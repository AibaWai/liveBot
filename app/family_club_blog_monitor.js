// family_club_blog_monitor.js - 優化版本
const https = require('https');

class FamilyClubBlogMonitor {
    constructor(notificationCallback = null) {
        this.notificationCallback = notificationCallback;
        this.isMonitoring = false;
        this.monitoringInterval = null;
        this.checkIntervalMinutes = 60;
        this.totalChecks = 0;
        this.articlesFound = 0;
        this.lastCheckTime = null;
        
        this.apiEndpoint = 'https://web.familyclub.jp/s/jwb/api/list/diarkiji_list';
        this.artistCode = process.env.ARTIST_CODE || 'F2017';
        this.artistName = null;
        this.baseUrl = 'https://web.familyclub.jp';
        
        this.latestRecord = {
            articleCode: null,
            datetime: null,
            datetimeString: null,
            title: null,
            url: null,
            diaryName: null,
            lastUpdated: null
        };
        
        console.log('📝 [博客監控] Family Club 博客監控已初始化');
    }

    makeRequest(url, options = {}) {
        return new Promise((resolve, reject) => {
            const req = https.request(url, {
                method: options.method || 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'application/json, text/html, */*',
                    'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
                    'Referer': `https://web.familyclub.jp/s/jwb/diary/${this.artistCode}`,
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
                        headers: res.headers
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

    async fetchArticlesFromAPI() {
        try {
            const apiUrl = `${this.apiEndpoint}?code=${this.artistCode}&so=JW5&page=0`;
            const response = await this.makeRequest(apiUrl);
            
            if (response.statusCode !== 200) {
                throw new Error(`API請求失敗: HTTP ${response.statusCode}`);
            }
            
            let jsonData;
            try {
                jsonData = JSON.parse(response.data);
            } catch (parseError) {
                throw new Error(`JSON解析失敗: ${parseError.message}`);
            }
            
            if (!jsonData.list || !Array.isArray(jsonData.list)) {
                throw new Error('API響應中沒有找到文章列表');
            }
            
            const articles = this.parseArticleList(jsonData.list);
            return articles;
            
        } catch (error) {
            console.error('❌ [API獲取] 獲取失敗:', error.message);
            throw error;
        }
    }

    parseArticleList(articleList) {
        const articles = [];
        
        articleList.forEach((item, index) => {
            try {
                if (!item || typeof item !== 'object') return;
                
                // 自動設置藝人名稱
                if (!this.artistName && item.artist_name) {
                    this.artistName = item.artist_name;
                }
                
                const dateTime = this.parseDateTime(item.date);
                if (!dateTime) return;
                
                let articleUrl = null;
                if (item.link) {
                    articleUrl = item.link.startsWith('http') ? item.link : this.baseUrl + item.link;
                } else if (item.code) {
                    articleUrl = `${this.baseUrl}/s/jwb/diary/${this.artistCode}/detail/${item.code}`;
                }
                
                const article = {
                    code: item.code,
                    title: item.title || '未知標題',
                    diaryName: item.diary_name || '',
                    artistName: item.artist_name || this.artistName || '',
                    date: dateTime.date,
                    datetimeString: dateTime.datetimeString,
                    labelDate: item.label_date || '',
                    url: articleUrl,
                    image: item.diary_image || null
                };
                
                articles.push(article);
                
            } catch (error) {
                console.error(`❌ [文章解析] 解析文章 ${index + 1} 失敗:`, error.message);
            }
        });
        
        return articles;
    }

    parseDateTime(dateString) {
        try {
            if (!dateString) return null;
            
            // Family Club API格式: "2025-07-14T19:00"
            const isoMatch = dateString.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
            if (isoMatch) {
                const [, year, month, day, hour, minute] = isoMatch;
                const date = new Date(
                    parseInt(year),
                    parseInt(month) - 1,
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

    findLatestArticle(articles) {
        if (articles.length === 0) return null;
        
        // 按日期排序，最新的在前
        const sortedArticles = articles.sort((a, b) => b.date - a.date);
        const latestArticle = sortedArticles[0];
        
        // 只在調試模式或初始化時輸出詳細信息
        if (!this.latestRecord.articleCode) {
            console.log(`✅ [最新文章] 找到最新文章: Code=${latestArticle.code}, 時間=${latestArticle.datetimeString}`);
        }
        
        return latestArticle;
    }

    async initialize() {
        try {
            console.log('🚀 [博客監控] 正在初始化...');
            
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
            
            console.log('✅ [博客監控] 初始化完成');
            console.log(`   🎭 藝人: ${this.artistName} (${this.artistCode})`);
            console.log(`   📄 最新文章: ${this.latestRecord.title}`);
            console.log(`   🗓️ 發佈時間: ${this.latestRecord.datetimeString}`);
            
            return true;
            
        } catch (error) {
            console.error('❌ [博客監控] 初始化失敗:', error.message);
            return false;
        }
    }

    async checkForNewArticles(testMode = false) {
        try {
            const japanTime = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
            
            if (testMode) {
                console.log(`🔍 [測試檢查] 獲取最新文章狀態 - ${japanTime}`);
            }
            
            this.totalChecks++;
            this.lastCheckTime = japanTime;

            const articles = await this.fetchArticlesFromAPI();
            
            if (articles.length === 0) {
                console.log('📋 [檢查更新] 未找到文章');
                return null;
            }
            
            const latestArticle = this.findLatestArticle(articles);
            
            if (testMode) {
                return latestArticle; // 測試模式直接返回最新文章
            }
            
            // 正常監控模式的檢查邏輯
            let hasUpdate = false;
            let updateReason = '';
            
            if (!this.latestRecord.articleCode) {
                hasUpdate = true;
                updateReason = '初始化記錄';
            } else {
                if (latestArticle.code !== this.latestRecord.articleCode) {
                    hasUpdate = true;
                    updateReason = `新文章: ${latestArticle.code}`;
                } else if (latestArticle.date > this.latestRecord.datetime) {
                    hasUpdate = true;
                    updateReason = `更新時間: ${latestArticle.datetimeString}`;
                }
            }
            
            if (hasUpdate) {
                console.log(`📝 [新文章] 發現更新! ${updateReason}`);
                console.log(`   標題: ${latestArticle.title}`);
                console.log(`   時間: ${latestArticle.datetimeString}`);
                
                // 更新記錄
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
                return latestArticle;
            }
            
            return null;

        } catch (error) {
            console.error('❌ [檢查更新] 失敗:', error.message);
            if (testMode) throw error;
            return null;
        }
    }

    async sendNewArticleNotification(article) {
        if (!this.notificationCallback) return;

        const notificationMessage = `📝 **Family Club 新文章發布!** (${this.artistName || this.artistCode})

📄 **文章代碼:** ${article.code}
🗓️ **發布時間:** ${article.datetimeString}
📝 **標題:** ${article.title}
📝 **Diary名稱:** ${article.diaryName}
${article.url ? `🔗 **文章連結:** ${article.url}` : ''}
👤 **藝人:** ${article.artistName}
🌐 **博客首頁:** https://web.familyclub.jp/s/jwb/diary/${this.artistCode}
⏰ **檢測時間:** ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}

🎉 快去看看新內容吧！`;

        try {
            await this.notificationCallback(notificationMessage, 'blog_alert', 'FamilyClubBlog');
            console.log('📤 [通知] 新文章通知已發送');
        } catch (error) {
            console.error('❌ [通知] 通知發送失敗:', error.message);
        }
    }

    calculateNextCheckTime() {
        const now = new Date();
        const japanNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
        const currentHour = japanNow.getHours();
        
        const isActiveTime = currentHour >= 12 && currentHour <= 23;
        
        let nextCheck = new Date(japanNow);
        
        if (isActiveTime) {
            nextCheck.setHours(currentHour + 1);
            nextCheck.setMinutes(0);
            nextCheck.setSeconds(0);
            nextCheck.setMilliseconds(0);
        } else {
            if (currentHour < 12) {
                nextCheck.setHours(12);
            } else {
                nextCheck.setDate(nextCheck.getDate() + 1);
                nextCheck.setHours(12);
            }
            nextCheck.setMinutes(0);
            nextCheck.setSeconds(0);
            nextCheck.setMilliseconds(0);
        }
        
        const utcNow = new Date();
        const utcNext = new Date(nextCheck.getTime() - (9 * 60 * 60 * 1000));
        const waitTime = Math.max(0, utcNext.getTime() - utcNow.getTime());
        
        return Math.floor(waitTime / 1000);
    }

    startMonitoring() {
        if (this.isMonitoring) {
            console.log('⚠️ [監控] 博客監控已在運行中');
            return;
        }

        this.isMonitoring = true;
        console.log('🚀 [監控] 開始Family Club博客監控');
        console.log('⏰ [監控] 活躍時段: 日本時間12:00-24:00，每小時檢查');
        
        const monitorLoop = async () => {
            if (!this.isMonitoring) return;

            try {
                const newArticle = await this.checkForNewArticles();
                if (newArticle) {
                    await this.sendNewArticleNotification(newArticle);
                }

                const nextCheckSeconds = this.calculateNextCheckTime();
                const nextCheckTime = new Date(Date.now() + nextCheckSeconds * 1000)
                    .toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
                
                console.log(`⏰ [監控] 下次檢查: ${nextCheckTime}`);
                this.monitoringInterval = setTimeout(monitorLoop, nextCheckSeconds * 1000);

            } catch (error) {
                console.error('❌ [監控] 監控循環錯誤:', error.message);
                
                if (this.isMonitoring) {
                    console.log('⚠️ [監控] 10分鐘後重試');
                    this.monitoringInterval = setTimeout(monitorLoop, 10 * 60 * 1000);
                }
            }
        };

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

    stopMonitoring() {
        this.isMonitoring = false;
        
        if (this.monitoringInterval) {
            clearTimeout(this.monitoringInterval);
            this.monitoringInterval = null;
        }
        
        console.log('⏹️ [監控] Family Club博客監控已停止');
    }

    getStatus() {
        const japanNow = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
        const currentHour = new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo", hour: '2-digit', hour12: false });
        const isActiveTime = parseInt(currentHour) >= 12 && parseInt(currentHour) <= 23;
        
        let nextCheckTime = null;
        if (this.isMonitoring && this.monitoringInterval) {
            const nextCheckSeconds = this.calculateNextCheckTime();
            nextCheckTime = new Date(Date.now() + nextCheckSeconds * 1000).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
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
            artistName: this.artistName || '高木雄也',
            blogUrl: `https://web.familyclub.jp/s/jwb/diary/${this.artistCode}`,
            activeTimeSchedule: '日本時間12:00-24:00 (每小時00分檢查)',
            currentActiveTime: isActiveTime,
            japanTime: japanNow,
            latestRecord: {
                ...this.latestRecord,
                hasRecord: !!(this.latestRecord.articleCode || this.latestRecord.datetime)
            }
        };
    }

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

    async reinitialize() {
        console.log('🔄 [重新初始化] 手動重新初始化記錄...');
        return await this.initialize();
    }

    // 簡化的獲取最新文章方法，主要用於 !blog-latest 命令
    async getLatestArticles(limit = 5) {
        try {
            const articles = await this.fetchArticlesFromAPI();
            
            if (articles.length === 0) {
                return [];
            }
            
            const sortedArticles = articles.sort((a, b) => b.date - a.date);
            
            return sortedArticles.slice(0, limit).map(article => ({
                code: article.code,
                title: article.title,
                diaryName: article.diaryName,
                datetime: article.datetimeString,
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