// 修復版Instagram監控 - 適配2025年8月API變化
const https = require('https');
const crypto = require('crypto');

// 安全配置 (針對新的API限制進行調整)
const SAFE_CONFIG = {
    minInterval: 120,         // 增加到120秒最小間隔
    maxInterval: 300,         // 5分鐘最大間隔
    maxRequestsPerAccount: 200,   // 減少到每個帳號每天200次
    accountCooldownMinutes: 30,   // 增加基礎冷卻到30分鐘
    maxDailyRequests: 500,        // 減少全系統每天500次
    cookieAlertCooldown: 3600000, // Cookie失效提醒冷卻 (1小時)
    rotationThreshold: 5,         // 減少到每個帳號使用5次後強制輪換
    rotationCooldown: 45,         // 增加輪換後的冷卻時間(分鐘)
    retryDelay: 5000,            // 失敗後重試延遲
    maxRetries: 2,               // 最大重試次數
};

class FixedInstagramMonitor {
    constructor(notificationCallback = null) {
        this.accounts = this.loadAccounts();
        this.currentAccountIndex = 0;
        this.dailyRequestCount = 0;
        this.dailyDate = this.getJapanDateString();
        this.accountStats = new Map();
        this.cooldownAccounts = new Map();
        this.isMonitoring = false;
        this.notificationCallback = notificationCallback;
        
        // Cookie失效追蹤
        this.cookieFailureStats = new Map();
        this.lastCookieAlert = new Map();
        
        // 輪換策略追蹤
        this.rotationStats = new Map();
        this.lastUsedAccount = null;
        
        this.initializeStats();
        
        // 更新的User-Agent池 (模擬更真實的瀏覽器)
        this.userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0'
        ];
        
        // Instagram App ID (從網頁版實際抓取)
        this.appIds = [
            '936619743392459',  // 主要App ID
            '1217981644879628', // 備用App ID
            '567067343352427'   // 舊版App ID
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
        
        console.log(`🔐 [修復監控] 載入 ${accounts.length} 個Instagram帳號`);
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
            
            this.cookieFailureStats.set(account.id, {
                consecutiveFailures: 0,
                lastFailureTime: 0,
                isCurrentlyInvalid: false,
                invalidSince: null
            });
            
            this.rotationStats.set(account.id, {
                consecutiveUses: 0,
                lastRotationTime: 0
            });
        });
    }
    
    // 生成真實的設備指紋
    generateDeviceFingerprint() {
        const timestamp = Date.now();
        return {
            deviceId: crypto.randomBytes(16).toString('hex'),
            uuid: crypto.randomUUID(),
            sessionId: crypto.randomBytes(16).toString('hex'),
            timestamp: timestamp,
            // 模擬瀏覽器指紋
            screenResolution: ['1920x1080', '1366x768', '1536x864', '1440x900'][Math.floor(Math.random() * 4)],
            timezone: 'Asia/Tokyo',
            language: 'ja-JP,ja;q=0.9,en;q=0.8'
        };
    }
    
    // 改進的HTTP請求函數
    makeSecureRequest(url, options, retries = 0) {
        return new Promise((resolve, reject) => {
            const req = https.request(url, options, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    console.log(`📊 [HTTP] ${options.method} ${url} -> ${res.statusCode}`);
                    resolve({ 
                        statusCode: res.statusCode, 
                        data: data,
                        headers: res.headers
                    });
                });
            });
            
            req.on('error', (error) => {
                if (retries < SAFE_CONFIG.maxRetries) {
                    console.log(`🔄 [重試] ${retries + 1}/${SAFE_CONFIG.maxRetries}: ${error.message}`);
                    setTimeout(() => {
                        this.makeSecureRequest(url, options, retries + 1)
                            .then(resolve)
                            .catch(reject);
                    }, SAFE_CONFIG.retryDelay * (retries + 1));
                } else {
                    reject(error);
                }
            });
            
            req.setTimeout(30000, () => {
                req.destroy();
                reject(new Error('Request timeout after 30s'));
            });
            
            if (options.body) req.write(options.body);
            req.end();
        });
    }
    
    // 新的獲取用戶ID方法 (使用修復後的端點)
    async getUserIdFixed(username, account) {
        const deviceData = this.generateDeviceFingerprint();
        const userAgent = this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
        const appId = this.appIds[Math.floor(Math.random() * this.appIds.length)];
        
        try {
            // 增加更長的延遲
            await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 5000));
            
            // 構建更完整的cookies字符串
            const cookies = [
                `sessionid=${account.sessionId}`,
                `csrftoken=${account.csrfToken}`,
                `ds_user_id=${account.dsUserId}`,
                `rur="CLN\\05471878062223\\0541756364068:01f7a2e3bf8fa1b4c1b7c8b79b5e4c3e9e8d7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0"`,
                `mid=${deviceData.deviceId.substring(0, 27)}`,
                'ig_did=C9A8B7F6-E5D4-4C3B-A291-8F7E6D5C4B3A'
            ].join('; ');
            
            // 嘗試新的端點方法
            const endpoints = [
                // 方法1: 使用X-IG-App-ID header
                {
                    url: `https://i.instagram.com/api/v1/users/web_profile_info/?username=${username}`,
                    headers: {
                        'User-Agent': userAgent,
                        'Accept': '*/*',
                        'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'Cookie': cookies,
                        'X-IG-App-ID': appId,
                        'X-IG-WWW-Claim': '0',
                        'X-Requested-With': 'XMLHttpRequest',
                        'Sec-Fetch-Dest': 'empty',
                        'Sec-Fetch-Mode': 'cors',
                        'Sec-Fetch-Site': 'same-origin',
                        'Referer': `https://www.instagram.com/${username}/`,
                        'Origin': 'https://www.instagram.com',
                        'Host': 'i.instagram.com',
                        'Connection': 'keep-alive',
                        'Cache-Control': 'no-cache',
                        'Pragma': 'no-cache'
                    }
                },
                // 方法2: 使用圖形API風格
                {
                    url: `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`,
                    headers: {
                        'User-Agent': userAgent,
                        'Accept': 'application/json, text/plain, */*',
                        'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
                        'Cookie': cookies,
                        'X-CSRFToken': account.csrfToken,
                        'X-IG-App-ID': appId,
                        'X-IG-WWW-Claim': '0',
                        'X-Requested-With': 'XMLHttpRequest',
                        'Referer': `https://www.instagram.com/${username}/`,
                        'Origin': 'https://www.instagram.com',
                        'Host': 'www.instagram.com'
                    }
                }
            ];
            
            for (const endpoint of endpoints) {
                try {
                    console.log(`🔍 [嘗試] ${endpoint.url.includes('i.instagram') ? 'i.instagram' : 'www.instagram'} 端點`);
                    
                    const response = await this.makeSecureRequest(endpoint.url, {
                        method: 'GET',
                        headers: endpoint.headers
                    });
                    
                    if (response.statusCode === 200) {
                        const data = JSON.parse(response.data);
                        if (data.data?.user?.id) {
                            console.log(`✅ [成功] 用戶ID: ${data.data.user.id}`);
                            return data.data.user.id;
                        } else if (data.user?.id) {
                            console.log(`✅ [成功] 用戶ID: ${data.user.id}`);
                            return data.user.id;
                        }
                    } else if (response.statusCode === 429) {
                        console.log(`⚠️ [限制] 端點被限制: ${response.statusCode}`);
                        // 如果被限制，等待更長時間
                        await new Promise(resolve => setTimeout(resolve, 10000));
                        continue;
                    } else {
                        console.log(`❌ [失敗] 端點回應: ${response.statusCode}`);
                    }
                    
                    // 在嘗試之間添加延遲
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                } catch (error) {
                    console.log(`❌ [端點錯誤] ${error.message}`);
                    continue;
                }
            }
            
            console.log(`❌ [失敗] 所有端點都無法獲取用戶ID`);
            return null;
            
        } catch (error) {
            console.error('❌ [獲取用戶ID] 錯誤:', error.message);
            return null;
        }
    }
    
    // 改進的直播檢查方法
    async checkLiveFixed(username, userId, account) {
        const deviceData = this.generateDeviceFingerprint();
        const userAgent = this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
        const appId = this.appIds[Math.floor(Math.random() * this.appIds.length)];
        
        try {
            // 增加延遲
            await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));
            
            const cookies = [
                `sessionid=${account.sessionId}`,
                `csrftoken=${account.csrfToken}`,
                `ds_user_id=${account.dsUserId}`,
                `rur="CLN\\05471878062223\\0541756364068:01f7a2e3bf8fa1b4c1b7c8b79b5e4c3e9e8d7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0"`,
                `mid=${deviceData.deviceId.substring(0, 27)}`
            ].join('; ');
            
            // 使用多個檢查端點
            const checkEndpoints = [
                // Story端點 (主要)
                {
                    url: `https://i.instagram.com/api/v1/feed/user/${userId}/story/`,
                    type: 'story'
                },
                // Reel端點 (備用)
                {
                    url: `https://i.instagram.com/api/v1/feed/user/${userId}/`,
                    type: 'feed'
                }
            ];
            
            for (const endpoint of checkEndpoints) {
                try {
                    console.log(`🔍 [檢查] ${endpoint.type} 端點`);
                    
                    const response = await this.makeSecureRequest(endpoint.url, {
                        method: 'GET',
                        headers: {
                            'User-Agent': userAgent,
                            'Accept': 'application/json',
                            'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
                            'Cookie': cookies,
                            'X-IG-App-ID': appId,
                            'X-IG-WWW-Claim': '0',
                            'X-CSRFToken': account.csrfToken,
                            'X-Requested-With': 'XMLHttpRequest',
                            'Referer': `https://www.instagram.com/${username}/`,
                            'Origin': 'https://www.instagram.com',
                            'Host': 'i.instagram.com',
                            'Sec-Fetch-Dest': 'empty',
                            'Sec-Fetch-Mode': 'cors',
                            'Sec-Fetch-Site': 'same-origin'
                        }
                    });
                    
                    if (response.statusCode === 200) {
                        const data = JSON.parse(response.data);
                        
                        // 檢查直播
                        if (endpoint.type === 'story') {
                            // Story端點檢查
                            if (data.broadcast) {
                                console.log('🔴 [直播] Story端點發現直播!');
                                return true;
                            }
                            
                            if (data.reel?.items) {
                                for (const item of data.reel.items) {
                                    if (item.media_type === 4) {
                                        console.log('🔴 [直播] Story項目中發現直播!');
                                        return true;
                                    }
                                }
                            }
                        } else if (endpoint.type === 'feed') {
                            // Feed端點檢查
                            if (data.items) {
                                for (const item of data.items) {
                                    if (item.media_type === 4 || item.product_type === 'igtv') {
                                        console.log('🔴 [直播] Feed中發現直播!');
                                        return true;
                                    }
                                }
                            }
                        }
                        
                        console.log(`⚫ [${endpoint.type}] 無直播`);
                        return false;
                        
                    } else if (response.statusCode === 429) {
                        console.log(`⚠️ [限制] ${endpoint.type}端點被限制`);
                        continue;
                    } else {
                        console.log(`❌ [${endpoint.type}] 端點失敗: ${response.statusCode}`);
                        continue;
                    }
                    
                } catch (error) {
                    console.log(`❌ [${endpoint.type}] 檢查錯誤: ${error.message}`);
                    continue;
                }
            }
            
            return false;
            
        } catch (error) {
            console.error('❌ [直播檢查] 錯誤:', error.message);
            return false;
        }
    }
    
    // 選擇最佳帳號 (與原版相同的輪換邏輯)
    selectBestAccount() {
        const now = Date.now();
        
        const availableAccounts = this.accounts.filter(account => {
            const stats = this.accountStats.get(account.id);
            const cooldownEnd = this.cooldownAccounts.get(account.id) || 0;
            const cookieStats = this.cookieFailureStats.get(account.id);
            
            return stats.dailyRequests < SAFE_CONFIG.maxRequestsPerAccount && 
                   now >= cooldownEnd &&
                   !cookieStats.isCurrentlyInvalid;
        });
        
        if (availableAccounts.length === 0) {
            return null;
        }
        
        // 檢查輪換
        if (this.lastUsedAccount) {
            const rotationStats = this.rotationStats.get(this.lastUsedAccount);
            const shouldRotate = rotationStats.consecutiveUses >= SAFE_CONFIG.rotationThreshold;
            
            if (shouldRotate) {
                console.log(`🔄 [強制輪換] ${this.lastUsedAccount} 已使用${rotationStats.consecutiveUses}次`);
                this.setCooldown(this.lastUsedAccount, SAFE_CONFIG.rotationCooldown);
                rotationStats.consecutiveUses = 0;
                rotationStats.lastRotationTime = now;
                
                const otherAccounts = availableAccounts.filter(acc => acc.id !== this.lastUsedAccount);
                if (otherAccounts.length > 0) {
                    const nextAccount = otherAccounts.reduce((best, current) => {
                        const bestStats = this.accountStats.get(best.id);
                        const currentStats = this.accountStats.get(current.id);
                        return currentStats.dailyRequests < bestStats.dailyRequests ? current : best;
                    });
                    
                    console.log(`🔄 [輪換] ${this.lastUsedAccount} -> ${nextAccount.id}`);
                    return nextAccount;
                }
            }
        }
        
        const bestAccount = availableAccounts.reduce((best, current) => {
            const bestStats = this.accountStats.get(best.id);
            const currentStats = this.accountStats.get(current.id);
            return currentStats.dailyRequests < bestStats.dailyRequests ? current : best;
        });
        
        if (this.lastUsedAccount && this.lastUsedAccount !== bestAccount.id) {
            console.log(`🔄 [切換] ${this.lastUsedAccount} -> ${bestAccount.id}`);
        }
        
        return bestAccount;
    }
    
    // 記錄請求結果
    recordRequest(accountId, success, errorType = null) {
        const stats = this.accountStats.get(accountId);
        if (!stats) return;
        
        stats.lastUsed = Date.now();
        stats.dailyRequests++;
        this.dailyRequestCount++;
        
        const rotationStats = this.rotationStats.get(accountId);
        if (this.lastUsedAccount === accountId) {
            rotationStats.consecutiveUses++;
        } else {
            if (this.lastUsedAccount) {
                const lastRotationStats = this.rotationStats.get(this.lastUsedAccount);
                lastRotationStats.consecutiveUses = 0;
            }
            rotationStats.consecutiveUses = 1;
        }
        this.lastUsedAccount = accountId;
        
        if (success) {
            stats.successCount++;
            this.resetCookieStatus(accountId);
            
            if (this.cooldownAccounts.has(accountId)) {
                const currentCooldown = this.cooldownAccounts.get(accountId);
                const reducedCooldown = Math.max(Date.now(), currentCooldown - 300000);
                this.cooldownAccounts.set(accountId, reducedCooldown);
            }
        } else {
            stats.errorCount++;
            this.checkAndSendCookieAlert(accountId, errorType);
            
            let cooldownMinutes = SAFE_CONFIG.accountCooldownMinutes;
            
            if (errorType === 'rate_limit' || errorType === 'too_many_requests') {
                cooldownMinutes = Math.min(cooldownMinutes * 2, 60);
            } else if (errorType === 'forbidden' || errorType === 'unauthorized') {
                cooldownMinutes = Math.min(cooldownMinutes * 3, 120);
            }
            
            this.setCooldown(accountId, cooldownMinutes);
        }
        
        const successRate = stats.successCount + stats.errorCount > 0 ? 
            Math.round(stats.successCount / (stats.successCount + stats.errorCount) * 100) : 0;
            
        console.log(`📊 [統計] ${accountId}: 今日${stats.dailyRequests}次, 成功率${successRate}%, 連續${rotationStats.consecutiveUses}/${SAFE_CONFIG.rotationThreshold}次`);
    }
    
    // 設置帳號冷卻
    setCooldown(accountId, minutes) {
        const cooldownEnd = Date.now() + (minutes * 60 * 1000);
        this.cooldownAccounts.set(accountId, cooldownEnd);
        console.log(`❄️ [冷卻] ${accountId} 冷卻 ${minutes} 分鐘`);
    }
    
    // 重置Cookie狀態
    resetCookieStatus(accountId) {
        const cookieStats = this.cookieFailureStats.get(accountId);
        if (cookieStats && cookieStats.consecutiveFailures > 0) {
            console.log(`✅ [Cookie恢復] ${accountId} 認證已恢復`);
            cookieStats.consecutiveFailures = 0;
            cookieStats.isCurrentlyInvalid = false;
            cookieStats.invalidSince = null;
        }
    }
    
    // Cookie失效檢查
    async checkAndSendCookieAlert(accountId, errorType) {
        if (errorType !== 'unauthorized' && errorType !== 'forbidden') return;
        
        const cookieStats = this.cookieFailureStats.get(accountId);
        const now = Date.now();
        
        cookieStats.consecutiveFailures++;
        cookieStats.lastFailureTime = now;
        
        if (cookieStats.consecutiveFailures >= 3 && !cookieStats.isCurrentlyInvalid) {
            cookieStats.isCurrentlyInvalid = true;
            cookieStats.invalidSince = now;
            
            const lastAlert = this.lastCookieAlert.get(accountId) || 0;
            if (now - lastAlert > SAFE_CONFIG.cookieAlertCooldown) {
                await this.sendCookieInvalidAlert(accountId);
                this.lastCookieAlert.set(accountId, now);
            }
        }
    }
    
    // 發送Cookie失效提醒
    async sendCookieInvalidAlert(accountId) {
        if (!this.notificationCallback) return;
        
        const account = this.accounts.find(acc => acc.id === accountId);
        const cookieStats = this.cookieFailureStats.get(accountId);
        
        const alertMessage = `🚨 **Instagram帳號認證失效警告** (API更新影響)

**失效帳號:** ${accountId}
**SessionID:** ${account?.sessionId?.substring(0, 12)}****
**失效時間:** ${new Date(cookieStats.invalidSince).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}

⚠️ **可能原因:**
• Instagram於2025年8月更新了API安全檢查
• 需要更新cookies或使用不同的獲取方式
• 帳號可能被暫時限制

🔧 **修復步驟:**
1. 清除瀏覽器緩存和cookies
2. 重新登入Instagram網頁版
3. 從開發者工具獲取新的cookies
4. 更新環境變數並重新部署

📊 **系統已自動切換到其他可用帳號**`;

        try {
            await this.notificationCallback(alertMessage, 'cookie_alert', 'Instagram');
            console.log(`📨 [Cookie提醒] ${accountId} 失效提醒已發送`);
        } catch (error) {
            console.error(`❌ [Cookie提醒] 發送失敗:`, error.message);
        }
    }
    
    // 檢查是否可以運行
    canOperate() {
        const todayJapan = this.getJapanDateString();
        if (this.dailyDate !== todayJapan) {
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
        this.dailyDate = this.getJapanDateString();
        this.dailyRequestCount = 0;
        this.accountStats.forEach(stats => {
            stats.dailyRequests = 0;
        });
        this.rotationStats.forEach(rotationStats => {
            rotationStats.consecutiveUses = 0;
        });
        this.lastUsedAccount = null;
        console.log('🌅 [重置] 每日計數器已重置 (日本時間)');
    }
    
    // 主要的直播檢查函數
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
            console.log(`🔍 [修復檢查] 使用 ${account.id} 檢查 @${username}`);
            
            // 更長的智能延遲
            await new Promise(resolve => setTimeout(resolve, 5000 + Math.random() * 5000));
            
            // 步驟1: 獲取用戶ID (使用修復後的方法)
            const userId = await this.getUserIdFixed(username, account);
            if (!userId) {
                this.recordRequest(account.id, false, 'user_id_failed');
                return false;
            }
            
            // 步驟2: 檢查直播 (使用修復後的方法)
            await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000));
            
            const isLive = await this.checkLiveFixed(username, userId, account);
            
            if (isLive !== null) {
                this.recordRequest(account.id, true);
                return isLive;
            } else {
                this.recordRequest(account.id, false, 'check_failed');
                return false;
            }
            
        } catch (error) {
            console.error(`❌ [修復檢查] ${account.id} 失敗: ${error.message}`);
            
            let errorType = 'network_error';
            if (error.message.includes('401')) {
                errorType = 'unauthorized';
            } else if (error.message.includes('403')) {
                errorType = 'forbidden';
            } else if (error.message.includes('429')) {
                errorType = 'rate_limit';
            } else if (error.message.includes('400')) {
                errorType = 'bad_request';
            }
            
            this.recordRequest(account.id, false, errorType);
            return false;
        }
    }
    
    // 計算下次檢查間隔 (增加間隔以適應新的限制)
    calculateNextInterval() {
        const hour = parseInt(this.getJapanHour());
        const availableAccounts = this.accounts.filter(account => {
            const stats = this.accountStats.get(account.id);
            const cooldownEnd = this.cooldownAccounts.get(account.id) || 0;
            const cookieStats = this.cookieFailureStats.get(account.id);
            return stats.dailyRequests < SAFE_CONFIG.maxRequestsPerAccount && 
                   Date.now() >= cooldownEnd &&
                   !cookieStats.isCurrentlyInvalid;
        }).length;
        
        let interval = SAFE_CONFIG.minInterval;
        
        // 根據日本時間調整間隔 (增加所有間隔)
        if (hour >= 2 && hour <= 6) {
            // 深夜時段 - 15~20分鐘間隔
            interval = 900 + Math.random() * 300; // 15-20分鐘
            console.log('🌙 [深夜模式] 使用15-20分鐘間隔');
        } else if (hour >= 0 && hour <= 1) {
            // 深夜前期 - 8~12分鐘間隔
            interval = 480 + Math.random() * 240; // 8-12分鐘
            console.log('🌃 [深夜前期] 使用8-12分鐘間隔');
        } else if (hour >= 7 && hour <= 8) {
            // 早晨時段 - 5~8分鐘間隔
            interval = 300 + Math.random() * 180; // 5-8分鐘
            console.log('🌅 [早晨時段] 使用5-8分鐘間隔');
        } else if (hour >= 9 && hour <= 23) {
            // 白天活躍時段 - 2~5分鐘間隔
            interval = SAFE_CONFIG.minInterval + Math.random() * (SAFE_CONFIG.maxInterval - SAFE_CONFIG.minInterval);
            console.log('☀️ [活躍時段] 使用2-5分鐘間隔');
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
        
        console.log('🚀 [修復監控] 開始Instagram監控 (適配2025年8月API變化)');
        console.log(`📊 [新配置] 間隔: ${SAFE_CONFIG.minInterval}-${SAFE_CONFIG.maxInterval}秒`);
        console.log(`🔐 [帳號] 總數: ${this.accounts.length}`);
        console.log(`🔄 [輪換策略] 每${SAFE_CONFIG.rotationThreshold}次請求強制輪換，冷卻${SAFE_CONFIG.rotationCooldown}分鐘`);
        console.log(`🕐 [時間] 當前日本時間: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
        console.log(`🛡️ [安全措施] 更長延遲、多端點嘗試、User-Agent輪換`);
        
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
                // 發生錯誤時使用更長的間隔
                setTimeout(monitorLoop, SAFE_CONFIG.maxInterval * 2000);
            }
        };
        
        // 初始延遲 (更長)
        const initialDelay = 60 + Math.random() * 120; // 1-3分鐘
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
        
        const invalidCookieCount = this.accounts.filter(account => {
            const cookieStats = this.cookieFailureStats.get(account.id);
            return cookieStats.isCurrentlyInvalid;
        }).length;
        
        let totalRequests = 0;
        let totalSuccessful = 0;
        this.accountStats.forEach(stats => {
            totalRequests += stats.successCount + stats.errorCount;
            totalSuccessful += stats.successCount;
        });
        const successRate = totalRequests > 0 ? Math.round((totalSuccessful / totalRequests) * 100) : 0;
        
        return {
            isMonitoring: this.isMonitoring,
            isLiveNow: false, // 會在main.js中更新
            totalAccounts: this.accounts.length,
            availableAccounts: availableCount,
            disabledAccounts: invalidCookieCount,
            invalidCookieAccounts: invalidCookieCount,
            dailyRequests: this.dailyRequestCount,
            maxDailyRequests: SAFE_CONFIG.maxDailyRequests,
            accountStatus: availableCount > 0 ? 'active' : 'no_available_accounts',
            totalRequests: totalRequests,
            successfulRequests: totalSuccessful,
            successRate: successRate,
            consecutiveErrors: 0,
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
                    isDisabled: cookieStats.isCurrentlyInvalid,
                    cookieStatus: cookieStats.isCurrentlyInvalid ? 'Invalid' : 'Valid',
                    consecutiveFailures: cookieStats.consecutiveFailures,
                    invalidSince: cookieStats.invalidSince ? new Date(cookieStats.invalidSince).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : null,
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

module.exports = FixedInstagramMonitor;