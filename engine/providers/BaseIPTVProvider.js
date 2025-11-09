/**
 * @typedef {Object} TitleData
 * @property {string} [stream_id]
 * @property {string} [series_id]
 * @property {string} [stream_display_name]
 * @property {string} [name]
 * @property {string} [title]
 * @property {string} [container_extension]
 * @property {Object} [info]
 * @property {number} [category_id]
 * @property {string} [category_name]
 * @property {string} [url]
 * @property {number} [duration]
 * @property {string} [type] - Media type ('movies' or 'tvshows')
 * @property {string} [title_id] - Original title ID from provider
 * @property {string} [title_key] - Unique key combining type and title_id: {type}-{title_id}
 * @property {string} [createdAt] - ISO timestamp when title was first created
 * @property {string} [lastUpdated] - ISO timestamp when title was last updated
 * @property {Object<string, string>} [streams] - Dictionary of stream URLs (key: "main" for movies, "Sxx-Exx" for TV shows)
 * @property {Array} [episodes] - Array of episode data (for TV shows)
 */

import { BaseProvider } from './BaseProvider.js';
import { generateTitleKey, generateCategoryKey } from '../utils/titleUtils.js';

/**
 * Base class for all IPTV providers (AGTV, Xtream)
 * Extends BaseProvider with IPTV-specific functionality
 * @abstract
 */
export class BaseIPTVProvider extends BaseProvider { 
  /**
   * @param {Object} providerData - Provider configuration data
   * @param {import('../managers/StorageManager.js').StorageManager} cache - Storage manager instance for temporary cache
   * @param {import('../managers/StorageManager.js').StorageManager} data - Storage manager instance for persistent data storage
   * @param {import('../services/MongoDataService.js').MongoDataService} mongoData - MongoDB data service instance
   * @param {number} [metadataBatchSize=100] - Batch size for processing metadata (default: 100)
   */
  constructor(providerData, cache, data, mongoData, metadataBatchSize = 100) {
    super(providerData, cache, data);
    
    if (!mongoData) {
      throw new Error('MongoDataService is required');
    }
    this.mongoData = mongoData;
    
    // In-memory cache for titles and ignored titles
    // Loaded once at the start of job execution and kept in memory
    this._titlesCache = null;
    this._ignoredCache = null;
    
    // Accumulated ignored titles by type for batch saving
    // Format: { 'movies': { titleId: reason }, 'tvshows': { titleId: reason } }
    this._accumulatedIgnoredTitles = {};
    
    /**
     * Batch size for processing metadata
     * Controls memory usage (max concurrent promises), not save frequency
     * @type {number}
     */
    this.metadataBatchSize = metadataBatchSize;
  }

  /**
   * Get the provider type identifier
   * @returns {string} Provider type (e.g., 'agtv', 'xtream')
   * @abstract
   */
  getProviderType() {
    throw new Error('getProviderType() must be implemented by subclass');
  }

  /**
   * Fetch categories from the provider
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Promise<Array<{category_id: number, category_name: string}>>} Array of category data
   * @abstract
   */
  async fetchCategories(type) {
    throw new Error('fetchCategories(type) must be implemented by subclass');
  }

  /**
   * Fetch metadata from the provider and save it
   * Template method pattern - delegates to provider-specific methods
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Promise<number>} Number of titles processed and saved
   * @override
   */
  async fetchMetadata(type) {
    this.logger.info(`${type}: Starting fetchMetadata`);

    // Step 1: Fetch titles metadata (provider-specific)
    const titles = await this._fetchTitlesMetadata(type);

    // Step 2: Filter titles (provider-specific)
    const filteredTitles = await this._filterTitles(titles, type);

    this.logger.info(`${type}: Filtered ${filteredTitles.length} titles to process`);

    // Step 3: Process in batches for memory efficiency
    // Batch size controls memory usage (max concurrent promises), not save frequency
    const batchSize = this.metadataBatchSize;
    const batches = [];
    for (let i = 0; i < filteredTitles.length; i += batchSize) {
      batches.push(filteredTitles.slice(i, i + batchSize));
    }

    this.logger.info(`${type}: Processing ${batches.length} batch(es) of up to ${batchSize} titles each`);

    let totalProcessed = 0;
    let totalRemaining = filteredTitles.length;
    
    // Accumulate processed titles for periodic saving (not batch-based)
    const processedTitles = [];
    
    // Save callback for progress tracking (called every 30 seconds and on completion)
    const saveCallback = async () => {
      if (processedTitles.length > 0) {
        try {
          await this.saveTitles(type, processedTitles);
          this.logger.debug(`${type}: Saved ${processedTitles.length} accumulated title(s) via progress callback`);
          processedTitles.length = 0; // Clear after saving
        } catch (error) {
          this.logger.error(`Error saving accumulated titles for ${type}: ${error.message}`);
        }
      }
      
      // Also save accumulated ignored titles for this type
      if (this._accumulatedIgnoredTitles[type] && Object.keys(this._accumulatedIgnoredTitles[type]).length > 0) {
        try {
          // Convert title_id to title_key format and save directly
          const ignoredByTitleKey = Object.fromEntries(
            Object.entries(this._accumulatedIgnoredTitles[type]).map(([titleId, reason]) => [
              generateTitleKey(type, titleId),
              reason
            ])
          );
          
          await this.saveAllIgnoredTitles(ignoredByTitleKey);
          
          const count = Object.keys(this._accumulatedIgnoredTitles[type]).length;
          this.logger.debug(`${type}: Saved ${count} accumulated ignored title(s) via progress callback`);
          this._accumulatedIgnoredTitles[type] = {}; // Clear after saving
        } catch (error) {
          this.logger.error(`Error saving accumulated ignored titles for ${type}: ${error.message}`);
        }
      }
    };

    // Register this type for progress tracking with save callback
    this.registerProgress(type, totalRemaining, saveCallback);

    try {
      // Process each batch
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        const batchStart = batchIndex * batchSize + 1;
        const batchEnd = Math.min((batchIndex + 1) * batchSize, filteredTitles.length);

        this.logger.debug(`${type}: Starting batch ${batchIndex + 1}/${batches.length} (titles ${batchStart}-${batchEnd})`);

        // Process batch titles in parallel (rate limiting happens inside fetchWithCache)
        const batchPromises = batch.map(title => 
          this._processSingleTitle(title, type)
        );

        const batchResults = await Promise.allSettled(batchPromises);

        // Accumulate results instead of saving immediately
        for (const result of batchResults) {
          if (result.status === 'fulfilled' && result.value) {
            const processedTitle = this._buildProcessedTitleData(result.value, type);
            processedTitles.push(processedTitle);
            totalProcessed++;
          } else if (result.status === 'rejected') {
            this.logger.warn(`${type}: Failed to process title: ${result.reason?.message || result.reason}`);
          }
        }

        totalRemaining = filteredTitles.length - totalProcessed;
        
        // Update progress tracking (triggers save callback every 30 seconds if configured)
        this.updateProgress(type, totalRemaining);

        // Log progress every batch
        this.logger.info(`${type}: Completed batch ${batchIndex + 1}/${batches.length} - ${totalProcessed} title(s) processed, ${totalRemaining} remaining`);
      }
    } finally {
      // Save any remaining accumulated titles before unregistering
      await saveCallback();
      
      // Unregister this type from progress tracking (will also call save callback)
      this.unregisterProgress(type);
    }

    this.logger.info(`${type}: Completed processing - ${totalProcessed} title(s) processed and saved`);
    
    return totalProcessed;
  }

  /**
   * Fetch titles metadata from provider (provider-specific)
   * @abstract
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Promise<Array>} Array of raw title objects
   */
  async _fetchTitlesMetadata(type) {
    throw new Error('_fetchTitlesMetadata(type) must be implemented by subclass');
  }

  /**
   * Filter titles based on provider-specific rules (provider-specific)
   * @abstract
   * @param {Array} titles - Array of raw title objects
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Promise<Array>} Array of filtered title objects
   */
  async _filterTitles(titles, type) {
    throw new Error('_filterTitles(titles, type) must be implemented by subclass');
  }

  /**
   * Process a single title (provider-specific)
   * @abstract
   * @param {Object} title - Raw title object
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Promise<Object|null>} Processed title object or null if should be skipped
   */
  async _processSingleTitle(title, type) {
    throw new Error('_processSingleTitle(title, type) must be implemented by subclass');
  }

  /**
   * Build processed title data object (provider-specific)
   * @abstract
   * @param {Object} title - Title object after processing
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Object} Clean title data object
   */
  _buildProcessedTitleData(title, type) {
    throw new Error('_buildProcessedTitleData(title, type) must be implemented by subclass');
  }

  /**
   * Apply cleanup rules to title names
   * @param {string} title - Title to clean up
   * @returns {string} Cleaned title
   */
  cleanupTitle(title) {
    if (!this.providerData.cleanup || typeof title !== 'string') {
      return title;
    }

    let cleaned = title;
    for (const [pattern, replacement] of Object.entries(this.providerData.cleanup)) {
      try {
        const regex = new RegExp(pattern, 'g');
        cleaned = cleaned.replace(regex, replacement);
      } catch (error) {
        this.logger.warn(`Invalid cleanup pattern: ${pattern}`, error.message);
      }
    }

    return cleaned.trim();
  }

  /**
   * Save categories for a provider by type to MongoDB
   * Merges with existing categories, preserving enabled status
   * @param {string} type - Category type ('movies' or 'tvshows')
   * @param {Array<{category_id: number|string, category_name: string}>} categories - Array of category data objects
   * @returns {Promise<Object>} Saved category data object
   */
  async saveCategories(type, categories) {
    if (!categories || categories.length === 0) {
      return { saved: 0, inserted: 0, updated: 0 };
    }

    this.logger.debug(`Saving ${categories.length} categories for ${type} to MongoDB`);

    // Load existing categories to preserve enabled status
    const existingCategories = await this.mongoData.getProviderCategories(this.providerId, type);
    const existingCategoryMap = new Map();
    existingCategories.forEach(cat => {
      const categoryKey = cat.category_key || generateCategoryKey(cat.type, cat.category_id);
      existingCategoryMap.set(categoryKey, cat);
    });

    // Prepare categories with type and category_key
    const processedCategories = categories.map(cat => {
      if (!cat.category_id) return null;

      // Ensure type and category_key are set
      const categoryType = cat.type || type;
      const categoryKey = cat.category_key || generateCategoryKey(categoryType, cat.category_id);

      const existingCategory = existingCategoryMap.get(categoryKey);

      return {
        category_id: cat.category_id || cat.id,
        category_name: cat.category_name || cat.name,
        type: categoryType,
        category_key: categoryKey,
        enabled: existingCategory ? existingCategory.enabled : false, // Preserve enabled status or default to false
      };
    }).filter(Boolean);

    if (processedCategories.length === 0) {
      return { saved: 0, inserted: 0, updated: 0 };
    }

    try {
      // Save to MongoDB using bulk operations
      const result = await this.mongoData.saveProviderCategories(this.providerId, processedCategories);
      
      const totalSaved = result.inserted + result.updated;
      this.logger.info(`Saved ${totalSaved} categories for ${type} to MongoDB (${result.inserted} inserted, ${result.updated} updated)`);
      
      // Refresh API cache
      await this.refreshAPICache(`${this.providerId}.categories`);
      
      return { saved: totalSaved, inserted: result.inserted, updated: result.updated };
    } catch (error) {
      this.logger.error(`Error saving categories for ${type} to MongoDB: ${error.message}`);
      throw error;
    }
  }

  /**
   * Load categories for a provider by type from MongoDB
   * @param {string} type - Category type ('movies' or 'tvshows')
   * @returns {Promise<Array<{category_id: number, category_name: string, enabled: boolean, type: string, category_key: string}>>} Array of category data objects
   */
  async loadCategories(type) {
    try {
      const categories = await this.mongoData.getProviderCategories(this.providerId, type);
      return categories;
    } catch (error) {
      this.logger.error(`Error loading categories from MongoDB: ${error.message}`);
      return [];
    }
  }

  /**
   * Get category enabled status by ID and type
   * @param {string} type - Category type ('movies' or 'tvshows')
   * @param {number} categoryId - Category ID
   * @returns {Promise<boolean>} True if category is enabled, false otherwise (defaults to false if not found)
   */
  async isCategoryEnabled(type, categoryId) {
    const categories = await this.loadCategories(type);
    const category = categories.find(cat => cat.category_id === categoryId);
    return category ? category.enabled : false;
  }

  /**
   * Load provider titles from MongoDB (incremental)
   * Should be called once at the start of job execution
   * @param {Date} [since=null] - Only load titles updated since this date
   * @returns {Promise<TitleData[]>} Array of all title data objects
   */
  async loadProviderTitles(since = null) {
    try {
      const titles = await this.mongoData.getProviderTitles(this.providerId, {
        since: since,
        ignored: false // Only non-ignored titles
      });
      
      this._titlesCache = titles;
      return titles;
    } catch (error) {
      this.logger.error(`Error loading provider titles from MongoDB: ${error.message}`);
      this._titlesCache = [];
      return [];
    }
  }

  /**
   * Get all titles from memory cache
   * If cache is not loaded, loads from MongoDB first
   * @returns {TitleData[]} Array of all title data objects
   */
  getAllTitles() {
    if (this._titlesCache === null) {
      // Synchronous fallback - should not happen if loadProviderTitles is called first
      this.logger.warn('Titles cache not loaded. Call loadProviderTitles() first.');
      this._titlesCache = [];
      return [];
    }
    return this._titlesCache;
  }

  /**
   * Load titles metadata for a specific type
   * Loads from consolidated file: data/titles/{providerId}.titles.json
   * Filters titles by type property
   * Can use cache if available for better performance
   * @param {string} type - Title type ('movies' or 'tvshows')
   * @returns {TitleData[]} Array of title data objects filtered by type
   */
  loadTitles(type) {
    // Use cache if available, otherwise load from disk
    const allTitles = this.getAllTitles();
    // Filter titles by type property
    return allTitles.filter(t => t.type === type);
  }

  /**
   * Update titles in memory cache
   * Merges new titles with existing cache (updates existing, adds new)
   * @private
   * @param {TitleData[]} titles - Array of title data objects to merge into cache
   */
  updateTitlesInMemory(titles) {
    if (this._titlesCache === null) {
      // If cache not initialized, initialize it
      this._titlesCache = [];
    }

    // Create map of existing titles by title_key for fast lookup
    const existingTitleMap = new Map(
      this._titlesCache.map(t => [t.title_key || generateTitleKey(t.type, t.title_id), t])
    );

    // Update existing titles and add new ones
    for (const title of titles) {
      if (!title.title_id) continue;
      
      const titleKey = title.title_key || generateTitleKey(title.type || 'movies', title.title_id);
      const existingIndex = this._titlesCache.findIndex(t => {
        const tKey = t.title_key || generateTitleKey(t.type, t.title_id);
        return tKey === titleKey;
      });

      if (existingIndex >= 0) {
        // Update existing title
        this._titlesCache[existingIndex] = title;
      } else {
        // Add new title
        this._titlesCache.push(title);
      }
    }
  }

  /**
   * Update ignored titles in memory cache
   * Replaces the entire ignored cache with new data
   * @private
   * @param {Object<string, string>} ignored - Object mapping title_key to reason for ignoring
   */
  updateIgnoredInMemory(ignored) {
    this._ignoredCache = { ...ignored };
  }

  /**
   * Save titles metadata to MongoDB
   * Called periodically (every 30 seconds) or at end of process
   * Adds type and title_key properties to each title
   * @param {string} [type] - Optional title type ('movies' or 'tvshows') - if not provided, extracted from each title
   * @param {TitleData[]} titles - Array of title data objects to save
   * @returns {Promise<{saved: number, inserted: number, updated: number}>} Number of titles saved
   */
  async saveTitles(type, titles) {
    if (!titles || titles.length === 0) {
      return { saved: 0, inserted: 0, updated: 0 };
    }

    this.logger.debug(`Saving ${titles.length} titles to MongoDB`);

    const now = new Date().toISOString();
    
    // Ensure type and title_key are set for each title
    const processedTitles = titles.map(title => {
      if (!title.title_id) return null;

      // Ensure type and title_key are set - extract type from title or use provided type
      const titleType = title.type || type;
      if (!titleType) {
        this.logger.warn(`Title ${title.title_id} has no type, skipping`);
        return null;
      }
      const titleKey = title.title_key || generateTitleKey(titleType, title.title_id);
      
      return {
        ...title,
        type: titleType,
        title_key: titleKey,
        lastUpdated: now
      };
    }).filter(Boolean);

    if (processedTitles.length === 0) {
      return { saved: 0, inserted: 0, updated: 0 };
    }

    try {
      // Save to MongoDB using bulk operations
      const result = await this.mongoData.saveProviderTitles(this.providerId, processedTitles);
      
      // Update in-memory cache - merge with existing cache
      if (this._titlesCache === null) {
        this._titlesCache = [];
      }
      
      // Update cache with saved titles
      const titleKeyMap = new Map(this._titlesCache.map(t => [t.title_key, t]));
      for (const title of processedTitles) {
        titleKeyMap.set(title.title_key, title);
      }
      this._titlesCache = Array.from(titleKeyMap.values());
      
      const totalSaved = result.inserted + result.updated;
      this.logger.info(`Saved ${totalSaved} titles to MongoDB (${result.inserted} inserted, ${result.updated} updated)`);
      
      // Refresh API cache
      await this.refreshAPICache(`${this.providerId}.titles`);
      
      return { saved: totalSaved, inserted: result.inserted, updated: result.updated };
    } catch (error) {
      this.logger.error(`Error saving titles to MongoDB: ${error.message}`);
      throw error;
    }    
  }

  /**
   * Get all ignored titles from memory cache
   * If cache is not loaded, returns empty object (should call loadProviderTitles or _loadIgnoredFromMongoDB first)
   * @returns {Object<string, string>} Object mapping title_key to reason for ignoring
   */
  getAllIgnored() {
    if (this._ignoredCache === null) {
      // Cache not loaded - return empty object
      // Should be loaded via loadProviderTitles or explicitly via _loadIgnoredFromMongoDB
      this._ignoredCache = {};
      return {};
    }
    return this._ignoredCache;
  }

  /**
   * Load ignored titles from MongoDB (async)
   * Should be called to initialize ignored cache
   * @returns {Promise<Object<string, string>>} Object mapping title_key to reason for ignoring
   */
  async loadIgnoredTitlesFromMongoDB() {
    await this._loadIgnoredFromMongoDB();
    return this._ignoredCache;
  }

  /**
   * Load ignored titles from MongoDB
   * @private
   * @returns {Promise<void>}
   */
  async _loadIgnoredFromMongoDB() {
    try {
      const ignoredTitles = await this.mongoData.getProviderTitles(this.providerId, {
        ignored: true
      });
      
      // Convert to object format: { title_key: ignored_reason }
      const ignoredMap = {};
      for (const title of ignoredTitles) {
        if (title.title_key && title.ignored_reason) {
          ignoredMap[title.title_key] = title.ignored_reason;
        }
      }
      
      this._ignoredCache = ignoredMap;
    } catch (error) {
      this.logger.error(`Error loading ignored titles from MongoDB: ${error.message}`);
      this._ignoredCache = {};
    }
  }

  /**
   * Load ignored titles from consolidated JSON file
   * Loads from: data/titles/{providerId}.ignored.json
   * Filters by type and returns title_id mappings for backward compatibility
   * Can use cache if available for better performance
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Object<string, string>} Object mapping title_id to reason for ignoring
   */
  loadIgnoredTitles(type) {
    // Use cache if available, otherwise load from disk
    const allIgnored = this.getAllIgnored();
    
    // Filter by type and convert title_key back to title_id for backward compatibility
    const filtered = {};
    for (const [titleKey, reason] of Object.entries(allIgnored)) {
      if (titleKey.startsWith(`${type}-`)) {
        const titleId = titleKey.substring(type.length + 1); // Remove "movies-" or "tvshows-" prefix
        filtered[titleId] = reason;
      }
    }
    return filtered;
  }

  /**
   * Save all ignored titles to MongoDB
   * Updates provider_titles collection to set ignored: true for specified titles
   * Groups titles by reason and uses updateMany for bulk operations
   * @param {Object<string, string>} allIgnored - Object mapping title_key to reason for ignoring
   */
  async saveAllIgnoredTitles(allIgnored) {
    try {
      const collection = this.mongoData.db.collection('provider_titles');
      const now = new Date();
      
      // Group titles by reason for bulk updates
      const titlesByReason = {};
      for (const [titleKey, reason] of Object.entries(allIgnored)) {
        if (!titlesByReason[reason]) {
          titlesByReason[reason] = [];
        }
        titlesByReason[reason].push(titleKey);
      }
      
      // Build bulk operations: one updateMany per reason group
      const operations = [];
      for (const [reason, titleKeys] of Object.entries(titlesByReason)) {
        // Process in batches if a single reason has too many titles (MongoDB $in limit)
        const batchSize = 1000; // MongoDB $in operator limit is much higher, but 1000 is safe
        for (let i = 0; i < titleKeys.length; i += batchSize) {
          const titleKeysBatch = titleKeys.slice(i, i + batchSize);
          operations.push({
            updateMany: {
              filter: {
                provider_id: this.providerId,
                title_key: { $in: titleKeysBatch }
              },
              update: {
                $set: {
                  ignored: true,
                  ignored_reason: reason,
                  lastUpdated: now
                }
              }
            }
          });
        }
      }

      if (operations.length > 0) {
        // Process all operations in batches of 1000
        for (let i = 0; i < operations.length; i += 1000) {
          const batch = operations.slice(i, i + 1000);
          await collection.bulkWrite(batch, { ordered: false });
        }
      }
      
      // Update in-memory cache to keep it in sync
      this._ignoredCache = { ...allIgnored };
      const count = Object.keys(allIgnored).length;
      const reasonGroups = Object.keys(titlesByReason).length;
      this.logger.info(`Saved ${count} ignored titles to MongoDB (${reasonGroups} reason groups)`);
      
      // Refresh API cache
      await this.refreshAPICache(`${this.providerId}.ignored`);
    } catch (error) {
      this.logger.error(`Error saving ignored titles to MongoDB: ${error.message}`);
      throw error;
    }
  }

  /**
   * Add a title to the ignored list with a reason
   * Accumulates in memory for batch saving (saved every 30 seconds or at end of process)
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @param {string} titleId - Title ID to ignore
   * @param {string} reason - Reason for ignoring (e.g., "Extended info fetch failed", "TMDB matching failed")
   */
  addIgnoredTitle(type, titleId, reason) {
    // Accumulate in memory instead of saving immediately
    if (!this._accumulatedIgnoredTitles[type]) {
      this._accumulatedIgnoredTitles[type] = {};
    }
    this._accumulatedIgnoredTitles[type][titleId] = reason;
    
    // Also update in-memory ignored cache for immediate checking during processing
    const titleKey = generateTitleKey(type, titleId);
    if (this._ignoredCache === null) {
      this._ignoredCache = {};
    }
    this._ignoredCache[titleKey] = reason;
  }

  /**
   * Unload titles from memory cache
   * Clears in-memory caches to free memory after job execution
   * Safe to call multiple times (idempotent)
   */
  unloadTitles() {
    this._titlesCache = null;
    this._ignoredCache = null;
    this.logger.debug('Unloaded titles from memory cache');
  }
}

