import { createLogger } from '../utils/logger.js';

const logger = createLogger('SyncLiveTVJob');

/**
 * Job for syncing Live TV channels and EPG from user-configured M3U and EPG URLs
 */
export class SyncLiveTVJob {
  /**
   * @param {import('../managers/domain/UserManager.js').UserManager} userManager - User manager instance
   * @param {import('../managers/processing/LiveTVProcessingManager.js').LiveTVProcessingManager} liveTVProcessingManager - Live TV processing manager instance
   */
  constructor(userManager, liveTVProcessingManager) {
    this.userManager = userManager;
    this.liveTVProcessingManager = liveTVProcessingManager;
    this.logger = logger;
  }

  /**
   * Execute the job
   * @returns {Promise<Object>} Job execution result
   */
  async execute() {
    try {
      this.logger.info('Starting Live TV sync job...');
      
      // Get users with Live TV configuration
      const users = await this.userManager.getUsersWithLiveTVConfig();
      
      // Sync Live TV for all users
      const result = await this.liveTVProcessingManager.syncUsers(users);
      
      this.logger.info(`Live TV sync completed: ${result.users_processed} user(s) processed`);
      return result;
    } catch (error) {
      this.logger.error(`Live TV sync job failed: ${error.message}`);
      throw error;
    }
  }
}

