import BaseRouter from './BaseRouter.js';
import { getTokenExpireDays } from '../utils/jwt.js';

/**
 * Auth router for handling authentication endpoints
 */
class AuthRouter extends BaseRouter {
  /**
   * @param {import('express').Application} app - Express app instance
   * @param {UserManager} userManager - User manager instance
   * @param {import('../middleware/Middleware.js').default} middleware - Middleware instance
   */
  constructor(app, userManager, middleware) {
    super(app, middleware, 'AuthRouter');
    this._userManager = userManager;
  }

  /**
   * Get the base path(s) for this router
   * @returns {string[]} Base path(s) for this router
   */
  getBasePath() {
    return ['/api/auth'];
  }

  /**
   * Set up routes for this router
   */
  setupRoutes() {
    /**
     * POST /api/auth/login
     * Authenticate user and set JWT cookie
     */
    this.router.post('/login', this._handleLogin.bind(this));

    /**
     * POST /api/auth/logout
     * Logout user (clear cookie)
     */
    this.router.post('/logout', this.middleware.requireAuth, this._handleLogout.bind(this));

    /**
     * GET /api/auth/verify
     * Verify authentication status
     */
    this.router.get('/verify', this.middleware.requireAuth, this._handleVerify.bind(this));
  }

  /**
   * Handle POST /login request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleLogin(req, res) {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return this.returnErrorResponse(res, 400, 'Username and password required');
      }

      const result = await this._userManager.login(username, password);

      // Create response with cookie
      const tokenExpireDays = getTokenExpireDays();
      res.cookie('access_token', result.jwtToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production', // Set to true in production with HTTPS
        sameSite: 'Strict',
        maxAge: tokenExpireDays * 24 * 60 * 60 * 1000, // Match JWT token expiration
      });
      
      return res.status(200).json({ success: result.success, user: result.user });
    } catch (error) {
      return this.handleError(res, error, 'Login failed');
    }
  }

  /**
   * Handle POST /logout request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleLogout(req, res) {
    try {
      const result = await this._userManager.logout();

      // Clear cookie
      res.cookie('access_token', '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Strict',
        maxAge: 0, // Expire immediately
      });

      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(res, error, 'Logout failed');
    }
  }

  /**
   * Handle GET /verify request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleVerify(req, res) {
    try {
      // User is attached to request by requireAuth middleware
      const username = req.user.username;
      const result = await this._userManager.verifyAuth(username);

      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(res, error, 'Verification failed');
    }
  }
}

export default AuthRouter;

