import { BaseIPTVProvider } from './BaseIPTVProvider.js';
import path from 'path';
import { parseM3U } from '@iptv/playlist';
import { generateChannelKey } from '../utils/channelUtils.js';

/**
 * Apollo Group TV provider implementation
 * Handles AGTV-specific API calls for M3U8 content
 * @extends {BaseIPTVProvider}
 */
export class AGTVProvider extends BaseIPTVProvider {
  /**
   * @param {Object<string, Object>} providerConfigs - Map of provider ID to provider configuration
   * @param {string} [cacheDir] - Optional cache directory path (defaults to CACHE_DIR env var or '/app/cache')
   * @param {import('../managers/orchestration/MetricsManager.js').default} metricsManager - Metrics manager instance (optional)
   */
  constructor(providerConfigs = {}, cacheDir = null, metricsManager) {
    super('AGTVProvider', providerConfigs, cacheDir, metricsManager);
  }

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

      // Step 1: Login to get token
      const loginUrl = `${provider.api_url}/api/login`;
      const loginResponse = await this._httpPost({
        providerId,
        type: 'auth',
        endpoint: 'login',
        url: loginUrl,
        data: {
          username: provider.username,
          password: provider.password
        },
        skipCache: true
      });

      // Extract token from login response
      const token = loginResponse.data?.token;
      if (!token) {
        throw new Error('No token received from login');
      }

      // Step 2: Get user info with token
      const userUrl = `${provider.api_url}/api/user`;
      const userResponse = await this._httpGet({
        providerId,
        type: 'auth',
        endpoint: 'user',
        url: userUrl,
        headers: {
          'Authorization': `Bearer ${token}`
        },
        skipCache: true
      });

      // Parse expiration date from expiration_date_timestamp
      const expirationTimestamp = userResponse.data?.expiration_date_timestamp;
      const expirationDate = expirationTimestamp ? expirationTimestamp : null;
      const active = userResponse.data?.active ?? null;

      // AGTV does not provide connection information via API
      // Return hardcoded values as per specification
      // max_connections: 5 (hardcoded, not available from API)
      // active_connections: 0 (cannot be retrieved from API)
      
      return {
        expiration_date: expirationDate,
        max_connections: 5,
        active_connections: 0,
        active: active
      };
    } catch (error) {
      this.logger.error(`[${providerId}] Error authenticating with AGTV provider: ${error.message}`);
      // Return hardcoded values on error
      return {
        expiration_date: null,
        max_connections: 5,
        active_connections: 0,
        active: null
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
    
    return await this._httpGet({
      providerId,
      type,
      endpoint: 'm3u8',
      cacheParams: page ? { page } : {},
      url,
      responseType: 'text'
    });
  }

  /**
   * Fetch live TV channels from AGTV provider
   * Parses M3U content and returns uniform channel objects
   * @param {string} providerId - Provider ID
   * @returns {Promise<Array>} Array of channel objects with uniform structure
   */
  async fetchLiveChannels(providerId) {
    const provider = this._getProviderConfig(providerId);
    const url = `${provider.api_url}/api/list/${provider.username}/${provider.password}/m3u8/livetv`;
    
    // Fetch M3U content (cached via _httpGet)
    const m3uContent = await this._httpGet({
      providerId,
      type: 'live',
      endpoint: 'm3u8',
      url,
      responseType: 'text'
    });

    // Parse M3U content
    const playlist = parseM3U(m3uContent);
    const channels = [];

    for (const channelData of playlist.channels) {
      // Determine channel_id - use tvgId if available, otherwise fallback to URL
      const channelId = channelData.tvgId || channelData.url || 'unknown';
      
      const channel = {
        provider_id: providerId,
        channel_id: channelId,
        channel_key: generateChannelKey(providerId, channelId),
        name: channelData.name || 'Unknown',
        url: channelData.url || '',
        tvg_id: channelData.tvgId || null,
        tvg_name: channelData.tvgId ? (channelData.name || null) : null,
        tvg_logo: channelData.tvgLogo || null,
        group_title: channelData.groupTitle || null,
        duration: channelData.duration !== undefined ? channelData.duration : -1,
        createdAt: new Date(),
        lastUpdated: new Date()
      };
      channels.push(channel);
    }

    return channels;
  }

  /**
   * Fetch live TV EPG from shared EPG source
   * @param {string} providerId - Provider ID (not used, but kept for consistency)
   * @returns {Promise<string>} EPG XML content as string (decompressed)
   */
  async fetchLiveEPG(providerId) {
    // Shared EPG URL for AGTV providers
    const epgUrl = 'https://epg.starlite.best/utc.xml.gz';
    
    // Decompress gzip transform function
    const decompressGzip = async (data) => {
      const zlib = await import('zlib');
      const { promisify } = await import('util');
      const gunzip = promisify(zlib.gunzip);
      const decompressed = await gunzip(data);
      return decompressed.toString('utf8');
    };
    
    return await this._httpGet({
      providerId,
      type: 'live',
      endpoint: 'epg',
      url: epgUrl,
      responseType: 'arraybuffer', // For gzipped content
      timeout: 60000, // Longer timeout for large EPG files
      transform: decompressGzip, // Decompress before caching
      skipCache: true // Don't read from cache, only store
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
      },
      // Live TV M3U8
      'm3u8-live': {
        type: 'live',
        endpoint: 'm3u8',
        dirBuilder: (cacheDir, providerId, params) => {
          return path.join(cacheDir, providerId, 'live', 'metadata');
        },
        fileBuilder: (cacheDir, providerId, type, params) => {
          const dirPath = path.join(cacheDir, providerId, 'live', 'metadata');
          return path.join(dirPath, 'list.m3u8');
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

