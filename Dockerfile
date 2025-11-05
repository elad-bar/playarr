# Multi-stage build for Playarr
# Builds engine, web API, and web UI components
# Stage 1: Build UI
FROM node:20-alpine AS ui-builder

WORKDIR /app

# Copy UI package files
COPY web-ui/package.json ./web-ui/

# Install UI dependencies
WORKDIR /app/web-ui
RUN npm install && npm cache clean --force

# Copy UI source and build
COPY web-ui/ ./web-ui/
RUN npm run build

# Stage 2: Build API dependencies
FROM node:20-alpine AS api-builder

WORKDIR /app

# Copy API package files
COPY web-api/package.json ./web-api/

# Install API dependencies
WORKDIR /app/web-api
RUN npm install --omit=dev && npm cache clean --force

# Stage 3: Build engine dependencies
FROM node:20-alpine AS engine-builder

WORKDIR /app

# Copy engine package files
COPY engine/package.json ./engine/

# Install engine dependencies
WORKDIR /app/engine
RUN npm install --omit=dev && npm cache clean --force

# Stage 4: Runtime
FROM node:20-alpine

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Set working directory
WORKDIR /app

# Copy UI build from stage 1
COPY --from=ui-builder /app/web-ui/build ./web-ui/build

# Copy API dependencies from stage 2
COPY --from=api-builder /app/web-api/node_modules ./web-api/node_modules

# Copy API source code
COPY web-api/ ./web-api/

# Copy engine dependencies from stage 3
COPY --from=engine-builder /app/engine/node_modules ./engine/node_modules

# Copy engine source code
COPY engine/ ./engine/

# Create logs directory (configurations, data, and cache will be mounted as volumes)
RUN mkdir -p /app/logs

# Create startup script to run both engine and API
RUN echo '#!/bin/sh' > /app/start.sh && \
    echo 'cd /app/engine && node index.js &' >> /app/start.sh && \
    echo 'cd /app/web-api && node src/index.js' >> /app/start.sh && \
    chmod +x /app/start.sh

# Set environment variables
ENV NODE_ENV=production
ENV CACHE_DIR=/app/cache
ENV DATA_DIR=/app/data
ENV LOGS_DIR=/app/logs
ENV CONFIG_DIR=/app/configurations
ENV PORT=3000

# Expose API port
EXPOSE 3000

# Health check (simple file system check)
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD test -d /app/data && test -d /app/cache || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Run both engine and API
CMD ["/app/start.sh"]