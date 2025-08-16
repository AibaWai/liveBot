FROM node:18-alpine

WORKDIR /app

# Copy package files first for better caching
COPY app/package.json package.json

# Install dependencies
RUN npm install --only=production && \
    npm cache clean --force

# Copy application files (包含新的Instagram監控模組)
COPY app/main_blog.js main_blog.js
COPY app/family_club_blog_monitor.js family_club_blog_monitor.js
COPY app/instagram_monitor.js instagram_monitor.js
COPY app/web_status_panel.js web_status_panel.js

# Create a non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# 確保臨時目錄存在且有正確權限
RUN mkdir -p /tmp/instagram_cache && \
    chown -R nextjs:nodejs /app && \
    chown -R nextjs:nodejs /tmp/instagram_cache

USER nextjs

# Health check (更新為包含Instagram監控)
HEALTHCHECK --interval=5m --timeout=30s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })" || exit 1

# Expose port
EXPOSE 3000

CMD ["node", "main_blog.js"]