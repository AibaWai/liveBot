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
            
            // 專門針對familyclub.jp的time標籤解析 - 更寬松的匹配
            const timeTagPatterns = [
                // 原始嚴格模式
                /<time[^>]*datetime="([^"]+)"[^>]*class="entry__posted"[^>]*>([^<]+)<\/time>/gi,
                // 放寬順序限制
                /<time[^>]*class="entry__posted"[^>]*datetime="([^"]+)"[^>]*>([^<]+)<\/time>/gi,
                // 更寬松的匹配
                /<time[^>]*datetime="([^"]+)"[^>]*>([^<]+)<\/time>/gi,
                // 最寬松的匹配
                /<time[^>]*>([^<]*2025[^<]*)<\/time>/gi
            ];
            
            console.log('🔍 [Blog分析] 嘗試多種time標籤模式...');
            
            timeTagPatterns.forEach((pattern, patternIndex) => {
                pattern.lastIndex = 0;
                let patternMatch;
                let matchCount = 0;
                
                while ((patternMatch = pattern.exec(html)) !== null && matchCount < 20) {
                    matchCount++;
                    
                    let datetimeAttr, displayText;
                    
                    if (patternIndex === 3) {
                        // 最寬松模式，只有顯示文本
                        displayText = patternMatch[1].trim();
                        datetimeAttr = null;
                    } else {
                        datetimeAttr = patternMatch[1];
                        displayText = patternMatch[2].trim();
                    }
                    
                    console.log(`📅 [Blog分析] 模式${patternIndex + 1}找到: datetime="${datetimeAttr}", 顯示="${displayText}"`);
                    
                    // 解析datetime屬性或顯示文本
                    let parsedDate = null;
                    
                    if (datetimeAttr) {
                        // 解析 datetime 屬性 (ISO格式: 2025-07-14T19:00)
                        const dateMatch = datetimeAttr.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
                        if (dateMatch) {
                            const year = parseInt(dateMatch[1]);
                            const month = parseInt(dateMatch[2]);
                            const day = parseInt(dateMatch[3]);
                            const hour = parseInt(dateMatch[4]);
                            const minute = parseInt(dateMatch[5]);
                            parsedDate = {
                                date: new Date(year, month - 1, day, hour, minute),
                                year, month, day, hour, minute
                            };
                        }
                    } else {
                        // 解析顯示文本 (2025.07.14 19:00)
                        const textMatch = displayText.match(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})\s+(\d{1,2}):(\d{2})/);
                        if (textMatch) {
                            const year = parseInt(textMatch[1]);
                            const month = parseInt(textMatch[2]);
                            const day = parseInt(textMatch[3]);
                            const hour = parseInt(textMatch[4]);
                            const minute = parseInt(textMatch[5]);
                            parsedDate = {
                                date: new Date(year, month - 1, day, hour, minute),
                                year, month, day, hour, minute
                            };
                        }
                    }
                    
                    if (parsedDate) {
                        const now = new Date();
                        const diffDays = (now - parsedDate.date) / (1000 * 60 * 60 * 24);
                        
                        allDates.push({
                            original: displayText,
                            datetime: datetimeAttr,
                            date: parsedDate.date,
                            dateString: `${parsedDate.year}年${parsedDate.month}月${parsedDate.day}日`,
                            fullDateTime: `${parsedDate.year}年${parsedDate.month}月${parsedDate.day}日 ${parsedDate.hour.toString().padStart(2, '0')}:${parsedDate.minute.toString().padStart(2, '0')}`,
                            daysAgo: Math.floor(diffDays),
                            isRecent: diffDays >= 0 && diffDays <= 30,
                            patternUsed: patternIndex + 1
                        });
                    }
                }
                
                if (matchCount > 0) {
                    console.log(`📊 [Blog分析] 模式${patternIndex + 1}找到 ${matchCount} 個time標籤`);
                }
            });

            // 如果沒找到time標籤，回退到通用日期解析
            if (allDates.length === 0) {
                console.log('🔍 [Blog分析] 未找到time標籤，使用通用日期模式...');
                
                const datePatterns = [
                    // 2025.07.14 格式
                    /(\d{4})\.(\d{1,2})\.(\d{1,2})/g,
                    // 2025/07/14 格式
                    /(\d{4})\/(\d{1,2})\/(\d{1,2})/g,
                    // 2025-07-14 格式
                    /(\d{4})-(\d{1,2})-(\d{1,2})/g,
                    // 2025年7月14日 格式
                    /(\d{4})[年](\d{1,2})[月](\d{1,2})[日]/g
                ];
                
                const currentYear = new Date().getFullYear();
                
                datePatterns.forEach((pattern, patternIndex) => {
                    pattern.lastIndex = 0;
                    let patternMatch;
                    let matchCount = 0;
                    
                    while ((patternMatch = pattern.exec(html)) !== null && matchCount < 50) {
                        matchCount++;
                        const year = parseInt(patternMatch[1]);
                        const month = parseInt(patternMatch[2]);
                        const day = parseInt(patternMatch[3]);
                        
                        if (year >= 2020 && year <= currentYear + 1 && 
                            month >= 1 && month <= 12 && 
                            day >= 1 && day <= 31) {
                            
                            const articleDate = new Date(year, month - 1, day);
                            const now = new Date();
                            const diffDays = (now - articleDate) / (1000 * 60 * 60 * 24);
                            
                            allDates.push({
                                original: patternMatch[0],
                                pattern: patternIndex,
                                date: articleDate,
                                dateString: `${year}年${month}月${day}日`,
                                daysAgo: Math.floor(diffDays),
                                isRecent: diffDays >= 0 && diffDays <= 30
                            });
                        }
                    }
                    
                    if (matchCount > 0) {
                        console.log(`📊 [Blog分析] 模式 ${patternIndex + 1} 找到 ${matchCount} 個匹配`);
                    }
                });
            }

            // 去重複並按日期排序
            const uniqueDates = allDates.filter((date, index, self) => 
                index === self.findIndex(d => d.date.getTime() === date.date.getTime())
            );
            
            uniqueDates.sort((a, b) => b.date - a.date);

            // 過濾最近的文章
            const recentArticles = uniqueDates.filter(article => article.isRecent);
            
            console.log(`📊 [Blog分析] 總共找到 ${uniqueDates.length} 個唯一日期`);
            console.log(`📊 [Blog分析] 最近30天內的文章: ${recentArticles.length} 個`);

            if (uniqueDates.length > 0) {
                const latest = uniqueDates[0];
                console.log(`📅 [Blog分析] 最新文章: ${latest.fullDateTime || latest.dateString} (${latest.daysAgo}天前)`);
                
                if (showDetails && recentArticles.length > 0) {
                    console.log('📋 [Blog分析] 最近文章列表:');
                    recentArticles.slice(0, 10).forEach((article, index) => {
                        const timeInfo = article.fullDateTime || article.dateString;
                        const sourceInfo = article.datetime ? `time標籤: ${article.original}` : `模式${article.pattern + 1}: ${article.original}`;
                        console.log(`   ${index + 1}. ${timeInfo} (${article.daysAgo}天前) [${sourceInfo}]`);
                    });
                }
            }

            return {
                success: true,
                totalDates: uniqueDates.length,
                recentArticles: recentArticles.length,
                latestArticle: uniqueDates.length > 0 ? uniqueDates[0] : null,
                allRecentArticles: recentArticles,
                analysisTime: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
                htmlLength: html.length,
                useTimeTag: allDates.some(d => d.datetime), // 是否使用了time標籤解析
                debugInfo: uniqueDates.length === 0 ? {
                    htmlSample: html.substring(0, 1000),
                    timeTagSample: html.match(/<time[^>]*>.*?<\/time>/gi)?.slice(0, 3) || []
                } : null
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

            const html = response.data;
            
            // 專門針對familyclub.jp的time標籤解析
            const timeTagPattern = /<time[^>]*datetime="([^"]+)"[^>]*class="entry__posted"[^>]*>([^<]+)<\/time>/g;
            const dates = [];
            let match;
            
            // 優先使用time標籤解析
            while ((match = timeTagPattern.exec(html)) !== null) {
                const datetimeAttr = match[1]; // datetime="2025-07-14T19:00"
                const displayText = match[2].trim(); // "2025.07.14 19:00"
                
                // 解析 datetime 屬性 (ISO格式: 2025-07-14T19:00)
                const dateMatch = datetimeAttr.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
                if (dateMatch) {
                    const year = parseInt(dateMatch[1]);
                    const month = parseInt(dateMatch[2]);
                    const day = parseInt(dateMatch[3]);
                    const hour = parseInt(dateMatch[4]);
                    const minute = parseInt(dateMatch[5]);
                    
                    const articleDate = new Date(year, month - 1, day, hour, minute);
                    const now = new Date();
                    const diffDays = (now - articleDate) / (1000 * 60 * 60 * 24);
                    
                    // 只考慮7天內的文章（正常模式）或30天內（測試模式）
                    const dayLimit = testMode ? 30 : 7;
                    
                    if (diffDays >= 0 && diffDays <= dayLimit) {
                        dates.push({
                            date: articleDate,
                            dateString: `${year}年${month}月${day}日`,
                            fullDateTime: `${year}年${month}月${day}日 ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
                            original: displayText,
                            datetime: datetimeAttr
                        });
                    }
                }
            }

            // 如果沒找到time標籤，回退到通用日期解析
            if (dates.length === 0) {
                console.log('🔍 [Blog] 未找到time標籤，使用通用日期模式...');
                
                const datePatterns = [
                    // 2025.07.14 格式
                    /(\d{4})\.(\d{1,2})\.(\d{1,2})/g,
                    // 2025/07/14 格式
                    /(\d{4})\/(\d{1,2})\/(\d{1,2})/g,
                    // 2025-07-14 格式
                    /(\d{4})-(\d{1,2})-(\d{1,2})/g,
                    // 2025年7月14日 格式
                    /(\d{4})[年](\d{1,2})[月](\d{1,2})[日]/g
                ];
                
                const currentYear = new Date().getFullYear();
                
                datePatterns.forEach((pattern) => {
                    pattern.lastIndex = 0;
                    let patternMatch;
                    
                    while ((patternMatch = pattern.exec(html)) !== null) {
                        const year = parseInt(patternMatch[1]);
                        const month = parseInt(patternMatch[2]);
                        const day = parseInt(patternMatch[3]);
                        
                        if (year >= 2020 && year <= currentYear + 1 && 
                            month >= 1 && month <= 12 && 
                            day >= 1 && day <= 31) {
                            
                            const articleDate = new Date(year, month - 1, day);
                            const now = new Date();
                            const diffDays = (now - articleDate) / (1000 * 60 * 60 * 24);
                            
                            const dayLimit = testMode ? 30 : 7;
                            
                            if (diffDays >= 0 && diffDays <= dayLimit) {
                                dates.push({
                                    date: articleDate,
                                    dateString: `${year}年${month}月${day}日`,
                                    original: patternMatch[0]
                                });
                            }
                        }
                    }
                });
            }

            // 去重複並排序
            const uniqueDates = dates.filter((date, index, self) => 
                index === self.findIndex(d => d.date.getTime() === date.date.getTime())
            );
            
            uniqueDates.sort((a, b) => b.date - a.date);

            if (uniqueDates.length > 0) {
                // 取最新的日期
                const latestArticle = uniqueDates[0];

                // 在測試模式下，總是顯示找到的文章
                if (testMode) {
                    const timeInfo = latestArticle.fullDateTime || latestArticle.dateString;
                    const sourceInfo = latestArticle.datetime ? `time標籤: ${latestArticle.original}` : `通用模式: ${latestArticle.original}`;
                    console.log(`📝 [Blog測試] 找到最新文章: ${timeInfo} (${sourceInfo})`);
                    this.lastFoundArticles = uniqueDates.slice(0, 5);
                    return latestArticle;
                }

                // 檢查是否為新文章
                if (!this.lastArticleDate || latestArticle.date > this.lastArticleDate) {
                    this.lastArticleDate = latestArticle.date;
                    this.articlesFound++;
                    
                    const timeInfo = latestArticle.fullDateTime || latestArticle.dateString;
                    console.log(`📝 [Blog] 發現新文章: ${timeInfo}`);
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

    // 暴露makeRequest方法供調試使用
    async makeRequestPublic(url) {
        return await this.makeRequest(url);
    }
}

module.exports = BlogMonitor;