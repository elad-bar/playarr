import { BaseRepository } from './BaseRepository.js';

/**
 * Repository for provider_categories collection
 * Stores provider category information (movies and TV shows only)
 */
export class ProviderCategoryRepository extends BaseRepository {
  /**
   * @param {import('mongodb').MongoClient} mongoClient - MongoDB client instance
   */
  constructor(mongoClient) {
    super(
      'ProviderCategoryRepository',
      mongoClient,
      'provider_categories',
      (doc) => `${doc.provider_id}-${doc.type}-${doc.category_id}`,
      'data',  // Collection type
      'v1'     // Schema version
    );
  }

  /**
   * Get index definitions for provider_categories collection
   * @returns {Array<Object>} Array of index definitions
   */
  getIndexDefinitions() {
    return [
      {
        key: { provider_id: 1, type: 1, category_id: 1 },
        options: { unique: true },
        duplicateKey: { provider_id: 1, type: 1, category_id: 1 },
        description: 'Primary lookup (unique compound key)'
      },
      {
        key: { provider_id: 1, type: 1 },
        options: {},
        description: 'Provider and type filtering'
      }
    ];
  }

  /**
   * Build existence query for a document
   * @protected
   * @param {Object} doc - Document to check
   * @returns {Object} Query object
   */
  buildExistenceQuery(doc) {
    return { 
      provider_id: doc.provider_id, 
      type: doc.type, 
      category_id: doc.category_id 
    };
  }

  /**
   * Build key for existence check
   * @protected
   * @param {Object} doc - Document
   * @returns {string|null} Key or null if invalid
   */
  buildKeyForCheck(doc) {
    if (!doc.provider_id || !doc.type || doc.category_id === undefined) {
      return null;
    }
    return `${doc.provider_id}-${doc.type}-${doc.category_id}`;
  }

  /**
   * Get all categories for a provider
   * @param {string} providerId - Provider ID
   * @param {string} [type] - Optional media type filter ('movies' or 'tvshows')
   * @returns {Promise<Array>} Array of category documents
   */
  async findByProvider(providerId, type = null) {
    const query = { provider_id: providerId };
    if (type) {
      query.type = type;
    }
    return await this.findByQuery(query);
  }

  /**
   * Delete all categories for a provider
   * @param {string} providerId - Provider ID
   * @returns {Promise<Object>} Delete result with deletedCount
   */
  async deleteByProvider(providerId) {
    return await this.deleteMany({ provider_id: providerId });
  }

  /**
   * Delete categories for a provider and specific media type
   * @param {string} providerId - Provider ID
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Promise<Object>} Delete result with deletedCount
   */
  async deleteByProviderAndType(providerId, type) {
    return await this.deleteMany({ 
      provider_id: providerId,
      type: type
    });
  }
}

