const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');

// Express 伺服器設定 (Koyeb 需要 HTTP 端點)
const app = express();
const PORT = process.env.PORT || 3000;

console.log('🚀 雙 API 多頻道 Discord Live Alert Bot 啟動中...');

// 檢查必要的環境變數
const requiredEnvVars = ['DISCORD_TOKEN', 'CHANNEL_CONFIGS'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.error('❌ 缺少必要的環境變數:', missingVars.join(', '));
    console.error('請在 Koyeb 部署設定中添加這些環境變數');
    process.exit(1);
}

// 解析頻道設定 JSON
let channelConfigs = {};
try {
    channelConfigs = JSON.parse(process.env.CHANNEL_CONFIGS);
    console.log('⚙️  頻道設定載入成功:', Object.keys(channelConfigs).length, '個頻道');
} catch (error) {
    console.error('❌ 頻道設定 JSON 格式錯誤:', error.message);
    console.error('請檢查 CHANNEL_CONFIGS 環境變數格式');
    process.exit(1);
}

// 基本設定
const config = {
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    CHANNEL_CONFIGS: channelConfigs
};

// 驗證頻道設定格式
for (const [channelId, channelConfig] of Object.entries(config.CHANNEL_CONFIGS)) {
    // 檢查必要欄位
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
    
    // 驗證API設定
    console.log(`🔑 頻道 ${channelId} 使用 API Key: ${channelConfig.api_key.substring(0, 8)}****`);
    console.log(`📱 頻道 ${channelId} 通知號碼: ${channelConfig.phone_number}`);
}

console.log('📋 監控設定摘要:');
for (const [channelId, channelConfig] of Object.entries(config.CHANNEL_CONFIGS)) {
    console.log(`   📺 頻道 ${channelId} (${channelConfig.name || '未命名'}):`);
    console.log(`      🔍 關鍵字: ${channelConfig.keywords.join(', ')}`);
    console.log(`      💬 通知訊息: ${channelConfig.message}`);
    console.log(`      🔑 API Key: ${channelConfig.api_key.substring(0, 8)}****`);
    console.log(`      📞 電話: ${channelConfig.phone_number}`);
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
    totalMessagesProcessed: 0,
    channelStats: {},
    lastDetections: [],
    apiUsage: {} // 追蹤每個API的使用情況
};

// 初始化頻道統計
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

// 健康檢查端點
app.get('/', (req, res) => {
    const uptime = Math.floor((Date.now() - stats.startTime) / 1000);
    const channelStatsFormatted = {};
    
    // 格式化頻道統計
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
    
    // 格式化API使用統計
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
    
    res.json({
        status: '雙 API 多頻道 Discord Live Alert Bot 運行中 🤖📞📞',
        uptime: `${Math.floor(uptime / 3600)}小時 ${Math.floor((uptime % 3600) / 60)}分鐘`,
        bot_status: client.user ? `✅ ${client.user.tag}` : '❌ 未連線',
        connected_guilds: client.guilds.cache.size,
        monitoring_channels: Object.keys(config.CHANNEL_CONFIGS).length,
        total_messages_processed: stats.totalMessagesProcessed,
        api_accounts: Object.keys(stats.apiUsage).length,
        channels: channelStatsFormatted,
        api_usage: apiUsageFormatted,
        recent_detections: stats.lastDetections.slice(-10), // 最近10次偵測
        timestamp: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: client.user ? 'healthy' : 'unhealthy',
        bot: client.user?.tag || 'Not ready',
        channels: Object.keys(config.CHANNEL_CONFIGS).length,
        apis: Object.keys(stats.apiUsage).length,
        uptime: Math.floor((Date.now() - stats.startTime) / 1000)
    });
});

// API 使用統計端點
app.get('/api-stats', (req, res) => {
    const apiStatsDetailed = {};
    for (const [apiKey, usage] of Object.entries(stats.apiUsage)) {
        apiStatsDetailed[apiKey + '****'] = {
            ...usage,
            phoneNumbers: Array.from(usage.phoneNumbers)
        };
    }
    res.json(apiStatsDetailed);
});

// 啟動 Express 伺服器
app.listen(PORT, () => {
    console.log(`🌐 HTTP 伺服器運行在 port ${PORT}`);
});

// Discord Bot 事件處理
client.once('ready', () => {
    console.log(`✅ Discord Bot 已上線: ${client.user.tag}`);
    console.log(`🏠 已加入 ${client.guilds.cache.size} 個伺服器`);
    console.log(`📺 正在監聽 ${Object.keys(config.CHANNEL_CONFIGS).length} 個頻道`);
    console.log(`🔑 使用 ${Object.keys(stats.apiUsage).length} 個 PushCall API 帳號`);
    console.log('⏰ 開始多頻道多API監聽...');
    
    // 設定 Bot 狀態
    client.user.setActivity(`監聽 ${Object.keys(config.CHANNEL_CONFIGS).length} 個頻道`, { type: 'WATCHING' });
});

// 監聽所有訊息
client.on('messageCreate', async (message) => {
    try {
        // 統計總處理的訊息數
        stats.totalMessagesProcessed++;
        
        // 忽略自己的訊息
        if (message.author.bot && message.author.id === client.user.id) {
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
            stats.channelStats[channelId].lastDetection = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
            
            // 記錄最近偵測
            const detection = {
                時間: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
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
            
            // 呼叫對應的 PushCall API
            await callPushCall(channelId, channelConfig, foundKeyword, message.content, youtubeUrl);
        }
    } catch (error) {
        console.error('❌ 處理訊息時發生錯誤:', error.message);
    }
});

// 呼叫 PushCall API 函數
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

        const callerIdIndex = channelConfig.from || 1; // 預設值為 1（如果沒設定）
        apiUrl.searchParams.append('from', callerIdIndex.toString());

        apiUrl.searchParams.append('to', channelConfig.phone_number.replace('+', '')); // 移除 + 號
        
        console.log(`🔗 [${channelConfig.name || channelId}] API URL: ${apiUrl.toString().replace(channelConfig.api_key, '****')}`);
        
        // 更新API使用統計
        stats.apiUsage[apiKeyShort].totalCalls++;
        stats.apiUsage[apiKeyShort].lastUsed = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
        
        // 發送 GET 請求
        const response = await axios.get(apiUrl.toString(), {
            headers: {
                'User-Agent': 'Discord-Live-Bot-DualAPI/1.0'
            },
            timeout: 30000 // 30秒超時
        });
        
        if (response.status === 200) {
            // 成功
            stats.channelStats[channelId].callsMade++;
            stats.channelStats[channelId].lastCallSuccess = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
            stats.apiUsage[apiKeyShort].successCalls++;
            
            console.log(`✅ [${channelConfig.name || channelId}] 電話通知撥打成功！`);
            console.log(`📊 API 回應:`, JSON.stringify(response.data, null, 2));
            console.log(`📈 API ${apiKeyShort}**** 使用統計: ${stats.apiUsage[apiKeyShort].successCalls}/${stats.apiUsage[apiKeyShort].totalCalls} 成功`);
        } else {
            // 異常狀態
            stats.apiUsage[apiKeyShort].failedCalls++;
            stats.channelStats[channelId].lastCallError = `狀態碼 ${response.status}: ${new Date().toLocaleString('zh-TW')}`;
            
            console.log(`⚠️  [${channelConfig.name || channelId}] API 回應狀態異常:`, response.status);
            console.log('📋 回應內容:', response.data);
        }
        
    } catch (error) {
        // 錯誤處理
        stats.apiUsage[apiKeyShort].failedCalls++;
        stats.channelStats[channelId].lastCallError = `${error.message}: ${new Date().toLocaleString('zh-TW')}`;
        
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