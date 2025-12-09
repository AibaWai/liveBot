const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');

const DiscordCommands = require('./discord_commands');
let discordCommands = null;


// Express 設定
const app = express();
const PORT = process.env.PORT || 3000;

console.log('🚀 Discord頻道監控 + Family Club博客監控機器人啟動中...');
console.log('📱 Instagram監控已轉移至CloudPhone (24/7外部監控)');
console.log('📺 Discord頻道監控 + 📝 Family Club博客監控');

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
        console.warn('⚠️ Discord頻道配置解析失敗，將只運行博客監控');
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

// === 博客監控系統 ===
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
        
        if (type === 'live_alert' && source === 'Discord' && config.PUSHCALL_API_KEY) {
            await makePhoneCall(`Instagram直播開始了！`, source);
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
    
    // 初始化Discord命令處理器
    discordCommands = new DiscordCommands(
        config, 
        unifiedState, 
        () => blogMonitor, // 使用函數返回 blogMonitor，確保獲取最新狀態
        sendNotification
    );
    
    startBlogMonitoring();
    console.log(`✅ Discord Bot 已上線: ${client.user.tag}`);
    console.log(`📋 Discord頻道監控: ${Object.keys(config.CHANNEL_CONFIGS).length} 個頻道`);
    console.log(`🕐 當前日本時間: ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' })}`);
    
    // 發送啟動通知（修改版本）
    sendNotification(`🚀 **統一監控機器人已啟動** (日本時間)

**Discord頻道監控:** ${Object.keys(config.CHANNEL_CONFIGS).length} 個頻道
**博客監控:** ${config.BLOG_NOTIFICATION_CHANNEL_ID ? '✅ Family Club 高木雄也' : '❌ 未配置'}
**電話通知:** ${config.PUSHCALL_API_KEY ? '✅ 已配置' : '❌ 未配置'}
`, 'info', 'System');
    
    // 初始化Web狀態面板
    setTimeout(() => {
        console.log('🔄 [Web面板] 開始初始化狀態面板...');
        initializeWebStatusPanel();
    }, 3000);
});

// Discord消息監聽 - 修改版：支持檢測 embed 中的關鍵字
client.on('messageCreate', async (message) => {
    try {
        unifiedState.discord.totalMessagesProcessed++;
        
        // 忽略自己的命令回覆,但不忽略自己發送的測試 embed
        if (message.author.bot && message.author.id === client.user.id) {
            // 如果是測試訊息(包含 embed),允許繼續處理
            if (!message.embeds || message.embeds.length === 0) {
                return;
            }
            console.log('🧪 [測試] 檢測到 Bot 自己發送的 embed 訊息,繼續處理...');
        }
        
        // 處理命令（使用新的命令處理器）
        if (message.content.startsWith('!')) {
            if (discordCommands) {
                await discordCommands.handleCommand(message);
            } else {
                await message.reply('❌ 命令處理器未初始化，請稍後再試');
            }
            return;
        }
        
        // 頻道監控邏輯
        const channelId = message.channel.id;
        if (!config.CHANNEL_CONFIGS[channelId]) return;
        
        const channelConfig = config.CHANNEL_CONFIGS[channelId];
        
        // === 關鍵修改：收集所有可檢查的文本內容 ===
        let searchableText = message.content.toLowerCase();
        let embedDetected = false;
        
        // 添加 embed 內容到搜索文本
        if (message.embeds && message.embeds.length > 0) {
            console.log(`📦 [Discord] 檢測到 ${message.embeds.length} 個 embed`);
            
            for (const embed of message.embeds) {
                if (embed.title) {
                    searchableText += ' ' + embed.title.toLowerCase();
                    console.log(`   📝 Embed Title: ${embed.title}`);
                }
                if (embed.description) {
                    searchableText += ' ' + embed.description.toLowerCase();
                    console.log(`   📝 Embed Description: ${embed.description.substring(0, 100)}...`);
                }
                if (embed.author?.name) {
                    searchableText += ' ' + embed.author.name.toLowerCase();
                }
                if (embed.footer?.text) {
                    searchableText += ' ' + embed.footer.text.toLowerCase();
                }
                
                // 添加 fields 內容
                if (embed.fields && embed.fields.length > 0) {
                    for (const field of embed.fields) {
                        if (field.name) searchableText += ' ' + field.name.toLowerCase();
                        if (field.value) searchableText += ' ' + field.value.toLowerCase();
                    }
                }
            }
            embedDetected = true;
        }
        
        unifiedState.discord.channelStats[channelId].messagesProcessed++;
        
        // 在合併的文本中搜索關鍵字
        let foundKeyword = null;
        for (const keyword of channelConfig.keywords) {
            if (searchableText.includes(keyword.toLowerCase())) {
                foundKeyword = keyword;
                break;
            }
        }
        
        if (foundKeyword) {
            unifiedState.discord.channelStats[channelId].keywordsDetected++;
            unifiedState.discord.channelStats[channelId].lastDetection = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
            
            const detectionSource = embedDetected ? 'embed' : '訊息內容';
            console.log(`🔔 [Discord頻道監控] 檢測到關鍵字: "${foundKeyword}" (來源: ${detectionSource})`);
            
            const detection = {
                時間: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
                頻道: channelConfig.name || channelId,
                關鍵字: foundKeyword,
                訊息: searchableText.substring(0, 150),
                作者: message.author.username,
                來源: detectionSource
            };
            unifiedState.discord.lastDetections.push(detection);
            
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
                await callChannelSpecificAPI(channelId, channelConfig, foundKeyword, searchableText);
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
            null, // 不需要Instagram監控函數
            () => blogMonitor
        );
        console.log('🌐 [Web面板] 狀態面板已初始化');
    } catch (error) {
        console.error('❌ [Web面板] 初始化失敗:', error.message);
        setTimeout(() => {
            console.log('🔄 [Web面板] 開始初始化狀態面板...');
            initializeWebStatusPanel();
        }, 3000);
    }
}


// 健康檢查端點
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        uptime: Math.round((Date.now() - unifiedState.startTime) / 1000),
        channels: Object.keys(config.CHANNEL_CONFIGS).length,
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
