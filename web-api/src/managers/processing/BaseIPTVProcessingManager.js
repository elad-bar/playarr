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

import { BaseProcessingManager } from './BaseProcessingManager.js';
import { formatNumber } from '../../utils/numberFormat.js';
import { generateTitleKey, generateCategoryKey } from '../../utils/titleUtils.js';

/**
 * Base class for all IPTV processing managers (AGTV, Xtream)
 * Extends BaseProcessingManager with IPTV-specific functionality
 * @abstract
 */
export class BaseIPTVProcessingManager extends BaseProcessingManager { 
  /**
   * @param {Object} providerData - Provider configuration data
   * @param {import('../domain/ProviderTitlesManager.js').ProviderTitlesManager} providerTitlesManager - Provider titles manager (for saving and reading titles)
   * @param {import('../orchestration/ProvidersManager.js').ProvidersManager} providersManager - Providers manager for direct API calls
   * @param {import('../domain/TMDBManager.js').TMDBManager} tmdbManager - TMDB manager for matching TMDB IDs (required)
   * @param {import('./TMDBProcessingManager.js').TMDBProcessingManager} tmdbProcessingManager - TMDB processing manager instance (required)
   * @param {number} [metadataBatchSize=100] - Batch size for processing metadata (default: 100)
   */
  constructor(providerData, providerTitlesManager, providersManager, tmdbManager, tmdbProcessingManager, metadataBatchSize = 100) {
    // Generate loggerContext from providerData if not explicitly provided
    const loggerContext = `${providerData.type?.toUpperCase() || 'PROCESSING'}::${providerData.id || 'default'}`;
    super(providerData, loggerContext);
    
    if (!providerTitlesManager) {
      throw new Error('ProviderTitlesManager is required');
    }
    this.providerTitlesManager = providerTitlesManager;
    
    if (!providersManager) {
      throw new Error('ProvidersManager is required for BaseIPTVProcessingManager');
    }
    this.providersManager = providersManager;
    
    // TMDB manager for matching TMDB IDs (required)
    if (!tmdbManager) {
      throw new Error('TMDBManager is required for BaseIPTVProcessingManager');
    }
    this.tmdbManager = tmdbManager;
    
    // TMDB handler for matching TMDB IDs (required)
    if (!tmdbProcessingManager) {
      throw new Error('TMDBProcessingManager is required for BaseIPTVProcessingManager');
    }
    this.tmdbProcessingManager = tmdbProcessingManager;
    
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
    
    /**
     * Whether this provider supports categories
     * @type {boolean}
     */
    this.supportsCategories = false;
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
   */
  async fetchMetadata(type) {
    this.logger.info(`${type}: Starting fetchMetadata`);

    // Load ALL provider titles from MongoDB for comparison with provider data
    this.logger.debug(`${type}: Loading all provider titles from MongoDB for comparison`);
    await this.loadProviderTitles(null, true); // null = load all titles, true = include ignored

    // Step 1: Fetch titles metadata (provider-specific)
    const titles = await this._fetchTitlesMetadata(type);

    // Step 2: Filter titles (provider-specific)
    const filteredTitles = await this._filterTitles(titles, type);

    this.logger.debug(`${type}: Filtered ${formatNumber(filteredTitles.length)} titles to process`);

    // Step 3: Process in batches for memory efficiency
    // Batch size controls memory usage (max concurrent promises), not save frequency
    const batchSize = this.metadataBatchSize;
    const batches = [];
    for (let i = 0; i < filteredTitles.length; i += batchSize) {
      batches.push(filteredTitles.slice(i, i + batchSize));
    }

    this.logger.info(`${type}: Processing ${formatNumber(batches.length)} batch(es) of up to ${formatNumber(batchSize)} titles each`);

    let totalProcessed = 0;
    let totalRemaining = filteredTitles.length;
    
    // Accumulate processed titles for periodic saving (not batch-based)
    const processedTitles = [];
    
    // Save callback for progress tracking (called every 30 seconds and on completion)
    const saveCallback = async () => {
      if (processedTitles.length > 0) {
        try {
          await this.saveTitles(type, processedTitles);
          this.logger.debug(`${type}: Saved ${formatNumber(processedTitles.length)} accumulated title(s) via progress callback`);
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
          this.logger.debug(`${type}: Saved ${formatNumber(count)} accumulated ignored title(s) via progress callback`);
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

        this.logger.debug(`${type}: Starting batch ${formatNumber(batchIndex + 1)}/${formatNumber(batches.length)} (titles ${formatNumber(batchStart)}-${formatNumber(batchEnd)})`);

        // Process batch titles in parallel (rate limiting happens in provider-specific methods via limiter.schedule())
        const batchPromises = batch.map(title => 
          this._processSingleTitle(title, type, processedTitles)
        );

        const batchResults = await Promise.allSettled(batchPromises);

        // Count successes - titles already pushed to processedTitles by _processSingleTitle
        for (const result of batchResults) {
          if (result.status === 'fulfilled' && result.value === true) {
            totalProcessed++;
          } else if (result.status === 'rejected') {
            this.logger.warn(`${type}: Failed to process title: ${result.reason?.message || result.reason}`);
          }
        }

        totalRemaining = filteredTitles.length - totalProcessed;
        
        // Update progress tracking (triggers save callback every 30 seconds if configured)
        this.updateProgress(type, totalRemaining);

        // Log progress every batch
        this.logger.info(`${type}: Completed batch ${formatNumber(batchIndex + 1)}/${formatNumber(batches.length)} - ${formatNumber(totalProcessed)} title(s) processed, ${formatNumber(totalRemaining)} remaining`);
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
   * Filter titles based on existing titles, ignored status, and category enabled status
   * Generic implementation that handles common filtering logic
   * @param {Array} titles - Array of raw title objects
   * @param {string} type - Media type ('movies', 'tvshows', or 'live')
   * @returns {Promise<Array>} Array of filtered title objects
   */
  async _filterTitles(titles, type) {
    // Access _typeConfig from subclass (assumes it exists)
    const config = this._typeConfig?.[type];
    if (!config) {
      throw new Error(`Unsupported type: ${type}`);
    }

    this.logger.debug(`${type}: Filtering titles`);

    // Load existing titles and create lookup Map
    const existingTitles = this.loadTitles(type);
    const existingTitlesMap = new Map(existingTitles.map(t => [t.title_id, t]));

    // Filter titles using generic checks and provider-specific shouldSkip
    const filteredTitles = titles.filter(title => {
      const titleId = title[config.idField];
      
      if (!titleId) {
        return false;
      }
      
      // Get existing title if it exists (O(1) lookup)
      const existingTitle = existingTitlesMap.get(titleId);
      
      // Skip if exists and is ignored (generic check)
      if (existingTitle && existingTitle.ignored === true) {
        return false;
      }
      
      // Skip if category is disabled or missing (generic check - only if provider supports categories)
      if (this.supportsCategories) {        
        // Skip if title has no category_id when categories are supported
        if (!title.category_id) {
          return false;
        }

        const title_type_enabled_categories = this.providerData.enabled_categories[type];

        const category_key = generateCategoryKey(type, title.category_id);
        
        const is_category_enabled = title_type_enabled_categories.includes(category_key);
        
        // Skip if category is disabled
        if (!is_category_enabled) {
          return false;
        }
      }
      
      // Call provider-specific shouldSkip (no category check here)
      return !config.shouldSkip(title, existingTitle);
    });

    this.logger.debug(`${type}: Filtered to ${formatNumber(filteredTitles.length)} titles to process`);

    return filteredTitles;
  }

  /**
   * Check if a movie title should be skipped (base implementation)
   * Can be overridden by subclasses for provider-specific logic
   * @private
   * @param {TitleData} title - Title data to check
   * @param {Object|null} existingTitle - Existing title object from DB (null if doesn't exist)
   * @returns {boolean} True if title should be skipped
   */
  _shouldSkipMovies(title, existingTitle) {
    const shouldSkip = existingTitle != null;

    return shouldSkip;
  }

  /**
   * Check if a TV show title should be skipped (base implementation)
   * Can be overridden by subclasses for provider-specific logic
   * @private
   * @param {TitleData} title - Title data to check
   * @param {Object|null} existingTitle - Existing title object from DB (null if doesn't exist)
   * @returns {boolean} True if title should be skipped
   */
  _shouldSkipTVShows(title, existingTitle) {
    // If title doesn't exist, process it
    if (!existingTitle) {
      return false;
    }
    // Base implementation: don't skip if exists (subclasses can override for modification checks, etc.)
    return false;
  }

  /**
   * Match TMDB ID for a title if needed and update title data
   * @private
   * @param {Object} titleData - Title data object
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @param {string} titleId - Title ID
   * @returns {Promise<boolean>} true if title should be processed, false if should be skipped/ignored
   */
  async _matchAndUpdateTMDBId(titleData, type, titleId) {
    // Check if title is already ignored
    const titleKey = generateTitleKey(type, titleId);
    const ignoredTitles = this.getAllIgnored();
    if (ignoredTitles[titleKey]) {
      this.logger.debug(`${type}: Title ${titleId} is already ignored, skipping`);
      return false;
    }

    // Match TMDB ID if needed - use tmdbManager directly
    if (!titleData.tmdb_id) {
      try {
        // Create a temporary handler-like object for matchTMDBIdForTitle
        // The tmdbManager needs to be called via a handler that has matchTMDBIdForTitle method
        // For now, we'll need to pass the handler instance to tmdbManager or create a wrapper
        // This will be handled in TMDBProcessingManager
        const tmdbId = await this.tmdbProcessingManager.matchTMDBIdForTitle(titleData, type, this.getProviderType());
        
        if (tmdbId) {
          titleData.tmdb_id = tmdbId;
          titleData.lastUpdated = new Date().toISOString();
        } else {
          // Matching failed, mark as ignored but still save to database
          const reason = 'TMDB matching failed';
          titleData.ignored = true;
          titleData.ignored_reason = reason;
          this.addIgnoredTitle(type, titleId, reason);
          return true; // Return true so title gets saved with ignored flag
        }
      } catch (error) {
        this.logger.warn(`TMDB matching error for ${type} ${titleId}: ${error.message}`);
        // Mark as ignored on error but still save to database
        const reason = `TMDB matching error: ${error.message}`;
        titleData.ignored = true;
        titleData.ignored_reason = reason;
        this.addIgnoredTitle(type, titleId, reason);
        return true; // Return true so title gets saved with ignored flag
      }
    } else {
      // Already has TMDB ID, just update lastUpdated
      titleData.lastUpdated = new Date().toISOString();
    }

    return true;
  }


  /**
   * Process a single title (provider-specific)
   * Fetches extended info, matches TMDB ID if needed, builds processed data, and pushes to processedTitles
   * @abstract
   * @param {Object} title - Raw title object
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @param {Array<Object>} processedTitles - Array to push processed titles to
   * @returns {Promise<boolean>} true if processed and pushed, false if skipped/ignored
   */
  async _processSingleTitle(title, type, processedTitles) {
    throw new Error('_processSingleTitle(title, type, processedTitles) must be implemented by subclass');
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
   * Get category enabled status by ID and type
   * Checks provider config's enabled_categories field
   * @param {string} type - Category type ('movies' or 'tvshows')
   * @param {number} categoryId - Category ID
   * @returns {boolean} True if category is enabled, false otherwise (defaults to false if not found)
   */
  isCategoryEnabled(type, categoryId) {
    const categoryKey = generateCategoryKey(type, categoryId);
    const enabledCategories = this.providerData.enabled_categories || { movies: [], tvshows: [] };
    const enabledCategoryKeys = enabledCategories[type] || [];
    return enabledCategoryKeys.includes(categoryKey);
  }

  /**
   * Update enabled categories in provider configuration and persist to MongoDB
   * @param {Object} enabledCategories - Object with movies and tvshows arrays of category keys
   * @param {Array<string>} enabledCategories.movies - Array of enabled movie category keys
   * @param {Array<string>} enabledCategories.tvshows - Array of enabled TV show category keys
   * @returns {Promise<void>}
   */
  async updateEnabledCategories(enabledCategories) {
    if (!enabledCategories || typeof enabledCategories !== 'object') {
      throw new Error('enabledCategories must be an object with movies and tvshows arrays');
    }

    if (!Array.isArray(enabledCategories.movies) || !Array.isArray(enabledCategories.tvshows)) {
      throw new Error('enabledCategories must have movies and tvshows arrays');
    }

    // Update provider config in memory
    this.providerData.enabled_categories = {
      movies: enabledCategories.movies || [],
      tvshows: enabledCategories.tvshows || []
    };

    // Use ProvidersManager to persist (handles cache invalidation)
    const result = await this.providersManager.updateEnabledCategories(
      this.providerId,
      enabledCategories
    );

    if (result.statusCode !== 200) {
      throw new Error(`Failed to update enabled categories: ${result.response?.error || 'Unknown error'}`);
    }

    this.logger.info(`Updated enabled categories for provider ${this.providerId}`);
  }

  /**
   * Load provider titles from MongoDB (incremental)
   * Should be called once at the start of job execution
   * @param {Date} [since=null] - Only load titles updated since this date
   * @param {boolean} [includeIgnored=false] - If true, include ignored titles in the results
   * @returns {Promise<TitleData[]>} Array of all title data objects
   */
  async loadProviderTitles(since = null, includeIgnored = false) {
    try {
      const queryOptions = {
        since: since
      };
      
      // Only filter by ignored status if includeIgnored is false
      if (!includeIgnored) {
        queryOptions.ignored = false;
      }
      
      // Build query from options
      const query = { provider_id: this.providerId };
      if (queryOptions.since) {
        query.lastUpdated = { $gt: queryOptions.since };
      }
      if (queryOptions.type) {
        query.type = queryOptions.type;
      }
      if (queryOptions.ignored !== undefined) {
        query.ignored = queryOptions.ignored;
      }
      
      const titles = await this.providerTitlesManager.findByQuery(query);
      
      this._titlesCache = titles;
      
      // Also load ignored titles into cache
      if (includeIgnored) {
        await this._loadIgnoredFromMongoDB();
      }
      
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
   * Loads from in-memory cache (populated from MongoDB)
   * Filters titles by type property
   * @param {string} type - Title type ('movies' or 'tvshows')
   * @returns {TitleData[]} Array of title data objects filtered by type
   */
  loadTitles(type) {
    const allTitles = this.getAllTitles();
    // Filter titles by type property
    return allTitles.filter(t => t.type === type);
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

    this.logger.debug(`Saving ${formatNumber(titles.length)} titles to MongoDB`);

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
      // Save to MongoDB using ProviderTitlesManager
      const result = await this.providerTitlesManager.saveProviderTitles(this.providerId, processedTitles);
      
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
      this.logger.info(`Saved ${formatNumber(totalSaved)} titles to MongoDB (${formatNumber(result.inserted)} inserted, ${formatNumber(result.updated)} updated)`);
      
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
   * Load ignored titles from MongoDB
   * @private
   * @returns {Promise<void>}
   */
  async _loadIgnoredFromMongoDB() {
    try {
      const ignoredTitles = await this.providerTitlesManager.findByQuery({
        provider_id: this.providerId,
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
   * Load ignored titles for a specific type
   * Loads from in-memory cache (populated from MongoDB)
   * Filters by type and returns title_id mappings for backward compatibility
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Object<string, string>} Object mapping title_id to reason for ignoring
   */
  loadIgnoredTitles(type) {
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
      // Early return if no ignored titles
      if (!allIgnored || typeof allIgnored !== 'object' || Object.keys(allIgnored).length === 0) {
        return;
      }

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
        if (!Array.isArray(titleKeys) || titleKeys.length === 0) {
          continue;
        }
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
          if (Array.isArray(batch) && batch.length > 0) {
            await this.providerTitlesManager.bulkWrite(batch, { ordered: false });
          }
        }
      }
      
      // Update in-memory cache to keep it in sync
      this._ignoredCache = { ...allIgnored };
      const count = Object.keys(allIgnored).length;
      const reasonGroups = Object.keys(titlesByReason).length;
      this.logger.info(`Saved ${count} ignored titles to MongoDB (${reasonGroups} reason groups)`);
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

  /**
   * Update provider configuration
   * @param {Object} providerConfig - Provider configuration data
   * @returns {Promise<void>}
   */
  async updateConfiguration(providerConfig) {
    this.providerData = providerConfig;
    this.logger.info(`Updated configuration for provider ${this.providerId}`);
  }

  /**
   * Trigger full provider title processing
   * Fetches categories and metadata for both movies and TV shows
   * @returns {Promise<void>}
   */
  async processProviderTitles() {
    this.logger.info(`Processing provider titles for ${this.providerId}`);
    
    // Fetch metadata (categories are now UI-only, fetched on-demand)
    await this.fetchMetadata('movies').catch(err => {
      this.logger.warn(`Error fetching movie metadata: ${err.message}`);
    });
    
    await this.fetchMetadata('tvshows').catch(err => {
      this.logger.warn(`Error fetching TV show metadata: ${err.message}`);
    });
    
    this.logger.info(`Completed processing provider titles for ${this.providerId}`);
  }

  /**
   * Reset lastUpdated for all provider titles
   * Ensures all titles will be picked up by ProviderTitlesMonitorJob
   * @returns {Promise<number>} Number of titles updated
   */
  async resetTitlesLastUpdated() {
    const result = await this.providerTitlesManager.updateManyByQuery(
      { provider_id: this.providerId },
      { $set: { lastUpdated: new Date() } }
    );
    return result.modifiedCount || 0;
  }
}

