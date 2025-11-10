import BaseRouter from './BaseRouter.js';

/**
 * Titles router for handling titles endpoints
 */
class TitlesRouter extends BaseRouter {
  /**
   * @param {TitlesManager} titlesManager - Titles manager instance
   * @param {DatabaseService} database - Database service instance
   */
  constructor(titlesManager, database) {
    super(database, 'TitlesRouter');
    this._titlesManager = titlesManager;
  }

  /**
   * Initialize routes for this router
   */
  initialize() {
    /**
     * GET /api/titles
     * Get paginated list of titles with filtering
     */
    this.router.get('/', this._requireAuth, async (req, res) => {
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
        return this.returnErrorResponse(res, 500, 'Failed to get titles', `Get titles error: ${error.message}`);
      }
    });

    /**
     * GET /api/titles/:title_key
     * Get detailed information for a specific title
     */
    this.router.get('/:title_key', this._requireAuth, async (req, res) => {
      try {
        const { title_key } = req.params;
        const result = await this._titlesManager.getTitleDetails(title_key, req.user);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get title details', `Get title details error: ${error.message}`);
      }
    });

    /**
     * PUT /api/titles/:title_key/watchlist
     * Update watchlist status for a single title
     */
    this.router.put('/:title_key/watchlist', this._requireAuth, async (req, res) => {
      try {
        const { title_key } = req.params;
        const { watchlist } = req.body;

        if (typeof watchlist !== 'boolean') {
          return this.returnErrorResponse(res, 400, 'watchlist must be a boolean');
        }

        const result = await this._titlesManager.updateWatchlist(req.user, title_key, watchlist);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to update watchlist', `Update watchlist error: ${error.message}`);
      }
    });

    /**
     * PUT /api/titles/watchlist/bulk
     * Update watchlist status for multiple titles
     */
    this.router.put('/watchlist/bulk', this._requireAuth, async (req, res) => {
      try {
        const { titles } = req.body;

        if (!Array.isArray(titles)) {
          return this.returnErrorResponse(res, 400, 'titles must be an array');
        }

        // Validate each title object
        for (const title of titles) {
          if (!title.key || typeof title.watchlist !== 'boolean') {
            return this.returnErrorResponse(res, 400, 'Each title must have "key" (string) and "watchlist" (boolean) fields');
          }
        }

        const result = await this._titlesManager.updateWatchlistBulk(req.user, titles);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to update watchlist', `Bulk update watchlist error: ${error.message}`);
      }
    });
  }
}

export default TitlesRouter;
