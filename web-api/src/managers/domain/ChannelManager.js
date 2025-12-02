import { BaseDomainManager } from './BaseDomainManager.js';

/**
 * ChannelManager for managing Live TV channel data
 * Type A: Domain Manager
 * Extends BaseDomainManager to use ChannelRepository
 */
export class ChannelManager extends BaseDomainManager {
  /**
   * @param {import('../../repositories/ChannelRepository.js').ChannelRepository} channelRepo - Channel repository
   */
  constructor(channelRepo) {
    super('ChannelManager', channelRepo);
  }

  /**
   * Get channels for a specific user
   * @param {string} username - Username
   * @returns {Promise<Array<Object>>} Array of channel objects
   */
  async getChannelsByUsername(username) {
    try {
      return await this._repository.findByQuery({ username });
    } catch (error) {
      this.logger.error(`Error getting channels for user ${username}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get a specific channel by username and channel ID
   * @param {string} username - Username
   * @param {string} channelId - Channel ID
   * @returns {Promise<Object|null>} Channel object or null if not found
   */
  async getChannelByUsernameAndId(username, channelId) {
    try {
      return await this._repository.findOneByQuery({ username, channel_id: channelId });
    } catch (error) {
      this.logger.error(`Error getting channel ${channelId} for user ${username}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete channels for multiple usernames
   * Used for cleanup when syncing Live TV data
   * @param {Array<string>} usernames - Array of usernames
   * @returns {Promise<number>} Number of channels deleted
   */
  async deleteChannelsByUsernames(usernames) {
    try {
      if (!usernames || usernames.length === 0) {
        return 0;
      }
      const result = await this._repository.deleteManyByQuery({ username: { $in: usernames } });
      return result.deletedCount || 0;
    } catch (error) {
      this.logger.error(`Error deleting channels for usernames: ${error.message}`);
      throw error;
    }
  }

  /**
   * Insert channels in bulk
   * Used when syncing Live TV data
   * @param {Array<Object>} channels - Array of channel objects
   * @returns {Promise<{inserted: number, updated: number}>} Insert/update counts
   */
  async insertChannels(channels) {
    try {
      if (!channels || channels.length === 0) {
        return { inserted: 0, updated: 0 };
      }

      // Add timestamps to each channel
      const now = new Date();
      const channelsWithTimestamps = channels.map(channel => ({
        ...channel,
        createdAt: channel.createdAt || now,
        lastUpdated: now
      }));

      // Use bulkUpsert from BaseDomainManager
      // Match on username and channel_id
      return await this.bulkUpsert(channelsWithTimestamps, {
        matchFields: ['username', 'channel_id'],
        setTimestamps: false // Already set above
      });
    } catch (error) {
      this.logger.error(`Error inserting channels: ${error.message}`);
      throw error;
    }
  }
}

