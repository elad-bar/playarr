import BaseRouter from './BaseRouter.js';

/**
 * Profile router for handling user profile endpoints
 */
class ProfileRouter extends BaseRouter {
  /**
   * @param {UserManager} userManager - User manager instance
   * @param {DatabaseService} database - Database service instance
   */
  constructor(userManager, database) {
    super(database, 'ProfileRouter');
    this._userManager = userManager;
  }

  /**
   * Initialize routes for this router
   */
  initialize() {
    /**
     * GET /api/profile
     * Get current user's profile
     */
    this.router.get('/', this._requireAuth, async (req, res) => {
      try {
        const username = req.user.username;
        const result = await this._userManager.getProfile(username);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get profile', `Get profile error: ${error.message}`);
      }
    });

    /**
     * PUT /api/profile
     * Update current user's profile
     */
    this.router.put('/', this._requireAuth, async (req, res) => {
      try {
        const username = req.user.username;
        const { first_name, last_name } = req.body;

        const updates = {};
        if (first_name !== undefined) updates.first_name = first_name;
        if (last_name !== undefined) updates.last_name = last_name;

        const result = await this._userManager.updateProfile(username, updates);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to update profile', `Update profile error: ${error.message}`);
      }
    });

    /**
     * POST /api/profile/regenerate-api-key
     * Regenerate API key for current user
     */
    this.router.post('/regenerate-api-key', this._requireAuth, async (req, res) => {
      try {
        const username = req.user.username;
        const result = await this._userManager.regenerateApiKey(username);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to regenerate API key', `Regenerate API key error: ${error.message}`);
      }
    });

    /**
     * POST /api/profile/change-password
     * Change password for current user (requires current password verification)
     */
    this.router.post('/change-password', this._requireAuth, async (req, res) => {
      try {
        const username = req.user.username;
        const { current_password, new_password } = req.body;

        if (!current_password || !new_password) {
          return this.returnErrorResponse(res, 400, 'Current password and new password are required');
        }

        const result = await this._userManager.changePassword(username, current_password, new_password);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to change password', `Change password error: ${error.message}`);
      }
    });
  }
}

export default ProfileRouter;
