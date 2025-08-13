const https = require('https');

class BlogMonitor {
    constructor(notificationCallback = null) {
        this.notificationCallback = notificationCallback;
        this.isMonitoring = false;
        this.monitoringInterval = null;
        this.checkIntervalMinutes = 60; // 每小時檢查一次
        this.totalChecks = 0;
        this.articlesFound = 0;
        this.lastCheckTime = null;
        
        // 博客監控配置
        this.blogUrl = 'https://web.familyclub.jp/s/jwb/diary/F2017?ima=3047';
        
        // 記錄最新文章信息
        this.latestRecord = {
            articleId: null,        // 最大的文章ID
            datetime: null,         // 最近期的發佈時間 (Date對象)
            datetimeString: null,   // 發佈時間字符串
            title: null,            // 文章標題
            url: null,              // 文章URL
            lastUpdated: null       // 記錄更新時間
        };
        
        console.log('🔍 [Blog Monitor] Family Club 博客監控已初始化');
        console.log('🔗 [Blog Monitor] 目標網址:', this.blogUrl);
    }

    // 安全HTTP請求
    makeRequest(url, options = {}) {
        return new Promise((resolve, reject) => {
            const req = https.request(url, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'DNT': '1',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache',
                    ...options.headers
                },
                timeout: 30000
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

    // 初始化 - 首次讀取網頁並建立基準記錄
    async initialize() {
        try {
            console.log('🚀 [Blog Monitor] 正在初始化，讀取網頁建立基準記錄...');
            
            const response = await this.makeRequest(this.blogUrl);
            
            if (response.statusCode !== 200) {
                throw new Error(`HTTP錯誤: ${response.statusCode}`);
            }
            
            const html = response.data;
            console.log(`📊 [Blog Monitor] 成功獲取網頁，HTML長度: ${html.length} 字元`);
            
            // 解析網頁中的所有文章
            const articles = this.parseArticles(html);
            
            if (articles.length === 0) {
                console.warn('⚠️ [Blog Monitor] 未找到任何文章，可能需要調整解析邏輯');
                return false;
            }
            
            // 找出最新文章（最大ID或最近時間）
            const latestArticle = this.findLatestArticle(articles);
            
            // 更新記錄
            this.latestRecord = {
                articleId: latestArticle.id,
                datetime: latestArticle.date,
                datetimeString: latestArticle.datetimeString,
                title: latestArticle.title,
                url: latestArticle.url,
                lastUpdated: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
            };
            
            console.log('✅ [Blog Monitor] 初始化完成，建立基準記錄:');
            console.log(`   📄 文章ID: ${this.latestRecord.articleId}`);
            console.log(`   🗓️  發佈時間: ${this.latestRecord.datetimeString}`);
            console.log(`   📝 標題: ${this.latestRecord.title}`);
            console.log(`   🔗 URL: ${this.latestRecord.url}`);
            
            return true;
            
        } catch (error) {
            console.error('❌ [Blog Monitor] 初始化失敗:', error.message);
            return false;
        }
    }

    // 解析網頁中的文章
    parseArticles(html) {
        const articles = [];
        
        try {
            console.log('🔍 [解析文章] 開始解析網頁中的文章...');
            
            // 尋找文章容器的多種模式 - 針對 Family Club 優化
            const articlePatterns = [
                // 日記條目容器 - 放在前面優先匹配
                /<div[^>]*class="[^"]*diary[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
                /<li[^>]*class="[^"]*diary[^"]*"[^>]*>([\s\S]*?)<\/li>/gi,
                // Entry 相關容器
                /<div[^>]*class="[^"]*entry[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
                /<li[^>]*class="[^"]*entry[^"]*"[^>]*>([\s\S]*?)<\/li>/gi,
                // 通用容器
                /<article[^>]*>([\s\S]*?)<\/article>/gi,
                // 更寬泛的 diary 匹配
                /<[^>]*diary[^>]*>([\s\S]*?)<\/[^>]*>/gi
            ];
            
            for (const pattern of articlePatterns) {
                let match;
                pattern.lastIndex = 0;
                
                while ((match = pattern.exec(html)) !== null) {
                    const articleHTML = match[1];
                    const article = this.parseIndividualArticle(articleHTML, match[0]);
                    
                    if (article && article.id && article.date) {
                        articles.push(article);
                        console.log(`📄 [解析文章] 找到文章: ID=${article.id}, 時間=${article.datetimeString}`);
                    }
                }
                
                if (articles.length > 0) {
                    console.log(`✅ [解析文章] 使用模式成功，找到 ${articles.length} 篇文章`);
                    break; // 找到文章就停止嘗試其他模式
                }
            }
            
            // 如果沒找到文章，嘗試更寬泛的搜索
            if (articles.length === 0) {
                console.log('🔍 [解析文章] 嘗試尋找 time 標籤...');
                articles.push(...this.findTimeBasedArticles(html));
            }
            
            console.log(`📊 [解析文章] 總共找到 ${articles.length} 篇文章`);
            return articles;
            
        } catch (error) {
            console.error('❌ [解析文章] 解析失敗:', error.message);
            return [];
        }
    }

    // 解析單個文章
    parseIndividualArticle(articleHTML, fullHTML) {
        try {
            // 提取文章ID - 多種可能的模式
            const idPatterns = [
                /data-id="(\d+)"/i,
                /id="entry_(\d+)"/i,
                /id="diary_(\d+)"/i,
                /\/diary\/(\d+)/i,
                /entry[_-]?(\d+)/i,
                /article[_-]?(\d+)/i
            ];
            
            let articleId = null;
            for (const pattern of idPatterns) {
                const match = fullHTML.match(pattern);
                if (match) {
                    articleId = parseInt(match[1]);
                    break;
                }
            }
            
            // 提取時間信息
            const timeInfo = this.extractDateTime(articleHTML);
            if (!timeInfo) {
                return null;
            }
            
            // 提取標題
            const title = this.extractTitle(articleHTML);
            
            // 提取URL
            const url = this.extractArticleURL(articleHTML);
            
            return {
                id: articleId,
                date: timeInfo.date,
                datetimeString: timeInfo.datetimeString,
                title: title,
                url: url
            };
            
        } catch (error) {
            console.error('❌ [解析文章] 解析單個文章失敗:', error.message);
            return null;
        }
    }

    // 尋找基於時間的文章（備用方法）
    findTimeBasedArticles(html) {
        const articles = [];
        
        try {
            // 尋找所有 time 標籤
            const timePattern = /<time[^>]*datetime="([^"]+)"[^>]*>([^<]*)<\/time>/gi;
            let match;
            let index = 0;
            
            while ((match = timePattern.exec(html)) !== null) {
                const datetime = match[1];
                const displayText = match[2];
                
                const timeInfo = this.parseDateTime(datetime);
                if (timeInfo) {
                    articles.push({
                        id: index++, // 使用索引作為臨時ID
                        date: timeInfo.date,
                        datetimeString: timeInfo.datetimeString,
                        title: `文章 ${displayText}`,
                        url: null
                    });
                }
            }
            
            return articles;
            
        } catch (error) {
            console.error('❌ [時間搜索] 失敗:', error.message);
            return [];
        }
    }

    // 提取時間信息
    extractDateTime(html) {
        try {
            // 多種時間格式模式 - 針對日文網站優化
            const timePatterns = [
                // 日文日期格式 - 放在前面優先匹配
                /(\d{4})[年](\d{1,2})[月](\d{1,2})[日]/,
                /(\d{4})\.(\d{1,2})\.(\d{1,2})/,
                /(\d{4})\/(\d{1,2})\/(\d{1,2})/,
                /(\d{4})-(\d{1,2})-(\d{1,2})/,
                // 包含時間的格式
                /(\d{4})[年](\d{1,2})[月](\d{1,2})[日]\s*(\d{1,2}):(\d{2})/,
                /(\d{4})\.(\d{1,2})\.(\d{1,2})\s+(\d{1,2}):(\d{2})/,
                // 標準屬性
                /datetime="([^"]+)"/i,
                /data-time="([^"]+)"/i,
                /<time[^>]*>([^<]+)<\/time>/i,
                // ISO格式
                /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/
            ];
            
            for (const pattern of timePatterns) {
                const match = html.match(pattern);
                if (match) {
                    const timeInfo = this.parseDateTime(match[1] || match[0]);
                    if (timeInfo) {
                        return timeInfo;
                    }
                }
            }
            
            return null;
            
        } catch (error) {
            console.error('❌ [時間提取] 失敗:', error.message);
            return null;
        }
    }

    // 解析日期時間
    parseDateTime(dateString) {
        try {
            let date = null;

            // 優先處理日文日期格式
            const jpPatterns = [
                // YYYY年MM月DD日 HH:MM
                /(\d{4})[年](\d{1,2})[月](\d{1,2})[日]\s*(\d{1,2}):(\d{2})/,
                // YYYY.MM.DD HH:MM  
                /(\d{4})\.(\d{1,2})\.(\d{1,2})\s+(\d{1,2}):(\d{2})/,
                // YYYY年MM月DD日
                /(\d{4})[年](\d{1,2})[月](\d{1,2})[日]/,
                // YYYY.MM.DD
                /(\d{4})\.(\d{1,2})\.(\d{1,2})/,
                // YYYY/MM/DD
                /(\d{4})\/(\d{1,2})\/(\d{1,2})/,
                // YYYY-MM-DD
                /(\d{4})-(\d{1,2})-(\d{1,2})/
            ];
            
            for (const pattern of jpPatterns) {
                const match = dateString.match(pattern);
                if (match) {
                    const year = parseInt(match[1]);
                    const month = parseInt(match[2]) - 1; // 月份從0開始
                    const day = parseInt(match[3]);
                    const hour = match[4] ? parseInt(match[4]) : 0;
                    const minute = match[5] ? parseInt(match[5]) : 0;
                    
                    date = new Date(year, month, day, hour, minute);
                    console.log(`🗓️ [日期解析] 日文格式解析成功: ${dateString} -> ${date}`);
                    break;
                }
            }
            
            // 嘗試直接解析ISO格式
            if (dateString.includes('T') || dateString.includes('-')) {
                date = new Date(dateString);
            }
            
            // 如果直接解析失敗，嘗試其他格式
            if (!date || isNaN(date.getTime())) {
                // 解析 YYYY年MM月DD日 格式
                const jpMatch = dateString.match(/(\d{4})[年](\d{1,2})[月](\d{1,2})[日]/);
                if (jpMatch) {
                    const year = parseInt(jpMatch[1]);
                    const month = parseInt(jpMatch[2]) - 1; // 月份從0開始
                    const day = parseInt(jpMatch[3]);
                    date = new Date(year, month, day);
                }
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

    // 提取文章標題
    extractTitle(html) {
        try {
            const titlePatterns = [
                /<h[1-6][^>]*>([^<]+)<\/h[1-6]>/i,
                /<div[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/div>/i,
                /<span[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/span>/i,
                /<a[^>]*>([^<]+)<\/a>/i
            ];
            
            for (const pattern of titlePatterns) {
                const match = html.match(pattern);
                if (match && match[1].trim().length > 0) {
                    return match[1].trim();
                }
            }
            
            return '未知標題';
            
        } catch (error) {
            return '標題提取失敗';
        }
    }

    // 提取文章URL
    extractArticleURL(html) {
        try {
            const urlPatterns = [
                /href="([^"]*diary[^"]*[^"]+)"/i,
                /href="([^"]*\/\d+[^"]*)"/i
            ];
            
            for (const pattern of urlPatterns) {
                const match = html.match(pattern);
                if (match) {
                    let url = match[1];
                    // 確保URL是完整的
                    if (url.startsWith('/')) {
                        url = 'https://web.familyclub.jp' + url;
                    }
                    return url;
                }
            }
            
            return null;
            
        } catch (error) {
            return null;
        }
    }

    // 找出最新文章
    findLatestArticle(articles) {
        if (articles.length === 0) {
            return null;
        }
        
        // 優先按ID排序（如果有ID的話）
        const articlesWithId = articles.filter(a => a.id !== null && !isNaN(a.id));
        if (articlesWithId.length > 0) {
            console.log('📊 [最新文章] 按ID排序查找最新文章');
            return articlesWithId.sort((a, b) => b.id - a.id)[0];
        }
        
        // 否則按時間排序
        console.log('📊 [最新文章] 按時間排序查找最新文章');
        return articles.sort((a, b) => b.date - a.date)[0];
    }

    // 檢查是否有新文章
    async checkForNewArticles(testMode = false) {
        try {
            console.log(`🔍 [檢查更新] 檢查新文章... ${testMode ? '(測試模式)' : ''}`);
            this.totalChecks++;
            this.lastCheckTime = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

            const response = await this.makeRequest(this.blogUrl);
            
            if (response.statusCode !== 200) {
                throw new Error(`HTTP錯誤: ${response.statusCode}`);
            }
            
            const html = response.data;
            const articles = this.parseArticles(html);
            
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
                // 第一次運行，初始化記錄
                hasUpdate = true;
                updateReason = '初始化記錄';
            } else {
                // 檢查ID是否更大
                if (latestArticle.id && this.latestRecord.articleId && latestArticle.id > this.latestRecord.articleId) {
                    hasUpdate = true;
                    updateReason = `新文章ID: ${latestArticle.id} > ${this.latestRecord.articleId}`;
                }
                
                // 檢查時間是否更新
                if (!hasUpdate && latestArticle.date && this.latestRecord.datetime && latestArticle.date > this.latestRecord.datetime) {
                    hasUpdate = true;
                    updateReason = `新發佈時間: ${latestArticle.datetimeString} > ${this.latestRecord.datetimeString}`;
                }
            }
            
            if (hasUpdate) {
                console.log(`📝 [檢查更新] 發現新文章! 原因: ${updateReason}`);
                
                // 更新記錄
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

    // 發送新文章通知
    async sendNewArticleNotification(article) {
        if (!this.notificationCallback) return;

        const notificationMessage = `📝 **Family Club 新文章發布!**

📄 **文章ID:** ${article.id || '未知'}
🗓️ **發布時間:** ${article.datetimeString}
📝 **標題:** ${article.title || '未知標題'}
${article.url ? `🔗 **文章連結:** ${article.url}` : ''}
🌐 **博客首頁:** ${this.blogUrl}
⏰ **檢測時間:** ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}

🎉 快去看看新內容吧！`;

        try {
            await this.notificationCallback(notificationMessage, 'blog_alert', 'Blog');
            console.log('📤 [通知] 新文章通知已發送');
        } catch (error) {
            console.error('❌ [通知] 通知發送失敗:', error.message);
        }
    }

    // 測試網站連接
    async testWebsiteAccess() {
        try {
            console.log('🔍 [測試連接] 測試博客網站連接...');
            
            const response = await this.makeRequest(this.blogUrl);
            
            console.log(`📊 [測試連接] HTTP狀態: ${response.statusCode}`);
            console.log(`📊 [測試連接] Content-Type: ${response.headers['content-type'] || '未知'}`);
            console.log(`📊 [測試連接] 內容長度: ${response.data.length} 字元`);
            
            if (response.statusCode !== 200) {
                return {
                    success: false,
                    error: `HTTP錯誤: ${response.statusCode}`,
                    details: response.headers
                };
            }

            const html = response.data;
            const hasContent = html.length > 1000;
            const hasTimeTag = html.includes('<time');
            const articles = this.parseArticles(html);
            
            return {
                success: true,
                statusCode: response.statusCode,
                contentLength: response.data.length,
                hasContent,
                hasTimeTag,
                articlesFound: articles.length,
                sampleArticles: articles.slice(0, 3).map(a => ({
                    id: a.id,
                    time: a.datetimeString,
                    title: a.title
                }))
            };

        } catch (error) {
            console.error('❌ [測試連接] 測試失敗:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // 計算下次檢查時間（每小時的00分）
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
            console.log('⚠️ [監控] 監控已在運行中');
            return;
        }

        this.isMonitoring = true;
        console.log('🚀 [監控] 開始Family Club博客監控 (每小時00分檢查)');
        
        const monitorLoop = async () => {
            if (!this.isMonitoring) {
                console.log('⏹️ [監控] 監控已停止');
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
            blogUrl: this.blogUrl,
            latestRecord: {
                ...this.latestRecord,
                hasRecord: !!(this.latestRecord.articleId || this.latestRecord.datetime)
            }
        };
    }

    // 獲取當前最新記錄 (for !blog-latest 命令)
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
}

module.exports = BlogMonitor;