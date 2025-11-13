import { createLogger } from '../utils/logger.js';

const logger = createLogger('ApplicationTokenMiddleware');

/**
 * Read application token from environment variable
 * @returns {string|null} Application token or null if not set
 */
function readApplicationToken() {
  const token = process.env.APPLICATION_TOKEN;
  if (!token) {
    logger.warn('APPLICATION_TOKEN environment variable not set');
    return null;
  }
  return token.trim();
}

/**
 * Check if request comes from localhost
 * @param {Object} req - Express request object
 * @returns {boolean} True if request is from localhost
 */
function isLocalhost(req) {
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
 * Create middleware to require application token authentication
 * Validates token from file and ensures request is from localhost
 * 
 * @returns {Function} Express middleware function
 */
export function createRequireApplicationToken() {
  return async function requireApplicationToken(req, res, next) {
    try {
      // Check if request is from localhost
      if (!isLocalhost(req)) {
        logger.warn(`Application token request rejected: not from localhost (IP: ${req.ip || req.socket?.remoteAddress})`);
        return res.status(403).json({ error: 'Access denied: request must come from localhost' });
      }
      
      // Get token from header or query parameter
      const providedToken = req.headers['x-application-token'] || req.query.application_token;
      
      if (!providedToken) {
        return res.status(401).json({ error: 'Application token required' });
      }
      
      // Read token from file
      const expectedToken = readApplicationToken();
      
      if (!expectedToken) {
        logger.error('Application token file not available');
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
  };
}

