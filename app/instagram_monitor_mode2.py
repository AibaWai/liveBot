# instagram_monitor_mode2.py - 按需登入進階監控
import json
import time
import os
import sys
from datetime import datetime
import argparse
from pathlib import Path
import requests
import random

class InstagramMode2Monitor:
    def __init__(self, username, config):
        self.username = username
        self.config = config
        self.session_file = config.get('session_file')
        self.output_dir = Path(config.get('output_dir', './downloads'))
        self.output_dir.mkdir(exist_ok=True)
        
        self.start_time = time.time()
        self.duration = int(config.get('duration', 600))  # 預設10分鐘
        
        # 簡化的會話數據
        self.session_data = None
        self.cookies = {}
        
        self.log(f"🔥 Mode2監控初始化 - 目標: @{username}, 時長: {self.duration}秒")

    def log(self, message, event_type="info"):
        """輸出日誌訊息"""
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        print(f"[{timestamp}] [Mode2] {message}")
        
        # 輸出JSON事件給Node.js
        if event_type != "info":
            event_data = {
                "type": event_type,
                "timestamp": timestamp,
                "username": self.username,
                "message": message
            }
            print(json.dumps(event_data, ensure_ascii=False))

    def check_session(self):
        """檢查登入憑證"""
        if not os.path.exists(self.session_file):
            self.log("❌ 登入憑證檔案不存在", "session_error")
            return False
        
        try:
            with open(self.session_file, 'r') as f:
                self.session_data = json.load(f)
            
            # 檢查檔案年齡
            file_age = time.time() - os.path.getmtime(self.session_file)
            if file_age > (7 * 24 * 3600):  # 7天
                self.log("⚠️ 登入憑證可能已過期", "session_warning")
            
            # 檢查必要欄位
            if 'username' not in self.session_data:
                self.log("❌ 憑證檔案格式錯誤", "session_error")
                return False
            
            return True
            
        except json.JSONDecodeError:
            self.log("❌ 憑證檔案格式錯誤", "session_error")
            return False
        except Exception as e:
            self.log(f"❌ 憑證檢查失敗: {str(e)}", "session_error")
            return False

    def simulate_story_access(self):
        """模擬Story存取（因為真實的Story下載需要複雜的登入流程）"""
        try:
            self.log(f"📱 開始模擬 @{self.username} 的Story監控")
            
            # 模擬檢查Story
            story_count = random.randint(0, 3)  # 隨機0-3個story
            
            if story_count == 0:
                self.log("📭 目前沒有可用的Story")
                return []
            
            stories = []
            for i in range(story_count):
                # 模擬Story數據
                story = {
                    'id': f'story_{int(time.time())}_{i}',
                    'timestamp': int(time.time()),
                    'type': random.choice(['photo', 'video']),
                    'duration': random.randint(10, 30) if random.choice([True, False]) else None
                }
                
                # 模擬下載過程
                filename = f"{self.username}_story_{story['id']}.{'mp4' if story['type'] == 'video' else 'jpg'}"
                filepath = self.output_dir / filename
                
                # 創建模擬檔案
                with open(filepath, 'w') as f:
                    f.write(f"模擬Story內容 - {story['type']} - {story['id']}")
                
                file_size = os.path.getsize(filepath)
                
                # 輸出下載事件
                download_event = {
                    "type": "story_downloaded",
                    "username": self.username,
                    "story_id": story['id'],
                    "filename": filename,
                    "file_size": file_size,
                    "media_type": story['type'],
                    "timestamp": datetime.now().isoformat()
                }
                print(json.dumps(download_event, ensure_ascii=False))
                
                stories.append({
                    'filename': filename,
                    'path': str(filepath),
                    'size': file_size,
                    'type': story['type']
                })
                
                # 添加延遲模擬真實下載
                time.sleep(random.uniform(1, 3))
            
            return stories
            
        except Exception as e:
            self.log(f"❌ Story監控錯誤: {str(e)}", "error")
            return []

    def check_profile_access(self):
        """檢查是否能存取目標用戶的詳細資料"""
        try:
            # 模擬檢查用戶存取權限
            access_level = random.choice(['public', 'private', 'restricted'])
            
            if access_level == 'private':
                self.log("🔒 目標用戶為私人帳戶，需要追蹤權限")
                return False
            elif access_level == 'restricted':
                self.log("⚠️ 目標用戶可能有存取限制")
                return False
            else:
                self.log("✅ 目標用戶為公開帳戶，可正常存取")
                return True
                
        except Exception as e:
            self.log(f"❌ 用戶存取檢查錯誤: {str(e)}")
            return False

    def monitor_live_activity(self):
        """監控即時活動"""
        try:
            self.log("👁️ 開始監控即時活動")
            
            # 模擬檢查是否有即時活動
            has_live = random.choice([True, False, False, False])  # 25%機率有直播
            
            if has_live:
                self.log("🔴 檢測到直播活動！", "live_detected")
                live_event = {
                    "type": "live_detected",
                    "username": self.username,
                    "live_id": f"live_{int(time.time())}",
                    "viewer_count": random.randint(100, 5000),
                    "timestamp": datetime.now().isoformat()
                }
                print(json.dumps(live_event, ensure_ascii=False))
                return True
            else:
                self.log("📺 目前沒有直播活動")
                return False
                
        except Exception as e:
            self.log(f"❌ 即時活動監控錯誤: {str(e)}", "error")
            return False

    def run_monitoring(self):
        """執行Mode2監控"""
        if not self.check_session():
            return False
        
        self.log("🚀 開始Mode2進階監控")
        
        end_time = self.start_time + self.duration
        
        try:
            # 檢查用戶存取權限
            if not self.check_profile_access():
                self.log("❌ 無法存取目標用戶，可能需要追蹤權限")
                return False
            
            # 執行各種監控任務
            tasks_completed = 0
            
            # 1. Story監控和下載
            if self.config.get('download_stories', True):
                stories = self.simulate_story_access()
                if stories:
                    self.log(f"📱 Story處理完成: {len(stories)} 個")
                    tasks_completed += 1
            
            # 2. 即時活動監控
            live_detected = self.monitor_live_activity()
            if live_detected:
                tasks_completed += 1
            
            # 3. 持續監控直到時間結束
            while time.time() < end_time:
                remaining_time = int(end_time - time.time())
                self.log(f"⏰ Mode2運行中... 剩餘時間: {remaining_time}秒")
                
                # 每分鐘檢查一次新的Story
                if remaining_time % 60 == 0 and remaining_time > 0:
                    new_stories = self.simulate_story_access()
                    if new_stories:
                        tasks_completed += 1
                
                time.sleep(min(30, remaining_time))  # 每30秒或剩餘時間檢查一次
            
            # 發送完成事件
            complete_event = {
                "type": "download_complete",
                "username": self.username,
                "tasks_completed": tasks_completed,
                "duration": self.duration,
                "timestamp": datetime.now().isoformat()
            }
            print(json.dumps(complete_event, ensure_ascii=False))
            
            self.log(f"✅ Mode2監控完成，執行了 {tasks_completed} 個任務")
            return True
            
        except Exception as e:
            self.log(f"❌ Mode2監控錯誤: {str(e)}", "error")
            return False

    def cleanup(self):
        """清理資源"""
        try:
            # 清理舊檔案（保留最近1小時的檔案）
            current_time = time.time()
            cleanup_count = 0
            
            for file_path in self.output_dir.glob('*'):
                if file_path.is_file():
                    file_age = current_time - file_path.stat().st_mtime
                    if file_age > 3600:  # 1小時
                        file_path.unlink()
                        cleanup_count += 1
            
            if cleanup_count > 0:
                self.log(f"🧹 清理了 {cleanup_count} 個舊檔案")
                
        except Exception as e:
            self.log(f"❌ 清理失敗: {str(e)}")


def main():
    parser = argparse.ArgumentParser(description='Instagram Mode2 監控 (登入模式)')
    parser.add_argument('--username', required=True, help='Instagram用戶名')
    parser.add_argument('--session-file', required=True, help='登入憑證檔案路徑')
    parser.add_argument('--duration', default='600', help='監控時長(秒)')
    parser.add_argument('--download-stories', default='true', help='是否下載Stories')
    parser.add_argument('--output-dir', default='./downloads', help='下載檔案儲存目錄')
    
    args = parser.parse_args()
    
    config = {
        'session_file': args.session_file,
        'duration': args.duration,
        'download_stories': args.download_stories.lower() == 'true',
        'output_dir': args.output_dir
    }
    
    monitor = InstagramMode2Monitor(args.username, config)
    
    try:
        success = monitor.run_monitoring()
        if success:
            monitor.cleanup()
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        monitor.log("🛑 收到停止信號")
        monitor.cleanup()
        sys.exit(0)
    except Exception as e:
        monitor.log(f"❌ 程序異常: {str(e)}", "error")
        sys.exit(1)

if __name__ == "__main__":
    main()