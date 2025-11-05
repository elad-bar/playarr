import express from 'express';
import { getTokenExpireDays } from '../utils/jwt.js';
import { requireAuth } from '../middleware/auth.js';

/**
 * Auth router for handling authentication endpoints
 */
class AuthRouter {
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
     * POST /api/auth/login
     * Authenticate user and set JWT cookie
     */
    this.router.post('/login', async (req, res) => {
      try {
        const { username, password } = req.body;

        if (!username || !password) {
          return res.status(400).json({ error: 'Username and password required' });
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
        console.error('Login error:', error);
        return res.status(500).json({ error: 'Login failed' });
      }
    });

    /**
     * POST /api/auth/logout
     * Logout user (clear cookie)
     */
    this.router.post('/logout', requireAuth, async (req, res) => {
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
        console.error('Logout error:', error);
        return res.status(500).json({ error: 'Logout failed' });
      }
    });

    /**
     * GET /api/auth/verify
     * Verify authentication status
     */
    this.router.get('/verify', requireAuth, async (req, res) => {
      try {
        // User is attached to request by requireAuth middleware
        const username = req.user.username;
        const result = await this._userManager.verifyAuth(username);

        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        console.error('Verify auth error:', error);
        return res.status(500).json({ error: 'Verification failed' });
      }
    });
  }
}

export default AuthRouter;

