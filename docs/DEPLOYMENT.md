# Playarr Deployment Guide

## Overview

This guide covers deploying Playarr in both local and Docker environments. It includes prerequisites, setup instructions, configuration options, and production considerations.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Docker Deployment](#docker-deployment)
3. [Local Setup](#local-setup)
4. [Environment Variables](#environment-variables)
5. [Initial Configuration](#initial-configuration)
6. [Production Considerations](#production-considerations)
7. [Troubleshooting](#troubleshooting)

---

## Prerequisites

- Node.js 20 or higher
- MongoDB database
- Docker (optional, for containerized deployment)

## Docker Deployment

Playarr provides a pre-built Docker image available at `ghcr.io/elad-bar/playarr:latest`. This is the recommended way to deploy Playarr.

### Running with Docker

#### Using Docker CLI

```bash
# Run the container using the pre-built image
docker run -d \
  --name playarr \
  -p 3000:3000 \
  -v $(pwd)/cache:/app/cache \
  -v $(pwd)/logs:/app/logs \
  -e DEFAULT_ADMIN_USERNAME=admin \
  -e DEFAULT_ADMIN_PASSWORD=your-secure-password \
  ghcr.io/elad-bar/playarr:latest
```

#### Using Docker Compose (Recommended)

Create a `docker-compose.yml` file in your project directory:

```yaml
version: '3.8'

services:
  playarr:
    image: ghcr.io/elad-bar/playarr:latest
    container_name: playarr
    restart: unless-stopped
    volumes:
      # Mount cache directory for persistence
      - ./cache:/app/cache
      # Mount logs directory
      - ./logs:/app/logs
    environment:
      - NODE_ENV=production
      - CACHE_DIR=/app/cache
      - LOGS_DIR=/app/logs
      - PORT=3000
      - DEFAULT_ADMIN_USERNAME=${DEFAULT_ADMIN_USERNAME:-admin}
      - DEFAULT_ADMIN_PASSWORD=${DEFAULT_ADMIN_PASSWORD:-}
      - MONGODB_URI=${MONGODB_URI:-}
    ports:
      - "3000:3000"
```

Create a `.env` file (optional) to set environment variables:

```bash
DEFAULT_ADMIN_USERNAME=admin
DEFAULT_ADMIN_PASSWORD=your-secure-password
MONGODB_URI=mongodb://localhost:27017/playarr
```

Then start the container:

```bash
# Start the container
docker-compose up -d

# View logs
docker-compose logs -f playarr

# Stop the container
docker-compose down

# Restart the container
docker-compose restart
```

**Important Notes:**
- Data and cache directories are **not** included in the Docker image and **must** be mounted as volumes
- The UI will be used to configure providers and settings
- MongoDB should be running separately (or use a MongoDB container)

## Local Setup

### 1. Install Dependencies

```bash
# Install all dependencies (API, UI)
npm run install:all

# Or install individually
npm run install:api
npm run install:ui
```

### 2. Build the Web UI

Required for production:

```bash
npm run build:ui
```

### 3. Configure Environment Variables

Create a `.env` file (optional):

```bash
cp .env.example .env
# Edit .env if you want to customize cache directory, ports, etc.
```

### 4. Configure MongoDB

Ensure MongoDB is running and accessible. The application will connect to MongoDB using the connection string configured in the environment or default settings.

### 5. Run the Application

```bash
# Run API (serves UI on port 3000)
npm start

# Or run individually
npm run start:api     # Run API only (serves UI on port 3000)

# Run in development mode with watch
npm run dev
```

## Environment Variables

You can customize the Docker container using environment variables:

- `CACHE_DIR`: Cache directory path (default: `/app/cache`)
- `LOGS_DIR`: Logs directory path (default: `/app/logs`)
- `PORT`: API server port (default: `3000`)
- `NODE_ENV`: Node environment (default: `production`)
- `DEFAULT_ADMIN_USERNAME`: Default admin username (default: `admin`)
- `DEFAULT_ADMIN_PASSWORD`: Default admin password (required - must be set)
- `MONGODB_URI`: MongoDB connection string (if not using default)

**Important**: Always set `DEFAULT_ADMIN_PASSWORD` when deploying to production!

## Initial Configuration

After deployment:

1. **Access Web UI**: Open `http://localhost:3000` (or your configured port) in your browser
2. **Login**: Use the default admin credentials:
   - Username: `DEFAULT_ADMIN_USERNAME` (default: `admin`)
   - Password: `DEFAULT_ADMIN_PASSWORD` (must be set)
3. **Configure MongoDB**: Ensure MongoDB connection is configured in settings
4. **Add Providers**: Configure your IPTV providers in the Settings → IPTV Providers section
5. **Configure TMDB**: Add your TMDB API token in Settings → General (optional but recommended for metadata enrichment)
6. **Wait for Sync**: Let Playarr fetch and process your content (first sync may take some time)

## Production Considerations

### Security

- Always set a strong `DEFAULT_ADMIN_PASSWORD`
- Use HTTPS in production (configure reverse proxy)
- Regularly update dependencies
- Monitor logs for suspicious activity

### Performance

- Ensure MongoDB has adequate resources
- Configure appropriate cache directory size
- Monitor disk space for cache and logs
- Set up log rotation

### Backup

- Regularly backup MongoDB database
- Backup provider configurations
- Consider backing up cache directory (optional)

### Monitoring

- Monitor system health through the web UI
- **Prometheus Metrics**: Access Prometheus-compatible metrics at `/metrics` endpoint (Bearer token required)
  - Get metrics token from Settings → Metrics in the web UI
  - Configure Prometheus to scrape metrics using Bearer token authentication
  - See [Prometheus Metrics Exporter](features/prometheus-metrics-exporter.md) for details
- Set up external monitoring for container health
- Monitor MongoDB performance
- Track job execution status

## Troubleshooting

### Container Won't Start

- Check logs: `docker-compose logs playarr`
- Verify environment variables are set correctly
- Ensure volumes are mounted correctly
- Check MongoDB connection

### UI Not Loading

- Verify the UI was built: `npm run build:ui`
- Check API server is running
- Verify port mapping is correct

### Content Not Syncing

- Check provider configurations are correct
- Verify MongoDB connection
- Check job execution status in Settings → Jobs
- Review logs for errors

