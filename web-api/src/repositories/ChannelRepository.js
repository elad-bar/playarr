import { BaseRepository } from './BaseRepository.js';

/**
 * Repository for channels collection
 * Stores Live TV channel information per provider
 */
export class ChannelRepository extends BaseRepository {
  /**
   * @param {import('mongodb').MongoClient} mongoClient - MongoDB client instance
   */
  constructor(mongoClient) {
    super(
      'ChannelRepository',
      mongoClient,
      'channels',
      (doc) => `${doc.provider_id}-${doc.channel_id}`,
      'data',  // Collection type
      'v3'     // Schema version (v2: channel_id String, v3: channel_id Number)
    );
  }

  /**
   * Get index definitions for channels collection
   * @returns {Array<Object>} Array of index definitions
   */
  getIndexDefinitions() {
    return [
      {
        key: { provider_id: 1, channel_id: 1 },
        options: { unique: true },
        duplicateKey: { provider_id: 1, channel_id: 1 },
        description: 'Primary lookup (unique compound key)'
      },
      {
        key: { provider_id: 1 },
        options: {},
        description: 'Provider channels lookup'
      },
      {
        key: { channel_key: 1 },
        options: {},
        description: 'Channel key lookup (for watchlist queries)'
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
    return { provider_id: doc.provider_id, channel_id: doc.channel_id };
  }

  /**
   * Build key for existence check
   * @protected
   * @param {Object} doc - Document
   * @returns {string|null} Key or null if invalid
   */
  buildKeyForCheck(doc) {
    return `${doc.provider_id}-${doc.channel_id}`;
  }

  /**
   * Get all channels for a provider
   * @param {string} providerId - Provider ID
   * @returns {Promise<Array>} Array of channel documents
   */
  async findByProvider(providerId) {
    return await this.findByQuery({ provider_id: providerId });
  }

  /**
   * Delete all channels for a provider
   * @param {string} providerId - Provider ID
   * @returns {Promise<number>} Number of deleted documents
   */
  async deleteByProvider(providerId) {
    return await this.deleteMany({ provider_id: providerId });
  }

  /**
   * Get distinct values for a field
   * @param {string} field - Field name to get distinct values for
   * @param {Object} [query={}] - Optional query filter
   * @returns {Promise<Array>} Array of distinct values
   */
  async getDistinct(field, query = {}) {
    try {
      const collection = this.db.collection(this.collectionName);
      return await collection.distinct(field, query);
    } catch (error) {
      this.logger.error(`Error getting distinct ${field} in ${this.collectionName}:`, error);
      throw error;
    }
  }
}

