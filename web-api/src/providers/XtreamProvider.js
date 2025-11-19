import { BaseIPTVProvider } from './BaseIPTVProvider.js';
import path from 'path';

/**
 * Xtream Codec provider implementation
 * Handles Xtream-specific API calls for categories, metadata, and extended info
 * @extends {BaseIPTVProvider}
 */
export class XtreamProvider extends BaseIPTVProvider {
  /**
   * Xtream type configuration mapping
   * @private
   * @type {Object<string, Object>}
   */
  _xtreamTypeConfig = {
    movies: {
      categoryAction: 'get_vod_categories',
      metadataAction: 'get_vod_streams',
      extendedInfoAction: 'get_vod_info',
      extendedInfoParam: 'vod_id'
    },
    tvshows: {
      categoryAction: 'get_series_categories',
      metadataAction: 'get_series',
      extendedInfoAction: 'get_series_info',
      extendedInfoParam: 'series_id'
    }
  };

  /**
   * Fetch categories from Xtream provider
   * @param {string} providerId - Provider ID
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Promise<Array>} Array of category objects
   */
  async fetchCategories(providerId, type) {
    const provider = this._getProviderConfig(providerId);
    
    // Get type config
    const config = this._xtreamTypeConfig[type];
    if (!config) {
      throw new Error(`Unsupported type: ${type}`);
    }
    
    // Build API URL using config
    const queryParams = new URLSearchParams({
      username: provider.username,
      password: provider.password,
      action: config.categoryAction
    });
    
    const url = `${provider.api_url}/player_api.php?${queryParams.toString()}`;
    const limiter = this._getLimiter(providerId);

    return await this._fetchJsonWithCacheAxios({
      providerId,
      type,
      endpoint: 'categories',
      url,
      headers: {},
      limiter,
      transform: (data) => {
        const categories = Array.isArray(data) ? data : [];
        return categories.map(cat => ({
          category_id: cat.category_id || cat.id,
          category_name: cat.category_name || cat.name
        }));
      }
    });
  }

  /**
   * Fetch metadata from Xtream provider
   * @param {string} providerId - Provider ID
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Promise<Array>} Array of title objects
   */
  async fetchMetadata(providerId, type) {
    const provider = this._getProviderConfig(providerId);
    
    // Get type config
    const config = this._xtreamTypeConfig[type];
    if (!config) {
      throw new Error(`Unsupported type: ${type}`);
    }
    
    const queryParams = new URLSearchParams({
      username: provider.username,
      password: provider.password,
      action: config.metadataAction
    });
    
    const url = `${provider.api_url}/player_api.php?${queryParams.toString()}`;
    const limiter = this._getLimiter(providerId);

    return await this._fetchJsonWithCacheAxios({
      providerId,
      type,
      endpoint: 'metadata',
      url,
      headers: {},
      limiter
    });
  }

  /**
   * Fetch extended info from Xtream provider
   * @param {string} providerId - Provider ID
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @param {string} titleId - Title ID
   * @returns {Promise<Object>} Extended info object
   */
  async fetchExtendedInfo(providerId, type, titleId) {
    const provider = this._getProviderConfig(providerId);
    
    // Get type config
    const config = this._xtreamTypeConfig[type];
    if (!config) {
      throw new Error(`Unsupported type: ${type}`);
    }
    
    const queryParams = new URLSearchParams({
      username: provider.username,
      password: provider.password,
      action: config.extendedInfoAction,
      [config.extendedInfoParam]: titleId
    });
    
    const url = `${provider.api_url}/player_api.php?${queryParams.toString()}`;
    const limiter = this._getLimiter(providerId);

    return await this._fetchJsonWithCacheAxios({
      providerId,
      type,
      endpoint: 'extended',
      cacheParams: { titleId },
      url,
      headers: {},
      limiter
    });
  }

  /**
   * Get cache key mappings for Xtream provider
   * @private
   * @param {string} providerId - Provider ID
   * @returns {Object<string, {type: string, endpoint: string, dirBuilder: Function, fileBuilder: Function, cacheParams?: Object, ttl: number|null}>} Mapping of cache key identifier to cache configuration
   */
  _getCacheKeyMappings(providerId) {
    return {
      'categories-movies': {
        type: 'movies',
        endpoint: 'categories',
        dirBuilder: (cacheDir, providerId, params) => {
          return path.join(cacheDir, providerId, 'categories');
        },
        fileBuilder: (cacheDir, providerId, type, params) => {
          const dirPath = path.join(cacheDir, providerId, 'categories');
          return path.join(dirPath, `${type}.json`);
        },
        ttl: 1 // 1 hour
      },
      'categories-tvshows': {
        type: 'tvshows',
        endpoint: 'categories',
        dirBuilder: (cacheDir, providerId, params) => {
          return path.join(cacheDir, providerId, 'categories');
        },
        fileBuilder: (cacheDir, providerId, type, params) => {
          const dirPath = path.join(cacheDir, providerId, 'categories');
          return path.join(dirPath, `${type}.json`);
        },
        ttl: 1 // 1 hour
      },
      'metadata-movies': {
        type: 'movies',
        endpoint: 'metadata',
        dirBuilder: (cacheDir, providerId, params) => {
          return path.join(cacheDir, providerId, 'metadata');
        },
        fileBuilder: (cacheDir, providerId, type, params) => {
          const dirPath = path.join(cacheDir, providerId, 'metadata');
          return path.join(dirPath, `${type}.json`);
        },
        ttl: 1 // 1 hour
      },
      'metadata-tvshows': {
        type: 'tvshows',
        endpoint: 'metadata',
        dirBuilder: (cacheDir, providerId, params) => {
          return path.join(cacheDir, providerId, 'metadata');
        },
        fileBuilder: (cacheDir, providerId, type, params) => {
          const dirPath = path.join(cacheDir, providerId, 'metadata');
          return path.join(dirPath, `${type}.json`);
        },
        ttl: 1 // 1 hour
      },
      // Extended info is dynamic per titleId
      'extended-movies': {
        type: 'movies',
        endpoint: 'extended',
        dirBuilder: (cacheDir, providerId, params) => {
          // Base directory for all extended movies
          return path.join(cacheDir, providerId, 'extended', 'movies');
        },
        fileBuilder: (cacheDir, providerId, type, params) => {
          if (!params.titleId) {
            throw new Error('titleId is required for extended endpoint');
          }
          const dirPath = path.join(cacheDir, providerId, 'extended', type);
          return path.join(dirPath, `${params.titleId}.json`);
        },
        ttl: null // Never expire for movies
      },
      'extended-tvshows': {
        type: 'tvshows',
        endpoint: 'extended',
        dirBuilder: (cacheDir, providerId, params) => {
          // Base directory for all extended tvshows
          return path.join(cacheDir, providerId, 'extended', 'tvshows');
        },
        fileBuilder: (cacheDir, providerId, type, params) => {
          if (!params.titleId) {
            throw new Error('titleId is required for extended endpoint');
          }
          const dirPath = path.join(cacheDir, providerId, 'extended', type);
          return path.join(dirPath, `${params.titleId}.json`);
        },
        ttl: 48 // 6 hours for tvshows
      }
    };
  }
}

