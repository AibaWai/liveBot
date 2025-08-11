// 簡化版Instagram監控 - 使用能工作的直播檢測邏輯
const https = require('https');
const crypto = require('crypto');

// 安全配置 (確保充足的請求額度)
const SAFE_CONFIG = {
    minInterval: 90,         // 90秒最小間隔 (活躍時段)
    maxInterval: 180,        // 3分鐘最大間隔
    maxRequestsPerAccount: 300,  // 每個帳號每天300次
    accountCooldownMinutes: 20,  // 基礎冷卻20分鐘 (會動態調整)
    maxDailyRequests: 750,       // 全系統每天750次 (充足緩衝)
};

class SimplifiedInstagramMonitor {
    constructor(notificationCallback = null) {
        this.accounts = this.loadAccounts();
        this.currentAccountIndex = 0;
        this.dailyRequestCount = 0;
        this.dailyDate = new Date().toDateString();
        this.accountStats = new Map();
        this.cooldownAccounts = new Map();
        this.isMonitoring = false;
        this.notificationCallback = notificationCallback;
        
        // 簡化的Cookie失效追蹤
        this.disabledAccounts = new Set();
        this.cookieAlertSent = new Set();
        this.allAccountsDisabledAlertSent = false;
        
        // 緩存用戶ID
        this.userIdCache = new Map();
        
        this.initializeStats();
        
        // 豐富的User-Agent池
        this.userAgents = [
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
            'Mozilla/5.0 (Linux; Android 14; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
            'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ];
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
                        dsUserId: parts[2].trim(),
                        uuid: this.generateUUID(),
                        deviceId: this.generateDeviceId()
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
                dsUserId: process.env.IG_DS_USER_ID,
                uuid: this.generateUUID(),
                deviceId: this.generateDeviceId()
            });
        }
        
        console.log(`🔐 [簡化監控] 載入 ${accounts.length} 個Instagram帳號`);
        return accounts;
    }
    
    // 生成UUID
    generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
    
    // 生成設備ID
    generateDeviceId() {
        return crypto.randomBytes(16).toString('hex');
    }
    
    // 初始化統計
    initializeStats() {
        this.accounts.forEach(account => {
            this.accountStats.set(account.id, {
                dailyRequests: 0,
                successCount: 0,
                errorCount: 0,
                lastUsed: 0,
                consecutiveFailures: 0,
                invalidSince: null
            });
        });
    }
    
    // 停用帳號並發送提醒
    async disableAccount(accountId, errorType) {
        if (this.disabledAccounts.has(accountId)) {
            return;
        }
        
        if (errorType !== 'unauthorized' && errorType !== 'forbidden') {
            return;
        }
        
        this.disabledAccounts.add(accountId);
        const stats = this.accountStats.get(accountId);
        if (stats) {
            stats.invalidSince = Date.now();
        }
        
        console.log(`🚫 [帳號停用] ${accountId} 已停用 (${errorType})`);
        
        if (!this.cookieAlertSent.has(accountId) && this.notificationCallback) {
            const account = this.accounts.find(acc => acc.id === accountId);
            const alertMessage = `🚨 **Instagram帳號認證失效** 

**失效帳號:** ${accountId}
**SessionID:** ${account?.sessionId?.substring(0, 12)}****
**錯誤類型:** ${errorType === 'unauthorized' ? '401 Unauthorized' : '403 Forbidden'}
**處理方式:** 該帳號已自動停用

🔧 **修復步驟:**
1. 瀏覽器重新登入Instagram
2. 複製新的cookies (sessionid, csrftoken, ds_user_id)
3. 更新環境變數 \`${process.env[`IG_ACCOUNT_${accountId.split('_')[1]}`] ? `IG_ACCOUNT_${accountId.split('_')[1]}` : 'IG_SESSION_ID等'}\`
4. 重新部署應用

⚡ 系統已切換到其他可用帳號繼續監控`;

            try {
                await this.notificationCallback(alertMessage, 'cookie_alert', 'Instagram');
                this.cookieAlertSent.add(accountId);
                console.log(`📨 [Cookie提醒] ${accountId} 失效提醒已發送`);
            } catch (error) {
                console.error(`❌ [Cookie提醒] 發送失敗:`, error.message);
            }
        }
        
        if (this.disabledAccounts.size === this.accounts.length && !this.allAccountsDisabledAlertSent) {
            await this.sendAllAccountsDisabledAlert();
        }
    }
    
    // 發送所有帳號失效提醒
    async sendAllAccountsDisabledAlert() {
        if (!this.notificationCallback || this.allAccountsDisabledAlertSent) {
            return;
        }
        
        const criticalMessage = `🆘 **嚴重警告：Instagram監控已完全停止** 

⛔ **所有帳號已停用**
🕐 **停止時間:** ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}

📋 **失效帳號列表:**
${this.accounts.map(acc => `• ${acc.id}: ${acc.sessionId.substring(0, 12)}****`).join('\n')}

🚨 **影響:**
• Instagram直播監控已完全停止
• 無法檢測到任何直播通知
• 需要立即修復所有帳號的cookies

⚡ **緊急處理:**
1. 立即更新所有帳號的cookies
2. 重新部署應用程式
3. 確認監控恢復正常`;

        try {
            await this.notificationCallback(criticalMessage, 'critical_alert', 'Instagram');
            this.allAccountsDisabledAlertSent = true;
            console.log(`📨 [緊急提醒] 所有帳號失效提醒已發送`);
        } catch (error) {
            console.error(`❌ [緊急提醒] 發送失敗:`, error.message);
        }
    }
    
    // 選擇最佳帳號
    selectBestAccount() {
        const now = Date.now();
        
        const availableAccounts = this.accounts.filter(account => {
            const stats = this.accountStats.get(account.id);
            const cooldownEnd = this.cooldownAccounts.get(account.id) || 0;
            
            return !this.disabledAccounts.has(account.id) &&
                   stats.dailyRequests < SAFE_CONFIG.maxRequestsPerAccount && 
                   now >= cooldownEnd;
        });
        
        if (availableAccounts.length === 0) {
            return null;
        }
        
        const bestAccount = availableAccounts.reduce((best, current) => {
            const bestStats = this.accountStats.get(best.id);
            const currentStats = this.accountStats.get(current.id);
            return currentStats.dailyRequests < bestStats.dailyRequests ? current : best;
        });
        
        console.log(`🔄 [帳號輪換] 使用: ${bestAccount.id}`);
        return bestAccount;
    }
    
    // 記錄請求結果
    recordRequest(accountId, success, errorType = null) {
        const stats = this.accountStats.get(accountId);
        if (!stats) return;
        
        stats.lastUsed = Date.now();
        stats.dailyRequests++;
        this.dailyRequestCount++;
        
        if (success) {
            stats.successCount++;
            stats.consecutiveFailures = 0;
            
            if (this.cooldownAccounts.has(accountId)) {
                const currentCooldown = this.cooldownAccounts.get(accountId);
                const reducedCooldown = Math.max(Date.now(), currentCooldown - 300000);
                this.cooldownAccounts.set(accountId, reducedCooldown);
            }
        } else {
            stats.errorCount++;
            stats.consecutiveFailures++;
            
            this.disableAccount(accountId, errorType);
            
            const availableAccountsCount = this.accounts.filter(account => {
                const accountStats = this.accountStats.get(account.id);
                const cooldownEnd = this.cooldownAccounts.get(account.id) || 0;
                return !this.disabledAccounts.has(account.id) &&
                       accountStats.dailyRequests < SAFE_CONFIG.maxRequestsPerAccount && 
                       Date.now() >= cooldownEnd;
            }).length;
            
            let cooldownMinutes = SAFE_CONFIG.accountCooldownMinutes;
            
            if (availableAccountsCount <= 1) {
                cooldownMinutes = Math.max(5, cooldownMinutes / 2);
                console.log(`⚠️ [智能調整] 只剩${availableAccountsCount}個可用帳號，縮短冷卻至${cooldownMinutes}分鐘`);
            }
            
            if (errorType === 'rate_limit') {
                cooldownMinutes = Math.min(cooldownMinutes * 1.5, 45);
            } else if (errorType === 'forbidden') {
                cooldownMinutes = Math.min(cooldownMinutes * 2, 60);
            }
            
            this.setCooldown(accountId, cooldownMinutes);
        }
        
        const successRate = stats.successCount + stats.errorCount > 0 ? 
            Math.round(stats.successCount / (stats.successCount + stats.errorCount) * 100) : 0;
            
        console.log(`📊 [統計] ${accountId}: 今日${stats.dailyRequests}次, 成功率${successRate}%`);
    }
    
    // 設置帳號冷卻
    setCooldown(accountId, minutes) {
        const cooldownEnd = Date.now() + (minutes * 60 * 1000);
        this.cooldownAccounts.set(accountId, cooldownEnd);
        console.log(`❄️ [冷卻] ${accountId} 冷卻 ${minutes} 分鐘`);
    }
    
    // 檢查是否可以運行
    canOperate() {
        const today = new Date().toDateString();
        if (this.dailyDate !== today) {
            this.resetDailyCounters();
        }
        
        if (this.dailyRequestCount >= SAFE_CONFIG.maxDailyRequests) {
            console.log('📊 [限制] 已達每日請求限制');
            return false;
        }
        
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
    
    // 生成完整的cookies
    generateCompleteCookies(account) {
        const mid = crypto.randomBytes(16).toString('hex');
        const ig_did = account.deviceId;
        
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
    
    // 獲取用戶ID
    async getUserId(username) {
        if (this.userIdCache.has(username)) {
            return this.userIdCache.get(username);
        }
        
        const account = this.selectBestAccount();
        if (!account) return null;
        
        try {
            const userAgent = this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
            const cookies = this.generateCompleteCookies(account);
            
            const response = await this.makeRequest(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`, {
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
            
            if (response.statusCode === 200) {
                const data = JSON.parse(response.data);
                if (data.data?.user?.id) {
                    const userId = data.data.user.id;
                    this.userIdCache.set(username, userId);
                    console.log(`✅ [用戶ID] ${username} -> ${userId}`);
                    return userId;
                }
            }
            
            console.log(`❌ [用戶ID] 無法獲取 ${username} 的用戶ID: ${response.statusCode}`);
            return null;
            
        } catch (error) {
            console.error(`❌ [用戶ID] 獲取失敗:`, error.message);
            return null;
        }
    }
    
    // 檢查Instagram直播（使用能工作的方法）
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
            // 獲取用戶ID
            const userId = await this.getUserId(username);
            if (!userId) {
                console.log('❌ [檢查] 無法獲取用戶ID');
                this.recordRequest(account.id, false, 'bad_request');
                return false;
            }
            
            console.log(`🔍 [檢查] 使用 ${account.id} 檢查 @${username} (ID: ${userId})`);
            
            // 智能延遲
            await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1500));
            
            const userAgent = this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
            const cookies = this.generateCompleteCookies(account);
            const timestamp = Math.floor(Date.now() / 1000);
            
            // 使用能工作的story端點
            const response = await this.makeRequest(`https://i.instagram.com/api/v1/feed/user/${userId}/story/`, {
                method: 'GET',
                headers: {
                    'User-Agent': userAgent,
                    'Accept': 'application/json',
                    'Cookie': cookies,
                    'X-IG-App-Locale': 'en_US',
                    'X-Pigeon-Session-Id': account.uuid,
                    'X-Pigeon-Rawclienttime': timestamp,
                    'X-IG-App-ID': '567067343352427',
                    'X-IG-Device-ID': account.deviceId,
                    'Host': 'i.instagram.com'
                }
            });
            
            console.log(`📊 [檢查] 回應: HTTP ${response.statusCode}`);
            
            if (response.statusCode === 200) {
                this.recordRequest(account.id, true);
                
                try {
                    const data = JSON.parse(response.data);
                    
                    // 檢查直播 - 使用能工作的檢測邏輯
                    if (data.broadcast) {
                        console.log('🔴 [檢查] 發現直播 (broadcast)!');
                        return true;
                    }
                    
                    if (data.reel?.items) {
                        for (const item of data.reel.items) {
                            if (item.media_type === 4) { // 直播類型
                                console.log('🔴 [檢查] Reel中發現直播!');
                                return true;
                            }
                        }
                    }
                    
                    console.log('⚫ [檢查] 目前無直播');
                    return false;
                    
                } catch (parseError) {
                    console.log('⚠️ [檢查] JSON解析失敗');
                    return false;
                }
            } else {
                // 處理錯誤狀態碼
                let errorType = 'network_error';
                
                if (response.statusCode === 401) {
                    errorType = 'unauthorized';
                } else if (response.statusCode === 403) {
                    errorType = 'forbidden';
                } else if (response.statusCode === 429) {
                    errorType = 'rate_limit';
                } else if (response.statusCode === 400) {
                    errorType = 'bad_request';
                }
                
                this.recordRequest(account.id, false, errorType);
                return false;
            }
            
        } catch (error) {
            console.error(`❌ [檢查] ${account.id} 失敗: ${error.message}`);
            this.recordRequest(account.id, false, 'network_error');
            return false;
        }
    }
    
    // 計算下次檢查間隔
    calculateNextInterval() {
        const hour = new Date().getHours();
        const availableAccounts = this.accounts.filter(account => {
            const stats = this.accountStats.get(account.id);
            const cooldownEnd = this.cooldownAccounts.get(account.id) || 0;
            return !this.disabledAccounts.has(account.id) &&
                   stats.dailyRequests < SAFE_CONFIG.maxRequestsPerAccount && 
                   Date.now() >= cooldownEnd;
        }).length;
        
        let interval = SAFE_CONFIG.minInterval;
        
        if (hour >= 2 && hour <= 6) {
            interval = 600; // 10分鐘間隔
            console.log('🌙 [深夜模式] 使用10分鐘間隔');
        } else if (hour >= 0 && hour <= 1) {
            interval = 300; // 5分鐘間隔
            console.log('🌃 [深夜前期] 使用5分鐘間隔');
        } else if (hour >= 7 && hour <= 8) {
            interval = 180; // 3分鐘間隔
            console.log('🌅 [早晨時段] 使用3分鐘間隔');
        } else if (hour >= 9 && hour <= 23) {
            interval = SAFE_CONFIG.minInterval; // 90秒間隔
            console.log('☀️ [活躍時段] 使用90秒間隔');
        }
        
        if (availableAccounts <= 1) {
            interval = Math.max(interval, SAFE_CONFIG.maxInterval);
        }
        
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
        
        console.log('🚀 [簡化監控] 開始Instagram監控 (使用Story端點)');
        console.log(`📊 [配置] 間隔: ${SAFE_CONFIG.minInterval}-${SAFE_CONFIG.maxInterval}秒`);
        console.log(`🔐 [帳號] 總數: ${this.accounts.length}`);
        
        const monitorLoop = async () => {
            if (!this.isMonitoring) return;
            
            try {
                const currentlyLive = await this.checkLive(username);
                
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
                
                const nextInterval = this.calculateNextInterval();
                console.log(`⏰ [監控] 下次檢查: ${Math.round(nextInterval/60)}分鐘後`);
                
                const availableCount = this.accounts.filter(account => {
                    const stats = this.accountStats.get(account.id);
                    const cooldownEnd = this.cooldownAccounts.get(account.id) || 0;
                    return !this.disabledAccounts.has(account.id) &&
                           stats.dailyRequests < SAFE_CONFIG.maxRequestsPerAccount && 
                           Date.now() >= cooldownEnd;
                }).length;
                
                console.log(`📊 [狀態] 可用帳號: ${availableCount}/${this.accounts.length}, 已停用: ${this.disabledAccounts.size}, 今日請求: ${this.dailyRequestCount}/${SAFE_CONFIG.maxDailyRequests}`);
                
                setTimeout(monitorLoop, nextInterval * 1000);
                
            } catch (error) {
                console.error('❌ [監控] 循環錯誤:', error.message);
                setTimeout(monitorLoop, SAFE_CONFIG.maxInterval * 1000);
            }
        };
        
        const initialDelay = 30 + Math.random() * 60;
        console.log(`⏳ [監控] ${Math.round(initialDelay)}秒後開始首次檢查`);
        setTimeout(monitorLoop, initialDelay * 1000);
    }
    
    // 停止監控
    stopMonitoring() {
        this.isMonitoring = false;
        console.log('⏹️ [監控] 已停止');
    }
    
    // 獲取狀態
    getStatus() {
        const availableCount = this.accounts.filter(account => {
            const stats = this.accountStats.get(account.id);
            const cooldownEnd = this.cooldownAccounts.get(account.id) || 0;
            return !this.disabledAccounts.has(account.id) &&
                   stats.dailyRequests < SAFE_CONFIG.maxRequestsPerAccount && 
                   Date.now() >= cooldownEnd;
        }).length;
        
        return {
            isMonitoring: this.isMonitoring,
            totalAccounts: this.accounts.length,
            availableAccounts: availableCount,
            disabledAccounts: this.disabledAccounts.size,
            invalidCookieAccounts: this.disabledAccounts.size,
            dailyRequests: this.dailyRequestCount,
            maxDailyRequests: SAFE_CONFIG.maxDailyRequests,
            accountDetails: Array.from(this.accountStats.entries()).map(([id, stats]) => ({
                id,
                dailyRequests: stats.dailyRequests,
                successCount: stats.successCount,
                errorCount: stats.errorCount,
                lastUsed: stats.lastUsed ? new Date(stats.lastUsed).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : 'Never',
                inCooldown: this.cooldownAccounts.has(id) && this.cooldownAccounts.get(id) > Date.now(),
                isDisabled: this.disabledAccounts.has(id),
                cookieStatus: this.disabledAccounts.has(id) ? 'Invalid' : 'Valid',
                consecutiveFailures: stats.consecutiveFailures,
                invalidSince: stats.invalidSince ? new Date(stats.invalidSince).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : null
            }))
        };
    }
    
    // 獲取Cookie狀態摘要（為兼容性保留）
    getCookieStatusSummary() {
        const summary = {
            totalAccounts: this.accounts.length,
            validAccounts: this.accounts.length - this.disabledAccounts.size,
            invalidAccounts: this.disabledAccounts.size,
            recentlyFailed: 0,
            details: []
        };
        
        this.accounts.forEach(account => {
            const stats = this.accountStats.get(account.id);
            const isDisabled = this.disabledAccounts.has(account.id);
            
            const accountSummary = {
                id: account.id,
                sessionId: account.sessionId.substring(0, 12) + '****',
                status: isDisabled ? 'Invalid' : 'Valid',
                consecutiveFailures: stats.consecutiveFailures,
                lastFailure: stats.errorCount > 0 ? new Date(stats.lastUsed).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : null,
                invalidSince: stats.invalidSince ? new Date(stats.invalidSince).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : null
            };
            
            if (stats.consecutiveFailures > 0 && !isDisabled) {
                summary.recentlyFailed++;
            }
            
            summary.details.push(accountSummary);
        });
        
        return summary;
    }
}

module.exports = SimplifiedInstagramMonitor;