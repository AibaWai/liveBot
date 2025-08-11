// 簡化版Instagram監控 - 3帳號輪換 + 90秒間隔
const https = require('https');
const crypto = require('crypto');

// 安全配置 (確保充足的請求額度 + Cookie監控)
const SAFE_CONFIG = {
    minInterval: 90,         // 90秒最小間隔 (活躍時段)
    maxInterval: 180,        // 3分鐘最大間隔
    maxRequestsPerAccount: 300,  // 每個帳號每天300次
    accountCooldownMinutes: 20,  // 基礎冷卻20分鐘 (會動態調整)
    maxDailyRequests: 750,       // 全系統每天750次 (充足緩衝)
    
    // Cookie監控配置
    cookieWarningDays: 3,        // Cookie過期前3天開始警告
    cookieExpireCheckHours: 12,  // 每12小時檢查一次Cookie狀態
    consecutiveFailuresForAlert: 3, // 連續3次失敗後發送提醒
};

class SimplifiedInstagramMonitor {
    constructor() {
        this.accounts = this.loadAccounts();
        this.currentAccountIndex = 0;
        this.dailyRequestCount = 0;
        this.dailyDate = new Date().toDateString();
        this.accountStats = new Map();
        this.cooldownAccounts = new Map();
        this.isMonitoring = false;
        
        // Cookie監控
        this.cookieAlerts = new Map(); // 記錄每個帳號的警告狀態
        this.lastCookieCheck = new Map(); // 記錄最後檢查時間
        this.onCookieAlert = null; // Cookie警告回調函數
        
        this.initializeStats();
        
        // 豐富的User-Agent池
        this.userAgents = [
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
            'Mozilla/5.0 (Linux; Android 14; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
            'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ];
        
        // 啟動Cookie監控
        this.startCookieMonitoring();
    }
    
    // 載入帳號配置
    loadAccounts() {
        const accounts = [];
        
        // 支援多帳號格式: IG_ACCOUNT_1=sessionid|csrftoken|ds_user_id
        for (let i = 1; i <= 10; i++) {
            const accountData = process.env[`IG_ACCOUNT_${i}`];
            if (accountData) {
                const parts = accountData.split('|');
                if (parts.length >= 3) {
                    accounts.push({
                        id: `account_${i}`,
                        sessionId: parts[0].trim(),
                        csrfToken: parts[1].trim(),
                        dsUserId: parts[2].trim()
                    });
                }
            }
        }
        
        // 備用：單帳號配置
        if (accounts.length === 0 && process.env.IG_SESSION_ID) {
            accounts.push({
                id: 'main_account',
                sessionId: process.env.IG_SESSION_ID,
                csrfToken: process.env.IG_CSRF_TOKEN,
                dsUserId: process.env.IG_DS_USER_ID
            });
        }
        
        console.log(`🔐 [簡化監控] 載入 ${accounts.length} 個Instagram帳號`);
        return accounts;
    }
    
    // 初始化統計 (包含Cookie狀態)
    initializeStats() {
        this.accounts.forEach(account => {
            this.accountStats.set(account.id, {
                dailyRequests: 0,
                successCount: 0,
                errorCount: 0,
                lastUsed: 0,
                consecutiveFailures: 0, // 追蹤連續失敗次數
                lastSuccessTime: Date.now(),
                cookieStatus: 'unknown', // unknown, active, warning, expired
                lastCookieCheck: 0
            });
            
            // 初始化Cookie警告狀態
            this.cookieAlerts.set(account.id, {
                warningsSent: 0,
                lastWarningTime: 0,
                isExpired: false
            });
        });
    }
    
    // 選擇最佳帳號
    selectBestAccount() {
        const now = Date.now();
        
        // 過濾可用帳號
        const availableAccounts = this.accounts.filter(account => {
            const stats = this.accountStats.get(account.id);
            const cooldownEnd = this.cooldownAccounts.get(account.id) || 0;
            
            return stats.dailyRequests < SAFE_CONFIG.maxRequestsPerAccount && 
                   now >= cooldownEnd;
        });
        
        if (availableAccounts.length === 0) {
            return null;
        }
        
        // 選擇使用次數最少的帳號
        const bestAccount = availableAccounts.reduce((best, current) => {
            const bestStats = this.accountStats.get(best.id);
            const currentStats = this.accountStats.get(current.id);
            return currentStats.dailyRequests < bestStats.dailyRequests ? current : best;
        });
        
        console.log(`🔄 [帳號輪換] 使用: ${bestAccount.id}`);
        return bestAccount;
    }
    
    // 記錄請求結果 (智能冷卻 + Cookie狀態分析)
    recordRequest(accountId, success, errorType = null) {
        const stats = this.accountStats.get(accountId);
        if (!stats) return;
        
        stats.lastUsed = Date.now();
        stats.dailyRequests++;
        this.dailyRequestCount++;
        
        if (success) {
            stats.successCount++;
            stats.consecutiveFailures = 0; // 重置連續失敗
            stats.lastSuccessTime = Date.now();
            stats.cookieStatus = 'active'; // 成功表示Cookie正常
            
            // 成功時減少現有的冷卻時間
            if (this.cooldownAccounts.has(accountId)) {
                const currentCooldown = this.cooldownAccounts.get(accountId);
                const reducedCooldown = Math.max(Date.now(), currentCooldown - 300000); // 減少5分鐘
                this.cooldownAccounts.set(accountId, reducedCooldown);
            }
        } else {
            stats.errorCount++;
            stats.consecutiveFailures++; // 增加連續失敗次數
            
            // 分析Cookie狀態
            this.analyzeCookieStatus(accountId, errorType, stats.consecutiveFailures);
            
            // 根據錯誤類型和可用帳號數量智能調整冷卻
            const availableAccountsCount = this.accounts.filter(account => {
                const accountStats = this.accountStats.get(account.id);
                const cooldownEnd = this.cooldownAccounts.get(account.id) || 0;
                return accountStats.dailyRequests < SAFE_CONFIG.maxRequestsPerAccount && 
                       Date.now() >= cooldownEnd;
            }).length;
            
            let cooldownMinutes = SAFE_CONFIG.accountCooldownMinutes;
            
            // 如果只剩1個可用帳號，減少冷卻時間
            if (availableAccountsCount <= 1) {
                cooldownMinutes = Math.max(5, cooldownMinutes / 2); // 最少5分鐘
                console.log(`⚠️ [智能調整] 只剩${availableAccountsCount}個可用帳號，縮短冷卻至${cooldownMinutes}分鐘`);
            }
            
            // 根據錯誤類型調整
            if (errorType === 'rate_limit') {
                cooldownMinutes = Math.min(cooldownMinutes * 1.5, 45); // 最多45分鐘
            } else if (errorType === 'forbidden' || errorType === 'unauthorized') {
                cooldownMinutes = Math.min(cooldownMinutes * 2, 60); // 最多1小時
                stats.cookieStatus = 'expired'; // 可能Cookie過期
            }
            
            this.setCooldown(accountId, cooldownMinutes);
        }
        
        const successRate = stats.successCount + stats.errorCount > 0 ? 
            Math.round(stats.successCount / (stats.successCount + stats.errorCount) * 100) : 0;
            
        console.log(`📊 [統計] ${accountId}: 今日${stats.dailyRequests}次, 成功率${successRate}%, Cookie狀態: ${stats.cookieStatus}`);
    }
    
    // 設置帳號冷卻
    setCooldown(accountId, minutes) {
        const cooldownEnd = Date.now() + (minutes * 60 * 1000);
        this.cooldownAccounts.set(accountId, cooldownEnd);
        console.log(`❄️ [冷卻] ${accountId} 冷卻 ${minutes} 分鐘`);
    }
    
    // 檢查是否可以運行
    canOperate() {
        // 檢查每日限制
        const today = new Date().toDateString();
        if (this.dailyDate !== today) {
            this.resetDailyCounters();
        }
        
        if (this.dailyRequestCount >= SAFE_CONFIG.maxDailyRequests) {
            console.log('📊 [限制] 已達每日請求限制');
            return false;
        }
        
        // 檢查可用帳號
        const availableAccount = this.selectBestAccount();
        return availableAccount !== null;
    }
    
    // 重置每日計數器
    resetDailyCounters() {
        this.dailyDate = new Date().toDateString();
        this.dailyRequestCount = 0;
        this.accountStats.forEach(stats => {
            stats.dailyRequests = 0;
        });
        console.log('🌅 [重置] 每日計數器已重置');
    }
    
    // 生成真實的cookies
    generateRealisticCookies(account) {
        const mid = crypto.randomBytes(16).toString('hex');
        const ig_did = crypto.randomUUID();
        
        return [
            `sessionid=${account.sessionId}`,
            `csrftoken=${account.csrfToken}`,
            `ds_user_id=${account.dsUserId}`,
            `mid=${mid}`,
            `ig_did=${ig_did}`,
            'ig_nrcb=1'
        ].join('; ');
    }
    
    // 安全HTTP請求
    makeRequest(url, options) {
        return new Promise((resolve, reject) => {
            const req = https.request(url, options, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    resolve({ 
                        statusCode: res.statusCode, 
                        data 
                    });
                });
            });
            
            req.on('error', reject);
            req.setTimeout(30000, () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });
            
            req.end();
        });
    }
    
    // 檢查Instagram直播
    async checkLive(username) {
        if (!this.canOperate()) {
            console.log('⏸️ [檢查] 系統限制，跳過檢查');
            return false;
        }
        
        const account = this.selectBestAccount();
        if (!account) {
            console.log('😴 [檢查] 沒有可用帳號');
            return false;
        }
        
        try {
            console.log(`🔍 [檢查] 使用 ${account.id} 檢查 @${username}`);
            
            // 智能延遲
            await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));
            
            const userAgent = this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
            const cookies = this.generateRealisticCookies(account);
            
            // 使用安全的API端點
            const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`;
            
            const response = await this.makeRequest(url, {
                method: 'GET',
                headers: {
                    'User-Agent': userAgent,
                    'Accept': '*/*',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Cookie': cookies,
                    'X-CSRFToken': account.csrfToken,
                    'X-Requested-With': 'XMLHttpRequest',
                    'Referer': `https://www.instagram.com/${username}/`,
                    'Origin': 'https://www.instagram.com'
                }
            });
            
            this.recordRequest(account.id, true);
            
            if (response.statusCode === 200) {
                const data = JSON.parse(response.data);
                
                // 檢查直播狀態 (需要根據實際API回應調整)
                if (data.data?.user) {
                    const user = data.data.user;
                    // 檢查可能的直播指標
                    if (user.is_live || user.broadcast || user.live_broadcast_id) {
                        console.log('🔴 [檢查] 檢測到直播!');
                        return true;
                    }
                }
                
                return false;
            } else {
                throw new Error(`HTTP ${response.statusCode}`);
            }
            
        } catch (error) {
            console.error(`❌ [檢查] ${account.id} 失敗: ${error.message}`);
            
            // 分析錯誤類型
            let errorType = 'network_error';
            if (error.message.includes('401')) errorType = 'unauthorized';
            else if (error.message.includes('403')) errorType = 'forbidden';
            else if (error.message.includes('429')) errorType = 'rate_limit';
            
            this.recordRequest(account.id, false, errorType);
            return false;
        }
    }
    
    // 計算下次檢查間隔 (考慮時間段)
    calculateNextInterval() {
        const hour = new Date().getHours(); // 日本時間
        const availableAccounts = this.accounts.filter(account => {
            const stats = this.accountStats.get(account.id);
            const cooldownEnd = this.cooldownAccounts.get(account.id) || 0;
            return stats.dailyRequests < SAFE_CONFIG.maxRequestsPerAccount && 
                   Date.now() >= cooldownEnd;
        }).length;
        
        let interval = SAFE_CONFIG.minInterval;
        
        // 時間段調整
        if (hour >= 2 && hour <= 6) {
            // 深夜時段 (2am-6am) - 大幅減少檢查
            interval = 600; // 10分鐘間隔
            console.log('🌙 [深夜模式] 使用10分鐘間隔');
        } else if (hour >= 0 && hour <= 1) {
            // 深夜前期 (12am-2am) - 適中間隔
            interval = 300; // 5分鐘間隔
            console.log('🌃 [深夜前期] 使用5分鐘間隔');
        } else if (hour >= 7 && hour <= 8) {
            // 早晨時段 (7am-8am) - 適中間隔
            interval = 180; // 3分鐘間隔
            console.log('🌅 [早晨時段] 使用3分鐘間隔');
        } else if (hour >= 9 && hour <= 23) {
            // 白天活躍時段 (9am-11pm) - 正常間隔
            interval = SAFE_CONFIG.minInterval; // 90秒間隔
            console.log('☀️ [活躍時段] 使用90秒間隔');
        }
        
        // 根據可用帳號調整
        if (availableAccounts <= 1) {
            interval = Math.max(interval, SAFE_CONFIG.maxInterval);
        }
        
        // 隨機化 (±20%)
        const randomFactor = 0.8 + (Math.random() * 0.4);
        interval = Math.floor(interval * randomFactor);
        
        return Math.max(interval, SAFE_CONFIG.minInterval);
    }
    
    // 啟動監控
    async startMonitoring(username, onLiveDetected) {
        if (this.isMonitoring) {
            console.log('⚠️ [監控] 已在運行中');
            return;
        }
        
        this.isMonitoring = true;
        let isLiveNow = false;
        
        console.log('🚀 [簡化監控] 開始Instagram監控');
        console.log(`📊 [配置] 間隔: ${SAFE_CONFIG.minInterval}-${SAFE_CONFIG.maxInterval}秒`);
        console.log(`🔐 [帳號] 總數: ${this.accounts.length}`);
        
        const monitorLoop = async () => {
            if (!this.isMonitoring) return;
            
            try {
                const currentlyLive = await this.checkLive(username);
                
                // 檢查狀態變化
                if (currentlyLive && !isLiveNow) {
                    isLiveNow = true;
                    console.log('🔴 [監控] 檢測到直播開始!');
                    if (onLiveDetected) {
                        await onLiveDetected();
                    }
                } else if (!currentlyLive && isLiveNow) {
                    isLiveNow = false;
                    console.log('⚫ [監控] 直播已結束');
                }
                
                // 計算下次檢查間隔
                const nextInterval = this.calculateNextInterval();
                console.log(`⏰ [監控] 下次檢查: ${Math.round(nextInterval/60)}分鐘後`);
                
                // 顯示狀態
                const availableCount = this.accounts.filter(account => {
                    const stats = this.accountStats.get(account.id);
                    const cooldownEnd = this.cooldownAccounts.get(account.id) || 0;
                    return stats.dailyRequests < SAFE_CONFIG.maxRequestsPerAccount && 
                           Date.now() >= cooldownEnd;
                }).length;
                
                console.log(`📊 [狀態] 可用帳號: ${availableCount}/${this.accounts.length}, 今日請求: ${this.dailyRequestCount}/${SAFE_CONFIG.maxDailyRequests}`);
                
                setTimeout(monitorLoop, nextInterval * 1000);
                
            } catch (error) {
                console.error('❌ [監控] 循環錯誤:', error.message);
                setTimeout(monitorLoop, SAFE_CONFIG.maxInterval * 1000);
            }
        };
        
        // 初始延遲
        const initialDelay = 30 + Math.random() * 60;
        console.log(`⏳ [監控] ${Math.round(initialDelay)}秒後開始首次檢查`);
        setTimeout(monitorLoop, initialDelay * 1000);
    }
    
    // 停止監控
    stopMonitoring() {
        this.isMonitoring = false;
        console.log('⏹️ [監控] 已停止');
    }
    
    // 獲取狀態 (包含Cookie信息)
    getStatus() {
        const availableCount = this.accounts.filter(account => {
            const stats = this.accountStats.get(account.id);
            const cooldownEnd = this.cooldownAccounts.get(account.id) || 0;
            return stats.dailyRequests < SAFE_CONFIG.maxRequestsPerAccount && 
                   Date.now() >= cooldownEnd;
        }).length;
        
        return {
            isMonitoring: this.isMonitoring,
            totalAccounts: this.accounts.length,
            availableAccounts: availableCount,
            dailyRequests: this.dailyRequestCount,
            maxDailyRequests: SAFE_CONFIG.maxDailyRequests,
            cookieStatus: this.getCookieStatusSummary(),
            accountDetails: Array.from(this.accountStats.entries()).map(([id, stats]) => ({
                id,
                dailyRequests: stats.dailyRequests,
                successCount: stats.successCount,
                errorCount: stats.errorCount,
                consecutiveFailures: stats.consecutiveFailures,
                cookieStatus: stats.cookieStatus,
                lastSuccessTime: stats.lastSuccessTime ? new Date(stats.lastSuccessTime).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : 'Never',
                lastUsed: stats.lastUsed ? new Date(stats.lastUsed).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : 'Never',
                inCooldown: this.cooldownAccounts.has(id) && this.cooldownAccounts.get(id) > Date.now(),
                warningsSent: this.cookieAlerts.get(id)?.warningsSent || 0
            }))
        };
    }
    
    // 設置Cookie警告回調
    setCookieAlertCallback(callback) {
        this.onCookieAlert = callback;
    }
    
    // 分析Cookie狀態
    analyzeCookieStatus(accountId, errorType, consecutiveFailures) {
        const stats = this.accountStats.get(accountId);
        if (!stats) return;
        
        let newStatus = stats.cookieStatus;
        
        // 根據錯誤類型判斷Cookie狀態
        if (errorType === 'unauthorized' || errorType === 'forbidden') {
            newStatus = 'expired';
        } else if (errorType === 'challenge_required') {
            newStatus = 'warning';
        } else if (consecutiveFailures >= SAFE_CONFIG.consecutiveFailuresForAlert) {
            newStatus = 'warning';
        }
        
        // 如果狀態發生變化，觸發警告
        if (newStatus !== stats.cookieStatus) {
            stats.cookieStatus = newStatus;
            this.handleCookieStatusChange(accountId, newStatus, errorType);
        }
    }
    
    // 處理Cookie狀態變化
    async handleCookieStatusChange(accountId, newStatus, errorType) {
        const alertInfo = this.cookieAlerts.get(accountId);
        const now = Date.now();
        
        // 避免重複警告 (30分鐘內不重複)
        if (alertInfo && (now - alertInfo.lastWarningTime) < 1800000) {
            return;
        }
        
        let alertMessage = '';
        let alertLevel = 'warning';
        
        switch (newStatus) {
            case 'expired':
                alertMessage = `🚨 **Cookie過期警告**
                
**帳號:** ${accountId}
**狀態:** Cookie可能已過期
**錯誤類型:** ${errorType}
**時間:** ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}

**建議操作:**
1. 重新登入Instagram獲取新Cookie
2. 更新環境變數中的Cookie信息
3. 重新部署應用

⚠️ **影響:** 此帳號將無法繼續監控，請盡快更新！`;
                alertLevel = 'critical';
                alertInfo.isExpired = true;
                break;
                
            case 'warning':
                alertMessage = `⚠️ **Cookie狀態警告**
                
**帳號:** ${accountId}
**狀態:** Cookie可能即將過期
**連續失敗:** ${this.accountStats.get(accountId)?.consecutiveFailures || 0} 次
**時間:** ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}

**建議操作:**
- 密切關注此帳號狀態
- 準備更新Cookie
- 如繼續失敗將升級為過期警告

💡 **提示:** 考慮提前更新Cookie以避免監控中斷`;
                alertLevel = 'warning';
                break;
        }
        
        if (alertMessage && this.onCookieAlert) {
            alertInfo.warningsSent++;
            alertInfo.lastWarningTime = now;
            this.cookieAlerts.set(accountId, alertInfo);
            
            await this.onCookieAlert(alertMessage, alertLevel, accountId);
            console.log(`🔔 [Cookie警告] ${accountId} 狀態: ${newStatus}`);
        }
    }
    
    // 啟動Cookie監控
    startCookieMonitoring() {
        console.log('🍪 [Cookie監控] 啟動定期Cookie狀態檢查');
        
        // 每12小時執行一次全面檢查
        setInterval(async () => {
            await this.performCookieHealthCheck();
        }, SAFE_CONFIG.cookieExpireCheckHours * 3600000);
        
        // 30分鐘後執行首次檢查
        setTimeout(() => {
            this.performCookieHealthCheck();
        }, 1800000);
    }
    
    // 執行Cookie健康檢查
    async performCookieHealthCheck() {
        console.log('🍪 [Cookie檢查] 執行定期健康檢查');
        
        for (const account of this.accounts) {
            const stats = this.accountStats.get(account.id);
            if (!stats) continue;
            
            const timeSinceLastSuccess = Date.now() - stats.lastSuccessTime;
            const hoursSinceSuccess = timeSinceLastSuccess / (1000 * 60 * 60);
            
            // 如果超過24小時沒有成功請求，發送預警
            if (hoursSinceSuccess > 24 && stats.cookieStatus !== 'expired') {
                await this.handleCookieStatusChange(account.id, 'warning', 'long_time_no_success');
            }
            
            // 如果連續失敗超過閾值，升級警告
            if (stats.consecutiveFailures >= SAFE_CONFIG.consecutiveFailuresForAlert) {
                if (stats.cookieStatus === 'active') {
                    await this.handleCookieStatusChange(account.id, 'warning', 'consecutive_failures');
                }
            }
        }
    }
    
    // 獲取Cookie狀態摘要
    getCookieStatusSummary() {
        const statusCounts = {
            active: 0,
            warning: 0,
            expired: 0,
            unknown: 0
        };
        
        this.accounts.forEach(account => {
            const stats = this.accountStats.get(account.id);
            if (stats) {
                statusCounts[stats.cookieStatus] = (statusCounts[stats.cookieStatus] || 0) + 1;
            }
        });
        
        return {
            total: this.accounts.length,
            ...statusCounts,
            overallStatus: this.getOverallCookieStatus(statusCounts)
        };
    }
    
    // 獲取整體Cookie狀態
    getOverallCookieStatus(statusCounts) {
        if (statusCounts.expired > 0) {
            return statusCounts.expired >= this.accounts.length ? 'all_expired' : 'some_expired';
        } else if (statusCounts.warning > 0) {
            return 'warning';
        } else if (statusCounts.active > 0) {
            return 'healthy';
        } else {
            return 'unknown';
        }
    }
    
    // 手動檢查特定帳號Cookie
    async checkAccountCookie(accountId) {
        const account = this.accounts.find(acc => acc.id === accountId);
        if (!account) {
            throw new Error(`帳號 ${accountId} 不存在`);
        }
        
        try {
            console.log(`🍪 [Cookie檢查] 手動檢查 ${accountId}`);
            
            // 執行一個簡單的API請求來測試Cookie
            const userAgent = this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
            const cookies = this.generateRealisticCookies(account);
            
            const response = await this.makeRequest('https://www.instagram.com/api/v1/accounts/current_user/', {
                method: 'GET',
                headers: {
                    'User-Agent': userAgent,
                    'Accept': '*/*',
                    'Cookie': cookies,
                    'X-CSRFToken': account.csrfToken,
                    'X-Requested-With': 'XMLHttpRequest'
                }
            });
            
            const stats = this.accountStats.get(accountId);
            
            if (response.statusCode === 200) {
                stats.cookieStatus = 'active';
                stats.lastSuccessTime = Date.now();
                stats.consecutiveFailures = 0;
                return { status: 'active', message: 'Cookie有效' };
            } else if (response.statusCode === 401 || response.statusCode === 403) {
                stats.cookieStatus = 'expired';
                return { status: 'expired', message: 'Cookie已過期，需要更新' };
            } else {
                stats.cookieStatus = 'warning';
                return { status: 'warning', message: `Cookie狀態可疑 (HTTP ${response.statusCode})` };
            }
            
        } catch (error) {
            console.error(`❌ [Cookie檢查] ${accountId} 檢查失敗:`, error.message);
            return { status: 'error', message: `檢查失敗: ${error.message}` };
        }
    }
}

module.exports = SimplifiedInstagramMonitor;