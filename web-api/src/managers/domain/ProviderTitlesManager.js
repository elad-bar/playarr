import { BaseDomainManager } from './BaseDomainManager.js';
import { AppError, NotFoundError, ValidationError } from '../../errors/AppError.js';
import { generateTitleKey } from '../../utils/titleUtils.js';
import { toCollectionName, DatabaseCollections } from '../../config/collections.js';

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

  /**
   * Get count of ignored provider titles grouped by provider_id and type
   * Uses MongoDB aggregation for efficiency
   * @returns {Promise<Array<{provider_id: string, media_type: string, count: number}>>}
   */
  async getIgnoredCountByProviderAndType() {
    const pipeline = [
      {
        $match: {
          ignored: true
        }
      },
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

  /**
   * Get paginated list of ignored titles across all providers with filters
   * @param {Object} options - Query options
   * @param {number} [options.page=1] - Page number
   * @param {number} [options.perPage=50] - Items per page
   * @param {string} [options.mediaType] - Filter by media type ('movies' or 'tvshows')
   * @param {string} [options.issueType] - Filter by ignored_reason
   * @param {string|Array<string>} [options.providerId] - Filter by provider ID(s)
   * @param {string} [options.search] - Search in title name
   * @param {import('../../repositories/ProviderRepository.js').ProviderRepository} providerRepo - Provider repository for joining provider names
   * @returns {Promise<{items: Array<Object>, total: number, page: number, perPage: number, totalPages: number}>}
   * @throws {AppError} If an error occurs
   */
  async getIgnoredTitlesPaginated(options = {}, providerRepo) {
    try {
      const {
        page = 1,
        perPage = 50,
        mediaType,
        issueType,
        providerId,
        search
      } = options;

      // Build query
      const query = { ignored: true };

      if (mediaType) {
        if (!['movies', 'tvshows'].includes(mediaType)) {
          throw new ValidationError("Invalid media type. Must be 'movies' or 'tvshows'");
        }
        query.type = mediaType;
      }

      if (issueType) {
        query.ignored_reason = issueType;
      }

      if (providerId) {
        if (Array.isArray(providerId)) {
          query.provider_id = { $in: providerId };
        } else {
          query.provider_id = providerId;
        }
      }

      if (search) {
        query.title = { $regex: search, $options: 'i' };
      }

      // Get total count
      const total = await this._repository.count(query);

      // Calculate pagination
      const skip = (page - 1) * perPage;
      const totalPages = Math.ceil(total / perPage);

      // Get paginated results
      const findOptions = {
        sort: { lastUpdated: -1 }, // Most recently updated first
        skip,
        limit: perPage
      };

      const titles = await this._repository.findByQuery(query, findOptions);

      // Get provider names by joining with providers collection
      const providerIds = [...new Set(titles.map(t => t.provider_id).filter(Boolean))];
      const providerMap = new Map();

      if (providerRepo && providerIds.length > 0) {
        const providers = await providerRepo.findByQuery({
          id: { $in: providerIds }
        });
        providers.forEach(p => {
          providerMap.set(p.id, p.name || p.id);
        });
      }

      // Transform results to include provider name
      const items = titles.map(title => {
        const year = title.release_date ? new Date(title.release_date).getFullYear() : null;
        return {
          _id: title._id,
          provider_id: title.provider_id,
          provider_name: providerMap.get(title.provider_id) || title.provider_id,
          title_key: title.title_key,
          type: title.type,
          title: title.title,
          release_date: title.release_date,
          year: year,
          ignored_reason: title.ignored_reason || 'Unknown issue',
          tmdb_id: title.tmdb_id || null,
          lastUpdated: title.lastUpdated
        };
      });

      return {
        items,
        total,
        page: parseInt(page, 10),
        perPage: parseInt(perPage, 10),
        totalPages
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      this.logger.error('Error getting paginated ignored titles:', error);
      throw new AppError('Failed to get ignored titles', 500);
    }
  }

  /**
   * Get single ignored provider title by MongoDB _id
   * @param {string} id - MongoDB _id (as string)
   * @param {import('../../repositories/ProviderRepository.js').ProviderRepository} providerRepo - Provider repository for joining provider name
   * @returns {Promise<Object>} Provider title document with provider name
   * @throws {NotFoundError} If title not found
   * @throws {AppError} If an error occurs
   */
  async getIgnoredTitleById(id, providerRepo) {
    try {
      const { ObjectId } = await import('mongodb');
      let objectId;
      
      try {
        objectId = new ObjectId(id);
      } catch (error) {
        throw new ValidationError('Invalid ID format');
      }

      const title = await this._repository.findOneByQuery({ _id: objectId });

      if (!title) {
        throw new NotFoundError('Provider title not found');
      }

      if (!title.ignored) {
        throw new ValidationError('Title is not ignored');
      }

      // Get provider name
      let providerName = title.provider_id;
      if (providerRepo) {
        const provider = await providerRepo.findOneByQuery({ id: title.provider_id });
        if (provider) {
          providerName = provider.name || provider.id;
        }
      }

      const year = title.release_date ? new Date(title.release_date).getFullYear() : null;

      return {
        _id: title._id,
        provider_id: title.provider_id,
        provider_name: providerName,
        title_key: title.title_key,
        type: title.type,
        title: title.title,
        release_date: title.release_date,
        year: year,
        ignored_reason: title.ignored_reason || 'Unknown issue',
        tmdb_id: title.tmdb_id || null,
        createdAt: title.createdAt,
        lastUpdated: title.lastUpdated
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      this.logger.error(`Error getting ignored title by ID ${id}:`, error);
      throw new AppError('Failed to get ignored title', 500);
    }
  }

  /**
   * Update provider title with TMDB ID and unignore it
   * @param {string} id - MongoDB _id (as string)
   * @param {number} tmdbId - TMDB ID to assign
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Promise<Object>} Updated provider title document
   * @throws {NotFoundError} If title not found
   * @throws {ValidationError} If validation fails
   * @throws {AppError} If an error occurs
   */
  async updateProviderTitleWithTMDB(id, tmdbId, type) {
    try {
      // Validate type
      if (!['movies', 'tvshows'].includes(type)) {
        throw new ValidationError("Invalid media type. Must be 'movies' or 'tvshows'");
      }

      // Validate tmdbId
      if (!tmdbId || typeof tmdbId !== 'number' || tmdbId <= 0) {
        throw new ValidationError('Invalid TMDB ID');
      }

      const { ObjectId } = await import('mongodb');
      let objectId;
      
      try {
        objectId = new ObjectId(id);
      } catch (error) {
        throw new ValidationError('Invalid ID format');
      }

      // Check if title exists
      const existingTitle = await this._repository.findOneByQuery({ _id: objectId });
      if (!existingTitle) {
        throw new NotFoundError('Provider title not found');
      }

      // Generate new title_key
      const newTitleKey = generateTitleKey(type, tmdbId);

      // Update the provider title
      const now = new Date();
      const updateResult = await this._repository.updateOne(
        { _id: objectId },
        {
          $set: {
            tmdb_id: tmdbId,
            title_key: newTitleKey,
            ignored: false,
            ignored_reason: null,
            lastUpdated: now
          }
        }
      );

      if (updateResult.matchedCount === 0) {
        throw new NotFoundError('Provider title not found');
      }

      // Return updated document
      const updatedTitle = await this._repository.findOneByQuery({ _id: objectId });
      return updatedTitle;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      this.logger.error(`Error updating provider title ${id} with TMDB ID:`, error);
      throw new AppError('Failed to update provider title', 500);
    }
  }
}

export { ProviderTitlesManager };

