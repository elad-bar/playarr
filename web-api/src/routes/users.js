import BaseRouter from './BaseRouter.js';

/**
 * Users router for handling user management endpoints
 */
class UsersRouter extends BaseRouter {
  /**
   * @param {UserManager} userManager - User manager instance
   * @param {DatabaseService} database - Database service instance
   */
  constructor(userManager, database) {
    super(database, 'UsersRouter');
    this._userManager = userManager;
  }

  /**
   * Initialize routes for this router
   */
  initialize() {
    /**
     * GET /api/users
     * List all users (admin only)
     */
    this.router.get('/', this._requireAdmin, async (req, res) => {
      try {
        const result = await this._userManager.getAllUsers();
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get users', `Get all users error: ${error.message}`);
      }
    });

    /**
     * POST /api/users
     * Create a new user (admin only)
     */
    this.router.post('/', this._requireAdmin, async (req, res) => {
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

        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to create user', `Create user error: ${error.message}`);
      }
    });

    /**
     * GET /api/users/:username
     * Get user details (admin only)
     */
    this.router.get('/:username', this._requireAdmin, async (req, res) => {
      try {
        const { username } = req.params;
        const result = await this._userManager.getUser(username);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get user', `Get user error: ${error.message}`);
      }
    });

    /**
     * PUT /api/users/:username
     * Update user (admin only)
     */
    this.router.put('/:username', this._requireAdmin, async (req, res) => {
      try {
        const { username } = req.params;
        const { first_name, last_name, status, role } = req.body;

        const updates = {};
        if (first_name !== undefined) updates.first_name = first_name;
        if (last_name !== undefined) updates.last_name = last_name;
        if (status !== undefined) updates.status = status;
        if (role !== undefined) updates.role = role;

        const result = await this._userManager.updateUser(username, updates);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to update user', `Update user error: ${error.message}`);
      }
    });

    /**
     * DELETE /api/users/:username
     * Deactivate user (admin only)
     */
    this.router.delete('/:username', this._requireAdmin, async (req, res) => {
      try {
        const { username } = req.params;
        const result = await this._userManager.deleteUser(username);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to delete user', `Delete user error: ${error.message}`);
      }
    });

    /**
     * POST /api/users/:username/reset-password
     * Reset user password (admin only)
     */
    this.router.post('/:username/reset-password', this._requireAdmin, async (req, res) => {
      try {
        const { username } = req.params;
        const { password } = req.body;

        if (!password) {
          return this.returnErrorResponse(res, 400, 'Password is required');
        }

        const result = await this._userManager.resetPassword(username, password);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to reset password', `Reset password error: ${error.message}`);
      }
    });
  }
}

export default UsersRouter;
