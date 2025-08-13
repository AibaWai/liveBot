const https = require('https');
const puppeteer = require('puppeteer');

class EnhancedBlogMonitor {
    constructor(notificationCallback = null) {
        this.notificationCallback = notificationCallback;
        this.isMonitoring = false;
        this.monitoringInterval = null;
        this.checkIntervalMinutes = 60;
        this.totalChecks = 0;
        this.articlesFound = 0;
        this.lastCheckTime = null;
        this.browser = null;
        this.page = null;
        
        // 博客監控配置
        this.blogUrl = 'https://web.familyclub.jp/s/jwb/diary/F2017?ima=3047';
        
        // 記錄最新文章信息
        this.latestRecord = {
            articleId: null,
            datetime: null,
            datetimeString: null,
            title: null,
            url: null,
            lastUpdated: null
        };
        
        console.log('🔍 [Enhanced Blog Monitor] Family Club 動態博客監控已初始化 (Docker版)');
        console.log('🔗 [Enhanced Blog Monitor] 目標網址:', this.blogUrl);
        console.log('🚀 [Enhanced Blog Monitor] 支援 JavaScript 動態內容加載');
    }

    // 初始化瀏覽器 (Docker 優化版)
    async initializeBrowser() {
        try {
            if (this.browser) {
                console.log('🌐 [Browser] 瀏覽器已存在，跳過初始化');
                return true;
            }

            console.log('🚀 [Browser] 正在啟動 Puppeteer 瀏覽器 (Docker 環境)...');
            
            // Docker 環境的瀏覽器配置
            const browserOptions = {
                headless: 'new',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu',
                    '--disable-web-security',
                    '--disable-features=VizDisplayCompositor',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                    '--disable-field-trial-config',
                    '--disable-ipc-flooding-protection',
                    '--memory-pressure-off',
                    '--max_old_space_size=512',
                    '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                ],
                timeout: 30000
            };

            // 檢查是否在 Docker/Alpine 環境中
            const isDocker = process.env.PUPPETEER_EXECUTABLE_PATH || 
                             process.platform === 'linux';
            
            if (isDocker) {
                // 使用系統安裝的 Chromium
                browserOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser';
                console.log('🐳 [Browser] 使用 Docker 環境配置');
            }

            this.browser = await puppeteer.launch(browserOptions);

            this.page = await this.browser.newPage();
            
            // 設置視窗大小和其他配置
            await this.page.setViewport({ width: 1366, height: 768 });
            
            // 設置請求攔截（優化性能）
            await this.page.setRequestInterception(true);
            this.page.on('request', (req) => {
                const resourceType = req.resourceType();
                if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
                    req.abort(); // 阻止非必要資源
                } else {
                    req.continue();
                }
            });

            // 設置頁面錯誤處理
            this.page.on('error', (error) => {
                console.warn('⚠️ [Browser] 頁面錯誤:', error.message);
            });

            this.page.on('pageerror', (error) => {
                console.warn('⚠️ [Browser] 頁面 JavaScript 錯誤:', error.message);
            });

            // 設置超時
            this.page.setDefaultTimeout(30000);
            this.page.setDefaultNavigationTimeout(30000);

            console.log('✅ [Browser] Puppeteer 瀏覽器啟動成功 (Docker 環境)');
            return true;

        } catch (error) {
            console.error('❌ [Browser] 瀏覽器初始化失敗:', error.message);
            
            // Docker 環境特殊錯誤提示
            if (error.message.includes('could not find expected browser')) {
                console.error('💡 [Browser] 提示: 請確保 Dockerfile 中正確安裝了 Chromium');
            }
            
            return false;
        }
    }

    // 關閉瀏覽器
    async closeBrowser() {
        try {
            if (this.page) {
                await this.page.close();
                this.page = null;
            }
            if (this.browser) {
                await this.browser.close();
                this.browser = null;
            }
            console.log('🔒 [Browser] 瀏覽器已關閉');
        } catch (error) {
            console.error('❌ [Browser] 關閉瀏覽器失敗:', error.message);
        }
    }

    // 使用 Puppeteer 獲取動態內容 (Docker 優化版)
    async fetchDynamicContent() {
        try {
            if (!this.browser || !this.page) {
                console.log('🔄 [Browser] 瀏覽器未初始化，正在啟動...');
                const success = await this.initializeBrowser();
                if (!success) {
                    throw new Error('瀏覽器初始化失敗');
                }
            }

            console.log('🌐 [Fetch] 正在訪問博客頁面 (Docker 環境)...');
            
            // 訪問頁面，增加重試機制
            let retryCount = 0;
            const maxRetries = 3;
            
            while (retryCount < maxRetries) {
                try {
                    await this.page.goto(this.blogUrl, {
                        waitUntil: 'networkidle0',
                        timeout: 30000
                    });
                    break; // 成功就跳出循環
                } catch (error) {
                    retryCount++;
                    console.warn(`⚠️ [Fetch] 頁面加載失敗 (嘗試 ${retryCount}/${maxRetries}):`, error.message);
                    
                    if (retryCount >= maxRetries) {
                        throw error;
                    }
                    
                    // 等待後重試
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            }

            console.log('📊 [Fetch] 頁面加載完成，等待動態內容...');
            
            // 等待動態內容加載
            await this.page.waitForTimeout(5000);

            // 嘗試等待文章容器出現
            try {
                await this.page.waitForSelector('article, .diary, .entry, [data-id]', { 
                    timeout: 10000 
                });
                console.log('✅ [Fetch] 檢測到文章容器');
            } catch (e) {
                console.log('⚠️ [Fetch] 未檢測到標準文章容器，繼續嘗試...');
            }

            // 滾動頁面確保所有動態內容加載
            await this.page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight);
            });
            
            // 再等待一下讓滾動觸發的內容加載
            await this.page.waitForTimeout(3000);

            // 獲取頁面內容
            const content = await this.page.content();
            
            console.log(`📄 [Fetch] 動態內容獲取成功，長度: ${content.length} 字元`);
            
            return content;

        } catch (error) {
            console.error('❌ [Fetch] 動態內容獲取失敗:', error.message);
            
            // 如果是網絡錯誤，嘗試重啟瀏覽器
            if (error.message.includes('Navigation timeout') || 
                error.message.includes('net::') ||
                error.message.includes('Protocol error')) {
                console.log('🔄 [Fetch] 嘗試重啟瀏覽器...');
                await this.closeBrowser();
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
            
            throw error;
        }
    }

    // 解析文章（針對動態內容優化）
    async parseArticlesFromDynamicContent(html) {
        try {
            console.log('🔍 [Parse] 開始解析動態加載的文章...');
            
            const articles = [];
            
            // 使用 Puppeteer 在頁面上下文中執行解析
            const articleData = await this.page.evaluate(() => {
                const foundArticles = [];
                
                // 多種選擇器策略，針對日文博客優化
                const selectors = [
                    'article',
                    '[data-article-id]',
                    '[data-id]',
                    '.diary-entry',
                    '.diary-item',
                    '.blog-entry',
                    '.entry',
                    '[id*="entry"]',
                    '[id*="article"]',
                    '[id*="diary"]',
                    '[class*="diary"]',
                    '[class*="entry"]',
                    '[class*="blog"]',
                    // Family Club 特定選擇器
                    '.fc-diary-entry',
                    '.fc-blog-item',
                    '[data-diary-id]'
                ];
                
                for (const selector of selectors) {
                    const elements = document.querySelectorAll(selector);
                    
                    elements.forEach((element, index) => {
                        try {
                            // 提取文章ID
                            let articleId = null;
                            const idAttributes = ['data-id', 'data-article-id', 'data-diary-id', 'id'];
                            for (const attr of idAttributes) {
                                const value = element.getAttribute(attr);
                                if (value) {
                                    const idMatch = value.match(/\d+/);
                                    if (idMatch) {
                                        articleId = parseInt(idMatch[0]);
                                        break;
                                    }
                                }
                            }
                            
                            // 如果沒有找到ID，從URL中提取
                            if (!articleId) {
                                const linkEl = element.querySelector('a[href]');
                                if (linkEl) {
                                    const href = linkEl.getAttribute('href');
                                    const urlIdMatch = href.match(/\/(\d+)(?:\?|$)/);
                                    if (urlIdMatch) {
                                        articleId = parseInt(urlIdMatch[1]);
                                    }
                                }
                            }
                            
                            // 如果還是沒有ID，使用索引
                            if (!articleId) {
                                articleId = Date.now() + index; // 使用時間戳+索引避免衝突
                            }
                            
                            // 提取標題
                            let title = '未知標題';
                            const titleSelectors = [
                                'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                                '.title', '[class*="title"]',
                                '.subject', '[class*="subject"]',
                                '.headline', '[class*="headline"]'
                            ];
                            for (const titleSel of titleSelectors) {
                                const titleEl = element.querySelector(titleSel);
                                if (titleEl && titleEl.textContent.trim()) {
                                    title = titleEl.textContent.trim();
                                    break;
                                }
                            }
                            
                            // 如果沒找到標題，從連結文本中提取
                            if (title === '未知標題') {
                                const linkEl = element.querySelector('a');
                                if (linkEl && linkEl.textContent.trim()) {
                                    title = linkEl.textContent.trim();
                                }
                            }
                            
                            // 提取時間信息
                            let dateInfo = null;
                            const timeSelectors = [
                                'time', '[datetime]', 
                                '.date', '[class*="date"]', 
                                '.time', '[class*="time"]',
                                '.created', '[class*="created"]',
                                '.published', '[class*="published"]'
                            ];
                            for (const timeSel of timeSelectors) {
                                const timeEl = element.querySelector(timeSel);
                                if (timeEl) {
                                    const datetime = timeEl.getAttribute('datetime') || 
                                                   timeEl.getAttribute('data-time') ||
                                                   timeEl.textContent;
                                    if (datetime) {
                                        dateInfo = datetime.trim();
                                        break;
                                    }
                                }
                            }
                            
                            // 如果沒有找到時間，查找文本中的日期
                            if (!dateInfo) {
                                const textContent = element.textContent;
                                const datePatterns = [
                                    /(\d{4})[年](\d{1,2})[月](\d{1,2})[日]/,
                                    /(\d{4})\.(\d{1,2})\.(\d{1,2})/,
                                    /(\d{4})\/(\d{1,2})\/(\d{1,2})/,
                                    /(\d{4})-(\d{1,2})-(\d{1,2})/,
                                    /(\d{1,2})\/(\d{1,2})\/(\d{4})/,
                                    /(\d{1,2})-(\d{1,2})-(\d{4})/
                                ];
                                
                                for (const pattern of datePatterns) {
                                    const match = textContent.match(pattern);
                                    if (match) {
                                        dateInfo = match[0];
                                        break;
                                    }
                                }
                            }
                            
                            // 提取URL
                            let url = null;
                            const linkEl = element.querySelector('a[href]');
                            if (linkEl) {
                                url = linkEl.getAttribute('href');
                                if (url && !url.startsWith('http')) {
                                    url = 'https://web.familyclub.jp' + url;
                                }
                            }
                            
                            // 只有當我們找到有意義的信息時才添加
                            if (articleId && (dateInfo || title !== '未知標題')) {
                                foundArticles.push({
                                    id: articleId,
                                    title: title,
                                    dateString: dateInfo,
                                    url: url,
                                    selector: selector,
                                    elementHTML: element.outerHTML.substring(0, 500)
                                });
                            }
                            
                        } catch (error) {
                            console.error('解析單個文章失敗:', error);
                        }
                    });
                    
                    if (foundArticles.length > 0) {
                        console.log(`使用選擇器 "${selector}" 找到 ${foundArticles.length} 篇文章`);
                        break; // 找到文章就停止
                    }
                }
                
                return foundArticles;
            });

            // 處理日期解析
            for (const article of articleData) {
                const timeInfo = this.parseDateTime(article.dateString || '');
                if (timeInfo) {
                    articles.push({
                        id: article.id,
                        date: timeInfo.date,
                        datetimeString: timeInfo.datetimeString,
                        title: article.title,
                        url: article.url
                    });
                } else {
                    // 如果沒有有效日期，使用當前時間
                    const now = new Date();
                    articles.push({
                        id: article.id,
                        date: now,
                        datetimeString: now.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
                        title: article.title,
                        url: article.url
                    });
                }
            }

            console.log(`📊 [Parse] 總共解析到 ${articles.length} 篇文章`);
            return articles;

        } catch (error) {
            console.error('❌ [Parse] 動態內容解析失敗:', error.message);
            return [];
        }
    }

    // 解析日期時間（重用原有邏輯）
    parseDateTime(dateString) {
        try {
            if (!dateString) return null;

            let date = null;

            // 優先處理日文日期格式
            const jpPatterns = [
                /(\d{4})[年](\d{1,2})[月](\d{1,2})[日]\s*(\d{1,2}):(\d{2})/,
                /(\d{4})\.(\d{1,2})\.(\d{1,2})\s+(\d{1,2}):(\d{2})/,
                /(\d{4})[年](\d{1,2})[月](\d{1,2})[日]/,
                /(\d{4})\.(\d{1,2})\.(\d{1,2})/,
                /(\d{4})\/(\d{1,2})\/(\d{1,2})/,
                /(\d{4})-(\d{1,2})-(\d{1,2})/
            ];
            
            for (const pattern of jpPatterns) {
                const match = dateString.match(pattern);
                if (match) {
                    const year = parseInt(match[1]);
                    const month = parseInt(match[2]) - 1;
                    const day = parseInt(match[3]);
                    const hour = match[4] ? parseInt(match[4]) : 0;
                    const minute = match[5] ? parseInt(match[5]) : 0;
                    
                    date = new Date(year, month, day, hour, minute);
                    break;
                }
            }
            
            // 嘗試直接解析ISO格式
            if (!date && (dateString.includes('T') || dateString.includes('-'))) {
                date = new Date(dateString);
            }
            
            if (!date || isNaN(date.getTime())) {
                return null;
            }
            
            return {
                date: date,
                datetimeString: `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
            };
            
        } catch (error) {
            console.error('❌ [日期解析] 失敗:', error.message);
            return null;
        }
    }

    // 找出最新文章
    findLatestArticle(articles) {
        if (articles.length === 0) {
            return null;
        }
        
        // 優先按ID排序
        const articlesWithId = articles.filter(a => a.id !== null && !isNaN(a.id));
        if (articlesWithId.length > 0) {
            console.log('📊 [最新文章] 按ID排序查找最新文章');
            return articlesWithId.sort((a, b) => b.id - a.id)[0];
        }
        
        // 否則按時間排序
        console.log('📊 [最新文章] 按時間排序查找最新文章');
        return articles.sort((a, b) => b.date - a.date)[0];
    }

    // 初始化
    async initialize() {
        try {
            console.log('🚀 [Enhanced Blog Monitor] 正在初始化動態博客監控 (Docker 環境)...');
            
            const success = await this.initializeBrowser();
            if (!success) {
                throw new Error('瀏覽器初始化失敗');
            }

            const html = await this.fetchDynamicContent();
            const articles = await this.parseArticlesFromDynamicContent(html);
            
            if (articles.length === 0) {
                console.warn('⚠️ [Enhanced Blog Monitor] 未找到任何文章，可能需要調整解析邏輯');
                return false;
            }
            
            const latestArticle = this.findLatestArticle(articles);
            
            this.latestRecord = {
                articleId: latestArticle.id,
                datetime: latestArticle.date,
                datetimeString: latestArticle.datetimeString,
                title: latestArticle.title,
                url: latestArticle.url,
                lastUpdated: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
            };
            
            console.log('✅ [Enhanced Blog Monitor] 動態初始化完成 (Docker 環境)，建立基準記錄:');
            console.log(`   📄 文章ID: ${this.latestRecord.articleId}`);
            console.log(`   🗓️ 發佈時間: ${this.latestRecord.datetimeString}`);
            console.log(`   📝 標題: ${this.latestRecord.title}`);
            console.log(`   🔗 URL: ${this.latestRecord.url}`);
            
            return true;
            
        } catch (error) {
            console.error('❌ [Enhanced Blog Monitor] 動態初始化失敗 (Docker 環境):', error.message);
            return false;
        }
    }

    // 檢查是否有新文章（動態版本）
    async checkForNewArticles(testMode = false) {
        try {
            console.log(`🔍 [檢查更新] 檢查新文章（動態模式 Docker）... ${testMode ? '(測試模式)' : ''}`);
            this.totalChecks++;
            this.lastCheckTime = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

            const html = await this.fetchDynamicContent();
            const articles = await this.parseArticlesFromDynamicContent(html);
            
            if (articles.length === 0) {
                console.log('📋 [檢查更新] 未找到文章');
                return null;
            }
            
            const latestArticle = this.findLatestArticle(articles);
            
            if (testMode) {
                console.log(`📝 [測試模式] 當前最新文章: ID=${latestArticle.id}, 時間=${latestArticle.datetimeString}`);
                return latestArticle;
            }
            
            // 檢查是否有更新
            let hasUpdate = false;
            let updateReason = '';
            
            if (!this.latestRecord.articleId && !this.latestRecord.datetime) {
                hasUpdate = true;
                updateReason = '初始化記錄';
            } else {
                if (latestArticle.id && this.latestRecord.articleId && latestArticle.id > this.latestRecord.articleId) {
                    hasUpdate = true;
                    updateReason = `新文章ID: ${latestArticle.id} > ${this.latestRecord.articleId}`;
                }
                
                if (!hasUpdate && latestArticle.date && this.latestRecord.datetime && latestArticle.date > this.latestRecord.datetime) {
                    hasUpdate = true;
                    updateReason = `新發佈時間: ${latestArticle.datetimeString} > ${this.latestRecord.datetimeString}`;
                }
            }
            
            if (hasUpdate) {
                console.log(`📝 [檢查更新] 發現新文章! 原因: ${updateReason}`);
                
                this.latestRecord = {
                    articleId: latestArticle.id,
                    datetime: latestArticle.date,
                    datetimeString: latestArticle.datetimeString,
                    title: latestArticle.title,
                    url: latestArticle.url,
                    lastUpdated: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
                };
                
                this.articlesFound++;
                return latestArticle;
            }
            
            console.log('📋 [檢查更新] 無新文章');
            return null;

        } catch (error) {
            console.error('❌ [檢查更新] 動態檢查失敗:', error.message);
            return null;
        }
    }

    // 測試網站連接（Docker 優化版）
    async testWebsiteAccess() {
        try {
            console.log('🔍 [測試連接] 測試博客網站動態連接 (Docker 環境)...');
            
            const success = await this.initializeBrowser();
            if (!success) {
                return {
                    success: false,
                    error: '瀏覽器初始化失敗 (Docker 環境)',
                    method: 'dynamic (Puppeteer Docker)'
                };
            }

            const html = await this.fetchDynamicContent();
            const articles = await this.parseArticlesFromDynamicContent(html);
            
            return {
                success: true,
                method: 'dynamic (Puppeteer Docker)',
                contentLength: html.length,
                articlesFound: articles.length,
                sampleArticles: articles.slice(0, 3).map(a => ({
                    id: a.id,
                    time: a.datetimeString,
                    title: a.title
                })),
                dynamicContentSupported: true,
                dockerOptimized: true
            };

        } catch (error) {
            console.error('❌ [測試連接] 動態測試失敗 (Docker 環境):', error.message);
            return {
                success: false,
                error: error.message,
                method: 'dynamic (Puppeteer Docker)'
            };
        }
    }

    // 發送新文章通知
    async sendNewArticleNotification(article) {
        if (!this.notificationCallback) return;

        const notificationMessage = `📝 **Family Club 新文章發布!** (動態檢測 Docker)

📄 **文章ID:** ${article.id || '未知'}
🗓️ **發布時間:** ${article.datetimeString}
📝 **標題:** ${article.title || '未知標題'}
${article.url ? `🔗 **文章連結:** ${article.url}` : ''}
🌐 **博客首頁:** ${this.blogUrl}
⏰ **檢測時間:** ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
🚀 **檢測方式:** JavaScript 動態內容解析 (Docker)

🎉 快去看看新內容吧！`;

        try {
            await this.notificationCallback(notificationMessage, 'blog_alert', 'EnhancedBlogDocker');
            console.log('📤 [通知] 動態新文章通知已發送 (Docker)');
        } catch (error) {
            console.error('❌ [通知] 動態通知發送失敗 (Docker):', error.message);
        }
    }

    // 開始監控
    startMonitoring() {
        if (this.isMonitoring) {
            console.log('⚠️ [監控] 動態監控已在運行中 (Docker)');
            return;
        }

        this.isMonitoring = true;
        console.log('🚀 [監控] 開始Family Club動態博客監控 (Docker 環境，每小時00分檢查)');
        
        const monitorLoop = async () => {
            if (!this.isMonitoring) {
                console.log('⏹️ [監控] 動態監控已停止 (Docker)');
                return;
            }

            try {
                const newArticle = await this.checkForNewArticles();
                if (newArticle) {
                    await this.sendNewArticleNotification(newArticle);
                }

                const nextCheckSeconds = this.calculateNextCheckTime();
                const nextCheckTime = new Date(Date.now() + nextCheckSeconds * 1000)
                    .toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
                
                console.log(`⏰ [監控] 下次檢查: ${nextCheckTime} (${Math.round(nextCheckSeconds/60)}分鐘後)`);

                this.monitoringInterval = setTimeout(monitorLoop, nextCheckSeconds * 1000);

            } catch (error) {
                console.error('❌ [監控] 動態監控循環錯誤 (Docker):', error.message);
                
                // Docker 環境錯誤恢復
                if (error.message.includes('Protocol error') || 
                    error.message.includes('Target closed') ||
                    error.message.includes('Navigation timeout')) {
                    console.log('🔄 [監控] 檢測到瀏覽器問題，重啟瀏覽器...');
                    await this.closeBrowser();
                    await new Promise(resolve => setTimeout(resolve, 10000)); // 等待10秒
                }
                
                if (this.isMonitoring) {
                    console.log('⚠️ [監控] 10分鐘後重試');
                    this.monitoringInterval = setTimeout(monitorLoop, 10 * 60 * 1000);
                }
            }
        };

        // 先初始化，然後開始監控
        this.initialize().then(success => {
            if (success) {
                console.log('⏳ [監控] 5秒後開始定期檢查 (Docker)');
                this.monitoringInterval = setTimeout(monitorLoop, 5000);
            } else {
                console.error('❌ [監控] 動態初始化失敗 (Docker)，停止監控');
                this.isMonitoring = false;
            }
        });
    }

    // 停止監控
    stopMonitoring() {
        this.isMonitoring = false;
        
        if (this.monitoringInterval) {
            clearTimeout(this.monitoringInterval);
            this.monitoringInterval = null;
        }
        
        // 關閉瀏覽器
        this.closeBrowser();
        
        console.log('⏹️ [監控] Family Club動態博客監控已停止 (Docker)');
    }

    // 計算下次檢查時間
    calculateNextCheckTime() {
        const now = new Date();
        const nextCheck = new Date(now);
        
        nextCheck.setHours(now.getHours() + 1);
        nextCheck.setMinutes(0);
        nextCheck.setSeconds(0);
        nextCheck.setMilliseconds(0);

        const waitTime = nextCheck.getTime() - now.getTime();
        return Math.floor(waitTime / 1000);
    }

    // 獲取狀態
    getStatus() {
        return {
            isMonitoring: this.isMonitoring,
            totalChecks: this.totalChecks,
            articlesFound: this.articlesFound,
            lastCheckTime: this.lastCheckTime,
            nextCheckTime: this.isMonitoring ? new Date(Date.now() + this.calculateNextCheckTime() * 1000).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : null,
            blogUrl: this.blogUrl,
            method: 'dynamic (Puppeteer Docker)',
            browserStatus: this.browser ? '運行中' : '未啟動',
            dockerOptimized: true,
            latestRecord: {
                ...this.latestRecord,
                hasRecord: !!(this.latestRecord.articleId || this.latestRecord.datetime)
            }
        };
    }

    // 獲取當前最新記錄
    getLatestRecord() {
        if (!this.latestRecord.articleId && !this.latestRecord.datetime) {
            return null;
        }
        
        return {
            articleId: this.latestRecord.articleId,
            datetime: this.latestRecord.datetimeString,
            title: this.latestRecord.title,
            url: this.latestRecord.url,
            lastUpdated: this.latestRecord.lastUpdated
        };
    }

    // 手動重新初始化
    async reinitialize() {
        console.log('🔄 [重新初始化] 手動重新初始化動態記錄 (Docker)...');
        
        // 關閉現有瀏覽器
        await this.closeBrowser();
        
        return await this.initialize();
    }
}

module.exports = EnhancedBlogMonitor;