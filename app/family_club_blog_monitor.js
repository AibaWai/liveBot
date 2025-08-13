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
        
        // 基於你發現的真正API端點
        this.apiEndpoint = 'https://web.familyclub.jp/s/jwb/api/list/diarkiji_list';
        this.artistCode = 'F2017';
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
        
        console.log('📝 [博客監控] Family Club 博客監控已初始化');
        console.log('🎯 [博客監控] 使用真正的API端點:', this.apiEndpoint);
        console.log('🎨 [博客監控] 目標藝人:', this.artistCode);
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

    // 從真正的API獲取文章列表
    async fetchArticlesFromAPI() {
        try {
            console.log('📡 [API獲取] 從真正的API端點獲取文章列表');
            
            // 構建API URL - 基於你發現的真實端點
            const apiUrl = `${this.apiEndpoint}?code=${this.artistCode}&so=JW5&page=0`;
            console.log('🔗 [API獲取] 請求URL:', apiUrl);
            
            const response = await this.makeRequest(apiUrl);
            
            if (response.statusCode !== 200) {
                throw new Error(`API請求失敗: HTTP ${response.statusCode}`);
            }
            
            console.log(`📊 [API獲取] 成功獲取響應，長度: ${response.data.length} 字元`);
            console.log(`📋 [API獲取] Content-Type: ${response.contentType}`);
            
            // 顯示響應的前500字符以供調試
            console.log('📄 [API響應] 前500字符:', response.data.substring(0, 500));
            
            let articles = [];
            
            // 嘗試解析JSON響應
            if (response.contentType.includes('application/json') || this.isValidJSON(response.data)) {
                console.log('✅ [API解析] 響應是JSON格式');
                const jsonData = JSON.parse(response.data);
                articles = this.parseJSONArticles(jsonData);
            } else {
                console.log('📄 [API解析] 響應不是JSON，嘗試HTML解析');
                articles = this.parseHTMLResponse(response.data);
            }
            
            console.log(`📝 [API獲取] 成功解析 ${articles.length} 篇文章`);
            return articles;
            
        } catch (error) {
            console.error('❌ [API獲取] 獲取失敗:', error.message);
            throw error;
        }
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

    // 解析JSON格式的文章
    parseJSONArticles(data) {
        const articles = [];
        
        try {
            console.log('📄 [JSON解析] 開始解析JSON文章數據');
            console.log('📊 [JSON結構] 頂層keys:', Object.keys(data));
            
            // 檢查多種可能的JSON結構
            let articleArray = [];
            
            if (Array.isArray(data)) {
                console.log('📋 [JSON解析] 數據是頂層陣列');
                articleArray = data;
            } else if (data.items && Array.isArray(data.items)) {
                console.log('📋 [JSON解析] 找到 data.items 陣列');
                articleArray = data.items;
            } else if (data.list && Array.isArray(data.list)) {
                console.log('📋 [JSON解析] 找到 data.list 陣列');
                articleArray = data.list;
            } else if (data.articles && Array.isArray(data.articles)) {
                console.log('📋 [JSON解析] 找到 data.articles 陣列');
                articleArray = data.articles;
            } else if (data.entries && Array.isArray(data.entries)) {
                console.log('📋 [JSON解析] 找到 data.entries 陣列');
                articleArray = data.entries;
            } else if (data.diary && Array.isArray(data.diary)) {
                console.log('📋 [JSON解析] 找到 data.diary 陣列');
                articleArray = data.diary;
            } else if (data.data) {
                if (Array.isArray(data.data)) {
                    console.log('📋 [JSON解析] 找到 data.data 陣列');
                    articleArray = data.data;
                } else if (data.data.items && Array.isArray(data.data.items)) {
                    console.log('📋 [JSON解析] 找到 data.data.items 陣列');
                    articleArray = data.data.items;
                } else if (data.data.list && Array.isArray(data.data.list)) {
                    console.log('📋 [JSON解析] 找到 data.data.list 陣列');
                    articleArray = data.data.list;
                }
            } else {
                // 搜索所有可能包含文章的屬性
                console.log('🔍 [JSON解析] 搜索所有可能的文章陣列');
                Object.keys(data).forEach(key => {
                    if (Array.isArray(data[key]) && data[key].length > 0) {
                        const firstItem = data[key][0];
                        if (firstItem && typeof firstItem === 'object') {
                            console.log(`🔍 [JSON解析] 檢查 ${key} 陣列:`, Object.keys(firstItem));
                            // 檢查是否包含文章相關的欄位
                            const hasArticleFields = Object.keys(firstItem).some(field => 
                                ['id', 'title', 'subject', 'content', 'date', 'created', 'url', 'link'].includes(field.toLowerCase())
                            );
                            if (hasArticleFields) {
                                console.log(`✅ [JSON解析] ${key} 看起來像文章陣列`);
                                articleArray = data[key];
                            }
                        }
                    }
                });
            }
            
            console.log(`📊 [JSON解析] 找到 ${articleArray.length} 個潛在文章項目`);
            
            if (articleArray.length > 0) {
                console.log('📝 [JSON解析] 第一個項目的結構:', Object.keys(articleArray[0]));
            }
            
            articleArray.forEach((item, index) => {
                try {
                    if (!item || typeof item !== 'object') {
                        console.log(`⚠️ [JSON解析] 項目 ${index} 不是有效對象`);
                        return;
                    }
                    
                    // 嘗試多種可能的欄位名稱
                    const article = {
                        id: item.id || item.articleId || item.diary_id || item.entryId || item.kiji_id || (Date.now() + index),
                        title: item.title || item.subject || item.headline || item.name || item.kiji_title || '未知標題',
                        content: item.content || item.body || item.text || item.description || item.kiji_content || '',
                        url: item.url || item.link || item.permalink || item.kiji_url || null,
                        dateString: item.date || item.created || item.published || item.createdAt || 
                                   item.updatedAt || item.datetime || item.kiji_date || item.post_date || null,
                        author: item.author || item.writer || item.user || null
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
            console.log('📄 [HTML解析] 開始HTML回退解析');
            
            // 尋找文章標題
            const titleMatches = html.match(/<h[1-4][^>]*>([^<]{5,100})<\/h[1-4]>/gi) || [];
            const dateMatches = html.match(/(\d{4})[年\/\-](\d{1,2})[月\/\-](\d{1,2})[日]?/g) || [];
            const linkMatches = html.match(/href="([^"]*diary[^"]*)"/gi) || [];
            
            console.log(`📊 [HTML解析] 找到 ${titleMatches.length} 個標題, ${dateMatches.length} 個日期, ${linkMatches.length} 個連結`);
            
            titleMatches.forEach((titleMatch, index) => {
                const titleText = titleMatch.replace(/<[^>]*>/g, '').trim();
                if (titleText && titleText.length > 3 && 
                    !titleText.includes('ログイン') && 
                    !titleText.includes('TOP') && 
                    !titleText.includes('MENU')) {
                    
                    const article = {
                        id: Date.now() + index,
                        title: titleText,
                        content: '',
                        url: linkMatches[index] ? linkMatches[index].match(/href="([^"]*)"/)[1] : null,
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
                    
                    if (article.url && !article.url.startsWith('http')) {
                        article.url = this.baseUrl + (article.url.startsWith('/') ? '' : '/') + article.url;
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
            
            // ISO格式和其他標準格式
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
        
        // 打印所有文章ID用於調試
        console.log('🔍 [最新文章] 所有文章ID:', articles.map(a => a.id).join(', '));
        
        // 優先按ID排序（數字越大越新）
        const articlesWithNumericId = articles.filter(a => a.id && !isNaN(a.id));
        if (articlesWithNumericId.length > 0) {
            console.log('📊 [最新文章] 按數字ID排序查找最新文章');
            // 確保正確的數字比較
            const sorted = articlesWithNumericId.sort((a, b) => {
                const idA = Number(a.id);
                const idB = Number(b.id);
                console.log(`🔍 [排序] 比較 ${idA} vs ${idB} = ${idB - idA}`);
                return idB - idA;
            });
            console.log('📊 [最新文章] 排序後的前3個ID:', sorted.slice(0, 3).map(a => a.id).join(', '));
            return sorted[0];
        }
        
        // 否則按時間排序
        console.log('📊 [最新文章] 按時間排序查找最新文章');
        return articles.sort((a, b) => b.date - a.date)[0];
    }

    // 初始化
    async initialize() {
        try {
            console.log('🚀 [博客監控] 正在初始化Family Club博客監控...');
            console.log('🔗 [博客監控] 使用真正的API端點進行初始化');
            
            const articles = await this.fetchArticlesFromAPI();
            
            if (articles.length === 0) {
                console.warn('⚠️ [博客監控] 初始化時未找到任何文章');
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
            
            console.log('✅ [博客監控] 初始化完成，建立基準記錄:');
            console.log(`   📄 文章ID: ${this.latestRecord.articleId}`);
            console.log(`   🗓️ 發佈時間: ${this.latestRecord.datetimeString}`);
            console.log(`   📝 標題: ${this.latestRecord.title}`);
            console.log(`   🔗 URL: ${this.latestRecord.url}`);
            console.log(`   📊 總文章數: ${articles.length}`);
            console.log(`   🎯 使用真正的API: ${this.apiEndpoint}`);
            
            return true;
            
        } catch (error) {
            console.error('❌ [博客監控] 初始化失敗:', error.message);
            return false;
        }
    }

    // 檢查是否有新文章
    async checkForNewArticles(testMode = false) {
        try {
            console.log(`🔍 [檢查更新] 檢查新文章（真正API模式）... ${testMode ? '(測試模式)' : ''}`);
            this.totalChecks++;
            this.lastCheckTime = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

            const articles = await this.fetchArticlesFromAPI();
            
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
                // ID比較
                if (latestArticle.id && this.latestRecord.articleId && 
                    Number(latestArticle.id) > Number(this.latestRecord.articleId)) {
                    hasUpdate = true;
                    updateReason = `新文章ID: ${latestArticle.id} > ${this.latestRecord.articleId}`;
                }
                
                // 時間比較
                if (!hasUpdate && latestArticle.date && this.latestRecord.datetime && 
                    latestArticle.date > this.latestRecord.datetime) {
                    hasUpdate = true;
                    updateReason = `新發佈時間: ${latestArticle.datetimeString} > ${this.latestRecord.datetimeString}`;
                }
                
                // 標題變化（作為額外檢查）
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
            console.error('❌ [檢查更新] 檢查失敗:', error.message);
            return null;
        }
    }

    // 測試API連接
    async testWebsiteAccess() {
        try {
            console.log('🔍 [測試連接] 測試真正的API連接...');
            
            const articles = await this.fetchArticlesFromAPI();
            
            return {
                success: true,
                method: 'Real API Endpoint',
                endpoint: this.apiEndpoint,
                articlesFound: articles.length,
                sampleArticles: articles.slice(0, 3).map(a => ({
                    id: a.id,
                    time: a.datetimeString,
                    title: a.title.substring(0, 50) + (a.title.length > 50 ? '...' : '')
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
                method: 'Real API Endpoint',
                endpoint: this.apiEndpoint
            };
        }
    }

    // 發送新文章通知
    async sendNewArticleNotification(article) {
        if (!this.notificationCallback) return;

        const notificationMessage = `📝 **Family Club 新文章發布!** (真正API)

📄 **文章ID:** ${article.id || '未知'}
🗓️ **發布時間:** ${article.datetimeString}${article.dateEstimated ? ' (估計)' : ''}
📝 **標題:** ${article.title || '未知標題'}
${article.url ? `🔗 **文章連結:** ${article.url}` : ''}
${article.author ? `✍️ **作者:** ${article.author}` : ''}
🌐 **博客首頁:** https://web.familyclub.jp/s/jwb/diary/F2017?ima=3047
⏰ **檢測時間:** ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
🎯 **檢測方式:** 真正的API端點 (diarkiji_list)

🎉 快去看看新內容吧！`;

        try {
            await this.notificationCallback(notificationMessage, 'blog_alert', 'FamilyClubBlog');
            console.log('📤 [通知] 新文章通知已發送');
        } catch (error) {
            console.error('❌ [通知] 通知發送失敗:', error.message);
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
            console.log('⚠️ [監控] 博客監控已在運行中');
            return;
        }

        this.isMonitoring = true;
        console.log('🚀 [監控] 開始Family Club博客監控 (使用真正API端點)');
        console.log('⏰ [監控] 每小時00分檢查一次');
        
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
    getStatus() {
        return {
            isMonitoring: this.isMonitoring,
            totalChecks: this.totalChecks,
            articlesFound: this.articlesFound,
            lastCheckTime: this.lastCheckTime,
            nextCheckTime: this.isMonitoring ? new Date(Date.now() + this.calculateNextCheckTime() * 1000).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : null,
            method: 'Real API Endpoint',
            endpoint: this.apiEndpoint,
            artistCode: this.artistCode,
            blogUrl: 'https://web.familyclub.jp/s/jwb/diary/F2017?ima=3047',
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
            
            // 按ID或時間排序，返回最新的幾篇
            const sortedArticles = articles.sort((a, b) => {
                if (a.id && b.id && !isNaN(a.id) && !isNaN(b.id)) {
                    return Number(b.id) - Number(a.id);
                }
                return b.date - a.date;
            });
            
            return sortedArticles.slice(0, limit).map(article => ({
                id: article.id,
                title: article.title,
                datetime: article.datetimeString,
                url: article.url,
                dateEstimated: article.dateEstimated || false
            }));
            
        } catch (error) {
            console.error('❌ [獲取文章] 獲取最新文章失敗:', error.message);
            return [];
        }
    }
}

module.exports = FamilyClubBlogMonitor;