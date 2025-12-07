import { BaseProvider } from './BaseProvider.js';
import path from 'path';

const TMDB_API_URL = 'https://api.themoviedb.org/3';
const TMDB_AUTH_URL = `${TMDB_API_URL}/authentication`;
const API_REQUEST_TIMEOUT = 5000; // 5 seconds

// TMDB rate limit: 45 requests per second
const TMDB_RATE_CONFIG = {
  concurrent: 45,
  duration_seconds: 1
};

/**
 * TMDB provider for raw API calls
 * Includes rate limiting and caching via Bottleneck and disk storage
 * @extends {BaseProvider}
 */
export class TMDBProvider extends BaseProvider {
  /**
   * @param {string} [apiKey] - Optional TMDB API key (can be set later via updateApiKey)
   * @param {string} [cacheDir] - Optional cache directory path (defaults to CACHE_DIR env var or '/app/cache')
   * @param {import('../services/metrics.js').default} metricsService - Metrics service instance (required)
   */
  constructor(apiKey = null, cacheDir = null, metricsService) {
    super('TMDBProvider', cacheDir, metricsService);
    this._apiKey = apiKey;
    this._headers = this._buildHeaders(apiKey);
    
    // Create rate limiter
    this.limiter = this._createLimiter(TMDB_RATE_CONFIG);
    
    // Initialize cache directories
    this.initialize('tmdb');
    
    /**
     * Type mapping configuration for TMDB API
     * Maps media types to their endpoint paths and parameter names
     * @private
     * @type {Object<string, Object>}
     */
    this._typeConfig = {
      movie: {
        searchEndpoint: '/search/movie',
        detailsEndpoint: '/movie',
        similarEndpoint: '/movie',
        yearParam: 'year'
      },
      tv: {
        searchEndpoint: '/search/tv',
        detailsEndpoint: '/tv',
        similarEndpoint: '/tv',
        yearParam: 'first_air_date_year'
      }
    };
  }

  /**
   * Build headers object for API requests
   * @private
   * @param {string} apiKey - TMDB API key
   * @returns {Object} Headers object
   */
  _buildHeaders(apiKey) {
    if (!apiKey) {
      return {
        'Accept': 'application/json'
      };
    }
    return {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json'
    };
  }

  /**
   * Update the API key and rebuild headers
   * @param {string} apiKey - New TMDB API key
   */
  updateApiKey(apiKey) {
    this._apiKey = apiKey;
    this._headers = this._buildHeaders(apiKey);
    this.logger.debug('TMDB API key updated');
  }

  /**
   * Verify a TMDB API key
   * Note: This method uses the provided apiKey parameter (not stored key) for verification
   * @param {string} apiKey - TMDB API key to verify
   * @returns {Promise<Object>} Verification result with success, status_message, status_code
   */
  async verifyApiKey(apiKey) {
    const headers = this._buildHeaders(apiKey);

    try {
      const result = await this._httpGet({
        providerId: 'tmdb',
        type: 'auth', // Dummy type for verification endpoint
        endpoint: 'tmdb-verify',
        cacheParams: {},
        url: TMDB_AUTH_URL,
        headers,
        skipCache: true, // Don't cache verification results
        timeout: API_REQUEST_TIMEOUT,
        allowNonOk: true, // Allow 401 responses for invalid keys
        transform: (data, responseStatus) => {
          return {
            success: responseStatus === 200 && data.success === true,
            status_message: data.status_message,
            status_code: responseStatus
          };
        }
      });

      return result;
    } catch (error) {
      if (error.message === 'Request timeout') {
        return { 
          success: false, 
          status_message: 'Request timeout', 
          status_code: 500 
        };
      }
      throw error;
    }
  }

  /**
   * Search for movies or TV shows
   * @param {string} type - Media type: 'movie' or 'tv'
   * @param {string} title - Title to search for
   * @param {number|null} year - Optional release year
   * @returns {Promise<Object>} TMDB search results
   */
  async search(type, title, year = null) {
    if (!this._apiKey) {
      throw new Error('TMDB API key not set. Call updateApiKey() first.');
    }

    const typeConfig = this._typeConfig[type];
    if (!typeConfig) {
      throw new Error(`Invalid media type: ${type}. Must be 'movie' or 'tv'`);
    }

    const params = new URLSearchParams({ query: title });
    
    if (year) {
      params.set(typeConfig.yearParam, year);
    }

    const url = `${TMDB_API_URL}${typeConfig.searchEndpoint}?${params.toString()}`;

    return await this._httpGet({
      providerId: 'tmdb',
      type,
      endpoint: 'tmdb-search',
      cacheParams: { title, year },
      url,
      headers: this._headers
    });
  }

  /**
   * Find TMDB ID by IMDB ID
   * @param {string} imdbId - IMDB ID
   * @param {string} type - Media type: 'movie' or 'tv' (required)
   * @returns {Promise<Object>} TMDB find results
   */
  async findByIMDBId(imdbId, type) {
    if (!this._apiKey) {
      throw new Error('TMDB API key not set. Call updateApiKey() first.');
    }

    if (!type) {
      throw new Error('Type parameter is required for findByIMDBId');
    }

    const url = `${TMDB_API_URL}/find/${imdbId}?external_source=imdb_id`;

    return await this._httpGet({
      providerId: 'tmdb',
      type,
      endpoint: 'tmdb-find',
      cacheParams: { imdbId },
      url,
      headers: this._headers
    });
  }

  /**
   * Get details by TMDB ID
   * @param {string} type - Media type: 'movie' or 'tv'
   * @param {number} tmdbId - TMDB ID
   * @returns {Promise<Object>} Media details
   */
  async getDetails(type, tmdbId) {
    if (!this._apiKey) {
      throw new Error('TMDB API key not set. Call updateApiKey() first.');
    }

    const typeConfig = this._typeConfig[type];
    if (!typeConfig) {
      throw new Error(`Invalid media type: ${type}. Must be 'movie' or 'tv'`);
    }

    const url = `${TMDB_API_URL}${typeConfig.detailsEndpoint}/${tmdbId}?append_to_response=external_ids`;

    return await this._httpGet({
      providerId: 'tmdb',
      type,
      endpoint: 'tmdb-details',
      cacheParams: { tmdbId },
      url,
      headers: this._headers
    });
  }

  /**
   * Get TV show season details
   * @param {number} tmdbId - TMDB TV show ID
   * @param {number} seasonNumber - Season number
   * @returns {Promise<Object>} Season details
   */
  async getSeasonDetails(tmdbId, seasonNumber) {
    if (!this._apiKey) {
      throw new Error('TMDB API key not set. Call updateApiKey() first.');
    }

    const url = `${TMDB_API_URL}/tv/${tmdbId}/season/${seasonNumber}`;

    return await this._httpGet({
      providerId: 'tmdb',
      type: 'tv',
      endpoint: 'tmdb-season',
      cacheParams: { tmdbId, seasonNumber },
      url,
      headers: this._headers
    });
  }

  /**
   * Get similar movies or TV shows
   * @param {string} type - Media type: 'movie' or 'tv'
   * @param {number} tmdbId - TMDB ID
   * @param {number} page - Page number (default: 1)
   * @returns {Promise<Object>} Similar media results
   */
  async getSimilar(type, tmdbId, page = 1) {
    if (!this._apiKey) {
      throw new Error('TMDB API key not set. Call updateApiKey() first.');
    }

    const typeConfig = this._typeConfig[type];
    if (!typeConfig) {
      throw new Error(`Invalid media type: ${type}. Must be 'movie' or 'tv'`);
    }

    const url = `${TMDB_API_URL}${typeConfig.similarEndpoint}/${tmdbId}/similar?page=${page}`;

    return await this._httpGet({
      providerId: 'tmdb',
      type,
      endpoint: 'tmdb-similar',
      cacheParams: { tmdbId, page },
      url,
      headers: this._headers
    });
  }

  /**
   * Get cache key mappings for TMDB provider
   * @private
   * @param {string} providerId - Provider ID (always 'tmdb')
   * @returns {Object<string, {type: string, endpoint: string, dirBuilder: Function, fileBuilder: Function, cacheParams?: Object, ttl: number|null}>} Mapping of cache key identifier to cache configuration
   */
  _getCacheKeyMappings(providerId) {
    return {
      'tmdb-search-movie': {
        type: 'movie',
        endpoint: 'tmdb-search',
        dirBuilder: (cacheDir, providerId, params) => {
          return path.join(cacheDir, 'tmdb', 'movie', 'search');
        },
        fileBuilder: (cacheDir, providerId, type, params) => {
          const safeTitle = (params.title || '').replace(/[^a-zA-Z0-9]/g, '_');
          const yearStr = params.year ? `_${params.year}` : '_no-year';
          const dirPath = path.join(cacheDir, 'tmdb', 'movie', 'search');
          return path.join(dirPath, `${safeTitle}${yearStr}.json`);
        },
        ttl: null // Never expire
      },
      'tmdb-search-tv': {
        type: 'tv',
        endpoint: 'tmdb-search',
        dirBuilder: (cacheDir, providerId, params) => {
          return path.join(cacheDir, 'tmdb', 'tv', 'search');
        },
        fileBuilder: (cacheDir, providerId, type, params) => {
          const safeTitle = (params.title || '').replace(/[^a-zA-Z0-9]/g, '_');
          const yearStr = params.year ? `_${params.year}` : '_no-year';
          const dirPath = path.join(cacheDir, 'tmdb', 'tv', 'search');
          return path.join(dirPath, `${safeTitle}${yearStr}.json`);
        },
        ttl: null // Never expire
      },
      'tmdb-find-movie': {
        type: 'movie',
        endpoint: 'tmdb-find',
        dirBuilder: (cacheDir, providerId, params) => {
          return path.join(cacheDir, 'tmdb', 'movie', 'imdb');
        },
        fileBuilder: (cacheDir, providerId, type, params) => {
          if (!params.imdbId) {
            throw new Error('imdbId is required for tmdb-find endpoint');
          }
          const dirPath = path.join(cacheDir, 'tmdb', 'movie', 'imdb');
          return path.join(dirPath, `${params.imdbId}.json`);
        },
        ttl: null // Never expire
      },
      'tmdb-find-tv': {
        type: 'tv',
        endpoint: 'tmdb-find',
        dirBuilder: (cacheDir, providerId, params) => {
          return path.join(cacheDir, 'tmdb', 'tv', 'imdb');
        },
        fileBuilder: (cacheDir, providerId, type, params) => {
          if (!params.imdbId) {
            throw new Error('imdbId is required for tmdb-find endpoint');
          }
          const dirPath = path.join(cacheDir, 'tmdb', 'tv', 'imdb');
          return path.join(dirPath, `${params.imdbId}.json`);
        },
        ttl: null // Never expire
      },
      'tmdb-details-movie': {
        type: 'movie',
        endpoint: 'tmdb-details',
        dirBuilder: (cacheDir, providerId, params) => {
          return path.join(cacheDir, 'tmdb', 'movie', 'details');
        },
        fileBuilder: (cacheDir, providerId, type, params) => {
          if (!params.tmdbId) {
            throw new Error('tmdbId is required for tmdb-details endpoint');
          }
          const dirPath = path.join(cacheDir, 'tmdb', 'movie', 'details');
          return path.join(dirPath, `${params.tmdbId}.json`);
        },
        ttl: null // Never expire
      },
      'tmdb-details-tv': {
        type: 'tv',
        endpoint: 'tmdb-details',
        dirBuilder: (cacheDir, providerId, params) => {
          return path.join(cacheDir, 'tmdb', 'tv', 'details');
        },
        fileBuilder: (cacheDir, providerId, type, params) => {
          if (!params.tmdbId) {
            throw new Error('tmdbId is required for tmdb-details endpoint');
          }
          const dirPath = path.join(cacheDir, 'tmdb', 'tv', 'details');
          return path.join(dirPath, `${params.tmdbId}.json`);
        },
        ttl: null // Never expire
      },
      'tmdb-season': {
        type: 'tv',
        endpoint: 'tmdb-season',
        dirBuilder: (cacheDir, providerId, params) => {
          return path.join(cacheDir, 'tmdb', 'tv', 'season');
        },
        fileBuilder: (cacheDir, providerId, type, params) => {
          if (!params.tmdbId || params.seasonNumber === undefined) {
            throw new Error('tmdbId and seasonNumber are required for tmdb-season endpoint');
          }
          const dirPath = path.join(cacheDir, 'tmdb', 'tv', 'season');
          return path.join(dirPath, `${params.tmdbId}-S${params.seasonNumber}.json`);
        },
        ttl: 6 // 6 hours
      },
      'tmdb-similar-movie': {
        type: 'movie',
        endpoint: 'tmdb-similar',
        dirBuilder: (cacheDir, providerId, params) => {
          return path.join(cacheDir, 'tmdb', 'movie', 'similar');
        },
        fileBuilder: (cacheDir, providerId, type, params) => {
          if (!params.tmdbId) {
            throw new Error('tmdbId is required for tmdb-similar endpoint');
          }
          const page = params.page || 1;
          const dirPath = path.join(cacheDir, 'tmdb', 'movie', 'similar');
          return path.join(dirPath, `${params.tmdbId}-${page}.json`);
        },
        ttl: null // Never expire
      },
      'tmdb-similar-tv': {
        type: 'tv',
        endpoint: 'tmdb-similar',
        dirBuilder: (cacheDir, providerId, params) => {
          return path.join(cacheDir, 'tmdb', 'tv', 'similar');
        },
        fileBuilder: (cacheDir, providerId, type, params) => {
          if (!params.tmdbId) {
            throw new Error('tmdbId is required for tmdb-similar endpoint');
          }
          const page = params.page || 1;
          const dirPath = path.join(cacheDir, 'tmdb', 'tv', 'similar');
          return path.join(dirPath, `${params.tmdbId}-${page}.json`);
        },
        ttl: null // Never expire
      }
    };
  }
}

