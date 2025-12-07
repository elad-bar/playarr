import BaseRouter from './BaseRouter.js';

/**
 * Metrics router for Prometheus metrics endpoint
 * Protected with Bearer token authentication
 */
class MetricsRouter extends BaseRouter {
  /**
   * @param {import('../managers/domain/SettingsManager.js').SettingsManager} settingsManager - Settings manager instance
   * @param {import('../middleware/Middleware.js').default} middleware - Middleware instance
   * @param {import('../services/metrics.js').default} metricsService - Metrics service instance
   */
  constructor(settingsManager, middleware, metricsService) {
    super(middleware, 'MetricsRouter');
    this._settingsManager = settingsManager;
    this._metricsService = metricsService;
  }

  /**
   * Initialize routes for this router
   */
  initialize() {
    this.logger.info('Initializing MetricsRouter routes');
    
    /**
     * GET /metrics
     * Prometheus metrics endpoint
     * Requires Bearer token authentication via Authorization header
     */
    this.router.get('/', async (req, res) => {
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

        // Validate token against settings
        const metricsToken = await this._settingsManager.getSetting('metrics_token');
        if (!metricsToken.value || token !== metricsToken.value) {
          return this.returnErrorResponse(res, 401, 'Invalid metrics token');
        }

        // Return Prometheus metrics
        res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        const metrics = await this._metricsService.getMetrics();
        return res.send(metrics);
      } catch (error) {
        this.logger.error('Metrics endpoint error:', error);
        return this.returnErrorResponse(res, 500, 'Internal server error', error.message);
      }
    });

    /**
     * GET /metrics/json
     * Prometheus metrics endpoint in JSON format
     * Requires JWT authentication via cookie
     */
    // Test route without auth to verify routing works
    this.router.get('/test', (req, res) => {
      this.logger.info('Metrics test endpoint called');
      return res.json({ message: 'Metrics router is working', path: req.path, url: req.url });
    });

    this.router.get('/json', this.middleware.requireAuth, async (req, res) => {
      try {
        const metrics = await this._metricsService.getMetricsAsJSON();
        return res.json(metrics);
      } catch (error) {
        this.logger.error('Metrics JSON endpoint error:', error);
        return this.returnErrorResponse(res, 500, 'Internal server error', error.message);
      }
    });
    
    this.logger.info('MetricsRouter routes initialized: GET /, GET /json');
  }
}

export default MetricsRouter;

