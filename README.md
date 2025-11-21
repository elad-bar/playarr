# Playarr - IPTV Playlist Manager

**Playarr** is a powerful IPTV Playlist Manager that helps you aggregate, organize, and access content from multiple IPTV providers in one unified platform. Think of it as your personal media library manager for IPTV content.

## What Does Playarr Do?

Playarr solves the problem of managing content from multiple IPTV providers by:

### 🎬 **Unified Content Library**
- **Aggregates Content**: Combines movies and TV shows from multiple IPTV providers (AGTV and Xtream Codec) into one searchable library
- **Smart Deduplication**: Intelligently handles overlapping content from different providers using priority-based processing
- **Organized Categories**: Automatically organizes content by type (movies vs. TV shows) and provider-specific categories

### 🎨 **Rich Metadata**
- **TMDB Integration**: Enriches your content with high-quality metadata from The Movie Database (TMDB), including:
  - Movie posters and backdrops
  - Descriptions and plot summaries
  - Cast and crew information
  - Ratings and release dates
- **Intelligent Matching**: Automatically matches provider titles with TMDB entries using IMDB IDs and fuzzy title matching
- **Normalized Data**: Standardizes metadata across different providers into a consistent format

### 🔄 **Automated Updates**
- **Scheduled Sync**: Automatically fetches new content from your providers:
  - Provider content sync: Every 1 hour
  - Content aggregation: Every 5 minutes
- **Update Detection**: Automatically detects and processes updates for TV shows
- **Smart Caching**: Efficient caching system minimizes API calls and improves performance

### 🌐 **Web Interface**
- **Easy Management**: User-friendly web interface for managing your IPTV setup
- **Content Browsing**: Browse and search through all your aggregated content
- **Provider Management**: Add, edit, enable/disable, and prioritize IPTV providers
- **Settings Configuration**: Configure TMDB API keys, rate limits, and other settings
- **User Management**: Create and manage user accounts with different permission levels
- **System Monitoring**: Monitor system health and job status

### 📺 **Multiple Client Support**
Playarr supports a wide variety of media clients through different protocols:

- **Stremio Addon**: Use Playarr as a Stremio addon to access all your movies and TV shows directly in Stremio
  - Live TV channels are also available if configured
  - Seamless streaming with automatic source selection

- **M3U8 Playlist Support**: Generate M3U8 playlists for movies and TV shows
  - Compatible with any M3U8-based IPTV player
  - Includes rich metadata (posters, genres, descriptions)
  - Supports watchlist-based filtering

- **Xtream Code API**: Full Xtream Code API compatibility
  - Works with any Xtream Code API compatible client
  - Supports VOD (movies), series, and Live TV
  - Standard Xtream Code API endpoints and authentication

- **Strmarr Integration**: Integration with Strmarr for Emby, Jellyfin, and Kodi
  - Generates STRM files that point to your Playarr streams
  - Allows Emby, Jellyfin, and Kodi to display your watchlist as local media
  - Automatic synchronization with your Playarr watchlist

### 🎯 **Key Features**

#### Multi-Provider Support
- **AGTV (Apollo Group TV)**: M3U8 format provider support
- **Xtream Codec**: Full Xtream API support with extended metadata
- **Priority System**: Set provider priorities to control which content takes precedence when duplicates exist
- **Enable/Disable**: Easily enable or disable providers without deleting configurations

#### Content Quality Control
- **Title Cleanup**: Automatically cleans up title names (removes language tags, quality indicators, etc.)
- **Content Filtering**: Filter out unwanted or low-quality content using ignore patterns
- **Best Source Selection**: Automatically selects the best available stream source

#### Performance & Reliability
- **Intelligent Caching**: Multi-layer caching system for fast data retrieval
- **Rate Limiting**: Configurable rate limiting per provider to respect API constraints
- **Concurrent Processing**: Efficient parallel processing of movies and TV shows
- **Error Handling**: Robust error handling with detailed logging

#### Multi-User Watchlist Management
- **Personal Watchlists**: Each user has their own watchlist/favorites
- **Content Filtering**: All clients automatically show only content from your watchlist
- **Easy Management**: Add or remove titles from your watchlist through the web interface
- **Isolated Access**: Each user only sees and can access their own selected content

For a complete feature list, see the [Features](docs/FEATURES.md) documentation.

## Who is Playarr For?

Playarr is perfect for:

- **IPTV Service Providers**: Who want to aggregate content from multiple sources
- **Content Managers**: Building unified content catalogs from diverse IPTV providers
- **Media Enthusiasts**: Who want a better way to organize and access their IPTV content
- **Stremio Users**: Who want to integrate their IPTV providers into Stremio
- **Emby/Jellyfin/Kodi Users**: Who want to use Strmarr to integrate Playarr with their media server
- **M3U8 Player Users**: Who want M3U8 playlist support for their IPTV players
- **Xtream Code API Users**: Who want Xtream Code API compatibility for their existing clients

## Supported Clients & Access Methods

Playarr provides multiple ways to access your content, making it compatible with a wide range of media clients:

### 🌐 **Web Interface**
- Browse and search your entire content library
- Manage providers, settings, and users
- Monitor system health and job status
- Access at `http://localhost:3000` (or your configured port)

### 📺 **Stremio**
- Native Stremio addon support
- Access all movies, TV shows, and Live TV channels
- Automatic metadata and poster integration
- Get your addon URL from your profile page

### 📋 **M3U8 Playlists**
- Generate M3U8 playlists for movies and TV shows
- Compatible with any M3U8-based IPTV player
- Includes rich metadata (posters, genres, descriptions)
- Automatically filtered by user watchlist

### 🔌 **Xtream Code API**
- Full Xtream Code API compatibility
- Works with any Xtream Code API compatible client
- Supports VOD (movies), series, and Live TV
- Automatically filtered by user watchlist
- Standard authentication

### 🎬 **Strmarr (Emby, Jellyfin, Kodi)**
- Integration with [Strmarr](https://github.com/elad-bar/strmarr) tool
- Generates STRM files that point to your Playarr streams
- Allows Emby, Jellyfin, and Kodi to display your watchlist as local media
- Automatic synchronization with your Playarr watchlist
- Setup instructions available in your profile page

## How Does It Work?

1. **Configure Providers**: Add your IPTV provider credentials (AGTV or Xtream Codec) through the web interface - see [User Flows](docs/USER_FLOWS.md) for detailed steps
2. **Automatic Fetching**: Playarr automatically fetches and processes content from your providers
3. **Metadata Enrichment**: Content is enriched with TMDB metadata for better organization
4. **Unified Access**: Access all your content through any of the supported clients and methods above
5. **Continuous Updates**: Playarr keeps your library up-to-date with scheduled background jobs

For detailed step-by-step workflows, see the [User Flows](docs/USER_FLOWS.md) guide.

## Getting Started

1. **Install Playarr**: Set up Playarr using Docker or run it directly - see [Deployment Guide](docs/DEPLOYMENT.md) for detailed instructions
2. **Access Web UI**: Open `http://localhost:3000` in your browser
3. **Login**: Use the default admin credentials (configured via environment variables)
4. **Add Providers**: Configure your IPTV providers in the Settings - see [User Flows](docs/USER_FLOWS.md) for step-by-step instructions
5. **Wait for Sync**: Let Playarr fetch and process your content (first sync may take some time)
6. **Enjoy**: Access your unified content library through:
   - Web interface for browsing and management
   - Stremio: Add the Stremio addon URL from your profile
   - M3U8 Players: Access your personalized playlists
   - Xtream Code API Clients: Connect using your credentials
   - Emby/Jellyfin/Kodi: Set up Strmarr to generate STRM files (see your profile for instructions)

## Technical Details

- **Database**: MongoDB for efficient data storage and querying
- **API**: RESTful API for programmatic access
- **Web UI**: React-based modern web interface
- **Containerized**: Full Docker support for easy deployment
- **Extensible**: Plugin-based provider system for easy extension

For detailed system architecture and design, see the [Architecture](docs/ARCHITECTURE.md) documentation.

## Configuration

All configuration is done through the web interface. Navigate to **Settings** in the web UI to configure your providers and system settings.

### Adding IPTV Providers

To add a new IPTV provider:

1. Go to **Settings → IPTV Providers**
2. Click **"Add Provider"**
3. Fill in the required information:
   - **Provider ID**: A unique name to identify this provider
   - **Provider Type**: Choose either "AGTV" or "Xtream Codec"
   - **API URL**: The base URL for your provider's API
   - **Username**: Your provider account username
   - **Password**: Your provider account password
   - **Priority**: Set a priority number (lower numbers = higher priority). This determines which provider's content takes precedence when the same content exists in multiple providers.
   - **Enabled**: Toggle to enable or disable this provider
4. Click **"Save"**

The provider will start syncing content automatically. You can enable or disable providers at any time without deleting the configuration.

### General Settings

To configure system-wide settings:

1. Go to **Settings → General**
2. Configure the following:
   - **TMDB API Token**: (Optional but recommended) Enter your TMDB API token to enable rich metadata enrichment (posters, descriptions, cast info, etc.). Get your free token from [TMDB](https://www.themoviedb.org/settings/api).
   - **Rate Limiting**: Configure API rate limits to control how many requests are made per second (advanced settings)

These settings apply globally to all providers and affect how Playarr processes and enriches your content.

## Documentation

For more detailed information, see the following documentation:

- **[Architecture](docs/ARCHITECTURE.md)** - System architecture and design
- **[Features](docs/FEATURES.md)** - Complete feature list
- **[Deployment](docs/DEPLOYMENT.md)** - Setup and deployment guide
- **[User Flows](docs/USER_FLOWS.md)** - Step-by-step user workflows
- **[MongoDB Entities](docs/MONGODB_ENTITIES.md)** - MongoDB collections, schemas, and indexes

---

**Playarr** - Your unified IPTV content management solution.
