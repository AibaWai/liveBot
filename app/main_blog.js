const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');

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
    
})

    // 初始化Web狀態面板
    setTimeout(() => {
        console.log('🔄 [Web面板] 開始初始化狀態面板...');
        initializeWebStatusPanel();
    }, 3000);
;

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

            // 新增：發送自定義通知訊息到主通知頻道
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

// Discord命令處理
async function handleDiscordCommands(message) {
    const cmd = message.content.toLowerCase();
    
    if (cmd === '!status') {
        const runtime = Math.round((Date.now() - unifiedState.startTime) / 60000);
        const blogStatus = blogMonitor ? blogMonitor.getStatus() : { isMonitoring: false };
        const latestRecord = blogMonitor ? blogMonitor.getLatestRecord() : null;
        
        const statusMsg = `📊 **Discord頻道監控 + 博客監控系統狀態**

    🕐 **系統資訊** (日本時間)
    - 運行時間: \`${Math.floor(runtime / 60)}h ${runtime % 60}m\`
    - Bot狀態: ${unifiedState.botReady ? '✅ 在線' : '❌ 離線'}
    - 當前時間: \`${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' })}\`

    📝 **博客監控** (Family Club F2017)
    - 狀態: ${blogStatus.isMonitoring ? '✅ 運行中' : '❌ 停止'}
    - 檢查次數: \`${blogStatus.totalChecks}\`
    - 發現文章: \`${blogStatus.articlesFound}\`
    - 最新記錄: ${latestRecord ? `\`${latestRecord.datetime}\`` : '❌ 未建立'}

    💬 **Discord頻道監控**
    - 監控頻道: \`${Object.keys(config.CHANNEL_CONFIGS).length}\` 個
    - 處理訊息: \`${unifiedState.discord.totalMessagesProcessed}\`
    - 關鍵字檢測: \`${unifiedState.discord.lastDetections.length}\` 次

    📞 **通知統計**
    - Discord訊息: \`${unifiedState.notifications.discordMessages}\`
    - 電話通知: \`${unifiedState.notifications.phoneCallsMade}\`
    - 最後通知: ${unifiedState.notifications.lastNotification || '`無`'}

    🌐 **Web面板**: 訪問根網址查看詳細狀態`;

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

    else if (cmd === '!channels') {
        if (Object.keys(config.CHANNEL_CONFIGS).length === 0) {
            await message.reply('⚠️ **未配置任何Discord頻道監控**\n\n請設定 `CHANNEL_CONFIGS` 環境變數來配置頻道監控');
            return;
        }

        const channelsInfo = Object.entries(config.CHANNEL_CONFIGS).map(([channelId, channelConfig]) => {
            const stats = unifiedState.discord.channelStats[channelId];
            return `📺 **${channelConfig.name || '未命名頻道'}**
    - 頻道ID: \`${channelId}\`
    - 關鍵字: \`${channelConfig.keywords.join('`, `')}\`
    - 處理訊息: \`${stats.messagesProcessed}\`
    - 檢測次數: \`${stats.keywordsDetected}\`
    - 電話通知: \`${stats.callsMade}\` 次 ${channelConfig.phone_number ? '📞' : '❌'}
    - 最後檢測: ${stats.lastDetection || '`無`'}`;
        }).join('\n\n');

        const recentDetections = unifiedState.discord.lastDetections.slice(-5).map((detection, index) => 
            `${index + 1}. **${detection.頻道}** - \`${detection.關鍵字}\` (${detection.時間})`
        ).join('\n') || '無最近檢測';

        const statusMsg = `📋 **Discord頻道監控詳情**

    ${channelsInfo}

    📈 **最近5次檢測:**
    ${recentDetections}

    📊 **總統計:**
    - 處理訊息: \`${unifiedState.discord.totalMessagesProcessed}\`
    - 總檢測: \`${unifiedState.discord.lastDetections.length}\`
    - 電話通知: \`${unifiedState.notifications.phoneCallsMade}\``;

        await message.reply(statusMsg);
    }
    
    // 更新幫助命令
    else if (cmd === '!help') {
        await message.reply(`🤖 **Discord頻道監控 + 博客監控機器人**

    📝 **博客監控命令**
    \`!blog-status\` - 博客監控狀態
    \`!blog-test\` - 測試API連接  
    \`!blog-check\` - 手動檢查新文章
    \`!blog-restart\` - 重新啟動博客監控

    💬 **Discord監控命令**
    \`!channels\` - 查看頻道監控詳情
    \`!status\` - 完整系統狀態
    \`!help\` - 顯示此幫助

    🚀 **系統功能**
    - Discord頻道關鍵字監控 + 自動電話通知
    - Family Club博客新文章監控  
    - 實時Web狀態面板
    - 多API Key電話通知支援

    💡 **使用說明**
    機器人會自動監控配置的Discord頻道，檢測到關鍵字時自動發送通知和撥打電話。博客監控每小時自動檢查新文章。

    🌐 **Web面板**: 訪問機器人網址查看實時狀態`);
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