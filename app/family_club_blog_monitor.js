const https = require('https');

class FamilyClubBlogMonitor {
    constructor(notificationCallback = null) {
        this.notificationCallback = notificationCallback;
        this.isMonitoring = false;
        this.monitoringInterval = null;
        this.checkIntervalMinutes = 60; // 每小時檢查一次
        this.totalChecks = 0;
        this.articlesFound = 0;
        this.lastCheckTime = null;
        
        // Family Club API 端點
        this.apiEndpoint = 'https://web.familyclub.jp/s/jwb/api/list/diarkiji_list';
        this.artistCode = 'F2017'; // 高木雄也
        this.baseUrl = 'https://web.familyclub.jp';
        
        // 記錄最新文章信息 - 使用正確的字段
        this.latestRecord = {
            articleCode: null,          // 使用 code 而不是隨機ID
            datetime: null,             // Date 對象
            datetimeString: null,       // 格式化的時間字符串
            title: null,
            url: null,
            diaryName: null,            // diary_name
            lastUpdated: null
        };
        
        console.log('📝 [博客監控] Family Club 博客監控已初始化');
        console.log('🎯 [博客監控] 使用API端點:', this.apiEndpoint);
        console.log('🎨 [博客監控] 目標藝人:', this.artistCode, '(高木雄也)');
    }

    // 安全HTTP請求
    makeRequest(url, options = {}) {
        return new Promise((resolve, reject) => {
            const req = https.request(url, {
                method: options.method || 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'application/json, text/html, */*',
                    'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache',
                    'Referer': 'https://web.familyclub.jp/s/jwb/diary/F2017',
                    'X-Requested-With': 'XMLHttpRequest',
                    ...options.headers
                },
                timeout: 15000
            }, (res) => {
                let data = '';
                
                let stream = res;
                if (res.headers['content-encoding'] === 'gzip') {
                    const zlib = require('zlib');
                    stream = res.pipe(zlib.createGunzip());
                }
                
                stream.on('data', (chunk) => { data += chunk; });
                stream.on('end', () => {
                    resolve({ 
                        statusCode: res.statusCode, 
                        data: data,
                        headers: res.headers,
                        contentType: res.headers['content-type'] || ''
                    });
                });
                stream.on('error', reject);
            });
            
            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });
            
            req.end();
        });
    }

    // 從API獲取文章列表
    async fetchArticlesFromAPI() {
        try {
            console.log('📡 [API獲取] 從Family Club API獲取文章列表');
            
            const apiUrl = `${this.apiEndpoint}?code=${this.artistCode}&so=JW5&page=0`;
            console.log('🔗 [API獲取] 請求URL:', apiUrl);
            
            const response = await this.makeRequest(apiUrl);
            
            if (response.statusCode !== 200) {
                throw new Error(`API請求失敗: HTTP ${response.statusCode}`);
            }
            
            console.log(`📊 [API獲取] 成功獲取響應，長度: ${response.data.length} 字元`);
            
            let jsonData;
            try {
                jsonData = JSON.parse(response.data);
            } catch (parseError) {
                throw new Error(`JSON解析失敗: ${parseError.message}`);
            }
            
            console.log('📄 [API解析] JSON結構:', Object.keys(jsonData));
            
            if (!jsonData.list || !Array.isArray(jsonData.list)) {
                throw new Error('API響應中沒有找到文章列表');
            }
            
            const articles = this.parseArticleList(jsonData.list);
            console.log(`📝 [API獲取] 成功解析 ${articles.length} 篇文章`);
            
            return articles;
            
        } catch (error) {
            console.error('❌ [API獲取] 獲取失敗:', error.message);
            throw error;
        }
    }

    // 解析文章列表
    parseArticleList(articleList) {
        const articles = [];
        
        articleList.forEach((item, index) => {
            try {
                if (!item || typeof item !== 'object') {
                    console.log(`⚠️ [文章解析] 項目 ${index} 不是有效對象`);
                    return;
                }
                
                // 解析日期 - API返回格式: "2025-07-14T19:00"
                const dateTime = this.parseDateTime(item.date);
                if (!dateTime) {
                    console.warn(`⚠️ [文章解析] 無法解析日期: ${item.date}`);
                    return; // 跳過無法解析日期的文章
                }
                
                // 構建文章URL
                let articleUrl = null;
                if (item.link) {
                    articleUrl = item.link.startsWith('http') ? item.link : this.baseUrl + item.link;
                } else if (item.code) {
                    // 使用code構建URL
                    articleUrl = `${this.baseUrl}/s/jwb/diary/${this.artistCode}/detail/${item.code}`;
                }
                
                const article = {
                    code: item.code,                    // 使用真正的文章代碼
                    title: item.title || '未知標題',
                    diaryName: item.diary_name || '',
                    artistName: item.artist_name || '',
                    date: dateTime.date,
                    datetimeString: dateTime.datetimeString,
                    labelDate: item.label_date || '',   // API提供的格式化日期
                    url: articleUrl,
                    image: item.diary_image || null
                };
                
                articles.push(article);
                console.log(`📝 [文章解析] 文章 ${index + 1}: Code=${article.code}, 日期=${article.datetimeString}, 標題="${article.title.substring(0, 30)}..."`);
                
            } catch (error) {
                console.error(`❌ [文章解析] 解析文章 ${index + 1} 失敗:`, error.message);
            }
        });
        
        return articles;
    }

    // 解析日期時間 - 處理Family Club API的日期格式
    parseDateTime(dateString) {
        try {
            if (!dateString) return null;
            
            // Family Club API格式: "2025-07-14T19:00"
            const isoMatch = dateString.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
            if (isoMatch) {
                const [, year, month, day, hour, minute] = isoMatch;
                const date = new Date(
                    parseInt(year),
                    parseInt(month) - 1, // JavaScript月份從0開始
                    parseInt(day),
                    parseInt(hour),
                    parseInt(minute)
                );
                
                if (!isNaN(date.getTime())) {
                    return {
                        date: date,
                        datetimeString: `${year}年${month}月${day}日 ${hour}:${minute}`
                    };
                }
            }
            
            // 回退: 嘗試直接解析
            const date = new Date(dateString);
            if (!isNaN(date.getTime())) {
                return {
                    date: date,
                    datetimeString: date.toLocaleString('ja-JP', { 
                        timeZone: 'Asia/Tokyo',
                        year: 'numeric',
                        month: 'long', 
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    })
                };
            }
            
            return null;
            
        } catch (error) {
            console.error('❌ [日期解析] 失敗:', error.message);
            return null;
        }
    }

    // 找出最新文章 - 按時間排序
    findLatestArticle(articles) {
        if (articles.length === 0) {
            return null;
        }
        
        console.log('🔍 [最新文章] 分析文章時間順序...');
        
        // 按日期排序，最新的在前
        const sortedArticles = articles.sort((a, b) => b.date - a.date);
        
        console.log('📊 [最新文章] 最新5篇文章:');
        sortedArticles.slice(0, 5).forEach((article, index) => {
            console.log(`   ${index + 1}. Code: ${article.code}, 時間: ${article.datetimeString}, 標題: ${article.title.substring(0, 30)}...`);
        });
        
        const latestArticle = sortedArticles[0];
        console.log(`✅ [最新文章] 選擇最新文章: Code=${latestArticle.code}, 時間=${latestArticle.datetimeString}`);
        
        return latestArticle;
    }

    // 初始化
    async initialize() {
        try {
            console.log('🚀 [博客監控] 正在初始化Family Club博客監控...');
            
            const articles = await this.fetchArticlesFromAPI();
            
            if (articles.length === 0) {
                console.warn('⚠️ [博客監控] 初始化時未找到任何文章');
                return false;
            }
            
            const latestArticle = this.findLatestArticle(articles);
            
            this.latestRecord = {
                articleCode: latestArticle.code,
                datetime: latestArticle.date,
                datetimeString: latestArticle.datetimeString,
                title: latestArticle.title,
                url: latestArticle.url,
                diaryName: latestArticle.diaryName,
                lastUpdated: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
            };
            
            console.log('✅ [博客監控] 初始化完成，建立基準記錄:');
            console.log(`   📄 文章Code: ${this.latestRecord.articleCode}`);
            console.log(`   🗓️ 發佈時間: ${this.latestRecord.datetimeString}`);
            console.log(`   📝 標題: ${this.latestRecord.title}`);
            console.log(`   📝 Diary名稱: ${this.latestRecord.diaryName}`);
            console.log(`   🔗 URL: ${this.latestRecord.url}`);
            console.log(`   📊 總文章數: ${articles.length}`);
            
            return true;
            
        } catch (error) {
            console.error('❌ [博客監控] 初始化失敗:', error.message);
            return false;
        }
    }

    // 檢查是否有新文章
    async checkForNewArticles(testMode = false) {
        try {
            const japanTime = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
            console.log(`🔍 [檢查更新] 檢查新文章... ${testMode ? '(測試模式)' : ''} - ${japanTime}`);
            
            this.totalChecks++;
            this.lastCheckTime = japanTime;

            const articles = await this.fetchArticlesFromAPI();
            
            if (articles.length === 0) {
                console.log('📋 [檢查更新] 未找到文章');
                return null;
            }
            
            const latestArticle = this.findLatestArticle(articles);
            
            if (testMode) {
                console.log(`📝 [測試模式] 當前最新文章: Code=${latestArticle.code}, 時間=${latestArticle.datetimeString}`);
                console.log(`📊 [測試模式] 總文章數: ${articles.length}`);
                return latestArticle;
            }
            
            // 檢查是否有更新
            let hasUpdate = false;
            let updateReason = '';
            
            if (!this.latestRecord.articleCode) {
                hasUpdate = true;
                updateReason = '初始化記錄';
            } else {
                // 首先比較文章代碼
                if (latestArticle.code !== this.latestRecord.articleCode) {
                    hasUpdate = true;
                    updateReason = `新文章代碼: ${latestArticle.code} != ${this.latestRecord.articleCode}`;
                }
                
                // 如果代碼相同，比較時間
                if (!hasUpdate && latestArticle.date > this.latestRecord.datetime) {
                    hasUpdate = true;
                    updateReason = `新發佈時間: ${latestArticle.datetimeString} > ${this.latestRecord.datetimeString}`;
                }
            }
            
            if (hasUpdate) {
                console.log(`📝 [檢查更新] 發現新文章! 原因: ${updateReason}`);
                
                // 更新記錄
                const previousRecord = { ...this.latestRecord };
                this.latestRecord = {
                    articleCode: latestArticle.code,
                    datetime: latestArticle.date,
                    datetimeString: latestArticle.datetimeString,
                    title: latestArticle.title,
                    url: latestArticle.url,
                    diaryName: latestArticle.diaryName,
                    lastUpdated: japanTime
                };
                
                this.articlesFound++;
                
                console.log(`📊 [檢查更新] 記錄已更新:`);
                console.log(`   舊: Code=${previousRecord.articleCode}, 時間=${previousRecord.datetimeString}`);
                console.log(`   新: Code=${latestArticle.code}, 時間=${latestArticle.datetimeString}`);
                
                return latestArticle;
            }
            
            console.log('📋 [檢查更新] 無新文章');
            return null;

        } catch (error) {
            console.error('❌ [檢查更新] 檢查失敗:', error.message);
            return null;
        }
    }

    // 測試API連接
    async testWebsiteAccess() {
        try {
            console.log('🔍 [測試連接] 測試Family Club API連接...');
            
            const articles = await this.fetchArticlesFromAPI();
            
            return {
                success: true,
                method: 'Family Club Official API',
                endpoint: this.apiEndpoint,
                articlesFound: articles.length,
                sampleArticles: articles.slice(0, 3).map(a => ({
                    code: a.code,
                    time: a.datetimeString,
                    title: a.title.substring(0, 50) + (a.title.length > 50 ? '...' : ''),
                    diaryName: a.diaryName
                })),
                apiParameters: {
                    code: this.artistCode,
                    so: 'JW5',
                    page: 0
                }
            };

        } catch (error) {
            console.error('❌ [測試連接] API測試失敗:', error.message);
            return {
                success: false,
                error: error.message,
                method: 'Family Club Official API',
                endpoint: this.apiEndpoint
            };
        }
    }

    // 發送新文章通知
    async sendNewArticleNotification(article) {
        if (!this.notificationCallback) return;

        const notificationMessage = `📝 **Family Club 新文章發布!** (高木雄也)

📄 **文章代碼:** ${article.code}
🗓️ **發布時間:** ${article.datetimeString}
📝 **標題:** ${article.title}
📝 **Diary名稱:** ${article.diaryName}
${article.url ? `🔗 **文章連結:** ${article.url}` : ''}
👤 **藝人:** ${article.artistName}
🌐 **博客首頁:** https://web.familyclub.jp/s/jwb/diary/F2017
⏰ **檢測時間:** ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
🎯 **檢測方式:** Family Club 官方API

🎉 快去看看新內容吧！`;

        try {
            await this.notificationCallback(notificationMessage, 'blog_alert', 'FamilyClubBlog');
            console.log('📤 [通知] 新文章通知已發送');
        } catch (error) {
            console.error('❌ [通知] 通知發送失敗:', error.message);
        }
    }

    // 計算下次檢查時間 - 日本時間12:00-24:00每小時00分檢查
    calculateNextCheckTime() {
        const now = new Date();
        const japanNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
        const currentHour = japanNow.getHours();
        
        // 檢查是否在活躍時段 (12:00-23:59)
        const isActiveTime = currentHour >= 12 && currentHour <= 23;
        
        let nextCheck = new Date(japanNow);
        
        if (isActiveTime) {
            // 活躍時段：下一個整點
            nextCheck.setHours(currentHour + 1);
            nextCheck.setMinutes(0);
            nextCheck.setSeconds(0);
            nextCheck.setMilliseconds(0);
        } else {
            // 非活躍時段：等到12:00
            if (currentHour < 12) {
                // 當天12:00
                nextCheck.setHours(12);
            } else {
                // 明天12:00
                nextCheck.setDate(nextCheck.getDate() + 1);
                nextCheck.setHours(12);
            }
            nextCheck.setMinutes(0);
            nextCheck.setSeconds(0);
            nextCheck.setMilliseconds(0);
        }
        
        // 轉換回UTC時間來計算等待時間
        const utcNow = new Date();
        const utcNext = new Date(nextCheck.getTime() - (9 * 60 * 60 * 1000)); // 減去9小時時差
        const waitTime = Math.max(0, utcNext.getTime() - utcNow.getTime());
        
        // 只在監控循環中打印詳細日誌，狀態查詢時不打印
        return Math.floor(waitTime / 1000);
    }


    // 開始監控
    // 修正後的監控循環 - 增加更詳細的日誌控制
    startMonitoring() {
        if (this.isMonitoring) {
            console.log('⚠️ [監控] 博客監控已在運行中');
            return;
        }

        this.isMonitoring = true;
        console.log('🚀 [監控] 開始Family Club博客監控');
        console.log('⏰ [監控] 活躍時段: 日本時間12:00-24:00，每小時00分檢查');
        
        const monitorLoop = async () => {
            if (!this.isMonitoring) {
                console.log('⏹️ [監控] 博客監控已停止');
                return;
            }

            try {
                const newArticle = await this.checkForNewArticles();
                if (newArticle) {
                    await this.sendNewArticleNotification(newArticle);
                }

                // 計算下次檢查時間並打印詳細日誌
                const now = new Date();
                const japanNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
                const currentHour = japanNow.getHours();
                const isActiveTime = currentHour >= 12 && currentHour <= 23;
                
                console.log(`⏰ [計算時間] 日本當前時間: ${japanNow.toLocaleString()}, 小時: ${currentHour}, 活躍時段: ${isActiveTime}`);
                
                const nextCheckSeconds = this.calculateNextCheckTime();
                const nextCheckTime = new Date(Date.now() + nextCheckSeconds * 1000)
                    .toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
                
                console.log(`⏰ [監控] 下次檢查: ${nextCheckTime} (${Math.round(nextCheckSeconds/60)}分鐘後)`);

                this.monitoringInterval = setTimeout(monitorLoop, nextCheckSeconds * 1000);

            } catch (error) {
                console.error('❌ [監控] 監控循環錯誤:', error.message);
                
                if (this.isMonitoring) {
                    console.log('⚠️ [監控] 10分鐘後重試');
                    this.monitoringInterval = setTimeout(monitorLoop, 10 * 60 * 1000);
                }
            }
        };

        // 先初始化，然後開始監控
        this.initialize().then(success => {
            if (success) {
                console.log('⏳ [監控] 5秒後開始定期檢查');
                this.monitoringInterval = setTimeout(monitorLoop, 5000);
            } else {
                console.error('❌ [監控] 初始化失敗，停止監控');
                this.isMonitoring = false;
            }
        });
    }

    // 停止監控
    stopMonitoring() {
        this.isMonitoring = false;
        
        if (this.monitoringInterval) {
            clearTimeout(this.monitoringInterval);
            this.monitoringInterval = null;
        }
        
        console.log('⏹️ [監控] Family Club博客監控已停止');
    }

    // 獲取狀態
    // 修正後的 getStatus 方法 - 緩存計算結果避免重複計算
    getStatus() {
        const japanNow = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
        const currentHour = new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo", hour: '2-digit', hour12: false });
        const isActiveTime = parseInt(currentHour) >= 12 && parseInt(currentHour) <= 23;
        
        // 只在監控運行時計算下次檢查時間，避免頻繁計算
        let nextCheckTime = null;
        if (this.isMonitoring) {
            // 使用緩存的下次檢查時間，避免重複計算
            if (this.monitoringInterval) {
                const nextCheckSeconds = this.calculateNextCheckTime();
                nextCheckTime = new Date(Date.now() + nextCheckSeconds * 1000).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
            }
        }
        
        return {
            isMonitoring: this.isMonitoring,
            totalChecks: this.totalChecks,
            articlesFound: this.articlesFound,
            lastCheckTime: this.lastCheckTime,
            nextCheckTime: nextCheckTime,
            method: 'Family Club Official API',
            endpoint: this.apiEndpoint,
            artistCode: this.artistCode,
            artistName: '高木雄也',
            blogUrl: 'https://web.familyclub.jp/s/jwb/diary/F2017',
            activeTimeSchedule: '日本時間12:00-24:00 (每小時00分檢查)',
            currentActiveTime: isActiveTime,
            japanTime: japanNow,
            latestRecord: {
                ...this.latestRecord,
                hasRecord: !!(this.latestRecord.articleCode || this.latestRecord.datetime)
            }
        };
    }

    // 獲取當前最新記錄
    getLatestRecord() {
        if (!this.latestRecord.articleCode && !this.latestRecord.datetime) {
            return null;
        }
        
        return {
            articleCode: this.latestRecord.articleCode,
            datetime: this.latestRecord.datetimeString,
            title: this.latestRecord.title,
            url: this.latestRecord.url,
            diaryName: this.latestRecord.diaryName,
            lastUpdated: this.latestRecord.lastUpdated
        };
    }

    // 手動重新初始化
    async reinitialize() {
        console.log('🔄 [重新初始化] 手動重新初始化記錄...');
        return await this.initialize();
    }

    // 獲取最新的幾篇文章（用於調試）
    async getLatestArticles(limit = 5) {
        try {
            console.log(`🔍 [獲取文章] 獲取最新 ${limit} 篇文章`);
            const articles = await this.fetchArticlesFromAPI();
            
            if (articles.length === 0) {
                return [];
            }
            
            // 按時間排序，返回最新的幾篇
            const sortedArticles = articles.sort((a, b) => b.date - a.date);
            
            return sortedArticles.slice(0, limit).map(article => ({
                code: article.code,
                title: article.title,
                diaryName: article.diaryName,
                datetime: article.datetimeString,
                labelDate: article.labelDate,
                url: article.url,
                artistName: article.artistName
            }));
            
        } catch (error) {
            console.error('❌ [獲取文章] 獲取最新文章失敗:', error.message);
            return [];
        }
    }
}

module.exports = FamilyClubBlogMonitor;