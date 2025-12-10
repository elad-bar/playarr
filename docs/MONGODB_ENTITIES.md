# MongoDB Entities Documentation

This document describes all MongoDB collections (entities) used in Playarr, including their structure, purpose, and indexes.

## Overview

Playarr uses MongoDB to store all runtime data including titles, provider information, user accounts, settings, and Live TV data. All collections are automatically indexed for optimal query performance.

## Table of Contents

1. [titles](#titles)
2. [provider_titles](#provider_titles)
3. [iptv_providers](#iptv_providers)
4. [users](#users)
5. [settings](#settings)
6. [job_history](#job_history)
7. [channels](#channels)
8. [programs](#programs)
9. [stats](#stats)
10. [provider_categories](#provider_categories)

---

## titles

### Purpose

The `titles` collection stores aggregated main titles (movies and TV shows) with enriched TMDB metadata. This is the primary collection for content browsing and serves as the unified catalog that combines data from multiple IPTV providers.

**Key Features:**
- Contains TMDB-enriched metadata (posters, descriptions, cast, ratings)
- Aggregates content from multiple providers
- Stores all available stream sources in the `media` array
- Used for content browsing, search, and client access (Stremio, M3U8, Xtream Code API)

### Structure

```javascript
{
  _id: ObjectId,                    // MongoDB auto-generated ID
  title_key: String,                 // Unique identifier: "movies-{tmdbId}" or "tvshows-{tmdbId}"
  title_id: Number,                  // TMDB ID (the actual TMDB identifier)
  type: String,                      // Media type: "movies" | "tvshows"
  title: String,                     // Title name
  release_date: String,              // Release date in "YYYY-MM-DD" format
  vote_average: Number,              // TMDB vote average (0-10)
  vote_count: Number,                // Number of votes on TMDB
  overview: String,                  // Plot overview/description
  poster_path: String,               // TMDB poster image path (e.g., "/abc123.jpg")
  backdrop_path: String,             // TMDB backdrop image path
  genres: Array,                     // Array of genre objects: [{ id: Number, name: String }]
  runtime: Number,                   // Runtime in minutes (movies only, optional)
  imdb_id: String,                   // IMDB ID (e.g., "tt0133093") if available
  similar_titles: Array,             // Array of title_key strings for similar titles
  media: Array,                      // Array of MediaStream objects (see below)
  createdAt: ISODate,                // Document creation timestamp
  lastUpdated: ISODate               // Last update timestamp
}
```

**MediaStream Object Structure:**
```javascript
{
  name: String,                      // Stream name: "main" for movies, episode name for TV shows
  proxy_path: String,                // File path for the STRM file
  sources: Array,                    // Array of MediaStreamSource objects (see below)
  // TV shows only:
  season: Number,                    // Season number (TV shows only)
  episode: Number,                   // Episode number (TV shows only)
  air_date: String,                  // Episode air date (TV shows only)
  overview: String,                  // Episode overview (TV shows only)
  still_path: String                 // Episode still image path (TV shows only)
}
```

**MediaStreamSource Object Structure:**
```javascript
{
  provider_id: String,               // Provider identifier (e.g., "agtv", "digitalizard")
  provider_title_id: String,         // Provider's original title ID
  provider_url: String               // Stream URL from provider
}
```

### Indexes

| Index Fields | Type | Options | Purpose | Query Patterns |
|--------------|------|---------|---------|----------------|
| `{ title_key: 1 }` | Unique | `unique: true` | Primary lookup key for titles. Enables fast retrieval by title_key. | `findOne({ title_key: "movies-12345" })` |
| `{ type: 1, title: 1 }` | Compound | - | Most common query pattern (type filter + alphabetical sort). Optimizes browsing by type with title sorting. | `find({ type: "movies" }).sort({ title: 1 })` |
| `{ type: 1, release_date: 1 }` | Compound | - | Date range queries with type. Enables filtering by type and sorting by release date. | `find({ type: "movies", release_date: { $gte: "2020" } })` |
| `{ release_date: 1 }` | Standard | - | Release date only queries. Used when type filter is not needed. | `find({ release_date: { $gte: "2020" } })` |
| `{ title: 1 }` | Standard | - | Sort-only queries when type filter is not present. | `find({}).sort({ title: 1 })` |
| `{ type: 1, release_date: 1, title: 1 }` | Compound | - | Common filter+sort combinations (type + year + alphabetical sort). Optimizes complex queries. | `find({ type: "movies", release_date: { $gte: "2020" } }).sort({ title: 1 })` |
| `{ type: 1, imdb_id: 1 }` | Sparse | `sparse: true` | Stremio IMDB ID lookups (type + imdb_id). Sparse because not all titles have IMDB IDs. | `find({ type: "movie", imdb_id: "tt0133093" })` |
| `{ "media.sources.provider_id": 1 }` | Standard | - | Provider-based queries on media sources. Enables finding titles with streams from specific providers. | `find({ "media.sources.provider_id": "agtv" })` |
| `{ type: 1, "media.sources.provider_id": 1 }` | Compound | - | Type + provider combination queries. Optimizes queries filtering by both type and provider. | `find({ type: "movies", "media.sources.provider_id": "agtv" })` |
| `{ title: "text" }` | Text | - | Full-text search on title names. Enables text search across all titles. | `find({ $text: { $search: "Avengers" } })` |

### Relationships

- **Related to `provider_titles`**: 
  - `title_key` → `provider_titles.title_key` (one-to-many)
  - Multiple providers can have the same title
  - Stream sources are extracted from `provider_titles.streams` and embedded in `media` array

- **Related to `users`**: 
  - `title_key` referenced in `users.watchlist` array (many-to-many via array)
  - Users can add titles to their watchlist

- **Self-referential**: 
  - `similar_titles` contains array of `title_key` values (many-to-many)

---

## provider_titles

### Purpose

The `provider_titles` collection stores provider-specific title information, including provider URLs and ignored status. This collection serves as the source data that gets aggregated into the main `titles` collection.

**Key Features:**
- Stores raw title data from each IPTV provider
- Contains provider-specific stream URLs
- Tracks ignored titles per provider
- Used for incremental sync and change detection

### Structure

```javascript
{
  _id: ObjectId,                     // MongoDB auto-generated ID
  provider_id: String,               // Provider identifier (e.g., "agtv", "digitalizard")
  title_key: String,                 // Generated key: "{type}-{tmdb_id}" (matches titles.title_key)
  type: String,                      // Media type: "movies" | "tvshows"
  title_id: String,                  // Provider's original title ID (provider-specific)
  tmdb_id: Number,                   // TMDB ID if matched (matches titles.title_id)
  title: String,                     // Title name (provider's version)
  category_id: Number,               // Provider category ID
  release_date: String,              // Release date
  streams: Object,                   // Provider stream URLs: { "main": "/url" } or { "S01-E01": "/url" }
  ignored: Boolean,                  // Whether this title is ignored (from ignored.json)
  ignored_reason: String,            // Reason for ignoring (if ignored is true, null otherwise)
  createdAt: ISODate,                // Document creation timestamp
  lastUpdated: ISODate               // Last update timestamp
}
```

### Indexes

| Index Fields | Type | Options | Purpose | Query Patterns |
|--------------|------|---------|---------|----------------|
| `{ provider_id: 1, title_key: 1 }` | Unique Compound | `unique: true` | Primary lookup (unique compound key). Ensures one provider title per title_key per provider. | `findOne({ provider_id: "agtv", title_key: "movies-12345" })` |
| `{ provider_id: 1, type: 1 }` | Compound | - | Most common query pattern. Finds all titles of a specific type for a provider. | `find({ provider_id: "agtv", type: "movies" })` |
| `{ provider_id: 1, ignored: 1 }` | Compound | - | Ignored titles filtering. Filters ignored/non-ignored titles per provider. | `find({ provider_id: "agtv", ignored: false })` |
| `{ provider_id: 1, lastUpdated: 1 }` | Compound | - | Incremental sync queries. Enables fetching only titles updated since last sync. | `find({ provider_id: "agtv", lastUpdated: { $gt: date } })` |
| `{ provider_id: 1, ignored: 1, lastUpdated: 1 }` | Compound | - | Incremental sync queries with ignored filter. Combines ignored status with incremental sync. | `find({ provider_id: "agtv", ignored: false, lastUpdated: { $gt: date } })` |
| `{ provider_id: 1, type: 1, ignored: 1 }` | Compound | - | Type+ignored filtering per provider. Filters by type and ignored status together. | `find({ provider_id: "agtv", type: "movies", ignored: false })` |
| `{ title_key: 1 }` | Standard | - | Find all providers for a title. Enables finding all provider instances of a main title. | `find({ title_key: "movies-12345" })` |
| `{ type: 1, tmdb_id: 1, ignored: 1 }` | Compound | - | Change detection queries (type + tmdb_id + ignored filter). Used for detecting changes in provider titles. | `find({ type: "movies", tmdb_id: 12345, ignored: false })` |

### Relationships

- **Related to `titles`**: 
  - `title_key` → `titles.title_key` (many-to-one)
  - `tmdb_id` → `titles.title_id` (many-to-one)
  - Multiple providers can have the same title
  - Stream sources from `provider_titles.streams` are extracted and embedded in `titles.media` array

- **Related to `iptv_providers`**: 
  - `provider_id` → `iptv_providers.id` (many-to-one)
  - Provider has many titles

---

## iptv_providers

### Purpose

The `iptv_providers` collection stores IPTV provider configurations and settings. This includes provider credentials, API URLs, rate limiting settings, and provider-specific configuration.

**Key Features:**
- Stores provider authentication credentials
- Contains provider priority and enabled status
- Includes cleanup rules and ignore patterns
- Used by the engine to fetch content from providers

### Structure

```javascript
{
  _id: ObjectId,                     // MongoDB auto-generated ID
  id: String,                        // Unique provider identifier (e.g., "agtv", "digitalizard")
  name: String,                      // Provider display name
  type: String,                      // Provider type: "agtv" | "xtream"
  enabled: Boolean,                  // Whether provider is enabled
  priority: Number,                  // Provider priority (lower = higher priority)
  api_url: String,                   // Base API URL for provider
  username: String,                  // Provider username
  password: String,                  // Provider password
  streams_urls: Array,               // Array of stream URLs (optional)
  cleanup: Object,                   // Regex patterns for title cleanup (optional)
  ignored_titles: Object,            // Titles to ignore (optional)
  api_rate: Object,                  // Rate limiting configuration: { concurrent: Number, duration_seconds: Number }
  enabled_categories: Object,       // Enabled categories: { movies: Array, tvshows: Array, live: Array }
  deleted: Boolean,                  // Soft delete flag (optional)
  createdAt: ISODate,                // Document creation timestamp
  lastUpdated: ISODate               // Last update timestamp
}
```

### Indexes

| Index Fields | Type | Options | Purpose | Query Patterns |
|--------------|------|---------|---------|----------------|
| `{ id: 1 }` | Unique | `unique: true` | Primary lookup (unique). Fast provider lookup by ID. Enforces unique provider IDs. | `findOne({ id: "agtv" })` |
| `{ deleted: 1, priority: 1 }` | Compound | - | Active providers with priority sort. Filters non-deleted providers and sorts by priority. | `find({ deleted: { $ne: true } }).sort({ priority: 1 })` |
| `{ priority: 1 }` | Partial | `partialFilterExpression: { deleted: { $ne: true } }` | Non-deleted providers with priority sort (partial index). Only indexes non-deleted providers for efficient priority sorting. | `find({ deleted: { $ne: true } }).sort({ priority: 1 })` |

### Relationships

- **Related to `provider_titles`**: 
  - `id` → `provider_titles.provider_id` (one-to-many)
  - Provider has many titles

- **Related to `titles`**: 
  - `id` → `titles.media[].sources[].provider_id` (one-to-many via embedded media array)
  - Provider streams are embedded in titles.media array

- **Related to `channels`**: 
  - `id` → `channels.provider_id` (one-to-many)
  - Provider has many channels

- **Related to `programs`**: 
  - `id` → `programs.provider_id` (one-to-many)
  - Provider has many programs

---

## users

### Purpose

The `users` collection stores user accounts with authentication credentials and personal watchlists. Each user has their own watchlist that filters content in all client access methods.

**Key Features:**
- Stores user authentication (username/password hash)
- Contains per-user watchlists (organized by media type)
- Supports role-based access (admin/user)
- Includes API keys for programmatic access
- Watchlist determines what content is visible to each user

### Structure

```javascript
{
  _id: ObjectId,                     // MongoDB auto-generated ID
  username: String,                  // Unique username (used for login)
  password_hash: String,             // Hashed password (bcrypt)
  api_key: String,                   // API key for programmatic access (unique, optional)
  role: String,                      // User role: "admin" | "user"
  watchlist: {                       // Unified watchlist object organized by media type
    movies: Array<string>,            // Array of title keys (format: "movies-{id}")
    tvshows: Array<string>,           // Array of title keys (format: "tvshows-{id}")
    live: Array<string>              // Array of channel keys (format: "live-{providerId}-{channelId}")
  },
  createdAt: ISODate,                // Account creation timestamp
  lastUpdated: ISODate               // Last update timestamp
}
```

### Indexes

| Index Fields | Type | Options | Purpose | Query Patterns |
|--------------|------|---------|---------|----------------|
| `{ username: 1 }` | Unique | `unique: true` | Authentication (unique). Fast username lookup for authentication. Enforces unique usernames. | `findOne({ username: "admin" })` |
| `{ api_key: 1 }` | Unique Sparse | `unique: true, sparse: true` | API key authentication (unique, sparse). Enables API key-based authentication. Sparse because not all users may have API keys. | `findOne({ api_key: "abc123" })` |

### Relationships

- **Related to `titles`**: 
  - `watchlist.movies` and `watchlist.tvshows` arrays contain `title_key` values → `titles.title_key` (many-to-many via array)
  - Users can have multiple titles in watchlist
  - Titles can be in multiple users' watchlists
- **Related to `channels`**: 
  - `watchlist.live` array contains channel keys → `channels.channel_key` (many-to-many via array)
  - Users can have multiple channels in watchlist
  - Channels can be in multiple users' watchlists


- **Related to `programs`**: 
  - `username` → `programs.username` (one-to-many)
  - User has many EPG programs

---

## settings

### Purpose

The `settings` collection stores global application settings as key-value pairs. Each setting is stored as a separate document with the setting key as the `_id` field.

**Key Features:**
- One document per setting key
- Stores global configuration (TMDB token, rate limits, etc.)
- Used for application-wide settings
- Supports change detection via `lastUpdated` timestamp

### Structure

```javascript
{
  _id: String,                       // Setting key (e.g., "tmdb_token", "tmdb_api_rate")
  value: Any,                        // Setting value (can be String, Object, Number, etc.)
  createdAt: ISODate,                // Document creation timestamp
  lastUpdated: ISODate               // Last update timestamp
}
```

**Common Settings:**
- `tmdb_token`: TMDB API authentication token (String)
- `tmdb_api_rate`: API rate limit configuration (Object: `{ concurrent: Number, duration_seconds: Number }`)

### Indexes

| Index Fields | Type | Options | Purpose | Query Patterns |
|--------------|------|---------|---------|----------------|
| `{ _id: 1 }` | Unique | Automatic | The `_id` field is automatically indexed in MongoDB. Since `_id` is the setting key, lookups by key are O(1). | `findOne({ _id: "tmdb_token" })` |
| `{ lastUpdated: 1 }` | Standard | - | Changed settings query. Enables finding settings that changed since a specific date. | `find({ lastUpdated: { $gt: date } })` |

### Relationships

- **No direct relations** - Settings are application-level configuration, not related to other collections.

---

## job_history

### Purpose

The `job_history` collection tracks job execution history and status for engine jobs. This enables monitoring, debugging, and incremental processing.

**Key Features:**
- Tracks job execution status (running, completed, failed, cancelled)
- Stores execution results and error messages
- Enables incremental processing by tracking last execution time
- Supports provider-specific jobs

### Structure

```javascript
{
  _id: ObjectId,                     // MongoDB auto-generated ID
  job_name: String,                  // Job name: "ProcessProvidersTitlesJob" | "ProcessMainTitlesJob" | "MonitorConfigurationJob"
  provider_id: String,               // Optional, for provider-specific jobs
  status: String,                    // Job status: "running" | "cancelled" | "completed" | "failed"
  last_execution: ISODate,           // Last execution timestamp
  execution_count: Number,           // Total successful executions
  last_result: Object,               // Last execution result (varies by job type)
  last_error: String,                // Last error message (if failed)
  last_provider_check: ISODate,      // Last time providers were checked (optional)
  last_settings_check: ISODate,      // Last time settings were checked (optional)
  last_policy_check: ISODate,        // Last time cache policy was checked (optional)
  createdAt: ISODate,                // Document creation timestamp
  lastUpdated: ISODate               // Last update timestamp
}
```

**Status Lifecycle:**
1. **running**: Job is currently executing
2. **cancelled**: Job was cancelled due to configuration changes (automatically retriggered)
3. **completed**: Job finished successfully
4. **failed**: Job encountered an error during execution

### Indexes

| Index Fields | Type | Options | Purpose | Query Patterns |
|--------------|------|---------|---------|----------------|
| `{ job_name: 1 }` | Standard | - | Primary lookup. Efficient lookup by job name. | `findOne({ job_name: "ProcessProvidersTitlesJob" })` |
| `{ job_name: 1, provider_id: 1 }` | Compound | - | Provider-specific jobs. For jobs that are provider-specific, enables efficient lookup. | `findOne({ job_name: "ProcessProvidersTitlesJob", provider_id: "agtv" })` |
| `{ status: 1 }` | Standard | - | Status queries (startup reset). Enables finding all running jobs for reset on startup. | `find({ status: "running" })` |

### Relationships

- **No direct relations** - Job history tracks execution state, not data relationships.

---

## channels

### Purpose

The `channels` collection stores Live TV channel information per provider. Channels are automatically synced from active IPTV providers (AGTV and Xtream) and made available to all users. This centralizes channel management and eliminates the need for per-user Live TV configuration.

**Key Features:**
- Stores channel information per provider (not per user)
- Contains channel metadata (name, logo, group, stream URL)
- Used for Live TV streaming and EPG display
- Supports Stremio Live TV integration
- Channels are automatically synced from providers via scheduled jobs

### Structure

```javascript
{
  _id: ObjectId,                     // MongoDB auto-generated ID
  provider_id: String,               // Provider identifier (references iptv_providers.id)
  channel_id: Number,                // Unique channel identifier (within provider) - numeric ID
  channel_key: String,                // Unique key per provider (format: "live-{providerId}-{channelId}")
  name: String,                      // Channel name
  url: String,                      // Stream URL
  tvg_id: String,                    // TV Guide ID (optional)
  tvg_name: String,                  // TV Guide name (optional)
  tvg_logo: String,                  // Channel logo URL (optional)
  group_title: String,               // Channel group/category (optional)
  category_id: Number,               // Category ID for Xtream providers (optional)
  duration: Number,                 // Stream duration (-1 for live)
  createdAt: ISODate,                // Document creation timestamp
  lastUpdated: ISODate               // Last update timestamp
}
```

### Indexes

| Index Fields | Type | Options | Purpose | Query Patterns |
|--------------|------|---------|---------|----------------|
| `{ provider_id: 1, channel_id: 1 }` | Unique Compound | `unique: true` | Primary lookup (unique compound key). Ensures one channel per provider per channel_id. | `findOne({ provider_id: "agtv", channel_id: 10000 })` |
| `{ provider_id: 1 }` | Standard | - | Provider channels lookup. Finds all channels for a specific provider. | `find({ provider_id: "agtv" })` |
| `{ channel_key: 1 }` | Standard | - | Channel key lookup (for watchlist queries). Enables fast lookup by channel_key for watchlist filtering. | `find({ channel_key: "live-agtv-channel123" })` |

### Relationships

- **Related to `iptv_providers`**: 
  - `provider_id` → `iptv_providers.id` (many-to-one)
  - Provider has many channels

- **Related to `programs`**: 
  - `provider_id` + `channel_id` → `programs.provider_id` + `programs.channel_id` (one-to-many)
  - Channel has many programs

- **Related to `users`**: 
  - `channel_key` referenced in `users.watchlist.live` array (many-to-many via array)
  - Users can add channels to their watchlist

---

## programs

### Purpose

The `programs` collection stores EPG (Electronic Program Guide) program information per provider and channel. This enables displaying what's currently playing and upcoming programs for Live TV channels. Programs are automatically synced from provider EPG sources.

**Key Features:**
- Stores program schedule per provider and channel (not per user)
- Contains program metadata (title, description, start/stop times)
- Used for EPG display in clients
- Supports Stremio Live TV EPG integration
- Programs are automatically synced from providers via scheduled jobs

### Structure

```javascript
{
  _id: ObjectId,                     // MongoDB auto-generated ID
  provider_id: String,               // Provider identifier (references iptv_providers.id)
  channel_id: Number,                // Channel identifier (references channels.channel_id) - numeric ID
  start: ISODate,                    // Program start time
  stop: ISODate,                     // Program end time
  title: String,                     // Program title
  desc: String,                      // Program description (optional)
  category: String,                   // Program category (optional)
  icon: String,                      // Program icon URL (optional)
  episode: String,                   // Episode number (optional)
  createdAt: ISODate,                // Document creation timestamp
  lastUpdated: ISODate               // Last update timestamp
}
```

### Indexes

| Index Fields | Type | Options | Purpose | Query Patterns |
|--------------|------|---------|---------|----------------|
| `{ provider_id: 1, channel_id: 1, start: 1, stop: 1 }` | Unique Compound | `unique: true` | Primary lookup (unique compound key). Ensures one program per provider per channel per time slot. | `findOne({ provider_id: "agtv", channel_id: 10000, start: date1, stop: date2 })` |
| `{ provider_id: 1, channel_id: 1 }` | Compound | - | Provider channel programs lookup. Finds all programs for a specific provider and channel. | `find({ provider_id: "agtv", channel_id: 10000 })` |

### Relationships

- **Related to `iptv_providers`**: 
  - `provider_id` → `iptv_providers.id` (many-to-one)
  - Provider has many programs

- **Related to `channels`**: 
  - `provider_id` + `channel_id` → `channels.provider_id` + `channels.channel_id` (many-to-one)
  - Channel has many programs

---

## stats

### Purpose

The `stats` collection stores application statistics and metrics. This is typically a single document or a small collection of aggregate statistics.

**Key Features:**
- Stores aggregate application metrics
- Used for system monitoring and reporting
- Typically contains counts and totals
- No indexes needed (single document or small collection)

### Structure

```javascript
{
  _id: ObjectId,                     // MongoDB auto-generated ID
  total_requests: Number,            // Total API requests processed
  total_titles: Number,              // Total number of titles
  // ... additional stat fields as needed
  lastUpdated: ISODate               // Last update timestamp (no createdAt for stats)
}
```

### Indexes

| Index Fields | Type | Options | Purpose | Query Patterns |
|--------------|------|---------|---------|----------------|
| None | N/A | - | Single document collection - no indexes needed. Always retrieved by `_id` or as the only document. | `findOne({})` |

### Relationships

- **No direct relations** - Stats are aggregate metrics, not related to other collections.

---

## Collection Relationships Summary

### Primary Relationships

```
titles (1) ──< (many) provider_titles
titles (1) ──< (many) users.watchlist.movies, users.watchlist.tvshows (via array)
channels (1) ──< (many) users.watchlist.live (via array)

iptv_providers (1) ──< (many) provider_titles
iptv_providers (1) ──< (many) channels
iptv_providers (1) ──< (many) programs
iptv_providers (1) ──< (many) provider_categories

channels (1) ──< (many) programs (via provider_id + channel_id)
```

### Key Design Decisions

1. **Embedded Media Array**: The `titles.media` field contains all stream information directly embedded in the title document. This eliminates the need for a separate `title_streams` collection and simplifies queries.

2. **Title Key as Foreign Key**: `title_key` is used consistently across collections (`titles`, `provider_titles`, `users.watchlist.movies`, `users.watchlist.tvshows`) as the primary relationship key.

3. **Provider-Based Live TV**: Channels and programs are stored per provider, automatically synced from active IPTV providers. All users access the same provider-sourced channels, with personal watchlists for filtering.

4. **Soft Delete for Providers**: Providers use a `deleted` flag for soft deletion, allowing data retention while hiding providers from active use.

---

## Index Strategy Summary

### Unique Indexes
- `titles.title_key`: Ensures no duplicate titles
- `users.username`: Ensures unique usernames
- `users.api_key`: Ensures unique API keys (sparse)
- `iptv_providers.id`: Ensures unique provider IDs
- `provider_titles.provider_id + title_key`: Ensures unique provider title per provider
- `channels.provider_id + channel_id`: Ensures unique channel per provider
- `programs.provider_id + channel_id + start + stop`: Ensures unique program per time slot
- `provider_categories.provider_id + type + category_id`: Ensures unique category per provider/type/id

### Compound Indexes
Used for common query patterns:
- Filtering by provider and type
- Finding titles with streams from specific providers
- Filtering ignored titles per provider
- Type + provider combination queries
- Incremental sync queries

### Special Indexes
- **Text Index**: `titles.title` enables full-text search
- **Sparse Index**: `titles.type + imdb_id` only indexes documents with IMDB IDs
- **Partial Index**: `iptv_providers.priority` only indexes non-deleted providers

---

## Data Types Reference

- **ObjectId**: MongoDB's default `_id` type (12-byte identifier)
- **ISODate**: MongoDB Date type (stored as BSON Date, displayed as ISO 8601)
- **String**: UTF-8 string
- **Number**: 64-bit floating point or integer
- **Boolean**: true/false
- **Array**: Ordered list of values
- **Object**: Embedded document (nested object)
- **null**: Null value

---

## Notes

- All collections include `createdAt` and `lastUpdated` timestamps (except `stats` which only has `lastUpdated`)
- Timestamps are stored as MongoDB Date objects (ISODate) for efficient date range queries
- The `title_key` format is consistent: `"{type}-{tmdbId}"` (e.g., `"movies-12345"`, `"tvshows-67890"`)
- The `channel_key` format is consistent: `"live-{providerId}-{channelId}"` (e.g., `"live-agtv-channel123"`)
- Indexes are automatically created on application startup
- All indexes support efficient querying and are optimized for common access patterns

