import { DatabaseCollections, toCollectionName } from '../config/collections.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ApiKeyMiddleware');

/**
 * Create middleware to require API key authentication (for streaming/playlist endpoints)
 * Matches Python's require_api_key decorator
 * 
 * Gets API key from query parameter or X-API-Key header,
 * loads user from database, and attaches user to request
 * 
 * @param {DatabaseService} database - Database service instance
 * @returns {Function} Express middleware function
 */
export function createRequireApiKey(database) {
  return async function requireApiKey(req, res, next) {
    try {
      // Get API key from query parameter or header
      const apiKey = req.query.api_key || req.headers['x-api-key'];

      if (!apiKey) {
        return res.status(401).json({ error: 'API key required' });
      }

      // Get user by API key
      const usersCollection = toCollectionName(DatabaseCollections.USERS);
      const user = await database.getData(usersCollection, { api_key: apiKey });

      if (!user) {
        return res.status(401).json({ error: 'Invalid API key' });
      }

      // Check user status
      if (user.status !== 'active') {
        return res.status(403).json({ error: 'User account is inactive' });
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
  };
}

