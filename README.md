# Playarr - IPTV Playlist Manager

IPTV Playlist Manager ecosystem for fetching and managing IPTV content. Currently includes the data fetching engine component. Future releases will include web UI and API components.

## About the Engine

The Playarr Engine is a robust data fetching and processing system designed to aggregate, enrich, and normalize IPTV content metadata from multiple providers. It serves as the foundation for building a comprehensive IPTV content management platform.

### Business Capabilities

The engine provides the following core business capabilities:

#### 1. **Multi-Provider Content Aggregation**
- **Connect to Multiple IPTV Providers**: Supports multiple provider types simultaneously (AGTV and Xtream Codec)
- **Priority-Based Processing**: Process providers in priority order to handle overlapping content intelligently
- **Provider Management**: Enable or disable providers dynamically without code changes
- **Configuration-Driven**: Simple JSON-based provider configuration for easy setup and maintenance

#### 2. **Content Discovery & Categorization**
- **Category Fetching**: Automatically discovers and fetches available categories for movies and TV shows from each provider
- **Category Organization**: Organizes content by media type (movies vs. TV shows) and provider-specific categories
- **Structured Data Storage**: Stores categorized content in organized, queryable formats

#### 3. **Metadata Enrichment & Normalization**
- **TMDB Integration**: Enriches content with high-quality metadata from The Movie Database (TMDB)
- **TMDB ID Matching**: Intelligently matches provider titles with TMDB entries using multiple strategies:
  - Direct IMDB ID matching (for AGTV providers)
  - Title-based search with fuzzy matching
- **Metadata Normalization**: Standardizes metadata across different providers into a unified format
- **Main Title Generation**: Creates aggregated "main titles" that combine data from multiple providers, enriched with TMDB metadata

#### 4. **Content Processing & Quality Control**
- **Title Cleanup**: Applies provider-specific regex patterns to clean up title names (removes language tags, quality indicators, etc.)
- **Content Filtering**: Supports ignore patterns to exclude unwanted or low-quality content
- **Update Detection**: Automatically detects and processes updates for TV shows (Xtream providers)
- **Progress Tracking**: Real-time progress monitoring with automatic saving of processed titles

#### 5. **Performance & Reliability**
- **Intelligent Caching**: Multi-layer caching system to minimize API calls and improve performance
  - Raw API response caching
  - Processed data caching
  - Configurable cache expiration policies via `cache-policy.json`
  - Automatic cache purging to manage disk space
- **Rate Limiting**: Configurable rate limiting per provider to respect API constraints
- **Concurrent Processing**: Efficient parallel processing of movies and TV shows
- **Error Handling**: Robust error handling with detailed logging and recovery mechanisms

#### 6. **Data Management**
- **Structured Storage**: Organizes data into logical directories:
  - Provider-specific titles and categories
  - Main aggregated titles
  - Ignored titles tracking
- **Data Persistence**: Persistent storage of all processed data for offline access
- **Incremental Updates**: Only processes new or updated content to minimize processing time

#### 7. **Operational Excellence**
- **Automated Job Scheduling**: Uses Bree.js for reliable job scheduling with configurable intervals:
  - Provider title processing: Every 1 hour
  - Main title aggregation: Every 30 minutes (first run 5 minutes after startup)
  - Cache purging: Every 15 minutes
- **Comprehensive Logging**: Detailed logging with configurable log levels (debug, info, error)
- **Progress Monitoring**: Real-time progress updates for long-running operations
- **Health Monitoring**: Health check support for containerized deployments
- **Extensible Architecture**: Plugin-based provider system for easy extension to new provider types

### Use Cases

The engine is designed for:
- **IPTV Service Providers**: Aggregating content from multiple sources
- **Content Managers**: Building unified content catalogs from diverse IPTV providers
- **Media Applications**: Providing enriched metadata for media browsing and search applications
- **Content Discovery Platforms**: Creating searchable, categorized content databases

### Current Provider Support

- **AGTV (Apollo Group TV)**: M3U8 format provider support
- **Xtream Codec**: Full Xtream API support with extended metadata

## Setup

1. Install dependencies:
```bash
# Install engine dependencies
npm run install:engine

# Or install from root (same as above)
npm install
```

2. Configure environment variables (optional):
```bash
cp .env.example .env
# Edit .env if you want to customize cache directory
```

3. Ensure provider configuration files exist in `configurations/providers/`:
   - Each provider should have a JSON file (e.g., `provider-1.json`, `provider-2.json`)
   - See the [Configurations](#configurations) section below for details

4. Run the engine:
```bash
# Fetch all enabled providers (from root)
npm start

# Run in development mode with watch
npm run dev

# Or run directly from engine directory
cd engine
npm start
```

## Docker

The project includes Docker support for easy deployment and containerization.

### Building the Docker Image

```bash
# Build the image
docker build -t playarr .

# Or using docker-compose
docker-compose build
```

### CI/CD

The project includes GitHub Actions workflow (`.github/workflows/docker-build.yml`) that automatically builds Docker images on:
- Push to `main` or `master` branches
- Pull requests to `main` or `master` branches
- Tags matching `v*` pattern

The workflow uses Docker Buildx for multi-platform builds and includes automated testing of the built image.

### Running with Docker

```bash
# Run the container
docker run -d \
  --name playarr \
  -v $(pwd)/configurations:/app/configurations \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/cache:/app/cache \
  -v $(pwd)/logs:/app/logs \
  playarr

# Or using docker-compose (recommended)
docker-compose up -d

# View logs
docker-compose logs -f playarr

# Stop the container
docker-compose down
```

### Docker Compose Configuration

The `docker-compose.yml` file includes:
- Volume mounts for configurations (read-write for UI configuration), data, cache, and logs
- Health checks
- Automatic restart policy
- Environment variable configuration

**Note**: Configurations, data, and cache directories are **not** included in the Docker image and **must** be mounted as volumes. The UI will be used to configure providers and settings.

### Docker Image Details

The Dockerfile uses:
- **Multi-stage build**: Optimized for size and build speed
- **Node.js 20 Alpine**: Lightweight base image
- **dumb-init**: Proper signal handling for graceful shutdowns in containers
- **Health check**: Verifies data and cache directories are accessible
- **`.dockerignore`**: Excludes unnecessary files (configurations, data, cache, logs, node_modules, etc.) from the build context

### Environment Variables

You can customize the Docker container using environment variables:

- `CACHE_DIR`: Cache directory path (default: `/app/cache`)
- `DATA_DIR`: Data directory path (default: `/app/data`)
- `LOGS_DIR`: Logs directory path (default: `/app/logs`)
- `NODE_ENV`: Node environment (default: `production`)

### Future Extensions

The Dockerfile is designed to be extended for future services:
- **Web API**: Uncomment and modify port mappings in `docker-compose.yml`
- **UI**: Add additional service definitions to docker-compose
- **Multi-stage builds**: Already set up for optimized builds

## Configurations

The engine requires configuration files in the `configurations/` directory. There are two types of configuration files:

### Provider Configurations

Provider configuration files are stored in `configurations/providers/` directory. Each provider should have its own JSON file named after the provider ID (e.g., `provider-1.json`, `provider-2.json`).

#### Provider Configuration Structure

Each provider JSON file should contain the following fields:

```json
{
  "id": "provider-id",           // Unique identifier (must match filename without .json)
  "type": "agtv" | "xtream",     // Provider type
  "enabled": true,                // Whether this provider is active (default: true)
  "priority": 1,                  // Processing priority (lower = higher priority)
  "api_url": "https://example.com", // Base API URL
  "username": "your-username",   // Provider username
  "password": "your-password",    // Provider password
  "streams_urls": [              // Array of stream URLs (optional)
    "https://example.com"
  ],
  "cleanup": {                    // Regex patterns for title cleanup (optional)
    "pattern": "replacement"
  },
  "ignored_titles": {},          // Titles to ignore (optional)
  "api_rate": {                  // Rate limiting configuration
    "concurrect": 10,            // Number of concurrent requests (note: typo "concurrect" is supported)
    "duration_seconds": 1        // Time window in seconds
  }
}
```

#### Provider Type: AGTV

AGTV providers use M3U8 format for fetching content. Example configuration:

```json
{
  "id": "provider-1",
  "type": "agtv",
  "enabled": true,
  "priority": 2,
  "api_url": "https://starlite.best",
  "streams_urls": [
    "https://starlite.best"
  ],
  "username": "your-username",
  "password": "your-password",
  "cleanup": {},
  "ignored_titles": {},
  "api_rate": {
    "concurrect": 10,
    "duration_seconds": 1
  }
}
```

#### Provider Type: Xtream

Xtream Codec providers use the Xtream API. Example configuration:

```json
{
  "id": "providerid",
  "type": "xtream",
  "enabled": true,
  "priority": 1,
  "api_url": "http://example.com",
  "streams_urls": [
    "http://example.com",
    "http://backup.example.com"
  ],
  "username": "your-username",
  "password": "your-password",
  "cleanup": {
    "[A-Z]{2}\\|\\s": "",
    "\\s\\[[m|M][u|U][l|L][t|T]{0,1}[i|I][-|\\s][s|S][u|U][b|B]]": ""
  },
  "ignored_titles": {},
  "api_rate": {
    "concurrect": 4,
    "duration_seconds": 1
  }
}
```

#### Configuration Fields Explained

- **id**: Unique identifier for the provider. Must match the filename (without `.json` extension).
- **type**: Provider type - either `"agtv"` for Apollo Group TV or `"xtream"` for Xtream Codec.
- **enabled**: Set to `false` to disable this provider without deleting the configuration file.
- **priority**: Lower numbers are processed first. Useful when providers have overlapping content.
- **api_url**: Base URL for the provider's API endpoint.
- **username** / **password**: Authentication credentials for the provider.
- **streams_urls**: Array of URLs where stream content is available. Used for building stream URLs.
- **cleanup**: Object with regex patterns as keys and replacement strings as values. Applied to clean up title names (e.g., remove language tags, quality indicators).
- **ignored_titles**: Object mapping title IDs to ignore reasons. Used to skip specific titles during processing.
- **api_rate**: Rate limiting configuration:
  - **concurrect**: Maximum number of concurrent requests (note: supports typo "concurrect" for backward compatibility).
  - **duration_seconds**: Time window in seconds for the rate limit.

### Settings Configuration

The settings file is located at `configurations/settings.json` and contains global configuration:

```json
{
  "tmdb_token": "your-tmdb-api-token",
  "tmdb_api_rate": {
    "concurrect": 45,
    "duration_seconds": 1
  }
}
```

#### Settings Fields Explained

- **tmdb_token**: TMDB (The Movie Database) API token for metadata enrichment. Get your token from [TMDB](https://www.themoviedb.org/settings/api).
- **tmdb_api_rate**: Rate limiting for TMDB API calls:
  - **concurrect**: Maximum concurrent requests to TMDB API.
  - **duration_seconds**: Time window in seconds.

### Cache Policy Configuration

The cache policy file is located at `configurations/cache-policy.json` and controls automatic cache expiration and purging. The `CachePurgeJob` runs every 15 minutes to remove expired cache files based on TTL (Time To Live) values specified in hours.

```json
{
  "tmdb/search/movie": null,
  "tmdb/search/tv": null,
  "tmdb/find/imdb": null,
  "tmdb/movie": null,
  "tmdb/tv": null,
  "tmdb/movie/{tmdbId}/similar": null,
  "tmdb/tv/{tmdbId}/similar": null,
  "tmdb/tv/{tmdbId}/season": 6,
  "{providerId}/categories": 1,
  "{providerId}/metadata": 1,
  "{providerId}/extended/movies": null,
  "{providerId}/extended/tvshows": 6,
  "{providerId}": 6
}
```

#### Cache Policy Fields Explained

- **Key format**: Cache path patterns (supports dynamic segments like `{providerId}` and `{tmdbId}`)
- **Value**: TTL in hours:
  - `null`: Cache never expires (kept indefinitely)
  - `number`: TTL in hours (e.g., `6` = expires after 6 hours)
- **Example**: `"tmdb/tv/{tmdbId}/season": 6` means season data expires after 6 hours
- **Dynamic matching**: The purge job matches patterns like `tmdb/tv/12345/season` to `tmdb/tv/{tmdbId}/season`

Files older than their TTL are automatically purged, and empty directories are cleaned up.

### Configuration File Location

All configuration files should be placed in:
- **Provider configs**: `configurations/providers/*.json`
- **Settings**: `configurations/settings.json`
- **Cache policy**: `configurations/cache-policy.json` (optional, defaults to no expiration if not present)

The engine automatically loads all enabled providers from the `configurations/providers/` directory and processes them in priority order.

## Features

- Fetches movies and TV shows from AGTV (M3U8) and Xtream Codec providers
- Disk caching for efficient data retrieval with configurable expiration policies
- Automatic cache purging based on TTL policies
- Automatic update detection for TV shows (Xtream)
- Stores processed titles in `data/titles/` directory
- Supports provider-specific cleanup rules and ignore patterns
- Respects provider priority and enabled status
- Scheduled job processing with Bree.js:
  - Provider title fetching: Every 1 hour
  - Main title aggregation: Every 30 minutes
  - Cache purging: Every 15 minutes

## Project Structure

```
playarr/
├── configurations/
│   ├── providers/          # Provider configuration files
│   ├── settings.json       # Global settings (TMDB token, etc.)
│   └── cache-policy.json   # Cache expiration policies
├── data/
│   ├── categories/         # Provider categories (generated)
│   ├── main/               # Main titles (generated)
│   └── titles/             # Processed titles (generated)
├── cache/                  # Raw API response cache
├── engine/
│   ├── jobs/               # Job implementations
│   ├── managers/           # Storage manager
│   ├── providers/          # Provider implementations
│   ├── utils/              # Utility functions
│   ├── workers/            # Worker scripts for Bree.js scheduler
│   ├── package.json        # Engine dependencies
│   └── index.js            # Main entry point
├── .github/
│   └── workflows/
│       └── docker-build.yml # CI/CD workflow for Docker builds
├── Dockerfile              # Docker image definition
├── docker-compose.yml      # Docker Compose configuration
├── .dockerignore          # Files excluded from Docker builds
├── package.json            # Root package (monorepo scripts)
└── README.md
```

