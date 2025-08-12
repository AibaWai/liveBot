// 簡化版Instagram監控 - 3帳號輪換 + 90秒間隔 + Cookie失效提醒 + 日本時間
const https = require('https');
const crypto = require('crypto');

// 安全配置 (確保充足的請求額度)
const SAFE_CONFIG = {
    minInterval: 90,         // 90秒最小間隔 (活躍時段)
    maxInterval: 180,        // 3分鐘最大間隔
    maxRequestsPerAccount: 300,  // 每個帳號每天300次
    accountCooldownMinutes: 20,  // 基礎冷卻20分鐘 (會動態調整)
    maxDailyRequests: 750,       // 全系統每天750次 (充足緩衝)
    cookieAlertCooldown: 3600000, // Cookie失效提醒冷卻 (1小時)
    // 輪換策略配置
    rotationThreshold: 8,    // 每個帳號使用8次後強制輪換
    rotationCooldown: 30,    // 輪換後的冷卻時間(分鐘)
};

class SimplifiedInstagramMonitor {
    constructor(notificationCallback = null) {
        this.accounts = this.loadAccounts();
        this.currentAccountIndex = 0;
        this.dailyRequestCount = 0;
        this.dailyDate = this.getJapanDateString();  // 使用日本時間
        this.accountStats = new Map();
        this.cooldownAccounts = new Map();
        this.isMonitoring = false;
        this.notificationCallback = notificationCallback; // Discord通知回調函數
        
        // Cookie失效追蹤
        this.cookieFailureStats = new Map();
        this.lastCookieAlert = new Map(); // 追蹤每個帳號的最後提醒時間
        
        // 輪換策略追蹤
        this.rotationStats = new Map(); // 追蹤每個帳號的連續使用次數
        this.lastUsedAccount = null;     // 最後使用的帳號
        
        this.initializeStats();
        
        // 豐富的User-Agent池 (使用old_main.js的方式)
        this.userAgents = [
            'Instagram 302.0.0.23.113 Android (33/13; 420dpi; 1080x2400; samsung; SM-G991B; o1s; exynos2100; en_US; 492113219)',
            'Instagram 299.0.0.51.109 Android (32/12; 440dpi; 1080x2340; OnePlus; CPH2423; OP515FL1; qcom; en_US; 486741830)',
            'Instagram 301.0.0.29.124 Android (33/13; 480dpi; 1080x2400; Xiaomi; 2201116SG; lisa; qcom; en_US; 491671575)',
            'Instagram 300.1.0.23.111 Android (31/12; 420dpi; 1080x2400; google; Pixel 6; oriole; google; en_US; 489553847)'
        ];
    }
    
    // 獲取日本時間的日期字符串
    getJapanDateString() {
        return new Date().toLocaleDateString('ja-JP', { 
            timeZone: 'Asia/Tokyo',
            year: 'numeric',
            month: '2-digit', 
            day: '2-digit'
        });
    }
    
    // 獲取日本時間的小時
    getJapanHour() {
        return new Date().toLocaleString('ja-JP', { 
            timeZone: 'Asia/Tokyo',
            hour: '2-digit',
            hour12: false
        }).split(':')[0];
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
    
    // 初始化統計
    initializeStats() {
        this.accounts.forEach(account => {
            this.accountStats.set(account.id, {
                dailyRequests: 0,
                successCount: 0,
                errorCount: 0,
                lastUsed: 0
            });
            
            // 初始化Cookie失效統計
            this.cookieFailureStats.set(account.id, {
                consecutiveFailures: 0,
                lastFailureTime: 0,
                isCurrentlyInvalid: false,
                invalidSince: null
            });
            
            // 初始化輪換統計
            this.rotationStats.set(account.id, {
                consecutiveUses: 0,
                lastRotationTime: 0
            });
        });
    }
    
    // 檢查並發送Cookie失效提醒
    async checkAndSendCookieAlert(accountId, errorType) {
        if (errorType !== 'unauthorized' && errorType !== 'forbidden') return;
        
        const cookieStats = this.cookieFailureStats.get(accountId);
        const now = Date.now();
        
        // 更新Cookie失效統計
        cookieStats.consecutiveFailures++;
        cookieStats.lastFailureTime = now;
        
        // 如果連續失敗3次且之前沒有標記為失效，標記為失效
        if (cookieStats.consecutiveFailures >= 3 && !cookieStats.isCurrentlyInvalid) {
            cookieStats.isCurrentlyInvalid = true;
            cookieStats.invalidSince = now;
            
            // 檢查是否需要發送提醒（避免重複提醒）
            const lastAlert = this.lastCookieAlert.get(accountId) || 0;
            if (now - lastAlert > SAFE_CONFIG.cookieAlertCooldown) {
                await this.sendCookieInvalidAlert(accountId);
                this.lastCookieAlert.set(accountId, now);
            }
        }
        
        console.log(`🔑 [Cookie檢查] ${accountId}: 連續失敗 ${cookieStats.consecutiveFailures} 次`);
    }
    
    // 發送Cookie失效提醒
    async sendCookieInvalidAlert(accountId) {
        if (!this.notificationCallback) return;
        
        const account = this.accounts.find(acc => acc.id === accountId);
        const cookieStats = this.cookieFailureStats.get(accountId);
        
        const alertMessage = `🚨 **Instagram帳號認證失效警告** 🚨

**失效帳號:** ${accountId}
**SessionID:** ${account?.sessionId?.substring(0, 12)}****
**失效時間:** ${new Date(cookieStats.invalidSince).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
**連續失敗:** ${cookieStats.consecutiveFailures} 次

⚠️ **需要立即處理:**
1. 重新登入Instagram獲取新的cookies
2. 更新環境變數中的認證資訊
3. 重新部署應用程式

📋 **影響範圍:**
• 該帳號無法繼續監控Instagram
• 系統將自動切換到其他可用帳號
• 如果所有帳號都失效，監控將完全停止

🔧 **修復步驟:**
1. 瀏覽器登入 Instagram
2. 開發者工具 → Application → Cookies
3. 複製 sessionid, csrftoken, ds_user_id
4. 更新對應的環境變數
5. 重新啟動應用

⏰ 下次提醒將在1小時後（如果問題未解決）`;

        try {
            await this.notificationCallback(alertMessage, 'cookie_alert', 'Instagram');
            console.log(`📨 [Cookie提醒] ${accountId} 失效提醒已發送`);
        } catch (error) {
            console.error(`❌ [Cookie提醒] 發送失敗:`, error.message);
        }
    }
    
    // 重置Cookie狀態（成功時調用）
    resetCookieStatus(accountId) {
        const cookieStats = this.cookieFailureStats.get(accountId);
        if (cookieStats && cookieStats.consecutiveFailures > 0) {
            console.log(`✅ [Cookie恢復] ${accountId} 認證已恢復正常`);
            
            // 如果之前標記為失效，發送恢復通知
            if (cookieStats.isCurrentlyInvalid && this.notificationCallback) {
                const recoveryMessage = `✅ **Instagram帳號認證已恢復** 

**帳號:** ${accountId}
**恢復時間:** ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
**停機時長:** ${Math.round((Date.now() - cookieStats.invalidSince) / 60000)} 分鐘

🎉 該帳號已重新開始正常工作！`;
                
                this.notificationCallback(recoveryMessage, 'cookie_recovery', 'Instagram').catch(console.error);
            }
            
            // 重置統計
            cookieStats.consecutiveFailures = 0;
            cookieStats.isCurrentlyInvalid = false;
            cookieStats.invalidSince = null;
        }
    }
    
    // 選擇最佳帳號 (新的輪換策略)
    selectBestAccount() {
        const now = Date.now();
        
        // 過濾可用帳號（排除Cookie失效的帳號）
        const availableAccounts = this.accounts.filter(account => {
            const stats = this.accountStats.get(account.id);
            const cooldownEnd = this.cooldownAccounts.get(account.id) || 0;
            const cookieStats = this.cookieFailureStats.get(account.id);
            
            return stats.dailyRequests < SAFE_CONFIG.maxRequestsPerAccount && 
                   now >= cooldownEnd &&
                   !cookieStats.isCurrentlyInvalid; // 排除Cookie失效的帳號
        });
        
        if (availableAccounts.length === 0) {
            return null;
        }
        
        // 檢查當前帳號是否需要強制輪換
        if (this.lastUsedAccount) {
            const rotationStats = this.rotationStats.get(this.lastUsedAccount);
            const shouldRotate = rotationStats.consecutiveUses >= SAFE_CONFIG.rotationThreshold;
            
            if (shouldRotate) {
                console.log(`🔄 [強制輪換] ${this.lastUsedAccount} 已使用${rotationStats.consecutiveUses}次，強制輪換`);
                
                // 設置當前帳號冷卻
                this.setCooldown(this.lastUsedAccount, SAFE_CONFIG.rotationCooldown);
                
                // 重置輪換統計
                rotationStats.consecutiveUses = 0;
                rotationStats.lastRotationTime = now;
                
                // 從可用帳號中排除當前帳號
                const otherAccounts = availableAccounts.filter(acc => acc.id !== this.lastUsedAccount);
                if (otherAccounts.length > 0) {
                    // 選擇使用次數最少的其他帳號
                    const nextAccount = otherAccounts.reduce((best, current) => {
                        const bestStats = this.accountStats.get(best.id);
                        const currentStats = this.accountStats.get(current.id);
                        return currentStats.dailyRequests < bestStats.dailyRequests ? current : best;
                    });
                    
                    console.log(`🔄 [帳號輪換] 從 ${this.lastUsedAccount} 切換到: ${nextAccount.id}`);
                    return nextAccount;
                }
            }
        }
        
        // 如果不需要強制輪換，選擇使用次數最少的帳號
        const bestAccount = availableAccounts.reduce((best, current) => {
            const bestStats = this.accountStats.get(best.id);
            const currentStats = this.accountStats.get(current.id);
            return currentStats.dailyRequests < bestStats.dailyRequests ? current : best;
        });
        
        // 如果選擇了不同的帳號，顯示切換信息
        if (this.lastUsedAccount && this.lastUsedAccount !== bestAccount.id) {
            console.log(`🔄 [帳號切換] 從 ${this.lastUsedAccount} 切換到: ${bestAccount.id}`);
        } else if (!this.lastUsedAccount) {
            console.log(`🔄 [首次選擇] 使用: ${bestAccount.id}`);
        }
        
        return bestAccount;
    }
    
    // 記錄請求結果 (智能冷卻 + Cookie檢查 + 輪換追蹤)
    recordRequest(accountId, success, errorType = null) {
        const stats = this.accountStats.get(accountId);
        if (!stats) return;
        
        stats.lastUsed = Date.now();
        stats.dailyRequests++;
        this.dailyRequestCount++;
        
        // 更新輪換統計
        const rotationStats = this.rotationStats.get(accountId);
        if (this.lastUsedAccount === accountId) {
            // 同一帳號連續使用
            rotationStats.consecutiveUses++;
        } else {
            // 切換到新帳號，重置計數
            if (this.lastUsedAccount) {
                const lastRotationStats = this.rotationStats.get(this.lastUsedAccount);
                lastRotationStats.consecutiveUses = 0;
            }
            rotationStats.consecutiveUses = 1;
        }
        this.lastUsedAccount = accountId;
        
        if (success) {
            stats.successCount++;
            
            // 重置Cookie失效狀態
            this.resetCookieStatus(accountId);
            
            // 成功時減少現有的冷卻時間
            if (this.cooldownAccounts.has(accountId)) {
                const currentCooldown = this.cooldownAccounts.get(accountId);
                const reducedCooldown = Math.max(Date.now(), currentCooldown - 300000); // 減少5分鐘
                this.cooldownAccounts.set(accountId, reducedCooldown);
            }
        } else {
            stats.errorCount++;
            
            // 檢查Cookie失效並發送提醒
            this.checkAndSendCookieAlert(accountId, errorType);
            
            // 根據錯誤類型和可用帳號數量智能調整冷卻
            const availableAccountsCount = this.accounts.filter(account => {
                const accountStats = this.accountStats.get(account.id);
                const cooldownEnd = this.cooldownAccounts.get(account.id) || 0;
                const cookieStats = this.cookieFailureStats.get(account.id);
                return accountStats.dailyRequests < SAFE_CONFIG.maxRequestsPerAccount && 
                       Date.now() >= cooldownEnd &&
                       !cookieStats.isCurrentlyInvalid;
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
                cooldownMinutes = Math.min(cooldownMinutes * 3, 120); // Cookie問題更長冷卻
            }
            
            this.setCooldown(accountId, cooldownMinutes);
        }
        
        const successRate = stats.successCount + stats.errorCount > 0 ? 
            Math.round(stats.successCount / (stats.successCount + stats.errorCount) * 100) : 0;
            
        console.log(`📊 [統計] ${accountId}: 今日${stats.dailyRequests}次, 成功率${successRate}%, 連續使用${rotationStats.consecutiveUses}/${SAFE_CONFIG.rotationThreshold}次`);
    }
    
    // 設置帳號冷卻
    setCooldown(accountId, minutes) {
        const cooldownEnd = Date.now() + (minutes * 60 * 1000);
        this.cooldownAccounts.set(accountId, cooldownEnd);
        console.log(`❄️ [冷卻] ${accountId} 冷卻 ${minutes} 分鐘`);
    }
    
    // 檢查是否可以運行
    canOperate() {
        // 檢查每日限制 (使用日本時間)
        const todayJapan = this.getJapanDateString();
        if (this.dailyDate !== todayJapan) {
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
        this.dailyDate = this.getJapanDateString();
        this.dailyRequestCount = 0;
        this.accountStats.forEach(stats => {
            stats.dailyRequests = 0;
        });
        // 重置輪換統計
        this.rotationStats.forEach(rotationStats => {
            rotationStats.consecutiveUses = 0;
        });
        this.lastUsedAccount = null;
        console.log('🌅 [重置] 每日計數器已重置 (日本時間)');
    }
    
    // 生成設備數據 (使用old_main.js的方法)
    generateDeviceData() {
        return {
            deviceId: 'android-' + Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join(''),
            uuid: 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                const r = Math.random() * 16 | 0;
                const v = c == 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            })
        };
    }
    
    // 安全HTTP請求 (使用old_main.js的方法)
    makeRequest(url, options) {
        return new Promise((resolve, reject) => {
            const req = https.request(url, options, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    resolve({ 
                        statusCode: res.statusCode, 
                        data: data
                    });
                });
            });
            
            req.on('error', reject);
            req.setTimeout(30000, () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });
            
            if (options.body) req.write(options.body);
            req.end();
        });
    }
    
    // 獲取用戶ID (使用old_main.js的成功方法)
    async getUserId(username, account) {
        const deviceData = this.generateDeviceData();
        const sessionData = {
            ...deviceData,
            userAgent: this.userAgents[Math.floor(Math.random() * this.userAgents.length)],
            cookies: `sessionid=${account.sessionId}; csrftoken=${account.csrfToken}; ds_user_id=${account.dsUserId}`
        };
        
        try {
            await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
            
            const timestamp = Math.floor(Date.now() / 1000);
            const response = await this.makeRequest(`https://i.instagram.com/api/v1/users/web_profile_info/?username=${username}`, {
                method: 'GET',
                headers: {
                    'User-Agent': sessionData.userAgent,
                    'Accept': 'application/json',
                    'Cookie': sessionData.cookies,
                    'X-IG-App-Locale': 'en_US',
                    'X-IG-Device-Locale': 'en_US',
                    'X-Pigeon-Session-Id': sessionData.uuid,
                    'X-Pigeon-Rawclienttime': timestamp,
                    'X-IG-Connection-Type': 'WIFI',
                    'X-IG-App-ID': '567067343352427',
                    'X-IG-Device-ID': sessionData.deviceId,
                    'Host': 'i.instagram.com'
                }
            });
            
            if (response.statusCode === 200) {
                const data = JSON.parse(response.data);
                if (data.data?.user?.id) {
                    console.log(`✅ [Instagram] 用戶ID: ${data.data.user.id}`);
                    return data.data.user.id;
                }
            }
            
            console.log(`❌ [Instagram] 獲取用戶ID失敗: ${response.statusCode}`);
            return null;
            
        } catch (error) {
            console.error('❌ [Instagram] 獲取用戶ID錯誤:', error.message);
            return null;
        }
    }
    
    // 檢查Instagram直播 (使用old_main.js的成功方法)
    async checkLive(username) {
        if (!this.canOperate()) {
            console.log('⏸️ [檢查] 系統限制，跳過檢查');
            return false;
        }
        
        const account = this.selectBestAccount();
        if (!account) {
            console.log('😴 [檢查] 沒有可用帳號');
            
            // 檢查是否所有帳號都因Cookie失效而不可用
            const allAccountsInvalid = this.accounts.every(acc => {
                const cookieStats = this.cookieFailureStats.get(acc.id);
                return cookieStats.isCurrentlyInvalid;
            });
            
            if (allAccountsInvalid && this.notificationCallback) {
                const criticalMessage = `🆘 **嚴重警告：所有Instagram帳號認證失效** 

⛔ **監控已完全停止**
🕐 **停止時間:** ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}

🔧 **緊急處理:**
所有帳號的cookies都已失效，需要立即更新認證資訊！

📋 **失效帳號列表:**
${this.accounts.map(acc => `• ${acc.id}: ${acc.sessionId.substring(0, 12)}****`).join('\n')}

⚡ **立即行動:** 請更新所有帳號的cookies並重新部署！`;
                
                try {
                    await this.notificationCallback(criticalMessage, 'critical_alert', 'Instagram');
                } catch (error) {
                    console.error('❌ [緊急提醒] 發送失敗:', error.message);
                }
            }
            
            return false;
        }
        
        try {
            console.log(`🔍 [檢查] 使用 ${account.id} 檢查 @${username}`);
            
            // 智能延遲
            await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));
            
            // 首先獲取用戶ID
            const userId = await this.getUserId(username, account);
            if (!userId) {
                this.recordRequest(account.id, false, 'user_id_failed');
                return false;
            }
            
            // 檢查story端點 (old_main.js的成功方法)
            await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1500));
            
            const deviceData = this.generateDeviceData();
            const sessionData = {
                ...deviceData,
                userAgent: this.userAgents[Math.floor(Math.random() * this.userAgents.length)],
                cookies: `sessionid=${account.sessionId}; csrftoken=${account.csrfToken}; ds_user_id=${account.dsUserId}`
            };
            
            const timestamp = Math.floor(Date.now() / 1000);
            const response = await this.makeRequest(`https://i.instagram.com/api/v1/feed/user/${userId}/story/`, {
                method: 'GET',
                headers: {
                    'User-Agent': sessionData.userAgent,
                    'Accept': 'application/json',
                    'Cookie': sessionData.cookies,
                    'X-IG-App-Locale': 'en_US',
                    'X-Pigeon-Session-Id': sessionData.uuid,
                    'X-Pigeon-Rawclienttime': timestamp,
                    'X-IG-App-ID': '567067343352427',
                    'X-IG-Device-ID': sessionData.deviceId,
                    'Host': 'i.instagram.com'
                }
            });
            
            console.log(`📊 [檢查] Story端點回應: HTTP ${response.statusCode}`);
            
            if (response.statusCode === 200) {
                const data = JSON.parse(response.data);
                this.recordRequest(account.id, true);
                
                // 檢查直播 (old_main.js的邏輯)
                if (data.broadcast) {
                    console.log('🔴 [Instagram] 發現直播!');
                    return true;
                }
                
                if (data.reel?.items) {
                    for (const item of data.reel.items) {
                        if (item.media_type === 4) {
                            console.log('🔴 [Instagram] Reel中發現直播!');
                            return true;
                        }
                    }
                }
                
                console.log('⚫ [檢查] 目前無直播');
                return false;
                
            } else {
                // 分析錯誤類型
                let errorType = 'network_error';
                if (response.statusCode === 401) {
                    errorType = 'unauthorized';
                } else if (response.statusCode === 403) {
                    errorType = 'forbidden';
                } else if (response.statusCode === 429) {
                    errorType = 'rate_limit';
                }
                
                console.log(`❌ [檢查] Story端點失敗: HTTP ${response.statusCode}`);
                this.recordRequest(account.id, false, errorType);
                return false;
            }
            
        } catch (error) {
            console.error(`❌ [檢查] ${account.id} 失敗: ${error.message}`);
            
            // 分析錯誤類型並設置適當的冷卻
            let errorType = 'network_error';
            
            if (error.message.includes('401')) {
                errorType = 'unauthorized';
            } else if (error.message.includes('403')) {
                errorType = 'forbidden';
            } else if (error.message.includes('429')) {
                errorType = 'rate_limit';
            }
            
            this.recordRequest(account.id, false, errorType);
            
            // 如果所有帳號都連續失敗，暫停監控一段時間
            const allAccountsFailing = this.accounts.every(acc => {
                const stats = this.accountStats.get(acc.id);
                const cookieStats = this.cookieFailureStats.get(acc.id);
                return (stats.errorCount > stats.successCount && stats.errorCount >= 3) ||
                       cookieStats.isCurrentlyInvalid;
            });
            
            if (allAccountsFailing) {
                console.log('⚠️ [監控] 所有帳號連續失敗，暫停監控30分鐘');
                this.stopMonitoring();
                setTimeout(() => {
                    console.log('🔄 [監控] 嘗試重新啟動監控');
                    this.startMonitoring(username);
                }, 30 * 60 * 1000); // 30分鐘後重試
            }
            
            return false;
        }
    }
    
    // 計算下次檢查間隔 (根據日本時間調整)
    calculateNextInterval() {
        const hour = parseInt(this.getJapanHour()); // 日本時間的小時
        const availableAccounts = this.accounts.filter(account => {
            const stats = this.accountStats.get(account.id);
            const cooldownEnd = this.cooldownAccounts.get(account.id) || 0;
            const cookieStats = this.cookieFailureStats.get(account.id);
            return stats.dailyRequests < SAFE_CONFIG.maxRequestsPerAccount && 
                   Date.now() >= cooldownEnd &&
                   !cookieStats.isCurrentlyInvalid;
        }).length;
        
        let interval = SAFE_CONFIG.minInterval;
        
        // 根據日本時間調整間隔
        if (hour >= 2 && hour <= 6) {
            // 深夜時段 (2am-6am) - 10~15分鐘間隔
            interval = 600 + Math.random() * 300; // 10-15分鐘
            console.log('🌙 [深夜模式] 使用10-15分鐘間隔');
        } else if (hour >= 0 && hour <= 1) {
            // 深夜前期 (12am-2am) - 3~5分鐘間隔
            interval = 180 + Math.random() * 120; // 3-5分鐘
            console.log('🌃 [深夜前期] 使用3-5分鐘間隔');
        } else if (hour >= 7 && hour <= 8) {
            // 早晨時段 (7am-8am) - 3~5分鐘間隔
            interval = 180 + Math.random() * 120; // 3-5分鐘
            console.log('🌅 [早晨時段] 使用3-5分鐘間隔');
        } else if (hour >= 9 && hour <= 23) {
            // 白天活躍時段 (9am-11pm) - 90~180秒間隔
            interval = SAFE_CONFIG.minInterval + Math.random() * (SAFE_CONFIG.maxInterval - SAFE_CONFIG.minInterval);
            console.log('☀️ [活躍時段] 使用90-180秒間隔');
        }
        
        // 根據可用帳號調整
        if (availableAccounts <= 1) {
            interval = Math.max(interval, SAFE_CONFIG.maxInterval);
        }
        
        // 最小間隔限制
        interval = Math.max(interval, SAFE_CONFIG.minInterval);
        
        return Math.floor(interval);
    }
    
    // 啟動監控
    async startMonitoring(username, onLiveDetected) {
        if (this.isMonitoring) {
            console.log('⚠️ [監控] 已在運行中');
            return;
        }
        
        this.isMonitoring = true;
        let isLiveNow = false;
        
        console.log('🚀 [簡化監控] 開始Instagram監控 (日本時間)');
        console.log(`📊 [配置] 間隔: ${SAFE_CONFIG.minInterval}-${SAFE_CONFIG.maxInterval}秒`);
        console.log(`🔐 [帳號] 總數: ${this.accounts.length}`);
        console.log(`🔄 [輪換策略] 每${SAFE_CONFIG.rotationThreshold}次請求強制輪換，冷卻${SAFE_CONFIG.rotationCooldown}分鐘`);
        console.log(`🕐 [時間] 當前日本時間: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
        
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
                const nextCheckTime = new Date(Date.now() + nextInterval * 1000).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
                console.log(`⏰ [監控] 下次檢查: ${Math.round(nextInterval/60)}分鐘後 (${nextCheckTime})`);
                
                // 顯示狀態
                const availableCount = this.accounts.filter(account => {
                    const stats = this.accountStats.get(account.id);
                    const cooldownEnd = this.cooldownAccounts.get(account.id) || 0;
                    const cookieStats = this.cookieFailureStats.get(account.id);
                    return stats.dailyRequests < SAFE_CONFIG.maxRequestsPerAccount && 
                           Date.now() >= cooldownEnd &&
                           !cookieStats.isCurrentlyInvalid;
                }).length;
                
                console.log(`📊 [狀態] 可用帳號: ${availableCount}/${this.accounts.length}, 今日請求: ${this.dailyRequestCount}/${SAFE_CONFIG.maxDailyRequests}`);
                console.log(`🕐 [日本時間] ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
                
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
    
    // 獲取狀態
    getStatus() {
        const availableCount = this.accounts.filter(account => {
            const stats = this.accountStats.get(account.id);
            const cooldownEnd = this.cooldownAccounts.get(account.id) || 0;
            const cookieStats = this.cookieFailureStats.get(account.id);
            return stats.dailyRequests < SAFE_CONFIG.maxRequestsPerAccount && 
                   Date.now() >= cooldownEnd &&
                   !cookieStats.isCurrentlyInvalid;
        }).length;
        
        // 計算Cookie失效的帳號數量
        const invalidCookieCount = this.accounts.filter(account => {
            const cookieStats = this.cookieFailureStats.get(account.id);
            return cookieStats.isCurrentlyInvalid;
        }).length;
        
        // 計算成功率
        let totalRequests = 0;
        let totalSuccessful = 0;
        this.accountStats.forEach(stats => {
            totalRequests += stats.successCount + stats.errorCount;
            totalSuccessful += stats.successCount;
        });
        const successRate = totalRequests > 0 ? Math.round((totalSuccessful / totalRequests) * 100) : 0;
        
        return {
            isMonitoring: this.isMonitoring,
            isLiveNow: false, // 這個值會在main.js中更新
            totalAccounts: this.accounts.length,
            availableAccounts: availableCount,
            disabledAccounts: invalidCookieCount, // 重命名以保持向後兼容
            invalidCookieAccounts: invalidCookieCount,
            dailyRequests: this.dailyRequestCount,
            maxDailyRequests: SAFE_CONFIG.maxDailyRequests,
            accountStatus: availableCount > 0 ? 'active' : 'no_available_accounts',
            totalRequests: totalRequests,
            successfulRequests: totalSuccessful,
            successRate: successRate,
            consecutiveErrors: 0, // 這個可以根據需要計算
            lastCheck: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
            targetUserId: null,
            japanTime: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
            japanHour: parseInt(this.getJapanHour()),
            accountDetails: Array.from(this.accountStats.entries()).map(([id, stats]) => {
                const cookieStats = this.cookieFailureStats.get(id);
                return {
                    id,
                    dailyRequests: stats.dailyRequests,
                    successCount: stats.successCount,
                    errorCount: stats.errorCount,
                    lastUsed: stats.lastUsed ? new Date(stats.lastUsed).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : 'Never',
                    inCooldown: this.cooldownAccounts.has(id) && this.cooldownAccounts.get(id) > Date.now(),
                    isDisabled: cookieStats.isCurrentlyInvalid, // 向後兼容
                    cookieStatus: cookieStats.isCurrentlyInvalid ? 'Invalid' : 'Valid',
                    consecutiveFailures: cookieStats.consecutiveFailures,
                    invalidSince: cookieStats.invalidSince ? new Date(cookieStats.invalidSince).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : null,
                    // 新增輪換信息
                    consecutiveUses: this.rotationStats.get(id)?.consecutiveUses || 0,
                    rotationThreshold: SAFE_CONFIG.rotationThreshold,
                    isCurrentlyUsed: this.lastUsedAccount === id
                };
            })
        };
    }
    
    // 獲取Cookie狀態摘要
    getCookieStatusSummary() {
        const summary = {
            totalAccounts: this.accounts.length,
            validAccounts: 0,
            invalidAccounts: 0,
            recentlyFailed: 0,
            japanTime: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
            details: []
        };
        
        this.accounts.forEach(account => {
            const cookieStats = this.cookieFailureStats.get(account.id);
            const accountSummary = {
                id: account.id,
                sessionId: account.sessionId.substring(0, 12) + '****',
                status: cookieStats.isCurrentlyInvalid ? 'Invalid' : 'Valid',
                consecutiveFailures: cookieStats.consecutiveFailures,
                lastFailure: cookieStats.lastFailureTime ? new Date(cookieStats.lastFailureTime).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : null,
                invalidSince: cookieStats.invalidSince ? new Date(cookieStats.invalidSince).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : null
            };
            
            if (cookieStats.isCurrentlyInvalid) {
                summary.invalidAccounts++;
            } else {
                summary.validAccounts++;
            }
            
            if (cookieStats.consecutiveFailures > 0 && !cookieStats.isCurrentlyInvalid) {
                summary.recentlyFailed++;
            }
            
            summary.details.push(accountSummary);
        });
        
        return summary;
    }
}

module.exports = SimplifiedInstagramMonitor;