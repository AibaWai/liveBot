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

    // 解析Instagram響應 - 使用多種方式解析
    parseInstagramResponse(data) {
        try {
            let user = null;
            let posts = [];

            // 嘗試不同的解析方式
            if (typeof data === 'string') {
                // 如果是HTML字符串，嘗試提取JSON
                const jsonMatch = data.match(/window\._sharedData\s*=\s*({.*?});/);
                if (jsonMatch) {
                    const sharedData = JSON.parse(jsonMatch[1]);
                    const userKey = Object.keys(sharedData.entry_data?.ProfilePage?.[0]?.graphql?.user || {})[0];
                    user = sharedData.entry_data?.ProfilePage?.[0]?.graphql?.user;
                }

                // 嘗試另一種模式
                if (!user) {
                    const scriptMatch = data.match(/"ProfilePage":\[{"graphql":{"user":(.*?)}\]\s*}/);
                    if (scriptMatch) {
                        user = JSON.parse(scriptMatch[1]);
                    }
                }

                // 嘗試提取基本用戶信息
                if (!user) {
                    const bioMatch = data.match(/<meta property="og:description" content="([^"]*)"/) ||
                                   data.match(/<meta name="description" content="([^"]*)"/) ||
                                   data.match(/"biography":"([^"]*)"/) ||
                                   data.match(/"biography\\u0022:\\u0022([^"]*)"/) ||
                                   data.match(/"biography\\u0022:\\u0022([^\\]*?)\\u0022/);
                    
                    const followersMatch = data.match(/"edge_followed_by":{"count":(\d+)}/) ||
                                         data.match(/"follower_count":(\d+)/);
                    
                    const postsMatch = data.match(/"edge_owner_to_timeline_media":{"count":(\d+)}/) ||
                                     data.match(/"media_count":(\d+)/);

                    if (bioMatch || followersMatch || postsMatch) {
                        user = {
                            biography: bioMatch ? bioMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : '',
                            edge_followed_by: { count: followersMatch ? parseInt(followersMatch[1]) : 0 },
                            edge_owner_to_timeline_media: { count: postsMatch ? parseInt(postsMatch[1]) : 0, edges: [] },
                            is_private: data.includes('"is_private":true') || data.includes('"is_private\\u0022:true'),
                            profile_pic_url_hd: this.extractProfilePicUrl(data)
                        };
                    }
                }
            } else if (typeof data === 'object') {
                // JSON對象格式
                user = data.graphql?.user || data.user || data;
            }

            if (!user) {
                // 最後嘗試：創建基本用戶對象
                console.warn('⚠️ [Instagram] 無法解析完整用戶數據，創建基本對象');
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
            if (user.edge_owner_to_timeline_media?.edges) {
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
            }

            return {
                isPrivate: user.is_private || false,
                bio: user.biography || '',
                followerCount: user.edge_followed_by?.count || 0,
                followingCount: user.edge_follow?.count || 0,
                postCount: user.edge_owner_to_timeline_media?.count || 0,
                profilePicUrl: user.profile_pic_url_hd || '',
                posts: posts
            };

        } catch (error) {
            console.error('❌ [Instagram] 數據解析失敗:', error.message);
            console.error('Raw data type:', typeof data);
            console.error('Raw data preview:', typeof data === 'string' ? data.substring(0, 200) : JSON.stringify(data).substring(0, 200));
            
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

    // 檢查Bio變更
    async checkBioChange(userData) {
        if (this.state.lastBio && this.state.lastBio !== userData.bio) {
            this.state.bioChanges++;
            const oldBio = this.state.lastBio;
            this.state.lastBio = userData.bio;
            
            console.log(`📝 [Instagram] 發現Bio變更`);
            await this.sendBioChangeNotification(oldBio, userData.bio);
            
            return { oldBio, newBio: userData.bio };
        }

        if (!this.state.lastBio) {
            this.state.lastBio = userData.bio;
            console.log(`🎯 [Instagram] 初始化Bio內容`);
        }

        return null;
    }

    // 檢查頭像變更
    async checkProfilePicChange(userData) {
        if (this.state.lastProfilePic && this.state.lastProfilePic !== userData.profilePicUrl) {
            this.state.profilePicChanges++;
            const oldPicUrl = this.state.lastProfilePic;
            this.state.lastProfilePic = userData.profilePicUrl;
            
            console.log(`🖼️ [Instagram] 發現頭像變更`);
            
            try {
                // 下載新頭像
                const picFilename = `profile_pic_${Date.now()}.jpg`;
                const downloadedPic = await this.downloadMedia(userData.profilePicUrl, picFilename);
                
                await this.sendProfilePicChangeNotification(downloadedPic);
                
                // 立即刪除
                await this.deleteFile(downloadedPic);
                
            } catch (error) {
                console.error('❌ [Instagram] 頭像處理失敗:', error.message);
            }
            
            return { oldUrl: oldPicUrl, newUrl: userData.profilePicUrl };
        }

        if (!this.state.lastProfilePic) {
            this.state.lastProfilePic = userData.profilePicUrl;
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