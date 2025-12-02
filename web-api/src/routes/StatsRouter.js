import BaseRouter from './BaseRouter.js';

/**
 * Stats router for handling statistics endpoints
 */
class StatsRouter extends BaseRouter {
  /**
   * @param {StatsManager} statsManager - Stats manager instance
   * @param {import('../middleware/Middleware.js').default} middleware - Middleware instance
   */
  constructor(statsManager, middleware) {
    super(middleware, 'StatsRouter');
    this._statsManager = statsManager;
  }

  /**
   * Initialize routes for this router
   */
  initialize() {
    /**
     * GET /api/stats
     * Get all statistics grouped by provider
     */
    this.router.get('/', this.middleware.requireAuth, async (req, res) => {
      try {
        const result = await this._statsManager.getStats();
        return res.status(200).json(result);
      } catch (error) {
        return this.handleError(res, error, 'Failed to get statistics');
      }
    });
  }
}

export default StatsRouter;
