import { BaseIPTVProvider } from './BaseIPTVProvider.js';
import path from 'path';

/**
 * Xtream Codec provider implementation
 * Handles Xtream-specific API calls for categories, metadata, and extended info
 * @extends {BaseIPTVProvider}
 */
export class XtreamProvider extends BaseIPTVProvider {
  /**
   * @param {Object<string, Object>} providerConfigs - Map of provider ID to provider configuration
   * @param {string} [cacheDir] - Optional cache directory path (defaults to CACHE_DIR env var or '/app/cache')
   */
  constructor(providerConfigs = {}, cacheDir = null) {
    super('XtreamProvider', providerConfigs, cacheDir);
  }

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

    return await this._httpGet({
      providerId,
      type,
      endpoint: 'categories',
      url,
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

    return await this._httpGet({
      providerId,
      type,
      endpoint: 'metadata',
      url
    });
  }

  /**
   * Authenticate with Xtream provider and get account details
   * @param {string} providerId - Provider ID
   * @returns {Promise<Object>} Provider details object with expiration_date, max_connections, active_connections
   */
  async authenticate(providerId) {
    try {
      const provider = this._getProviderConfig(providerId);
      
      // Build API URL without action parameter (authentication endpoint)
      const queryParams = new URLSearchParams({
        username: provider.username,
        password: provider.password
      });
      
      const url = `${provider.api_url}/player_api.php?${queryParams.toString()}`;

      const data = await this._httpGet({
        providerId,
        type: 'auth', // Use 'auth' as type for cache key
        endpoint: 'authenticate',
        url,
        skipCache: true // Don't cache authentication calls
      });

      // Parse user_info from response
      const userInfo = data.user_info;
      if (!userInfo) {
        this.logger.warn(`[${providerId}] No user_info in authentication response`);
        return {
          expiration_date: null,
          max_connections: 0,
          active_connections: 0
        };
      }

      // Extract and convert fields
      const expirationDate = userInfo.exp_date ? parseInt(userInfo.exp_date, 10) : null;
      const maxConnections = userInfo.max_connections ? parseInt(userInfo.max_connections, 10) : 0;
      const activeConnections = userInfo.active_cons ? parseInt(userInfo.active_cons, 10) : 0;
      // Convert status to active boolean: true if status is not "expired", false if expired, null if status is missing
      const status = userInfo.status?.toLowerCase();
      const active = status ? status !== 'expired' : null;

      return {
        expiration_date: expirationDate,
        max_connections: maxConnections,
        active_connections: activeConnections,
        active: active
      };
    } catch (error) {
      this.logger.error(`[${providerId}] Error authenticating with Xtream provider: ${error.message}`);
      // Return empty details on error
      return {
        expiration_date: null,
        max_connections: 0,
        active_connections: 0,
        active: null
      };
    }
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

    return await this._httpGet({
      providerId,
      type,
      endpoint: 'extended',
      cacheParams: { titleId },
      url
    });
  }

  /**
   * Fetch live TV categories from Xtream provider
   * @param {string} providerId - Provider ID
   * @returns {Promise<Array>} Array of category objects
   */
  async fetchLiveCategories(providerId) {
    const provider = this._getProviderConfig(providerId);
    const queryParams = new URLSearchParams({
      username: provider.username,
      password: provider.password,
      action: 'get_live_categories'
    });
    const url = `${provider.api_url}/player_api.php?${queryParams.toString()}`;
    
    return await this._httpGet({
      providerId,
      type: 'live',
      endpoint: 'live_categories',
      url,
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
   * Fetch live TV streams from Xtream provider
   * @param {string} providerId - Provider ID
   * @param {number} [categoryId] - Optional category ID to filter
   * @returns {Promise<Array>} Array of channel stream objects
   */
  async fetchLiveStreams(providerId, categoryId = null) {
    const provider = this._getProviderConfig(providerId);
    const queryParams = new URLSearchParams({
      username: provider.username,
      password: provider.password,
      action: 'get_live_streams'
    });
    if (categoryId) {
      queryParams.append('category_id', categoryId);
    }
    const url = `${provider.api_url}/player_api.php?${queryParams.toString()}`;
    
    return await this._httpGet({
      providerId,
      type: 'live',
      endpoint: 'live_streams',
      cacheParams: categoryId ? { categoryId } : {},
      url
    });
  }

  /**
   * Fetch live TV M3U playlist from Xtream provider
   * @param {string} providerId - Provider ID
   * @returns {Promise<string>} M3U playlist content as string
   */
  async fetchLiveM3U(providerId) {
    const provider = this._getProviderConfig(providerId);
    const queryParams = new URLSearchParams({
      username: provider.username,
      password: provider.password,
      type: 'm3u_plus',
      output: 'm3u8'
    });
    const url = `${provider.api_url}/get.php?${queryParams.toString()}`;
    
    return await this._httpGet({
      providerId,
      type: 'live',
      endpoint: 'm3u',
      url,
      responseType: 'text',
      timeout: 60000 // Longer timeout for large M3U files
    });
  }

  /**
   * Fetch live TV EPG (XMLTV) from Xtream provider
   * @param {string} providerId - Provider ID
   * @returns {Promise<string>} EPG XML content as string
   */
  async fetchLiveEPG(providerId) {
    const provider = this._getProviderConfig(providerId);
    const queryParams = new URLSearchParams({
      username: provider.username,
      password: provider.password
    });
    const url = `${provider.api_url}/xmltv.php?${queryParams.toString()}`;
    
    return await this._httpGet({
      providerId,
      type: 'live',
      endpoint: 'epg',
      url,
      responseType: 'text',
      timeout: 60000 // Longer timeout for large EPG files
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
      // Authentication endpoint
      'authenticate-auth': {
        type: 'auth',
        endpoint: 'authenticate',
        dirBuilder: (cacheDir, providerId, params) => {
          return path.join(cacheDir, providerId, 'auth');
        },
        fileBuilder: (cacheDir, providerId, type, params) => {
          const dirPath = path.join(cacheDir, providerId, 'auth');
          return path.join(dirPath, 'authenticate.json');
        },
        ttl: null // Never expire (for debugging)
      },
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
        ttl: 12 // 12 hours for tvshows
      },
      // Live TV categories
      'live_categories-live': {
        type: 'live',
        endpoint: 'live_categories',
        dirBuilder: (cacheDir, providerId, params) => {
          return path.join(cacheDir, providerId, 'live', 'categories');
        },
        fileBuilder: (cacheDir, providerId, type, params) => {
          const dirPath = path.join(cacheDir, providerId, 'live', 'categories');
          return path.join(dirPath, 'categories.json');
        },
        ttl: 6 // 6 hours
      },
      // Live TV streams
      'live_streams-live': {
        type: 'live',
        endpoint: 'live_streams',
        dirBuilder: (cacheDir, providerId, params) => {
          return path.join(cacheDir, providerId, 'live', 'streams');
        },
        fileBuilder: (cacheDir, providerId, type, params) => {
          const dirPath = path.join(cacheDir, providerId, 'live', 'streams');
          const filename = params.categoryId ? `streams-${params.categoryId}.json` : 'streams.json';
          return path.join(dirPath, filename);
        },
        ttl: 6 // 6 hours
      },
      // Live TV EPG
      'epg-live': {
        type: 'live',
        endpoint: 'epg',
        dirBuilder: (cacheDir, providerId, params) => {
          return path.join(cacheDir, providerId, 'live', 'metadata');
        },
        fileBuilder: (cacheDir, providerId, type, params) => {
          const dirPath = path.join(cacheDir, providerId, 'live', 'metadata');
          return path.join(dirPath, 'epg.xml');
        },
        ttl: 6 // 6 hours
      }
    };
  }
}

