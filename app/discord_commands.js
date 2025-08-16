class DiscordCommands {
    constructor(config, unifiedState, blogMonitorGetter, sendNotification) {
        this.config = config;
        this.unifiedState = unifiedState;
        this.getBlogMonitor = blogMonitorGetter; // 使用函數來動態獲取 blogMonitor
        this.sendNotification = sendNotification;
    }

    get blogMonitor() {
        return typeof this.getBlogMonitor === 'function' ? this.getBlogMonitor() : this.getBlogMonitor;
    }

    async handleCommand(message) {
        const cmd = message.content.toLowerCase();
        
        try {
            switch (cmd) {
                case '!status':
                    await this.handleStatusCommand(message);
                    break;
                    
                case '!blog-status':
                    await this.handleBlogStatusCommand(message);
                    break;
                    
                case '!blog-test':
                    await this.handleBlogTestCommand(message);
                    break;
                    
                case '!blog-check':
                    await this.handleBlogCheckCommand(message);
                    break;
                    
                case '!blog-restart':
                    await this.handleBlogRestartCommand(message);
                    break;
                    
                case '!channels':
                    await this.handleChannelsCommand(message);
                    break;
                    
                case '!help':
                    await this.handleHelpCommand(message);
                    break;
                    
                default:
                    // 未知命令，可以選擇忽略或回覆
                    break;
            }
        } catch (error) {
            console.error('❌ [Discord命令] 處理錯誤:', error.message);
            await message.reply('❌ 命令執行失敗，請稍後再試');
        }
    }

    async handleStatusCommand(message) {
        const runtime = Math.round((Date.now() - this.unifiedState.startTime) / 60000);
        const blogStatus = this.blogMonitor ? this.blogMonitor.getStatus() : { isMonitoring: false };
        
        const statusMsg = `📊 **系統狀態** \`${Math.floor(runtime / 60)}h ${runtime % 60}m\`

🤖 **Bot**: ${this.unifiedState.botReady ? '✅ 在線' : '❌ 離線'}
📝 **博客**: ${blogStatus.isMonitoring ? '✅ 運行中' : '❌ 停止'} (\`${blogStatus.totalChecks}\` 次檢查，\`${blogStatus.articlesFound}\` 篇新文章)
💬 **Discord**: \`${Object.keys(this.config.CHANNEL_CONFIGS).length}\` 個頻道，\`${this.unifiedState.discord.lastDetections.length}\` 次檢測
📞 **通知**: \`${this.unifiedState.notifications.phoneCallsMade}\` 次電話通知

🌐 Web面板查看詳情:https://tame-amalee-k-326-34061d70.koyeb.app/`;

        await message.reply(statusMsg);
    }

    async handleBlogStatusCommand(message) {
        if (this.blogMonitor) {
            const blogStatus = this.blogMonitor.getStatus();
            const latestRecord = this.blogMonitor.getLatestRecord();
            
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

    async handleBlogTestCommand(message) {
        if (this.blogMonitor) {
            await message.reply('🔍 執行博客API連接測試...');
            try {
                const testResult = await this.blogMonitor.testWebsiteAccess();
                
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

    async handleBlogCheckCommand(message) {
        if (this.blogMonitor) {
            await message.reply('🔍 執行手動博客檢查...');
            try {
                // 調用測試模式檢查
                const newArticle = await this.blogMonitor.checkForNewArticles(true);
                
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
📊 **當前記錄:** ${this.blogMonitor.getLatestRecord()?.articleCode || '無'}
🎯 **API狀態:** 正常運行`;

                    await message.reply(checkMsg);
                } else {
                    // 如果沒有返回文章，嘗試獲取狀態信息
                    const status = this.blogMonitor.getStatus();
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

    async handleBlogRestartCommand(message) {
        if (this.blogMonitor) {
            await message.reply('🔄 重新啟動博客監控...');
            try {
                this.blogMonitor.stopMonitoring();
                await new Promise(resolve => setTimeout(resolve, 2000)); // 等待2秒
                
                const success = await this.blogMonitor.reinitialize();
                if (success) {
                    this.blogMonitor.startMonitoring();
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

    async handleChannelsCommand(message) {
        if (Object.keys(this.config.CHANNEL_CONFIGS).length === 0) {
            await message.reply('⚠️ **未配置頻道監控**');
            return;
        }

        const channelsInfo = Object.entries(this.config.CHANNEL_CONFIGS).map(([channelId, channelConfig]) => {
            const stats = this.unifiedState.discord.channelStats[channelId];
            const phoneIcon = channelConfig.phone_number ? '📞' : '❌';
            return `${phoneIcon}**${channelConfig.name || '未命名'}** 
關鍵字: \`${channelConfig.keywords.join(' / ')}\`
統計: \`${stats.keywordsDetected}\` 次檢測，\`${stats.callsMade}\` 次通話`;
        }).join('\n\n');

        let recentPart = '';
        if (this.unifiedState.discord.lastDetections.length > 0) {
            const recent = this.unifiedState.discord.lastDetections.slice(-3).reverse()
                .map(d => `\`${d.關鍵字}\` 在 ${d.頻道}`)
                .join(', ');
            recentPart = `\n\n**最近檢測:** ${recent}`;
        }

        await message.reply(`📋 **頻道監控詳情**\n\n${channelsInfo}${recentPart}`);
    }

    async handleHelpCommand(message) {
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

🌐 **Web面板**: https://tame-amalee-k-326-34061d70.koyeb.app/`);
    }
}

module.exports = DiscordCommands;