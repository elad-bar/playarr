import { createLogger } from '../utils/this.logger.js';
import { formatNumber } from '../utils/numberFormat.js';
import { DB_NAME } from '../config/database.js';

/**
 * Base repository with common patterns for entity-specific repositories
 * Provides low-level MongoDB operations and repository-specific patterns
 * Entity-specific repositories extend this and override methods as needed
 */
export class BaseRepository {
  /**
   * @param {string} repositoryName - Repository name for logging (required)
   * @param {import('mongodb').MongoClient} mongoClient - MongoDB client instance
   * @param {string} collectionName - Collection name for this repository
   * @param {Function} keyBuilder - Function to build unique key from document: (doc) => string
   * @param {string} [collectionType='data'] - Collection type: 'data' or 'configuration'
   * @param {string} [schemaVersion='v1'] - Schema version (e.g., 'v1', 'v2')
   * @param {number} [defaultBatchSize=1000] - Default batch size for bulk operations
   */
  constructor(repositoryName, mongoClient, collectionName, keyBuilder, collectionType = 'data', schemaVersion = 'v1', defaultBatchSize = 1000) {
    this.logger = createLogger(repositoryName);
    this.client = mongoClient;
    this.db = mongoClient.db(DB_NAME);
    this.defaultBatchSize = defaultBatchSize;
    this._isStopping = false;
    this.collectionName = collectionName;
    this.keyBuilder = keyBuilder;
    this.collectionType = collectionType; // 'data' or 'configuration'
    this.schemaVersion = schemaVersion;   // Schema version (e.g., 'v1', 'v2')
  }

  /**
   * Set stopping flag to prevent new operations
   * @param {boolean} value - Whether service is stopping
   */
  setStopping(value) {
    this._isStopping = value;
  }

  /**
   * Get MongoDB collection directly (private - only for internal repository use)
   * @private
   * @param {string} collectionName - MongoDB collection name
   * @returns {import('mongodb').Collection}
   */
  _getCollection(collectionName) {
    return this.db.collection(collectionName);
  }

  /**
   * Get a single document by query
   * @param {Object} query - MongoDB query object
   * @param {Object} [options={}] - Options
   * @param {Object} [options.projection] - Projection object
   * @param {Object} [options.sort] - Sort object
   * @returns {Promise<Object|null>} Document or null
   */
  async findOne(query, options = {}) {
    try {
      if (this._isStopping) return null;

      const collection = this.db.collection(this.collectionName);
      let cursor = collection.find(query);

      if (options.projection) {
        cursor = cursor.project(options.projection);
      }
      if (options.sort) {
        cursor = cursor.sort(options.sort);
      }

      return await cursor.limit(1).next() || null;
    } catch (error) {
      this.logger.error(`Error finding one in ${this.collectionName}:`, error);
      return null;
    }
  }

  /**
   * Get multiple documents by query with pagination
   * @param {Object} query - MongoDB query object
   * @param {Object} [options={}] - Options
   * @param {Object} [options.projection] - Projection object
   * @param {Object} [options.sort] - Sort object
   * @param {number} [options.limit] - Limit number of results
   * @param {number} [options.skip] - Skip number of results (for pagination)
   * @returns {Promise<Array>} Array of documents
   */
  async findMany(query, options = {}) {
    try {
      if (this._isStopping) return [];

      const collection = this.db.collection(this.collectionName);
      let cursor = collection.find(query);

      if (options.projection) {
        cursor = cursor.project(options.projection);
      }
      if (options.sort) {
        cursor = cursor.sort(options.sort);
      }
      if (options.skip) {
        cursor = cursor.skip(options.skip);
      }
      if (options.limit) {
        cursor = cursor.limit(options.limit);
      }

      return await cursor.toArray();
    } catch (error) {
      this.logger.error(`Error finding many in ${this.collectionName}:`, error);
      return [];
    }
  }

  /**
   * Get documents as Map with custom key mapping
   * @param {Object} query - MongoDB query object
   * @param {Function} keyMapper - Function to extract key from document: (doc) => string
   * @param {Object} [options={}] - Options (same as findMany)
   * @returns {Promise<Map>} Map of documents keyed by keyMapper result
   */
  async findManyAsMap(query, keyMapper, options = {}) {
    try {
      const documents = await this.findMany(query, options);
      const map = new Map();
      
      for (const doc of documents) {
        const key = keyMapper(doc);
        if (key) {
          map.set(key, doc);
        }
      }
      
      return map;
    } catch (error) {
      this.logger.error(`Error finding many as map in ${this.collectionName}:`, error);
      return new Map();
    }
  }

  /**
   * Count documents matching query
   * @param {Object} query - MongoDB query object
   * @returns {Promise<number>} Count of documents
   */
  async count(query = {}) {
    try {
      if (this._isStopping) return 0;
      const collection = this.db.collection(this.collectionName);
      return await collection.countDocuments(query);
    } catch (error) {
      this.logger.error(`Error counting in ${this.collectionName}:`, error);
      return 0;
    }
  }

  /**
   * Execute MongoDB aggregation pipeline
   * @param {Array<Object>} pipeline - MongoDB aggregation pipeline
   * @returns {Promise<Array>} Aggregation results
   */
  async aggregate(pipeline) {
    try {
      if (this._isStopping) return [];
      const collection = this.db.collection(this.collectionName);
      return await collection.aggregate(pipeline).toArray();
    } catch (error) {
      this.logger.error(`Error aggregating in ${this.collectionName}:`, error);
      return [];
    }
  }

  /**
   * Insert a single document
   * @param {Object} document - Document to insert
   * @param {Object} [options={}] - Insert options
   * @returns {Promise<import('mongodb').InsertOneResult|null>}
   */
  async insertOne(document, options = {}) {
    try {
      if (this._isStopping) return null;

      const collection = this.db.collection(this.collectionName);
      return await collection.insertOne(document, options);
    } catch (error) {
      this.logger.error(`Error inserting one in ${this.collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Insert multiple documents (with optional batching)
   * @param {Array<Object>} documents - Documents to insert
   * @param {Object} [options={}] - Insert options
   * @param {boolean} [options.batch=true] - Whether to batch inserts
   * @param {number} [options.batchSize] - Batch size (defaults to defaultBatchSize)
   * @param {boolean} [options.ordered=false] - Whether inserts are ordered
   * @returns {Promise<{insertedCount: number}>}
   */
  async insertMany(documents, options = {}) {
    try {
      if (this._isStopping || !documents || documents.length === 0) {
        return { insertedCount: 0 };
      }

      const collection = this.db.collection(this.collectionName);
      const batch = options.batch !== false;
      const batchSize = options.batchSize || this.defaultBatchSize;
      const ordered = options.ordered || false;

      if (batch && documents.length > batchSize) {
        // Batch inserts
        let totalInserted = 0;
        for (let i = 0; i < documents.length; i += batchSize) {
          const batch = documents.slice(i, i + batchSize);
          const result = await collection.insertMany(batch, { ordered });
          totalInserted += result.insertedCount;
        }
        return { insertedCount: totalInserted };
      } else {
        // Single insert
        const result = await collection.insertMany(documents, { ordered });
        return { insertedCount: result.insertedCount };
      }
    } catch (error) {
      this.logger.error(`Error inserting many in ${this.collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Update a single document
   * @param {Object} filter - Filter query
   * @param {Object} update - Update operations (e.g., { $set: {...} })
   * @param {Object} [options={}] - Update options
   * @param {boolean} [options.upsert=false] - Whether to upsert
   * @returns {Promise<import('mongodb').UpdateResult>}
   */
  async updateOne(filter, update, options = {}) {
    try {
      if (this._isStopping) return { modifiedCount: 0 };

      const collection = this.db.collection(this.collectionName);
      return await collection.updateOne(filter, update, options);
    } catch (error) {
      this.logger.error(`Error updating one in ${this.collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Update multiple documents
   * @param {Object} filter - Filter query
   * @param {Object} update - Update operations
   * @param {Object} [options={}] - Update options
   * @returns {Promise<import('mongodb').UpdateResult>}
   */
  async updateMany(filter, update, options = {}) {
    try {
      if (this._isStopping) return { modifiedCount: 0 };

      const collection = this.db.collection(this.collectionName);
      return await collection.updateMany(filter, update, options);
    } catch (error) {
      this.logger.error(`Error updating many in ${this.collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Bulk write operations (with optional batching)
   * @param {Array<Object>} operations - Array of bulk write operations
   * @param {Object} [options={}] - Bulk write options
   * @param {boolean} [options.batch=true] - Whether to batch operations
   * @param {number} [options.batchSize] - Batch size (defaults to defaultBatchSize)
   * @param {boolean} [options.ordered=false] - Whether operations are ordered
   * @returns {Promise<{insertedCount: number, modifiedCount: number, deletedCount: number}>}
   */
  async bulkWrite(operations, options = {}) {
    try {
      if (this._isStopping || !operations || operations.length === 0) {
        return { insertedCount: 0, modifiedCount: 0, deletedCount: 0 };
      }

      const collection = this.db.collection(this.collectionName);
      const batch = options.batch !== false;
      const batchSize = options.batchSize || this.defaultBatchSize;
      const ordered = options.ordered || false;

      if (batch && operations.length > batchSize) {
        // Batch bulk writes
        let totalInserted = 0;
        let totalModified = 0;
        let totalDeleted = 0;

        for (let i = 0; i < operations.length; i += batchSize) {
          const batch = operations.slice(i, i + batchSize);
          const result = await collection.bulkWrite(batch, { ordered });
          totalInserted += result.insertedCount || 0;
          totalModified += result.modifiedCount || 0;
          totalDeleted += result.deletedCount || 0;
        }

        return {
          insertedCount: totalInserted,
          modifiedCount: totalModified,
          deletedCount: totalDeleted
        };
      } else {
        // Single bulk write
        const result = await collection.bulkWrite(operations, { ordered });
        return {
          insertedCount: result.insertedCount || 0,
          modifiedCount: result.modifiedCount || 0,
          deletedCount: result.deletedCount || 0
        };
      }
    } catch (error) {
      this.logger.error(`Error bulk writing in ${this.collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Delete a single document
   * @param {Object} filter - Filter query
   * @param {Object} [options={}] - Delete options
   * @returns {Promise<import('mongodb').DeleteResult>}
   */
  async deleteOne(filter, options = {}) {
    try {
      if (this._isStopping) return { deletedCount: 0 };
      const collection = this.db.collection(this.collectionName);
      return await collection.deleteOne(filter, options);
    } catch (error) {
      this.logger.error(`Error deleting one in ${this.collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Delete multiple documents
   * @param {Object} filter - Filter query
   * @param {Object} [options={}] - Delete options
   * @returns {Promise<import('mongodb').DeleteResult>}
   */
  async deleteMany(filter, options = {}) {
    try {
      if (this._isStopping) return { deletedCount: 0 };
      const collection = this.db.collection(this.collectionName);
      return await collection.deleteMany(filter, options);
    } catch (error) {
      this.logger.error(`Error deleting many in ${this.collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Check existence of documents in batches using $or queries
   * Useful for checking if multiple documents exist before insert/update
   * @param {Array<Object>} queries - Array of query objects to check
   * @param {Function} keyBuilder - Function to build unique key from document: (doc) => string
   * @param {Object} [options={}] - Options
   * @param {number} [options.batchSize] - Batch size for $or queries (defaults to defaultBatchSize)
   * @param {Object} [options.projection] - Projection for existence check
   * @returns {Promise<Set<string>>} Set of existing keys
   */
  async checkExistenceBatch(queries, keyBuilder, options = {}) {
    const existingSet = new Set();
    
    if (!queries || queries.length === 0) {
      return existingSet;
    }

    const collection = this.db.collection(this.collectionName);
    const batchSize = options.batchSize || this.defaultBatchSize;
    const projection = options.projection || { _id: 0 };

    // MongoDB $or has practical limits, so batch the queries
    for (let i = 0; i < queries.length; i += batchSize) {
      const batch = queries.slice(i, i + batchSize);
      
      const existing = await collection.find(
        { $or: batch },
        { projection }
      ).toArray();

      for (const doc of existing) {
        const key = keyBuilder(doc);
        if (key) {
          existingSet.add(key);
        }
      }
    }

    return existingSet;
  }

  /**
   * Create index if it doesn't exist
   * @param {Object} keySpec - Index key specification
   * @param {Object} [options={}] - Index options
   * @returns {Promise<boolean>} True if index was created, false if already exists
   */
  async createIndexIfNotExists(keySpec, options = {}) {
    try {
      const collection = this.db.collection(this.collectionName);
      
      // Ensure collection exists before checking indexes
      const collections = await this.db.listCollections({ name: this.collectionName }).toArray();
      if (collections.length === 0) {
        // Collection doesn't exist, create it by inserting and deleting a dummy document
        try {
          const result = await collection.insertOne({ _temp: true });
          await collection.deleteOne({ _id: result.insertedId });
        } catch (createError) {
          // Ignore - collection might have been created by another process
        }
      }
      
      const indexes = await collection.indexes();
      
      // Convert keySpec to string for comparison
      const keySpecStr = JSON.stringify(keySpec);
      
      for (const index of indexes) {
        // Compare key specification
        const indexKeyStr = JSON.stringify(index.key);
        if (indexKeyStr === keySpecStr) {
          // Check if options match (especially unique)
          const indexUnique = index.unique === true;
          const optionsUnique = options.unique === true;
          
          if (indexUnique === optionsUnique) {
            return false; // Already exists with matching properties
          } else {
            // Index exists with same keys but different properties (e.g., unique vs non-unique)
            // Drop the old index first to avoid name conflicts
            // MongoDB auto-generates index names based on keys, so same keys = same name
            try {
              await collection.dropIndex(index.name);
            } catch (dropError) {
              // If drop fails, try to continue - might be a race condition
              // The createIndex call below will handle the conflict
              this.logger.debug(`Failed to drop existing index ${index.name}: ${dropError.message}`);
            }
            break; // Exit loop and create new index
          }
        }
      }
      
      await collection.createIndex(keySpec, options);
      return true; // Created
    } catch (error) {
      // Check if error is about index already existing with same name
      if (error.message && (
        error.message.includes('already exists') ||
        error.message.includes('same name as the requested index')
      )) {
        // Index conflict - likely a race condition or the drop didn't work
        // Return false to indicate we couldn't create it, but don't throw
        this.logger.warn(`Index creation skipped due to conflict: ${error.message}`);
        return false;
      }
      throw error;
    }
  }


  // Common query methods (atomic)
  
  /**
   * Find documents by query
   * @param {Object} query - MongoDB query object
   * @param {Object} [options={}] - Query options (projection, sort, limit, skip)
   * @returns {Promise<Array<Object>>} Array of documents
   */
  async findByQuery(query, options = {}) {
    return await this.findMany(query, options);
  }

  /**
   * Find one document by query
   * @param {Object} query - MongoDB query object
   * @param {Object} [options={}] - Query options (projection, sort)
   * @returns {Promise<Object|null>} Document or null
   */
  async findOneByQuery(query, options = {}) {
    return await this.findOne(query, options);
  }

  /**
   * Find documents by keys
   * @param {Array<string>} keys - Array of keys
   * @param {string} keyField - Field name for keys (default: '_id')
   * @returns {Promise<Array<Object>>} Array of documents
   */
  async findByKeys(keys, keyField = '_id') {
    if (!keys || keys.length === 0) {
      return [];
    }
    return await this.findMany({ [keyField]: { $in: keys } });
  }

  /**
   * Update many documents by query
   * @param {Object} filter - Filter query
   * @param {Object} update - Update operations
   * @param {Object} [options={}] - Update options
   * @returns {Promise<import('mongodb').UpdateResult>}
   */
  async updateManyByQuery(filter, update, options = {}) {
    return await this.updateMany(filter, update, options);
  }

  /**
   * Delete many documents by query
   * @param {Object} filter - Filter query
   * @param {Object} [options={}] - Delete options
   * @returns {Promise<import('mongodb').DeleteResult>}
   */
  async deleteManyByQuery(filter, options = {}) {
    return await this.deleteMany(filter, options);
  }

  /**
   * Get index definitions for this repository
   * Override this method in child classes to define indexes
   * @returns {Array<Object>} Array of index definitions
   * @property {Object} key - Index key specification (e.g., { field: 1 })
   * @property {Object} [options={}] - Index options (e.g., { unique: true })
   * @property {Object} [duplicateKey] - Key structure for duplicate detection (defaults to key if unique)
   * @property {string} [description] - Description for logging
   * @example
   * return [
   *   {
   *     key: { provider_id: 1, title_key: 1 },
   *     options: { unique: true },
   *     duplicateKey: { provider_id: 1, title_key: 1 },
   *     description: 'Primary lookup (unique compound key)'
   *   }
   * ];
   */
  getIndexDefinitions() {
    // Override in child classes
    return [];
  }

  /**
   * Remove duplicate documents before creating unique index
   * Keeps the most recent document based on lastUpdated or createdAt
   * @private
   * @param {Object} duplicateKey - Key structure for duplicate detection
   * @returns {Promise<number>} Number of duplicates removed
   */
  async _removeDuplicates(duplicateKey) {
    const collection = this.db.collection(this.collectionName);
    
    // Build aggregation pipeline to find duplicates
    const groupId = {};
    for (const [field, direction] of Object.entries(duplicateKey)) {
      groupId[field] = `$${field}`;
    }

    // First, check if duplicates exist (fast check without loading all docs)
    const duplicateGroups = await collection.aggregate([
      {
        $group: {
          _id: groupId,
          count: { $sum: 1 },
          firstId: { $first: '$_id' } // Just get first ID to verify duplicates exist
        }
      },
      {
        $match: { count: { $gt: 1 } }
      }
    ]).toArray();

    if (duplicateGroups.length === 0) {
      return 0;
    }

    this.logger.info(`Found ${formatNumber(duplicateGroups.length)} duplicate key groups in ${this.collectionName}, removing duplicates...`);
    let totalRemoved = 0;

    // Now fetch only minimal fields for groups that have duplicates
    for (const dupGroup of duplicateGroups) {
      // Build query to find all documents with this duplicate key
      const query = {};
      for (const [field, value] of Object.entries(dupGroup._id)) {
        query[field] = value;
      }
      
      // Fetch only _id, lastUpdated, and createdAt to minimize memory usage
      const docs = await collection.find(query, {
        projection: { _id: 1, lastUpdated: 1, createdAt: 1 }
      }).sort({ lastUpdated: -1, createdAt: -1 }).toArray();

      // Keep the first (most recent), remove the rest
      const toRemove = docs.slice(1);
      if (toRemove.length > 0) {
        const idsToRemove = toRemove.map(d => d._id);
        const result = await collection.deleteMany({ _id: { $in: idsToRemove } });
        totalRemoved += result.deletedCount;
        this.logger.debug(`Removed ${formatNumber(result.deletedCount)} duplicate(s) for key: ${JSON.stringify(dupGroup._id)}`);
      }
    }

    this.logger.info(`Removed ${totalRemoved} duplicate document(s) from ${this.collectionName}`);
    return totalRemoved;
  }

  /**
   * Get version definitions with structure and transformation functions
   * Override in repositories for configuration collections that need transformation
   * @returns {Object|null} Version definitions dictionary or null
   */
  getVersionDefinitions() {
    // Override in repositories that need transformation
    return null;
  }

  /**
   * Get stored version from metadata collection
   * @private
   * @returns {Promise<string|null>} Stored version or null (means v1)
   */
  async _getStoredVersion() {
    try {
      const metadata = await this.db.collection('_collection_metadata')
        .findOne({ _id: this.collectionName });
      return metadata?.version || null; // null = v1 (default)
    } catch (error) {
      this.logger.error(`Error getting stored version for ${this.collectionName}: ${error.message}`);
      return null; // On error, assume v1
    }
  }

  /**
   * Update metadata collection with current version
   * @private
   * @param {Object} metadata - Metadata to update
   */
  async _updateMetadata(metadata) {
    try {
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
    } catch (error) {
      this.logger.error(`Error updating metadata for ${this.collectionName}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check if backup already exists for a version
   * @private
   * @param {string} version - Version to check
   * @returns {Promise<boolean>} True if backup exists
   */
  async _checkBackupExists(version) {
    try {
      const backupPattern = `${this.collectionName}_${version}_backup_`;
      const collections = await this.db.listCollections({ 
        name: { $regex: `^${backupPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` } 
      }).toArray();
      return collections.length > 0;
    } catch (error) {
      this.logger.error(`Error checking backup existence for ${this.collectionName} ${version}: ${error.message}`);
      return false;
    }
  }

  /**
   * Backup collection with version in name
   * @private
   * @param {string} version - Version being backed up
   * @returns {Promise<string>} Backup collection name
   */
  async _backupCollection(version) {
    try {
      // Check if backup already exists
      const backupPattern = `${this.collectionName}_${version}_backup_`;
      const existingBackups = await this.db.listCollections({ 
        name: { $regex: `^${backupPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` } 
      }).toArray();
      
      if (existingBackups.length > 0) {
        this.logger.info(`Backup already exists for ${this.collectionName} ${version}, skipping backup creation`);
        return existingBackups[0].name;
      }
      
      // Create new backup
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('.')[0];
      const backupName = `${this.collectionName}_${version}_backup_${timestamp}`;
      
      const collection = this.db.collection(this.collectionName);
      const docCount = await collection.countDocuments();
      
      await collection.rename(backupName);
      
      // Log backup creation
      this.logger.warn('═══════════════════════════════════════════════════════════════');
      this.logger.warn(`⚠️  COLLECTION BACKUP CREATED: ${this.collectionName}`);
      this.logger.warn(`   Backup name: ${backupName}`);
      this.logger.warn(`   Version backed up: ${version}`);
      this.logger.warn(`   Documents backed up: ${docCount}`);
      this.logger.warn(`   Reason: Schema version mismatch (${version} → ${this.schemaVersion})`);
      this.logger.warn('═══════════════════════════════════════════════════════════════');
      
      return backupName;
    } catch (error) {
      this.logger.error(`Error backing up collection ${this.collectionName}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Migrate collection sequentially from stored version to target version
   * Applies transformations step-by-step (v1 → v2 → v3, etc.)
   * @private
   * @param {string} fromVersion - Starting version
   * @param {string} toVersion - Target version
   * @returns {Promise<number|null>} Number of documents migrated, or null if no transformation available
   */
  async _migrateCollectionSequentially(fromVersion, toVersion) {
    const versionDefs = this.getVersionDefinitions();
    
    if (!versionDefs) {
      return null; // No version definitions available
    }
    
    // Parse version numbers
    const fromId = versionDefs[fromVersion]?.id;
    const toId = versionDefs[toVersion]?.id;
    
    if (!fromId || !toId) {
      return null; // Version definitions not available
    }
    
    if (fromId >= toId) {
      return null; // Already at or past target version
    }
    
    // Get backup collection name (fromVersion already includes "v" prefix)
    const backupPattern = `${this.collectionName}_${fromVersion}_backup_`;
    const backupCollections = await this.db.listCollections({ 
      name: { $regex: `^${backupPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` } 
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

  /**
   * Initialize database indexes for this collection
   * Uses getIndexDefinitions() to get index configuration
   * Creates indexes if they don't exist (MongoDB will auto-create collection if needed)
   * Handles schema version mismatches with automatic backup and migration
   * @returns {Promise<void>}
   */
  async initializeIndexes() {
    try {
      const indexDefinitions = this.getIndexDefinitions();
      
      if (indexDefinitions.length === 0) {
        this.logger.debug(`No index definitions found for ${this.collectionName}`);
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
              this.logger.info(`✅ Successfully migrated ${this.collectionName} from ${storedVersion} to ${expectedVersion} (${transformedCount} documents)`);
              // Continue with index creation
            } else {
              // No transformation available - fall back to error
              this.logger.error('═══════════════════════════════════════════════════════════════');
              this.logger.error(`❌ CONFIGURATION COLLECTION SCHEMA MISMATCH: ${this.collectionName}`);
              this.logger.error(`   Version mismatch: ${versionToBackup} → ${expectedVersion}`);
              this.logger.error(`   Backup created: ${this.collectionName}_${versionToBackup}_backup_*`);
              this.logger.error(`   No transformation available for this version jump`);
              this.logger.error(`   ACTION REQUIRED: Collection not migrated. Please restore from backup manually.`);
              this.logger.error('═══════════════════════════════════════════════════════════════');
              return; // Stop initialization for this collection
            }
          } catch (error) {
            // Transformation failed
            this.logger.error('═══════════════════════════════════════════════════════════════');
            this.logger.error(`❌ CONFIGURATION COLLECTION MIGRATION FAILED: ${this.collectionName}`);
            this.logger.error(`   Version: ${versionToBackup} → ${expectedVersion}`);
            this.logger.error(`   Error: ${error.message}`);
            this.logger.error(`   Backup available: ${this.collectionName}_${versionToBackup}_backup_*`);
            this.logger.error(`   Migration stopped. Collection remains at previous version.`);
            this.logger.error(`   ACTION REQUIRED: Check logs and restore from backup if needed.`);
            this.logger.error('═══════════════════════════════════════════════════════════════');
            return; // Stop initialization for this collection
          }
        } else {
          // Data collection - recreate with new schema
          this.logger.warn(`Data collection ${this.collectionName} will be recreated with schema ${expectedVersion}`);
          // Collection already renamed to backup, will be recreated when indexes are created
        }
      }

      const collection = this.db.collection(this.collectionName);
      
      // Fetch indexes ONCE for the entire collection (not per index!)
      let indexes;
      try {
        indexes = await collection.indexes();
      } catch (error) {
        // Collection might not exist, that's fine - MongoDB will create it when we create first index
        indexes = [];
      }
      
      // Build a Map for fast lookup: keyString -> index info
      const existingIndexesMap = new Map();
      for (const index of indexes) {
        const indexKeyStr = JSON.stringify(index.key);
        existingIndexesMap.set(indexKeyStr, {
          unique: index.unique === true,
          name: index.name
        });
      }

      // Create indexes that don't exist
      for (const indexDef of indexDefinitions) {
        const { key, options = {}, description } = indexDef;
        const keySpecStr = JSON.stringify(key);
        const existingIndex = existingIndexesMap.get(keySpecStr);
        const optionsUnique = options.unique === true;
        
        // Check if index already exists with matching properties
        if (existingIndex && existingIndex.unique === optionsUnique) {
          // Index already exists, skip
          continue;
        }
        
        // Index doesn't exist or has different properties - create it
        try {
          // If index exists with different properties, drop it first
          if (existingIndex && existingIndex.name) {
            try {
              await collection.dropIndex(existingIndex.name);
            } catch (dropError) {
              // Ignore drop errors, continue with creation
            }
          }
          
          await collection.createIndex(key, options);
          const indexDesc = description || JSON.stringify(key);
          this.logger.debug(`Created index in ${this.collectionName}: ${indexDesc}`);
        } catch (error) {
          // Handle duplicate key errors by backing up and retrying
          if (error.code === 11000 || error.message?.includes('duplicate key')) {
            const storedVersion = await this._getStoredVersion() || 'v1';
            this.logger.warn(`Duplicate key error creating index ${keySpecStr} in ${this.collectionName}, backing up collection...`);
            try {
              // Backup the collection
              await this._backupCollection(storedVersion);
              // Retry creating the index (on new empty collection)
              await collection.createIndex(key, options);
              this.logger.debug(`Recreated index in ${this.collectionName} after backup: ${description || JSON.stringify(key)}`);
            } catch (retryError) {
              this.logger.error(`Failed to recreate index after backup: ${retryError.message}`);
              throw retryError;
            }
          } else if (error.message && (
            error.message.includes('already exists') ||
            error.message.includes('same name as the requested index')
          )) {
            // Index was created by another process, continue
            continue;
          } else {
            // Re-throw other errors
            throw error;
          }
        }
      }

      // After successful initialization, update metadata
      await this._updateMetadata({
        version: expectedVersion,
        collectionType: collectionType
      });

      this.logger.debug(`${this.collectionName} indexes initialized`);
    } catch (error) {
      this.logger.error(`Error initializing indexes for ${this.collectionName}: ${error.message}`);
      throw error;
    }
  }
}

