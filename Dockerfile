FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY app/package.json package.json

# Install dependencies
RUN npm install --only=production

# Copy application files
COPY app/main.js main.js
COPY app/main_blog.js main_blog.js
COPY app/blog_monitor.js blog_monitor.js
COPY app/simplified_instagram_monitor.js simplified_instagram_monitor.js
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

# Health check
HEALTHCHECK --interval=5m --timeout=30s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })" || exit 1

# Expose port (for Koyeb)
EXPOSE 3000

CMD ["node", "main_blog.js"]