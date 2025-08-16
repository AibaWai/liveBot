# 使用包含 Python 的 Node.js 映像
FROM node:18

# 安裝基本工具
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 設定工作目錄
WORKDIR /app

# 複製 package.json 和 package-lock.json
COPY package*.json ./

# 安裝 Node.js 依賴
RUN npm ci --only=production

# 複製應用程式碼
COPY . .

# 建立必要的目錄
RUN mkdir -p /tmp/instagram_cache

# 設定環境變數
ENV NODE_ENV=production
ENV TZ=Asia/Tokyo

# 暴露端口
EXPOSE 3000

# 健康檢查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# 啟動應用
CMD ["node", "app/main_blog.js"]