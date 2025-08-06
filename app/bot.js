const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');

// Express 伺服器設定 (Koyeb 需要 HTTP 端點)
const app = express();
const PORT = process.env.PORT || 3000;

console.log('🚀 Discord Live Alert Bot 啟動中...');

// 檢查必要的環境變數
const requiredEnvVars = ['DISCORD_TOKEN', 'CHANNEL_ID', 'PUSHCALLME_API_KEY', 'PHONE_NUMBER'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.error('❌ 缺少必要的環境變數:', missingVars.join(', '));
    console.error('請在 Koyeb 部署設定中添加這些環境變數');
    process.exit(1);
}

// 設定參數 (從環境變數讀取)
const config = {
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    CHANNEL_ID: process.env.CHANNEL_ID,
    PUSHCALLME_CONFIG: {
        api_key: process.env.PUSHCALLME_API_KEY,
        phone_number: process.env.PHONE_NUMBER,
        message: '三枝明那開始直播了！快來看～',
        voice: 'female',
        language: 'zh-TW'
    }
};

console.log('⚙️  設定載入完成');
console.log(`📺 監聽頻道 ID: ${config.CHANNEL_ID}`);
console.log(`📞 通知號碼: ${config.PUSHCALLME_CONFIG.phone_number}`);

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
    liveDetected: 0,
    callsMade: 0,
    lastLiveDetection: null
};

// 健康檢查端點 (Koyeb 和 UptimeRobot 需要)
app.get('/', (req, res) => {
    const uptime = Math.floor((Date.now() - stats.startTime) / 1000);
    res.json({
        status: 'Discord Live Alert Bot 運行中 🤖',
        uptime: `${Math.floor(uptime / 3600)}小時 ${Math.floor((uptime % 3600) / 60)}分鐘`,
        bot_status: client.user ? `✅ ${client.user.tag}` : '❌ 未連線',
        connected_guilds: client.guilds.cache.size,
        monitoring_channel: config.CHANNEL_ID,
        stats: {
            訊息處理數: stats.messagesProcessed,
            直播偵測數: stats.liveDetected,
            通話撥打數: stats.callsMade,
            最後偵測時間: stats.lastLiveDetection || '尚未偵測到'
        },
        timestamp: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: client.user ? 'healthy' : 'unhealthy',
        bot: client.user?.tag || 'Not ready',
        guilds: client.guilds.cache.size,
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
    console.log(`🎯 正在監聽頻道: ${config.CHANNEL_ID}`);
    console.log(`🏠 已加入 ${client.guilds.cache.size} 個伺服器`);
    console.log('⏰ 開始 24/7 監聽直播通知...');
    
    // 設定 Bot 狀態
    client.user.setActivity('監聽直播通知中...', { type: 'WATCHING' });
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
        
        // 檢查是否為指定頻道
        if (message.channel.id !== config.CHANNEL_ID) {
            return;
        }
        
        console.log(`📨 收到頻道訊息: ${message.content.substring(0, 100)}...`);
        
        // 檢查訊息是否包含 "live over" (直播通知關鍵字)
        if (message.content.includes('live over')) {
            stats.liveDetected++;
            stats.lastLiveDetection = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
            
            console.log('🔔 偵測到直播通知！');
            console.log(`📄 完整訊息: ${message.content}`);
            
            // 提取 YouTube 連結 (選用)
            const youtubeMatch = message.content.match(/https:\/\/www\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)/);
            const youtubeUrl = youtubeMatch ? youtubeMatch[0] : '';
            
            if (youtubeUrl) {
                console.log(`🎬 YouTube 連結: ${youtubeUrl}`);
            }
            
            // 呼叫 PushCallMe API
            await callPushCallMe(message.content, youtubeUrl);
        }
    } catch (error) {
        console.error('❌ 處理訊息時發生錯誤:', error.message);
    }
});

// 修正版的 PushCall API 呼叫函數
async function callPushCallMe(originalMessage, youtubeUrl = '') {
    try {
        console.log('📞 準備撥打電話通知...');
        console.log(`📱 目標號碼: ${config.PUSHCALLME_CONFIG.phone_number}`);
        
        // PushCall API 使用 GET 請求，參數放在 URL 中
        const apiUrl = new URL('https://pushcall.me/api/call');
        apiUrl.searchParams.append('api_key', config.PUSHCALLME_CONFIG.api_key);
        apiUrl.searchParams.append('from', '1'); // Caller ID index (1-5)
        apiUrl.searchParams.append('to', config.PUSHCALLME_CONFIG.phone_number.replace('+', '')); // 移除 + 號
        
        console.log(`🔗 API URL: ${apiUrl.toString().replace(config.PUSHCALLME_CONFIG.api_key, '****')}`);
        
        // 發送 GET 請求
        const response = await axios.get(apiUrl.toString(), {
            headers: {
                'User-Agent': 'Discord-Live-Bot/1.0'
            },
            timeout: 30000 // 30秒超時
        });
        
        if (response.status === 200) {
            stats.callsMade++;
            console.log('✅ 電話通知撥打成功！');
            console.log('📊 API 回應:', JSON.stringify(response.data, null, 2));
        } else {
            console.log('⚠️  API 回應狀態異常:', response.status);
            console.log('📋 回應內容:', response.data);
        }
        
    } catch (error) {
        console.error('❌ PushCall API 呼叫失敗:');
        console.error('🔍 錯誤訊息:', error.message);
        
        if (error.response) {
            console.error('📋 API 錯誤回應:', error.response.status);
            console.error('📄 錯誤詳情:', error.response.data);
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
client.login(config.DISCORD_TOKEN).catch(error => {
    console.error('❌ Discord Bot 登入失敗:', error.message);
    console.error('🔑 請檢查 DISCORD_TOKEN 是否正確');
    process.exit(1);
});