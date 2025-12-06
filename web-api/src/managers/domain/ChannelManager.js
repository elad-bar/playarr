import { BaseDomainManager } from './BaseDomainManager.js';
import { formatNumber } from '../../utils/numberFormat.js';

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
   * Sync channels using insert/update/delete operations
   * @param {Object} operations - Sync operations
   * @param {Array<Object>} operations.toInsert - Channels to insert
   * @param {Array<Object>} operations.toUpdate - Channels to update
   * @param {Array<string>} operations.toRemove - Channel keys to remove
   * @returns {Promise<{inserted: number, updated: number, deleted: number}>} Sync result
   */
  async syncChannels({ toInsert, toUpdate, toRemove }) {
    try {
      const now = new Date();
      let insertedCount = 0;
      let updatedCount = 0;
      let deletedCount = 0;
      
      // 1. Bulk Insert
      if (toInsert && toInsert.length > 0) {
        const channelsWithTimestamps = toInsert.map(channel => ({
          ...channel,
          createdAt: now,
          lastUpdated: now
        }));
        
        await this._repository.insertMany(channelsWithTimestamps);
        insertedCount = channelsWithTimestamps.length;
      }
      
      // 2. Bulk Update
      if (toUpdate && toUpdate.length > 0) {
        const bulkOps = toUpdate.map(channel => ({
          updateOne: {
            filter: { channel_key: channel.channel_key },
            update: {
              $set: {
                ...channel,
                lastUpdated: now
              }
            }
          }
        }));
        
        const result = await this._repository.bulkWrite(bulkOps);
        updatedCount = result.modifiedCount || toUpdate.length;
      }
      
      // 3. Bulk Delete
      if (toRemove && toRemove.length > 0) {
        const deleteResult = await this._repository.deleteManyByQuery({
          channel_key: { $in: toRemove }
        });
        deletedCount = deleteResult.deletedCount || 0;
      }
      
      return {
        inserted: insertedCount,
        updated: updatedCount,
        deleted: deletedCount
      };
    } catch (error) {
      this.logger.error(`Error syncing channels: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get channels map by channel_key for sync comparison
   * @param {string} providerId - Provider ID
   * @returns {Promise<Map<string, {channel_key: string, url: string}>>} Map of channel_key -> {channel_key, url}
   */
  async getChannelsMapByKey(providerId) {
    try {
      const channels = await this._repository.findByProvider(providerId);
      const map = new Map();
      for (const channel of channels) {
        map.set(channel.channel_key, {
          channel_key: channel.channel_key,
          url: channel.url
        });
      }
      return map;
    } catch (error) {
      this.logger.error(`Error getting channels map for provider ${providerId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get unique categories (group_title) from all channels
   * @param {Array<string>} [enabledProviderIds] - Array of enabled provider IDs
   * @returns {Promise<Array<string>>} Array of unique category names (sorted)
   */
  async getUniqueCategories(enabledProviderIds = []) {
    try {
      let query = {};
      
      // Filter by enabled providers if provided
      if (enabledProviderIds && Array.isArray(enabledProviderIds) && enabledProviderIds.length > 0) {
        query.provider_id = { $in: enabledProviderIds };
      }
      
      // Use repository method to get distinct values
      const categories = await this._repository.getDistinct('group_title', query);
      
      this.logger.debug(`Found ${formatNumber(categories.length)} distinct group_title values (before filtering)`);
      
      // Filter out null/undefined/empty values and sort
      const filteredCategories = categories
        .filter(cat => cat && typeof cat === 'string' && cat.trim().length > 0)
        .sort();
      
      this.logger.debug(`Returning ${formatNumber(filteredCategories.length)} valid categories after filtering`);
      
      return filteredCategories;
    } catch (error) {
      this.logger.error(`Error getting unique categories: ${error.message}`, error);
      throw error;
    }
  }

  /**
   * Get all channels with optional watchlist filtering and pagination
   * @param {Object} options - Query options
   * @param {string} [options.userId] - User ID for watchlist filtering
   * @param {boolean} [options.watchlistFilter] - Filter by watchlist (true = only watchlist, false = exclude watchlist, undefined = all)
   * @param {string} [options.providerId] - Filter by provider
   * @param {string} [options.search] - Search term
   * @param {Array<string>} [options.category] - Filter by category (group_title) - array of category names
   * @param {Object} [options.watchlist] - User's watchlist object (for filtering)
   * @param {number} [options.page=1] - Page number (1-based)
   * @param {number} [options.perPage=50] - Items per page
   * @param {Array<string>} [options.enabledProviderIds] - Array of enabled provider IDs (for filtering)
   * @returns {Promise<Object>} Object with items array and pagination info
   */
  async getAllChannels(options = {}) {
    try {
      const page = options.page || 1;
      const perPage = options.perPage || 50;
      
      let query = {};
      
      // Filter by enabled providers if provided
      if (options.enabledProviderIds && Array.isArray(options.enabledProviderIds) && options.enabledProviderIds.length > 0) {
        query.provider_id = { $in: options.enabledProviderIds };
      }
      
      // Provider filter (specific provider)
      if (options.providerId) {
        query.provider_id = options.providerId;
      }
      
      // Category filter
      if (options.category && Array.isArray(options.category) && options.category.length > 0) {
        query.group_title = { $in: options.category };
      }
      
      // Search filter
      if (options.search) {
        query.name = { $regex: options.search, $options: 'i' };
      }
      
      // Get total count before pagination and watchlist filtering
      let totalCount = await this._repository.count(query);
      
      // Build findMany options for pagination
      const findOptions = {
        sort: { name: 1 }
      };
      
      findOptions.skip = (page - 1) * perPage;
      findOptions.limit = perPage;
      
      // Fetch channels with pagination
      let channels = await this._repository.findMany(query, findOptions);
      
      // Watchlist filtering (using watchlist object passed in options)
      // Note: This filtering happens after pagination, so the count might be slightly off
      // For exact count, we'd need to filter before counting, but that's more complex
      if (options.userId && options.watchlistFilter !== undefined && options.watchlist && typeof options.watchlist === 'object') {
        const watchlistKeys = new Set(options.watchlist.live || []);
        
        if (options.watchlistFilter === true) {
          // Only show watchlist channels
          channels = channels.filter(ch => watchlistKeys.has(ch.channel_key));
        } else if (options.watchlistFilter === false) {
          // Exclude watchlist channels
          channels = channels.filter(ch => !watchlistKeys.has(ch.channel_key));
        }
      }
      
      // Calculate pagination info
      // Note: totalCount is before watchlist filtering, so it's approximate
      const totalPages = Math.max(1, Math.ceil(totalCount / perPage));
      const validPage = Math.max(1, Math.min(page, totalPages));
      
      return {
        items: channels,
        pagination: {
          page: validPage,
          per_page: perPage,
          total: totalCount,
          total_pages: totalPages
        }
      };
    } catch (error) {
      this.logger.error(`Error getting all channels: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get channels for a specific provider
   * @param {string} providerId - Provider ID
   * @returns {Promise<Array<Object>>} Array of channel objects
   */
  async findByProvider(providerId) {
    try {
      return await this._repository.findByProvider(providerId);
    } catch (error) {
      this.logger.error(`Error getting channels for provider ${providerId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete all channels for a provider
   * @param {string} providerId - Provider ID
   * @returns {Promise<number>} Number of deleted channels
   */
  async deleteByProvider(providerId) {
    try {
      return await this._repository.deleteByProvider(providerId);
    } catch (error) {
      this.logger.error(`Error deleting channels for provider ${providerId}: ${error.message}`);
      throw error;
    }
  }
}

