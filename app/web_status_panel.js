const express = require('express');

class WebStatusPanel {
    constructor(app, unifiedState, config, client, getInstagramMonitorFn, getBlogMonitorFn = null) {
        this.app = app;
        this.unifiedState = unifiedState;
        this.config = config;
        this.client = client;
        // Instagram監控已移除，不再使用
        this.getBlogMonitor = getBlogMonitorFn;
        
        this.setupRoutes();
        console.log('🌐 [Web面板] 初始化完成 - Discord頻道監控 + 博客監控模式');
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
        
        // API 使用統計端點
        this.app.get('/api-stats', (req, res) => {
            try {
                const apiStatsDetailed = {};
                for (const [apiKey, usage] of Object.entries(this.unifiedState.discord.apiUsage)) {
                    apiStatsDetailed[apiKey + '****'] = {
                        ...usage,
                        phoneNumbers: Array.from(usage.phoneNumbers)
                    };
                }
                res.json(apiStatsDetailed);
            } catch (error) {
                console.error('❌ [Web面板] 獲取API統計失敗:', error.message);
                res.status(500).json({ error: 'API stats not available' });
            }
        });
        
        // CloudPhone 狀態端點
        this.app.get('/cloudphone-status', (req, res) => {
            try {
                res.json({
                    configured: this.unifiedState.cloudphone.configured,
                    channelId: this.unifiedState.cloudphone.channelId,
                    totalNotifications: this.unifiedState.cloudphone.totalNotifications,
                    lastNotification: this.unifiedState.cloudphone.lastNotification,
                    status: this.unifiedState.cloudphone.configured ? 'active' : 'not_configured'
                });
            } catch (error) {
                console.error('❌ [Web面板] 獲取CloudPhone狀態失敗:', error.message);
                res.status(500).json({ error: 'CloudPhone status not available' });
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
        <title>Discord頻道監控 + 博客監控機器人 (日本時間)</title>
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
            
            .architecture-info {
                background: rgba(33, 150, 243, 0.2);
                border: 1px solid #2196F3;
                border-radius: 15px;
                padding: 20px;
                margin-bottom: 30px;
                text-align: center;
            }
            .architecture-info h3 {
                color: #2196F3;
                margin-bottom: 15px;
            }
            .architecture-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 15px;
                margin-top: 15px;
            }
            .arch-item {
                background: rgba(26, 26, 46, 0.8);
                padding: 15px;
                border-radius: 10px;
                border-left: 3px solid #4CAF50;
            }
            .arch-item h4 {
                color: #4CAF50;
                margin-bottom: 8px;
            }
            .arch-item p {
                font-size: 0.9em;
                color: #ccc;
            }
            
            .main-status {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
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
            .status-card.cloudphone { border-left-color: #9c27b0; }
            
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
            }
            .stat-box {
                background: rgba(26, 26, 46, 0.8);
                padding: 15px;
                border-radius: 10px;
                text-align: center;
            }
            .stat-box.warning { border: 1px solid #ff9800; }
            .stat-box.error { border: 1px solid #f44336; }
            .stat-number {
                font-size: 2em;
                font-weight: bold;
                color: #2196F3;
            }
            .stat-label { color: #888; font-size: 0.9em; }
            
            .detail-card {
                background: rgba(26, 26, 46, 0.8);
                border-radius: 10px;
                padding: 20px;
                border-left: 3px solid #2196F3;
                margin-bottom: 15px;
            }

            .detail-card h4 {
                color: #2196F3;
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
            
            .refresh-note {
                text-align: center;
                color: #666;
                margin-top: 30px;
                font-size: 0.9em;
            }

            .cloudphone-status {
                background: rgba(156, 39, 176, 0.2);
                border: 1px solid #9c27b0;
                border-radius: 10px;
                padding: 15px;
                margin-top: 15px;
                text-align: center;
            }
            
            .discord-channels {
                margin-top: 20px;
            }
            .channel-item {
                background: rgba(26, 26, 46, 0.8);
                border-radius: 8px;
                padding: 15px;
                margin-bottom: 10px;
                border-left: 3px solid #673ab7;
            }
            .channel-name {
                font-weight: bold;
                color: #673ab7;
                margin-bottom: 8px;
            }
            .channel-stats {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
                gap: 10px;
                font-size: 0.9em;
            }
            .channel-stat {
                display: flex;
                justify-content: space-between;
                padding: 4px 0;
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
                <p>CloudPhone Instagram監控 + Discord頻道監控 + Family Club博客監控</p>
            </div>

            <div class="architecture-info">
                <h3>🔄 系統架構升級說明</h3>
                <p>Instagram監控已轉移至CloudPhone 24/7外部監控，提供更穩定可靠的監控體驗</p>
                
                <div class="architecture-grid">
                    <div class="arch-item">
                        <h4>📱 CloudPhone Instagram</h4>
                        <p>24/7 Android手機<br>Instagram原生通知<br>無API限制</p>
                    </div>
                    <div class="arch-item">
                        <h4>📺 Discord頻道監控</h4>
                        <p>實時關鍵字檢測<br>多頻道支援<br>電話通知整合</p>
                    </div>
                    <div class="arch-item">
                        <h4>📝 Family Club博客</h4>
                        <p>官方API監控<br>新文章即時通知<br>日本時間排程</p>
                    </div>
                </div>
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
                        <span>啟動時間:</span>
                        <span class="status-value">${new Date(this.unifiedState.startTime).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}</span>
                    </div>
                </div>

                <div class="status-card cloudphone ${this.unifiedState.cloudphone.configured ? '' : 'warning'}">
                    <div class="card-title">📱 CloudPhone Instagram</div>
                    <div class="status-item">
                        <span>配置狀態:</span>
                        <span class="status-value">${this.unifiedState.cloudphone.configured ? '✅ 已配置' : '❌ 未配置'}</span>
                    </div>
                    <div class="status-item">
                        <span>監控頻道:</span>
                        <span class="status-value">${this.unifiedState.cloudphone.channelId || '未設定'}</span>
                    </div>
                    <div class="status-item">
                        <span>收到通知:</span>
                        <span class="status-value">${this.unifiedState.cloudphone.totalNotifications} 次</span>
                    </div>
                    <div class="status-item">
                        <span>最後通知:</span>
                        <span class="status-value">${this.unifiedState.cloudphone.lastNotification || '無'}</span>
                    </div>
                </div>

                ${this.config.BLOG_NOTIFICATION_CHANNEL_ID ? `
                <div class="status-card ${blogStatus.isMonitoring ? '' : 'warning'}">
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
                    <div class="card-title">📞 通知統計</div>
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

            ${this.unifiedState.cloudphone.configured ? `
            <div class="section">
                <div class="section-title">📱 CloudPhone Instagram監控詳情</div>
                <div class="stats-grid" style="margin-bottom: 20px;">
                    <div class="stat-box ${this.unifiedState.cloudphone.configured ? '' : 'error'}">
                        <div class="stat-number">${this.unifiedState.cloudphone.configured ? '✅' : '❌'}</div>
                        <div class="stat-label">配置狀態</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-number">${this.unifiedState.cloudphone.totalNotifications}</div>
                        <div class="stat-label">收到通知</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-number">24/7</div>
                        <div class="stat-label">監控時間</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-number">0ms</div>
                        <div class="stat-label">延遲時間</div>
                    </div>
                </div>

                <div class="detail-card">
                    <h4>📋 CloudPhone監控詳情</h4>
                    <div class="detail-grid">
                        <div class="detail-item">
                            <span>監控類型:</span>
                            <span>Android手機實體監控</span>
                        </div>
                        <div class="detail-item">
                            <span>通知來源:</span>
                            <span>Instagram原生App</span>
                        </div>
                        <div class="detail-item">
                            <span>運行時間:</span>
                            <span>24小時不間斷</span>
                        </div>
                        <div class="detail-item">
                            <span>Discord頻道:</span>
                            <span>${this.unifiedState.cloudphone.channelId}</span>
                        </div>
                        <div class="detail-item">
                            <span>總通知數:</span>
                            <span>${this.unifiedState.cloudphone.totalNotifications}</span>
                        </div>
                        <div class="detail-item">
                            <span>最後通知:</span>
                            <span>${this.unifiedState.cloudphone.lastNotification || '等待中'}</span>
                        </div>
                    </div>
                </div>

                <div class="cloudphone-status">
                    🔄 <strong>CloudPhone監控優勢:</strong><br>
                    ✅ 24/7不間斷實體手機監控<br>
                    ✅ Instagram原生App通知（最快檢測）<br>
                    ✅ 無API限制或帳號管理問題<br>
                    ✅ 不受Instagram政策變更影響<br>
                    ✅ 自動轉發至Discord觸發後續流程
                </div>
            </div>` : `
            <div class="section">
                <div class="section-title">📱 CloudPhone Instagram監控 (未配置)</div>
                <div class="detail-card">
                    <h4>⚠️ CloudPhone監控未配置</h4>
                    <p style="color: #ff9800; margin-bottom: 15px;">
                        請設定 <code>CLOUDPHONE_NOTIFICATION_CHANNEL</code> 環境變數來啟用CloudPhone Instagram監控
                    </p>
                    <div style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px; font-family: monospace;">
                        CLOUDPHONE_NOTIFICATION_CHANNEL=YOUR_DISCORD_CHANNEL_ID
                    </div>
                    <p style="margin-top: 15px; color: #ccc; font-size: 0.9em;">
                        配置後，CloudPhone收到的Instagram通知將轉發至指定Discord頻道，觸發關鍵字檢測和電話通知
                    </p>
                </div>
            </div>`}

            <div class="section">
                <div class="section-title">📺 Discord頻道監控詳情</div>
                <div class="stats-grid" style="margin-bottom: 20px;">
                    <div class="stat-box">
                        <div class="stat-number">${Object.keys(this.config.CHANNEL_CONFIGS).length}</div>
                        <div class="stat-label">監控頻道</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-number">${this.unifiedState.discord.totalMessagesProcessed}</div>
                        <div class="stat-label">處理訊息</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-number">${this.unifiedState.discord.lastDetections.length}</div>
                        <div class="stat-label">關鍵字檢測</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-number">${this.unifiedState.notifications.phoneCallsMade}</div>
                        <div class="stat-label">電話通知</div>
                    </div>
                </div>

                ${Object.keys(this.config.CHANNEL_CONFIGS).length > 0 ? `
                <div class="discord-channels">
                    <h4 style="color: #673ab7; margin-bottom: 15px;">📋 監控頻道列表</h4>
                    ${Object.entries(this.config.CHANNEL_CONFIGS).map(([channelId, config]) => {
                        const stats = this.unifiedState.discord.channelStats[channelId] || {};
                        return `
                        <div class="channel-item">
                            <div class="channel-name">📺 ${config.name || `頻道 ${channelId}`}</div>
                            <div class="channel-stats">
                                <div class="channel-stat">
                                    <span>處理訊息:</span>
                                    <span>${stats.messagesProcessed || 0}</span>
                                </div>
                                <div class="channel-stat">
                                    <span>關鍵字檢測:</span>
                                    <span>${stats.keywordsDetected || 0}</span>
                                </div>
                                <div class="channel-stat">
                                    <span>電話通知:</span>
                                    <span>${stats.callsMade || 0}</span>
                                </div>
                                <div class="channel-stat">
                                    <span>最後檢測:</span>
                                    <span>${stats.lastDetection || '無'}</span>
                                </div>
                            </div>
                            <div style="margin-top: 10px; font-size: 0.85em; color: #888;">
                                關鍵字: ${config.keywords.join(', ')}
                            </div>
                            ${config.api_key && config.phone_number ? `
                            <div style="margin-top: 8px; font-size: 0.85em; color: #4CAF50;">
                                ✅ 電話通知已配置 (${config.phone_number})
                            </div>
                            ` : `
                            <div style="margin-top: 8px; font-size: 0.85em; color: #ff9800;">
                                ⚠️ 電話通知未配置
                            </div>
                            `}
                        </div>
                        `;
                    }).join('')}
                </div>
                ` : `
                <div style="background: rgba(255, 152, 0, 0.2); border: 1px solid #ff9800; border-radius: 10px; padding: 15px; text-align: center; color: #ffb74d;">
                    ⚠️ <strong>未配置Discord頻道監控</strong><br>
                    請設定 <code>CHANNEL_CONFIGS</code> 環境變數來啟用Discord頻道監控功能
                </div>
                `}
            </div>

            ${this.config.BLOG_NOTIFICATION_CHANNEL_ID ? `
            <div class="section">
                <div class="section-title">📝 Family Club 博客監控詳情</div>
                <div class="stats-grid" style="margin-bottom: 20px;">
                    <div class="stat-box ${blogStatus.isMonitoring ? '' : 'warning'}">
                        <div class="stat-number">${blogStatus.isMonitoring ? '✅' : '❌'}</div>
                        <div class="stat-label">監控狀態</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-number">${blogStatus.totalChecks}</div>
                        <div class="stat-label">總檢查次數</div>
                    </div>
                    <div class="stat-box ${blogStatus.articlesFound > 0 ? '' : 'warning'}">
                        <div class="stat-number">${blogStatus.articlesFound}</div>
                        <div class="stat-label">發現新文章</div>
                    </div>
                    <div class="stat-box ${blogStatus.currentActiveTime ? '' : 'warning'}">
                        <div class="stat-number">${blogStatus.currentActiveTime ? '活躍' : '休眠'}</div>
                        <div class="stat-label">當前時段</div>
                    </div>
                </div>

                <div class="detail-card">
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
                            <span><a href="${blogStatus.blogUrl}" target="_blank" style="color: #2196F3; text-decoration: none;">familyclub.jp</a></span>
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
            </div>` : `
            <div class="section">
                <div class="section-title">📝 Family Club 博客監控 (未配置)</div>
                <div class="detail-card">
                    <h4>⚠️ 博客監控未配置</h4>
                    <p style="color: #ff9800; margin-bottom: 15px;">
                        請設定 <code>BLOG_NOTIFICATION_CHANNEL_ID</code> 環境變數來啟用Family Club博客監控
                    </p>
                    <div style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px; font-family: monospace;">
                        BLOG_NOTIFICATION_CHANNEL_ID=YOUR_DISCORD_CHANNEL_ID<br>
                        ARTIST_CODE=F2017  # 高木雄也
                    </div>
                    <p style="margin-top: 15px; color: #ccc; font-size: 0.9em;">
                        配置後將監控Family Club博客新文章，每小時自動檢查並發送通知
                    </p>
                </div>
            </div>`}

            <div class="section">
                <div class="section-title">💬 Discord 命令</div>
                <div class="commands">
                    <div class="command">!status - 完整系統狀態</div>
                    <div class="command">!discord-stats - Discord監控統計</div>
                    <div class="command">!cloudphone-stats - CloudPhone統計</div>
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
                architecture: 'CloudPhone + Discord + Blog'
            },
            cloudphone: {
                configured: this.unifiedState.cloudphone.configured,
                channel_id: this.unifiedState.cloudphone.channelId,
                total_notifications: this.unifiedState.cloudphone.totalNotifications,
                last_notification: this.unifiedState.cloudphone.lastNotification,
                status: this.unifiedState.cloudphone.configured ? 'active' : 'not_configured'
            },
            blog: {
                is_monitoring: blogStatus.isMonitoring,
                total_checks: blogStatus.totalChecks,
                articles_found: blogStatus.articlesFound,
                last_check: blogStatus.lastCheckTime,
                next_check: blogStatus.nextCheckTime,
                artist: blogStatus.artistName,
                method: blogStatus.method
            },
            discord: {
                monitoring_channels: Object.keys(this.config.CHANNEL_CONFIGS).length,
                total_messages_processed: this.unifiedState.discord.totalMessagesProcessed,
                total_detections: this.unifiedState.discord.lastDetections.length,
                channel_stats: this.unifiedState.discord.channelStats,
                recent_detections: this.unifiedState.discord.lastDetections.slice(-10)
            },
            notifications: {
                discord_messages: this.unifiedState.notifications.discordMessages,
                phone_calls: this.unifiedState.notifications.phoneCallsMade,
                last_notification: this.unifiedState.notifications.lastNotification
            },
            timestamp: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
        };
    }
    
    getHealthStatus() {
        return {
            status: this.unifiedState.botReady ? 'healthy' : 'unhealthy',
            bot: this.client.user?.tag || 'Not ready',
            cloudphone_monitoring: this.unifiedState.cloudphone.configured,
            blog_monitoring: this.unifiedState.blog.isMonitoring,
            discord_channels: Object.keys(this.config.CHANNEL_CONFIGS).length,
            uptime: Math.floor((Date.now() - this.unifiedState.startTime) / 1000),
            architecture: 'CloudPhone + Discord + Blog'
        };
    }
}

module.exports = WebStatusPanel;