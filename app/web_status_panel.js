const express = require('express');
const path = require('path');
const fs = require('fs').promises;

class WebStatusPanel {
    constructor(app, unifiedState, config, client, getInstagramMonitorFn) {
        this.app = app;
        this.unifiedState = unifiedState;
        this.config = config;
        this.client = client;
        this.getInstagramMonitor = getInstagramMonitorFn;
        
        this.templateCache = new Map();
        this.setupStaticFiles();
        this.setupRoutes();
    }
    
    // 設置靜態文件服務
    setupStaticFiles() {
        // 提供CSS和JS文件
        this.app.use('/css', express.static(path.join(__dirname, 'public/css')));
        this.app.use('/js', express.static(path.join(__dirname, 'public/js')));
        this.app.use('/images', express.static(path.join(__dirname, 'public/images')));
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
    
    // 讀取和編譯模板
    async loadTemplate(templateName) {
        if (this.templateCache.has(templateName)) {
            return this.templateCache.get(templateName);
        }
        
        try {
            const templatePath = path.join(__dirname, 'templates', `${templateName}.html`);
            const templateContent = await fs.readFile(templatePath, 'utf8');
            this.templateCache.set(templateName, templateContent);
            return templateContent;
        } catch (error) {
            console.error(`❌ [模板] 載入失敗: ${templateName}`, error.message);
            return null;
        }
    }
    
    // 簡單的模板引擎
    renderTemplate(template, data) {
        let rendered = template;
        
        // 處理簡單變數替換 {{variable}}
        rendered = rendered.replace(/\{\{(\w+)\}\}/g, (match, key) => {
            return data[key] !== undefined ? data[key] : '';
        });
        
        // 處理條件語句 {{#if condition}}...{{/if}}
        rendered = rendered.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, condition, content) => {
            return data[condition] ? content : '';
        });
        
        // 處理否定條件 {{#unless condition}}...{{/unless}}
        rendered = rendered.replace(/\{\{#unless\s+(\w+)\}\}([\s\S]*?)\{\{\/unless\}\}/g, (match, condition, content) => {
            return !data[condition] ? content : '';
        });
        
        // 處理循環 {{#each array}}...{{/each}}
        rendered = rendered.replace(/\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (match, arrayName, itemTemplate) => {
            const array = data[arrayName];
            if (!Array.isArray(array)) return '';
            
            return array.map(item => {
                let itemRendered = itemTemplate;
                // 替換項目屬性
                itemRendered = itemRendered.replace(/\{\{(\w+)\}\}/g, (match, key) => {
                    return item[key] !== undefined ? item[key] : '';
                });
                return itemRendered;
            }).join('');
        });
        
        return rendered;
    }
    
    // 準備模板數據
    prepareTemplateData() {
        const uptime = Math.floor((Date.now() - this.unifiedState.startTime) / 1000);
        const igStatus = this.getInstagramStatus();
        
        // 處理帳號詳情
        const accountDetails = igStatus.accountDetails.map(account => {
            const successRate = account.successCount + account.errorCount > 0 ? 
                Math.round(account.successCount / (account.successCount + account.errorCount) * 100) : 0;
            const cookieStatus = account.cookieStatus || 'Valid';
            const isCurrentlyUsed = account.isCurrentlyUsed;
            
            let statusClass = cookieStatus === 'Invalid' ? 'disabled' : (account.inCooldown ? 'cooldown' : 'active');
            if (isCurrentlyUsed) statusClass += ' current-account';
            
            const statusText = cookieStatus === 'Invalid' ? '🚫 Cookie失效' : 
                             (account.inCooldown ? '❄️ 冷卻中' : 
                             (isCurrentlyUsed ? '🎯 使用中' : '✅ 可用'));
            
            return {
                ...account,
                successRate,
                statusClass,
                statusText,
                rotationWarning: account.consecutiveUses >= (account.rotationThreshold - 2)
            };
        });
        
        // 處理頻道配置
        const channelConfigs = Object.entries(this.config.CHANNEL_CONFIGS).map(([channelId, config]) => {
            const stats = this.unifiedState.discord.channelStats[channelId] || {};
            return {
                id: channelId,
                name: config.name || `頻道 ${channelId}`,
                keywords: config.keywords.join(', '),
                messagesProcessed: stats.messagesProcessed || 0,
                keywordsDetected: stats.keywordsDetected || 0,
                callsMade: stats.callsMade || 0,
                lastDetection: stats.lastDetection || '無'
            };
        });
        
        return {
            // 時間信息
            japanTime: this.getJapanTimeString(),
            japanHour: parseInt(this.getJapanHour()),
            timeSlot: this.getTimeSlotDescription(),
            lastUpdate: this.getJapanTimeString(),
            
            // 系統狀態
            botReady: this.unifiedState.botReady,
            uptimeHours: Math.floor(uptime / 3600),
            uptimeMinutes: Math.floor((uptime % 3600) / 60),
            guildCount: this.client.guilds?.cache.size || 0,
            
            // Instagram狀態
            targetUsername: this.config.TARGET_USERNAME,
            isLiveNow: this.unifiedState.instagram.isLiveNow,
            isMonitoring: igStatus.isMonitoring,
            availableAccounts: igStatus.availableAccounts,
            totalAccounts: igStatus.totalAccounts,
            invalidCookieAccounts: igStatus.invalidCookieAccounts || 0,
            dailyRequests: igStatus.dailyRequests,
            maxDailyRequests: igStatus.maxDailyRequests,
            totalRequests: igStatus.totalRequests || 0,
            consecutiveErrors: igStatus.consecutiveErrors || 0,
            currentAccount: accountDetails.find(acc => acc.isCurrentlyUsed)?.id || '無',
            
            // Discord狀態
            discordChannelCount: Object.keys(this.config.CHANNEL_CONFIGS).length,
            totalMessagesProcessed: this.unifiedState.discord.totalMessagesProcessed,
            totalDetections: this.unifiedState.discord.lastDetections.length,
            
            // 通知統計
            discordMessages: this.unifiedState.notifications.discordMessages,
            phoneCallsMade: this.unifiedState.notifications.phoneCallsMade,
            lastNotification: this.unifiedState.notifications.lastNotification || '無',
            
            // API統計
            apiAccountCount: Object.keys(this.unifiedState.discord.apiUsage).length,
            
            // 詳細數據
            accountDetails,
            channelConfigs
        };
    }
    
    setupRoutes() {
        this.app.use(express.json());
        
        // 主狀態頁面
        this.app.get('/', async (req, res) => {
            try {
                const template = await this.loadTemplate('status');
                if (!template) {
                    return res.status(500).send('模板載入失敗');
                }
                
                const templateData = this.prepareTemplateData();
                const html = this.renderTemplate(template, templateData);
                
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
        
        // Cookie狀態API
        this.app.get('/api/cookies', (req, res) => {
            try {
                const instagramMonitor = this.getInstagramMonitor();
                if (instagramMonitor && typeof instagramMonitor.getCookieStatusSummary === 'function') {
                    const cookieSummary = instagramMonitor.getCookieStatusSummary();
                    res.json(cookieSummary);
                } else {
                    res.status(503).json({ error: 'Cookie status not available' });
                }
            } catch (error) {
                console.error('❌ [Web面板] 獲取Cookie狀態失敗:', error.message);
                res.status(500).json({ error: 'Cookie status error' });
            }
        });
        
        // Instagram詳細狀態API
        this.app.get('/api/instagram', (req, res) => {
            try {
                const igStatus = this.getInstagramStatus();
                res.json(igStatus);
            } catch (error) {
                console.error('❌ [Web面板] 獲取Instagram狀態失敗:', error.message);
                res.status(500).json({ error: 'Instagram status not available' });
            }
        });
        
        // 手動觸發檢查API
        this.app.post('/api/check', async (req, res) => {
            try {
                const instagramMonitor = this.getInstagramMonitor();
                if (instagramMonitor && typeof instagramMonitor.checkLive === 'function') {
                    const isLive = await instagramMonitor.checkLive(this.config.TARGET_USERNAME);
                    res.json({
                        success: true,
                        isLive,
                        timestamp: this.getJapanTimeString()
                    });
                } else {
                    res.status(503).json({ success: false, error: 'Monitor not available' });
                }
            } catch (error) {
                console.error('❌ [手動檢查] 失敗:', error.message);
                res.status(500).json({ success: false, error: error.message });
            }
        });
    }
    
    getSystemStatus() {
        const uptime = Math.floor((Date.now() - this.unifiedState.startTime) / 1000);
        const igStatus = this.getInstagramStatus();
        
        return {
            system: {
                uptime: uptime,
                bot_ready: this.unifiedState.botReady,
                start_time: this.unifiedState.startTime,
                japan_time: this.getJapanTimeString(),
                japan_hour: parseInt(this.getJapanHour()),
                time_slot: this.getTimeSlotDescription()
            },
            instagram: {
                target: this.config.TARGET_USERNAME,
                is_live: this.unifiedState.instagram.isLiveNow,
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
                invalid_cookie_accounts: igStatus.invalidCookieAccounts,
                account_details: igStatus.accountDetails
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
            timestamp: this.getJapanTimeString()
        };
    }
    
    getHealthStatus() {
        const igStatus = this.getInstagramStatus();
        
        return {
            status: this.unifiedState.botReady ? 'healthy' : 'unhealthy',
            bot: this.client.user?.tag || 'Not ready',
            instagram_monitoring: igStatus.isMonitoring,
            discord_channels: Object.keys(this.config.CHANNEL_CONFIGS).length,
            uptime: Math.floor((Date.now() - this.unifiedState.startTime) / 1000),
            japan_time: this.getJapanTimeString(),
            time_slot: this.getTimeSlotDescription()
        };
    }
}

module.exports = WebStatusPanel;