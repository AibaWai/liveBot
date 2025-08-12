const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const https = require('https');
const axios = require('axios');

// Express 設定
const app = express();
const PORT = process.env.PORT || 3000;

// 在現有的環境變數檢查後添加
const BLOG_NOTIFICATION_CHANNEL_ID = process.env.BLOG_NOTIFICATION_CHANNEL_ID;
if (BLOG_NOTIFICATION_CHANNEL_ID) {
    console.log('📝 博客監控已啟用');
} else {
    console.log('📝 博客監控未配置 (BLOG_NOTIFICATION_CHANNEL_ID 未設定)');
}

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
    PUSHCALL_TO: process.env.PUSHCALL_TO,
    
    // 博客監控配置 (新增)
    BLOG_NOTIFICATION_CHANNEL_ID: process.env.BLOG_NOTIFICATION_CHANNEL_ID
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
        isLiveNow: false,  // 這裡會被正確更新
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

// === 簡化Instagram監控系統 === （修復版）
let instagramMonitor = null;


async function startInstagramMonitoring() {
    try {
        if (instagramMonitor && instagramMonitor.isMonitoring) {
            console.log('⚠️ [Instagram] 監控已在運行中');
            return;
        }
        
        const SaferInstagramMonitor = require('./safer_instagram_monitor');
        
        // 創建監控實例時傳入Discord通知回調函數
        instagramMonitor = new SaferInstagramMonitor(sendNotification);
        
        console.log('🚀 [Instagram] 啟動安全監控系統');
        
        await instagramMonitor.startMonitoring(config.TARGET_USERNAME, async () => {
            // 檢測到直播時的處理
            if (!unifiedState.instagram.isLiveNow) {
                unifiedState.instagram.isLiveNow = true;  // 正確更新狀態
                console.log('🔴 [Instagram] 檢測到直播開始!');
                
                await sendNotification(`🔴 **@${config.TARGET_USERNAME} Instagram直播開始!** 🎥

📺 觀看: https://www.instagram.com/${config.TARGET_USERNAME}/
⏰ 檢測時間: ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' })}
🛡️ 安全監控系統 + 智能間隔調整
🕐 日本時間調整: 深夜降頻，活躍時段密集監控

🚀 快去看直播吧！`, 'live_alert', 'Instagram');
            }
        });
        
        // 更新狀態
        unifiedState.instagram.isMonitoring = true;
        
        // 移除舊的 startLiveStatusCheck()，因為 SaferInstagramMonitor 已經內建狀態檢查
        
    } catch (error) {
        console.error('❌ [Instagram] 安全監控啟動失敗:', error.message);
    }
}

// 停止Instagram監控
// 停止Instagram監控
function stopInstagramMonitoring() {
    if (instagramMonitor) {
        instagramMonitor.stopMonitoring();
        unifiedState.instagram.isMonitoring = false;
        unifiedState.instagram.isLiveNow = false;  // 重置直播狀態
        console.log('⏹️ [Instagram] 監控已停止');
    }
}

// 修改獲取Instagram監控狀態函數
function getInstagramStatus() {
    if (instagramMonitor && typeof instagramMonitor.getStatus === 'function') {
        try {
            const igStatus = instagramMonitor.getStatus();
            // 確保直播狀態正確同步
            igStatus.isLiveNow = unifiedState.instagram.isLiveNow;
            return igStatus;
        } catch (error) {
            console.error('❌ [狀態] 獲取Instagram狀態失敗:', error.message);
        }
    }
    
    // 返回默認狀態
    return {
        isMonitoring: unifiedState.instagram.isMonitoring,
        totalAccounts: 0,
        availableAccounts: 0,
        disabledAccounts: 0,
        dailyRequests: 0,
        maxDailyRequests: 0,
        accountStatus: 'initializing',
        successRate: 0,
        totalRequests: 0,
        successfulRequests: 0,
        consecutiveErrors: 0,
        isLiveNow: unifiedState.instagram.isLiveNow,  // 使用統一狀態
        lastCheck: null,
        targetUserId: null,
        japanTime: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' }),
        accountDetails: []
    };
}

// 在 Instagram 監控後添加
let blogMonitor = null;

async function startBlogMonitoring() {
    if (!BLOG_NOTIFICATION_CHANNEL_ID) {
        console.log('⚠️ [Blog] 未配置通知頻道，跳過博客監控');
        return;
    }

    try {
        const BlogMonitor = require('./blog_monitor');
        
        blogMonitor = new BlogMonitor(async (message, type, source) => {
            try {
                const channel = await client.channels.fetch(BLOG_NOTIFICATION_CHANNEL_ID);
                await channel.send(message);
                console.log(`📤 [${source}] 博客通知已發送: ${type}`);
            } catch (error) {
                console.error('❌ 博客通知發送失敗:', error.message);
            }
        });
        
        blogMonitor.startMonitoring();
        console.log('🚀 [Blog] 博客監控已啟動');
        
    } catch (error) {
        console.error('❌ [Blog] 博客監控啟動失敗:', error.message);
    }
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

// 修改 Discord ready 事件處理
client.once('ready', () => {
    unifiedState.botReady = true;
    startBlogMonitoring();
    console.log(`✅ Discord Bot 已上線: ${client.user.tag}`);
    console.log(`📺 Instagram監控目標: @${config.TARGET_USERNAME}`);
    console.log(`📋 Discord頻道監控: ${Object.keys(config.CHANNEL_CONFIGS).length} 個頻道`);
    console.log(`🕐 當前日本時間: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
    
    // 發送啟動通知
    sendNotification(`🚀 **統一直播監控機器人已啟動** (日本時間)

**Instagram監控:** @${config.TARGET_USERNAME}
**Discord頻道監控:** ${Object.keys(config.CHANNEL_CONFIGS).length} 個頻道
**電話通知:** ${config.PUSHCALL_API_KEY ? '✅ 已配置' : '❌ 未配置'}
**時區:** 🕐 日本時間 (JST)

**智能間隔調整:**
🌙 深夜 (02-06): 10-15分鐘間隔
🌅 早晨 (07-08): 3-5分鐘間隔
☀️ 活躍 (09-24): 90-180秒間隔
🌃 深夜前期 (00-02): 3-5分鐘間隔

📋 **可用命令:**
\`!ig-start\` - 開始Instagram監控
\`!ig-stop\` - 停止Instagram監控
\`!ig-status\` - Instagram監控狀態
\`!ig-check\` - 手動檢查Instagram
\`!ig-accounts\` - 檢查帳號狀態
\`!status\` - 完整系統狀態
\`!help\` - 顯示幫助

🔄 準備開始監控...`, 'info', 'System');
    
    // 自動開始Instagram監控
    startInstagramMonitoring().then(() => {
        // Instagram監控啟動後，等待更長時間確保所有組件都已初始化
        setTimeout(() => {
            console.log('🔄 [Web面板] 開始初始化狀態面板...');
            initializeWebStatusPanel();
        }, 5000); // 增加到5秒
    }).catch(error => {
        console.error('❌ [Instagram] 監控啟動失敗:', error.message);
        // 即使Instagram監控失敗，也要初始化Web面板
        setTimeout(initializeWebStatusPanel, 3000);
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
        
        const statusMsg = `📊 **Instagram監控狀態** (日本時間)

**目標:** @${config.TARGET_USERNAME}
**當前狀態:** ${unifiedState.instagram.isLiveNow ? '🔴 直播中' : '⚫ 離線'}
**監控:** ${igStatus.isMonitoring ? '✅ 運行中' : '❌ 已停止'}

**3帳號輪換系統:**
⏱️ 運行時間: ${runtime} 分鐘
🔐 總帳號數: ${igStatus.totalAccounts}
✅ 可用帳號: ${igStatus.availableAccounts}
🚫 已停用帳號: ${igStatus.disabledAccounts || 0}
📊 今日請求: ${igStatus.dailyRequests}/${igStatus.maxDailyRequests}

**時間段智能監控 (日本時間):**
🕐 當前時間: ${igStatus.japanTime}
🌙 深夜 (02-06): 10-15分鐘間隔
🌅 早晨 (07-08): 3-5分鐘間隔  
☀️ 活躍 (09-24): 90-180秒間隔
🌃 深夜前期 (00-02): 3-5分鐘間隔`;

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

🕐 檢查時間: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
🔐 可用帳號: ${igStatus.availableAccounts}/${igStatus.totalAccounts}
🚫 已停用帳號: ${igStatus.disabledAccounts || 0}
📊 今日請求: ${igStatus.dailyRequests}/${igStatus.maxDailyRequests}`);
            } catch (error) {
                await message.reply(`❌ 檢查失敗: ${error.message}`);
            }
        } else {
            await message.reply('❌ 監控系統未初始化');
        }
    }
    
    // 簡化的帳號狀態檢查命令
    else if (cmd === '!ig-accounts' || cmd === '!accounts') {
        if (instagramMonitor) {
            try {
                const igStatus = getInstagramStatus();
                
                let statusMsg = `🔐 **Instagram帳號狀態** (日本時間)

📊 **總覽:**
• 總帳號數: ${igStatus.totalAccounts}
• 可用帳號: ${igStatus.availableAccounts} ✅
• 已停用帳號: ${igStatus.disabledAccounts || 0} 🚫
• 檢查時間: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}

📋 **帳號詳情:**\n`;

                igStatus.accountDetails.forEach(account => {
                    const statusIcon = account.isDisabled ? '🚫' : '✅';
                    const cooldownInfo = account.inCooldown ? ' (冷卻中)' : '';
                    const successRate = account.successCount + account.errorCount > 0 ? 
                        Math.round(account.successCount / (account.successCount + account.errorCount) * 100) : 0;
                    
                    statusMsg += `${statusIcon} **${account.id}**: ${account.isDisabled ? '已停用' : '可用'}${cooldownInfo}\n`;
                    statusMsg += `   └ 成功率: ${successRate}%, 今日請求: ${account.dailyRequests}\n`;
                    statusMsg += `   └ 最後使用: ${account.lastUsed}\n`;
                });

                if ((igStatus.disabledAccounts || 0) > 0) {
                    statusMsg += `\n⚠️ **注意:** 有 ${igStatus.disabledAccounts} 個帳號已被停用，需要更新cookies！`;
                }

                await message.reply(statusMsg);
            } catch (error) {
                await message.reply(`❌ 獲取帳號狀態失敗: ${error.message}`);
            }
        } else {
            await message.reply('❌ 帳號狀態檢查功能不可用');
        }
    }
    
    else if (cmd === '!status') {
        const runtime = Math.round((Date.now() - unifiedState.startTime) / 60000);
        const igStatus = getInstagramStatus();
        
        const statusMsg = `📊 **統一監控系統狀態** (日本時間)

**系統運行時間:** ${runtime} 分鐘
**Bot狀態:** ${unifiedState.botReady ? '✅ 在線' : '❌ 離線'}
**當前日本時間:** ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}

**Instagram監控:**
• 目標: @${config.TARGET_USERNAME}
• 狀態: ${unifiedState.instagram.isLiveNow ? '🔴 直播中' : '⚫ 離線'}
• 監控: ${unifiedState.instagram.isMonitoring ? '✅ 運行中' : '❌ 停止'}
• 可用帳號: ${igStatus.availableAccounts}/${igStatus.totalAccounts}
• 已停用帳號: ${igStatus.disabledAccounts || 0}
• 成功率: ${igStatus.successRate}%

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
        await message.reply(`🔍 **統一直播監控機器人** (日本時間版)

**Instagram監控命令:**
\`!ig-start\` - 開始Instagram監控
\`!ig-stop\` - 停止Instagram監控
\`!ig-status\` - Instagram監控狀態
\`!ig-check\` - 手動檢查Instagram
\`!ig-accounts\` - 檢查帳號狀態

**博客監控命令:**
\`!blog-status\` - 博客監控狀態
\`!blog-check\` - 手動檢查博客
\`!blog-test\` - 測試網站連接
\`!blog-analyze\` - 分析網站內容
\`!blog-latest\` - 檢查最新文章
\`!blog-debug\` - 調試分析
\`!blog-raw\` - 查看原始HTML
\`!blog-dynamic\` - 測試動態載入

**系統命令:**
\`!status\` - 完整系統狀態
\`!help\` - 顯示此幫助`);
}

    // 在 handleDiscordCommands 函數中添加/修改博客監控命令
    else if (cmd === '!blog-status' || cmd === '!twitter-status') {
        if (blogMonitor) {
            const blogStatus = blogMonitor.getStatus();
            const statusMsg = `🐦 **Twitter監控狀態**

**監控狀態:** ${blogStatus.isMonitoring ? '✅ 運行中' : '❌ 已停止'}
**目標帳號:** @${blogStatus.targetAccount}
**監控關鍵字:** ${blogStatus.keywords.join(', ')}
**Twitter網址:** ${blogStatus.twitterUrl}
**總檢查次數:** ${blogStatus.totalChecks}
**發現推文數:** ${blogStatus.articlesFound}
**最後檢查:** ${blogStatus.lastCheckTime || '尚未檢查'}
**最新推文:** ${blogStatus.lastArticleDate || '無'}
**下次檢查:** ${blogStatus.nextCheckTime || '未安排'}

⏰ 每小時00分自動檢查`;

            await message.reply(statusMsg);
        } else {
            await message.reply('❌ Twitter監控未啟用');
        }
    }

    else if (cmd === '!blog-check' || cmd === '!twitter-check') {
        if (blogMonitor) {
            await message.reply('🔍 執行手動Twitter檢查...');
            try {
                const newTweet = await blogMonitor.checkForNewArticles(true); // 測試模式
                if (newTweet) {
                    await message.reply(`🐦 **發現相關推文!**

🗓️ **時間:** ${newTweet.fullDateTime}
🔍 **關鍵字:** ${newTweet.keyword}
📝 **內容:** ${newTweet.content.substring(0, 300)}${newTweet.content.length > 300 ? '...' : ''}
🔗 **查看:** https://x.com/${blogMonitor.targetAccount}`);
                } else {
                    await message.reply('📋 目前無包含關鍵字的新推文');
                }
            } catch (error) {
                await message.reply(`❌ 檢查失敗: ${error.message}`);
            }
        } else {
            await message.reply('❌ Twitter監控未啟用');
        }
    }

    else if (cmd === '!blog-test' || cmd === '!twitter-test') {
        if (blogMonitor) {
            await message.reply('🔍 執行Twitter連接測試...');
            try {
                const testResult = await blogMonitor.testWebsiteAccess();
                if (testResult.success) {
                    const testMsg = `✅ **Twitter連接測試成功**

📊 **連接狀態:** HTTP ${testResult.statusCode}
📄 **內容長度:** ${testResult.contentLength} 字元
🏗️ **推文結構:** ${testResult.hasValidContent ? '✅ 正常' : '❌ 異常'}
🔍 **包含關鍵字:** ${testResult.hasKeywords ? '✅ 是' : '❌ 否'}
📝 **監控關鍵字:** ${testResult.keywords.join(', ')}

✅ Twitter頁面可正常訪問並解析！`;
                    
                    await message.reply(testMsg);
                } else {
                    await message.reply(`❌ **Twitter連接測試失敗**\n\n錯誤: ${testResult.error}`);
                }
            } catch (error) {
                await message.reply(`❌ 測試執行失敗: ${error.message}`);
            }
        } else {
            await message.reply('❌ Twitter監控未啟用');
        }
    }

    else if (cmd === '!blog-analyze' || cmd === '!twitter-analyze') {
        if (blogMonitor) {
            await message.reply('🔍 分析Twitter當前內容...');
            try {
                const analysis = await blogMonitor.analyzeCurrentContent(true);
                if (analysis.success) {
                    const analysisMsg = `📊 **Twitter內容分析結果**

🔍 **監控關鍵字:** ${analysis.keywords.join(', ')}
📊 **總相關推文:** ${analysis.totalTweets}
📝 **最近推文:** ${analysis.recentTweets} 篇 (7天內)
🗓️ **最新推文:** ${analysis.latestTweet ? 
    `${analysis.latestTweet.fullDateTime} (關鍵字: ${analysis.latestTweet.keyword})` : 
    '無'}
⏰ **分析時間:** ${analysis.analysisTime}

${analysis.recentTweets > 0 ? 
`📋 **最近推文列表:**
${analysis.allRecentTweets.slice(0, 3).map((tweet, index) => {
    return `${index + 1}. ${tweet.fullDateTime} - ${tweet.keyword}\n   ${tweet.content.substring(0, 100)}...`;
}).join('\n')}` : 
'📭 最近7天內無包含關鍵字的推文'}

✅ 分析完成，監控系統能正確解析推文！`;
                    
                    await message.reply(analysisMsg);
                } else {
                    await message.reply(`❌ **內容分析失敗**\n\n錯誤: ${analysis.error}`);
                }
            } catch (error) {
                await message.reply(`❌ 分析執行失敗: ${error.message}`);
            }
        } else {
            await message.reply('❌ Twitter監控未啟用');
        }
    }

    else if (cmd === '!blog-keywords' || cmd === '!twitter-keywords') {
        if (blogMonitor) {
            try {
                const keywords = blogMonitor.reloadKeywords();
                await message.reply(`🔍 **Twitter監控關鍵字**

**當前關鍵字:** ${keywords.join(', ')}
**關鍵字數量:** ${keywords.length}

💡 **設定方式:**
• 環境變數 \`BLOG_KEYWORDS\` 或 \`TWITTER_KEYWORDS\` (逗號分隔)
• 或使用 \`BLOG_KEYWORD_1\`, \`BLOG_KEYWORD_2\` 等

🔄 關鍵字已重新載入！`);
            } catch (error) {
                await message.reply(`❌ 關鍵字載入失敗: ${error.message}`);
            }
        } else {
            await message.reply('❌ Twitter監控未啟用');
        }
    }

    else if (cmd === '!blog-latest' || cmd === '!twitter-latest') {
        if (blogMonitor) {
            await message.reply('🔍 檢查最新推文...');
            try {
                const latestTweet = await blogMonitor.checkForNewArticles(true); // 測試模式
                if (latestTweet) {
                    await message.reply(`🐦 **找到最新相關推文!**

🗓️ **發布時間:** ${latestTweet.fullDateTime}
🔍 **匹配關鍵字:** ${latestTweet.keyword}
📝 **推文內容:**
${latestTweet.content}

🔗 **查看完整推文:** https://x.com/${blogMonitor.targetAccount}
⏰ **檢查時間:** ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}

✅ Twitter監控系統運作正常！`);
                } else {
                    await message.reply(`📋 **未找到最近包含關鍵字的推文**

🔍 **監控關鍵字:** ${blogMonitor.keywords.join(', ')}
🐦 **目標帳號:** @${blogMonitor.targetAccount}

可能原因：
• 最近確實沒有包含關鍵字的推文
• Nitter服務臨時不可用
• 網絡連接問題`);
                }
            } catch (error) {
                await message.reply(`❌ 檢查失敗: ${error.message}`);
            }
        } else {
            await message.reply('❌ Twitter監控未啟用');
        }
    }

    else if (cmd === '!help') {
        await message.reply(`🔍 **統一直播監控機器人** (日本時間版)

**Instagram監控命令:**
\`!ig-start\` - 開始Instagram監控
\`!ig-stop\` - 停止Instagram監控
\`!ig-status\` - Instagram監控狀態
\`!ig-check\` - 手動檢查Instagram
\`!ig-accounts\` - 檢查帳號狀態

**Twitter監控命令:**
\`!twitter-status\` / \`!blog-status\` - Twitter監控狀態
\`!twitter-check\` / \`!blog-check\` - 手動檢查推文
\`!twitter-test\` / \`!blog-test\` - 測試Twitter連接
\`!twitter-analyze\` / \`!blog-analyze\` - 分析推文內容
\`!twitter-latest\` / \`!blog-latest\` - 檢查最新推文
\`!twitter-keywords\` / \`!blog-keywords\` - 查看/重載關鍵字

**系統命令:**
\`!status\` - 完整系統狀態
\`!help\` - 顯示此幫助

**Twitter監控說明:**
🐦 監控目標: @FCweb_info
🔍 關鍵字: 透過環境變數設定
⏰ 檢查頻率: 每小時00分自動檢查`);
    }

}

// 頻道專用API呼叫
async function callChannelSpecificAPI(channelId, channelConfig, keyword, originalMessage) {
    if (!channelConfig.api_key || !channelConfig.phone_number) return;
    
    const apiKeyShort = channelConfig.api_key.substring(0, 8);
    
    try {
        const apiUrl = new URL('https://pushcall.me/api/call');
        apiUrl.searchParams.append('api_key', channelConfig.api_key);
        apiUrl.searchParams.append('from', channelConfig.caller_id || '1');
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
    // 確保 instagramMonitor 已經初始化且具有 getStatus 方法
    if (!webStatusPanel && instagramMonitor && typeof instagramMonitor.getStatus === 'function') {
        try {
            const WebStatusPanel = require('./web_status_panel');
            webStatusPanel = new WebStatusPanel(
                app, 
                unifiedState, 
                config, 
                client, 
                () => instagramMonitor,  // Instagram監控函數
                () => blogMonitor       // 博客監控函數 (新增)
            );
            console.log('🌐 [Web面板] 狀態面板已初始化');
        } catch (error) {
            console.error('❌ [Web面板] 初始化失敗:', error.message);
            // 延遲重試
            setTimeout(() => {
                console.log('🔄 [Web面板] 嘗試重新初始化...');
                initializeWebStatusPanel();
            }, 5000);
        }
    } else if (!instagramMonitor) {
        console.log('⏳ [Web面板] 等待Instagram監控初始化...');
        // 延遲重試
        setTimeout(initializeWebStatusPanel, 3000);
    } else if (typeof instagramMonitor.getStatus !== 'function') {
        console.log('⏳ [Web面板] Instagram監控尚未完全初始化...');
        // 延遲重試
        setTimeout(initializeWebStatusPanel, 2000);
    }
}

// 啟動Express服務器
app.listen(PORT, () => {
    console.log(`🌐 HTTP伺服器運行在 port ${PORT}`);
    console.log(`🕐 服務器啟動時間 (日本時間): ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
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