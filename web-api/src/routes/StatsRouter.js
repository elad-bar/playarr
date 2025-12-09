import BaseRouter from './BaseRouter.js';

/**
 * Stats router for handling statistics endpoints
 */
class StatsRouter extends BaseRouter {
  /**
   * @param {import('express').Application} app - Express app instance
   * @param {StatsManager} statsManager - Stats manager instance
   * @param {import('../middleware/Middleware.js').default} middleware - Middleware instance
   */
  constructor(app, statsManager, middleware) {
    super(app, middleware, 'StatsRouter');
    this._statsManager = statsManager;
  }

  /**
   * Get the base path(s) for this router
   * @returns {string[]} Base path(s) for this router
   */
  getBasePath() {
    return ['/api/stats'];
  }

  /**
   * Set up routes for this router
   */
  setupRoutes() {
    /**
     * GET /api/stats
     * Get all statistics grouped by provider
     */
    this.router.get('/', this.middleware.requireAuth, this._handleGetStats.bind(this));
  }

  /**
   * Handle GET / request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleGetStats(req, res) {
    try {
      const result = await this._statsManager.getStats();
      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(res, error, 'Failed to get statistics');
    }
  }
}

export default StatsRouter;
