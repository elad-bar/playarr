import { BaseRepository } from './BaseRepository.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('UserRepository');

/**
 * Repository for users collection
 * Minimal repository - uses BaseRepository methods directly
 */
export class UserRepository extends BaseRepository {
  /**
   * @param {import('mongodb').MongoClient} mongoClient - MongoDB client instance
   */
  constructor(mongoClient) {
    super(
      mongoClient,
      'users',
      (doc) => doc.username,
      'configuration', // Collection type
      'v2'             // Schema version (was v1 with liveTV field)
    );
  }

  /**
   * Get index definitions for users collection
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
          username: String,
          password_hash: String,
          api_key: String,
          role: String,
          watchlist: Array,
          liveTV: {
            m3u_url: String,
            epg_url: String
          }
        },
        "transformation": null // No transformation from nothing to v1
      },
      "v2": {
        "id": 2,
        "structure": {
          // Documentation of v2 schema structure
          username: String,
          password_hash: String,
          api_key: String,
          role: String,
          watchlist: {
            movies: Array,      // Array of title keys (format: "movies-{id}")
            tvshows: Array,     // Array of title keys (format: "tvshows-{id}")
            live: Array        // Array of channel keys (format: "live-{providerId}-{channelId}")
          }
          // liveTV removed in v2
          // watchlist_channels removed in v2 (moved to watchlist.live)
        },
        "transformation": async (doc) => {
          const { liveTV, watchlist: oldWatchlist, ...rest } = doc;
          
          const watchlist = {
            movies: [],
            tvshows: [],
            live: []
          };
          
          if (Array.isArray(oldWatchlist)) {
            oldWatchlist.forEach(key => {
              if (key.startsWith('movies-')) {
                watchlist.movies.push(key);
              } else if (key.startsWith('tvshows-')) {
                watchlist.tvshows.push(key);
              }
            });
          }
          
          return {
            ...rest,
            watchlist
          };
        }
      }
    };
  }

  getIndexDefinitions() {
    return [
      {
        key: { username: 1 },
        options: { unique: true },
        duplicateKey: { username: 1 },
        description: 'Authentication (unique)'
      },
      {
        key: { api_key: 1 },
        options: { unique: true, sparse: true },
        duplicateKey: { api_key: 1 },
        description: 'API key authentication (unique, sparse)'
      }
    ];
  }
  
  // No wrapper methods needed - use inherited methods directly:
  // - findOneByQuery({ username }) for get by username
  // - findOneByQuery({ api_key }) for get by API key
  // - findByQuery({}) for get all
  // - insertOne() for creates
  // - updateOne() for updates
  // - deleteOne() for deletes
}

