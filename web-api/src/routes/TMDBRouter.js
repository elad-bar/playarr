import BaseRouter from './BaseRouter.js';

/**
 * TMDB router for handling TMDB API endpoints
 */
class TMDBRouter extends BaseRouter {
  /**
   * @param {import('../managers/domain/TMDBManager.js').TMDBManager} tmdbManager - TMDB manager instance
   * @param {import('../managers/domain/SettingsManager.js').SettingsManager} settingsManager - Settings manager instance
   * @param {import('../middleware/Middleware.js').default} middleware - Middleware instance
   */
  constructor(tmdbManager, settingsManager, middleware) {
    super(middleware, 'TMDBRouter');
    this._tmdbManager = tmdbManager;
    this._settingsManager = settingsManager;
    this._tmdbTokenKey = 'tmdb_token';
  }

  /**
   * Initialize routes for this router
   */
  initialize() {
    /**
     * GET /api/tmdb/api-key
     * Get the TMDB API key
     */
    this.router.get('/api-key', this.middleware.requireAuth, async (req, res) => {
      try {
        const result = await this._settingsManager.getSetting(this._tmdbTokenKey);
        return res.status(200).json({ api_key: result.value || null });
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get TMDB API key', `Get TMDB API key error: ${error.message}`);
      }
    });

    /**
     * PUT /api/tmdb/api-key
     * Set the TMDB API key (admin only)
     */
    this.router.put('/api-key', this.middleware.requireAdmin, async (req, res) => {
      try {
        const { api_key } = req.body;

        if (!api_key) {
          return this.returnErrorResponse(res, 400, 'Missing api_key field');
        }

        await this._settingsManager.setSetting(this._tmdbTokenKey, api_key);

        // Update the provider's API key
        this._tmdbManager.updateProviderApiKey(api_key);

        return res.status(200).json({ api_key: api_key });
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to set TMDB API key', `Set TMDB API key error: ${error.message}`);
      }
    });

    /**
     * DELETE /api/tmdb/api-key
     * Delete the TMDB API key (admin only)
     */
    this.router.delete('/api-key', this.middleware.requireAdmin, async (req, res) => {
      try {
        await this._settingsManager.deleteSetting(this._tmdbTokenKey);
        
        // 204 No Content should have empty body
        return res.status(204).send();
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to delete TMDB API key', `Delete TMDB API key error: ${error.message}`);
      }
    });

    /**
     * POST /api/tmdb/verify
     * Verify a TMDB API key
     */
    this.router.post('/verify', this.middleware.requireAuth, async (req, res) => {
      try {
        const { api_key } = req.body;

        if (!api_key) {
          return res.status(400).json({ 
            valid: false, 
            message: 'API key is required' 
          });
        }

        const result = await this._tmdbManager.verifyApiKey(api_key);
        // Map manager result to HTTP status codes
        // valid: false with "Authentication failed" message maps to 401, other failures to 500
        const statusCode = result.valid ? 200 : (result.message.includes('Authentication failed') || result.message.includes('Invalid API key') ? 401 : 500);
        return res.status(statusCode).json(result);
      } catch (error) {
        return this.handleError(res, error, 'Failed to verify API key');
      }
    });

  }
}

export default TMDBRouter;
