import BaseRouter from './BaseRouter.js';
import { getTokenExpireDays } from '../utils/jwt.js';

/**
 * Auth router for handling authentication endpoints
 */
class AuthRouter extends BaseRouter {
  /**
   * @param {UserManager} userManager - User manager instance
   * @param {DatabaseService} database - Database service instance
   */
  constructor(userManager, database) {
    super(database, 'AuthRouter');
    this._userManager = userManager;
  }

  /**
   * Initialize routes for this router
   */
  initialize() {
    /**
     * POST /api/auth/login
     * Authenticate user and set JWT cookie
     */
    this.router.post('/login', async (req, res) => {
      try {
        const { username, password } = req.body;

        if (!username || !password) {
          return this.returnErrorResponse(res, 400, 'Username and password required');
        }

        const result = await this._userManager.login(username, password);

        if (result.statusCode === 200 && result.jwtToken) {
          // Create response with cookie
          const tokenExpireDays = getTokenExpireDays();
          res.cookie('access_token', result.jwtToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production', // Set to true in production with HTTPS
            sameSite: 'Strict',
            maxAge: tokenExpireDays * 24 * 60 * 60 * 1000, // Match JWT token expiration
          });
          
          return res.status(result.statusCode).json(result.response);
        }

        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Login failed', `Login error: ${error.message}`);
      }
    });

    /**
     * POST /api/auth/logout
     * Logout user (clear cookie)
     */
    this.router.post('/logout', this._requireAuth, async (req, res) => {
      try {
        const result = await this._userManager.logout();

        // Clear cookie
        res.cookie('access_token', '', {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'Strict',
          maxAge: 0, // Expire immediately
        });

        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Logout failed', `Logout error: ${error.message}`);
      }
    });

    /**
     * GET /api/auth/verify
     * Verify authentication status
     */
    this.router.get('/verify', this._requireAuth, async (req, res) => {
      try {
        // User is attached to request by requireAuth middleware
        const username = req.user.username;
        const result = await this._userManager.verifyAuth(username);

        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Verification failed', `Verify auth error: ${error.message}`);
      }
    });
  }
}

export default AuthRouter;

