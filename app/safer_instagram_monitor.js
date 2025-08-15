// 平衡安全Instagram監控 - 修改版本

const https = require('https');

// 平衡安全配置：保持檢測頻率但增強安全性
const BALANCED_SAFE_CONFIG = {
    // 恢復原來的間隔設定 (不要極保守)
    minInterval: 120,             // 2分鐘最小間隔 (恢復原設定)
    maxInterval: 300,             // 5分鐘最大間隔 (恢復原設定)
    maxRequestsPerAccount: 200,   // 每日200次 (恢復原設定)
    maxDailyRequests: 500,        // 全系統每日500次 (恢復原設定)
    
    // 保留的安全特性
    sleepHours: [2, 3, 4, 5, 6],  // 睡眠時段：完全停止監控
    lowActivityHours: [0, 1, 7, 8, 23], // 低活躍度時段
    autoStartMonitoring: false,   // 手動啟動
    preloadUserIds: true,         // 預載入用戶ID
    
    // 簡化的錯誤處理：一錯就停用帳號
    maxConsecutiveErrors: 1,      // 1次錯誤就停用帳號
    accountRotationSuccess: 2,    // 2次成功就輪換帳號
    
    // 隨機化配置
    enableRandomDelay: true,
    randomDelayMin: 10,           // 10秒最小隨機延遲
    randomDelayMax: 60,           // 1分鐘最大隨機延遲
    
    // 用戶ID緩存
    userIdCacheHours: 168,        // 7天緩存時間
};

class BalancedSafeInstagramMonitor {
    constructor(notificationCallback = null) {
        console.log('🔧 [Balanced Safe] 初始化平衡安全Instagram監控...');
        
        this.userAgents = [
            'Instagram 302.0.0.23.113 Android (33/13; 420dpi; 1080x2400; samsung; SM-G991B; o1s; exynos2100; en_US; 492113219)',
            'Instagram 299.0.0.51.109 Android (32/12; 440dpi; 1080x2340; OnePlus; CPH2423; OP515FL1; qcom; en_US; 486741830)',
            'Instagram 301.0.0.29.124 Android (33/13; 480dpi; 1080x2400; Xiaomi; 2201116SG; lisa; qcom; en_US; 491671575)',
            'Instagram 300.1.0.23.111 Android (31/12; 420dpi; 1080x2400; google; Pixel 6; oriole; google; en_US; 489553847)'
        ];
        
        this.accounts = this.loadAccounts();
        this.dailyRequestCount = 0;
        this.dailyDate = this.getJapanDateString();
        this.accountStats = new Map();
        this.isMonitoring = false;
        this.monitoringTimeout = null;
        this.notificationCallback = notificationCallback;
        this.accountSessions = new Map();
        
        // 簡化的帳號管理：只追蹤是否停用
        this.disabledAccounts = new Set(); // 停用的帳號ID
        this.successCountTracker = new Map(); // 追蹤成功次數以進行輪換
        
        // 用戶ID管理
        this.preloadedUserIds = new Map(); // username -> {userId, loadTime, account}
        
        this.initializeStats();
        this.initializeAccountSessions();
        
        console.log('✅ [Balanced Safe] 平衡安全監控初始化完成');
        console.log('🔧 [手動啟動] 監控需要手動使用 !ig-start 開始');
        console.log('📊 [配置] 間隔: 2-5分鐘, 睡眠: 02:00-06:00, 輪換: 每2次成功');
    }
    
    // 獲取日本時間
    getJapanDateString() {
        return new Date().toLocaleDateString('zh-TW', { 
            timeZone: 'Asia/Tokyo',
            year: 'numeric',
            month: '2-digit', 
            day: '2-digit'
        });
    }
    
    getJapanHour() {
        const timeString = new Date().toLocaleString('zh-TW', { 
            timeZone: 'Asia/Tokyo',
            hour: '2-digit',
            hour12: false
        });
        return parseInt(timeString.split(':')[0]);
    }
    
    // 檢查是否在睡眠時段
    isInSleepHours() {
        const hour = this.getJapanHour();
        return BALANCED_SAFE_CONFIG.sleepHours.includes(hour);
    }
    
    // 檢查是否在低活躍時段
    isInLowActivityHours() {
        const hour = this.getJapanHour();
        return BALANCED_SAFE_CONFIG.lowActivityHours.includes(hour);
    }
    
    // 載入帳號配置
    loadAccounts() {
        console.log('🔧 [Balanced Safe] 載入帳號配置...');
        const accounts = [];
        
        // 支援多帳號格式
        for (let i = 1; i <= 10; i++) {
            const accountData = process.env[`IG_ACCOUNT_${i}`];
            if (accountData) {
                const parts = accountData.split('|');
                if (parts.length >= 3) {
                    const sessionId = parts[0].trim();
                    const csrfToken = parts[1].trim();
                    const dsUserId = parts[2].trim();
                    
                    if (sessionId.length > 0 && csrfToken.length > 0 && dsUserId.length > 0) {
                        accounts.push({
                            id: `account_${i}`,
                            sessionId: sessionId,
                            csrfToken: csrfToken,
                            dsUserId: dsUserId
                        });
                        console.log(`✅ [Balanced Safe] 帳號 ${i} 載入成功`);
                    }
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
            console.log('✅ [Balanced Safe] 單帳號配置載入成功');
        }
        
        console.log(`🔐 [Balanced Safe] 載入 ${accounts.length} 個Instagram帳號`);
        
        if (accounts.length === 0) {
            throw new Error('未找到任何有效的Instagram帳號配置');
        }
        
        return accounts;
    }
    
    // 初始化帳號sessions
    initializeAccountSessions() {
        this.accounts.forEach(account => {
            const sessionData = {
                deviceId: 'android-' + Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join(''),
                uuid: 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                    const r = Math.random() * 16 | 0;
                    const v = c == 'x' ? r : (r & 0x3 | 0x8);
                    return v.toString(16);
                }),
                userAgent: this.userAgents[Math.floor(Math.random() * this.userAgents.length)],
                cookies: `sessionid=${account.sessionId}; csrftoken=${account.csrfToken}; ds_user_id=${account.dsUserId}`,
                currentInterval: BALANCED_SAFE_CONFIG.minInterval
            };
            
            this.accountSessions.set(account.id, sessionData);
        });
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
            
            this.successCountTracker.set(account.id, 0);
        });
    }
    
    // 預先載入目標用戶ID
    async preloadUserIds(usernames) {
        if (!Array.isArray(usernames)) {
            usernames = [usernames];
        }
        
        console.log(`🔄 [預載] 開始預載入 ${usernames.length} 個用戶ID...`);
        
        for (const username of usernames) {
            // 檢查是否已有有效緩存
            const cached = this.preloadedUserIds.get(username);
            if (cached) {
                const cacheAge = Date.now() - cached.loadTime;
                if (cacheAge < BALANCED_SAFE_CONFIG.userIdCacheHours * 3600 * 1000) {
                    console.log(`📋 [預載] ${username} 使用現有緩存 (${Math.round(cacheAge/3600000)}小時前)`);
                    continue;
                }
            }
            
            // 尝试預載入
            await this.attemptUserIdPreload(username);
            
            // 預載入間增加延遲
            await new Promise(resolve => setTimeout(resolve, 10000 + Math.random() * 15000)); // 10-25秒
        }
        
        console.log('✅ [預載] 用戶ID預載入完成');
    }
    
    // 嘗試預載入單個用戶ID
    async attemptUserIdPreload(username) {
        const account = this.selectBestAccountForPreload();
        if (!account) {
            console.log(`⚠️ [預載] 沒有可用帳號為 ${username} 預載入ID`);
            return;
        }
        
        try {
            console.log(`🔍 [預載] 使用 ${account.id} 預載入 ${username} 的用戶ID...`);
            
            // 添加隨機延遲
            if (BALANCED_SAFE_CONFIG.enableRandomDelay) {
                const delay = BALANCED_SAFE_CONFIG.randomDelayMin + 
                             Math.random() * (BALANCED_SAFE_CONFIG.randomDelayMax - BALANCED_SAFE_CONFIG.randomDelayMin);
                await new Promise(resolve => setTimeout(resolve, delay * 1000));
            }
            
            const accountSession = this.accountSessions.get(account.id);
            const timestamp = Math.floor(Date.now() / 1000);
            
            const response = await this.makeRequest(`https://i.instagram.com/api/v1/users/web_profile_info/?username=${username}`, {
                method: 'GET',
                headers: {
                    'User-Agent': accountSession.userAgent,
                    'Accept': 'application/json',
                    'Cookie': accountSession.cookies,
                    'X-IG-App-Locale': 'en_US',
                    'X-IG-Device-Locale': 'en_US',
                    'X-Pigeon-Session-Id': accountSession.uuid,
                    'X-Pigeon-Rawclienttime': timestamp,
                    'X-IG-Connection-Type': 'WIFI',
                    'X-IG-App-ID': '567067343352427',
                    'X-IG-Device-ID': accountSession.deviceId,
                    'Host': 'i.instagram.com',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive'
                }
            });
            
            if (response.statusCode === 200) {
                const data = JSON.parse(response.data);
                if (data.data?.user?.id) {
                    // 成功載入用戶ID
                    this.preloadedUserIds.set(username, {
                        userId: data.data.user.id,
                        loadTime: Date.now(),
                        account: account.id
                    });
                    
                    console.log(`✅ [預載] ${username} 用戶ID載入成功: ${data.data.user.id}`);
                    this.recordPreloadRequest(account.id, true);
                    return;
                }
            }
            
            console.log(`❌ [預載] ${username} 載入失敗: HTTP ${response.statusCode}`);
            this.recordPreloadRequest(account.id, false, response.statusCode);
            
        } catch (error) {
            console.error(`❌ [預載] ${username} 載入錯誤:`, error.message);
            this.recordPreloadRequest(account.id, false, 0);
        }
    }
    
    // 為預載入選擇帳號
    selectBestAccountForPreload() {
        const availableAccounts = this.accounts.filter(account => {
            return !this.disabledAccounts.has(account.id) && 
                   this.accountStats.get(account.id).dailyRequests < BALANCED_SAFE_CONFIG.maxRequestsPerAccount;
        });
        
        if (availableAccounts.length === 0) {
            return null;
        }
        
        // 選擇使用次數最少的帳號
        return availableAccounts.reduce((best, current) => {
            const bestStats = this.accountStats.get(best.id);
            const currentStats = this.accountStats.get(current.id);
            return currentStats.dailyRequests < bestStats.dailyRequests ? current : best;
        });
    }
    
    // 記錄預載入請求
    recordPreloadRequest(accountId, success, statusCode = null) {
        const stats = this.accountStats.get(accountId);
        if (!stats) return;
        
        stats.lastUsed = Date.now();
        stats.dailyRequests++;
        this.dailyRequestCount++;
        
        if (success) {
            stats.successCount++;
            console.log(`📊 [預載統計] ${accountId}: 成功, 今日${stats.dailyRequests}次請求`);
        } else {
            stats.errorCount++;
            console.log(`❌ [預載錯誤] ${accountId}: 失敗 HTTP ${statusCode}, 今日${stats.dailyRequests}次請求`);
            
            // 一次錯誤就停用帳號
            this.disabledAccounts.add(accountId);
            console.log(`🚫 [帳號停用] ${accountId} 已被停用 (預載入錯誤)`);
        }
    }
    
    // 獲取用戶ID（使用預載入的ID）
    async getUserId(username) {
        const cached = this.preloadedUserIds.get(username);
        if (cached) {
            const cacheAge = Date.now() - cached.loadTime;
            if (cacheAge < BALANCED_SAFE_CONFIG.userIdCacheHours * 3600 * 1000) {
                console.log(`📋 [緩存] 使用預載入的${username}用戶ID (${Math.round(cacheAge/3600000)}小時前)`);
                return cached.userId;
            } else {
                console.log(`⏰ [緩存] ${username}用戶ID緩存已過期`);
                this.preloadedUserIds.delete(username);
            }
        }
        
        console.log(`❌ [用戶ID] ${username} 沒有預載入的用戶ID`);
        return { error: true, statusCode: 0, errorType: 'no_preloaded_user_id' };
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
    
    // 檢查Instagram直播（單請求版本）
    async checkLive(username) {
        // 檢查睡眠時段
        if (this.isInSleepHours()) {
            console.log(`😴 [睡眠模式] 日本時間 ${this.getJapanHour()}:00 - 停止監控`);
            return false;
        }
        
        if (!this.canOperate()) {
            console.log('⏸️ [檢查] 系統限制，跳過檢查');
            return false;
        }
        
        const account = this.selectBestAccount();
        if (!account) {
            console.log('😴 [檢查] 沒有可用帳號');
            return false;
        }
        
        // 獲取預載入的用戶ID
        const userIdResult = await this.getUserId(username);
        if (userIdResult.error) {
            console.log(`❌ [檢查] 無法獲取${username}的用戶ID，請確保已預載入`);
            return false;
        }
        const userId = userIdResult;
        
        const accountSession = this.accountSessions.get(account.id);
        
        try {
            const isLowActivity = this.isInLowActivityHours();
            console.log(`🔍 [檢查] 使用 ${account.id} 檢查 @${username} ${isLowActivity ? '(低活躍時段)' : '(正常時段)'}`);
            
            // 添加隨機延遲
            if (BALANCED_SAFE_CONFIG.enableRandomDelay) {
                const delay = BALANCED_SAFE_CONFIG.randomDelayMin + 
                             Math.random() * (BALANCED_SAFE_CONFIG.randomDelayMax - BALANCED_SAFE_CONFIG.randomDelayMin);
                await new Promise(resolve => setTimeout(resolve, delay * 1000));
            }
            
            const timestamp = Math.floor(Date.now() / 1000);
            const response = await this.makeRequest(`https://i.instagram.com/api/v1/feed/user/${userId}/story/`, {
                method: 'GET',
                headers: {
                    'User-Agent': accountSession.userAgent,
                    'Accept': 'application/json',
                    'Cookie': accountSession.cookies,
                    'X-IG-App-Locale': 'en_US',
                    'X-Pigeon-Session-Id': accountSession.uuid,
                    'X-Pigeon-Rawclienttime': timestamp,
                    'X-IG-App-ID': '567067343352427',
                    'X-IG-Device-ID': accountSession.deviceId,
                    'Host': 'i.instagram.com',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive'
                }
            });
            
            console.log(`📊 [檢查] Story回應: HTTP ${response.statusCode}`);
            
            if (response.statusCode === 200) {
                const data = JSON.parse(response.data);
                this.recordRequest(account.id, true);
                
                // 檢查直播
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
                console.log(`❌ [檢查] Story端點失敗: HTTP ${response.statusCode}`);
                this.recordRequest(account.id, false, response.statusCode);
                return false;
            }
            
        } catch (error) {
            console.error(`❌ [檢查] ${account.id} 失敗: ${error.message}`);
            this.recordRequest(account.id, false, 0);
            return false;
        }
    }
    
    // 計算下次檢查間隔（恢復原來的設定）
    calculateNextInterval() {
        const hour = this.getJapanHour();
        
        // 睡眠時段檢查
        if (BALANCED_SAFE_CONFIG.sleepHours.includes(hour)) {
            console.log(`😴 [間隔計算] 睡眠時段 ${hour}:00，返回長間隔等待醒來`);
            return 3600; // 1小時後重新檢查是否醒來
        }
        
        let baseInterval = BALANCED_SAFE_CONFIG.minInterval;
        
        // 根據時間段調整間隔 (恢復原來的邏輯)
        if (hour >= 2 && hour <= 6) {
            // 深夜時段 - 10~15分鐘間隔
            baseInterval = 600 + Math.random() * 300; // 10-15分鐘
            console.log('🌙 [深夜模式] 使用10-15分鐘間隔');
        } else if (hour >= 0 && hour <= 1) {
            // 深夜前期 - 3~5分鐘間隔
            baseInterval = 180 + Math.random() * 120; // 3-5分鐘
            console.log('🌃 [深夜前期] 使用3-5分鐘間隔');
        } else if (hour >= 7 && hour <= 8) {
            // 早晨時段 - 3~5分鐘間隔
            baseInterval = 180 + Math.random() * 120; // 3-5分鐘
            console.log('🌅 [早晨時段] 使用3-5分鐘間隔');
        } else if (hour >= 9 && hour <= 23) {
            // 白天活躍時段 - 2~5分鐘間隔 (恢復原設定)
            baseInterval = BALANCED_SAFE_CONFIG.minInterval + 
                          Math.random() * (BALANCED_SAFE_CONFIG.maxInterval - BALANCED_SAFE_CONFIG.minInterval);
            console.log('☀️ [活躍時段] 使用2-5分鐘間隔');
        }
        
        // 檢查可用帳號數量調整
        const availableCount = this.getAvailableAccountsCount();
        if (availableCount <= 1) {
            baseInterval = Math.max(baseInterval * 1.5, BALANCED_SAFE_CONFIG.maxInterval);
            console.log(`⚠️ [帳號保護] 只有${availableCount}個可用帳號，稍微延長間隔`);
        }
        
        const finalInterval = Math.floor(baseInterval);
        console.log(`🎯 [間隔] 最終間隔: ${Math.round(finalInterval/60)}分${finalInterval%60}秒`);
        
        return finalInterval;
    }
    
    // 選擇最佳帳號
    selectBestAccount() {
        const availableAccounts = this.accounts.filter(account => {
            const stats = this.accountStats.get(account.id);
            return !this.disabledAccounts.has(account.id) && 
                   stats.dailyRequests < BALANCED_SAFE_CONFIG.maxRequestsPerAccount;
        });
        
        if (availableAccounts.length === 0) {
            console.log('😴 [帳號選擇] 沒有可用帳號 - 全部已停用或達到限制');
            return null;
        }
        
        // 選擇使用次數最少的帳號
        const bestAccount = availableAccounts.reduce((best, current) => {
            const bestStats = this.accountStats.get(best.id);
            const currentStats = this.accountStats.get(current.id);
            return currentStats.dailyRequests < bestStats.dailyRequests ? current : best;
        });
        
        console.log(`🔄 [帳號選擇] 使用: ${bestAccount.id} (可用: ${availableAccounts.length}/${this.accounts.length})`);
        return bestAccount;
    }
    
    // 檢查是否可以運行
    canOperate() {
        const todayJapan = this.getJapanDateString();
        if (this.dailyDate !== todayJapan) {
            this.resetDailyCounters();
        }
        
        if (this.dailyRequestCount >= BALANCED_SAFE_CONFIG.maxDailyRequests) {
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
        console.log('🌅 [重置] 每日計數器已重置 (日本時間)');
    }
    
    // 記錄請求結果（簡化版本：一錯就停用）
    recordRequest(accountId, success, statusCode = null) {
        const stats = this.accountStats.get(accountId);
        if (!stats) return;
        
        stats.lastUsed = Date.now();
        stats.dailyRequests++;
        this.dailyRequestCount++;
        
        if (success) {
            stats.successCount++;
            
            // 追蹤成功次數進行輪換
            const successCount = this.successCountTracker.get(accountId) + 1;
            this.successCountTracker.set(accountId, successCount);
            
            // 每2次成功就輪換帳號
            if (successCount >= BALANCED_SAFE_CONFIG.accountRotationSuccess) {
                console.log(`🔄 [輪換] ${accountId} 已成功${successCount}次，重置計數促進輪換`);
                this.successCountTracker.set(accountId, 0);
                // 不需要強制冷卻，只是重置計數讓其他帳號有機會被選中
            }
            
        } else {
            stats.errorCount++;
            console.log(`❌ [錯誤] ${accountId}: HTTP ${statusCode || '未知'}`);
            
            // 一次錯誤就停用帳號
            this.disabledAccounts.add(accountId);
            console.log(`🚫 [帳號停用] ${accountId} 已被停用 (一次錯誤即停用策略)`);
            
            // 檢查是否所有帳號都被停用
            if (this.disabledAccounts.size >= this.accounts.length) {
                console.log('🛑 [全部停用] 所有帳號都已停用，將停止監控');
                this.autoStopAllAccountsDisabled();
            }
        }
        
        const successRate = stats.successCount + stats.errorCount > 0 ? 
            Math.round(stats.successCount / (stats.successCount + stats.errorCount) * 100) : 0;
            
        console.log(`📊 [統計] ${accountId}: 今日${stats.dailyRequests}次, 成功率${successRate}%, 成功連續${this.successCountTracker.get(accountId)}次`);
    }
    
    // 自動停止監控（所有帳號都停用時）
    async autoStopAllAccountsDisabled() {
        if (!this.isMonitoring) return;
        
        try {
            if (this.notificationCallback) {
                const stopMessage = `🛑 **Instagram監控自動停止** 

**停止原因:** 所有帳號都已停用
**停止時間:** ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' })}

📋 **帳號狀態:**
• 總帳號數: ${this.accounts.length}
• 停用帳號: ${this.disabledAccounts.size}
• 可用帳號: 0

**停用策略:** 一次錯誤即停用帳號
**今日使用:** ${this.dailyRequestCount}/${BALANCED_SAFE_CONFIG.maxDailyRequests} 次請求

🔧 **解決方案:**
1. 檢查並更新失效的cookies
2. 使用 \`!ig-start\` 重新啟動監控
3. 使用 \`!ig-accounts\` 查看詳細帳號狀態

⚡ **監控已完全停止，等待手動重新啟動！**`;
                
                await this.notificationCallback(stopMessage, 'auto_stop', 'Instagram');
            }
        } catch (error) {
            console.error('❌ [自動停止] 發送通知失敗:', error.message);
        }
        
        this.stopMonitoring();
        console.log('🛑 [自動停止] 所有帳號停用，監控已自動停止');
    }
    
    // 獲取可用帳號數量
    getAvailableAccountsCount() {
        return this.accounts.filter(account => {
            const stats = this.accountStats.get(account.id);
            return !this.disabledAccounts.has(account.id) && 
                   stats.dailyRequests < BALANCED_SAFE_CONFIG.maxRequestsPerAccount;
        }).length;
    }
    
    // 啟動監控（手動啟動版本）
    async startMonitoring(username, onLiveDetected) {
        console.log(`🔧 [Balanced Safe] 手動啟動監控，目標: @${username}`);
        
        if (this.isMonitoring) {
            console.log('⚠️ [監控] 已在運行中');
            return false;
        }
        
        // 檢查是否在睡眠時段
        if (this.isInSleepHours()) {
            console.log(`😴 [睡眠時段] 當前日本時間 ${this.getJapanHour()}:00 在睡眠時段`);
            if (this.notificationCallback) {
                await this.notificationCallback(`😴 **監控延遲啟動**

當前是睡眠時段 (${this.getJapanHour()}:00)，監控將在日本時間 07:00 自動開始

🛌 **睡眠時段:** 02:00-06:00 (完全停止)
🌅 **醒來時間:** 07:00 (自動恢復監控)

監控系統已準備就緒，等待合適時機開始...`, 'sleep_delay', 'Instagram');
            }
        }
        
        // 預載入用戶ID
        console.log(`🔄 [預載] 開始預載入 @${username} 的用戶ID...`);
        await this.preloadUserIds([username]);
        
        // 檢查預載入是否成功
        const preloaded = this.preloadedUserIds.get(username);
        if (!preloaded) {
            console.log(`❌ [預載] ${username} 預載入失敗，無法啟動監控`);
            if (this.notificationCallback) {
                await this.notificationCallback(`❌ **監控啟動失敗**

無法預載入 @${username} 的用戶ID

可能原因：
• Instagram帳號認證失效
• 用戶名不存在或私人帳號
• 網絡連接問題

請檢查帳號狀態並重試`, 'preload_failed', 'Instagram');
            }
            return false;
        }
        
        console.log(`✅ [預載] @${username} 用戶ID預載入成功: ${preloaded.userId}`);
        
        // 清除之前的監控循環
        if (this.monitoringTimeout) {
            clearTimeout(this.monitoringTimeout);
            this.monitoringTimeout = null;
        }
        
        this.isMonitoring = true;
        let isLiveNow = false;
        
        console.log('🚀 [Balanced Safe] 平衡安全Instagram監控已啟動');
        console.log(`🛌 [睡眠時段] ${BALANCED_SAFE_CONFIG.sleepHours.join(', ')}:00 完全停止監控`);
        console.log(`🔐 [預載入] 用戶ID已預載入，每次檢查只需1個請求`);
        console.log(`📊 [配置] 間隔: ${BALANCED_SAFE_CONFIG.minInterval/60}-${BALANCED_SAFE_CONFIG.maxInterval/60}分鐘 (恢復原設定)`);
        console.log(`🔄 [輪換] 每${BALANCED_SAFE_CONFIG.accountRotationSuccess}次成功輪換帳號`);
        console.log(`🚫 [錯誤處理] 一次錯誤即停用帳號`);
        
        const monitorLoop = async () => {
            if (!this.isMonitoring) {
                console.log('⏹️ [監控循環] 監控已停止，退出循環');
                return;
            }
            
            // 檢查睡眠時段
            if (this.isInSleepHours()) {
                const currentHour = this.getJapanHour();
                console.log(`😴 [睡眠模式] 日本時間 ${currentHour}:00 - 監控暫停`);
                
                // 計算到醒來時間的間隔
                let wakeUpHour = 7; // 07:00醒來
                let hoursToWakeUp = wakeUpHour - currentHour;
                if (hoursToWakeUp <= 0) hoursToWakeUp += 24; // 隔夜情況
                
                const sleepInterval = hoursToWakeUp * 3600; // 轉換為秒
                console.log(`😴 [睡眠] ${hoursToWakeUp}小時後醒來 (${wakeUpHour}:00)`);
                
                this.monitoringTimeout = setTimeout(monitorLoop, sleepInterval * 1000);
                return;
            }
            
            console.log(`🔄 [監控循環] 開始新檢查 - ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' })}`);
            
            try {
                const currentlyLive = await this.checkLive(username);
                
                // 檢查狀態變化
                if (currentlyLive && !isLiveNow) {
                    isLiveNow = true;
                    console.log('🔴 [監控] 檢測到直播開始!');
                    if (onLiveDetected) {
                        try {
                            await onLiveDetected();
                        } catch (error) {
                            console.error('❌ [直播通知] 發送失敗:', error.message);
                        }
                    }
                } else if (!currentlyLive && isLiveNow) {
                    isLiveNow = false;
                    console.log('⚫ [監控] 直播已結束');
                }
                
                // 檢查是否需要停止
                if (!this.isMonitoring) {
                    console.log('🛑 [監控循環] 監控已被停止，退出循環');
                    return;
                }
                
                // 計算下次檢查間隔
                const nextInterval = this.calculateNextInterval();
                const nextCheckTime = new Date(Date.now() + nextInterval * 1000).toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' });
                console.log(`⏰ [監控] 下次檢查: ${Math.round(nextInterval/60)}分${nextInterval%60}秒後 (${nextCheckTime})`);
                
                // 顯示狀態
                const availableCount = this.getAvailableAccountsCount();
                const disabledCount = this.disabledAccounts.size;
                
                console.log(`📊 [狀態] 可用帳號: ${availableCount}/${this.accounts.length}, 停用: ${disabledCount}, 今日請求: ${this.dailyRequestCount}/${BALANCED_SAFE_CONFIG.maxDailyRequests}`);
                console.log(`🕐 [日本時間] ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' })} (${this.isInLowActivityHours() ? '低活躍' : '正常'}時段)`);
                
                // 設置下次檢查
                this.monitoringTimeout = setTimeout(monitorLoop, nextInterval * 1000);
                
            } catch (error) {
                console.error('❌ [監控] 循環錯誤:', error.message);
                
                // 錯誤時使用更長間隔重試
                if (this.isMonitoring) {
                    const errorInterval = Math.max(BALANCED_SAFE_CONFIG.maxInterval * 2, 600); // 至少10分鐘
                    console.log(`⚠️ [錯誤恢復] ${Math.round(errorInterval/60)}分鐘後重試`);
                    this.monitoringTimeout = setTimeout(monitorLoop, errorInterval * 1000);
                }
            }
        };
        
        // 發送啟動通知
        if (this.notificationCallback) {
            const availableCount = this.getAvailableAccountsCount();
            const startMessage = `🚀 **平衡安全Instagram監控已啟動** 

**目標用戶:** @${username}
**用戶ID:** ${preloaded.userId} ✅
**預載入帳號:** ${preloaded.account}

**🔐 帳號狀態:**
• 可用帳號: ${availableCount}/${this.accounts.length}
• 停用帳號: ${this.disabledAccounts.size}

**⏰ 監控時程 (日本時間):**
• 😴 睡眠時段: ${BALANCED_SAFE_CONFIG.sleepHours.join(', ')}:00 (完全停止)
• 🌅 低活躍時段: ${BALANCED_SAFE_CONFIG.lowActivityHours.join(', ')}:00 (較長間隔)
• ☀️ 正常時段: 其他時間 (2-5分鐘間隔)

**🛡️ 平衡安全特性:**
• 每次檢查只需1個API請求 (預載入用戶ID)
• 每日限制: ${BALANCED_SAFE_CONFIG.maxDailyRequests}次總請求
• 每帳號限制: ${BALANCED_SAFE_CONFIG.maxRequestsPerAccount}次
• 隨機延遲: ${BALANCED_SAFE_CONFIG.randomDelayMin}-${BALANCED_SAFE_CONFIG.randomDelayMax}秒
• 🔄 帳號輪換: 每${BALANCED_SAFE_CONFIG.accountRotationSuccess}次成功輪換
• 🚫 嚴格錯誤處理: 一次錯誤即停用帳號

🔄 監控循環將在合適時機開始...`;
            
            await this.notificationCallback(startMessage, 'monitor_start', 'Instagram');
        }
        
        // 初始延遲啟動
        const initialDelay = this.isInSleepHours() ? 
            this.calculateSleepDelay() : 
            (60 + Math.random() * 120); // 1-3分鐘初始延遲
            
        console.log(`⏳ [監控] ${Math.round(initialDelay/60)}分鐘後開始首次檢查`);
        this.monitoringTimeout = setTimeout(monitorLoop, initialDelay * 1000);
        
        return true;
    }
    
    // 計算睡眠延遲
    calculateSleepDelay() {
        const currentHour = this.getJapanHour();
        let wakeUpHour = 7;
        let hoursToWakeUp = wakeUpHour - currentHour;
        if (hoursToWakeUp <= 0) hoursToWakeUp += 24;
        return hoursToWakeUp * 3600; // 秒
    }
    
    // 停止監控
    stopMonitoring() {
        this.isMonitoring = false;
        
        if (this.monitoringTimeout) {
            clearTimeout(this.monitoringTimeout);
            this.monitoringTimeout = null;
        }
        
        console.log('⏹️ [Balanced Safe] 監控已停止');
        return true;
    }
    
    // 重置帳號狀態（可選功能，用於手動重置）
    resetAccountStatus() {
        this.disabledAccounts.clear();
        this.successCountTracker.forEach((value, key) => {
            this.successCountTracker.set(key, 0);
        });
        console.log('🔄 [重置] 所有帳號狀態已重置');
    }
    
    // 獲取狀態
    getStatus() {
        const availableCount = this.getAvailableAccountsCount();
        const disabledCount = this.disabledAccounts.size;
        
        let totalRequests = 0;
        let totalSuccessful = 0;
        this.accountStats.forEach(stats => {
            totalRequests += stats.successCount + stats.errorCount;
            totalSuccessful += stats.successCount;
        });
        const successRate = totalRequests > 0 ? Math.round((totalSuccessful / totalRequests) * 100) : 0;
        
        return {
            isMonitoring: this.isMonitoring,
            isLiveNow: false,
            totalAccounts: this.accounts.length,
            availableAccounts: availableCount,
            disabledAccounts: disabledCount,
            dailyRequests: this.dailyRequestCount,
            maxDailyRequests: BALANCED_SAFE_CONFIG.maxDailyRequests,
            accountStatus: availableCount > 0 ? 'active' : 'no_available_accounts',
            totalRequests: totalRequests,
            successfulRequests: totalSuccessful,
            successRate: successRate,
            consecutiveErrors: 0,
            lastCheck: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' }),
            targetUserId: null,
            japanTime: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' }),
            japanHour: this.getJapanHour(),
            currentTimeSlot: this.isInSleepHours() ? 'sleep' : 
                           this.isInLowActivityHours() ? 'low_activity' : 'normal',
            sleepHours: BALANCED_SAFE_CONFIG.sleepHours,
            lowActivityHours: BALANCED_SAFE_CONFIG.lowActivityHours,
            preloadedUsers: Array.from(this.preloadedUserIds.entries()).map(([username, data]) => ({
                username,
                userId: data.userId,
                loadTime: new Date(data.loadTime).toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' }),
                account: data.account,
                cacheAge: Math.round((Date.now() - data.loadTime) / 3600000) // 小時
            })),
            errorHandling: 'one_error_disable',
            rotationStrategy: `every_${BALANCED_SAFE_CONFIG.accountRotationSuccess}_success`,
            accountDetails: Array.from(this.accountStats.entries()).map(([id, stats]) => {
                const successCount = this.successCountTracker.get(id);
                return {
                    id,
                    dailyRequests: stats.dailyRequests,
                    successCount: stats.successCount,
                    errorCount: stats.errorCount,
                    lastUsed: stats.lastUsed ? new Date(stats.lastUsed).toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' }) : 'Never',
                    inCooldown: false, // 不使用冷卻機制
                    isDisabled: this.disabledAccounts.has(id),
                    disabledReason: this.disabledAccounts.has(id) ? 'Error occurred' : null,
                    consecutiveSuccess: successCount,
                    rotationThreshold: BALANCED_SAFE_CONFIG.accountRotationSuccess,
                    nextRotationIn: BALANCED_SAFE_CONFIG.accountRotationSuccess - successCount
                };
            })
        };
    }
}

module.exports = BalancedSafeInstagramMonitor;