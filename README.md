# Discord頻道監控 + 博客監控機器人

一個專門用於Discord頻道關鍵字監控和Family Club博客監控的機器人，支援自動電話通知。

## 功能特色

### 🔥 核心功能
- **Discord頻道監控**: 監控指定Discord頻道的關鍵字，支援多頻道多關鍵字
- **Family Club博客監控**: 監控Family Club藝人博客新文章發布
- **電話通知系統**: 檢測到關鍵字時自動撥打電話通知
- **實時Web面板**: 提供美觀的實時狀態監控面板
- **多API Key支援**: 支援為不同頻道配置不同的電話API

### 🛡️ 系統特性
- **24/7運行**: 穩定的24小時監控服務
- **日本時間智能調整**: 根據日本時間調整博客監控頻率
- **容器化部署**: 支援Docker部署，易於維護
- **優雅錯誤處理**: 完善的錯誤處理和自動恢復機制

## 快速開始

### 環境變數配置

#### 必要配置
```bash
# Discord Bot設定
DISCORD_TOKEN=your_discord_bot_token
NOTIFICATION_CHANNEL_ID=your_notification_channel_id

# Discord頻道監控配置 (JSON格式)
CHANNEL_CONFIGS={
  "channel_id_1": {
    "name": "Instagram通知頻道",
    "keywords": ["直播", "live", "開始"],
    "message": "🔴 Instagram直播開始了！關鍵字: {keyword}",
    "api_key": "your_pushcall_api_key_1",
    "phone_number": "+886912345678",
    "caller_id": "1"
  },
  "channel_id_2": {
    "name": "其他通知頻道",
    "keywords": ["重要", "緊急"],
    "message": "⚠️ 重要通知: {keyword}",
    "api_key": "your_pushcall_api_key_2",
    "phone_number": "+886987654321",
    "caller_id": "2"
  }
}
```

#### 可選配置
```bash
# Family Club博客監控 (可選)
BLOG_NOTIFICATION_CHANNEL_ID=your_blog_notification_channel_id
ARTIST_CODE=F2017  # 預設高木雄也

# 默認電話通知 (可選)
PUSHCALL_API_KEY=your_default_pushcall_api_key
PUSHCALL_FROM=1
PUSHCALL_TO=+886912345678
```

### Docker部署

1. **構建映像**
```bash
docker build -t discord-blog-monitor .
```

2. **運行容器**
```bash
docker run -d \
  --name discord-blog-monitor \
  -p 3000:3000 \
  -e DISCORD_TOKEN="your_token" \
  -e NOTIFICATION_CHANNEL_ID="your_channel_id" \
  -e CHANNEL_CONFIGS='{"channel_id":{"name":"test","keywords":["live"],"message":"通知","api_key":"key","phone_number":"+886123456789"}}' \
  -e BLOG_NOTIFICATION_CHANNEL_ID="your_blog_channel_id" \
  --restart unless-stopped \
  discord-blog-monitor
```

### 本地開發

1. **安裝依賴**
```bash
cd app
npm install
```

2. **設定環境變數**
```bash
cp .env.example .env
# 編輯 .env 文件
```

3. **運行**
```bash
npm start
```

## Discord頻道監控配置

### 配置格式說明

```json
{
  "Discord頻道ID": {
    "name": "頻道顯示名稱",
    "keywords": ["關鍵字1", "關鍵字2"],
    "message": "自定義通知訊息模板",
    "api_key": "PushCall API Key",
    "phone_number": "通知電話號碼",
    "caller_id": "來電顯示ID"
  }
}
```

### 訊息模板變數
- `{keyword}`: 觸發的關鍵字
- `{channel}`: 頻道名稱
- `{author}`: 訊息作者
- `{time}`: 檢測時間

### 範例配置

```json
{
  "1234567890123456789": {
    "name": "Instagram直播通知",
    "keywords": ["直播開始", "live", "going live"],
    "message": "🔴 **Instagram直播警報!** \n\n觸發關鍵字: {keyword}\n檢測時間: {time}\n\n快去看直播！",
    "api_key": "pk_live_xxxxxxxxxxxxxxxx",
    "phone_number": "+886912345678",
    "caller_id": "Instagram"
  },
  "9876543210987654321": {
    "name": "重要通知頻道",
    "keywords": ["緊急", "重要", "urgent"],
    "message": "⚠️ **重要通知** \n\n內容: {keyword}\n來源: {channel}\n時間: {time}",
    "api_key": "pk_live_yyyyyyyyyyyyyyyy",
    "phone_number": "+886987654321",
    "caller_id": "Alert"
  }
}
```

## Discord命令

### 系統狀態命令
- `!status` - 完整系統狀態
- `!channels` - 查看頻道監控詳情
- `!help` - 顯示幫助

### 博客監控命令
- `!blog-status` - 博客監控狀態
- `!blog-test` - 測試API連接
- `!blog-check` - 手動檢查新文章
- `!blog-restart` - 重新啟動博客監控

## Web狀態面板

訪問 `http://your-server:3000` 查看實時狀態面板，包含：

- **系統運行狀態**: Bot連線狀態、運行時間
- **Discord頻道監控**: 各頻道監控詳情、檢測統計
- **博客監控狀態**: Family Club博客監控詳情
- **電話API統計**: 各API Key使用統計和成功率
- **最近檢測記錄**: 最近的關鍵字檢測記錄

## API端點

- `GET /` - Web狀態面板
- `GET /health` - 健康檢查
- `GET /api/status` - 系統狀態JSON
- `GET /api/discord-stats` - Discord統計JSON
- `GET /api/blog-status` - 博客狀態JSON

## 故障排除

### 常見問題

1. **Discord Bot無法啟動**
   - 檢查 `DISCORD_TOKEN` 是否正確
   - 確認Bot有足夠的權限

2. **頻道監控不工作**
   - 檢查 `CHANNEL_CONFIGS` JSON格式是否正確
   - 確認頻道ID是否正確
   - 檢查Bot是否在目標頻道中

3. **電話通知失敗**
   - 檢查 PushCall API Key 是否有效
   - 確認電話號碼格式正確
   - 檢查API額度是否足夠

4. **博客監控不工作**
   - 檢查網絡連接
   - 確認 Family Club API 可訪問性
   - 查看日誌檢查具體錯誤

### 日誌查看

```bash
# Docker容器日誌
docker logs discord-blog-monitor

# 實時日誌
docker logs -f discord-blog-monitor
```

## 系統架構

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Discord Bot   │───→│  頻道監控系統    │───→│   電話通知API   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  博客監控系統   │    │   Web狀態面板   │    │   通知發送系統  │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## 更新日誌

### v2.0.0 (目前版本)
- 🚫 移除Instagram直接監控功能
- ✅ 保留並增強Discord頻道監控
- ✅ 保留Family Club博客監控
- ✅ 完善Web狀態面板
- ✅ 支援多API Key電話通知
- ✅ 改善錯誤處理和系統穩定性

### v1.x.x (舊版本)
- ✅ Instagram直接監控
- ✅ Discord頻道監控
- ✅ 基礎博客監控

## 授權

MIT License

## 支援

如有問題或建議，請查看日誌或聯繫開發團隊。