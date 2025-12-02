import { BaseJob } from './BaseJob.js';

/**
 * Job for processing provider titles (fetching metadata from IPTV providers)
 * Handles fetching metadata from all configured IPTV providers,
 * and matching TMDB IDs for provider titles
 * @extends {BaseJob}
 */
export class SyncIPTVProviderTitlesJob extends BaseJob {
  /**
   * @param {string} jobName - Name identifier for this job (used in logging)
   * @param {import('../managers/domain/JobHistoryManager.js').JobHistoryManager} jobHistoryManager - Job history manager
   * @param {import('../managers/orchestration/ProvidersManager.js').ProvidersManager} providersManager - Providers manager for direct API calls
   * @param {import('../managers/domain/TMDBManager.js').TMDBManager} tmdbManager - TMDB manager for API calls
   * @param {import('../managers/domain/TitlesManager.js').TitlesManager} titlesManager - Titles manager
   * @param {import('../managers/domain/ProviderTitlesManager.js').ProviderTitlesManager} providerTitlesManager - Provider titles manager
   */
  constructor(jobName, jobHistoryManager, providersManager, tmdbManager, titlesManager, providerTitlesManager) {
    super(jobName, jobHistoryManager, providersManager, tmdbManager, titlesManager, providerTitlesManager);
  }

  /**
   * Execute the job - fetch metadata from all IPTV providers (incremental)
   * @returns {Promise<Array<{providerId: string, providerName: string, movies?: number, tvShows?: number, error?: string}>>} Array of fetch results
   */
  async execute() {
    try {
      // Get last execution time from job history BEFORE setting status
      // This ensures we have the correct last_execution value from previous successful run
      const lastExecution = await this.getLastExecution({
        fallbackDate: null,
        logMessage: 'Last execution: {date}. Processing incremental update.',
        noExecutionMessage: 'No previous execution found. Processing full update.'
      });

      // Set status to "running" at start (after reading last_execution)
      await this.setJobStatus('running');

      // Create handler instances for all providers
      this.handlers = await this._createHandlers();
      
      if (this.handlers.size === 0) {
        this.logger.warn('No handlers created. No providers configured or all failed to initialize.');
        await this.setJobStatus('completed', {
          providers_processed: 0,
          results: []
        });
        return [];
      }

      // Filter to only enabled, non-deleted providers
      const enabledHandlers = Array.from(this.handlers.entries())
        .filter(([id, handler]) => {
          const config = handler.providerData;
          return config.enabled && !config.deleted;
        });

      if (enabledHandlers.length === 0) {
        this.logger.warn('No enabled providers found. Skipping metadata fetch.');
        await this.setJobStatus('completed', {
          providers_processed: 0,
          results: []
        });
        return [];
      }

      // Fetch metadata from enabled providers only
      // Note: fetchMetadata() will load all provider titles internally for comparison
      this.logger.info(`Starting metadata fetch process for ${enabledHandlers.length} enabled provider(s) (${this.handlers.size} total)...`);
      
      const results = await Promise.all(
        enabledHandlers.map(async ([providerId, handler]) => {
          try {
            this.logger.debug(`[${providerId}] Processing provider (${handler.getProviderType()})`);
            this.logger.info(`Fetching metadata from provider ${providerId}...`);
            
            // Fetch movies and TV shows in parallel
            const [moviesCount, tvShowsCount] = await Promise.all([
              handler.fetchMetadata('movies').catch(err => {
                this.logger.error(`[${providerId}] Error fetching movies: ${err.message}`);
                return 0;
              }),
              handler.fetchMetadata('tvshows').catch(err => {
                this.logger.error(`[${providerId}] Error fetching TV shows: ${err.message}`);
                return 0;
              })
            ]);
            
            return {
              providerId,
              providerName: providerId,
              movies: moviesCount,
              tvShows: tvShowsCount
            };
          } catch (error) {
            this.logger.error(`[${providerId}] Error processing provider: ${error.message}`);
            return {
              providerId,
              providerName: providerId,
              error: error.message
            };
          }
        })
      );

      // Set status to completed on success with result
      await this.setJobStatus('completed', {
        providers_processed: enabledHandlers.length,
        results: results
      });

      return results;
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
      // Note: fetchMetadata() updates _titlesCache via saveTitles(), so cleanup is needed
      try {
        this.logger.debug('Unloading titles from memory cache...');
        if (this.handlers) {
          for (const [providerId, handler] of this.handlers) {
            handler.unloadTitles();
          }
        }
        this.logger.debug('Memory cleanup completed');
      } catch (error) {
        this.logger.error(`Error during memory cleanup: ${error.message}`);
      }
    }
  }

}

