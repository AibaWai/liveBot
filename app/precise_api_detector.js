const https = require('https');

class PreciseAPIDetector {
    constructor() {
        this.blogUrl = 'https://web.familyclub.jp/s/jwb/diary/F2017?ima=3047';
        this.baseUrl = 'https://web.familyclub.jp';
        this.artistId = 'F2017';
        this.ima = '3047'; // 從原URL提取的ima參數
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
                    'Referer': this.blogUrl,
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
                        contentType: res.headers['content-type'] || '',
                        url: url
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

    // 生成更精準的API端點（基於觀察到的模式）
    generatePreciseEndpoints() {
        const endpoints = [
            // 基於發現的模式 - 包含ima參數
            `${this.baseUrl}/s/jwb/diary/${this.artistId}/data?ima=${this.ima}`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}/list?ima=${this.ima}`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}/entries?ima=${this.ima}`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}/articles?ima=${this.ima}`,
            
            // AJAX 可能的端點
            `${this.baseUrl}/ajax/jwb/diary/${this.artistId}?ima=${this.ima}`,
            `${this.baseUrl}/ajax/jwb/diary/${this.artistId}/list?ima=${this.ima}`,
            `${this.baseUrl}/ajax/diary/${this.artistId}?ima=${this.ima}`,
            `${this.baseUrl}/ajax/blog/${this.artistId}?ima=${this.ima}`,
            
            // API 路徑變體
            `${this.baseUrl}/api/jwb/diary/${this.artistId}?ima=${this.ima}`,
            `${this.baseUrl}/api/diary/${this.artistId}?ima=${this.ima}`,
            `${this.baseUrl}/api/blog/${this.artistId}?ima=${this.ima}`,
            `${this.baseUrl}/api/v1/diary/${this.artistId}?ima=${this.ima}`,
            
            // 現代Web API模式
            `${this.baseUrl}/api/v1/jwb/diary/${this.artistId}?ima=${this.ima}`,
            `${this.baseUrl}/api/v2/jwb/diary/${this.artistId}?ima=${this.ima}`,
            `${this.baseUrl}/rest/jwb/diary/${this.artistId}?ima=${this.ima}`,
            
            // JSON 格式變體
            `${this.baseUrl}/s/jwb/diary/${this.artistId}.json?ima=${this.ima}`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}/data.json?ima=${this.ima}`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}/list.json?ima=${this.ima}`,
            
            // GraphQL 可能端點
            `${this.baseUrl}/graphql?query=diary&artist=${this.artistId}&ima=${this.ima}`,
            
            // 分頁相關
            `${this.baseUrl}/s/jwb/diary/${this.artistId}/page/1?ima=${this.ima}`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?page=1&ima=${this.ima}`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?limit=20&ima=${this.ima}`,
            
            // 不同的格式參數組合
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?ima=${this.ima}&format=json`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?ima=${this.ima}&output=json`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?ima=${this.ima}&type=api`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?ima=${this.ima}&ajax=1`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?ima=${this.ima}&mode=json`,
            
            // Mobile API 可能端點
            `${this.baseUrl}/m/api/jwb/diary/${this.artistId}?ima=${this.ima}`,
            `${this.baseUrl}/mobile/api/diary/${this.artistId}?ima=${this.ima}`,
            
            // WebSocket 或 SSE 相關
            `${this.baseUrl}/ws/jwb/diary/${this.artistId}?ima=${this.ima}`,
            `${this.baseUrl}/sse/jwb/diary/${this.artistId}?ima=${this.ima}`,
            
            // 可能的內部API路徑
            `${this.baseUrl}/internal/jwb/diary/${this.artistId}?ima=${this.ima}`,
            `${this.baseUrl}/admin/api/diary/${this.artistId}?ima=${this.ima}`,
            
            // Feed 格式
            `${this.baseUrl}/feed/jwb/diary/${this.artistId}?ima=${this.ima}`,
            `${this.baseUrl}/rss/jwb/diary/${this.artistId}?ima=${this.ima}`,
            `${this.baseUrl}/atom/jwb/diary/${this.artistId}?ima=${this.ima}`,
            
            // 嘗試不同的HTTP方法可能觸發的端點
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?ima=${this.ima}&method=GET`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?ima=${this.ima}&action=list`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?ima=${this.ima}&cmd=getEntries`,
            
            // 可能的CMS API模式
            `${this.baseUrl}/cms/api/diary/${this.artistId}?ima=${this.ima}`,
            `${this.baseUrl}/content/api/diary/${this.artistId}?ima=${this.ima}`,
            
            // 嘗試不同的端點結構
            `${this.baseUrl}/jwb/api/diary/${this.artistId}?ima=${this.ima}`,
            `${this.baseUrl}/diary/api/${this.artistId}?ima=${this.ima}`,
            
            // 可能的負載均衡或CDN端點
            `${this.baseUrl}/api1/jwb/diary/${this.artistId}?ima=${this.ima}`,
            `${this.baseUrl}/api2/jwb/diary/${this.artistId}?ima=${this.ima}`,
            
            // 嘗試省略部分路徑
            `${this.baseUrl}/jwb/diary/${this.artistId}?ima=${this.ima}&format=json`,
            `${this.baseUrl}/diary/${this.artistId}?ima=${this.ima}&format=json`,
            `${this.baseUrl}/${this.artistId}/diary?ima=${this.ima}&format=json`
        ];
        
        return endpoints;
    }

    // 檢查響應是否包含有效的文章數據
    analyzeResponse(response) {
        const analysis = {
            url: response.url,
            statusCode: response.statusCode,
            contentType: response.contentType,
            contentLength: response.data.length,
            isJson: false,
            jsonValid: false,
            hasArticleStructure: false,
            articleCount: 0,
            confidence: 0,
            sample: response.data.substring(0, 300),
            issues: []
        };

        // 檢查是否是JSON
        if (response.contentType.includes('application/json')) {
            analysis.isJson = true;
            analysis.confidence += 30;
        }

        // 嘗試解析JSON
        try {
            const jsonData = JSON.parse(response.data);
            analysis.jsonValid = true;
            analysis.confidence += 40;
            
            // 分析JSON結構
            const articleIndicators = this.findArticleIndicators(jsonData);
            analysis.hasArticleStructure = articleIndicators.found;
            analysis.articleCount = articleIndicators.count;
            analysis.confidence += articleIndicators.confidence;
            
            if (articleIndicators.found) {
                analysis.sampleArticles = articleIndicators.samples;
            }
            
        } catch (e) {
            // 不是有效JSON，檢查HTML中的文章跡象
            const htmlAnalysis = this.analyzeHTMLContent(response.data);
            analysis.hasArticleStructure = htmlAnalysis.hasArticles;
            analysis.articleCount = htmlAnalysis.count;
            analysis.confidence += htmlAnalysis.confidence;
            
            if (!htmlAnalysis.hasArticles) {
                analysis.issues.push('無法解析為JSON且HTML中未發現文章結構');
            }
        }

        // 檢查狀態碼
        if (response.statusCode === 200) {
            analysis.confidence += 20;
        } else if (response.statusCode === 404) {
            analysis.confidence = 0;
            analysis.issues.push('端點不存在 (404)');
        } else if (response.statusCode >= 400) {
            analysis.confidence = 0;
            analysis.issues.push(`HTTP錯誤: ${response.statusCode}`);
        }

        // 檢查內容長度
        if (response.data.length < 100) {
            analysis.confidence -= 20;
            analysis.issues.push('內容太短，可能是錯誤響應');
        }

        return analysis;
    }

    // 在JSON中尋找文章指標
    findArticleIndicators(data) {
        const result = {
            found: false,
            count: 0,
            confidence: 0,
            samples: []
        };

        try {
            // 檢查不同的JSON結構
            let articles = [];
            
            if (Array.isArray(data)) {
                articles = data;
            } else if (data.articles && Array.isArray(data.articles)) {
                articles = data.articles;
            } else if (data.entries && Array.isArray(data.entries)) {
                articles = data.entries;
            } else if (data.posts && Array.isArray(data.posts)) {
                articles = data.posts;
            } else if (data.data && Array.isArray(data.data)) {
                articles = data.data;
            } else if (data.items && Array.isArray(data.items)) {
                articles = data.items;
            } else if (data.diary && Array.isArray(data.diary)) {
                articles = data.diary;
            } else if (data.blog && Array.isArray(data.blog)) {
                articles = data.blog;
            }

            if (articles.length > 0) {
                result.found = true;
                result.count = articles.length;
                result.confidence = Math.min(50, articles.length * 5);
                
                // 分析文章結構
                articles.slice(0, 3).forEach(article => {
                    if (typeof article === 'object' && article !== null) {
                        const sample = {
                            hasId: !!(article.id || article.articleId || article.diary_id),
                            hasTitle: !!(article.title || article.subject || article.headline),
                            hasDate: !!(article.date || article.created || article.published || article.createdAt),
                            hasContent: !!(article.content || article.body || article.text),
                            hasUrl: !!(article.url || article.link || article.permalink)
                        };
                        
                        const validFields = Object.values(sample).filter(Boolean).length;
                        if (validFields >= 2) {
                            result.confidence += 10;
                            result.samples.push({
                                preview: JSON.stringify(article).substring(0, 200),
                                validFields: validFields,
                                sample: sample
                            });
                        }
                    }
                });
            }

            // 檢查是否有文章相關的關鍵字
            const jsonStr = JSON.stringify(data).toLowerCase();
            const keywords = ['diary', 'blog', 'article', 'entry', 'post', 'title', 'content', 'date', 'published'];
            const foundKeywords = keywords.filter(keyword => jsonStr.includes(keyword));
            
            if (foundKeywords.length > 0) {
                result.confidence += foundKeywords.length * 2;
                if (!result.found && foundKeywords.length >= 3) {
                    result.found = true;
                    result.count = 1; // 至少有文章相關結構
                }
            }

        } catch (error) {
            console.error('分析JSON結構失敗:', error);
        }

        return result;
    }

    // 分析HTML內容
    analyzeHTMLContent(html) {
        const result = {
            hasArticles: false,
            count: 0,
            confidence: 0
        };

        try {
            // 檢查是否包含常見的文章元素
            const articleIndicators = [
                /<article[^>]*>/gi,
                /<div[^>]*class="[^"]*entry[^"]*"/gi,
                /<div[^>]*class="[^"]*diary[^"]*"/gi,
                /<div[^>]*class="[^"]*post[^"]*"/gi,
                /<h[1-6][^>]*>[^<]+<\/h[1-6]>/gi,
                /<time[^>]*>/gi,
                /\d{4}[年]\d{1,2}[月]\d{1,2}[日]/g
            ];

            let totalMatches = 0;
            articleIndicators.forEach(pattern => {
                const matches = html.match(pattern) || [];
                totalMatches += matches.length;
            });

            if (totalMatches > 0) {
                result.hasArticles = true;
                result.count = Math.max(1, Math.floor(totalMatches / 3)); // 估算文章數
                result.confidence = Math.min(30, totalMatches * 2);
            }

            // 檢查特定的文章內容關鍵字
            const contentKeywords = ['title', 'diary', 'blog', 'entry', '記事', '日記', 'ブログ'];
            const keywordMatches = contentKeywords.filter(keyword => 
                html.toLowerCase().includes(keyword)
            ).length;
            
            result.confidence += keywordMatches * 2;

        } catch (error) {
            console.error('分析HTML內容失敗:', error);
        }

        return result;
    }

    // 執行精準探測
    async executePreciseDetection() {
        console.log('🎯 [精準探測] 開始基於模式的精準API探測...');
        console.log(`🎯 [精準探測] 目標藝人: ${this.artistId}, IMA參數: ${this.ima}`);
        
        const endpoints = this.generatePreciseEndpoints();
        const results = [];
        let bestCandidate = null;
        let bestScore = 0;

        console.log(`🎯 [精準探測] 將測試 ${endpoints.length} 個精準端點...`);

        for (let i = 0; i < endpoints.length; i++) {
            const endpoint = endpoints[i];
            
            try {
                console.log(`🔍 [${i+1}/${endpoints.length}] 測試: ${endpoint}`);
                
                const response = await this.makeRequest(endpoint);
                const analysis = this.analyzeResponse(response);
                
                results.push(analysis);
                
                // 評估是否是最佳候選
                if (analysis.confidence > bestScore) {
                    bestScore = analysis.confidence;
                    bestCandidate = analysis;
                }
                
                // 如果找到高信心度的端點，提前報告
                if (analysis.confidence > 70) {
                    console.log(`🎉 [精準探測] 發現高質量端點: ${endpoint}`);
                    console.log(`   信心度: ${analysis.confidence}%, 文章數: ${analysis.articleCount}`);
                }
                
            } catch (error) {
                console.log(`❌ [${i+1}/${endpoints.length}] 失敗: ${endpoint} - ${error.message}`);
                results.push({
                    url: endpoint,
                    error: error.message,
                    confidence: 0
                });
            }
            
            // 添加延遲
            await new Promise(resolve => setTimeout(resolve, 300));
        }

        // 按信心度排序結果
        const sortedResults = results
            .filter(r => !r.error && r.confidence > 0)
            .sort((a, b) => b.confidence - a.confidence);

        console.log('🎯 [精準探測] 探測完成');
        console.log(`📊 [精準探測] 最佳候選端點信心度: ${bestScore}%`);

        return {
            bestCandidate: bestCandidate,
            allResults: sortedResults,
            summary: {
                totalTested: endpoints.length,
                successful: results.filter(r => !r.error).length,
                withArticles: results.filter(r => r.hasArticleStructure).length,
                validJson: results.filter(r => r.jsonValid).length,
                bestScore: bestScore
            }
        };
    }
}

// 使用示例
async function testPreciseDetection() {
    const detector = new PreciseAPIDetector();
    const results = await detector.executePreciseDetection();
    
    console.log('\n🎯 [測試結果] 精準探測結果:');
    console.log(`最佳候選: ${results.bestCandidate ? results.bestCandidate.url : '無'}`);
    console.log(`信心度: ${results.summary.bestScore}%`);
    console.log(`成功響應: ${results.summary.successful}/${results.summary.totalTested}`);
    console.log(`包含文章: ${results.summary.withArticles}`);
    console.log(`有效JSON: ${results.summary.validJson}`);
    
    if (results.allResults.length > 0) {
        console.log('\n📋 [測試結果] 前5個最佳端點:');
        results.allResults.slice(0, 5).forEach((result, index) => {
            console.log(`${index + 1}. ${result.url}`);
            console.log(`   信心度: ${result.confidence}%, 狀態: ${result.statusCode}, 文章數: ${result.articleCount}`);
            if (result.issues.length > 0) {
                console.log(`   問題: ${result.issues.join(', ')}`);
            }
        });
    }
    
    return results;
}

module.exports = { PreciseAPIDetector, testPreciseDetection };