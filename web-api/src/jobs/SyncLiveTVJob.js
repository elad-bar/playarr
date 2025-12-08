import { createLogger } from '../utils/logger.js';

const logger = createLogger('SyncLiveTVJob');

/**
 * Job for syncing Live TV channels from active IPTV providers
 */
export class SyncLiveTVJob {
  /**
   * @param {import('../managers/domain/IPTVProviderManager.js').IPTVProviderManager} iptvProviderManager - IPTV Provider manager instance
   * @param {import('../managers/processing/LiveTVProcessingManager.js').LiveTVProcessingManager} liveTVProcessingManager - Live TV processing manager instance
   * @param {import('../managers/domain/JobHistoryManager.js').JobHistoryManager} jobHistoryManager - Job history manager instance
   */
  constructor(iptvProviderManager, liveTVProcessingManager, jobHistoryManager) {
    this._iptvProviderManager = iptvProviderManager;
    this._liveTVProcessingManager = liveTVProcessingManager;
    this._jobHistoryManager = jobHistoryManager;
    this.logger = logger;
  }

  /**
   * Check if job execution should be cancelled
   * @private
   * @param {AbortSignal} [abortSignal] - AbortSignal to check
   * @throws {Error} If job is aborted
   */
  _checkCancellation(abortSignal) {
    if (abortSignal && abortSignal.aborted) {
      const error = new Error('SyncLiveTVJob was cancelled');
      error.name = 'AbortError';
      error.cancelled = true;
      throw error;
    }
  }

  /**
   * Execute the job
   * @param {AbortSignal} [abortSignal] - AbortSignal for cancellation
   * @returns {Promise<Object>} Job execution result
   */
  async execute(abortSignal) {
    try {
      this.logger.info('Starting Live TV sync job...');
      
      // Check for cancellation after starting
      this._checkCancellation(abortSignal);
      
      // Get active providers
      const allProviders = await this._iptvProviderManager.findByQuery({
        type: { $in: ['agtv', 'xtream'] },
        enabled: { $ne: false },
        deleted: { $ne: true }
      });
      
      // Filter to only providers with Live TV sync enabled
      // For v1 providers without sync_media_types, default to true (backward compatibility)
      const providers = allProviders.filter(provider => {
        const syncTypes = provider.sync_media_types;
        if (!syncTypes) {
          // v1 provider - default to true for backward compatibility
          return true;
        }
        return syncTypes.live === true;
      });
      
      if (providers.length === 0) {
        this.logger.info('No active providers found for Live TV sync');
        return {
          providers_processed: 0,
          results: []
        };
      }
      
      // Check for cancellation before calling syncProviders
      this._checkCancellation(abortSignal);
      
      // Sync Live TV for enabled providers
      const result = await this._liveTVProcessingManager.syncProviders(providers);
      
      this.logger.info(`Live TV sync completed: ${result.providers_processed} provider(s) processed`);
      return result;
    } catch (error) {
      // Check if error is due to cancellation
      if (error.cancelled || error.name === 'AbortError') {
        this.logger.info(`Live TV sync job cancelled: ${error.message}`);
        // Note: This job doesn't extend BaseJob, so we can't use setJobStatus
        // The EngineScheduler will handle status update
      } else {
        this.logger.error(`Live TV sync job failed: ${error.message}`);
      }
      throw error;
    }
  }
}

