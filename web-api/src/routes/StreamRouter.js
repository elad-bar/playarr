import BaseRouter from './BaseRouter.js';

/**
 * Stream router for handling stream endpoints
 */
class StreamRouter extends BaseRouter {
  /**
   * @param {import('express').Application} app - Express app instance
   * @param {import('../managers/formatting/StremioManager.js').StremioManager} stremioManager - Stremio manager instance (for stream URL resolution)
   * @param {import('../middleware/Middleware.js').default} middleware - Middleware instance
   * @param {import('../managers/orchestration/MetricsManager.js').default} metricsManager - Metrics manager instance
   */
  constructor(app, stremioManager, middleware, metricsManager) {
    super(app, middleware, 'StreamRouter');
    this._stremioManager = stremioManager;
    this._metricsManager = metricsManager;
  }

  /**
   * Get the base path(s) for this router
   * @returns {string[]} Base path(s) for this router
   */
  getBasePath() {
    return ['/api/stream'];
  }

  /**
   * Set up routes for this router
   */
  setupRoutes() {
    /**
     * GET /api/stream/movies/:title_id
     * Get movie stream redirect (requires API key)
     */
    this.router.get('/movies/:title_id', this.middleware.requireApiKey, this._handleGetMovieStream.bind(this));

    /**
     * GET /api/stream/tvshows/:title_id/:season/:episode
     * Get TV show stream redirect (requires API key)
     */
    this.router.get('/tvshows/:title_id/:season/:episode', this.middleware.requireApiKey, this._handleGetTvShowStream.bind(this));

    /**
     * OPTIONS handler for CORS preflight on stream endpoints
     */
    this.router.options('/movies/:title_id', this._handleOptionsMovieStream.bind(this));

    this.router.options('/tvshows/:title_id/:season/:episode', this._handleOptionsTvShowStream.bind(this));
  }

  /**
   * Handle GET /movies/:title_id request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleGetMovieStream(req, res) {
    const startTime = Date.now();
    try {
      const { title_id } = req.params;
      const username = req.user?.username || null;
      const stream = await this._stremioManager.getBestSource(title_id, 'movies', null, null, username);

      if (!stream) {
        return this.returnErrorResponse(res, 503, 'No available providers');
      }

      // Track metrics
      if (username) {
        this._metricsManager.incrementCounter('stream_requests', { user: username });
      }
      const duration = (Date.now() - startTime) / 1000;
      this._metricsManager.observeHistogram('stream_request_duration', { media_type: 'movies' }, duration);

      // Add CORS headers for Stremio casting support
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');

      return res.redirect(stream);
    } catch (error) {
      return this.returnErrorResponse(res, 500, 'Failed to get stream', `Get movie stream error: ${error.message}`);
    }
  }

  /**
   * Handle GET /tvshows/:title_id/:season/:episode request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleGetTvShowStream(req, res) {
    const startTime = Date.now();
    try {
      const { title_id, season, episode } = req.params;
      const username = req.user?.username || null;
      const stream = await this._stremioManager.getBestSource(
        title_id,
        'tvshows',
        parseInt(season, 10),
        parseInt(episode, 10),
        username
      );

      if (!stream) {
        return this.returnErrorResponse(res, 503, 'No available providers');
      }

      // Track metrics
      if (username) {
        this._metricsManager.incrementCounter('stream_requests', { user: username });
      }
      const duration = (Date.now() - startTime) / 1000;
      this._metricsManager.observeHistogram('stream_request_duration', { media_type: 'tvshows' }, duration);

      // Add CORS headers for Stremio casting support
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');

      return res.redirect(stream);
    } catch (error) {
      return this.returnErrorResponse(res, 500, 'Failed to get stream', `Get TV show stream error: ${error.message}`);
    }
  }

  /**
   * Handle OPTIONS /movies/:title_id request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  _handleOptionsMovieStream(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
    res.status(200).send();
  }

  /**
   * Handle OPTIONS /tvshows/:title_id/:season/:episode request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  _handleOptionsTvShowStream(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
    res.status(200).send();
  }
}

export default StreamRouter;
