import { BaseJob } from './BaseJob.js';

/**
 * Job for processing main titles
 * Handles TMDB ID matching and main title generation from provider titles
 * @extends {BaseJob}
 */
export class ProcessMainTitlesJob extends BaseJob {
  /**
   * @param {import('../managers/StorageManager.js').StorageManager} cache - Storage manager instance for temporary cache
   * @param {import('../managers/StorageManager.js').StorageManager} data - Storage manager instance for persistent data storage
   * @param {Map<string, import('../providers/BaseIPTVProvider.js').BaseIPTVProvider>} providers - Map of providerId -> provider instance (already initialized)
   * @param {import('../providers/TMDBProvider.js').TMDBProvider} tmdbProvider - TMDB provider singleton instance
   */
  constructor(cache, data, providers, tmdbProvider) {
    super('ProcessMainTitlesJob', cache, data, providers, tmdbProvider);
  }

  /**
   * Execute the job - match TMDB IDs and generate main titles
   * @returns {Promise<{movies: number, tvShows: number}>} Count of generated main titles
   */
  async execute() {
    this._validateDependencies();

    // Match TMDB IDs for all provider titles
    await this.matchAllTMDBIds();

    // Generate main titles from provider titles with TMDB IDs
    const result = await this.generateMainTitles();

    // Enrich similar titles for all main titles
    await this.enrichSimilarTitles();

    return result;
  }

  /**
   * Match TMDB IDs for all titles of a specific provider and type
   * @private
   * @param {import('../providers/BaseIPTVProvider.js').BaseIPTVProvider} providerInstance - Provider instance
   * @param {string} providerId - Provider identifier
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Promise<{matched: number, ignored: number}>} Count of matched and ignored titles
   */
  async _matchTMDBIdsForProviderType(providerInstance, providerId, type) {
    const providerType = providerInstance.getProviderType();
    const allTitles = providerInstance.loadTitles(type);
    
    // Filter titles without TMDB ID
    const titlesWithoutTMDB = allTitles.filter(t => !t.tmdb_id && t.title_id);

    if (titlesWithoutTMDB.length === 0) {
      this.logger.info(`[${providerId}] All ${type} titles already have TMDB IDs`);
      return { matched: 0, ignored: 0 };
    }

    this.logger.debug(`[${providerId}] Matching TMDB IDs for ${titlesWithoutTMDB.length} ${type} titles...`);

    // Load existing ignored titles
    const ignoredTitles = providerInstance.loadIgnoredTitles(type);
    const initialIgnoredCount = Object.keys(ignoredTitles).length;
    
    // Get recommended batch size from TMDB provider
    const batchSize = this.tmdbProvider.getRecommendedBatchSize();
    
    let matchedCount = 0;
    let ignoredCount = 0;
    const updatedTitles = [];
    
    // Track remaining titles for progress
    let totalRemaining = titlesWithoutTMDB.length;
    
    // Track last saved ignored count to avoid saving unchanged state
    let lastSavedIgnoredCount = initialIgnoredCount;
    
    // Save callback for progress tracking (called every 30 seconds and on completion)
    const saveCallback = async () => {
      // Save updated titles
      if (updatedTitles.length > 0) {
        try {
          await providerInstance.saveTitles(type, updatedTitles);
          this.logger.debug(`[${providerId}] Saved ${updatedTitles.length} accumulated ${type} titles with TMDB IDs via progress callback`);
          updatedTitles.length = 0; // Clear after saving
        } catch (error) {
          this.logger.error(`[${providerId}] Error saving accumulated titles for ${type}: ${error.message}`);
        }
      }
      
      // Save ignored titles if changed since last save
      const currentIgnoredCount = Object.keys(ignoredTitles).length;
      if (currentIgnoredCount !== lastSavedIgnoredCount) {
        try {
          providerInstance.saveIgnoredTitles(type, ignoredTitles);
          this.logger.debug(`[${providerId}] Saved ignored ${type} titles via progress callback`);
          lastSavedIgnoredCount = currentIgnoredCount;
        } catch (error) {
          this.logger.error(`[${providerId}] Error saving ignored titles for ${type}: ${error.message}`);
        }
      }
    };

    // Register this type for progress tracking with save callback
    // Use a unique key to avoid conflicts with fetchMetadata progress tracking
    const progressKey = `tmdb_${type}`;
    providerInstance.registerProgress(progressKey, totalRemaining, saveCallback);

    // Process titles in batches for progress reporting and memory efficiency
    // Note: TMDB provider's limiter handles actual rate limiting internally
    try {
      for (let i = 0; i < titlesWithoutTMDB.length; i += batchSize) {
        const batch = titlesWithoutTMDB.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async (title) => {
          // Skip if already ignored (they won't be reprocessed)
          if (ignoredTitles.hasOwnProperty(title.title_id)) {
            ignoredCount++;
            return;
          }

          const tmdbId = await this.tmdbProvider.matchTMDBIdForTitle(title, type, providerType);
          
          if (tmdbId) {
            title.tmdb_id = tmdbId;
            title.lastUpdated = new Date().toISOString();
            updatedTitles.push(title);
            matchedCount++;
            
            // Remove from ignored list if it was previously ignored
            if (ignoredTitles.hasOwnProperty(title.title_id)) {
              delete ignoredTitles[title.title_id];
            }
          } else {
            // Add to ignored list with reason
            ignoredTitles[title.title_id] = 'TMDB matching failed';
            ignoredCount++;
          }
        }));

        totalRemaining = titlesWithoutTMDB.length - (matchedCount + ignoredCount);
        
        // Update progress tracking (triggers save callback every 30 seconds if configured)
        providerInstance.updateProgress(progressKey, totalRemaining);

        // Log progress every batch
        if ((i + batchSize) % 100 === 0 || i + batchSize >= titlesWithoutTMDB.length) {
          this.logger.debug(`[${providerId}] Progress: ${Math.min(i + batchSize, titlesWithoutTMDB.length)}/${titlesWithoutTMDB.length} ${type} titles processed (${matchedCount} matched, ${ignoredCount} ignored)`);
        }
      }
    } finally {
      // Save any remaining accumulated titles before unregistering
      await saveCallback();
      
      // Unregister this type from progress tracking (will also call save callback)
      providerInstance.unregisterProgress(progressKey);
    }

    return { matched: matchedCount, ignored: ignoredCount };
  }

  /**
   * Match TMDB IDs for all provider titles across all providers
   * Matches titles that don't have a TMDB ID using multiple strategies:
   * 1. For AGTV provider: use title_id (IMDB ID) directly
   * 2. Fallback: search by title name
   * 3. If both fail: mark as ignored for future re-matching
   * @returns {Promise<void>}
   */
  async matchAllTMDBIds() {
    if (this.providers.size === 0) {
      this.logger.warn('No providers available for TMDB ID matching.');
      return;
    }

    this.logger.debug(`Starting TMDB ID matching process for ${this.providers.size} provider(s)...`);
    
    for (const [providerId, providerInstance] of this.providers) {
      try {
        this.logger.info(`[${providerId}] Processing TMDB ID matching...`);
        
        const [moviesResult, tvShowsResult] = await Promise.all([
          this._matchTMDBIdsForProviderType(providerInstance, providerId, 'movies'),
          this._matchTMDBIdsForProviderType(providerInstance, providerId, 'tvshows')
        ]);

        this.logger.info(
          `[${providerId}] TMDB ID matching completed: ` +
          `Movies - ${moviesResult.matched} matched, ${moviesResult.ignored} ignored; ` +
          `TV Shows - ${tvShowsResult.matched} matched, ${tvShowsResult.ignored} ignored`
        );
      } catch (error) {
        this.logger.error(`[${providerId}] Error during TMDB ID matching: ${error.message}`);
      }
    }

    this.logger.info('TMDB ID matching process completed');
  }

  /**
   * Generate main titles from all provider titles with TMDB IDs
   * Groups provider titles by TMDB ID and creates main titles using TMDB API data
   * @returns {Promise<{movies: number, tvShows: number}>} Count of generated main titles
   */
  async generateMainTitles() {
    if (this.providers.size === 0) {
      this.logger.warn('No providers available for main title generation.');
      return { movies: 0, tvShows: 0 };
    }

    this.logger.info('Starting main title generation process...');
    const batchSize = this.tmdbProvider.getRecommendedBatchSize();

    // Process movies and TV shows separately
    const [moviesCount, tvShowsCount] = await Promise.all([
      this._generateMainTitlesForType('movies', batchSize),
      this._generateMainTitlesForType('tvshows', batchSize)
    ]);

    this.logger.info(
      `Main title generation completed: ${moviesCount} movies, ${tvShowsCount} TV shows`
    );

    return { movies: moviesCount, tvShows: tvShowsCount };
  }

  /**
   * Generate main titles for a specific type (movies or tvshows)
   * @private
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @param {number} batchSize - Batch size for processing
   * @returns {Promise<number>} Count of generated main titles
   */
  async _generateMainTitlesForType(type, batchSize) {
    // Collect all provider titles with TMDB IDs
    const providerTitlesByTMDB = new Map(); // Map<tmdbId, Array<{providerId, title}>>

    for (const [providerId, providerInstance] of this.providers) {
      const titles = providerInstance.loadTitles(type);
      
      titles.forEach(title => {
        if (title.tmdb_id) {
          const tmdbId = title.tmdb_id;
          
          if (!providerTitlesByTMDB.has(tmdbId)) {
            providerTitlesByTMDB.set(tmdbId, []);
          }
          
          providerTitlesByTMDB.get(tmdbId).push({
            providerId,
            title
          });
        }
      });
    }

    if (providerTitlesByTMDB.size === 0) {
      this.logger.info(`No ${type} with TMDB IDs found for main title generation`);
      return 0;
    }

    this.logger.info(`Generating ${providerTitlesByTMDB.size} main ${type} titles...`);

    const uniqueTMDBIds = Array.from(providerTitlesByTMDB.keys());
    const mainTitles = [];
    let processedCount = 0;

    // Load existing main titles to preserve createdAt timestamps
    const existingMainTitles = this.data.get('main', `${type}.json`) || [];
    const existingMainTitleMap = new Map(
      existingMainTitles.map(t => [t.title_id, t])
    );

    // Track remaining titles for progress
    let totalRemaining = uniqueTMDBIds.length;

    // Save callback for progress tracking
    const saveCallback = async () => {
      if (mainTitles.length > 0) {
        try {
          await this._saveMainTitles(type, mainTitles, existingMainTitleMap);
          this.logger.debug(`Saved ${mainTitles.length} accumulated main ${type} titles via progress callback`);
          mainTitles.length = 0; // Clear after saving
        } catch (error) {
          this.logger.error(`Error saving accumulated main ${type} titles: ${error.message}`);
        }
      }
    };

    // Register for progress tracking
    const progressKey = `main_${type}`;
    this.tmdbProvider.registerProgress(progressKey, totalRemaining, saveCallback);

    try {
      // Process in batches
      for (let i = 0; i < uniqueTMDBIds.length; i += batchSize) {
        const batch = uniqueTMDBIds.slice(i, i + batchSize);

        await Promise.all(batch.map(async (tmdbId) => {
          const providerTitleGroups = providerTitlesByTMDB.get(tmdbId);
          
          const mainTitle = await this.tmdbProvider.generateMainTitle(
            tmdbId,
            type,
            providerTitleGroups
          );

          if (mainTitle) {
            // Preserve createdAt if title already exists
            const existing = existingMainTitleMap.get(tmdbId);
            if (existing && existing.createdAt) {
              mainTitle.createdAt = existing.createdAt;
            }
            
            mainTitles.push(mainTitle);
            processedCount++;
          }
        }));

        totalRemaining = uniqueTMDBIds.length - processedCount;
        this.tmdbProvider.updateProgress(progressKey, totalRemaining);

        // Log progress
        if ((i + batchSize) % 100 === 0 || i + batchSize >= uniqueTMDBIds.length) {
          this.logger.debug(
            `Progress: ${Math.min(i + batchSize, uniqueTMDBIds.length)}/${uniqueTMDBIds.length} ` +
            `${type} main titles processed`
          );
        }
      }
    } finally {
      // Save any remaining accumulated titles
      await saveCallback();
      
      // Unregister from progress tracking
      this.tmdbProvider.unregisterProgress(progressKey);
    }

    // Final save to ensure all titles are saved
    if (mainTitles.length > 0) {
      await this._saveMainTitles(type, mainTitles, existingMainTitleMap);
    }

    return processedCount;
  }

  /**
   * Save main titles to data directory
   * @private
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @param {Array<Object>} newMainTitles - Array of new main titles to save
   * @param {Map<number, Object>} existingMainTitleMap - Map of existing main titles by title_id
   * @returns {Promise<void>}
   */
  async _saveMainTitles(type, newMainTitles, existingMainTitleMap) {
    const cacheKey = ['main', `${type}.json`];
    const existingTitles = this.data.get(...cacheKey) || [];

    // Create map of new titles by title_id
    const newTitleMap = new Map(newMainTitles.map(t => [t.title_id, t]));

    // Merge: update existing titles that are in newTitles, keep others unchanged
    const updatedTitles = existingTitles.map(existing => {
      const updated = newTitleMap.get(existing.title_id);
      return updated || existing;
    });

    // Add new titles that don't exist yet
    const existingIds = new Set(existingTitles.map(t => t.title_id));
    newMainTitles.forEach(newTitle => {
      if (!existingIds.has(newTitle.title_id)) {
        updatedTitles.push(newTitle);
      }
    });

    // Sort by title_id for consistency
    updatedTitles.sort((a, b) => a.title_id - b.title_id);

    try {
      this.data.set(updatedTitles, ...cacheKey);
      this.logger.info(`Saved ${newMainTitles.length} main ${type} titles (total: ${updatedTitles.length})`);
    } catch (error) {
      this.logger.error(`Error saving main ${type} titles: ${error.message}`);
      throw error;
    }
  }

  /**
   * Enrich main titles with similar titles
   * Fetches similar titles from TMDB API, filters to only include titles available in main titles,
   * and stores the filtered title_ids under the 'similar' property as an array
   * @returns {Promise<void>}
   */
  async enrichSimilarTitles() {
    this.logger.info('Starting similar titles enrichment process...');
    const batchSize = this.tmdbProvider.getRecommendedBatchSize();

    // Process movies and TV shows separately
    await Promise.all([
      this._enrichSimilarTitlesForType('movies', batchSize),
      this._enrichSimilarTitlesForType('tvshows', batchSize)
    ]);

    this.logger.info('Similar titles enrichment completed');
  }

  /**
   * Enrich similar titles for a specific type (movies or tvshows)
   * @private
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @param {number} batchSize - Batch size for processing
   * @returns {Promise<void>}
   */
  async _enrichSimilarTitlesForType(type, batchSize) {
    // Load all main titles for this type
    const mainTitles = this.data.get('main', `${type}.json`) || [];
    
    if (mainTitles.length === 0) {
      this.logger.info(`No ${type} main titles found for similar titles enrichment`);
      return;
    }

    // Create a Set of available title_ids for fast lookup
    const availableTitleIds = new Set(mainTitles.map(t => t.title_id));
    
    this.logger.info(`Enriching similar titles for ${mainTitles.length} main ${type} titles...`);

    const tmdbType = type === 'movies' ? 'movie' : 'tv';
    const updatedTitles = [];
    let processedCount = 0;

    // Load existing main titles to preserve other properties
    const existingMainTitles = this.data.get('main', `${type}.json`) || [];
    const existingMainTitleMap = new Map(
      existingMainTitles.map(t => [t.title_id, t])
    );

    // Save callback for progress tracking
    const saveCallback = async () => {
      if (updatedTitles.length > 0) {
        try {
          await this._saveMainTitles(type, updatedTitles, existingMainTitleMap);
          this.logger.debug(`Saved ${updatedTitles.length} accumulated ${type} titles with similar titles via progress callback`);
          updatedTitles.length = 0; // Clear after saving
        } catch (error) {
          this.logger.error(`Error saving accumulated ${type} titles: ${error.message}`);
        }
      }
    };

    // Register for progress tracking
    const progressKey = `similar_${type}`;
    let totalRemaining = mainTitles.length;
    this.tmdbProvider.registerProgress(progressKey, totalRemaining, saveCallback);

    try {
      // Process in batches
      for (let i = 0; i < mainTitles.length; i += batchSize) {
        const batch = mainTitles.slice(i, i + batchSize);

        await Promise.all(batch.map(async (mainTitle) => {
          try {
            const similarTitleIds = await this._fetchSimilarTitleIds(
              tmdbType,
              mainTitle.title_id,
              availableTitleIds
            );

            // Create updated title with similar titles
            const updatedTitle = {
              ...existingMainTitleMap.get(mainTitle.title_id) || mainTitle,
              similar: similarTitleIds
            };

            updatedTitles.push(updatedTitle);
            processedCount++;
          } catch (error) {
            this.logger.error(`Error enriching similar titles for ${type} ID ${mainTitle.title_id}: ${error.message}`);
            // Still add the title without similar titles to preserve it
            const existingTitle = existingMainTitleMap.get(mainTitle.title_id) || mainTitle;
            if (!existingTitle.similar) {
              existingTitle.similar = [];
            }
            updatedTitles.push(existingTitle);
          }
        }));

        totalRemaining = mainTitles.length - processedCount;
        this.tmdbProvider.updateProgress(progressKey, totalRemaining);

        // Log progress
        if ((i + batchSize) % 100 === 0 || i + batchSize >= mainTitles.length) {
          this.logger.debug(
            `Progress: ${Math.min(i + batchSize, mainTitles.length)}/${mainTitles.length} ` +
            `${type} titles processed for similar titles enrichment`
          );
        }
      }
    } finally {
      // Save any remaining accumulated titles
      await saveCallback();
      
      // Unregister from progress tracking
      this.tmdbProvider.unregisterProgress(progressKey);
    }

    // Final save to ensure all titles are saved
    if (updatedTitles.length > 0) {
      await this._saveMainTitles(type, updatedTitles, existingMainTitleMap);
    }

    this.logger.info(`Similar titles enrichment completed for ${processedCount} ${type} titles`);
  }

  /**
   * Fetch all similar title IDs for a given TMDB ID, handling pagination
   * Only returns title_ids that exist in the available titles set
   * Limited to a maximum of 10 pages
   * @private
   * @param {string} tmdbType - TMDB type ('movie' or 'tv')
   * @param {number} tmdbId - TMDB ID
   * @param {Set<number>} availableTitleIds - Set of available title IDs from main titles
   * @returns {Promise<Array<number>>} Array of similar title IDs that exist in main titles
   */
  async _fetchSimilarTitleIds(tmdbType, tmdbId, availableTitleIds) {
    const similarTitleIds = [];
    let page = 1;
    const maxPages = 10; // Limit to 10 pages
    let hasMorePages = true;

    while (hasMorePages && page <= maxPages) {
      try {
        const response = await this.tmdbProvider.getSimilar(tmdbType, tmdbId, page);
        
        if (!response || !response.results) {
          break;
        }

        // Filter results to only include titles that exist in main titles
        const filteredIds = response.results
          .map(result => result.id)
          .filter(id => availableTitleIds.has(id));

        similarTitleIds.push(...filteredIds);

        // Check if there are more pages (but respect maxPages limit)
        const totalPages = response.total_pages || 1;
        hasMorePages = page < totalPages && page < maxPages;
        page++;
      } catch (error) {
        this.logger.error(`Error fetching similar titles page ${page} for ${tmdbType} ID ${tmdbId}: ${error.message}`);
        break;
      }
    }

    return similarTitleIds;
  }
}

