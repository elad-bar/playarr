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
   */
  constructor(providerData, cache, data) {
    super(providerData, cache, data);
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
    const batchSize = 100; // Process 100 at a time to limit memory
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
   * Save categories for a provider by type
   * Merges with existing categories, preserving enabled status
   * Saves to consolidated file: data/categories/{providerId}.categories.json
   * @param {string} type - Category type ('movies' or 'tvshows')
   * @param {Array<{category_id: number|string, category_name: string}>} categories - Array of category data objects
   * @returns {Object} Saved category data object
   */
  saveCategories(type, categories) {
    this.logger.debug(`Saving ${categories.length} categories for ${type}`);

    const now = new Date().toISOString();
    const categoriesCacheKey = ['categories', `${this.providerId}.categories.json`];

    // Load existing consolidated categories file (contains all types as array)
    const existingCategories = this.data.get(...categoriesCacheKey) || [];
    const existingCategoryMap = new Map();
    existingCategories.forEach(cat => {
      const categoryKey = cat.category_key || generateCategoryKey(cat.type, cat.category_id);
      existingCategoryMap.set(categoryKey, cat);
    });

    // Merge new categories with existing ones, adding type and category_key
    const mergedCategories = categories.map(cat => {
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
        createdAt: existingCategory?.createdAt || now,
        lastUpdated: now
      };
    }).filter(Boolean);

    // Combine with existing categories that weren't updated
    const updatedCategoryKeys = new Set(mergedCategories.map(c => c.category_key));
    const unchangedCategories = existingCategories.filter(c => {
      const categoryKey = c.category_key || generateCategoryKey(c.type, c.category_id);
      return !updatedCategoryKeys.has(categoryKey);
    });

    const allCategories = [...unchangedCategories, ...mergedCategories];

    try {
      // Save as plain array (no wrapper object)
      this.data.set(allCategories, ...categoriesCacheKey);
      this.logger.info(`Saved ${mergedCategories.length} categories for ${type}`);
      return { saved: mergedCategories.length };
    } catch (error) {
      this.logger.error(`Error saving categories for ${type}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Load categories for a provider by type
   * Loads from consolidated file: data/categories/{providerId}.categories.json
   * @param {string} type - Category type ('movies' or 'tvshows')
   * @returns {Array<{category_id: number, category_name: string, enabled: boolean, type: string, category_key: string}>} Array of category data objects
   */
  loadCategories(type) {
    const categoryData = this.data.get('categories', `${this.providerId}.categories.json`);
    if (Array.isArray(categoryData)) {
      // Filter by type
      return categoryData.filter(cat => {
        const catType = cat.type || (cat.category_key && cat.category_key.startsWith('movies-') ? 'movies' : 'tvshows');
        return catType === type;
      });
    }
    
    return [];
  }

  /**
   * Get category enabled status by ID and type
   * @param {string} type - Category type ('movies' or 'tvshows')
   * @param {number} categoryId - Category ID
   * @returns {boolean} True if category is enabled, false otherwise (defaults to false if not found)
   */
  isCategoryEnabled(type, categoryId) {
    const categories = this.loadCategories(type);
    const category = categories.find(cat => cat.category_id === categoryId);
    return category ? category.enabled : false;
  }

  /**
   * Load titles metadata for a specific type
   * Loads from consolidated file: data/titles/{providerId}.titles.json
   * Filters titles by type property
   * @param {string} type - Title type ('movies' or 'tvshows')
   * @returns {TitleData[]} Array of title data objects filtered by type
   */
  loadTitles(type) {
    try {
      const allTitles = this.data.get('titles', `${this.providerId}.titles.json`);
      if (!Array.isArray(allTitles)) {
        return [];
      }
      // Filter titles by type property
      return allTitles.filter(t => t.type === type);
    } catch (error) {
      this.logger.debug(`No titles file found for ${type}: ${error.message}`);
      return [];
    }
  }

  /**
   * Save titles metadata to a consolidated file per provider
   * Saves all titles to: data/titles/{providerId}.titles.json
   * Adds type and title_key properties to each title
   * @param {string} type - Title type ('movies' or 'tvshows')
   * @param {TitleData[]} titles - Array of title data objects to save
   * @returns {Promise<{saved: number}>} Number of titles saved
   */
  async saveTitles(type, titles) {
    this.logger.debug(`Saving ${titles.length} titles for ${type}`);

    const now = new Date().toISOString();
    const titlesCacheKey = ['titles', `${this.providerId}.titles.json`];
    
    // Load existing consolidated titles file (contains all types)
    const existingTitles = this.data.get(...titlesCacheKey) || [];
    const existingTitleMap = new Map(existingTitles.map(t => [t.title_key || generateTitleKey(t.type, t.title_id), t]));

    // Merge new titles with existing ones, adding type and title_key
    const mergedTitles = titles.map(title => {
      if (!title.title_id) return null;

      // Ensure type and title_key are set
      const titleType = title.type || type;
      const titleKey = title.title_key || generateTitleKey(titleType, title.title_id);
      
      const existingTitle = existingTitleMap.get(titleKey);
      
      return {
        ...title,
        type: titleType,
        title_key: titleKey,
        createdAt: existingTitle?.createdAt || now,
        lastUpdated: now
      };
    }).filter(Boolean);

    // Combine with existing titles that weren't updated
    const updatedTitleKeys = new Set(mergedTitles.map(t => t.title_key));
    const unchangedTitles = existingTitles.filter(t => {
      const titleKey = t.title_key || generateTitleKey(t.type, t.title_id);
      return !updatedTitleKeys.has(titleKey);
    });

    const allTitles = [...unchangedTitles, ...mergedTitles];

    try {
      this.data.set(allTitles, ...titlesCacheKey);
      this.logger.info(`Saved ${mergedTitles.length} titles for ${type}`);
      return { saved: mergedTitles.length };
    } catch (error) {
      this.logger.error(`Error saving titles for ${type}: ${error.message}`);
      throw error;
    }    
  }

  /**
   * Load ignored titles from consolidated JSON file
   * Loads from: data/titles/{providerId}.ignored.json
   * Filters by type and returns title_id mappings for backward compatibility
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Object<string, string>} Object mapping title_id to reason for ignoring
   */
  loadIgnoredTitles(type) {
    try {
      const allIgnored = this.data.get('titles', `${this.providerId}.ignored.json`) || {};
      if (!allIgnored || typeof allIgnored !== 'object' || Array.isArray(allIgnored)) {
        return {};
      }
      
      // Filter by type and convert title_key back to title_id for backward compatibility
      const filtered = {};
      for (const [titleKey, reason] of Object.entries(allIgnored)) {
        if (titleKey.startsWith(`${type}-`)) {
          const titleId = titleKey.substring(type.length + 1); // Remove "movies-" or "tvshows-" prefix
          filtered[titleId] = reason;
        }
      }
      return filtered;
    } catch (error) {
      return {};
    }
  }

  /**
   * Save ignored titles to consolidated JSON file
   * Saves to: data/titles/{providerId}.ignored.json
   * Converts title_id keys to title_key format
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @param {Object<string, string>} ignoredTitles - Object mapping title_id to reason for ignoring
   */
  saveIgnoredTitles(type, ignoredTitles) {
    try {
      // Load existing consolidated ignored titles
      const allIgnored = this.data.get('titles', `${this.providerId}.ignored.json`) || {};
      const existingIgnored = typeof allIgnored === 'object' && !Array.isArray(allIgnored) ? allIgnored : {};
      
      // Remove old entries for this type
      const filteredIgnored = {};
      for (const [titleKey, reason] of Object.entries(existingIgnored)) {
        if (!titleKey.startsWith(`${type}-`)) {
          filteredIgnored[titleKey] = reason;
        }
      }
      
      // Add new entries with title_key format
      for (const [titleId, reason] of Object.entries(ignoredTitles)) {
        const titleKey = generateTitleKey(type, titleId);
        filteredIgnored[titleKey] = reason;
      }
      
      this.data.set(filteredIgnored, 'titles', `${this.providerId}.ignored.json`);
      const count = Object.keys(ignoredTitles).length;
      this.logger.info(`Saved ${count} ignored ${type} titles`);
    } catch (error) {
      this.logger.error(`Error saving ignored titles for ${type}: ${error.message}`);
    }
  }

  /**
   * Add a title to the ignored list with a reason
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @param {string} titleId - Title ID to ignore
   * @param {string} reason - Reason for ignoring (e.g., "Extended info fetch failed", "TMDB matching failed")
   */
  addIgnoredTitle(type, titleId, reason) {
    const ignoredTitles = this.loadIgnoredTitles(type);
    ignoredTitles[titleId] = reason;
    this.saveIgnoredTitles(type, ignoredTitles);
  }
}

