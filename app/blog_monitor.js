const https = require('https');

class BlogMonitor {
    constructor(notificationCallback = null) {
        this.notificationCallback = notificationCallback;
        this.lastArticleDate = null;
        this.isMonitoring = false;
        this.monitoringInterval = null;
        this.blogUrl = 'https://web.familyclub.jp/s/jwb/diary/F2017?ima=3047';
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

    // 新增：嘗試找到API端點或動態內容
    async findApiEndpoint() {
        try {
            console.log('🔍 [Blog API] 尋找動態載入端點...');
            
            const response = await this.makeRequest(this.blogUrl);
            const html = response.data;
            
            // 尋找可能的API端點
            const scriptMatches = html.match(/<script[^>]*>[\s\S]*?<\/script>/gi) || [];
            const apiPatterns = [
                /\/api\/[^"'\s]+/g,
                /diarkiji_list[^"'\s]*/g
            ];
            
            const potentialEndpoints = [];
            
            scriptMatches.forEach(script => {
                apiPatterns.forEach(pattern => {
                    const matches = [...script.matchAll(pattern)];
                    matches.forEach(match => {
                        if (match[1]) {
                            potentialEndpoints.push(match[1]);
                        } else {
                            potentialEndpoints.push(match[0]);
                        }
                    });
                });
            });
            
            return potentialEndpoints;
            
        } catch (error) {
            console.error('❌ [Blog API] API搜尋失敗:', error.message);
            return [];
        }
    }

    // 新增：詳細調試HTML內容
    async debugHtmlContent() {
        try {
            console.log('🔍 [Blog調試] 開始詳細分析HTML內容...');
            
            const response = await this.makeRequest(this.blogUrl);
            
            if (response.statusCode !== 200) {
                console.error(`❌ [Blog調試] HTTP錯誤: ${response.statusCode}`);
                return null;
            }

            const html = response.data;
            console.log(`📊 [Blog調試] HTML長度: ${html.length} 字元`);
            
            // 檢查是否包含JavaScript動態載入的跡象
            const hasJavaScript = html.includes('<script');
            const hasJQuery = html.includes('jquery') || html.includes('jQuery');
            const hasAjax = html.includes('ajax') || html.includes('AJAX');
            const hasReact = html.includes('react') || html.includes('React');
            
            console.log(`🔧 [Blog調試] JavaScript檢測:`);
            console.log(`   - 包含script標籤: ${hasJavaScript ? '✅' : '❌'}`);
            console.log(`   - 使用jQuery: ${hasJQuery ? '✅' : '❌'}`);
            console.log(`   - 使用Ajax: ${hasAjax ? '✅' : '❌'}`);
            console.log(`   - 使用React: ${hasReact ? '✅' : '❌'}`);
            
            // 尋找可能的動態載入容器
            const containers = [
                'js-blog-container',
                'entry-list',
                'blog-container',
                'article-list',
                'content-container'
            ];
            
            console.log(`🔍 [Blog調試] 檢查容器元素:`);
            for (const containerId of containers) {
                const hasContainer = html.includes(containerId);
                console.log(`   - ${containerId}: ${hasContainer ? '✅ 找到' : '❌ 未找到'}`);
                
                if (hasContainer) {
                    // 提取容器周圍的HTML
                    const containerRegex = new RegExp(`<[^>]*${containerId}[^>]*>`, 'i');
                    const match = html.match(containerRegex);
                    if (match) {
                        console.log(`   - 容器HTML: ${match[0]}`);
                    }
                }
            }
            
            // 檢查是否有API端點或數據載入的跡象
            console.log(`🔍 [Blog調試] 尋找API端點線索:`);
            const apiPatterns = [
                /\/api\/[^"'\s]+/g,
                /diarkiji_list/g,
                /blog.*api/gi,
                /ajax.*url/gi
            ];
            
            for (const pattern of apiPatterns) {
                const matches = [...html.matchAll(pattern)];
                if (matches.length > 0) {
                    console.log(`   - 模式 ${pattern.source}: 找到 ${matches.length} 個匹配`);
                    matches.slice(0, 3).forEach((match, index) => {
                        console.log(`     ${index + 1}. ${match[0]}`);
                    });
                }
            }
            
            // 輸出HTML片段進行分析
            console.log(`📄 [Blog調試] HTML開頭片段 (前2000字元):`);
            console.log(html.substring(0, 2000));
            
            console.log(`📄 [Blog調試] HTML結尾片段 (後1000字元):`);
            console.log(html.substring(Math.max(0, html.length - 1000)));
            
            return {
                htmlLength: html.length,
                hasJavaScript,
                hasJQuery,
                hasAjax,
                hasReact,
                containersFound: containers.filter(id => html.includes(id)),
                fullHtml: html
            };
            
        } catch (error) {
            console.error('❌ [Blog調試] 調試失敗:', error.message);
            return null;
        }
    }
    async getDynamicContent() {
        try {
            console.log('🔄 [Blog動態] 嘗試獲取動態載入內容...');
            
            // 測試最有希望的API端點
            const targetEndpoints = [
                'https://web.familyclub.jp/api/list/diarkiji_list?code=F2017&so=JW5',
                'https://web.familyclub.jp/api/list/diarkiji_list?code=F2017'
            ];
            
            for (const url of targetEndpoints) {
                try {
                    console.log(`🧪 [Blog動態] 測試API端點: ${url}`);
                    
                    const response = await this.makeRequest(url, {
                        headers: {
                            'Accept': 'application/json, text/plain, */*',
                            'Referer': this.blogUrl,
                            'X-Requested-With': 'XMLHttpRequest'
                        }
                    });
                    
                    if (response.statusCode === 200) {
                        try {
                            const jsonData = JSON.parse(response.data);
                            console.log(`✅ [Blog動態] 找到JSON API: ${url}`);
                            return { url: url, data: jsonData, type: 'json' };
                        } catch (parseError) {
                            if (response.data.includes('<time')) {
                                return { url: url, data: response.data, type: 'html' };
                            }
                        }
                    }
                } catch (error) {
                    console.log(`❌ [Blog動態] 端點測試失敗: ${url}`);
                }
            }
            
            return null;
            
        } catch (error) {
            console.error('❌ [Blog動態] 動態內容獲取失敗:', error.message);
            return null;
        }
    }

    // 新增：解析JSON格式的文章數據
    parseArticlesFromJson(jsonData) {
        const articles = [];
        
        try {
            console.log('🔍 [Blog JSON] 解析JSON文章數據...');
            
            const possibleArrays = [jsonData, jsonData.data, jsonData.articles, jsonData.entries, jsonData.items, jsonData.list];
            
            for (const arrayData of possibleArrays) {
                if (Array.isArray(arrayData)) {
                    console.log(`📊 [Blog JSON] 找到陣列數據，長度: ${arrayData.length}`);
                    
                    arrayData.forEach((item, index) => {
                        if (typeof item === 'object' && item !== null) {
                            const dateFields = ['datetime', 'date', 'published', 'created', 'posted'];
                            
                            for (const field of dateFields) {
                                if (item[field]) {
                                    const dateStr = item[field].toString();
                                    const dateMatch = dateStr.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
                                    
                                    if (dateMatch) {
                                        const foundDate = new Date(parseInt(dateMatch[1]), parseInt(dateMatch[2]) - 1, parseInt(dateMatch[3]), parseInt(dateMatch[4]), parseInt(dateMatch[5]));
                                        
                                        articles.push({
                                            date: foundDate,
                                            dateString: `${foundDate.getFullYear()}年${foundDate.getMonth() + 1}月${foundDate.getDate()}日`,
                                            fullDateTime: `${foundDate.getFullYear()}年${foundDate.getMonth() + 1}月${foundDate.getDate()}日 ${foundDate.getHours().toString().padStart(2, '0')}:${foundDate.getMinutes().toString().padStart(2, '0')}`,
                                            original: dateStr,
                                            source: 'json'
                                        });
                                        break;
                                    }
                                }
                            }
                        }
                    });
                    break;
                }
            }
            
            return articles;
            
        } catch (error) {
            console.error('❌ [Blog JSON] JSON解析失敗:', error.message);
            return [];
        }
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

    // 修復的：詳細分析當前網站內容
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
            const allDates = []; // 修復：在函數開始時定義 allDates
            
            // 針對實際HTML結構的精確匹配模式
            const timeTagPatterns = [
                // 精確匹配實際格式: <time datetime="2025-07-14T19:00" class="entry__posted">2025.07.14 19:00</time>
                /<time\s+datetime="([^"]+)"\s+class="entry__posted">([^<]+)<\/time>/gi,
                // 順序調換版本
                /<time\s+class="entry__posted"\s+datetime="([^"]+)">([^<]+)<\/time>/gi,
                // 更寬松的匹配（可能有其他屬性）
                /<time[^>]*datetime="([^"]+)"[^>]*class="entry__posted"[^>]*>([^<]+)<\/time>/gi,
                // 反向順序
                /<time[^>]*class="entry__posted"[^>]*datetime="([^"]+)"[^>]*>([^<]+)<\/time>/gi,
                // 最寬松的匹配
                /<time[^>]*datetime="([^"]+)"[^>]*>([^<]+)<\/time>/gi
            ];
            
            console.log('🔍 [Blog分析] 嘗試精確匹配time標籤模式...');
            console.log('🔍 [Blog分析] 在HTML中搜尋entry__posted類...');
            
            // 先檢查HTML中是否包含預期的結構
            const entryPostedCount = (html.match(/entry__posted/g) || []).length;
            const timeTagCount = (html.match(/<time[^>]*>/g) || []).length;
            console.log(`📊 [Blog分析] 找到 entry__posted: ${entryPostedCount} 個, time標籤: ${timeTagCount} 個`);
            
            
            timeTagPatterns.forEach((pattern, patternIndex) => {
                pattern.lastIndex = 0;
                let patternMatch;
                let matchCount = 0;
                
                console.log(`🔍 [Blog分析] 嘗試模式 ${patternIndex + 1}: ${pattern.source.substring(0, 50)}...`);
                
                while ((patternMatch = pattern.exec(html)) !== null && matchCount < 20) {
                    matchCount++;
                    
                    let datetimeAttr, displayText;
                    
                    // 所有模式都應該有 datetime 和 display text
                    datetimeAttr = patternMatch[1];
                    displayText = patternMatch[2] ? patternMatch[2].trim() : '';
                    
                    console.log(`📅 [Blog分析] 模式${patternIndex + 1}找到: datetime="${datetimeAttr}", 顯示="${displayText}"`);
                    
                    // 解析datetime屬性 (ISO格式: 2025-07-14T19:00)
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
                        
                        console.log(`✅ [Blog分析] 解析成功: ${year}-${month}-${day} ${hour}:${minute} (${Math.floor(diffDays)}天前)`);
                        
                        allDates.push({
                            original: displayText,
                            datetime: datetimeAttr,
                            date: articleDate,
                            dateString: `${year}年${month}月${day}日`,
                            fullDateTime: `${year}年${month}月${day}日 ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
                            daysAgo: Math.floor(diffDays),
                            isRecent: diffDays >= 0 && diffDays <= 30,
                            patternUsed: patternIndex + 1
                        });
                    } else {
                        console.log(`❌ [Blog分析] 無法解析datetime: ${datetimeAttr}`);
                    }
                }
                
                if (matchCount > 0) {
                    console.log(`📊 [Blog分析] 模式${patternIndex + 1}找到 ${matchCount} 個time標籤`);
                    // 如果找到了匹配，就不需要嘗試其他模式
                    if (allDates.length > 0) {
                        console.log(`✅ [Blog分析] 模式${patternIndex + 1}成功，停止嘗試其他模式`);
                        return; // 跳出forEach
                    }
                } else {
                    console.log(`❌ [Blog分析] 模式${patternIndex + 1}無匹配`);
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

            // 首先嘗試獲取動態內容
            const dynamicContent = await this.getDynamicContent();
            
            let dates = [];
            
            if (dynamicContent && dynamicContent.type === 'json') {
                dates = this.parseArticlesFromJson(dynamicContent.data);
            } else {
                const response = await this.makeRequest(this.blogUrl);
                if (response.statusCode !== 200) {
                    console.log(`❌ [Blog] HTTP錯誤: ${response.statusCode}`);
                    return null;
                }
                dates = this.parseArticlesFromHtml(response.data, testMode);
            }

            // 去重複並排序
            const uniqueDates = dates.filter((date, index, self) => 
                index === self.findIndex(d => d.date.getTime() === date.date.getTime())
            );
            
            uniqueDates.sort((a, b) => b.date - a.date);

            if (uniqueDates.length > 0) {
                const latestArticle = uniqueDates[0];

                if (testMode) {
                    const timeInfo = latestArticle.fullDateTime || latestArticle.dateString;
                    console.log(`📝 [Blog測試] 找到最新文章: ${timeInfo}`);
                    this.lastFoundArticles = uniqueDates.slice(0, 5);
                    return latestArticle;
                }

                if (!this.lastArticleDate || latestArticle.date > this.lastArticleDate) {
                    this.lastArticleDate = latestArticle.date;
                    this.articlesFound++;
                    console.log(`📝 [Blog] 發現新文章: ${latestArticle.fullDateTime || latestArticle.dateString}`);
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

    // 修復的：從HTML解析文章（針對實際HTML結構優化）
    parseArticlesFromHtml(html, testMode = false) {
        const dates = [];
        
        console.log('🔍 [Blog HTML] 開始解析HTML中的文章...');
        
        // 精確匹配實際的HTML結構
        const timeTagPatterns = [
            // 最精確的匹配: <time datetime="2025-07-14T19:00" class="entry__posted">2025.07.14 19:00</time>
            /<time\s+datetime="([^"]+)"\s+class="entry__posted">([^<]+)<\/time>/g,
            // 順序可能不同
            /<time\s+class="entry__posted"\s+datetime="([^"]+)">([^<]+)<\/time>/g,
            // 包含其他屬性的版本
            /<time[^>]*datetime="([^"]+)"[^>]*class="entry__posted"[^>]*>([^<]+)<\/time>/g,
            // 反向順序
            /<time[^>]*class="entry__posted"[^>]*datetime="([^"]+)"[^>]*>([^<]+)<\/time>/g
        ];
        
        // 檢查HTML中是否包含預期的結構
        const hasEntryPosted = html.includes('entry__posted');
        const entryPostedCount = (html.match(/entry__posted/g) || []).length;
        console.log(`📊 [Blog HTML] 找到 entry__posted: ${hasEntryPosted ? '✅' : '❌'} (${entryPostedCount} 個)`);
        
        if (!hasEntryPosted) {
            console.log('❌ [Blog HTML] 未找到預期的entry__posted類，HTML結構可能已改變');
            // 輸出一些HTML樣本進行調試
            const timeTagSample = html.match(/<time[^>]*>.*?<\/time>/gi)?.slice(0, 3) || [];
            console.log('🔍 [Blog HTML] 找到的time標籤範例:', timeTagSample);
            return dates;
        }
        
        for (let patternIndex = 0; patternIndex < timeTagPatterns.length; patternIndex++) {
            const pattern = timeTagPatterns[patternIndex];
            let match;
            let matchCount = 0;
            
            console.log(`🧪 [Blog HTML] 嘗試模式 ${patternIndex + 1}...`);
            pattern.lastIndex = 0; // 重置正則表達式
            
            while ((match = pattern.exec(html)) !== null && matchCount < 50) {
                matchCount++;
                
                const datetimeAttr = match[1];
                const displayText = match[2].trim();
                
                console.log(`📅 [Blog HTML] 找到: datetime="${datetimeAttr}", 顯示="${displayText}"`);
                
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
                    const dayLimit = testMode ? 30 : 7;
                    
                    console.log(`📊 [Blog HTML] 解析文章: ${year}-${month}-${day} ${hour}:${minute} (${Math.floor(diffDays)}天前)`);
                    
                    if (diffDays >= 0 && diffDays <= dayLimit) {
                        dates.push({
                            date: articleDate,
                            dateString: `${year}年${month}月${day}日`,
                            fullDateTime: `${year}年${month}月${day}日 ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
                            original: displayText,
                            datetime: datetimeAttr,
                            source: 'html'
                        });
                        console.log(`✅ [Blog HTML] 文章已加入: ${year}年${month}月${day}日 ${hour}:${minute}`);
                    } else {
                        console.log(`⏭️ [Blog HTML] 文章太舊或太新，跳過: ${Math.floor(diffDays)}天前 (限制: ${dayLimit}天)`);
                    }
                } else {
                    console.log(`❌ [Blog HTML] 無法解析datetime格式: ${datetimeAttr}`);
                }
            }
            
            console.log(`📊 [Blog HTML] 模式 ${patternIndex + 1} 找到 ${matchCount} 個匹配`);
            
            if (dates.length > 0) {
                console.log(`✅ [Blog HTML] 成功找到 ${dates.length} 篇文章，停止嘗試其他模式`);
                break; // 如果找到了文章，就不需要嘗試其他模式
            }
        }
        
        console.log(`📋 [Blog HTML] 最終結果: 找到 ${dates.length} 篇符合條件的文章`);
        return dates;
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
            lastFoundArticles: this.lastFoundArticles.map(article => article.dateString || article.fullDateTime) // 最近找到的文章
        };
    }

    // 暴露調試方法供外部使用
    async debugHtmlContentPublic() {
        return await this.debugHtmlContent();
    }
}

module.exports = BlogMonitor;