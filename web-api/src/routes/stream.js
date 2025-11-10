import BaseRouter from './BaseRouter.js';

/**
 * Stream router for handling stream endpoints
 */
class StreamRouter extends BaseRouter {
  /**
   * @param {StreamManager} streamManager - Stream manager instance
   * @param {DatabaseService} database - Database service instance
   */
  constructor(streamManager, database) {
    super(database, 'StreamRouter');
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
    this.router.get('/movies/:title_id', this._requireApiKey, async (req, res) => {
      try {
        const { title_id } = req.params;
        const stream = await this._streamManager.getBestSource(title_id, 'movies');

        if (!stream) {
          return this.returnErrorResponse(res, 503, 'No available providers');
        }

        return res.redirect(stream);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get stream', `Get movie stream error: ${error.message}`);
      }
    });

    /**
     * GET /api/stream/tvshows/:title_id/:season/:episode
     * Get TV show stream redirect (requires API key)
     */
    this.router.get('/tvshows/:title_id/:season/:episode', this._requireApiKey, async (req, res) => {
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

        return res.redirect(stream);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get stream', `Get TV show stream error: ${error.message}`);
      }
    });
  }
}

export default StreamRouter;
