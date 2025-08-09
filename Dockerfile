FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY app/package.json package.json

# Install dependencies
RUN npm install --only=production

# Copy application files
COPY app/main.js main.js

# Create necessary directories
RUN mkdir -p /app/logs
RUN mkdir -p /app/debug-files

# Health check
HEALTHCHECK --interval=5m --timeout=30s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })" || exit 1

# Expose port (for Koyeb) - 改為 3000
EXPOSE 3000

CMD ["node", "main.js"]