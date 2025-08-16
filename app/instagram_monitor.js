const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

class InstagramMonitor {
    constructor(notificationCallback, config) {
        this.notificationCallback = notificationCallback;
        this.config = config;
        this.isMonitoring = false;
        this.checkInterval = null;
        this.tempDir = '/tmp/instagram_cache';
        
        // 監控狀態
        this.state = {
            lastPostId: null,
            lastBio: null,
            lastProfilePic: null,
            totalChecks: 0,
            newPostsFound: 0,
            bioChanges: 0,
            profilePicChanges: 0,
            lastCheck: null,
            nextCheck: null,
            isPrivate: false,
            followerCount: null,
            followingCount: null,
            postCount: null
        };

        // 確保臨時目錄存在
        this.ensureTempDir();
    }

    async ensureTempDir() {
        try {
            await fs.mkdir(this.tempDir, { recursive: true });
            console.log(`📁 [Instagram] 臨時目錄已建立: ${this.tempDir}`);
        } catch (error) {
            console.error('❌ [Instagram] 臨時目錄建立失敗:', error.message);
        }
    }

    // 清理臨時檔案
    async cleanupTempFiles() {
        try {
            const files = await fs.readdir(this.tempDir);
            for (const file of files) {
                await fs.unlink(path.join(this.tempDir, file));
            }
            if (files.length > 0) {
                console.log(`🧹 [Instagram] 已清理 ${files.length} 個臨時檔案`);
            }
        } catch (error) {
            console.error('❌ [Instagram] 清理臨時檔案失敗:', error.message);
        }
    }

    // 下載媒體檔案到臨時目錄
    async downloadMedia(url, filename) {
        try {
            const response = await axios({
                method: 'GET',
                url: url,
                responseType: 'stream',
                timeout: 30000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });

            const filePath = path.join(this.tempDir, filename);
            const writer = require('fs').createWriteStream(filePath);
            
            response.data.pipe(writer);

            return new Promise((resolve, reject) => {
                writer.on('finish', () => resolve(filePath));
                writer.on('error', reject);
            });
        } catch (error) {
            console.error(`❌ [Instagram] 媒體下載失敗: ${error.message}`);
            throw error;
        }
    }

    // 刪除檔案
    async deleteFile(filePath) {
        try {
            await fs.unlink(filePath);
            console.log(`🗑️ [Instagram] 已刪除檔案: ${path.basename(filePath)}`);
        } catch (error) {
            console.error(`❌ [Instagram] 檔案刪除失敗: ${error.message}`);
        }
    }

    // 獲取Instagram用戶資料 - 參考instagram_monitor項目
    async fetchInstagramData() {
        try {
            const username = this.config.username;
            console.log(`🔍 [Instagram] 獲取 @${username} 的數據...`);
            
            // 使用Instagram的公開頁面
            const url = `https://www.instagram.com/${username}/`;
            
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'none',
                    'Cache-Control': 'no-cache',
                    'DNT': '1'
                },
                timeout: 30000,
                maxRedirects: 5
            });

            if (response.status === 200 && response.data) {
                console.log(`✅ [Instagram] 成功獲取頁面數據，長度: ${response.data.length}`);
                return this.parseInstagramHTML(response.data);
            } else {
                throw new Error(`HTTP ${response.status}`);
            }

        } catch (error) {
            console.error('❌ [Instagram] 數據獲取失敗:', error.message);
            
            if (error.response?.status === 429) {
                console.warn('⚠️ [Instagram] 達到請求限制');
                throw new Error('RATE_LIMITED');
            }
            
            throw error;
        }
    }

    // 解析Instagram HTML - 增強版本，包含詳細調試
    parseInstagramHTML(html) {
        try {
            console.log(`🔍 [Instagram] 開始解析HTML數據，長度: ${html.length}`);
            
            // 先檢查頁面內容類型
            this.debugPageContent(html);

            // 方法1: 提取 window._sharedData (舊版Instagram)
            let userData = this.extractFromSharedData(html);
            
            // 方法2: 提取嵌入的JSON數據 (新版Instagram)
            if (!userData) {
                userData = this.extractFromEmbeddedJson(html);
            }
            
            // 方法3: 使用正則表達式提取基本信息
            if (!userData) {
                userData = this.extractWithRegex(html);
            }

            // 方法4: 詳細的HTML結構分析
            if (!userData) {
                console.log(`🔍 [Instagram] 嘗試詳細HTML分析...`);
                userData = this.detailedHtmlAnalysis(html);
            }

            if (!userData) {
                console.warn('⚠️ [Instagram] 所有解析方法都失敗');
                // 保存失敗的HTML片段用於調試
                this.saveDebugHtml(html);
                return this.createEmptyUserData();
            }

            console.log(`✅ [Instagram] 數據解析成功:`);
            console.log(`   用戶名: ${userData.username}`);
            console.log(`   Bio: "${userData.biography?.substring(0, 50) || '無'}${userData.biography?.length > 50 ? '...' : ''}"`);
            console.log(`   追蹤者: ${userData.followerCount}`);
            console.log(`   貼文: ${userData.postCount}`);
            console.log(`   私人: ${userData.isPrivate}`);
            console.log(`   貼文數據: ${userData.posts.length} 篇`);

            return {
                isPrivate: userData.isPrivate,
                bio: userData.biography || '',
                followerCount: userData.followerCount,
                followingCount: userData.followingCount,
                postCount: userData.postCount,
                profilePicUrl: userData.profilePicUrl || '',
                posts: userData.posts || []
            };

        } catch (error) {
            console.error('❌ [Instagram] HTML解析失敗:', error.message);
            return this.createEmptyUserData();
        }
    }

    // 調試頁面內容
    debugPageContent(html) {
        try {
            console.log(`🔍 [Instagram] 頁面內容分析:`);
            
            // 檢查是否包含關鍵標識
            const indicators = {
                'window._sharedData': html.includes('window._sharedData'),
                'ProfilePage': html.includes('ProfilePage'),
                'biography': html.includes('biography'),
                'edge_owner_to_timeline_media': html.includes('edge_owner_to_timeline_media'),
                'shortcode': html.includes('shortcode'),
                'display_url': html.includes('display_url'),
                'is_private': html.includes('is_private'),
                'follower_count': html.includes('follower_count'),
                'edge_followed_by': html.includes('edge_followed_by')
            };

            for (const [key, found] of Object.entries(indicators)) {
                console.log(`   ${key}: ${found ? '✅' : '❌'}`);
            }

            // 檢查是否為登入頁面或錯誤頁面
            if (html.includes('Log in to Instagram')) {
                console.warn('⚠️ [Instagram] 檢測到登入頁面');
            }
            if (html.includes('Sorry, this page isn\'t available')) {
                console.warn('⚠️ [Instagram] 檢測到頁面不存在');
            }
            if (html.includes('This account is private')) {
                console.log('🔒 [Instagram] 檢測到私人帳戶');
            }

        } catch (error) {
            console.error('❌ [Instagram] 頁面內容分析失敗:', error.message);
        }
    }

    // 詳細的HTML結構分析
    detailedHtmlAnalysis(html) {
        try {
            console.log(`🔍 [Instagram] 執行詳細HTML結構分析...`);

            // 尋找所有script標籤中的JSON數據
            const scriptPattern = /<script[^>]*>(.*?)<\/script>/gs;
            let scriptMatch;
            let scriptIndex = 0;

            while ((scriptMatch = scriptPattern.exec(html)) !== null && scriptIndex < 10) {
                const scriptContent = scriptMatch[1];
                scriptIndex++;

                if (scriptContent.length > 100 && scriptContent.includes('{')) {
                    console.log(`📋 [Instagram] 分析第${scriptIndex}個script標籤，長度: ${scriptContent.length}`);
                    
                    // 嘗試提取JSON對象
                    const jsonMatches = scriptContent.match(/{[^{}]*"username"[^{}]*}/g);
                    if (jsonMatches) {
                        for (const jsonMatch of jsonMatches) {
                            try {
                                const userData = JSON.parse(jsonMatch);
                                if (userData.username === this.config.username) {
                                    console.log(`✅ [Instagram] 在script中找到用戶數據`);
                                    return this.formatUserData(userData);
                                }
                            } catch (e) {
                                // JSON解析失敗，繼續嘗試
                            }
                        }
                    }
                }
            }

            // 嘗試更廣泛的模式匹配
            console.log(`🔍 [Instagram] 嘗試廣泛模式匹配...`);
            
            // 尋找包含用戶名的JSON結構
            const usernamePattern = new RegExp(`"username":"${this.config.username}"[^}]*}`, 'g');
            const usernameMatches = html.match(usernamePattern);
            
            if (usernameMatches) {
                console.log(`📋 [Instagram] 找到 ${usernameMatches.length} 個用戶名匹配`);
                for (const match of usernameMatches) {
                    console.log(`   匹配內容: ${match.substring(0, 100)}...`);
                }
            }

            // 嘗試提取Meta標籤信息
            const metaInfo = this.extractMetaTags(html);
            if (metaInfo) {
                console.log(`📋 [Instagram] Meta標籤信息:`, metaInfo);
                return {
                    username: this.config.username,
                    biography: metaInfo.description || '',
                    followerCount: 0,
                    followingCount: 0,
                    postCount: 0,
                    profilePicUrl: metaInfo.image || '',
                    isPrivate: false,
                    posts: []
                };
            }

            return null;

        } catch (error) {
            console.error('❌ [Instagram] 詳細HTML分析失敗:', error.message);
            return null;
        }
    }

    // 提取Meta標籤信息
    extractMetaTags(html) {
        try {
            const metaTags = {};
            
            // 提取各種meta標籤
            const patterns = {
                title: /<title[^>]*>([^<]*)<\/title>/i,
                description: /<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i,
                image: /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']*)["']/i,
                url: /<meta[^>]*property=["']og:url["'][^>]*content=["']([^"']*)["']/i
            };

            for (const [key, pattern] of Object.entries(patterns)) {
                const match = html.match(pattern);
                if (match) {
                    metaTags[key] = match[1];
                    console.log(`📋 [Instagram] Meta ${key}: ${match[1].substring(0, 50)}...`);
                }
            }

            return Object.keys(metaTags).length > 0 ? metaTags : null;

        } catch (error) {
            console.error('❌ [Instagram] Meta標籤提取失敗:', error.message);
            return null;
        }
    }

    // 保存調試HTML
    saveDebugHtml(html) {
        try {
            // 只在開發環境保存HTML片段用於調試
            const debugInfo = {
                timestamp: new Date().toISOString(),
                username: this.config.username,
                htmlLength: html.length,
                htmlStart: html.substring(0, 1000),
                htmlEnd: html.substring(html.length - 1000),
                containsSharedData: html.includes('window._sharedData'),
                containsProfilePage: html.includes('ProfilePage'),
                containsBiography: html.includes('biography')
            };
            
            console.log(`🔧 [Instagram] 調試信息:`, JSON.stringify(debugInfo, null, 2));
            
        } catch (error) {
            console.error('❌ [Instagram] 保存調試信息失敗:', error.message);
        }
    }

    // 提取 window._sharedData
    extractFromSharedData(html) {
        try {
            const sharedDataMatch = html.match(/window\._sharedData\s*=\s*({.*?});/);
            if (sharedDataMatch) {
                const sharedData = JSON.parse(sharedDataMatch[1]);
                const user = sharedData.entry_data?.ProfilePage?.[0]?.graphql?.user;
                
                if (user) {
                    console.log(`✅ [Instagram] 使用 window._sharedData 解析成功`);
                    return this.formatUserData(user);
                }
            }
        } catch (error) {
            console.warn(`⚠️ [Instagram] window._sharedData 解析失敗: ${error.message}`);
        }
        return null;
    }

    // 提取嵌入的JSON數據
    extractFromEmbeddedJson(html) {
        try {
            // 尋找各種可能的JSON嵌入模式
            const patterns = [
                /"ProfilePage":\[({.*?})\]/,
                /"user":({.*?"id":".*?"})/,
                /{"config":.*?"user":({.*?}).*?}/,
            ];

            for (const pattern of patterns) {
                const match = html.match(pattern);
                if (match) {
                    try {
                        let userData = JSON.parse(match[1]);
                        
                        // 如果是嵌套結構，提取user數據
                        if (userData.graphql?.user) {
                            userData = userData.graphql.user;
                        }
                        
                        if (userData.id || userData.username) {
                            console.log(`✅ [Instagram] 使用嵌入JSON解析成功`);
                            return this.formatUserData(userData);
                        }
                    } catch (e) {
                        continue;
                    }
                }
            }
        } catch (error) {
            console.warn(`⚠️ [Instagram] 嵌入JSON解析失敗: ${error.message}`);
        }
        return null;
    }

    // 使用正則表達式提取基本信息 - 增強版本
    extractWithRegex(html) {
        try {
            console.log(`🔍 [Instagram] 使用正則表達式提取基本信息...`);

            // 提取真正的Bio (不是meta description) - 使用更多模式
            let biography = '';
            const bioPatterns = [
                /"biography":"([^"]*?)"/,
                /"biography\\u0022:\\u0022([^"]*?)\\u0022/,
                /"biography":\s*"([^"]*?)"/,
                /"bio":"([^"]*?)"/,
                /<meta property="og:description" content="([^"]*?)"/,
                /<meta name="description" content="([^"]*?)"/
            ];
            
            for (let i = 0; i < bioPatterns.length; i++) {
                const pattern = bioPatterns[i];
                const match = html.match(pattern);
                console.log(`   嘗試Bio模式 ${i + 1}: ${match ? '✅ 匹配' : '❌ 無匹配'}`);
                
                if (match && match[1]) {
                    let extractedBio = match[1]
                        .replace(/\\n/g, '\n')
                        .replace(/\\"/g, '"')
                        .replace(/\\u([0-9a-fA-F]{4})/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
                        .replace(/&quot;/g, '"')
                        .replace(/&#039;/g, "'");
                    
                    console.log(`   提取的Bio: "${extractedBio}"`);
                    
                    // 檢查是否為有意義的Bio
                    if (!extractedBio.includes('Followers') && 
                        !extractedBio.includes('See Instagram photos and videos') &&
                        extractedBio.length > 0) {
                        biography = extractedBio;
                        console.log(`📝 [Instagram] Bio提取成功: "${biography.substring(0, 50)}..."`);
                        break;
                    }
                }
            }
            
            // 提取追蹤者數量 - 使用更多模式
            let followerCount = 0;
            const followerPatterns = [
                /"edge_followed_by":\s*{\s*"count":\s*(\d+)/,
                /"follower_count":\s*(\d+)/,
                /"followers":\s*{\s*"count":\s*(\d+)/,
                /(\d+)\s+[Ff]ollowers?/,
                /"followed_by":\s*{\s*"count":\s*(\d+)/
            ];
            
            for (let i = 0; i < followerPatterns.length; i++) {
                const pattern = followerPatterns[i];
                const match = html.match(pattern);
                console.log(`   嘗試追蹤者模式 ${i + 1}: ${match ? '✅ 匹配' : '❌ 無匹配'}`);
                
                if (match && match[1]) {
                    followerCount = parseInt(match[1]);
                    console.log(`👥 [Instagram] 追蹤者數: ${followerCount}`);
                    break;
                }
            }
            
            // 提取貼文數量 - 使用更多模式
            let postCount = 0;
            const postCountPatterns = [
                /"edge_owner_to_timeline_media":\s*{\s*"count":\s*(\d+)/,
                /"media_count":\s*(\d+)/,
                /"posts":\s*{\s*"count":\s*(\d+)/,
                /(\d+)\s+[Pp]osts?/,
                /"timeline_media":\s*{\s*"count":\s*(\d+)/
            ];
            
            for (let i = 0; i < postCountPatterns.length; i++) {
                const pattern = postCountPatterns[i];
                const match = html.match(pattern);
                console.log(`   嘗試貼文數模式 ${i + 1}: ${match ? '✅ 匹配' : '❌ 無匹配'}`);
                
                if (match && match[1]) {
                    postCount = parseInt(match[1]);
                    console.log(`📸 [Instagram] 貼文數: ${postCount}`);
                    break;
                }
            }

            // 提取貼文數據 - 增強版本
            const posts = this.extractPostsDataEnhanced(html);
            console.log(`📋 [Instagram] 提取到 ${posts.length} 篇貼文數據`);

            // 提取頭像URL - 使用更多模式
            let profilePicUrl = '';
            const picPatterns = [
                /"profile_pic_url_hd":"([^"]+)"/,
                /"profile_pic_url":"([^"]+)"/,
                /"avatar":"([^"]+)"/,
                /<meta property="og:image" content="([^"]+)"/,
                /"profile_picture":"([^"]+)"/
            ];
            
            for (let i = 0; i < picPatterns.length; i++) {
                const pattern = picPatterns[i];
                const match = html.match(pattern);
                console.log(`   嘗試頭像模式 ${i + 1}: ${match ? '✅ 匹配' : '❌ 無匹配'}`);
                
                if (match && match[1]) {
                    profilePicUrl = match[1]
                        .replace(/\\u0026/g, '&')
                        .replace(/\\u002F/g, '/')
                        .replace(/\\\//g, '/');
                    console.log(`🖼️ [Instagram] 頭像URL提取成功`);
                    break;
                }
            }

            // 檢查是否為私人帳戶 - 使用更多模式
            const privatePatterns = [
                /"is_private":\s*true/,
                /"private":\s*true/,
                /This Account is Private/i,
                /"account_type":\s*"private"/
            ];
            
            let isPrivate = false;
            for (const pattern of privatePatterns) {
                if (html.match(pattern)) {
                    isPrivate = true;
                    console.log(`🔒 [Instagram] 檢測到私人帳戶`);
                    break;
                }
            }

            // 如果提取到任何有用信息，創建用戶對象
            const hasUsefulData = biography || followerCount > 0 || postCount > 0 || profilePicUrl || posts.length > 0;
            
            console.log(`📊 [Instagram] 正則表達式提取結果:`);
            console.log(`   Bio: "${biography || '無'}"`);
            console.log(`   追蹤者: ${followerCount}`);
            console.log(`   貼文數: ${postCount}`);
            console.log(`   頭像: ${profilePicUrl ? '有' : '無'}`);
            console.log(`   私人: ${isPrivate}`);
            console.log(`   貼文數據: ${posts.length} 篇`);
            console.log(`   有用數據: ${hasUsefulData ? '是' : '否'}`);

            if (hasUsefulData) {
                return {
                    username: this.config.username,
                    biography: biography,
                    followerCount: followerCount,
                    followingCount: 0,
                    postCount: postCount,
                    profilePicUrl: profilePicUrl,
                    isPrivate: isPrivate,
                    posts: posts
                };
            }

            return null;

        } catch (error) {
            console.error('❌ [Instagram] 正則表達式提取失敗:', error.message);
            return null;
        }
    }

    // 增強的貼文數據提取
    extractPostsDataEnhanced(html) {
        try {
            const posts = [];
            console.log(`🔍 [Instagram] 開始增強貼文數據提取...`);
            
            // 方法1: 尋找完整的edge_owner_to_timeline_media
            const postDataPattern = /"edge_owner_to_timeline_media":\s*{\s*"count":\s*(\d+)[^}]*"edges":\s*(\[[^\]]*\])/;
            const postDataMatch = html.match(postDataPattern);
            
            if (postDataMatch) {
                console.log(`📋 [Instagram] 找到edge_owner_to_timeline_media數據`);
                try {
                    const edges = JSON.parse(postDataMatch[2]);
                    console.log(`📋 [Instagram] 解析到 ${edges.length} 個edge`);
                    
                    for (const edge of edges) {
                        const node = edge.node;
                        if (node && node.shortcode) {
                            posts.push({
                                id: node.id,
                                shortcode: node.shortcode,
                                caption: node.edge_media_to_caption?.edges?.[0]?.node?.text || '',
                                displayUrl: node.display_url,
                                isVideo: node.is_video || false,
                                videoUrl: node.video_url || null,
                                timestamp: node.taken_at_timestamp,
                                likeCount: node.edge_liked_by?.count || 0,
                                commentCount: node.edge_media_to_comment?.count || 0
                            });
                            console.log(`   貼文: ${node.shortcode}, 類型: ${node.is_video ? '影片' : '圖片'}`);
                        }
                    }
                } catch (e) {
                    console.warn(`⚠️ [Instagram] 貼文JSON解析失敗: ${e.message}`);
                }
            }

            // 方法2: 尋找所有shortcode
            if (posts.length === 0) {
                console.log(`🔍 [Instagram] 使用shortcode模式提取...`);
                
                const shortcodePatterns = [
                    /"shortcode":"([A-Za-z0-9_-]+)"/g,
                    /"code":"([A-Za-z0-9_-]+)"/g,
                    /\/p\/([A-Za-z0-9_-]+)\//g
                ];
                
                const foundShortcodes = new Set();
                
                for (const pattern of shortcodePatterns) {
                    let match;
                    while ((match = pattern.exec(html)) !== null) {
                        const shortcode = match[1];
                        if (shortcode && shortcode.length >= 8 && !foundShortcodes.has(shortcode)) {
                            foundShortcodes.add(shortcode);
                            posts.push({
                                id: shortcode,
                                shortcode: shortcode,
                                caption: '',
                                displayUrl: `https://www.instagram.com/p/${shortcode}/media/?size=l`,
                                isVideo: false,
                                videoUrl: null,
                                timestamp: Date.now() / 1000,
                                likeCount: 0,
                                commentCount: 0
                            });
                            console.log(`   找到shortcode: ${shortcode}`);
                        }
                    }
                    pattern.lastIndex = 0; // 重置正則表達式
                }
            }

            // 方法3: 尋找圖片URL模式
            if (posts.length === 0) {
                console.log(`🔍 [Instagram] 使用圖片URL模式提取...`);
                
                const imagePattern = /"display_url":"([^"]*instagram[^"]*\.jpg)"/g;
                let imageMatch;
                let imageIndex = 0;
                
                while ((imageMatch = imagePattern.exec(html)) !== null && imageIndex < 10) {
                    const imageUrl = imageMatch[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
                    const shortcode = `img_${Date.now()}_${imageIndex}`;
                    
                    posts.push({
                        id: shortcode,
                        shortcode: shortcode,
                        caption: '',
                        displayUrl: imageUrl,
                        isVideo: false,
                        videoUrl: null,
                        timestamp: Date.now() / 1000,
                        likeCount: 0,
                        commentCount: 0
                    });
                    
                    console.log(`   找到圖片URL: ${imageUrl.substring(0, 50)}...`);
                    imageIndex++;
                }
            }

            console.log(`📋 [Instagram] 最終提取到 ${posts.length} 篇貼文`);
            return posts;

        } catch (error) {
            console.error('❌ [Instagram] 增強貼文數據提取失敗:', error.message);
            return [];
        }
    }

    // 提取貼文數據
    extractPostsData(html) {
        try {
            const posts = [];
            
            // 尋找貼文JSON數據
            const postDataPattern = /"edge_owner_to_timeline_media":\s*{\s*"count":\s*\d+,\s*"page_info":[^}]*,\s*"edges":\s*(\[[^\]]*\])/;
            const match = html.match(postDataPattern);
            
            if (match) {
                try {
                    const edges = JSON.parse(match[1]);
                    for (const edge of edges) {
                        const node = edge.node;
                        if (node && node.shortcode) {
                            posts.push({
                                id: node.id,
                                shortcode: node.shortcode,
                                caption: node.edge_media_to_caption?.edges?.[0]?.node?.text || '',
                                displayUrl: node.display_url,
                                isVideo: node.is_video || false,
                                videoUrl: node.video_url || null,
                                timestamp: node.taken_at_timestamp,
                                likeCount: node.edge_liked_by?.count || 0,
                                commentCount: node.edge_media_to_comment?.count || 0
                            });
                        }
                    }
                    console.log(`📋 [Instagram] 從edge_owner_to_timeline_media提取 ${posts.length} 篇貼文`);
                } catch (e) {
                    console.warn(`⚠️ [Instagram] 貼文JSON解析失敗: ${e.message}`);
                }
            }

            // 如果上面的方法失敗，嘗試其他模式
            if (posts.length === 0) {
                const shortcodePattern = /"shortcode":"([A-Za-z0-9_-]+)"/g;
                const foundShortcodes = new Set();
                let shortcodeMatch;
                
                while ((shortcodeMatch = shortcodePattern.exec(html)) !== null) {
                    const shortcode = shortcodeMatch[1];
                    if (!foundShortcodes.has(shortcode)) {
                        foundShortcodes.add(shortcode);
                        posts.push({
                            id: shortcode, // 暫時使用shortcode作為ID
                            shortcode: shortcode,
                            caption: '',
                            displayUrl: `https://www.instagram.com/p/${shortcode}/media/?size=l`,
                            isVideo: false,
                            videoUrl: null,
                            timestamp: Date.now() / 1000,
                            likeCount: 0,
                            commentCount: 0
                        });
                    }
                }
                console.log(`📋 [Instagram] 從shortcode提取 ${posts.length} 篇貼文`);
            }

            return posts;
        } catch (error) {
            console.error('❌ [Instagram] 貼文數據提取失敗:', error.message);
            return [];
        }
    }

    // 格式化用戶數據
    formatUserData(user) {
        try {
            const posts = [];
            if (user.edge_owner_to_timeline_media?.edges) {
                for (const edge of user.edge_owner_to_timeline_media.edges) {
                    posts.push({
                        id: edge.node.id,
                        shortcode: edge.node.shortcode,
                        caption: edge.node.edge_media_to_caption?.edges?.[0]?.node?.text || '',
                        displayUrl: edge.node.display_url,
                        isVideo: edge.node.is_video || false,
                        videoUrl: edge.node.video_url || null,
                        timestamp: edge.node.taken_at_timestamp,
                        likeCount: edge.node.edge_liked_by?.count || 0,
                        commentCount: edge.node.edge_media_to_comment?.count || 0
                    });
                }
            }

            return {
                username: user.username,
                biography: user.biography || '',
                followerCount: user.edge_followed_by?.count || 0,
                followingCount: user.edge_follow?.count || 0,
                postCount: user.edge_owner_to_timeline_media?.count || 0,
                profilePicUrl: user.profile_pic_url_hd || user.profile_pic_url || '',
                isPrivate: user.is_private || false,
                posts: posts
            };
        } catch (error) {
            console.error('❌ [Instagram] 用戶數據格式化失敗:', error.message);
            return null;
        }
    }

    // 創建空用戶數據
    createEmptyUserData() {
        return {
            isPrivate: false,
            bio: '',
            followerCount: 0,
            followingCount: 0,
            postCount: 0,
            profilePicUrl: '',
            posts: []
        };
    }

    // 檢查新貼文
    async checkForNewPosts(userData) {
        if (!userData.posts || userData.posts.length === 0) {
            console.log(`📋 [Instagram] 無貼文數據可檢查`);
            return null;
        }

        const latestPost = userData.posts[0];
        console.log(`🔍 [Instagram] 檢查最新貼文: ${latestPost.shortcode}`);
        
        if (this.state.lastPostId && this.state.lastPostId !== latestPost.id) {
            this.state.newPostsFound++;
            this.state.lastPostId = latestPost.id;
            
            console.log(`📸 [Instagram] 發現新貼文: ${latestPost.shortcode}`);
            
            // 下載媒體並發送通知
            await this.handleNewPost(latestPost);
            
            return latestPost;
        }

        // 初始化狀態
        if (!this.state.lastPostId) {
            this.state.lastPostId = latestPost.id;
            console.log(`🎯 [Instagram] 初始化最新貼文ID: ${latestPost.shortcode}`);
        }

        return null;
    }

    // 處理新貼文
    async handleNewPost(post) {
        const mediaFiles = [];
        
        try {
            // 下載主要圖片
            if (post.displayUrl) {
                const imageFilename = `post_${post.shortcode}_${Date.now()}.jpg`;
                const downloadedImage = await this.downloadMedia(post.displayUrl, imageFilename);
                mediaFiles.push(downloadedImage);
                console.log(`📥 [Instagram] 已下載圖片: ${imageFilename}`);
            }

            // 如果是影片，也下載影片
            if (post.isVideo && post.videoUrl) {
                const videoFilename = `video_${post.shortcode}_${Date.now()}.mp4`;
                const downloadedVideo = await this.downloadMedia(post.videoUrl, videoFilename);
                mediaFiles.push(downloadedVideo);
                console.log(`📥 [Instagram] 已下載影片: ${videoFilename}`);
            }

            // 發送通知
            await this.sendPostNotification(post, mediaFiles);

        } catch (error) {
            console.error('❌ [Instagram] 新貼文處理失敗:', error.message);
        } finally {
            // 無論成功還是失敗，都要清理檔案
            for (const file of mediaFiles) {
                await this.deleteFile(file);
            }
        }
    }

    // 檢查Bio變更
    async checkBioChange(userData) {
        const newBio = userData.bio || '';
        
        // 跳過HTML元數據
        if (newBio.includes('See Instagram photos and videos') || 
            newBio.includes('Followers, ') || 
            newBio.length === 0) {
            return null;
        }
        
        if (this.state.lastBio && this.state.lastBio !== newBio) {
            this.state.bioChanges++;
            const oldBio = this.state.lastBio;
            this.state.lastBio = newBio;
            
            console.log(`📝 [Instagram] 發現Bio變更`);
            await this.sendBioChangeNotification(oldBio, newBio);
            
            return { oldBio, newBio };
        }

        if (!this.state.lastBio && newBio.length > 0) {
            this.state.lastBio = newBio;
            console.log(`🎯 [Instagram] 初始化Bio: "${newBio.substring(0, 30)}..."`);
        }

        return null;
    }

    // 檢查頭像變更
    async checkProfilePicChange(userData) {
        const newProfilePic = userData.profilePicUrl || '';
        
        if (newProfilePic.length < 10) return null;
        
        if (this.state.lastProfilePic && this.state.lastProfilePic !== newProfilePic) {
            this.state.profilePicChanges++;
            const oldPicUrl = this.state.lastProfilePic;
            this.state.lastProfilePic = newProfilePic;
            
            console.log(`🖼️ [Instagram] 發現頭像變更`);
            
            try {
                const picFilename = `profile_pic_${Date.now()}.jpg`;
                const downloadedPic = await this.downloadMedia(newProfilePic, picFilename);
                await this.sendProfilePicChangeNotification(downloadedPic);
                await this.deleteFile(downloadedPic);
            } catch (error) {
                console.error('❌ [Instagram] 頭像處理失敗:', error.message);
            }
            
            return { oldUrl: oldPicUrl, newUrl: newProfilePic };
        }

        if (!this.state.lastProfilePic && newProfilePic.length > 10) {
            this.state.lastProfilePic = newProfilePic;
            console.log(`🎯 [Instagram] 初始化頭像URL`);
        }

        return null;
    }

    // 發送貼文通知
    async sendPostNotification(post, mediaFiles) {
        const message = `📸 **Instagram 新貼文通知**

👤 **用戶:** @${this.config.username}
🆔 **貼文ID:** ${post.shortcode}
⏰ **發布時間:** ${new Date(post.timestamp * 1000).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
❤️ **讚數:** ${post.likeCount || 0}
💬 **留言數:** ${post.commentCount || 0}
🎥 **類型:** ${post.isVideo ? '影片' : '照片'}

📝 **內容:**
${post.caption ? post.caption.substring(0, 500) + (post.caption.length > 500 ? '...' : '') : '無文字內容'}

🔗 **連結:** https://www.instagram.com/p/${post.shortcode}/`;

        await this.notificationCallback(message, 'new_post', 'Instagram', mediaFiles);
    }

    // 發送Bio變更通知
    async sendBioChangeNotification(oldBio, newBio) {
        const message = `📝 **Instagram Bio 變更通知**

👤 **用戶:** @${this.config.username}
⏰ **變更時間:** ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}

**🔴 舊Bio:**
${oldBio || '(空白)'}

**🟢 新Bio:**
${newBio || '(空白)'}`;

        await this.notificationCallback(message, 'bio_change', 'Instagram');
    }

    // 發送頭像變更通知
    async sendProfilePicChangeNotification(picFilePath) {
        const message = `🖼️ **Instagram 頭像變更通知**

👤 **用戶:** @${this.config.username}
⏰ **變更時間:** ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}

📷 **新頭像已下載 (將在發送後刪除)**`;

        await this.notificationCallback(message, 'profile_pic_change', 'Instagram', [picFilePath]);
    }

    // 主檢查函數
    async performCheck() {
        try {
            this.state.totalChecks++;
            this.state.lastCheck = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
            
            console.log(`🔍 [Instagram] 開始檢查 @${this.config.username} (第${this.state.totalChecks}次)`);

            const userData = await this.fetchInstagramData();
            
            // 更新基本統計
            this.state.isPrivate = userData.isPrivate;
            this.state.followerCount = userData.followerCount;
            this.state.followingCount = userData.followingCount;
            this.state.postCount = userData.postCount;

            // 檢查各種變更
            const newPost = await this.checkForNewPosts(userData);
            const bioChange = await this.checkBioChange(userData);
            const picChange = await this.checkProfilePicChange(userData);

            // 清理臨時檔案
            await this.cleanupTempFiles();

            console.log(`✅ [Instagram] 檢查完成 @${this.config.username}`);
            
        } catch (error) {
            console.error(`❌ [Instagram] 檢查失敗: ${error.message}`);
            
            if (error.message === 'RATE_LIMITED') {
                console.warn('⏸️ [Instagram] 因速率限制暫停監控30分鐘');
                this.pauseMonitoring(30 * 60 * 1000);
            }
        }
    }

    // 暫停監控
    pauseMonitoring(duration) {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }

        setTimeout(() => {
            if (this.isMonitoring) {
                this.startMonitoring();
                console.log('▶️ [Instagram] 監控已恢復');
            }
        }, duration);
    }

    // 開始監控
    startMonitoring() {
        if (this.isMonitoring) {
            console.warn('⚠️ [Instagram] 監控已在運行中');
            return;
        }

        this.isMonitoring = true;
        const checkInterval = this.config.checkInterval || 5 * 60 * 1000;
        
        this.checkInterval = setInterval(() => {
            this.performCheck();
        }, checkInterval);

        // 立即執行一次檢查
        this.performCheck();

        console.log(`🚀 [Instagram] 開始監控 @${this.config.username}`);
        console.log(`⏰ [Instagram] 檢查間隔: ${checkInterval / 60000} 分鐘`);
    }

    // 停止監控
    stopMonitoring() {
        if (!this.isMonitoring) return;

        this.isMonitoring = false;
        
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }

        this.cleanupTempFiles();
        console.log(`🛑 [Instagram] 已停止監控 @${this.config.username}`);
    }

    // 獲取狀態
    getStatus() {
        const checkIntervalMinutes = this.config.checkInterval ? this.config.checkInterval / 60000 : 5;
        
        return {
            isMonitoring: this.isMonitoring,
            username: this.config.username,
            totalChecks: this.state.totalChecks,
            newPostsFound: this.state.newPostsFound,
            bioChanges: this.state.bioChanges,
            profilePicChanges: this.state.profilePicChanges,
            lastCheck: this.state.lastCheck,
            nextCheck: this.isMonitoring ? 
                new Date(Date.now() + (this.config.checkInterval || 5 * 60 * 1000)).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : 
                null,
            checkInterval: `${checkIntervalMinutes} 分鐘`,
            isPrivate: this.state.isPrivate,
            followerCount: this.state.followerCount,
            followingCount: this.state.followingCount,
            postCount: this.state.postCount,
            storageUsage: 'Koyeb臨時存儲 (自動清理)'
        };
    }

    // 測試連接
    async testConnection() {
        try {
            console.log(`🔍 [Instagram] 測試連接 @${this.config.username}...`);
            
            const userData = await this.fetchInstagramData();
            
            return {
                success: true,
                username: this.config.username,
                isPrivate: userData.isPrivate,
                followerCount: userData.followerCount,
                postCount: userData.postCount,
                hasRecentPosts: userData.posts && userData.posts.length > 0,
                latestPostId: userData.posts?.[0]?.shortcode || null,
                bio: userData.bio?.substring(0, 100) || '無Bio'
            };
        } catch (error) {
            return {
                success: false,
                username: this.config.username,
                error: error.message
            };
        }
    }
}

module.exports = InstagramMonitor;