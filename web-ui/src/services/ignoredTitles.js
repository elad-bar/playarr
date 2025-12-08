import axiosInstance from '../config/axios';
import { API_ENDPOINTS } from '../config/api';

/**
 * Ignored titles service for managing ignored provider titles
 */
export const ignoredTitlesService = {
  /**
   * Fetch paginated list of ignored titles with filters
   * @param {Object} filters - Filter options
   * @param {string} [filters.media_type] - Media type filter ('movies' or 'tvshows')
   * @param {string} [filters.issue_type] - Issue type filter (ignored_reason)
   * @param {string|Array<string>} [filters.provider_id] - Provider ID filter(s)
   * @param {string} [filters.search] - Search query
   * @param {number} [filters.page=1] - Page number
   * @param {number} [filters.per_page=50] - Items per page
   * @returns {Promise<{items: Array, total: number, page: number, perPage: number, totalPages: number}>}
   */
  async fetchIgnoredTitles(filters = {}) {
    const response = await axiosInstance.get(API_ENDPOINTS.providerTitlesIgnored(filters));
    return response.data;
  },

  /**
   * Fetch single ignored title by ID
   * @param {string} id - MongoDB _id
   * @returns {Promise<Object>} Provider title object
   */
  async fetchIgnoredTitleById(id) {
    const response = await axiosInstance.get(API_ENDPOINTS.providerTitleIgnored(id));
    return response.data;
  },

  /**
   * Validate TMDB ID for a provider title
   * @param {string} id - Provider title MongoDB _id
   * @param {string} type - Media type ('movie' or 'tv')
   * @param {number} tmdbId - TMDB ID to validate
   * @returns {Promise<{valid: boolean, preview?: Object, error?: string}>}
   */
  async validateTMDBId(id, type, tmdbId) {
    const response = await axiosInstance.post(API_ENDPOINTS.validateProviderTitleTMDB(id), {
      type,
      tmdbId
    });
    return response.data;
  },

  /**
   * Update provider title with TMDB ID and unignore it
   * @param {string} id - Provider title MongoDB _id
   * @param {number} tmdbId - TMDB ID to assign
   * @param {string} type - Media type ('movie' or 'tv')
   * @returns {Promise<{success: boolean, title: Object}>}
   */
  async updateProviderTitle(id, tmdbId, type) {
    const response = await axiosInstance.put(API_ENDPOINTS.updateProviderTitle(id), {
      tmdbId,
      type
    });
    return response.data;
  }
};

