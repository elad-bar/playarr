import { createLogger } from '../utils/logger.js';

/**
 * Base class for all IPTV providers (Xtream, AGTV)
 * Provides common functionality for fetching provider configurations and accessing storage
 * @abstract
 */
export class BaseIPTVProvider {
  /**
   * @param {import('../services/mongodb-database.js').MongoDatabaseService} database - Database service instance
   * @param {import('../services/providerApiStorage.js').ProviderApiStorage} storage - Provider API disk storage instance
   */
  constructor(database, storage) {
    this._database = database;
    this._storage = storage;
    this._providersCollection = 'iptv_providers';
    this.logger = createLogger(this.constructor.name);
  }

  /**
   * Get provider configuration from database
   * @param {string} providerId - Provider ID
   * @returns {Promise<Object>} Provider configuration
   */
  async _getProviderConfig(providerId) {
    const provider = await this._database.getData(this._providersCollection, { id: providerId });
    
    if (!provider) {
      throw new Error(`Provider ${providerId} not found`);
    }
    
    if (provider.deleted) {
      throw new Error(`Provider ${providerId} is deleted`);
    }
    
    return provider;
  }

  /**
   * Fetch categories from provider
   * @param {string} providerId - Provider ID
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Promise<Array>} Array of category objects
   * @abstract
   */
  async fetchCategories(providerId, type) {
    return []
  }

  /**
   * Fetch metadata from provider
   * @param {string} providerId - Provider ID
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Promise<Array>} Array of title objects
   * @abstract
   */
  async fetchMetadata(providerId, type) {
    throw new Error('fetchMetadata() must be implemented by subclass');
  }

  /**
   * Fetch extended info from provider
   * @param {string} providerId - Provider ID
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @param {string} titleId - Title ID
   * @returns {Promise<Object>} Extended info object
   * @abstract
   */
  async fetchExtendedInfo(providerId, type, titleId) {
    throw new Error('fetchExtendedInfo() must be implemented by subclass');
  }

  /**
   * Fetch M3U8 content from provider
   * @param {string} providerId - Provider ID
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @param {number} [page] - Page number (for paginated types)
   * @returns {Promise<string>} M3U8 content as string
   * @abstract
   */
  async fetchM3U8(providerId, type, page = null) {
    throw new Error('fetchM3U8() must be implemented by subclass');
  }
}

