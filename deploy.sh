#!/bin/bash

# Instagram監控系統部署腳本

echo "🚀 開始部署 LiveBot Instagram 監控系統..."

# 檢查必要環境變數
required_vars=(
    "DISCORD_TOKEN"
    "NOTIFICATION_CHANNEL_ID" 
    "INSTAGRAM_TARGET_USERNAME"
)

for var in "${required_vars[@]}"; do
    if [[ -z "${!var}" ]]; then
        echo "❌ 錯誤: 環境變數 $var 未設定"
        exit 1
    fi
done

# 建立必要目錄
echo "📁 建立目錄結構..."
mkdir -p data/{sessions,downloads,stories,logs}

# 檢查Docker是否安裝
if ! command -v docker &> /dev/null; then
    echo "❌ Docker 未安裝，請先安裝 Docker"
    exit 1
fi

# 構建Docker映像
echo "🔨 構建Docker映像..."
docker build -t livebot-instagram .

if [ $? -ne 0 ]; then
    echo "❌ Docker映像構建失敗"
    exit 1
fi

# 停止現有容器（如果存在）
echo "🛑 停止現有容器..."
docker stop livebot-instagram 2>/dev/null || true
docker rm livebot-instagram 2>/dev/null || true

# 啟動新容器
echo "🚀 啟動容器..."
docker run -d \
    --name livebot-instagram \
    --restart unless-stopped \
    -p 3000:3000 \
    --env-file .env \
    -v $(pwd)/data/sessions:/app/sessions \
    -v $(pwd)/data/downloads:/app/downloads \
    -v $(pwd)/data/stories:/app/stories \
    -v $(pwd)/data/logs:/app/logs \
    livebot-instagram

if [ $? -eq 0 ]; then
    echo "✅ 部署成功！"
    echo "🌐 Web面板: http://localhost:3000"
    echo "📊 健康檢查: http://localhost:3000/health"
    echo ""
    echo "📋 查看日誌: docker logs -f livebot-instagram"
    echo "🛑 停止服務: docker stop livebot-instagram"
else
    echo "❌ 容器啟動失敗"
    exit 1
fi
