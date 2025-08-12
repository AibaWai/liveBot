const express = require('express');

class WebStatusPanel {
    constructor(app, unifiedState, config, client, getInstagramMonitorFn, getBlogMonitorFn = null) {
        this.app = app;
        this.unifiedState = unifiedState;
        this.config = config;
        this.client = client;
        this.getInstagramMonitor = getInstagramMonitorFn;
        this.getBlogMonitor = getBlogMonitorFn; // 新增博客監控函數
        
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
    
    // 根據日本時間獲取時間段描述
    getTimeSlotDescription() {
        const hour = parseInt(this.getJapanHour());
        
        if (hour >= 2 && hour <= 6) {
            return '🌙 深夜模式 (10-15分鐘間隔)';
        } else if (hour >= 0 && hour <= 1) {
            return '🌃 深夜前期 (3-5分鐘間隔)';
        } else if (hour >= 7 && hour <= 8) {
            return '🌅 早晨時段 (3-5分鐘間隔)';
        } else if (hour >= 9 && hour <= 23) {
            return '☀️ 活躍時段 (90-180秒間隔)';
        }
        return '🕐 一般時段';
    }
    
    // 安全獲取Instagram監控狀態
    getInstagramStatus() {
        try {
            const instagramMonitor = this.getInstagramMonitor();
            if (instagramMonitor && typeof instagramMonitor.getStatus === 'function') {
                return instagramMonitor.getStatus();
            }
        } catch (error) {
            console.error('❌ [Web面板] 獲取Instagram狀態失敗:', error.message);
        }
        
        // 返回默認狀態
        return {
            isMonitoring: false,
            isLiveNow: false,
            accountStatus: 'unknown',
            totalRequests: 0,
            successfulRequests: 0,
            successRate: 0,
            consecutiveErrors: 0,
            lastCheck: null,
            targetUserId: null,
            totalAccounts: 0,
            availableAccounts: 0,
            dailyRequests: 0,
            maxDailyRequests: 0,
            invalidCookieAccounts: 0,
            japanTime: this.getJapanTimeString(),
            japanHour: parseInt(this.getJapanHour()),
            accountDetails: []
        };
    }


    // 安全獲取博客監控狀態
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
            lastArticleDate: null,
            nextCheckTime: null,
            blogUrl: 'https://web.familyclub.jp/s/jwb/diary/F2017?ima=2317'
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
        
        // Instagram 狀態詳細端點
        this.app.get('/instagram-status', (req, res) => {
            try {
                const igStatus = this.getInstagramStatus();
                res.json(igStatus);
            } catch (error) {
                console.error('❌ [Web面板] 獲取Instagram詳細狀態失敗:', error.message);
                res.status(500).json({ error: 'Instagram status not available' });
            }
        });
    }

    generateCookieStatusHTML() {
        try {
            const instagramMonitor = this.getInstagramMonitor();
            if (instagramMonitor && typeof instagramMonitor.getCookieStatusSummary === 'function') {
                const cookieSummary = instagramMonitor.getCookieStatusSummary();
                
                return `
                <div class="cookie-summary">
                    <div class="stats-grid">
                        <div class="stat-box ${cookieSummary.validAccounts === cookieSummary.totalAccounts ? '' : 'warning'}">
                            <div class="stat-number">${cookieSummary.validAccounts}</div>
                            <div class="stat-label">有效帳號</div>
                        </div>
                        <div class="stat-box ${cookieSummary.invalidAccounts > 0 ? 'error' : ''}">
                            <div class="stat-number">${cookieSummary.invalidAccounts}</div>
                            <div class="stat-label">失效帳號</div>
                        </div>
                        <div class="stat-box ${cookieSummary.recentlyFailed > 0 ? 'warning' : ''}">
                            <div class="stat-number">${cookieSummary.recentlyFailed}</div>
                            <div class="stat-label">近期失敗</div>
                        </div>
                        <div class="stat-box">
                            <div class="stat-number">${parseInt(this.getJapanHour())}</div>
                            <div class="stat-label">日本時間 (時)</div>
                        </div>
                    </div>
                    
                    <div class="time-info">
                        <div class="current-time">
                            🕐 當前日本時間: ${cookieSummary.japanTime}
                        </div>
                        <div class="time-slot">
                            ${this.getTimeSlotDescription()}
                        </div>
                    </div>
                    
                    <div class="cookie-accounts">
                        ${cookieSummary.details.map(account => `
                            <div class="cookie-account ${account.status === 'Invalid' ? 'invalid' : 'valid'}">
                                <div class="account-header">
                                    <span class="account-name">${account.id}</span>
                                    <span class="account-status ${account.status.toLowerCase()}">${account.status === 'Valid' ? '✅ 有效' : '❌ 失效'}</span>
                                </div>
                                <div class="account-details">
                                    <div class="detail-item">
                                        <span>Session ID:</span>
                                        <span class="session-id">${account.sessionId}</span>
                                    </div>
                                    ${account.consecutiveFailures > 0 ? `
                                    <div class="detail-item warning">
                                        <span>連續失敗:</span>
                                        <span>${account.consecutiveFailures} 次</span>
                                    </div>
                                    ` : ''}
                                    ${account.lastFailure ? `
                                    <div class="detail-item">
                                        <span>最後失敗:</span>
                                        <span>${account.lastFailure}</span>
                                    </div>
                                    ` : ''}
                                    ${account.invalidSince ? `
                                    <div class="detail-item error">
                                        <span>失效時間:</span>
                                        <span>${account.invalidSince}</span>
                                    </div>
                                    ` : ''}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    
                    ${cookieSummary.invalidAccounts > 0 ? `
                    <div class="cookie-warning">
                        ⚠️ <strong>注意:</strong> 有 ${cookieSummary.invalidAccounts} 個帳號的cookies已失效，需要立即更新！
                        <br>
                        📋 <strong>修復步驟:</strong> 
                        1. 重新登入Instagram → 2. 複製新的cookies → 3. 更新環境變數 → 4. 重新部署
                    </div>
                    ` : ''}
                `;
            }
        } catch (error) {
            console.error('❌ [Web面板] 生成Cookie狀態失敗:', error.message);
        }
        
        return `
        <div class="cookie-unavailable">
            <p>Cookie狀態信息暫時不可用</p>
            <p>系統正在初始化中...</p>
            <p>當前日本時間: ${this.getJapanTimeString()}</p>
        </div>
        `;
    }
    
    generateStatusHTML() {
        const uptime = Math.floor((Date.now() - this.unifiedState.startTime) / 1000);
        const igStatus = this.getInstagramStatus(); // 使用安全的方法
        
        return `
<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>統一直播監控機器人 (日本時間)</title>
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
        .header .time-display {
            background: rgba(42, 42, 42, 0.8);
            border-radius: 10px;
            padding: 15px;
            margin-top: 15px;
            border: 1px solid #4CAF50;
        }
        .time-display .japan-time {
            font-size: 1.3em;
            color: #4CAF50;
            font-weight: bold;
        }
        .time-display .time-slot {
            font-size: 1.1em;
            color: #2196F3;
            margin-top: 5px;
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
        
        .system-warning {
            background: rgba(255, 152, 0, 0.2);
            border: 1px solid #ff9800;
            border-radius: 10px;
            padding: 15px;
            margin-bottom: 20px;
            text-align: center;
        }

        .account-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 15px;
            margin-top: 20px;
        }
        
        .account-card {
            background: rgba(26, 26, 46, 0.8);
            border-radius: 10px;
            padding: 15px;
            border-left: 3px solid #4CAF50;
        }
        
        .account-card.disabled {
            border-left-color: #f44336;
            background: rgba(46, 26, 26, 0.8);
        }
        
        .account-card.cooldown {
            border-left-color: #ff9800;
            background: rgba(46, 39, 26, 0.8);
        }
        
        .account-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
            padding-bottom: 8px;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        
        .account-name {
            font-weight: bold;
            color: #2196F3;
        }
        
        .account-status {
            font-size: 0.9em;
        }
        
        .account-stats {
            display: flex;
            flex-direction: column;
            gap: 5px;
        }
        
        .stat-item {
            display: flex;
            justify-content: space-between;
            font-size: 0.9em;
            padding: 2px 0;
        }
        
        .account-warning {
            background: rgba(255, 152, 0, 0.2);
            border: 1px solid #ff9800;
            border-radius: 10px;
            padding: 15px;
            margin-top: 15px;
            color: #ffb74d;
        }
        
        .status-value.error {
            color: #f44336;
        }

        .cookie-summary {
            margin-bottom: 20px;
        }
        
        .cookie-accounts {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
            gap: 15px;
            margin-top: 20px;
        }
        
        .cookie-account {
            background: rgba(26, 26, 46, 0.8);
            border-radius: 10px;
            padding: 15px;
            border-left: 3px solid #4CAF50;
        }
        
        .cookie-account.invalid {
            border-left-color: #f44336;
            background: rgba(46, 26, 26, 0.8);
        }
        
        .account-details {
            display: flex;
            flex-direction: column;
            gap: 5px;
        }
        
        .detail-item {
            display: flex;
            justify-content: space-between;
            font-size: 0.9em;
            padding: 3px 0;
        }
        
        .detail-item.warning {
            color: #ff9800;
        }
        
        .detail-item.error {
            color: #f44336;
        }
        
        .session-id {
            font-family: 'Courier New', monospace;
            font-size: 0.8em;
            background: rgba(0,0,0,0.3);
            padding: 2px 6px;
            border-radius: 4px;
        }
        
        .cookie-warning {
            background: rgba(255, 152, 0, 0.2);
            border: 1px solid #ff9800;
            border-radius: 10px;
            padding: 15px;
            margin-top: 15px;
            color: #ffb74d;
        }
        
        .cookie-unavailable {
            text-align: center;
            color: #888;
            font-style: italic;
            padding: 20px;
        }
        
        .stat-box.warning {
            border-left: 3px solid #ff9800;
        }
        
        .stat-box.error {
            border-left: 3px solid #f44336;
        }
        
        .stat-box.warning .stat-number {
            color: #ff9800;
        }
        
        .stat-box.error .stat-number {
            color: #f44336;
        }

        .blog-info {
            margin-top: 20px;
        }

        .blog-detail-card {
            background: rgba(26, 26, 46, 0.8);
            border-radius: 10px;
            padding: 20px;
            border-left: 3px solid #2196F3;
        }

        .blog-detail-card h4 {
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

        .detail-item:last-child {
            border-bottom: none;
        }

        .next-check {
            color: #4CAF50;
            font-weight: bold;
        }

        .blog-success {
            background: rgba(76, 175, 80, 0.2);
            border: 1px solid #4CAF50;
            border-radius: 10px;
            padding: 15px;
            margin-top: 15px;
            color: #81c784;
            text-align: center;
        }

        .blog-waiting {
            background: rgba(33, 150, 243, 0.2);
            border: 1px solid #2196F3;
            border-radius: 10px;
            padding: 15px;
            margin-top: 15px;
            color: #64b5f6;
            text-align: center;
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

        ${!igStatus.isMonitoring ? `
        <div class="system-warning">
            ⚠️ Instagram監控系統正在初始化中，請稍等...
        </div>` : ''}

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
                    <span>可用帳號:</span>
                    <span class="status-value">${igStatus.availableAccounts}/${igStatus.totalAccounts}</span>
                </div>
                <div class="status-item">
                    <span>失效帳號:</span>
                    <span class="status-value ${(igStatus.invalidCookieAccounts || 0) > 0 ? 'error' : ''}">${igStatus.invalidCookieAccounts || 0}</span>
                </div>
                <div class="status-item">
                    <span>今日請求:</span>
                    <span class="status-value">${igStatus.dailyRequests}/${igStatus.maxDailyRequests}</span>
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

            ${this.config.BLOG_NOTIFICATION_CHANNEL_ID ? `
            <div class="status-card">
                <div class="card-title">📝 博客監控</div>
                <div class="status-item">
                    <span>監控狀態:</span>
                    <span class="status-value">${this.getBlogStatus().isMonitoring ? '✅ 運行中' : '❌ 已停止'}</span>
                </div>
                <div class="status-item">
                    <span>檢查次數:</span>
                    <span class="status-value">${this.getBlogStatus().totalChecks}</span>
                </div>
                <div class="status-item">
                    <span>發現文章:</span>
                    <span class="status-value">${this.getBlogStatus().articlesFound}</span>
                </div>
                <div class="status-item">
                    <span>下次檢查:</span>
                    <span class="status-value">${this.getBlogStatus().nextCheckTime ? new Date(this.getBlogStatus().nextCheckTime).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }) : '未安排'}</span>
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

    
        <div class="section">
            <div class="section-title">📊 詳細統計</div>
            <div class="stats-grid">
                <div class="stat-box">
                    <div class="stat-number">${igStatus.totalRequests || 0}</div>
                    <div class="stat-label">Instagram 請求總數</div>
                </div>
                <div class="stat-box">
                    <div class="stat-number">${igStatus.consecutiveErrors || 0}</div>
                    <div class="stat-label">連續錯誤次數</div>
                </div>
                <div class="stat-box ${(igStatus.invalidCookieAccounts || 0) > 0 ? 'error' : ''}">
                    <div class="stat-number">${igStatus.invalidCookieAccounts || 0}</div>
                    <div class="stat-label">失效帳號</div>
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

        ${igStatus.totalAccounts > 0 ? `
        <div class="section">
            <div class="section-title">🔐 Instagram 帳號狀態 & Cookie監控</div>
            
            <!-- 添加總覽統計 -->
            <div class="stats-grid" style="margin-bottom: 20px;">
                <div class="stat-box ${igStatus.availableAccounts === igStatus.totalAccounts ? '' : 'warning'}">
                    <div class="stat-number">${igStatus.availableAccounts}</div>
                    <div class="stat-label">可用帳號</div>
                </div>
                <div class="stat-box ${(igStatus.invalidCookieAccounts || 0) > 0 ? 'error' : ''}">
                    <div class="stat-number">${igStatus.invalidCookieAccounts || 0}</div>
                    <div class="stat-label">Cookie失效</div>
                </div>
                <div class="stat-box">
                    <div class="stat-number">${igStatus.dailyRequests}</div>
                    <div class="stat-label">今日請求</div>
                </div>
                <div class="stat-box">
                    <div class="stat-number">${this.getTimeSlotDescription().split(' ')[0]}</div>
                    <div class="stat-label">當前時段</div>
                </div>
            </div>

            <!-- 時間信息 -->
            <div class="time-display" style="margin-bottom: 20px;">
                <div class="japan-time">🕐 當前日本時間: ${igStatus.japanTime}</div>
                <div class="time-slot">${this.getTimeSlotDescription()}</div>
            </div>
            
            <!-- 原有的帳號詳細卡片 -->
            <div class="account-grid">
                ${igStatus.accountDetails.map(account => {
                    // 原有的帳號卡片代碼，但增加Cookie狀態信息
                    const successRate = account.successCount + account.errorCount > 0 ? 
                        Math.round(account.successCount / (account.successCount + account.errorCount) * 100) : 0;
                    const cookieStatus = account.cookieStatus || 'Valid';
                    const statusClass = cookieStatus === 'Invalid' ? 'disabled' : (account.inCooldown ? 'cooldown' : 'active');
                    const statusText = cookieStatus === 'Invalid' ? '🚫 Cookie失效' : (account.inCooldown ? '❄️ 冷卻中' : '✅ 可用');
                    
                    return `
                    <div class="account-card ${statusClass}">
                        <div class="account-header">
                            <span class="account-name">${account.id}</span>
                            <span class="account-status">${statusText}</span>
                        </div>
                        <div class="account-stats">
                            <!-- 添加Cookie詳細信息 -->
                            <div class="stat-item">
                                <span>Session ID:</span>
                                <span class="session-id">${account.deviceId}</span>
                            </div>
                            <div class="stat-item">
                                <span>成功率:</span>
                                <span>${successRate}%</span>
                            </div>
                            <div class="stat-item">
                                <span>今日請求:</span>
                                <span>${account.dailyRequests}</span>
                            </div>
                            <div class="stat-item">
                                <span>最後使用:</span>
                                <span>${account.lastUsed}</span>
                            </div>
                            ${account.consecutiveFailures > 0 ? `
                            <div class="stat-item" style="color: #ff9800;">
                                <span>連續失敗:</span>
                                <span>${account.consecutiveFailures}</span>
                            </div>
                            ` : ''}
                            ${account.invalidSince ? `
                            <div class="stat-item" style="color: #f44336;">
                                <span>失效時間:</span>
                                <span>${account.invalidSince}</span>
                            </div>
                            ` : ''}
                        </div>
                    </div>`;
                }).join('')}
            </div>
            
            <!-- 保持原有的警告信息 -->
            ${(igStatus.invalidCookieAccounts || 0) > 0 ? `
            <div class="account-warning">
                ⚠️ <strong>注意:</strong> 有 ${igStatus.invalidCookieAccounts} 個帳號的cookies已失效，需要立即更新！
                <br>
                📋 <strong>修復步驟:</strong> 
                1. 重新登入Instagram → 2. 複製新的cookies → 3. 更新環境變數 → 4. 重新部署
            </div>
            ` : ''}
        </div>` : ''}

        ${this.config.BLOG_NOTIFICATION_CHANNEL_ID ? `
        <div class="section">
            <div class="section-title">📝 博客監控詳情</div>
            <div class="stats-grid" style="margin-bottom: 20px;">
                <div class="stat-box ${this.getBlogStatus().isMonitoring ? '' : 'warning'}">
                    <div class="stat-number">${this.getBlogStatus().isMonitoring ? '✅' : '❌'}</div>
                    <div class="stat-label">監控狀態</div>
                </div>
                <div class="stat-box">
                    <div class="stat-number">${this.getBlogStatus().totalChecks}</div>
                    <div class="stat-label">總檢查次數</div>
                </div>
                <div class="stat-box ${this.getBlogStatus().articlesFound > 0 ? '' : 'warning'}">
                    <div class="stat-number">${this.getBlogStatus().articlesFound}</div>
                    <div class="stat-label">發現新文章</div>
                </div>
                <div class="stat-box">
                    <div class="stat-number">${this.getBlogStatus().nextCheckTime ? new Date(this.getBlogStatus().nextCheckTime).getHours() : '--'}</div>
                    <div class="stat-label">下次檢查 (時)</div>
                </div>
            </div>

            <div class="blog-info">
                <div class="blog-detail-card">
                    <h4>📋 博客監控信息</h4>
                    <div class="detail-grid">
                        <div class="detail-item">
                            <span>博客網址:</span>
                            <span><a href="${this.getBlogStatus().blogUrl}" target="_blank" style="color: #2196F3; text-decoration: none;">familyclub.jp</a></span>
                        </div>
                        <div class="detail-item">
                            <span>檢查頻率:</span>
                            <span>每小時00分</span>
                        </div>
                        <div class="detail-item">
                            <span>最後檢查:</span>
                            <span>${this.getBlogStatus().lastCheckTime || '尚未檢查'}</span>
                        </div>
                        <div class="detail-item">
                            <span>最新文章日期:</span>
                            <span>${this.getBlogStatus().lastArticleDate || '無'}</span>
                        </div>
                        <div class="detail-item">
                            <span>下次檢查時間:</span>
                            <span class="next-check">${this.getBlogStatus().nextCheckTime || '未安排'}</span>
                        </div>
                        <div class="detail-item">
                            <span>通知頻道:</span>
                            <span>已配置 ✅</span>
                        </div>
                    </div>
                </div>
            </div>

            ${this.getBlogStatus().articlesFound > 0 ? `
            <div class="blog-success">
                🎉 <strong>監控運作正常!</strong> 已成功檢測到 ${this.getBlogStatus().articlesFound} 篇新文章
            </div>
            ` : this.getBlogStatus().totalChecks > 10 ? `
            <div class="blog-waiting">
                ⏳ <strong>持續監控中...</strong> 已檢查 ${this.getBlogStatus().totalChecks} 次，等待新文章發布
            </div>
            ` : ''}
        </div>` : ''}

        ${Object.keys(this.config.CHANNEL_CONFIGS).length > 0 ? `
        <div class="section">
            <div class="section-title">📺 Discord 頻道監控詳情</div>
            <div class="channel-stats">
                ${Object.entries(this.config.CHANNEL_CONFIGS).map(([channelId, config]) => {
                    const stats = this.unifiedState.discord.channelStats[channelId] || {};
                    return `
                    <div class="channel-card">
                        <div class="channel-name">${config.name || `頻道 ${channelId}`}</div>
                        <div class="channel-detail">
                            <span>關鍵字:</span>
                            <span>${config.keywords.join(', ')}</span>
                        </div>
                        <div class="channel-detail">
                            <span>處理訊息:</span>
                            <span>${stats.messagesProcessed || 0}</span>
                        </div>
                        <div class="channel-detail">
                            <span>檢測次數:</span>
                            <span>${stats.keywordsDetected || 0}</span>
                        </div>
                        <div class="channel-detail">
                            <span>通話次數:</span>
                            <span>${stats.callsMade || 0}</span>
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
                <div class="command">!ig-accounts - 檢查帳號狀態</div>
                ${this.config.BLOG_NOTIFICATION_CHANNEL_ID ? `
                <div class="command">!blog-status - 博客監控狀態</div>
                <div class="command">!blog-check - 手動檢查博客</div>
                ` : ''}
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
        const igStatus = this.getInstagramStatus(); // 使用安全的方法
        
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
                user_id: igStatus.targetUserId,
                available_accounts: igStatus.availableAccounts,
                total_accounts: igStatus.totalAccounts,
                daily_requests: igStatus.dailyRequests,
                max_daily_requests: igStatus.maxDailyRequests,
                invalid_cookie_accounts: igStatus.invalidCookieAccounts
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
        const igStatus = this.getInstagramStatus(); // 使用安全的方法
        
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