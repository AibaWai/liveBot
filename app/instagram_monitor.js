const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

class InstagramMonitor {
    constructor(notificationCallback, config) {
        this.notificationCallback = notificationCallback;
        this.config = config;
        this.isMonitoring = false;
        this.checkInterval = null;
        this.tempDir = '/tmp/instagram_cache'; // 使用臨時目錄
        
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
            console.log(`🧹 [Instagram] 已清理 ${files.length} 個臨時檔案`);
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
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
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

    // 獲取Instagram用戶資料 - 改進版本
    async fetchInstagramData() {
        try {
            // 嘗試多種不同的URL和方法
            const urls = [
                `https://www.instagram.com/${this.config.username}/`,
                `https://www.instagram.com/${this.config.username}/?__a=1`,
                `https://i.instagram.com/api/v1/users/web_profile_info/?username=${this.config.username}`
            ];

            let lastError = null;

            for (const url of urls) {
                try {
                    console.log(`🔍 [Instagram] 嘗試URL: ${url}`);
                    
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
                            'Cache-Control': 'no-cache'
                        },
                        timeout: 30000,
                        maxRedirects: 5
                    });

                    if (response.status === 200 && response.data) {
                        console.log(`✅ [Instagram] 成功獲取數據，URL: ${url}`);
                        console.log(`📊 [Instagram] 響應類型: ${typeof response.data}, 長度: ${typeof response.data === 'string' ? response.data.length : JSON.stringify(response.data).length}`);
                        
                        const userData = this.parseInstagramResponse(response.data);
                        
                        // 驗證解析結果
                        if (userData && (userData.bio !== undefined || userData.followerCount > 0 || userData.postCount > 0)) {
                            console.log(`✅ [Instagram] 數據解析成功`);
                            console.log(`📊 [Instagram] 解析結果: Bio長度=${userData.bio ? userData.bio.length : 0}, 追蹤者=${userData.followerCount}, 貼文=${userData.postCount}`);
                            return userData;
                        } else {
                            console.warn(`⚠️ [Instagram] 數據解析結果無效，嘗試下一個URL`);
                        }
                    }
                } catch (error) {
                    lastError = error;
                    console.warn(`⚠️ [Instagram] URL ${url} 失敗: ${error.message}`);
                    
                    // 如果是429錯誤，直接拋出
                    if (error.response?.status === 429) {
                        throw new Error('RATE_LIMITED');
                    }
                }
            }

            // 如果所有URL都失敗，嘗試最後的備用方案
            console.log(`🔄 [Instagram] 嘗試備用數據獲取方式...`);
            return await this.fallbackDataFetch();

        } catch (error) {
            console.error('❌ [Instagram] 數據獲取失敗:', error.message);
            
            // 如果是429錯誤，需要延長檢查間隔
            if (error.message === 'RATE_LIMITED' || error.response?.status === 429) {
                console.warn('⚠️ [Instagram] 達到請求限制，延長檢查間隔');
                throw new Error('RATE_LIMITED');
            }
            
            throw error;
        }
    }

    // 備用數據獲取方法
    async fallbackDataFetch() {
        try {
            console.log(`🔄 [Instagram] 使用備用方法獲取基本信息...`);
            
            // 創建基本用戶對象，包含最小必要信息
            const basicUserData = {
                isPrivate: false,
                bio: `監控中的用戶: @${this.config.username}`,
                followerCount: 0,
                followingCount: 0,
                postCount: 0,
                profilePicUrl: '',
                posts: []
            };

            console.log(`📊 [Instagram] 備用數據已準備`);
            return basicUserData;

        } catch (error) {
            console.error('❌ [Instagram] 備用數據獲取也失敗:', error.message);
            throw error;
        }
    }

    // 解析Instagram響應 - 改進版本
    parseInstagramResponse(data) {
        try {
            let user = null;
            let posts = [];

            console.log(`🔍 [Instagram] 開始解析數據，類型: ${typeof data}, 長度: ${typeof data === 'string' ? data.length : 'N/A'}`);

            // 嘗試不同的解析方式
            if (typeof data === 'string') {
                // 方法1: 尋找 window._sharedData
                const sharedDataMatch = data.match(/window\._sharedData\s*=\s*({.*?});/);
                if (sharedDataMatch) {
                    try {
                        const sharedData = JSON.parse(sharedDataMatch[1]);
                        user = sharedData.entry_data?.ProfilePage?.[0]?.graphql?.user;
                        if (user) {
                            console.log(`✅ [Instagram] 使用 window._sharedData 解析成功`);
                        }
                    } catch (e) {
                        console.warn(`⚠️ [Instagram] window._sharedData 解析失敗: ${e.message}`);
                    }
                }

                // 方法2: 尋找 ProfilePage JSON
                if (!user) {
                    const profilePageMatch = data.match(/"ProfilePage":\[({.*?})\]/);
                    if (profilePageMatch) {
                        try {
                            const profileData = JSON.parse(profilePageMatch[1]);
                            user = profileData.graphql?.user;
                            if (user) {
                                console.log(`✅ [Instagram] 使用 ProfilePage 解析成功`);
                            }
                        } catch (e) {
                            console.warn(`⚠️ [Instagram] ProfilePage 解析失敗: ${e.message}`);
                        }
                    }
                }

                // 方法3: 正則表達式提取基本信息
                if (!user) {
                    console.log(`🔍 [Instagram] 嘗試正則表達式提取...`);
                    
                    // 提取Bio
                    const bioPatterns = [
                        /<meta property="og:description" content="([^"]*)"[^>]*>/,
                        /<meta name="description" content="([^"]*)"[^>]*>/,
                        /"biography":"([^"]*?)"/,
                        /"biography\\u0022:\\u0022([^"]*?)\\u0022/
                    ];
                    
                    let biography = '';
                    for (const pattern of bioPatterns) {
                        const match = data.match(pattern);
                        if (match && match[1]) {
                            biography = match[1]
                                .replace(/\\n/g, '\n')
                                .replace(/\\"/g, '"')
                                .replace(/\\u0040/g, '@')
                                .replace(/&#064;/g, '@');
                            console.log(`📝 [Instagram] Bio提取成功: "${biography.substring(0, 50)}..."`);
                            break;
                        }
                    }
                    
                    // 提取追蹤者數量
                    const followerPatterns = [
                        /"edge_followed_by":\s*{\s*"count":\s*(\d+)/,
                        /"follower_count":\s*(\d+)/,
                        /(\d+)\s+Followers?/i
                    ];
                    
                    let followerCount = 0;
                    for (const pattern of followerPatterns) {
                        const match = data.match(pattern);
                        if (match && match[1]) {
                            followerCount = parseInt(match[1]);
                            console.log(`👥 [Instagram] 追蹤者數提取成功: ${followerCount}`);
                            break;
                        }
                    }
                    
                    // 提取貼文數量
                    const postCountPatterns = [
                        /"edge_owner_to_timeline_media":\s*{\s*"count":\s*(\d+)/,
                        /"media_count":\s*(\d+)/,
                        /(\d+)\s+Posts?/i
                    ];
                    
                    let postCount = 0;
                    for (const pattern of postCountPatterns) {
                        const match = data.match(pattern);
                        if (match && match[1]) {
                            postCount = parseInt(match[1]);
                            console.log(`📸 [Instagram] 貼文數提取成功: ${postCount}`);
                            break;
                        }
                    }
                    
                    // 提取頭像URL
                    const profilePicPatterns = [
                        /"profile_pic_url_hd":"([^"]+)"/,
                        /"profile_pic_url":"([^"]+)"/,
                        /<meta property="og:image" content="([^"]+)"/
                    ];
                    
                    let profilePicUrl = '';
                    for (const pattern of profilePicPatterns) {
                        const match = data.match(pattern);
                        if (match && match[1]) {
                            profilePicUrl = match[1]
                                .replace(/\\u0026/g, '&')
                                .replace(/\\u002F/g, '/');
                            console.log(`🖼️ [Instagram] 頭像URL提取成功`);
                            break;
                        }
                    }
                    
                    // 檢查是否為私人帳戶
                    const isPrivate = data.includes('"is_private":true') || 
                                     data.includes('"is_private\\u0022:true') ||
                                     data.includes('This Account is Private');
                    
                    // 如果提取到任何有用信息，創建用戶對象
                    if (biography || followerCount > 0 || postCount > 0 || profilePicUrl) {
                        user = {
                            biography: biography,
                            edge_followed_by: { count: followerCount },
                            edge_follow: { count: 0 }, // 無法從頁面提取追蹤中數量
                            edge_owner_to_timeline_media: { count: postCount, edges: [] },
                            is_private: isPrivate,
                            profile_pic_url_hd: profilePicUrl
                        };
                        console.log(`✅ [Instagram] 正則表達式提取成功`);
                    }
                }

                // 方法4: 尋找貼文數據
                if (user && user.edge_owner_to_timeline_media?.count > 0) {
                    console.log(`🔍 [Instagram] 嘗試提取貼文數據...`);
                    
                    // 尋找貼文JSON數據
                    const postDataPatterns = [
                        /"edge_owner_to_timeline_media":\s*{\s*"count":\s*\d+,\s*"page_info":[^}]*,\s*"edges":\s*(\[[^\]]*\])/,
                        /"shortcode_media":\s*({[^}]*"shortcode"[^}]*})/g
                    ];
                    
                    for (const pattern of postDataPatterns) {
                        const matches = data.match(pattern);
                        if (matches) {
                            try {
                                // 這裡需要更複雜的JSON解析
                                console.log(`📋 [Instagram] 找到潛在貼文數據`);
                                break;
                            } catch (e) {
                                console.warn(`⚠️ [Instagram] 貼文數據解析失敗: ${e.message}`);
                            }
                        }
                    }
                }

            } else if (typeof data === 'object') {
                // JSON對象格式
                user = data.graphql?.user || data.user || data;
                console.log(`✅ [Instagram] JSON對象解析`);
            }

            if (!user) {
                console.warn('⚠️ [Instagram] 所有解析方法都失敗，創建基本對象');
                user = {
                    biography: '',
                    edge_followed_by: { count: 0 },
                    edge_follow: { count: 0 },
                    edge_owner_to_timeline_media: { count: 0, edges: [] },
                    is_private: false,
                    profile_pic_url_hd: ''
                };
            }

            // 解析貼文數據
            if (user.edge_owner_to_timeline_media?.edges && Array.isArray(user.edge_owner_to_timeline_media.edges)) {
                posts = user.edge_owner_to_timeline_media.edges.map(edge => ({
                    id: edge.node.id,
                    shortcode: edge.node.shortcode,
                    caption: edge.node.edge_media_to_caption?.edges?.[0]?.node?.text || '',
                    displayUrl: edge.node.display_url,
                    isVideo: edge.node.is_video || false,
                    videoUrl: edge.node.video_url || null,
                    timestamp: edge.node.taken_at_timestamp,
                    likeCount: edge.node.edge_liked_by?.count || 0,
                    commentCount: edge.node.edge_media_to_comment?.count || 0
                }));
                console.log(`📋 [Instagram] 解析了 ${posts.length} 篇貼文`);
            }

            const result = {
                isPrivate: user.is_private || false,
                bio: user.biography || '',
                followerCount: user.edge_followed_by?.count || 0,
                followingCount: user.edge_follow?.count || 0,
                postCount: user.edge_owner_to_timeline_media?.count || 0,
                profilePicUrl: user.profile_pic_url_hd || '',
                posts: posts
            };

            console.log(`📊 [Instagram] 最終解析結果:`);
            console.log(`   Bio: "${result.bio.substring(0, 30)}${result.bio.length > 30 ? '...' : ''}"`);
            console.log(`   追蹤者: ${result.followerCount}`);
            console.log(`   貼文: ${result.postCount}`);
            console.log(`   私人: ${result.isPrivate}`);
            console.log(`   實際貼文數據: ${result.posts.length}`);

            return result;

        } catch (error) {
            console.error('❌ [Instagram] 數據解析失敗:', error.message);
            console.error('Raw data preview:', typeof data === 'string' ? data.substring(0, 300) : JSON.stringify(data).substring(0, 300));
            
            // 返回基本空對象而不是拋出錯誤
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
    }

    // 提取頭像URL
    extractProfilePicUrl(htmlData) {
        const patterns = [
            /"profile_pic_url_hd":"([^"]+)"/,
            /"profile_pic_url":"([^"]+)"/,
            /<meta property="og:image" content="([^"]+)"/,
            /"profilePicUrl":"([^"]+)"/
        ];

        for (const pattern of patterns) {
            const match = htmlData.match(pattern);
            if (match) {
                return match[1].replace(/\\u0026/g, '&').replace(/\\u002F/g, '/');
            }
        }

        return '';
    }

    // 檢查新貼文
    async checkForNewPosts(userData) {
        if (!userData.posts || userData.posts.length === 0) {
            return null;
        }

        const latestPost = userData.posts[0];
        
        if (this.state.lastPostId && this.state.lastPostId !== latestPost.id) {
            this.state.newPostsFound++;
            this.state.lastPostId = latestPost.id;
            
            console.log(`📸 [Instagram] 發現新貼文: ${latestPost.shortcode}`);
            
            // 下載媒體
            const mediaFiles = [];
            try {
                const mediaFilename = `post_${latestPost.shortcode}_${Date.now()}.jpg`;
                const downloadedFile = await this.downloadMedia(latestPost.displayUrl, mediaFilename);
                mediaFiles.push(downloadedFile);

                // 如果是影片，也下載影片
                if (latestPost.isVideo && latestPost.videoUrl) {
                    const videoFilename = `video_${latestPost.shortcode}_${Date.now()}.mp4`;
                    const downloadedVideo = await this.downloadMedia(latestPost.videoUrl, videoFilename);
                    mediaFiles.push(downloadedVideo);
                }

                // 發送通知
                await this.sendPostNotification(latestPost, mediaFiles);

                // 立即清理檔案
                for (const file of mediaFiles) {
                    await this.deleteFile(file);
                }

            } catch (error) {
                console.error('❌ [Instagram] 貼文處理失敗:', error.message);
                
                // 清理已下載的檔案
                for (const file of mediaFiles) {
                    await this.deleteFile(file);
                }
            }

            return latestPost;
        }

        // 初始化狀態
        if (!this.state.lastPostId) {
            this.state.lastPostId = latestPost.id;
            console.log(`🎯 [Instagram] 初始化最新貼文ID: ${latestPost.shortcode}`);
        }

        return null;
    }

    // 檢查Bio變更 - 改進版本
    async checkBioChange(userData) {
        // 過濾掉明顯的HTML解析錯誤
        let cleanBio = userData.bio || '';
        
        // 移除常見的HTML元數據模式
        const htmlPatterns = [
            /^\d+\s+Followers,\s+\d+\s+Following,\s+\d+\s+Posts\s+-\s+See Instagram photos and videos from.*$/i,
            /^See photos, videos and more on Instagram\.$/i,
            /^.*&#064;.*$/,  // 包含HTML實體的
            /^監控中的用戶:.*$/  // 備用數據模式
        ];
        
        let isMeaningfulBio = true;
        for (const pattern of htmlPatterns) {
            if (pattern.test(cleanBio)) {
                console.log(`⚠️ [Instagram] 檢測到HTML元數據Bio，忽略: "${cleanBio.substring(0, 50)}..."`);
                isMeaningfulBio = false;
                break;
            }
        }
        
        // 只在有意義的Bio變更時才處理
        if (isMeaningfulBio && this.state.lastBio && this.state.lastBio !== cleanBio) {
            // 確保兩個Bio都不是HTML元數據
            let lastBioMeaningful = true;
            for (const pattern of htmlPatterns) {
                if (pattern.test(this.state.lastBio)) {
                    lastBioMeaningful = false;
                    break;
                }
            }
            
            if (lastBioMeaningful) {
                this.state.bioChanges++;
                const oldBio = this.state.lastBio;
                this.state.lastBio = cleanBio;
                
                console.log(`📝 [Instagram] 發現真實Bio變更`);
                console.log(`   舊: "${oldBio.substring(0, 30)}..."`);
                console.log(`   新: "${cleanBio.substring(0, 30)}..."`);
                
                await this.sendBioChangeNotification(oldBio, cleanBio);
                return { oldBio, newBio: cleanBio };
            }
        }

        // 初始化狀態（只在有意義的Bio時）
        if (!this.state.lastBio && isMeaningfulBio && cleanBio.length > 0) {
            this.state.lastBio = cleanBio;
            console.log(`🎯 [Instagram] 初始化Bio內容: "${cleanBio.substring(0, 30)}..."`);
        }

        return null;
    }

    // 檢查頭像變更 - 改進版本
    async checkProfilePicChange(userData) {
        // 過濾無效的頭像URL
        const profilePicUrl = userData.profilePicUrl || '';
        
        if (!profilePicUrl || profilePicUrl.length < 10) {
            console.log(`⚠️ [Instagram] 頭像URL無效，跳過檢查: "${profilePicUrl}"`);
            return null;
        }
        
        if (this.state.lastProfilePic && this.state.lastProfilePic !== profilePicUrl) {
            // 確保兩個URL都是有效的
            if (this.state.lastProfilePic.length > 10) {
                this.state.profilePicChanges++;
                const oldPicUrl = this.state.lastProfilePic;
                this.state.lastProfilePic = profilePicUrl;
                
                console.log(`🖼️ [Instagram] 發現頭像變更`);
                console.log(`   舊URL: ${oldPicUrl.substring(0, 50)}...`);
                console.log(`   新URL: ${profilePicUrl.substring(0, 50)}...`);
                
                try {
                    // 下載新頭像
                    const picFilename = `profile_pic_${Date.now()}.jpg`;
                    const downloadedPic = await this.downloadMedia(profilePicUrl, picFilename);
                    
                    await this.sendProfilePicChangeNotification(downloadedPic);
                    
                    // 立即刪除
                    await this.deleteFile(downloadedPic);
                    
                } catch (error) {
                    console.error('❌ [Instagram] 頭像處理失敗:', error.message);
                }
                
                return { oldUrl: oldPicUrl, newUrl: profilePicUrl };
            }
        }

        // 初始化狀態（只在有效URL時）
        if (!this.state.lastProfilePic && profilePicUrl.length > 10) {
            this.state.lastProfilePic = profilePicUrl;
            console.log(`🎯 [Instagram] 初始化頭像URL: ${profilePicUrl.substring(0, 50)}...`);
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

            // 清理臨時檔案（預防性清理）
            await this.cleanupTempFiles();

            console.log(`✅ [Instagram] 檢查完成 @${this.config.username}`);
            
        } catch (error) {
            console.error(`❌ [Instagram] 檢查失敗: ${error.message}`);
            
            if (error.message === 'RATE_LIMITED') {
                // 如果遇到速率限制，暫停監控一段時間
                console.warn('⏸️ [Instagram] 因速率限制暫停監控30分鐘');
                this.pauseMonitoring(30 * 60 * 1000); // 30分鐘
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
        
        // 設定檢查間隔 (建議5-10分鐘，避免被限制)
        const checkInterval = this.config.checkInterval || 5 * 60 * 1000; // 預設5分鐘
        
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
        if (!this.isMonitoring) {
            return;
        }

        this.isMonitoring = false;
        
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }

        // 清理所有臨時檔案
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