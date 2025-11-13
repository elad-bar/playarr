import axios from 'axios';
import { createLogger } from './logger.js';

const logger = createLogger('ServerApiClient');

// Server API URL (constructed from PORT env var)
const SERVER_API_URL = `http://127.0.0.1:${process.env.PORT || 3000}`;

/**
 * Read application token from environment variable
 * @returns {string|null} Application token or null if not set
 */
function readApplicationToken() {
  const token = process.env.APPLICATION_TOKEN;
  if (!token) {
    logger.warn('APPLICATION_TOKEN environment variable not set');
    return null;
  }
  return token.trim();
}

/**
 * Make HTTP request to server API with application token
 * @private
 * @param {string} method - HTTP method
 * @param {string} endpoint - API endpoint
 * @param {Object} [options] - Additional axios options
 * @returns {Promise<any>} Response data
 */
async function _makeRequest(method, endpoint, options = {}) {
  const token = readApplicationToken();
  
  if (!token) {
    throw new Error('Application token not available');
  }
  
  const url = `${SERVER_API_URL}${endpoint}`;
  const headers = {
    'X-Application-Token': token,
    ...options.headers
  };
  
  try {
    const response = await axios({
      method,
      url,
      headers,
      ...options
    });
    
    return response.data;
  } catch (error) {
    if (error.response) {
      // Server responded with error status
      const status = error.response.status;
      const message = error.response.data?.error || error.message;
      throw new Error(`Server API error (${status}): ${message}`);
    } else if (error.request) {
      // Request made but no response
      throw new Error(`Server API request failed: ${error.message}`);
    } else {
      // Error setting up request
      throw new Error(`Server API error: ${error.message}`);
    }
  }
}

/**
 * Server API Client
 * HTTP client for engine to call server API endpoints
 */
export class ServerApiClient {
  /**
   * Fetch metadata from provider via server API
   * @param {string} providerId - Provider ID
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Promise<Array>} Array of title objects
   */
  async fetchMetadata(providerId, type) {
    const endpoint = `/api/provider/${providerId}/metadata?type=${type}`;
    logger.debug(`Fetching metadata from server: ${providerId}/${type}`);
    return await _makeRequest('GET', endpoint);
  }

  /**
   * Fetch extended info from provider via server API
   * @param {string} providerId - Provider ID
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @param {string} titleId - Title ID
   * @returns {Promise<Object>} Extended info object
   */
  async fetchExtendedInfo(providerId, type, titleId) {
    const endpoint = `/api/provider/${providerId}/extended/${titleId}?type=${type}`;
    logger.debug(`Fetching extended info from server: ${providerId}/${type}/${titleId}`);
    return await _makeRequest('GET', endpoint);
  }

  /**
   * Fetch M3U8 content from provider via server API
   * @param {string} providerId - Provider ID
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @param {number} [page] - Page number (for paginated types)
   * @returns {Promise<string>} M3U8 content as string
   */
  async fetchM3U8(providerId, type, page = null) {
    let endpoint = `/api/provider/${providerId}/m3u8?type=${type}`;
    if (page) {
      endpoint += `&page=${page}`;
    }
    logger.debug(`Fetching M3U8 from server: ${providerId}/${type}${page ? `/${page}` : ''}`);
    return await _makeRequest('GET', endpoint, {
      responseType: 'text'
    });
  }
}

// Export singleton instance
export const serverApiClient = new ServerApiClient();

