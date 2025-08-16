const express = require('express');
const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const axios = require('axios');
const path = require('path');

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

// === Instagram 監控系統 ===
let instagramMonitor = null;

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
    startInstagramMonitoring();
    console.log(`✅ Discord Bot 已上線: ${client.user.tag}`);
    console.log(`📋 Discord頻道監控: ${Object.keys(config.CHANNEL_CONFIGS).length} 個頻道`);
    console.log(`🕐 當前日本時間: ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' })}`);
    
    // 發送啟動通知（修改版本）
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
        const instagramStatus = instagramMonitor ? instagramMonitor.getStatus() : { isMonitoring: false };
        
        const statusMsg = `📊 **系統狀態** \`${Math.floor(runtime / 60)}h ${runtime % 60}m\`

    🤖 **Bot**: ${unifiedState.botReady ? '✅ 在線' : '❌ 離線'}
    📝 **博客**: ${blogStatus.isMonitoring ? '✅ 運行中' : '❌ 停止'} (\`${blogStatus.totalChecks}\` 次檢查，\`${blogStatus.articlesFound}\` 篇新文章)
    📸 **Instagram**: ${instagramStatus.isMonitoring ? '✅ 運行中' : '❌ 停止'} (\`${instagramStatus.totalChecks}\` 次檢查，\`${instagramStatus.newPostsFound}\` 篇新貼文)
    💬 **Discord**: \`${Object.keys(config.CHANNEL_CONFIGS).length}\` 個頻道，\`${unifiedState.discord.lastDetections.length}\` 次檢測
    📞 **通知**: \`${unifiedState.notifications.phoneCallsMade}\` 次電話通知

    🌐 Web面板查看詳情: https://tame-amalee-k-326-34061d70.koyeb.app/`;

        await message.reply(statusMsg);
    }

    // Instagram監控命令
    else if (cmd === '!instagram-status') {
        if (instagramMonitor) {
            const instagramStatus = instagramMonitor.getStatus();
            
            const statusMsg = `📸 **Instagram監控狀態** (@${instagramStatus.username})

    **監控狀態:** ${instagramStatus.isMonitoring ? '✅ 運行中' : '❌ 已停止'}
    **目標用戶:** @${instagramStatus.username}
    **監控模式:** Mode 1 (貼文 + Bio + 頭像變更)
    **存儲策略:** ${instagramStatus.storageUsage}

    **檢查統計:**
    • 總檢查次數: ${instagramStatus.totalChecks}
    • 發現新貼文: ${instagramStatus.newPostsFound} 篇
    • Bio變更: ${instagramStatus.bioChanges} 次
    • 頭像變更: ${instagramStatus.profilePicChanges} 次
    • 最後檢查: ${instagramStatus.lastCheck || '尚未檢查'}
    • 下次檢查: ${instagramStatus.nextCheck || '未安排'}

    **監控設定:**
    • 檢查間隔: ${instagramStatus.checkInterval}
    • 日本時間: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}

    **用戶資訊:**
    • 帳戶類型: ${instagramStatus.isPrivate ? '🔒 私人帳戶' : '🌐 公開帳戶'}
    • 追蹤者數: ${instagramStatus.followerCount || 'N/A'}
    • 追蹤中數: ${instagramStatus.followingCount || 'N/A'}
    • 貼文數: ${instagramStatus.postCount || 'N/A'}

    💡 **監控邏輯:**
    • 每${instagramStatus.checkInterval}檢查新貼文、Bio變更、頭像變更
    • 自動下載媒體並發送到Discord
    • 發送後立即清理Koyeb臨時存儲
    • 遇到速率限制自動暫停並恢復`;

            await message.reply(statusMsg);
        } else {
            await message.reply('❌ Instagram監控未啟用');
        }
    }

    else if (cmd === '!instagram-test') {
        if (instagramMonitor) {
            await message.reply('🔍 執行Instagram連接測試...');
            try {
                const testResult = await instagramMonitor.testConnection();
                
                if (testResult.success) {
                    const testMsg = `✅ **Instagram連接測試成功**

    👤 **目標用戶:** @${testResult.username}
    🔒 **帳戶類型:** ${testResult.isPrivate ? '私人帳戶' : '公開帳戶'}
    👥 **追蹤者數:** ${testResult.followerCount || 'N/A'}
    📸 **貼文總數:** ${testResult.postCount || 'N/A'}
    📝 **最新貼文:** ${testResult.hasRecentPosts ? `✅ 找到 (ID: ${testResult.latestPostId})` : '❌ 無貼文'}

    📋 **Bio預覽:**
    ${testResult.bio}

    ✅ Instagram API連接正常！`;
                    
                    await message.reply(testMsg);
                } else {
                    await message.reply(`❌ **Instagram連接測試失敗**

    👤 **目標用戶:** @${testResult.username}
    ❌ **錯誤:** ${testResult.error}

    🔧 **故障排除建議:**
    • 檢查網絡連接
    • 確認用戶名是否正確
    • 確認帳戶是否為公開帳戶
    • 可能遇到Instagram速率限制，稍後再試`);
                }
            } catch (error) {
                await message.reply(`❌ 測試執行失敗: ${error.message}`);
            }
        } else {
            await message.reply('❌ Instagram監控未啟用');
        }
    }

    else if (cmd === '!instagram-restart') {
        if (instagramMonitor) {
            await message.reply('🔄 重新啟動Instagram監控...');
            try {
                instagramMonitor.stopMonitoring();
                await new Promise(resolve => setTimeout(resolve, 3000)); // 等待3秒
                
                instagramMonitor.startMonitoring();
                unifiedState.instagram.isMonitoring = true;
                
                await message.reply('✅ **Instagram監控重新啟動成功！**\n\n📊 已重設監控狀態\n⏰ 恢復定期檢查排程\n🧹 已清理臨時存儲');
            } catch (error) {
                await message.reply(`❌ 重新啟動失敗: ${error.message}`);
            }
        } else {
            await message.reply('❌ Instagram監控未啟用');
        }
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
            await message.reply('⚠️ **未配置頻道監控**');
            return;
        }

        const channelsInfo = Object.entries(config.CHANNEL_CONFIGS).map(([channelId, channelConfig]) => {
            const stats = unifiedState.discord.channelStats[channelId];
            const phoneIcon = channelConfig.phone_number ? '📞' : '❌';
            return `${phoneIcon}**${channelConfig.name || '未命名'}** 
    關鍵字: \`${channelConfig.keywords.join(' / ')}\`
    統計: \`${stats.keywordsDetected}\` 次檢測，\`${stats.callsMade}\` 次通話`;
        }).join('\n\n');

        let recentPart = '';
        if (unifiedState.discord.lastDetections.length > 0) {
            const recent = unifiedState.discord.lastDetections.slice(-3).reverse()
                .map(d => `\`${d.關鍵字}\` 在 ${d.頻道}`)
                .join(', ');
            recentPart = `\n\n**最近檢測:** ${recent}`;
        }

        await message.reply(`📋 **頻道監控詳情**\n\n${channelsInfo}${recentPart}`);
    }
    
    // 更新幫助命令
    else if (cmd === '!help') {
        await message.reply(`🤖 **Discord頻道監控 + 博客監控 + Instagram監控機器人**

    📸 **Instagram監控命令**
    \`!instagram-status\` - Instagram監控狀態
    \`!instagram-test\` - 測試Instagram連接  
    \`!instagram-restart\` - 重新啟動Instagram監控

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
    - Instagram貼文/Bio/頭像變更監控 (Mode 1)
    - 實時Web狀態面板
    - Koyeb臨時存儲 + 自動清理

    💡 **使用說明**
    機器人會自動監控配置的Discord頻道、博客和Instagram，檢測到變更時自動發送通知。媒體檔案會在發送後立即從Koyeb臨時存儲中清理。

    🌐 **Web面板**: https://tame-amalee-k-326-34061d70.koyeb.app/`);
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
            () => instagramMonitor, // Instagram監控函數
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
    
    if (instagramMonitor) {
        instagramMonitor.stopMonitoring();
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
    
    if (instagramMonitor) {
        instagramMonitor.stopMonitoring();
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