import { BaseRepository } from './BaseRepository.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ChannelRepository');

/**
 * Repository for channels collection
 * Stores Live TV channel information per user
 */
export class ChannelRepository extends BaseRepository {
  /**
   * @param {import('mongodb').MongoClient} mongoClient - MongoDB client instance
   */
  constructor(mongoClient) {
    super(
      mongoClient,
      'channels',
      (doc) => `${doc.username}-${doc.channel_id}`
    );
  }

  /**
   * Get index definitions for channels collection
   * @returns {Array<Object>} Array of index definitions
   */
  getIndexDefinitions() {
    return [
      {
        key: { username: 1, channel_id: 1 },
        options: { unique: true },
        duplicateKey: { username: 1, channel_id: 1 },
        description: 'Primary lookup (unique compound key)'
      },
      {
        key: { username: 1 },
        options: {},
        description: 'User channels lookup'
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
    return { username: doc.username, channel_id: doc.channel_id };
  }

  /**
   * Build key for existence check
   * @protected
   * @param {Object} doc - Document
   * @returns {string|null} Key or null if invalid
   */
  buildKeyForCheck(doc) {
    return `${doc.username}-${doc.channel_id}`;
  }
}

