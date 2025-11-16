import BaseRouter from './BaseRouter.js';

/**
 * Profile router for handling user profile endpoints
 */
class ProfileRouter extends BaseRouter {
  /**
   * @param {UserManager} userManager - User manager instance
   * @param {import('../middleware/Middleware.js').default} middleware - Middleware instance
   * @param {import('../managers/jobs.js').JobsManager} [jobsManager] - Jobs manager instance (optional, for triggering Live TV sync)
   */
  constructor(userManager, middleware, jobsManager = null) {
    super(middleware, 'ProfileRouter');
    this._userManager = userManager;
    this._jobsManager = jobsManager;
  }

  /**
   * Initialize routes for this router
   */
  initialize() {
    /**
     * GET /api/profile
     * Get current user's profile
     */
    this.router.get('/', this.middleware.requireAuth, async (req, res) => {
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
    this.router.put('/', this.middleware.requireAuth, async (req, res) => {
      try {
        const username = req.user.username;
        const { first_name, last_name, liveTV } = req.body;

        const updates = {};
        if (first_name !== undefined) updates.first_name = first_name;
        if (last_name !== undefined) updates.last_name = last_name;
        if (liveTV !== undefined) updates.liveTV = liveTV;

        const result = await this._userManager.updateProfile(username, updates);
        
        // Trigger Live TV sync job if liveTV was modified
        if (liveTV !== undefined && this._jobsManager) {
          try {
            await this._jobsManager.triggerJob('syncLiveTV');
            this.logger.info(`Triggered Live TV sync job after profile update for user ${username}`);
          } catch (error) {
            this.logger.warn(`Failed to trigger Live TV sync job: ${error.message}`);
            // Don't fail the request if job trigger fails
          }
        }
        
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to update profile', `Update profile error: ${error.message}`);
      }
    });

    /**
     * POST /api/profile/regenerate-api-key
     * Regenerate API key for current user
     */
    this.router.post('/regenerate-api-key', this.middleware.requireAuth, async (req, res) => {
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
    this.router.post('/change-password', this.middleware.requireAuth, async (req, res) => {
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
