const https = require('https');

class JSONPBlogMonitor {
    constructor(notificationCallback = null) {
        this.notificationCallback = notificationCallback;
        this.isMonitoring = false;
        this.monitoringInterval = null;
        this.checkIntervalMinutes = 60;
        this.totalChecks = 0;
        this.articlesFound = 0;
        this.lastCheckTime = null;
        
        // 基於發現的最佳端點
        this.apiEndpoint = 'https://web.familyclub.jp/s/jwb/diary/F2017?ima=3047&callback=jsonp';
        this.baseUrl = 'https://web.familyclub.jp';
        this.artistId = 'F2017';
        this.ima = '3047';
        
        // 記錄最新文章信息
        this.latestRecord = {
            articleId: null,
            datetime: null,
            datetimeString: null,
            title: null,
            url: null,
            lastUpdated: null
        };
        
        console.log('🎯 [JSONP Monitor] Family Club JSONP博客監控已初始化');
        console.log('✅ [JSONP Monitor] 使用發現的最佳端點:', this.apiEndpoint);
    }

    // HTTP請求
    makeRequest(url, options = {}) {
        return new Promise((resolve, reject) => {
            const req = https.request(url, {
                method: options.method || 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Cache-Control': 'no-cache',
                    'Referer': 'https://web.familyclub.jp/s/jwb/diary/F2017?ima=3047',
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

    // 解析JSONP響應
    parseJSONPResponse(data) {
        try {
            console.log('🔍 [JSONP解析] 開始解析JSONP響應...');
            
            // JSONP通常格式為: callback({...data...})
            // 先嘗試提取JSON部分
            let jsonData = null;
            
            // 嘗試多種JSONP解析模式
            const jsonpPatterns = [
                /jsonp\s*\(\s*({.*})\s*\)/s,
                /callback\s*\(\s*({.*})\s*\)/s,
                /\w+\s*\(\s*({.*})\s*\)/s,
                /^[^{]*({.*})[^}]*$/s
            ];
            
            for (const pattern of jsonpPatterns) {
                const match = data.match(pattern);
                if (match) {
                    try {
                        jsonData = JSON.parse(match[1]);
                        console.log('✅ [JSONP解析] JSONP JSON部分解析成功');
                        break;
                    } catch (e) {
                        continue;
                    }
                }
            }
            
            // 如果JSONP解析失敗，嘗試直接解析為JSON
            if (!jsonData) {
                try {
                    jsonData = JSON.parse(data);
                    console.log('✅ [JSONP解析] 直接JSON解析成功');
                } catch (e) {
                    console.log('⚠️ [JSONP解析] JSON解析失敗，嘗試HTML解析');
                    return this.parseHTMLResponse(data);
                }
            }
            
            return this.extractArticlesFromJSON(jsonData);
            
        } catch (error) {
            console.error('❌ [JSONP解析] JSONP解析失敗:', error.message);
            // 回退到HTML解析
            return this.parseHTMLResponse(data);
        }
    }

    // 從JSON數據中提取文章
    extractArticlesFromJSON(data) {
        const articles = [];
        
        try {
            console.log('📄 [JSON解析] 開始從JSON提取文章...');
            
            // 檢查多種可能的JSON結構
            let articleArray = [];
            
            if (Array.isArray(data)) {
                articleArray = data;
            } else if (data.articles && Array.isArray(data.articles)) {
                articleArray = data.articles;
            } else if (data.entries && Array.isArray(data.entries)) {
                articleArray = data.entries;
            } else if (data.diary && Array.isArray(data.diary)) {
                articleArray = data.diary;
            } else if (data.posts && Array.isArray(data.posts)) {
                articleArray = data.posts;
            } else if (data.data) {
                if (Array.isArray(data.data)) {
                    articleArray = data.data;
                } else if (data.data.articles) {
                    articleArray = data.data.articles;
                } else if (data.data.entries) {
                    articleArray = data.data.entries;
                }
            } else if (data.items && Array.isArray(data.items)) {
                articleArray = data.items;
            } else {
                // 如果沒有明顯的數組，檢查所有屬性
                Object.keys(data).forEach(key => {
                    if (Array.isArray(data[key]) && data[key].length > 0) {
                        // 檢查數組元素是否像文章
                        const firstItem = data[key][0];
                        if (firstItem && typeof firstItem === 'object' && 
                            (firstItem.title || firstItem.id || firstItem.content)) {
                            articleArray = data[key];
                        }
                    }
                });
            }
            
            console.log(`📊 [JSON解析] 找到 ${articleArray.length} 個潛在文章項目`);
            
            articleArray.forEach((item, index) => {
                try {
                    if (!item || typeof item !== 'object') return;
                    
                    const article = {
                        id: item.id || item.articleId || item.diary_id || item.entryId || (Date.now() + index),
                        title: item.title || item.subject || item.headline || item.name || '未知標題',
                        content: item.content || item.body || item.text || item.description || '',
                        url: item.url || item.link || item.permalink || null,
                        dateString: item.date || item.created || item.published || item.createdAt || 
                                   item.updatedAt || item.datetime || null,
                        author: item.author || item.writer || null
                    };
                    
                    // 解析日期
                    const timeInfo = this.parseDateTime(article.dateString);
                    if (timeInfo) {
                        article.date = timeInfo.date;
                        article.datetimeString = timeInfo.datetimeString;
                    } else {
                        // 如果沒有有效日期，使用當前時間但標記為估計
                        const now = new Date();
                        article.date = now;
                        article.datetimeString = now.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
                        article.dateEstimated = true;
                    }
                    
                    // 處理URL
                    if (article.url && !article.url.startsWith('http')) {
                        article.url = this.baseUrl + (article.url.startsWith('/') ? '' : '/') + article.url;
                    }
                    
                    articles.push(article);
                    console.log(`📝 [JSON解析] 文章 ${index + 1}: ID=${article.id}, 標題="${article.title.substring(0, 30)}..."`);
                    
                } catch (error) {
                    console.error(`❌ [JSON解析] 解析文章 ${index + 1} 失敗:`, error.message);
                }
            });
            
            console.log(`✅ [JSON解析] 成功解析 ${articles.length} 篇文章`);
            
        } catch (error) {
            console.error('❌ [JSON解析] JSON文章提取失敗:', error.message);
        }
        
        return articles;
    }

    // HTML解析作為回退
    parseHTMLResponse(html) {
        const articles = [];
        
        try {
            console.log('📄 [HTML解析] 開始HTML回退解析...');
            
            // 尋找文章標題
            const titleMatches = html.match(/<h[1-4][^>]*>([^<]{5,100})<\/h[1-4]>/gi) || [];
            const dateMatches = html.match(/(\d{4})[年\/\-](\d{1,2})[月\/\-](\d{1,2})[日]?/g) || [];
            
            titleMatches.forEach((titleMatch, index) => {
                const titleText = titleMatch.replace(/<[^>]*>/g, '').trim();
                if (titleText && titleText.length > 3 && 
                    !titleText.includes('ログイン') && 
                    !titleText.includes('TOP')) {
                    
                    const article = {
                        id: Date.now() + index,
                        title: titleText,
                        content: '',
                        url: null,
                        dateString: dateMatches[index] || null
                    };
                    
                    const timeInfo = this.parseDateTime(article.dateString);
                    if (timeInfo) {
                        article.date = timeInfo.date;
                        article.datetimeString = timeInfo.datetimeString;
                    } else {
                        const now = new Date();
                        article.date = now;
                        article.datetimeString = now.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
                        article.dateEstimated = true;
                    }
                    
                    articles.push(article);
                }
            });
            
            console.log(`📊 [HTML解析] HTML回退解析找到 ${articles.length} 篇文章`);
            
        } catch (error) {
            console.error('❌ [HTML解析] HTML解析失敗:', error.message);
        }
        
        return articles;
    }

    // 解析日期時間
    parseDateTime(dateString) {
        try {
            if (!dateString) return null;

            let date = null;

            // 日文日期格式
            const jpPatterns = [
                /(\d{4})[年](\d{1,2})[月](\d{1,2})[日]\s*(\d{1,2}):(\d{2})/,
                /(\d{4})\.(\d{1,2})\.(\d{1,2})\s+(\d{1,2}):(\d{2})/,
                /(\d{4})[年](\d{1,2})[月](\d{1,2})[日]/,
                /(\d{4})\.(\d{1,2})\.(\d{1,2})/,
                /(\d{4})\/(\d{1,2})\/(\d{1,2})/,
                /(\d{4})-(\d{1,2})-(\d{1,2})/
            ];
            
            for (const pattern of jpPatterns) {
                const match = dateString.match(pattern);
                if (match) {
                    const year = parseInt(match[1]);
                    const month = parseInt(match[2]) - 1;
                    const day = parseInt(match[3]);
                    const hour = match[4] ? parseInt(match[4]) : 0;
                    const minute = match[5] ? parseInt(match[5]) : 0;
                    
                    date = new Date(year, month, day, hour, minute);
                    break;
                }
            }
            
            // ISO格式
            if (!date && (dateString.includes('T') || dateString.includes('-'))) {
                date = new Date(dateString);
            }
            
            if (!date || isNaN(date.getTime())) {
                return null;
            }
            
            return {
                date: date,
                datetimeString: `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
            };
            
        } catch (error) {
            console.error('❌ [日期解析] 失敗:', error.message);
            return null;
        }
    }

    // 找出最新文章
    findLatestArticle(articles) {
        if (articles.length === 0) {
            return null;
        }
        
        // 優先按ID排序（數字越大越新）
        const articlesWithId = articles.filter(a => a.id && !isNaN(a.id));
        if (articlesWithId.length > 0) {
            console.log('📊 [最新文章] 按ID排序查找最新文章');
            return articlesWithId.sort((a, b) => b.id - a.id)[0];
        }
        
        // 否則按時間排序
        console.log('📊 [最新文章] 按時間排序查找最新文章');
        return articles.sort((a, b) => b.date - a.date)[0];
    }

    // 初始化
    async initialize() {
        try {
            console.log('🚀 [JSONP Monitor] 正在初始化JSONP博客監控...');
            console.log('🎯 [JSONP Monitor] 使用發現的最佳API端點');
            
            const response = await this.makeRequest(this.apiEndpoint);
            
            if (response.statusCode !== 200) {
                throw new Error(`HTTP錯誤: ${response.statusCode}`);
            }
            
            console.log(`📊 [JSONP Monitor] 成功獲取響應，長度: ${response.data.length} 字元`);
            console.log(`📋 [JSONP Monitor] Content-Type: ${response.contentType}`);
            
            const articles = this.parseJSONPResponse(response.data);
            
            if (articles.length === 0) {
                console.warn('⚠️ [JSONP Monitor] 未找到任何文章');
                return false;
            }
            
            const latestArticle = this.findLatestArticle(articles);
            
            this.latestRecord = {
                articleId: latestArticle.id,
                datetime: latestArticle.date,
                datetimeString: latestArticle.datetimeString,
                title: latestArticle.title,
                url: latestArticle.url,
                lastUpdated: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
            };
            
            console.log('✅ [JSONP Monitor] JSONP監控初始化完成，建立基準記錄:');
            console.log(`   📄 文章ID: ${this.latestRecord.articleId}`);
            console.log(`   🗓️ 發佈時間: ${this.latestRecord.datetimeString}`);
            console.log(`   📝 標題: ${this.latestRecord.title}`);
            console.log(`   🔗 URL: ${this.latestRecord.url}`);
            console.log(`   📊 總文章數: ${articles.length}`);
            
            return true;
            
        } catch (error) {
            console.error('❌ [JSONP Monitor] 初始化失敗:', error.message);
            return false;
        }
    }

    // 檢查是否有新文章
    async checkForNewArticles(testMode = false) {
        try {
            console.log(`🔍 [檢查更新] 檢查新文章（JSONP模式）... ${testMode ? '(測試模式)' : ''}`);
            this.totalChecks++;
            this.lastCheckTime = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

            const response = await this.makeRequest(this.apiEndpoint);
            
            if (response.statusCode !== 200) {
                throw new Error(`HTTP錯誤: ${response.statusCode}`);
            }
            
            const articles = this.parseJSONPResponse(response.data);
            
            if (articles.length === 0) {
                console.log('📋 [檢查更新] 未找到文章');
                return null;
            }
            
            const latestArticle = this.findLatestArticle(articles);
            
            if (testMode) {
                console.log(`📝 [測試模式] 當前最新文章: ID=${latestArticle.id}, 時間=${latestArticle.datetimeString}`);
                console.log(`📊 [測試模式] 總文章數: ${articles.length}`);
                return latestArticle;
            }
            
            // 檢查是否有更新
            let hasUpdate = false;
            let updateReason = '';
            
            if (!this.latestRecord.articleId && !this.latestRecord.datetime) {
                hasUpdate = true;
                updateReason = '初始化記錄';
            } else {
                if (latestArticle.id && this.latestRecord.articleId && latestArticle.id > this.latestRecord.articleId) {
                    hasUpdate = true;
                    updateReason = `新文章ID: ${latestArticle.id} > ${this.latestRecord.articleId}`;
                }
                
                if (!hasUpdate && latestArticle.date && this.latestRecord.datetime && latestArticle.date > this.latestRecord.datetime) {
                    hasUpdate = true;
                    updateReason = `新發佈時間: ${latestArticle.datetimeString} > ${this.latestRecord.datetimeString}`;
                }
                
                // 標題變化也可能表示新文章
                if (!hasUpdate && latestArticle.title !== this.latestRecord.title) {
                    hasUpdate = true;
                    updateReason = `標題變化: "${latestArticle.title}" != "${this.latestRecord.title}"`;
                }
            }
            
            if (hasUpdate) {
                console.log(`📝 [檢查更新] 發現新文章! 原因: ${updateReason}`);
                
                this.latestRecord = {
                    articleId: latestArticle.id,
                    datetime: latestArticle.date,
                    datetimeString: latestArticle.datetimeString,
                    title: latestArticle.title,
                    url: latestArticle.url,
                    lastUpdated: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
                };
                
                this.articlesFound++;
                return latestArticle;
            }
            
            console.log('📋 [檢查更新] 無新文章');
            return null;

        } catch (error) {
            console.error('❌ [檢查更新] JSONP檢查失敗:', error.message);
            return null;
        }
    }

    // 發送新文章通知
    async sendNewArticleNotification(article) {
        if (!this.notificationCallback) return;

        const notificationMessage = `📝 **Family Club 新文章發布!** (JSONP API)

📄 **文章ID:** ${article.id || '未知'}
🗓️ **發布時間:** ${article.datetimeString}${article.dateEstimated ? ' (估計)' : ''}
📝 **標題:** ${article.title || '未知標題'}
${article.url ? `🔗 **文章連結:** ${article.url}` : ''}
${article.author ? `✍️ **作者:** ${article.author}` : ''}
🌐 **博客首頁:** https://web.familyclub.jp/s/jwb/diary/F2017?ima=3047
⏰ **檢測時間:** ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
🎯 **檢測方式:** JSONP API (發現的最佳端點)

🎉 快去看看新內容吧！`;

        try {
            await this.notificationCallback(notificationMessage, 'blog_alert', 'JSONPBlog');
            console.log('📤 [通知] JSONP新文章通知已發送');
        } catch (error) {
            console.error('❌ [通知] JSONP通知發送失敗:', error.message);
        }
    }

    // 測試API連接
    async testWebsiteAccess() {
        try {
            console.log('🔍 [測試連接] 測試JSONP API連接...');
            
            const response = await this.makeRequest(this.apiEndpoint);
            
            if (response.statusCode === 200) {
                const articles = this.parseJSONPResponse(response.data);
                
                return {
                    success: true,
                    method: 'JSONP API',
                    endpoint: this.apiEndpoint,
                    statusCode: response.statusCode,
                    contentType: response.contentType,
                    contentLength: response.data.length,
                    articlesFound: articles.length,
                    sampleArticles: articles.slice(0, 3).map(a => ({
                        id: a.id,
                        time: a.datetimeString,
                        title: a.title
                    }))
                };
            } else {
                return {
                    success: false,
                    error: `HTTP ${response.statusCode}`,
                    method: 'JSONP API'
                };
            }

        } catch (error) {
            console.error('❌ [測試連接] JSONP測試失敗:', error.message);
            return {
                success: false,
                error: error.message,
                method: 'JSONP API'
            };
        }
    }

    // 計算下次檢查時間
    calculateNextCheckTime() {
        const now = new Date();
        const nextCheck = new Date(now);
        
        nextCheck.setHours(now.getHours() + 1);
        nextCheck.setMinutes(0);
        nextCheck.setSeconds(0);
        nextCheck.setMilliseconds(0);

        const waitTime = nextCheck.getTime() - now.getTime();
        return Math.floor(waitTime / 1000);
    }

    // 開始監控
    startMonitoring() {
        if (this.isMonitoring) {
            console.log('⚠️ [監控] JSONP監控已在運行中');
            return;
        }

        this.isMonitoring = true;
        console.log('🚀 [監控] 開始Family Club JSONP博客監控 (每小時00分檢查)');
        
        const monitorLoop = async () => {
            if (!this.isMonitoring) {
                console.log('⏹️ [監控] JSONP監控已停止');
                return;
            }

            try {
                const newArticle = await this.checkForNewArticles();
                if (newArticle) {
                    await this.sendNewArticleNotification(newArticle);
                }

                const nextCheckSeconds = this.calculateNextCheckTime();
                const nextCheckTime = new Date(Date.now() + nextCheckSeconds * 1000)
                    .toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
                
                console.log(`⏰ [監控] 下次檢查: ${nextCheckTime} (${Math.round(nextCheckSeconds/60)}分鐘後)`);

                this.monitoringInterval = setTimeout(monitorLoop, nextCheckSeconds * 1000);

            } catch (error) {
                console.error('❌ [監控] JSONP監控循環錯誤:', error.message);
                
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
                console.error('❌ [監控] JSONP初始化失敗，停止監控');
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
        
        console.log('⏹️ [監控] Family Club JSONP博客監控已停止');
    }

    // 獲取狀態
    getStatus() {
        return {
            isMonitoring: this.isMonitoring,
            totalChecks: this.totalChecks,
            articlesFound: this.articlesFound,
            lastCheckTime: this.lastCheckTime,
            nextCheckTime: this.isMonitoring ? new Date(Date.now() + this.calculateNextCheckTime() * 1000).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : null,
            method: 'JSONP API',
            endpoint: this.apiEndpoint,
            latestRecord: {
                ...this.latestRecord,
                hasRecord: !!(this.latestRecord.articleId || this.latestRecord.datetime)
            }
        };
    }

    // 獲取當前最新記錄
    getLatestRecord() {
        if (!this.latestRecord.articleId && !this.latestRecord.datetime) {
            return null;
        }
        
        return {
            articleId: this.latestRecord.articleId,
            datetime: this.latestRecord.datetimeString,
            title: this.latestRecord.title,
            url: this.latestRecord.url,
            lastUpdated: this.latestRecord.lastUpdated
        };
    }

    // 手動重新初始化
    async reinitialize() {
        console.log('🔄 [重新初始化] 手動重新初始化JSONP記錄...');
        return await this.initialize();
    }
}

module.exports = JSONPBlogMonitor;