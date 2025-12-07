import { BaseDomainManager } from './BaseDomainManager.js';
import { AppError } from '../../errors/AppError.js';

/**
 * Provider Titles Manager (Domain Manager)
 * Manages provider_titles domain operations
 * One domain = one repository (ProviderTitleRepository)
 */
class ProviderTitlesManager extends BaseDomainManager {
  /**
   * @param {import('../../repositories/ProviderTitleRepository.js').ProviderTitleRepository} providerTitleRepo - Provider title repository
   */
  constructor(providerTitleRepo) {
    super('ProviderTitlesManager', providerTitleRepo);
  }

  /**
   * Save provider titles (bulk upsert)
   * @param {string} providerId - Provider ID
   * @param {Array<Object>} titles - Array of title objects
   * @returns {Promise<{inserted: number, updated: number}>}
   */
  async saveProviderTitles(providerId, titles) {
    // Add provider_id and timestamps to each title
    const now = new Date();
    const titlesWithMetadata = titles.map(title => ({
      ...title,
      provider_id: providerId,
      createdAt: title.createdAt || now,
      lastUpdated: now
    }));

    // Use bulkUpsert from BaseDomainManager
    // Match on provider_id and title_key
    return await this.bulkUpsert(titlesWithMetadata, {
      matchFields: ['provider_id', 'title_key'],
      setTimestamps: false // Already set above
    });
  }

  /**
   * Get provider titles with filters
   * @param {string} providerId - Provider ID
   * @param {Object} [options={}] - Query options
   * @param {Date} [options.since] - Only get titles updated since this date
   * @param {string} [options.type] - Filter by type ('movies' or 'tvshows')
   * @param {boolean} [options.ignored] - Filter by ignored status
   * @returns {Promise<Array<Object>>} Array of provider title documents
   */
  async getProviderTitles(providerId, options = {}) {
    // Build query in manager (business logic)
    const query = { provider_id: providerId };
    
    if (options.since) {
      query.lastUpdated = { $gt: options.since };
    }
    if (options.type) {
      query.type = options.type;
    }
    if (options.ignored !== undefined) {
      query.ignored = options.ignored;
    }
    
    // Use repository's atomic method
    return await this._repository.findByQuery(query);
  }

  /**
   * Reset lastUpdated for all provider titles
   * @param {string} providerId - Provider ID
   * @returns {Promise<number>} Number of titles updated
   */
  async resetLastUpdated(providerId) {
    // Use repository's atomic method
    const result = await this._repository.updateManyByQuery(
      { provider_id: providerId },
      { $set: { lastUpdated: new Date() } }
    );
    return result.modifiedCount || 0;
  }

  /**
   * Delete all provider titles for a provider
   * @param {string} providerId - Provider ID
   * @returns {Promise<number>} Number of documents deleted
   */
  async deleteByProvider(providerId) {
    // Use repository's atomic method
    const result = await this._repository.deleteManyByQuery({ provider_id: providerId });
    return result.deletedCount || 0;
  }

  /**
   * Get ignored titles for a specific provider
   * @param {string} providerId - Provider ID
   * @returns {Promise<Array<Object>>} Array of ignored title objects
   * @throws {AppError} If an error occurs
   */
  async getIgnoredTitles(providerId) {
    try {
      // Query MongoDB directly for ignored titles for this provider
      // Ignored titles are in provider_titles collection with ignored: true
      const ignoredTitles = await this._repository.findByQuery({
        provider_id: providerId,
        ignored: true
      });

      if (!ignoredTitles || ignoredTitles.length === 0) {
        return [];
      }

      // Transform to array format: [{ title_key, issue, name, year }]
      // The issue/reason is stored in the ignored_reason field, or we can use a default
      const ignoredList = ignoredTitles.map(title => {
        const year = title.release_date ? new Date(title.release_date).getFullYear() : null;
        const titleKey = title.title_key || `${title.type}-${title.tmdb_id}`;
        
        return {
          title_key: titleKey,
          issue: title.ignored_reason || 'Unknown issue',
          name: title.title || null,
          year: year || null
        };
      });

      return ignoredList;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      this.logger.error(`Error getting ignored titles for provider ${providerId}:`, error);
      throw new AppError('Failed to get ignored titles', 500);
    }
  }

  /**
   * Find provider titles by query (exposes repository method for Processing Managers)
   * @param {Object} query - MongoDB query object
   * @param {Object} [options] - Query options (sort, limit, skip, projection, etc.)
   * @returns {Promise<Array<Object>>} Array of provider title documents
   */
  async findByQuery(query, options = {}) {
    return await this._repository.findByQuery(query, options);
  }

  /**
   * Bulk write operations (exposes repository method for Processing Managers)
   * @param {Array<Object>} operations - Array of bulk write operations
   * @param {Object} [options={}] - Bulk write options
   * @returns {Promise<import('mongodb').BulkWriteResult>}
   */
  async bulkWrite(operations, options = {}) {
    return await this._repository.bulkWrite(operations, options);
  }

  /**
   * Update many provider titles by query (exposes repository method for Processing Managers)
   * @param {Object} filter - Filter query
   * @param {Object} update - Update operations
   * @param {Object} [options={}] - Update options
   * @returns {Promise<import('mongodb').UpdateResult>}
   */
  async updateManyByQuery(filter, update, options = {}) {
    return await this._repository.updateManyByQuery(filter, update, options);
  }

  /**
   * Get provider titles for change detection
   * Returns all non-ignored provider titles with tmdb_id and type for aggregating lastUpdated timestamps
   * @returns {Promise<Array<Object>>} Array of provider title documents with lastUpdated information
   */
  async getProviderTitlesForChangeDetection() {
    return await this._repository.getProviderTitlesForChangeDetection();
  }

  /**
   * Get count of provider titles grouped by provider_id and type
   * Uses MongoDB aggregation for efficiency
   * @returns {Promise<Array<{provider_id: string, media_type: string, count: number}>>}
   */
  async getCountByProviderAndType() {
    const pipeline = [
      {
        $group: {
          _id: {
            provider_id: { $ifNull: ['$provider_id', 'unknown'] },
            media_type: { $ifNull: ['$type', 'unknown'] }
          },
          count: { $sum: 1 }
        }
      },
      {
        $project: {
          _id: 0,
          provider_id: '$_id.provider_id',
          media_type: '$_id.media_type',
          count: 1
        }
      }
    ];
    
    return await this._repository.aggregate(pipeline);
  }
}

export { ProviderTitlesManager };

