import express from 'express';
import { requireAuth } from '../middleware/auth.js';

/**
 * Titles router for handling titles endpoints
 */
class TitlesRouter {
  /**
   * @param {TitlesManager} titlesManager - Titles manager instance
   */
  constructor(titlesManager) {
    this._titlesManager = titlesManager;
    this.router = express.Router();
    this._setupRoutes();
  }

  /**
   * Setup all routes for this router
   * @private
   */
  _setupRoutes() {
    /**
     * GET /api/titles
     * Get paginated list of titles with filtering
     */
    this.router.get('/', requireAuth, async (req, res) => {
      try {
        const {
          page = 1,
          per_page = 50,
          search = '',
          year = '',
          watchlist,
          media_type,
          starts_with = '',
        } = req.query;

        const result = await this._titlesManager.getTitles({
          user: req.user,
          page: parseInt(page, 10),
          perPage: parseInt(per_page, 10),
          searchQuery: search,
          yearFilter: year,
          watchlist: watchlist === 'true' ? true : watchlist === 'false' ? false : null,
          mediaType: media_type,
          startsWith: starts_with,
        });

        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        console.error('Get titles error:', error);
        return res.status(500).json({ error: 'Failed to get titles' });
      }
    });

    /**
     * GET /api/titles/:title_key
     * Get detailed information for a specific title
     */
    this.router.get('/:title_key', requireAuth, async (req, res) => {
      try {
        const { title_key } = req.params;
        const result = await this._titlesManager.getTitleDetails(title_key, req.user);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        console.error('Get title details error:', error);
        return res.status(500).json({ error: 'Failed to get title details' });
      }
    });

    /**
     * PUT /api/titles/:title_key/watchlist
     * Update watchlist status for a single title
     */
    this.router.put('/:title_key/watchlist', requireAuth, async (req, res) => {
      try {
        const { title_key } = req.params;
        const { watchlist } = req.body;

        if (typeof watchlist !== 'boolean') {
          return res.status(400).json({ error: 'watchlist must be a boolean' });
        }

        const result = await this._titlesManager.updateWatchlist(req.user, title_key, watchlist);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        console.error('Update watchlist error:', error);
        return res.status(500).json({ error: 'Failed to update watchlist' });
      }
    });

    /**
     * PUT /api/titles/watchlist/bulk
     * Update watchlist status for multiple titles
     */
    this.router.put('/watchlist/bulk', requireAuth, async (req, res) => {
      try {
        const { titles } = req.body;

        if (!Array.isArray(titles)) {
          return res.status(400).json({ error: 'titles must be an array' });
        }

        // Validate each title object
        for (const title of titles) {
          if (!title.key || typeof title.watchlist !== 'boolean') {
            return res.status(400).json({ 
              error: 'Each title must have "key" (string) and "watchlist" (boolean) fields' 
            });
          }
        }

        const result = await this._titlesManager.updateWatchlistBulk(req.user, titles);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        console.error('Bulk update watchlist error:', error);
        return res.status(500).json({ error: 'Failed to update watchlist' });
      }
    });
  }
}

export default TitlesRouter;
