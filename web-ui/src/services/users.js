import axiosInstance from '../config/axios';

/**
 * User management service for admin operations
 */
export const usersService = {
  /**
   * Get all users
   * @returns {Promise<Array>} List of users
   */
  async getAllUsers() {
    const response = await axiosInstance.get('/users');
    // Backend returns {users: [...]}, extract the array
    return response.data.users || [];
  },

  /**
   * Get user by username
   * @param {string} username
   * @returns {Promise<Object>} User object
   */
  async getUser(username) {
    const response = await axiosInstance.get(`/users/${username}`);
    return response.data;
  },

  /**
   * Create a new user
   * @param {Object} userData - { username, first_name, last_name, password, role }
   * @returns {Promise<Object>} Created user
   */
  async createUser(userData) {
    const response = await axiosInstance.post('/users', userData);
    return response.data;
  },

  /**
   * Update a user
   * @param {string} username
   * @param {Object} userData - { first_name, last_name, status, role }
   * @returns {Promise<Object>} Updated user
   */
  async updateUser(username, userData) {
    const response = await axiosInstance.put(`/users/${username}`, userData);
    return response.data;
  },

  /**
   * Deactivate a user (sets status to inactive)
   * @param {string} username
   * @returns {Promise<Object>} Updated user
   */
  async deactivateUser(username) {
    const response = await axiosInstance.delete(`/users/${username}`);
    return response.data;
  },

  /**
   * Activate a user (sets status to active)
   * @param {string} username
   * @returns {Promise<Object>} Updated user
   */
  async activateUser(username) {
    const response = await axiosInstance.put(`/users/${username}`, { status: 'active' });
    return response.data;
  },

  /**
   * Reset user password
   * @param {string} username
   * @param {string} newPassword
   * @returns {Promise<Object>} Success response
   */
  async resetPassword(username, newPassword) {
    const response = await axiosInstance.post(`/users/${username}/reset-password`, {
      password: newPassword
    });
    return response.data;
  }
};
