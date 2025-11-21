# Playarr Deployment Guide

## Overview

This guide covers deploying Playarr in both local and Docker environments. It includes prerequisites, setup instructions, configuration options, and production considerations.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Local Setup](#local-setup)
3. [Docker Deployment](#docker-deployment)
4. [Environment Variables](#environment-variables)
5. [CI/CD](#cicd)
6. [Initial Configuration](#initial-configuration)
7. [Production Considerations](#production-considerations)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

- Node.js 20 or higher
- MongoDB database
- Docker (optional, for containerized deployment)

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

## Docker Deployment

### Building the Docker Image

```bash
# Build the image
docker build -t playarr .

# Or using docker-compose
docker-compose build
```

### Docker Image Details

The Dockerfile uses:
- **Multi-stage build**: Optimized for size and build speed
  - Stage 1: Builds React UI
  - Stage 2: Installs API dependencies
  - Stage 3: Installs engine dependencies
  - Stage 4: Runtime with all components
- **Node.js 20 Alpine**: Lightweight base image
- **dumb-init**: Proper signal handling for graceful shutdowns in containers
- **Health check**: Verifies data and cache directories are accessible
- **`.dockerignore`**: Excludes unnecessary files (data, cache, logs, node_modules, etc.) from the build context
- **Single container**: Runs both engine and API together

### Running with Docker

#### Using Docker CLI

```bash
# Run the container
docker run -d \
  --name playarr \
  -p 3000:3000 \
  -v $(pwd)/cache:/app/cache \
  -v $(pwd)/logs:/app/logs \
  -e DEFAULT_ADMIN_USERNAME=admin \
  -e DEFAULT_ADMIN_PASSWORD=your-secure-password \
  playarr
```

#### Using Docker Compose (Recommended)

```bash
# Start the container
docker-compose up -d

# View logs
docker-compose logs -f playarr

# Stop the container
docker-compose down
```

### Docker Compose Configuration

The `docker-compose.yml` file includes:
- Volume mounts for cache and logs
- Port mapping for API (port 3000)
- Health checks
- Automatic restart policy
- Environment variable configuration

**Important Notes:**
- Data and cache directories are **not** included in the Docker image and **must** be mounted as volumes
- The UI will be used to configure providers and settings
- MongoDB should be running separately (or use a MongoDB container)

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

## CI/CD

The project includes GitHub Actions workflow (`.github/workflows/docker-build.yml`) that automatically builds Docker images on:
- Push to `main` or `master` branches
- Pull requests to `main` or `master` branches
- Tags matching `v*` pattern

The workflow uses Docker Buildx for multi-platform builds and includes automated testing of the built image.

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

