# instagram_monitor_mode1.py - 24/7 無登入基礎監控
import json
import time
import requests
import argparse
import sys
from datetime import datetime
import random
import os
from urllib.parse import quote
import re

class InstagramMode1Monitor:
    def __init__(self, username, config):
        self.username = username
        self.config = config
        self.last_post_data = None
        self.last_bio = None
        self.last_profile_data = None
        self.session = requests.Session()
        
        # 防檢測設定
        self.user_agents = [
            'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
            'Mozilla/5.0 (Android 12; Mobile; rv:92.0) Gecko/92.0 Firefox/92.0',
            'Mozilla/5.0 (iPhone; CPU iPhone OS 14_7_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1',
            'Mozilla/5.0 (Linux; Android 11; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36'
        ]
        
        self.request_count = 0
        self.start_time = time.time()
        
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

    def get_random_headers(self):
        """獲取隨機請求標頭"""
        return {
            'User-Agent': random.choice(self.user_agents),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Cache-Control': 'max-age=0'
        }

    def check_rate_limit(self):
        """檢查請求頻率限制"""
        self.request_count += 1
        elapsed_hours = (time.time() - self.start_time) / 3600
        
        if elapsed_hours > 0:
            requests_per_hour = self.request_count / elapsed_hours
            if requests_per_hour > 15:  # 每小時限制15次請求
                self.log("⚠️ 請求頻率過高，強制等待...")
                time.sleep(300)  # 等待5分鐘

    def get_user_info(self):
        """獲取用戶基本資訊（無需登入）"""
        try:
            self.check_rate_limit()
            
            # 使用Instagram的公開端點
            url = f"https://www.instagram.com/{self.username}/"
            headers = self.get_random_headers()
            
            # 添加隨機延遲
            delay = random.uniform(2, 5)
            time.sleep(delay)
            
            response = self.session.get(url, headers=headers, timeout=30)
            
            if response.status_code == 200:
                html_content = response.text
                return self.parse_instagram_page(html_content)
                
            elif response.status_code == 429:
                self.log("❌ 請求被限制 (429)，等待重試...")
                time.sleep(900)  # 等待15分鐘
                return None
            elif response.status_code == 404:
                self.log("❌ 用戶不存在或帳戶私人")
                return None
            else:
                self.log(f"❌ HTTP錯誤: {response.status_code}")
                return None
                
        except requests.exceptions.RequestException as e:
            self.log(f"❌ 網路請求錯誤: {str(e)}")
            return None
        except Exception as e:
            self.log(f"❌ 未預期錯誤: {str(e)}")
            return None

    def parse_instagram_page(self, html_content):
        """解析Instagram頁面"""
        try:
            # 尋找JSON數據
            patterns = [
                r'window\._sharedData\s*=\s*({.*?});',
                r'window\.__additionalDataLoaded\([^,]+,\s*({.*?})\);',
                r'"profilePage_(\d+)":\s*({.*?"user":.*?})',
            ]
            
            user_data = None
            
            for pattern in patterns:
                matches = re.finditer(pattern, html_content, re.DOTALL)
                for match in matches:
                    try:
                        json_str = match.group(1) if len(match.groups()) == 1 else match.group(2)
                        data = json.loads(json_str)
                        user_data = self.extract_user_from_json(data)
                        if user_data:
                            break
                    except json.JSONDecodeError:
                        continue
                if user_data:
                    break
            
            # 備用解析方法
            if not user_data:
                user_data = self.parse_html_fallback(html_content)
            
            return user_data
            
        except Exception as e:
            self.log(f"❌ 頁面解析錯誤: {str(e)}")
            return None

    def extract_user_from_json(self, data):
        """從JSON數據中提取用戶信息"""
        try:
            # 處理不同的JSON結構
            user_info = None
            
            # 嘗試從 _sharedData 結構提取
            if 'entry_data' in data and 'ProfilePage' in data['entry_data']:
                profile_page = data['entry_data']['ProfilePage'][0]
                if 'graphql' in profile_page and 'user' in profile_page['graphql']:
                    user_info = profile_page['graphql']['user']
            
            # 嘗試直接從 user 欄位提取
            elif 'user' in data:
                user_info = data['user']
            
            # 嘗試從其他可能的結構提取
            elif 'data' in data and 'user' in data['data']:
                user_info = data['data']['user']
            
            if user_info:
                return self.format_user_data(user_info)
                
        except Exception as e:
            self.log(f"❌ JSON用戶數據提取錯誤: {str(e)}")
        
        return None

    def format_user_data(self, user_info):
        """格式化用戶數據"""
        try:
            # 提取基本信息
            formatted_data = {
                'id': user_info.get('id'),
                'username': user_info.get('username'),
                'full_name': user_info.get('full_name', ''),
                'biography': user_info.get('biography', ''),
                'profile_pic_url': user_info.get('profile_pic_url', ''),
                'is_private': user_info.get('is_private', False),
                'is_verified': user_info.get('is_verified', False),
                'followers_count': self.extract_count(user_info, 'edge_followed_by'),
                'following_count': self.extract_count(user_info, 'edge_follow'),
                'posts_count': self.extract_count(user_info, 'edge_owner_to_timeline_media'),
                'recent_posts': []
            }
            
            # 提取最近貼文
            if not user_info.get('is_private', False):
                formatted_data['recent_posts'] = self.extract_recent_posts(user_info)
            
            return formatted_data
            
        except Exception as e:
            self.log(f"❌ 用戶數據格式化錯誤: {str(e)}")
            return None

    def extract_count(self, user_info, edge_key):
        """提取計數信息"""
        try:
            if edge_key in user_info and 'count' in user_info[edge_key]:
                return user_info[edge_key]['count']
        except:
            pass
        return 0

    def extract_recent_posts(self, user_info):
        """提取最近的貼文"""
        try:
            posts = []
            timeline_media = user_info.get('edge_owner_to_timeline_media', {})
            edges = timeline_media.get('edges', [])
            
            for edge in edges[:5]:  # 只取最近5篇
                try:
                    node = edge['node']
                    post = {
                        'id': node.get('id'),
                        'shortcode': node.get('shortcode'),
                        'timestamp': node.get('taken_at_timestamp'),
                        'caption': '',
                        'like_count': self.extract_count(node, 'edge_liked_by'),
                        'comment_count': self.extract_count(node, 'edge_media_to_comment'),
                        'url': f"https://www.instagram.com/p/{node.get('shortcode')}/" if node.get('shortcode') else '',
                        'media_type': self.determine_media_type(node)
                    }
                    
                    # 提取caption
                    caption_edges = node.get('edge_media_to_caption', {}).get('edges', [])
                    if caption_edges:
                        post['caption'] = caption_edges[0]['node'].get('text', '')
                    
                    posts.append(post)
                except Exception as e:
                    self.log(f"⚠️ 解析單個貼文失敗: {str(e)}")
                    continue
            
            return posts
            
        except Exception as e:
            self.log(f"❌ 貼文提取錯誤: {str(e)}")
            return []

    def determine_media_type(self, node):
        """判斷媒體類型"""
        try:
            if node.get('is_video', False):
                return 'video'
            elif node.get('edge_sidecar_to_children'):
                return 'carousel'
            else:
                return 'photo'
        except:
            return 'unknown'

    def parse_html_fallback(self, html_content):
        """備用HTML解析方法"""
        try:
            # 使用正則表達式提取基本資訊
            username_match = re.search(r'"username":"([^"]+)"', html_content)
            username = username_match.group(1) if username_match else self.username
            
            bio_match = re.search(r'"biography":"([^"]*)"', html_content)
            biography = bio_match.group(1) if bio_match else ""
            
            fullname_match = re.search(r'"full_name":"([^"]*)"', html_content)
            full_name = fullname_match.group(1) if fullname_match else ""
            
            # 嘗試提取是否為私人帳戶
            private_match = re.search(r'"is_private":(true|false)', html_content)
            is_private = private_match.group(1) == 'true' if private_match else False
            
            return {
                'username': username,
                'full_name': full_name,
                'biography': biography,
                'is_private': is_private,
                'recent_posts': [],
                'followers_count': 0,
                'following_count': 0,
                'posts_count': 0
            }
            
        except Exception as e:
            self.log(f"❌ 備用解析錯誤: {str(e)}")
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
        if current_posts and self.last_post_data:
            latest_post = current_posts[0]
            last_known_post = self.last_post_data[0] if self.last_post_data else None
            
            if last_known_post and latest_post['id'] != last_known_post['id']:
                self.log(f"📸 新貼文檢測: {latest_post['shortcode']}", "new_post")
                event_data = {
                    "type": "new_post",
                    "username": self.username,
                    "post_id": latest_post['id'],
                    "shortcode": latest_post['shortcode'],
                    "url": latest_post['url'],
                    "caption": latest_post['caption'][:200],
                    "media_type": latest_post['media_type'],
                    "like_count": latest_post['like_count'],
                    "timestamp": datetime.now().isoformat()
                }
                print(json.dumps(event_data, ensure_ascii=False))
        
        self.last_post_data = current_posts

        # 檢查個人資料變更
        if self.last_profile_data:
            changes = []
            
            # 檢查用戶名變更
            if current_data.get('full_name') != self.last_profile_data.get('full_name'):
                changes.append('全名')
            
            # 檢查驗證狀態變更
            if current_data.get('is_verified') != self.last_profile_data.get('is_verified'):
                changes.append('驗證狀態')
            
            # 檢查私人狀態變更
            if current_data.get('is_private') != self.last_profile_data.get('is_private'):
                changes.append('隱私設定')
            
            if changes:
                self.log(f"👤 個人資料變更: {', '.join(changes)}", "profile_change")
                event_data = {
                    "type": "profile_change",
                    "username": self.username,
                    "changes": changes,
                    "timestamp": datetime.now().isoformat()
                }
                print(json.dumps(event_data, ensure_ascii=False))
        
        self.last_profile_data = current_data.copy()

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
                delay = random.randint(base_interval - 120, base_interval + 120)
                
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
    
    args = parser.parse_args()
    
    config = {
        'interval': args.interval,
        'check_posts': args.check_posts.lower() == 'true',
        'check_bio': args.check_bio.lower() == 'true'
    }
    
    monitor = InstagramMode1Monitor(args.username, config)
    monitor.run_monitoring()

if __name__ == "__main__":
    main()