import BaseRouter from './BaseRouter.js';

/**
 * Profile router for handling user profile endpoints
 */
class ProfileRouter extends BaseRouter {
  /**
   * @param {import('express').Application} app - Express app instance
   * @param {UserManager} userManager - User manager instance
   * @param {import('../middleware/Middleware.js').default} middleware - Middleware instance
   */
  constructor(app, userManager, middleware) {
    super(app, middleware, 'ProfileRouter');
    this._userManager = userManager;
  }

  /**
   * Get the base path(s) for this router
   * @returns {string[]} Base path(s) for this router
   */
  getBasePath() {
    return ['/api/profile'];
  }

  /**
   * Set up routes for this router
   */
  setupRoutes() {
    /**
     * GET /api/profile
     * Get current user's profile
     */
    this.router.get('/', this.middleware.requireAuth, this._handleGetProfile.bind(this));

    /**
     * PUT /api/profile
     * Update current user's profile
     */
    this.router.put('/', this.middleware.requireAuth, this._handleUpdateProfile.bind(this));

    /**
     * POST /api/profile/regenerate-api-key
     * Regenerate API key for current user
     */
    this.router.post('/regenerate-api-key', this.middleware.requireAuth, this._handleRegenerateApiKey.bind(this));

    /**
     * POST /api/profile/change-password
     * Change password for current user (requires current password verification)
     */
    this.router.post('/change-password', this.middleware.requireAuth, this._handleChangePassword.bind(this));
  }

  /**
   * Handle GET / request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleGetProfile(req, res) {
    try {
      const username = req.user.username;
      const result = await this._userManager.getProfile(username);
      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(res, error, 'Failed to get profile');
    }
  }

  /**
   * Handle PUT / request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleUpdateProfile(req, res) {
    try {
      const username = req.user.username;
      const { first_name, last_name } = req.body;

      const updates = {};
      if (first_name !== undefined) updates.first_name = first_name;
      if (last_name !== undefined) updates.last_name = last_name;

      const result = await this._userManager.updateProfile(username, updates);
      
      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(res, error, 'Failed to update profile');
    }
  }

  /**
   * Handle POST /regenerate-api-key request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleRegenerateApiKey(req, res) {
    try {
      const username = req.user.username;
      const result = await this._userManager.regenerateApiKey(username);
      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(res, error, 'Failed to regenerate API key');
    }
  }

  /**
   * Handle POST /change-password request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleChangePassword(req, res) {
    try {
      const username = req.user.username;
      const { current_password, new_password } = req.body;

      if (!current_password || !new_password) {
        return this.returnErrorResponse(res, 400, 'Current password and new password are required');
      }

      const result = await this._userManager.changePassword(username, current_password, new_password);
      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(res, error, 'Failed to change password');
    }
  }
}

export default ProfileRouter;
