import json
import os
import sys
from pathlib import Path

def setup_instagram_session():
    """設定Instagram登入憑證"""
    print("🔐 Instagram Mode2 登入憑證設定工具")
    print("⚠️  注意：此工具僅用於設定，實際登入需要安全的方式")
    print()
    
    session_dir = Path("./data/sessions")
    session_dir.mkdir(parents=True, exist_ok=True)
    session_file = session_dir / "instagram_session.json"
    
    print("選擇設定方式：")
    print("1. 手動輸入憑證（不推薦）")
    print("2. 使用現有憑證檔案")
    print("3. 建立空憑證檔案（稍後手動設定）")
    
    choice = input("請選擇 (1-3): ").strip()
    
    if choice == "1":
        print("⚠️  警告：手動輸入憑證不安全，僅用於測試")
        username = input("Instagram 用戶名: ").strip()
        password = input("密碼: ").strip()
        
        session_data = {
            "username": username,
            "password": password,
            "created_at": "manual_setup",
            "note": "手動設定的憑證，建議盡快更換為安全方式"
        }
        
    elif choice == "2":
        source_file = input("現有憑證檔案路徑: ").strip()
        if os.path.exists(source_file):
            with open(source_file, 'r') as f:
                session_data = json.load(f)
        else:
            print("❌ 檔案不存在")
            return False
            
    elif choice == "3":
        session_data = {
            "note": "請手動設定登入憑證",
            "setup_required": True
        }
        
    else:
        print("❌ 無效選擇")
        return False
    
    # 儲存憑證檔案
    with open(session_file, 'w') as f:
        json.dump(session_data, f, indent=2)
    
    print(f"✅ 憑證檔案已建立: {session_file}")
    print()
    print("📋 後續步驟：")
    print("1. 確保憑證安全性")
    print("2. 測試Mode2功能")
    print("3. 定期更新憑證")
    
    return True

if __name__ == "__main__":
    setup_instagram_session()