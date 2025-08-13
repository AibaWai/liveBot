const https = require('https');

class TargetedFamilyClubDetector {
    constructor() {
        this.blogUrl = 'https://web.familyclub.jp/s/jwb/diary/F2017?ima=3047';
        this.baseUrl = 'https://web.familyclub.jp';
        this.artistId = 'F2017';
        this.ima = '3047';
    }

    // 基於發現的模式，生成更有針對性的端點
    generateTargetedEndpoints() {
        const endpoints = [
            // 基於最佳候選端點的變體
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?ima=${this.ima}&format=json`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?ima=${this.ima}&format=xml`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?ima=${this.ima}&format=rss`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?ima=${this.ima}&format=atom`,
            
            // 嘗試不同的參數組合
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?ima=${this.ima}&response=json`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?ima=${this.ima}&dataType=json`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?ima=${this.ima}&accept=application/json`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?ima=${this.ima}&contentType=json`,
            
            // 移動端變體（通常更簡潔）
            `${this.baseUrl}/m/s/jwb/diary/${this.artistId}?ima=${this.ima}`,
            `${this.baseUrl}/mobile/s/jwb/diary/${this.artistId}?ima=${this.ima}`,
            `${this.baseUrl}/app/s/jwb/diary/${this.artistId}?ima=${this.ima}`,
            
            // API 路徑變體
            `${this.baseUrl}/api/s/jwb/diary/${this.artistId}?ima=${this.ima}`,
            `${this.baseUrl}/json/s/jwb/diary/${this.artistId}?ima=${this.ima}`,
            `${this.baseUrl}/data/s/jwb/diary/${this.artistId}?ima=${this.ima}`,
            
            // 異步加載端點
            `${this.baseUrl}/async/s/jwb/diary/${this.artistId}?ima=${this.ima}`,
            `${this.baseUrl}/xhr/s/jwb/diary/${this.artistId}?ima=${this.ima}`,
            `${this.baseUrl}/fetch/s/jwb/diary/${this.artistId}?ima=${this.ima}`,
            
            // 不同的請求方法參數
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?ima=${this.ima}&method=json`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?ima=${this.ima}&callback=jsonp`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?ima=${this.ima}&jsonp=callback`,
            
            // 分頁和過濾
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?ima=${this.ima}&page=0&format=json`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?ima=${this.ima}&limit=100&format=json`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?ima=${this.ima}&all=true&format=json`,
            
            // 不同的文件擴展名
            `${this.baseUrl}/s/jwb/diary/${this.artistId}.json?ima=${this.ima}`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}.xml?ima=${this.ima}`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}.rss?ima=${this.ima}`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}.feed?ima=${this.ima}`,
            
            // WebAPI 標準路徑
            `${this.baseUrl}/webapi/diary/${this.artistId}?ima=${this.ima}`,
            `${this.baseUrl}/restapi/diary/${this.artistId}?ima=${this.ima}`,
            `${this.baseUrl}/service/diary/${this.artistId}?ima=${this.ima}`,
            
            // 版本化的API
            `${this.baseUrl}/v1/diary/${this.artistId}?ima=${this.ima}`,
            `${this.baseUrl}/v2/diary/${this.artistId}?ima=${this.ima}`,
            `${this.baseUrl}/api/v1/diary/${this.artistId}?ima=${this.ima}`
        ];
        
        return endpoints;
    }

    // 嘗試不同的User-Agent來模擬不同的客戶端
    getUserAgents() {
        return [
            // 標準瀏覽器
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            // 移動端
            'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
            // API客戶端
            'FamilyClub/1.0 (API Client)',
            // 簡單的HTTP客戶端
            'curl/7.68.0',
            // 日本常用的移動端
            'DoCoMo/2.0 P505i (c100;TB;W20;H20)',
            // Webkit 移動端
            'Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36'
        ];
    }

    // 高級HTTP請求，支持不同的User-Agent和Header組合
    makeAdvancedRequest(url, options = {}) {
        return new Promise((resolve, reject) => {
            const userAgent = options.userAgent || this.getUserAgents()[0];
            
            const req = https.request(url, {
                method: options.method || 'GET',
                headers: {
                    'User-Agent': userAgent,
                    'Accept': options.accept || 'application/json, text/html, */*',
                    'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache',
                    'Referer': this.blogUrl,
                    'X-Requested-With': 'XMLHttpRequest',
                    'Origin': this.baseUrl,
                    ...options.headers
                },
                timeout: 20000
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
                        contentType: res.headers['content-type'] || '',
                        userAgent: userAgent
                    });
                });
                stream.on('error', reject);
            });
            
            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });
            
            if (options.postData) {
                req.write(options.postData);
            }
            
            req.end();
        });
    }

    // 深度分析響應內容
    deepAnalyzeResponse(response, url) {
        const analysis = {
            url: url,
            userAgent: response.userAgent,
            statusCode: response.statusCode,
            contentType: response.contentType,
            contentLength: response.data.length,
            confidence: 0,
            findings: [],
            articleData: null,
            isJson: false,
            hasArticleContent: false,
            isDifferentFromMainPage: false
        };

        try {
            // 基本狀態檢查
            if (response.statusCode === 200) {
                analysis.confidence += 20;
                analysis.findings.push('HTTP 200 成功響應');
            } else {
                analysis.findings.push(`HTTP ${response.statusCode}`);
                return analysis;
            }

            // 檢查內容類型
            if (response.contentType.includes('application/json')) {
                analysis.isJson = true;
                analysis.confidence += 40;
                analysis.findings.push('Content-Type: application/json');

                // 嘗試解析JSON
                try {
                    const jsonData = JSON.parse(response.data);
                    analysis.confidence += 20;
                    analysis.findings.push('有效的JSON數據');
                    
                    const articleCheck = this.extractArticlesFromJSON(jsonData);
                    if (articleCheck.found) {
                        analysis.hasArticleContent = true;
                        analysis.articleData = articleCheck;
                        analysis.confidence += 50;
                        analysis.findings.push(`發現 ${articleCheck.articles.length} 篇文章`);
                    }
                } catch (e) {
                    analysis.findings.push('JSON解析失敗');
                    analysis.confidence -= 10;
                }
            } else if (response.contentType.includes('text/html')) {
                analysis.findings.push('Content-Type: text/html');
                
                // 檢查是否與主頁面不同
                const contentHash = this.hashContent(response.data);
                if (this.mainPageHash && contentHash !== this.mainPageHash) {
                    analysis.isDifferentFromMainPage = true;
                    analysis.confidence += 20;
                    analysis.findings.push('內容與主頁面不同');
                }

                // HTML文章檢測
                const htmlCheck = this.extractArticlesFromHTML(response.data);
                if (htmlCheck.found) {
                    analysis.hasArticleContent = true;
                    analysis.articleData = htmlCheck;
                    analysis.confidence += 30;
                    analysis.findings.push(`HTML中發現 ${htmlCheck.articles.length} 篇文章線索`);
                }
            } else if (response.contentType.includes('application/xml') || 
                      response.contentType.includes('text/xml')) {
                analysis.findings.push('Content-Type: XML');
                analysis.confidence += 30;
                
                // XML/RSS檢測
                if (response.data.includes('<item>') || response.data.includes('<entry>')) {
                    analysis.hasArticleContent = true;
                    analysis.confidence += 40;
                    analysis.findings.push('XML/RSS feed 格式');
                }
            }

            // 內容長度分析
            if (response.data.length > 50000) {
                analysis.confidence += 15;
                analysis.findings.push('內容豐富（大於50KB）');
            } else if (response.data.length > 10000) {
                analysis.confidence += 10;
                analysis.findings.push('內容中等（大於10KB）');
            }

            // 檢查特殊模式
            const patterns = this.checkSpecialPatterns(response.data);
            if (patterns.length > 0) {
                analysis.confidence += patterns.length * 5;
                analysis.findings.push(...patterns);
            }

        } catch (error) {
            analysis.findings.push(`分析錯誤: ${error.message}`);
        }

        return analysis;
    }

    // 從JSON中提取文章
    extractArticlesFromJSON(data) {
        const result = { found: false, articles: [] };
        
        try {
            // 遍歷所有可能的文章容器
            const containers = [
                data,
                data.articles, data.entries, data.posts, data.diary, data.blog,
                data.data, data.items, data.content, data.results
            ].filter(Boolean);

            for (const container of containers) {
                const articles = Array.isArray(container) ? container : [container];
                
                for (const item of articles) {
                    if (item && typeof item === 'object') {
                        const article = {
                            id: item.id || item.articleId || item.entryId,
                            title: item.title || item.subject || item.headline,
                            content: item.content || item.body || item.text,
                            date: item.date || item.created || item.published,
                            url: item.url || item.link || item.permalink
                        };
                        
                        // 至少要有標題或內容才算有效文章
                        if (article.title || article.content) {
                            result.articles.push(article);
                            result.found = true;
                        }
                    }
                }
            }
        } catch (error) {
            console.error('JSON文章提取失敗:', error);
        }

        return result;
    }

    // 從HTML中提取文章
    extractArticlesFromHTML(html) {
        const result = { found: false, articles: [] };
        
        try {
            // 尋找可能的文章標題
            const titleMatches = [
                ...html.matchAll(/<h[1-4][^>]*>([^<]{5,100})<\/h[1-4]>/gi),
                ...html.matchAll(/<[^>]*class="[^"]*title[^"]*"[^>]*>([^<]{5,100})<\/[^>]*>/gi),
                ...html.matchAll(/<[^>]*class="[^"]*subject[^"]*"[^>]*>([^<]{5,100})<\/[^>]*>/gi)
            ];

            // 尋找日期
            const dateMatches = [
                ...html.matchAll(/(\d{4})[年\/\-](\d{1,2})[月\/\-](\d{1,2})[日]?/g),
                ...html.matchAll(/(\d{1,2})\/(\d{1,2})\/(\d{4})/g)
            ];

            // 如果找到標題和日期，構建文章對象
            if (titleMatches.length > 0) {
                titleMatches.forEach((match, index) => {
                    const title = match[1].trim();
                    // 過濾導航等元素
                    if (!title.includes('ログイン') && !title.includes('TOP') && 
                        !title.includes('MENU') && title.length > 3) {
                        
                        result.articles.push({
                            id: index + 1,
                            title: title,
                            date: dateMatches[index] ? dateMatches[index][0] : null,
                            content: null,
                            url: null
                        });
                        result.found = true;
                    }
                });
            }
        } catch (error) {
            console.error('HTML文章提取失敗:', error);
        }

        return result;
    }

    // 檢查特殊模式
    checkSpecialPatterns(content) {
        const patterns = [];
        
        // JSON相關模式
        if (content.includes('"id":') && content.includes('"title":')) {
            patterns.push('包含JSON文章結構');
        }
        
        // 日文博客相關詞彙
        const japaneseTerms = ['日記', 'ブログ', '記事', '投稿', 'エントリー'];
        const foundTerms = japaneseTerms.filter(term => content.includes(term));
        if (foundTerms.length > 0) {
            patterns.push(`包含日文博客詞彙: ${foundTerms.join(', ')}`);
        }
        
        // API響應模式
        if (content.includes('callback(') || content.includes('jsonp')) {
            patterns.push('JSONP回調格式');
        }
        
        // RSS/XML模式
        if (content.includes('<rss') || content.includes('<feed')) {
            patterns.push('RSS/Atom Feed格式');
        }
        
        return patterns;
    }

    // 內容哈希（簡單實現）
    hashContent(content) {
        let hash = 0;
        for (let i = 0; i < content.length; i++) {
            const char = content.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // 轉換為32位整數
        }
        return hash.toString();
    }

    // 執行目標探測
    async executeTargetedDetection() {
        console.log('🎯 [目標探測] 開始針對Family Club的深度探測...');
        
        // 先獲取主頁面作為基準
        try {
            const mainPageResponse = await this.makeAdvancedRequest(this.blogUrl);
            this.mainPageHash = this.hashContent(mainPageResponse.data);
            console.log('📄 [目標探測] 主頁面基準已建立');
        } catch (e) {
            console.warn('⚠️ [目標探測] 無法獲取主頁面基準');
        }

        const endpoints = this.generateTargetedEndpoints();
        const userAgents = this.getUserAgents();
        const results = [];
        let bestResult = null;
        let bestScore = 0;

        console.log(`🔍 [目標探測] 將測試 ${endpoints.length} 個端點，${userAgents.length} 個User-Agent...`);

        for (let i = 0; i < endpoints.length; i++) {
            const endpoint = endpoints[i];
            
            // 對每個端點嘗試不同的User-Agent
            for (let j = 0; j < userAgents.length; j++) {
                const userAgent = userAgents[j];
                
                try {
                    console.log(`🔍 [${i+1}/${endpoints.length}] [UA${j+1}] ${endpoint}`);
                    
                    // 嘗試不同的請求配置
                    const requestConfigs = [
                        { userAgent: userAgent, accept: 'application/json' },
                        { userAgent: userAgent, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
                        { userAgent: userAgent, accept: '*/*', headers: { 'X-Requested-With': 'XMLHttpRequest' } }
                    ];

                    for (const config of requestConfigs) {
                        try {
                            const response = await this.makeAdvancedRequest(endpoint, config);
                            const analysis = this.deepAnalyzeResponse(response, endpoint);
                            
                            analysis.requestConfig = config;
                            results.push(analysis);
                            
                            if (analysis.confidence > bestScore) {
                                bestScore = analysis.confidence;
                                bestResult = analysis;
                                console.log(`🎉 [目標探測] 新的最佳候選! 信心度: ${bestScore}%`);
                                console.log(`    URL: ${endpoint}`);
                                console.log(`    發現: ${analysis.findings.join(', ')}`);
                            }
                            
                            // 如果找到高信心度的結果，可以提前結束部分探測
                            if (analysis.confidence > 80) {
                                console.log(`✅ [目標探測] 找到高質量端點，減少後續測試`);
                                break;
                            }
                            
                        } catch (error) {
                            // 單個配置失敗不影響其他配置
                        }
                        
                        // 小延遲避免過於頻繁的請求
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                    
                } catch (error) {
                    console.log(`❌ [${i+1}/${endpoints.length}] 失敗: ${error.message}`);
                }
                
                // User-Agent之間的延遲
                await new Promise(resolve => setTimeout(resolve, 200));
            }
            
            // 端點之間的延遲
            await new Promise(resolve => setTimeout(resolve, 300));
        }

        // 按信心度排序結果
        const sortedResults = results
            .filter(r => r.confidence > 0)
            .sort((a, b) => b.confidence - a.confidence);

        console.log('🎯 [目標探測] 深度探測完成');
        
        return {
            bestResult,
            topResults: sortedResults.slice(0, 10),
            summary: {
                totalTests: results.length,
                successfulTests: results.filter(r => r.statusCode === 200).length,
                bestScore,
                articlesFound: sortedResults.filter(r => r.hasArticleContent).length
            }
        };
    }
}

module.exports = TargetedFamilyClubDetector;