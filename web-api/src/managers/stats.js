import { BaseManager } from './BaseManager.js';
import { DatabaseCollections, toCollectionName } from '../config/collections.js';

/**
 * Stats manager for handling statistics data operations
 * Matches Python's StatsService format
 */
class StatsManager extends BaseManager {
  /**
   * @param {import('../services/database.js').DatabaseService} database - Database service instance
   */
  constructor(database) {
    super('StatsManager', database);
    this._statsCollection = toCollectionName(DatabaseCollections.STATS);
  }

  /**
   * Get all statistics grouped by provider
   * Matches Python's StatsService.get_stats()
   * @returns {Promise<{response: object, statusCode: number}>}
   */
  async getStats() {
    try {
      // Load from database (database service handles caching internally)
      const stats = await this._getStats();
      
      if (stats === null) {
        return {
          response: { error: 'Failed to get statistics' },
          statusCode: 500,
        };
      }

      return {
        response: stats,
        statusCode: 200,
      };
    } catch (error) {
      this.logger.error('Error getting statistics:', error);
      return {
        response: { error: 'Failed to get statistics' },
        statusCode: 500,
      };
    }
  }

  /**
   * Get all statistics grouped by provider
   * Matches Python's StatsService._get_stats()
   * @returns {Promise<object|null>}
   */
  async _getStats() {
    try {
      const statsData = await this._database.getDataList(this._statsCollection);

      if (!statsData || statsData.length === 0) {
        return { providers: [] };
      }

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

