# 使用 Node.js 官方映像
FROM node:18-slim

# 設定環境變數
ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1

# 安裝系統依賴
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-setuptools \
    python3-wheel \
    curl \
    wget \
    git \
    build-essential \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 建立符號連結
RUN ln -sf /usr/bin/python3 /usr/bin/python && \
    ln -sf /usr/bin/pip3 /usr/bin/pip

# 先安裝基礎 Python 包
RUN pip3 install --no-cache-dir --upgrade pip setuptools wheel

# 安裝 instaloader
RUN pip3 install --no-cache-dir instaloader

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