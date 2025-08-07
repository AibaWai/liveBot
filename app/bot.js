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
    if (!channelConfig.from) {
        console.error(`❌ 頻道 ${channelId} 缺少 from 設定`);
        process.exit(1);
    }
    
    // 驗證API設定
    console.log(`🔑 頻道 ${channelId} 使用 API Key: ${channelConfig.api_key.substring(0, 8)}****`);
    console.log(`📱 頻道 ${channelId} 通知號碼: ${channelConfig.phone_number}`);
    console.log(`📞 頻道 ${channelId} 來電顯示: ${channelConfig.from}`);
}

console.log('📋 監控設定摘要:');
for (const [channelId, channelConfig] of Object.entries(config.CHANNEL_CONFIGS)) {
    console.log(`   📺 頻道 ${channelId} (${channelConfig.name || '未命名'}):`);
    console.log(`      🔍 關鍵字: ${channelConfig.keywords.join(', ')}`);
    console.log(`      💬 通知訊息: ${channelConfig.message}`);
    console.log(`      🔑 API Key: ${channelConfig.api_key.substring(0, 8)}****`);
    console.log(`      📞 電話: ${channelConfig.phone_number}`);
    console.log(`      📞 來電顯示: ${channelConfig.from}`);
}

// 建立 Discord 客戶端
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// 統計資訊和防重複機制
let stats = {
    startTime: Date.now(),
    totalMessagesProcessed: 0,
    channelStats: {},
    lastDetections: [],
    apiUsage: {} // 追蹤每個API的使用情況
};

// 防重複通話機制 - 使用 Map 來更好地管理
const callCooldowns = new Map();
const COOLDOWN_DURATION = 30000; // 30秒防重複時間

// 處理中的訊息 Set，防止並發處理同一訊息
const processingMessages = new Set();

// 初始化頻道統計
for (const [channelId, channelConfig] of Object.entries(config.CHANNEL_CONFIGS)) {
    stats.channelStats[channelId] = {
        messagesProcessed: 0,
        keywordsDetected: 0,
        callsMade: 0,
        callsSkipped: 0, // 新增跳過的通話統計
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
                通知號碼: channelConfig.phone_number,
                來電顯示: channelConfig.from
            },
            統計: {
                訊息處理數: channelStat.messagesProcessed,
                關鍵字偵測數: channelStat.keywordsDetected,
                通話撥打數: channelStat.callsMade,
                跳過通話數: channelStat.callsSkipped, // 顯示跳過的通話
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
    
    // 顯示當前冷卻中的通話
    const activeCooldowns = {};
    const now = Date.now();
    for (const [key, timestamp] of callCooldowns.entries()) {
        const remaining = Math.ceil((timestamp + COOLDOWN_DURATION - now) / 1000);
        if (remaining > 0) {
            activeCooldowns[key] = `${remaining}秒`;
        }
    }
    
    res.json({
        status: '雙 API 多頻道 Discord Live Alert Bot 運行中 🤖📞📞',
        uptime: `${Math.floor(uptime / 3600)}小時 ${Math.floor((uptime % 3600) / 60)}分鐘`,
        bot_status: client.user ? `✅ ${client.user.tag}` : '❌ 未連線',
        connected_guilds: client.guilds.cache.size,
        monitoring_channels: Object.keys(config.CHANNEL_CONFIGS).length,
        total_messages_processed: stats.totalMessagesProcessed,
        api_accounts: Object.keys(stats.apiUsage).length,
        cooldown_duration: `${COOLDOWN_DURATION / 1000}秒`,
        active_cooldowns: activeCooldowns,
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

// 通話歷史查詢端點
app.get('/call-history', (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    const calls = Array.from(callHistory.entries())
        .slice(-limit)
        .map(([id, record]) => ({
            通話序號: id,
            ...record
        }))
        .reverse(); // 最新的在前面
    
    res.json({
        總通話記錄數: callHistory.size,
        顯示數量: calls.length,
        通話記錄: calls,
        說明: '如果看到重複的成功記錄但只有一次API請求，可能是電信商或VoIP服務的重撥機制'
    });
});

// 診斷端點 - 專門用於排查重複通話問題
app.get('/diagnose', (req, res) => {
    const now = Date.now();
    const recentCalls = Array.from(callHistory.entries())
        .slice(-10)
        .map(([id, record]) => ({
            序號: id,
            狀態: record.狀態,
            時間: record.時間,
            API: record.API,
            目標: record.目標號碼,
            回應: record.API回應 || record.錯誤訊息 || 'N/A'
        }));
    
    const activeCooldownsDetailed = {};
    for (const [key, timestamp] of callCooldowns.entries()) {
        const remaining = Math.ceil((timestamp + COOLDOWN_DURATION - now) / 1000);
        if (remaining > 0) {
            activeCooldownsDetailed[key] = {
                剩餘秒數: remaining,
                設定時間: new Date(timestamp).toLocaleString('zh-TW'),
                可用時間: new Date(timestamp + COOLDOWN_DURATION).toLocaleString('zh-TW')
            };
        }
    }
    
    res.json({
        診斷時間: new Date().toLocaleString('zh-TW'),
        系統狀態: {
            Bot狀態: client.user ? `✅ ${client.user.tag}` : '❌ 未連線',
            監聽頻道數: Object.keys(config.CHANNEL_CONFIGS).length,
            冷卻持續時間: `${COOLDOWN_DURATION / 1000}秒`,
            活躍冷卻數: Object.keys(activeCooldownsDetailed).length
        },
        最近通話: recentCalls,
        活躍冷卻: activeCooldownsDetailed,
        建議: [
            '如果PushCall後台只顯示1次撥號但收到2次電話，這通常是：',
            '1. 電信商的自動重撥機制（網路不穩定時）',
            '2. VoIP服務商的重試邏輯',
            '3. 手機雙卡或VoLTE設定問題',
            '建議檢查PushCall後台的詳細通話記錄和狀態'
        ]
    });
});

// 清理過期的冷卻記錄
function cleanupCooldowns() {
    const now = Date.now();
    for (const [key, timestamp] of callCooldowns.entries()) {
        if (now - timestamp > COOLDOWN_DURATION) {
            callCooldowns.delete(key);
        }
    }
}

// 每分鐘清理一次過期記錄
setInterval(cleanupCooldowns, 60000);

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
    console.log(`⏰ 防重複通話時間: ${COOLDOWN_DURATION / 1000}秒`);
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
        
        // 防止並發處理同一訊息
        const messageKey = `${channelId}-${message.id}`;
        if (processingMessages.has(messageKey)) {
            console.log(`🔄 訊息 ${messageKey} 正在處理中，跳過重複處理`);
            return;
        }
        processingMessages.add(messageKey);
        
        // 5秒後清理處理記錄
        setTimeout(() => {
            processingMessages.delete(messageKey);
        }, 5000);
        
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
                通知號碼: channelConfig.phone_number,
                來電顯示: channelConfig.from
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
            console.log(`📞 來電顯示: ${channelConfig.from}`);
            
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

// 全局通話記錄 - 追蹤所有API請求
const callHistory = new Map();
let callSequenceNumber = 0;

// 呼叫 PushCall API 函數
async function callPushCall(channelId, channelConfig, keyword, originalMessage, youtubeUrl = '') {
    const apiKeyShort = channelConfig.api_key.substring(0, 8);
    const callId = ++callSequenceNumber;
    const timestamp = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
    
    try {
        // 生成唯一的冷卻Key：頻道ID + API Key + 來電號碼 + 目標號碼
        const cooldownKey = `${channelId}-${channelConfig.api_key}-${channelConfig.from}-${channelConfig.phone_number}`;
        const now = Date.now();
        
        console.log(`🆔 [通話序號 ${callId}] 開始處理通話請求`);
        console.log(`📝 [通話序號 ${callId}] 冷卻Key: ${cooldownKey.replace(channelConfig.api_key, '****')}`);
        
        // 檢查是否在冷卻時間內
        if (callCooldowns.has(cooldownKey)) {
            const lastCallTime = callCooldowns.get(cooldownKey);
            const timeSinceLastCall = now - lastCallTime;
            
            if (timeSinceLastCall < COOLDOWN_DURATION) {
                const remainingTime = Math.ceil((COOLDOWN_DURATION - timeSinceLastCall) / 1000);
                console.log(`⛔ [通話序號 ${callId}] 冷卻中，還需等待 ${remainingTime} 秒`);
                console.log(`🔑 [通話序號 ${callId}] API: ${apiKeyShort}**** | 📞 ${channelConfig.from} → ${channelConfig.phone_number}`);
                
                // 記錄被跳過的通話
                callHistory.set(callId, {
                    狀態: '⛔ 冷卻跳過',
                    時間: timestamp,
                    頻道: channelConfig.name || channelId,
                    API: apiKeyShort + '****',
                    來電號碼: channelConfig.from,
                    目標號碼: channelConfig.phone_number,
                    冷卻剩餘: `${remainingTime}秒`,
                    關鍵字: keyword
                });
                
                // 更新跳過統計
                stats.channelStats[channelId].callsSkipped++;
                return;
            }
        }
        
        // 記錄這次通話時間
        callCooldowns.set(cooldownKey, now);
        
        console.log(`📞 [通話序號 ${callId}] 準備撥打電話通知...`);
        console.log(`🔑 [通話序號 ${callId}] 使用 API Key: ${apiKeyShort}****`);
        console.log(`📱 [通話序號 ${callId}] 目標號碼: ${channelConfig.phone_number}`);
        console.log(`📱 [通話序號 ${callId}] 來電顯示: ${channelConfig.from}`);
        console.log(`💬 [通話序號 ${callId}] 通知內容: ${channelConfig.message}`);
        console.log(`🔍 [通話序號 ${callId}] 觸發關鍵字: ${keyword}`);
        
        // 記錄準備發送的通話
        callHistory.set(callId, {
            狀態: '📤 準備發送',
            時間: timestamp,
            頻道: channelConfig.name || channelId,
            API: apiKeyShort + '****',
            來電號碼: channelConfig.from,
            目標號碼: channelConfig.phone_number,
            關鍵字: keyword,
            訊息內容: originalMessage.substring(0, 100)
        });
        
        // PushCall API 使用 GET 請求
        const apiUrl = new URL('https://pushcall.me/api/call');
        apiUrl.searchParams.append('api_key', channelConfig.api_key);
        apiUrl.searchParams.append('from', channelConfig.from.replace('+', '')); // Caller ID
        apiUrl.searchParams.append('to', channelConfig.phone_number.replace('+', '')); // 移除 + 號
        
        console.log(`🔗 [通話序號 ${callId}] API URL: ${apiUrl.toString().replace(channelConfig.api_key, '****')}`);
        console.log(`⏰ [通話序號 ${callId}] 請求發送時間: ${new Date().toISOString()}`);
        
        // 更新準備發送狀態
        const currentRecord = callHistory.get(callId);
        callHistory.set(callId, {
            ...currentRecord,
            狀態: '🚀 API請求中',
            API請求時間: new Date().toISOString()
        });
        
        // 更新API使用統計
        stats.apiUsage[apiKeyShort].totalCalls++;
        stats.apiUsage[apiKeyShort].lastUsed = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
        
        // 發送 GET 請求
        const requestStartTime = Date.now();
        const response = await axios.get(apiUrl.toString(), {
            headers: {
                'User-Agent': 'Discord-Live-Bot-DualAPI/1.0',
                'X-Request-ID': `call-${callId}` // 添加請求ID幫助追蹤
            },
            timeout: 30000 // 30秒超時
        });
        const requestDuration = Date.now() - requestStartTime;
        
        console.log(`📡 [通話序號 ${callId}] API 請求完成，耗時: ${requestDuration}ms`);
        
        if (response.status === 200) {
            // 成功
            stats.channelStats[channelId].callsMade++;
            stats.channelStats[channelId].lastCallSuccess = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
            stats.apiUsage[apiKeyShort].successCalls++;
            
            // 更新成功狀態
            const successRecord = callHistory.get(callId);
            callHistory.set(callId, {
                ...successRecord,
                狀態: '✅ 成功',
                API回應時間: new Date().toISOString(),
                請求耗時: `${requestDuration}ms`,
                API回應: response.data,
                HTTP狀態: response.status
            });
            
            console.log(`✅ [通話序號 ${callId}] 電話通知撥打成功！`);
            console.log(`📊 [通話序號 ${callId}] API 回應:`, JSON.stringify(response.data, null, 2));
            console.log(`📈 [通話序號 ${callId}] API ${apiKeyShort}**** 使用統計: ${stats.apiUsage[apiKeyShort].successCalls}/${stats.apiUsage[apiKeyShort].totalCalls} 成功`);
            console.log(`⏰ [通話序號 ${callId}] 該組合下次可用時間: ${new Date(now + COOLDOWN_DURATION).toLocaleString('zh-TW')}`);
            
            // 特殊檢查：如果API說成功但沒有返回通話ID，記錄警告
            if (response.data && !response.data.call_id && !response.data.id) {
                console.log(`⚠️  [通話序號 ${callId}] 警告：API回應成功但未包含通話ID，可能導致重複撥號`);
            }
            
        } else {
            // 異常狀態 - 但不算作失敗，移除冷卻記錄讓它可以重試
            callCooldowns.delete(cooldownKey);
            stats.apiUsage[apiKeyShort].failedCalls++;
            stats.channelStats[channelId].lastCallError = `狀態碼 ${response.status}: ${new Date().toLocaleString('zh-TW')}`;
            
            // 更新失敗狀態
            const failRecord = callHistory.get(callId);
            callHistory.set(callId, {
                ...failRecord,
                狀態: `⚠️ HTTP ${response.status}`,
                API回應時間: new Date().toISOString(),
                請求耗時: `${requestDuration}ms`,
                錯誤回應: response.data,
                HTTP狀態: response.status
            });
            
            console.log(`⚠️  [通話序號 ${callId}] API 回應狀態異常:`, response.status);
            console.log(`📋 [通話序號 ${callId}] 回應內容:`, response.data);
        }
        
    } catch (error) {
        // 錯誤處理 - 移除冷卻記錄讓它可以重試
        const cooldownKey = `${channelId}-${channelConfig.api_key}-${channelConfig.from}-${channelConfig.phone_number}`;
        callCooldowns.delete(cooldownKey);
        
        stats.apiUsage[apiKeyShort].failedCalls++;
        stats.channelStats[channelId].lastCallError = `${error.message}: ${new Date().toLocaleString('zh-TW')}`;
        
        // 更新錯誤狀態
        const errorRecord = callHistory.get(callId) || {
            時間: timestamp,
            頻道: channelConfig.name || channelId,
            API: apiKeyShort + '****',
            來電號碼: channelConfig.from,
            目標號碼: channelConfig.phone_number,
            關鍵字: keyword
        };
        callHistory.set(callId, {
            ...errorRecord,
            狀態: `❌ ${error.code || '錯誤'}`,
            錯誤時間: new Date().toISOString(),
            錯誤訊息: error.message,
            錯誤類型: error.name
        });
        
        console.error(`❌ [通話序號 ${callId}] PushCall API 呼叫失敗:`);
        console.error(`🔑 [通話序號 ${callId}] API Key: ${apiKeyShort}****`);
        console.error(`🔍 [通話序號 ${callId}] 錯誤訊息:`, error.message);
        
        if (error.response) {
            console.error(`📋 [通話序號 ${callId}] API 錯誤回應:`, error.response.status);
            console.error(`📄 [通話序號 ${callId}] 錯誤詳情:`, error.response.data);
        } else if (error.request) {
            console.error(`🌐 [通話序號 ${callId}] 網路請求失敗，請檢查網路連線`);
        }
    }
    
    // 限制通話歷史記錄數量
    if (callHistory.size > 100) {
        const oldestKey = callHistory.keys().next().value;
        callHistory.delete(oldestKey);
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