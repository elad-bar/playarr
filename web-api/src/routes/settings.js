import BaseRouter from './BaseRouter.js';

// TMDB token key constant matching Python
const TMDB_TOKEN_KEY = 'tmdb_token';

/**
 * Settings router for handling settings endpoints
 */
class SettingsRouter extends BaseRouter {
  /**
   * @param {SettingsManager} settingsManager - Settings manager instance
   * @param {DatabaseService} database - Database service instance
   */
  constructor(settingsManager, database) {
    super(database, 'SettingsRouter');
    this._settingsManager = settingsManager;
  }

  /**
   * Initialize routes for this router
   */
  initialize() {
    /**
     * GET /api/settings/tmdb_token
     * Get TMDB token setting
     */
    this.router.get('/tmdb_token', this._requireAuth, async (req, res) => {
      try {
        const result = await this._settingsManager.getSetting(TMDB_TOKEN_KEY);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get TMDB token', `Get TMDB token error: ${error.message}`);
      }
    });

    /**
     * POST /api/settings/tmdb_token
     * Set TMDB token setting
     */
    this.router.post('/tmdb_token', this._requireAuth, async (req, res) => {
      try {
        const { value } = req.body;

        if (value === undefined) {
          return this.returnErrorResponse(res, 400, 'value is required');
        }

        const result = await this._settingsManager.setSetting(TMDB_TOKEN_KEY, value);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to set TMDB token', `Set TMDB token error: ${error.message}`);
      }
    });

    /**
     * DELETE /api/settings/tmdb_token
     * Delete TMDB token setting
     */
    this.router.delete('/tmdb_token', this._requireAuth, async (req, res) => {
      try {
        const result = await this._settingsManager.deleteSetting(TMDB_TOKEN_KEY);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to delete TMDB token', `Delete TMDB token error: ${error.message}`);
      }
    });
  }
}

export default SettingsRouter;
