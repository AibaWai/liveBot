// 更安全的Instagram監控 - 模擬old_main.js的成功策略 + 多帳號支援
const https = require('https');

// 更保守的安全配置
const SAFE_CONFIG = {
    minInterval: 120,         // 提高到120秒最小間隔
    maxInterval: 300,         // 提高到5分鐘最大間隔
    maxRequestsPerAccount: 200,   // 降低每日請求限制
    accountCooldownMinutes: 30,   // 增加冷卻時間
    maxDailyRequests: 500,        // 降低全系統每日限制
    cookieAlertCooldown: 3600000, // Cookie失效提醒冷卻 (1小時)
    maxConsecutiveErrors: 3,
    backoffMultiplier: 2,
    maxBackoffInterval: 600,
};

class SaferInstagramMonitor {
    constructor(notificationCallback = null) {
        console.log('🔧 [Debug] 開始初始化SaferInstagramMonitor...');
        
        try {
            // 首先定義 User-Agent池 (必須在其他初始化之前)
            this.userAgents = [
                'Instagram 302.0.0.23.113 Android (33/13; 420dpi; 1080x2400; samsung; SM-G991B; o1s; exynos2100; en_US; 492113219)',
                'Instagram 299.0.0.51.109 Android (32/12; 440dpi; 1080x2340; OnePlus; CPH2423; OP515FL1; qcom; en_US; 486741830)',
                'Instagram 301.0.0.29.124 Android (33/13; 480dpi; 1080x2400; Xiaomi; 2201116SG; lisa; qcom; en_US; 491671575)',
                'Instagram 300.1.0.23.111 Android (31/12; 420dpi; 1080x2400; google; Pixel 6; oriole; google; en_US; 489553847)'
            ];
            
            this.accounts = this.loadAccounts();
            this.currentAccountIndex = 0;
            this.dailyRequestCount = 0;
            this.dailyDate = this.getJapanDateString();
            this.accountStats = new Map();
            this.cooldownAccounts = new Map();
            this.isMonitoring = false;
            this.monitoringTimeout = null;
            this.notificationCallback = notificationCallback;
            
            // Cookie失效追蹤
            this.cookieFailureStats = new Map();
            this.lastCookieAlert = new Map();
            this.allAccountsFailureNotified = false;
            
            // 模擬old_main.js的session策略：每個帳號保持固定的設備數據
            this.accountSessions = new Map();
            
            this.initializeStats();
            this.initializeAccountSessions();
            
            console.log('✅ [Debug] SaferInstagramMonitor初始化完成');
        } catch (error) {
            console.error('❌ [Debug] 初始化失敗:', error.message);
            console.error('❌ [Debug] 堆疊追蹤:', error.stack);
            throw error;
        }
    }
    
    // 獲取日本時間的日期字符串
    getJapanDateString() {
        try {
            return new Date().toLocaleDateString('zh-TW', { 
                timeZone: 'Asia/Tokyo',
                year: 'numeric',
                month: '2-digit', 
                day: '2-digit'
            });
        } catch (error) {
            console.error('❌ [Debug] getJapanDateString錯誤:', error.message);
            // 備用方案
            return new Date().toISOString().split('T')[0];
        }
    }
    
    // 獲取日本時間的小時
    getJapanHour() {
        try {
            const timeString = new Date().toLocaleString('zh-TW', { 
                timeZone: 'Asia/Tokyo',
                hour: '2-digit',
                hour12: false
            });
            return timeString.split(':')[0];
        } catch (error) {
            console.error('❌ [Debug] getJapanHour錯誤:', error.message);
            // 備用方案
            return new Date().getHours().toString();
        }
    }
    
    // 載入帳號配置
    loadAccounts() {
        console.log('🔧 [Debug] 開始載入帳號配置...');
        const accounts = [];
        
        try {
            // 支援多帳號格式
            for (let i = 1; i <= 10; i++) {
                const accountData = process.env[`IG_ACCOUNT_${i}`];
                if (accountData) {
                    console.log(`🔧 [Debug] 發現帳號配置: IG_ACCOUNT_${i}`);
                    console.log(`🔧 [Debug] 帳號 ${i} 原始資料長度: ${accountData.length}`);
                    
                    const parts = accountData.split('|');
                    console.log(`🔧 [Debug] 帳號 ${i} 分割後部分數: ${parts.length}`);
                    
                    if (parts.length >= 3) {
                        const sessionId = parts[0].trim();
                        const csrfToken = parts[1].trim();
                        const dsUserId = parts[2].trim();
                        
                        console.log(`🔧 [Debug] 帳號 ${i} - SessionID長度: ${sessionId.length}, CSRF長度: ${csrfToken.length}, UserID長度: ${dsUserId.length}`);
                        
                        if (sessionId.length > 0 && csrfToken.length > 0 && dsUserId.length > 0) {
                            accounts.push({
                                id: `account_${i}`,
                                sessionId: sessionId,
                                csrfToken: csrfToken,
                                dsUserId: dsUserId
                            });
                            console.log(`✅ [Debug] 帳號 ${i} 載入成功`);
                        } else {
                            console.warn(`⚠️ [Debug] 帳號 ${i} 有空白欄位，跳過`);
                        }
                    } else {
                        console.warn(`⚠️ [Debug] 帳號 ${i} 格式錯誤，需要3個部分，實際: ${parts.length}`);
                        console.warn(`⚠️ [Debug] 帳號 ${i} 原始資料: ${accountData.substring(0, 50)}...`);
                    }
                }
            }
            
            // 備用：單帳號配置
            if (accounts.length === 0) {
                console.log('🔧 [Debug] 未找到多帳號配置，檢查單帳號配置...');
                if (process.env.IG_SESSION_ID && process.env.IG_CSRF_TOKEN && process.env.IG_DS_USER_ID) {
                    accounts.push({
                        id: 'main_account',
                        sessionId: process.env.IG_SESSION_ID,
                        csrfToken: process.env.IG_CSRF_TOKEN,
                        dsUserId: process.env.IG_DS_USER_ID
                    });
                    console.log('✅ [Debug] 單帳號配置載入成功');
                } else {
                    console.warn('⚠️ [Debug] 單帳號配置也不完整');
                }
            }
            
            console.log(`🔐 [安全監控] 最終載入 ${accounts.length} 個Instagram帳號`);
            
            if (accounts.length === 0) {
                throw new Error('未找到任何有效的Instagram帳號配置');
            }
            
            return accounts;
        } catch (error) {
            console.error('❌ [Debug] 載入帳號配置失敗:', error.message);
            throw error;
        }
    }
    
    // 初始化每個帳號的固定session數據（模擬old_main.js策略）
    initializeAccountSessions() {
        console.log('🔧 [Debug] 初始化帳號Sessions...');
        
        this.accounts.forEach(account => {
            try {
                // 為每個帳號生成固定的設備數據，一旦生成就不再改變
                const sessionData = {
                    deviceId: 'android-' + Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join(''),
                    uuid: 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                        const r = Math.random() * 16 | 0;
                        const v = c == 'x' ? r : (r & 0x3 | 0x8);
                        return v.toString(16);
                    }),
                    userAgent: this.userAgents[Math.floor(Math.random() * this.userAgents.length)],
                    cookies: `sessionid=${account.sessionId}; csrftoken=${account.csrfToken}; ds_user_id=${account.dsUserId}`,
                    // 保存用戶ID緩存
                    cachedUserId: null,
                    consecutiveErrors: 0,
                    currentInterval: SAFE_CONFIG.minInterval
                };
                
                this.accountSessions.set(account.id, sessionData);
                console.log(`🔧 [Session初始化] ${account.id}: ${sessionData.deviceId.substring(0, 12)}****`);
            } catch (error) {
                console.error(`❌ [Debug] 初始化${account.id}失敗:`, error.message);
                throw error;
            }
        });
    }
    
    // 初始化統計
    initializeStats() {
        console.log('🔧 [Debug] 初始化統計資料...');
        
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
        });
    }
    
    // 檢查錯誤類型是否為Cookie問題
    isCookieError(statusCode, errorMessage) {
        if (statusCode === 400 || statusCode === 401 || statusCode === 403) {
            return true;
        }
        
        if (errorMessage && typeof errorMessage === 'string') {
            const lowerMessage = errorMessage.toLowerCase();
            return lowerMessage.includes('unauthorized') || 
                   lowerMessage.includes('forbidden') || 
                   lowerMessage.includes('invalid') ||
                   lowerMessage.includes('authentication');
        }
        
        return false;
    }
    
    // 檢查並發送Cookie失效提醒
    async checkAndSendCookieAlert(accountId, errorType, statusCode) {
        if (!this.isCookieError(statusCode, errorType)) return;
        
        const cookieStats = this.cookieFailureStats.get(accountId);
        const accountSession = this.accountSessions.get(accountId);
        const now = Date.now();
        
        cookieStats.consecutiveFailures++;
        cookieStats.lastFailureTime = now;
        accountSession.consecutiveErrors++;
        
        console.log(`🔑 [Cookie檢查] ${accountId}: 檢測到認證錯誤 (HTTP ${statusCode}), 連續失敗 ${cookieStats.consecutiveFailures} 次`);
        
        const failureThreshold = statusCode === 400 ? 1 : 2; // 400錯誤1次就失效，其他2次
        
        if (cookieStats.consecutiveFailures >= failureThreshold && !cookieStats.isCurrentlyInvalid) {
            cookieStats.isCurrentlyInvalid = true;
            cookieStats.invalidSince = now;
            
            console.log(`🚫 [Cookie失效] ${accountId} 已標記為失效 (HTTP ${statusCode})`);
            
            const lastAlert = this.lastCookieAlert.get(accountId) || 0;
            if (now - lastAlert > SAFE_CONFIG.cookieAlertCooldown) {
                await this.sendCookieInvalidAlert(accountId, statusCode);
                this.lastCookieAlert.set(accountId, now);
            }
            
            await this.checkAllAccountsFailure();
        }
    }
    
    // 發送Cookie失效提醒
    async sendCookieInvalidAlert(accountId, statusCode) {
        if (!this.notificationCallback) return;
        
        const account = this.accounts.find(acc => acc.id === accountId);
        const cookieStats = this.cookieFailureStats.get(accountId);
        
        const errorDescription = statusCode === 400 ? 
            '帳號可能被Instagram限制或封鎖' : 
            statusCode === 401 ? 
            'Session過期，需要重新登入' : 
            statusCode === 403 ? 
            '權限不足，可能被暫時限制' : 
            '認證失敗';
        
        const alertMessage = `🚨 **Instagram帳號認證失效警告** 🚨

**失效帳號：** ${accountId}
**SessionID：** ${account?.sessionId?.substring(0, 12)}****
**錯誤代碼：** HTTP ${statusCode}
**錯誤說明：** ${errorDescription}
**失效時間：** ${new Date(cookieStats.invalidSince).toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' })}
**連續失敗：** ${cookieStats.consecutiveFailures} 次

⚠️ **需要立即處理：**
該帳號已被系統自動停用，請更新認證資訊：

🔧 **修復步驟：**
1. 瀏覽器登入 Instagram
2. 開發者工具 → Application → Cookies → instagram.com
3. 複製 sessionid, csrftoken, ds_user_id
4. 更新環境變數 ${accountId.toUpperCase().replace('ACCOUNT_', 'IG_ACCOUNT_')}
5. 重新啟動應用

⏰ 系統將自動切換到其他可用帳號繼續監控`;

        try {
            await this.notificationCallback(alertMessage, 'cookie_alert', 'Instagram');
            console.log(`📨 [Cookie提醒] ${accountId} 失效提醒已發送 (HTTP ${statusCode})`);
        } catch (error) {
            console.error(`❌ [Cookie提醒] 發送失敗:`, error.message);
        }
    }
    
    // 檢查所有帳號是否都失效
    async checkAllAccountsFailure() {
        const allAccountsInvalid = this.accounts.every(acc => {
            const cookieStats = this.cookieFailureStats.get(acc.id);
            return cookieStats.isCurrentlyInvalid;
        });
        
        if (allAccountsInvalid && !this.allAccountsFailureNotified && this.notificationCallback) {
            this.allAccountsFailureNotified = true;
            
            const criticalMessage = `🆘 **緊急警告：所有Instagram帳號已失效** 

⛔ **監控已完全停止**
🕐 **停止時間：** ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' })}

🔧 **緊急處理所需：**
所有帳號的認證資訊都已失效，監控系統已停止！

📋 **失效帳號清單：**
${this.accounts.map(acc => {
    const cookieStats = this.cookieFailureStats.get(acc.id);
    const invalidTime = cookieStats.invalidSince ? 
        new Date(cookieStats.invalidSince).toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' }) : 
        '未知';
    return `• ${acc.id}: ${acc.sessionId.substring(0, 12)}**** (失效時間: ${invalidTime})`;
}).join('\n')}

⚡ **立即行動：** 請更新所有帳號的cookies並重新部署！`;
            
            try {
                await this.notificationCallback(criticalMessage, 'critical_alert', 'Instagram');
                console.log(`📨 [緊急通知] 所有帳號失效通知已發送`);
            } catch (error) {
                console.error(`❌ [緊急通知] 發送失敗:`, error.message);
            }
        }
    }
    
    // 重置Cookie狀態
    resetCookieStatus(accountId) {
        const cookieStats = this.cookieFailureStats.get(accountId);
        const accountSession = this.accountSessions.get(accountId);
        
        if (cookieStats && cookieStats.consecutiveFailures > 0) {
            console.log(`✅ [Cookie恢復] ${accountId} 認證已恢復正常`);
            
            if (cookieStats.isCurrentlyInvalid && this.notificationCallback) {
                const recoveryMessage = `✅ **Instagram帳號認證已恢復** 

**帳號：** ${accountId}
**恢復時間：** ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' })}
**停機時長：** ${Math.round((Date.now() - cookieStats.invalidSince) / 60000)} 分鐘

🎉 該帳號已重新開始正常工作！`;
                
                this.notificationCallback(recoveryMessage, 'cookie_recovery', 'Instagram').catch(console.error);
            }
            
            cookieStats.consecutiveFailures = 0;
            cookieStats.isCurrentlyInvalid = false;
            cookieStats.invalidSince = null;
            
            // 重置帳號session的錯誤計數
            accountSession.consecutiveErrors = 0;
            
            this.allAccountsFailureNotified = false;
        }
    }
    
    // 選擇最佳帳號（模擬old_main.js的輪換策略）
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
        
        // 選擇使用次數最少且錯誤最少的帳號
        const bestAccount = availableAccounts.reduce((best, current) => {
            const bestStats = this.accountStats.get(best.id);
            const currentStats = this.accountStats.get(current.id);
            const bestSession = this.accountSessions.get(best.id);
            const currentSession = this.accountSessions.get(current.id);
            
            // 優先選擇錯誤少的帳號
            if (currentSession.consecutiveErrors < bestSession.consecutiveErrors) {
                return current;
            } else if (currentSession.consecutiveErrors === bestSession.consecutiveErrors) {
                // 錯誤數相同則選擇使用次數少的
                return currentStats.dailyRequests < bestStats.dailyRequests ? current : best;
            }
            return best;
        });
        
        console.log(`🔄 [帳號選擇] 使用: ${bestAccount.id} (錯誤數: ${this.accountSessions.get(bestAccount.id).consecutiveErrors})`);
        return bestAccount;
    }
    
    // 記錄請求結果（模擬old_main.js的動態間隔調整）
    recordRequest(accountId, success, errorInfo = null) {
        const stats = this.accountStats.get(accountId);
        const accountSession = this.accountSessions.get(accountId);
        if (!stats || !accountSession) return;
        
        stats.lastUsed = Date.now();
        stats.dailyRequests++;
        this.dailyRequestCount++;
        
        if (success) {
            stats.successCount++;
            this.resetCookieStatus(accountId);
            
            // 模擬old_main.js的成功後間隔調整（更保守）
            accountSession.consecutiveErrors = 0;
            accountSession.currentInterval = Math.max(
                accountSession.currentInterval * 0.95, // 改為0.95，更保守
                SAFE_CONFIG.minInterval
            );
            
            // 檢查是否需要輪換帳號（每個帳號用5次後輪換）
            if (stats.dailyRequests % 5 === 0) {
                console.log(`🔄 [帳號輪換] ${accountId} 已使用5次，下次將輪換到其他帳號`);
                // 給這個帳號設置短暫冷卻，強制輪換
                this.setCooldown(accountId, 1); // 1分鐘冷卻
            }
            
            // 成功時減少冷卻時間
            if (this.cooldownAccounts.has(accountId)) {
                const currentCooldown = this.cooldownAccounts.get(accountId);
                const reducedCooldown = Math.max(Date.now(), currentCooldown - 300000);
                this.cooldownAccounts.set(accountId, reducedCooldown);
            }
        } else {
            stats.errorCount++;
            accountSession.consecutiveErrors++;
            
            const statusCode = errorInfo?.statusCode || 0;
            const errorType = errorInfo?.errorType || 'unknown';
            
            this.checkAndSendCookieAlert(accountId, errorType, statusCode);
            
            // 模擬old_main.js的錯誤後間隔調整（更激進）
            accountSession.currentInterval = Math.min(
                accountSession.currentInterval * SAFE_CONFIG.backoffMultiplier,
                SAFE_CONFIG.maxBackoffInterval
            );
            
            // 智能冷卻調整
            const availableAccountsCount = this.accounts.filter(account => {
                const accountStats = this.accountStats.get(account.id);
                const cooldownEnd = this.cooldownAccounts.get(account.id) || 0;
                const cookieStats = this.cookieFailureStats.get(account.id);
                return accountStats.dailyRequests < SAFE_CONFIG.maxRequestsPerAccount && 
                       Date.now() >= cooldownEnd &&
                       !cookieStats.isCurrentlyInvalid;
            }).length;
            
            let cooldownMinutes = SAFE_CONFIG.accountCooldownMinutes;
            
            if (availableAccountsCount <= 1) {
                cooldownMinutes = Math.max(10, cooldownMinutes / 2);
                console.log(`⚠️ [智能調整] 只剩${availableAccountsCount}個可用帳號，縮短冷卻至${cooldownMinutes}分鐘`);
            }
            
            if (statusCode === 429) {
                cooldownMinutes = Math.min(cooldownMinutes * 2, 90);
            } else if (this.isCookieError(statusCode, errorType)) {
                cooldownMinutes = Math.min(cooldownMinutes * 3, 180);
            }
            
            this.setCooldown(accountId, cooldownMinutes);
        }
        
        const successRate = stats.successCount + stats.errorCount > 0 ? 
            Math.round(stats.successCount / (stats.successCount + stats.errorCount) * 100) : 0;
            
        console.log(`📊 [統計] ${accountId}: 今日${stats.dailyRequests}次, 成功率${successRate}%, 當前間隔${Math.round(accountSession.currentInterval)}s`);
    }
    
    // 設置帳號冷卻
    setCooldown(accountId, minutes) {
        const cooldownEnd = Date.now() + (minutes * 60 * 1000);
        this.cooldownAccounts.set(accountId, cooldownEnd);
        console.log(`❄️ [冷卻] ${accountId} 冷卻 ${minutes} 分鐘`);
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
        console.log('🌅 [重置] 每日計數器已重置 (日本時間)');
    }
    
    // 安全HTTP請求（使用old_main.js的方法）
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
    
    // 獲取用戶ID（使用固定session數據）
    async getUserId(username, account) {
        const accountSession = this.accountSessions.get(account.id);
        
        // 如果已有緩存的用戶ID，直接使用
        if (accountSession.cachedUserId) {
            return accountSession.cachedUserId;
        }
        
        try {
            // 使用更長的延遲
            await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));
            
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
                    'Host': 'i.instagram.com'
                }
            });
            
            if (response.statusCode === 200) {
                const data = JSON.parse(response.data);
                if (data.data?.user?.id) {
                    // 緩存用戶ID
                    accountSession.cachedUserId = data.data.user.id;
                    console.log(`✅ [Instagram] 用戶ID已緩存: ${data.data.user.id}`);
                    return data.data.user.id;
                }
            }
            
            console.log(`❌ [Instagram] 獲取用戶ID失敗: HTTP ${response.statusCode}`);
            return { error: true, statusCode: response.statusCode, errorType: 'user_id_failed' };
            
        } catch (error) {
            console.error('❌ [Instagram] 獲取用戶ID錯誤:', error.message);
            return { error: true, statusCode: 0, errorType: error.message };
        }
    }
    
    // 檢查Instagram直播（使用固定session + 動態間隔）
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
        
        const accountSession = this.accountSessions.get(account.id);
        
        try {
            console.log(`🔍 [檢查] 使用 ${account.id} 檢查 @${username} (間隔: ${Math.round(accountSession.currentInterval)}s)`);
            
            // 使用帳號特定的間隔延遲
            await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));
            
            // 獲取用戶ID
            const userIdResult = await this.getUserId(username, account);
            if (userIdResult.error) {
                this.recordRequest(account.id, false, {
                    statusCode: userIdResult.statusCode,
                    errorType: userIdResult.errorType
                });
                return false;
            }
            const userId = userIdResult;
            
            // 檢查story端點
            await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
            
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
                    'Host': 'i.instagram.com'
                }
            });
            
            console.log(`📊 [檢查] Story端點回應: HTTP ${response.statusCode}`);
            
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
                this.recordRequest(account.id, false, {
                    statusCode: response.statusCode,
                    errorType: 'story_endpoint_failed'
                });
                return false;
            }
            
        } catch (error) {
            console.error(`❌ [檢查] ${account.id} 失敗: ${error.message}`);
            
            this.recordRequest(account.id, false, {
                statusCode: 0,
                errorType: error.message
            });
            
            return false;
        }
    }
    
    // 計算下次檢查間隔（修復版本）
    calculateNextInterval() {
        const hour = parseInt(this.getJapanHour());
        
        // 找到最佳帳號來獲取其當前間隔
        const bestAccount = this.selectBestAccount();
        let baseInterval = SAFE_CONFIG.minInterval;
        
        if (bestAccount) {
            const accountSession = this.accountSessions.get(bestAccount.id);
            baseInterval = accountSession.currentInterval;
            console.log(`🔧 [間隔Debug] ${bestAccount.id} 當前間隔: ${baseInterval}秒`);
        }
        
        // 根據日本時間調整間隔（修復版本）
        if (hour >= 2 && hour <= 6) {
            // 深夜時段 - 10~15分鐘間隔
            baseInterval = 600 + Math.random() * 300; // 10-15分鐘
            console.log('🌙 [深夜模式] 強制使用10-15分鐘間隔');
        } else if (hour >= 0 && hour <= 1) {
            // 深夜前期 - 3~5分鐘間隔
            baseInterval = 180 + Math.random() * 120; // 3-5分鐘
            console.log('🌃 [深夜前期] 強制使用3-5分鐘間隔');
        } else if (hour >= 7 && hour <= 8) {
            // 早晨時段 - 3~5分鐘間隔
            baseInterval = 180 + Math.random() * 120; // 3-5分鐘
            console.log('🌅 [早晨時段] 強制使用3-5分鐘間隔');
        } else if (hour >= 9 && hour <= 23) {
            // 白天活躍時段 - 90~180秒間隔
            baseInterval = SAFE_CONFIG.minInterval + Math.random() * (SAFE_CONFIG.maxInterval - SAFE_CONFIG.minInterval);
            console.log('☀️ [活躍時段] 使用90-180秒間隔');
        }
        
        // 檢查可用帳號數量調整
        const availableAccounts = this.accounts.filter(account => {
            const stats = this.accountStats.get(account.id);
            const cooldownEnd = this.cooldownAccounts.get(account.id) || 0;
            const cookieStats = this.cookieFailureStats.get(account.id);
            return stats.dailyRequests < SAFE_CONFIG.maxRequestsPerAccount && 
                   Date.now() >= cooldownEnd &&
                   !cookieStats.isCurrentlyInvalid;
        }).length;
        
        if (availableAccounts <= 1) {
            // 只有1個帳號時，使用更長間隔保護帳號
            baseInterval = Math.max(baseInterval * 1.5, SAFE_CONFIG.maxInterval);
            console.log(`⚠️ [帳號保護] 只有${availableAccounts}個可用帳號，延長間隔保護帳號`);
        }
        
        // 最小間隔限制
        baseInterval = Math.max(baseInterval, SAFE_CONFIG.minInterval);
        
        const finalInterval = Math.floor(baseInterval);
        console.log(`🎯 [間隔計算] 最終間隔: ${finalInterval}秒 (${Math.round(finalInterval/60)}分${finalInterval%60}秒)`);
        
        return finalInterval;
    }
    
    // 啟動監控（修復重複循環問題）
    async startMonitoring(username, onLiveDetected) {
        console.log(`🔧 [Debug] startMonitoring被調用, 當前監控狀態: ${this.isMonitoring}`);
        
        if (this.isMonitoring) {
            console.log('⚠️ [監控] 已在運行中，跳過重複啟動');
            return;
        }
        
        // 清除之前的監控循環
        if (this.monitoringTimeout) {
            console.log('🔧 [Debug] 清除舊的monitoring timeout');
            clearTimeout(this.monitoringTimeout);
            this.monitoringTimeout = null;
        }
        
        this.isMonitoring = true;
        let isLiveNow = false;
        
        console.log('🚀 [安全監控] 開始Instagram監控 (模擬old_main.js策略)');
        console.log(`📊 [配置] 保守間隔: ${SAFE_CONFIG.minInterval}-${SAFE_CONFIG.maxInterval}秒`);
        console.log(`🔐 [帳號] 總數: ${this.accounts.length} (固定設備ID策略)`);
        console.log(`🕐 [時間] 當前日本時間: ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' })}`);
        
        const monitorLoop = async () => {
            if (!this.isMonitoring) {
                console.log('⏹️ [監控循環] 監控已停止，退出循環');
                return;
            }
            
            console.log(`🔄 [監控循環] 開始新的檢查循環 - ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' })}`);
            
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
                
                // 計算下次檢查間隔（使用修復的計算）
                const nextInterval = this.calculateNextInterval();
                const nextCheckTime = new Date(Date.now() + nextInterval * 1000).toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' });
                console.log(`⏰ [監控] 下次檢查: ${Math.round(nextInterval/60)}分${nextInterval%60}秒後 (${nextCheckTime})`);
                console.log(`🔧 [Debug] 實際等待毫秒數: ${nextInterval * 1000}`);
                
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
                console.log(`🕐 [日本時間] ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' })}`);
                
                // 確保使用正確的間隔設置下次檢查
                console.log(`🔧 [Debug] 準備設置timeout: ${nextInterval}秒 = ${nextInterval * 1000}毫秒`);
                this.monitoringTimeout = setTimeout(() => {
                    console.log(`⏰ [監控] 間隔時間到，開始下次檢查 (實際等待了${nextInterval}秒)`);
                    monitorLoop();
                }, nextInterval * 1000);
                
            } catch (error) {
                console.error('❌ [監控] 循環錯誤:', error.message);
                
                // 發生錯誤時使用更長間隔重試
                if (this.isMonitoring) {
                    const errorInterval = Math.max(SAFE_CONFIG.maxInterval * 2, 300); // 至少5分鐘
                    console.log(`⚠️ [錯誤恢復] ${Math.round(errorInterval/60)}分鐘後重試`);
                    this.monitoringTimeout = setTimeout(monitorLoop, errorInterval * 1000);
                }
            }
        };
        
        // 初始延遲（更長的延遲）
        const initialDelay = (60 + Math.random() * 120) * 1000; // 1-3分鐘初始延遲
        console.log(`⏳ [監控] ${Math.round(initialDelay/1000)}秒後開始首次檢查 (更安全的啟動)`);
        this.monitoringTimeout = setTimeout(monitorLoop, initialDelay);
    }
    
    // 停止監控
    stopMonitoring() {
        this.isMonitoring = false;
        
        if (this.monitoringTimeout) {
            clearTimeout(this.monitoringTimeout);
            this.monitoringTimeout = null;
            console.log('⏹️ [監控] 監控循環已清除');
        }
        
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
            isLiveNow: false, // 這個值會在main.js中更新
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
            lastCheck: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' }),
            targetUserId: null,
            japanTime: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' }),
            japanHour: parseInt(this.getJapanHour()),
            accountDetails: Array.from(this.accountStats.entries()).map(([id, stats]) => {
                const cookieStats = this.cookieFailureStats.get(id);
                const accountSession = this.accountSessions.get(id);
                return {
                    id,
                    dailyRequests: stats.dailyRequests,
                    successCount: stats.successCount,
                    errorCount: stats.errorCount,
                    lastUsed: stats.lastUsed ? new Date(stats.lastUsed).toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' }) : 'Never',
                    inCooldown: this.cooldownAccounts.has(id) && this.cooldownAccounts.get(id) > Date.now(),
                    isDisabled: cookieStats.isCurrentlyInvalid,
                    cookieStatus: cookieStats.isCurrentlyInvalid ? 'Invalid' : 'Valid',
                    consecutiveFailures: cookieStats.consecutiveFailures,
                    invalidSince: cookieStats.invalidSince ? new Date(cookieStats.invalidSince).toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' }) : null,
                    currentInterval: Math.round(accountSession.currentInterval),
                    deviceId: accountSession.deviceId.substring(0, 12) + '****',
                    cachedUserId: accountSession.cachedUserId ? 'Yes' : 'No'
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
            japanTime: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' }),
            details: []
        };
        
        this.accounts.forEach(account => {
            const cookieStats = this.cookieFailureStats.get(account.id);
            const accountSession = this.accountSessions.get(account.id);
            const accountSummary = {
                id: account.id,
                sessionId: account.sessionId.substring(0, 12) + '****',
                deviceId: accountSession.deviceId.substring(0, 12) + '****',
                status: cookieStats.isCurrentlyInvalid ? 'Invalid' : 'Valid',
                consecutiveFailures: cookieStats.consecutiveFailures,
                lastFailure: cookieStats.lastFailureTime ? new Date(cookieStats.lastFailureTime).toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' }) : null,
                invalidSince: cookieStats.invalidSince ? new Date(cookieStats.invalidSince).toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' }) : null,
                currentInterval: Math.round(accountSession.currentInterval),
                consecutiveErrors: accountSession.consecutiveErrors
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

module.exports = SaferInstagramMonitor;