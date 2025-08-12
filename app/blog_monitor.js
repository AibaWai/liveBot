const https = require('https');

class BlogMonitor {
    constructor(notificationCallback = null) {
        this.notificationCallback = notificationCallback;
        this.lastArticleDate = null;
        this.isMonitoring = false;
        this.monitoringInterval = null;
        this.blogUrl = 'https://web.familyclub.jp/s/jwb/diary/F2017?ima=2317';
        this.checkIntervalMinutes = 60; // 每小時檢查一次
        this.totalChecks = 0;
        this.articlesFound = 0;
        this.lastCheckTime = null;
        this.lastFoundArticles = []; // 存儲最近找到的文章
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

    // 新增：測試網站連接和內容解析
    async testWebsiteAccess() {
        try {
            console.log('🔍 [Blog測試] 測試網站訪問...');
            
            const response = await this.makeRequest(this.blogUrl);
            
            console.log(`📊 [Blog測試] HTTP狀態: ${response.statusCode}`);
            console.log(`📊 [Blog測試] Content-Type: ${response.headers['content-type'] || '未知'}`);
            console.log(`📊 [Blog測試] 內容長度: ${response.data.length} 字元`);
            
            if (response.statusCode !== 200) {
                return {
                    success: false,
                    error: `HTTP錯誤: ${response.statusCode}`,
                    details: response.headers
                };
            }

            // 檢查是否包含預期的HTML結構
            const html = response.data;
            const hasHtmlStructure = html.includes('<html') && html.includes('</html>');
            const hasContent = html.length > 1000; // 至少1KB的內容
            
            console.log(`📊 [Blog測試] HTML結構: ${hasHtmlStructure ? '✅' : '❌'}`);
            console.log(`📊 [Blog測試] 內容充足: ${hasContent ? '✅' : '❌'}`);
            
            // 測試日期模式匹配
            const datePattern = /(\d{4})[年\/\-](\d{1,2})[月\/\-](\d{1,2})[日號]/g;
            const dateMatches = [...html.matchAll(datePattern)];
            
            console.log(`📊 [Blog測試] 找到日期模式: ${dateMatches.length} 個`);
            
            if (dateMatches.length > 0) {
                dateMatches.slice(0, 5).forEach((match, index) => {
                    console.log(`   ${index + 1}. ${match[0]} (${match[1]}年${match[2]}月${match[3]}日)`);
                });
            }

            return {
                success: true,
                statusCode: response.statusCode,
                contentLength: response.data.length,
                hasHtmlStructure,
                hasContent,
                dateMatchesCount: dateMatches.length,
                sampleDates: dateMatches.slice(0, 5).map(match => match[0])
            };

        } catch (error) {
            console.error('❌ [Blog測試] 測試失敗:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // 新增：詳細分析當前網站內容
    async analyzeCurrentContent(showDetails = false) {
        try {
            console.log('🔍 [Blog分析] 分析當前網站內容...');
            
            const response = await this.makeRequest(this.blogUrl);
            
            if (response.statusCode !== 200) {
                return {
                    success: false,
                    error: `HTTP錯誤: ${response.statusCode}`
                };
            }

            const html = response.data;
            
            // 尋找所有日期模式
            const datePattern = /(\d{4})[年\/\-](\d{1,2})[月\/\-](\d{1,2})[日號]/g;
            const allDates = [];
            let match;
            
            while ((match = datePattern.exec(html)) !== null) {
                const year = parseInt(match[1]);
                const month = parseInt(match[2]);
                const day = parseInt(match[3]);
                
                const articleDate = new Date(year, month - 1, day);
                const now = new Date();
                const diffDays = (now - articleDate) / (1000 * 60 * 60 * 24);
                
                allDates.push({
                    original: match[0],
                    date: articleDate,
                    dateString: `${year}年${month}月${day}日`,
                    daysAgo: Math.floor(diffDays),
                    isRecent: diffDays >= 0 && diffDays <= 30 // 30天內
                });
            }

            // 按日期排序，最新的在前
            allDates.sort((a, b) => b.date - a.date);

            // 過濾最近的文章
            const recentArticles = allDates.filter(article => article.isRecent);
            
            console.log(`📊 [Blog分析] 總共找到 ${allDates.length} 個日期`);
            console.log(`📊 [Blog分析] 最近30天內的文章: ${recentArticles.length} 個`);

            if (allDates.length > 0) {
                const latest = allDates[0];
                console.log(`📅 [Blog分析] 最新文章: ${latest.dateString} (${latest.daysAgo}天前)`);
                
                if (showDetails && recentArticles.length > 0) {
                    console.log('📋 [Blog分析] 最近文章列表:');
                    recentArticles.slice(0, 10).forEach((article, index) => {
                        console.log(`   ${index + 1}. ${article.dateString} (${article.daysAgo}天前)`);
                    });
                }
            }

            return {
                success: true,
                totalDates: allDates.length,
                recentArticles: recentArticles.length,
                latestArticle: allDates.length > 0 ? allDates[0] : null,
                allRecentArticles: recentArticles,
                analysisTime: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
            };

        } catch (error) {
            console.error('❌ [Blog分析] 分析失敗:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // 解析博客頁面尋找新文章（增強版）
    async checkForNewArticles(testMode = false) {
        try {
            console.log(`🔍 [Blog] 檢查新文章... ${testMode ? '(測試模式)' : ''}`);
            this.totalChecks++;
            this.lastCheckTime = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

            const response = await this.makeRequest(this.blogUrl);
            
            if (response.statusCode !== 200) {
                console.log(`❌ [Blog] HTTP錯誤: ${response.statusCode}`);
                return null;
            }

            // 簡單的HTML解析尋找文章日期模式
            const html = response.data;
            
            // 尋找最新文章的日期模式
            const datePattern = /(\d{4})[年\/\-](\d{1,2})[月\/\-](\d{1,2})[日號]/g;
            const dates = [];
            let match;
            
            while ((match = datePattern.exec(html)) !== null) {
                const year = parseInt(match[1]);
                const month = parseInt(match[2]);
                const day = parseInt(match[3]);
                
                // 只考慮近期的日期
                const articleDate = new Date(year, month - 1, day);
                const now = new Date();
                const diffDays = (now - articleDate) / (1000 * 60 * 60 * 24);
                
                if (diffDays >= 0 && diffDays <= 7) { // 只檢查7天內的文章
                    dates.push({
                        date: articleDate,
                        dateString: `${year}年${month}月${day}日`
                    });
                }
            }

            if (dates.length > 0) {
                // 取最新的日期
                const latestArticle = dates.reduce((latest, current) => 
                    current.date > latest.date ? current : latest
                );

                // 在測試模式下，總是顯示找到的文章
                if (testMode) {
                    console.log(`📝 [Blog測試] 找到最新文章: ${latestArticle.dateString}`);
                    this.lastFoundArticles = dates.slice(0, 5); // 保存最近5篇
                    return latestArticle;
                }

                // 檢查是否為新文章
                if (!this.lastArticleDate || latestArticle.date > this.lastArticleDate) {
                    this.lastArticleDate = latestArticle.date;
                    this.articlesFound++;
                    
                    console.log(`📝 [Blog] 發現新文章: ${latestArticle.dateString}`);
                    return latestArticle;
                }
            }

            console.log('📋 [Blog] 無新文章');
            return null;

        } catch (error) {
            console.error('❌ [Blog] 檢查失敗:', error.message);
            return null;
        }
    }

    // 發送新文章通知
    async sendNewArticleNotification(article) {
        if (!this.notificationCallback) return;

        const notificationMessage = `📝 **新博客文章發布!** 

🗓️ **發布日期:** ${article.dateString}
🔗 **博客連結:** ${this.blogUrl}
⏰ **檢測時間:** ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}

🎉 快去看看新內容吧！`;

        try {
            await this.notificationCallback(notificationMessage, 'blog_alert', 'Blog');
            console.log('📤 [Blog] 新文章通知已發送');
        } catch (error) {
            console.error('❌ [Blog] 通知發送失敗:', error.message);
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
            console.log('⚠️ [Blog] 監控已在運行中');
            return;
        }

        this.isMonitoring = true;
        console.log('🚀 [Blog] 開始博客監控 (每小時00分檢查)');
        
        const monitorLoop = async () => {
            if (!this.isMonitoring) {
                console.log('⏹️ [Blog] 監控已停止');
                return;
            }

            try {
                const newArticle = await this.checkForNewArticles();
                if (newArticle) {
                    await this.sendNewArticleNotification(newArticle);
                }

                // 計算下次檢查時間
                const nextCheckSeconds = this.calculateNextCheckTime();
                const nextCheckTime = new Date(Date.now() + nextCheckSeconds * 1000)
                    .toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
                
                console.log(`⏰ [Blog] 下次檢查: ${nextCheckTime} (${Math.round(nextCheckSeconds/60)}分鐘後)`);

                // 設定下次檢查
                this.monitoringInterval = setTimeout(monitorLoop, nextCheckSeconds * 1000);

            } catch (error) {
                console.error('❌ [Blog] 監控循環錯誤:', error.message);
                
                // 發生錯誤時，10分鐘後重試
                if (this.isMonitoring) {
                    console.log('⚠️ [Blog] 10分鐘後重試');
                    this.monitoringInterval = setTimeout(monitorLoop, 10 * 60 * 1000);
                }
            }
        };

        // 首次檢查 - 立即執行
        console.log('⏳ [Blog] 5秒後開始首次檢查');
        this.monitoringInterval = setTimeout(monitorLoop, 5000);
    }

    // 停止監控
    stopMonitoring() {
        this.isMonitoring = false;
        
        if (this.monitoringInterval) {
            clearTimeout(this.monitoringInterval);
            this.monitoringInterval = null;
        }
        
        console.log('⏹️ [Blog] 博客監控已停止');
    }

    // 獲取狀態（增強版）
    getStatus() {
        return {
            isMonitoring: this.isMonitoring,
            totalChecks: this.totalChecks,
            articlesFound: this.articlesFound,
            lastCheckTime: this.lastCheckTime,
            lastArticleDate: this.lastArticleDate ? this.lastArticleDate.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : null,
            nextCheckTime: this.isMonitoring ? new Date(Date.now() + this.calculateNextCheckTime() * 1000).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : null,
            blogUrl: this.blogUrl,
            lastFoundArticles: this.lastFoundArticles.map(article => article.dateString) // 最近找到的文章
        };
    }
}

module.exports = BlogMonitor;