import { BaseJob } from './BaseJob.js';
import { generateTitleKey } from '../utils/titleUtils.js';

/**
 * Job for processing main titles
 * Handles main title generation from provider titles
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
   * Execute the job - generate main titles from provider titles
   * @param {string} [providerId] - Optional provider ID. If provided, loads all titles for this provider (ignores lastExecution)
   * @returns {Promise<{movies: number, tvShows: number}>} Count of generated main titles by type (for reporting)
   */
  async execute(providerId = null) {
    this._validateDependencies();

    const jobName = 'ProcessMainTitlesJob';
    let lastExecution = null;

    try {
      // Get last execution time from job history BEFORE setting status
      // If providerId is provided, we'll ignore lastExecution for that provider
      const jobHistory = await this.mongoData.getJobHistory(jobName);
      if (jobHistory && jobHistory.last_execution) {
        lastExecution = new Date(jobHistory.last_execution);
        if (providerId) {
          this.logger.info(`Processing all titles for provider ${providerId} (triggered by provider change)`);
        } else {
          this.logger.info(`Last execution: ${lastExecution.toISOString()}. Processing incremental update.`);
        }
      } else {
        this.logger.info('No previous execution found. Processing full update.');
      }

      // Set status to "running" at start (after reading last_execution)
      await this.mongoData.updateJobStatus(jobName, 'running');

      // Load provider titles
      // If providerId is specified, load all titles for that provider (pass null to ignore lastExecution)
      // Otherwise, load incrementally for all providers
      for (const [id, providerInstance] of this.providers) {
        const loadSince = (providerId && id === providerId) ? null : lastExecution;
        await providerInstance.loadProviderTitles(loadSince);
      }

      // Load main titles for provider titles that have TMDB IDs
      // Main titles use title_key = type-tmdb_id, not type-title_id
      const mainTitleKeys = new Set();
      for (const [id, providerInstance] of this.providers) {
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
      for (const [id, providerInstance] of this.providers) {
        providerTitlesByProvider.set(id, providerInstance.getAllTitles());
      }

      // Delegate main title processing to TMDBProvider
      // It will only process titles that need regeneration based on provider title updates
      const result = await this.tmdbProvider.processMainTitles(providerTitlesByProvider);

      // Update job history
      await this.mongoData.updateJobHistory(jobName, {
        movies_processed: result.movies,
        tvshows_processed: result.tvShows,
        ...(providerId ? { triggered_by_provider: providerId } : {})
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
        for (const [id, providerInstance] of this.providers) {
          providerInstance.unloadTitles();
        }
        this.tmdbProvider.unloadMainTitles();
        this.logger.debug('Memory cleanup completed');
      } catch (error) {
        this.logger.error(`Error during memory cleanup: ${error.message}`);
      }
    }
  }

}

