# MongoDB Migration Scripts

Migration scripts to migrate Playarr data from JSON files to MongoDB.

## Prerequisites

- Node.js >= 18.0.0
- MongoDB server running and accessible
- Access to `data/` directory with all JSON files

## Setup

1. Install dependencies:
```bash
npm install
```

2. Copy `.env.example` to `.env` and configure:
```bash
cp .env.example .env
```

3. Edit `.env` with your MongoDB connection details:
```env
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB_NAME=playarr
DATA_DIR=./data
```

## Usage

### Run Full Migration (Recommended)

```bash
npm run migrate
```

This runs all steps in the correct order:
1. **Migrate all collections** (9 migration steps)
2. **Create all indexes**
3. **Run validation**

### Run Individual Steps

If you need to run steps separately, use this order:

#### Step 1: Run Migrations
```bash
npm run migrate
```
(Stop after migrations complete, before indexes are created)

#### Step 2: Create Indexes
```bash
npm run create-indexes
```
**Note:** Indexes should be created AFTER all data is migrated for better performance.

#### Step 3: Validate Migration
```bash
npm run validate
```
**Note:** Validation should be run AFTER migrations and indexes are complete.

### Script Execution Order

When running `npm run migrate`, the execution order is:

1. **Data Migrations** (in this order):
   - `provider_categories`
   - `provider_titles` (with ignored titles merged)
   - `titles` (main titles)
   - `title_streams`
   - `iptv_providers`
   - `users`
   - `settings`
   - `cache_policy`
   - `stats`

2. **Index Creation** (after all data is migrated)

3. **Validation** (after indexes are created)

## Environment Variables

- `MONGODB_URI` - MongoDB connection string
- `MONGODB_DB_NAME` - Database name (default: `playarr`)
- `DATA_DIR` - Path to data directory (default: `./data`)
- `BATCH_SIZE` - Batch size for inserts (default: `1000`)
- `LOG_LEVEL` - Logging level: `info`, `warn`, `error`, `debug` (default: `info`)
- `DRY_RUN` - Set to `true` to test without writing to database (default: `false`)

## Notes

- The migration preserves all existing data in JSON files as backup
- Large collections are processed in batches for efficiency
- Progress is reported for each migration step
- Errors are logged but migration continues for other collections
- Validation runs automatically after migration completes

## Troubleshooting

### Connection Errors
- Verify MongoDB is running and accessible
- Check `MONGODB_URI` in `.env` file
- Ensure network connectivity to MongoDB server

### Missing Files
- Verify `DATA_DIR` points to correct directory
- Check that all required JSON files exist
- Missing files are handled gracefully (empty collections created)

### Duplicate Key Errors
- Use upsert operations for collections with unique constraints
- Check existing data in MongoDB before migration
- Consider dropping collections if re-running migration

