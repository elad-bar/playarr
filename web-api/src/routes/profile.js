import express from 'express';
import { requireAuth } from '../middleware/auth.js';

/**
 * Profile router for handling user profile endpoints
 */
class ProfileRouter {
  /**
   * @param {UserManager} userManager - User manager instance
   */
  constructor(userManager) {
    this._userManager = userManager;
    this.router = express.Router();
    this._setupRoutes();
  }

  /**
   * Setup all routes for this router
   * @private
   */
  _setupRoutes() {
    /**
     * GET /api/profile
     * Get current user's profile
     */
    this.router.get('/', requireAuth, async (req, res) => {
      try {
        const username = req.user.username;
        const result = await this._userManager.getProfile(username);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        console.error('Get profile error:', error);
        return res.status(500).json({ error: 'Failed to get profile' });
      }
    });

    /**
     * PUT /api/profile
     * Update current user's profile
     */
    this.router.put('/', requireAuth, async (req, res) => {
      try {
        const username = req.user.username;
        const { first_name, last_name } = req.body;

        const updates = {};
        if (first_name !== undefined) updates.first_name = first_name;
        if (last_name !== undefined) updates.last_name = last_name;

        const result = await this._userManager.updateProfile(username, updates);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        console.error('Update profile error:', error);
        return res.status(500).json({ error: 'Failed to update profile' });
      }
    });

    /**
     * POST /api/profile/regenerate-api-key
     * Regenerate API key for current user
     */
    this.router.post('/regenerate-api-key', requireAuth, async (req, res) => {
      try {
        const username = req.user.username;
        const result = await this._userManager.regenerateApiKey(username);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        console.error('Regenerate API key error:', error);
        return res.status(500).json({ error: 'Failed to regenerate API key' });
      }
    });

    /**
     * POST /api/profile/change-password
     * Change password for current user (requires current password verification)
     */
    this.router.post('/change-password', requireAuth, async (req, res) => {
      try {
        const username = req.user.username;
        const { current_password, new_password } = req.body;

        if (!current_password || !new_password) {
          return res.status(400).json({ error: 'Current password and new password are required' });
        }

        const result = await this._userManager.changePassword(username, current_password, new_password);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        console.error('Change password error:', error);
        return res.status(500).json({ error: 'Failed to change password' });
      }
    });
  }
}

export default ProfileRouter;
