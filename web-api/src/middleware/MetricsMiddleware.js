import { createLogger } from '../utils/logger.js';

const logger = createLogger('MetricsMiddleware');

/**
 * Middleware to track HTTP request metrics
 * Should be added early in the middleware chain (after body parsing, before routes)
 */
class MetricsMiddleware {
  /**
   * @param {import('../services/metrics.js').default} metricsService - Metrics service instance
   */
  constructor(metricsService) {
    this.metricsService = metricsService;
    this.trackRequest = this.trackRequest.bind(this);
  }

  /**
   * Get normalized endpoint path from request
   * Uses req.route?.path if available (set by Express after route matching)
   * Otherwise normalizes common parameter patterns
   * @param {import('express').Request} req - Express request object
   * @returns {string} Normalized endpoint path
   * @private
   */
  _getEndpoint(req) {
    // Use req.route?.path if available (Express sets this after route matching)
    if (req.route?.path) {
      // Combine base path with route path
      const basePath = req.baseUrl || '';
      return basePath + req.route.path;
    }
    
    // Fallback: use req.path and normalize common patterns
    let path = req.path;
    
    // Normalize common parameter patterns
    // UUIDs: 8-4-4-4-12 hex pattern
    path = path.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id');
    
    // MongoDB ObjectIds: 24 hex characters
    path = path.replace(/\/[0-9a-f]{24}/gi, '/:id');
    
    // Numeric IDs
    path = path.replace(/\/\d+/g, '/:id');
    
    return path || req.path;
  }

  /**
   * Get username from request (if authenticated)
   * @param {import('express').Request} req - Express request object
   * @returns {string} Username or 'anonymous' if not authenticated
   * @private
   */
  _getUsername(req) {
    return req.user?.username || 'anonymous';
  }

  /**
   * Express middleware to track HTTP request metrics
   * Tracks request count, duration, and errors
   * Must be added before routes are registered
   */
  trackRequest(req, res, next) {
    const startTime = Date.now();
    
    // Store endpoint and username on request for later use
    req._metricsStartTime = startTime;
    req._metricsEndpoint = this._getEndpoint(req);
    req._metricsUsername = this._getUsername(req);

    // Track response finish
    res.on('finish', () => {
      const duration = (Date.now() - startTime) / 1000;
      const statusCode = res.statusCode;
      const endpoint = req._metricsEndpoint || this._getEndpoint(req);
      const username = req._metricsUsername || this._getUsername(req);

      // Track request count
      this.metricsService.incrementCounter('http_requests', {
        endpoint,
        status_code: statusCode.toString(),
        username
      });

      // Track request duration
      this.metricsService.observeHistogram('http_request_duration', {
        endpoint,
        username
      }, duration);
    });

    next();
  }

  /**
   * Track managed error (AppError instance)
   * Should be called from error handling middleware
   * @param {import('express').Request} req - Express request object
   * @param {Error} error - Error instance
   */
  trackManagedError(req, error) {
    const endpoint = req._metricsEndpoint || this._getEndpoint(req);
    const username = req._metricsUsername || this._getUsername(req);
    const errorType = error.constructor.name || 'AppError';

    this.metricsService.incrementCounter('managed_errors', {
      endpoint,
      error_type: errorType,
      username
    });
  }

  /**
   * Track authentication failure
   * Should be called from authentication middleware on failure
   * @param {import('express').Request} req - Express request object
   * @param {string} [endpoint] - Optional endpoint path (if not provided, will be extracted from req)
   */
  trackAuthenticationFailure(req, endpoint = null) {
    const endpointPath = endpoint || req._metricsEndpoint || this._getEndpoint(req);
    const username = req.body?.username || req.query?.username || req.params?.username || 'unknown';

    this.metricsService.incrementCounter('authentication_failures', {
      endpoint: endpointPath,
      username
    });
  }
}

export default MetricsMiddleware;

