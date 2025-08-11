const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');

// Express 設定
const app = express();
const PORT = process.env.PORT || 3000;

console.log('🚀 升級版直播監控機器人啟動中...');
console.log('📺 Instagram 3帳號輪換監控 + Discord 頻道監控 + 電話通知');

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

// Discord監控配置（保持原邏輯）
let discordChannelConfigs = {};
if (process.env.CHANNEL_CONFIGS) {
    try {
        discordChannelConfigs = JSON.parse(process.env.CHANNEL_CONFIGS);
        console.log('📋 Discord頻道監控配置載入:', Object.keys(discordChannelConfigs).length, '個頻道');
        
        // 驗證每個頻道配置（保持原邏輯）
        for (const [channelId, channelConfig] of Object.entries(discordChannelConfigs)) {
            if (!channelConfig.keywords || !Array.isArray(channelConfig.keywords)) {
                console.error(`❌ 頻道 ${channelId} 的 keywords 設定錯誤，必須是陣列`);
                process.exit(1);
            }
            if (!channelConfig.message) {
                console.error(`❌ 頻道 ${channelId} 缺少 message 設定`);
                process.exit(1);
            }
            if (!channelConfig.api_key) {
                console.error(`❌ 頻道 ${channelId} 缺少 api_key 設定`);
                process.exit(1);
            }
            if (!channelConfig.phone_number) {
                console.error(`❌ 頻道 ${channelId} 缺少 phone_number 設定`);
                process.exit(1);
            }
            
            // 確保有 caller_id
            if (!channelConfig.caller_id) {
                console.warn(`⚠️ 頻道 ${channelId} 缺少 caller_id，將使用預設值 '1'`);
                channelConfig.caller_id = '1';
            }
            
            console.log(`🔑 頻道 ${channelId} 使用 API Key: ${channelConfig.api_key.substring(0, 8)}****`);
            console.log(`📱 頻道 ${channelId} 通知號碼: ${channelConfig.phone_number}`);
        }
    } catch (error) {
        console.warn('⚠️ Discord頻道配置解析失敗，將只監控Instagram');
        console.warn('錯誤詳情:', error.message);
    }
}

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
    console.error('❌ 缺少必要環境變數:', missingVars.join(', '));
    console.error('\n📝 多帳號配置格式:');
    console.error('IG_ACCOUNT_1=sessionid1|csrftoken1|ds_user_id1');
    console.error('IG_ACCOUNT_2=sessionid2|csrftoken2|ds_user_id2');
    console.error('IG_ACCOUNT_3=sessionid3|csrftoken3|ds_user_id3');
    process.exit(1);
}

// === 配置整合 ===
const config = {
    // Discord Bot 基本配置
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    NOTIFICATION_CHANNEL_ID: process.env.NOTIFICATION_CHANNEL_ID,
    
    // Instagram 監控配置
    TARGET_USERNAME: process.env.TARGET_USERNAME,
    
    // Discord 頻道監控配置（保持原邏輯）
    CHANNEL_CONFIGS: discordChannelConfigs,
    
    // PushCall 配置 (可選)
    PUSHCALL_API_KEY: process.env.PUSHCALL_API_KEY,
    PUSHCALL_FROM: process.env.PUSHCALL_FROM,
    PUSHCALL_TO: process.env.PUSHCALL_TO
};

console.log('📋 監控設定摘要:');
console.log(`📺 Instagram監控: @${config.TARGET_USERNAME} (${hasMultiAccount ? '多帳號輪換' : '單帳號'})`);
for (const [channelId, channelConfig] of Object.entries(config.CHANNEL_CONFIGS)) {
    console.log(`   📺 頻道 ${channelId} (${channelConfig.name || '未命名'}):`);
    console.log(`      🔍 關鍵字: ${channelConfig.keywords.join(', ')}`);
    console.log(`      💬 通知訊息: ${channelConfig.message}`);
    console.log(`      🔑 API Key: ${channelConfig.api_key.substring(0, 8)}****`);
    console.log(`      📞 電話: ${channelConfig.phone_number}`);
}

// === Discord Client 設定 ===
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// === 統計資訊（保持原邏輯 + 新增Instagram統計） ===
let stats = {
    startTime: Date.now(),
    totalMessagesProcessed: 0,
    channelStats: {},
    lastDetections: [],
    apiUsage: {}, // Discord頻道API使用情況
    
    // 新增Instagram統計
    instagram: {
        isLiveNow: false,
        isMonitoring: false,
        totalRequests: 0,
        successfulRequests: 0,
        accountStatus: 'unknown',
        lastCheck: null,
        monitorStartTime: null
    }
};

// 初始化Discord頻道統計（保持原邏輯）
for (const [channelId, channelConfig] of Object.entries(config.CHANNEL_CONFIGS)) {
    stats.channelStats[channelId] = {
        messagesProcessed: 0,
        keywordsDetected: 0,
        callsMade: 0,
        lastDetection: null,
        lastCallSuccess: null,
        lastCallError: null
    };
    
    // 初始化API使用統計
    const apiKey = channelConfig.api_key.substring(0, 8);
    if (!stats.apiUsage[apiKey]) {
        stats.apiUsage[apiKey] = {
            totalCalls: 0,
            successCalls: 0,
            failedCalls: 0,
            lastUsed: null,
            phoneNumbers: new Set()
        };
    }
    stats.apiUsage[apiKey].phoneNumbers.add(channelConfig.phone_number);
}

// === Instagram 監控（使用新的簡化監控器） ===
const SimplifiedInstagramMonitor = require('./simplified_instagram_monitor');
let instagramMonitor = null;

// 啟動Instagram監控 (包含Cookie監控)
async function startInstagramMonitoring() {
    if (stats.instagram.isMonitoring) {
        console.log('⚠️ Instagram監控已在運行中');
        return;
    }
    
    try {
        console.log('🚀 [Instagram] 啟動3帳號輪換監控 + Cookie監控...');
        
        instagramMonitor = new SimplifiedInstagramMonitor();
        
        // 設置Cookie警告回調
        instagramMonitor.setCookieAlertCallback(async (message, level, accountId) => {
            await sendCookieAlert(message, level, accountId);
        });
        
        stats.instagram.isMonitoring = true;
        stats.instagram.monitorStartTime = Date.now();
        
        await instagramMonitor.startMonitoring(config.TARGET_USERNAME, async () => {
            // 檢測到直播的回調
            stats.instagram.isLiveNow = true;
            console.log('🔴 [Instagram] 檢測到直播開始!');
            
            // 發送通知（結合原有Discord通知 + 新的電話通知）
            await sendInstagramLiveNotification();
        });
        
        console.log('✅ [Instagram] 監控啟動成功 (包含Cookie自動檢測)');
        
    } catch (error) {
        console.error('❌ [Instagram] 監控啟動失敗:', error.message);
        stats.instagram.isMonitoring = false;
    }
}

// 發送Cookie警告
async function sendCookieAlert(message, level, accountId) {
    try {
        const channel = await client.channels.fetch(config.NOTIFICATION_CHANNEL_ID);
        
        // 根據警告級別調整消息格式
        let formattedMessage = message;
        if (level === 'critical') {
            formattedMessage = `🚨 **CRITICAL** ${message}

@everyone **需要立即處理！**`;
        }
        
        await channel.send(formattedMessage);
        console.log(`🔔 [Cookie警告] ${level} 級別警告已發送: ${accountId}`);
        
        // 如果是關鍵警告，也發送電話通知
        if (level === 'critical' && config.PUSHCALL_API_KEY && config.PUSHCALL_TO) {
            await makeCookiePhoneCall(accountId);
        }
        
    } catch (error) {
        console.error('❌ [Cookie警告] 發送失敗:', error.message);
    }
}

// Cookie過期電話通知
async function makeCookiePhoneCall(accountId) {
    try {
        const apiUrl = new URL('https://pushcall.me/api/call');
        apiUrl.searchParams.append('api_key', config.PUSHCALL_API_KEY);
        apiUrl.searchParams.append('from', config.PUSHCALL_FROM || '1');
        apiUrl.searchParams.append('to', config.PUSHCALL_TO.replace('+', ''));
        
        const response = await axios.get(apiUrl.toString(), { timeout: 30000 });
        
        if (response.status === 200) {
            console.log(`📞 [Cookie警告] ${accountId} 過期電話通知已發送`);
        }
    } catch (error) {
        console.error(`❌ [Cookie警告] ${accountId} 電話通知失敗:`, error.message);
    }
}動失敗:', error.message);
        stats.instagram.isMonitoring = false;
    }
}

// Instagram直播通知
async function sendInstagramLiveNotification() {
    try {
        // Discord通知
        const channel = await client.channels.fetch(config.NOTIFICATION_CHANNEL_ID);
        const message = `🔴 **@${config.TARGET_USERNAME} Instagram直播開始!** 🎥

📺 觀看: https://www.instagram.com/${config.TARGET_USERNAME}/
⏰ 檢測時間: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
🛡️ 3帳號輪換系統 + 時間段智能監控
⚡ 90秒-10分鐘動態間隔

🚀 快去看直播吧！`;

        await channel.send(message);
        console.log('📤 [Instagram] Discord通知已發送');
        
        // 電話通知
        if (config.PUSHCALL_API_KEY && config.PUSHCALL_TO) {
            await makeInstagramPhoneCall();
        }
        
    } catch (error) {
        console.error('❌ [Instagram] 通知發送失敗:', error.message);
    }
}

// Instagram電話通知
async function makeInstagramPhoneCall() {
    try {
        const apiUrl = new URL('https://pushcall.me/api/call');
        apiUrl.searchParams.append('api_key', config.PUSHCALL_API_KEY);
        apiUrl.searchParams.append('from', config.PUSHCALL_FROM || '1');
        apiUrl.searchParams.append('to', config.PUSHCALL_TO.replace('+', ''));
        
        const response = await axios.get(apiUrl.toString(), { timeout: 30000 });
        
        if (response.status === 200) {
            console.log('✅ [Instagram] 電話通知撥打成功');
        }
    } catch (error) {
        console.error('❌ [Instagram] 電話通知失敗:', error.message);
    }
}

// === Discord Bot 事件處理（保持原邏輯） ===
client.once('ready', () => {
    console.log(`✅ Discord Bot 已上線: ${client.user.tag}`);
    console.log(`🏠 已加入 ${client.guilds.cache.size} 個伺服器`);
    console.log(`📺 Instagram監控目標: @${config.TARGET_USERNAME}`);
    console.log(`📋 Discord頻道監控: ${Object.keys(config.CHANNEL_CONFIGS).length} 個頻道`);
    console.log(`🔑 使用 ${Object.keys(stats.apiUsage).length} 個 PushCall API 帳號`);
    
    // 設定 Bot 狀態
    const totalChannels = Object.keys(config.CHANNEL_CONFIGS).length;
    client.user.setActivity(`監聽 ${totalChannels} 個頻道 + Instagram`, { type: 'WATCHING' });
    
    // 自動開始Instagram監控
    startInstagramMonitoring();
    
    console.log('⏰ 開始多功能監聽...');
});

// 監聽所有訊息（保持原邏輯）
client.on('messageCreate', async (message) => {
    try {
        // 統計總處理的訊息數
        stats.totalMessagesProcessed++;
        
        // 忽略自己的訊息
        if (message.author.bot && message.author.id === client.user.id) {
            return;
        }
        
        // Discord命令處理
        if (message.content.startsWith('!')) {
            await handleDiscordCommands(message);
            return;
        }
        
        // 檢查是否為我們監聽的頻道
        const channelId = message.channel.id;
        if (!config.CHANNEL_CONFIGS[channelId]) {
            return; // 不是我們監聽的頻道，忽略
        }
        
        // 更新頻道統計
        stats.channelStats[channelId].messagesProcessed++;
        
        const channelConfig = config.CHANNEL_CONFIGS[channelId];
        const messageContent = message.content.toLowerCase();
        
        console.log(`📨 [頻道 ${channelConfig.name || channelId}] 收到訊息: ${message.content.substring(0, 100)}...`);
        
        // 檢查是否包含任何關鍵字
        let foundKeyword = null;
        for (const keyword of channelConfig.keywords) {
            if (messageContent.includes(keyword.toLowerCase())) {
                foundKeyword = keyword;
                break;
            }
        }
        
        if (foundKeyword) {
            // 更新統計
            stats.channelStats[channelId].keywordsDetected++;
            stats.channelStats[channelId].lastDetection = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
            
            // 記錄最近偵測
            const detection = {
                時間: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
                頻道: channelConfig.name || channelId,
                頻道ID: channelId,
                關鍵字: foundKeyword,
                訊息: message.content.substring(0, 150),
                作者: message.author.username,
                使用API: channelConfig.api_key.substring(0, 8) + '****',
                通知號碼: channelConfig.phone_number
            };
            stats.lastDetections.push(detection);
            
            // 只保留最近50次記錄
            if (stats.lastDetections.length > 50) {
                stats.lastDetections = stats.lastDetections.slice(-50);
            }
            
            console.log(`🔔 [${channelConfig.name || channelId}] 偵測到關鍵字: "${foundKeyword}"`);
            console.log(`📄 完整訊息: ${message.content}`);
            console.log(`🔑 將使用 API: ${channelConfig.api_key.substring(0, 8)}****`);
            console.log(`📞 通知號碼: ${channelConfig.phone_number}`);
            
            // 提取 YouTube 連結 (選用)
            const youtubeMatch = message.content.match(/https:\/\/www\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)/);
            const youtubeUrl = youtubeMatch ? youtubeMatch[0] : '';
            
            if (youtubeUrl) {
                console.log(`🎬 YouTube 連結: ${youtubeUrl}`);
            }
            
            // 呼叫對應的 PushCall API（保持原邏輯）
            await callPushCall(channelId, channelConfig, foundKeyword, message.content, youtubeUrl);
        }
    } catch (error) {
        console.error('❌ 處理訊息時發生錯誤:', error.message);
    }
});

// Discord命令處理（新增Instagram命令）
async function handleDiscordCommands(message) {
    const cmd = message.content.toLowerCase();
    
    // Instagram監控命令
    if (cmd === '!ig-start') {
        if (stats.instagram.isMonitoring) {
            await message.reply('⚠️ Instagram監控已在運行中!');
        } else {
            await message.reply('🚀 開始Instagram 3帳號輪換監控...');
            await startInstagramMonitoring();
        }
    }
    else if (cmd === '!ig-stop') {
        if (instagramMonitor) {
            instagramMonitor.stopMonitoring();
            stats.instagram.isMonitoring = false;
            await message.reply('⏹️ Instagram監控已停止');
        } else {
            await message.reply('⚠️ Instagram監控未運行');
        }
    }
    else if (cmd === '!ig-status') {
        if (instagramMonitor) {
            const monitorStatus = instagramMonitor.getStatus();
            const runtime = stats.instagram.monitorStartTime ? 
                Math.round((Date.now() - stats.instagram.monitorStartTime) / 60000) : 0;
            
            const statusMsg = `📊 **Instagram監控狀態**

**目標:** @${config.TARGET_USERNAME}
**當前狀態:** ${stats.instagram.isLiveNow ? '🔴 直播中' : '⚫ 離線'}
**監控模式:** 3帳號輪換 + 時間段智能
**運行狀態:** ${monitorStatus.isMonitoring ? '✅ 運行中' : '❌ 已停止'}

**帳號統計:**
• 總帳號數: ${monitorStatus.totalAccounts}
• 可用帳號: ${monitorStatus.availableAccounts}
• 今日請求: ${monitorStatus.dailyRequests}/${monitorStatus.maxDailyRequests}

**運行時間:** ${runtime} 分鐘
**最後檢查:** ${stats.instagram.lastCheck || '尚未檢查'}`;

            await message.reply(statusMsg);
        } else {
            await message.reply('❌ Instagram監控未初始化');
        }
    }
    else if (cmd === '!ig-check') {
        if (instagramMonitor) {
            await message.reply('🔍 執行手動Instagram檢查...');
            try {
                const isLive = await instagramMonitor.checkLive(config.TARGET_USERNAME);
                const status = isLive ? '🔴 發現直播' : '⚫ 無直播';
                await message.reply(`📊 **手動檢查結果:** ${status}`);
            } catch (error) {
                await message.reply(`❌ **檢查失敗:** ${error.message}`);
            }
        } else {
            await message.reply('❌ Instagram監控未運行');
        }
    }
    else if (cmd === '!cookie-status') {
        if (instagramMonitor) {
            const cookieStatus = instagramMonitor.getStatus().cookieStatus;
            const statusMsg = `🍪 **Cookie狀態報告**

**總帳號數:** ${cookieStatus.total}
**健康帳號:** ${cookieStatus.active} ✅
**警告帳號:** ${cookieStatus.warning} ⚠️
**過期帳號:** ${cookieStatus.expired} ❌
**未知狀態:** ${cookieStatus.unknown} ❓

**整體狀態:** ${getCookieStatusEmoji(cookieStatus.overallStatus)} ${cookieStatus.overallStatus}

${cookieStatus.overallStatus === 'some_expired' || cookieStatus.overallStatus === 'all_expired' ? 
'🚨 **需要更新Cookie！**' : 
cookieStatus.overallStatus === 'warning' ? 
'⚠️ **建議檢查Cookie狀態**' : 
'✅ **Cookie狀態正常**'}`;

            await message.reply(statusMsg);
        } else {
            await message.reply('❌ Instagram監控未運行');
        }
    }
    else if (cmd.startsWith('!cookie-check ')) {
        if (instagramMonitor) {
            const accountId = cmd.replace('!cookie-check ', '').trim();
            await message.reply(`🔍 檢查帳號 ${accountId} 的Cookie狀態...`);
            
            try {
                const result = await instagramMonitor.checkAccountCookie(accountId);
                const emoji = result.status === 'active' ? '✅' : 
                             result.status === 'expired' ? '❌' : 
                             result.status === 'warning' ? '⚠️' : '❓';
                
                await message.reply(`${emoji} **${accountId} Cookie檢查結果**

**狀態:** ${result.status}
**訊息:** ${result.message}
**檢查時間:** ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
            } catch (error) {
                await message.reply(`❌ **檢查失敗:** ${error.message}`);
            }
        } else {
            await message.reply('❌ Instagram監控未運行');
        }
    }
    else if (cmd === '!status') {
        const runtime = Math.round((Date.now() - stats.startTime) / 60000);
        const igRuntime = stats.instagram.monitorStartTime ? 
            Math.round((Date.now() - stats.instagram.monitorStartTime) / 60000) : 0;
        
        const statusMsg = `📊 **統一監控系統狀態**

**系統運行時間:** ${runtime} 分鐘
**Bot狀態:** ✅ 在線

**Instagram監控:**
• 目標: @${config.TARGET_USERNAME}
• 狀態: ${stats.instagram.isLiveNow ? '🔴 直播中' : '⚫ 離線'}
• 監控: ${stats.instagram.isMonitoring ? `✅ 運行中 (${igRuntime}分鐘)` : '❌ 停止'}
• 模式: 3帳號輪換 + 智能時間段

**Discord頻道監控:**
• 監控頻道數: ${Object.keys(config.CHANNEL_CONFIGS).length}
• 處理訊息數: ${stats.totalMessagesProcessed}
• 檢測次數: ${stats.lastDetections.length}

**API統計:**
• PushCall帳號: ${Object.keys(stats.apiUsage).length}`;

        await message.reply(statusMsg);
    }
    else if (cmd === '!help') {
        await message.reply(`🔍 **升級版直播監控機器人**

**Instagram監控命令:**
\`!ig-start\` - 開始Instagram 3帳號輪換監控
\`!ig-stop\` - 停止Instagram監控
\`!ig-status\` - Instagram監控詳細狀態
\`!ig-check\` - 手動檢查Instagram

**Cookie管理命令:**
\`!cookie-status\` - 查看所有帳號Cookie狀態
\`!cookie-check [帳號ID]\` - 檢查特定帳號Cookie
例如: \`!cookie-check account_1\`

**系統命令:**
\`!status\` - 完整系統狀態
\`!help\` - 顯示此幫助

**新功能:**
🔄 3帳號智能輪換 (永不停止)
🍪 自動Cookie狀態監控 + 提醒
🕐 時間段優化 (深夜減少請求)
🛡️ 防ban保護機制
⚡ 90秒-10分鐘動態間隔
📞 多API電話通知系統
🚨 Cookie過期緊急通知`);
    }
}

// Cookie狀態表情符號
function getCookieStatusEmoji(status) {
    switch (status) {
        case 'healthy': return '✅';
        case 'warning': return '⚠️';
        case 'some_expired': return '🔶';
        case 'all_expired': return '🚨';
        default: return '❓';
    }
}

// 呼叫 PushCall API 函數（保持原邏輯）
async function callPushCall(channelId, channelConfig, keyword, originalMessage, youtubeUrl = '') {
    const apiKeyShort = channelConfig.api_key.substring(0, 8);
    
    try {
        console.log(`📞 [${channelConfig.name || channelId}] 準備撥打電話通知...`);
        console.log(`🔑 使用 API Key: ${apiKeyShort}****`);
        console.log(`📱 目標號碼: ${channelConfig.phone_number}`);
        console.log(`💬 通知內容: ${channelConfig.message}`);
        console.log(`🔍 觸發關鍵字: ${keyword}`);
        
        // PushCall API 使用 GET 請求
        const apiUrl = new URL('https://pushcall.me/api/call');
        apiUrl.searchParams.append('api_key', channelConfig.api_key);
        apiUrl.searchParams.append('from', channelConfig.caller_id || '1');
        apiUrl.searchParams.append('to', channelConfig.phone_number.replace('+', ''));
        
        console.log(`🔗 [${channelConfig.name || channelId}] API URL: ${apiUrl.toString().replace(channelConfig.api_key, '****')}`);
        
        // 更新API使用統計
        stats.apiUsage[apiKeyShort].totalCalls++;
        stats.apiUsage[apiKeyShort].lastUsed = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
        
        // 發送 GET 請求
        const response = await axios.get(apiUrl.toString(), {
            headers: {
                'User-Agent': 'Discord-Live-Bot-Enhanced/2.0'
            },
            timeout: 30000 // 30秒超時
        });
        
        if (response.status === 200) {
            // 成功
            stats.channelStats[channelId].callsMade++;
            stats.channelStats[channelId].lastCallSuccess = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
            stats.apiUsage[apiKeyShort].successCalls++;
            
            console.log(`✅ [${channelConfig.name || channelId}] 電話通知撥打成功！`);
            console.log(`📊 API 回應:`, JSON.stringify(response.data, null, 2));
            console.log(`📈 API ${apiKeyShort}**** 使用統計: ${stats.apiUsage[apiKeyShort].successCalls}/${stats.apiUsage[apiKeyShort].totalCalls} 成功`);
        } else {
            // 異常狀態
            stats.apiUsage[apiKeyShort].failedCalls++;
            stats.channelStats[channelId].lastCallError = `狀態碼 ${response.status}: ${new Date().toLocaleString('ja-JP')}`;
            
            console.log(`⚠️ [${channelConfig.name || channelId}] API 回應狀態異常:`, response.status);
            console.log('📋 回應內容:', response.data);
        }
        
    } catch (error) {
        // 錯誤處理
        stats.apiUsage[apiKeyShort].failedCalls++;
        stats.channelStats[channelId].lastCallError = `${error.message}: ${new Date().toLocaleString('ja-JP')}`;
        
        console.error(`❌ [${channelConfig.name || channelId}] PushCall API 呼叫失敗:`);
        console.error(`🔑 API Key: ${apiKeyShort}****`);
        console.error('🔍 錯誤訊息:', error.message);
        
        if (error.response) {
            console.error('📋 API 錯誤回應:', error.response.status);
            console.error('📄 錯誤詳情:', error.response.data);
        } else if (error.request) {
            console.error('🌐 網路請求失敗，請檢查網路連線');
        }
    }
}

// === 健康檢查端點（更新版） ===
app.get('/', (req, res) => {
    const uptime = Math.floor((Date.now() - stats.startTime) / 1000);
    const channelStatsFormatted = {};
    
    // 格式化頻道統計（保持原邏輯）
    for (const [channelId, channelStat] of Object.entries(stats.channelStats)) {
        const channelConfig = config.CHANNEL_CONFIGS[channelId];
        channelStatsFormatted[channelId] = {
            頻道資訊: {
                名稱: channelConfig.name || '未命名',
                關鍵字: channelConfig.keywords,
                通知訊息: channelConfig.message,
                API帳號: channelConfig.api_key.substring(0, 8) + '****',
                通知號碼: channelConfig.phone_number
            },
            統計: {
                訊息處理數: channelStat.messagesProcessed,
                關鍵字偵測數: channelStat.keywordsDetected,
                通話撥打數: channelStat.callsMade,
                最後偵測時間: channelStat.lastDetection || '尚未偵測到',
                最後成功通話: channelStat.lastCallSuccess || '尚未成功',
                最後錯誤: channelStat.lastCallError || '無錯誤'
            }
        };
    }
    
    // 格式化API使用統計（保持原邏輯）
    const apiUsageFormatted = {};
    for (const [apiKey, usage] of Object.entries(stats.apiUsage)) {
        apiUsageFormatted[apiKey + '****'] = {
            總通話數: usage.totalCalls,
            成功數: usage.successCalls,
            失敗數: usage.failedCalls,
            成功率: usage.totalCalls > 0 ? `${Math.round(usage.successCalls / usage.totalCalls * 100)}%` : 'N/A',
            最後使用: usage.lastUsed || '尚未使用',
            關聯電話: Array.from(usage.phoneNumbers)
        };
    }
    
    // Instagram監控狀態
    const instagramStatus = instagramMonitor ? instagramMonitor.getStatus() : {
        isMonitoring: false,
        totalAccounts: 0,
        availableAccounts: 0,
        dailyRequests: 0,
        maxDailyRequests: 0
    };
    
    res.json({
        status: '升級版 Instagram + Discord Live Alert Bot 運行中 🤖📞📺',
        uptime: `${Math.floor(uptime / 3600)}小時 ${Math.floor((uptime % 3600) / 60)}分鐘`,
        bot_status: client.user ? `✅ ${client.user.tag}` : '❌ 未連線',
        connected_guilds: client.guilds.cache.size,
        
        // Instagram監控狀態 (包含Cookie信息)
        instagram_monitoring: {
            target_username: config.TARGET_USERNAME,
            is_live: stats.instagram.isLiveNow,
            is_monitoring: stats.instagram.isMonitoring,
            account_rotation: `${instagramStatus.availableAccounts}/${instagramStatus.totalAccounts} 帳號可用`,
            daily_requests: `${instagramStatus.dailyRequests}/${instagramStatus.maxDailyRequests}`,
            monitoring_mode: '3帳號輪換 + 時間段智能 + Cookie監控',
            cookie_status: instagramStatus.cookieStatus,
            last_check: stats.instagram.lastCheck
        },
        
        // Discord頻道監控（保持原邏輯）
        discord_monitoring: {
            monitoring_channels: Object.keys(config.CHANNEL_CONFIGS).length,
            total_messages_processed: stats.totalMessagesProcessed,
            api_accounts: Object.keys(stats.apiUsage).length,
            channels: channelStatsFormatted,
            api_usage: apiUsageFormatted,
            recent_detections: stats.lastDetections.slice(-10)
        },
        
        timestamp: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
    });
});

app.get('/health', (req, res) => {
    const instagramStatus = instagramMonitor ? instagramMonitor.getStatus() : {};
    
    res.json({ 
        status: client.user ? 'healthy' : 'unhealthy',
        bot: client.user?.tag || 'Not ready',
        instagram_monitoring: stats.instagram.isMonitoring,
        instagram_accounts: instagramStatus.totalAccounts || 0,
        discord_channels: Object.keys(config.CHANNEL_CONFIGS).length,
        apis: Object.keys(stats.apiUsage).length,
        uptime: Math.floor((Date.now() - stats.startTime) / 1000)
    });
});

// API 使用統計端點（保持原邏輯）
app.get('/api-stats', (req, res) => {
    const apiStatsDetailed = {};
    for (const [apiKey, usage] of Object.entries(stats.apiUsage)) {
        apiStatsDetailed[apiKey + '****'] = {
            ...usage,
            phoneNumbers: Array.from(usage.phoneNumbers)
        };
    }
    
    // 新增Instagram監控統計
    const instagramStats = instagramMonitor ? instagramMonitor.getStatus() : {};
    
    res.json({
        discord_apis: apiStatsDetailed,
        instagram_monitoring: instagramStats,
        system_stats: {
            total_messages_processed: stats.totalMessagesProcessed,
            instagram_is_live: stats.instagram.isLiveNow,
            instagram_monitoring: stats.instagram.isMonitoring
        }
    });
});

// Instagram監控統計端點（新增）
app.get('/instagram-stats', (req, res) => {
    if (instagramMonitor) {
        res.json(instagramMonitor.getStatus());
    } else {
        res.json({ error: 'Instagram monitor not initialized' });
    }
});

// 啟動 Express 伺服器
app.listen(PORT, () => {
    console.log(`🌐 HTTP 伺服器運行在 port ${PORT}`);
});

// === Discord 客戶端錯誤處理（保持原邏輯） ===
client.on('error', (error) => {
    console.error('❌ Discord 客戶端錯誤:', error.message);
});

client.on('warn', (warning) => {
    console.warn('⚠️ Discord 警告:', warning);
});

client.on('disconnect', () => {
    console.log('🔌 Discord 連線中斷，嘗試重新連線...');
});

client.on('reconnecting', () => {
    console.log('🔄 正在重新連線到 Discord...');
});

// 程序錯誤處理（保持原邏輯）
process.on('unhandledRejection', (error) => {
    console.error('❌ 未處理的 Promise 錯誤:', error);
});

process.on('uncaughtException', (error) => {
    console.error('❌ 未捕獲的例外錯誤:', error);
    process.exit(1);
});

// 優雅關閉處理（更新版）
process.on('SIGINT', () => {
    console.log('🛑 收到終止信號，正在安全關閉...');
    
    // 停止Instagram監控
    if (instagramMonitor) {
        instagramMonitor.stopMonitoring();
    }
    
    client.destroy();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('🛑 收到終止信號，正在安全關閉...');
    
    // 停止Instagram監控
    if (instagramMonitor) {
        instagramMonitor.stopMonitoring();
    }
    
    client.destroy();
    process.exit(0);
});

// 啟動 Discord Bot
console.log('🔐 正在登入 Discord...');
client.login(config.DISCORD_TOKEN).catch(error => {
    console.error('❌ Discord Bot 登入失敗:', error.message);
    console.error('🔑 請檢查 DISCORD_TOKEN 是否正確');
    process.exit(1);
});