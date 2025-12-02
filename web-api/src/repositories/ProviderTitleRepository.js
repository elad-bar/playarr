import { BaseRepository } from './BaseRepository.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ProviderTitleRepository');

/**
 * Repository for provider_titles collection
 * Handles all operations related to provider-specific titles
 */
export class ProviderTitleRepository extends BaseRepository {
  /**
   * @param {import('mongodb').MongoClient} mongoClient - MongoDB client instance
   */
  constructor(mongoClient) {
    super(
      mongoClient,
      'provider_titles',
      (doc) => `${doc.provider_id}|${doc.title_key}`
    );
  }


  /**
   * Get index definitions for provider_titles collection
   * @returns {Array<Object>} Array of index definitions
   */
  getIndexDefinitions() {
    return [
      {
        key: { provider_id: 1, title_key: 1 },
        options: { unique: true },
        duplicateKey: { provider_id: 1, title_key: 1 },
        description: 'Primary lookup (unique compound key)'
      },
      {
        key: { provider_id: 1, type: 1 },
        options: {},
        description: 'Most common query pattern'
      },
      {
        key: { provider_id: 1, ignored: 1 },
        options: {},
        description: 'Ignored titles filtering'
      },
      {
        key: { provider_id: 1, lastUpdated: 1 },
        options: {},
        description: 'Incremental sync queries'
      },
      {
        key: { provider_id: 1, ignored: 1, lastUpdated: 1 },
        options: {},
        description: 'Incremental sync queries with ignored filter'
      },
      {
        key: { provider_id: 1, type: 1, ignored: 1 },
        options: {},
        description: 'Type+ignored filtering per provider'
      },
      {
        key: { title_key: 1 },
        options: {},
        description: 'Find all providers for a title'
      },
      {
        key: { type: 1, tmdb_id: 1, ignored: 1 },
        options: {},
        description: 'Change detection queries (type + tmdb_id + ignored filter)'
      }
    ];
  }


  /**
   * Get provider titles for change detection
   * Returns all non-ignored provider titles with tmdb_id and type for aggregating lastUpdated timestamps
   * @returns {Promise<Array<Object>>} Array of provider title documents with lastUpdated information
   */
  async getProviderTitlesForChangeDetection() {
    return await this.findByQuery(
      {
        ignored: false,
        tmdb_id: { $exists: true, $ne: null },
        type: { $in: ['movies', 'tvshows'] }
      },
      {
        projection: {
          type: 1,
          tmdb_id: 1,
          lastUpdated: 1,
          provider_id: 1
        }
      }
    );
  }
}

