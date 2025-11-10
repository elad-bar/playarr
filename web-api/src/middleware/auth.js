import { verifyJWTToken } from '../utils/jwt.js';
import { DatabaseCollections, toCollectionName } from '../config/collections.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('AuthMiddleware');

/**
 * Create middleware to require JWT authentication via httpOnly cookie
 * Matches Python's require_auth decorator
 * 
 * Extracts JWT token from cookie, verifies it, loads user from database,
 * and attaches user to request object
 * 
 * @param {DatabaseService} database - Database service instance
 * @returns {Function} Express middleware function
 */
export function createRequireAuth(database) {
  return async function requireAuth(req, res, next) {
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

      // Get user from database
      const username = payload.sub;
      const usersCollection = toCollectionName(DatabaseCollections.USERS);
      const user = await database.getData(usersCollection, { username });

      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }

      // Remove password_hash and MongoDB _id from user object before attaching to request
      const { password_hash, _id, ...userPublic } = user;

      // Check user status
      if (user.status !== 'active') {
        return res.status(403).json({ error: 'User account is inactive' });
      }

      // Attach user to request object (matches Python's request.user)
      req.user = userPublic;

      next();
    } catch (error) {
      logger.error('Auth middleware error:', error);
      return res.status(401).json({ error: 'Authentication failed' });
    }
  };
}

