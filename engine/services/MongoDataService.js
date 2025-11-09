import { createLogger } from '../utils/logger.js';

const logger = createLogger('MongoDataService');

/**
 * MongoDB-based data service for engine
 * Provides efficient collection-based queries with bulk operations and incremental updates
 */
export class MongoDataService {
  /**
   * @param {import('../utils/mongo-client.js').default} mongoClient - MongoDB client instance
   */
  constructor(mongoClient) {
    this.client = mongoClient;
    this.db = mongoClient.getDatabase();
    this.batchSize = 1000; // Batch size for bulk operations
    this.existenceCheckBatchSize = 1000; // Batch size for existence checks (MongoDB $or limit)
  }

  /**
   * Check existence of documents in batches using $or queries
   * @private
   * @param {import('mongodb').Collection} collection - MongoDB collection
   * @param {Array<Object>} queries - Array of query objects to check
   * @param {Function} keyBuilder - Function to build unique key from query: (query) => string
   * @returns {Promise<Set<string>>} Set of existing keys
   */
  async _checkExistenceBatch(collection, queries, keyBuilder) {
    const existingSet = new Set();
    
    if (queries.length === 0) {
      return existingSet;
    }

    // MongoDB $or has practical limits, so batch the queries
    for (let i = 0; i < queries.length; i += this.existenceCheckBatchSize) {
      const batch = queries.slice(i, i + this.existenceCheckBatchSize);
      
      const existing = await collection.find(
        { $or: batch },
        { projection: { _id: 0 } } // Only return fields needed for key building
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
   * Get provider titles from MongoDB
   * @param {string} providerId - Provider identifier
   * @param {Object} [options={}] - Query options
   * @param {Date} [options.since] - Only get titles updated since this date
   * @param {string} [options.type] - Filter by type ('movies' or 'tvshows')
   * @param {boolean} [options.ignored] - Filter by ignored status
   * @returns {Promise<Array<Object>>} Array of provider title documents
   */
  async getProviderTitles(providerId, options = {}) {
    const query = { provider_id: providerId };
    
    // Incremental: only get titles updated since last execution
    if (options.since) {
      query.lastUpdated = { $gt: options.since };
    }
    
    // Filter by type if specified
    if (options.type) {
      query.type = options.type;
    }
    
    // Filter ignored if specified
    if (options.ignored !== undefined) {
      query.ignored = options.ignored;
    }
    
    return await this.db.collection('provider_titles')
      .find(query)
      .toArray();
  }

  /**
   * Save provider titles with optimized bulk operations
   * Called periodically (every 30 seconds) or at end of process
   * Internally batches operations into chunks of 1000 to reduce database load
   * @param {string} providerId - Provider identifier
   * @param {Array<Object>} titles - Array of title objects to save (accumulated since last save)
   * @returns {Promise<{inserted: number, updated: number}>}
   */
  async saveProviderTitles(providerId, titles) {
    if (!titles || titles.length === 0) {
      return { inserted: 0, updated: 0 };
    }

    const collection = this.db.collection('provider_titles');
    const now = new Date();
    
    // Build queries to check existence (using title_key as unique identifier)
    const existenceQueries = titles
      .filter(t => t.title_key)
      .map(t => ({
        provider_id: providerId,
        title_key: t.title_key
      }));

    // Check existence in batches
    const existingKeys = await this._checkExistenceBatch(
      collection,
      existenceQueries,
      (doc) => `${doc.provider_id}|${doc.title_key}`
    );

    // Separate into inserts and updates
    const toInsert = [];
    const toUpdate = [];

    for (const title of titles) {
      if (!title.title_key) continue;

      const key = `${providerId}|${title.title_key}`;
      const titleDoc = {
        ...title,
        provider_id: providerId,
        createdAt: now,
        lastUpdated: now
      };

      if (existingKeys.has(key)) {
        // Update existing
        toUpdate.push({
          updateOne: {
            filter: { 
              provider_id: providerId,
              title_key: title.title_key 
            },
            update: {
              $set: {
                ...title,
                provider_id: providerId,
                lastUpdated: now
              }
            }
          }
        });
      } else {
        // Insert new
        toInsert.push(titleDoc);
      }
    }

    let inserted = 0;
    let updated = 0;

    // Bulk insert new titles in batches of 1000
    if (toInsert.length > 0) {
      for (let i = 0; i < toInsert.length; i += this.batchSize) {
        const batch = toInsert.slice(i, i + this.batchSize);
        const result = await collection.insertMany(batch, { ordered: false });
        inserted += result.insertedCount;
      }
    }

    // Bulk update existing titles in batches of 1000
    if (toUpdate.length > 0) {
      for (let i = 0; i < toUpdate.length; i += this.batchSize) {
        const batch = toUpdate.slice(i, i + this.batchSize);
        const result = await collection.bulkWrite(batch, { ordered: false });
        updated += result.modifiedCount;
      }
    }

    return { inserted, updated };
  }

  /**
   * Get main titles from MongoDB
   * @param {Object} [query={}] - MongoDB query object
   * @returns {Promise<Array<Object>>} Array of main title documents
   */
  async getMainTitles(query = {}) {
    return await this.db.collection('titles')
      .find(query)
      .toArray();
  }

  /**
   * Get main titles by title_key array (efficient lookup)
   * @param {Array<string>} titleKeys - Array of title_key values
   * @returns {Promise<Array<Object>>} Array of main title documents
   */
  async getMainTitlesByKeys(titleKeys) {
    if (!titleKeys || titleKeys.length === 0) {
      return [];
    }
    
    return await this.db.collection('titles')
      .find({ title_key: { $in: titleKeys } })
      .toArray();
  }

  /**
   * Save main titles with optimized bulk operations
   * Called periodically (every 30 seconds) or at end of process
   * Internally batches operations into chunks of 1000
   * @param {Array<Object>} titles - Array of main title objects
   * @returns {Promise<{inserted: number, updated: number}>}
   */
  async saveMainTitles(titles) {
    if (!titles || titles.length === 0) {
      return { inserted: 0, updated: 0 };
    }

    const collection = this.db.collection('titles');
    const now = new Date();
    
    // Build queries to check existence (using title_key as unique identifier)
    const existenceQueries = titles
      .filter(t => t.title_key)
      .map(t => ({
        title_key: t.title_key
      }));

    // Check existence in batches
    const existingKeys = await this._checkExistenceBatch(
      collection,
      existenceQueries,
      (doc) => doc.title_key
    );

    // Separate into inserts and updates
    const toInsert = [];
    const toUpdate = [];

    for (const title of titles) {
      if (!title.title_key) continue;

      const titleDoc = {
        ...title,
        createdAt: now,
        lastUpdated: now
      };

      if (existingKeys.has(title.title_key)) {
        // Update existing
        toUpdate.push({
          updateOne: {
            filter: { title_key: title.title_key },
            update: {
              $set: {
                ...title,
                lastUpdated: now
              }
            }
          }
        });
      } else {
        // Insert new
        toInsert.push(titleDoc);
      }
    }

    let inserted = 0;
    let updated = 0;

    // Bulk insert new titles
    if (toInsert.length > 0) {
      for (let i = 0; i < toInsert.length; i += this.batchSize) {
        const batch = toInsert.slice(i, i + this.batchSize);
        const result = await collection.insertMany(batch, { ordered: false });
        inserted += result.insertedCount;
      }
    }

    // Bulk update existing titles
    if (toUpdate.length > 0) {
      for (let i = 0; i < toUpdate.length; i += this.batchSize) {
        const batch = toUpdate.slice(i, i + this.batchSize);
        const result = await collection.bulkWrite(batch, { ordered: false });
        updated += result.modifiedCount;
      }
    }

    return { inserted, updated };
  }

  /**
   * Get title streams from MongoDB
   * @param {string} titleKey - Title key (e.g., "movies-12345")
   * @returns {Promise<Array<Object>>} Array of stream documents
   */
  async getTitleStreams(titleKey) {
    return await this.db.collection('title_streams')
      .find({ title_key: titleKey })
      .toArray();
  }

  /**
   * Save title streams with optimized bulk operations
   * Called periodically (every 30 seconds) or at end of process
   * Internally batches operations into chunks of 1000
   * @param {Array<Object>} streams - Array of stream objects
   * @returns {Promise<{inserted: number, updated: number}>}
   */
  async saveTitleStreams(streams) {
    if (!streams || streams.length === 0) {
      return { inserted: 0, updated: 0 };
    }

    const collection = this.db.collection('title_streams');
    const now = new Date();
    
    // Build queries to check existence (compound key: title_key + stream_id + provider_id)
    const existenceQueries = streams
      .filter(s => s.title_key && s.stream_id && s.provider_id)
      .map(s => ({
        title_key: s.title_key,
        stream_id: s.stream_id,
        provider_id: s.provider_id
      }));

    // Check existence in batches
    const existingKeys = await this._checkExistenceBatch(
      collection,
      existenceQueries,
      (doc) => `${doc.title_key}|${doc.stream_id}|${doc.provider_id}`
    );

    // Separate into inserts and updates
    const toInsert = [];
    const toUpdate = [];

    for (const stream of streams) {
      if (!stream.title_key || !stream.stream_id || !stream.provider_id) {
        continue;
      }

      const key = `${stream.title_key}|${stream.stream_id}|${stream.provider_id}`;
      const streamDoc = {
        ...stream,
        createdAt: now,
        lastUpdated: now
      };

      if (existingKeys.has(key)) {
        // Update existing
        toUpdate.push({
          updateOne: {
            filter: {
              title_key: stream.title_key,
              stream_id: stream.stream_id,
              provider_id: stream.provider_id
            },
            update: {
              $set: {
                ...stream,
                lastUpdated: now
              }
            }
          }
        });
      } else {
        // Insert new
        toInsert.push(streamDoc);
      }
    }

    let inserted = 0;
    let updated = 0;

    // Bulk insert new streams
    if (toInsert.length > 0) {
      for (let i = 0; i < toInsert.length; i += this.batchSize) {
        const batch = toInsert.slice(i, i + this.batchSize);
        const result = await collection.insertMany(batch, { ordered: false });
        inserted += result.insertedCount;
      }
    }

    // Bulk update existing streams
    if (toUpdate.length > 0) {
      for (let i = 0; i < toUpdate.length; i += this.batchSize) {
        const batch = toUpdate.slice(i, i + this.batchSize);
        const result = await collection.bulkWrite(batch, { ordered: false });
        updated += result.modifiedCount;
      }
    }

    return { inserted, updated };
  }

  /**
   * Get provider categories from MongoDB
   * @param {string} providerId - Provider identifier
   * @param {string} [type=null] - Filter by type ('movies' or 'tvshows')
   * @returns {Promise<Array<Object>>} Array of category documents
   */
  async getProviderCategories(providerId, type = null) {
    const query = { provider_id: providerId };
    if (type) {
      query.type = type;
    }
    return await this.db.collection('provider_categories')
      .find(query)
      .toArray();
  }

  /**
   * Save provider categories with optimized bulk operations
   * @param {string} providerId - Provider identifier
   * @param {Array<Object>} categories - Array of category objects
   * @returns {Promise<{inserted: number, updated: number}>}
   */
  async saveProviderCategories(providerId, categories) {
    if (!categories || categories.length === 0) {
      return { inserted: 0, updated: 0 };
    }

    const collection = this.db.collection('provider_categories');
    const now = new Date();
    
    // Build queries to check existence (using category_key as unique identifier)
    // category_key format: "{type}-{category_id}"
    const existenceQueries = categories
      .filter(c => c.category_key || (c.type && c.category_id !== undefined))
      .map(c => ({
        provider_id: providerId,
        category_key: c.category_key || `${c.type}-${c.category_id}`
      }));

    // Check existence in batches
    const existingKeys = await this._checkExistenceBatch(
      collection,
      existenceQueries,
      (doc) => `${doc.provider_id}|${doc.category_key}`
    );

    // Separate into inserts and updates
    const toInsert = [];
    const toUpdate = [];

    for (const category of categories) {
      const categoryKey = category.category_key || 
        (category.type && category.category_id !== undefined 
          ? `${category.type}-${category.category_id}` 
          : null);
      
      if (!categoryKey) continue;

      const key = `${providerId}|${categoryKey}`;
      const categoryDoc = {
        ...category,
        provider_id: providerId,
        category_key: categoryKey,
        createdAt: now,
        lastUpdated: now
      };

      if (existingKeys.has(key)) {
        // Update existing
        toUpdate.push({
          updateOne: {
            filter: { 
              provider_id: providerId,
              category_key: categoryKey
            },
            update: {
              $set: {
                ...category,
                provider_id: providerId,
                category_key: categoryKey,
                lastUpdated: now
              }
            }
          }
        });
      } else {
        // Insert new
        toInsert.push(categoryDoc);
      }
    }

    let inserted = 0;
    let updated = 0;

    // Bulk insert new categories
    if (toInsert.length > 0) {
      for (let i = 0; i < toInsert.length; i += this.batchSize) {
        const batch = toInsert.slice(i, i + this.batchSize);
        const result = await collection.insertMany(batch, { ordered: false });
        inserted += result.insertedCount;
      }
    }

    // Bulk update existing categories
    if (toUpdate.length > 0) {
      for (let i = 0; i < toUpdate.length; i += this.batchSize) {
        const batch = toUpdate.slice(i, i + this.batchSize);
        const result = await collection.bulkWrite(batch, { ordered: false });
        updated += result.modifiedCount;
      }
    }

    return { inserted, updated };
  }

  /**
   * Get IPTV providers from MongoDB
   * @returns {Promise<Array<Object>>} Array of enabled, non-deleted provider documents, sorted by priority
   */
  async getIPTVProviders() {
    return await this.db.collection('iptv_providers')
      .find({ enabled: true, deleted: { $ne: true } })
      .sort({ priority: 1 })
      .toArray();
  }

  /**
   * Get deleted providers from MongoDB
   * @returns {Promise<Array<Object>>} Array of deleted provider documents
   */
  async getDeletedProviders() {
    return await this.db.collection('iptv_providers')
      .find({ deleted: true })
      .toArray();
  }

  /**
   * Get job history from MongoDB
   * @param {string} jobName - Job name (e.g., "ProcessProvidersTitlesJob")
   * @param {string} [providerId=null] - Optional provider ID for provider-specific jobs
   * @returns {Promise<Object|null>} Job history document or null if not found
   */
  async getJobHistory(jobName, providerId = null) {
    const query = { job_name: jobName };
    if (providerId) {
      query.provider_id = providerId;
    }
    
    return await this.db.collection('job_history')
      .findOne(query);
  }

  /**
   * Update job history in MongoDB
   * @param {string} jobName - Job name (e.g., "ProcessProvidersTitlesJob")
   * @param {Object} result - Execution result object
   * @param {string} [providerId=null] - Optional provider ID for provider-specific jobs
   * @returns {Promise<void>}
   */
  async updateJobHistory(jobName, result, providerId = null) {
    const collection = this.db.collection('job_history');
    const now = new Date();
    
    const filter = {
      job_name: jobName,
      ...(providerId && { provider_id: providerId })
    };
    
    await collection.updateOne(
      filter,
      {
        $set: {
          last_execution: now,
          last_result: result,
          lastUpdated: now
        },
        $inc: { execution_count: 1 },
        $setOnInsert: {
          createdAt: now
        }
      },
      { upsert: true }
    );
  }

  /**
   * Get all cache policies from MongoDB as an object
   * @returns {Promise<Object>} Cache policy object with key-value pairs
   */
  async getCachePolicies() {
    try {
      const docs = await this.db.collection('cache_policy')
        .find({})
        .toArray();
      
      const policies = {};
      for (const doc of docs) {
        policies[doc._id] = doc.value;
      }
      return policies;
    } catch (error) {
      logger.error(`Error getting cache policies: ${error.message}`);
      return {};
    }
  }

  /**
   * Extract provider_id from policy key
   * @private
   * @param {string} policyKey - Cache path key (e.g., "agtv/categories", "tmdb/search/movie")
   * @returns {string|null} Provider ID or null if global policy
   */
  _extractProviderIdFromPolicyKey(policyKey) {
    if (!policyKey || typeof policyKey !== 'string') {
      return null;
    }
    
    // Check if it starts with known provider prefixes
    if (policyKey.startsWith('tmdb/')) {
      return 'tmdb';
    }
    
    // Extract first part before first slash (e.g., "agtv/categories" -> "agtv")
    const parts = policyKey.split('/');
    if (parts.length > 0 && parts[0]) {
      // Check if it's a valid provider ID (not a generic path like "search")
      const firstPart = parts[0];
      // Common provider types: agtv, xtream, or any custom provider ID
      // If it doesn't look like a generic path, assume it's a provider ID
      if (firstPart !== 'search' && firstPart !== 'find' && firstPart !== 'movie' && firstPart !== 'tv') {
        return firstPart;
      }
    }
    
    return null;
  }

  /**
   * Update cache policy in MongoDB
   * @param {string} policyKey - Cache path key (e.g., "tmdb/search/movie", "agtv/categories")
   * @param {number|null} ttlHours - TTL in hours (null for Infinity)
   * @param {string|null} [providerId=null] - Optional provider ID. If not provided, will be extracted from policyKey
   * @returns {Promise<void>}
   */
  async updateCachePolicy(policyKey, ttlHours, providerId = null) {
    const now = new Date();
    
    // Extract provider_id from policyKey if not provided
    const extractedProviderId = providerId !== null ? providerId : this._extractProviderIdFromPolicyKey(policyKey);
    
    await this.db.collection('cache_policy').updateOne(
      { _id: policyKey },
      {
        $set: {
          value: ttlHours,
          provider_id: extractedProviderId,
          lastUpdated: now
        },
        $setOnInsert: {
          createdAt: now
        }
      },
      { upsert: true }
    );
  }

  /**
   * Get cache policies by provider ID
   * @param {string} providerId - Provider identifier
   * @returns {Promise<Array<Object>>} Array of cache policy documents for the provider
   */
  async getCachePoliciesByProvider(providerId) {
    try {
      return await this.db.collection('cache_policy')
        .find({ provider_id: providerId })
        .toArray();
    } catch (error) {
      logger.error(`Error getting cache policies for provider ${providerId}: ${error.message}`);
      return [];
    }
  }

  /**
   * Get all settings from MongoDB as an object
   * @returns {Promise<Object>} Settings object with key-value pairs
   */
  async getSettings() {
    try {
      const docs = await this.db.collection('settings')
        .find({})
        .toArray();
      
      const settings = {};
      for (const doc of docs) {
        settings[doc._id] = doc.value;
      }
      return settings;
    } catch (error) {
      logger.error(`Error getting settings: ${error.message}`);
      return {};
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
        // Process in batches of 1000
        for (let i = 0; i < bulkOps.length; i += this.batchSize) {
          const batch = bulkOps.slice(i, i + this.batchSize);
          await this.db.collection('titles').bulkWrite(batch, { ordered: false });
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
}

