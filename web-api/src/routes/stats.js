import express from 'express';
import { requireAuth } from '../middleware/auth.js';

/**
 * Stats router for handling statistics endpoints
 */
class StatsRouter {
  /**
   * @param {StatsManager} statsManager - Stats manager instance
   */
  constructor(statsManager) {
    this._statsManager = statsManager;
    this.router = express.Router();
    this._setupRoutes();
  }

  /**
   * Setup all routes for this router
   * @private
   */
  _setupRoutes() {
    /**
     * GET /api/stats
     * Get all statistics grouped by provider
     */
    this.router.get('/', requireAuth, async (req, res) => {
      try {
        const result = await this._statsManager.getStats();
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        console.error('Get stats error:', error);
        return res.status(500).json({ error: 'Failed to get statistics' });
      }
    });
  }
}

export default StatsRouter;
