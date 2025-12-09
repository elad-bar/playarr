import BaseRouter from './BaseRouter.js';

/**
 * Metrics router for Prometheus metrics endpoint
 * Protected with Bearer token authentication
 */
class MetricsRouter extends BaseRouter {
  /**
   * @param {import('express').Application} app - Express app instance
   * @param {import('../middleware/Middleware.js').default} middleware - Middleware instance
   * @param {import('../managers/orchestration/MetricsManager.js').default} metricsManager - Metrics manager instance
   */
  constructor(app, middleware, metricsManager) {
    super(app, middleware, 'MetricsRouter');
    this._metricsManager = metricsManager;
  }

  /**
   * Get the base path(s) for this router
   * @returns {string[]} Base path(s) for this router
   */
  getBasePath() {
    return ['/metrics'];
  }

  /**
   * Set up routes for this router
   */
  setupRoutes() {
    this.logger.info('Initializing MetricsRouter routes');
    
    /**
     * GET /metrics
     * Prometheus metrics endpoint
     * Requires Bearer token authentication via Authorization header
     */
    this.router.get('/', this._handleGetMetrics.bind(this));

    /**
     * GET /metrics/json
     * Prometheus metrics endpoint in JSON format
     * Requires JWT authentication via cookie
     */
    this.router.get('/json', this.middleware.requireAuth, this._handleGetMetricsJson.bind(this));
    
    this.logger.info('MetricsRouter routes initialized: GET /, GET /json');
  }

  /**
   * Handle GET / request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleGetMetrics(req, res) {
    try {
      // Extract Bearer token from Authorization header
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return this.returnErrorResponse(
          res,
          401,
          'Missing or invalid Authorization header. Expected: Authorization: Bearer <token>'
        );
      }

      const token = authHeader.substring(7); // Remove 'Bearer ' prefix

      // Validate token using MetricsManager
      if (!this._metricsManager.validateToken(token)) {
        return this.returnErrorResponse(res, 401, 'Invalid metrics token');
      }

      // Return Prometheus metrics
      res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      const metrics = await this._metricsManager.getMetrics();
      return res.send(metrics);
    } catch (error) {
      this.logger.error('Metrics endpoint error:', error);
      return this.returnErrorResponse(res, 500, 'Internal server error', error.message);
    }
  }

  /**
   * Handle GET /json request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleGetMetricsJson(req, res) {
    try {
      const metrics = await this._metricsManager.getMetricsAsJSON();
      return res.json(metrics);
    } catch (error) {
      this.logger.error('Metrics JSON endpoint error:', error);
      return this.returnErrorResponse(res, 500, 'Internal server error', error.message);
    }
  }
}

export default MetricsRouter;

