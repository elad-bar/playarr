import { BaseRepository } from './BaseRepository.js';

/**
 * Repository for programs collection
 * Stores EPG program information per provider and channel
 */
export class ProgramRepository extends BaseRepository {
  /**
   * @param {import('mongodb').MongoClient} mongoClient - MongoDB client instance
   */
  constructor(mongoClient) {
    super(
      'ProgramRepository',
      mongoClient,
      'programs',
      (doc) => `${doc.provider_id}-${doc.channel_id}-${doc.start?.getTime?.() || doc.start}-${doc.stop?.getTime?.() || doc.stop}`,
      'data',  // Collection type
      'v3'     // Schema version (v2: channel_id String, v3: channel_id Number)
    );
  }

  /**
   * Get index definitions for programs collection
   * @returns {Array<Object>} Array of index definitions
   */
  getIndexDefinitions() {
    return [
      {
        key: { provider_id: 1, channel_id: 1, start: 1, stop: 1 },
        options: { unique: true },
        duplicateKey: { provider_id: 1, channel_id: 1, start: 1, stop: 1 },
        description: 'Primary lookup (unique compound key)'
      },
      {
        key: { provider_id: 1, channel_id: 1 },
        options: {},
        description: 'Provider channel programs lookup'
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
      channel_id: doc.channel_id,
      start: doc.start,
      stop: doc.stop
    };
  }

  /**
   * Build key for existence check
   * @protected
   * @param {Object} doc - Document
   * @returns {string|null} Key or null if invalid
   */
  buildKeyForCheck(doc) {
    const startTime = doc.start?.getTime?.() || doc.start;
    const stopTime = doc.stop?.getTime?.() || doc.stop;
    return `${doc.provider_id}-${doc.channel_id}-${startTime}-${stopTime}`;
  }

  /**
   * Get all programs for a provider
   * @param {string} providerId - Provider ID
   * @returns {Promise<Array>} Array of program documents
   */
  async findByProvider(providerId) {
    return await this.findByQuery({ provider_id: providerId });
  }

  /**
   * Delete all programs for a provider
   * @param {string} providerId - Provider ID
   * @returns {Promise<number>} Number of deleted documents
   */
  async deleteByProvider(providerId) {
    return await this.deleteMany({ provider_id: providerId });
  }
}

