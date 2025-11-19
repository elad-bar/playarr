import { BaseRepository } from './BaseRepository.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('TitleRepository');

/**
 * Repository for titles collection
 * Handles all operations related to main titles
 */
export class TitleRepository extends BaseRepository {
  /**
   * @param {import('mongodb').MongoClient} mongoClient - MongoDB client instance
   */
  constructor(mongoClient) {
    super(
      mongoClient,
      'titles',
      (doc) => doc.title_key
    );
  }

  /**
   * Build existence query for titles
   * @protected
   * @param {Object} doc - Document
   * @param {Object} options - Options
   * @returns {Object} Query object
   */
  buildExistenceQuery(doc, options) {
    return {
      title_key: doc.title_key
    };
  }

  /**
   * Build key for existence check
   * @protected
   * @param {Object} doc - Document
   * @param {Object} options - Options
   * @returns {string|null} Key or null
   */
  buildKeyForCheck(doc, options) {
    return doc.title_key || null;
  }

  /**
   * Get document key for existence check
   * @protected
   * @param {Object} doc - Document
   * @returns {string|null} Key or null
   */
  getDocumentKey(doc) {
    return doc.title_key || null;
  }

  /**
   * Build update operation
   * @protected
   * @param {Object} doc - Document to update
   * @param {Object} options - Options
   * @returns {Object} Bulk write operation
   */
  buildUpdateOperation(doc, options) {
    return {
      updateOne: {
        filter: { title_key: doc.title_key },
        update: {
          $set: {
            ...doc,
            lastUpdated: new Date()
          }
        }
      }
    };
  }

  /**
   * Get index definitions for titles collection
   * @returns {Array<Object>} Array of index definitions
   */
  getIndexDefinitions() {
    return [
      {
        key: { title_key: 1 },
        options: { unique: true },
        duplicateKey: { title_key: 1 },
        description: 'Primary lookup (unique)'
      },
      {
        key: { type: 1, title: 1 },
        options: {},
        description: 'Most common query pattern (type filter + alphabetical sort)'
      },
      {
        key: { type: 1, release_date: 1 },
        options: {},
        description: 'Date range queries with type'
      },
      {
        key: { release_date: 1 },
        options: {},
        description: 'Release date only'
      },
      {
        key: { type: 1, imdb_id: 1 },
        options: { sparse: true }, // Sparse index since imdb_id may be null for some titles
        description: 'Stremio IMDB ID lookups (type + imdb_id)'
      },
      {
        key: { 'media.sources.provider_id': 1 },
        options: {},
        description: 'Provider-based queries on media sources'
      },
      {
        key: { type: 1, 'media.sources.provider_id': 1 },
        options: {},
        description: 'Type + provider combination queries'
      }
    ];
  }

  /**
   * Initialize database indexes for titles collection
   * Creates all required indexes if they don't exist
   * Also handles text index separately (special case)
   * @returns {Promise<void>}
   */
  async initializeIndexes() {
    try {
      // Use base implementation for standard indexes
      await super.initializeIndexes();

      // Handle text index separately (special case)
      try {
        const collection = this.db.collection(this.collectionName);
        const indexes = await collection.indexes();
        const hasTextIndex = indexes.some(idx => idx.textIndexVersion !== undefined);
        if (!hasTextIndex) {
          await collection.createIndex({ title: 'text' });
          logger.debug('Created text index: title');
        }
      } catch (error) {
        // Text index might fail if there's already a different index on title
        // This is okay, we'll use regex search instead
        logger.debug('Text index creation skipped (may already exist or conflict)');
      }

      logger.debug('TitleRepository indexes initialized');
    } catch (error) {
      logger.error(`Error initializing indexes: ${error.message}`);
      throw error;
    }
  }

  /**
   * Find titles by title_key array
   * @param {Array<string>} keys - Array of title_key values
   * @returns {Promise<Array<Object>>} Array of title documents
   */
  async findByTitleKeys(keys) {
    return await super.findByKeys(keys, 'title_key');
  }

  /**
   * Get main titles with lastUpdated timestamp
   * Returns title_key, title_id, type, and lastUpdated for change detection
   * @returns {Promise<Array<Object>>} Array of title documents with lastUpdated information
   */
  async getMainTitlesLastUpdated() {
    return await this.findByQuery(
      {},
      {
        projection: {
          title_key: 1,
          title_id: 1,
          type: 1,
          lastUpdated: 1
        }
      }
    );
  }

  /**
   * Remove provider from titles.streams
   * This method is no longer used - provider removal is handled directly via MongoDB $pull operations
   * Kept for backward compatibility but returns zero counts
   * @param {string} providerId - Provider ID to remove
   * @param {Array<string>} titleKeys - Array of title_key values
   * @returns {Promise<{titlesUpdated: number, streamsRemoved: number}>}
   */
  async removeProviderFromStreams(providerId, titleKeys) {
    // This method is no longer used - provider removal is handled in ProvidersManager
    // using MongoDB $pull operations on titles.media[].sources
    return { titlesUpdated: 0, streamsRemoved: 0 };
  }

  /**
   * Delete titles without streams
   * This method is no longer used - title deletion is handled directly in ProvidersManager
   * Kept for backward compatibility
   * @param {Array<string>} titleKeys - Array of title_key values to check
   * @param {Set<string>} titleKeysWithStreams - Set of title_keys that have streams (unused)
   * @returns {Promise<number>} Number of deleted titles
   */
  async deleteWithoutStreams(titleKeys, titleKeysWithStreams) {
    // This method is no longer used - title deletion is handled in ProvidersManager
    // by querying titles.media array directly
    return 0;
  }
}

