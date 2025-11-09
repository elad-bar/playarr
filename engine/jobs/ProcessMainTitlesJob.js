import { BaseJob } from './BaseJob.js';
import { generateTitleKey } from '../utils/titleUtils.js';

/**
 * Job for processing main titles
 * Handles TMDB ID matching and main title generation from provider titles
 * @extends {BaseJob}
 */
export class ProcessMainTitlesJob extends BaseJob {
  /**
   * @param {import('../managers/StorageManager.js').StorageManager} cache - Storage manager instance for temporary cache
   * @param {import('../services/MongoDataService.js').MongoDataService} mongoData - MongoDB data service instance
   * @param {Map<string, import('../providers/BaseIPTVProvider.js').BaseIPTVProvider>} providers - Map of providerId -> provider instance (already initialized)
   * @param {import('../providers/TMDBProvider.js').TMDBProvider} tmdbProvider - TMDB provider singleton instance
   */
  constructor(cache, mongoData, providers, tmdbProvider) {
    super('ProcessMainTitlesJob', cache, mongoData, providers, tmdbProvider);
  }

  /**
   * Execute the job - match TMDB IDs and generate main titles (incremental)
   * Processes only titles updated since last execution
   * @returns {Promise<{movies: number, tvShows: number}>} Count of generated main titles by type (for reporting)
   */
  async execute() {
    this._validateDependencies();

    const jobName = 'ProcessMainTitlesJob';
    let lastExecution = null;

    try {
      // Check if ProcessProvidersTitlesJob is currently running
      // This prevents processMainTitles from running while providers are being fetched
      const providersJobHistory = await this.mongoData.getJobHistory('ProcessProvidersTitlesJob');
      if (providersJobHistory && providersJobHistory.status === 'running') {
        this.logger.info('Skipping execution - ProcessProvidersTitlesJob is currently running. Will retry on next schedule.');
        return { movies: 0, tvShows: 0 }; // Return empty result to indicate skip
      }

      // Get last execution time from job history BEFORE setting status
      // This ensures we have the correct last_execution value from previous successful run
      const jobHistory = await this.mongoData.getJobHistory(jobName);
      if (jobHistory && jobHistory.last_execution) {
        lastExecution = new Date(jobHistory.last_execution);
        this.logger.info(`Last execution: ${lastExecution.toISOString()}. Processing incremental update.`);
      } else {
        this.logger.info('No previous execution found. Processing full update.');
      }

      // Set status to "running" at start (after reading last_execution)
      await this.mongoData.updateJobStatus(jobName, 'running');

      // Load provider titles incrementally (only updated since last execution)
      for (const [providerId, providerInstance] of this.providers) {
        await providerInstance.loadProviderTitles(lastExecution);
      }

      // Match TMDB IDs for provider titles that don't have one yet
      await this.matchAllTMDBIds();

      // Load main titles for provider titles that have TMDB IDs
      // Main titles use title_key = type-tmdb_id, not type-title_id
      const mainTitleKeys = new Set();
      for (const [providerId, providerInstance] of this.providers) {
        for (const title of providerInstance.getAllTitles()) {
          if (title.tmdb_id && title.type) {
            mainTitleKeys.add(generateTitleKey(title.type, title.tmdb_id));
          }
        }
      }
      
      if (mainTitleKeys.size > 0) {
        const mainTitles = await this.tmdbProvider.getMainTitlesByKeys(Array.from(mainTitleKeys));
        this.tmdbProvider._mainTitlesCache = mainTitles;
      } else {
        this.tmdbProvider._mainTitlesCache = [];
      }

      // Extract provider titles into dictionary for main title processing
      const providerTitlesByProvider = new Map();
      for (const [providerId, providerInstance] of this.providers) {
        providerTitlesByProvider.set(providerId, providerInstance.getAllTitles());
      }

      // Delegate main title processing to TMDBProvider
      // It will only process titles that need regeneration based on provider title updates
      const result = await this.tmdbProvider.processMainTitles(providerTitlesByProvider);

      // Update job history
      await this.mongoData.updateJobHistory(jobName, {
        movies_processed: result.movies,
        tvshows_processed: result.tvShows
      });

      // Set status to completed on success
      await this.mongoData.updateJobStatus(jobName, 'completed');

      return result;
    } catch (error) {
      this.logger.error(`Job execution failed: ${error.message}`);
      
      await this.mongoData.updateJobStatus(jobName, 'failed');
      // Update job history with error
      await this.mongoData.updateJobHistory(jobName, {
        error: error.message
      }).catch(err => {
        this.logger.error(`Failed to update job history: ${err.message}`);
      });
      throw error;
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

    // Get recommended batch size from TMDB provider
    const batchSize = this.tmdbProvider.getRecommendedBatchSize();
    
    let matchedCount = 0;
    let ignoredCount = 0;
    const updatedTitles = [];
    
    // Track matched by type for return value calculation only
    const matchedCountByType = { movies: 0, tvshows: 0 };
    
    // Track ignored by type for return value calculation
    const ignoredCountByType = { movies: 0, tvshows: 0 };
    
    // Track remaining titles for progress
    let totalRemaining = titlesWithoutTMDB.length;
    
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
      
      // Save accumulated ignored titles for each type
      for (const type of ['movies', 'tvshows']) {
        if (providerInstance._accumulatedIgnoredTitles[type] && 
            Object.keys(providerInstance._accumulatedIgnoredTitles[type]).length > 0) {
          try {
            // Convert title_id to title_key format and save directly
            const ignoredByTitleKey = Object.fromEntries(
              Object.entries(providerInstance._accumulatedIgnoredTitles[type]).map(([titleId, reason]) => [
                `${type}-${titleId}`,
                reason
              ])
            );
            await providerInstance.saveAllIgnoredTitles(ignoredByTitleKey);
            const count = Object.keys(providerInstance._accumulatedIgnoredTitles[type]).length;
            this.logger.debug(`[${providerId}] Saved ${count} accumulated ignored ${type} title(s) via progress callback`);
            providerInstance._accumulatedIgnoredTitles[type] = {}; // Clear after saving
          } catch (error) {
            this.logger.error(`[${providerId}] Error saving accumulated ignored titles for ${type}: ${error.message}`);
          }
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
          const titleId = title.title_id;

          const tmdbId = await this.tmdbProvider.matchTMDBIdForTitle(title, type, providerType);
          
          if (tmdbId) {
            title.tmdb_id = tmdbId;
            title.lastUpdated = new Date().toISOString();
            updatedTitles.push(title);
            matchedCount++;
            
            // Track by type for return value
            if (type === 'movies') matchedCountByType.movies++;
            else if (type === 'tvshows') matchedCountByType.tvshows++;
          } else {
            // Mark as ignored - will be saved via saveCallback
            providerInstance.addIgnoredTitle(type, titleId, 'TMDB matching failed');
            ignoredCount++;
            
            // Track by type for return value
            if (type === 'movies') ignoredCountByType.movies++;
            else if (type === 'tvshows') ignoredCountByType.tvshows++;
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

