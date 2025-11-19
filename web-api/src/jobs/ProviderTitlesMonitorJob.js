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
   * @param {import('../repositories/ProviderRepository.js').ProviderRepository} providerRepo - Provider repository
   * @param {import('../repositories/ProviderTitleRepository.js').ProviderTitleRepository} providerTitleRepo - Provider title repository
   * @param {import('../repositories/TitleRepository.js').TitleRepository} titleRepo - Title repository
   * @param {import('../repositories/JobHistoryRepository.js').JobHistoryRepository} jobHistoryRepo - Job history repository
   * @param {import('../managers/providers.js').ProvidersManager} providersManager - Providers manager for direct API calls
   * @param {import('../managers/tmdb.js').TMDBManager} tmdbManager - TMDB manager for direct API calls
   * @param {import('../providers/TMDBProvider.js').TMDBProvider} tmdbProvider - TMDB provider for direct API calls
   */
  constructor(jobName, providerRepo, providerTitleRepo, titleRepo, jobHistoryRepo, providersManager, tmdbManager, tmdbProvider) {
    super(jobName, providerRepo, providerTitleRepo, titleRepo, jobHistoryRepo, providersManager, tmdbManager, tmdbProvider);
  }

  /**
   * Execute the job - process provider titles that changed since last execution
   * @returns {Promise<{movies: number, tvShows: number}>} Count of generated main titles by type (for reporting)
   */
  async execute() {
    this._validateDependencies();

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
      this.tmdbHandler = this._createTMDBHandler();
      
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
        const mainTitles = await this.tmdbHandler.getMainTitlesByKeys(Array.from(mainTitleKeys));
        this.tmdbHandler._mainTitlesCache = mainTitles;
      } else {
        this.tmdbHandler._mainTitlesCache = [];
      }

      // Extract provider titles into dictionary for main title processing
      const providerTitlesByProvider = new Map();
      for (const [id, handler] of enabledHandlers) {
        providerTitlesByProvider.set(id, handler.getAllTitles());
      }

      // Delegate main title processing to TMDBHandler
      // It will only process titles that need regeneration based on provider title updates
      const result = await this.tmdbHandler.processMainTitles(providerTitlesByProvider);

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
        if (this.tmdbHandler) {
          this.tmdbHandler.unloadMainTitles();
        }
        this.logger.debug('Memory cleanup completed');
      } catch (error) {
        this.logger.error(`Error during memory cleanup: ${error.message}`);
      }
    }
  }
}

