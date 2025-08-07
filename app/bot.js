const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');

// Express 伺服器設定 (Koyeb 需要 HTTP 端點)
const app = express();
const PORT = process.env.PORT || 3000;

console.log('🚀 Multi-Channel Discord Live Alert Bot 啟動中...');

// 檢查必要的環境變數
const requiredEnvVars = ['DISCORD_TOKEN', 'CHANNEL_CONFIGS'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.error('❌ 缺少必要的環境變數:', missingVars.join(', '));
    console.error('請在 Koyeb 部署設定中添加這些環境變數');
    process.exit(1);
}

// 解析頻道配置
let channelConfigs = {};
try {
    channelConfigs = JSON.parse(process.env.CHANNEL_CONFIGS);
    console.log('⚙️  頻道配置載入成功');
    
    // 驗證每個頻道配置
    for (const [channelId, config] of Object.entries(channelConfigs)) {
        const requiredFields = ['name', 'keywords', 'message', 'api_key', 'phone_number', 'from'];
        const missingFields = requiredFields.filter(field => !config[field]);
        
        if (missingFields.length > 0) {
            console.error(`❌ 頻道 ${channelId} 配置不完整，缺少: ${missingFields.join(', ')}`);
            process.exit(1);
        }
        
        console.log(`📺 監聽頻道: ${config.name} (${channelId})`);
        console.log(`   關鍵字: ${config.keywords.join(', ')}`);
        console.log(`   通知號碼: ${config.phone_number}`);
        console.log(`   來電顯示: ${config.from}`);
    }
} catch (error) {
    console.error('❌ 解析 CHANNEL_CONFIGS 失敗:', error.message);
    console.error('請確認 JSON 格式正確');
    process.exit(1);
}

// 建立 Discord 客戶端
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// 統計資訊
let stats = {
    startTime: Date.now(),
    messagesProcessed: 0,
    channelStats: {},
    totalCallsMade: 0
};

// 防重複機制 - 記錄最近處理的訊息
let recentMessages = new Map();
const DUPLICATE_WINDOW = 10000; // 10秒內的重複訊息會被忽略

// 初始化每個頻道的統計
for (const channelId of Object.keys(channelConfigs)) {
    stats.channelStats[channelId] = {
        liveDetected: 0,
        callsMade: 0,
        lastLiveDetection: null
    };
}

// 健康檢查端點
app.get('/', (req, res) => {
    const uptime = Math.floor((Date.now() - stats.startTime) / 1000);
    
    // 格式化每個頻道的統計資訊
    const channelStatsFormatted = {};
    for (const [channelId, config] of Object.entries(channelConfigs)) {
        const channelStat = stats.channelStats[channelId];
        channelStatsFormatted[config.name] = {
            頻道ID: channelId,
            直播偵測數: channelStat.liveDetected,
            通話撥打數: channelStat.callsMade,
            最後偵測時間: channelStat.lastLiveDetection || '尚未偵測到',
            監聽關鍵字: config.keywords
        };
    }
    
    res.json({
        status: 'Multi-Channel Discord Live Alert Bot 運行中 🤖',
        uptime: `${Math.floor(uptime / 3600)}小時 ${Math.floor((uptime % 3600) / 60)}分鐘`,
        bot_status: client.user ? `✅ ${client.user.tag}` : '❌ 未連線',
        connected_guilds: client.guilds.cache.size,
        monitoring_channels: Object.keys(channelConfigs).length,
        stats: {
            總訊息處理數: stats.messagesProcessed,
            總通話撥打數: stats.totalCallsMade,
            頻道統計: channelStatsFormatted
        },
        timestamp: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: client.user ? 'healthy' : 'unhealthy',
        bot: client.user?.tag || 'Not ready',
        guilds: client.guilds.cache.size,
        monitoring_channels: Object.keys(channelConfigs).length,
        uptime: Math.floor((Date.now() - stats.startTime) / 1000)
    });
});

// 啟動 Express 伺服器
app.listen(PORT, () => {
    console.log(`🌐 HTTP 伺服器運行在 port ${PORT}`);
});

// Discord Bot 事件處理
client.once('ready', () => {
    console.log(`✅ Discord Bot 已上線: ${client.user.tag}`);
    console.log(`🎯 正在監聽 ${Object.keys(channelConfigs).length} 個頻道`);
    console.log(`🏠 已加入 ${client.guilds.cache.size} 個伺服器`);
    console.log('⏰ 開始 24/7 監聽直播通知...');
    
    // 設定 Bot 狀態
    client.user.setActivity(`監聽 ${Object.keys(channelConfigs).length} 個直播頻道`, { type: 'WATCHING' });
});

// 監聽所有訊息
client.on('messageCreate', async (message) => {
    try {
        // 統計處理的訊息數
        stats.messagesProcessed++;
        
        // 忽略自己的訊息
        if (message.author.bot && message.author.id === client.user.id) {
            return;
        }
        
        // 檢查是否為監聽的頻道
        const channelConfig = channelConfigs[message.channel.id];
        if (!channelConfig) {
            return;
        }
        
        console.log(`📨 收到 ${channelConfig.name} 頻道訊息: ${message.content.substring(0, 100)}...`);
        
        // 檢查訊息是否包含任何關鍵字
        const foundKeyword = channelConfig.keywords.find(keyword => 
            message.content.includes(keyword)
        );
        
        if (foundKeyword) {
            // 防重複機制 - 檢查是否為重複訊息
            const messageKey = `${message.channel.id}-${message.content}-${foundKeyword}`;
            const now = Date.now();
            
            if (recentMessages.has(messageKey)) {
                const lastProcessed = recentMessages.get(messageKey);
                if (now - lastProcessed < DUPLICATE_WINDOW) {
                    console.log(`⏭️  忽略重複訊息 (${Math.floor((now - lastProcessed) / 1000)}秒前已處理)`);
                    return;
                }
            }
            
            // 記錄此訊息處理時間
            recentMessages.set(messageKey, now);
            
            // 清理過期的記錄
            for (const [key, timestamp] of recentMessages.entries()) {
                if (now - timestamp > DUPLICATE_WINDOW) {
                    recentMessages.delete(key);
                }
            }
            
            const channelStat = stats.channelStats[message.channel.id];
            channelStat.liveDetected++;
            channelStat.lastLiveDetection = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
            
            console.log(`🔔 偵測到 ${channelConfig.name} 直播通知！關鍵字: "${foundKeyword}"`);
            console.log(`📄 完整訊息: ${message.content}`);
            
            // 提取 YouTube 連結 (選用)
            const youtubeMatch = message.content.match(/https:\/\/www\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)/);
            const youtubeUrl = youtubeMatch ? youtubeMatch[0] : '';
            
            if (youtubeUrl) {
                console.log(`🎬 YouTube 連結: ${youtubeUrl}`);
            }
            
            // 呼叫 PushCallMe API
            await callPushCallMe(channelConfig, message.content, youtubeUrl, message.channel.id);
        }
    } catch (error) {
        console.error('❌ 處理訊息時發生錯誤:', error.message);
    }
});

// PushCall API 呼叫函數
async function callPushCallMe(config, originalMessage, youtubeUrl = '', channelId) {
    try {
        console.log(`📞 準備為 ${config.name} 撥打電話通知...`);
        console.log(`📱 目標號碼: ${config.phone_number}`);
        console.log(`📞 來電顯示: ${config.from}`);
        
        // 加入短暫延遲避免 API 限制
        console.log('⏳ 等待 2 秒避免 API 限制...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // PushCall API 使用 GET 請求，參數放在 URL 中
        const apiUrl = new URL('https://pushcall.me/api/call');
        apiUrl.searchParams.append('api_key', config.api_key);
        apiUrl.searchParams.append('from', config.from);
        apiUrl.searchParams.append('to', config.phone_number.replace('+', '')); // 移除 + 號
        
        console.log(`🔗 API URL: ${apiUrl.toString().replace(config.api_key, '****')}`);
        
        // 發送 GET 請求
        const response = await axios.get(apiUrl.toString(), {
            headers: {
                'User-Agent': 'Multi-Channel-Discord-Live-Bot/1.0'
            },
            timeout: 30000 // 30秒超時
        });
        
        if (response.status === 200) {
            // 正確更新統計
            if (stats.channelStats[channelId]) {
                stats.channelStats[channelId].callsMade++;
            }
            stats.totalCallsMade++;
            
            console.log(`✅ ${config.name} 電話通知撥打成功！`);
            console.log('📊 API 回應:', JSON.stringify(response.data, null, 2));
            console.log(`📈 統計更新: ${config.name} 通話次數 +1, 總計: ${stats.totalCallsMade}`);
        } else {
            console.log(`⚠️  ${config.name} API 回應狀態異常:`, response.status);
            console.log('📋 回應內容:', response.data);
        }
        
    } catch (error) {
        console.error(`❌ ${config.name} PushCall API 呼叫失敗:`);
        console.error('🔍 錯誤訊息:', error.message);
        
        if (error.response) {
            console.error('📋 API 錯誤回應:', error.response.status);
            console.error('📄 錯誤詳情:', error.response.data);
            
            // 特殊處理 400 錯誤（太多請求）
            if (error.response.status === 400 && error.response.data?.message?.includes('Too many requests')) {
                console.log('⚠️  API 請求頻率限制，將在稍後重試...');
                // 可選：在這裡實作重試機制
            }
        } else if (error.request) {
            console.error('🌐 網路請求失敗，請檢查網路連線');
        }
    }
}

// Discord 客戶端錯誤處理
client.on('error', (error) => {
    console.error('❌ Discord 客戶端錯誤:', error.message);
});

client.on('warn', (warning) => {
    console.warn('⚠️  Discord 警告:', warning);
});

client.on('disconnect', () => {
    console.log('🔌 Discord 連線中斷，嘗試重新連線...');
});

client.on('reconnecting', () => {
    console.log('🔄 正在重新連線到 Discord...');
});

// 程序錯誤處理
process.on('unhandledRejection', (error) => {
    console.error('❌ 未處理的 Promise 錯誤:', error);
});

process.on('uncaughtException', (error) => {
    console.error('❌ 未捕獲的例外錯誤:', error);
    process.exit(1);
});

// 優雅關閉處理
process.on('SIGINT', () => {
    console.log('🛑 收到終止信號，正在安全關閉...');
    client.destroy();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('🛑 收到終止信號，正在安全關閉...');
    client.destroy();
    process.exit(0);
});

// 啟動 Discord Bot
console.log('🔐 正在登入 Discord...');
client.login(process.env.DISCORD_TOKEN).catch(error => {
    console.error('❌ Discord Bot 登入失敗:', error.message);
    console.error('🔑 請檢查 DISCORD_TOKEN 是否正確');
    process.exit(1);
});