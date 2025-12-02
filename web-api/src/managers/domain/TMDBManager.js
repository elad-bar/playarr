import { BaseManager } from '../BaseManager.js';
import { AppError } from '../../errors/AppError.js';

const TMDB_TOKEN_KEY = 'tmdb_token';

/**
 * TMDB Manager (Domain Manager)
 * Type A: Domain Manager
 * Manages TMDB API operations for use by Processing Managers and Routers
 * Note: Does not extend BaseDomainManager as it doesn't manage a database domain
 */
class TMDBManager extends BaseManager {
  /**
   * @param {import('../../providers/TMDBProvider.js').TMDBProvider} tmdbProvider - TMDB provider instance
   */
  constructor(tmdbProvider) {
    super('TMDBManager');
    if (!tmdbProvider) {
      throw new Error('TMDBProvider is required');
    }
    this._tmdbTokenKey = TMDB_TOKEN_KEY;
    this._tmdbProvider = tmdbProvider;
  }

  /**
   * Update provider API key when API key is set
   * @param {string} apiKey - TMDB API key
   */
  updateProviderApiKey(apiKey) {
    this._tmdbProvider.updateApiKey(apiKey);
  }

  /**
   * Verify a TMDB API key
   * Matches Python's TMDBVerificationService.verify_api_key()
   * @param {string} apiKey - TMDB API key to verify
   * @returns {Promise<{valid: boolean, message: string}>} Verification result
   * @throws {AppError} If an error occurs
   */
  async verifyApiKey(apiKey) {
    try {
      const result = await this._tmdbProvider.verifyApiKey(apiKey);
      return {
        valid: result.success,
        message: result.success ? 'API key is valid' : result.status_message || 'Authentication failed',
      };
    } catch (error) {
      this.logger.error('Error verifying TMDB API key:', error);
      throw new AppError(`Error connecting to TMDB: ${error.message}`, 500);
    }
  }

  /**
   * Search for movies or TV shows
   * Wraps TMDBProvider.search() for use by Processing Managers
   * @param {string} type - Media type: 'movie' or 'tv'
   * @param {string} title - Title to search for
   * @param {number|null} year - Optional release year
   * @returns {Promise<Object>} TMDB search results
   * @throws {AppError} If an error occurs
   */
  async search(type, title, year = null) {
    try {
      return await this._tmdbProvider.search(type, title, year);
    } catch (error) {
      this.logger.error(`Error searching TMDB for ${type} "${title}":`, error);
      throw new AppError(`Failed to search TMDB: ${error.message}`, 500);
    }
  }

  /**
   * Find TMDB ID by IMDB ID
   * Wraps TMDBProvider.findByIMDBId() for use by Processing Managers
   * @param {string} imdbId - IMDB ID
   * @param {string} type - Media type: 'movie' or 'tv' (required)
   * @returns {Promise<Object>} TMDB find results
   * @throws {AppError} If an error occurs
   */
  async findByIMDBId(imdbId, type) {
    try {
      return await this._tmdbProvider.findByIMDBId(imdbId, type);
    } catch (error) {
      this.logger.error(`Error finding TMDB ID by IMDB ID ${imdbId}:`, error);
      throw new AppError(`Failed to find TMDB ID: ${error.message}`, 500);
    }
  }

  /**
   * Get details by TMDB ID
   * Wraps TMDBProvider.getDetails() for use by Processing Managers
   * @param {string} type - Media type: 'movie' or 'tv'
   * @param {number} tmdbId - TMDB ID
   * @returns {Promise<Object>} Media details
   * @throws {AppError} If an error occurs
   */
  async getDetails(type, tmdbId) {
    try {
      return await this._tmdbProvider.getDetails(type, tmdbId);
    } catch (error) {
      this.logger.error(`Error getting TMDB details for ${type} ${tmdbId}:`, error);
      throw new AppError(`Failed to get TMDB details: ${error.message}`, 500);
    }
  }

  /**
   * Get TV show season details
   * Wraps TMDBProvider.getSeasonDetails() for use by Processing Managers
   * @param {number} tmdbId - TMDB TV show ID
   * @param {number} seasonNumber - Season number
   * @returns {Promise<Object>} Season details
   * @throws {AppError} If an error occurs
   */
  async getSeasonDetails(tmdbId, seasonNumber) {
    try {
      return await this._tmdbProvider.getSeasonDetails(tmdbId, seasonNumber);
    } catch (error) {
      this.logger.error(`Error getting TMDB season details for ${tmdbId} season ${seasonNumber}:`, error);
      throw new AppError(`Failed to get TMDB season details: ${error.message}`, 500);
    }
  }

  /**
   * Get similar movies or TV shows
   * Wraps TMDBProvider.getSimilar() for use by Processing Managers
   * @param {string} type - Media type: 'movie' or 'tv'
   * @param {number} tmdbId - TMDB ID
   * @param {number} page - Page number (default: 1)
   * @returns {Promise<Object>} Similar media results
   * @throws {AppError} If an error occurs
   */
  async getSimilar(type, tmdbId, page = 1) {
    try {
      return await this._tmdbProvider.getSimilar(type, tmdbId, page);
    } catch (error) {
      this.logger.error(`Error getting similar TMDB results for ${type} ${tmdbId}:`, error);
      throw new AppError(`Failed to get similar TMDB results: ${error.message}`, 500);
    }
  }

  /**
   * Get cache access for TMDB provider (for internal cache operations)
   * @private
   * @param {string} providerId - Provider ID
   * @param {string} type - Media type
   * @param {string} endpoint - Endpoint identifier
   * @param {Object} params - Cache parameters
   * @returns {Object|null} Cached data or null
   */
  _getCache(providerId, type, endpoint, params) {
    return this._tmdbProvider._getCache(providerId, type, endpoint, params);
  }

}

// Export class
export { TMDBManager };

