import { BaseProcessingManager } from './BaseProcessingManager.js';
import { formatNumber } from '../../utils/numberFormat.js';
import { extractYearFromTitle, extractBaseTitle, extractYearFromReleaseDate, generateTitleKey } from '../../utils/titleUtils.js';

/**
 * TMDB API handler
 * Provides TMDB API integration for metadata enrichment
 * Rate limiting and caching are handled by TMDBProvider
 */
export class TMDBProcessingManager extends BaseProcessingManager {
  /**
   * Constructor
   * @param {Object} providerData - Provider configuration data
   * @param {import('../domain/TitlesManager.js').TitlesManager} titlesManager - Titles manager (for saving and reading titles)
   * @param {import('../domain/TMDBManager.js').TMDBManager} tmdbManager - TMDB manager for API calls
   * @param {import('../domain/ProviderTitlesManager.js').ProviderTitlesManager} providerTitlesManager - Provider titles manager (for fetching all provider titles)
   */
  constructor(providerData, titlesManager, tmdbManager, providerTitlesManager) {
    super(providerData, 'TMDB');
    if (!titlesManager) {
      throw new Error('TitlesManager is required');
    }
    if (!tmdbManager) {
      throw new Error('TMDBManager is required');
    }
    if (!providerTitlesManager) {
      throw new Error('ProviderTitlesManager is required');
    }
    this.titlesManager = titlesManager;
    this.tmdbManager = tmdbManager;
    this.providerTitlesManager = providerTitlesManager;
    
    // In-memory cache for main titles
    // Loaded once at the start of job execution and kept in memory
    this._mainTitlesCache = null;
    
    /**
     * Configuration for each media type
     * @private
     * @type {Object<string, Object>}
     */
    this._typeConfig = {
      movies: {
        tvgType: 'movie',
        tmdbType: 'movie'
      },
      tvshows: {
        tvgType: 'series',
        tmdbType: 'tv'
      }
    };
  }

  /**
   * Get the provider type identifier
   * @returns {string} 'tmdb'
   */
  getProviderType() {
    return 'tmdb';
  }

  /**
   * Get title and release date fields from TMDB API data based on type
   * @private
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @param {Object} apiData - TMDB API response data
   * @returns {{title: string, release_date: string}} Object with title and release_date
   */
  _getTitleField(type, apiData) {
    const typeFieldMap = {
      movies: {
        title: apiData.title,
        release_date: apiData.release_date
      },
      tvshows: {
        title: apiData.name,
        release_date: apiData.first_air_date
      }
    };
    
    return typeFieldMap[type] || { title: '', release_date: '' };
  }

  /**
   * Get counter key for type-based counting
   * @private
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {string} Counter key ('movies' or 'tvShows')
   */
  _getTypeCounterKey(type) {
    const counterKeyMap = {
      movies: 'movies',
      tvshows: 'tvShows'
    };
    
    return counterKeyMap[type] || 'movies';
  }

  /**
   * Search for a movie or TV show by title
   * @param {string} type - Media type: 'movie' or 'tv'
   * @param {string} title - Title to search for
   * @param {number} [year] - Optional release year (for movies) or first air date year (for TV shows)
   * @returns {Promise<Object>} TMDB search results
   */
  async search(type, title, year = null) {
    this.logger.debug(`Searching TMDB: ${type}/${title}${year ? `/${year}` : ''}`);
    return await this.tmdbManager.search(type, title, year);
  }

  /**
   * Find TMDB ID by IMDB ID (returns both movies and TV shows)
   * Note: TMDB find endpoint returns both movie_results and tv_results
   * @param {string} imdbId - IMDB ID (e.g., 'tt0133093')
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Promise<Object>} TMDB find results with movie_results and tv_results arrays
   */
  async findByIMDBId(imdbId, type) {
    this.logger.debug(`Finding TMDB by IMDB ID: ${imdbId}/${type}`);
    return await this.tmdbManager.findByIMDBId(imdbId, type);
  }

  
  /**
   * Get details by TMDB ID (movies or TV shows)
   * @param {string} type - Media type: 'movie' or 'tv'
   * @param {number} tmdbId - TMDB ID
   * @returns {Promise<Object>} Media details
   */
  async getDetails(type, tmdbId) {
    this.logger.debug(`Getting TMDB details: ${type}/${tmdbId}`);
    return await this.tmdbManager.getDetails(type, tmdbId);
  }

  /**
   * Get TV show details by TMDB ID
   * @param {number} tmdbId - TMDB TV show ID
   * @returns {Promise<Object>} TV show details
   */
  async getTVShowDetails(tmdbId) {
    return await this.getDetails('tv', tmdbId);
  }

  /**
   * Get TV show season details by TMDB ID and season number
   * @param {number} tmdbId - TMDB TV show ID
   * @param {number} seasonNumber - Season number
   * @returns {Promise<Object>} Season details
   */
  async getTVShowSeasonDetails(tmdbId, seasonNumber) {
    this.logger.debug(`Getting TMDB season details: ${tmdbId}/S${seasonNumber}`);
    return await this.tmdbManager.getSeasonDetails(tmdbId, seasonNumber);
  }

  /**
   * Get similar movies or TV shows by TMDB ID
   * @param {string} type - Media type: 'movie' or 'tv'
   * @param {number} tmdbId - TMDB ID
   * @param {number} [page=1] - Page number for pagination
   * @returns {Promise<Object>} Similar media results with pagination info
   */
  async getSimilar(type, tmdbId, page = 1) {
    this.logger.debug(`Getting TMDB similar: ${type}/${tmdbId}/${page}`);
    return await this.tmdbManager.getSimilar(type, tmdbId, page);
  }

  /**
   * Get all similar titles across multiple pages with pagination handling
   * @param {string} type - Media type: 'movie' or 'tv'
   * @param {number} tmdbId - TMDB ID
   * @param {number} [maxPages=10] - Maximum number of pages to fetch
   * @returns {Promise<Array<Object>>} Array of similar title objects (from response.results)
   */
  async getSimilarAllPages(type, tmdbId, maxPages = 10) {
    const allResults = [];
    let page = 1;
    let consecutiveFailures = 0;

    while (page <= maxPages) {
      try {
        const response = await this.getSimilar(type, tmdbId, page);
        if (!response?.results) break;

        allResults.push(...response.results);
        consecutiveFailures = 0;

        const totalPages = response.total_pages || 1;
        if (page >= totalPages || page >= maxPages) break;
        page++;
      } catch (error) {
        consecutiveFailures++;
        
        if (consecutiveFailures >= 3) {
          this.logger.warn(`Failed 3 times in a row for ${type} ID ${tmdbId}, returning ${formatNumber(allResults.length)} similar titles`);
          break;
        } else {
          this.logger.warn(`Error fetching similar titles page ${page} for ${type} ID ${tmdbId}: ${error.message}`);
        }

        page++;
      }
    }

    return allResults;
  }

  /**
   * Get similar title IDs filtered by available titles
   * Fetches similar titles from TMDB API and filters to only include titles that exist in the available set
   * Returns title_keys for the filtered similar titles
   * @param {string} tmdbType - TMDB media type: 'movie' or 'tv'
   * @param {number} tmdbId - TMDB ID
   * @param {Set<number>} availableTitleIds - Set of available TMDB IDs to filter against
   * @param {string} type - Media type ('movies' or 'tvshows') for title key generation
   * @param {number} [maxPages=10] - Maximum number of pages to fetch
   * @returns {Promise<Array<string>>} Array of title_keys for similar titles that exist in availableTitleIds
   */
  async getSimilarTitleKeys(tmdbType, tmdbId, availableTitleIds, type, maxPages = 10) {
    // Get all similar titles across pages (pagination handled internally)
    const allResults = await this.getSimilarAllPages(tmdbType, tmdbId, maxPages);

    // Filter results to only include titles that exist in main titles
    // Convert matching IDs to title_keys
    const similarTitleKeys = allResults
      .map(result => result.id)
      .filter(id => availableTitleIds.has(id))
      .map(id => generateTitleKey(type, id));

    return similarTitleKeys;
  }

  /**
   * Load all main titles from MongoDB into memory cache
   * Should be called once at the start of job execution
   * @param {Object} [query={}] - Optional MongoDB query to filter titles
   * @returns {Promise<Array<Object>>} Array of all main title objects
   */
  async loadMainTitles(query = {}) {
    try {
      const allMainTitles = await this.titlesManager.findTitlesByQuery(query);
      this._mainTitlesCache = allMainTitles;
      return allMainTitles;
    } catch (error) {
      this.logger.error(`Error loading main titles from MongoDB: ${error.message}`);
      this._mainTitlesCache = [];
      return [];
    }
  }

  /**
   * Get all main titles from memory cache
   * If cache is not loaded, returns empty array (should call loadMainTitles first)
   * @returns {Array<Object>} Array of all main title objects
   */
  getMainTitles() {
    if (this._mainTitlesCache === null) {
      this.logger.warn('Main titles cache not loaded. Call loadMainTitles() first.');
      this._mainTitlesCache = [];
      return [];
    }
    return this._mainTitlesCache;
  }

  /**
   * Get main titles by title_key array (efficient lookup)
   * @param {Array<string>} titleKeys - Array of title_key values
   * @returns {Promise<Array<Object>>} Array of main title objects
   */
  async getMainTitlesByKeys(titleKeys) {
    try {
      return await this.titlesManager.findByKeys(titleKeys, 'title_key');
    } catch (error) {
      this.logger.error(`Error loading main titles by keys from MongoDB: ${error.message}`);
      return [];
    }
  }

  /**
   * Unload main titles from memory cache
   * Clears in-memory cache to free memory after job execution
   * Safe to call multiple times (idempotent)
   */
  unloadMainTitles() {
    this._mainTitlesCache = null;
    this.logger.debug('Unloaded main titles from memory cache');
  }

  /**
   * Enrich main titles with similar titles
   * Fetches similar titles from TMDB API, filters to only include titles available in main titles,
   * and stores the filtered title_keys under the 'similar' property as an array
   * @returns {Promise<void>}
   */
  async enrichSimilarTitles() {
    this.logger.info('Starting similar titles enrichment process...');
    const batchSize = this.getRecommendedBatchSize();

    // Process all titles together
    await this._enrichSimilarTitles(batchSize);

    this.logger.info('Similar titles enrichment completed');
  }

  /**
   * Enrich similar titles for all main titles
   * @private
   * @param {number} batchSize - Batch size for processing
   * @returns {Promise<void>}
   */
  async _enrichSimilarTitles(batchSize) {
    // Get main titles from memory cache
    const allMainTitles = this.getMainTitles();
    
    if (allMainTitles.length === 0) {
      this.logger.info('No main titles found for similar titles enrichment');
      return;
    }

    // Filter to only process newly created titles (createdAt == lastUpdated)
    // Titles without similar data that aren't newly created were already processed
    // and just didn't find matches, so we skip them to avoid unnecessary API calls
    const titlesToProcess = allMainTitles.filter(title => {
      // Skip titles without createdAt or lastUpdated (legacy data)
      if (!title.createdAt || !title.lastUpdated) {
        return false;
      }
      
      // Skip titles that already have similar data (already processed)
      if (title.similar !== undefined) {
        return false;
      }
      
      // Only process if title was just created (createdAt == lastUpdated)
      return title.createdAt === title.lastUpdated;
    });

    if (titlesToProcess.length === 0) {
      this.logger.info('No titles need similar titles enrichment (no newly created titles)');
      return;
    }

    // Create a Set of available title_ids for fast lookup (for filtering similar titles)
    // Include all titles, not just one type
    const availableTitleIds = new Set(allMainTitles.map(t => t.title_id));
    
    // Create a Set of available title_keys for matching similar titles
    const availableTitleKeys = new Set(allMainTitles.map(t => t.title_key || generateTitleKey(t.type, t.title_id)));
    
    this.logger.info(`Enriching similar titles for ${formatNumber(titlesToProcess.length)} newly created titles (${formatNumber(allMainTitles.length - titlesToProcess.length)} skipped)...`);

    const updatedTitles = [];
    let processedCount = 0;

    // Load existing main titles to preserve other properties
    const existingMainTitleMap = new Map(
      allMainTitles.map(t => [t.title_key || generateTitleKey(t.type, t.title_id), t])
    );

    // Save callback for progress tracking
    const saveCallback = async () => {
      if (updatedTitles.length > 0) {
        try {
          await this._saveMainTitles(updatedTitles, existingMainTitleMap);
          this.logger.debug(`Saved ${formatNumber(updatedTitles.length)} accumulated titles with similar titles via progress callback`);
          updatedTitles.length = 0; // Clear after saving
        } catch (error) {
          this.logger.error(`Error saving accumulated titles: ${error.message}`);
        }
      }
    };

    // Register for progress tracking
    const progressKey = 'similar_titles';
    let totalRemaining = titlesToProcess.length;
    this.registerProgress(progressKey, totalRemaining, saveCallback);

    try {
      // Process in batches
      for (let i = 0; i < titlesToProcess.length; i += batchSize) {
        const batch = titlesToProcess.slice(i, i + batchSize);

        await Promise.all(batch.map(async (mainTitle) => {
          try {
            // Determine tmdbType from each title's type
            const type = mainTitle.type;
            const tmdbType = this._typeConfig[type]?.tmdbType;
            if (!tmdbType) {
              this.logger.warn(`Invalid media type: ${type}, skipping`);
              return; // Return early instead of continue
            }
            
            const similarTitleIds = await this.getSimilarTitleKeys(
              tmdbType,
              mainTitle.title_id,
              availableTitleIds,
              type
            );

            const titleKey = mainTitle.title_key || generateTitleKey(mainTitle.type, mainTitle.title_id);
            
            // Create updated title with similar titles (store as title_keys)
            const updatedTitle = {
              ...existingMainTitleMap.get(titleKey) || mainTitle,
              similar: similarTitleIds,
              lastUpdated: new Date().toISOString() // Update lastUpdated to mark as processed
            };

            updatedTitles.push(updatedTitle);
            processedCount++;
          } catch (error) {
            const titleKey = mainTitle.title_key || generateTitleKey(mainTitle.type, mainTitle.title_id);
            this.logger.error(`Error enriching similar titles for ID ${mainTitle.title_id}: ${error.message}`);
            // Still add the title without similar titles to preserve it
            const existingTitle = existingMainTitleMap.get(titleKey) || mainTitle;
            if (!existingTitle.similar) {
              existingTitle.similar = [];
            }
            // Update lastUpdated even on error to prevent reprocessing
            existingTitle.lastUpdated = new Date().toISOString();
            updatedTitles.push(existingTitle);
          }
        }));

        totalRemaining = titlesToProcess.length - processedCount;
        this.updateProgress(progressKey, totalRemaining);

        // Log progress
        if ((i + batchSize) % 100 === 0 || i + batchSize >= titlesToProcess.length) {
          this.logger.debug(
            `Progress: ${Math.min(i + batchSize, titlesToProcess.length)}/${titlesToProcess.length} titles processed for similar titles enrichment`
          );
        }
      }
    } finally {
      // Save any remaining accumulated titles
      await saveCallback();
      
      // Unregister from progress tracking
      this.unregisterProgress(progressKey);
    }

    // Final save to ensure all titles are saved
    if (updatedTitles.length > 0) {
      await this._saveMainTitles(updatedTitles, existingMainTitleMap);
    }

    this.logger.info(`Similar titles enrichment completed for ${processedCount} titles`);
  }


  /**
   * Detect gaps between main titles and provider titles based on lastUpdated timestamps
   * @private
   * @param {Object} main_titles_data - Dictionary: { type: { tmdb_id: lastUpdated } }
   * @param {Object} provider_titles_data - Dictionary: { type: { tmdb_id: maxLastUpdated } }
   * @returns {{to_create: Array, to_update: Array, to_delete: Array}} Action arrays
   */
  _detectGaps(main_titles_data, provider_titles_data) {
    const to_create = [];
    const to_update = [];
    const to_delete = [];
    
    // Check all types
    for (const type of ['movies', 'tvshows']) {
      const mainData = main_titles_data[type] || {};
      const providerData = provider_titles_data[type] || {};
      
      // Find all unique tmdb_ids
      const allTmdbIds = new Set([
        ...Object.keys(mainData).map(Number),
        ...Object.keys(providerData).map(Number)
      ]);
      
      for (const tmdbId of allTmdbIds) {
        const mainLastUpdated = mainData[tmdbId] || null;
        const providerMaxLastUpdated = providerData[tmdbId] || null;
        
        if (!mainLastUpdated && providerMaxLastUpdated) {
          // Create: exists in provider but not in main
          to_create.push({ type, tmdb_id: tmdbId });
        } else if (mainLastUpdated && !providerMaxLastUpdated) {
          // Delete: exists in main but not in provider
          to_delete.push({ type, tmdb_id: tmdbId });
        } else if (mainLastUpdated && providerMaxLastUpdated) {
          // Compare timestamps
          const mainTime = mainLastUpdated instanceof Date ? mainLastUpdated.getTime() : new Date(mainLastUpdated).getTime();
          const providerTime = providerMaxLastUpdated instanceof Date ? providerMaxLastUpdated.getTime() : new Date(providerMaxLastUpdated).getTime();
          
          if (providerTime > mainTime) {
            // Update: provider has newer timestamp
            to_update.push({ type, tmdb_id: tmdbId });
          }
        }
      }
    }
    
    return { to_create, to_update, to_delete };
  }

  /**
   * Process main titles: generate, enrich similar, and generate streams
   * Orchestrates the complete main title processing workflow after TMDB ID matching
   * @param {Map<string, Array<Object>>} providerTitlesByProvider - Map of providerId -> titles array
   * @returns {Promise<{movies: number, tvShows: number}>} Count of generated main titles by type
   */
  async processMainTitles(providerTitlesByProvider) {
    if (!providerTitlesByProvider || providerTitlesByProvider.size === 0) {
      this.logger.warn('No provider titles available for main title processing.');
      return { movies: 0, tvShows: 0 };
    }

    // Load main titles into cache for later use
    await this.loadMainTitles();

    // Initialize arrays and dictionaries
    const to_create = [];
    const to_delete = [];
    const to_update = [];
    const main_titles_data = { movies: {}, tvshows: {} };
    const provider_titles_data = { movies: {}, tvshows: {} };

    // Query main titles with lastUpdated timestamp
    const mainTitles = await this.titlesManager.getMainTitlesLastUpdated();
    for (const title of mainTitles) {
      if (title.type && title.title_id && title.lastUpdated) {
        if (!main_titles_data[title.type]) {
          main_titles_data[title.type] = {};
        }
        main_titles_data[title.type][title.title_id] = title.lastUpdated;
      }
    }

    // Query provider titles and aggregate max lastUpdated
    const providerTitles = await this.providerTitlesManager.getProviderTitlesForChangeDetection();
    
    // Group by type + tmdb_id and calculate max lastUpdated
    const providerTitlesByKey = new Map();
    for (const title of providerTitles) {
      const key = `${title.type}-${title.tmdb_id}`;
      
      if (!providerTitlesByKey.has(key)) {
        providerTitlesByKey.set(key, {
          type: title.type,
          tmdb_id: title.tmdb_id,
          maxLastUpdated: null
        });
      }
      
      const group = providerTitlesByKey.get(key);
      // Track max lastUpdated across all providers for this tmdb_id
      if (title.lastUpdated) {
        const titleTime = title.lastUpdated instanceof Date ? title.lastUpdated.getTime() : new Date(title.lastUpdated).getTime();
        const currentMaxTime = group.maxLastUpdated ? (group.maxLastUpdated instanceof Date ? group.maxLastUpdated.getTime() : new Date(group.maxLastUpdated).getTime()) : 0;
        
        if (titleTime > currentMaxTime) {
          group.maxLastUpdated = title.lastUpdated;
        }
      }
    }
    
    // Map max lastUpdated for each type+tmdb_id group
    for (const [key, group] of providerTitlesByKey) {
      if (group.maxLastUpdated) {
        if (!provider_titles_data[group.type]) {
          provider_titles_data[group.type] = {};
        }
        provider_titles_data[group.type][group.tmdb_id] = group.maxLastUpdated;
      }
    }

    // Detect gaps
    const gaps = this._detectGaps(main_titles_data, provider_titles_data);
    to_create.push(...gaps.to_create);
    to_update.push(...gaps.to_update);
    to_delete.push(...gaps.to_delete);

    this.logger.info(`Gap detection: ${formatNumber(to_create.length)} to create, ${formatNumber(to_update.length)} to update, ${formatNumber(to_delete.length)} to delete`);

    // Step 1: Process deletions
    if (to_delete.length > 0) {
      const deleteTitleKeys = to_delete.map(t => generateTitleKey(t.type, t.tmdb_id));
      
      const deleteResult = await this.titlesManager.deleteManyByQuery({
        title_key: { $in: deleteTitleKeys }
      });
      this.logger.info(`Deleted ${formatNumber(deleteResult.deletedCount || 0)} main titles`);
    }

    // Step 2: Process updates and creates (they use the same logic - rebuild streams)
    const toProcess = [...to_update, ...to_create];
    if (toProcess.length > 0) {
      // Fetch FULL provider titles for titles that need processing
      // The getProviderTitlesForChangeDetection() only returns a projection,
      // but we need full provider title objects with streams data for stream generation
      this.logger.debug(`Fetching full provider titles for ${formatNumber(toProcess.length)} title(s) to process`);
      
      const allProviderTitles = [];
      const titlesByType = new Map();
      
      // Group by type and collect tmdb_ids
      for (const t of toProcess) {
        if (!titlesByType.has(t.type)) {
          titlesByType.set(t.type, []);
        }
        titlesByType.get(t.type).push(t.tmdb_id);
      }
      
      // Fetch full provider titles for each type
      for (const [type, tmdbIds] of titlesByType) {
        const typeProviderTitles = await this.providerTitlesManager.findByQuery({
          type: type,
          tmdb_id: { $in: tmdbIds },
          ignored: false
        });
        allProviderTitles.push(...typeProviderTitles);
      }
      
      // Group provider titles by type + tmdb_id for processing
      const providerTitlesByTMDB = new Map();
      for (const title of allProviderTitles) {
        if (title.tmdb_id && title.type) {
          const key = `${title.type}-${title.tmdb_id}`;
          if (!providerTitlesByTMDB.has(key)) {
            providerTitlesByTMDB.set(key, {
              type: title.type,
              providerTitleGroups: []
            });
          }
          providerTitlesByTMDB.get(key).providerTitleGroups.push({
            providerId: title.provider_id,
            title: title
          });
        }
      }

      // Process creates and updates using existing generation logic
      const titlesToProcess = toProcess.map(t => ({
        type: t.type,
        tmdbId: t.tmdb_id,
        titleKey: generateTitleKey(t.type, t.tmdb_id),
        providerTitleGroups: providerTitlesByTMDB.get(`${t.type}-${t.tmdb_id}`)?.providerTitleGroups || []
      }));

      // Get existing main titles for preservation
      const allMainTitles = this.getMainTitles();
      const existingMainTitleMap = new Map(
        allMainTitles.map(t => [t.title_key || generateTitleKey(t.type, t.title_id), t])
      );

      const batchSize = this.getRecommendedBatchSize();
      const result = await this._processTitlesBatch(batchSize, titlesToProcess, existingMainTitleMap);
      
      // Run enrichSimilarTitles
      await this.enrichSimilarTitles();

      return result;
    } else {
      // No titles to process, just run enrichSimilarTitles
      await this.enrichSimilarTitles();
      return { movies: 0, tvShows: 0 };
    }
  }

  /**
   * Cleanup outdated main titles by removing sources from disabled/deleted providers
   * @param {Array<Object>} disabledProviders - Array of disabled/deleted provider objects
   * @returns {Promise<Object>} Cleanup statistics
   */
  async cleanupOutdatedMainTitles(disabledProviders) {
    if (!disabledProviders || disabledProviders.length === 0) {
      this.logger.debug('No disabled/deleted providers to cleanup');
      return {
        providersProcessed: 0,
        titlesUpdated: 0,
        mediaItemsRemoved: 0,
        titlesDeleted: 0
      };
    }

    let totalTitlesUpdated = 0;
    let totalMediaItemsRemoved = 0;
    let totalTitlesDeleted = 0;

    for (const provider of disabledProviders) {
      const providerId = provider._id || provider.id;
      if (!providerId) {
        this.logger.warn(`Skipping provider without ID: ${JSON.stringify(provider)}`);
        continue;
      }

      this.logger.info(`Cleaning up sources from disabled/deleted provider: ${providerId}`);

      // Find all titles that have sources from this provider
      const titlesWithProvider = await this.titlesManager.findTitlesByQuery({
        'media.sources.provider_id': providerId
      }, {
        projection: { title_key: 1 }
      });

      if (titlesWithProvider.length === 0) {
        this.logger.debug(`No titles found with sources from provider ${providerId}`);
        continue;
      }

      const titleKeys = titlesWithProvider.map(t => t.title_key).filter(Boolean);
      this.logger.info(`Found ${titleKeys.length} titles with sources from provider ${providerId}`);

      // Step 1: Remove provider sources from titles
      const pullResult = await this.titlesManager.removeProviderSourcesFromTitles(titleKeys, providerId);
      const titlesUpdated = pullResult.modifiedCount || 0;
      totalTitlesUpdated += titlesUpdated;
      this.logger.info(`Removed sources from ${titlesUpdated} titles for provider ${providerId}`);

      // Step 2: Remove empty media items
      const mediaResult = await this.titlesManager.removeEmptyMediaItems(titleKeys);
      const mediaItemsRemoved = mediaResult.modifiedCount || 0;
      totalMediaItemsRemoved += mediaItemsRemoved;
      this.logger.info(`Removed ${mediaItemsRemoved} empty media items for provider ${providerId}`);

      // Step 3: Delete titles with no media items left
      const deleteResult = await this.titlesManager.deleteEmptyTitles(titleKeys);
      const titlesDeleted = deleteResult.deletedCount || 0;
      totalTitlesDeleted += titlesDeleted;
      this.logger.info(`Deleted ${titlesDeleted} empty titles for provider ${providerId}`);
    }

    const stats = {
      providersProcessed: disabledProviders.length,
      titlesUpdated: totalTitlesUpdated,
      mediaItemsRemoved: totalMediaItemsRemoved,
      titlesDeleted: totalTitlesDeleted
    };

    this.logger.info(`Cleanup completed: ${JSON.stringify(stats)}`);
    return stats;
  }

  /**
   * Process a batch of titles (create/update)
   * @private
   * @param {number} batchSize - Batch size for processing
   * @param {Array<Object>} titlesToProcess - Array of { type, tmdbId, titleKey, providerTitleGroups }
   * @param {Map<string, Object>} existingMainTitleMap - Map of existing main titles by title_key
   * @returns {Promise<{movies: number, tvShows: number}>} Count of processed titles by type
   */
  async _processTitlesBatch(batchSize, titlesToProcess, existingMainTitleMap) {
    const mainTitles = [];
    let processedCount = 0;
    const processedCountByType = { movies: 0, tvShows: 0 };
    const totalTitles = titlesToProcess.length;
    const failedTitles = []; // Track titles that failed to get TMDB details

    // Track time for periodic saves and progress logging
    let lastSaveTime = Date.now();
    const SAVE_INTERVAL_MS = 30000; // 30 seconds

    try {
      // Process in batches
      for (let i = 0; i < titlesToProcess.length; i += batchSize) {
        const batch = titlesToProcess.slice(i, i + batchSize);

        await Promise.all(batch.map(async ({ type, tmdbId, titleKey, providerTitleGroups }) => {
          if (providerTitleGroups.length === 0) {
            this.logger.warn(`No provider titles found for ${type} ${tmdbId}`);
            return;
          }

          const result = await this.generateMainTitle(tmdbId, type, providerTitleGroups);

          if (result && result.mainTitle) {
            const mainTitle = result.mainTitle;
            
            if (!mainTitle.type) mainTitle.type = type;
            if (!mainTitle.title_key) mainTitle.title_key = titleKey;
            
            // Preserve createdAt if title already exists
            const existing = existingMainTitleMap.get(titleKey);
            if (existing && existing.createdAt) {
              mainTitle.createdAt = existing.createdAt;
            }
            
            mainTitles.push(mainTitle);
            
            processedCount++;
            const counterKey = this._getTypeCounterKey(type);
            processedCountByType[counterKey]++;
          } else {
            // TMDB details not found - mark for ignoring
            failedTitles.push({ type, tmdbId });
          }
        }));

        // Check if 30 seconds have passed since last save
        const now = Date.now();
        const timeSinceLastSave = now - lastSaveTime;

        if (timeSinceLastSave >= SAVE_INTERVAL_MS) {
          // Save accumulated data
          if (mainTitles.length > 0) {
            await this._saveMainTitles(mainTitles, existingMainTitleMap);
            this.logger.debug(`Saved ${formatNumber(mainTitles.length)} main titles (periodic save)`);
            mainTitles.length = 0;
          }

          // Log progress
          this.logger.info(`Progress: ${processedCount} out of ${totalTitles} titles processed`);

          // Update last save time
          lastSaveTime = now;
        }
      }

      // Mark provider titles as ignored for titles that failed to get TMDB details
      if (failedTitles.length > 0) {
        await this._markProviderTitlesAsIgnored(failedTitles);
      }

      // Final save for any remaining data
      if (mainTitles.length > 0) {
        await this._saveMainTitles(mainTitles, existingMainTitleMap);
        this.logger.debug(`Saved ${formatNumber(mainTitles.length)} main titles (final save)`);
      }

      // Final progress log
      this.logger.info(`Completed: ${processedCount} out of ${totalTitles} titles processed`);

      return processedCountByType;
    } catch (error) {
      this.logger.error(`Error processing titles batch: ${error.message}`);
      throw error;
    }
  }

  /**
   * Mark provider titles as ignored when TMDB details cannot be found
   * @private
   * @param {Array<Object>} failedTitles - Array of { type, tmdbId }
   * @returns {Promise<void>}
   */
  async _markProviderTitlesAsIgnored(failedTitles) {
    if (!failedTitles || failedTitles.length === 0) {
      return;
    }

    const reason = 'no tmdb details found for the title';
    const now = new Date();

    try {
      // Group by type for batch updates
      const titlesByType = new Map();
      for (const { type, tmdbId } of failedTitles) {
        if (!titlesByType.has(type)) {
          titlesByType.set(type, []);
        }
        titlesByType.get(type).push(tmdbId);
      }

      // Update provider titles for each type
      for (const [type, tmdbIds] of titlesByType) {
        // Process in batches to avoid MongoDB $in limit issues
        const batchSize = 1000;
        for (let i = 0; i < tmdbIds.length; i += batchSize) {
          const tmdbIdsBatch = tmdbIds.slice(i, i + batchSize);
          
          const result = await this.providerTitlesManager.updateManyByQuery(
            {
              type: type,
              tmdb_id: { $in: tmdbIdsBatch },
              ignored: { $ne: true } // Only update titles that aren't already ignored
            },
            {
              $set: {
                ignored: true,
                ignored_reason: reason,
                lastUpdated: now
              }
            }
          );

          if (result.modifiedCount > 0) {
            this.logger.info(`Marked ${formatNumber(result.modifiedCount)} provider title(s) as ignored for ${type} (reason: ${reason})`);
          }
        }
      }
    } catch (error) {
      this.logger.error(`Error marking provider titles as ignored: ${error.message}`);
      // Don't throw - this is a non-critical operation
    }
  }

  /**
   * Generate main titles from all provider titles with TMDB IDs
   * Groups provider titles by TMDB ID and creates main titles using TMDB API data
   * @param {Map<string, Array<Object>>} providerTitlesByProvider - Map of providerId -> titles array
   * @returns {Promise<{movies: number, tvShows: number}>} Count of generated main titles by type for reporting
   */
  async generateMainTitles(providerTitlesByProvider) {
    if (!providerTitlesByProvider || providerTitlesByProvider.size === 0) {
      this.logger.warn('No providers available for main title generation.');
      return { movies: 0, tvShows: 0 };
    }

    this.logger.info('Starting main title generation process...');
    const batchSize = this.getRecommendedBatchSize();

    // Group all titles by TMDB ID (key: {type}-{tmdbId}, value: {type, providerTitleGroups})
    const providerTitlesByTMDB = new Map(); // Map<string, {type: string, providerTitleGroups: Array<{providerId, title}>}>

    for (const [providerId, allTitles] of providerTitlesByProvider) {
      for (const title of allTitles) {
        if (title.tmdb_id && title.type) {
          const tmdbId = title.tmdb_id;
          const type = title.type;
          const key = `${type}-${tmdbId}`;
          
          if (!providerTitlesByTMDB.has(key)) {
            providerTitlesByTMDB.set(key, {
              type,
              providerTitleGroups: []
            });
          }
          
          providerTitlesByTMDB.get(key).providerTitleGroups.push({
            providerId,
            title
          });
        }
      }
    }

    // Get existing main titles from memory cache
    const allMainTitles = this.getMainTitles();
    const existingMainTitleMap = new Map(
      allMainTitles.map(t => [t.title_key || generateTitleKey(t.type, t.title_id), t])
    );

    // Process all titles together
    const countsByType = await this._generateMainTitles(batchSize, providerTitlesByTMDB, existingMainTitleMap);

    const totalCount = countsByType.movies + countsByType.tvShows;
    this.logger.info(
      `Main title generation completed: ${totalCount} titles processed`
    );

    return { movies: countsByType.movies, tvShows: countsByType.tvShows };
  }

  /**
   * Check if main title needs regeneration based on provider title updates
   * @private
   * @param {Object|null} existingMainTitle - Existing main title or null
   * @param {Array<Object>} providerTitleGroups - Array of provider title groups
   * @returns {boolean} True if regeneration is needed
   */
  _needsRegeneration(existingMainTitle, providerTitleGroups) {
    // If main title doesn't exist, needs regeneration
    if (!existingMainTitle || !existingMainTitle.lastUpdated) {
      return true;
    }

    const mainLastUpdated = new Date(existingMainTitle.lastUpdated).getTime();

    // Check if any provider title has been updated after main title
    for (const group of providerTitleGroups) {
      const providerLastUpdated = group.title.lastUpdated 
        ? new Date(group.title.lastUpdated).getTime() 
        : 0;
      
      if (providerLastUpdated > mainLastUpdated) {
        return true; // At least one provider title is newer
      }
    }

    return false; // All provider titles are older or equal to main title
  }

  /**
   * Generate main titles from provider titles grouped by TMDB ID
   * @private
   * @param {number} batchSize - Batch size for processing
   * @param {Map<string, {type: string, providerTitleGroups: Array}>} providerTitlesByTMDB - Pre-grouped provider titles by {type}-{tmdbId} key
   * @param {Map<string, Object>} existingMainTitleMap - Map of existing main titles by title_key
   * @returns {Promise<{movies: number, tvShows: number}>} Count of generated main titles by type for reporting
   */
  async _generateMainTitles(batchSize, providerTitlesByTMDB, existingMainTitleMap) {
    if (providerTitlesByTMDB.size === 0) {
      this.logger.info('No titles with TMDB IDs found for main title generation');
      return { movies: 0, tvShows: 0 };
    }

    // Filter titles that need regeneration
    const titlesToProcess = [];
    let skippedCount = 0;
    
    for (const [key, value] of providerTitlesByTMDB) {
      const { type, providerTitleGroups } = value;
      const match = key.match(/^(movies|tvshows)-(\d+)$/);
      if (!match) continue;
      
      const tmdbId = parseInt(match[2], 10);
      const titleKey = generateTitleKey(type, tmdbId);
      const existingMainTitle = existingMainTitleMap.get(titleKey);
      
      if (this._needsRegeneration(existingMainTitle, providerTitleGroups)) {
        titlesToProcess.push({ key, type, tmdbId, providerTitleGroups, titleKey });
      } else {
        skippedCount++;
      }
    }
    
    if (skippedCount > 0) {
      this.logger.debug(`Skipping ${skippedCount} main titles (no provider updates since last generation)`);
    }
    
    if (titlesToProcess.length === 0) {
      this.logger.info('No main titles need regeneration');
      return { movies: 0, tvShows: 0 };
    }

    // Fetch ALL provider titles for titles that need regeneration
    // This ensures we include provider titles that weren't in the incremental load
    if (titlesToProcess.length > 0) {
      const titleKeysToFetch = titlesToProcess.map(t => t.titleKey);
      const tmdbIdsToFetch = titlesToProcess.map(t => t.tmdbId);
      this.logger.debug(`Fetching all provider titles for ${formatNumber(titleKeysToFetch.length)} title(s) needing regeneration`);
      
      try {
        // Group titles by type
        const titlesByType = new Map();
        for (const titleInfo of titlesToProcess) {
          if (!titlesByType.has(titleInfo.type)) {
            titlesByType.set(titleInfo.type, []);
          }
          titlesByType.get(titleInfo.type).push(titleInfo.tmdbId);
        }
        
        // Query separately for each type to ensure type and tmdb_id match correctly
        const allProviderTitles = [];
        for (const [type, tmdbIds] of titlesByType) {
          const typeProviderTitles = await this.providerTitlesManager.findByQuery({
            type: type,
            tmdb_id: { $in: tmdbIds },
            ignored: false
          });
          allProviderTitles.push(...typeProviderTitles);
        }
        
        // Group fetched titles by main title's title_key (type-tmdb_id) and merge with existing providerTitleGroups
        const fetchedTitlesByKey = new Map();
        for (const title of allProviderTitles) {
          // Use the main title's title_key (type-tmdb_id) as the key
          const mainTitleKey = generateTitleKey(title.type, title.tmdb_id);
          if (!fetchedTitlesByKey.has(mainTitleKey)) {
            fetchedTitlesByKey.set(mainTitleKey, []);
          }
          fetchedTitlesByKey.get(mainTitleKey).push(title);
        }
        
        // Merge fetched titles into providerTitleGroups
        for (const titleInfo of titlesToProcess) {
          const fetchedTitles = fetchedTitlesByKey.get(titleInfo.titleKey) || [];
          
          // Create a map of existing provider IDs to avoid duplicates
          const existingProviderIds = new Set(
            titleInfo.providerTitleGroups.map(g => g.providerId)
          );
          
          // Add fetched titles that aren't already in the groups
          for (const fetchedTitle of fetchedTitles) {
            if (!existingProviderIds.has(fetchedTitle.provider_id)) {
              titleInfo.providerTitleGroups.push({
                providerId: fetchedTitle.provider_id,
                title: fetchedTitle
              });
              this.logger.debug(
                `Added missing provider title: ${fetchedTitle.provider_id} for ${titleInfo.titleKey}`
              );
            }
          }
        }
        
        this.logger.debug(`Merged provider titles from database for regeneration`);
      } catch (error) {
        this.logger.warn(`Failed to fetch all provider titles for regeneration: ${error.message}. Continuing with incremental titles only.`);
      }
    }
    
    this.logger.info(`Generating ${formatNumber(titlesToProcess.length)} main titles (${formatNumber(skippedCount)} skipped)...`);

    const mainTitles = [];
    let processedCount = 0;
    const processedCountByType = { movies: 0, tvShows: 0 };

    // Track remaining titles for progress
    let totalRemaining = titlesToProcess.length;

    // Save callback for progress tracking
    const saveCallback = async () => {
      // Save main titles
      if (mainTitles.length > 0) {
        try {
          await this._saveMainTitles(mainTitles, existingMainTitleMap);
          this.logger.debug(`Saved ${formatNumber(mainTitles.length)} accumulated main titles via progress callback`);
          mainTitles.length = 0; // Clear after saving
        } catch (error) {
          this.logger.error(`Error saving accumulated main titles: ${error.message}`);
        }
      }
      
    };

    // Register for progress tracking
    const progressKey = 'main_titles';
    this.registerProgress(progressKey, totalRemaining, saveCallback);

    try {
      // Process in batches
      for (let i = 0; i < titlesToProcess.length; i += batchSize) {
        const batch = titlesToProcess.slice(i, i + batchSize);

        await Promise.all(batch.map(async ({ type, tmdbId, providerTitleGroups }) => {
          const result = await this.generateMainTitle(
            tmdbId,
            type,
            providerTitleGroups
          );

          // Only create main title if streams exist (result is not null)
          if (result && result.mainTitle) {
            const mainTitle = result.mainTitle;
            
            // Type and title_key should already be set by TMDBProvider, but ensure they exist
            if (!mainTitle.type) mainTitle.type = type;
            if (!mainTitle.title_key) mainTitle.title_key = generateTitleKey(type, tmdbId);
            
            // Preserve createdAt if title already exists
            const titleKey = mainTitle.title_key;
            const existing = existingMainTitleMap.get(titleKey);
            if (existing && existing.createdAt) {
              mainTitle.createdAt = existing.createdAt;
            }
            
            mainTitles.push(mainTitle);
            
            processedCount++;
            
            // Track by type for return value
            const counterKey = this._getTypeCounterKey(type);
            processedCountByType[counterKey]++;
          }
        }));

        totalRemaining = titlesToProcess.length - processedCount;
        this.updateProgress(progressKey, totalRemaining);

        // Log progress
        if ((i + batchSize) % 100 === 0 || i + batchSize >= titlesToProcess.length) {
          this.logger.debug(
            `Progress: ${Math.min(i + batchSize, titlesToProcess.length)}/${titlesToProcess.length} main titles processed`
          );
        }
      }
    } finally {
      // Save any remaining accumulated titles
      await saveCallback();
      
      // Unregister from progress tracking
      this.unregisterProgress(progressKey);
    }

    // Final save to ensure all titles are saved
    if (mainTitles.length > 0) {
      await this._saveMainTitles(mainTitles, existingMainTitleMap);
    }

    return processedCountByType;
  }


  /**
   * Save main titles to MongoDB
   * Called periodically (every 30 seconds) or at end of process
   * @private
   * @param {Array<Object>} newMainTitles - Array of new main titles to save (can be mixed types)
   * @param {Map<string, Object>} existingMainTitleMap - Map of existing main titles by title_key (unused, kept for compatibility)
   * @returns {Promise<Array<Object>>} Updated titles array
   */
  async _saveMainTitles(newMainTitles, existingMainTitleMap) {
    if (!newMainTitles || newMainTitles.length === 0) {
      return this._mainTitlesCache || [];
    }

    // Ensure all new titles have title_key
    const processedTitles = newMainTitles.map(t => {
      if (!t.title_key && t.type && t.title_id) {
        t.title_key = generateTitleKey(t.type, t.title_id);
      }
      return t;
    }).filter(t => t.title_key);

    if (processedTitles.length === 0) {
      return this._mainTitlesCache || [];
    }

    try {
      // Save to MongoDB using TitlesManager
      const result = await this.titlesManager.saveMainTitles(processedTitles);
      
      // Reload from MongoDB to get updated cache (includes all titles, not just new ones)
      const allTitles = await this.titlesManager.findTitlesByQuery({});
      this._mainTitlesCache = allTitles;
      
      this.logger.info(`Saved ${formatNumber(result.inserted + result.updated)} main titles to MongoDB (${formatNumber(result.inserted)} inserted, ${formatNumber(result.updated)} updated, total: ${formatNumber(allTitles.length)} titles)`);
      
      return allTitles;
    } catch (error) {
      this.logger.error(`Error saving main titles to MongoDB: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get recommended batch size for processing titles based on rate limit configuration
   * The batch size is calculated from the API rate limit settings to optimize throughput
   * while avoiding memory issues. The limiter handles actual rate limiting internally.
   * @returns {number} Recommended batch size for processing
   */
  getRecommendedBatchSize() {
    const rateLimit = this.providerData.api_rate || {};
    const concurrent = rateLimit.concurrent || rateLimit.concurrect || 40; // Default to 40 if not configured
    // Use a reasonable batch size based on rate limit (not too large to avoid memory issues)
    return Math.min(concurrent * 2, 100);
  }

  /**
   * Match TMDB ID for a title using multiple strategies
   * Caching is handled by the server (web-api), rate limiting is handled here via limiter
   * @param {Object} title - Title object with title_id, title, etc.
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @param {string} providerType - Provider type ('agtv', 'xtream', etc.)
   * @returns {Promise<number|null>} TMDB ID if matched, null otherwise
   */
  async matchTMDBIdForTitle(title, type, providerType) {
    const tmdbType = this._typeConfig[type]?.tmdbType;
    if (!tmdbType) {
      throw new Error(`Invalid media type: ${type}. Must be 'movies' or 'tvshows'`);
    }

    // Strategy 1: For AGTV provider, try using title_id (IMDB ID) directly
    // Note: Xtream providers either have tmdb_id from extended info or fall through to search
    if (providerType === 'agtv' && title.title_id) {
      try {
        // Check if title_id looks like an IMDB ID (starts with 'tt')
        if (title.title_id.startsWith('tt')) {
          const result = await this.findByIMDBId(title.title_id, tmdbType);
          
          if (!result) {
            this.logger.debug(`IMDB ID lookup returned null/undefined for ${title.title_id} (type: ${type})`);
          } else {
            // Dynamically access results using tmdbType (movie_results or tv_results)
            const resultsKey = `${tmdbType}_results`;
            if (result[resultsKey] && result[resultsKey].length > 0) {
              const tmdbId = result[resultsKey][0].id;
              this.logger.debug(`Found TMDB ${tmdbType} ID ${tmdbId} via IMDB ${title.title_id}`);
              return tmdbId;
            }
            // Log when expected results are not found
            this.logger.debug(`IMDB ID ${title.title_id} found but ${resultsKey} is empty or missing`);
          }
        }
      } catch (error) {
        this.logger.debug(`IMDB ID lookup failed for ${title.title_id}: ${error.message || error.toString()}`);
      }
    }

    // Strategy 2: Search by title name
    // Used for AGTV when IMDB lookup fails, and for Xtream when tmdb_id is not available
    // Check both title.title and title.name (Xtream providers use 'name', AGTV uses 'title')
    const titleName = title.title || title.name;
    if (titleName) {
      try {
        // Prefer release_date year if available (for Xtream providers), otherwise extract from title
        const year = title.release_date 
          ? extractYearFromReleaseDate(title.release_date) 
          : extractYearFromTitle(titleName);
        const baseTitle = extractBaseTitle(titleName);
        
        // Try searching with base title and year first
        let searchResult = await this.search(tmdbType, baseTitle, year);
        
        // If no results with year, try without year
        if (!searchResult.results || searchResult.results.length === 0) {
          searchResult = await this.search(tmdbType, baseTitle, null);
        }
        
        if (searchResult.results && searchResult.results.length > 0) {
          // Return the first result (best match)
          return searchResult.results[0].id;
        }
      } catch (error) {
        this.logger.debug(`Search failed for "${titleName}": ${error.message || error.toString()}`);
      }
    }

    return null;
  }

  /**
   * Generate main title from TMDB API data and provider titles
   * @param {number} tmdbId - TMDB ID
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @param {Array<Object>} providerTitleGroups - Array of objects with { providerId, title } structure
   * @returns {Promise<{mainTitle: Object}|null>} Object with main title (including media array), or null if no streams found or API call fails
   */
  async generateMainTitle(tmdbId, type, providerTitleGroups) {
    const tmdbType = this._typeConfig[type]?.tmdbType;
    if (!tmdbType) {
      throw new Error(`Invalid media type: ${type}. Must be 'movies' or 'tvshows'`);
    }
    
    try {
      // Fetch TMDB details
      const apiData = await this.getDetails(tmdbType, tmdbId);
      
      if (!apiData) {
        this.logger.warn(`No TMDB data found for ${tmdbType} ID ${tmdbId}`);
        return null;
      }

      const now = new Date().toISOString();
      
      // Extract imdb_id from external_ids if available
      let imdbId = null;
      if (apiData.external_ids && apiData.external_ids.imdb_id) {
        imdbId = apiData.external_ids.imdb_id;
      }
      
      // Get type-specific fields
      const { title: titleField, release_date: releaseDateField } = this._getTitleField(type, apiData);
      
      // Build base main title structure (metadata only)
      const mainTitle = {
        title_id: tmdbId,
        type: type,
        title_key: generateTitleKey(type, tmdbId),
        title: titleField,
        release_date: releaseDateField,
        vote_average: apiData.vote_average || null,
        vote_count: apiData.vote_count || null,
        overview: apiData.overview || null,
        poster_path: apiData.poster_path || null,
        genres: apiData.genres || [],
        imdb_id: imdbId,
        media: [], // Will be populated with media streams
        createdAt: now,
        lastUpdated: now
      };

      // Build media streams from ALL provider_titles
      const { media } = await this._buildMediaStreams(tmdbId, type, mainTitle);

      // If no media streams found, don't create main title
      if (!media || media.length === 0) {
        this.logger.debug(`No media streams found for ${type} ${tmdbId}, skipping main title creation`);
        return null;
      }

      // Set media array
      mainTitle.media = media;

      return { mainTitle };
    } catch (error) {
      this.logger.error(`Error generating main title for ${tmdbType} ID ${tmdbId}: ${error.message}`);
      return null;
    }
  }


  /**
   * Build media streams from ALL provider_titles with matching tmdb_id and type
   * Groups provider sources by media item (main for movies, season/episode for TV shows)
   * @private
   * @param {number} tmdbId - TMDB ID
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @param {Object} mainTitle - Main title object (for metadata like title, release_date, etc.)
   * @returns {Promise<{media: Array}>} Object with media array
   */
  async _buildMediaStreams(tmdbId, type, mainTitle) {
    const media = [];
    const mediaMap = new Map(); // Key: 'main' for movies, 'S{season}-E{episode}' for TV shows

    try {
      // Fetch ALL provider_titles with matching tmdb_id and type from database
      const providerTitles = await this.providerTitlesManager.findByQuery({
        tmdb_id: tmdbId,
        type: type,
        ignored: false
      });

      if (!providerTitles || providerTitles.length === 0) {
        this.logger.debug(`No provider titles found for ${type} ${tmdbId}`);
        return { media };
      }

      // Extract metadata from mainTitle
      const title = mainTitle.title || '';
      const releaseDate = mainTitle.release_date || '';
      const year = releaseDate ? releaseDate.split('-')[0] : '';

      // Type-specific handlers
      const typeHandlers = {
        movies: {
          validateStreamId: (streamId) => streamId === 'main',
          createMediaItem: (streamId, title, year, tmdbId, type) => {
            const proxyPath = `${type}/${title} (${year}) [tmdb=${tmdbId}]/${title} (${year}).strm`;
            return {
              name: 'main',
              proxy_path: proxyPath,
              sources: []
            };
          },
          enrichMetadata: async () => {
            // Movies don't need episode metadata enrichment
            return;
          }
        },
        tvshows: {
          validateStreamId: (streamId) => streamId === 'main' || streamId.match(/^S\d{2}-E\d{2}$/),
          createMediaItem: (streamId, title, year, tmdbId, type) => {
            const match = streamId.match(/^S(\d+)-E(\d+)$/);
            if (!match) {
              return null; // Invalid stream ID
            }
            const seasonNumber = parseInt(match[1], 10);
            const episodeNumber = parseInt(match[2], 10);
            const seasonStrPath = `Season ${seasonNumber}`;
            const proxyPath = `${type}/${title} (${year}) [tmdb=${tmdbId}]/${seasonStrPath}/${title} (${year}) ${streamId}.strm`;
            
            return {
              name: '', // Will be populated from TMDB
              proxy_path: proxyPath,
              season: seasonNumber,
              episode: episodeNumber,
              air_date: null,
              overview: null,
              still_path: null,
              sources: []
            };
          },
          enrichMetadata: async (mediaMap, tmdbId) => {
            await this._enrichTVShowMetadata(mediaMap, tmdbId);
          }
        }
      };

      const handler = typeHandlers[type];
      if (!handler) {
        this.logger.warn(`Unknown type: ${type}`);
        return { media };
      }

      // Collect all provider sources grouped by media item
      for (const providerTitle of providerTitles) {
        const providerId = providerTitle.provider_id;
        const providerTitleId = providerTitle.title_id;
        const providerStreams = providerTitle.streams || {};

        for (const [streamId, streamUrl] of Object.entries(providerStreams)) {
          // Validate stream ID using type-specific handler
          if (!handler.validateStreamId(streamId)) {
            continue;
          }

          // Get or create media item
          let mediaItem = mediaMap.get(streamId);
          if (!mediaItem) {
            // Create media item using type-specific handler
            mediaItem = handler.createMediaItem(streamId, title, year, tmdbId, type);
            if (!mediaItem) {
              continue; // Skip invalid stream ID
            }
            mediaMap.set(streamId, mediaItem);
          }

          // Add provider source
          mediaItem.sources.push({
            provider_id: providerId,
            provider_title_id: providerTitleId,
            provider_url: streamUrl
          });
        }
      }

      // Enrich metadata using type-specific handler
      if (mediaMap.size > 0) {
        await handler.enrichMetadata(mediaMap, tmdbId);
      }

      // Convert map to array
      media.push(...Array.from(mediaMap.values()));

      this.logger.debug(`Built ${formatNumber(media.length)} media items from ${formatNumber(providerTitles.length)} provider titles for ${type} ${tmdbId}`);
    } catch (error) {
      this.logger.error(`Error building media streams for ${type} ${tmdbId}: ${error.message}`);
    }

    return { media };
  }

  /**
   * Enrich TV show episode metadata from TMDB cache and API
   * Implements cache-checking optimization: checks cache first, only fetches missing/incomplete seasons
   * @private
   * @param {Map<string, Object>} mediaMap - Map of media items keyed by stream ID
   * @param {number} tmdbId - TMDB TV show ID
   * @returns {Promise<void>}
   */
  async _enrichTVShowMetadata(mediaMap, tmdbId) {
    try {
      // Step 1: Collect required episodes and seasons from providers
      const requiredEpisodes = new Map(); // Map<seasonNum, Set<episodeNum>>
      const seasonsToProcess = new Set();
      
      for (const streamId of mediaMap.keys()) {
        if (streamId !== 'main') {
          const match = streamId.match(/^S(\d+)-E(\d+)$/);
          if (match) {
            const seasonNum = parseInt(match[1], 10);
            const episodeNum = parseInt(match[2], 10);
            seasonsToProcess.add(seasonNum);
            
            if (!requiredEpisodes.has(seasonNum)) {
              requiredEpisodes.set(seasonNum, new Set());
            }
            requiredEpisodes.get(seasonNum).add(episodeNum);
          }
        }
      }

      // Step 1.5: Validate seasons against TMDB's available seasons
      // Fetch TV show details to get the list of available seasons
      let availableSeasons = new Set();
      try {
        const tvShowDetails = await this.getTVShowDetails(tmdbId);
        if (tvShowDetails && Array.isArray(tvShowDetails.seasons)) {
          // Extract season numbers from TMDB's seasons array
          availableSeasons = new Set(
            tvShowDetails.seasons
              .map(season => season.season_number)
              .filter(seasonNum => seasonNum !== null && seasonNum !== undefined)
          );
          
          // Filter seasonsToProcess to only include seasons that exist in TMDB
          const invalidSeasons = [];
          for (const seasonNum of seasonsToProcess) {
            if (!availableSeasons.has(seasonNum)) {
              invalidSeasons.push(seasonNum);
              this.logger.debug(`Season ${seasonNum} not available in TMDB for TV show ${tmdbId}, skipping`);
            }
          }
          
          // Remove invalid seasons from seasonsToProcess and requiredEpisodes
          for (const invalidSeason of invalidSeasons) {
            seasonsToProcess.delete(invalidSeason);
            requiredEpisodes.delete(invalidSeason);
          }
          
          if (invalidSeasons.length > 0) {
            this.logger.debug(`Filtered out ${formatNumber(invalidSeasons.length)} invalid season(s) [${invalidSeasons.join(', ')}] for TV show ${tmdbId} (TMDB has ${formatNumber(availableSeasons.size)} seasons)`);
          }
        }
      } catch (error) {
        // If fetching TV show details fails, log warning but continue with all seasons
        // This provides fallback behavior in case of API issues
        this.logger.warn(`Failed to fetch TV show details for ${tmdbId} to validate seasons: ${error.message}. Proceeding with all requested seasons.`);
      }

      // Step 2: Try to get seasons from cache first, check if they have all needed episodes
      const seasonsData = [];
      const seasonsToFetch = [];
      
      for (const seasonNum of seasonsToProcess) {
        // Try to get from cache first (read-only, doesn't trigger fetch)
        const cachedSeason = this.tmdbManager._getCache('tmdb', 'tv', 'tmdb-season', {
          tmdbId,
          seasonNumber: seasonNum
        });
        
        if (cachedSeason && cachedSeason.episodes) {
          // Check if cached season has all required episodes
          const requiredEps = requiredEpisodes.get(seasonNum);
          const cachedEpisodes = new Set(
            cachedSeason.episodes.map(ep => ep.episode_number)
          );
          
          const hasAllEpisodes = Array.from(requiredEps).every(epNum => 
            cachedEpisodes.has(epNum)
          );
          
          if (hasAllEpisodes) {
            // Cache has all episodes we need, use it
            this.logger.debug(`Using cached season ${seasonNum} for TV show ${tmdbId}`);
            seasonsData.push(cachedSeason);
          } else {
            // Cache exists but missing some episodes, need to fetch
            this.logger.debug(`Cached season ${seasonNum} missing episodes, will fetch from API`);
            seasonsToFetch.push(seasonNum);
          }
        } else {
          // No cache or expired, need to fetch
          this.logger.debug(`No cache for season ${seasonNum}, will fetch from API`);
          seasonsToFetch.push(seasonNum);
        }
      }

      // Step 3: Fetch only seasons that are missing or incomplete
      if (seasonsToFetch.length > 0) {
        // Use Promise.allSettled to handle individual season fetch failures gracefully
        // This prevents one failing season from breaking the entire operation
        const seasonPromises = seasonsToFetch.map(async (seasonNum) => {
          try {
            return await this.getTVShowSeasonDetails(tmdbId, seasonNum);
          } catch (error) {
            // Log error but don't throw - we'll skip this season
            this.logger.warn(`Failed to fetch season ${seasonNum} for TV show ${tmdbId}: ${error.message}`);
            return null; // Return null to indicate failure
          }
        });
        
        const seasonResults = await Promise.all(seasonPromises);
        // Filter out null results (failed fetches) and add successful ones
        const fetchedSeasons = seasonResults.filter(season => season !== null);
        seasonsData.push(...fetchedSeasons);
      }

      // Step 4: Populate episode metadata from all seasons (cached + fetched)
      for (const seasonData of seasonsData) {
        if (seasonData && seasonData.episodes) {
          for (const episode of seasonData.episodes) {
            const seasonStr = String(episode.season_number).padStart(2, '0');
            const episodeStr = String(episode.episode_number).padStart(2, '0');
            const streamKey = `S${seasonStr}-E${episodeStr}`;
            
            const mediaItem = mediaMap.get(streamKey);
            if (mediaItem) {
              mediaItem.name = episode.name || '';
              mediaItem.air_date = episode.air_date || null;
              mediaItem.overview = episode.overview || null;
              mediaItem.still_path = episode.still_path || null;
            }
          }
        }
      }
    } catch (error) {
      this.logger.warn(`Error fetching episode metadata for TV show ${tmdbId}: ${error.message}`);
    }
  }

}

