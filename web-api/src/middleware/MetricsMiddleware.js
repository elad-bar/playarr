/**
 * Middleware to track HTTP request metrics
 * Should be added early in the middleware chain (after body parsing, before routes)
 */
class MetricsMiddleware {
  /**
   * @param {import('../managers/orchestration/MetricsManager.js').default} metricsManager - Metrics manager instance
   */
  constructor(metricsManager) {
    this.metricsManager = metricsManager;
    this.trackRequest = this.trackRequest.bind(this);
  }

  /**
   * Get normalized endpoint path from request
   * Uses req.route?.path if available (set by Express after route matching)
   * Otherwise returns safe fallback for unmatched routes
   * @param {import('express').Request} req - Express request object
   * @returns {string} Normalized endpoint path
   * @private
   */
  _getEndpoint(req) {
    // Use req.route?.path if available (Express sets this after route matching)
    if (req.route?.path) {
      const basePath = req.baseUrl || '';
      return basePath + req.route.path;
    }
    
    // Only for unmatched routes (404s, etc.)
    return 'unknown_endpoint';
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
    
    // Store start time only (don't store endpoint here - it's too early)
    req._metricsStartTime = startTime;

    // Track response finish
    res.on('finish', () => {
      const duration = (Date.now() - startTime) / 1000;
      const statusCode = res.statusCode;
      // Always re-evaluate endpoint here (req.route is now available after route matching)
      const endpoint = this._getEndpoint(req);
      // Always re-evaluate username since authentication middleware runs after this middleware
      const username = this._getUsername(req);

      // Track request count
      this.metricsManager.incrementCounter('http_requests', {
        endpoint,
        status_code: statusCode.toString(),
        username
      });

      // Track request duration
      this.metricsManager.observeHistogram('http_request_duration', {
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
    // Always re-evaluate endpoint (req.route should be available)
    const endpoint = this._getEndpoint(req);
    // Always re-evaluate username since authentication middleware runs after metrics middleware
    const username = this._getUsername(req);
    const errorType = error.constructor.name || 'AppError';

    this.metricsManager.incrementCounter('managed_errors', {
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
    // Use provided endpoint or re-evaluate (req.route should be available)
    const endpointPath = endpoint || this._getEndpoint(req);
    const username = req.body?.username || req.query?.username || req.params?.username || 'unknown';

    this.metricsManager.incrementCounter('authentication_failures', {
      endpoint: endpointPath,
      username
    });
  }
}

export default MetricsMiddleware;

