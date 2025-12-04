import { BaseDomainManager } from './BaseDomainManager.js';

/**
 * ProgramManager for managing Live TV program (EPG) data
 * Type A: Domain Manager
 * Extends BaseDomainManager to use ProgramRepository
 */
export class ProgramManager extends BaseDomainManager {
  /**
   * @param {import('../../repositories/ProgramRepository.js').ProgramRepository} programRepo - Program repository
   */
  constructor(programRepo) {
    super('ProgramManager', programRepo);
  }

  /**
   * Get programs for a specific user
   * @param {string} username - Username
   * @returns {Promise<Array<Object>>} Array of program objects
   */
  async getProgramsByUsername(username) {
    try {
      return await this._repository.findByQuery({ username });
    } catch (error) {
      this.logger.error(`Error getting programs for user ${username}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get programs for a specific channel
   * @param {string} username - Username
   * @param {string} channelId - Channel ID
   * @param {Object} [options] - Query options (sort, etc.)
   * @returns {Promise<Array<Object>>} Array of program objects
   */
  async getProgramsByChannel(username, channelId, options = {}) {
    try {
      const query = { username, channel_id: channelId };
      const findOptions = {
        sort: { start: 1 },
        ...options
      };
      return await this._repository.findByQuery(query, findOptions);
    } catch (error) {
      this.logger.error(`Error getting programs for channel ${channelId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get current programs for channels (programs that are currently airing)
   * @param {string} username - Username
   * @param {Date} [now] - Current time (defaults to new Date())
   * @returns {Promise<Array<Object>>} Array of program objects
   */
  async getCurrentPrograms(username, now = null) {
    try {
      const currentTime = now || new Date();
      const query = {
        username,
        start: { $lte: currentTime },
        stop: { $gte: currentTime }
      };
      return await this._repository.findByQuery(query);
    } catch (error) {
      this.logger.error(`Error getting current programs for user ${username}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete programs for multiple usernames
   * Used for cleanup when syncing Live TV data
   * @param {Array<string>} usernames - Array of usernames
   * @returns {Promise<number>} Number of programs deleted
   */
  async deleteProgramsByUsernames(usernames) {
    try {
      if (!usernames || usernames.length === 0) {
        return 0;
      }
      const result = await this._repository.deleteManyByQuery({ username: { $in: usernames } });
      return result.deletedCount || 0;
    } catch (error) {
      this.logger.error(`Error deleting programs for usernames: ${error.message}`);
      throw error;
    }
  }

  /**
   * Insert programs in bulk
   * Used when syncing Live TV data
   * @param {Array<Object>} programs - Array of program objects
   * @returns {Promise<{inserted: number, updated: number}>} Insert/update counts
   */
  async insertPrograms(programs) {
    try {
      if (!programs || programs.length === 0) {
        return { inserted: 0, updated: 0 };
      }

      // Add timestamps to each program
      const now = new Date();
      const programsWithTimestamps = programs.map(program => ({
        ...program,
        createdAt: program.createdAt || now,
        lastUpdated: now
      }));

      // Use bulkUpsert from BaseDomainManager
      // Match on provider_id, channel_id, start, and stop
      return await this.bulkUpsert(programsWithTimestamps, {
        matchFields: ['provider_id', 'channel_id', 'start', 'stop'],
        setTimestamps: false // Already set above
      });
    } catch (error) {
      this.logger.error(`Error inserting programs: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete all programs for a provider
   * @param {string} providerId - Provider ID
   * @returns {Promise<number>} Number of deleted programs
   */
  async deleteByProvider(providerId) {
    try {
      return await this._repository.deleteByProvider(providerId);
    } catch (error) {
      this.logger.error(`Error deleting programs for provider ${providerId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete programs matching a query
   * @param {Object} query - MongoDB query object
   * @returns {Promise<number>} Number of deleted programs
   */
  async deleteMany(query) {
    try {
      const result = await this._repository.deleteManyByQuery(query);
      return result.deletedCount || 0;
    } catch (error) {
      this.logger.error(`Error deleting programs: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get programs for multiple provider-channel combinations
   * @param {Array<Object>} channels - Array of channel objects with provider_id and channel_id
   * @param {Object} [options={}] - Query options (sort, etc.)
   * @returns {Promise<Array<Object>>} Array of program objects
   */
  async getProgramsByChannels(channels, options = {}) {
    try {
      if (!channels || channels.length === 0) {
        return [];
      }

      const programsQuery = {
        $or: channels.map(channel => ({
          provider_id: channel.provider_id,
          channel_id: channel.channel_id
        }))
      };

      const findOptions = {
        sort: { start: 1 },
        ...options
      };

      return await this._repository.findByQuery(programsQuery, findOptions);
    } catch (error) {
      this.logger.error(`Error getting programs for channels: ${error.message}`);
      throw error;
    }
  }
}

