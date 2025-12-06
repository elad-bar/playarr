import { BaseRepository } from './BaseRepository.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ProviderRepository');

/**
 * Repository for iptv_providers collection
 * Minimal repository - uses BaseRepository methods directly
 */
export class ProviderRepository extends BaseRepository {
  /**
   * @param {import('mongodb').MongoClient} mongoClient - MongoDB client instance
   */
  constructor(mongoClient) {
    super(
      mongoClient,
      'iptv_providers',
      (doc) => doc.id,
      'configuration', // Collection type
      'v2'             // Schema version (was v1, needs enabled_categories.live)
    );
  }

  /**
   * Get index definitions for iptv_providers collection
   * @returns {Array<Object>} Array of index definitions
   */
  /**
   * Get version definitions with structure and transformation functions
   * @returns {Object} Version definitions dictionary
   */
  getVersionDefinitions() {
    return {
      "v1": {
        "id": 1,
        "structure": {
          // Documentation of v1 schema structure
          id: String,
          type: String,
          enabled: Boolean,
          priority: Number,
          deleted: Boolean,
          enabled_categories: {
            movies: Array,
            tvshows: Array
          }
          // live categories not in v1
        },
        "transformation": null // No transformation from nothing to v1
      },
      "v2": {
        "id": 2,
        "structure": {
          // Documentation of v2 schema structure
          id: String,
          type: String,
          enabled: Boolean,
          priority: Number,
          deleted: Boolean,
          enabled_categories: {
            movies: Array,
            tvshows: Array,
            live: Array // NEW: Live channel categories (managed automatically)
          },
          sync_media_types: {  // NEW: Media type sync control
            movies: Boolean,
            tvshows: Boolean,
            live: Boolean
          }
        },
        "transformation": async (doc) => {
          // Transform document from v1 to v2
          // Add enabled_categories.live and sync_media_types
          return {
            ...doc,
            enabled_categories: {
              ...doc.enabled_categories,
              live: doc.enabled_categories?.live || [] // Empty array, populated during sync
            },
            sync_media_types: {
              movies: true,  // Existing providers: enable all by default
              tvshows: true,
              live: true
            }
          };
        }
      }
    };
  }

  getIndexDefinitions() {
    return [
      {
        key: { id: 1 },
        options: { unique: true },
        duplicateKey: { id: 1 },
        description: 'Primary lookup (unique)'
      },
      {
        key: { deleted: 1, priority: 1 },
        options: {},
        description: 'Active providers with priority sort'
      },
      {
        key: { priority: 1 },
        options: { partialFilterExpression: { deleted: false } },
        description: 'Non-deleted providers with priority sort (partial index)'
      }
    ];
  }
  
  // No wrapper methods needed - use inherited methods directly:
  // - findByQuery() for queries
  // - findOneByQuery() for single document
  // - insertOne() for inserts
  // - updateOne() for updates
  // - deleteOne() for deletes
}

