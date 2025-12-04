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
   * Execute the job
   * @returns {Promise<Object>} Job execution result
   */
  async execute() {
    try {
      this.logger.info('Starting Live TV sync job...');
      
      // Get active providers (type in ['agtv','xtream'], enabled: true, deleted: false)
      const providers = await this._iptvProviderManager.findByQuery({
        type: { $in: ['agtv', 'xtream'] },
        enabled: { $ne: false },
        deleted: { $ne: true }
      });
      
      if (providers.length === 0) {
        this.logger.info('No active providers found for Live TV sync');
        return {
          providers_processed: 0,
          results: []
        };
      }
      
      // Sync Live TV for all providers
      const result = await this._liveTVProcessingManager.syncProviders(providers);
      
      this.logger.info(`Live TV sync completed: ${result.providers_processed} provider(s) processed`);
      return result;
    } catch (error) {
      this.logger.error(`Live TV sync job failed: ${error.message}`);
      throw error;
    }
  }
}

