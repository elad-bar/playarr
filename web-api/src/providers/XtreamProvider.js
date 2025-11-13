import axios from 'axios';
import { BaseIPTVProvider } from './BaseIPTVProvider.js';

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
    // Check cache first
    const cached = this._storage.get(providerId, type, 'categories');
    if (cached !== null) {
      this.logger.debug(`Cache hit for categories: ${providerId}/${type}`);
      return cached;
    }

    const provider = await this._getProviderConfig(providerId);
    
    // Get type config
    const config = this._xtreamTypeConfig[type];
    if (!config) {
      throw new Error(`Unsupported type: ${type}`);
    }
    
    // Build API URL using config
    const categoryAction = config.categoryAction;
    const baseUrl = provider.api_url;
    const username = provider.username;
    const password = provider.password;
    
    const queryParams = new URLSearchParams({
      username,
      password,
      action: categoryAction
    });
    
    const url = `${baseUrl}/player_api.php?${queryParams.toString()}`;
    
    try {
      this.logger.debug(`Fetching categories from Xtream: ${providerId}/${type}`);
      const response = await axios.get(url, { timeout: 30000 });
      
      // Normalize categories
      const categories = Array.isArray(response.data) 
        ? response.data 
        : [];
      
      const normalizedCategories = categories.map(cat => ({
        category_id: cat.category_id || cat.id,
        category_name: cat.category_name || cat.name
      }));
      
      // Cache the result
      this._storage.set(providerId, type, 'categories', normalizedCategories);
      
      return normalizedCategories;
    } catch (error) {
      this.logger.error(`Error fetching categories from Xtream ${providerId}/${type}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fetch metadata from Xtream provider
   * @param {string} providerId - Provider ID
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Promise<Array>} Array of title objects
   */
  async fetchMetadata(providerId, type) {
    // Check cache first
    const cached = this._storage.get(providerId, type, 'metadata');
    if (cached !== null) {
      this.logger.debug(`Cache hit for metadata: ${providerId}/${type}`);
      return cached;
    }

    const provider = await this._getProviderConfig(providerId);
    
    // Get type config
    const config = this._xtreamTypeConfig[type];
    if (!config) {
      throw new Error(`Unsupported type: ${type}`);
    }
    
    const metadataAction = config.metadataAction;
    const baseUrl = provider.api_url;
    const username = provider.username;
    const password = provider.password;
    
    const queryParams = new URLSearchParams({
      username,
      password,
      action: metadataAction
    });
    
    const url = `${baseUrl}/player_api.php?${queryParams.toString()}`;
    
    try {
      this.logger.debug(`Fetching metadata from Xtream: ${providerId}/${type}`);
      const response = await axios.get(url, { timeout: 30000 });
      
      // Cache the full response object
      this._storage.set(providerId, type, 'metadata', response.data);
      return response.data;
    } catch (error) {
      this.logger.error(`Error fetching metadata from Xtream ${providerId}/${type}: ${error.message}`);
      throw error;
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
    // Check cache first
    const cached = this._storage.get(providerId, type, 'extended', { titleId });
    if (cached !== null) {
      this.logger.debug(`Cache hit for extended info: ${providerId}/${type}/${titleId}`);
      return cached;
    }

    const provider = await this._getProviderConfig(providerId);
    
    // Get type config
    const config = this._xtreamTypeConfig[type];
    if (!config) {
      throw new Error(`Unsupported type: ${type}`);
    }
    
    const extendedInfoAction = config.extendedInfoAction;
    const extendedInfoParam = config.extendedInfoParam;
    const baseUrl = provider.api_url;
    const username = provider.username;
    const password = provider.password;
    
    const queryParams = new URLSearchParams({
      username,
      password,
      action: extendedInfoAction,
      [extendedInfoParam]: titleId
    });
    
    const url = `${baseUrl}/player_api.php?${queryParams.toString()}`;
    
    try {
      this.logger.debug(`Fetching extended info from Xtream: ${providerId}/${type}/${titleId}`);
      const response = await axios.get(url, { timeout: 30000 });
      
      // Cache the full response object
      this._storage.set(providerId, type, 'extended', response.data, { titleId });
      
      return response.data;
    } catch (error) {
      this.logger.error(`Error fetching extended info from Xtream ${providerId}/${type}/${titleId}: ${error.message}`);
      throw error;
    }
  }
}

