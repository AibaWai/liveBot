# 使用 Node.js 官方映像
FROM node:18-slim

# 安裝 Python 和必要工具
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    curl \
    wget \
    git \
    && rm -rf /var/lib/apt/lists/*

# 建立符號連結讓 python 指向 python3
RUN ln -s /usr/bin/python3 /usr/bin/python

# 升級 pip
RUN python3 -m pip install --upgrade pip

# 預先安裝 instaloader
RUN pip3 install instaloader

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