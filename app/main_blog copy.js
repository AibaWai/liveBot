const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const https = require('https');
const axios = require('axios');

// Express 設定
const app = express();
const PORT = process.env.PORT || 3000;

// 博客監控配置
const BLOG_NOTIFICATION_CHANNEL_ID = process.env.BLOG_NOTIFICATION_CHANNEL_ID;

if (BLOG_NOTIFICATION_CHANNEL_ID) {
    console.log('📝 博客監控已啟用 (API探測模式)');
} else {
    console.log('📝 博客監控未配置 (BLOG_NOTIFICATION_CHANNEL_ID 未設定)');
}

console.log('🚀 輕量級統一直播監控機器人啟動中...');
console.log('📺 Instagram 監控 + Discord 頻道監控 + API探測博客監控');

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
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    NOTIFICATION_CHANNEL_ID: process.env.NOTIFICATION_CHANNEL_ID,
    TARGET_USERNAME: process.env.TARGET_USERNAME,
    IG_SESSION_ID: process.env.IG_SESSION_ID,
    IG_CSRF_TOKEN: process.env.IG_CSRF_TOKEN,
    IG_DS_USER_ID: process.env.IG_DS_USER_ID,
    CHANNEL_CONFIGS: discordChannelConfigs,
    PUSHCALL_API_KEY: process.env.PUSHCALL_API_KEY,
    PUSHCALL_FROM: process.env.PUSHCALL_FROM,
    PUSHCALL_TO: process.env.PUSHCALL_TO,
    BLOG_NOTIFICATION_CHANNEL_ID: process.env.BLOG_NOTIFICATION_CHANNEL_ID
};

// === 統一狀態管理 ===
let unifiedState = {
    startTime: Date.now(),
    botReady: false,
    instagram: {
        isLiveNow: false,
        targetUserId: null,
        isMonitoring: false,
        consecutiveErrors: 0,
        accountStatus: 'unknown',
        totalRequests: 0,
        successfulRequests: 0,
        lastSuccessTime: Date.now(),
        lastCheck: null
    },
    discord: {
        totalMessagesProcessed: 0,
        channelStats: {},
        lastDetections: [],
        apiUsage: {}
    },
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
        
        // 使用新的平衡安全監控器
        const BalancedSafeInstagramMonitor = require('./balanced_safe_instagram_monitor');
        
        instagramMonitor = new BalancedSafeInstagramMonitor(sendNotification);
        
        console.log('🚀 [Instagram] 啟動平衡安全監控系統');
        console.log('🔧 [手動啟動] 監控不會自動開始，請使用 !ig-start 命令');
        
        // 預載入目標用戶ID但不開始監控
        try {
            console.log(`🔄 [預載] 預載入 @${config.TARGET_USERNAME} 的用戶ID...`);
            await instagramMonitor.preloadUserIds([config.TARGET_USERNAME]);
            console.log('✅ [預載] 用戶ID預載入完成，系統準備就緒');
            
            // 發送準備就緒通知
            await sendNotification(`🔧 **Instagram監控系統準備就緒** 

**目標用戶:** @${config.TARGET_USERNAME}
**用戶ID:** 已預載入 ✅
**監控狀態:** 等待手動啟動

**🛡️ 平衡安全特性:**
• 每次檢查只需1個API請求 (預載入用戶ID)
• 睡眠時段 (02:00-06:00) 完全停止
• 間隔設定: 2-5分鐘 (保持檢測頻率)
• 每日限制: 500次總請求, 200次/帳號
• 🔄 智能輪換: 每2次成功輪換帳號
• 🚫 嚴格策略: 一次錯誤即停用帳號

**📋 啟動命令:**
\`!ig-start\` - 開始監控
\`!ig-status\` - 查看狀態
\`!ig-accounts\` - 查看帳號狀態
\`!ig-reset\` - 重置停用的帳號狀態

⚠️ **注意:** 監控不會自動開始，請手動啟動！`, 'info', 'Instagram');
            
        } catch (preloadError) {
            console.error('❌ [預載] 用戶ID預載入失敗:', preloadError.message);
            
            await sendNotification(`⚠️ **Instagram監控系統警告** 

**系統狀態:** 已初始化但預載入失敗
**目標用戶:** @${config.TARGET_USERNAME}
**錯誤:** ${preloadError.message}

**可能原因:**
• Instagram帳號認證失效
• 網絡連接問題
• 用戶名不存在

**解決方案:**
1. 檢查帳號cookies是否有效
2. 使用 \`!ig-start\` 嘗試手動啟動
3. 使用 \`!ig-accounts\` 檢查帳號狀態

系統已初始化，可嘗試手動操作`, 'warning', 'Instagram');
        }
        
        unifiedState.instagram.isMonitoring = false; // 不自動開始
        
    } catch (error) {
        console.error('❌ [Instagram] 平衡安全監控啟動失敗:', error.message);
        
        await sendNotification(`❌ **Instagram監控系統啟動失敗** 

**錯誤:** ${error.message}

**可能原因:**
• 環境變數配置錯誤
• Instagram帳號格式錯誤
• 系統資源不足

**檢查項目:**
\`IG_ACCOUNT_1\` 格式: sessionid|csrftoken|ds_user_id
\`IG_ACCOUNT_2\` 格式: sessionid|csrftoken|ds_user_id

請修復配置後重新部署`, 'error', 'Instagram');
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
    try {
        if (instagramMonitor && typeof instagramMonitor.getStatus === 'function') {
            const status = instagramMonitor.getStatus();
            status.isLiveNow = unifiedState.instagram.isLiveNow;
            return status;
        }
    } catch (error) {
        console.error('❌ [狀態] 獲取Instagram狀態失敗:', error.message);
    }
    
    // 返回默認狀態
    return {
        isMonitoring: false,
        isLiveNow: false,
        accountStatus: 'initializing',
        successRate: 0,
        totalRequests: 0,
        successfulRequests: 0,
        consecutiveErrors: 0,
        totalAccounts: 0,
        availableAccounts: 0,
        disabledAccounts: 0,
        dailyRequests: 0,
        maxDailyRequests: 500, // 更新為新的限制
        lastCheck: null,
        targetUserId: null,
        japanTime: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' }),
        japanHour: parseInt(new Date().toLocaleString('zh-TW', { 
            timeZone: 'Asia/Tokyo',
            hour: '2-digit',
            hour12: false
        }).split(':')[0]),
        currentTimeSlot: 'unknown',
        sleepHours: [2, 3, 4, 5, 6],
        lowActivityHours: [0, 1, 7, 8, 23],
        preloadedUsers: [],
        errorHandling: 'one_error_disable',
        rotationStrategy: 'every_2_success',
        accountDetails: []
    };
}

// === 輕量級博客監控系統 ===
let blogMonitor = null;

async function startBlogMonitoring() {
    if (!BLOG_NOTIFICATION_CHANNEL_ID) {
        console.log('⚠️ [Blog] 未配置通知頻道，跳過博客監控');
        return;
    }

    try {
        // 使用新的真正API監控器
        const FamilyClubBlogMonitor = require('./family_club_blog_monitor');
        
        blogMonitor = new FamilyClubBlogMonitor(async (message, type, source) => {
            try {
                const channel = await client.channels.fetch(BLOG_NOTIFICATION_CHANNEL_ID);
                await channel.send(message);
                console.log(`📤 [${source}] 博客通知已發送: ${type}`);
            } catch (error) {
                console.error('❌ 博客通知發送失敗:', error.message);
            }
        });
        
        blogMonitor.startMonitoring();
        console.log('🚀 [Blog] Family Club 博客監控已啟動');
        console.log('🎯 [Blog] 監控模式: 真正的API端點 (diarkiji_list)');
        console.log('🔗 [Blog] API端點: https://web.familyclub.jp/s/jwb/api/list/diarkiji_list?code=F2017&so=JW5&page=0');
        console.log('⏰ [Blog] 檢查頻率: 每小時00分');
        
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
    console.log(`🕐 當前日本時間: ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' })}`);
    
    // 發送啟動通知（修改版本）
    sendNotification(`🚀 **平衡安全統一監控機器人已啟動** (日本時間)

**Instagram監控:** @${config.TARGET_USERNAME} (手動啟動模式)
**Discord頻道監控:** ${Object.keys(config.CHANNEL_CONFIGS).length} 個頻道
**博客監控:** ${config.BLOG_NOTIFICATION_CHANNEL_ID ? '✅ Family Club 高木雄也' : '❌ 未配置'}
**電話通知:** ${config.PUSHCALL_API_KEY ? '✅ 已配置' : '❌ 未配置'}

**🛡️ 平衡安全Instagram監控特性:**
• 🚫 **不自動啟動** - 需手動使用 \`!ig-start\`
• 😴 **睡眠模式** - 02:00-06:00完全停止監控
• ⚡ **單請求檢查** - 預載入用戶ID，每次只需1個API調用
• 🕐 **保持頻率** - 2-5分鐘間隔 (不會錯過直播)
• 🔄 **智能輪換** - 每2次成功自動輪換到其他帳號
• 🚫 **嚴格保護** - 一次錯誤即停用帳號 (保護長期可用性)
• 📊 **充足限制** - 500次/日總請求, 200次/帳號

**⏰ 監控時程:**
• 😴 深夜 (02-06): 完全停止
• 🌅 低活躍 (00-01, 07-08, 23): 較長間隔
• ☀️ 正常 (09-22): 2-5分鐘間隔

**📋 主要命令:**
\`!ig-start\` - 手動開始Instagram監控
\`!ig-status\` - 查看監控狀態
\`!ig-accounts\` - 檢查帳號狀態
\`!ig-reset\` - 重置停用的帳號狀態
\`!status\` - 完整系統狀態
\`!help\` - 顯示幫助

⚠️ **重要:** Instagram監控已切換為手動啟動模式，請使用 \`!ig-start\` 開始監控

💡 **使用提示:** 如果帳號被停用，可使用 \`!ig-reset\` 重置狀態後重新啟動`, 'info', 'System');
    
    // 初始化Instagram監控系統（但不開始監控）
    startInstagramMonitoring().then(() => {
        setTimeout(() => {
            console.log('🔄 [Web面板] 開始初始化狀態面板...');
            initializeWebStatusPanel();
        }, 5000);
    }).catch(error => {
        console.error('❌ [Instagram] 監控系統初始化失敗:', error.message);
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
        if (!instagramMonitor) {
            await message.reply('❌ Instagram監控系統未初始化，請重新啟動Bot');
            return;
        }
        
        if (unifiedState.instagram.isMonitoring) {
            await message.reply('⚠️ Instagram監控已在運行中!');
            return;
        }
        
        await message.reply('🚀 正在啟動Instagram監控...');
        
        try {
            const started = await instagramMonitor.startMonitoring(config.TARGET_USERNAME, async () => {
                if (!unifiedState.instagram.isLiveNow) {
                    unifiedState.instagram.isLiveNow = true;
                    console.log('🔴 [Instagram] 檢測到直播開始!');
                    
                    await sendNotification(`🔴 **@${config.TARGET_USERNAME} Instagram直播開始!** 🎥

📺 觀看: https://www.instagram.com/${config.TARGET_USERNAME}/
⏰ 檢測時間: ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' })}
🛡️ 平衡安全監控系統
🕐 日本時間智能調整

🚀 快去看直播吧！`, 'live_alert', 'Instagram');
                }
            });
            
            if (started) {
                unifiedState.instagram.isMonitoring = true;
                await message.reply('✅ Instagram監控已成功啟動！');
            } else {
                await message.reply('❌ Instagram監控啟動失敗，請檢查帳號狀態');
            }
            
        } catch (error) {
            console.error('❌ [命令] Instagram監控啟動失敗:', error.message);
            await message.reply(`❌ 啟動失敗: ${error.message}`);
        }
    }
    
    else if (cmd === '!ig-stop') {
        if (!instagramMonitor) {
            await message.reply('❌ Instagram監控系統未初始化');
            return;
        }
        
        const stopped = instagramMonitor.stopMonitoring();
        if (stopped) {
            unifiedState.instagram.isMonitoring = false;
            unifiedState.instagram.isLiveNow = false;
            await message.reply('⏹️ Instagram監控已停止');
        } else {
            await message.reply('⚠️ 停止監控時發生錯誤');
        }
    }
    
    else if (cmd === '!ig-status') {
        if (!instagramMonitor) {
            await message.reply('❌ Instagram監控系統未初始化');
            return;
        }
        
        const runtime = Math.round((Date.now() - unifiedState.startTime) / 60000);
        const igStatus = getInstagramStatus();
        
        const statusMsg = `📊 **平衡安全Instagram監控狀態** (日本時間)

**目標:** @${config.TARGET_USERNAME}
**當前狀態:** ${unifiedState.instagram.isLiveNow ? '🔴 直播中' : '⚫ 離線'}
**監控:** ${igStatus.isMonitoring ? '✅ 運行中' : '❌ 已停止'}

**🔐 帳號狀態:**
• 總帳號數: ${igStatus.totalAccounts}
• 可用帳號: ${igStatus.availableAccounts}
• 停用帳號: ${igStatus.disabledAccounts || 0}

**📊 請求統計:**
• 今日請求: ${igStatus.dailyRequests}/${igStatus.maxDailyRequests}
• 成功率: ${igStatus.successRate}%
• 運行時間: ${runtime} 分鐘

**⏰ 時間段管理 (日本時間):**
• 當前時間: ${igStatus.japanTime}
• 當前時段: ${igStatus.currentTimeSlot === 'sleep' ? '😴 睡眠時段' : 
                        igStatus.currentTimeSlot === 'low_activity' ? '🌅 低活躍時段' : 
                        '☀️ 正常時段'}
• 睡眠時段: ${igStatus.sleepHours?.join(', ')}:00 (完全停止)

**🎯 預載入用戶:**
${igStatus.preloadedUsers?.map(user => 
    `• ${user.username}: ${user.userId} (${user.cacheAge}小時前載入)`
).join('\n') || '• 無預載入用戶'}

**🛡️ 安全策略:**
• 錯誤處理: ${igStatus.errorHandling || '一次錯誤即停用'}
• 輪換策略: ${igStatus.rotationStrategy || '每2次成功輪換'}`;

        await message.reply(statusMsg);
    }
    
    else if (cmd === '!ig-accounts' || cmd === '!accounts') {
        if (!instagramMonitor) {
            await message.reply('❌ Instagram監控系統未初始化');
            return;
        }
        
        try {
            const igStatus = getInstagramStatus();
            
            let statusMsg = `🔐 **Instagram帳號狀態** (日本時間)

📊 **總覽:**
• 總帳號數: ${igStatus.totalAccounts}
• 可用帳號: ${igStatus.availableAccounts} ✅
• 停用帳號: ${igStatus.disabledAccounts || 0} 🚫
• 檢查時間: ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' })}

📋 **帳號詳情:**\n`;

            igStatus.accountDetails?.forEach(account => {
                const statusIcon = account.isDisabled ? '🚫' : '✅';
                const statusText = account.isDisabled ? '已停用' : '可用';
                const successRate = account.successCount + account.errorCount > 0 ? 
                    Math.round(account.successCount / (account.successCount + account.errorCount) * 100) : 0;
                
                statusMsg += `${statusIcon} **${account.id}**: ${statusText}\n`;
                statusMsg += `   └ 成功率: ${successRate}%, 今日請求: ${account.dailyRequests}/${igStatus.maxDailyRequests/igStatus.totalAccounts}\n`;
                statusMsg += `   └ 最後使用: ${account.lastUsed}\n`;
                statusMsg += `   └ 連續成功: ${account.consecutiveSuccess}/${account.rotationThreshold} (${account.nextRotationIn}次後輪換)\n`;
                
                if (account.isDisabled && account.disabledReason) {
                    statusMsg += `   └ ❌ 停用原因: ${account.disabledReason}\n`;
                }
            });

            if ((igStatus.disabledAccounts || 0) > 0) {
                statusMsg += `\n⚠️ **注意:** 有 ${igStatus.disabledAccounts} 個帳號已停用！`;
                statusMsg += `\n💡 **提示:** 使用 \`!ig-reset\` 重置帳號狀態，或更新cookies`;
            }

            if (igStatus.availableAccounts === 0) {
                statusMsg += `\n🆘 **緊急:** 沒有可用帳號！請立即使用 \`!ig-reset\` 或修復cookies`;
            }

            await message.reply(statusMsg);
        } catch (error) {
            await message.reply(`❌ 獲取帳號狀態失敗: ${error.message}`);
        }
    }
    
    else if (cmd === '!ig-reset') {
        if (!instagramMonitor) {
            await message.reply('❌ Instagram監控系統未初始化');
            return;
        }
        
        try {
            const igStatus = getInstagramStatus();
            const disabledCount = igStatus.disabledAccounts || 0;
            
            if (disabledCount === 0) {
                await message.reply('ℹ️ 沒有需要重置的帳號，所有帳號都是可用狀態');
                return;
            }
            
            // 重置帳號狀態
            if (typeof instagramMonitor.resetAccountStatus === 'function') {
                instagramMonitor.resetAccountStatus();
                
                await message.reply(`🔄 **帳號狀態已重置**

**重置帳號數:** ${disabledCount}
**重置時間:** ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' })}

**注意事項:**
• 所有帳號的錯誤狀態已清除
• 帳號輪換計數已重置
• 如果cookies確實失效，帳號可能會再次被停用
• 建議重置後立即測試監控功能

**後續動作:**
1. 使用 \`!ig-accounts\` 確認帳號狀態
2. 使用 \`!ig-start\` 重新啟動監控
3. 觀察帳號是否正常運作`);
                
            } else {
                await message.reply('❌ 當前監控器版本不支援重置功能');
            }
        } catch (error) {
            await message.reply(`❌ 重置帳號狀態失敗: ${error.message}`);
        }
    }
    
    else if (cmd === '!ig-check') {
        if (!instagramMonitor) {
            await message.reply('❌ Instagram監控系統未初始化');
            return;
        }
        
        await message.reply('🔍 執行手動Instagram檢查...');
        
        try {
            const isLive = await instagramMonitor.checkLive(config.TARGET_USERNAME);
            const status = isLive ? '🔴 發現直播' : '⚫ 無直播';
            const igStatus = getInstagramStatus();
            
            await message.reply(`📊 **手動檢查結果:** ${status}

🕐 檢查時間: ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' })}
🔐 可用帳號: ${igStatus.availableAccounts}/${igStatus.totalAccounts}
🚫 停用帳號: ${igStatus.disabledAccounts || 0}
📊 今日請求: ${igStatus.dailyRequests}/${igStatus.maxDailyRequests}
⏰ 當前時段: ${igStatus.currentTimeSlot === 'sleep' ? '😴 睡眠' : 
                      igStatus.currentTimeSlot === 'low_activity' ? '🌅 低活躍' : 
                      '☀️ 正常'}

${igStatus.disabledAccounts > 0 ? '\n💡 **提示:** 有帳號被停用，可使用 `!ig-reset` 重置' : ''}`);
        } catch (error) {
            await message.reply(`❌ 檢查失敗: ${error.message}`);
        }
    }
    
    else if (cmd === '!ig-preload') {
        if (!instagramMonitor) {
            await message.reply('❌ Instagram監控系統未初始化');
            return;
        }
        
        await message.reply(`🔄 重新預載入 @${config.TARGET_USERNAME} 的用戶ID...`);
        
        try {
            await instagramMonitor.preloadUserIds([config.TARGET_USERNAME]);
            await message.reply('✅ 用戶ID預載入成功！');
        } catch (error) {
            await message.reply(`❌ 預載入失敗: ${error.message}`);
        }
    }
    
    else if (cmd === '!status') {
        const runtime = Math.round((Date.now() - unifiedState.startTime) / 60000);
        const igStatus = getInstagramStatus();
        const blogStatus = blogMonitor ? blogMonitor.getStatus() : { isMonitoring: false };
        const latestRecord = blogMonitor ? blogMonitor.getLatestRecord() : null;
        
        const statusMsg = `📊 **平衡安全統一監控系統狀態** (日本時間)

**系統運行時間:** ${runtime} 分鐘
**Bot狀態:** ${unifiedState.botReady ? '✅ 在線' : '❌ 離線'}
**當前日本時間:** ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' })}

**Instagram監控 (平衡安全模式):**
• 目標: @${config.TARGET_USERNAME}
• 狀態: ${unifiedState.instagram.isLiveNow ? '🔴 直播中' : '⚫ 離線'}
• 監控: ${unifiedState.instagram.isMonitoring ? '✅ 運行中' : '❌ 停止'}
• 可用帳號: ${igStatus.availableAccounts}/${igStatus.totalAccounts}
• 停用帳號: ${igStatus.disabledAccounts || 0}
• 成功率: ${igStatus.successRate}%
• 錯誤策略: 一次錯誤即停用
• 輪換策略: 每2次成功輪換

**博客監控:**
• 目標: Family Club F2017
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
• 最後通知: ${unifiedState.notifications.lastNotification || '無'}

**🛡️ 平衡安全特性:**
• 預載入用戶ID: ✅ 每次檢查只需1個請求
• 睡眠模式: ✅ 02:00-06:00完全停止
• 手動啟動: ✅ 防止意外啟動
• 智能輪換: ✅ 每2次成功輪換帳號
• 嚴格策略: ✅ 一次錯誤即停用保護帳號`;

        await message.reply(statusMsg);
    }
    
    // 博客監控命令
    else if (cmd === '!blog-status') {
        if (blogMonitor) {
            const blogStatus = blogMonitor.getStatus();
            const latestRecord = blogMonitor.getLatestRecord();
            
            const statusMsg = `📝 **Family Club 博客監控狀態** (${blogStatus.artistName})

    **監控狀態:** ${blogStatus.isMonitoring ? '✅ 運行中' : '❌ 已停止'}
    **目標藝人:** ${blogStatus.artistName} (${blogStatus.artistCode})
    **API端點:** Family Club 官方API
    **博客網址:** ${blogStatus.blogUrl}

    **檢查統計:**
    • 總檢查次數: ${blogStatus.totalChecks}
    • 發現新文章: ${blogStatus.articlesFound} 篇
    • 最後檢查: ${blogStatus.lastCheckTime || '尚未檢查'}
    • 下次檢查: ${blogStatus.nextCheckTime || '未安排'}

    **監控時程:**
    • 活躍時段: ${blogStatus.activeTimeSchedule}
    • 當前是活躍時段: ${blogStatus.currentActiveTime ? '✅ 是' : '❌ 否'}
    • 日本時間: ${blogStatus.japanTime}

    **當前記錄的最新文章:**
    ${latestRecord ? `📄 文章代碼: ${latestRecord.articleCode}
    🗓️ 發布時間: ${latestRecord.datetime}
    📝 標題: ${latestRecord.title}
    📝 Diary名稱: ${latestRecord.diaryName}
    ${latestRecord.url ? `🔗 連結: ${latestRecord.url}` : ''}
    ⏰ 記錄更新: ${latestRecord.lastUpdated}` : '❌ 尚未建立記錄'}

    💡 **監控邏輯:**
    • 日本時間12:00-23:59每小時00分檢查
    • 比較文章代碼和發布時間
    • 發現新文章自動發送通知`;

            await message.reply(statusMsg);
        } else {
            await message.reply('❌ 博客監控未啟用');
        }
    }

    else if (cmd === '!blog-test') {
        if (blogMonitor) {
            await message.reply('🔍 執行博客API連接測試...');
            try {
                const testResult = await blogMonitor.testWebsiteAccess();
                
                if (testResult.success) {
                    const testMsg = `✅ **博客API連接測試成功**

    🔧 **檢測方式:** ${testResult.method}
    🎭 **目標藝人:** ${testResult.artistName} (${testResult.artistCode})
    📡 **API端點:** ${testResult.endpoint}
    📰 **找到文章:** ${testResult.articlesFound} 篇

    📋 **API參數:**
    • 藝人代碼: ${testResult.apiParameters.code}
    • 排序方式: ${testResult.apiParameters.so}
    • 頁數: ${testResult.apiParameters.page}

    ${testResult.sampleArticles && testResult.sampleArticles.length > 0 ? `📝 **範例文章:**
    ${testResult.sampleArticles.map((article, index) => 
        `${index + 1}. 代碼: ${article.code} | 時間: ${article.time} | 標題: ${article.title}${article.diaryName ? ` | Diary: ${article.diaryName}` : ''}`
    ).join('\n')}` : ''}

    ✅ Family Club API系統運行正常！`;
                    
                    await message.reply(testMsg);
                } else {
                    await message.reply(`❌ **博客API連接測試失敗**

    🔧 **檢測方式:** ${testResult.method}
    🎭 **目標藝人代碼:** ${testResult.artistCode}
    📡 **API端點:** ${testResult.endpoint}
    ❌ **錯誤:** ${testResult.error}

    🔧 **故障排除建議:**
    • 檢查網絡連接
    • 確認藝人代碼是否正確
    • 確認Family Club網站是否正常運行
    • 稍後再試`);
                }
            } catch (error) {
                await message.reply(`❌ 測試執行失敗: ${error.message}`);
            }
        } else {
            await message.reply('❌ 博客監控未啟用');
        }
    }

    else if (cmd === '!blog-check') {
        if (blogMonitor) {
            await message.reply('🔍 執行手動博客檢查...');
            try {
                // 調用測試模式檢查
                const newArticle = await blogMonitor.checkForNewArticles(true);
                
                if (newArticle) {
                    const checkMsg = `📊 **手動檢查結果**

    🆕 **當前最新文章:**
    📄 **代碼:** ${newArticle.code}
    📝 **標題:** ${newArticle.title}
    📝 **Diary名稱:** ${newArticle.diaryName}
    📅 **發布時間:** ${newArticle.datetimeString}
    👤 **藝人:** ${newArticle.artistName}
    ${newArticle.url ? `🔗 **連結:** ${newArticle.url}` : ''}

    🕐 **檢查時間:** ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
    📊 **當前記錄:** ${blogMonitor.getLatestRecord()?.articleCode || '無'}
    🎯 **API狀態:** 正常運行`;

                    await message.reply(checkMsg);
                } else {
                    // 如果沒有返回文章，嘗試獲取狀態信息
                    const status = blogMonitor.getStatus();
                    await message.reply(`❌ **手動檢查完成但無法獲取詳細信息**

    📊 **基本狀態:**
    • 監控狀態: ${status.isMonitoring ? '✅ 運行中' : '❌ 已停止'}
    • 檢查次數: ${status.totalChecks}
    • 發現文章: ${status.articlesFound}
    • 最後檢查: ${status.lastCheckTime || '尚未檢查'}

    🔧 **故障排除:**
    • 使用 \`!blog-test\` 檢查API連接
    • 使用 \`!blog-status\` 查看詳細狀態`);
                }
            } catch (error) {
                await message.reply(`❌ 手動檢查失敗: ${error.message}

    🔧 **故障排除建議:**
    • 檢查網絡連接
    • 確認藝人代碼配置 (ARTIST_CODE)
    • 使用 \`!blog-test\` 進行詳細診斷
    • 使用 \`!blog-restart\` 重新啟動監控`);
            }
        } else {
            await message.reply('❌ 博客監控未啟用');
        }
    }

    else if (cmd === '!blog-restart') {
        if (blogMonitor) {
            await message.reply('🔄 重新啟動博客監控...');
            try {
                blogMonitor.stopMonitoring();
                await new Promise(resolve => setTimeout(resolve, 2000)); // 等待2秒
                
                const success = await blogMonitor.reinitialize();
                if (success) {
                    blogMonitor.startMonitoring();
                    await message.reply('✅ **博客監控重新啟動成功！**\n\n📊 已重新初始化最新文章記錄\n⏰ 恢復定期檢查排程');
                } else {
                    await message.reply('❌ **博客監控重新啟動失敗**\n\n無法重新初始化，請檢查API連接和藝人代碼');
                }
            } catch (error) {
                await message.reply(`❌ 重新啟動失敗: ${error.message}`);
            }
        } else {
            await message.reply('❌ 博客監控未啟用');
        }
    }
    
    // 更新幫助命令
    else if (cmd === '!help') {
        await message.reply(`🔍 **平衡安全Instagram監控機器人** (日本時間版)

**Instagram監控命令:**
\`!ig-start\` - 手動開始Instagram監控
\`!ig-stop\` - 停止Instagram監控  
\`!ig-status\` - Instagram監控狀態
\`!ig-check\` - 手動檢查Instagram
\`!ig-accounts\` - 檢查帳號狀態
\`!ig-reset\` - 重置停用的帳號狀態
\`!ig-preload\` - 重新預載入用戶ID

**博客監控命令:** (Family Club)
\`!blog-status\` - 博客監控狀態
\`!blog-test\` - 測試API連接
\`!blog-check\` - 手動檢查新文章
\`!blog-restart\` - 重新啟動博客監控

**系統命令:**
\`!status\` - 完整系統狀態
\`!help\` - 顯示此幫助

**🛡️ 平衡安全特性:**
• 手動啟動：不會自動開始監控
• 睡眠模式：02:00-06:00完全停止
• 單請求檢查：預載入用戶ID
• 保持頻率：2-5分鐘間隔 (不會錯過直播)
• 智能輪換：每2次成功就輪換帳號
• 嚴格保護：一次錯誤即停用帳號
• 每日限制：500次總請求, 200次/帳號

**💡 常用操作流程:**
1. \`!ig-start\` 啟動監控
2. \`!ig-status\` 查看狀態
3. 如有帳號停用，使用 \`!ig-reset\` 重置
4. \`!ig-accounts\` 查看詳細帳號狀態`);
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

// 健康檢查端點
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        uptime: Math.round((Date.now() - unifiedState.startTime) / 1000),
        instagram: unifiedState.instagram.isMonitoring,
        blog: blogMonitor ? blogMonitor.getStatus().isMonitoring : false,
        discord: unifiedState.botReady
    });
});

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
        await sendNotification('📴 輕量級統一監控機器人正在關閉...', 'info', 'System');
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