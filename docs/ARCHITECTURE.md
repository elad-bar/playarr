# Playarr Architecture

## Overview

Playarr is an IPTV Playlist Manager ecosystem consisting of three main components:
- **Data Fetching Engine**: Aggregates, enriches, and normalizes IPTV content metadata
- **Web API**: RESTful API for managing providers, viewing content, and configuring settings
- **Web UI**: React-based user interface for managing the system

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Business Capabilities](#business-capabilities)
3. [Data Storage Architecture](#data-storage-architecture)
4. [Project Structure](#project-structure)
5. [Provider Architecture](#provider-architecture)
6. [Client Integration Architecture](#client-integration-architecture)
7. [Extensibility](#extensibility)

---

## System Architecture

### Core Components

#### 1. Data Fetching Engine

The Playarr Engine is a robust data fetching and processing system designed to aggregate, enrich, and normalize IPTV content metadata from multiple providers. It serves as the foundation for building a comprehensive IPTV content management platform.

**Key Responsibilities:**
- Multi-provider content aggregation
- Content discovery and categorization
- Metadata enrichment and normalization
- Content processing and quality control
- Data management and persistence

#### 2. Web API

The web API provides REST endpoints for:
- Authentication and user management
- Provider CRUD operations
- Content browsing and search
- Settings management
- Health checks
- Playlist generation
- Stream URLs

#### 3. Web UI

The web UI is a React application that provides:
- Provider management (add, edit, delete, prioritize)
- Content browsing and search
- Settings configuration
- User management
- System health monitoring

The UI is built and served statically by the API server.

#### 4. Metrics Service

The metrics service provides Prometheus-compatible metrics export:
- **Metrics Collection**: Automatically tracks HTTP requests, errors, job executions, and system operations
- **Prometheus Export**: Exposes `/metrics` endpoint in Prometheus format
- **JSON Export**: Provides `/metrics/json` endpoint for programmatic access
- **Secure Access**: Bearer token authentication for metrics endpoint
- **Configuration-Driven**: Metrics defined in `metrics.json` for easy extension

For detailed information, see the [Prometheus Metrics Exporter](features/prometheus-metrics-exporter.md) documentation.

## Business Capabilities

### 1. Multi-Provider Content Aggregation
- **Connect to Multiple IPTV Providers**: Supports multiple provider types simultaneously (AGTV and Xtream Codec)
- **Priority-Based Processing**: Process providers in priority order to handle overlapping content intelligently
- **Provider Management**: Enable or disable providers dynamically without code changes
- **Configuration-Driven**: Simple JSON-based provider configuration for easy setup and maintenance

### 2. Content Discovery & Categorization
- **Category Fetching**: Automatically discovers and fetches available categories for movies and TV shows from each provider
- **Category Organization**: Organizes content by media type (movies vs. TV shows) and provider-specific categories
- **Structured Data Storage**: Stores categorized content in organized, queryable formats

### 3. Metadata Enrichment & Normalization
- **TMDB Integration**: Enriches content with high-quality metadata from The Movie Database (TMDB)
- **TMDB ID Matching**: Intelligently matches provider titles with TMDB entries using multiple strategies:
  - Direct IMDB ID matching (for AGTV providers)
  - Title-based search with fuzzy matching
- **Metadata Normalization**: Standardizes metadata across different providers into a unified format
- **Main Title Generation**: Creates aggregated "main titles" that combine data from multiple providers, enriched with TMDB metadata

### 4. Content Processing & Quality Control
- **Title Cleanup**: Applies provider-specific regex patterns to clean up title names (removes language tags, quality indicators, etc.)
- **Content Filtering**: Supports ignore patterns to exclude unwanted or low-quality content
- **Update Detection**: Automatically detects and processes updates for TV shows (Xtream providers)
- **Progress Tracking**: Real-time progress monitoring with automatic saving of processed titles

### 5. Performance & Reliability
- **Intelligent Caching**: Multi-layer caching system to minimize API calls and improve performance
  - Raw API response caching
  - Processed data caching
  - Automatic cache purging to manage disk space
- **Rate Limiting**: Configurable rate limiting per provider to respect API constraints
- **Concurrent Processing**: Efficient parallel processing of movies and TV shows
- **Error Handling**: Robust error handling with detailed logging and recovery mechanisms

### 6. Data Management
- **Structured Storage**: Organizes data into logical directories:
  - Provider-specific titles and categories
  - Main aggregated titles
  - Ignored titles tracking
- **Data Persistence**: Persistent storage of all processed data for offline access
- **Incremental Updates**: Only processes new or updated content to minimize processing time

### 7. Operational Excellence
- **Automated Job Scheduling**: The in-process `EngineScheduler` uses native timers and the metadata in `web-api/src/jobs.json` to control recurring jobs:
  - `syncIPTVProviderTitles`: Runs shortly after startup (configurable delay) and then every 6 hours; triggers downstream jobs on completion
  - `providerTitlesMonitor`: Executes as a post-job hook to process aggregated titles when the sync finishes
  - `syncLiveTV`: Refreshes channels and EPG data on startup and every 12 hours
- **Comprehensive Logging**: Detailed logging with configurable log levels (debug, info, error)
- **Progress Monitoring**: Real-time progress updates for long-running operations
- **Health Monitoring**: Health check support for containerized deployments
- **Extensible Architecture**: Plugin-based provider system for easy extension to new provider types

## Data Storage Architecture

### MongoDB Collections

All configuration and runtime data is stored in MongoDB collections:

- **`iptv_providers`**: Provider configurations (enabled providers with priority)
- **`settings`**: Global settings (TMDB token, API rate limits, etc.)
- **`users`**: User accounts with authentication and watchlists
- **`titles`**: Aggregated main titles with TMDB metadata
- **`provider_titles`**: Provider-specific title data
- **`channels`**: Live TV channel information
- **`programs`**: Live TV program guide data

### File-Based Storage

- **`cache/`**: Raw API response cache (file-based)
- **`logs/`**: Application logs
- **`data/`**: Legacy files (used only by migration scripts)

**Note**: The `data/` directory is only used by migration scripts to read legacy files. Runtime data is stored entirely in MongoDB.

## Project Structure

```
playarr/
├── data/                       # Legacy files (used only by migration scripts)
│   ├── settings/              # Legacy configuration files (migration scripts only)
│   │   ├── iptv-providers.json # Legacy provider configs
│   │   ├── settings.json       # Legacy settings
│   │   ├── cache-policy.json  # Legacy cache policies
│   │   └── users.json         # Legacy user accounts
│   ├── categories/            # Legacy categories (migration scripts only)
│   ├── titles/                # Legacy titles (migration scripts only)
│   └── stats.json             # Legacy stats (migration scripts only)
├── cache/                     # Raw API response cache (file-based)
├── logs/                      # Application logs
│   └── api.log                # API logs
├── web-api/
│   ├── src/
│   │   ├── config/            # Configuration (database, collections)
│   │   ├── middleware/        # Auth and metrics middleware
│   │   │   └── MetricsMiddleware.js  # HTTP request tracking
│   │   ├── routes/            # API routes
│   │   ├── managers/          # Business logic managers
│   │   ├── repositories/      # Data access layer
│   │   ├── handlers/          # Provider handlers
│   │   ├── providers/         # Provider implementations
│   │   ├── jobs/              # Scheduled jobs
│   │   ├── services/          # Infrastructure services
│   │   │   └── metrics.js     # Prometheus metrics service
│   │   ├── utils/             # Utility functions
│   │   └── metrics.json       # Metrics configuration
│   ├── package.json           # API dependencies
│   └── src/index.js           # API server entry point
├── web-ui/
│   ├── src/                   # React source code
│   │   ├── components/        # React components
│   │   ├── pages/             # Page components
│   │   ├── services/          # API service layer
│   │   ├── store/             # Redux store
│   │   └── context/           # React contexts
│   ├── build/                 # Built UI (generated)
│   ├── package.json           # UI dependencies
│   └── public/                # Static assets
├── .github/
│   └── workflows/
│       └── docker-build.yml   # CI/CD workflow for Docker builds
├── Dockerfile                 # Docker image definition
├── docker-compose.yml         # Docker Compose configuration
├── .dockerignore             # Files excluded from Docker builds
├── package.json              # Root package (monorepo scripts)
└── README.md                 # Main documentation
```

## Provider Architecture

### Provider Types

Playarr supports multiple provider types through a plugin-based architecture:

- **AGTV (Apollo Group TV)**: M3U8 format provider support
- **Xtream Codec**: Full Xtream API support with extended metadata

### Provider Handler System

Each provider type has a dedicated handler that implements:
- Content fetching from provider APIs
- Title parsing and normalization
- Category discovery and organization
- Update detection and processing

### Priority-Based Processing

Providers are processed in priority order (lower number = higher priority) to handle overlapping content intelligently. When multiple providers have the same content, the provider with the highest priority (lowest number) takes precedence.

## Client Integration Architecture

Playarr provides multiple client access methods:

1. **Web Interface**: Direct access through React UI
2. **Stremio Addon**: Stremio protocol integration
3. **M3U8 Playlists**: Standard M3U8 playlist format
4. **Xtream Code API**: Full Xtream Code API compatibility
5. **Strmarr Integration**: STRM file generation for Emby/Jellyfin/Kodi

All client access methods filter content based on user watchlists, ensuring each user only sees their selected content.

## Extensibility

The architecture is designed for easy extension:
- **Plugin-based providers**: Add new provider types by implementing the base provider interface
- **Modular components**: Clear separation between data fetching, API, and UI layers
- **Configuration-driven**: Most settings can be changed without code modifications

