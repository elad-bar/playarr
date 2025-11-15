import BaseRouter from './BaseRouter.js';

/**
 * Stream router for handling stream endpoints
 */
class StreamRouter extends BaseRouter {
  /**
   * @param {StreamManager} streamManager - Stream manager instance
   * @param {import('../middleware/Middleware.js').default} middleware - Middleware instance
   */
  constructor(streamManager, middleware) {
    super(middleware, 'StreamRouter');
    this._streamManager = streamManager;
  }

  /**
   * Initialize routes for this router
   */
  initialize() {
    /**
     * GET /api/stream/movies/:title_id
     * Get movie stream redirect (requires API key)
     */
    this.router.get('/movies/:title_id', this.middleware.requireApiKey, async (req, res) => {
      try {
        const { title_id } = req.params;
        const stream = await this._streamManager.getBestSource(title_id, 'movies');

        if (!stream) {
          return this.returnErrorResponse(res, 503, 'No available providers');
        }

        // Add CORS headers for Stremio casting support
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');

        return res.redirect(stream);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get stream', `Get movie stream error: ${error.message}`);
      }
    });

    /**
     * GET /api/stream/tvshows/:title_id/:season/:episode
     * Get TV show stream redirect (requires API key)
     */
    this.router.get('/tvshows/:title_id/:season/:episode', this.middleware.requireApiKey, async (req, res) => {
      try {
        const { title_id, season, episode } = req.params;
        const stream = await this._streamManager.getBestSource(
          title_id,
          'tvshows',
          season,
          episode
        );

        if (!stream) {
          return this.returnErrorResponse(res, 503, 'No available providers');
        }

        // Add CORS headers for Stremio casting support
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');

        return res.redirect(stream);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get stream', `Get TV show stream error: ${error.message}`);
      }
    });

    /**
     * OPTIONS handler for CORS preflight on stream endpoints
     */
    this.router.options('/movies/:title_id', (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
      res.status(200).send();
    });

    this.router.options('/tvshows/:title_id/:season/:episode', (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
      res.status(200).send();
    });
  }
}

export default StreamRouter;
