import { createLogger } from '../utils/logger.js';

const logger = createLogger('AdminMiddleware');

/**
 * Create middleware to require admin role (requires JWT authentication)
 * Matches Python's require_admin decorator
 * 
 * Uses requireAuth first, then checks if user.role === 'admin'
 * 
 * @param {Function} requireAuth - requireAuth middleware function
 * @returns {Function} Express middleware function
 */
export function createRequireAdmin(requireAuth) {
  return async function requireAdmin(req, res, next) {
    // First check authentication
    return requireAuth(req, res, async () => {
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
  };
}

