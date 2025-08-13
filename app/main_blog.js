const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const https = require('https');
const axios = require('axios');

// Express 設定
const app = express();
const PORT = process.env.PORT || 3000;

// 在現有的環境變數檢查後添加
const BLOG_NOTIFICATION_CHANNEL_ID = process.env.BLOG_NOTIFICATION_CHANNEL_ID;
const USE_ENHANCED_BLOG_MONITOR = process.env.USE_ENHANCED_BLOG_MONITOR === 'true'; // 新增環境變數

if (BLOG_NOTIFICATION_CHANNEL_ID) {
    console.log(`📝 博客監控已啟用 (${USE_ENHANCED_BLOG_MONITOR ? '動態模式' : '靜態模式'})`);
} else {
    console.log('📝 博客監控未配置 (BLOG_NOTIFICATION_CHANNEL_ID 未設定)');
}

console.log('🚀 統一直播監控機器人啟動中...');
console.log('📺 Instagram 監控 + Discord 頻道監控 + 電話通知 + 博客監控');

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
    PUSHCALL_TO: process.env.PUSHCALL_TO,
    
    // 博客監控配置
    BLOG_NOTIFICATION_CHANNEL_ID: process.env.BLOG_NOTIFICATION_CHANNEL_ID,
    USE_ENHANCED_BLOG_MONITOR: USE_ENHANCED_BLOG_MONITOR
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

// === Instagram監控系統 ===
let instagramMonitor = null;

async function startInstagramMonitoring() {
    try {
        if (instagramMonitor && instagramMonitor.isMonitoring) {
            console.log('⚠️ [Instagram] 監控已在運行中');
            return;
        }
        
        const SaferInstagramMonitor = require('./safer_instagram_monitor');
        
        instagramMonitor = new SaferInstagramMonitor(sendNotification);
        
        console.log('🚀 [Instagram] 啟動安全監控系統');
        
        await instagramMonitor.startMonitoring(config.TARGET_USERNAME, async () => {
            if (!unifiedState.instagram.isLiveNow) {
                unifiedState.instagram.isLiveNow = true;
                console.log('🔴 [Instagram] 檢測到直播開始!');
                
                await sendNotification(`🔴 **@${config.TARGET_USERNAME} Instagram直播開始!** 🎥

📺 觀看: https://www.instagram.com/${config.TARGET_USERNAME}/
⏰ 檢測時間: ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' })}
🛡️ 安全監控系統 + 智能間隔調整
🕐 日本時間調整: 深夜降頻，活躍時段密集監控

🚀 快去看直播吧！`, 'live_alert', 'Instagram');
            }
        });
        
        unifiedState.instagram.isMonitoring = true;
        
    } catch (error) {
        console.error('❌ [Instagram] 安全監控啟動失敗:', error.message);
    }
}

function stopInstagramMonitoring() {
    if (instagramMonitor) {
        instagramMonitor.stopMonitoring();
        unifiedState.instagram.isMonitoring = false;
        unifiedState.instagram.isLiveNow = false;
        console.log('⏹️ [Instagram] 監控已停止');
    }
}

function getInstagramStatus() {
    if (instagramMonitor && typeof instagramMonitor.getStatus === 'function') {
        try {
            const igStatus = instagramMonitor.getStatus();
            igStatus.isLiveNow = unifiedState.instagram.isLiveNow;
            return igStatus;
        } catch (error) {
            console.error('❌ [狀態] 獲取Instagram狀態失敗:', error.message);
        }
    }
    
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
        isLiveNow: unifiedState.instagram.isLiveNow,
        lastCheck: null,
        targetUserId: null,
        japanTime: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' }),
        accountDetails: []
    };
}

// === 博客監控系統（升級版）===
let blogMonitor = null;

async function startBlogMonitoring() {
    if (!BLOG_NOTIFICATION_CHANNEL_ID) {
        console.log('⚠️ [Blog] 未配置通知頻道，跳過博客監控');
        return;
    }

    try {
        // 根據環境變數選擇監控器類型
        if (USE_ENHANCED_BLOG_MONITOR) {
            console.log('🚀 [Blog] 啟動增強版博客監控器（支援動態內容）');
            
            // 檢查 Puppeteer 依賴
            try {
                require('puppeteer');
                console.log('✅ [Blog] Puppeteer 已安裝');
            } catch (error) {
                console.error('❌ [Blog] Puppeteer 未安裝，請執行: npm install puppeteer');
                console.log('⚠️ [Blog] 回退到基本監控器');
                config.USE_ENHANCED_BLOG_MONITOR = false;
            }
        }
        
        let BlogMonitorClass;
        if (config.USE_ENHANCED_BLOG_MONITOR) {
            BlogMonitorClass = require('./enhanced_blog_monitor');
            console.log('🔧 [Blog] 使用增強版監控器（JavaScript 動態內容支援）');
        } else {
            BlogMonitorClass = require('./blog_monitor');
            console.log('🔧 [Blog] 使用基本監控器（靜態 HTML 解析）');
        }
        
        blogMonitor = new BlogMonitorClass(async (message, type, source) => {
            try {
                const channel = await client.channels.fetch(BLOG_NOTIFICATION_CHANNEL_ID);
                await channel.send(message);
                console.log(`📤 [${source}] 博客通知已發送: ${type}`);
            } catch (error) {
                console.error('❌ 博客通知發送失敗:', error.message);
            }
        });
        
        blogMonitor.startMonitoring();
        console.log(`🚀 [Blog] Family Club 博客監控已啟動 (${config.USE_ENHANCED_BLOG_MONITOR ? '動態模式' : '靜態模式'})`);
        console.log('🔗 [Blog] 監控網址: https://web.familyclub.jp/s/jwb/diary/F2017?ima=3047');
        
    } catch (error) {
        console.error('❌ [Blog] 博客監控啟動失敗:', error.message);
        
        // 如果增強版失敗，嘗試回退到基本版
        if (config.USE_ENHANCED_BLOG_MONITOR) {
            console.log('🔄 [Blog] 嘗試回退到基本監控器...');
            try {
                const BasicBlogMonitor = require('./blog_monitor');
                blogMonitor = new BasicBlogMonitor(async (message, type, source) => {
                    try {
                        const channel = await client.channels.fetch(BLOG_NOTIFICATION_CHANNEL_ID);
                        await channel.send(message);
                        console.log(`📤 [${source}] 博客通知已發送: ${type}`);
                    } catch (error) {
                        console.error('❌ 博客通知發送失敗:', error.message);
                    }
                });
                
                blogMonitor.startMonitoring();
                console.log('✅ [Blog] 回退到基本博客監控器成功');
                config.USE_ENHANCED_BLOG_MONITOR = false;
            } catch (fallbackError) {
                console.error('❌ [Blog] 基本監控器也啟動失敗:', fallbackError.message);
            }
        }
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

// Discord ready 事件處理
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
**博客監控:** ${config.BLOG_NOTIFICATION_CHANNEL_ID ? `✅ Family Club F2017 (${config.USE_ENHANCED_BLOG_MONITOR ? '動態模式' : '靜態模式'})` : '❌ 未配置'}
**電話通知:** ${config.PUSHCALL_API_KEY ? '✅ 已配置' : '❌ 未配置'}
**時區:** 🕐 日本時間 (JST)

**智能間隔調整:**
🌙 深夜 (02-06): 10-15分鐘間隔
🌅 早晨 (07-08): 3-5分鐘間隔
☀️ 活躍 (09-24): 90-180秒間隔
🌃 深夜前期 (00-02): 3-5分鐘間隔

**博客監控功能:**
${config.USE_ENHANCED_BLOG_MONITOR ? '🚀 JavaScript 動態內容解析' : '📄 靜態 HTML 解析'}
📊 智能文章ID和時間檢測
⏰ 每小時00分自動檢查
🎯 基準記錄自動建立和更新

📋 **可用命令:**
\`!ig-start\` - 開始Instagram監控
\`!ig-stop\` - 停止Instagram監控
\`!ig-status\` - Instagram監控狀態
\`!blog-status\` - 博客監控狀態
\`!blog-latest\` - 顯示最新文章記錄
\`!blog-switch\` - 切換監控器模式 🆕
\`!status\` - 完整系統狀態
\`!help\` - 顯示幫助

🔄 準備開始監控...`, 'info', 'System');
    
    startInstagramMonitoring().then(() => {
        setTimeout(() => {
            console.log('🔄 [Web面板] 開始初始化狀態面板...');
            initializeWebStatusPanel();
        }, 5000);
    }).catch(error => {
        console.error('❌ [Instagram] 監控啟動失敗:', error.message);
        setTimeout(initializeWebStatusPanel, 3000);
    });
});

// Discord消息監聽
client.on('messageCreate', async (message) => {
    try {
        unifiedState.discord.totalMessagesProcessed++;
        
        if (message.author.bot && message.author.id === client.user.id) return;
        
        if (message.content.startsWith('!')) {
            await handleDiscordCommands(message);
            return;
        }
        
        const channelId = message.channel.id;
        if (!config.CHANNEL_CONFIGS[channelId]) return;
        
        const channelConfig = config.CHANNEL_CONFIGS[channelId];
        const messageContent = message.content.toLowerCase();
        
        unifiedState.discord.channelStats[channelId].messagesProcessed++;
        
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
            
            const detection = {
                時間: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
                頻道: channelConfig.name || channelId,
                關鍵字: foundKeyword,
                訊息: message.content.substring(0, 150),
                作者: message.author.username
            };
            unifiedState.discord.lastDetections.push(detection);
            
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
        const blogStatus = blogMonitor ? blogMonitor.getStatus() : { isMonitoring: false };
        const latestRecord = blogMonitor ? blogMonitor.getLatestRecord() : null;
        
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

**博客監控:**
• 目標: Family Club F2017
• 模式: ${config.USE_ENHANCED_BLOG_MONITOR ? '🚀 動態模式' : '📄 靜態模式'}
• 狀態: ${blogStatus.isMonitoring ? '✅ 運行中' : '❌ 停止'}
• 檢查次數: ${blogStatus.totalChecks}
• 發現新文章: ${blogStatus.articlesFound}
• 最新記錄: ${latestRecord ? `${latestRecord.datetime} (ID: ${latestRecord.articleId})` : '未建立'}

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
    
    // 博客監控命令
    else if (cmd === '!blog-status') {
        if (blogMonitor) {
            const blogStatus = blogMonitor.getStatus();
            const latestRecord = blogMonitor.getLatestRecord();
            
            const statusMsg = `📝 **Family Club 博客監控狀態**

**監控模式:** ${config.USE_ENHANCED_BLOG_MONITOR ? '🚀 動態模式 (JavaScript 支援)' : '📄 靜態模式 (基本 HTML)'}
**監控狀態:** ${blogStatus.isMonitoring ? '✅ 運行中' : '❌ 已停止'}
**目標網址:** ${blogStatus.blogUrl}
**總檢查次數:** ${blogStatus.totalChecks}
**發現新文章:** ${blogStatus.articlesFound} 篇
**最後檢查:** ${blogStatus.lastCheckTime || '尚未檢查'}
**下次檢查:** ${blogStatus.nextCheckTime || '未安排'}
${config.USE_ENHANCED_BLOG_MONITOR ? `**瀏覽器狀態:** ${blogStatus.browserStatus || '未知'}` : ''}

**當前記錄的最新文章:**
${latestRecord ? `📄 文章ID: ${latestRecord.articleId || '未知'}
🗓️ 發布時間: ${latestRecord.datetime}
📝 標題: ${latestRecord.title}
${latestRecord.url ? `🔗 連結: ${latestRecord.url}` : ''}
⏰ 記錄更新: ${latestRecord.lastUpdated}` : '❌ 尚未建立記錄'}

⏰ 每小時00分自動檢查`;

            await message.reply(statusMsg);
        } else {
            await message.reply('❌ 博客監控未啟用');
        }
    }

    else if (cmd === '!blog-latest') {
        if (blogMonitor) {
            const latestRecord = blogMonitor.getLatestRecord();
            
            if (latestRecord) {
                await message.reply(`📄 **當前記錄中的最新文章**

📄 **文章ID:** ${latestRecord.articleId || '未知'}
🗓️ **發布時間:** ${latestRecord.datetime}
📝 **文章標題:** ${latestRecord.title}
${latestRecord.url ? `🔗 **文章連結:** ${latestRecord.url}` : ''}
⏰ **記錄時間:** ${latestRecord.lastUpdated}
🔧 **檢測模式:** ${config.USE_ENHANCED_BLOG_MONITOR ? '動態 (JavaScript)' : '靜態 (HTML)'}

💡 這是系統當前記錄的最新文章信息，用於比較檢測新文章`);
            } else {
                await message.reply(`📋 **尚未建立文章記錄**

原因可能是：
• 系統剛啟動，尚未完成初始化
• 網站連接失敗
• 網頁解析出現問題

🔧 建議操作：
• 使用 \`!blog-test\` 測試網站連接
• 使用 \`!blog-init\` 手動初始化
• 使用 \`!blog-switch\` 切換監控模式
• 檢查網絡連接狀態`);
            }
        } else {
            await message.reply('❌ 博客監控未啟用');
        }
    }

    else if (cmd === '!blog-check') {
        if (blogMonitor) {
            await message.reply(`🔍 執行手動博客檢查（${config.USE_ENHANCED_BLOG_MONITOR ? '動態模式' : '靜態模式'}）...`);
            try {
                const newArticle = await blogMonitor.checkForNewArticles(true);
                
                if (newArticle) {
                    await message.reply(`📝 **找到文章信息**

📄 **文章ID:** ${newArticle.id || '未知'}
🗓️ **發布時間:** ${newArticle.datetimeString}
📝 **文章標題:** ${newArticle.title}
${newArticle.url ? `🔗 **文章連結:** ${newArticle.url}` : ''}
⏰ **檢查時間:** ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
🔧 **檢測模式:** ${config.USE_ENHANCED_BLOG_MONITOR ? '動態 (JavaScript)' : '靜態 (HTML)'}

💡 這是網站上當前最新的文章`);
                } else {
                    await message.reply('📋 目前無法找到文章或解析失敗');
                }
            } catch (error) {
                await message.reply(`❌ 檢查失敗: ${error.message}`);
            }
        } else {
            await message.reply('❌ 博客監控未啟用');
        }
    }

    else if (cmd === '!blog-test') {
        if (blogMonitor) {
            await message.reply(`🔍 執行博客網站連接測試（${config.USE_ENHANCED_BLOG_MONITOR ? '動態模式' : '靜態模式'}）...`);
            try {
                const testResult = await blogMonitor.testWebsiteAccess();
                
                if (testResult.success) {
                    const testMsg = `✅ **博客網站連接測試成功**

🔧 **檢測方式:** ${testResult.method || (config.USE_ENHANCED_BLOG_MONITOR ? 'dynamic (Puppeteer)' : 'static (HTTPS)')}
📊 **連接狀態:** HTTP ${testResult.statusCode || 200}
📄 **內容長度:** ${testResult.contentLength.toLocaleString()} 字元
🏗️ **包含time標籤:** ${testResult.hasTimeTag ? '✅ 是' : '❌ 否'}
📰 **找到文章:** ${testResult.articlesFound} 篇
${config.USE_ENHANCED_BLOG_MONITOR ? `🌐 **動態內容支援:** ${testResult.dynamicContentSupported ? '✅ 是' : '❌ 否'}` : ''}

${testResult.sampleArticles && testResult.sampleArticles.length > 0 ? `📋 **範例文章:**
${testResult.sampleArticles.map((article, index) => 
    `${index + 1}. ID: ${article.id || 'N/A'} | 時間: ${article.time} | 標題: ${article.title}`
).join('\n')}` : ''}

✅ 網站可正常訪問並解析文章！`;
                    
                    await message.reply(testMsg);
                } else {
                    await message.reply(`❌ **博客網站連接測試失敗**

🔧 **檢測方式:** ${testResult.method || (config.USE_ENHANCED_BLOG_MONITOR ? 'dynamic (Puppeteer)' : 'static (HTTPS)')}
錯誤: ${testResult.error}

🔧 **故障排除建議:**
• 檢查網絡連接
• 確認網站是否正常運行
${config.USE_ENHANCED_BLOG_MONITOR ? '• 檢查 Puppeteer 是否正常運行\n• 嘗試使用 `!blog-switch` 切換到靜態模式' : '• 嘗試使用 `!blog-switch` 切換到動態模式'}
• 稍後再試`);
                }
            } catch (error) {
                await message.reply(`❌ 測試執行失敗: ${error.message}`);
            }
        } else {
            await message.reply('❌ 博客監控未啟用');
        }
    }

    else if (cmd === '!blog-init') {
        if (blogMonitor) {
            await message.reply(`🔄 執行手動初始化（${config.USE_ENHANCED_BLOG_MONITOR ? '動態模式' : '靜態模式'}）...`);
            try {
                const success = await blogMonitor.reinitialize();
                
                if (success) {
                    const latestRecord = blogMonitor.getLatestRecord();
                    await message.reply(`✅ **初始化成功！**

📄 **基準文章已記錄:**
• 文章ID: ${latestRecord.articleId || '未知'}
• 發布時間: ${latestRecord.datetime}
• 標題: ${latestRecord.title}
${latestRecord.url ? `• 連結: ${latestRecord.url}` : ''}
🔧 檢測模式: ${config.USE_ENHANCED_BLOG_MONITOR ? '動態 (JavaScript)' : '靜態 (HTML)'}

🎯 系統將以此為基準檢測新文章`);
                } else {
                    await message.reply(`❌ **初始化失敗**

可能原因：
• 網站連接問題
• 網頁結構解析失敗
• 未找到有效文章
${config.USE_ENHANCED_BLOG_MONITOR ? '• Puppeteer 瀏覽器啟動失敗' : ''}

🔧 建議：
• 先使用 \`!blog-test\` 檢查網站狀態
${config.USE_ENHANCED_BLOG_MONITOR ? '• 嘗試使用 `!blog-switch` 切換到靜態模式' : '• 嘗試使用 `!blog-switch` 切換到動態模式'}`);
                }
            } catch (error) {
                await message.reply(`❌ 初始化失敗: ${error.message}`);
            }
        } else {
            await message.reply('❌ 博客監控未啟用');
        }
    }

    // 新增：切換監控器模式命令
    else if (cmd === '!blog-switch') {
        if (!blogMonitor) {
            await message.reply('❌ 博客監控未啟用');
            return;
        }

        await message.reply(`🔄 **切換博客監控模式**

當前模式: ${config.USE_ENHANCED_BLOG_MONITOR ? '🚀 動態模式 (JavaScript)' : '📄 靜態模式 (HTML)'}
正在切換到: ${!config.USE_ENHANCED_BLOG_MONITOR ? '🚀 動態模式' : '📄 靜態模式'}...

⏳ 請稍候，正在重新啟動監控器...`);

        try {
            // 停止當前監控器
            if (blogMonitor) {
                blogMonitor.stopMonitoring();
                blogMonitor = null;
            }

            // 切換模式
            config.USE_ENHANCED_BLOG_MONITOR = !config.USE_ENHANCED_BLOG_MONITOR;

            // 重新啟動博客監控
            await startBlogMonitoring();

            await message.reply(`✅ **模式切換成功！**

新模式: ${config.USE_ENHANCED_BLOG_MONITOR ? '🚀 動態模式 (JavaScript 動態內容支援)' : '📄 靜態模式 (基本 HTML 解析)'}

${config.USE_ENHANCED_BLOG_MONITOR ? 
'🔧 動態模式特點:\n• 支援 JavaScript 動態加載的內容\n• 使用 Puppeteer 瀏覽器引擎\n• 更準確但消耗更多資源' : 
'🔧 靜態模式特點:\n• 僅解析初始 HTML 內容\n• 使用原生 HTTPS 請求\n• 速度快但可能錯過動態內容'}

💡 使用 \`!blog-test\` 測試新模式是否正常工作`);

        } catch (error) {
            await message.reply(`❌ **模式切換失敗**: ${error.message}

🔄 正在嘗試恢復原始模式...`);
            
            // 嘗試恢復原始模式
            config.USE_ENHANCED_BLOG_MONITOR = !config.USE_ENHANCED_BLOG_MONITOR;
            try {
                await startBlogMonitoring();
                await message.reply('✅ 已恢復到原始模式');
            } catch (recoveryError) {
                await message.reply(`❌ 恢復失敗: ${recoveryError.message}`);
            }
        }
    }

    else if (cmd === '!blog-debug') {
        if (blogMonitor) {
            await message.reply('🔍 執行博客調試分析...');
            try {
                let debugResult;
                
                if (config.USE_ENHANCED_BLOG_MONITOR) {
                    // 動態模式調試
                    await message.reply('🚀 動態模式調試：正在啟動瀏覽器分析...');
                    debugResult = await blogMonitor.fetchDynamicContent();
                    
                    const html = debugResult;
                    const hasTimeTag = html.includes('<time');
                    const timeTagCount = (html.match(/<time[^>]*>/g) || []).length;
                    const hasEntry = html.includes('entry');
                    const hasDiary = html.includes('diary');
                    const hasArticle = html.includes('<article');
                    
                    await message.reply(`🔍 **博客動態內容分析**

📊 **基本信息:**
• 模式: 🚀 動態模式 (Puppeteer)
• HTML長度: ${html.length.toLocaleString()} 字元
• 瀏覽器狀態: ${blogMonitor.browser ? '✅ 運行中' : '❌ 未啟動'}

🏗️ **結構元素:**
• Time標籤: ${hasTimeTag ? '✅' : '❌'} (${timeTagCount} 個)
• Entry元素: ${hasEntry ? '✅' : '❌'}
• Diary元素: ${hasDiary ? '✅' : '❌'}
• Article標籤: ${hasArticle ? '✅' : '❌'}

💡 動態模式可以獲取 JavaScript 加載後的完整內容`);
                } else {
                    // 靜態模式調試
                    const response = await blogMonitor.makeRequest(blogMonitor.blogUrl);
                    
                    if (response.statusCode === 200) {
                        const html = response.data;
                        
                        const hasTimeTag = html.includes('<time');
                        const timeTagCount = (html.match(/<time[^>]*>/g) || []).length;
                        const hasEntry = html.includes('entry');
                        const hasDiary = html.includes('diary');
                        const hasArticle = html.includes('<article');
                        
                        const containerPatterns = [
                            'entry',
                            'diary', 
                            'article',
                            'post',
                            'content'
                        ];
                        
                        let containerInfo = '';
                        containerPatterns.forEach(pattern => {
                            const count = (html.match(new RegExp(pattern, 'gi')) || []).length;
                            if (count > 0) {
                                containerInfo += `• ${pattern}: ${count} 個\n`;
                            }
                        });
                        
                        const timeTagSamples = html.match(/<time[^>]*>.*?<\/time>/gi)?.slice(0, 3) || [];
                        
                        await message.reply(`🔍 **博客HTML結構分析**

📊 **基本信息:**
• 模式: 📄 靜態模式 (HTTPS)
• HTML長度: ${html.length.toLocaleString()} 字元
• HTTP狀態: ${response.statusCode}

🏗️ **結構元素:**
• Time標籤: ${hasTimeTag ? '✅' : '❌'} (${timeTagCount} 個)
• Entry元素: ${hasEntry ? '✅' : '❌'}
• Diary元素: ${hasDiary ? '✅' : '❌'}
• Article標籤: ${hasArticle ? '✅' : '❌'}

📦 **容器統計:**
${containerInfo || '未找到常見容器'}

${timeTagSamples.length > 0 ? `⏰ **Time標籤範例:**
${timeTagSamples.map((tag, i) => `${i+1}. \`${tag}\``).join('\n')}` : '❌ 未找到time標籤'}

💡 靜態模式僅能分析初始 HTML，如需完整內容請使用 \`!blog-switch\` 切換到動態模式`);
                    } else {
                        await message.reply(`❌ 獲取網頁失敗: HTTP ${response.statusCode}`);
                    }
                }
            } catch (error) {
                await message.reply(`❌ 調試分析失敗: ${error.message}`);
            }
        } else {
            await message.reply('❌ 博客監控未啟用');
        }
    }

    else if (cmd === '!blog-diary') {
        if (blogMonitor && !config.USE_ENHANCED_BLOG_MONITOR) {
            await message.reply('🔍 分析 diary 容器內容...');
            try {
                const diaryResult = await blogMonitor.debugDiaryContainers();
                
                if (diaryResult.success && diaryResult.totalFound > 0) {
                    let diaryMsg = `📦 **找到 ${diaryResult.totalFound} 個 diary 容器**\n\n`;
                    
                    diaryResult.containers.slice(0, 3).forEach((container, index) => {
                        diaryMsg += `**容器 ${index + 1}:**\n`;
                        diaryMsg += `• 模式: ${container.patternIndex}\n`;
                        diaryMsg += `• Class: ${container.class}\n`;
                        diaryMsg += `• ID: ${container.id}\n`;
                        diaryMsg += `• 標籤: \`${container.containerTag}...\`\n`;
                        diaryMsg += `• 內容預覽:\n\`\`\`\n${container.contentPreview}...\n\`\`\`\n\n`;
                    });
                    
                    if (diaryResult.totalFound > 3) {
                        diaryMsg += `...(還有 ${diaryResult.totalFound - 3} 個容器)`;
                    }
                    
                    await message.reply(diaryMsg);
                } else {
                    await message.reply(`❌ **未找到 diary 容器**\n\n錯誤: ${diaryResult.error || '無內容'}`);
                }
            } catch (error) {
                await message.reply(`❌ diary 分析失敗: ${error.message}`);
            }
        } else if (config.USE_ENHANCED_BLOG_MONITOR) {
            await message.reply('⚠️ 此命令僅適用於靜態模式，請使用 `!blog-switch` 切換到靜態模式後再試');
        } else {
            await message.reply('❌ 博客監控未啟用');
        }
    }
    
    // 更新幫助命令
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
\`!blog-latest\` - 顯示當前記錄的最新文章
\`!blog-check\` - 手動檢查博客文章
\`!blog-test\` - 測試網站連接和解析
\`!blog-init\` - 手動初始化/重新建立基準記錄
\`!blog-switch\` - 切換動態/靜態監控模式 🆕
\`!blog-debug\` - 調試分析網頁結構
\`!blog-diary\` - 分析 diary 容器內容 (僅靜態模式)

**系統命令:**
\`!status\` - 完整系統狀態
\`!help\` - 顯示此幫助

**博客監控說明:**
🌐 監控目標: Family Club F2017 日記
🔧 監控模式: 
  • 📄 靜態模式: 快速 HTML 解析
  • 🚀 動態模式: JavaScript 動態內容支援
📊 檢測方式: 文章ID和發布時間比較
⏰ 檢查頻率: 每小時00分自動檢查
🎯 智能記錄: 自動記錄最新文章作為比較基準`);
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

let webStatusPanel = null;

function initializeWebStatusPanel() {
    if (!webStatusPanel && instagramMonitor && typeof instagramMonitor.getStatus === 'function') {
        try {
            const WebStatusPanel = require('./web_status_panel');
            webStatusPanel = new WebStatusPanel(
                app, 
                unifiedState, 
                config, 
                client, 
                () => instagramMonitor,
                () => blogMonitor
            );
            console.log('🌐 [Web面板] 狀態面板已初始化');
        } catch (error) {
            console.error('❌ [Web面板] 初始化失敗:', error.message);
            setTimeout(() => {
                console.log('🔄 [Web面板] 嘗試重新初始化...');
                initializeWebStatusPanel();
            }, 5000);
        }
    } else if (!instagramMonitor) {
        console.log('⏳ [Web面板] 等待Instagram監控初始化...');
        setTimeout(initializeWebStatusPanel, 3000);
    } else if (typeof instagramMonitor.getStatus !== 'function') {
        console.log('⏳ [Web面板] Instagram監控尚未完全初始化...');
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
    
    if (blogMonitor) {
        blogMonitor.stopMonitoring();
    }
    
    if (unifiedState.botReady) {
        await sendNotification('📴 統一監控機器人正在關閉...', 'info', 'System');
    }
    
    client.destroy();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('🛑 收到終止信號，正在安全關閉...');
    unifiedState.instagram.isMonitoring = false;
    
    if (blogMonitor) {
        blogMonitor.stopMonitoring();
    }
    
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