import express from 'express';
import { requireApiKey } from '../middleware/apiKey.js';

/**
 * Stream router for handling stream endpoints
 */
class StreamRouter {
  /**
   * @param {StreamManager} streamManager - Stream manager instance
   */
  constructor(streamManager) {
    this._streamManager = streamManager;
    this.router = express.Router();
    this._setupRoutes();
  }

  /**
   * Setup all routes for this router
   * @private
   */
  _setupRoutes() {
    /**
     * GET /api/stream/movies/:title_id
     * Get movie stream redirect (requires API key)
     */
    this.router.get('/movies/:title_id', requireApiKey, async (req, res) => {
      try {
        const { title_id } = req.params;
        const stream = await this._streamManager.getBestSource(title_id, 'movies');

        if (!stream) {
          return res.status(503).json({ error: 'No available providers' });
        }

        return res.redirect(stream);
      } catch (error) {
        console.error('Get movie stream error:', error);
        return res.status(500).json({ error: 'Failed to get stream' });
      }
    });

    /**
     * GET /api/stream/tvshows/:title_id/:season/:episode
     * Get TV show stream redirect (requires API key)
     */
    this.router.get('/tvshows/:title_id/:season/:episode', requireApiKey, async (req, res) => {
      try {
        const { title_id, season, episode } = req.params;
        const stream = await this._streamManager.getBestSource(
          title_id,
          'tvshows',
          season,
          episode
        );

        if (!stream) {
          return res.status(503).json({ error: 'No available providers' });
        }

        return res.redirect(stream);
      } catch (error) {
        console.error('Get TV show stream error:', error);
        return res.status(500).json({ error: 'Failed to get stream' });
      }
    });
  }
}

export default StreamRouter;
