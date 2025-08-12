// 前端JavaScript - 狀態頁面互動邏輯

class StatusPage {
    constructor() {
        this.refreshInterval = 30000; // 30秒刷新
        this.timeUpdateInterval = 1000; // 1秒更新時間
        this.init();
    }

    init() {
        this.startTimeUpdater();
        this.startAutoRefresh();
        this.setupEventListeners();
        this.updatePageTitle();
    }

    // 實時更新日本時間
    startTimeUpdater() {
        const updateTime = () => {
            const now = new Date();
            const japanTime = now.toLocaleString('ja-JP', { 
                timeZone: 'Asia/Tokyo',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            
            // 更新頁面中的時間顯示
            const timeElements = document.querySelectorAll('#japanTime, #currentTime');
            timeElements.forEach(element => {
                if (element) element.textContent = japanTime;
            });

            // 更新最後更新時間
            const lastUpdateElement = document.getElementById('lastUpdate');
            if (lastUpdateElement) {
                lastUpdateElement.textContent = japanTime;
            }
        };

        updateTime();
        setInterval(updateTime, this.timeUpdateInterval);
    }

    // 自動刷新頁面
    startAutoRefresh() {
        setTimeout(() => {
            this.refreshPage();
        }, this.refreshInterval);
    }

    // 刷新頁面數據
    async refreshPage() {
        try {
            // 顯示加載指示器
            this.showLoadingIndicator();
            
            // 獲取最新數據
            const response = await fetch('/api/status');
            if (response.ok) {
                const data = await response.json();
                this.updatePageData(data);
            } else {
                console.error('Failed to fetch status data');
                // 如果API失敗，就直接刷新頁面
                location.reload();
            }
        } catch (error) {
            console.error('Error refreshing data:', error);
            // 出錯時刷新整個頁面
            location.reload();
        } finally {
            this.hideLoadingIndicator();
        }
    }

    // 更新頁面數據（局部更新，避免整頁刷新）
    updatePageData(data) {
        try {
            // 更新直播狀態
            this.updateLiveStatus(data.instagram.is_live);
            
            // 更新統計數據
            this.updateStats(data);
            
            // 更新帳號狀態
            if (data.instagram.account_details) {
                this.updateAccountStatus(data.instagram.account_details);
            }
            
            // 更新Discord統計
            this.updateDiscordStats(data.discord);
            
            console.log('Page data updated successfully');
        } catch (error) {
            console.error('Error updating page data:', error);
            // 如果局部更新失敗，刷新整頁
            location.reload();
        }
    }

    // 更新直播狀態
    updateLiveStatus(isLive) {
        const liveIndicator = document.querySelector('.live-indicator');
        if (liveIndicator) {
            if (isLive) {
                liveIndicator.className = 'live-indicator live-yes';
                liveIndicator.innerHTML = '🔴 正在直播!';
            } else {
                liveIndicator.className = 'live-indicator live-no';
                liveIndicator.innerHTML = '⚫ 離線中';
            }
        }
    }

    // 更新統計數據
    updateStats(data) {
        // 更新數字統計
        const statUpdates = {
            'totalRequests': data.instagram.total_requests || 0,
            'consecutiveErrors': data.instagram.consecutive_errors || 0,
            'invalidCookieAccounts': data.instagram.invalid_cookie_accounts || 0,
            'availableAccounts': data.instagram.available_accounts || 0,
            'totalAccounts': data.instagram.total_accounts || 0,
            'dailyRequests': data.instagram.daily_requests || 0,
            'maxDailyRequests': data.instagram.max_daily_requests || 0,
            'discordMessages': data.notifications.discord_messages || 0,
            'phoneCallsMade': data.notifications.phone_calls || 0,
            'totalMessagesProcessed': data.discord.total_messages_processed || 0,
            'totalDetections': data.discord.total_detections || 0
        };

        Object.entries(statUpdates).forEach(([key, value]) => {
            const elements = document.querySelectorAll(`[data-stat="${key}"], .stat-number[data-type="${key}"]`);
            elements.forEach(element => {
                if (element) element.textContent = value;
            });
        });

        // 更新狀態值
        const statusUpdates = {
            'monitoring-status': data.instagram.is_monitoring ? '✅ 運行中' : '❌ 已停止',
            'bot-status': data.system.bot_ready ? '✅ 在線' : '❌ 離線',
            'last-notification': data.notifications.last_notification || '無'
        };

        Object.entries(statusUpdates).forEach(([key, value]) => {
            const element = document.querySelector(`[data-status="${key}"]`);
            if (element) element.textContent = value;
        });
    }

    // 更新帳號狀態
    updateAccountStatus(accountDetails) {
        accountDetails.forEach(account => {
            const accountCard = document.querySelector(`[data-account="${account.id}"]`);
            if (accountCard) {
                // 更新連續使用次數
                const consecutiveUsesElement = accountCard.querySelector('[data-consecutive-uses]');
                if (consecutiveUsesElement) {
                    consecutiveUsesElement.textContent = `${account.consecutiveUses}/${account.rotationThreshold}`;
                    
                    // 添加警告樣式
                    if (account.consecutiveUses >= account.rotationThreshold - 2) {
                        consecutiveUsesElement.classList.add('rotation-warning');
                    } else {
                        consecutiveUsesElement.classList.remove('rotation-warning');
                    }
                }

                // 更新帳號狀態類
                const statusClasses = ['active', 'disabled', 'cooldown', 'current-account'];
                statusClasses.forEach(cls => accountCard.classList.remove(cls));
                
                if (account.cookieStatus === 'Invalid') {
                    accountCard.classList.add('disabled');
                } else if (account.inCooldown) {
                    accountCard.classList.add('cooldown');
                } else {
                    accountCard.classList.add('active');
                }
                
                if (account.isCurrentlyUsed) {
                    accountCard.classList.add('current-account');
                }
            }
        });
    }

    // 更新Discord統計
    updateDiscordStats(discordData) {
        // 更新頻道統計
        if (discordData.channel_stats) {
            Object.entries(discordData.channel_stats).forEach(([channelId, stats]) => {
                const channelCard = document.querySelector(`[data-channel="${channelId}"]`);
                if (channelCard) {
                    const updates = {
                        'messages-processed': stats.messagesProcessed || 0,
                        'keywords-detected': stats.keywordsDetected || 0,
                        'calls-made': stats.callsMade || 0,
                        'last-detection': stats.lastDetection || '無'
                    };

                    Object.entries(updates).forEach(([key, value]) => {
                        const element = channelCard.querySelector(`[data-${key}]`);
                        if (element) element.textContent = value;
                    });
                }
            });
        }
    }

    // 顯示加載指示器
    showLoadingIndicator() {
        const indicator = document.getElementById('loadingIndicator');
        if (!indicator) {
            const div = document.createElement('div');
            div.id = 'loadingIndicator';
            div.className = 'loading-indicator';
            div.innerHTML = '🔄 更新中...';
            div.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: rgba(76, 175, 80, 0.9);
                color: white;
                padding: 10px 20px;
                border-radius: 5px;
                z-index: 1000;
                font-size: 14px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.3);
            `;
            document.body.appendChild(div);
        }
    }

    // 隱藏加載指示器
    hideLoadingIndicator() {
        const indicator = document.getElementById('loadingIndicator');
        if (indicator) {
            indicator.remove();
        }
    }

    // 設置事件監聽器
    setupEventListeners() {
        // 手動刷新按鈕
        const refreshButton = document.getElementById('manualRefresh');
        if (refreshButton) {
            refreshButton.addEventListener('click', () => {
                this.refreshPage();
            });
        }

        // 鍵盤快捷鍵
        document.addEventListener('keydown', (e) => {
            if (e.key === 'F5' || (e.ctrlKey && e.key === 'r')) {
                e.preventDefault();
                this.refreshPage();
            }
        });

        // 可見性API - 當頁面變為可見時刷新
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                this.refreshPage();
            }
        });
    }

    // 更新頁面標題（顯示直播狀態）
    updatePageTitle() {
        const updateTitle = async () => {
            try {
                const response = await fetch('/api/status');
                if (response.ok) {
                    const data = await response.json();
                    const isLive = data.instagram.is_live;
                    const username = data.instagram.target;
                    
                    if (isLive) {
                        document.title = `🔴 ${username} 直播中 - 監控機器人`;
                    } else {
                        document.title = `⚫ ${username} 離線 - 監控機器人`;
                    }
                }
            } catch (error) {
                console.error('Error updating title:', error);
            }
        };

        updateTitle();
        setInterval(updateTitle, 60000); // 每分鐘更新一次標題
    }

    // 添加通知功能（如果支持）
    requestNotificationPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }

    // 發送桌面通知
    sendNotification(title, message) {
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(title, {
                body: message,
                icon: '/favicon.ico',
                badge: '/favicon.ico'
            });
        }
    }

    // 檢查直播狀態變化並發送通知
    checkLiveStatusChange(newStatus) {
        const lastStatus = localStorage.getItem('lastLiveStatus');
        if (lastStatus !== null && lastStatus !== newStatus.toString()) {
            if (newStatus) {
                this.sendNotification('🔴 開始直播!', '您關注的用戶開始直播了！');
            } else {
                this.sendNotification('⚫ 直播結束', '直播已結束');
            }
        }
        localStorage.setItem('lastLiveStatus', newStatus.toString());
    }
}

// 頁面加載完成後初始化
document.addEventListener('DOMContentLoaded', () => {
    const statusPage = new StatusPage();
    
    // 請求通知權限
    statusPage.requestNotificationPermission();
    
    console.log('Status page initialized');
});

// 添加一些實用的全局函數
window.StatusUtils = {
    // 格式化時間差
    formatTimeDifference: (timestamp) => {
        const now = Date.now();
        const diff = now - timestamp;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (days > 0) return `${days}天前`;
        if (hours > 0) return `${hours}小時前`;
        if (minutes > 0) return `${minutes}分鐘前`;
        return '剛剛';
    },

    // 格式化數字
    formatNumber: (num) => {
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return num.toString();
    },

    // 複製文本到剪貼板
    copyToClipboard: async (text) => {
        try {
            await navigator.clipboard.writeText(text);
            console.log('Text copied to clipboard');
            return true;
        } catch (err) {
            console.error('Failed to copy text: ', err);
            return false;
        }
    }
};