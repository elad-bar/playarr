import { BaseJob } from './BaseJob.js';
import { generateTitleKey } from '../utils/titleUtils.js';

/**
 * Job for monitoring provider titles changes
 * Monitors provider titles for changes and processes them incrementally
 * @extends {BaseJob}
 */
export class ProviderTitlesMonitorJob extends BaseJob {
  /**
   * @param {string} jobName - Name identifier for this job (used in logging)
   * @param {import('../managers/domain/JobHistoryManager.js').JobHistoryManager} jobHistoryManager - Job history manager
   * @param {import('../managers/orchestration/ProvidersManager.js').ProvidersManager} providersManager - Providers manager for direct API calls
   * @param {import('../managers/domain/TMDBManager.js').TMDBManager} tmdbManager - TMDB manager for API calls
   * @param {import('../managers/domain/TitlesManager.js').TitlesManager} titlesManager - Titles manager
   * @param {import('../managers/domain/ProviderTitlesManager.js').ProviderTitlesManager} providerTitlesManager - Provider titles manager
   * @param {import('../services/metrics.js').default} metricsService - Metrics service for recording counters
   */
  constructor(jobName, jobHistoryManager, providersManager, tmdbManager, titlesManager, providerTitlesManager, metricsService) {
    super(jobName, jobHistoryManager, providersManager, tmdbManager, titlesManager, providerTitlesManager, metricsService);
  }

  /**
   * Execute the job - process provider titles that changed since last execution
   * @returns {Promise<{movies: number, tvShows: number}>} Count of generated main titles by type (for reporting)
   */
  async execute() {
    try {
      // Get last execution time from job history BEFORE setting status
      const lastExecution = await this.getLastExecution({
        fallbackDate: null,
        logMessage: 'Last execution: {date}. Processing incremental update.',
        noExecutionMessage: 'No previous execution found. Processing full update.'
      });

      // Set status to "running" at start (after reading last_execution)
      await this.setJobStatus('running');

      // Create handler instances for all providers
      this.handlers = await this._createHandlers();
      this.tmdbProcessingManager = this._createTMDBProcessingManager();
      
      if (this.handlers.size === 0) {
        this.logger.warn('No handlers created. No providers configured or all failed to initialize.');
        await this.setJobStatus('completed', {
          movies_processed: 0,
          tvshows_processed: 0
        });
        return { movies: 0, tvShows: 0 };
      }

      // Filter to only enabled, non-deleted providers
      const enabledHandlers = Array.from(this.handlers.entries())
        .filter(([id, handler]) => {
          const config = handler.providerData;
          return config.enabled && !config.deleted;
        });

      // Load provider titles that changed since lastExecution
      for (const [id, handler] of enabledHandlers) {
        await handler.loadProviderTitles(lastExecution);
      }

      // Load main titles for provider titles that have TMDB IDs
      // Main titles use title_key = type-tmdb_id, not type-title_id
      const mainTitleKeys = new Set();
      for (const [id, handler] of enabledHandlers) {
        for (const title of handler.getAllTitles()) {
          if (title.tmdb_id && title.type) {
            mainTitleKeys.add(generateTitleKey(title.type, title.tmdb_id));
          }
        }
      }
      
      if (mainTitleKeys.size > 0) {
        const mainTitles = await this.tmdbProcessingManager.getMainTitlesByKeys(Array.from(mainTitleKeys));
        this.tmdbProcessingManager._mainTitlesCache = mainTitles;
      } else {
        this.tmdbProcessingManager._mainTitlesCache = [];
      }

      // Extract provider titles into dictionary for main title processing
      const providerTitlesByProvider = new Map();
      for (const [id, handler] of enabledHandlers) {
        providerTitlesByProvider.set(id, handler.getAllTitles());
      }

      // Delegate main title processing to TMDBProcessingManager
      // It will only process titles that need regeneration based on provider title updates
      const result = await this.tmdbProcessingManager.processMainTitles(providerTitlesByProvider);

      // Update metrics for processed main titles per provider
      if (result.byProvider) {
        for (const [providerId, counts] of result.byProvider) {
          if (counts.movies !== undefined && counts.movies !== null && counts.movies > 0) {
            this.metricsService.incrementCounter('main_titles_processed', { provider_id: providerId, media_type: 'movies' }, counts.movies);
          }
          if (counts.tvShows !== undefined && counts.tvShows !== null && counts.tvShows > 0) {
            this.metricsService.incrementCounter('main_titles_processed', { provider_id: providerId, media_type: 'tvshows' }, counts.tvShows);
          }
        }
      }

      // Cleanup outdated main titles from disabled/deleted providers
      const allProvidersResult = await this.providersManager.getProviders();
      const disabledProviders = allProvidersResult.providers.filter(p => 
        p.enabled === false || p.deleted === true
      );
      if (disabledProviders.length > 0) {
        await this.tmdbProcessingManager.cleanupOutdatedMainTitles(disabledProviders);
      }

      // Set status to completed on success with result
      await this.setJobStatus('completed', {
        movies_processed: result.movies,
        tvshows_processed: result.tvShows
      });

      return result;
    } catch (error) {
      this.logger.error(`Job execution failed: ${error.message}`);
      
      // Set status to failed with error result
      await this.setJobStatus('failed', {
        error: error.message
      }).catch(err => {
        this.logger.error(`Failed to update job history: ${err.message}`);
      });
      throw error;
    } finally {
      // Unload titles from memory to free resources
      try {
        this.logger.debug('Unloading titles from memory cache...');
        // Filter to enabled handlers for cleanup
        if (this.handlers) {
          const enabledHandlers = Array.from(this.handlers.entries())
            .filter(([id, handler]) => {
              const config = handler.providerData;
              return config.enabled && !config.deleted;
            });
          for (const [id, handler] of enabledHandlers) {
            handler.unloadTitles();
          }
        }
        if (this.tmdbProcessingManager) {
          this.tmdbProcessingManager.unloadMainTitles();
        }
        this.logger.debug('Memory cleanup completed');
      } catch (error) {
        this.logger.error(`Error during memory cleanup: ${error.message}`);
      }
    }
  }
}

