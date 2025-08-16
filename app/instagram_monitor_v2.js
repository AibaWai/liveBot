const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');

class InstagramMonitorV2 {
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
            postCount: null,
            instaloaderInstalled: false
        };

        // 確保臨時目錄存在
        this.ensureTempDir();
        
        // 檢查並安裝 instaloader
        this.setupInstaloader();
    }

    async ensureTempDir() {
        try {
            await fs.mkdir(this.tempDir, { recursive: true });
            console.log(`📁 [Instagram] 臨時目錄已建立: ${this.tempDir}`);
        } catch (error) {
            console.error('❌ [Instagram] 臨時目錄建立失敗:', error.message);
        }
    }

    // 安裝和設置 instaloader
    async setupInstaloader() {
        try {
            console.log('🔧 [Instagram] 檢查 instaloader 安裝狀態...');
            
            // 檢查 Python 是否可用
            const pythonCheck = await this.runCommand('python3', ['--version']);
            if (!pythonCheck.success) {
                console.error('❌ [Instagram] Python3 未安裝');
                console.error('請確保容器中安裝了 Python3');
                return;
            }
            console.log(`✅ [Instagram] ${pythonCheck.output}`);

            // 檢查 instaloader 是否已安裝
            const instaloaderCheck = await this.runCommand('python3', ['-c', 'import instaloader; print("instaloader version:", instaloader.__version__)']);
            
            if (instaloaderCheck.success) {
                console.log(`✅ [Instagram] ${instaloaderCheck.output}`);
                this.state.instaloaderInstalled = true;
            } else {
                console.log('📦 [Instagram] instaloader 未安裝，嘗試安裝...');
                
                // 嘗試多種安裝方式
                const installMethods = [
                    ['pip3', ['install', '--user', 'instaloader']],
                    ['pip3', ['install', 'instaloader']],
                    ['python3', ['-m', 'pip', 'install', '--user', 'instaloader']],
                    ['python3', ['-m', 'pip', 'install', 'instaloader']]
                ];
                
                let installSuccess = false;
                
                for (const [cmd, args] of installMethods) {
                    console.log(`🔄 [Instagram] 嘗試: ${cmd} ${args.join(' ')}`);
                    const installResult = await this.runCommand(cmd, args, { timeout: 120000 });
                    
                    if (installResult.success) {
                        // 再次檢查是否安裝成功
                        const verifyCheck = await this.runCommand('python3', ['-c', 'import instaloader; print("安裝成功")']);
                        if (verifyCheck.success) {
                            console.log('✅ [Instagram] instaloader 安裝成功');
                            this.state.instaloaderInstalled = true;
                            installSuccess = true;
                            break;
                        }
                    } else {
                        console.warn(`⚠️ [Instagram] ${cmd} 安裝失敗: ${installResult.error}`);
                    }
                }
                
                if (!installSuccess) {
                    console.error('❌ [Instagram] 所有安裝方法都失敗');
                    console.error('建議在 Dockerfile 中預先安裝 instaloader');
                }
            }

        } catch (error) {
            console.error('❌ [Instagram] instaloader 設置失敗:', error.message);
        }
    }

    // 執行命令行指令
    async runCommand(command, args = [], options = {}) {
        return new Promise((resolve) => {
            const timeout = options.timeout || 30000;
            const child = spawn(command, args, {
                cwd: options.cwd || this.tempDir,
                env: { ...process.env, ...options.env }
            });

            let output = '';
            let error = '';

            child.stdout?.on('data', (data) => {
                output += data.toString();
            });

            child.stderr?.on('data', (data) => {
                error += data.toString();
            });

            const timer = setTimeout(() => {
                child.kill('SIGKILL');
                resolve({
                    success: false,
                    output: output.trim(),
                    error: 'Command timeout'
                });
            }, timeout);

            child.on('close', (code) => {
                clearTimeout(timer);
                resolve({
                    success: code === 0,
                    output: output.trim(),
                    error: error.trim(),
                    code
                });
            });

            child.on('error', (err) => {
                clearTimeout(timer);
                resolve({
                    success: false,
                    output: output.trim(),
                    error: err.message
                });
            });
        });
    }

    // 使用 instaloader 獲取用戶資料
    async fetchInstagramData() {
        if (!this.state.instaloaderInstalled) {
            throw new Error('instaloader 未正確安裝');
        }

        try {
            const username = this.config.username;
            console.log(`🔍 [Instagram] 使用 instaloader 獲取 @${username} 的數據...`);
            
            // 創建 Python 腳本來獲取用戶資料
            const pythonScript = this.generatePythonScript();
            const scriptPath = path.join(this.tempDir, 'fetch_instagram_data.py');
            
            await fs.writeFile(scriptPath, pythonScript);
            
            // 執行 Python 腳本
            const result = await this.runCommand('python3', [scriptPath, username], { timeout: 60000 });
            
            if (!result.success) {
                console.error('❌ [Instagram] Python 腳本執行失敗:', result.error);
                throw new Error(result.error || 'Python 腳本執行失敗');
            }

            // 解析 JSON 輸出
            const userData = JSON.parse(result.output);
            console.log(`✅ [Instagram] 數據獲取成功: @${username}`);
            
            return userData;

        } catch (error) {
            console.error('❌ [Instagram] 數據獲取失敗:', error.message);
            
            if (error.message.includes('429') || error.message.includes('rate limit')) {
                throw new Error('RATE_LIMITED');
            }
            
            throw error;
        }
    }

    // 生成 Python 腳本
    generatePythonScript() {
        return `#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import instaloader
import json
import sys
import os
from datetime import datetime

def fetch_user_data(username):
    try:
        # 建立 instaloader 實例
        L = instaloader.Instaloader(
            download_pictures=False,
            download_videos=False,
            download_video_thumbnails=False,
            download_geotags=False,
            download_comments=False,
            save_metadata=False,
            compress_json=False,
            dirname_pattern="{target}",
            filename_pattern="{shortcode}"
        )
        
        # 設置請求延遲以避免被封鎖
        L.context.request_timeout = (4, 10)
        
        try:
            # 獲取用戶資料
            profile = instaloader.Profile.from_username(L.context, username)
            
            # 獲取最新貼文
            posts = []
            post_count = 0
            for post in profile.get_posts():
                if post_count >= 3:  # 只取前3篇貼文
                    break
                
                posts.append({
                    'id': post.mediaid,
                    'shortcode': post.shortcode,
                    'caption': post.caption or '',
                    'display_url': post.url,
                    'is_video': post.is_video,
                    'video_url': post.video_url if post.is_video else None,
                    'timestamp': int(post.date_utc.timestamp()),
                    'like_count': post.likes,
                    'comment_count': post.comments,
                    'typename': post.typename
                })
                post_count += 1
            
            # 組織用戶數據
            user_data = {
                'username': profile.username,
                'biography': profile.biography or '',
                'follower_count': profile.followers,
                'following_count': profile.followees,
                'post_count': profile.mediacount,
                'profile_pic_url': profile.profile_pic_url,
                'is_private': profile.is_private,
                'posts': posts,
                'success': True,
                'fetch_time': datetime.now().isoformat()
            }
            
            return user_data
            
        except instaloader.exceptions.ProfileNotExistsException:
            return {
                'success': False,
                'error': f'用戶 @{username} 不存在',
                'error_type': 'ProfileNotExists'
            }
        except instaloader.exceptions.LoginRequiredException:
            return {
                'success': False,
                'error': '此用戶為私人帳戶，需要登入',
                'error_type': 'LoginRequired'
            }
        except instaloader.exceptions.ConnectionException as e:
            return {
                'success': False,
                'error': f'連接錯誤: {str(e)}',
                'error_type': 'ConnectionError'
            }
        except instaloader.exceptions.TooManyRequestsException:
            return {
                'success': False,
                'error': '請求過於頻繁，請稍後再試',
                'error_type': 'RateLimit'
            }
            
    except Exception as e:
        return {
            'success': False,
            'error': f'未知錯誤: {str(e)}',
            'error_type': 'Unknown'
        }

if __name__ == '__main__':
    if len(sys.argv) != 2:
        print(json.dumps({
            'success': False,
            'error': '使用方式: python3 fetch_instagram_data.py <username>'
        }))
        sys.exit(1)
    
    username = sys.argv[1]
    result = fetch_user_data(username)
    print(json.dumps(result, ensure_ascii=False, indent=None))
`;
    }

    // 下載媒體檔案
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

    // 清理臨時檔案
    async cleanupTempFiles() {
        try {
            const files = await fs.readdir(this.tempDir);
            let cleanedCount = 0;
            
            for (const file of files) {
                const filePath = path.join(this.tempDir, file);
                const stats = await fs.stat(filePath);
                
                // 刪除超過1小時的檔案，或是 .py 腳本檔案
                const isOld = (Date.now() - stats.mtime.getTime()) > 3600000;
                const isPythonScript = file.endsWith('.py');
                const isMediaFile = file.match(/\.(jpg|jpeg|png|mp4|mov)$/i);
                
                if (isOld || isPythonScript || isMediaFile) {
                    await fs.unlink(filePath);
                    cleanedCount++;
                }
            }
            
            if (cleanedCount > 0) {
                console.log(`🧹 [Instagram] 已清理 ${cleanedCount} 個臨時檔案`);
            }
        } catch (error) {
            console.error('❌ [Instagram] 清理臨時檔案失敗:', error.message);
        }
    }

    // 刪除單個檔案
    async deleteFile(filePath) {
        try {
            await fs.unlink(filePath);
            console.log(`🗑️ [Instagram] 已刪除檔案: ${path.basename(filePath)}`);
        } catch (error) {
            console.error(`❌ [Instagram] 檔案刪除失敗: ${error.message}`);
        }
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
            // 下載主要圖片/影片
            if (post.display_url) {
                const extension = post.is_video ? 'mp4' : 'jpg';
                const filename = `${post.shortcode}_${Date.now()}.${extension}`;
                const downloadedFile = await this.downloadMedia(post.display_url, filename);
                mediaFiles.push(downloadedFile);
                console.log(`📥 [Instagram] 已下載 ${post.is_video ? '影片' : '圖片'}: ${filename}`);
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
        const newBio = userData.biography || '';
        
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
        const newProfilePic = userData.profile_pic_url || '';
        
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
        const postDate = new Date(post.timestamp * 1000);
        const message = `📸 **Instagram 新貼文通知**

👤 **用戶:** @${this.config.username}
🆔 **貼文ID:** ${post.shortcode}
⏰ **發布時間:** ${postDate.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
❤️ **讚數:** ${post.like_count || 0}
💬 **留言數:** ${post.comment_count || 0}
🎥 **類型:** ${post.is_video ? '影片' : '照片'}

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
            
            if (!userData.success) {
                console.error(`❌ [Instagram] 數據獲取失敗: ${userData.error}`);
                
                if (userData.error_type === 'RateLimit') {
                    throw new Error('RATE_LIMITED');
                } else if (userData.error_type === 'LoginRequired') {
                    console.warn('⚠️ [Instagram] 用戶為私人帳戶，無法監控');
                    return;
                }
                
                throw new Error(userData.error);
            }
            
            // 更新基本統計
            this.state.isPrivate = userData.is_private;
            this.state.followerCount = userData.follower_count;
            this.state.followingCount = userData.following_count;
            this.state.postCount = userData.post_count;

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

        if (!this.state.instaloaderInstalled) {
            console.error('❌ [Instagram] instaloader 未安裝，無法啟動監控');
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
        console.log(`🛠️ [Instagram] 使用 instaloader 引擎`);
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
            storageUsage: 'Koyeb臨時存儲 (自動清理)',
            instaloaderInstalled: this.state.instaloaderInstalled,
            engine: 'instaloader'
        };
    }

    // 測試連接
    async testConnection() {
        try {
            console.log(`🔍 [Instagram] 測試連接 @${this.config.username}...`);
            
            if (!this.state.instaloaderInstalled) {
                return {
                    success: false,
                    username: this.config.username,
                    error: 'instaloader 未正確安裝'
                };
            }
            
            const userData = await this.fetchInstagramData();
            
            if (!userData.success) {
                return {
                    success: false,
                    username: this.config.username,
                    error: userData.error,
                    error_type: userData.error_type
                };
            }
            
            return {
                success: true,
                username: this.config.username,
                isPrivate: userData.is_private,
                followerCount: userData.follower_count,
                postCount: userData.post_count,
                hasRecentPosts: userData.posts && userData.posts.length > 0,
                latestPostId: userData.posts?.[0]?.shortcode || null,
                bio: userData.biography?.substring(0, 100) || '無Bio',
                engine: 'instaloader'
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

module.exports = InstagramMonitorV2;