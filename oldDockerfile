# 使用 Node.js 18 官方映像
FROM node:18-alpine

# 設定工作目錄
WORKDIR /app

# 複製 app 資料夾的所有內容到容器
COPY app/ .

# 安裝依賴套件
RUN npm install --production

# 建立非 root 使用者以提高安全性
RUN addgroup -g 1001 -S nodejs
RUN adduser -S discordbot -u 1001

# 更改檔案擁有者
RUN chown -R discordbot:nodejs /app
USER discordbot

# 開放 port 3000 (Koyeb 需要)
EXPOSE 3000

# 健康檢查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# 啟動應用程式
CMD ["node", "bot.js"]