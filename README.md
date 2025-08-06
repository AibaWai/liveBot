# liveBot

# Discord Live Alert Bot 🤖📞

自動監聽 Discord 頻道中的直播通知，並透過 PushCallMe API 撥打電話提醒你！

## ✨ 功能特色

- 🎯 24/7 監聽指定 Discord 頻道
- 🔍 自動偵測包含 "live over" 的直播通知
- 📞 即時透過 PushCallMe API 撥打電話通知
- 🌐 內建健康檢查端點
- 📊 運行狀態統計
- 🔄 自動錯誤恢復

## 🚀 快速部署到 Koyeb

### 準備工作
1. Discord Bot Token
2. 要監聽的頻道 ID
3. PushCallMe API Key
4. 接收通知的手機號碼

### 部署步驟
1. Fork 此 repository
2. 註冊 [Koyeb](https://www.koyeb.com/) 帳號
3. 建立新的 App，選擇從 GitHub 部署
4. 設定環境變數（見下方說明）
5. 部署完成！

## ⚙️ 環境變數設定

在 Koyeb 部署時，請設定以下環境變數：

| 變數名稱 | 說明 | 範例 |
|----------|------|------|
| `DISCORD_TOKEN` | Discord Bot Token | `MTxxxxx.xxxxxx.xxxxxxx` |
| `CHANNEL_ID` | 要監聽的頻道 ID | `123456789012345678` |
| `PUSHCALLME_API_KEY` | PushCallMe API Key | `your-api-key-here` |
| `PHONE_NUMBER` | 接收通知的手機號碼 | `+886912345678` |

## 📱 如何取得頻道 ID

1. 在 Discord 啟用開發者模式：設定 > 進階 > 開發者模式
2. 右鍵點擊要監聽的頻道 > 複製 ID

## 🔧 本地開發

```bash
# 複製專案
git clone https://github.com/你的用戶名/discord-live-bot.git
cd discord-live-bot/app

# 安裝依賴
npm install

# 設定環境變數 (建立 .env 檔案)
DISCORD_TOKEN=你的token
CHANNEL_ID=頻道id
PUSHCALLME_API_KEY=你的api_key
PHONE_NUMBER=+886912345678

# 啟動
node bot.js