const https = require('https');

class BlogMonitor {
    constructor(notificationCallback = null) {
        this.notificationCallback = notificationCallback;
        this.lastArticleDate = null;
        this.isMonitoring = false;
        this.monitoringInterval = null;
        this.checkIntervalMinutes = 60; // 每小時檢查一次
        this.totalChecks = 0;
        this.articlesFound = 0;
        this.lastCheckTime = null;
        this.lastFoundArticles = []; // 存儲最近找到的文章
        
        // Twitter監控配置 - 使用更多可靠的Nitter實例
        this.nitterInstances = [
            'https://nitter.poast.org/FCweb_info',
            'https://nitter.net/FCweb_info', 
            'https://nitter.it/FCweb_info',
            'https://nitter.privacydev.net/FCweb_info',
            'https://nitter.1d4.us/FCweb_info',
            'https://nitter.kavin.rocks/FCweb_info'
        ];
        this.targetAccount = 'FCweb_info'; // Twitter帳號
        this.currentInstanceIndex = 0; // 當前使用的實例索引
        
        // 從環境變數讀取關鍵字
        this.keywords = this.loadKeywords();
        console.log('🔍 [Twitter Monitor] 監控關鍵字:', this.keywords);
        console.log('🔗 [Twitter Monitor] 可用Nitter實例:', this.nitterInstances.length, '個');
    }

    // 從環境變數載入關鍵字
    loadKeywords() {
        const keywords = [];
        
        // 從環境變數讀取關鍵字 (支持多種格式)
        const keywordEnv = process.env.BLOG_KEYWORDS || process.env.TWITTER_KEYWORDS || '';
        
        if (keywordEnv) {
            // 支持逗號分隔或分號分隔
            const parsed = keywordEnv.split(/[,;]/).map(k => k.trim()).filter(k => k.length > 0);
            keywords.push(...parsed);
        }
        
        // 支持編號的環境變數 (BLOG_KEYWORD_1, BLOG_KEYWORD_2 等)
        for (let i = 1; i <= 10; i++) {
            const keyword = process.env[`BLOG_KEYWORD_${i}`] || process.env[`TWITTER_KEYWORD_${i}`];
            if (keyword && keyword.trim()) {
                keywords.push(keyword.trim());
            }
        }
        
        // 如果沒有設定關鍵字，使用預設值
        if (keywords.length === 0) {
            console.warn('⚠️ [Twitter Monitor] 未設定監控關鍵字，使用預設關鍵字');
            keywords.push('髙木雄也');
        }
        
        return keywords;
    }

    // 安全HTTP請求 - 增加更多選項
    makeRequest(url, options = {}) {
        return new Promise((resolve, reject) => {
            const req = https.request(url, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9,ja;q=0.8',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'DNT': '1',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'none',
                    'Cache-Control': 'max-age=0',
                    ...options.headers
                },
                timeout: 15000 // 減少超時時間
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
                        url: url
                    });
                });
                stream.on('error', reject);
            });
            
            req.on('error', (err) => {
                console.error(`❌ [Request Error] ${url}:`, err.message);
                reject(err);
            });
            req.on('timeout', () => {
                req.destroy();
                reject(new Error(`Request timeout for ${url}`));
            });
            
            req.end();
        });
    }

    // Twitter監控方法（使用多個Nitter實例）
    async checkTwitterForUpdates() {
        let lastError = null;
        
        // 嘗試所有可用的Nitter實例
        for (let i = 0; i < this.nitterInstances.length; i++) {
            const instanceIndex = (this.currentInstanceIndex + i) % this.nitterInstances.length;
            const url = this.nitterInstances[instanceIndex];
            
            try {
                console.log(`🐦 [Twitter監控] 嘗試實例 ${instanceIndex + 1}/${this.nitterInstances.length}: ${url}...`);
                
                const response = await this.makeRequest(url);
                
                if (response.statusCode === 200) {
                    console.log(`✅ [Twitter監控] 實例 ${instanceIndex + 1} 連接成功`);
                    console.log(`📊 [Twitter監控] HTML長度: ${response.data.length} 字元`);
                    
                    // 更新當前使用的實例
                    this.currentInstanceIndex = instanceIndex;
                    
                    // 解析推文
                    const tweets = this.parseNitterTweets(response.data, url);
                    
                    if (tweets.length > 0) {
                        console.log(`🎯 [Twitter監控] 從實例 ${instanceIndex + 1} 找到 ${tweets.length} 個相關推文`);
                        return tweets;
                    } else {
                        console.log(`📋 [Twitter監控] 實例 ${instanceIndex + 1} 未找到包含關鍵字的推文`);
                        // 如果沒有找到推文但連接成功，仍然返回空數組（而不是繼續嘗試其他實例）
                        return [];
                    }
                } else if (response.statusCode === 403) {
                    console.warn(`⚠️ [Twitter監控] 實例 ${instanceIndex + 1} 返回403禁止訪問，嘗試下一個實例`);
                    lastError = new Error(`HTTP 403 from ${url}`);
                } else if (response.statusCode === 429) {
                    console.warn(`⚠️ [Twitter監控] 實例 ${instanceIndex + 1} 返回429限制請求，嘗試下一個實例`);
                    lastError = new Error(`HTTP 429 from ${url}`);
                } else {
                    console.warn(`⚠️ [Twitter監控] 實例 ${instanceIndex + 1} HTTP錯誤: ${response.statusCode}`);
                    lastError = new Error(`HTTP ${response.statusCode} from ${url}`);
                }
                
            } catch (error) {
                console.warn(`⚠️ [Twitter監控] 實例 ${instanceIndex + 1} 連接失敗: ${error.message}`);
                lastError = error;
            }
        }
        
        // 所有實例都失敗了
        console.error(`❌ [Twitter監控] 所有 ${this.nitterInstances.length} 個Nitter實例都無法使用`);
        if (lastError) {
            console.error('❌ [Twitter監控] 最後錯誤:', lastError.message);
        }
        
        return [];
    }
    
    // 解析Nitter頁面中的推文 - 改進版
    parseNitterTweets(html, sourceUrl) {
        const tweets = [];
        
        try {
            console.log(`🔍 [解析推文] 開始解析來自 ${sourceUrl} 的HTML...`);
            
            // 檢查HTML內容是否有效
            if (html.length < 1000) {
                console.warn('⚠️ [解析推文] HTML內容過短，可能是錯誤頁面');
                return [];
            }
            
            // 更精確的推文容器模式
            const tweetPatterns = [
                // Nitter標準推文格式
                /<div class="timeline-item[^>]*>([\s\S]*?)<\/div>(?=\s*<div class="timeline-item|$)/gi,
                // 推文內容容器
                /<div class="tweet-content[^>]*>([\s\S]*?)<\/div>/gi,
                // 推文主體
                /<article[^>]*class="[^"]*tweet[^"]*"[^>]*>([\s\S]*?)<\/article>/gi,
                // 通用推文容器
                /<div[^>]*data-tweet[^>]*>([\s\S]*?)<\/div>/gi
            ];
            
            let totalMatches = 0;
            
            for (const pattern of tweetPatterns) {
                let match;
                pattern.lastIndex = 0;
                let patternMatches = 0;
                
                while ((match = pattern.exec(html)) !== null && tweets.length < 20) {
                    patternMatches++;
                    totalMatches++;
                    const tweetContent = match[1];
                    
                    // 檢查是否包含任何關鍵字
                    let foundKeyword = null;
                    for (const keyword of this.keywords) {
                        // 使用不區分大小寫的搜索
                        if (tweetContent.toLowerCase().includes(keyword.toLowerCase())) {
                            foundKeyword = keyword;
                            break;
                        }
                    }
                    
                    if (foundKeyword) {
                        console.log(`🎯 [解析推文] 找到關鍵字 "${foundKeyword}" 的推文`);
                        
                        // 提取時間和文本
                        const timeInfo = this.extractTweetTime(tweetContent);
                        const textContent = this.extractTweetText(tweetContent);
                        
                        if (timeInfo && textContent) {
                            tweets.push({
                                date: timeInfo.date,
                                dateString: timeInfo.dateString,
                                fullDateTime: timeInfo.fullDateTime,
                                keyword: foundKeyword,
                                content: textContent,
                                source: 'twitter',
                                sourceUrl: sourceUrl
                            });
                            
                            console.log(`📅 [解析推文] 推文詳情: ${timeInfo.fullDateTime}, 關鍵字: ${foundKeyword}`);
                            console.log(`📝 [解析推文] 內容預覽: ${textContent.substring(0, 100)}...`);
                        }
                    }
                }
                
                console.log(`📊 [解析推文] 模式匹配: ${patternMatches} 個推文容器`);
                
                if (tweets.length > 0) break; // 找到推文就停止
            }
            
            console.log(`📋 [解析推文] 總共檢查了 ${totalMatches} 個容器，找到 ${tweets.length} 個相關推文`);
            
            // 按時間排序（最新的在前）
            return tweets.sort((a, b) => b.date - a.date);
            
        } catch (error) {
            console.error('❌ [解析推文] 解析失敗:', error.message);
            return [];
        }
    }
    
    // 提取推文時間 - 改進版
    extractTweetTime(tweetContent) {
        try {
            const timePatterns = [
                // Nitter時間格式
                /datetime="([^"]+)"/i,
                /data-time="([^"]+)"/i,
                /title="([^"]*\d{4}[^"]*)"]/i,
                // 相對時間
                /(\d+)([smhd])\s*ago/i,
                /(\d+)\s*(second|minute|hour|day)s?\s*ago/i,
                // 絕對時間
                /(\w{3})\s+(\d{1,2}),?\s+(\d{4})/i,
                /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(\d{4})/i,
                // 數字日期格式
                /(\d{1,2})\/(\d{1,2})\/(\d{4})/,
                /(\d{4})-(\d{2})-(\d{2})/,
                // 時間標籤內容
                /<time[^>]*>([^<]+)<\/time>/i
            ];
            
            for (const pattern of timePatterns) {
                const match = tweetContent.match(pattern);
                if (match) {
                    let tweetDate = null;
                    
                    try {
                        if (pattern.source.includes('([smhd])') || pattern.source.includes('(second|minute|hour|day)')) {
                            // 相對時間處理
                            const value = parseInt(match[1]);
                            let unit = match[2];
                            
                            // 標準化單位
                            if (unit.startsWith('s')) unit = 's';
                            else if (unit.startsWith('m')) unit = 'm';
                            else if (unit.startsWith('h')) unit = 'h';
                            else if (unit.startsWith('d')) unit = 'd';
                            
                            tweetDate = new Date();
                            switch (unit) {
                                case 's': tweetDate.setSeconds(tweetDate.getSeconds() - value); break;
                                case 'm': tweetDate.setMinutes(tweetDate.getMinutes() - value); break;
                                case 'h': tweetDate.setHours(tweetDate.getHours() - value); break;
                                case 'd': tweetDate.setDate(tweetDate.getDate() - value); break;
                            }
                        } else if (pattern.source.includes('(\\w{3})') || pattern.source.includes('(Jan|Feb')) {
                            // 月份格式處理
                            const months = {
                                'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
                                'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
                            };
                            const monthStr = match[1];
                            const month = months[monthStr] !== undefined ? months[monthStr] : parseInt(monthStr) - 1;
                            const day = parseInt(match[2]);
                            const year = parseInt(match[3]);
                            tweetDate = new Date(year, month, day);
                        } else {
                            // 嘗試直接解析
                            const dateStr = match[1] || match[0];
                            tweetDate = new Date(dateStr);
                        }
                        
                        if (tweetDate && !isNaN(tweetDate.getTime())) {
                            return {
                                date: tweetDate,
                                dateString: `${tweetDate.getFullYear()}年${tweetDate.getMonth() + 1}月${tweetDate.getDate()}日`,
                                fullDateTime: `${tweetDate.getFullYear()}年${tweetDate.getMonth() + 1}月${tweetDate.getDate()}日 ${tweetDate.getHours().toString().padStart(2, '0')}:${tweetDate.getMinutes().toString().padStart(2, '0')}`
                            };
                        }
                    } catch (parseError) {
                        console.warn(`⚠️ [時間解析] 解析錯誤: ${parseError.message}`);
                    }
                }
            }
            
            // 如果無法解析時間，使用當前時間
            const now = new Date();
            console.warn('⚠️ [時間解析] 無法解析推文時間，使用當前時間');
            return {
                date: now,
                dateString: `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`,
                fullDateTime: `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
            };
            
        } catch (error) {
            console.error('❌ [時間解析] 嚴重錯誤:', error.message);
            return null;
        }
    }
    
    // 提取推文文字內容 - 改進版
    extractTweetText(tweetContent) {
        try {
            // 移除不需要的標籤和內容
            let textContent = tweetContent
                .replace(/<script[\s\S]*?<\/script>/gi, '')
                .replace(/<style[\s\S]*?<\/style>/gi, '')
                .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
                .replace(/<!--[\s\S]*?-->/g, '')
                .replace(/<svg[\s\S]*?<\/svg>/gi, '')
                .replace(/<img[^>]*>/gi, ' [圖片] ')
                .replace(/<a[^>]*href="[^"]*"[^>]*>([^<]*)<\/a>/gi, '$1')
                .replace(/<[^>]+>/g, ' ')
                .replace(/&nbsp;/g, ' ')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&amp;/g, '&')
                .replace(/&quot;/g, '"')
                .replace(/&#x27;/g, "'")
                .replace(/&#x2F;/g, '/')
                .replace(/\s+/g, ' ')
                .trim();
            
            // 過濾掉太短的內容
            if (textContent.length < 10) {
                console.warn('⚠️ [文字提取] 提取的內容過短');
                return null;
            }
            
            // 限制長度
            const maxLength = 500;
            if (textContent.length > maxLength) {
                textContent = textContent.substring(0, maxLength) + '...';
            }
            
            return textContent;
            
        } catch (error) {
            console.error('❌ [文字提取] 失敗:', error.message);
            return '無法提取推文內容';
        }
    }

    // 搜索包含關鍵字的最新推文
    async searchLatestTweetWithKeywords() {
        try {
            console.log('🔍 [搜索最新推文] 開始搜索包含關鍵字的最新推文...');
            console.log(`🔍 [搜索最新推文] 目標關鍵字: ${this.keywords.join(', ')}`);
            
            const tweets = await this.checkTwitterForUpdates();
            
            if (tweets.length === 0) {
                console.log('📋 [搜索最新推文] 未找到包含關鍵字的推文');
                return null;
            }
            
            // 返回最新的推文（已按時間排序）
            const latestTweet = tweets[0];
            
            console.log(`✅ [搜索最新推文] 找到最新推文:`);
            console.log(`   - 時間: ${latestTweet.fullDateTime}`);
            console.log(`   - 關鍵字: ${latestTweet.keyword}`);
            console.log(`   - 內容: ${latestTweet.content.substring(0, 100)}...`);
            
            return latestTweet;
            
        } catch (error) {
            console.error('❌ [搜索最新推文] 搜索失敗:', error.message);
            return null;
        }
    }

    // 測試網站連接 - 改進版
    async testWebsiteAccess() {
        try {
            console.log('🔍 [Twitter測試] 測試所有Nitter實例連接...');
            
            const results = [];
            
            for (let i = 0; i < Math.min(3, this.nitterInstances.length); i++) {
                const url = this.nitterInstances[i];
                try {
                    console.log(`📊 [Twitter測試] 測試實例 ${i + 1}: ${url}`);
                    
                    const response = await this.makeRequest(url);
                    
                    const result = {
                        instance: i + 1,
                        url: url,
                        statusCode: response.statusCode,
                        contentLength: response.data.length,
                        success: response.statusCode === 200,
                        hasValidContent: response.data.includes('timeline') || response.data.includes('tweet'),
                        hasKeywords: this.keywords.some(keyword => 
                            response.data.toLowerCase().includes(keyword.toLowerCase())
                        )
                    };
                    
                    results.push(result);
                    
                    console.log(`${result.success ? '✅' : '❌'} [Twitter測試] 實例 ${i + 1}: HTTP ${result.statusCode}, ${result.contentLength} 字元`);
                    
                    if (result.success) break; // 找到一個可用的就停止
                    
                } catch (error) {
                    results.push({
                        instance: i + 1,
                        url: url,
                        success: false,
                        error: error.message
                    });
                    console.log(`❌ [Twitter測試] 實例 ${i + 1} 失敗: ${error.message}`);
                }
            }
            
            const successfulResults = results.filter(r => r.success);
            
            return {
                success: successfulResults.length > 0,
                totalTested: results.length,
                successfulInstances: successfulResults.length,
                results: results,
                keywords: this.keywords,
                bestInstance: successfulResults[0] || null
            };

        } catch (error) {
            console.error('❌ [Twitter測試] 測試失敗:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // 分析當前內容 - 改進版
    async analyzeCurrentContent(showDetails = false) {
        try {
            console.log('🔍 [Twitter分析] 開始分析當前推文內容...');
            
            const tweets = await this.checkTwitterForUpdates();
            
            if (tweets.length === 0) {
                return {
                    success: true,
                    totalTweets: 0,
                    recentTweets: 0,
                    latestTweet: null,
                    keywords: this.keywords,
                    analysisTime: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
                    message: '未找到包含關鍵字的推文',
                    currentInstance: this.nitterInstances[this.currentInstanceIndex]
                };
            }

            const now = new Date();
            const recentTweets = tweets.filter(tweet => {
                const diffDays = (now - tweet.date) / (1000 * 60 * 60 * 24);
                return diffDays <= 7; // 最近7天
            });

            console.log(`📊 [Twitter分析] 總共找到 ${tweets.length} 個相關推文`);
            console.log(`📊 [Twitter分析] 最近7天內的推文: ${recentTweets.length} 個`);

            if (showDetails && recentTweets.length > 0) {
                console.log('📋 [Twitter分析] 最近推文列表:');
                recentTweets.slice(0, 5).forEach((tweet, index) => {
                    console.log(`   ${index + 1}. ${tweet.fullDateTime} - 關鍵字: ${tweet.keyword}`);
                    console.log(`      內容: ${tweet.content.substring(0, 100)}...`);
                });
            }

            return {
                success: true,
                totalTweets: tweets.length,
                recentTweets: recentTweets.length,
                latestTweet: tweets[0],
                allRecentTweets: recentTweets,
                keywords: this.keywords,
                analysisTime: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
                currentInstance: this.nitterInstances[this.currentInstanceIndex]
            };

        } catch (error) {
            console.error('❌ [Twitter分析] 分析失敗:', error.message);
            return {
                success: false,
                error: error.message,
                currentInstance: this.nitterInstances[this.currentInstanceIndex]
            };
        }
    }

    // 主要檢查方法 - 改進版
    async checkForNewArticles(testMode = false) {
        try {
            console.log(`🔍 [Twitter] 檢查新推文... ${testMode ? '(測試模式)' : ''}`);
            this.totalChecks++;
            this.lastCheckTime = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

            const tweets = await this.checkTwitterForUpdates();
            
            if (tweets.length === 0) {
                console.log('📋 [Twitter] 無相關推文');
                return null;
            }

            const latestTweet = tweets[0];

            if (testMode) {
                console.log(`📝 [Twitter測試] 找到最新推文: ${latestTweet.fullDateTime} (關鍵字: ${latestTweet.keyword})`);
                console.log(`📝 [Twitter測試] 推文內容: ${latestTweet.content.substring(0, 150)}...`);
                this.lastFoundArticles = tweets.slice(0, 5);
                return latestTweet;
            }

            if (!this.lastArticleDate || latestTweet.date > this.lastArticleDate) {
                this.lastArticleDate = latestTweet.date;
                this.articlesFound++;
                console.log(`📝 [Twitter] 發現新推文: ${latestTweet.fullDateTime} (關鍵字: ${latestTweet.keyword})`);
                return latestTweet;
            }

            console.log('📋 [Twitter] 無新推文');
            return null;

        } catch (error) {
            console.error('❌ [Twitter] 檢查失敗:', error.message);
            return null;
        }
    }

    // 發送新文章通知
    async sendNewArticleNotification(article) {
        if (!this.notificationCallback) return;

        const notificationMessage = `🐦 **新推文發現!** 

🔍 **關鍵字:** ${article.keyword}
🗓️ **發布時間:** ${article.fullDateTime}
📝 **內容:** ${article.content.substring(0, 300)}${article.content.length > 300 ? '...' : ''}
🔗 **Twitter連結:** https://x.com/${this.targetAccount}
⏰ **檢測時間:** ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}

🎉 快去查看新推文吧！`;

        try {
            await this.notificationCallback(notificationMessage, 'blog_alert', 'Twitter');
            console.log('📤 [Twitter] 新推文通知已發送');
        } catch (error) {
            console.error('❌ [Twitter] 通知發送失敗:', error.message);
        }
    }

    // 計算下次檢查時間（每小時的00分）
    calculateNextCheckTime() {
        const now = new Date();
        const nextCheck = new Date(now);
        
        // 設定為下一個整點
        nextCheck.setHours(now.getHours() + 1);
        nextCheck.setMinutes(0);
        nextCheck.setSeconds(0);
        nextCheck.setMilliseconds(0);

        const waitTime = nextCheck.getTime() - now.getTime();
        return Math.floor(waitTime / 1000); // 返回秒數
    }

    // 開始監控
    startMonitoring() {
        if (this.isMonitoring) {
            console.log('⚠️ [Twitter] 監控已在運行中');
            return;
        }

        this.isMonitoring = true;
        console.log('🚀 [Twitter] 開始Twitter監控 (每小時00分檢查)');
        console.log('🔍 [Twitter] 監控關鍵字:', this.keywords);
        console.log('🔗 [Twitter] 可用Nitter實例:', this.nitterInstances.length, '個');
        
        const monitorLoop = async () => {
            if (!this.isMonitoring) {
                console.log('⏹️ [Twitter] 監控已停止');
                return;
            }

            try {
                const newTweet = await this.checkForNewArticles();
                if (newTweet) {
                    await this.sendNewArticleNotification(newTweet);
                }

                // 計算下次檢查時間
                const nextCheckSeconds = this.calculateNextCheckTime();
                const nextCheckTime = new Date(Date.now() + nextCheckSeconds * 1000)
                    .toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
                
                console.log(`⏰ [Twitter] 下次檢查: ${nextCheckTime} (${Math.round(nextCheckSeconds/60)}分鐘後)`);
                console.log(`🔗 [Twitter] 當前使用實例: ${this.nitterInstances[this.currentInstanceIndex]}`);

                // 設定下次檢查
                this.monitoringInterval = setTimeout(monitorLoop, nextCheckSeconds * 1000);

            } catch (error) {
                console.error('❌ [Twitter] 監控循環錯誤:', error.message);
                
                // 發生錯誤時，10分鐘後重試
                if (this.isMonitoring) {
                    console.log('⚠️ [Twitter] 10分鐘後重試');
                    this.monitoringInterval = setTimeout(monitorLoop, 10 * 60 * 1000);
                }
            }
        };

        // 首次檢查 - 立即執行
        console.log('⏳ [Twitter] 5秒後開始首次檢查');
        this.monitoringInterval = setTimeout(monitorLoop, 5000);
    }

    // 停止監控
    stopMonitoring() {
        this.isMonitoring = false;
        
        if (this.monitoringInterval) {
            clearTimeout(this.monitoringInterval);
            this.monitoringInterval = null;
        }
        
        console.log('⏹️ [Twitter] Twitter監控已停止');
    }

    // 獲取狀態 - 增強版
    getStatus() {
        return {
            isMonitoring: this.isMonitoring,
            totalChecks: this.totalChecks,
            articlesFound: this.articlesFound,
            lastCheckTime: this.lastCheckTime,
            lastArticleDate: this.lastArticleDate ? this.lastArticleDate.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : null,
            nextCheckTime: this.isMonitoring ? new Date(Date.now() + this.calculateNextCheckTime() * 1000).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : null,
            twitterUrl: this.nitterInstances[this.currentInstanceIndex],
            targetAccount: this.targetAccount,
            keywords: this.keywords,
            totalInstances: this.nitterInstances.length,
            currentInstance: this.currentInstanceIndex + 1,
            lastFoundArticles: this.lastFoundArticles.map(tweet => ({
                date: tweet.fullDateTime,
                keyword: tweet.keyword,
                content: tweet.content.substring(0, 100)
            }))
        };
    }

    // 重新載入關鍵字
    reloadKeywords() {
        this.keywords = this.loadKeywords();
        console.log('🔄 [Twitter] 關鍵字已重新載入:', this.keywords);
        return this.keywords;
    }

    // 獲取監控統計
    getMonitoringStats() {
        return {
            isActive: this.isMonitoring,
            totalChecks: this.totalChecks,
            successfulFinds: this.articlesFound,
            keywords: this.keywords,
            lastCheck: this.lastCheckTime,
            lastFind: this.lastArticleDate ? this.lastArticleDate.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : null,
            instanceStats: {
                total: this.nitterInstances.length,
                current: this.currentInstanceIndex + 1,
                currentUrl: this.nitterInstances[this.currentInstanceIndex]
            }
        };
    }

    // 切換到下一個Nitter實例
    switchToNextInstance() {
        this.currentInstanceIndex = (this.currentInstanceIndex + 1) % this.nitterInstances.length;
        console.log(`🔄 [Twitter] 切換到實例 ${this.currentInstanceIndex + 1}: ${this.nitterInstances[this.currentInstanceIndex]}`);
        return this.nitterInstances[this.currentInstanceIndex];
    }

    // 獲取所有可用實例的狀態
    async getAllInstancesStatus() {
        const results = [];
        
        for (let i = 0; i < this.nitterInstances.length; i++) {
            const url = this.nitterInstances[i];
            try {
                const startTime = Date.now();
                const response = await this.makeRequest(url);
                const responseTime = Date.now() - startTime;
                
                results.push({
                    index: i + 1,
                    url: url,
                    status: response.statusCode === 200 ? 'online' : 'error',
                    statusCode: response.statusCode,
                    responseTime: responseTime,
                    contentLength: response.data.length,
                    hasContent: response.data.length > 1000
                });
                
            } catch (error) {
                results.push({
                    index: i + 1,
                    url: url,
                    status: 'offline',
                    error: error.message,
                    responseTime: null
                });
            }
        }
        
        return results;
    }
}

module.exports = BlogMonitor;