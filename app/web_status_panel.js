const express = require('express');

class WebStatusPanel {
    constructor(app, unifiedState, config, client, getInstagramMonitorFn = null, getBlogMonitorFn = null) {
        this.app = app;
        this.unifiedState = unifiedState;
        this.config = config;
        this.client = client;
        this.getBlogMonitor = getBlogMonitorFn;
        
        this.setupRoutes();
    }
    
    // 獲取日本時間字符串
    getJapanTimeString() {
        return new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    }
    
    // 獲取日本時間的小時
    getJapanHour() {
        return new Date().toLocaleString('ja-JP', { 
            timeZone: 'Asia/Tokyo',
            hour: '2-digit',
            hour12: false
        }).split(':')[0];
    }

    getBlogStatus() {
        try {
            if (this.getBlogMonitor && typeof this.getBlogMonitor === 'function') {
                const blogMonitor = this.getBlogMonitor();
                if (blogMonitor && typeof blogMonitor.getStatus === 'function') {
                    return blogMonitor.getStatus();
                }
            }
        } catch (error) {
            console.error('❌ [Web面板] 獲取博客狀態失敗:', error.message);
        }
        
        // 返回默認狀態
        return {
            isMonitoring: false,
            totalChecks: 0,
            articlesFound: 0,
            lastCheckTime: null,
            nextCheckTime: null,
            method: 'Family Club Official API',
            endpoint: 'https://web.familyclub.jp/s/jwb/api/list/diarkiji_list',
            artistCode: 'F2017',
            artistName: '高木雄也',
            blogUrl: 'https://web.familyclub.jp/s/jwb/diary/F2017',
            activeTimeSchedule: '日本時間12:00-24:00 (每小時00分檢查)',
            currentActiveTime: false,
            japanTime: this.getJapanTimeString(),
            latestRecord: { hasRecord: false }
        };
    }
    
    setupRoutes() {
        // 中間件設定
        this.app.use(express.json());
        
        // 主狀態頁面
        this.app.get('/', (req, res) => {
            try {
                const html = this.generateStatusHTML();
                res.send(html);
            } catch (error) {
                console.error('❌ [Web面板] 生成狀態頁面失敗:', error.message);
                res.status(500).send(`
                    <h1>監控系統載入中...</h1>
                    <p>系統正在初始化，請稍後刷新頁面</p>
                    <p>當前日本時間: ${this.getJapanTimeString()}</p>
                    <script>setTimeout(() => location.reload(), 5000);</script>
                `);
            }
        });
        
        // API 端點
        this.app.get('/api/status', (req, res) => {
            try {
                const status = this.getSystemStatus();
                res.json(status);
            } catch (error) {
                console.error('❌ [Web面板] 獲取系統狀態失敗:', error.message);
                res.status(500).json({ error: 'System not ready', message: error.message });
            }
        });
        
        // 健康檢查
        this.app.get('/health', (req, res) => {
            try {
                res.json(this.getHealthStatus());
            } catch (error) {
                console.error('❌ [Web面板] 健康檢查失敗:', error.message);
                res.status(200).json({ status: 'initializing' });
            }
        });
        
        // Discord統計端點
        this.app.get('/api/discord-stats', (req, res) => {
            try {
                const stats = {
                    totalMessages: this.unifiedState.discord.totalMessagesProcessed,
                    totalDetections: this.unifiedState.discord.lastDetections.length,
                    channelStats: this.unifiedState.discord.channelStats,
                    recentDetections: this.unifiedState.discord.lastDetections.slice(-20),
                    apiUsage: {}
                };
                
                // 轉換API使用統計
                for (const [apiKey, usage] of Object.entries(this.unifiedState.discord.apiUsage)) {
                    stats.apiUsage[apiKey + '****'] = {
                        ...usage,
                        phoneNumbers: Array.from(usage.phoneNumbers)
                    };
                }
                
                res.json(stats);
            } catch (error) {
                console.error('❌ [Web面板] 獲取Discord統計失敗:', error.message);
                res.status(500).json({ error: 'Discord stats not available' });
            }
        });

        // 博客狀態端點
        this.app.get('/api/blog-status', (req, res) => {
            try {
                const blogStatus = this.getBlogStatus();
                res.json(blogStatus);
            } catch (error) {
                console.error('❌ [Web面板] 獲取博客狀態失敗:', error.message);
                res.status(500).json({ error: 'Blog status not available' });
            }
        });
    }
    
    generateStatusHTML() {
        const uptime = Math.floor((Date.now() - this.unifiedState.startTime) / 1000);
        const blogStatus = this.getBlogStatus();
        
        return `
    <!DOCTYPE html>
    <html lang="zh-TW">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Discord頻道監控 + 博客監控機器人</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background: linear-gradient(135deg, #1a1a2e, #16213e);
                color: #e0e0e0;
                min-height: 100vh;
                padding: 20px;
            }
            .container { max-width: 1200px; margin: 0 auto; }
            .header {
                text-align: center;
                padding: 30px 0;
                border-bottom: 2px solid #333;
                margin-bottom: 30px;
            }
            .header h1 {
                font-size: 2.5em;
                background: linear-gradient(45deg, #4CAF50, #2196F3);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                margin-bottom: 10px;
            }
            .header p { color: #888; font-size: 1.1em; }
            
            .main-status {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
                gap: 20px;
                margin-bottom: 30px;
            }
            .status-card {
                background: rgba(42, 42, 42, 0.8);
                border-radius: 15px;
                padding: 25px;
                border-left: 5px solid #4CAF50;
                backdrop-filter: blur(10px);
                transition: transform 0.3s ease;
            }
            .status-card:hover { transform: translateY(-5px); }
            .status-card.warning { border-left-color: #ff9800; }
            .status-card.error { border-left-color: #f44336; }
            .status-card.discord { border-left-color: #5865F2; }
            .status-card.blog { border-left-color: #00BCD4; }
            
            .card-title {
                font-size: 1.3em;
                font-weight: bold;
                margin-bottom: 15px;
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .status-item {
                display: flex;
                justify-content: space-between;
                margin-bottom: 10px;
                padding: 8px 0;
                border-bottom: 1px solid rgba(255,255,255,0.1);
            }
            .status-value {
                font-weight: bold;
                color: #4CAF50;
            }
            
            .section {
                background: rgba(42, 42, 42, 0.6);
                border-radius: 15px;
                padding: 25px;
                margin-bottom: 20px;
                backdrop-filter: blur(10px);
            }
            .section-title {
                font-size: 1.5em;
                font-weight: bold;
                margin-bottom: 20px;
                color: #4CAF50;
            }
            
            .stats-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 15px;
                margin-bottom: 20px;
            }
            .stat-box {
                background: rgba(26, 26, 46, 0.8);
                padding: 15px;
                border-radius: 10px;
                text-align: center;
            }
            .stat-box.warning { border: 2px solid #ff9800; }
            .stat-box.success { border: 2px solid #4CAF50; }
            .stat-number {
                font-size: 2em;
                font-weight: bold;
                color: #2196F3;
            }
            .stat-label { color: #888; font-size: 0.9em; }
            
            .channel-list {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                gap: 15px;
                margin-top: 20px;
            }
            
            .channel-item {
                background: rgba(26, 26, 46, 0.8);
                border-radius: 10px;
                padding: 15px;
                border-left: 3px solid #5865F2;
            }
            
            .channel-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 10px;
            }
            
            .channel-name {
                font-weight: bold;
                color: #5865F2;
            }
            
            .channel-stats {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 10px;
                font-size: 0.9em;
            }
            
            .recent-detections {
                background: rgba(26, 26, 46, 0.8);
                border-radius: 10px;
                padding: 20px;
                margin-top: 20px;
                max-height: 400px;
                overflow-y: auto;
            }
            
            .detection-item {
                background: rgba(0, 0, 0, 0.3);
                border-radius: 8px;
                padding: 10px;
                margin-bottom: 10px;
                border-left: 3px solid #4CAF50;
            }
            
            .detection-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 5px;
            }
            
            .detection-keyword {
                background: #4CAF50;
                color: white;
                padding: 2px 8px;
                border-radius: 12px;
                font-size: 0.8em;
                font-weight: bold;
            }
            
            .detection-time {
                color: #888;
                font-size: 0.8em;
            }
            
            .detection-message {
                color: #ccc;
                font-size: 0.9em;
                line-height: 1.4;
            }
            
            .blog-detail-card {
                background: rgba(26, 26, 46, 0.8);
                border-radius: 10px;
                padding: 20px;
                border-left: 3px solid #00BCD4;
                margin-top: 15px;
            }

            .blog-detail-card h4 {
                color: #00BCD4;
                margin-bottom: 15px;
                font-size: 1.2em;
            }

            .detail-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                gap: 10px;
            }

            .detail-item {
                display: flex;
                justify-content: space-between;
                padding: 8px 0;
                border-bottom: 1px solid rgba(255,255,255,0.1);
                font-size: 0.9em;
            }
            
            .refresh-note {
                text-align: center;
                color: #666;
                margin-top: 30px;
                font-size: 0.9em;
            }
            
            .commands {
                background: rgba(26, 26, 46, 0.8);
                border-radius: 10px;
                padding: 20px;
                margin-top: 20px;
            }
            .command {
                background: rgba(0, 0, 0, 0.5);
                padding: 10px 15px;
                border-radius: 8px;
                margin: 8px 0;
                font-family: 'Courier New', monospace;
                font-size: 0.9em;
            }

            .api-usage {
                background: rgba(26, 26, 46, 0.8);
                border-radius: 10px;
                padding: 20px;
                margin-top: 20px;
            }

            .api-item {
                background: rgba(0, 0, 0, 0.3);
                border-radius: 8px;
                padding: 15px;
                margin-bottom: 15px;
                border-left: 3px solid #FF9800;
            }

            .api-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 10px;
            }

            .api-key {
                font-family: 'Courier New', monospace;
                color: #FF9800;
                font-weight: bold;
            }

            .api-stats {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
                gap: 10px;
                font-size: 0.9em;
            }
        </style>
        <script>
            // Auto refresh every 30 seconds
            setTimeout(() => location.reload(), 30000);
        </script>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🤖 Discord頻道監控 + 博客監控機器人</h1>
                <p>Discord頻道關鍵字監控 + Family Club博客監控 + 電話通知</p>
            </div>

            <div class="main-status">
                <div class="status-card ${this.unifiedState.botReady ? '' : 'error'}">
                    <div class="card-title">🤖 Bot狀態</div>
                    <div class="status-item">
                        <span>連線狀態:</span>
                        <span class="status-value">${this.unifiedState.botReady ? '✅ 在線' : '❌ 離線'}</span>
                    </div>
                    <div class="status-item">
                        <span>運行時間:</span>
                        <span class="status-value">${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m</span>
                    </div>
                    <div class="status-item">
                        <span>伺服器數:</span>
                        <span class="status-value">${this.client.guilds?.cache.size || 0}</span>
                    </div>
                    <div class="status-item">
                        <span>日本時間:</span>
                        <span class="status-value">${this.getJapanTimeString()}</span>
                    </div>
                </div>

                <div class="status-card discord ${Object.keys(this.config.CHANNEL_CONFIGS).length > 0 ? '' : 'warning'}">
                    <div class="card-title">💬 Discord頻道監控</div>
                    <div class="status-item">
                        <span>監控頻道:</span>
                        <span class="status-value">${Object.keys(this.config.CHANNEL_CONFIGS).length} 個</span>
                    </div>
                    <div class="status-item">
                        <span>處理訊息:</span>
                        <span class="status-value">${this.unifiedState.discord.totalMessagesProcessed}</span>
                    </div>
                    <div class="status-item">
                        <span>關鍵字檢測:</span>
                        <span class="status-value">${this.unifiedState.discord.lastDetections.length} 次</span>
                    </div>
                    <div class="status-item">
                        <span>電話通知:</span>
                        <span class="status-value">${this.unifiedState.notifications.phoneCallsMade} 次</span>
                    </div>
                </div>

                ${this.config.BLOG_NOTIFICATION_CHANNEL_ID ? `
                <div class="status-card blog ${blogStatus.isMonitoring ? '' : 'warning'}">
                    <div class="card-title">📝 Family Club博客</div>
                    <div class="status-item">
                        <span>藝人:</span>
                        <span class="status-value">${blogStatus.artistName || '高木雄也'}</span>
                    </div>
                    <div class="status-item">
                        <span>監控狀態:</span>
                        <span class="status-value">${blogStatus.isMonitoring ? '✅ 運行中' : '❌ 已停止'}</span>
                    </div>
                    <div class="status-item">
                        <span>檢查次數:</span>
                        <span class="status-value">${blogStatus.totalChecks}</span>
                    </div>
                    <div class="status-item">
                        <span>發現文章:</span>
                        <span class="status-value">${blogStatus.articlesFound}</span>
                    </div>
                    <div class="status-item">
                        <span>活躍時段:</span>
                        <span class="status-value">${blogStatus.currentActiveTime ? '✅ 是' : '❌ 否'}</span>
                    </div>
                </div>` : ''}

                <div class="status-card">
                    <div class="card-title">📊 通知統計</div>
                    <div class="status-item">
                        <span>Discord訊息:</span>
                        <span class="status-value">${this.unifiedState.notifications.discordMessages}</span>
                    </div>
                    <div class="status-item">
                        <span>電話通知:</span>
                        <span class="status-value">${this.unifiedState.notifications.phoneCallsMade}</span>
                    </div>
                    <div class="status-item">
                        <span>最後通知:</span>
                        <span class="status-value">${this.unifiedState.notifications.lastNotification || '無'}</span>
                    </div>
                </div>
            </div>

            ${Object.keys(this.config.CHANNEL_CONFIGS).length > 0 ? `
            <div class="section">
                <div class="section-title">💬 Discord頻道監控詳情</div>
                
                <div class="stats-grid">
                    <div class="stat-box success">
                        <div class="stat-number">${Object.keys(this.config.CHANNEL_CONFIGS).length}</div>
                        <div class="stat-label">監控頻道</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-number">${this.unifiedState.discord.totalMessagesProcessed}</div>
                        <div class="stat-label">處理訊息</div>
                    </div>
                    <div class="stat-box ${this.unifiedState.discord.lastDetections.length > 0 ? 'success' : 'warning'}">
                        <div class="stat-number">${this.unifiedState.discord.lastDetections.length}</div>
                        <div class="stat-label">關鍵字檢測</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-number">${this.unifiedState.notifications.phoneCallsMade}</div>
                        <div class="stat-label">電話通知</div>
                    </div>
                </div>

                <div class="channel-list">
                    ${Object.entries(this.config.CHANNEL_CONFIGS).map(([channelId, channelConfig]) => {
                        const stats = this.unifiedState.discord.channelStats[channelId];
                        return `
                        <div class="channel-item">
                            <div class="channel-header">
                                <div class="channel-name">${channelConfig.name || channelId}</div>
                                <div>${channelConfig.phone_number ? '📞' : '📢'}</div>
                            </div>
                            <div class="channel-stats">
                                <div>關鍵字: ${channelConfig.keywords.join(', ')}</div>
                                <div>檢測: ${stats.keywordsDetected} 次</div>
                                <div>處理訊息: ${stats.messagesProcessed}</div>
                                <div>電話通知: ${stats.callsMade} 次</div>
                                <div>最後檢測: ${stats.lastDetection || '無'}</div>
                                <div>最後成功通話: ${stats.lastCallSuccess || '無'}</div>
                            </div>
                        </div>`;
                    }).join('')}
                </div>

                ${this.unifiedState.discord.lastDetections.length > 0 ? `
                <div class="recent-detections">
                    <h4 style="color: #4CAF50; margin-bottom: 15px;">📋 最近檢測 (最新20次)</h4>
                    ${this.unifiedState.discord.lastDetections.slice(-20).reverse().map(detection => `
                        <div class="detection-item">
                            <div class="detection-header">
                                <div class="detection-keyword">${detection.關鍵字}</div>
                                <div class="detection-time">${detection.時間}</div>
                            </div>
                            <div style="color: #2196F3; font-size: 0.9em; margin-bottom: 5px;">
                                頻道: ${detection.頻道} | 作者: ${detection.作者}
                            </div>
                            <div class="detection-message">${detection.訊息}</div>
                        </div>
                    `).join('')}
                </div>` : ''}
            </div>` : `
            <div class="section">
                <div class="section-title">💬 Discord頻道監控</div>
                <div style="text-align: center; padding: 40px; color: #888;">
                    <h3>未配置監控頻道</h3>
                    <p>請設定 CHANNEL_CONFIGS 環境變數來配置Discord頻道監控</p>
                </div>
            </div>`}

            ${Object.keys(this.unifiedState.discord.apiUsage).length > 0 ? `
            <div class="section">
                <div class="section-title">📞 電話API使用統計</div>
                
                <div class="api-usage">
                    ${Object.entries(this.unifiedState.discord.apiUsage).map(([apiKeyShort, usage]) => `
                        <div class="api-item">
                            <div class="api-header">
                                <div class="api-key">API Key: ${apiKeyShort}****</div>
                                <div style="color: ${usage.successCalls > usage.failedCalls ? '#4CAF50' : '#FF9800'};">
                                    ${usage.totalCalls > 0 ? Math.round((usage.successCalls / usage.totalCalls) * 100) : 0}% 成功率
                                </div>
                            </div>
                            <div class="api-stats">
                                <div>總通話: ${usage.totalCalls}</div>
                                <div>成功: ${usage.successCalls}</div>
                                <div>失敗: ${usage.failedCalls}</div>
                                <div>最後使用: ${usage.lastUsed || '未使用'}</div>
                                <div>電話號碼: ${Array.from(usage.phoneNumbers).join(', ') || '無'}</div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>` : ''}

            ${this.config.BLOG_NOTIFICATION_CHANNEL_ID ? `
            <div class="section">
                <div class="section-title">📝 Family Club 博客監控詳情</div>
                <div class="stats-grid">
                    <div class="stat-box ${blogStatus.isMonitoring ? 'success' : 'warning'}">
                        <div class="stat-number">${blogStatus.isMonitoring ? '✅' : '❌'}</div>
                        <div class="stat-label">監控狀態</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-number">${blogStatus.totalChecks}</div>
                        <div class="stat-label">總檢查次數</div>
                    </div>
                    <div class="stat-box ${blogStatus.articlesFound > 0 ? 'success' : 'warning'}">
                        <div class="stat-number">${blogStatus.articlesFound}</div>
                        <div class="stat-label">發現新文章</div>
                    </div>
                    <div class="stat-box ${blogStatus.currentActiveTime ? 'success' : 'warning'}">
                        <div class="stat-number">${blogStatus.currentActiveTime ? '活躍' : '休眠'}</div>
                        <div class="stat-label">當前時段</div>
                    </div>
                </div>

                <div class="blog-detail-card">
                    <h4>📋 博客監控詳情</h4>
                    <div class="detail-grid">
                        <div class="detail-item">
                            <span>藝人:</span>
                            <span>${blogStatus.artistName} (${blogStatus.artistCode})</span>
                        </div>
                        <div class="detail-item">
                            <span>API端點:</span>
                            <span>Family Club 官方API</span>
                        </div>
                        <div class="detail-item">
                            <span>監控時程:</span>
                            <span>${blogStatus.activeTimeSchedule}</span>
                        </div>
                        <div class="detail-item">
                            <span>最後檢查:</span>
                            <span>${blogStatus.lastCheckTime || '尚未檢查'}</span>
                        </div>
                        <div class="detail-item">
                            <span>下次檢查:</span>
                            <span>${blogStatus.nextCheckTime || '未安排'}</span>
                        </div>
                        <div class="detail-item">
                            <span>博客網址:</span>
                            <span><a href="${blogStatus.blogUrl}" target="_blank" style="color: #00BCD4; text-decoration: none;">familyclub.jp</a></span>
                        </div>
                    </div>
                </div>

                ${blogStatus.articlesFound > 0 ? `
                <div style="background: rgba(76, 175, 80, 0.2); border: 1px solid #4CAF50; border-radius: 10px; padding: 15px; margin-top: 15px; color: #81c784; text-align: center;">
                    🎉 <strong>監控運作正常!</strong> 已成功檢測到 ${blogStatus.articlesFound} 篇新文章
                </div>
                ` : blogStatus.totalChecks > 5 ? `
                <div style="background: rgba(33, 150, 243, 0.2); border: 1px solid #2196F3; border-radius: 10px; padding: 15px; margin-top: 15px; color: #64b5f6; text-align: center;">
                    ⏳ <strong>持續監控中...</strong> 已檢查 ${blogStatus.totalChecks} 次，等待新文章發布
                </div>
                ` : ''}
            </div>` : ''}

            <div class="section">
                <div class="section-title">💻 Discord 命令</div>
                <div class="commands">
                    <div class="command">!status - 完整系統狀態</div>
                    <div class="command">!channels - 查看頻道監控詳情</div>
                    ${this.config.BLOG_NOTIFICATION_CHANNEL_ID ? `
                    <div class="command">!blog-status - 博客監控狀態</div>
                    <div class="command">!blog-test - 測試API連接</div>
                    <div class="command">!blog-check - 手動檢查新文章</div>
                    <div class="command">!blog-restart - 重新啟動博客監控</div>
                    ` : ''}
                    <div class="command">!help - 顯示幫助</div>
                </div>
            </div>

            <div class="refresh-note">
                頁面每30秒自動刷新 | 最後更新: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
            </div>
        </div>
    </body>
    </html>`;
    }
    
    getSystemStatus() {
        const uptime = Math.floor((Date.now() - this.unifiedState.startTime) / 1000);
        const blogStatus = this.getBlogStatus();
        
        return {
            system: {
                uptime: uptime,
                bot_ready: this.unifiedState.botReady,
                start_time: this.unifiedState.startTime,
                japan_time: this.getJapanTimeString()
            },
            discord: {
                monitoring_channels: Object.keys(this.config.CHANNEL_CONFIGS).length,
                total_messages_processed: this.unifiedState.discord.totalMessagesProcessed,
                total_detections: this.unifiedState.discord.lastDetections.length,
                channel_stats: this.unifiedState.discord.channelStats,
                recent_detections: this.unifiedState.discord.lastDetections.slice(-10),
                api_usage: this.unifiedState.discord.apiUsage
            },
            blog: {
                is_monitoring: blogStatus.isMonitoring,
                total_checks: blogStatus.totalChecks,
                articles_found: blogStatus.articlesFound,
                last_check: blogStatus.lastCheckTime,
                next_check: blogStatus.nextCheckTime,
                artist_name: blogStatus.artistName,
                current_active_time: blogStatus.currentActiveTime
            },
            notifications: {
                discord_messages: this.unifiedState.notifications.discordMessages,
                phone_calls: this.unifiedState.notifications.phoneCallsMade,
                last_notification: this.unifiedState.notifications.lastNotification
            },
            timestamp: this.getJapanTimeString()
        };
    }
    
    getHealthStatus() {
        const blogStatus = this.getBlogStatus();
        
        return {
            status: this.unifiedState.botReady ? 'healthy' : 'unhealthy',
            bot: this.client.user?.tag || 'Not ready',
            blog_monitoring: blogStatus.isMonitoring,
            discord_channels: Object.keys(this.config.CHANNEL_CONFIGS).length,
            uptime: Math.floor((Date.now() - this.unifiedState.startTime) / 1000),
            japan_time: this.getJapanTimeString()
        };
    }
}

module.exports = WebStatusPanel;