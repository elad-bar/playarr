# MongoDB Migration Plan

## Overview
Migrate Playarr data storage from JSON files to MongoDB to support:
- 150k+ main titles
- 300k+ title streams
- 150k+ provider titles
- Efficient querying and pagination
- Better memory usage

## Current State
- **Main Titles**: `data/titles/main.json` - Array of ~20k objects (growing to 150k)
- **Title Streams**: `data/titles/main-titles-streams.json` - Object with ~20k keys (growing to 300k)
- **Provider Titles**: `data/titles/{providerId}.titles.json` - Arrays per provider
- **Provider Categories**: `data/categories/{providerId}.categories.json` - Arrays per provider
- **Provider Ignored Titles**: `data/titles/{providerId}.ignored.json` - Objects mapping title_key to issue
- **Users**: `data/settings/users.json` - Array of user objects
- **IPTV Providers**: `data/settings/iptv-providers.json` - Array of provider configurations
- **Settings**: `data/settings/settings.json` - Global settings (TMDB token, API rate limits)
- **Cache Policy**: `data/settings/cache-policy.json` - Object mapping cache paths to TTL values
- **Stats**: `data/stats.json` - API statistics

## Target MongoDB Schema

### Collection: `titles`
Main titles collection (consolidated from main.json)

**Schema:**
```javascript
{
  _id: ObjectId,
  title_key: String,        // Unique: "movies-12345" or "tvshows-67890"
  title_id: Number,         // TMDB ID
  type: String,             // "movies" | "tvshows"
  title: String,
  release_date: String,     // "YYYY-MM-DD"
  vote_average: Number,
  vote_count: Number,
  overview: String,
  poster_path: String,      // "/abc123.jpg"
  backdrop_path: String,
  genres: Array,
  runtime: Number,          // Movies only
  similar_titles: Array,    // Array of title_key strings
  streams: Object,          // Embedded summary: 
                             //   Movies: { "main": ["provider1", "provider2"] }
                             //   TV shows: { "S01-E01": { air_date, name, overview, still_path, sources: ["provider1"] } }
  createdAt: ISODate,
  lastUpdated: ISODate
}
```

**Indexes:**
- `{ title_key: 1 }` - Unique
- `{ type: 1 }`
- `{ title: "text" }` - Text search
- `{ release_date: 1 }`
- `{ type: 1, release_date: 1 }` - Compound for filtering

**Migration Source:** 
- `data/titles/main.json` - Main title data
- `data/titles/main-titles-streams.json` - Streams data (used to build embedded summary)

**Transformation:**
- Streams summary is built from `main-titles-streams.json` by grouping streams by `title_key` and `stream_id`
- For movies: Format is `{ stream_id: [provider_ids] }` - e.g., `{ "main": ["provider1", "provider2"] }`
- For TV shows: Format preserves episode metadata from `main.json`: `{ "S01-E01": { air_date, name, overview, still_path, sources: ["provider1"] } }`
- Episode metadata (air_date, name, overview, still_path) is preserved from `main.json` and provider lists are merged from `main-titles-streams.json`
- Full stream details (with URLs) are stored in the separate `title_streams` collection
- The embedded summary enables efficient queries without joining the `title_streams` collection

---

### Collection: `title_streams`
Title streams collection (from main-titles-streams.json)

**Schema:**
```javascript
{
  _id: ObjectId,
  title_key: String,         // "movies-12345" or "tvshows-67890"
  stream_id: String,        // "main" for movies, "S01-E01" for TV shows
  provider_id: String,      // Provider identifier
  proxy_url: String,        // Stream URL
  createdAt: ISODate,
  lastUpdated: ISODate
}
```

**Indexes:**
- `{ title_key: 1, stream_id: 1 }` - Compound
- `{ provider_id: 1 }`
- `{ title_key: 1, provider_id: 1 }` - Compound

**Migration Source:** `data/titles/main-titles-streams.json`
**Transformation:** 
- Key format: `{type}-{tmdbId}-{streamId}-{providerId}`
- Split into: `title_key`, `stream_id`, `provider_id`

---

### Collection: `provider_titles`
Provider-specific titles (from {providerId}.titles.json files)

**Schema:**
```javascript
{
  _id: ObjectId,
  provider_id: String,
  title_key: String,         // Generated: "{type}-{tmdb_id}"
  type: String,              // "movies" | "tvshows"
  title_id: String,          // Provider's original title ID
  tmdb_id: Number,           // TMDB ID if matched
  title: String,
  category_id: Number,
  release_date: String,
  streams: Object,           // { "main": "/url" } or { "S01-E01": "/url" }
  ignored: Boolean,          // Flag indicating if title is ignored (from {providerId}.ignored.json)
  ignored_reason: String,    // Reason for ignoring (if ignored is true)
  createdAt: ISODate,
  lastUpdated: ISODate
}
```

**Indexes:**
- `{ provider_id: 1, type: 1 }`
- `{ provider_id: 1, tmdb_id: 1 }`
- `{ title_key: 1 }`
- `{ provider_id: 1, ignored: 1 }` - For filtering ignored titles

**Migration Source:** 
- `data/titles/{providerId}.titles.json` (all provider files)
- `data/titles/{providerId}.ignored.json` (all provider files) - Merged into provider_titles as flags

**Transformation:**
- Load provider titles from `{providerId}.titles.json`
- Load ignored titles from `{providerId}.ignored.json` (object: `{ title_key: issue }`)
- For each provider title, check if `title_key` exists in ignored titles
- Set `ignored: true` and `ignored_reason: issue` if found, otherwise `ignored: false` and `ignored_reason: null`

---

### Collection: `provider_categories`
Provider categories (from {providerId}.categories.json files)

**Schema:**
```javascript
{
  _id: ObjectId,
  provider_id: String,
  category_key: String,     // "{type}-{category_id}"
  category_id: Number,
  category_name: String,
  type: String,              // "movies" | "tvshows"
  enabled: Boolean,
  createdAt: ISODate,
  lastUpdated: ISODate
}
```

**Indexes:**
- `{ provider_id: 1, type: 1 }`
- `{ provider_id: 1, category_key: 1 }` - Unique
- `{ provider_id: 1, enabled: 1 }`

**Migration Source:** `data/categories/{providerId}.categories.json` (all provider files)

---

### Collection: `users`
User accounts (from users.json)

**Schema:**
```javascript
{
  _id: ObjectId,
  username: String,          // Unique username
  password: String,          // Hashed password
  role: String,             // "admin" | "user"
  watchlist: Array,         // Array of title_key strings
  createdAt: ISODate,
  lastUpdated: ISODate
}
```

**Indexes:**
- `{ username: 1 }` - Unique
- `{ role: 1 }`

**Migration Source:** `data/settings/users.json`

---

### Collection: `iptv_providers`
IPTV provider configurations (from iptv-providers.json)

**Schema:**
```javascript
{
  _id: ObjectId,
  id: String,               // Unique provider identifier
  name: String,
  type: String,             // "agtv" | "xtream"
  enabled: Boolean,
  priority: Number,
  // ... all other provider configuration fields preserved as-is
  createdAt: ISODate,
  lastUpdated: ISODate
}
```

**Indexes:**
- `{ id: 1 }` - Unique
- `{ enabled: 1 }`
- `{ priority: 1 }`

**Migration Source:** `data/settings/iptv-providers.json`

---

### Collection: `settings`
Global settings (from settings.json)

**Schema:**
```javascript
{
  _id: String,              // Setting key (e.g., "tmdb_token", "tmdb_api_rate")
  value: Any,               // Setting value (can be String, Object, Number, etc.)
  createdAt: ISODate,
  lastUpdated: ISODate
}
```

**Indexes:**
- `{ _id: 1 }` - Unique (key is the _id)

**Migration Source:** `data/settings/settings.json`
**Transformation:**
- Each key-value pair becomes a separate document
- Document `_id` = setting key
- Document `value` = setting value
- Example: `{ "tmdb_token": "..." }` becomes `{ _id: "tmdb_token", value: "...", createdAt, lastUpdated }`

---

### Collection: `cache_policy`
Cache expiration policies (from cache-policy.json)

**Schema:**
```javascript
{
  _id: String,              // Cache path key (e.g., "tmdb/search/movie", "agtv/tvshows/metadata")
  value: Number | null,     // TTL value in hours (or null for no cache)
  createdAt: ISODate,
  lastUpdated: ISODate
}
```

**Indexes:**
- `{ _id: 1 }` - Unique (key is the _id)

**Migration Source:** `data/settings/cache-policy.json`
**Transformation:**
- Each key-value pair becomes a separate document
- Document `_id` = cache path key
- Document `value` = TTL value (Number or null)
- Example: `{ "tmdb/search/movie": null }` becomes `{ _id: "tmdb/search/movie", value: null, createdAt, lastUpdated }`

---

### Collection: `stats`
API statistics (from stats.json)

**Schema:**
```javascript
{
  _id: ObjectId,
  total_requests: Number,
  total_titles: Number,
  // ... all other stat fields preserved as-is
  lastUpdated: ISODate
}
```

**Indexes:**
- No additional indexes needed (single document collection)

**Migration Source:** `data/stats.json`
**Note:** Stored as single document since stats are always accessed together

---

## Migration Phases

### Phase 1: Preparation
- [ ] Set up MongoDB connection
- [ ] Create migration directory structure
- [ ] Write data reading utilities
- [ ] Write data transformation utilities
- [ ] Create MongoDB indexes script
- [ ] Test with small sample dataset

### Phase 2: Data Migration
- [ ] Migrate provider_categories (smallest, test first)
- [ ] Migrate provider_titles (with ignored titles merged as flags)
- [ ] Migrate titles (main titles)
- [ ] Migrate title_streams (largest, most complex)
- [ ] Migrate users
- [ ] Migrate iptv_providers
- [ ] Migrate settings
- [ ] Migrate cache_policy
- [ ] Migrate stats

### Phase 3: Verification
- [ ] Count documents in each collection
- [ ] Verify data integrity (sample checks)
- [ ] Compare counts with source files
- [ ] Verify ignored titles are correctly merged into provider_titles
- [ ] Test queries match expected results
- [ ] Performance testing

---

## Migration Script Requirements

### Data Reading
- Read JSON files from `data/` directory
- Handle large files efficiently (streaming if needed)
- Support both array and object formats
- Handle missing files gracefully

### Data Transformation

#### For titles collection:
- Build embedded `streams` summary from `main-titles-streams.json` by grouping by `title_key` and `stream_id`
- Format: `{ stream_id: [provider_ids] }` - e.g., `{ "main": ["provider1", "provider2"] }` for movies
- Preserve all other fields
- Ensure `title_key` is present (generate if missing: `{type}-{title_id}`)
- Full stream details (with URLs) are stored in separate `title_streams` collection

#### For title_streams collection:
- Parse key format: `{type}-{tmdbId}-{streamId}-{providerId}`
- Split into: `title_key = {type}-{tmdbId}`, `stream_id`, `provider_id`
- Extract `proxy_url` from value object

#### For provider_titles collection:
- Ensure all required fields present
- Preserve `streams` object as-is
- Load corresponding `{providerId}.ignored.json` file
- For each provider title, check if `title_key` exists in ignored titles object
- Set `ignored: true` and `ignored_reason: issue` if found in ignored titles
- Set `ignored: false` and `ignored_reason: null` if not found
- Generate `title_key` if missing: `{type}-{tmdb_id}`

#### For provider_categories collection:
- Ensure `category_key` is generated: `{type}-{category_id}`

#### For users collection:
- Preserve all fields as-is
- Ensure `username` is unique
- Preserve `watchlist` array

#### For iptv_providers collection:
- Preserve all provider configuration fields as-is
- Ensure `id` field is unique

#### For settings collection:
- Transform each key-value pair into a document
- Document `_id` = setting key
- Document `value` = setting value
- Preserve timestamps for each document

#### For cache_policy collection:
- Transform each key-value pair into a document
- Document `_id` = cache path key
- Document `value` = TTL value (Number or null)
- Preserve timestamps for each document

#### For stats collection:
- Keep as single document
- Preserve all stat fields as-is

### Data Writing
- Batch inserts (1000-5000 documents per batch)
- Handle duplicates (upsert where appropriate)
- Preserve timestamps (createdAt, lastUpdated)
- Error handling and logging
- Progress reporting

### Validation
- Verify document counts match source
- Sample data integrity checks
- Index verification
- Query performance testing

---

## Migration Order (Critical)

1. **provider_categories** - Smallest, no dependencies
2. **provider_titles** - Requires ignored titles to be loaded for merging
3. **titles** - No dependencies
4. **title_streams** - Can be migrated independently
5. **iptv_providers** - No dependencies
6. **users** - No dependencies
7. **settings** - No dependencies
8. **cache_policy** - No dependencies
9. **stats** - No dependencies

---

## Notes

- Keep JSON files as backup during transition period
- Ignored titles are merged into `provider_titles` collection as `ignored` boolean flag and `ignored_reason` field
- Settings and cache_policy are stored as one document per key-value pair for efficient individual key lookups
- Stats is stored as a single document since stats are always accessed together
- Monitor MongoDB performance and adjust indexes as needed
- Document any schema changes or optimizations

---

## Dependencies

- `mongodb` npm package
- MongoDB server (already available)
- Access to `data/` directory
- Node.js environment

---

## Environment Variables

```env
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB_NAME=playarr
DATA_DIR=./data
BATCH_SIZE=1000
LOG_LEVEL=info
```

---

## Success Criteria

1. All data successfully migrated
2. Document counts match source files
3. Data integrity verified (sample checks pass)
4. All indexes created successfully
5. No data loss
6. Ignored titles correctly merged into provider_titles as flags
7. Migration scripts are reusable and well-documented

