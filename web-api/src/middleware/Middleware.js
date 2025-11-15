import { verifyJWTToken } from '../utils/jwt.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Middleware');

/**
 * Unified middleware class that provides all authentication and authorization middleware functions
 * All middleware methods are bound to this instance and can be used directly in Express routes
 * 
 * @class Middleware
 */
class Middleware {
  /**
   * @param {import('../managers/users.js').UserManager} userManager - User manager instance
   */
  constructor(userManager) {
    this.userManager = userManager;
    
    // Bind methods to preserve 'this' context when used as Express middleware
    this.requireAuth = this.requireAuth.bind(this);
    this.requireAdmin = this.requireAdmin.bind(this);
    this.requireApiKey = this.requireApiKey.bind(this);
    this.requireApplicationToken = this.requireApplicationToken.bind(this);
    this.requireXtreamAuth = this.requireXtreamAuth.bind(this);
  }

  /**
   * Middleware to require JWT authentication via httpOnly cookie
   * Matches Python's require_auth decorator
   * 
   * Extracts JWT token from cookie, verifies it, loads user from database,
   * and attaches user to request object
   * 
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   * @param {import('express').NextFunction} next - Express next function
   */
  async requireAuth(req, res, next) {
    try {
      // Get token from cookie
      const token = req.cookies?.access_token;

      if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Verify token
      const payload = verifyJWTToken(token);
      if (!payload) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }

      // Get user from database using UserManager
      const username = payload.sub;
      const user = await this.userManager.getUserByUsername(username);

      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }

      // Check user status
      if (user.status !== 'active') {
        return res.status(403).json({ error: 'User account is inactive' });
      }

      // Remove password_hash and MongoDB _id from user object before attaching to request
      const { password_hash, _id, watchlist, ...userPublic } = user;

      // Attach user to request object (matches Python's request.user)
      req.user = userPublic;

      next();
    } catch (error) {
      logger.error('Auth middleware error:', error);
      return res.status(401).json({ error: 'Authentication failed' });
    }
  }

  /**
   * Middleware to require admin role (requires JWT authentication first)
   * Matches Python's require_admin decorator
   * 
   * Uses requireAuth first, then checks if user.role === 'admin'
   * 
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   * @param {import('express').NextFunction} next - Express next function
   */
  async requireAdmin(req, res, next) {
    // First check authentication
    return this.requireAuth(req, res, async () => {
      try {
        // Check if user is admin
        if (req.user?.role !== 'admin') {
          return res.status(403).json({ error: 'Admin access required' });
        }

        next();
      } catch (error) {
        logger.error('Admin middleware error:', error);
        return res.status(403).json({ error: 'Admin verification failed' });
      }
    });
  }

  /**
   * Middleware to require API key authentication (for streaming/playlist endpoints)
   * Matches Python's require_api_key decorator
   * 
   * Gets API key from URL parameter, query parameter, or X-API-Key header,
   * loads user from database using UserManager, and attaches user to request
   * 
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   * @param {import('express').NextFunction} next - Express next function
   */
  async requireApiKey(req, res, next) {
    try {
      // Get API key from URL parameter, query parameter, or header (in order of precedence)
      const apiKey = req.params.api_key || req.query.api_key || req.headers['x-api-key'];

      if (!apiKey) {
        return res.status(401).json({ error: 'API key required' });
      }

      // Get user by API key using UserManager (already checks status === 'active')
      const user = await this.userManager.getUserByApiKey(apiKey);

      if (!user) {
        return res.status(401).json({ error: 'Invalid API key' });
      }

      // Remove password_hash and MongoDB _id from user object
      const { password_hash, _id, ...userPublic } = user;

      // Attach user to request object (matches Python's request.user)
      req.user = userPublic;

      next();
    } catch (error) {
      logger.error('API key middleware error:', error);
      return res.status(401).json({ error: 'API key verification failed' });
    }
  }

  /**
   * Read application token from environment variable
   * @returns {string|null} Application token or null if not set
   * @private
   */
  _readApplicationToken() {
    const token = process.env.APPLICATION_TOKEN;
    if (!token) {
      logger.warn('APPLICATION_TOKEN environment variable not set');
      return null;
    }
    return token.trim();
  }

  /**
   * Check if request comes from localhost
   * @param {import('express').Request} req - Express request object
   * @returns {boolean} True if request is from localhost
   * @private
   */
  _isLocalhost(req) {
    const ip = req.ip || req.socket.remoteAddress;
    
    // Check various localhost representations
    const localhostIPs = [
      '127.0.0.1',
      '::1',
      '::ffff:127.0.0.1',
      'localhost'
    ];
    
    // Check req.ip
    if (ip && localhostIPs.includes(ip)) {
      return true;
    }
    
    // Check req.socket.remoteAddress
    const remoteAddress = req.socket?.remoteAddress;
    if (remoteAddress && localhostIPs.includes(remoteAddress)) {
      return true;
    }
    
    // Check X-Forwarded-For header (should be empty or localhost for local requests)
    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) {
      const forwardedIPs = forwardedFor.split(',').map(ip => ip.trim());
      if (forwardedIPs.length === 1 && localhostIPs.includes(forwardedIPs[0])) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Middleware to require application token authentication
   * Validates token from environment variable and ensures request is from localhost
   * 
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   * @param {import('express').NextFunction} next - Express next function
   */
  async requireApplicationToken(req, res, next) {
    try {
      // Check if request is from localhost
      if (!this._isLocalhost(req)) {
        logger.warn(`Application token request rejected: not from localhost (IP: ${req.ip || req.socket?.remoteAddress})`);
        return res.status(403).json({ error: 'Access denied: request must come from localhost' });
      }
      
      // Get token from header or query parameter
      const providedToken = req.headers['x-application-token'] || req.query.application_token;
      
      if (!providedToken) {
        return res.status(401).json({ error: 'Application token required' });
      }
      
      // Read token from environment variable
      const expectedToken = this._readApplicationToken();
      
      if (!expectedToken) {
        logger.error('Application token not configured');
        return res.status(500).json({ error: 'Application token not configured' });
      }
      
      // Validate token
      if (providedToken !== expectedToken) {
        logger.warn('Invalid application token provided');
        return res.status(401).json({ error: 'Invalid application token' });
      }
      
      // Token is valid and request is from localhost
      next();
    } catch (error) {
      logger.error('Application token middleware error:', error);
      return res.status(401).json({ error: 'Application token verification failed' });
    }
  }

  /**
   * Middleware to require Xtream Code API authentication
   * Validates username + API key (password) from query params or route params
   * Matches Xtream Code API authentication pattern
   * 
   * Gets username and password (API key) from:
   * - Query params: ?username=xxx&password=yyy
   * - Route params: /:username/:password/...
   * 
   * Validates that the user exists, is active, and the API key matches
   * 
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   * @param {import('express').NextFunction} next - Express next function
   */
  async requireXtreamAuth(req, res, next) {
    try {
      // Get username and password (API key) from query params or route params
      const username = req.query.username || req.params.username;
      const apiKey = req.query.password || req.params.password; // password param is actually API key

      if (!username || !apiKey) {
        // Return Xtream Code API format error response
        return res.status(401).json({ 
          user_info: { 
            auth: 0,
            status: 'Blocked',
            message: 'Username or password incorrect'
          }
        });
      }

      // Get user by username using UserManager
      const user = await this.userManager.getUserByUsername(username);

      if (!user) {
        return res.status(401).json({ 
          user_info: { 
            auth: 0,
            status: 'Blocked',
            message: 'Username or password incorrect'
          }
        });
      }

      // Check user status
      if (user.status !== 'active') {
        return res.status(401).json({ 
          user_info: { 
            auth: 0,
            status: 'Blocked',
            message: 'Username or password incorrect'
          }
        });
      }

      // Verify API key matches
      if (user.api_key !== apiKey) {
        return res.status(401).json({ 
          user_info: { 
            auth: 0,
            status: 'Blocked',
            message: 'Username or password incorrect'
          }
        });
      }

      // Remove password_hash and MongoDB _id from user object
      // Keep watchlist as it's needed for Xtream API endpoints
      const { password_hash, _id, ...userPublic } = user;

      // Attach user to request object
      req.user = userPublic;

      next();
    } catch (error) {
      logger.error('Xtream auth middleware error:', error);
      return res.status(401).json({ 
        user_info: { 
          auth: 0,
          status: 'Blocked',
          message: 'Username or password incorrect'
        }
      });
    }
  }
}

export default Middleware;

