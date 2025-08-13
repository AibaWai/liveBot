const https = require('https');

class EnhancedAPIBlogMonitor {
    constructor(notificationCallback = null) {
        this.notificationCallback = notificationCallback;
        this.isMonitoring = false;
        this.monitoringInterval = null;
        this.checkIntervalMinutes = 60;
        this.totalChecks = 0;
        this.articlesFound = 0;
        this.lastCheckTime = null;
        this.foundApiEndpoint = null;
        
        // 博客監控配置 - 從你的結果中提取的信息
        this.blogUrl = 'https://web.familyclub.jp/s/jwb/diary/F2017?ima=3047';
        this.artistId = 'F2017';
        this.baseUrl = 'https://web.familyclub.jp';
        this.ima = '3047'; // 關鍵參數
        
        // 記錄最新文章信息
        this.latestRecord = {
            articleId: null,
            datetime: null,
            datetimeString: null,
            title: null,
            url: null,
            lastUpdated: null
        };
        
        console.log('🎯 [Enhanced API] Family Club 增強API博客監控已初始化');
        console.log('🔗 [Enhanced API] 目標網址:', this.blogUrl);
        console.log('🎯 [Enhanced API] 藝人ID:', this.artistId, 'IMA:', this.ima);
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
                    'Referer': this.blogUrl,
                    'X-Requested-With': 'XMLHttpRequest', // 重要：模擬AJAX請求
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

    // 基於你的發現生成更聰明的端點
    generateSmartEndpoints() {
        const endpoints = [
            // 基於觀察：包含ima參數的端點似乎都返回內容
            // 嘗試添加不同的format參數
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?ima=${this.ima}&format=json`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?ima=${this.ima}&output=json`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?ima=${this.ima}&type=json`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?ima=${this.ima}&mode=api`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?ima=${this.ima}&ajax=1`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?ima=${this.ima}&json=1`,
            
            // 可能的AJAX載入端點
            `${this.baseUrl}/ajax/s/jwb/diary/${this.artistId}?ima=${this.ima}`,
            `${this.baseUrl}/load/s/jwb/diary/${this.artistId}?ima=${this.ima}`,
            `${this.baseUrl}/fetch/s/jwb/diary/${this.artistId}?ima=${this.ima}`,
            
            // 分頁相關（可能觸發不同的響應）
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?ima=${this.ima}&page=1`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?ima=${this.ima}&limit=10`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}?ima=${this.ima}&offset=0`,
            
            // 可能的API路徑（POST請求）
            `${this.baseUrl}/api/diary/list`,
            `${this.baseUrl}/api/jwb/diary/list`,
            `${this.baseUrl}/api/blog/entries`,
            
            // 嘗試不同的HTTP方法可能觸發的隱藏端點
            `${this.baseUrl}/s/jwb/diary/${this.artistId}/load?ima=${this.ima}`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}/fetch?ima=${this.ima}`,
            `${this.baseUrl}/s/jwb/diary/${this.artistId}/get?ima=${this.ima}`,
            
            // WebAPI 標準端點
            `${this.baseUrl}/api/v1/artists/${this.artistId}/diary?ima=${this.ima}`,
            `${this.baseUrl}/api/v2/artists/${this.artistId}/diary?ima=${this.ima}`,
            `${this.baseUrl}/rest/artists/${this.artistId}/diary?ima=${this.ima}`,
            
            // 可能的GraphQL端點
            `${this.baseUrl}/graphql`,
            
            // 移動端API（可能更直接）
            `${this.baseUrl}/m/api/diary/${this.artistId}?ima=${this.ima}`,
            `${this.baseUrl}/mobile/api/diary/${this.artistId}?ima=${this.ima}`,
            
            // 嘗試不同的路徑組合
            `${this.baseUrl}/jwb/api/diary/${this.artistId}?ima=${this.ima}`,
            `${this.baseUrl}/diary/api/${this.artistId}?ima=${this.ima}`,
            
            // 內容載入端點
            `${this.baseUrl}/content/jwb/diary/${this.artistId}?ima=${this.ima}`,
            `${this.baseUrl}/data/jwb/diary/${this.artistId}?ima=${this.ima}`,
            
            // SSR/CSR 相關端點
            `${this.baseUrl}/ssr/jwb/diary/${this.artistId}?ima=${this.ima}`,
            `${this.baseUrl}/csr/jwb/diary/${this.artistId}?ima=${this.ima}`
        ];
        
        return endpoints;
    }

    // POST請求的特殊端點
    generatePOSTEndpoints() {
        return [
            { 
                url: `${this.baseUrl}/api/diary/list`,
                data: { artist_id: this.artistId, ima: this.ima }
            },
            { 
                url: `${this.baseUrl}/api/jwb/diary/list`,
                data: { artist_id: this.artistId, ima: this.ima }
            },
            { 
                url: `${this.baseUrl}/graphql`,
                data: { 
                    query: `query GetDiary($artistId: String!, $ima: String!) {
                        diary(artistId: $artistId, ima: $ima) {
                            id
                            title
                            content
                            date
                            url
                        }
                    }`,
                    variables: { artistId: this.artistId, ima: this.ima }
                }
            }
        ];
    }

    // 增強的網絡探測，包含POST請求
    async enhancedAPIDetection() {
        console.log('🎯 [增強探測] 開始增強API探測（包含POST請求）...');
        
        const getEndpoints = this.generateSmartEndpoints();
        const postEndpoints = this.generatePOSTEndpoints();
        const results = [];
        let bestCandidate = null;
        let bestScore = 0;

        // 測試GET端點
        console.log(`🔍 [增強探測] 測試 ${getEndpoints.length} 個GET端點...`);
        
        for (let i = 0; i < getEndpoints.length; i++) {
            const endpoint = getEndpoints[i];
            
            try {
                console.log(`🔍 [${i+1}/${getEndpoints.length}] GET: ${endpoint}`);
                
                const response = await this.makeRequest(endpoint);
                const analysis = this.analyzeResponseAdvanced(response, endpoint);
                
                results.push(analysis);
                
                if (analysis.confidence > bestScore) {
                    bestScore = analysis.confidence;
                    bestCandidate = analysis;
                }
                
                // 如果找到高質量端點，記錄並可能提前結束
                if (analysis.confidence > 80) {
                    console.log(`🎉 [增強探測] 發現高質量GET端點: ${endpoint}`);
                    this.foundApiEndpoint = endpoint;
                    break;
                }
                
            } catch (error) {
                console.log(`❌ [${i+1}/${getEndpoints.length}] GET失敗: ${endpoint} - ${error.message}`);
            }
            
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        // 測試POST端點
        console.log(`🔍 [增強探測] 測試 ${postEndpoints.length} 個POST端點...`);
        
        for (let i = 0; i < postEndpoints.length; i++) {
            const endpoint = postEndpoints[i];
            
            try {
                console.log(`🔍 [${i+1}/${postEndpoints.length}] POST: ${endpoint.url}`);
                
                const response = await this.makeRequest(endpoint.url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
                
                const analysis = this.analyzeResponseAdvanced(response, endpoint.url);
                analysis.method = 'POST';
                analysis.postData = endpoint.data;
                
                results.push(analysis);
                
                if (analysis.confidence > bestScore) {
                    bestScore = analysis.confidence;
                    bestCandidate = analysis;
                }
                
                if (analysis.confidence > 80) {
                    console.log(`🎉 [增強探測] 發現高質量POST端點: ${endpoint.url}`);
                    this.foundApiEndpoint = endpoint.url;
                    break;
                }
                
            } catch (error) {
                console.log(`❌ [${i+1}/${postEndpoints.length}] POST失敗: ${endpoint.url} - ${error.message}`);
            }
            
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        console.log('🎯 [增強探測] 增強API探測完成');
        return {
            bestCandidate,
            allResults: results.filter(r => r.confidence > 0).sort((a, b) => b.confidence - a.confidence),
            summary: {
                totalTested: getEndpoints.length + postEndpoints.length,
                bestScore,
                foundEndpoint: this.foundApiEndpoint
            }
        };
    }

    // 高級響應分析
    analyzeResponseAdvanced(response, url) {
        const analysis = {
            url: url,
            statusCode: response.statusCode,
            contentType: response.contentType,
            contentLength: response.data.length,
            confidence: 0,
            isJson: false,
            hasRealArticles: false,
            articleCount: 0,
            issues: []
        };

        // 基本狀態檢查
        if (response.statusCode !== 200) {
            analysis.issues.push(`HTTP ${response.statusCode}`);
            return analysis;
        }

        analysis.confidence += 20; // 基本分數

        // JSON檢查
        if (response.contentType.includes('application/json')) {
            analysis.isJson = true;
            analysis.confidence += 30;
            
            try {
                const jsonData = JSON.parse(response.data);
                analysis.confidence += 20;
                
                // 尋找真實文章結構
                const articleAnalysis = this.findRealArticles(jsonData);
                if (articleAnalysis.found) {
                    analysis.hasRealArticles = true;
                    analysis.articleCount = articleAnalysis.count;
                    analysis.confidence += 50;
                    analysis.sampleArticles = articleAnalysis.samples;
                }
                
            } catch (e) {
                analysis.issues.push('JSON解析失敗');
                analysis.confidence -= 10;
            }
        } else {
            // HTML分析 - 尋找真實的文章內容
            const htmlAnalysis = this.analyzeHTMLForRealArticles(response.data);
            if (htmlAnalysis.hasRealArticles) {
                analysis.hasRealArticles = true;
                analysis.articleCount = htmlAnalysis.count;
                analysis.confidence += 30;
                analysis.sampleArticles = htmlAnalysis.samples;
            }
        }

        // 內容長度評估
        if (response.data.length > 10000) {
            analysis.confidence += 10;
        } else if (response.data.length < 1000) {
            analysis.confidence -= 10;
            analysis.issues.push('內容太短');
        }

        return analysis;
    }

    // 尋找真實文章（而非頁面元素）
    findRealArticles(data) {
        const result = { found: false, count: 0, samples: [] };
        
        try {
            let articles = [];
            
            // 檢查各種可能的文章容器
            if (Array.isArray(data)) {
                articles = data;
            } else if (data.articles) {
                articles = Array.isArray(data.articles) ? data.articles : [data.articles];
            } else if (data.entries) {
                articles = Array.isArray(data.entries) ? data.entries : [data.entries];
            } else if (data.diary) {
                articles = Array.isArray(data.diary) ? data.diary : [data.diary];
            } else if (data.posts) {
                articles = Array.isArray(data.posts) ? data.posts : [data.posts];
            } else if (data.data) {
                articles = Array.isArray(data.data) ? data.data : [data.data];
            }

            // 分析每個潛在文章
            const validArticles = articles.filter(item => {
                if (!item || typeof item !== 'object') return false;
                
                // 檢查是否有文章的基本特徵
                const hasId = !!(item.id || item.articleId || item.diary_id);
                const hasTitle = !!(item.title || item.subject);
                const hasDate = !!(item.date || item.created || item.published);
                const hasContent = !!(item.content || item.body || item.text);
                
                // 至少要有2個基本特徵才算是真實文章
                return [hasId, hasTitle, hasDate, hasContent].filter(Boolean).length >= 2;
            });

            if (validArticles.length > 0) {
                result.found = true;
                result.count = validArticles.length;
                result.samples = validArticles.slice(0, 3).map(article => ({
                    id: article.id || article.articleId || 'N/A',
                    title: (article.title || article.subject || '').substring(0, 50),
                    date: article.date || article.created || article.published || 'N/A'
                }));
            }

        } catch (error) {
            console.error('分析JSON文章失敗:', error);
        }

        return result;
    }

    // 分析HTML中的真實文章
    analyzeHTMLForRealArticles(html) {
        const result = { hasRealArticles: false, count: 0, samples: [] };
        
        try {
            // 尋找文章標題模式（避免導航等元素）
            const titlePatterns = [
                /<h[1-3][^>]*>([^<]{10,100})<\/h[1-3]>/gi,
                /<div[^>]*class="[^"]*title[^"]*"[^>]*>([^<]{10,100})<\/div>/gi,
                /<span[^>]*class="[^"]*subject[^"]*"[^>]*>([^<]{10,100})<\/span>/gi
            ];

            const titles = [];
            titlePatterns.forEach(pattern => {
                let match;
                while ((match = pattern.exec(html)) !== null) {
                    const title = match[1].trim();
                    // 過濾掉導航、按鈕等元素
                    if (title.length > 5 && 
                        !title.includes('ログイン') && 
                        !title.includes('登録') &&
                        !title.includes('TOP') &&
                        !title.includes('ARTISTS')) {
                        titles.push(title);
                    }
                }
            });

            // 尋找日期模式
            const dateMatches = html.match(/\d{4}[年月日\/\-\.]\d{1,2}[年月日\/\-\.]\d{1,2}/g) || [];
            
            // 如果找到多個標題和日期，可能是文章列表
            if (titles.length > 0 && dateMatches.length > 0) {
                result.hasRealArticles = true;
                result.count = Math.min(titles.length, dateMatches.length);
                result.samples = titles.slice(0, 3).map((title, index) => ({
                    title: title.substring(0, 50),
                    date: dateMatches[index] || 'N/A'
                }));
            }

        } catch (error) {
            console.error('分析HTML文章失敗:', error);
        }

        return result;
    }

    // 其他必要的方法保持不變...
    async initialize() {
        try {
            console.log('🎯 [Enhanced API] 正在初始化增強API博客監控...');
            
            const detectionResults = await this.enhancedAPIDetection();
            
            // 如果找到了好的API端點，使用它
            if (this.foundApiEndpoint) {
                console.log(`✅ [Enhanced API] 使用發現的API端點: ${this.foundApiEndpoint}`);
                // 實現使用API端點獲取文章的邏輯
            } else {
                console.log('⚠️ [Enhanced API] 未找到理想的API端點，使用最佳回退方案');
                // 實現回退邏輯
            }
            
            return true;
            
        } catch (error) {
            console.error('❌ [Enhanced API] 初始化失敗:', error.message);
            return false;
        }
    }

    // 簡化其他方法的實現...
    async checkForNewArticles(testMode = false) {
        // 實現檢查邏輯
        return null;
    }

    getStatus() {
        return {
            isMonitoring: this.isMonitoring,
            foundApiEndpoint: this.foundApiEndpoint,
            method: 'Enhanced API Detection'
        };
    }

    startMonitoring() {
        // 實現監控邏輯
    }

    stopMonitoring() {
        // 實現停止邏輯
    }
}

module.exports = EnhancedAPIBlogMonitor;