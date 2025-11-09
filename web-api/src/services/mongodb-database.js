import { MongoClient } from 'mongodb';
import { fromCollectionName, getCollectionKey } from '../config/collections.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('MongoDatabaseService');

/**
 * MongoDB-based database service for web API
 * Provides same interface as DatabaseService but uses MongoDB collections
 * Maps collection names to MongoDB collections
 */
class MongoDatabaseService {
  /**
   * @param {MongoClient} mongoClient - MongoDB client instance
   * @param {string} dbName - Database name
   * @param {import('./cache.js').CacheService} cacheService - Cache service instance (for compatibility, but MongoDB queries are fast)
   */
  constructor(mongoClient, dbName, cacheService) {
    this.client = mongoClient;
    this.db = mongoClient.db(dbName);
    this._cache = cacheService; // Kept for compatibility but not heavily used
    this._isStopping = false;
    
    // Map collection names to MongoDB collection names
    this._collectionMap = {
      'titles': 'titles',
      'titles-streams': 'title_streams',
      'iptv-providers': 'iptv_providers',
      'settings': 'settings',
      'stats': 'stats',
      'users': 'users',
    };
  }

  /**
   * Get MongoDB collection directly
   * @param {string} collectionName - MongoDB collection name (e.g., "titles", "provider_titles")
   * @returns {import('mongodb').Collection}
   */
  getCollection(collectionName) {
    return this.db.collection(collectionName);
  }

  /**
   * Get MongoDB collection name from API collection name
   * @private
   * @param {string} collectionName - API collection name (e.g., "titles", "providerId.titles")
   * @returns {string} MongoDB collection name
   */
  _getMongoCollectionName(collectionName) {
    // Handle provider-specific collections
    if (collectionName.includes('.')) {
      const [providerId, collectionType] = collectionName.split('.');
      
      if (collectionType === 'titles') {
        return 'provider_titles';
      } else if (collectionType === 'categories') {
        return 'provider_categories';
      } else if (collectionType === 'ignored') {
        // Ignored titles are in provider_titles with ignored: true
        return 'provider_titles';
      }
    }
    
    // Map standard collection names
    return this._collectionMap[collectionName] || collectionName;
  }

  /**
   * Build MongoDB query from simple query object
   * @private
   * @param {string} collectionName - API collection name
   * @param {Object} query - Simple query object (e.g., { title_key: "movies-123" })
   * @returns {Object} MongoDB query object
   */
  _buildMongoQuery(collectionName, query) {
    if (!query || Object.keys(query).length === 0) {
      return {};
    }

    const mongoQuery = { ...query };
    
    // Handle provider-specific collections
    if (collectionName.includes('.')) {
      const [providerId, collectionType] = collectionName.split('.');
      
      if (collectionType === 'titles' || collectionType === 'ignored') {
        mongoQuery.provider_id = providerId;
        
        // For ignored collection, add ignored: true
        if (collectionType === 'ignored') {
          mongoQuery.ignored = true;
        }
      } else if (collectionType === 'categories') {
        mongoQuery.provider_id = providerId;
      }
    }
    
    return mongoQuery;
  }

  setStopping(value) {
    this._isStopping = value;
  }

  /**
   * Invalidate cache for a collection (no-op for MongoDB, kept for compatibility)
   * @param {string} collectionName - Collection name to invalidate
   */
  invalidateCollectionCache(collectionName) {
    // MongoDB queries are fast, caching is less critical
    // But we can still invalidate cache service if needed
    if (this._cache) {
      // Cache keys might be used elsewhere, but MongoDB doesn't need file-level caching
    }
  }

  /**
   * Get a single document by query
   * @param {string} collectionName - Collection name
   * @param {Object} query - Query object
   * @returns {Promise<Object|null>} Document or null
   */
  async getData(collectionName, query) {
    try {
      if (this._isStopping) {
        return null;
      }

      const mongoCollection = this._getMongoCollectionName(collectionName);
      const mongoQuery = this._buildMongoQuery(collectionName, query);
      
      const collection = this.db.collection(mongoCollection);
      const result = await collection.findOne(mongoQuery);
      
      return result || null;
    } catch (error) {
      logger.error(`Error getting data from collection ${collectionName}:`, error);
      return null;
    }
  }

  /**
   * Get multiple documents by query
   * @param {string} collectionName - Collection name
   * @param {Object} query - Query object
   * @param {Object} projection - Projection object (e.g., { title: 1, type: 1 })
   * @param {Object} sort - Sort object (e.g., { title: 1 })
   * @returns {Promise<Array|Map>} Array of documents or Map if collection uses mapping
   */
  async getDataList(collectionName, query = {}, projection = null, sort = null) {
    try {
      if (this._isStopping) {
        return [];
      }

      const mongoCollection = this._getMongoCollectionName(collectionName);
      const mongoQuery = this._buildMongoQuery(collectionName, query);
      
      const collection = this.db.collection(mongoCollection);
      let cursor = collection.find(mongoQuery);
      
      if (projection) {
        cursor = cursor.project(projection);
      }
      
      if (sort) {
        cursor = cursor.sort(sort);
      }
      
      const items = await cursor.toArray();
      
      // For titles collection, return Map for compatibility with existing code
      if (collectionName === 'titles') {
        const titlesMap = new Map();
        for (const title of items) {
          if (title.title_key) {
            titlesMap.set(title.title_key, title);
          }
        }
        return titlesMap;
      }
      
      return items;
    } catch (error) {
      logger.error(`Error getting data list from collection ${collectionName}:`, error);
      return [];
    }
  }

  /**
   * Get object collection data (for collections stored as objects, like settings)
   * Special handling for titles-streams: converts title_streams collection to object format
   * @param {string} collectionName - Collection name
   * @param {string} [key] - Optional key to get specific item
   * @returns {Promise<Object|*>} Object data or specific value
   */
  async getDataObject(collectionName, key = null) {
    try {
      if (this._isStopping) {
        return key !== null ? null : {};
      }

      // Special handling for titles-streams collection
      if (collectionName === 'titles-streams') {
        return await this._getTitleStreamsAsObject(key);
      }

      const mongoCollection = this._getMongoCollectionName(collectionName);
      const collection = this.db.collection(mongoCollection);
      
      if (key !== null) {
        // Get specific document by _id (key is the _id in MongoDB)
        const result = await collection.findOne({ _id: key });
        return result ? result.value : null;
      }
      
      // Get all documents and convert to object
      const items = await collection.find({}).toArray();
      const result = {};
      for (const item of items) {
        result[item._id] = item.value || item;
      }
      return result;
    } catch (error) {
      logger.error(`Error getting data object from collection ${collectionName}:`, error);
      return key !== null ? null : {};
    }
  }

  /**
   * Get title streams as object format (for compatibility with existing code)
   * Converts MongoDB title_streams collection to object format: { "movies-123-main-providerId": streamObj }
   * @private
   * @param {string} [key] - Optional key to get specific stream
   * @returns {Promise<Object>} Streams object
   */
  async _getTitleStreamsAsObject(key = null) {
    try {
      const collection = this.db.collection('title_streams');
      
      if (key !== null) {
        // Parse key to find stream: "type-tmdbId-streamId-providerId"
        const parts = key.split('-');
        if (parts.length >= 4) {
          const type = parts[0];
          const tmdbId = parts[1];
          const streamId = parts[2];
          const providerId = parts.slice(3).join('-');
          
          const titleKey = `${type}-${tmdbId}`;
          const stream = await collection.findOne({
            title_key: titleKey,
            stream_id: streamId,
            provider_id: providerId
          });
          
          return stream || null;
        }
        return null;
      }
      
      // Get all streams and convert to object format
      const streams = await collection.find({}).toArray();
      const result = {};
      
      for (const stream of streams) {
        // Build key: "type-tmdbId-streamId-providerId"
        // title_key format is "type-tmdbId" (e.g., "movies-12345" or "tvshows-67890")
        if (stream.title_key && stream.stream_id && stream.provider_id) {
          const streamKey = `${stream.title_key}-${stream.stream_id}-${stream.provider_id}`;
          result[streamKey] = stream;
        }
      }
      
      return result;
    } catch (error) {
      logger.error('Error getting title streams as object:', error);
      return {};
    }
  }

  /**
   * Update object collection data
   * Special handling for titles-streams: converts object format to title_streams collection updates
   * @param {string} collectionName - Collection name
   * @param {Object} data - Object data to write
   * @returns {Promise<void>}
   */
  async updateDataObject(collectionName, data) {
    try {
      if (this._isStopping) {
        return;
      }

      // Special handling for titles-streams collection
      if (collectionName === 'titles-streams') {
        return await this._updateTitleStreamsFromObject(data);
      }

      const mongoCollection = this._getMongoCollectionName(collectionName);
      const collection = this.db.collection(mongoCollection);
      
      // Update each key-value pair
      for (const [key, value] of Object.entries(data)) {
        await collection.updateOne(
          { _id: key },
          { $set: { value: value, lastUpdated: new Date() } },
          { upsert: true }
        );
      }
      
      this.invalidateCollectionCache(collectionName);
    } catch (error) {
      logger.error(`Error updating data object in collection ${collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Update title streams from object format (for compatibility)
   * Converts object format to MongoDB title_streams collection updates/deletes
   * @private
   * @param {Object} data - Streams object: { "movies-123-main-providerId": streamObj, ... }
   * @returns {Promise<void>}
   */
  async _updateTitleStreamsFromObject(data) {
    try {
      const collection = this.db.collection('title_streams');
      
      // Get all existing streams to compare
      const existingStreams = await collection.find({}).toArray();
      const existingKeys = new Set();
      
      for (const stream of existingStreams) {
        if (stream.title_key && stream.stream_id && stream.provider_id) {
          const streamKey = `${stream.title_key}-${stream.stream_id}-${stream.provider_id}`;
          existingKeys.add(streamKey);
        }
      }
      
      // Update or insert streams from data object
      for (const [streamKey, streamObj] of Object.entries(data)) {
        // Parse stream key: "type-tmdbId-streamId-providerId"
        const parts = streamKey.split('-');
        if (parts.length >= 4) {
          const type = parts[0];
          const tmdbId = parts[1];
          const streamId = parts[2];
          const providerId = parts.slice(3).join('-');
          
          const titleKey = `${type}-${tmdbId}`;
          
          await collection.updateOne(
            {
              title_key: titleKey,
              stream_id: streamId,
              provider_id: providerId
            },
            {
              $set: {
                ...streamObj,
                title_key: titleKey,
                stream_id: streamId,
                provider_id: providerId,
                lastUpdated: new Date()
              }
            },
            { upsert: true }
          );
          
          existingKeys.delete(streamKey);
        }
      }
      
      // Delete streams that were removed from data object
      for (const streamKey of existingKeys) {
        const parts = streamKey.split('-');
        if (parts.length >= 4) {
          const type = parts[0];
          const tmdbId = parts[1];
          const streamId = parts[2];
          const providerId = parts.slice(3).join('-');
          
          const titleKey = `${type}-${tmdbId}`;
          
          await collection.deleteOne({
            title_key: titleKey,
            stream_id: streamId,
            provider_id: providerId
          });
        }
      }
      
      this.invalidateCollectionCache('titles-streams');
    } catch (error) {
      logger.error('Error updating title streams from object:', error);
      throw error;
    }
  }

  /**
   * Get item by ID using collection key
   * @param {string} collectionName - Collection name
   * @param {string|number} itemId - Item ID
   * @returns {Promise<Object|null>} Document or null
   */
  async getItemById(collectionName, itemId) {
    try {
      const collection = fromCollectionName(collectionName);
      const key = getCollectionKey(collection);
      const query = { [key]: itemId };
      return await this.getData(collectionName, query);
    } catch (error) {
      logger.error(`Error getting item by ID from collection ${collectionName}:`, error);
      return null;
    }
  }

  /**
   * Insert a single document
   * @param {string} collectionName - Collection name
   * @param {Object} data - Document data
   * @returns {Promise<void>}
   */
  async insertData(collectionName, data) {
    try {
      if (this._isStopping) {
        return;
      }

      const mongoCollection = this._getMongoCollectionName(collectionName);
      const collection = this.db.collection(mongoCollection);
      
      // Add timestamps
      const now = new Date();
      if (!data.createdAt) {
        data.createdAt = now;
      }
      if (!data.lastUpdated) {
        data.lastUpdated = now;
      }
      
      await collection.insertOne(data);
      this.invalidateCollectionCache(collectionName);
    } catch (error) {
      // Handle duplicate key error gracefully (like file-based version)
      if (error.code === 11000) {
        logger.debug(`Duplicate key error for collection ${collectionName}, ignoring`);
        return;
      }
      logger.error(`Error inserting data into collection ${collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Insert multiple documents
   * @param {string} collectionName - Collection name
   * @param {Array<Object>} dataItems - Array of documents
   * @returns {Promise<void>}
   */
  async insertDataList(collectionName, dataItems) {
    try {
      if (this._isStopping || !dataItems || dataItems.length === 0) {
        return;
      }

      const mongoCollection = this._getMongoCollectionName(collectionName);
      const collection = this.db.collection(mongoCollection);
      
      // Add timestamps
      const now = new Date();
      const items = dataItems.map(item => ({
        ...item,
        createdAt: item.createdAt || now,
        lastUpdated: item.lastUpdated || now
      }));
      
      await collection.insertMany(items, { ordered: false });
      this.invalidateCollectionCache(collectionName);
    } catch (error) {
      // Handle duplicate key errors gracefully
      if (error.code === 11000) {
        logger.debug(`Some duplicate keys in collection ${collectionName}, continuing`);
        return;
      }
      logger.error(`Error inserting data list into collection ${collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Update a single document
   * @param {string} collectionName - Collection name
   * @param {Object} data - Update data
   * @param {Object} query - Query to find document
   * @returns {Promise<number>} Number of modified documents (0 or 1)
   */
  async updateData(collectionName, data, query) {
    try {
      if (this._isStopping) {
        return 0;
      }

      const mongoCollection = this._getMongoCollectionName(collectionName);
      const mongoQuery = this._buildMongoQuery(collectionName, query);
      const collection = this.db.collection(mongoCollection);
      
      // Add lastUpdated timestamp
      const updateData = {
        ...data,
        lastUpdated: new Date()
      };
      
      const result = await collection.updateOne(mongoQuery, { $set: updateData });
      
      // If no document found and upsert needed, try to insert
      if (result.matchedCount === 0) {
        const collectionType = fromCollectionName(collectionName);
        const key = getCollectionKey(collectionType);
        if (data[key]) {
          await collection.insertOne({ ...updateData, ...mongoQuery });
          return 1;
        }
      }
      
      this.invalidateCollectionCache(collectionName);
      return result.modifiedCount;
    } catch (error) {
      logger.error(`Error updating data in collection ${collectionName}:`, error);
      return 0;
    }
  }

  /**
   * Update multiple documents
   * @param {string} collectionName - Collection name
   * @param {Object} data - Update data
   * @param {Object} query - Query to find documents
   * @returns {Promise<void>}
   */
  async updateDataList(collectionName, data, query) {
    try {
      if (this._isStopping) {
        return;
      }

      const mongoCollection = this._getMongoCollectionName(collectionName);
      const mongoQuery = this._buildMongoQuery(collectionName, query);
      const collection = this.db.collection(mongoCollection);
      
      // Add lastUpdated timestamp
      const updateData = {
        ...data,
        lastUpdated: new Date()
      };
      
      await collection.updateMany(mongoQuery, { $set: updateData });
      this.invalidateCollectionCache(collectionName);
    } catch (error) {
      logger.error(`Error updating data list in collection ${collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Delete a single document
   * @param {string} collectionName - Collection name
   * @param {Object} query - Query to find document
   * @returns {Promise<void>}
   */
  async deleteData(collectionName, query) {
    try {
      if (this._isStopping) {
        return;
      }

      const mongoCollection = this._getMongoCollectionName(collectionName);
      const mongoQuery = this._buildMongoQuery(collectionName, query);
      const collection = this.db.collection(mongoCollection);
      
      await collection.deleteOne(mongoQuery);
      this.invalidateCollectionCache(collectionName);
    } catch (error) {
      logger.error(`Error deleting data from collection ${collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Delete multiple documents
   * @param {string} collectionName - Collection name
   * @param {Object} query - Query to find documents
   * @returns {Promise<void>}
   */
  async deleteDataList(collectionName, query) {
    try {
      if (this._isStopping) {
        return;
      }

      const mongoCollection = this._getMongoCollectionName(collectionName);
      const mongoQuery = this._buildMongoQuery(collectionName, query);
      const collection = this.db.collection(mongoCollection);
      
      await collection.deleteMany(mongoQuery);
      this.invalidateCollectionCache(collectionName);
    } catch (error) {
      logger.error(`Error deleting data list from collection ${collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Get count of documents
   * @param {string} collectionName - Collection name
   * @param {Object} query - Query object
   * @param {number} limit - Optional limit
   * @returns {Promise<number>} Count of documents
   */
  async getCount(collectionName, query, limit = null) {
    try {
      if (this._isStopping) {
        return 0;
      }

      const mongoCollection = this._getMongoCollectionName(collectionName);
      const mongoQuery = this._buildMongoQuery(collectionName, query);
      const collection = this.db.collection(mongoCollection);
      
      let count = await collection.countDocuments(mongoQuery);
      
      if (limit && limit > 0) {
        count = Math.min(count, limit);
      }
      
      return count;
    } catch (error) {
      logger.error(`Error getting count from collection ${collectionName}:`, error);
      return 0;
    }
  }

  /**
   * Get data keys only
   * @param {string} collectionName - Collection name
   * @param {Object} query - Query object
   * @returns {Promise<Array>} Array of keys
   */
  async getDataKeys(collectionName, query) {
    try {
      if (this._isStopping) {
        return [];
      }

      const collection = fromCollectionName(collectionName);
      const key = getCollectionKey(collection);
      
      const mongoCollection = this._getMongoCollectionName(collectionName);
      const mongoQuery = this._buildMongoQuery(collectionName, query);
      const mongoCollectionObj = this.db.collection(mongoCollection);
      
      const items = await mongoCollectionObj.find(mongoQuery, { projection: { [key]: 1 } }).toArray();
      return items.map(item => item[key]).filter(Boolean);
    } catch (error) {
      logger.error(`Error getting data keys from collection ${collectionName}:`, error);
      return [];
    }
  }

  /**
   * Read JSON file as array (kept for compatibility, but not used with MongoDB)
   * @param {string} filePath - File path (not used with MongoDB)
   * @returns {Promise<Array>} Empty array
   */
  async readFile(filePath) {
    logger.warn(`readFile() called with MongoDB - file path ignored: ${filePath}`);
    return [];
  }

  /**
   * Read JSON file as object (kept for compatibility, but not used with MongoDB)
   * @param {string} filePath - File path (not used with MongoDB)
   * @returns {Promise<Object>} Empty object
   */
  async readObject(filePath) {
    logger.warn(`readObject() called with MongoDB - file path ignored: ${filePath}`);
    return {};
  }

  /**
   * Write JSON file as array (kept for compatibility, but not used with MongoDB)
   * @param {string} filePath - File path (not used with MongoDB)
   * @param {Array} data - Data (not used with MongoDB)
   */
  async writeFile(filePath, data) {
    logger.warn(`writeFile() called with MongoDB - file path ignored: ${filePath}`);
  }

  /**
   * Write JSON file as object (kept for compatibility, but not used with MongoDB)
   * @param {string} filePath - File path (not used with MongoDB)
   * @param {Object} data - Data (not used with MongoDB)
   */
  async writeObject(filePath, data) {
    logger.warn(`writeObject() called with MongoDB - file path ignored: ${filePath}`);
  }

  /**
   * Get file path helper (kept for compatibility, but not used with MongoDB)
   * @param {string} relativePath - Relative path (not used with MongoDB)
   * @returns {string} Empty string
   */
  getFilePath(relativePath) {
    logger.warn(`getFilePath() called with MongoDB - path ignored: ${relativePath}`);
    return '';
  }

  /**
   * Check if an index exists with the same key specification
   * @private
   * @param {import('mongodb').Collection} collection - MongoDB collection
   * @param {Object} keySpec - Index key specification (e.g., { username: 1 })
   * @param {Object} options - Index options (e.g., { unique: true })
   * @returns {Promise<boolean>} True if index exists with same spec
   */
  async _indexExists(collection, keySpec, options = {}) {
    try {
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
            return true;
          }
        }
      }
      
      return false;
    } catch (error) {
      logger.warn(`Error checking index existence: ${error.message}`);
      return false;
    }
  }

  /**
   * Create an index if it doesn't already exist
   * @private
   * @param {import('mongodb').Collection} collection - MongoDB collection
   * @param {Object} keySpec - Index key specification
   * @param {Object} options - Index options
   * @param {string} indexName - Description of index for logging
   * @returns {Promise<boolean>} True if index was created, false if it already existed
   */
  async _createIndexIfNotExists(collection, keySpec, options, indexName) {
    try {
      const exists = await this._indexExists(collection, keySpec, options);
      
      if (exists) {
        logger.debug(`Index already exists for ${indexName}, skipping`);
        return false;
      }
      
      await collection.createIndex(keySpec, options);
      logger.debug(`Created index for ${indexName}`);
      return true;
    } catch (error) {
      // Check if error is about index already existing with different name
      if (error.message && error.message.includes('already exists')) {
        logger.debug(`Index already exists for ${indexName} (different name), skipping`);
        return false;
      }
      throw error;
    }
  }

  /**
   * Create indices for collections
   * @returns {Promise<void>}
   */
  async createIndices() {
    try {
      // Create indexes for users collection
      const usersCollection = this.db.collection('users');
      await this._createIndexIfNotExists(
        usersCollection,
        { username: 1 },
        { unique: true },
        'users.username (unique)'
      );
      
      // Create indexes for titles collection
      const titlesCollection = this.db.collection('titles');
      await this._createIndexIfNotExists(
        titlesCollection,
        { title_key: 1 },
        { unique: true },
        'titles.title_key (unique)'
      );
      await this._createIndexIfNotExists(
        titlesCollection,
        { type: 1 },
        {},
        'titles.type'
      );
      
      // Create indexes for provider_titles collection
      const providerTitlesCollection = this.db.collection('provider_titles');
      await this._createIndexIfNotExists(
        providerTitlesCollection,
        { provider_id: 1, title_key: 1 },
        {},
        'provider_titles.provider_id + title_key'
      );
      await this._createIndexIfNotExists(
        providerTitlesCollection,
        { provider_id: 1, type: 1 },
        {},
        'provider_titles.provider_id + type'
      );
      
      // Create indexes for title_streams collection
      const titleStreamsCollection = this.db.collection('title_streams');
      await this._createIndexIfNotExists(
        titleStreamsCollection,
        { title_key: 1, stream_id: 1, provider_id: 1 },
        {},
        'title_streams.title_key + stream_id + provider_id'
      );
      await this._createIndexIfNotExists(
        titleStreamsCollection,
        { title_key: 1 },
        {},
        'title_streams.title_key'
      );
      
      logger.info('MongoDB indexes checked/created');
    } catch (error) {
      logger.error(`Error creating indices: ${error.message}`);
      // Don't throw - indexes might already exist
    }
  }

  /**
   * Initialize database (connect and create indices)
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      await this.createIndices();
      logger.info('MongoDB database service initialized');
    } catch (error) {
      logger.error(`Error initializing MongoDB database service: ${error.message}`);
      throw error;
    }
  }
}

// Export class
export { MongoDatabaseService };

