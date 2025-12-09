import BaseRouter from './BaseRouter.js';

/**
 * Titles router for handling titles endpoints
 */
class TitlesRouter extends BaseRouter {
  /**
   * @param {import('express').Application} app - Express app instance
   * @param {import('../managers/domain/TitlesManager.js').TitlesManager} titlesManager - Titles manager instance
   * @param {import('../managers/orchestration/ProvidersManager.js').ProvidersManager} providersManager - Providers manager instance (for getting enabled provider IDs)
   * @param {import('../managers/domain/UserManager.js').UserManager} userManager - User manager instance (for watchlist operations)
   * @param {import('../middleware/Middleware.js').default} middleware - Middleware instance
   * @param {import('../managers/orchestration/MetricsManager.js').default} metricsManager - Metrics manager instance
   */
  constructor(app, titlesManager, providersManager, userManager, middleware, metricsManager) {
    super(app, middleware, 'TitlesRouter');
    this._titlesManager = titlesManager;
    this._providersManager = providersManager;
    this._userManager = userManager;
    this._metricsManager = metricsManager;
  }

  /**
   * Get the base path(s) for this router
   * @returns {string[]} Base path(s) for this router
   */
  getBasePath() {
    return ['/api/titles'];
  }

  /**
   * Set up routes for this router
   */
  setupRoutes() {
    /**
     * GET /api/titles
     * Get paginated list of titles with filtering
     */
    this.router.get('/', this.middleware.requireAuth, this._handleGetTitles.bind(this));

    /**
     * GET /api/titles/:title_key
     * Get detailed information for a specific title
     */
    this.router.get('/:title_key', this.middleware.requireAuth, this._handleGetTitleByKey.bind(this));

    /**
     * PUT /api/titles/:title_key/watchlist
     * Update watchlist status for a single title
     */
    this.router.put('/:title_key/watchlist', this.middleware.requireAuth, this._handleUpdateTitleWatchlist.bind(this));

    /**
     * PUT /api/titles/watchlist/bulk
     * Update watchlist status for multiple titles
     */
    this.router.put('/watchlist/bulk', this.middleware.requireAuth, this._handleUpdateWatchlistBulk.bind(this));
  }

  /**
   * Handle GET / request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleGetTitles(req, res) {
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

      // Get enabled provider IDs
      const enabledProviderIds = await this._providersManager.getEnabledProviderIds();

      // Get user data and extract watchlist
      const userData = await this._userManager.getUserByUsername(req.user.username);
      const userWatchlist = userData?.watchlist || { movies: [], tvshows: [], live: [] };
      // Combine movies and tvshows arrays for titles query
      const watchlistArray = [
        ...(userWatchlist.movies || []),
        ...(userWatchlist.tvshows || [])
      ];

      const result = await this._titlesManager.getTitles({
        watchlist: watchlistArray,
        page: parseInt(page, 10),
        perPage: parseInt(per_page, 10),
        searchQuery: search,
        yearFilter: year,
        inWatchlist: watchlist,
        mediaType: media_type,
        startsWith: starts_with,
        enabledProviderIds,
      });

      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(res, error, 'Failed to get titles');
    }
  }

  /**
   * Handle GET /:title_key request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleGetTitleByKey(req, res) {
    try {
      const { title_key } = req.params;
      
      // Get enabled provider IDs
      const enabledProviderIds = await this._providersManager.getEnabledProviderIds();
      
      // Get user data and extract watchlist
      const userData = await this._userManager.getUserByUsername(req.user.username);
      const userWatchlist = userData?.watchlist || { movies: [], tvshows: [], live: [] };
      // Combine movies and tvshows arrays for titles query
      const watchlistArray = [
        ...(userWatchlist.movies || []),
        ...(userWatchlist.tvshows || [])
      ];
      
      const result = await this._titlesManager.getTitleDetails(title_key, watchlistArray, enabledProviderIds);
      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(res, error, 'Failed to get title details');
    }
  }

  /**
   * Handle PUT /:title_key/watchlist request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleUpdateTitleWatchlist(req, res) {
    try {
      const { title_key } = req.params;
      const { watchlist } = req.body;

      if (typeof watchlist !== 'boolean') {
        return res.status(400).json({ error: 'watchlist must be a boolean' });
      }

      // Validate title exists
      const title = await this._titlesManager.findTitleByQuery({ title_key });
      if (!title) {
        return res.status(404).json({ error: 'Title not found' });
      }

      // Update watchlist via UserManager
      const success = await this._userManager.updateUserWatchlist(req.user.username, [title_key], watchlist);
      if (!success) {
        return res.status(500).json({ error: 'Failed to update watchlist' });
      }

      // Track watchlist operation
      this._metricsManager.incrementCounter('watchlist_operations', {
        operation: watchlist ? 'add' : 'remove',
        media_type: title.type || 'unknown',
        username: req.user.username
      });

      return res.status(200).json({
        message: `Title ${watchlist ? 'added to' : 'removed from'} watchlist successfully`,
        title_key,
        watchlist
      });
    } catch (error) {
      return this.handleError(res, error, 'Failed to update watchlist');
    }
  }

  /**
   * Handle PUT /watchlist/bulk request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleUpdateWatchlistBulk(req, res) {
    try {
      const { titles } = req.body;

      if (!Array.isArray(titles)) {
        return res.status(400).json({ error: 'titles must be an array' });
      }

      // Validate each title object
      for (const title of titles) {
        if (!title.key || typeof title.watchlist !== 'boolean') {
          return res.status(400).json({ error: 'Each title must have "key" (string) and "watchlist" (boolean) fields' });
        }
      }

      // Extract all title keys to verify
      const titleKeys = titles.map(t => t.key).filter(Boolean);
      
      if (titleKeys.length === 0) {
        return res.status(400).json({ error: 'No title keys provided' });
      }

      // Validate titles exist and get their media types
      const existingTitles = await this._titlesManager.findTitlesByQuery(
        { title_key: { $in: titleKeys } },
        { projection: { title_key: 1, type: 1, _id: 0 } }
      );

      const existingKeys = new Set(existingTitles.map(t => t.title_key));
      const titleMediaTypeMap = new Map(existingTitles.map(t => [t.title_key, t.type || 'unknown']));
      const notFound = titleKeys.filter(key => !existingKeys.has(key));

      // Separate titles to add and remove
      const titlesToWatchlist = [];
      const titlesToUnwatchlist = [];

      for (const titleUpdate of titles) {
        const titleKey = titleUpdate.key;
        const watchlist = titleUpdate.watchlist;

        // Skip if title doesn't exist
        if (!existingKeys.has(titleKey)) {
          continue;
        }

        if (watchlist) {
          titlesToWatchlist.push(titleKey);
        } else {
          titlesToUnwatchlist.push(titleKey);
        }
      }

      // Update watchlist via UserManager
      let totalUpdated = 0;
      if (titlesToWatchlist.length > 0) {
        const success = await this._userManager.updateUserWatchlist(req.user.username, titlesToWatchlist, true);
        if (success) {
          totalUpdated += titlesToWatchlist.length;
          // Track watchlist operations
          for (const titleKey of titlesToWatchlist) {
            const mediaType = titleMediaTypeMap.get(titleKey) || 'unknown';
            this._metricsManager.incrementCounter('watchlist_operations', {
              operation: 'add',
              media_type: mediaType,
              username: req.user.username
            });
          }
        }
      }

      if (titlesToUnwatchlist.length > 0) {
        const success = await this._userManager.updateUserWatchlist(req.user.username, titlesToUnwatchlist, false);
        if (success) {
          totalUpdated += titlesToUnwatchlist.length;
          // Track watchlist operations
          for (const titleKey of titlesToUnwatchlist) {
            const mediaType = titleMediaTypeMap.get(titleKey) || 'unknown';
            this._metricsManager.incrementCounter('watchlist_operations', {
              operation: 'remove',
              media_type: mediaType,
              username: req.user.username
            });
          }
        }
      }

      const response = {
        message: `Updated ${totalUpdated} titles successfully`,
        updated_count: totalUpdated,
      };

      if (notFound.length > 0) {
        response.not_found = notFound;
      }

      if (totalUpdated === 0) {
        return res.status(404).json({ error: 'No titles were updated' });
      }

      return res.status(200).json(response);
    } catch (error) {
      return this.handleError(res, error, 'Failed to update watchlist');
    }
  }
}

export default TitlesRouter;
