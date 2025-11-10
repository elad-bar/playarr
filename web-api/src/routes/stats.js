import BaseRouter from './BaseRouter.js';

/**
 * Stats router for handling statistics endpoints
 */
class StatsRouter extends BaseRouter {
  /**
   * @param {StatsManager} statsManager - Stats manager instance
   * @param {DatabaseService} database - Database service instance
   */
  constructor(statsManager, database) {
    super(database, 'StatsRouter');
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
    this.router.get('/', this._requireAuth, async (req, res) => {
      try {
        const result = await this._statsManager.getStats();
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get statistics', `Get stats error: ${error.message}`);
      }
    });
  }
}

export default StatsRouter;
