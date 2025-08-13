const https = require('https');
const http = require('http');

class APIDetectorBlogMonitor {
    constructor(notificationCallback = null) {
        this.notificationCallback = notificationCallback;
        this.isMonitoring = false;
        this.monitoringInterval = null;
        this.checkIntervalMinutes = 60;
        this.totalChecks = 0;
        this.articlesFound = 0;
        this.lastCheckTime = null;
        this.foundApiEndpoint = null;
        
        // 博客監控配置
        this.blogUrl = 'https://web.familyclub.jp/s/jwb/diary/F2017?ima=3047';
        this.artistId = 'F2017';
        this.baseUrl = 'https://web.familyclub.jp';
        
        // 記錄最新文章信息
        this.latestRecord = {
            articleId: null,
            datetime: null,
            datetimeString: null,
            title: null,
            url: null,
            lastUpdated: null
        };
        
        console.log('🕵️ [API Detector] Family Club API 探測博客監控已初始化');
        console.log('🔗 [API Detector] 目標網址:', this.blogUrl);
        console.log('🎯 [API Detector] 目標藝人ID:', this.artistId);
    }

    // 安全HTTP請求
    makeRequest(url, options = {}) {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const isHttps = urlObj.protocol === 'https:';
            const client = isHttps ? https : http;
            
            const req = client.request(url, {
                method: options.method || 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'application/json, text/html, */*',
                    'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache',
                    'Referer': this.blogUrl,
                    'X-Requested-With': 'XMLHttpRequest', // 模擬 AJAX 請求
                    ...options.headers
                },
                timeout: 15000
            }, (res) => {
                let data = '';
                
                // 處理gzip壓縮
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

    // 生成可能的API端點
    generatePossibleEndpoints() {
        const endpoints = [
            // 基於觀察到的URL結構
            `${this.baseUrl}/s/jwb/diary/${this.artistId}/data`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}/list`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}/articles`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}/entries`,
            
            // JSON格式變體
            `${this.baseUrl}/s/jwb/diary/${this.artistId}.json`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}/data.json`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}/list.json`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}/entries.json`,
            
            // AJAX端點
            `${this.baseUrl}/ajax/jwb/diary/${this.artistId}`,
            `${this.baseUrl}/ajax/diary/${this.artistId}`,
            `${this.baseUrl}/ajax/diary/${this.artistId}/list`,
            `${this.baseUrl}/ajax/blog/${this.artistId}`,
            
            // API路徑
            `${this.baseUrl}/api/jwb/diary/${this.artistId}`,
            `${this.baseUrl}/api/diary/${this.artistId}`,
            `${this.baseUrl}/api/blog/${this.artistId}`,
            `${this.baseUrl}/api/artist/${this.artistId}/diary`,
            
            // 帶參數的原始URL
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?format=json`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?output=json`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?type=api`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?ajax=1`,
            
            // 移動端可能的端點
            `${this.baseUrl}/m/jwb/diary/${this.artistId}`,
            `${this.baseUrl}/mobile/api/diary/${this.artistId}`,
            
            // RSS/Feed 格式
            `${this.baseUrl}/s/jwb/diary/${this.artistId}/feed`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}/rss`,
            `${this.baseUrl}/feed/diary/${this.artistId}`,
            
            // 可能的分頁端點
            `${this.baseUrl}/s/jwb/diary/${this.artistId}/page/1`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?page=1`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?limit=10`,
            
            // 其他可能格式
            `${this.baseUrl}/data/jwb/diary/${this.artistId}`,
            `${this.baseUrl}/content/jwb/diary/${this.artistId}`,
            `${this.baseUrl}/load/jwb/diary/${this.artistId}`
        ];
        
        return endpoints;
    }

    // 探測API端點
    async detectAPIEndpoints() {
        console.log('🕵️ [API探測] 開始探測可能的API端點...');
        
        const endpoints = this.generatePossibleEndpoints();
        const results = [];
        
        for (let i = 0; i < endpoints.length; i++) {
            const endpoint = endpoints[i];
            
            try {
                console.log(`🔍 [${i+1}/${endpoints.length}] 測試: ${endpoint}`);
                
                const response = await this.makeRequest(endpoint);
                
                const result = {
                    url: endpoint,
                    statusCode: response.statusCode,
                    contentType: response.contentType,
                    dataLength: response.data.length,
                    isJson: false,
                    hasArticleData: false,
                    sample: response.data.substring(0, 200)
                };
                
                // 檢查是否是JSON格式
                if (response.contentType.includes('application/json') || 
                    this.isValidJSON(response.data)) {
                    result.isJson = true;
                    console.log(`✅ [API探測] 找到JSON端點: ${endpoint}`);
                    
                    try {
                        const jsonData = JSON.parse(response.data);
                        result.jsonData = jsonData;
                        
                        // 檢查是否包含文章數據
                        if (this.hasArticleStructure(jsonData)) {
                            result.hasArticleData = true;
                            console.log(`🎯 [API探測] 發現文章數據: ${endpoint}`);
                        }
                    } catch (e) {
                        // JSON解析失敗
                    }
                }
                
                // 檢查是否包含可能的文章關鍵字
                if (response.data.includes('title') || 
                    response.data.includes('content') || 
                    response.data.includes('date') ||
                    response.data.includes('diary') ||
                    response.data.includes('blog')) {
                    result.hasArticleData = true;
                    console.log(`📄 [API探測] 可能包含文章數據: ${endpoint}`);
                }
                
                results.push(result);
                
                // 找到有效的JSON端點就優先使用
                if (result.isJson && result.hasArticleData) {
                    console.log(`🎉 [API探測] 找到有效的API端點: ${endpoint}`);
                    this.foundApiEndpoint = endpoint;
                    break;
                }
                
            } catch (error) {
                console.log(`❌ [${i+1}/${endpoints.length}] 失敗: ${endpoint} - ${error.message}`);
                results.push({
                    url: endpoint,
                    error: error.message
                });
            }
            
            // 添加延遲避免被限制
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        console.log('📊 [API探測] 探測完成');
        return results;
    }

    // 檢查是否為有效JSON
    isValidJSON(str) {
        try {
            JSON.parse(str);
            return true;
        } catch (e) {
            return false;
        }
    }

    // 檢查JSON是否包含文章結構
    hasArticleStructure(data) {
        if (!data) return false;
        
        // 檢查常見的文章結構
        const articleIndicators = [
            'articles', 'entries', 'posts', 'diary', 'blog',
            'title', 'content', 'date', 'created', 'published',
            'id', 'slug', 'author'
        ];
        
        const jsonStr = JSON.stringify(data).toLowerCase();
        
        return articleIndicators.some(indicator => 
            jsonStr.includes(indicator)
        );
    }

    // 使用發現的API端點獲取文章
    async fetchArticlesFromAPI(endpoint) {
        try {
            console.log(`📡 [API獲取] 從API端點獲取文章: ${endpoint}`);
            
            const response = await this.makeRequest(endpoint);
            
            if (response.statusCode !== 200) {
                throw new Error(`HTTP錯誤: ${response.statusCode}`);
            }
            
            let articles = [];
            
            if (response.contentType.includes('application/json') || 
                this.isValidJSON(response.data)) {
                
                const jsonData = JSON.parse(response.data);
                articles = this.parseJSONArticles(jsonData);
                
            } else {
                // 如果不是JSON，嘗試從HTML中提取
                articles = this.parseHTMLArticles(response.data);
            }
            
            console.log(`📄 [API獲取] 成功獲取 ${articles.length} 篇文章`);
            return articles;
            
        } catch (error) {
            console.error('❌ [API獲取] 從API獲取失敗:', error.message);
            throw error;
        }
    }

    // 解析JSON格式的文章
    parseJSONArticles(data) {
        const articles = [];
        
        try {
            // 嘗試不同的JSON結構
            let articleArray = [];
            
            if (Array.isArray(data)) {
                articleArray = data;
            } else if (data.articles) {
                articleArray = data.articles;
            } else if (data.entries) {
                articleArray = data.entries;
            } else if (data.posts) {
                articleArray = data.posts;
            } else if (data.data) {
                articleArray = Array.isArray(data.data) ? data.data : [data.data];
            } else if (data.items) {
                articleArray = data.items;
            }
            
            articleArray.forEach((item, index) => {
                try {
                    const article = {
                        id: item.id || item.articleId || item.diary_id || (Date.now() + index),
                        title: item.title || item.subject || item.name || '未知標題',
                        content: item.content || item.body || item.text || '',
                        url: item.url || item.link || item.permalink || null,
                        dateString: item.date || item.created || item.published || item.createdAt || null
                    };
                    
                    // 解析日期
                    const timeInfo = this.parseDateTime(article.dateString);
                    if (timeInfo) {
                        article.date = timeInfo.date;
                        article.datetimeString = timeInfo.datetimeString;
                    } else {
                        const now = new Date();
                        article.date = now;
                        article.datetimeString = now.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
                    }
                    
                    articles.push(article);
                } catch (error) {
                    console.error('解析單個JSON文章失敗:', error);
                }
            });
            
        } catch (error) {
            console.error('❌ [JSON解析] 解析JSON文章失敗:', error.message);
        }
        
        return articles;
    }

    // 解析HTML格式的文章（簡化版）
    parseHTMLArticles(html) {
        const articles = [];
        
        try {
            // 基本的HTML文章提取
            const titleMatches = html.match(/<title[^>]*>([^<]+)<\/title>/gi) || [];
            const dateMatches = html.match(/(\d{4})[年](\d{1,2})[月](\d{1,2})[日]/g) || [];
            const linkMatches = html.match(/href="([^"]*diary[^"]*)"/gi) || [];
            
            if (titleMatches.length > 0 || dateMatches.length > 0) {
                const article = {
                    id: Date.now(),
                    title: titleMatches[0] ? titleMatches[0].replace(/<[^>]*>/g, '') : '從HTML提取的文章',
                    url: linkMatches[0] ? linkMatches[0].match(/href="([^"]*)"/)[1] : null,
                    dateString: dateMatches[0] || null
                };
                
                const timeInfo = this.parseDateTime(article.dateString);
                if (timeInfo) {
                    article.date = timeInfo.date;
                    article.datetimeString = timeInfo.datetimeString;
                } else {
                    const now = new Date();
                    article.date = now;
                    article.datetimeString = now.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
                }
                
                articles.push(article);
            }
            
        } catch (error) {
            console.error('❌ [HTML解析] 解析HTML文章失敗:', error.message);
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
        
        // 按ID排序
        const articlesWithId = articles.filter(a => a.id !== null && !isNaN(a.id));
        if (articlesWithId.length > 0) {
            return articlesWithId.sort((a, b) => b.id - a.id)[0];
        }
        
        // 按時間排序
        return articles.sort((a, b) => b.date - a.date)[0];
    }

    // 初始化
    async initialize() {
        try {
            console.log('🚀 [API探測] 正在初始化API探測博客監控...');
            
            // 首先探測API端點
            const detectionResults = await this.detectAPIEndpoints();
            
            let articles = [];
            
            if (this.foundApiEndpoint) {
                console.log(`🎯 [初始化] 使用發現的API端點: ${this.foundApiEndpoint}`);
                articles = await this.fetchArticlesFromAPI(this.foundApiEndpoint);
            } else {
                console.log('⚠️ [初始化] 未找到有效的API端點，嘗試原始頁面...');
                
                // 回退到原始頁面
                const response = await this.makeRequest(this.blogUrl);
                if (response.statusCode === 200) {
                    articles = this.parseHTMLArticles(response.data);
                }
            }
            
            if (articles.length === 0) {
                console.warn('⚠️ [API探測] 未找到任何文章');
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
            
            console.log('✅ [API探測] 初始化完成，建立基準記錄:');
            console.log(`   📄 文章ID: ${this.latestRecord.articleId}`);
            console.log(`   🗓️ 發佈時間: ${this.latestRecord.datetimeString}`);
            console.log(`   📝 標題: ${this.latestRecord.title}`);
            console.log(`   🔗 URL: ${this.latestRecord.url}`);
            console.log(`   🎯 使用端點: ${this.foundApiEndpoint || '原始頁面'}`);
            
            return true;
            
        } catch (error) {
            console.error('❌ [API探測] 初始化失敗:', error.message);
            return false;
        }
    }

    // 檢查是否有新文章
    async checkForNewArticles(testMode = false) {
        try {
            console.log(`🔍 [檢查更新] 檢查新文章（API探測模式）... ${testMode ? '(測試模式)' : ''}`);
            this.totalChecks++;
            this.lastCheckTime = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

            let articles = [];
            
            if (this.foundApiEndpoint) {
                articles = await this.fetchArticlesFromAPI(this.foundApiEndpoint);
            } else {
                const response = await this.makeRequest(this.blogUrl);
                if (response.statusCode === 200) {
                    articles = this.parseHTMLArticles(response.data);
                }
            }
            
            if (articles.length === 0) {
                console.log('📋 [檢查更新] 未找到文章');
                return null;
            }
            
            const latestArticle = this.findLatestArticle(articles);
            
            if (testMode) {
                console.log(`📝 [測試模式] 當前最新文章: ID=${latestArticle.id}, 時間=${latestArticle.datetimeString}`);
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
            console.error('❌ [檢查更新] API探測檢查失敗:', error.message);
            return null;
        }
    }

    // 測試網站連接
    async testWebsiteAccess() {
        try {
            console.log('🔍 [測試連接] 測試API探測博客連接...');
            
            // 重新探測API端點
            const detectionResults = await this.detectAPIEndpoints();
            
            let testResult = {
                success: true,
                method: 'API Detection + Fallback',
                detectedEndpoints: detectionResults.filter(r => !r.error).length,
                validJsonEndpoints: detectionResults.filter(r => r.isJson).length,
                endpointsWithArticles: detectionResults.filter(r => r.hasArticleData).length,
                foundApiEndpoint: this.foundApiEndpoint,
                sampleEndpoints: detectionResults.slice(0, 5)
            };
            
            // 測試獲取文章
            if (this.foundApiEndpoint) {
                try {
                    const articles = await this.fetchArticlesFromAPI(this.foundApiEndpoint);
                    testResult.articlesFound = articles.length;
                    testResult.sampleArticles = articles.slice(0, 3).map(a => ({
                        id: a.id,
                        time: a.datetimeString,
                        title: a.title
                    }));
                } catch (e) {
                    testResult.apiError = e.message;
                }
            } else {
                // 回退測試
                try {
                    const response = await this.makeRequest(this.blogUrl);
                    testResult.fallbackStatus = response.statusCode;
                    testResult.fallbackContentLength = response.data.length;
                    
                    const articles = this.parseHTMLArticles(response.data);
                    testResult.articlesFound = articles.length;
                    testResult.sampleArticles = articles.slice(0, 3).map(a => ({
                        id: a.id,
                        time: a.datetimeString,
                        title: a.title
                    }));
                } catch (e) {
                    testResult.fallbackError = e.message;
                }
            }
            
            return testResult;

        } catch (error) {
            console.error('❌ [測試連接] API探測測試失敗:', error.message);
            return {
                success: false,
                error: error.message,
                method: 'API Detection + Fallback'
            };
        }
    }

    // 發送新文章通知
    async sendNewArticleNotification(article) {
        if (!this.notificationCallback) return;

        const notificationMessage = `📝 **Family Club 新文章發布!** (API探測)

📄 **文章ID:** ${article.id || '未知'}
🗓️ **發布時間:** ${article.datetimeString}
📝 **標題:** ${article.title || '未知標題'}
${article.url ? `🔗 **文章連結:** ${article.url}` : ''}
🌐 **博客首頁:** ${this.blogUrl}
⏰ **檢測時間:** ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
🎯 **檢測方式:** ${this.foundApiEndpoint ? `API端點: ${this.foundApiEndpoint}` : 'HTML解析回退'}

🎉 快去看看新內容吧！`;

        try {
            await this.notificationCallback(notificationMessage, 'blog_alert', 'APIDetectorBlog');
            console.log('📤 [通知] API探測新文章通知已發送');
        } catch (error) {
            console.error('❌ [通知] API探測通知發送失敗:', error.message);
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
            console.log('⚠️ [監控] API探測監控已在運行中');
            return;
        }

        this.isMonitoring = true;
        console.log('🚀 [監控] 開始Family Club API探測博客監控 (每小時00分檢查)');
        
        const monitorLoop = async () => {
            if (!this.isMonitoring) {
                console.log('⏹️ [監控] API探測監控已停止');
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
                console.error('❌ [監控] API探測監控循環錯誤:', error.message);
                
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
                console.error('❌ [監控] API探測初始化失敗，停止監控');
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
        
        console.log('⏹️ [監控] Family Club API探測博客監控已停止');
    }

    // 獲取狀態
    getStatus() {
        return {
            isMonitoring: this.isMonitoring,
            totalChecks: this.totalChecks,
            articlesFound: this.articlesFound,
            lastCheckTime: this.lastCheckTime,
            nextCheckTime: this.isMonitoring ? new Date(Date.now() + this.calculateNextCheckTime() * 1000).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : null,
            blogUrl: this.blogUrl,
            method: 'API Detection + Fallback',
            foundApiEndpoint: this.foundApiEndpoint,
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
        console.log('🔄 [重新初始化] 手動重新初始化API探測記錄...');
        this.foundApiEndpoint = null; // 重置API端點，重新探測
        return await this.initialize();
    }

    // 獲取探測結果（調試用）
    async getDetectionResults() {
        console.log('🕵️ [調試] 執行API端點探測...');
        return await this.detectAPIEndpoints();
    }
}

module.exports = APIDetectorBlogMonitor;