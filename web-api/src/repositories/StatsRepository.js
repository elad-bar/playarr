import { BaseRepository } from './BaseRepository.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('StatsRepository');

/**
 * Repository for stats collection
 * Handles application statistics
 */
export class StatsRepository extends BaseRepository {
  /**
   * @param {import('mongodb').MongoClient} mongoClient - MongoDB client instance
   */
  constructor(mongoClient) {
    super(
      mongoClient,
      'stats',
      (doc) => doc._id,
      'data',  // Collection type
      'v1'     // Schema version
    );
  }

  /**
   * Get stats as object (legacy compatibility)
   * Converts array of documents to object format: { key: value }
   * @returns {Promise<Object>} Stats object
   */
  async getAsObject() {
    try {
      const docs = await this.findByQuery({});
      
      const result = {};
      for (const doc of docs) {
        result[doc._id] = doc.value || doc;
      }
      return result;
    } catch (error) {
      logger.error(`Error getting stats as object: ${error.message}`);
      return {};
    }
  }
}

