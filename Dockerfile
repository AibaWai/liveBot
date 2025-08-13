FROM node:18-alpine

WORKDIR /app

# Copy package files first for better caching
COPY app/package.json package.json

# Install dependencies (no Puppeteer)
RUN npm install --only=production && \
    npm cache clean --force

# Copy application files
COPY app/main_blog.js main_blog.js
COPY app/api_detector_blog_monitor.js api_detector_blog_monitor.js
COPY app/safer_instagram_monitor.js safer_instagram_monitor.js
COPY app/web_status_panel.js web_status_panel.js

# Copy template and static files
COPY app/templates/ templates/
COPY app/public/ public/

# Create necessary directories
RUN mkdir -p /app/logs
RUN mkdir -p /app/debug-files

# Ensure proper permissions for static files
RUN chmod -R 755 /app/public
RUN chmod -R 755 /app/templates

# Create a non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001
RUN chown -R nextjs:nodejs /app
USER nextjs

# Health check
HEALTHCHECK --interval=5m --timeout=30s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })" || exit 1

# Expose port (for Koyeb)
EXPOSE 3000

CMD ["node", "main_blog.js"]