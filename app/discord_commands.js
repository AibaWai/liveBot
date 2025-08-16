// Discord命令處理模組
class DiscordCommandHandler {
    constructor(unifiedState, config, getBlogMonitor, getInstagramMonitor) {
        this.state = unifiedState;
        this.config = config;
        this.getBlogMonitor = getBlogMonitor;
        this.getInstagramMonitor = getInstagramMonitor;
    }

    async handleCommand(message) {
        const cmd = message.content.toLowerCase();
        
        try {
            if (cmd === '!status') {
                await this.handleStatusCommand(message);
            } else if (cmd === '!instagram-status') {
                await this.handleInstagramStatusCommand(message);
            } else if (cmd === '!instagram-test') {
                await this.handleInstagramTestCommand(message);
            } else if (cmd === '!instagram-restart') {
                await this.handleInstagramRestartCommand(message);
            } else if (cmd === '!blog-status') {
                await this.handleBlogStatusCommand(message);
            } else if (cmd === '!blog-test') {
                await this.handleBlogTestCommand(message);
            } else if (cmd === '!blog-check') {
                await this.handleBlogCheckCommand(message);
            } else if (cmd === '!blog-restart') {
                await this.handleBlogRestartCommand(message);
            } else if (cmd === '!channels') {
                await this.handleChannelsCommand(message);
            } else if (cmd === '!help') {
                await this.handleHelpCommand(message);
            }
        } catch (error) {
            console.error('❌ [Discord命令] 處理失敗:', error.message);
            await message.reply(`❌ 命令執行失敗: ${error.message}`);
        }
    }

    async handleStatusCommand(message) {
        const runtime = Math.round((Date.now() - this.state.startTime) / 60000);
        const blogMonitor = this.getBlogMonitor();
        const instagramMonitor = this.getInstagramMonitor();
        
        const blogStatus = blogMonitor ? blogMonitor.getStatus() : { isMonitoring: false };
        const instagramStatus = instagramMonitor ? instagramMonitor.getStatus() : { isMonitoring: false };
        
        const statusMsg = `📊 **系統狀態** \`${Math.floor(runtime / 60)}h ${runtime % 60}m\`

🤖 **Bot**: ${this.state.botReady ? '✅ 在線' : '❌ 離線'}
📝 **博客**: ${blogStatus.isMonitoring ? '✅ 運行中' : '❌ 停止'} (\`${blogStatus.totalChecks}\` 次檢查，\`${blogStatus.articlesFound}\` 篇新文章)
📸 **Instagram**: ${instagramStatus.isMonitoring ? '✅ 運行中' : '❌ 停止'} (\`${instagramStatus.totalChecks}\` 次檢查，\`${instagramStatus.newPostsFound}\` 篇新貼文)
💬 **Discord**: \`${Object.keys(this.config.CHANNEL_CONFIGS).length}\` 個頻道，\`${this.state.discord.lastDetections.length}\` 次檢測
📞 **通知**: \`${this.state.notifications.phoneCallsMade}\` 次電話通知

🌐 Web面板查看詳情: https://tame-amalee-k-326-34061d70.koyeb.app/`;

        await message.reply(statusMsg);
    }

    async handleInstagramStatusCommand(message) {
        const instagramMonitor = this.getInstagramMonitor();
        
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

    async handleInstagramTestCommand(message) {
        const instagramMonitor = this.getInstagramMonitor();
        
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

    async handleInstagramRestartCommand(message) {
        const instagramMonitor = this.getInstagramMonitor();
        
        if (instagramMonitor) {
            await message.reply('🔄 重新啟動Instagram監控...');
            try {
                instagramMonitor.stopMonitoring();
                await new Promise(resolve => setTimeout(resolve, 3000)); // 等待3秒
                
                instagramMonitor.startMonitoring();
                this.state.instagram.isMonitoring = true;
                
                await message.reply('✅ **Instagram監控重新啟動成功！**\n\n📊 已重設監控狀態\n⏰ 恢復定期檢查排程\n🧹 已清理臨時存儲');
            } catch (error) {
                await message.reply(`❌ 重新啟動失敗: ${error.message}`);
            }
        } else {
            await message.reply('❌ Instagram監控未啟用');
        }
    }

    async handleBlogStatusCommand(message) {
        const blogMonitor = this.getBlogMonitor();
        
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

    async handleBlogTestCommand(message) {
        const blogMonitor = this.getBlogMonitor();
        
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

    async handleBlogCheckCommand(message) {
        const blogMonitor = this.getBlogMonitor();
        
        if (blogMonitor) {
            await message.reply('🔍 執行手動博客檢查...');
            try {
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

    async handleBlogRestartCommand(message) {
        const blogMonitor = this.getBlogMonitor();
        
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

    async handleChannelsCommand(message) {
        if (Object.keys(this.config.CHANNEL_CONFIGS).length === 0) {
            await message.reply('⚠️ **未配置頻道監控**');
            return;
        }

        const channelsInfo = Object.entries(this.config.CHANNEL_CONFIGS).map(([channelId, channelConfig]) => {
            const stats = this.state.discord.channelStats[channelId];
            const phoneIcon = channelConfig.phone_number ? '📞' : '❌';
            return `${phoneIcon}**${channelConfig.name || '未命名'}** 
關鍵字: \`${channelConfig.keywords.join(' / ')}\`
統計: \`${stats.keywordsDetected}\` 次檢測，\`${stats.callsMade}\` 次通話`;
        }).join('\n\n');

        let recentPart = '';
        if (this.state.discord.lastDetections.length > 0) {
            const recent = this.state.discord.lastDetections.slice(-3).reverse()
                .map(d => `\`${d.關鍵字}\` 在 ${d.頻道}`)
                .join(', ');
            recentPart = `\n\n**最近檢測:** ${recent}`;
        }

        await message.reply(`📋 **頻道監控詳情**\n\n${channelsInfo}${recentPart}`);
    }

    async handleHelpCommand(message) {
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

module.exports = DiscordCommandHandler;