# Collection Schema Versioning System [Done]

## Overview

This feature implements an automatic collection schema versioning system that detects schema mismatches, backs up collections with version-based naming, and handles data vs configuration collections differently. The system prevents duplicate backups and tracks collection versions in a metadata collection, ensuring safe schema migrations during application startup.

## Goals

1. **Automatic Schema Detection**: Automatically detect schema version mismatches during index initialization
2. **Safe Backups**: Backup collections with version-based naming before schema changes
3. **Prevent Duplicate Backups**: Avoid creating multiple backups of the same version on repeated restarts
4. **Differentiate Collection Types**: Handle data collections (can be regenerated) vs configuration collections (critical, cannot be regenerated) differently
5. **Version Tracking**: Track collection versions in a metadata collection for debugging and migration history
6. **Replace Manual Migration Jobs**: Eliminate the need for separate migration jobs by handling migrations automatically

## Collection Types

### Data Collections

Collections that can be regenerated from external sources:

- `titles` - Can be re-synced from providers
- `provider_titles` - Can be re-synced from providers
- `channels` - Can be re-synced from providers
- `programs` - Can be re-synced from providers
- `job_history` - Historical data, can start fresh
- `stats` - Can be recalculated

**Behavior on Schema Mismatch:**
- Backup collection with version in name
- Recreate collection with new schema
- Continue application startup normally
- Log warning (not error)

### Configuration Collections

Collections that contain critical user/system configuration:

- `iptv_providers` - User-configured provider settings
- `settings` - Application configuration
- `users` - User accounts and credentials

**Behavior on Schema Mismatch:**
- Backup collection with version in name
- Log error with clear message
- Stop index initialization for that collection
- Application continues (other collections work)
- User must manually restore from backup

## Architecture

### Metadata Collection

A special `_collection_metadata` collection tracks the actual schema version of each collection in the database:

```javascript
{
  _id: "channels",  // Collection name
  version: "v2",    // Actual version in database
  collectionType: "data",
  lastInitialized: ISODate,
  createdAt: ISODate
}
```

### Version Detection

1. **Expected Version**: Defined in repository constructor via `schemaVersion` parameter
2. **Stored Version**: Retrieved from `_collection_metadata` collection
3. **Default Version**: If no metadata exists, assume `v1` (oldest/legacy version)
4. **Comparison**: Compare stored vs expected to detect mismatches

### Parallel Migration

- Different collections can migrate in parallel during application startup
- Each collection's migration is independent
- If one collection's migration fails, other collections continue migrating
- This allows faster startup when multiple collections need migration

### Backup Naming Convention

Backups are named with the version being backed up:

```
{collectionName}_v{version}_backup_{timestamp}
```

**Examples:**
- `channels_v1_backup_2025-12-03_11-57-18`
- `users_v2_backup_2025-12-03_14-30-00`

### Duplicate Backup Prevention

Before creating a backup, the system checks if a backup already exists for that version:

- Pattern: `{collectionName}_v{version}_backup_*`
- If backup exists → Skip backup creation, use existing backup name
- Prevents multiple backups on repeated restarts
- Ensures each version is only backed up once

## Implementation

### BaseRepository Changes

#### Constructor Update

```javascript
constructor(mongoClient, collectionName, keyBuilder, collectionType = 'data', schemaVersion = 'v1', defaultBatchSize = 1000) {
  // ... existing code ...
  this.collectionType = collectionType; // 'data' or 'configuration'
  this.schemaVersion = schemaVersion;   // Schema version (e.g., 'v1', 'v2')
}
```

**Metadata Management:**

```javascript
/**
 * Get stored version from metadata collection
 * @private
 * @returns {Promise<string|null>} Stored version or null (means v1)
 */
async _getStoredVersion() {
  const metadata = await this.db.collection('_collection_metadata')
    .findOne({ _id: this.collectionName });
  return metadata?.version || null; // null = v1 (default)
}

/**
 * Update metadata collection with current version
 * @private
 * @param {Object} metadata - Metadata to update
 */
async _updateMetadata(metadata) {
  await this.db.collection('_collection_metadata').updateOne(
    { _id: this.collectionName },
    { 
      $set: { 
        ...metadata,
        lastInitialized: new Date()
      },
      $setOnInsert: {
        createdAt: new Date()
      }
    },
    { upsert: true }
  );
}
```

**Backup Methods:**

```javascript
/**
 * Check if backup already exists for a version
 * @private
 * @param {string} version - Version to check
 * @returns {Promise<boolean>} True if backup exists
 */
async _checkBackupExists(version) {
  const backupPattern = `${this.collectionName}_v${version}_backup_`;
  const collections = await this.db.listCollections({ 
    name: { $regex: `^${backupPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` } 
  }).toArray();
  return collections.length > 0;
}

/**
 * Backup collection with version in name
 * @private
 * @param {string} version - Version being backed up
 * @returns {Promise<string>} Backup collection name
 */
async _backupCollection(version) {
  // Check if backup already exists
  const existingBackups = await this.db.listCollections({ 
    name: { $regex: `^${this.collectionName}_v${version}_backup_` } 
  }).toArray();
  
  if (existingBackups.length > 0) {
    logger.info(`Backup already exists for ${this.collectionName} v${version}, skipping backup creation`);
    return existingBackups[0].name;
  }
  
  // Create new backup
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('.')[0];
  const backupName = `${this.collectionName}_v${version}_backup_${timestamp}`;
  
  const collection = this.db.collection(this.collectionName);
  const docCount = await collection.countDocuments();
  
  await collection.rename(backupName);
  
  // Log backup creation
  logger.warn('═══════════════════════════════════════════════════════════════');
  logger.warn(`⚠️  COLLECTION BACKUP CREATED: ${this.collectionName}`);
  logger.warn(`   Backup name: ${backupName}`);
  logger.warn(`   Version backed up: v${version}`);
  logger.warn(`   Documents backed up: ${docCount}`);
  logger.warn(`   Reason: Schema version mismatch (v${version} → v${this.schemaVersion})`);
  logger.warn('═══════════════════════════════════════════════════════════════');
  
  return backupName;
}
```

**Sequential Migration Method:**

```javascript
/**
 * Migrate collection sequentially from stored version to target version
 * Applies transformations step-by-step (v1 → v2 → v3, etc.)
 * @private
 * @param {string} fromVersion - Starting version
 * @param {string} toVersion - Target version
 * @returns {Promise<number|null>} Number of documents migrated, or null if no transformation available
 */
async _migrateCollectionSequentially(fromVersion, toVersion) {
  const versionDefs = this.getVersionDefinitions() || {};
  
  // Parse version numbers
  const fromId = versionDefs[fromVersion]?.id;
  const toId = versionDefs[toVersion]?.id;
  
  if (!fromId || !toId) {
    return null; // Version definitions not available
  }
  
  if (fromId >= toId) {
    return null; // Already at or past target version
  }
  
  // Get backup collection name
  const backupCollections = await this.db.listCollections({ 
    name: { $regex: `^${this.collectionName}_v${fromVersion}_backup_` } 
  }).toArray();
  
  if (backupCollections.length === 0) {
    throw new Error(`Backup collection not found for version ${fromVersion}`);
  }
  
  const backupName = backupCollections[0].name;
  const backupCollection = this.db.collection(backupName);
  const targetCollection = this.db.collection(this.collectionName);
  
  // Fetch all documents from backup
  const documents = await backupCollection.find({}).toArray();
  
  // Migrate step-by-step through each version
  let currentDocs = documents;
  let currentVersion = fromVersion;
  
  for (let targetId = fromId + 1; targetId <= toId; targetId++) {
    const targetVersion = Object.keys(versionDefs).find(v => versionDefs[v].id === targetId);
    if (!targetVersion) {
      throw new Error(`Version with id ${targetId} not found in definitions`);
    }
    
    const transformationKey = `${currentVersion}_to_${targetVersion}`;
    const transformFn = versionDefs[targetVersion]?.transformation;
    
    if (!transformFn) {
      throw new Error(`No transformation function available for ${transformationKey}`);
    }
    
    // Transform each document one-by-one
    const transformedDocs = [];
    for (const doc of currentDocs) {
      try {
        const transformed = await transformFn(doc);
        transformedDocs.push(transformed);
      } catch (error) {
        throw new Error(`Transformation failed for document ${doc._id} in ${transformationKey}: ${error.message}`);
      }
    }
    
    // Update metadata to intermediate version after each step
    await this._updateMetadata({
      version: targetVersion,
      collectionType: this.collectionType
    });
    
    currentDocs = transformedDocs;
    currentVersion = targetVersion;
  }
  
  // Insert all transformed documents into target collection
  if (currentDocs.length > 0) {
    await targetCollection.insertMany(currentDocs);
  }
  
  return currentDocs.length;
}
```

#### Updated initializeIndexes() Method

```javascript
async initializeIndexes() {
  try {
    const indexDefinitions = this.getIndexDefinitions();
    
    if (indexDefinitions.length === 0) {
      logger.debug(`No index definitions found for ${this.collectionName}`);
      return;
    }

    // Get expected and stored versions
    const expectedVersion = this.schemaVersion;
    const storedVersion = await this._getStoredVersion() || 'v1'; // null = v1 (default)
    const collectionType = this.collectionType;
    
    // Check for version mismatch
    if (storedVersion !== expectedVersion) {
      // Version mismatch detected - backup current version
      const versionToBackup = storedVersion;
      
      // Backup collection (even if empty - harmless and keeps logic simple)
      await this._backupCollection(versionToBackup);
      
      if (collectionType === 'configuration') {
        // Configuration collection - try transformation
        try {
          const transformedCount = await this._migrateCollectionSequentially(storedVersion, expectedVersion);
          if (transformedCount !== null) {
            // Transformation successful
            logger.info(`✅ Successfully migrated ${this.collectionName} from v${storedVersion} to v${expectedVersion} (${transformedCount} documents)`);
            // Continue with index creation
          } else {
            // No transformation available - fall back to error
            logger.error('═══════════════════════════════════════════════════════════════');
            logger.error(`❌ CONFIGURATION COLLECTION SCHEMA MISMATCH: ${this.collectionName}`);
            logger.error(`   Version mismatch: v${versionToBackup} → v${expectedVersion}`);
            logger.error(`   Backup created: ${this.collectionName}_v${versionToBackup}_backup_*`);
            logger.error(`   No transformation available for this version jump`);
            logger.error(`   ACTION REQUIRED: Collection not migrated. Please restore from backup manually.`);
            logger.error('═══════════════════════════════════════════════════════════════');
            return; // Stop initialization for this collection
          }
        } catch (error) {
          // Transformation failed
          logger.error('═══════════════════════════════════════════════════════════════');
          logger.error(`❌ CONFIGURATION COLLECTION MIGRATION FAILED: ${this.collectionName}`);
          logger.error(`   Version: v${versionToBackup} → v${expectedVersion}`);
          logger.error(`   Error: ${error.message}`);
          logger.error(`   Backup available: ${this.collectionName}_v${versionToBackup}_backup_*`);
          logger.error(`   Migration stopped. Collection remains at previous version.`);
          logger.error(`   ACTION REQUIRED: Check logs and restore from backup if needed.`);
          logger.error('═══════════════════════════════════════════════════════════════');
          return; // Stop initialization for this collection
        }
      } else {
        // Data collection - recreate with new schema
        logger.warn(`Data collection ${this.collectionName} will be recreated with schema v${expectedVersion}`);
        // Collection already renamed to backup, will be recreated when indexes are created
      }
    }

    const collection = this.db.collection(this.collectionName);
    
    // ... existing index creation logic ...
    
    // After successful initialization, update metadata
    await this._updateMetadata({
      version: expectedVersion,
      collectionType: collectionType
    });

    logger.debug(`${this.collectionName} indexes initialized`);
  } catch (error) {
    // Handle duplicate key errors
    if (error.code === 11000 || error.message?.includes('duplicate key')) {
      const storedVersion = await this._getStoredVersion() || 'v1';
      await this._backupCollection(storedVersion);
      // Retry index creation
      // ... retry logic ...
    } else {
      logger.error(`Error initializing indexes for ${this.collectionName}: ${error.message}`);
      throw error;
    }
  }
}
```

### Repository Updates

Each repository must specify its schema version and collection type:

#### ChannelRepository Example

```javascript
export class ChannelRepository extends BaseRepository {
  constructor(mongoClient) {
    super(
      mongoClient,
      'channels',
      (doc) => `${doc.provider_id}-${doc.channel_id}`,
      'data',  // Collection type
      'v2'     // Schema version (was v1 with username field)
    );
  }

  // ... rest of repository ...
}
```

#### UserRepository Example

```javascript
export class UserRepository extends BaseRepository {
  constructor(mongoClient) {
    super(
      mongoClient,
      'users',
      (doc) => doc.username,
      'configuration', // Collection type
      'v1'             // Schema version
    );
  }

  // ... rest of repository ...
}
```

### Version Definitions with Transformations

For configuration collections, repositories can define version structures and transformation functions:

```javascript
/**
 * Get version definitions with structure and transformation functions
 * Only needed for configuration collections that support data transformation
 * @returns {Object} Version definitions dictionary
 */
getVersionDefinitions() {
  return {
    "v1": {
      "id": 1,
      "structure": {
        // Documentation of v1 schema structure
        username: String,
        password: String,
        liveTV: {
          m3u_url: String,
          epg_url: String
        },
        watchlist: Array,
        watchlist_channels: Array
      },
      "transformation": null // No transformation from nothing to v1
    },
      "v2": {
        "id": 2,
        "structure": {
          // Documentation of v2 schema structure
          username: String,
          password: String,
          // liveTV removed in v2
          watchlist: {
            movies: Array,      // Array of title keys (format: "movies-{id}")
            tvshows: Array,     // Array of title keys (format: "tvshows-{id}")
            live: Array        // Array of channel keys (format: "live-{providerId}-{channelId}")
          }
          // watchlist_channels removed in v2 (moved to watchlist.live)
        },
        "transformation": async (doc) => {
          // Transform document from v1 to v2
          const { liveTV, watchlist_channels, ...rest } = doc;
          
          // Transform watchlist array to unified object structure
          const watchlist = {
            movies: [],
            tvshows: [],
            live: doc.watchlist_channels || []
          };
          
          // Parse existing watchlist array into movies and tvshows
          if (Array.isArray(doc.watchlist)) {
            doc.watchlist.forEach(key => {
              if (key.startsWith('movies-')) {
                watchlist.movies.push(key);
              } else if (key.startsWith('tvshows-')) {
                watchlist.tvshows.push(key);
              }
            });
          }
          
          return {
            ...rest,
            watchlist
          };
        }
      }
  };
}
```

**Key Points:**
- `structure`: Documentation only - describes the schema at that version
- `id`: Used for ordering versions (lower to higher)
- `transformation`: Async function that transforms a document from previous version, or `null` if no transformation needed
- Transformations are applied sequentially (v1 → v2 → v3, etc.)
- If transformation is `null` or missing, migration stops with error
- Different collections can migrate in parallel
- If any incremental transformation fails, migration stops at that step and logs error

## Migration Flow Examples

### Example 1: First Time Migration (v1 → v2)

**Scenario**: Channels collection has v1 schema (username field), code expects v2 (provider_id field)

1. Application starts
2. `initializeIndexes()` called for ChannelRepository
3. Expected version: `v2` (from `this.schemaVersion` constructor parameter)
4. Stored version: `null` (no metadata) → defaults to `v1`
5. Version comparison: `v1` ≠ `v2` → mismatch detected
6. Check for backup: `channels_v1_backup_*` → not found
7. Create backup: `channels_v1_backup_2025-12-03_11-57-18`
8. Collection type: `data` → recreate collection
9. Create indexes with new schema
10. Update metadata: `{ version: "v2", collectionType: "data" }`
11. Application continues normally

### Example 2: Restart After Migration (Still v1 in DB)

**Scenario**: Migration didn't complete, metadata still shows v1, code expects v2

1. Application starts
2. `initializeIndexes()` called
3. Expected version: `v2`
4. Stored version: `v1` (from metadata)
5. Version mismatch detected: `v1` ≠ `v2`
6. Check for backup: `channels_v1_backup_*` → found `channels_v1_backup_2025-12-03_11-57-18`
7. Skip backup creation (already exists)
8. Collection type: `data` → recreate collection
9. Create indexes with new schema
10. Update metadata: `{ version: "v2" }`
11. Application continues normally

### Example 3: Configuration Collection Migration (v1 → v2)

**Scenario**: Users collection has v1 schema (with liveTV field), code expects v2 (without liveTV)

1. Application starts
2. `initializeIndexes()` called for UserRepository
3. Expected version: `v2`
4. Stored version: `v1` (or null = v1)
5. Version mismatch detected: `v1` ≠ `v2`
6. Create backup: `users_v1_backup_2025-12-03_14-30-00`
7. Collection type: `configuration` → attempt transformation
8. Check version definitions: `getVersionDefinitions()` returns v1 and v2
9. Apply transformation: `v1_to_v2` function removes `liveTV` field from each document
10. Insert transformed documents into new collection
11. Update metadata: `{ version: "v2" }`
12. Create indexes with v2 schema
13. Log success: `✅ Successfully migrated users from v1 to v2 (5 documents)`
14. Application continues normally

### Example 4: Configuration Collection Migration Failure

**Scenario**: Users collection migration fails (transformation error or missing transformation)

1. Application starts
2. `initializeIndexes()` called for UserRepository
3. Expected version: `v2`
4. Stored version: `v1`
5. Version mismatch detected
6. Create backup: `users_v1_backup_2025-12-03_14-30-00`
7. Collection type: `configuration` → attempt transformation
8. Transformation fails (error in function or missing transformation)
9. Log error with clear message
10. Stop initialization for this collection
11. Application continues (other collections initialize)
12. User must check logs and restore from backup if needed

### Example 5: No Mismatch (Normal Operation)

**Scenario**: Collection version matches expected version

1. Application starts
2. `initializeIndexes()` called
3. Expected version: `v2`
4. Stored version: `v2` (from metadata)
5. Versions match → proceed normally
6. Create/update indexes as needed
7. Update metadata timestamp
8. Application continues normally

## Logging

### Backup Created (Data Collection)

```
═══════════════════════════════════════════════════════════════
⚠️  COLLECTION BACKUP CREATED: channels
   Backup name: channels_v1_backup_2025-12-03_11-57-18
   Version backed up: v1
   Documents backed up: 1250
   Reason: Schema version mismatch (v1 → v2)
   Original collection will be recreated with correct schema
═══════════════════════════════════════════════════════════════
```

### Configuration Collection Migration Success

```
[INFO] ✅ Successfully migrated users from v1 to v2 (5 documents)
```

### Configuration Collection Migration Failure (No Transformation)

```
═══════════════════════════════════════════════════════════════
❌ CONFIGURATION COLLECTION SCHEMA MISMATCH: users
   Version mismatch: v1 → v2
   Backup created: users_v1_backup_2025-12-03_14-30-00
   No transformation available for this version jump
   ACTION REQUIRED: Collection not migrated. Please restore from backup manually.
═══════════════════════════════════════════════════════════════
```

### Configuration Collection Migration Failure (Transformation Error)

```
═══════════════════════════════════════════════════════════════
❌ CONFIGURATION COLLECTION MIGRATION FAILED: users
   Version: v1 → v2
   Error: Transformation failed for document 507f1f77bcf86cd799439011: Cannot read property 'liveTV' of undefined
   Backup available: users_v1_backup_2025-12-03_14-30-00
   Migration stopped. Collection remains at previous version.
   ACTION REQUIRED: Check logs and restore from backup if needed.
═══════════════════════════════════════════════════════════════
```

### Backup Already Exists

```
[INFO] Backup already exists for channels v1, skipping backup creation
[WARN] Data collection channels will be recreated with schema v2
```

## Benefits

1. **Automatic Migration**: No need for separate migration jobs
2. **Safe Backups**: Collections backed up before schema changes
3. **No Duplicate Backups**: Each version backed up only once
4. **Type-Aware Handling**: Different behavior for data vs configuration
5. **Version Tracking**: Metadata collection tracks actual database state
6. **Clear Logging**: Easy to see what happened and where backups are
7. **Prevents Data Loss**: Configuration collections never auto-deleted

## Edge Cases

### Empty Collections
- If collection is empty, no backup needed
- Proceed with normal index creation
- Update metadata with new version

### Collection Doesn't Exist
- Create collection with new schema
- Update metadata with new version
- No backup needed (nothing to backup)

### Metadata Collection Doesn't Exist
- Created automatically on first use
- No special initialization needed

### Backup Rename Fails
- Log error
- Throw exception to prevent data loss
- Application startup fails (safe failure)

### Multiple Version Jumps
- Handles v1 → v3 (or any version jump)
- Backups current version (v1)
- Creates new version (v3)
- Future migrations can handle v2 → v3 if needed

### Duplicate Key Errors During Index Creation
- Detected as E11000 error code
- Backup collection before retrying
- Prevents corrupted index state

## Future Enhancements

1. **Data Transformation**: Support automatic data migration with transformation functions
2. **Rollback Support**: Ability to rollback to previous version
3. **Backup Cleanup**: Optional cleanup of old backups after successful migration
4. **Migration Scripts**: Support for custom migration scripts per version
5. **Version Comparison**: Detailed comparison of schema differences
6. **Restore Utility**: Helper utility to restore from backup collections

## Migration from Old System

This feature replaces the `LiveTVMigrationJob` system:

- **Before**: Separate migration job that runs on startup
- **After**: Automatic migration during index initialization
- **Migration**: Old migration job can be removed/deprecated

The new system handles the same use cases (username → provider_id migration) automatically without requiring a separate job.

