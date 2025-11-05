import axiosInstance from '../config/axios';

/**
 * Authentication service for handling login, logout, and auth verification.
 */
export const authService = {
  /**
   * Login with username and password.
   * @param {string} username - Username
   * @param {string} password - Password
   * @returns {Promise<{success: boolean, user?: object, error?: string}>}
   */
  async login(username, password) {
    try {
      const response = await axiosInstance.post('/auth/login', {
        username,
        password
      });

      if (response.data.success) {
        return {
          success: true,
          user: response.data.user
        };
      }

      return {
        success: false,
        error: response.data.error || 'Login failed'
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.error || 'Login failed'
      };
    }
  },

  /**
   * Logout the current user.
   * @returns {Promise<{success: boolean}>}
   */
  async logout() {
    try {
      await axiosInstance.post('/auth/logout');
      return { success: true };
    } catch (error) {
      // Even if logout fails, we consider it successful on client side
      return { success: true };
    }
  },

  /**
   * Verify current authentication status.
   * @returns {Promise<{authenticated: boolean, user?: object}>}
   */
  async verifyAuth() {
    try {
      const response = await axiosInstance.get('/auth/verify');
      return {
        authenticated: response.data.authenticated,
        user: response.data.user || null
      };
    } catch (error) {
      return {
        authenticated: false,
        user: null
      };
    }
  },

  /**
   * Get current user's profile.
   * @returns {Promise<object>}
   */
  async getProfile() {
    try {
      const response = await axiosInstance.get('/profile');
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.error || 'Failed to load profile');
    }
  },

  /**
   * Update current user's profile.
   * @param {object} data - Profile data (first_name, last_name)
   * @returns {Promise<object>}
   */
  async updateProfile(data) {
    try {
      const response = await axiosInstance.put('/profile', data);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.error || 'Failed to update profile');
    }
  },

  /**
   * Regenerate API key for current user.
   * @returns {Promise<{api_key: string}>}
   */
  async regenerateApiKey() {
    try {
      const response = await axiosInstance.post('/profile/regenerate-api-key');
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.error || 'Failed to regenerate API key');
    }
  },

  /**
   * Change password for current user.
   * @param {string} currentPassword - Current password
   * @param {string} newPassword - New password
   * @returns {Promise<{success: boolean, message?: string}>}
   */
  async changePassword(currentPassword, newPassword) {
    try {
      const response = await axiosInstance.post('/profile/change-password', {
        current_password: currentPassword,
        new_password: newPassword
      });
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.error || 'Failed to change password');
    }
  }
};
