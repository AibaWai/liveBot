const https = require('https');

class JavaScriptAnalyzer {
    constructor() {
        this.blogUrl = 'https://web.familyclub.jp/s/jwb/diary/F2017?ima=3047';
        this.baseUrl = 'https://web.familyclub.jp';
        this.artistId = 'F2017';
        this.ima = '3047';
    }

    makeRequest(url, options = {}) {
        return new Promise((resolve, reject) => {
            const req = https.request(url, {
                method: options.method || 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'application/json, text/html, */*',
                    'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
                    'Accept-Encoding': 'gzip, deflate, br',
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

    // 分析HTML中的JavaScript，尋找Ajax調用
    async analyzeJavaScriptInHTML() {
        try {
            console.log('🔍 [JS分析] 分析HTML中的JavaScript代碼...');
            
            const response = await this.makeRequest(this.blogUrl);
            if (response.statusCode !== 200) {
                throw new Error(`HTTP錯誤: ${response.statusCode}`);
            }
            
            const html = response.data;
            console.log(`📊 [JS分析] HTML長度: ${html.length}`);
            
            // 提取所有JavaScript代碼
            const scripts = this.extractJavaScript(html);
            console.log(`📄 [JS分析] 找到 ${scripts.length} 個JavaScript代碼段`);
            
            // 分析Ajax調用
            const ajaxCalls = this.findAjaxCalls(scripts);
            console.log(`🔍 [JS分析] 發現 ${ajaxCalls.length} 個Ajax調用`);
            
            // 分析API端點
            const apiEndpoints = this.findAPIEndpoints(scripts);
            console.log(`🎯 [JS分析] 發現 ${apiEndpoints.length} 個API端點`);
            
            // 尋找文章加載邏輯
            const articleLoaders = this.findArticleLoaders(scripts);
            console.log(`📝 [JS分析] 發現 ${articleLoaders.length} 個文章加載器`);
            
            return {
                scripts: scripts.length,
                ajaxCalls,
                apiEndpoints,
                articleLoaders,
                possibleEndpoints: this.generatePossibleEndpoints(ajaxCalls, apiEndpoints)
            };
            
        } catch (error) {
            console.error('❌ [JS分析] JavaScript分析失敗:', error.message);
            throw error;
        }
    }

    // 提取JavaScript代碼
    extractJavaScript(html) {
        const scripts = [];
        
        // 內聯JavaScript
        const inlineMatches = html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi);
        for (const match of inlineMatches) {
            if (match[1].trim()) {
                scripts.push({
                    type: 'inline',
                    content: match[1].trim(),
                    src: null
                });
            }
        }
        
        // 外部JavaScript文件
        const externalMatches = html.matchAll(/<script[^>]*src="([^"]+)"[^>]*>/gi);
        for (const match of externalMatches) {
            scripts.push({
                type: 'external',
                content: null,
                src: match[1]
            });
        }
        
        return scripts;
    }

    // 尋找Ajax調用
    findAjaxCalls(scripts) {
        const ajaxCalls = [];
        
        const ajaxPatterns = [
            // jQuery Ajax
            /\$\.ajax\s*\(\s*{([^}]+)}/gi,
            /\$\.get\s*\(\s*['"`]([^'"`]+)['"`]/gi,
            /\$\.post\s*\(\s*['"`]([^'"`]+)['"`]/gi,
            /\$\.getJSON\s*\(\s*['"`]([^'"`]+)['"`]/gi,
            
            // 原生 XMLHttpRequest
            /xhr\.open\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*['"`]([^'"`]+)['"`]/gi,
            /new\s+XMLHttpRequest\s*\(\s*\)/gi,
            
            // Fetch API
            /fetch\s*\(\s*['"`]([^'"`]+)['"`]/gi,
            
            // Axios
            /axios\.\w+\s*\(\s*['"`]([^'"`]+)['"`]/gi,
        ];
        
        scripts.forEach((script, index) => {
            if (script.type === 'inline' && script.content) {
                ajaxPatterns.forEach(pattern => {
                    let match;
                    pattern.lastIndex = 0;
                    while ((match = pattern.exec(script.content)) !== null) {
                        ajaxCalls.push({
                            scriptIndex: index,
                            type: this.identifyAjaxType(match[0]),
                            url: match[1] || match[2] || 'unknown',
                            fullMatch: match[0],
                            context: this.getContext(script.content, match.index, 100)
                        });
                    }
                });
            }
        });
        
        return ajaxCalls;
    }

    // 識別Ajax類型
    identifyAjaxType(matchText) {
        if (matchText.includes('$.ajax')) return 'jQuery.ajax';
        if (matchText.includes('$.get')) return 'jQuery.get';
        if (matchText.includes('$.post')) return 'jQuery.post';
        if (matchText.includes('$.getJSON')) return 'jQuery.getJSON';
        if (matchText.includes('xhr.open')) return 'XMLHttpRequest';
        if (matchText.includes('fetch')) return 'fetch';
        if (matchText.includes('axios')) return 'axios';
        return 'unknown';
    }

    // 獲取上下文
    getContext(content, index, length) {
        const start = Math.max(0, index - length);
        const end = Math.min(content.length, index + length);
        return content.substring(start, end);
    }

    // 尋找API端點
    findAPIEndpoints(scripts) {
        const endpoints = [];
        
        const endpointPatterns = [
            // URL路徑模式
            /['"`]([^'"`]*\/api\/[^'"`]*)['"`]/gi,
            /['"`]([^'"`]*\/ajax\/[^'"`]*)['"`]/gi,
            /['"`]([^'"`]*\/json\/[^'"`]*)['"`]/gi,
            /['"`]([^'"`]*\/data\/[^'"`]*)['"`]/gi,
            /['"`]([^'"`]*\.json[^'"`]*)['"`]/gi,
            
            // 包含參數的URL
            /['"`]([^'"`]*\?[^'"`]*format=json[^'"`]*)['"`]/gi,
            /['"`]([^'"`]*\?[^'"`]*callback=[^'"`]*)['"`]/gi,
            /['"`]([^'"`]*\?[^'"`]*ima=[^'"`]*)['"`]/gi,
        ];
        
        scripts.forEach((script, index) => {
            if (script.type === 'inline' && script.content) {
                endpointPatterns.forEach(pattern => {
                    let match;
                    pattern.lastIndex = 0;
                    while ((match = pattern.exec(script.content)) !== null) {
                        const url = match[1];
                        if (url && url.length > 5 && !url.includes('{{')) {
                            endpoints.push({
                                scriptIndex: index,
                                url: url,
                                type: this.categorizeEndpoint(url),
                                context: this.getContext(script.content, match.index, 150)
                            });
                        }
                    }
                });
            }
        });
        
        return endpoints;
    }

    // 分類端點
    categorizeEndpoint(url) {
        if (url.includes('/api/')) return 'API';
        if (url.includes('/ajax/')) return 'AJAX';
        if (url.includes('/json/')) return 'JSON';
        if (url.includes('.json')) return 'JSON文件';
        if (url.includes('callback=')) return 'JSONP';
        if (url.includes('format=json')) return 'JSON格式';
        return 'unknown';
    }

    // 尋找文章加載器
    findArticleLoaders(scripts) {
        const loaders = [];
        
        const loaderPatterns = [
            // 文章相關的JavaScript函數
            /function\s+(\w*[Ll]oad\w*[Aa]rticle\w*|\w*[Bb]log\w*|\w*[Dd]iary\w*)\s*\(/gi,
            /(\w*[Aa]rticle\w*|\w*[Bb]log\w*|\w*[Dd]iary\w*)\s*[:=]\s*function/gi,
            
            // DOM操作相關
            /\$\(['"`][^'"`]*article[^'"`]*['"`]\)/gi,
            /\$\(['"`][^'"`]*diary[^'"`]*['"`]\)/gi,
            /\$\(['"`][^'"`]*blog[^'"`]*['"`]\)/gi,
            /\$\(['"`][^'"`]*entry[^'"`]*['"`]\)/gi,
            
            // 內容加載
            /\.load\s*\(\s*['"`]([^'"`]+)['"`]/gi,
            /\.html\s*\(\s*[\w\$]/gi,
        ];
        
        scripts.forEach((script, index) => {
            if (script.type === 'inline' && script.content) {
                loaderPatterns.forEach(pattern => {
                    let match;
                    pattern.lastIndex = 0;
                    while ((match = pattern.exec(script.content)) !== null) {
                        loaders.push({
                            scriptIndex: index,
                            type: 'articleLoader',
                            match: match[0],
                            url: match[1] || null,
                            context: this.getContext(script.content, match.index, 200)
                        });
                    }
                });
            }
        });
        
        return loaders;
    }

    // 基於發現的Ajax調用生成可能的端點
    generatePossibleEndpoints(ajaxCalls, apiEndpoints) {
        const possibleEndpoints = new Set();
        
        // 基於發現的端點生成變體
        [...ajaxCalls, ...apiEndpoints].forEach(item => {
            if (item.url && item.url !== 'unknown') {
                let baseUrl = item.url;
                
                // 如果是相對路徑，補全
                if (!baseUrl.startsWith('http')) {
                    baseUrl = this.baseUrl + (baseUrl.startsWith('/') ? '' : '/') + baseUrl;
                }
                
                possibleEndpoints.add(baseUrl);
                
                // 生成變體
                if (baseUrl.includes(this.artistId)) {
                    // JSON格式變體
                    possibleEndpoints.add(baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'format=json');
                    possibleEndpoints.add(baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'output=json');
                    possibleEndpoints.add(baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'callback=jsonp');
                    
                    // API路徑變體
                    possibleEndpoints.add(baseUrl.replace('/s/', '/api/'));
                    possibleEndpoints.add(baseUrl.replace('/s/', '/ajax/'));
                    possibleEndpoints.add(baseUrl.replace('/s/', '/json/'));
                }
            }
        });
        
        return Array.from(possibleEndpoints);
    }

    // 測試發現的端點
    async testDiscoveredEndpoints(endpoints) {
        console.log(`🔍 [端點測試] 開始測試 ${endpoints.length} 個發現的端點...`);
        
        const results = [];
        
        for (let i = 0; i < Math.min(endpoints.length, 10); i++) {
            const endpoint = endpoints[i];
            
            try {
                console.log(`🔍 [${i+1}/${Math.min(endpoints.length, 10)}] 測試: ${endpoint}`);
                
                const response = await this.makeRequest(endpoint);
                const analysis = {
                    url: endpoint,
                    statusCode: response.statusCode,
                    contentType: response.contentType,
                    contentLength: response.data.length,
                    isJson: false,
                    hasArticleData: false,
                    sample: response.data.substring(0, 200)
                };
                
                // 檢查是否是JSON
                if (response.contentType.includes('application/json')) {
                    analysis.isJson = true;
                    try {
                        const jsonData = JSON.parse(response.data);
                        analysis.hasArticleData = this.hasArticleStructure(jsonData);
                    } catch (e) {
                        // JSON解析失敗
                    }
                }
                
                results.push(analysis);
                
            } catch (error) {
                console.log(`❌ [${i+1}/${Math.min(endpoints.length, 10)}] 失敗: ${endpoint} - ${error.message}`);
                results.push({
                    url: endpoint,
                    error: error.message
                });
            }
            
            // 延遲避免過於頻繁
            await new Promise(resolve => setTimeout(resolve, 300));
        }
        
        return results;
    }

    // 檢查JSON是否包含文章結構
    hasArticleStructure(data) {
        if (!data || typeof data !== 'object') return false;
        
        const jsonStr = JSON.stringify(data).toLowerCase();
        const articleIndicators = ['article', 'entry', 'post', 'diary', 'blog', 'title', 'content'];
        
        return articleIndicators.some(indicator => jsonStr.includes(indicator));
    }

    // 執行完整的JavaScript分析
    async executeJavaScriptAnalysis() {
        console.log('🔍 [JavaScript分析] 開始完整的JavaScript代碼分析...');
        
        try {
            const analysis = await this.analyzeJavaScriptInHTML();
            
            let testResults = [];
            if (analysis.possibleEndpoints.length > 0) {
                testResults = await this.testDiscoveredEndpoints(analysis.possibleEndpoints);
            }
            
            return {
                success: true,
                analysis,
                testResults,
                summary: {
                    scriptsFound: analysis.scripts,
                    ajaxCallsFound: analysis.ajaxCalls.length,
                    apiEndpointsFound: analysis.apiEndpoints.length,
                    articleLoadersFound: analysis.articleLoaders.length,
                    endpointsTested: testResults.length,
                    workingEndpoints: testResults.filter(r => r.statusCode === 200).length
                }
            };
            
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = JavaScriptAnalyzer;