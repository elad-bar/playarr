# Playarr Features

## Overview

Playarr is a comprehensive IPTV Playlist Manager that aggregates content from multiple IPTV providers, enriches it with TMDB metadata, and provides multiple client access methods. This document details all features and capabilities.

## Table of Contents

1. [Core Features](#core-features)
2. [Multi-Provider Support](#multi-provider-support)
3. [Content Management](#content-management)
4. [User Management](#user-management)
5. [Client Support](#client-support)
6. [Performance & Reliability](#performance--reliability)
7. [Automation](#automation)
8. [Use Cases](#use-cases)

---

## Core Features

- Fetches movies and TV shows from AGTV (M3U8) and Xtream Codec providers
- Disk caching for efficient data retrieval with configurable expiration policies (TTL values defined in provider classes)
- Automatic update detection for TV shows (Xtream)
- All data stored in MongoDB for efficient querying and scalability
- Supports provider-specific cleanup rules and ignore patterns
- Respects provider priority and enabled status
- Native EngineScheduler orchestrates recurring jobs defined in `web-api/src/jobs.json`:
  - IPTV provider sync runs on startup (after a short delay) and then every 6 hours
  - Live TV synchronization runs on startup and then every 12 hours (automatically syncs channels from active providers)
  - Post-execution chains (like `providerTitlesMonitor`) trigger automatically after dependent jobs

## Multi-Provider Support

### Supported Providers

- **AGTV (Apollo Group TV)**: M3U8 format provider support
- **Xtream Codec**: Full Xtream API support with extended metadata

### Provider Management

- **Priority System**: Set provider priorities to control which content takes precedence when duplicates exist
- **Enable/Disable**: Easily enable or disable providers without deleting configurations
- **Dynamic Configuration**: Change provider settings without code changes
- **Multiple Providers**: Support for multiple providers of the same or different types simultaneously

## Content Management

### Content Aggregation

- **Multi-Provider Aggregation**: Combines content from multiple IPTV providers into one unified library
- **Smart Deduplication**: Intelligently handles overlapping content from different providers
- **Category Organization**: Automatically organizes content by type (movies vs. TV shows) and provider-specific categories

### Metadata Enrichment

- **TMDB Integration**: Enriches content with high-quality metadata from The Movie Database (TMDB)
- **Intelligent Matching**: Automatically matches provider titles with TMDB entries using:
  - Direct IMDB ID matching (for AGTV providers)
  - Title-based search with fuzzy matching
- **Rich Metadata**: Includes posters, backdrops, descriptions, cast, crew, ratings, and release dates
- **Metadata Normalization**: Standardizes metadata across different providers into a unified format

### Content Quality Control

- **Title Cleanup**: Automatically cleans up title names (removes language tags, quality indicators, etc.)
- **Content Filtering**: Filter out unwanted or low-quality content using ignore patterns
- **Best Source Selection**: Automatically selects the best available stream source
- **Update Detection**: Automatically detects and processes updates for TV shows

## User Management

### Multi-User Support

- **User Accounts**: Create and manage multiple user accounts
- **Role-Based Access**: Different permission levels (admin, user)
- **Per-User Watchlists**: Each user has their own personal watchlist/favorites
- **Isolated Access**: Each user only sees and can access their own selected content

### Watchlist Management

- **Personal Watchlists**: Add titles to your personal watchlist
- **Bulk Operations**: Update multiple titles' watchlist status at once
- **Content Filtering**: All clients automatically show only content from your watchlist
- **Easy Management**: Add or remove titles through the web interface

## Client Support

### Web Interface

- **Content Browsing**: Browse and search through all aggregated content
- **Provider Management**: Add, edit, delete, and prioritize IPTV providers
- **Settings Configuration**: Configure TMDB API keys, rate limits, and other settings
- **User Management**: Create and manage user accounts
- **System Monitoring**: Monitor system health and job status

### Multiple Client Protocols

- **Stremio Addon**: Native Stremio addon support with automatic metadata integration
- **M3U8 Playlists**: Generate M3U8 playlists compatible with any M3U8-based IPTV player
- **Xtream Code API**: Full Xtream Code API compatibility for Xtream Code API clients
- **Strmarr Integration**: Generate STRM files for Emby, Jellyfin, and Kodi

All client access methods automatically filter content based on user watchlists.

## Performance & Reliability

### Caching

- **Intelligent Caching**: Multi-layer caching system for fast data retrieval
  - Raw API response caching
  - Processed data caching
  - Automatic cache purging to manage disk space

### Rate Limiting

- **Configurable Rate Limiting**: Per-provider rate limiting to respect API constraints
- **Concurrent Processing**: Efficient parallel processing of movies and TV shows

### Error Handling

- **Robust Error Handling**: Detailed logging and recovery mechanisms
- **Progress Tracking**: Real-time progress monitoring for long-running operations
- **Health Monitoring**: Health check support for containerized deployments

## Automation

### Scheduled Jobs

- **Automated Job Scheduling**: Handled by the in-process `EngineScheduler`, which reads intervals and delays from `web-api/src/jobs.json`
- **Provider Title Fetching** (`syncIPTVProviderTitles`): Starts shortly after boot, repeats every 6 hours, and triggers `providerTitlesMonitor` when complete
- **Provider Titles Monitor** (`providerTitlesMonitor`): Runs as a post-execution chain to process main titles whenever the sync completes
- **Live TV Synchronization** (`syncLiveTV`): Runs on startup and every 12 hours to automatically sync channels and EPG data from active IPTV providers

### Update Detection

- **Automatic Updates**: Automatically detects and processes updates for TV shows
- **Incremental Processing**: Only processes new or updated content to minimize processing time

## Use Cases

Playarr is designed for:

- **IPTV Service Providers**: Aggregating content from multiple sources
- **Content Managers**: Building unified content catalogs from diverse IPTV providers
- **Media Enthusiasts**: Better way to organize and access IPTV content
- **Stremio Users**: Integrating IPTV providers into Stremio
- **Emby/Jellyfin/Kodi Users**: Using Strmarr to integrate Playarr with media servers
- **M3U8 Player Users**: M3U8 playlist support for IPTV players
- **Xtream Code API Users**: Xtream Code API compatibility for existing clients

