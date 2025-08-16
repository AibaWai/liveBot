// instagram_dynamic_monitor.js
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class DynamicInstagramMonitor {
    constructor(config, notificationCallback) {
        this.config = config;
        this.notificationCallback = notificationCallback;
        
        // 監控狀態
        this.mode1Process = null;  // 24/7 基礎監控
        this.mode2Process = null;  // 按需進階監控
        this.isMode1Running = false;
        this.isMode2Running = false;
        
        // 模式2 控制
        this.mode2Timer = null;
        this.mode2Duration = 10 * 60 * 1000; // 10分鐘
        this.mode2CooldownUntil = 0;
        this.mode2CooldownDuration = 30 * 60 * 1000; // 30分鐘冷卻
        
        // 統計資料
        this.stats = {
            mode1: {
                啟動時間: null,
                總檢查次數: 0,
                檢測到的貼文: 0,
                bio變更次數: 0,
                最後檢查時間: null
            },
            mode2: {
                啟動次數: 0,
                總運行時間: 0,
                story備份次數: 0,
                最後啟動時間: null,
                下次可用時間: null
            }
        };
        
        // 登入憑證狀態
        this.sessionStatus = {
            有效: false,
            最後檢查: null,
            錯誤次數: 0
        };
    }

    /**
     * 啟動 Mode 1 - 24/7 基礎監控
     */
    async startMode1() {
        if (this.isMode1Running) {
            console.log('📸 [Mode1] 已在運行中，跳過啟動');
            return;
        }

        try {
            console.log('🚀 [Mode1] 啟動 24/7 基礎監控 (無登入模式)');
            
            // Validate username first
            if (!this.config.username || this.config.username === 'undefined') {
                throw new Error('Instagram用戶名未配置或無效');
            }
            
            const pythonArgs = [
                path.join(__dirname, 'instagram_monitor_mode1.py'),
                '--username', this.config.username,
                '--interval', this.config.mode1Interval || '600',
                '--check-posts', 'true',
                '--check-bio', 'true',
                '--mode', '1',
                '--check-followers', 'false',
                '--output-format', 'json'
            ];

            this.mode1Process = spawn('python3', pythonArgs);
            
            this.mode1Process.stdout.on('data', (data) => {
                this.handleMode1Output(data.toString());
            });

            this.mode1Process.stderr.on('data', (data) => {
                console.error('❌ [Mode1] 錯誤:', data.toString());
            });

            this.mode1Process.on('exit', (code) => {
                console.log(`🛑 [Mode1] 程序結束，退出碼: ${code}`);
                this.isMode1Running = false;
                
                // 如果非正常退出，嘗試重啟
                if (code !== 0) {
                    console.log('🔄 [Mode1] 5分鐘後嘗試重新啟動...');
                    setTimeout(() => this.startMode1(), 5 * 60 * 1000);
                }
            });

            this.isMode1Running = true;
            this.stats.mode1.啟動時間 = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' });
            
            await this.notificationCallback(
                '✅ **Instagram Mode1 監控已啟動**\n📱 24/7 無登入監控：貼文、Bio變更',
                'monitor_start',
                'Instagram'
            );
            
        } catch (error) {
            console.error('❌ [Mode1] 啟動失敗:', error.message);
            this.isMode1Running = false;
            throw error; // Re-throw to let caller handle
        }
    }

    /**
     * 啟動 Mode 2 - 按需進階監控
     */
    async startMode2(triggerReason = '手動觸發') {
        // 檢查冷卻時間
        const now = Date.now();
        if (now < this.mode2CooldownUntil) {
            const remainingMinutes = Math.ceil((this.mode2CooldownUntil - now) / 60000);
            console.log(`⏳ [Mode2] 冷卻中，還需等待 ${remainingMinutes} 分鐘`);
            await this.notificationCallback(
                `⏳ **Mode2 冷卻中**\n還需等待 ${remainingMinutes} 分鐘才能啟動`,
                'cooldown_warning',
                'Instagram'
            );
            return false;
        }

        // 檢查 Mode2 是否已在運行
        if (this.isMode2Running) {
            console.log('📸 [Mode2] 已在運行中');
            return false;
        }

        try {
            console.log(`🚀 [Mode2] 啟動進階監控 - 觸發原因: ${triggerReason}`);
            
            // 檢查登入憑證
            const sessionValid = await this.checkSessionCredentials();
            if (!sessionValid) {
                throw new Error('登入憑證無效或已過期');
            }

            const pythonArgs = [
                path.join(__dirname, 'instagram_monitor_mode2.py'),
                '--username', this.config.username,
                '--mode', '2',
                '--session-file', this.config.sessionFile,
                '--download-stories', 'true',
                '--download-highlights', 'false',
                '--output-dir', path.join(__dirname, 'downloads'),
                '--duration', (this.mode2Duration / 1000).toString(), // 轉換為秒
                '--output-format', 'json'
            ];

            this.mode2Process = spawn('python3', pythonArgs);
            
            this.mode2Process.stdout.on('data', (data) => {
                this.handleMode2Output(data.toString());
            });

            this.mode2Process.stderr.on('data', (data) => {
                console.error('❌ [Mode2] 錯誤:', data.toString());
            });

            this.mode2Process.on('exit', (code) => {
                console.log(`🛑 [Mode2] 程序結束，退出碼: ${code}`);
                this.stopMode2(false);
            });

            this.isMode2Running = true;
            this.stats.mode2.啟動次數++;
            this.stats.mode2.最後啟動時間 = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' });
            
            // 設定自動停止計時器
            this.mode2Timer = setTimeout(() => {
                this.stopMode2(true);
            }, this.mode2Duration);

            await this.notificationCallback(
                `🔥 **Instagram Mode2 已啟動**\n🎯 觸發原因: ${triggerReason}\n⏰ 運行時間: ${this.mode2Duration / 60000} 分鐘\n📱 功能: Story備份、進階監控`,
                'mode2_start',
                'Instagram'
            );

            return true;
            
        } catch (error) {
            console.error('❌ [Mode2] 啟動失敗:', error);
            await this.notificationCallback(
                `❌ **Mode2 啟動失敗**\n錯誤: ${error.message}`,
                'mode2_error',
                'Instagram'
            );
            return false;
        }
    }

    /**
     * 停止 Mode 2
     */
    stopMode2(isAutoStop = false) {
        if (!this.isMode2Running) return;

        console.log(`🛑 [Mode2] 停止進階監控 - ${isAutoStop ? '自動停止' : '手動停止'}`);
        
        if (this.mode2Process) {
            this.mode2Process.kill('SIGTERM');
            this.mode2Process = null;
        }

        if (this.mode2Timer) {
            clearTimeout(this.mode2Timer);
            this.mode2Timer = null;
        }

        this.isMode2Running = false;
        
        // 設定冷卻時間
        this.mode2CooldownUntil = Date.now() + this.mode2CooldownDuration;
        this.stats.mode2.下次可用時間 = new Date(this.mode2CooldownUntil).toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' });

        this.notificationCallback(
            `🛑 **Mode2 已停止**\n冷卻時間: ${this.mode2CooldownDuration / 60000} 分鐘`,
            'mode2_stop',
            'Instagram'
        );
    }

    /**
     * 處理 Mode 1 輸出
     */
    handleMode1Output(output) {
        try {
            const lines = output.trim().split('\n');
            
            for (const line of lines) {
                if (line.startsWith('{')) {
                    const data = JSON.parse(line);
                    this.processMode1Event(data);
                } else {
                    console.log('[Mode1]', line);
                }
            }
        } catch (error) {
            console.error('❌ [Mode1] 輸出解析錯誤:', error);
        }
    }

    /**
     * 處理 Mode 2 輸出
     */
    handleMode2Output(output) {
        try {
            const lines = output.trim().split('\n');
            
            for (const line of lines) {
                if (line.startsWith('{')) {
                    const data = JSON.parse(line);
                    this.processMode2Event(data);
                } else {
                    console.log('[Mode2]', line);
                }
            }
        } catch (error) {
            console.error('❌ [Mode2] 輸出解析錯誤:', error);
        }
    }

    /**
     * 處理 Mode 1 事件
     */
    async processMode1Event(data) {
        this.stats.mode1.總檢查次數++;
        this.stats.mode1.最後檢查時間 = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' });

        switch (data.type) {
            case 'new_post':
                this.stats.mode1.檢測到的貼文++;
                await this.notificationCallback(
                    `📸 **新貼文檢測** @${data.username}\n🆕 ${data.post_type}: ${data.caption || '無文字描述'}\n🔗 ${data.url}`,
                    'new_post',
                    'Instagram'
                );
                break;

            case 'bio_change':
                this.stats.mode1.bio變更次數++;
                await this.notificationCallback(
                    `✏️ **Bio變更檢測** @${data.username}\n📝 新Bio: ${data.new_bio}`,
                    'bio_change',
                    'Instagram'
                );
                break;

            case 'profile_change':
                await this.notificationCallback(
                    `👤 **個人資料變更** @${data.username}\n📋 變更內容: ${data.changes.join(', ')}`,
                    'profile_change',
                    'Instagram'
                );
                break;

            case 'error':
                console.error('[Mode1] 監控錯誤:', data.message);
                break;
        }
    }

    /**
     * 處理 Mode 2 事件
     */
    async processMode2Event(data) {
        switch (data.type) {
            case 'story_downloaded':
                this.stats.mode2.story備份次數++;
                await this.notificationCallback(
                    `💾 **Story已備份** @${data.username}\n📁 檔案: ${data.filename}\n📏 大小: ${data.file_size}\n⏰ 時間: ${data.timestamp}`,
                    'story_backup',
                    'Instagram'
                );
                break;

            case 'download_complete':
                await this.notificationCallback(
                    `✅ **下載完成** @${data.username}\n📱 Story數量: ${data.story_count}\n📁 總大小: ${data.total_size}`,
                    'download_complete',
                    'Instagram'
                );
                break;

            case 'session_expired':
                this.sessionStatus.有效 = false;
                await this.notificationCallback(
                    `⚠️ **登入憑證已過期**\n需要重新登入才能使用 Mode2 功能`,
                    'session_expired',
                    'Instagram'
                );
                this.stopMode2(false);
                break;

            case 'error':
                console.error('[Mode2] 監控錯誤:', data.message);
                if (data.message.includes('login') || data.message.includes('session')) {
                    this.sessionStatus.錯誤次數++;
                }
                break;
        }
    }

    /**
     * 檢查登入憑證狀態
     */
    async checkSessionCredentials() {
        try {
            const sessionFile = this.config.sessionFile;
            if (!fs.existsSync(sessionFile)) {
                console.log('❌ [Session] 憑證檔案不存在');
                return false;
            }

            // 檢查檔案修改時間（簡單的有效性檢查）
            const stats = fs.statSync(sessionFile);
            const fileAge = Date.now() - stats.mtime.getTime();
            const maxAge = 7 * 24 * 60 * 60 * 1000; // 7天

            if (fileAge > maxAge) {
                console.log('⚠️ [Session] 憑證檔案過舊，可能已失效');
                this.sessionStatus.有效 = false;
                return false;
            }

            this.sessionStatus.有效 = true;
            this.sessionStatus.最後檢查 = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' });
            return true;

        } catch (error) {
            console.error('❌ [Session] 憑證檢查失敗:', error);
            this.sessionStatus.有效 = false;
            return false;
        }
    }

    /**
     * 處理觸發器（Discord訊息）
     */
    async handleDiscordTrigger(message, triggerType) {
        const content = message.content.toLowerCase();
        
        switch (triggerType) {
            case 'story_alert':
                if (content.includes('story') || content.includes('限時動態')) {
                    console.log('🔔 [觸發器] 檢測到Story通知，啟動Mode2');
                    return await this.startMode2('Story通知觸發');
                }
                break;

            case 'live_alert':
                if (content.includes('live') || content.includes('直播') || content.includes('went live')) {
                    console.log('🔴 [觸發器] 檢測到直播通知，啟動Mode2');
                    return await this.startMode2('直播通知觸發');
                }
                break;

            case 'manual_command':
                if (content.startsWith('!ig-mode2')) {
                    console.log('👤 [觸發器] 手動命令觸發Mode2');
                    return await this.startMode2('手動命令觸發');
                }
                break;
        }
        
        return false;
    }

    /**
     * 獲取監控狀態
     */
    getStatus() {
        return {
            mode1: {
                運行狀態: this.isMode1Running ? '✅ 運行中' : '❌ 已停止',
                ...this.stats.mode1
            },
            mode2: {
                運行狀態: this.isMode2Running ? '🔥 運行中' : '💤 待機中',
                冷卻狀態: Date.now() < this.mode2CooldownUntil ? '⏳ 冷卻中' : '✅ 可用',
                ...this.stats.mode2
            },
            登入憑證: {
                狀態: this.sessionStatus.有效 ? '✅ 有效' : '❌ 無效',
                ...this.sessionStatus
            },
            目標用戶: this.config.username,
            當前時間: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Tokyo' })
        };
    }

    /**
     * 停止所有監控
     */
    async stopAll() {
        console.log('🛑 [系統] 停止所有Instagram監控');
        
        if (this.mode1Process) {
            this.mode1Process.kill('SIGTERM');
            this.isMode1Running = false;
        }
        
        if (this.mode2Process) {
            this.stopMode2(false);
        }

        await this.notificationCallback(
            '🛑 **所有Instagram監控已停止**',
            'monitor_stop',
            'Instagram'
        );
    }
}

module.exports = DynamicInstagramMonitor;