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

**Migration Source:** `data/titles/main.json`

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
  createdAt: ISODate,
  lastUpdated: ISODate
}
```

**Indexes:**
- `{ provider_id: 1, type: 1 }`
- `{ provider_id: 1, tmdb_id: 1 }`
- `{ title_key: 1 }`

**Migration Source:** `data/titles/{providerId}.titles.json` (all provider files)

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
- [ ] Migrate provider_titles
- [ ] Migrate titles (main titles)
- [ ] Migrate title_streams (largest, most complex)

### Phase 3: Verification
- [ ] Count documents in each collection
- [ ] Verify data integrity (sample checks)
- [ ] Compare counts with source files
- [ ] Test queries match expected results
- [ ] Performance testing

### Phase 4: Code Integration
- [ ] Create MongoDBService wrapper
- [ ] Update DatabaseService to support MongoDB
- [ ] Update TitlesManager to use MongoDB queries
- [ ] Update StreamManager to use MongoDB queries
- [ ] Update ProvidersManager for provider_titles
- [ ] Update CategoriesManager for provider_categories
- [ ] Update engine providers to write to MongoDB

### Phase 5: Testing
- [ ] Unit tests for MongoDB queries
- [ ] Integration tests with real data
- [ ] API endpoint testing
- [ ] Performance benchmarking
- [ ] Memory usage comparison

### Phase 6: Deployment
- [ ] Backup all JSON files
- [ ] Run migration in production
- [ ] Verify application works with MongoDB
- [ ] Monitor performance
- [ ] Keep JSON files as backup for rollback period

### Phase 7: Cleanup (After Verification Period)
- [ ] Remove JSON file dependencies
- [ ] Update documentation
- [ ] Archive old JSON files

---

## Migration Script Requirements

### Data Reading
- Read JSON files from `data/` directory
- Handle large files efficiently (streaming if needed)
- Support both array and object formats
- Handle missing files gracefully

### Data Transformation
- Transform main titles: remove `streams` field (moved to separate collection)
- Transform streams: split key `{type}-{tmdbId}-{streamId}-{providerId}` into fields
- Transform provider titles: ensure all required fields present
- Transform categories: ensure category_key is generated

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

## Code Changes Required

### 1. Database Service Layer
**File:** `web-api/src/services/database.js`

**Changes:**
- Add MongoDB connection support
- Implement MongoDB query methods
- Keep file-based fallback (dual mode during transition)
- Or create separate `MongoDBService` and switch via config

### 2. Titles Manager
**File:** `web-api/src/managers/titles.js`

**Changes:**
- Update `getTitles()` to use MongoDB queries with filters
- Update `getTitlesData()` to query MongoDB instead of loading all
- Update `getTitleDetails()` to query by title_key
- Remove in-memory filtering logic

### 3. Stream Manager
**File:** `web-api/src/managers/stream.js`

**Changes:**
- Update `_getSources()` to query `title_streams` collection
- Query by `title_key` and `stream_id` instead of loading all streams

### 4. Providers Manager
**File:** `web-api/src/managers/providers.js`

**Changes:**
- Update provider titles loading to query MongoDB
- Query `provider_titles` collection by `provider_id`

### 5. Categories Manager
**File:** `web-api/src/managers/categories.js`

**Changes:**
- Update to query `provider_categories` collection
- Filter by `provider_id` and `type`

### 6. Engine Providers
**Files:** 
- `engine/providers/BaseIPTVProvider.js`
- `engine/providers/TMDBProvider.js`

**Changes:**
- Update `saveTitles()` to write to MongoDB
- Update `saveCategories()` to write to MongoDB
- Update stream saving logic

---

## Rollback Plan

If issues occur:

1. **Immediate Rollback:**
   - Switch application back to file-based storage
   - MongoDB data remains for analysis
   - JSON files are backup

2. **Data Recovery:**
   - Export MongoDB collections to JSON
   - Restore from backups if needed

3. **Gradual Rollback:**
   - Run both systems in parallel
   - Compare results
   - Switch back if discrepancies found

---

## Performance Targets

### Query Performance
- Title list with filters: < 200ms (currently 2-5s)
- Title details: < 50ms (currently 100-500ms)
- Stream lookup: < 50ms (currently 1-3s)
- Search queries: < 300ms (currently 3-10s)

### Memory Usage
- Application startup: < 500MB (currently 1-2GB with all titles loaded)
- Per-request: < 50MB (currently 100-500MB)

---

## Testing Checklist

- [ ] Migration script handles all data types
- [ ] All indexes created successfully
- [ ] Document counts match source files
- [ ] Sample data integrity verified
- [ ] Queries return expected results
- [ ] Pagination works correctly
- [ ] Search functionality works
- [ ] Filtering works (type, year, etc.)
- [ ] Stream lookups work
- [ ] Provider titles loading works
- [ ] Categories loading works
- [ ] Write operations work (saving new titles)
- [ ] Update operations work
- [ ] Delete operations work
- [ ] Performance meets targets
- [ ] Memory usage acceptable

---

## Timeline Estimate

- **Phase 1 (Preparation):** 2-3 days
- **Phase 2 (Migration):** 1-2 days
- **Phase 3 (Verification):** 1 day
- **Phase 4 (Code Integration):** 3-5 days
- **Phase 5 (Testing):** 2-3 days
- **Phase 6 (Deployment):** 1 day
- **Phase 7 (Cleanup):** 1 day

**Total:** ~2-3 weeks (depending on complexity and testing)

---

## Notes

- Keep JSON files as backup during transition period
- Consider running both systems in parallel initially
- Monitor MongoDB performance and adjust indexes as needed
- Document any schema changes or optimizations
- Consider MongoDB connection pooling for production
- Set up MongoDB monitoring/alerting

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
2. Application works with MongoDB
3. Query performance improved
4. Memory usage reduced
5. No data loss
6. All tests passing
7. Production deployment successful

