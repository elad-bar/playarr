import { createLogger } from '../utils/logger.js';
import { DB_NAME } from '../config/database.js';

const logger = createLogger('BaseRepository');

/**
 * Base repository with common patterns for entity-specific repositories
 * Provides low-level MongoDB operations and repository-specific patterns
 * Entity-specific repositories extend this and override methods as needed
 */
export class BaseRepository {
  /**
   * @param {import('mongodb').MongoClient} mongoClient - MongoDB client instance
   * @param {string} collectionName - Collection name for this repository
   * @param {Function} keyBuilder - Function to build unique key from document: (doc) => string
   * @param {number} [defaultBatchSize=1000] - Default batch size for bulk operations
   */
  constructor(mongoClient, collectionName, keyBuilder, defaultBatchSize = 1000) {
    this.client = mongoClient;
    this.db = mongoClient.db(DB_NAME);
    this.defaultBatchSize = defaultBatchSize;
    this._isStopping = false;
    this.collectionName = collectionName;
    this.keyBuilder = keyBuilder;
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
      logger.error(`Error finding one in ${this.collectionName}:`, error);
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
      logger.error(`Error finding many in ${this.collectionName}:`, error);
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
      logger.error(`Error finding many as map in ${this.collectionName}:`, error);
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
      logger.error(`Error counting in ${this.collectionName}:`, error);
      return 0;
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
      const now = new Date();
      
      // Auto-add timestamps if not present
      if (!document.createdAt) document.createdAt = now;
      if (!document.lastUpdated) document.lastUpdated = now;

      return await collection.insertOne(document, options);
    } catch (error) {
      if (error.code === 11000) {
        logger.debug(`Duplicate key in ${this.collectionName}, ignoring`);
        return null;
      }
      logger.error(`Error inserting one in ${this.collectionName}:`, error);
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
      const now = new Date();

      // Auto-add timestamps
      documents.forEach(doc => {
        if (!doc.createdAt) doc.createdAt = now;
        if (!doc.lastUpdated) doc.lastUpdated = now;
      });

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
      if (error.code === 11000) {
        logger.debug(`Duplicate key in ${this.collectionName}, continuing`);
        return { insertedCount: 0 };
      }
      logger.error(`Error inserting many in ${this.collectionName}:`, error);
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
      
      // Auto-add lastUpdated if $set is used
      if (update.$set && !update.$set.lastUpdated) {
        update.$set.lastUpdated = new Date();
      }

      return await collection.updateOne(filter, update, options);
    } catch (error) {
      logger.error(`Error updating one in ${this.collectionName}:`, error);
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
      
      // Auto-add lastUpdated if $set is used
      if (update.$set && !update.$set.lastUpdated) {
        update.$set.lastUpdated = new Date();
      }

      return await collection.updateMany(filter, update, options);
    } catch (error) {
      logger.error(`Error updating many in ${this.collectionName}:`, error);
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
      logger.error(`Error bulk writing in ${this.collectionName}:`, error);
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
      logger.error(`Error deleting one in ${this.collectionName}:`, error);
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
      logger.error(`Error deleting many in ${this.collectionName}:`, error);
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
              logger.debug(`Failed to drop existing index ${index.name}: ${dropError.message}`);
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
        logger.warn(`Index creation skipped due to conflict: ${error.message}`);
        return false;
      }
      throw error;
    }
  }

  /**
   * Generic bulk save with existence check (atomic pattern)
   * Used by: saveProviderTitles, saveMainTitles, saveTitleStreams, etc.
   * @param {Array<Object>} documents - Documents to save
   * @param {Object} [options={}] - Options
   * @param {boolean} [options.addTimestamps=true] - Whether to add createdAt/lastUpdated
   * @param {Object} [options.existenceOptions] - Options for existence check
   * @returns {Promise<{inserted: number, updated: number}>}
   */
  async bulkSave(documents, options = {}) {
    if (!documents || documents.length === 0) {
      return { inserted: 0, updated: 0 };
    }

    const now = new Date();
    const addTimestamps = options.addTimestamps !== false;
    
    // Build existence queries (atomic)
    const existenceQueries = this.buildExistenceQueries(documents, options);
    
    if (existenceQueries.length === 0) {
      // No valid documents to check, return early
      return { inserted: 0, updated: 0 };
    }
    
    // Check existence (atomic)
    const existingKeys = await this.checkExistenceBatch(
      existenceQueries,
      this.keyBuilder,
      options.existenceOptions || {}
    );

    // Separate into inserts and updates (atomic)
    const { toInsert, toUpdate } = this.separateInsertsAndUpdates(
      documents,
      existingKeys,
      options
    );

    // Execute bulk operations (atomic)
    return await this.executeBulkSave(toInsert, toUpdate);
  }

  /**
   * Build existence queries from documents (atomic)
   * @protected
   * @param {Array<Object>} documents - Documents to check
   * @param {Object} options - Options passed to bulkSave
   * @returns {Array<Object>} Array of query objects
   */
  buildExistenceQueries(documents, options) {
    // Override in subclasses for entity-specific logic
    return documents
      .filter(doc => this.getDocumentKey(doc))
      .map(doc => this.buildExistenceQuery(doc, options));
  }

  /**
   * Build single existence query (atomic)
   * @protected
   * @param {Object} doc - Document to check
   * @param {Object} options - Options passed to bulkSave
   * @returns {Object} Query object
   */
  buildExistenceQuery(doc, options) {
    // Override in subclasses
    return { _id: doc._id };
  }

  /**
   * Get document key for existence check (atomic)
   * @protected
   * @param {Object} doc - Document
   * @returns {string|null} Key or null if invalid
   */
  getDocumentKey(doc) {
    // Override in subclasses
    return doc._id || doc.title_key;
  }

  /**
   * Separate documents into inserts and updates (atomic)
   * @protected
   * @param {Array<Object>} documents - Documents to separate
   * @param {Set<string>} existingKeys - Set of existing keys
   * @param {Object} options - Options passed to bulkSave
   * @returns {{toInsert: Array<Object>, toUpdate: Array<Object>}}
   */
  separateInsertsAndUpdates(documents, existingKeys, options) {
    const toInsert = [];
    const toUpdate = [];
    const now = new Date();
    const addTimestamps = options.addTimestamps !== false;

    for (const doc of documents) {
      const key = this.buildKeyForCheck(doc, options);
      if (!key) continue;

      const docWithTimestamps = addTimestamps ? {
        ...doc,
        ...(doc.createdAt ? {} : { createdAt: doc.createdAt || now }),
        lastUpdated: now
      } : doc;

      if (existingKeys.has(key)) {
        toUpdate.push(this.buildUpdateOperation(doc, options));
      } else {
        toInsert.push(docWithTimestamps);
      }
    }

    return { toInsert, toUpdate };
  }

  /**
   * Build key for existence check (atomic)
   * @protected
   * @param {Object} doc - Document
   * @param {Object} options - Options passed to bulkSave
   * @returns {string|null} Key or null if invalid
   */
  buildKeyForCheck(doc, options) {
    // Override in subclasses
    return this.keyBuilder(doc);
  }

  /**
   * Build update operation (atomic)
   * @protected
   * @param {Object} doc - Document to update
   * @param {Object} options - Options passed to bulkSave
   * @returns {Object} Bulk write operation
   */
  buildUpdateOperation(doc, options) {
    // Override in subclasses
    return {
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { ...doc, lastUpdated: new Date() } }
      }
    };
  }

  /**
   * Execute bulk save operations (atomic)
   * @protected
   * @param {Array<Object>} toInsert - Documents to insert
   * @param {Array<Object>} toUpdate - Update operations
   * @returns {Promise<{inserted: number, updated: number}>}
   */
  async executeBulkSave(toInsert, toUpdate) {
    const [insertResult, updateResult] = await Promise.all([
      toInsert.length > 0 
        ? this.insertMany(toInsert, { batch: true, ordered: false }) 
        : { insertedCount: 0 },
      toUpdate.length > 0 
        ? this.bulkWrite(toUpdate, { batch: true, ordered: false }) 
        : { modifiedCount: 0 }
    ]);

    return {
      inserted: insertResult.insertedCount || 0,
      updated: updateResult.modifiedCount || 0
    };
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

    logger.info(`Found ${duplicateGroups.length} duplicate key groups in ${this.collectionName}, removing duplicates...`);
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
        logger.debug(`Removed ${result.deletedCount} duplicate(s) for key: ${JSON.stringify(dupGroup._id)}`);
      }
    }

    logger.info(`Removed ${totalRemoved} duplicate document(s) from ${this.collectionName}`);
    return totalRemoved;
  }

  /**
   * Initialize database indexes for this collection
   * Uses getIndexDefinitions() to get index configuration
   * Automatically handles duplicate cleanup for unique indexes
   * @returns {Promise<void>}
   */
  async initializeIndexes() {
    try {
      const indexDefinitions = this.getIndexDefinitions();
      
      if (indexDefinitions.length === 0) {
        logger.debug(`No index definitions found for ${this.collectionName}`);
        return;
      }

      // Ensure collection exists before creating indexes
      const collection = this.db.collection(this.collectionName);
      const collections = await this.db.listCollections({ name: this.collectionName }).toArray();
      if (collections.length === 0) {
        // Collection doesn't exist, create it by inserting and immediately deleting a dummy document
        try {
          const result = await collection.insertOne({ _temp: true });
          await collection.deleteOne({ _id: result.insertedId });
          logger.debug(`Created collection ${this.collectionName} for index initialization`);
        } catch (createError) {
          // Collection might have been created by another process, continue
          logger.debug(`Collection ${this.collectionName} creation: ${createError.message}`);
        }
      }

      for (const indexDef of indexDefinitions) {
        const { key, options = {}, duplicateKey, description } = indexDef;
        
        // For unique indexes, check and remove duplicates first
        if (options.unique === true) {
          const dupKey = duplicateKey || key;
          await this._removeDuplicates(dupKey);
        }

        // Create the index
        const created = await this.createIndexIfNotExists(key, options);
        const indexDesc = description || JSON.stringify(key);
        if (created) {
          logger.debug(`Created index in ${this.collectionName}: ${indexDesc}`);
        } else {
          logger.debug(`Index already exists in ${this.collectionName}: ${indexDesc}`);
        }
      }

      logger.debug(`${this.collectionName} indexes initialized`);
    } catch (error) {
      logger.error(`Error initializing indexes for ${this.collectionName}: ${error.message}`);
      throw error;
    }
  }
}

