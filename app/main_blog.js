const express = require('express');
const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const axios = require('axios');
const path = require('path');

// 引入模組化組件
const DiscordCommandHandler = require('./discord_commands');

// Express 設定
const app = express();
const PORT = process.env.PORT || 3000;

console.log('🚀 Discord頻道監控 + Family Club博客監控 + Instagram監控機器人啟動中...');
console.log('📱 Instagram監控: Mode 1 (貼文 + Bio + 頭像變更)');
console.log('📺 Discord頻道監控 + 📝 Family Club博客監控 + 📸 Instagram監控');

// === 環境變數檢查 ===
const requiredEnvVars = [
    'DISCORD_TOKEN', 
    'NOTIFICATION_CHANNEL_ID'
];

// Discord監控配置（必要）
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
        console.warn('⚠️ Discord頻道配置解析失敗，將只運行博客和Instagram監控');
        console.warn('錯誤詳情:', error.message);
    }
} else {
    console.log('📋 未配置Discord頻道監控 (CHANNEL_CONFIGS 未設定)');
}

// 博客監控配置
const BLOG_NOTIFICATION_CHANNEL_ID = process.env.BLOG_NOTIFICATION_CHANNEL_ID;
if (BLOG_NOTIFICATION_CHANNEL_ID) {
    console.log('📝 Family Club博客監控已啟用');
} else {
    console.log('📝 博客監控未配置 (BLOG_NOTIFICATION_CHANNEL_ID 未設定)');
}

// Instagram監控配置
const INSTAGRAM_USERNAME = process.env.INSTAGRAM_USERNAME;
const INSTAGRAM_NOTIFICATION_CHANNEL_ID = process.env.INSTAGRAM_NOTIFICATION_CHANNEL_ID;
const INSTAGRAM_CHECK_INTERVAL = parseInt(process.env.INSTAGRAM_CHECK_INTERVAL) || 5 * 60 * 1000; // 預設5分鐘

if (INSTAGRAM_USERNAME && INSTAGRAM_NOTIFICATION_CHANNEL_ID) {
    console.log('📸 Instagram監控已啟用');
    console.log(`👤 監控用戶: @${INSTAGRAM_USERNAME}`);
    console.log(`⏰ 檢查間隔: ${INSTAGRAM_CHECK_INTERVAL / 60000} 分鐘`);
} else {
    console.log('📸 Instagram監控未配置 (INSTAGRAM_USERNAME 或 INSTAGRAM_NOTIFICATION_CHANNEL_ID 未設定)');
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
    CHANNEL_CONFIGS: discordChannelConfigs,
    PUSHCALL_API_KEY: process.env.PUSHCALL_API_KEY,
    PUSHCALL_FROM: process.env.PUSHCALL_FROM,
    PUSHCALL_TO: process.env.PUSHCALL_TO,
    BLOG_NOTIFICATION_CHANNEL_ID: process.env.BLOG_NOTIFICATION_CHANNEL_ID,
    INSTAGRAM_USERNAME: INSTAGRAM_USERNAME,
    INSTAGRAM_NOTIFICATION_CHANNEL_ID: INSTAGRAM_NOTIFICATION_CHANNEL_ID,
    INSTAGRAM_CHECK_INTERVAL: INSTAGRAM_CHECK_INTERVAL,
    CLOUDPHONE_NOTIFICATION_CHANNEL: process.env.CLOUDPHONE_NOTIFICATION_CHANNEL || null
};

// === 統一狀態管理 ===
let unifiedState = {
    startTime: Date.now(),
    botReady: false,
    cloudphone: {
        configured: !!config.CLOUDPHONE_NOTIFICATION_CHANNEL,
        channelId: config.CLOUDPHONE_NOTIFICATION_CHANNEL,
        lastNotification: null,
        totalNotifications: 0
    },
    discord: {
        totalMessagesProcessed: 0,
        channelStats: {},
        lastDetections: [],
        apiUsage: {}
    },
    blog: {
        isMonitoring: false,
        totalChecks: 0,
        articlesFound: 0,
        lastCheck: null
    },
    instagram: {
        isMonitoring: false,
        username: config.INSTAGRAM_USERNAME,
        totalChecks: 0,
        newPostsFound: 0,
        bioChanges: 0,
        profilePicChanges: 0,
        lastCheck: null,
        lastPostId: null,
        storageCleanups: 0
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

// === 監控系統變數 ===
let instagramMonitor = null;
let blogMonitor = null;
let commandHandler = null;

// === Instagram 監控系統 ===
async function startInstagramMonitoring() {
    if (!config.INSTAGRAM_USERNAME || !config.INSTAGRAM_NOTIFICATION_CHANNEL_ID) {
        console.log('⚠️ [Instagram] 未配置監控參數，跳過Instagram監控');
        return;
    }

    try {
        const InstagramMonitor = require('./instagram_monitor');
        
        instagramMonitor = new InstagramMonitor(
            async (message, type, source, mediaFiles = []) => {
                try {
                    const channel = await client.channels.fetch(config.INSTAGRAM_NOTIFICATION_CHANNEL_ID);
                    
                    // 準備附件
                    const attachments = [];
                    if (mediaFiles && mediaFiles.length > 0) {
                        for (const filePath of mediaFiles) {
                            try {
                                const attachment = new AttachmentBuilder(filePath, {
                                    name: path.basename(filePath)
                                });
                                attachments.push(attachment);
                            } catch (error) {
                                console.error(`❌ [Instagram] 附件準備失敗: ${error.message}`);
                            }
                        }
                    }
                    
                    // 發送訊息
                    const messageOptions = { content: message };
                    if (attachments.length > 0) {
                        messageOptions.files = attachments;
                    }
                    
                    await channel.send(messageOptions);
                    
                    unifiedState.notifications.discordMessages++;
                    if (type === 'new_post') unifiedState.instagram.newPostsFound++;
                    if (type === 'bio_change') unifiedState.instagram.bioChanges++;
                    if (type === 'profile_pic_change') unifiedState.instagram.profilePicChanges++;
                    
                    console.log(`📤 [${source}] Instagram通知已發送: ${type} ${attachments.length > 0 ? `(含${attachments.length}個附件)` : ''}`);
                    
                    // 如果是新貼文，可選擇撥打電話通知
                    if (type === 'new_post' && config.PUSHCALL_API_KEY) {
                        await makePhoneCall(`Instagram @${config.INSTAGRAM_USERNAME} 發布新貼文！`, source);
                    }
                    
                } catch (error) {
                    console.error('❌ Instagram通知發送失敗:', error.message);
                }
            },
            {
                username: config.INSTAGRAM_USERNAME,
                checkInterval: config.INSTAGRAM_CHECK_INTERVAL
            }
        );
        
        instagramMonitor.startMonitoring();
        unifiedState.instagram.isMonitoring = true;
        
        console.log('🚀 [Instagram] Instagram監控已啟動');
        console.log(`👤 [Instagram] 監控用戶: @${config.INSTAGRAM_USERNAME}`);
        console.log(`⏰ [Instagram] 檢查間隔: ${config.INSTAGRAM_CHECK_INTERVAL / 60000} 分鐘`);
        console.log(`🎯 [Instagram] 監控模式: Mode 1 (貼文 + Bio + 頭像變更)`);
        console.log(`💾 [Instagram] 存儲策略: Koyeb臨時存儲 + 即時清理`);
        
    } catch (error) {
        console.error('❌ [Instagram] Instagram監控啟動失敗:', error.message);
    }
}

// === 博客監控系統 ===
async function startBlogMonitoring() {
    if (!BLOG_NOTIFICATION_CHANNEL_ID) {
        console.log('⚠️ [Blog] 未配置通知頻道，跳過博客監控');
        return;
    }

    try {
        const FamilyClubBlogMonitor = require('./family_club_blog_monitor');
        
        blogMonitor = new FamilyClubBlogMonitor(async (message, type, source) => {
            try {
                const channel = await client.channels.fetch(BLOG_NOTIFICATION_CHANNEL_ID);
                await channel.send(message);
                unifiedState.blog.articlesFound++;
                console.log(`📤 [${source}] 博客通知已發送: ${type}`);
            } catch (error) {
                console.error('❌ 博客通知發送失敗:', error.message);
            }
        });
        
        blogMonitor.startMonitoring();
        unifiedState.blog.isMonitoring = true;
        
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
        
        if (type === 'live_alert' && source === 'Discord' && config.PUSHCALL_API_KEY) {
            await makePhoneCall(`直播開始了！`, source);
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
    
    // 先啟動監控系統
    startBlogMonitoring();
    startInstagramMonitoring();
    
    // 在監控系統啟動後初始化命令處理器
    setTimeout(() => {
        commandHandler = new DiscordCommandHandler(
            unifiedState, 
            config, 
            () => blogMonitor, 
            () => instagramMonitor
        );
        console.log('🎮 [Discord] 命令處理器已初始化');
    }, 1000);
    
    console.log(`✅ Discord Bot 已上線: ${client.user.tag}`);
    console.log(`📋 Discord頻道監控: ${Object.keys(config.CHANNEL_CONFIGS).length} 個頻道`);
    console.log(`🕐 當前日本時間: ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' })}`);
    
    // 發送啟動通知
    sendNotification(`🚀 **統一監控機器人已啟動** (日本時間)

**Discord頻道監控:** ${Object.keys(config.CHANNEL_CONFIGS).length} 個頻道
**博客監控:** ${config.BLOG_NOTIFICATION_CHANNEL_ID ? '✅ Family Club 高木雄也' : '❌ 未配置'}
**Instagram監控:** ${config.INSTAGRAM_USERNAME ? `✅ @${config.INSTAGRAM_USERNAME}` : '❌ 未配置'}
**電話通知:** ${config.PUSHCALL_API_KEY ? '✅ 已配置' : '❌ 未配置'}
`, 'info', 'System');
    
    // 初始化Web狀態面板
    setTimeout(() => {
        console.log('🔄 [Web面板] 開始初始化狀態面板...');
        initializeWebStatusPanel();
    }, 3000);
});

// Discord消息監聽
client.on('messageCreate', async (message) => {
    try {
        unifiedState.discord.totalMessagesProcessed++;
        
        if (message.author.bot && message.author.id === client.user.id) return;
        
        // 處理命令
        if (message.content.startsWith('!')) {
            if (commandHandler) {
                await commandHandler.handleCommand(message);
            } else {
                await message.reply('❌ 命令處理器尚未初始化，請稍後再試');
            }
            return;
        }
        
        // 處理頻道監控
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
            
            // 保持最多20個檢測記錄
            if (unifiedState.discord.lastDetections.length > 20) {
                unifiedState.discord.lastDetections = unifiedState.discord.lastDetections.slice(-20);
            }
            
            // 發送自定義通知訊息到主通知頻道
            if (channelConfig.message) {
                const customMessage = channelConfig.message
                    .replace('{keyword}', foundKeyword)
                    .replace('{channel}', channelConfig.name || channelId)
                    .replace('{author}', message.author.username)
                    .replace('{time}', new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }));
                
                await sendNotification(customMessage, 'live_alert', 'Discord');
            }
            
            // 撥打頻道專用電話
            if (channelConfig.api_key && channelConfig.phone_number) {
                await callChannelSpecificAPI(channelId, channelConfig, foundKeyword, message.content);
            }
        }
        
    } catch (error) {
        console.error('❌ [Discord消息處理] 錯誤:', error.message);
    }
});

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
            console.log('🔄 [Web面板] 重試初始化狀態面板...');
            initializeWebStatusPanel();
        }, 5000);
    }
}

// 健康檢查端點
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        uptime: Math.round((Date.now() - unifiedState.startTime) / 1000),
        services: {
            discord: unifiedState.botReady,
            blog: blogMonitor ? blogMonitor.getStatus().isMonitoring : false,
            instagram: instagramMonitor ? instagramMonitor.getStatus().isMonitoring : false
        },
        channels: Object.keys(config.CHANNEL_CONFIGS).length,
        monitoring: {
            blog: !!config.BLOG_NOTIFICATION_CHANNEL_ID,
            instagram: !!(config.INSTAGRAM_USERNAME && config.INSTAGRAM_NOTIFICATION_CHANNEL_ID)
        }
    });
});

// 基本路由
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>統一監控機器人</title>
        <meta charset="utf-8">
        <style>
            body { font-family: Arial, sans-serif; margin: 40px; }
            .status { padding: 20px; margin: 10px 0; border-radius: 5px; }
            .online { background-color: #d4edda; border: 1px solid #c3e6cb; }
            .offline { background-color: #f8d7da; border: 1px solid #f5c6cb; }
        </style>
    </head>
    <body>
        <h1>🚀 統一監控機器人</h1>
        <div class="status ${unifiedState.botReady ? 'online' : 'offline'}">
            <h3>系統狀態: ${unifiedState.botReady ? '✅ 在線' : '❌ 離線'}</h3>
            <p>運行時間: ${Math.floor((Date.now() - unifiedState.startTime) / 60000)} 分鐘</p>
            <p>Discord頻道監控: ${Object.keys(config.CHANNEL_CONFIGS).length} 個頻道</p>
            <p>博客監控: ${config.BLOG_NOTIFICATION_CHANNEL_ID ? '✅ 已啟用' : '❌ 未配置'}</p>
            <p>Instagram監控: ${config.INSTAGRAM_USERNAME ? `✅ @${config.INSTAGRAM_USERNAME}` : '❌ 未配置'}</p>
        </div>
        <p>查看健康狀態: <a href="/health">/health</a></p>
        <p>當前時間: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} (日本時間)</p>
    </body>
    </html>
    `);
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
    
    if (blogMonitor) {
        blogMonitor.stopMonitoring();
        console.log('📝 [Blog] 博客監控已停止');
    }
    
    if (instagramMonitor) {
        instagramMonitor.stopMonitoring();
        console.log('📸 [Instagram] Instagram監控已停止');
    }
    
    if (unifiedState.botReady) {
        await sendNotification('📴 統一監控機器人正在關閉...', 'info', 'System');
    }
    
    client.destroy();
    console.log('🤖 [Discord] Bot連接已關閉');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('🛑 收到終止信號，正在安全關閉...');
    
    if (blogMonitor) {
        blogMonitor.stopMonitoring();
        console.log('📝 [Blog] 博客監控已停止');
    }
    
    if (instagramMonitor) {
        instagramMonitor.stopMonitoring();
        console.log('📸 [Instagram] Instagram監控已停止');
    }
    
    client.destroy();
    console.log('🤖 [Discord] Bot連接已關閉');
    process.exit(0);
});

// === 啟動 Discord Bot ===
console.log('🔐 正在登入Discord...');
client.login(config.DISCORD_TOKEN).catch(error => {
    console.error('❌ Discord Bot登入失敗:', error.message);
    console.error('🔑 請檢查DISCORD_TOKEN是否正確');
    process.exit(1);
});