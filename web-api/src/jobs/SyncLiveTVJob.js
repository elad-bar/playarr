import { createLogger } from '../utils/logger.js';

const logger = createLogger('SyncLiveTVJob');

/**
 * Job for syncing Live TV channels and EPG from user-configured M3U and EPG URLs
 */
export class SyncLiveTVJob {
  /**
   * @param {import('../managers/liveTV.js').LiveTVManager} liveTVManager - Live TV manager instance
   */
  constructor(liveTVManager) {
    this.liveTVManager = liveTVManager;
    this.logger = logger;
  }

  /**
   * Execute the job
   * @returns {Promise<Object>} Job execution result
   */
  async execute() {
    try {
      this.logger.info('Starting Live TV sync job...');
      const result = await this.liveTVManager.syncAllUsers();
      this.logger.info(`Live TV sync completed: ${result.users_processed} user(s) processed`);
      return result;
    } catch (error) {
      this.logger.error(`Live TV sync job failed: ${error.message}`);
      throw error;
    }
  }
}

