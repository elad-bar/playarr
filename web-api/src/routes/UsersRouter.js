import BaseRouter from './BaseRouter.js';

/**
 * Users router for handling user management endpoints
 */
class UsersRouter extends BaseRouter {
  /**
   * @param {UserManager} userManager - User manager instance
   * @param {import('../middleware/Middleware.js').default} middleware - Middleware instance
   * @param {import('../services/metrics.js').default} metricsService - Metrics service instance
   */
  constructor(userManager, middleware, metricsService) {
    super(middleware, 'UsersRouter');
    this._userManager = userManager;
    this._metricsService = metricsService;
  }

  /**
   * Initialize routes for this router
   */
  initialize() {
    /**
     * GET /api/users
     * List all users (admin only)
     */
    this.router.get('/', this.middleware.requireAdmin, async (req, res) => {
      try {
        const result = await this._userManager.getAllUsers();
        
        // Track user operation
        this._metricsService.incrementCounter('user_operations', {
          operation: 'get',
          username: req.user.username
        });
        
        return res.status(200).json(result);
      } catch (error) {
        return this.handleError(res, error, 'Failed to get users');
      }
    });

    /**
     * POST /api/users
     * Create a new user (admin only)
     */
    this.router.post('/', this.middleware.requireAdmin, async (req, res) => {
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
        this._metricsService.incrementCounter('user_operations', {
          operation: 'create',
          username: req.user.username
        });

        return res.status(201).json(result);
      } catch (error) {
        return this.handleError(res, error, 'Failed to create user');
      }
    });

    /**
     * GET /api/users/:username
     * Get user details (admin only)
     */
    this.router.get('/:username', this.middleware.requireAdmin, async (req, res) => {
      try {
        const { username } = req.params;
        const result = await this._userManager.getUser(username);
        
        // Track user operation
        this._metricsService.incrementCounter('user_operations', {
          operation: 'get',
          username: req.user.username
        });
        
        return res.status(200).json(result);
      } catch (error) {
        return this.handleError(res, error, 'Failed to get user');
      }
    });

    /**
     * PUT /api/users/:username
     * Update user (admin only)
     */
    this.router.put('/:username', this.middleware.requireAdmin, async (req, res) => {
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
        this._metricsService.incrementCounter('user_operations', {
          operation: 'update',
          username: req.user.username
        });
        
        return res.status(200).json(result);
      } catch (error) {
        return this.handleError(res, error, 'Failed to update user');
      }
    });

    /**
     * DELETE /api/users/:username
     * Deactivate user (admin only)
     */
    this.router.delete('/:username', this.middleware.requireAdmin, async (req, res) => {
      try {
        const { username } = req.params;
        const result = await this._userManager.deleteUser(username);
        
        // Track user operation
        this._metricsService.incrementCounter('user_operations', {
          operation: 'delete',
          username: req.user.username
        });
        
        return res.status(200).json(result);
      } catch (error) {
        return this.handleError(res, error, 'Failed to delete user');
      }
    });

    /**
     * POST /api/users/:username/reset-password
     * Reset user password (admin only)
     */
    this.router.post('/:username/reset-password', this.middleware.requireAdmin, async (req, res) => {
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
    });
  }
}

export default UsersRouter;
