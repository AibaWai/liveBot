const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const https = require('https');
const axios = require('axios');

// Express 設定
const app = express();
const PORT = process.env.PORT || 3000;

console.log('🚀 統一直播監控機器人啟動中...');
console.log('📺 Instagram 監控 + Discord 頻道監控 + 電話通知');

// === 環境變數檢查 ===
const requiredEnvVars = [
    'DISCORD_TOKEN', 
    'NOTIFICATION_CHANNEL_ID',
    'TARGET_USERNAME'
];

// 檢查多帳號配置
let hasMultiAccount = false;
for (let i = 1; i <= 10; i++) {
    if (process.env[`IG_ACCOUNT_${i}`]) {
        hasMultiAccount = true;
        console.log(`✅ 發現Instagram帳號 ${i}`);
        break;
    }
}

if (!hasMultiAccount) {
    requiredEnvVars.push('IG_SESSION_ID', 'IG_CSRF_TOKEN', 'IG_DS_USER_ID');
    console.log('📱 使用單帳號模式');
} else {
    console.log('🔄 使用多帳號輪換模式');
}

// Discord監控配置（可選）
let discordChannelConfigs = {};
if (process.env.CHANNEL_CONFIGS) {
    try {
        discordChannelConfigs = JSON.parse(process.env.CHANNEL_CONFIGS);
        console.log('📋 Discord頻道監控配置載入:', Object.keys(discordChannelConfigs).length, '個頻道');
        
        // 驗證每個頻道配置
        for (const [channelId, channelConfig] of Object.entries(discordChannelConfigs)) {
            if (!channelConfig.keywords || !Array.isArray(channelConfig.keywords)) {
                console.error(`❌ 頻道 ${channelId} 的 keywords 設定錯誤，必須是陣列`);
                process.exit(1);
            }
            if (!channelConfig.message) {
                console.error(`❌ 頻道 ${channelId} 缺少 message 設定`);
                process.exit(1);
            }
            
            // 檢查電話通知配置（可選）
            if (channelConfig.api_key && channelConfig.phone_number) {
                if (!channelConfig.caller_id) {
                    console.warn(`⚠️ 頻道 ${channelId} 缺少 caller_id，將使用預設值 '1'`);
                    channelConfig.caller_id = '1';
                }
                console.log(`📞 頻道 ${channelId} 電話配置:`);
                console.log(`   API Key: ${channelConfig.api_key.substring(0, 8)}****`);
                console.log(`   來電顯示ID: ${channelConfig.caller_id}`);
                console.log(`   通知號碼: ${channelConfig.phone_number}`);
            }
            
            console.log(`✅ 頻道 ${channelId} (${channelConfig.name || '未命名'}) 配置有效`);
        }
    } catch (error) {
        console.warn('⚠️ Discord頻道配置解析失敗，將只監控Instagram');
        console.warn('錯誤詳情:', error.message);
    }
}

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
    console.error('❌ 缺少必要環境變數:', missingVars.join(', '));
    process.exit(1);
}

// === 配置整合 ===
const config = {
    // Discord Bot 基本配置
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    NOTIFICATION_CHANNEL_ID: process.env.NOTIFICATION_CHANNEL_ID,
    
    // Instagram 監控配置
    TARGET_USERNAME: process.env.TARGET_USERNAME,
    IG_SESSION_ID: process.env.IG_SESSION_ID,
    IG_CSRF_TOKEN: process.env.IG_CSRF_TOKEN,
    IG_DS_USER_ID: process.env.IG_DS_USER_ID,
    
    // Discord 頻道監控配置
    CHANNEL_CONFIGS: discordChannelConfigs,
    
    // PushCall 配置 (可選)
    PUSHCALL_API_KEY: process.env.PUSHCALL_API_KEY,
    PUSHCALL_FROM: process.env.PUSHCALL_FROM,
    PUSHCALL_TO: process.env.PUSHCALL_TO
};

// === Instagram 監控配置 ===
const SAFETY_CONFIG = {
    minInterval: 90,
    maxInterval: 180,
    maxConsecutiveErrors: 3,
    backoffMultiplier: 2,
    maxBackoffInterval: 600,
    rateLimitCooldown: 900,
};

// === 統一狀態管理 ===
let unifiedState = {
    // Bot 基本狀態
    startTime: Date.now(),
    botReady: false,
    
    // Instagram 監控狀態
    instagram: {
        isLiveNow: false,
        targetUserId: null,
        isMonitoring: false,
        consecutiveErrors: 0,
        currentInterval: SAFETY_CONFIG.minInterval,
        accountStatus: 'unknown',
        totalRequests: 0,
        successfulRequests: 0,
        lastSuccessTime: Date.now(),
        lastCheck: null
    },
    
    // Discord 頻道監控狀態
    discord: {
        totalMessagesProcessed: 0,
        channelStats: {},
        lastDetections: [],
        apiUsage: {}
    },
    
    // 通知統計
    notifications: {
        discordMessages: 0,
        phoneCallsMade: 0,
        lastNotification: null
    }
};

// 初始化Discord頻道統計
for (const [channelId, channelConfig] of Object.entries(config.CHANNEL_CONFIGS)) {
    unifiedState.discord.channelStats[channelId] = {
        messagesProcessed: 0,
        keywordsDetected: 0,
        callsMade: 0,
        lastDetection: null,
        lastCallSuccess: null,
        lastCallError: null
    };
    
    const apiKey = channelConfig.api_key ? channelConfig.api_key.substring(0, 8) : 'default';
    if (!unifiedState.discord.apiUsage[apiKey]) {
        unifiedState.discord.apiUsage[apiKey] = {
            totalCalls: 0,
            successCalls: 0,
            failedCalls: 0,
            lastUsed: null,
            phoneNumbers: new Set()
        };
    }
    if (channelConfig.phone_number) {
        unifiedState.discord.apiUsage[apiKey].phoneNumbers.add(channelConfig.phone_number);
    }
}

// === Discord Client 設定 ===
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// === 簡化Instagram監控系統 ===
let instagramMonitor = null;

async function startInstagramMonitoring() {
    try {
        if (instagramMonitor && instagramMonitor.isMonitoring) {
            console.log('⚠️ [Instagram] 監控已在運行中');
            return;
        }
        
        const SimplifiedInstagramMonitor = require('./simplified_instagram_monitor');
        instagramMonitor = new SimplifiedInstagramMonitor();
        
        console.log('🚀 [Instagram] 啟動簡化監控系統');
        
        await instagramMonitor.startMonitoring(config.TARGET_USERNAME, async () => {
            // 檢測到直播時的處理
            if (!unifiedState.instagram.isLiveNow) {
                unifiedState.instagram.isLiveNow = true;
                console.log('🔴 [Instagram] 檢測到直播開始!');
                
                await sendNotification(`🔴 **@${config.TARGET_USERNAME} Instagram直播開始!** 🎥

📺 觀看: https://www.instagram.com/${config.TARGET_USERNAME}/
⏰ 檢測時間: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
🛡️ 3帳號輪換系統 + 時間段智能監控
🌙 深夜模式: 自動降低檢查頻率

🚀 快去看直播吧！`, 'live_alert', 'Instagram');
            }
        });
        
        // 更新狀態
        unifiedState.instagram.isMonitoring = true;
        
    } catch (error) {
        console.error('❌ [Instagram] 簡化監控啟動失敗:', error.message);
        // 可以在這裡加入降級處理
    }
}

// 停止Instagram監控
function stopInstagramMonitoring() {
    if (instagramMonitor) {
        instagramMonitor.stopMonitoring();
        unifiedState.instagram.isMonitoring = false;
        console.log('⏹️ [Instagram] 監控已停止');
    }
}

// 獲取Instagram監控狀態
function getInstagramStatus() {
    if (instagramMonitor) {
        return instagramMonitor.getStatus();
    }
    return {
        isMonitoring: false,
        totalAccounts: 0,
        availableAccounts: 0,
        dailyRequests: 0,
        maxDailyRequests: 0
    };
}

// 統一通知函數
async function sendNotification(message, type = 'info', source = 'system') {
    try {
        const channel = await client.channels.fetch(config.NOTIFICATION_CHANNEL_ID);
        if (message.length > 1900) message = message.substring(0, 1900) + '...(truncated)';
        
        await channel.send(message);
        unifiedState.notifications.discordMessages++;
        unifiedState.notifications.lastNotification = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
        
        console.log(`📤 [${source}] Discord通知已發送: ${type}`);
        
        // 只有 Instagram 直播通知才調用統一電話通知
        if (type === 'live_alert' && source === 'Instagram' && config.PUSHCALL_API_KEY) {
            await makePhoneCall(`${config.TARGET_USERNAME} 開始直播了！`, source);
        }
    } catch (error) {
        console.error('❌ Discord通知發送失敗:', error.message);
    }
}

// 電話通知函數
async function makePhoneCall(message, source = 'system') {
    if (!config.PUSHCALL_API_KEY || !config.PUSHCALL_TO) {
        console.log('📞 電話通知未配置，跳過');
        return;
    }
    
    try {
        const apiUrl = new URL('https://pushcall.me/api/call');
        apiUrl.searchParams.append('api_key', config.PUSHCALL_API_KEY);
        apiUrl.searchParams.append('from', config.PUSHCALL_FROM || '1');
        apiUrl.searchParams.append('to', config.PUSHCALL_TO.replace('+', ''));
        
        const response = await axios.get(apiUrl.toString(), { timeout: 30000 });
        
        if (response.status === 200) {
            unifiedState.notifications.phoneCallsMade++;
            console.log(`✅ [${source}] 電話通知撥打成功`);
        }
    } catch (error) {
        console.error(`❌ [${source}] 電話通知失敗:`, error.message);
    }
}

// === Discord 事件處理 ===
client.once('ready', () => {
    unifiedState.botReady = true;
    console.log(`✅ Discord Bot 已上線: ${client.user.tag}`);
    console.log(`📺 Instagram監控目標: @${config.TARGET_USERNAME}`);
    console.log(`📋 Discord頻道監控: ${Object.keys(config.CHANNEL_CONFIGS).length} 個頻道`);
    
    // 發送啟動通知
    sendNotification(`🚀 **統一直播監控機器人已啟動**

**Instagram監控:** @${config.TARGET_USERNAME}
**Discord頻道監控:** ${Object.keys(config.CHANNEL_CONFIGS).length} 個頻道
**電話通知:** ${config.PUSHCALL_API_KEY ? '✅ 已配置' : '❌ 未配置'}

📋 **可用命令:**
\`!ig-start\` - 開始Instagram監控
\`!ig-stop\` - 停止Instagram監控
\`!ig-status\` - Instagram監控狀態
\`!ig-check\` - 手動檢查Instagram
\`!status\` - 完整系統狀態
\`!help\` - 顯示幫助

🔄 準備開始監控...`, 'info', 'System');
    
    // 自動開始Instagram監控
    startInstagramMonitoring().then(() => {
    // Instagram監控啟動後，初始化Web狀態面板
    setTimeout(() => {
        initializeWebStatusPanel();
    }, 2000); // 等待2秒確保所有組件都已初始化
    });
});

// Discord消息監聽 (Discord頻道監控)
client.on('messageCreate', async (message) => {
    try {
        // 統計
        unifiedState.discord.totalMessagesProcessed++;
        
        // 忽略自己的消息
        if (message.author.bot && message.author.id === client.user.id) return;
        
        // Discord命令處理
        if (message.content.startsWith('!')) {
            await handleDiscordCommands(message);
            return;
        }
        
        // Discord頻道監控
        const channelId = message.channel.id;
        if (!config.CHANNEL_CONFIGS[channelId]) return;
        
        const channelConfig = config.CHANNEL_CONFIGS[channelId];
        const messageContent = message.content.toLowerCase();
        
        // 更新統計
        unifiedState.discord.channelStats[channelId].messagesProcessed++;
        
        // 檢查關鍵字
        let foundKeyword = null;
        for (const keyword of channelConfig.keywords) {
            if (messageContent.includes(keyword.toLowerCase())) {
                foundKeyword = keyword;
                break;
            }
        }
        
        if (foundKeyword) {
            unifiedState.discord.channelStats[channelId].keywordsDetected++;
            unifiedState.discord.channelStats[channelId].lastDetection = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
            
            console.log(`🔔 [Discord頻道監控] 檢測到關鍵字: "${foundKeyword}"`);
            
            // 記錄檢測
            const detection = {
                時間: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
                頻道: channelConfig.name || channelId,
                關鍵字: foundKeyword,
                訊息: message.content.substring(0, 150),
                作者: message.author.username
            };
            unifiedState.discord.lastDetections.push(detection);
            
            
            
            // 電話通知 (如果配置了專用API)
            if (channelConfig.api_key && channelConfig.phone_number) {
                await callChannelSpecificAPI(channelId, channelConfig, foundKeyword, message.content);
            }
        }
        
    } catch (error) {
        console.error('❌ [Discord消息處理] 錯誤:', error.message);
    }
});

// Discord命令處理
async function handleDiscordCommands(message) {
    const cmd = message.content.toLowerCase();
    
    if (cmd === '!ig-start') {
        if (unifiedState.instagram.isMonitoring) {
            await message.reply('⚠️ Instagram監控已在運行中!');
        } else {
            await message.reply('🚀 開始Instagram監控...');
            startInstagramMonitoring();
        }
    }
    
    else if (cmd === '!ig-stop') {
        stopInstagramMonitoring();
        await message.reply('⏹️ Instagram監控已停止');
    }
    
    else if (cmd === '!ig-status') {
        const runtime = Math.round((Date.now() - unifiedState.startTime) / 60000);
        const igStatus = getInstagramStatus();
        
        const statusMsg = `📊 **Instagram監控狀態**

    **目標:** @${config.TARGET_USERNAME}
    **當前狀態:** ${unifiedState.instagram.isLiveNow ? '🔴 直播中' : '⚫ 離線'}
    **監控:** ${igStatus.isMonitoring ? '✅ 運行中' : '❌ 已停止'}

    **3帳號輪換系統:**
    ⏱️ 運行時間: ${runtime} 分鐘
    🔐 總帳號數: ${igStatus.totalAccounts}
    ✅ 可用帳號: ${igStatus.availableAccounts}
    📊 今日請求: ${igStatus.dailyRequests}/${igStatus.maxDailyRequests}

    **時間段智能監控:**
    🌙 深夜 (02-06): 10分鐘間隔
    🌅 早晨 (07-08): 3分鐘間隔  
    ☀️ 活躍 (09-24): 90秒間隔
    🌃 深夜前期 (00-02): 5分鐘間隔`;

        await message.reply(statusMsg);
    }
    
    else if (cmd === '!ig-check') {
        await message.reply('🔍 執行手動Instagram檢查...');
        
        if (instagramMonitor) {
            try {
                const isLive = await instagramMonitor.checkLive(config.TARGET_USERNAME);
                const status = isLive ? '🔴 發現直播' : '⚫ 無直播';
                const igStatus = getInstagramStatus();
                
                await message.reply(`📊 **手動檢查結果:** ${status}

    🔐 可用帳號: ${igStatus.availableAccounts}/${igStatus.totalAccounts}
    📊 今日請求: ${igStatus.dailyRequests}/${igStatus.maxDailyRequests}`);
            } catch (error) {
                await message.reply(`❌ 檢查失敗: ${error.message}`);
            }
        } else {
            await message.reply('❌ 監控系統未初始化');
        }
    }
    
    else if (cmd === '!status') {
        const runtime = Math.round((Date.now() - unifiedState.startTime) / 60000);
        
        const statusMsg = `📊 **統一監控系統狀態**

**系統運行時間:** ${runtime} 分鐘
**Bot狀態:** ${unifiedState.botReady ? '✅ 在線' : '❌ 離線'}

**Instagram監控:**
• 目標: @${config.TARGET_USERNAME}
• 狀態: ${unifiedState.instagram.isLiveNow ? '🔴 直播中' : '⚫ 離線'}
• 監控: ${unifiedState.instagram.isMonitoring ? '✅ 運行中' : '❌ 停止'}
• 成功率: ${unifiedState.instagram.totalRequests > 0 ? Math.round((unifiedState.instagram.successfulRequests / unifiedState.instagram.totalRequests) * 100) : 0}%

**Discord頻道監控:**
• 監控頻道數: ${Object.keys(config.CHANNEL_CONFIGS).length}
• 處理訊息數: ${unifiedState.discord.totalMessagesProcessed}
• 檢測次數: ${unifiedState.discord.lastDetections.length}

**通知統計:**
• Discord訊息: ${unifiedState.notifications.discordMessages}
• 電話通知: ${unifiedState.notifications.phoneCallsMade}
• 最後通知: ${unifiedState.notifications.lastNotification || '無'}`;

        await message.reply(statusMsg);
    }
    
    else if (cmd === '!help') {
        await message.reply(`🔍 **統一直播監控機器人**

**Instagram監控命令:**
\`!ig-start\` - 開始Instagram監控
\`!ig-stop\` - 停止Instagram監控
\`!ig-status\` - Instagram監控狀態
\`!ig-check\` - 手動檢查Instagram

**系統命令:**
\`!status\` - 完整系統狀態
\`!help\` - 顯示此幫助

**功能:**
🔒 Instagram安全監控 (90-180s隨機間隔)
📺 Discord頻道關鍵字監控
📞 電話通知 (如果配置)
🛡️ 自動錯誤處理與恢復`);
    }
}

// 頻道專用API呼叫
// 頻道專用API呼叫
async function callChannelSpecificAPI(channelId, channelConfig, keyword, originalMessage) {
    if (!channelConfig.api_key || !channelConfig.phone_number) return;
    
    const apiKeyShort = channelConfig.api_key.substring(0, 8);
    
    try {
        const apiUrl = new URL('https://pushcall.me/api/call');
        apiUrl.searchParams.append('api_key', channelConfig.api_key);
        apiUrl.searchParams.append('from', channelConfig.caller_id || '1'); // 修改這行
        apiUrl.searchParams.append('to', channelConfig.phone_number.replace('+', ''));
        
        unifiedState.discord.apiUsage[apiKeyShort].totalCalls++;
        unifiedState.discord.apiUsage[apiKeyShort].lastUsed = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
        
        const response = await axios.get(apiUrl.toString(), { timeout: 30000 });
        
        if (response.status === 200) {
            unifiedState.discord.channelStats[channelId].callsMade++;
            unifiedState.discord.channelStats[channelId].lastCallSuccess = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
            unifiedState.discord.apiUsage[apiKeyShort].successCalls++;
            unifiedState.notifications.phoneCallsMade++;
            
            console.log(`✅ [頻道專用API] 電話通知成功: ${channelConfig.name || channelId}`);
        }
    } catch (error) {
        unifiedState.discord.apiUsage[apiKeyShort].failedCalls++;
        unifiedState.discord.channelStats[channelId].lastCallError = `${error.message}: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`;
        
        console.error(`❌ [頻道專用API] 電話通知失敗: ${channelConfig.name || channelId}`);
        console.error('錯誤:', error.message);
    }
}

// === Web 狀態面板整合 ===
function getInstagramMonitorInstance() {
    return instagramMonitor;
}

// 等待所有組件初始化後再設置狀態面板
let webStatusPanel = null;

function initializeWebStatusPanel() {
    if (!webStatusPanel && instagramMonitor) {
        const WebStatusPanel = require('./web_status_panel');
        webStatusPanel = new WebStatusPanel(app, unifiedState, config, client, getInstagramMonitorInstance);
        console.log('🌐 [Web面板] 狀態面板已初始化');
    }
}




// 啟動Express服務器
app.listen(PORT, () => {
    console.log(`🌐 HTTP伺服器運行在 port ${PORT}`);
});

// === 錯誤處理 ===
client.on('error', (error) => {
    console.error('❌ Discord客戶端錯誤:', error.message);
});

client.on('warn', (warning) => {
    console.warn('⚠️ Discord警告:', warning);
});

process.on('unhandledRejection', (error) => {
    console.error('❌ 未處理的Promise錯誤:', error);
});

process.on('uncaughtException', (error) => {
    console.error('❌ 未捕獲的例外錯誤:', error);
    process.exit(1);
});

// 優雅關閉
process.on('SIGINT', async () => {
    console.log('🛑 收到終止信號，正在安全關閉...');
    unifiedState.instagram.isMonitoring = false;
    
    if (unifiedState.botReady) {
        await sendNotification('📴 統一監控機器人正在關閉...', 'info', 'System');
    }
    
    client.destroy();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('🛑 收到終止信號，正在安全關閉...');
    unifiedState.instagram.isMonitoring = false;
    client.destroy();
    process.exit(0);
});



// === 啟動 Discord Bot ===
console.log('🔐 正在登入Discord...');
client.login(config.DISCORD_TOKEN).catch(error => {
    console.error('❌ Discord Bot登入失敗:', error.message);
    console.error('🔑 請檢查DISCORD_TOKEN是否正確');
    process.exit(1);
});