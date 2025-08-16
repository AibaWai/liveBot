// === 更新統一狀態管理 ===
if (instagramMonitor) {
    // 將Instagram狀態添加到統一狀態中
    unifiedState.instagram = {
        configured: true,
        targetUsername: instagramConfig.username,
        mode1Running: false,
        mode2Running: false,
        mode2CooldownUntil: 0,
        totalMode1Checks: 0,
        totalMode2Activations: 0,
        postsDetected: 0,
        storiesBackedUp: 0,
        lastMode1Check: null,
        lastMode2Activation: null,
        sessionValid: false,
        triggerChannels: instagramConfig.triggerChannels
    };
} else {
    unifiedState.instagram = {
        configured: false,
        reason: 'INSTAGRAM_TARGET_USERNAME 未設定'
    };
}

// === 定期更新Instagram狀態 ===
if (instagramMonitor) {
    setInterval(() => {
        try {
            const status = instagramMonitor.getStatus();
            
            // 更新統一狀態
            unifiedState.instagram.mode1Running = status.mode1.運行狀態.includes('✅');
            unifiedState.instagram.mode2Running = status.mode2.運行狀態.includes('🔥');
            unifiedState.instagram.totalMode1Checks = status.mode1.總檢查次數;
            unifiedState.instagram.totalMode2Activations = status.mode2.啟動次數;
            unifiedState.instagram.postsDetected = status.mode1.檢測到的貼文;
            unifiedState.instagram.storiesBackedUp = status.mode2.story備份次數;
            unifiedState.instagram.lastMode1Check = status.mode1.最後檢查時間;
            unifiedState.instagram.lastMode2Activation = status.mode2.最後啟動時間;
            unifiedState.instagram.sessionValid = status.登入憑證.狀態.includes('✅');
            
        } catch (error) {
            console.error('❌ [狀態更新] Instagram狀態更新失敗:', error);
        }
    }, 30000); // 每30秒更新一次
}

// === 更新優雅關閉處理 ===
process.on('SIGINT', async () => {
    console.log('🛑 收到終止信號，正在安全關閉...');
    
    if (blogMonitor) {
        blogMonitor.stopMonitoring();
    }
    
    if (instagramMonitor) {
        await instagramMonitor.stopAll();
    }
    
    if (unifiedState.botReady) {
        await sendNotification('📴 統一監控機器人正在關閉...', 'info', 'System');
    }
    
    client.destroy();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('🛑 收到終止信號，正在安全關閉...');
    
    if (blogMonitor) {
        blogMonitor.stopMonitoring();
    }
    
    if (instagramMonitor) {
        await instagramMonitor.stopAll();
    }
    
    client.destroy();
    process.exit(0);
});
    