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
        
        // Twitter監控配置
        this.twitterUrl = 'https://nitter.poast.org/FCweb_info'; // 主要Nitter實例
        this.twitterUrlBackup = 'https://nitter.net/FCweb_info'; // 備用Nitter實例
        this.targetAccount = 'FCweb_info'; // Twitter帳號
        
        // 從環境變數讀取關鍵字
        this.keywords = this.loadKeywords();
        console.log('🔍 [Blog Monitor] 監控關鍵字:', this.keywords);
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
            console.warn('⚠️ [Blog Monitor] 未設定監控關鍵字，使用預設關鍵字');
            keywords.push('F2017', '髙木雄也', '橋本将生', '猪俣周杜', '篠塚大輝');
        }
        
        return keywords;
    }

    // 安全HTTP請求
    makeRequest(url, options = {}) {
        return new Promise((resolve, reject) => {
            const req = https.request(url, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'DNT': '1',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1',
                    ...options.headers
                },
                timeout: 30000
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    resolve({ 
                        statusCode: res.statusCode, 
                        data: data,
                        headers: res.headers
                    });
                });
            });
            
            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });
            
            req.end();
        });
    }

    // Twitter監控方法（使用Nitter）
    async checkTwitterForUpdates() {
        const urls = [this.twitterUrl, this.twitterUrlBackup];
        
        for (const url of urls) {
            try {
                console.log(`🐦 [Twitter監控] 檢查 ${url}...`);
                
                const response = await this.makeRequest(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8'
                    }
                });
                
                if (response.statusCode !== 200) {
                    console.error(`❌ [Twitter監控] HTTP錯誤: ${response.statusCode} for ${url}`);
                    continue;
                }
                
                const html = response.data;
                console.log(`📊 [Twitter監控] HTML長度: ${html.length} 字元`);
                
                // 解析推文
                const tweets = this.parseNitterTweets(html);
                
                if (tweets.length > 0) {
                    console.log(`✅ [Twitter監控] 從 ${url} 找到 ${tweets.length} 個相關推文`);
                    return tweets;
                }
                
            } catch (error) {
                console.error(`❌ [Twitter監控] ${url} 檢查失敗:`, error.message);
            }
        }
        
        return [];
    }
    
    // 解析Nitter頁面中的推文
    parseNitterTweets(html) {
        const tweets = [];
        
        try {
            // 多種推文容器模式
            const tweetPatterns = [
                // 標準推文容器
                /<div class="timeline-item[^>]*>([\s\S]*?)<\/div>\s*<div class="timeline-item/gi,
                /<article[^>]*class="[^"]*tweet[^"]*"[^>]*>([\s\S]*?)<\/article>/gi,
                /<div[^>]*class="[^"]*tweet-content[^"]*"[^>]*>([\s\S]*?)<\/div>/gi
            ];
            
            for (const pattern of tweetPatterns) {
                let match;
                pattern.lastIndex = 0;
                
                while ((match = pattern.exec(html)) !== null && tweets.length < 20) {
                    const tweetContent = match[1];
                    
                    // 檢查是否包含任何關鍵字
                    let foundKeyword = null;
                    for (const keyword of this.keywords) {
                        if (tweetContent.includes(keyword)) {
                            foundKeyword = keyword;
                            break;
                        }
                    }
                    
                    if (foundKeyword) {
                        console.log(`🎯 [Twitter監控] 找到關鍵字 "${foundKeyword}" 的推文`);
                        
                        // 嘗試提取時間信息
                        const timeInfo = this.extractTweetTime(tweetContent);
                        
                        if (timeInfo) {
                            tweets.push({
                                date: timeInfo.date,
                                dateString: timeInfo.dateString,
                                fullDateTime: timeInfo.fullDateTime,
                                keyword: foundKeyword,
                                content: this.extractTweetText(tweetContent),
                                source: 'twitter'
                            });
                            
                            console.log(`📅 [Twitter監控] 推文時間: ${timeInfo.fullDateTime}, 關鍵字: ${foundKeyword}`);
                        }
                    }
                }
                
                if (tweets.length > 0) break; // 如果找到推文就停止嘗試其他模式
            }
            
            return tweets.sort((a, b) => b.date - a.date);
            
        } catch (error) {
            console.error('❌ [Twitter監控] 推文解析失敗:', error.message);
            return [];
        }
    }
    
    // 提取推文時間
    extractTweetTime(tweetContent) {
        try {
            // 多種時間格式模式
            const timePatterns = [
                // 相對時間 (1h, 2m, 3d 等)
                /(\d+)([smhd])\s*ago/i,
                // 絕對時間 (Dec 25, 2023)
                /(\w{3})\s+(\d{1,2}),?\s+(\d{4})/,
                // ISO格式
                /(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/,
                // 日期屬性
                /datetime="([^"]+)"/,
                /data-time="([^"]+)"/,
                /title="([^"]*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[^"]*)"]/i
            ];
            
            for (const pattern of timePatterns) {
                const match = tweetContent.match(pattern);
                if (match) {
                    let tweetDate = null;
                    
                    if (pattern.source.includes('([smhd])')) {
                        // 相對時間處理
                        const value = parseInt(match[1]);
                        const unit = match[2].toLowerCase();
                        tweetDate = new Date();
                        
                        switch (unit) {
                            case 's': tweetDate.setSeconds(tweetDate.getSeconds() - value); break;
                            case 'm': tweetDate.setMinutes(tweetDate.getMinutes() - value); break;
                            case 'h': tweetDate.setHours(tweetDate.getHours() - value); break;
                            case 'd': tweetDate.setDate(tweetDate.getDate() - value); break;
                        }
                    } else if (pattern.source.includes('(\\w{3})')) {
                        // 月份格式處理
                        const months = {
                            'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
                            'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
                        };
                        const month = months[match[1]];
                        const day = parseInt(match[2]);
                        const year = parseInt(match[3]);
                        tweetDate = new Date(year, month, day);
                    } else {
                        // 嘗試直接解析
                        tweetDate = new Date(match[1] || match[0]);
                    }
                    
                    if (tweetDate && !isNaN(tweetDate.getTime())) {
                        return {
                            date: tweetDate,
                            dateString: `${tweetDate.getFullYear()}年${tweetDate.getMonth() + 1}月${tweetDate.getDate()}日`,
                            fullDateTime: `${tweetDate.getFullYear()}年${tweetDate.getMonth() + 1}月${tweetDate.getDate()}日 ${tweetDate.getHours().toString().padStart(2, '0')}:${tweetDate.getMinutes().toString().padStart(2, '0')}`
                        };
                    }
                }
            }
            
            // 如果沒有找到時間，使用當前時間
            const now = new Date();
            return {
                date: now,
                dateString: `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`,
                fullDateTime: `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
            };
            
        } catch (error) {
            console.error('❌ [時間解析] 失敗:', error.message);
            return null;
        }
    }
    
    // 提取推文文字內容
    extractTweetText(tweetContent) {
        try {
            // 移除HTML標籤，提取純文字
            const textContent = tweetContent
                .replace(/<script[\s\S]*?<\/script>/gi, '')
                .replace(/<style[\s\S]*?<\/style>/gi, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/&nbsp;/g, ' ')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&amp;/g, '&')
                .replace(/\s+/g, ' ')
                .trim();
            
            return textContent.substring(0, 200); // 限制長度
        } catch (error) {
            console.error('❌ [文字提取] 失敗:', error.message);
            return '無法提取推文內容';
        }
    }

    // 測試網站連接
    async testWebsiteAccess() {
        try {
            console.log('🔍 [Twitter測試] 測試Twitter連接...');
            
            const response = await this.makeRequest(this.twitterUrl);
            
            console.log(`📊 [Twitter測試] HTTP狀態: ${response.statusCode}`);
            console.log(`📊 [Twitter測試] Content-Type: ${response.headers['content-type'] || '未知'}`);
            console.log(`📊 [Twitter測試] 內容長度: ${response.data.length} 字元`);
            
            if (response.statusCode !== 200) {
                return {
                    success: false,
                    error: `HTTP錯誤: ${response.statusCode}`,
                    details: response.headers
                };
            }

            const html = response.data;
            const hasValidContent = html.includes('timeline') || html.includes('tweet');
            const hasKeywords = this.keywords.some(keyword => html.includes(keyword));
            
            console.log(`📊 [Twitter測試] 包含推文結構: ${hasValidContent ? '✅' : '❌'}`);
            console.log(`📊 [Twitter測試] 包含關鍵字: ${hasKeywords ? '✅' : '❌'}`);
            
            return {
                success: true,
                statusCode: response.statusCode,
                contentLength: response.data.length,
                hasValidContent,
                hasKeywords,
                keywords: this.keywords,
                sampleContent: html.substring(0, 500)
            };

        } catch (error) {
            console.error('❌ [Twitter測試] 測試失敗:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // 分析當前內容
    async analyzeCurrentContent(showDetails = false) {
        try {
            console.log('🔍 [Twitter分析] 分析當前推文內容...');
            
            const tweets = await this.checkTwitterForUpdates();
            
            if (tweets.length === 0) {
                return {
                    success: true,
                    totalTweets: 0,
                    recentTweets: 0,
                    latestTweet: null,
                    keywords: this.keywords,
                    analysisTime: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
                    message: '未找到包含關鍵字的推文'
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
                analysisTime: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
            };

        } catch (error) {
            console.error('❌ [Twitter分析] 分析失敗:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // 主要檢查方法
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
📝 **內容:** ${article.content.substring(0, 200)}${article.content.length > 200 ? '...' : ''}
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

    // 獲取狀態
    getStatus() {
        return {
            isMonitoring: this.isMonitoring,
            totalChecks: this.totalChecks,
            articlesFound: this.articlesFound,
            lastCheckTime: this.lastCheckTime,
            lastArticleDate: this.lastArticleDate ? this.lastArticleDate.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : null,
            nextCheckTime: this.isMonitoring ? new Date(Date.now() + this.calculateNextCheckTime() * 1000).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : null,
            twitterUrl: this.twitterUrl,
            targetAccount: this.targetAccount,
            keywords: this.keywords,
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
            lastFind: this.lastArticleDate ? this.lastArticleDate.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : null
        };
    }
}

module.exports = BlogMonitor;