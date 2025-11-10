import { BaseJob } from './BaseJob.js';

/**
 * Job for processing provider titles (fetching metadata from IPTV providers)
 * Handles fetching categories and metadata from all configured IPTV providers,
 * and matching TMDB IDs for provider titles
 * @extends {BaseJob}
 */
export class ProcessProvidersTitlesJob extends BaseJob {
  /**
   * @param {import('../managers/StorageManager.js').StorageManager} cache - Storage manager instance for temporary cache
   * @param {import('../services/MongoDataService.js').MongoDataService} mongoData - MongoDB data service instance
   * @param {Map<string, import('../providers/BaseIPTVProvider.js').BaseIPTVProvider>} providers - Map of providerId -> provider instance (already initialized)
   * @param {import('../providers/TMDBProvider.js').TMDBProvider} tmdbProvider - TMDB provider singleton instance
   */
  constructor(cache, mongoData, providers, tmdbProvider) {
    super('ProcessProvidersTitlesJob', cache, mongoData, providers, tmdbProvider);
  }

  /**
   * Execute the job - fetch categories and metadata from all IPTV providers (incremental)
   * @returns {Promise<Array<{providerId: string, providerName: string, movies?: number, tvShows?: number, error?: string}>>} Array of fetch results
   */
  async execute() {
    this._validateDependencies();

    const jobName = 'ProcessProvidersTitlesJob';
    let lastExecution = null;

    try {
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
      // Include ignored titles for proper comparison and filtering
      for (const [providerId, providerInstance] of this.providers) {
        try {
          await providerInstance.loadProviderTitles(lastExecution, true);
        } catch (error) {
          this.logger.warn(`[${providerId}] Error loading titles from MongoDB: ${error.message}`);
        }
      }

      // Fetch categories from all providers first
      await this.fetchAllCategories();

      // Then fetch metadata from all providers
      const results = await this.fetchAllMetadata();

      // Update job history
      await this.mongoData.updateJobHistory(jobName, {
        providers_processed: this.providers.size,
        results: results
      });

      // Set status to completed on success
      await this.mongoData.updateJobStatus(jobName, 'completed');

      return results;
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
      // Note: fetchMetadata() updates _titlesCache via saveTitles(), so cleanup is needed
      try {
        this.logger.debug('Unloading titles from memory cache...');
        for (const [providerId, providerInstance] of this.providers) {
          providerInstance.unloadTitles();
        }
        this.logger.debug('Memory cleanup completed');
      } catch (error) {
        this.logger.error(`Error during memory cleanup: ${error.message}`);
      }
    }
  }

  /**
   * Fetch categories from a provider instance
   * @param {import('../providers/BaseIPTVProvider.js').BaseIPTVProvider} providerInstance - Provider instance
   * @param {string} providerId - Provider ID
   * @returns {Promise<{movieCats: Array, tvShowCats: Array}>} Categories for movies and TV shows
   */
  async fetchCategoriesFromProvider(providerInstance, providerId) {
    try {
      this.logger.debug(`Fetching categories from provider ${providerId}...`);
      const [movieCats, tvShowCats] = await Promise.all([
        providerInstance.fetchCategories('movies').catch(() => []),
        providerInstance.fetchCategories('tvshows').catch(() => [])
      ]);
      this.logger.info(`Found ${movieCats.length} movie categories, ${tvShowCats.length} TV show categories`);
      return { movieCats, tvShowCats };
    } catch (error) {
      this.logger.error(`Error fetching categories from ${providerId}: ${error.message}`);
      return { movieCats: [], tvShowCats: [] };
    }
  }

  /**
   * Fetch categories from all providers
   * @returns {Promise<void>}
   */
  async fetchAllCategories() {
    this.logger.info(`Fetching categories from ${this.providers.size} provider(s)...`);
    
    for (const [providerId, providerInstance] of this.providers) {
      await this.fetchCategoriesFromProvider(providerInstance, providerId);
    }
  }

  /**
   * Fetch titles metadata (movies and TV shows) from a specific provider instance
   * Fetches movies and TV shows in parallel for better performance
   * @param {import('../providers/BaseIPTVProvider.js').BaseIPTVProvider} providerInstance - Provider instance (AGTVProvider or XtreamProvider)
   * @param {string} providerId - Provider ID
   * @returns {Promise<{movies: number, tvShows: number}>} Count of fetched movies and TV shows
   */
  async fetchMetadataFromProvider(providerInstance, providerId) {
    // Fetch and save movies and TV shows metadata in parallel
    this.logger.info(`Fetching metadata from provider ${providerId}...`);
    
    const [moviesCount, tvShowsCount] = await Promise.all([
      providerInstance.fetchMetadata('movies').catch(err => {
        this.logger.error(`[${providerId}] Error fetching movies: ${err.message}`);
        return 0;
      }),
      providerInstance.fetchMetadata('tvshows').catch(err => {
        this.logger.error(`[${providerId}] Error fetching TV shows: ${err.message}`);
        return 0;
      })
    ]);

    return {
      movies: moviesCount,
      tvShows: tvShowsCount
    };
  }

  /**
   * Fetch metadata from all providers
   * @returns {Promise<Array<{providerId: string, providerName: string, movies?: number, tvShows?: number, error?: string}>>} Array of fetch results
   */
  async fetchAllMetadata() {
    this.logger.info(`Starting metadata fetch process for ${this.providers.size} provider(s)...`);
    const results = [];

    for (const [providerId, providerInstance] of this.providers) {
      try {
        this.logger.debug(`[${providerId}] Processing provider (${providerInstance.getProviderType()})`);
        const result = await this.fetchMetadataFromProvider(providerInstance, providerId);
        results.push({
          providerId,
          providerName: providerId,
          ...result
        });
      } catch (error) {
        this.logger.error(`[${providerId}] Error processing provider: ${error.message}`);
        results.push({
          providerId,
          providerName: providerId,
          error: error.message
        });
      }
    }

    return results;
  }
}

