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
   */
  constructor(mongoClient, dbName) {
    this.client = mongoClient;
    this.db = mongoClient.db(dbName);
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
    } catch (error) {
      logger.error('Error updating title streams from object:', error);
      throw error;
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
      
      return result.modifiedCount;
    } catch (error) {
      logger.error(`Error updating data in collection ${collectionName}:`, error);
      return 0;
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
    } catch (error) {
      logger.error(`Error deleting data from collection ${collectionName}:`, error);
      throw error;
    }
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
      // Index for sorting by title (used in getTitles)
      await this._createIndexIfNotExists(
        titlesCollection,
        { title: 1 },
        {},
        'titles.title'
      );
      // Index for year/release_date filtering
      await this._createIndexIfNotExists(
        titlesCollection,
        { release_date: 1 },
        {},
        'titles.release_date'
      );
      // Compound index for filtering by type and sorting by title (common query pattern)
      await this._createIndexIfNotExists(
        titlesCollection,
        { type: 1, title: 1 },
        {},
        'titles.type + title'
      );
      // Compound index for filtering by type and release_date (year filtering)
      await this._createIndexIfNotExists(
        titlesCollection,
        { type: 1, release_date: 1 },
        {},
        'titles.type + release_date'
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
   * Remove provider from titles.streams object
   * Efficiently queries title_streams first to find only affected titles
   * @param {string} providerId - Provider ID to remove
   * @returns {Promise<{titlesUpdated: number, streamsRemoved: number}>}
   */
  async removeProviderFromTitles(providerId) {
    try {
      // 1. Get all title_streams for this provider
      const streams = await this.db.collection('title_streams')
        .find({ provider_id: providerId })
        .toArray();
      
      if (streams.length === 0) {
        return { titlesUpdated: 0, streamsRemoved: 0 };
      }
      
      // 2. Extract unique title_key values
      const titleKeys = [...new Set(streams.map(s => s.title_key))];
      
      // 3. Fetch only affected titles
      const titles = await this.db.collection('titles')
        .find({ title_key: { $in: titleKeys } })
        .toArray();
      
      if (titles.length === 0) {
        return { titlesUpdated: 0, streamsRemoved: 0 };
      }
      
      let titlesUpdated = 0;
      let streamsRemoved = 0;
      const bulkOps = [];
      
      // 4. Process each title
      for (const title of titles) {
        const streamsObj = title.streams || {};
        let titleModified = false;
        const updatedStreams = { ...streamsObj };
        
        // Process each stream entry in the streams object
        for (const [streamKey, streamValue] of Object.entries(streamsObj)) {
          // Both movies and TV shows use the same structure: { sources: [...] }
          // TV shows have additional metadata fields (air_date, name, overview, still_path)
          if (streamValue && typeof streamValue === 'object' && Array.isArray(streamValue.sources)) {
            const originalLength = streamValue.sources.length;
            const filteredSources = streamValue.sources.filter(id => id !== providerId);
            
            if (filteredSources.length !== originalLength) {
              if (filteredSources.length > 0) {
                // Keep the stream entry with filtered sources (preserve metadata for TV shows)
                updatedStreams[streamKey] = {
                  ...streamValue,
                  sources: filteredSources
                };
              } else {
                // Remove stream entry if no sources left
                updatedStreams[streamKey] = undefined;
              }
              streamsRemoved += (originalLength - filteredSources.length);
              titleModified = true;
            }
          }
        }
        
        // Remove undefined entries (streams with no sources left)
        for (const key in updatedStreams) {
          if (updatedStreams[key] === undefined) {
            delete updatedStreams[key];
          }
        }
        
        // 5. Prepare update operation
        if (titleModified) {
          titlesUpdated++;
          bulkOps.push({
            updateOne: {
              filter: { title_key: title.title_key },
              update: {
                $set: {
                  streams: updatedStreams,
                  lastUpdated: new Date()
                }
              }
            }
          });
        }
      }
      
      // 6. Execute bulk update
      if (bulkOps.length > 0) {
        const collection = this.db.collection('titles');
        // Process in batches of 1000
        for (let i = 0; i < bulkOps.length; i += 1000) {
          const batch = bulkOps.slice(i, i + 1000);
          await collection.bulkWrite(batch, { ordered: false });
        }
      }
      
      return { titlesUpdated, streamsRemoved };
    } catch (error) {
      logger.error(`Error removing provider ${providerId} from titles: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete all title_streams documents for a provider
   * @param {string} providerId - Provider ID
   * @returns {Promise<number>} Number of documents deleted
   */
  async deleteProviderTitleStreams(providerId) {
    try {
      const result = await this.db.collection('title_streams')
        .deleteMany({ provider_id: providerId });
      
      return result.deletedCount;
    } catch (error) {
      logger.error(`Error deleting title streams for provider ${providerId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete all provider_titles documents for a provider
   * @param {string} providerId - Provider ID
   * @returns {Promise<number>} Number of documents deleted
   */
  async deleteProviderTitles(providerId) {
    try {
      const result = await this.db.collection('provider_titles')
        .deleteMany({ provider_id: providerId });
      
      return result.deletedCount;
    } catch (error) {
      logger.error(`Error deleting provider titles for provider ${providerId}: ${error.message}`);
      throw error;
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

