import { BaseJob } from './BaseJob.js';

/**
 * Job for updating all gauge metrics from database
 * Refreshes all database-dependent metrics: provider titles, main titles, channels, watchlists, users, provider connections
 * @extends {BaseJob}
 */
export class UpdateMetricsJob extends BaseJob {
  /**
   * @param {string} jobName - Name identifier for this job (used in logging)
   * @param {import('../managers/domain/JobHistoryManager.js').JobHistoryManager} jobHistoryManager - Job history manager
   * @param {import('../managers/orchestration/ProvidersManager.js').ProvidersManager} providersManager - Providers manager for direct API calls
   * @param {import('../managers/domain/TMDBManager.js').TMDBManager} tmdbManager - TMDB manager for API calls
   * @param {import('../managers/domain/TitlesManager.js').TitlesManager} titlesManager - Titles manager
   * @param {import('../managers/domain/ProviderTitlesManager.js').ProviderTitlesManager} providerTitlesManager - Provider titles manager
   * @param {import('../services/metrics.js').default} metricsService - Metrics service instance
   * @param {import('../managers/domain/ChannelManager.js').ChannelManager} channelManager - Channel manager
   * @param {import('../managers/domain/UserManager.js').UserManager} userManager - User manager
   * @param {import('../managers/domain/IPTVProviderManager.js').IPTVProviderManager} iptvProviderManager - IPTV Provider manager
   */
  constructor(jobName, jobHistoryManager, providersManager, tmdbManager, titlesManager, providerTitlesManager, metricsService, channelManager, userManager, iptvProviderManager) {
    super(jobName, jobHistoryManager, providersManager, tmdbManager, titlesManager, providerTitlesManager, metricsService);
    this._channelManager = channelManager;
    this._userManager = userManager;
    this._iptvProviderManager = iptvProviderManager;
  }

  /**
   * Execute the job - update all gauge metrics from database
   * @param {AbortSignal} [abortSignal] - AbortSignal for cancellation
   * @returns {Promise<Object>} Execution result with success indicator
   */
  async execute(abortSignal) {
    try {
      // Set status to "running" at start
      await this.setJobStatus('running');
      
      // Check for cancellation after setting status
      this._checkCancellation(abortSignal);

      this.logger.info('Updating all gauge metrics from database...');

      // Update all gauge metrics
      await this.metricsService.updateGaugeMetrics({
        providerTitlesManager: this.providerTitlesManager,
        titlesManager: this.titlesManager,
        channelManager: this._channelManager,
        userManager: this._userManager,
        iptvProviderManager: this._iptvProviderManager
      });

      this.logger.info('Gauge metrics updated successfully');

      // Set status to completed on success
      await this.setJobStatus('completed', {
        success: true
      });

      return {
        success: true
      };
    } catch (error) {
      // Check if error is due to cancellation
      if (error.cancelled || error.name === 'AbortError') {
        this.logger.info(`Job execution cancelled: ${error.message}`);
        await this.setJobStatus('cancelled', {
          cancelled: true
        }).catch(err => {
          this.logger.error(`Failed to update job history: ${err.message}`);
        });
      } else {
        this.logger.error(`Job execution failed: ${error.message}`);
        
        // Set status to failed with error result
        // Don't throw - metrics update is non-critical
        await this.setJobStatus('failed', {
          error: error.message,
          success: false
        }).catch(err => {
          this.logger.error(`Failed to update job history: ${err.message}`);
        });
      }
      
      // Return failure result instead of throwing
      return {
        success: false,
        error: error.message
      };
    }
  }
}

