import { BaseIPTVProvider } from './BaseIPTVProvider.js';
import path from 'path';

/**
 * Apollo Group TV provider implementation
 * Handles AGTV-specific API calls for M3U8 content
 * @extends {BaseIPTVProvider}
 */
export class AGTVProvider extends BaseIPTVProvider {

  /**
   * Authenticate with AGTV provider and get account details
   * Calls /login endpoint to get expiration date
   * Connection information is not available from API, so returns hardcoded values
   * @param {string} providerId - Provider ID
   * @returns {Promise<Object>} Provider details object with expiration_date, max_connections, active_connections
   */
  async authenticate(providerId) {
    try {
      const provider = this._getProviderConfig(providerId);
      const limiter = this._getLimiter(providerId);

      // Step 1: Login to get token
      const loginUrl = `${provider.api_url}/api/login`;
      const loginResponse = await this._fetchJsonPostWithCacheAxios({
        providerId,
        type: 'auth',
        endpoint: 'login',
        url: loginUrl,
        data: {
          username: provider.username,
          password: provider.password
        },
        headers: {},
        limiter,
        skipCache: true
      });

      // Extract token from login response
      const token = loginResponse.data?.token;
      if (!token) {
        throw new Error('No token received from login');
      }

      // Step 2: Get user info with token
      const userUrl = `${provider.api_url}/api/user`;
      const userResponse = await this._fetchJsonWithCacheAxios({
        providerId,
        type: 'auth',
        endpoint: 'user',
        url: userUrl,
        headers: {
          'Authorization': `Bearer ${token}`
        },
        limiter,
        skipCache: true
      });

      // Parse expiration date from expiration_date_timestamp
      const expirationTimestamp = userResponse.data?.expiration_date_timestamp;
      const expirationDate = expirationTimestamp ? expirationTimestamp : null;

      // AGTV does not provide connection information via API
      // Return hardcoded values as per specification
      // max_connections: 5 (hardcoded, not available from API)
      // active_connections: 0 (cannot be retrieved from API)
      
      return {
        expiration_date: expirationDate,
        max_connections: 5,
        active_connections: 0
      };
    } catch (error) {
      this.logger.error(`[${providerId}] Error authenticating with AGTV provider: ${error.message}`);
      // Return hardcoded values on error
      return {
        expiration_date: null,
        max_connections: 5,
        active_connections: 0
      };
    }
  }

  /**
   * Fetch M3U8 content from AGTV provider
   * @param {string} providerId - Provider ID
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @param {number} [page] - Page number (for paginated types)
   * @returns {Promise<string>} M3U8 content as string
   */
  async fetchM3U8(providerId, type, page = null) {
    const provider = this._getProviderConfig(providerId);
    
    let url = `${provider.api_url}/api/list/${provider.username}/${provider.password}/m3u8/${type}`;
    
    // Add page if provided (for paginated types like tvshows)
    if (page) {
      url += `/${page}`;
    }
    
    const limiter = this._getLimiter(providerId);

    return await this._fetchTextWithCacheAxios({
      providerId,
      type,
      endpoint: 'm3u8',
      cacheParams: page ? { page } : {},
      url,
      headers: {},
      limiter
    });
  }

  /**
   * Get cache key mappings for AGTV provider
   * @private
   * @param {string} providerId - Provider ID
   * @returns {Object<string, {type: string, endpoint: string, dirBuilder: Function, fileBuilder: Function, cacheParams?: Object, ttl: number|null}>} Mapping of cache key identifier to cache configuration
   */
  _getCacheKeyMappings(providerId) {
    return {
      // Authentication endpoints
      'login-auth': {
        type: 'auth',
        endpoint: 'login',
        dirBuilder: (cacheDir, providerId, params) => {
          return path.join(cacheDir, providerId, 'auth');
        },
        fileBuilder: (cacheDir, providerId, type, params) => {
          const dirPath = path.join(cacheDir, providerId, 'auth');
          return path.join(dirPath, 'login.json');
        },
        ttl: null // Never expire (for debugging)
      },
      'user-auth': {
        type: 'auth',
        endpoint: 'user',
        dirBuilder: (cacheDir, providerId, params) => {
          return path.join(cacheDir, providerId, 'auth');
        },
        fileBuilder: (cacheDir, providerId, type, params) => {
          const dirPath = path.join(cacheDir, providerId, 'auth');
          return path.join(dirPath, 'user.json');
        },
        ttl: null // Never expire (for debugging)
      },
      // Movies M3U8 (no page param = list.m3u8)
      'm3u8-movies': {
        type: 'movies',
        endpoint: 'm3u8',
        dirBuilder: (cacheDir, providerId, params) => {
          return path.join(cacheDir, providerId, 'movies', 'metadata');
        },
        fileBuilder: (cacheDir, providerId, type, params) => {
          const dirPath = path.join(cacheDir, providerId, type, 'metadata');
          const filename = params.page ? `list-${params.page}.m3u8` : 'list.m3u8';
          return path.join(dirPath, filename);
        },
        ttl: 6 // 6 hours
      },
      'm3u8-tvshows': {
        type: 'tvshows',
        endpoint: 'm3u8',
        dirBuilder: (cacheDir, providerId, params) => {
          return path.join(cacheDir, providerId, 'tvshows', 'metadata');
        },
        fileBuilder: (cacheDir, providerId, type, params) => {
          const dirPath = path.join(cacheDir, providerId, type, 'metadata');
          const filename = params.page ? `list-${params.page}.m3u8` : 'list.m3u8';
          return path.join(dirPath, filename);
        },
        ttl: 6 // 6 hours
      }
    };
  }
}

