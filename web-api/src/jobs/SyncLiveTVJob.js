import { BaseJob } from './BaseJob.js';

/**
 * Job for syncing Live TV channels from active IPTV providers
 * @extends {BaseJob}
 */
export class SyncLiveTVJob extends BaseJob {
  /**
   * @param {string} jobName - Name identifier for this job (used in logging)
   * @param {import('../managers/domain/JobHistoryManager.js').JobHistoryManager} jobHistoryManager - Job history manager
   * @param {import('../managers/domain/IPTVProviderManager.js').IPTVProviderManager} iptvProviderManager - IPTV Provider manager instance
   * @param {import('../managers/processing/LiveTVProcessingManager.js').LiveTVProcessingManager} liveTVProcessingManager - Live TV processing manager instance
   */
  constructor(jobName, jobHistoryManager, iptvProviderManager, liveTVProcessingManager) {
    super(jobName, jobHistoryManager);
    this._iptvProviderManager = iptvProviderManager;
    this._liveTVProcessingManager = liveTVProcessingManager;
  }

  /**
   * Execute the job
   * @param {AbortSignal} [abortSignal] - AbortSignal for cancellation
   * @returns {Promise<Object>} Job execution result
   */
  async execute(abortSignal) {
    try {
      // Set status to "running" at start
      await this.setJobStatus('running');
      
      // Check for cancellation after setting status
      this._checkCancellation(abortSignal);
      
      this.logger.info('Starting Live TV sync job...');
      
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
        await this.setJobStatus('completed', {
          providers_processed: 0,
          results: []
        });
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
      
      // Set status to completed on success
      await this.setJobStatus('completed', result);
      
      return result;
    } catch (error) {
      // Check if error is due to cancellation
      if (error.cancelled || error.name === 'AbortError') {
        this.logger.info(`Live TV sync job cancelled: ${error.message}`);
        await this.setJobStatus('cancelled', {
          cancelled: true
        }).catch(err => {
          this.logger.error(`Failed to update job history: ${err.message}`);
        });
      } else {
        this.logger.error(`Live TV sync job failed: ${error.message}`);
        await this.setJobStatus('failed', {
          error: error.message
        }).catch(err => {
          this.logger.error(`Failed to update job history: ${err.message}`);
        });
      }
      throw error;
    }
  }
}

