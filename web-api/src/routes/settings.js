import express from 'express';
import { requireAuth } from '../middleware/auth.js';

// TMDB token key constant matching Python
const TMDB_TOKEN_KEY = 'tmdb_token';

/**
 * Settings router for handling settings endpoints
 */
class SettingsRouter {
  /**
   * @param {SettingsManager} settingsManager - Settings manager instance
   */
  constructor(settingsManager) {
    this._settingsManager = settingsManager;
    this.router = express.Router();
    this._setupRoutes();
  }

  /**
   * Setup all routes for this router
   * @private
   */
  _setupRoutes() {
    /**
     * GET /api/settings/tmdb_token
     * Get TMDB token setting
     */
    this.router.get('/tmdb_token', requireAuth, async (req, res) => {
      try {
        const result = await this._settingsManager.getSetting(TMDB_TOKEN_KEY);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        console.error('Get TMDB token error:', error);
        return res.status(500).json({ error: 'Failed to get TMDB token' });
      }
    });

    /**
     * POST /api/settings/tmdb_token
     * Set TMDB token setting
     */
    this.router.post('/tmdb_token', requireAuth, async (req, res) => {
      try {
        const { value } = req.body;

        if (value === undefined) {
          return res.status(400).json({ error: 'value is required' });
        }

        const result = await this._settingsManager.setSetting(TMDB_TOKEN_KEY, value);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        console.error('Set TMDB token error:', error);
        return res.status(500).json({ error: 'Failed to set TMDB token' });
      }
    });

    /**
     * DELETE /api/settings/tmdb_token
     * Delete TMDB token setting
     */
    this.router.delete('/tmdb_token', requireAuth, async (req, res) => {
      try {
        const result = await this._settingsManager.deleteSetting(TMDB_TOKEN_KEY);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        console.error('Delete TMDB token error:', error);
        return res.status(500).json({ error: 'Failed to delete TMDB token' });
      }
    });
  }
}

export default SettingsRouter;
