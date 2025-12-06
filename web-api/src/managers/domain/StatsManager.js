import { BaseDomainManager } from './BaseDomainManager.js';
import { DatabaseCollections, toCollectionName } from '../../config/collections.js';
import { AppError } from '../../errors/AppError.js';

/**
 * Stats manager for handling statistics data operations
 * Matches Python's StatsService format
 */
class StatsManager extends BaseDomainManager {
  /**
   * @param {import('../repositories/StatsRepository.js').StatsRepository} statsRepo - Stats repository
   */
  constructor(statsRepo) {
    super('StatsManager', statsRepo);
    this._statsCollection = toCollectionName(DatabaseCollections.STATS);
  }

  /**
   * Get all statistics grouped by provider
   * Matches Python's StatsService.get_stats()
   * @returns {Promise<object>} Statistics object with providers array
   * @throws {AppError} If an error occurs
   */
  async getStats() {
    try {
      // Load from database (database service handles caching internally)
      const stats = await this._getStats();
      
      if (stats === null) {
        throw new AppError('Failed to get statistics', 500);
      }

      return stats;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      this.logger.error('Error getting statistics:', error);
      throw new AppError('Failed to get statistics', 500);
    }
  }

  /**
   * Get all statistics grouped by provider
   * Matches Python's StatsService._get_stats()
   * @returns {Promise<object|null>}
   */
  async _getStats() {
    try {
      // Get all stats and transform to object
      const statsArray = await this._repository.findByQuery({});
      const statsDataObj = {};
      for (const stat of statsArray) {
        if (stat._id) {
          statsDataObj[stat._id] = stat;
        }
      }

      if (!statsDataObj || Object.keys(statsDataObj).length === 0) {
        return { providers: [] };
      }

      // Convert object to array
      const statsData = Object.values(statsDataObj);

      // Group stats by provider
      const statsByProvider = {};
      
      for (const stat of statsData) {
        const provider = stat.provider;
        if (!provider) {
          continue;
        }

        if (!statsByProvider[provider]) {
          statsByProvider[provider] = {
            name: provider,
            type: stat.provider_type || 'unknown',
            stats: [],
          };
        }

        // Add stat to provider group
        statsByProvider[provider].stats.push({
          name: stat.name || '',
          value: stat.value || 0,
          type: stat.type || '',
        });
      }

      // Convert to list and sort by provider name
      const providersList = Object.values(statsByProvider);
      providersList.sort((a, b) => a.name.localeCompare(b.name));

      // Sort stats within each provider by type and name
      for (const provider of providersList) {
        provider.stats.sort((a, b) => {
          const typeCompare = (a.type || '').localeCompare(b.type || '');
          if (typeCompare !== 0) return typeCompare;
          return (a.name || '').localeCompare(b.name || '');
        });
      }

      return { providers: providersList };
    } catch (error) {
      this.logger.error('Error getting statistics:', error);
      return null;
    }
  }
}

// Export class
export { StatsManager };

