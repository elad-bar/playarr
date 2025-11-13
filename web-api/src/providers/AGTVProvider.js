import axios from 'axios';
import { BaseIPTVProvider } from './BaseIPTVProvider.js';

/**
 * Apollo Group TV provider implementation
 * Handles AGTV-specific API calls for M3U8 content
 * @extends {BaseIPTVProvider}
 */
export class AGTVProvider extends BaseIPTVProvider {

  /**
   * Fetch M3U8 content from AGTV provider
   * @param {string} providerId - Provider ID
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @param {number} [page] - Page number (for paginated types)
   * @returns {Promise<string>} M3U8 content as string
   */
  async fetchM3U8(providerId, type, page = null) {
    // Check cache first
    const cacheParams = page ? { page } : {};
    const cached = this._storage.get(providerId, type, 'm3u8', cacheParams);
    if (cached !== null) {
      this.logger.debug(`Cache hit for M3U8: ${providerId}/${type}${page ? `/${page}` : ''}`);
      return cached;
    }

    const provider = await this._getProviderConfig(providerId);
    
    const apiUrl = provider.api_url;
    const username = provider.username;
    const password = provider.password;
    const mediaTypeSegment = type; // 'movies' or 'tvshows'
    
    let url = `${apiUrl}/api/list/${username}/${password}/m3u8/${mediaTypeSegment}`;
    
    // Add page if provided (for paginated types like tvshows)
    if (page) {
      url += `/${page}`;
    }
    
    try {
      this.logger.debug(`Fetching M3U8 from AGTV: ${providerId}/${type}${page ? `/${page}` : ''}`);
      const response = await axios.get(url, {
        responseType: 'text',
        timeout: 30000
      });
      
      // Cache the result
      this._storage.set(providerId, type, 'm3u8', response.data, cacheParams);
      
      return response.data;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        // End of pagination
        throw new Error('Page not found (end of pagination)');
      }
      this.logger.error(`Error fetching M3U8 from AGTV ${providerId}/${type}${page ? `/${page}` : ''}: ${error.message}`);
      throw error;
    }
  }
}

