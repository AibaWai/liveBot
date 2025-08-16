const https = require('https');

class DeepContentAnalyzer {
    constructor() {
        this.blogUrl = 'https://web.familyclub.jp/s/jwb/diary/F2017?ima=3047';
        this.jsonpUrl = 'https://web.familyclub.jp/s/jwb/diary/F2017?ima=3047&callback=jsonp';
        this.baseUrl = 'https://web.familyclub.jp';
    }

    makeRequest(url, options = {}) {
        return new Promise((resolve, reject) => {
            const req = https.request(url, {
                method: options.method || 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
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

    // 深度分析JSONP響應，專門尋找文章列表
    async analyzeJSONPForArticles() {
        try {
            console.log('🔍 [深度分析] 開始分析JSONP響應中的文章列表...');
            
            const response = await this.makeRequest(this.jsonpUrl);
            
            if (response.statusCode !== 200) {
                throw new Error(`HTTP錯誤: ${response.statusCode}`);
            }
            
            console.log(`📊 [深度分析] JSONP響應長度: ${response.data.length}`);
            console.log(`📋 [深度分析] Content-Type: ${response.contentType}`);
            
            // 顯示響應的前500字符以供分析
            console.log('📄 [深度分析] JSONP響應前500字符:');
            console.log(response.data.substring(0, 500));
            
            // 嘗試提取JSONP中的JSON部分
            const jsonData = this.extractJSONFromJSONP(response.data);
            if (jsonData) {
                console.log('✅ [深度分析] 成功提取JSON數據');
                console.log('📋 [深度分析] JSON結構分析:');
                this.analyzeJSONStructure(jsonData);
                
                return this.findArticlesInJSON(jsonData);
            }
            
            // 如果不是JSONP，嘗試直接分析HTML
            return this.findArticleListInHTML(response.data);
            
        } catch (error) {
            console.error('❌ [深度分析] JSONP分析失敗:', error.message);
            throw error;
        }
    }

    // 從JSONP中提取JSON
    extractJSONFromJSONP(data) {
        try {
            // 多種JSONP格式
            const patterns = [
                /jsonp\s*\(\s*({.*})\s*\)/s,
                /callback\s*\(\s*({.*})\s*\)/s,
                /\w+\s*\(\s*({.*})\s*\)/s,
                /^[^{]*({.*})[^}]*$/s
            ];
            
            for (const pattern of patterns) {
                const match = data.match(pattern);
                if (match) {
                    try {
                        return JSON.parse(match[1]);
                    } catch (e) {
                        continue;
                    }
                }
            }
            
            // 嘗試直接解析
            try {
                return JSON.parse(data);
            } catch (e) {
                return null;
            }
            
        } catch (error) {
            return null;
        }
    }

    // 分析JSON結構
    analyzeJSONStructure(data, prefix = '') {
        if (typeof data === 'object' && data !== null) {
            if (Array.isArray(data)) {
                console.log(`${prefix}Array (${data.length} 項目)`);
                if (data.length > 0) {
                    console.log(`${prefix}  [0]: ${typeof data[0]} ${Array.isArray(data[0]) ? `(${data[0].length} 項目)` : ''}`);
                    if (typeof data[0] === 'object' && data[0] !== null) {
                        const keys = Object.keys(data[0]).slice(0, 5);
                        console.log(`${prefix}  [0] keys: ${keys.join(', ')}${Object.keys(data[0]).length > 5 ? '...' : ''}`);
                    }
                }
            } else {
                const keys = Object.keys(data);
                console.log(`${prefix}Object keys (${keys.length}): ${keys.slice(0, 10).join(', ')}${keys.length > 10 ? '...' : ''}`);
                
                // 分析可能包含文章的關鍵字
                const articleKeys = keys.filter(key => 
                    key.includes('article') || key.includes('entry') || key.includes('post') || 
                    key.includes('diary') || key.includes('blog') || key.includes('list') ||
                    key.includes('item') || key.includes('content') || key.includes('data')
                );
                
                if (articleKeys.length > 0) {
                    console.log(`${prefix}  📝 可能的文章相關鍵: ${articleKeys.join(', ')}`);
                    
                    articleKeys.forEach(key => {
                        const value = data[key];
                        if (Array.isArray(value)) {
                            console.log(`${prefix}    ${key}: Array (${value.length} 項目)`);
                        } else if (typeof value === 'object') {
                            console.log(`${prefix}    ${key}: Object`);
                        } else {
                            console.log(`${prefix}    ${key}: ${typeof value} = ${String(value).substring(0, 50)}...`);
                        }
                    });
                }
            }
        }
    }

    // 在JSON中尋找文章
    findArticlesInJSON(data) {
        const articles = [];
        
        try {
            console.log('📝 [文章搜索] 在JSON中尋找文章...');
            
            // 遞歸搜索所有可能的文章容器
            this.searchForArticles(data, articles, '');
            
            console.log(`📊 [文章搜索] JSON中找到 ${articles.length} 篇潛在文章`);
            
            return articles;
            
        } catch (error) {
            console.error('❌ [文章搜索] JSON文章搜索失敗:', error.message);
            return [];
        }
    }

    // 遞歸搜索文章
    searchForArticles(obj, articles, path = '') {
        if (Array.isArray(obj)) {
            obj.forEach((item, index) => {
                this.searchForArticles(item, articles, `${path}[${index}]`);
            });
        } else if (typeof obj === 'object' && obj !== null) {
            // 檢查當前對象是否像文章
            if (this.looksLikeArticle(obj)) {
                const article = this.extractArticleData(obj);
                if (article) {
                    articles.push({
                        ...article,
                        source: 'JSON',
                        path: path
                    });
                    console.log(`📄 [文章發現] 在 ${path} 找到文章: ${article.title || article.id}`);
                }
            }
            
            // 繼續遞歸搜索
            Object.keys(obj).forEach(key => {
                this.searchForArticles(obj[key], articles, path ? `${path}.${key}` : key);
            });
        }
    }

    // 判斷對象是否像文章
    looksLikeArticle(obj) {
        if (typeof obj !== 'object' || obj === null) return false;
        
        const keys = Object.keys(obj);
        const articleIndicators = [
            'id', 'title', 'subject', 'content', 'body', 'text',
            'date', 'created', 'published', 'time', 'datetime',
            'url', 'link', 'permalink', 'href',
            'author', 'writer', 'user'
        ];
        
        const foundIndicators = keys.filter(key => 
            articleIndicators.some(indicator => 
                key.toLowerCase().includes(indicator.toLowerCase())
            )
        );
        
        // 至少要有2個文章指標才算
        return foundIndicators.length >= 2;
    }

    // 提取文章數據
    extractArticleData(obj) {
        try {
            const article = {
                id: null,
                title: null,
                content: null,
                date: null,
                url: null,
                author: null
            };
            
            // 提取ID
            const idKeys = ['id', 'articleId', 'entryId', 'postId', 'diaryId'];
            for (const key of idKeys) {
                if (obj[key] != null) {
                    article.id = obj[key];
                    break;
                }
            }
            
            // 提取標題
            const titleKeys = ['title', 'subject', 'headline', 'name'];
            for (const key of titleKeys) {
                if (obj[key] && typeof obj[key] === 'string' && obj[key].trim()) {
                    article.title = obj[key].trim();
                    break;
                }
            }
            
            // 提取內容
            const contentKeys = ['content', 'body', 'text', 'description', 'summary'];
            for (const key of contentKeys) {
                if (obj[key] && typeof obj[key] === 'string' && obj[key].trim()) {
                    article.content = obj[key].trim();
                    break;
                }
            }
            
            // 提取日期
            const dateKeys = ['date', 'created', 'published', 'createdAt', 'publishedAt', 'datetime', 'time'];
            for (const key of dateKeys) {
                if (obj[key]) {
                    article.date = obj[key];
                    break;
                }
            }
            
            // 提取URL
            const urlKeys = ['url', 'link', 'permalink', 'href'];
            for (const key of urlKeys) {
                if (obj[key] && typeof obj[key] === 'string') {
                    article.url = obj[key];
                    break;
                }
            }
            
            // 提取作者
            const authorKeys = ['author', 'writer', 'user', 'by'];
            for (const key of authorKeys) {
                if (obj[key] && typeof obj[key] === 'string') {
                    article.author = obj[key];
                    break;
                }
            }
            
            // 至少要有ID或標題才算有效
            if (article.id || article.title) {
                return article;
            }
            
            return null;
            
        } catch (error) {
            console.error('❌ [文章提取] 提取文章數據失敗:', error.message);
            return null;
        }
    }

    // 在HTML中尋找文章列表（專門針對 ブログ記事一覧）
    findArticleListInHTML(html) {
        const articles = [];
        
        try {
            console.log('📝 [HTML分析] 在HTML中尋找文章列表...');
            
            // 尋找包含 "ブログ記事一覧" 的區域
            const listSectionMatch = html.match(/ブログ記事一覧[\s\S]{1,2000}/);
            
            if (listSectionMatch) {
                console.log('✅ [HTML分析] 找到 "ブログ記事一覧" 區域');
                const listSection = listSectionMatch[0];
                
                // 在這個區域中尋找文章項目
                const articlePatterns = [
                    // 尋找列表項目
                    /<li[^>]*>([\s\S]*?)<\/li>/gi,
                    /<div[^>]*class="[^"]*entry[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
                    /<div[^>]*class="[^"]*item[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
                    /<article[^>]*>([\s\S]*?)<\/article>/gi
                ];
                
                for (const pattern of articlePatterns) {
                    let match;
                    pattern.lastIndex = 0;
                    
                    while ((match = pattern.exec(listSection)) !== null) {
                        const itemHtml = match[1];
                        const article = this.extractArticleFromHTML(itemHtml);
                        
                        if (article) {
                            articles.push({
                                ...article,
                                source: 'HTML-ブログ記事一覧'
                            });
                        }
                    }
                }
            }
            
            // 如果在特定區域沒找到，在整個頁面尋找
            if (articles.length === 0) {
                console.log('⚠️ [HTML分析] 在特定區域未找到，搜索整個頁面...');
                articles.push(...this.findArticlesInFullHTML(html));
            }
            
            console.log(`📊 [HTML分析] HTML中找到 ${articles.length} 篇潛在文章`);
            
            return articles;
            
        } catch (error) {
            console.error('❌ [HTML分析] HTML文章搜索失敗:', error.message);
            return [];
        }
    }

    // 從HTML片段提取文章
    extractArticleFromHTML(html) {
        try {
            // 提取標題
            const titleMatches = [
                html.match(/<h[1-6][^>]*>([^<]+)<\/h[1-6]>/i),
                html.match(/<[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/[^>]*>/i),
                html.match(/<a[^>]*>([^<]+)<\/a>/i)
            ].filter(Boolean);
            
            const title = titleMatches.length > 0 ? titleMatches[0][1].trim() : null;
            
            // 提取日期
            const dateMatch = html.match(/(\d{4})[年\/\-](\d{1,2})[月\/\-](\d{1,2})[日]?/);
            const date = dateMatch ? dateMatch[0] : null;
            
            // 提取URL
            const urlMatch = html.match(/href="([^"]+)"/i);
            const url = urlMatch ? urlMatch[1] : null;
            
            // 過濾掉明顯的導航元素
            if (title && title.length > 3 && 
                !title.includes('ログイン') && 
                !title.includes('TOP') && 
                !title.includes('MENU') &&
                !title.includes('ブログ記事一覧') &&
                !title.includes('日付を選択')) {
                
                return {
                    id: Date.now() + Math.random(),
                    title: title,
                    date: date,
                    url: url,
                    content: null,
                    author: null
                };
            }
            
            return null;
            
        } catch (error) {
            return null;
        }
    }

    // 在完整HTML中尋找文章
    findArticlesInFullHTML(html) {
        // 這裡實現更全面的HTML文章搜索
        return [];
    }

    // 執行深度內容分析
    async executeDeepAnalysis() {
        console.log('🔍 [深度內容分析] 開始深度分析Family Club博客內容...');
        
        try {
            const articles = await this.analyzeJSONPForArticles();
            
            return {
                success: true,
                totalArticles: articles.length,
                articles: articles,
                analysis: {
                    jsonArticles: articles.filter(a => a.source === 'JSON').length,
                    htmlArticles: articles.filter(a => a.source.includes('HTML')).length
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

module.exports = DeepContentAnalyzer;