# MongoDB Schema Documentation

This document describes the MongoDB schema for Playarr, including entity structures, indexes, and relationships between collections.

## Table of Contents

1. [titles](#titles)
2. [provider_titles](#provider_titles)
3. [provider_categories](#provider_categories)
4. [users](#users)
5. [iptv_providers](#iptv_providers)
6. [settings](#settings)
7. [stats](#stats)
8. [job_history](#job_history)

---

## titles

Main titles collection containing TMDB movie and TV show metadata.

### Schema

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

| Index | Type | Purpose |
|-------|------|---------|
| `{ title_key: 1 }` | Unique | Primary lookup key for titles. Enables fast retrieval by title_key. |
| `{ type: 1 }` | Standard | Filter titles by media type (movies/tvshows). |
| `{ title: "text" }` | Text | Full-text search on title names. |
| `{ release_date: 1 }` | Standard | Sort and filter by release date. |
| `{ type: 1, release_date: 1 }` | Compound | Efficient filtering by type and sorting by release date. |
| `{ type: 1, imdb_id: 1 }` | Sparse | Stremio IMDB ID lookups (type + imdb_id). |
| `{ "media.sources.provider_id": 1 }` | Standard | Provider-based queries on media sources. |
| `{ type: 1, "media.sources.provider_id": 1 }` | Compound | Type + provider combination queries. |

### Relations

- **Related to `provider_titles`**: 
  - `title_key` → `provider_titles.title_key` (one-to-many)
  - Multiple providers can have the same title
  - Stream sources are extracted from `provider_titles.streams` and embedded in `media` array

- **Related to `users`**: 
  - `title_key` referenced in `users.watchlist` array (many-to-many via array)

- **Self-referential**: 
  - `similar_titles` contains array of `title_key` values (many-to-many)

### Query Examples

```javascript
// Find title by key
db.titles.findOne({ title_key: "movies-12345" })

// Search titles by name
db.titles.find({ $text: { $search: "Avengers" } })

// Get movies released after 2020
db.titles.find({ type: "movies", release_date: { $gte: "2020-01-01" } })

// Find titles with streams from specific provider
db.titles.find({ "media.sources.provider_id": "agtv" })

// Find titles with available media
db.titles.find({ media: { $exists: true, $ne: [] } })

// Find TV show episodes for a specific season
db.titles.find({ 
  title_key: "tvshows-67890",
  "media.season": 1
})
```

---

## title_streams

**⚠️ DEPRECATED: This collection has been removed.**

Stream information is now embedded directly in the `titles.media` array. The `title_streams` collection is no longer used.

**Migration Note:** If you have existing data in `title_streams`, you will need to migrate it to the new `titles.media` structure before using the updated codebase. The new structure consolidates all stream information into the `titles` collection for better performance and simpler queries.

---

## provider_titles

Provider-specific title information, including provider URLs and ignored status.

### Schema

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

| Index | Type | Purpose |
|-------|------|---------|
| `{ provider_id: 1, type: 1 }` | Compound | Find all titles of a specific type for a provider. |
| `{ provider_id: 1, tmdb_id: 1 }` | Compound | Find provider title by TMDB ID for a specific provider. |
| `{ title_key: 1 }` | Standard | Find all provider titles matching a main title. |
| `{ provider_id: 1, ignored: 1 }` | Compound | Filter ignored/non-ignored titles per provider. |

### Relations

- **Related to `titles`**: 
  - `title_key` → `titles.title_key` (many-to-one)
  - `tmdb_id` → `titles.title_id` (many-to-one)
  - Multiple providers can have the same title
  - Stream sources from `provider_titles.streams` are extracted and embedded in `titles.media` array
  - Provider titles are the source of stream URLs that get consolidated into main titles

- **Related to `provider_categories`**: 
  - `provider_id` + `category_id` → `provider_categories.provider_id` + `provider_categories.category_id` (many-to-one)

- **Related to `iptv_providers`**: 
  - `provider_id` → `iptv_providers.id` (many-to-one)

### Query Examples

```javascript
// Get all titles from a provider
db.provider_titles.find({ provider_id: "agtv" })

// Find provider title by TMDB ID
db.provider_titles.find({ provider_id: "agtv", tmdb_id: 12345 })

// Get all ignored titles for a provider
db.provider_titles.find({ provider_id: "agtv", ignored: true })

// Find all provider titles matching a main title
db.provider_titles.find({ title_key: "movies-12345" })
```

---

## provider_categories

Provider category definitions (e.g., genres, categories).

### Schema

```javascript
{
  _id: ObjectId,                     // MongoDB auto-generated ID
  provider_id: String,               // Provider identifier (e.g., "agtv", "digitalizard")
  category_key: String,              // Unique key: "{type}-{category_id}"
  category_id: Number,               // Provider's category ID
  category_name: String,             // Category name
  type: String,                      // Media type: "movies" | "tvshows"
  enabled: Boolean,                  // Whether category is enabled
  createdAt: ISODate,                // Document creation timestamp
  lastUpdated: ISODate               // Last update timestamp
}
```

### Indexes

| Index | Type | Purpose |
|-------|------|---------|
| `{ provider_id: 1, type: 1 }` | Compound | Find all categories of a type for a provider. |
| `{ provider_id: 1, category_key: 1 }` | Unique | Ensure unique category per provider (enforced uniqueness). |
| `{ provider_id: 1, enabled: 1 }` | Compound | Find enabled/disabled categories per provider. |

### Relations

- **Related to `provider_titles`**: 
  - `provider_id` + `category_id` → `provider_titles.provider_id` + `provider_titles.category_id` (one-to-many)
  - Categories group provider titles

- **Related to `iptv_providers`**: 
  - `provider_id` → `iptv_providers.id` (many-to-one)

### Query Examples

```javascript
// Get all categories for a provider
db.provider_categories.find({ provider_id: "agtv" })

// Get enabled movie categories
db.provider_categories.find({ provider_id: "agtv", type: "movies", enabled: true })

// Find specific category
db.provider_categories.findOne({ 
  provider_id: "agtv", 
  category_key: "movies-801" 
})
```

---

## users

User accounts with authentication and watchlist information.

### Schema

```javascript
{
  _id: ObjectId,                     // MongoDB auto-generated ID
  username: String,                  // Unique username (used for login)
  password: String,                  // Hashed password
  role: String,                      // User role: "admin" | "user"
  watchlist: Array,                  // Array of title_key strings (references titles.title_key)
  createdAt: ISODate,                // Account creation timestamp
  lastUpdated: ISODate               // Last update timestamp
}
```

### Indexes

| Index | Type | Purpose |
|-------|------|---------|
| `{ username: 1 }` | Unique | Fast username lookup for authentication. Enforces unique usernames. |
| `{ role: 1 }` | Standard | Filter users by role (admin/user). |

### Relations

- **Related to `titles`**: 
  - `watchlist` array contains `title_key` values → `titles.title_key` (many-to-many via array)
  - Users can have multiple titles in watchlist
  - Titles can be in multiple users' watchlists

### Query Examples

```javascript
// Find user by username
db.users.findOne({ username: "admin" })

// Get all admin users
db.users.find({ role: "admin" })

// Find users with specific title in watchlist
db.users.find({ watchlist: "movies-12345" })
```

---

## iptv_providers

IPTV provider configurations and settings.

### Schema

```javascript
{
  _id: ObjectId,                     // MongoDB auto-generated ID
  id: String,                        // Unique provider identifier (e.g., "agtv", "digitalizard")
  name: String,                      // Provider display name
  type: String,                      // Provider type: "agtv" | "xtream"
  enabled: Boolean,                  // Whether provider is enabled
  priority: Number,                  // Provider priority (lower = higher priority)
  // ... all other provider configuration fields preserved as-is
  // (e.g., url, username, password, etc. - varies by provider type)
  createdAt: ISODate,                // Document creation timestamp
  lastUpdated: ISODate               // Last update timestamp
}
```

### Indexes

| Index | Type | Purpose |
|-------|------|---------|
| `{ id: 1 }` | Unique | Fast provider lookup by ID. Enforces unique provider IDs. |
| `{ enabled: 1 }` | Standard | Filter enabled/disabled providers. |
| `{ priority: 1 }` | Standard | Sort providers by priority. |

### Relations

- **Related to `provider_titles`**: 
  - `id` → `provider_titles.provider_id` (one-to-many)
  - Provider has many titles

- **Related to `provider_categories`**: 
  - `id` → `provider_categories.provider_id` (one-to-many)
  - Provider has many categories

- **Related to `titles`**: 
  - `id` → `titles.media[].sources[].provider_id` (one-to-many via embedded media array)
  - Provider streams are embedded in titles.media array

### Query Examples

```javascript
// Find provider by ID
db.iptv_providers.findOne({ id: "agtv" })

// Get all enabled providers
db.iptv_providers.find({ enabled: true }).sort({ priority: 1 })

// Get providers by type
db.iptv_providers.find({ type: "agtv" })
```

---

## settings

Global application settings stored as key-value pairs (one document per setting).

### Schema

```javascript
{
  _id: String,                       // Setting key (e.g., "tmdb_token", "tmdb_api_rate")
  value: Any,                        // Setting value (can be String, Object, Number, etc.)
  createdAt: ISODate,                // Document creation timestamp
  lastUpdated: ISODate               // Last update timestamp
}
```

### Indexes

| Index | Type | Purpose |
|-------|------|---------|
| `{ _id: 1 }` | Unique | The `_id` field is automatically indexed in MongoDB. Since `_id` is the setting key, lookups by key are O(1). |

### Relations

- **No direct relations** - Settings are application-level configuration, not related to other collections.

### Query Examples

```javascript
// Get a specific setting
db.settings.findOne({ _id: "tmdb_token" })

// Get all settings
db.settings.find({})

// Update a setting
db.settings.updateOne(
  { _id: "tmdb_token" },
  { $set: { value: "new_token", lastUpdated: new Date() } }
)
```

### Common Settings

- `tmdb_token`: TMDB API authentication token (String)
- `tmdb_api_rate`: API rate limit configuration (Object: `{ concurrent: Number, duration_seconds: Number }`)

---

## stats

API statistics and metrics (single document collection).

### Schema

```javascript
{
  _id: ObjectId,                     // MongoDB auto-generated ID
  total_requests: Number,            // Total API requests processed
  total_titles: Number,              // Total number of titles
  // ... all other stat fields preserved as-is
  // (additional fields may vary based on application needs)
  lastUpdated: ISODate               // Last update timestamp (no createdAt for stats)
}
```

### Indexes

| Index | Type | Purpose |
|-------|------|---------|
| None | N/A | Single document collection - no indexes needed. Always retrieved by `_id` or as the only document. |

### Relations

- **No direct relations** - Stats are aggregate metrics, not related to other collections.

### Query Examples

```javascript
// Get stats (single document)
db.stats.findOne({})

// Update stats
db.stats.updateOne(
  {},
  { $set: { total_requests: 1000, lastUpdated: new Date() } }
)
```

---

## job_history

Job execution tracking and status management for engine jobs.

### Schema

```javascript
{
  _id: ObjectId,                     // MongoDB auto-generated ID
  job_name: String,                  // Job name: "ProcessProvidersTitlesJob" | "ProcessMainTitlesJob" | "MonitorConfigurationJob"
  provider_id: String,               // Optional, for provider-specific jobs
  status: String,                    // Job status: "running" | "cancelled" | "completed" | "failed"
  last_execution: ISODate,           // Last execution timestamp
  execution_count: Number,            // Total successful executions
  last_result: Object,               // Last execution result (varies by job type)
  last_error: String,                // Last error message (if failed)
  createdAt: ISODate,                // Document creation timestamp
  lastUpdated: ISODate               // Last update timestamp
}
```

### Status Lifecycle

1. **running**: Job is currently executing
2. **cancelled**: Job was cancelled due to configuration changes (automatically retriggered)
3. **completed**: Job finished successfully
4. **failed**: Job encountered an error during execution

When a job is cancelled, it is automatically retriggered after a short delay (5 seconds) to allow configuration changes to settle.

### Indexes

| Index | Type | Purpose |
|-------|------|---------|
| `{ job_name: 1 }` | Single | Efficient lookup by job name |
| `{ job_name: 1, provider_id: 1 }` | Compound | For provider-specific jobs (if needed) |
| `{ status: 1 }` | Single | Query running jobs for cancellation |

### Relations

- **No direct relations** - Job history tracks execution state, not data relationships.

### Query Examples

```javascript
// Get job history
db.job_history.findOne({ job_name: "ProcessProvidersTitlesJob" })

// Get status of a job
db.job_history.findOne(
  { job_name: "ProcessProvidersTitlesJob" },
  { projection: { status: 1 } }
)

// Find all running jobs
db.job_history.find({ status: "running" })

// Update job status
db.job_history.updateOne(
  { job_name: "ProcessProvidersTitlesJob" },
  { $set: { status: "cancelled", lastUpdated: new Date() } }
)
```

---

## Collection Relationships Summary

### Primary Relationships

```
titles (1) ──< (many) provider_titles
titles (1) ──< (many) users.watchlist (via array)

iptv_providers (1) ──< (many) provider_titles
iptv_providers (1) ──< (many) provider_categories

provider_categories (1) ──< (many) provider_titles
```

### Key Design Decisions

1. **Embedded Media Array**: The `titles.media` field contains all stream information directly embedded in the title document. Each media item includes:
   - For movies: One media item with `name: "main"` and its sources
   - For TV shows: One media item per available episode with season/episode numbers and episode metadata (air_date, name, overview, still_path)
   - Each media item contains an array of `sources` with provider information (provider_id, provider_title_id, provider_url)
   - This design eliminates the need for a separate `title_streams` collection and simplifies queries

2. **One Document Per Key**: `settings` uses one document per key-value pair for efficient individual key lookups.

3. **Title Key as Foreign Key**: `title_key` is used consistently across collections (`titles`, `provider_titles`, `users.watchlist`) as the primary relationship key.

4. **Ignored Titles Merged**: Ignored titles are stored as flags (`ignored`, `ignored_reason`) in `provider_titles` rather than a separate collection for efficient filtering.

---

## Index Strategy

### Unique Indexes
- `titles.title_key`: Ensures no duplicate titles
- `users.username`: Ensures unique usernames
- `iptv_providers.id`: Ensures unique provider IDs
- `provider_categories.provider_id + category_key`: Ensures unique categories per provider
- `settings._id`: Automatically unique (MongoDB default)

### Compound Indexes
Used for common query patterns:
- Filtering by provider and type
- Finding titles with streams from specific providers
- Filtering ignored titles per provider
- Type + provider combination queries

### Text Index
- `titles.title`: Enables full-text search on title names

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
- The `category_key` format is: `"{type}-{categoryId}"` (e.g., `"movies-801"`, `"tvshows-802"`)

