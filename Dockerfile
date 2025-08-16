# Dockerfile - 更新版本支援Instagram監控
FROM node:18-alpine

WORKDIR /app

# 安裝Python和必要工具
RUN apk add --no-cache \
    python3 \
    py3-pip \
    py3-setuptools \
    build-base \
    python3-dev \
    libffi-dev \
    openssl-dev \
    curl

# 建立Python虛擬環境
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# 複製Python依賴文件
COPY requirements.txt .

# 安裝Python依賴
RUN pip install --no-cache-dir -r requirements.txt

# 複製Node.js package files
COPY app/package.json package.json

# 安裝Node.js依賴
RUN npm install --only=production && \
    npm cache clean --force

# 複製應用程式檔案
COPY app/main.js main.js
COPY app/family_club_blog_monitor.js family_club_blog_monitor.js
COPY app/web_status_panel.js web_status_panel.js
COPY app/instagram_dynamic_monitor.js instagram_dynamic_monitor.js
COPY app/instagram_monitor_mode1.py instagram_monitor_mode1.py
COPY app/instagram_monitor_mode2.py instagram_monitor_mode2.py

# 建立必要目錄
RUN mkdir -p downloads stories sessions logs

# 建立非root用戶
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001 -G nodejs

# 設定權限
RUN chown -R nextjs:nodejs /app /opt/venv

# 切換到非root用戶
USER nextjs

# 健康檢查 (更新為包含Instagram監控檢查)
HEALTHCHECK --interval=5m --timeout=30s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })" || exit 1

# 暴露端口
EXPOSE 3000

# 啟動命令
CMD ["node", "main_blog.js"]