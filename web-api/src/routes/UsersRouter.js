import BaseRouter from './BaseRouter.js';

/**
 * Users router for handling user management endpoints
 */
class UsersRouter extends BaseRouter {
  /**
   * @param {import('express').Application} app - Express app instance
   * @param {UserManager} userManager - User manager instance
   * @param {import('../middleware/Middleware.js').default} middleware - Middleware instance
   * @param {import('../managers/orchestration/MetricsManager.js').default} metricsManager - Metrics manager instance
   */
  constructor(app, userManager, middleware, metricsManager) {
    super(app, middleware, 'UsersRouter');
    this._userManager = userManager;
    this._metricsManager = metricsManager;
  }

  /**
   * Get the base path(s) for this router
   * @returns {string[]} Base path(s) for this router
   */
  getBasePath() {
    return ['/api/users'];
  }

  /**
   * Set up routes for this router
   */
  setupRoutes() {
    /**
     * GET /api/users
     * List all users (admin only)
     */
    this.router.get('/', this.middleware.requireAdmin, this._handleGetUsers.bind(this));

    /**
     * POST /api/users
     * Create a new user (admin only)
     */
    this.router.post('/', this.middleware.requireAdmin, this._handleCreateUser.bind(this));

    /**
     * GET /api/users/:username
     * Get user details (admin only)
     */
    this.router.get('/:username', this.middleware.requireAdmin, this._handleGetUserByUsername.bind(this));

    /**
     * PUT /api/users/:username
     * Update user (admin only)
     */
    this.router.put('/:username', this.middleware.requireAdmin, this._handleUpdateUser.bind(this));

    /**
     * DELETE /api/users/:username
     * Deactivate user (admin only)
     */
    this.router.delete('/:username', this.middleware.requireAdmin, this._handleDeleteUser.bind(this));

    /**
     * POST /api/users/:username/reset-password
     * Reset user password (admin only)
     */
    this.router.post('/:username/reset-password', this.middleware.requireAdmin, this._handleResetPassword.bind(this));
  }

  /**
   * Handle GET / request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleGetUsers(req, res) {
    try {
      const result = await this._userManager.getAllUsers();
      
      // Track user operation
      this._metricsManager.incrementCounter('user_operations', {
        operation: 'get',
        username: req.user.username
      });
      
      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(res, error, 'Failed to get users');
    }
  }

  /**
   * Handle POST / request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleCreateUser(req, res) {
    try {
      const { username, first_name, last_name, password, role } = req.body;

      if (!username || !first_name || !last_name || !password) {
        return this.returnErrorResponse(res, 400, 'Username, first_name, last_name, and password are required');
      }

      const result = await this._userManager.createUserWithResponse(
        username,
        first_name,
        last_name,
        password,
        role
      );

      // Track user operation
      this._metricsManager.incrementCounter('user_operations', {
        operation: 'create',
        username: req.user.username
      });

      return res.status(201).json(result);
    } catch (error) {
      return this.handleError(res, error, 'Failed to create user');
    }
  }

  /**
   * Handle GET /:username request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleGetUserByUsername(req, res) {
    try {
      const { username } = req.params;
      const result = await this._userManager.getUser(username);
      
      // Track user operation
      this._metricsManager.incrementCounter('user_operations', {
        operation: 'get',
        username: req.user.username
      });
      
      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(res, error, 'Failed to get user');
    }
  }

  /**
   * Handle PUT /:username request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleUpdateUser(req, res) {
    try {
      const { username } = req.params;
      const { first_name, last_name, status, role } = req.body;

      const updates = {};
      if (first_name !== undefined) updates.first_name = first_name;
      if (last_name !== undefined) updates.last_name = last_name;
      if (status !== undefined) updates.status = status;
      if (role !== undefined) updates.role = role;

      const result = await this._userManager.updateUser(username, updates);
      
      // Track user operation
      this._metricsManager.incrementCounter('user_operations', {
        operation: 'update',
        username: req.user.username
      });
      
      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(res, error, 'Failed to update user');
    }
  }

  /**
   * Handle DELETE /:username request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleDeleteUser(req, res) {
    try {
      const { username } = req.params;
      const result = await this._userManager.deleteUser(username);
      
      // Track user operation
      this._metricsManager.incrementCounter('user_operations', {
        operation: 'delete',
        username: req.user.username
      });
      
      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(res, error, 'Failed to delete user');
    }
  }

  /**
   * Handle POST /:username/reset-password request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleResetPassword(req, res) {
    try {
      const { username } = req.params;
      const { password } = req.body;

      if (!password) {
        return this.returnErrorResponse(res, 400, 'Password is required');
      }

      const result = await this._userManager.resetPassword(username, password);
      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(res, error, 'Failed to reset password');
    }
  }
}

export default UsersRouter;
