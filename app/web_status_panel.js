const express = require('express');

class WebStatusPanel {
    constructor(app, unifiedState, config, client, instagramMonitor) {
        this.app = app;
        this.unifiedState = unifiedState;
        this.config = config;
        this.client = client;
        this.instagramMonitor = instagramMonitor;
        
        this.setupRoutes();
    }
    
    setupRoutes() {
        // 中間件設定
        this.app.use(express.json());
        
        // 主狀態頁面
        this.app.get('/', (req, res) => {
            const html = this.generateStatusHTML();
            res.send(html);
        });
        
        // API 端點
        this.app.get('/api/status', (req, res) => {
            const status = this.getSystemStatus();
            res.json(status);
        });
        
        // 健康檢查
        this.app.get('/health', (req, res) => {
            res.json(this.getHealthStatus());
        });
        
        // API 使用統計端點
        this.app.get('/api-stats', (req, res) => {
            const apiStatsDetailed = {};
            for (const [apiKey, usage] of Object.entries(this.unifiedState.discord.apiUsage)) {
                apiStatsDetailed[apiKey + '****'] = {
                    ...usage,
                    phoneNumbers: Array.from(usage.phoneNumbers)
                };
            }
            res.json(apiStatsDetailed);
        });
        
        // Instagram 狀態詳細端點
        this.app.get('/instagram-status', (req, res) => {
            const igStatus = this.instagramMonitor.getStatus();
            res.json(igStatus);
        });
    }
    
    generateStatusHTML() {
        const uptime = Math.floor((Date.now() - this.unifiedState.startTime) / 1000);
        const igStatus = this.instagramMonitor.getStatus();
        
        return `
<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>統一直播監控機器人</title>
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
        .status-card.live { border-left-color: #e91e63; }
        
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
        
        .live-indicator {
            text-align: center;
            padding: 20px;
            border-radius: 15px;
            margin-bottom: 30px;
            font-size: 1.8em;
            font-weight: bold;
        }
        .live-yes {
            background: linear-gradient(45deg, #e91e63, #f44336);
            animation: pulse 2s infinite;
        }
        .live-no { background: rgba(66, 66, 66, 0.8); }
        
        @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.8; transform: scale(1.05); }
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
        .stat-number {
            font-size: 2em;
            font-weight: bold;
            color: #2196F3;
        }
        .stat-label { color: #888; font-size: 0.9em; }
        
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
        
        .channel-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 15px;
            margin-top: 20px;
        }
        .channel-card {
            background: rgba(26, 26, 46, 0.8);
            border-radius: 10px;
            padding: 15px;
            border-left: 3px solid #2196F3;
        }
        .channel-name {
            font-weight: bold;
            color: #2196F3;
            margin-bottom: 10px;
        }
        .channel-detail {
            display: flex;
            justify-content: space-between;
            margin: 5px 0;
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
            <h1>🤖 統一直播監控機器人</h1>
            <p>Instagram監控 + Discord頻道監控 + 電話通知</p>
        </div>

        <div class="live-indicator ${igStatus.isLiveNow ? 'live-yes' : 'live-no'}">
            ${igStatus.isLiveNow ? '🔴 @' + this.config.TARGET_USERNAME + ' 正在直播!' : '⚫ @' + this.config.TARGET_USERNAME + ' 離線中'}
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
            </div>

            <div class="status-card ${igStatus.isMonitoring ? '' : 'warning'}">
                <div class="card-title">📺 Instagram監控</div>
                <div class="status-item">
                    <span>目標用戶:</span>
                    <span class="status-value">@${this.config.TARGET_USERNAME}</span>
                </div>
                <div class="status-item">
                    <span>監控狀態:</span>
                    <span class="status-value">${igStatus.isMonitoring ? '✅ 運行中' : '❌ 已停止'}</span>
                </div>
                <div class="status-item">
                    <span>帳號狀態:</span>
                    <span class="status-value">${igStatus.accountStatus}</span>
                </div>
                <div class="status-item">
                    <span>成功率:</span>
                    <span class="status-value">${igStatus.successRate}%</span>
                </div>
            </div>

            <div class="status-card">
                <div class="card-title">📋 Discord監控</div>
                <div class="status-item">
                    <span>監控頻道:</span>
                    <span class="status-value">${Object.keys(this.config.CHANNEL_CONFIGS).length}</span>
                </div>
                <div class="status-item">
                    <span>處理訊息:</span>
                    <span class="status-value">${this.unifiedState.discord.totalMessagesProcessed}</span>
                </div>
                <div class="status-item">
                    <span>檢測次數:</span>
                    <span class="status-value">${this.unifiedState.discord.lastDetections.length}</span>
                </div>
            </div>

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

        <div class="section">
            <div class="section-title">📊 詳細統計</div>
            <div class="stats-grid">
                <div class="stat-box">
                    <div class="stat-number">${igStatus.totalRequests}</div>
                    <div class="stat-label">Instagram 請求總數</div>
                </div>
                <div class="stat-box">
                    <div class="stat-number">${igStatus.consecutiveErrors}</div>
                    <div class="stat-label">連續錯誤次數</div>
                </div>
                <div class="stat-box">
                    <div class="stat-number">${Object.keys(this.config.CHANNEL_CONFIGS).length}</div>
                    <div class="stat-label">Discord 頻道數</div>
                </div>
                <div class="stat-box">
                    <div class="stat-number">${Object.keys(this.unifiedState.discord.apiUsage).length}</div>
                    <div class="stat-label">PushCall API 帳號</div>
                </div>
            </div>
        </div>

        ${Object.keys(this.config.CHANNEL_CONFIGS).length > 0 ? `
        <div class="section">
            <div class="section-title">📺 Discord 頻道監控詳情</div>
            <div class="channel-stats">
                ${Object.entries(this.config.CHANNEL_CONFIGS).map(([channelId, config]) => {
                    const stats = this.unifiedState.discord.channelStats[channelId];
                    return `
                    <div class="channel-card">
                        <div class="channel-name">${config.name || `頻道 ${channelId}`}</div>
                        <div class="channel-detail">
                            <span>關鍵字:</span>
                            <span>${config.keywords.join(', ')}</span>
                        </div>
                        <div class="channel-detail">
                            <span>處理訊息:</span>
                            <span>${stats.messagesProcessed}</span>
                        </div>
                        <div class="channel-detail">
                            <span>檢測次數:</span>
                            <span>${stats.keywordsDetected}</span>
                        </div>
                        <div class="channel-detail">
                            <span>通話次數:</span>
                            <span>${stats.callsMade}</span>
                        </div>
                        <div class="channel-detail">
                            <span>最後檢測:</span>
                            <span>${stats.lastDetection || '無'}</span>
                        </div>
                    </div>`;
                }).join('')}
            </div>
        </div>` : ''}

        <div class="section">
            <div class="section-title">💬 Discord 命令</div>
            <div class="commands">
                <div class="command">!ig-start - 開始Instagram監控</div>
                <div class="command">!ig-stop - 停止Instagram監控</div>
                <div class="command">!ig-status - Instagram監控狀態</div>
                <div class="command">!ig-check - 手動檢查Instagram</div>
                <div class="command">!status - 完整系統狀態</div>
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
        const igStatus = this.instagramMonitor.getStatus();
        
        return {
            system: {
                uptime: uptime,
                bot_ready: this.unifiedState.botReady,
                start_time: this.unifiedState.startTime
            },
            instagram: {
                target: this.config.TARGET_USERNAME,
                is_live: igStatus.isLiveNow,
                is_monitoring: igStatus.isMonitoring,
                account_status: igStatus.accountStatus,
                total_requests: igStatus.totalRequests,
                successful_requests: igStatus.successfulRequests,
                success_rate: igStatus.successRate,
                consecutive_errors: igStatus.consecutiveErrors,
                last_check: igStatus.lastCheck,
                user_id: igStatus.targetUserId
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
        const igStatus = this.instagramMonitor.getStatus();
        
        return {
            status: this.unifiedState.botReady ? 'healthy' : 'unhealthy',
            bot: this.client.user?.tag || 'Not ready',
            instagram_monitoring: igStatus.isMonitoring,
            discord_channels: Object.keys(this.config.CHANNEL_CONFIGS).length,
            uptime: Math.floor((Date.now() - this.unifiedState.startTime) / 1000)
        };
    }
}

module.exports = WebStatusPanel;