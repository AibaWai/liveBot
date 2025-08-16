#!/usr/bin/env python3
# instagram_monitor_mode1.py - 24/7 無登入基礎監控
import json
import time
import requests
import argparse
import sys
from datetime import datetime
import random
import os

class InstagramMode1Monitor:
    def __init__(self, username, config):
        self.username = username
        self.config = config
        self.last_post_data = None
        self.last_bio = None
        self.last_profile_data = None
        
        self.log(f"🚀 Mode1監控初始化完成 - 目標用戶: @{username}")

    def log(self, message, event_type="info"):
        """輸出日誌訊息"""
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        print(f"[{timestamp}] [Mode1] {message}")
        
        # 如果是事件類型，同時輸出JSON格式給Node.js處理
        if event_type != "info":
            event_data = {
                "type": event_type,
                "timestamp": timestamp,
                "username": self.username,
                "message": message
            }
            print(json.dumps(event_data, ensure_ascii=False))

    def get_user_info(self):
        """模擬獲取用戶資訊（簡化版本）"""
        try:
            # 這裡可以實現真正的Instagram抓取邏輯
            # 現在先返回模擬數據避免錯誤
            return {
                'username': self.username,
                'biography': 'Sample bio',
                'recent_posts': [],
                'followers_count': 0,
                'following_count': 0,
                'posts_count': 0
            }
        except Exception as e:
            self.log(f"❌ 獲取用戶資訊失敗: {str(e)}")
            return None

    def check_for_changes(self, current_data):
        """檢查變更"""
        if not current_data:
            return
        
        # 檢查Bio變更
        current_bio = current_data.get('biography', '')
        if self.last_bio is not None and self.last_bio != current_bio:
            self.log(f"✏️ Bio變更檢測: {current_bio[:100]}", "bio_change")
            event_data = {
                "type": "bio_change",
                "username": self.username,
                "old_bio": self.last_bio,
                "new_bio": current_bio,
                "timestamp": datetime.now().isoformat()
            }
            print(json.dumps(event_data, ensure_ascii=False))
        
        self.last_bio = current_bio
        
        # 檢查新貼文
        current_posts = current_data.get('recent_posts', [])
        if current_posts and self.last_post_data and len(current_posts) > 0:
            latest_post = current_posts[0]
            last_known_post = self.last_post_data[0] if len(self.last_post_data) > 0 else None
            
            if last_known_post and latest_post.get('id') != last_known_post.get('id'):
                self.log(f"📸 新貼文檢測", "new_post")
                event_data = {
                    "type": "new_post",
                    "username": self.username,
                    "post_id": latest_post.get('id', 'unknown'),
                    "url": latest_post.get('url', ''),
                    "timestamp": datetime.now().isoformat()
                }
                print(json.dumps(event_data, ensure_ascii=False))
        
        self.last_post_data = current_posts

    def run_monitoring(self):
        """執行監控循環"""
        self.log(f"🔄 開始監控 @{self.username}")
        
        # 初始化檢查
        initial_data = self.get_user_info()
        if initial_data:
            self.last_bio = initial_data.get('biography', '')
            self.last_post_data = initial_data.get('recent_posts', [])
            self.last_profile_data = initial_data.copy()
            self.log("✅ 初始化完成，建立基準數據")
        
        while True:
            try:
                # 隨機延迟
                base_interval = int(self.config.get('interval', 600))
                delay = random.randint(max(base_interval - 120, 60), base_interval + 120)
                
                self.log(f"🔍 檢查用戶資料... (下次檢查: {delay}秒後)")
                
                user_data = self.get_user_info()
                if user_data:
                    self.check_for_changes(user_data)
                    self.log("✅ 檢查完成")
                else:
                    self.log("⚠️ 資料獲取失敗")
                
                # 輸出檢查完成事件
                check_event = {
                    "type": "check_complete",
                    "username": self.username,
                    "success": user_data is not None,
                    "timestamp": datetime.now().isoformat()
                }
                print(json.dumps(check_event, ensure_ascii=False))
                
                time.sleep(delay)
                
            except KeyboardInterrupt:
                self.log("🛑 收到停止信號")
                break
            except Exception as e:
                self.log(f"❌ 監控循環錯誤: {str(e)}")
                time.sleep(300)  # 錯誤時等待5分鐘


def main():
    parser = argparse.ArgumentParser(description='Instagram Mode1 監控 (無登入)')
    parser.add_argument('--username', required=True, help='要監控的Instagram用戶名')
    parser.add_argument('--interval', default='600', help='檢查間隔(秒)')
    parser.add_argument('--check-posts', default='true', help='檢查新貼文')
    parser.add_argument('--check-bio', default='true', help='檢查Bio變更')
    
    # 添加所有可能的參數，即使不使用
    parser.add_argument('--mode', default='1', help='監控模式')
    parser.add_argument('--check-followers', default='false', help='檢查追蹤者變更')
    parser.add_argument('--output-format', default='json', help='輸出格式')
    
    args = parser.parse_args()
    
    config = {
        'interval': args.interval,
        'check_posts': args.check_posts.lower() == 'true',
        'check_bio': args.check_bio.lower() == 'true',
        'mode': args.mode,
        'check_followers': args.check_followers.lower() == 'true',
        'output_format': args.output_format
    }
    
    monitor = InstagramMode1Monitor(args.username, config)
    monitor.run_monitoring()

if __name__ == "__main__":
    main()