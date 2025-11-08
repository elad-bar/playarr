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
   * Processes all titles together internally, returns counts by type for reporting
   * @returns {Promise<{movies: number, tvShows: number}>} Count of generated main titles by type (for reporting)
   */
  async execute() {
    this._validateDependencies();

    try {
      // Load all provider titles and main titles into memory once at the start
      // This ensures all subsequent operations use cached data instead of reading from disk
      this.logger.info('Loading all provider titles and main titles into memory...');
      for (const [providerId, providerInstance] of this.providers) {
        providerInstance.loadAllTitles();
        providerInstance.getAllIgnored(); // Initialize ignored cache as well
      }
      // Load main titles into memory (managed by TMDBProvider)
      this.tmdbProvider.loadMainTitles();
      this.logger.info(`All provider titles and main titles loaded into memory (${this.tmdbProvider.getMainTitles().length} main titles)`);

      // Match TMDB IDs for all provider titles
      await this.matchAllTMDBIds();

      // Extract provider titles into dictionary for main title processing
      const providerTitlesByProvider = new Map();
      for (const [providerId, providerInstance] of this.providers) {
        providerTitlesByProvider.set(providerId, providerInstance.getAllTitles());
      }

      // Delegate main title processing to TMDBProvider
      const result = await this.tmdbProvider.processMainTitles(providerTitlesByProvider);

      return result;
    } finally {
      // Unload titles from memory to free resources
      try {
        this.logger.debug('Unloading titles from memory cache...');
        for (const [providerId, providerInstance] of this.providers) {
          providerInstance.unloadTitles();
        }
        this.tmdbProvider.unloadMainTitles();
        this.logger.debug('Memory cleanup completed');
      } catch (error) {
        this.logger.error(`Error during memory cleanup: ${error.message}`);
      }
    }
  }

  /**
   * Match TMDB IDs for all titles of a provider
   * @private
   * @param {import('../providers/BaseIPTVProvider.js').BaseIPTVProvider} providerInstance - Provider instance
   * @param {string} providerId - Provider identifier
   * @returns {Promise<{movies: {matched: number, ignored: number}, tvShows: {matched: number, ignored: number}}>} Results by type for reporting
   */
  async _matchTMDBIdsForProvider(providerInstance, providerId) {
    // Get titles from provider's in-memory cache
    const allTitles = providerInstance.getAllTitles();
    const providerType = providerInstance.getProviderType();
    
    // Filter titles without TMDB ID
    const titlesWithoutTMDB = allTitles.filter(t => !t.tmdb_id);

    if (titlesWithoutTMDB.length === 0) {
      this.logger.info(`[${providerId}] All titles already have TMDB IDs`);
      return { movies: { matched: 0, ignored: 0 }, tvShows: { matched: 0, ignored: 0 } };
    }

    this.logger.debug(`[${providerId}] Matching TMDB IDs for ${titlesWithoutTMDB.length} titles...`);

    // Get ignored titles from provider's in-memory cache
    const allIgnored = providerInstance.getAllIgnored();
    const initialIgnoredCount = Object.keys(allIgnored).length;
    
    // Count initial ignored by type (for return value calculation)
    const initialIgnoredByType = { movies: 0, tvshows: 0 };
    for (const titleKey of Object.keys(allIgnored)) {
      if (titleKey.startsWith('movies-')) initialIgnoredByType.movies++;
      else if (titleKey.startsWith('tvshows-')) initialIgnoredByType.tvshows++;
    }
    
    // Get recommended batch size from TMDB provider
    const batchSize = this.tmdbProvider.getRecommendedBatchSize();
    
    let matchedCount = 0;
    let ignoredCount = 0;
    const updatedTitles = [];
    
    // Track matched by type for return value calculation only
    const matchedCountByType = { movies: 0, tvshows: 0 };
    
    // Track remaining titles for progress
    let totalRemaining = titlesWithoutTMDB.length;
    
    // Track last saved ignored count to avoid saving unchanged state
    let lastSavedIgnoredCount = initialIgnoredCount;
    
    // Save callback for progress tracking (called every 30 seconds and on completion)
    const saveCallback = async () => {
      // Save all updated titles together
      if (updatedTitles.length > 0) {
        try {
          await providerInstance.saveTitles(null, updatedTitles);
          this.logger.debug(`[${providerId}] Saved ${updatedTitles.length} accumulated titles with TMDB IDs via progress callback`);
        } catch (error) {
          this.logger.error(`[${providerId}] Error saving accumulated titles: ${error.message}`);
        }
        updatedTitles.length = 0; // Clear after saving
      }
      
      // Save all ignored titles together if changed since last save
      const currentIgnoredCount = Object.keys(allIgnored).length;
      if (currentIgnoredCount !== lastSavedIgnoredCount) {
        try {
          await providerInstance.saveAllIgnoredTitles(allIgnored);
          this.logger.debug(`[${providerId}] Saved ignored titles via progress callback`);
          lastSavedIgnoredCount = currentIgnoredCount;
        } catch (error) {
          this.logger.error(`[${providerId}] Error saving ignored titles: ${error.message}`);
        }
      }
    };

    // Register for progress tracking with save callback
    const progressKey = `tmdb_all`;
    providerInstance.registerProgress(progressKey, totalRemaining, saveCallback);

    // Process titles in batches for progress reporting and memory efficiency
    // Note: TMDB provider's limiter handles actual rate limiting internally
    try {
      for (let i = 0; i < titlesWithoutTMDB.length; i += batchSize) {
        const batch = titlesWithoutTMDB.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async (title) => {
          const type = title.type;
          const titleKey = `${type}-${title.title_id}`;
          
          // Skip if already ignored (they won't be reprocessed)
          if (allIgnored.hasOwnProperty(titleKey)) {
            ignoredCount++;
            return;
          }

          const tmdbId = await this.tmdbProvider.matchTMDBIdForTitle(title, type, providerType);
          
          if (tmdbId) {
            title.tmdb_id = tmdbId;
            title.lastUpdated = new Date().toISOString();
            updatedTitles.push(title);
            matchedCount++;
            
            // Track by type for return value
            if (type === 'movies') matchedCountByType.movies++;
            else if (type === 'tvshows') matchedCountByType.tvshows++;
            
            // Remove from ignored list if it was previously ignored
            if (allIgnored.hasOwnProperty(titleKey)) {
              delete allIgnored[titleKey];
            }
          } else {
            // Add to ignored list with reason
            allIgnored[titleKey] = 'TMDB matching failed';
            ignoredCount++;
          }
        }));

        totalRemaining = titlesWithoutTMDB.length - (matchedCount + ignoredCount);
        
        // Update progress tracking (triggers save callback every 30 seconds if configured)
        providerInstance.updateProgress(progressKey, totalRemaining);

        // Log progress every batch
        if ((i + batchSize) % 100 === 0 || i + batchSize >= titlesWithoutTMDB.length) {
          this.logger.debug(`[${providerId}] Progress: ${Math.min(i + batchSize, titlesWithoutTMDB.length)}/${titlesWithoutTMDB.length} titles processed (${matchedCount} matched, ${ignoredCount} ignored)`);
        }
      }
    } finally {
      // Save any remaining accumulated titles before unregistering
      await saveCallback();
      
      // Unregister from progress tracking (will also call save callback)
      providerInstance.unregisterProgress(progressKey);
    }

    // Calculate results by type for return value (for reporting/logging)
    const ignoredCountByType = { movies: 0, tvshows: 0 };
    
    // Count ignored by type from allIgnored changes
    const finalIgnoredByType = { movies: 0, tvshows: 0 };
    for (const titleKey of Object.keys(allIgnored)) {
      if (titleKey.startsWith('movies-')) finalIgnoredByType.movies++;
      else if (titleKey.startsWith('tvshows-')) finalIgnoredByType.tvshows++;
    }
    
    ignoredCountByType.movies = finalIgnoredByType.movies - initialIgnoredByType.movies;
    ignoredCountByType.tvshows = finalIgnoredByType.tvshows - initialIgnoredByType.tvshows;

    return {
      movies: { 
        matched: matchedCountByType.movies, 
        ignored: ignoredCountByType.movies
      },
      tvShows: { 
        matched: matchedCountByType.tvshows, 
        ignored: ignoredCountByType.tvshows
      }
    };
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
        
        // Process all titles together, handling by type internally
        // Titles are already loaded into memory in execute()
        const result = await this._matchTMDBIdsForProvider(providerInstance, providerId);

        const totalMatched = result.movies.matched + result.tvShows.matched;
        const totalIgnored = result.movies.ignored + result.tvShows.ignored;
        this.logger.info(
          `[${providerId}] TMDB ID matching completed: ${totalMatched} matched, ${totalIgnored} ignored ` +
          `(Movies: ${result.movies.matched} matched, ${result.movies.ignored} ignored; ` +
          `TV Shows: ${result.tvShows.matched} matched, ${result.tvShows.ignored} ignored)`
        );
      } catch (error) {
        this.logger.error(`[${providerId}] Error during TMDB ID matching: ${error.message}`);
      }
    }

    this.logger.info('TMDB ID matching process completed');
  }


}

