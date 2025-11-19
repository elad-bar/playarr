import { BaseRepository } from './BaseRepository.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ProgramRepository');

/**
 * Repository for programs collection
 * Stores EPG program information per user and channel
 */
export class ProgramRepository extends BaseRepository {
  /**
   * @param {import('mongodb').MongoClient} mongoClient - MongoDB client instance
   */
  constructor(mongoClient) {
    super(
      mongoClient,
      'programs',
      (doc) => `${doc.username}-${doc.channel_id}-${doc.start?.getTime?.() || doc.start}-${doc.stop?.getTime?.() || doc.stop}`
    );
  }

  /**
   * Get index definitions for programs collection
   * @returns {Array<Object>} Array of index definitions
   */
  getIndexDefinitions() {
    return [
      {
        key: { username: 1, channel_id: 1, start: 1, stop: 1 },
        options: { unique: true },
        duplicateKey: { username: 1, channel_id: 1, start: 1, stop: 1 },
        description: 'Primary lookup (unique compound key)'
      },
      {
        key: { username: 1, channel_id: 1 },
        options: {},
        description: 'User channel programs lookup'
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
      username: doc.username, 
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
    return `${doc.username}-${doc.channel_id}-${startTime}-${stopTime}`;
  }
}

