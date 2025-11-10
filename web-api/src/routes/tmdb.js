import BaseRouter from './BaseRouter.js';

/**
 * TMDB router for handling TMDB API endpoints
 */
class TMDBRouter extends BaseRouter {
  /**
   * @param {TMDBManager} tmdbManager - TMDB manager instance
   * @param {DatabaseService} database - Database service instance
   */
  constructor(tmdbManager, database) {
    super(database, 'TMDBRouter');
    this._tmdbManager = tmdbManager;
  }

  /**
   * Initialize routes for this router
   */
  initialize() {
    /**
     * GET /api/tmdb/api-key
     * Get the TMDB API key
     */
    this.router.get('/api-key', this._requireAuth, async (req, res) => {
      try {
        const result = await this._tmdbManager.getApiKey();
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get TMDB API key', `Get TMDB API key error: ${error.message}`);
      }
    });

    /**
     * PUT /api/tmdb/api-key
     * Set the TMDB API key (admin only)
     */
    this.router.put('/api-key', this._requireAdmin, async (req, res) => {
      try {
        const { api_key } = req.body;

        if (!api_key) {
          return this.returnErrorResponse(res, 400, 'Missing api_key field');
        }

        const result = await this._tmdbManager.setApiKey(api_key);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to set TMDB API key', `Set TMDB API key error: ${error.message}`);
      }
    });

    /**
     * DELETE /api/tmdb/api-key
     * Delete the TMDB API key (admin only)
     */
    this.router.delete('/api-key', this._requireAdmin, async (req, res) => {
      try {
        const result = await this._tmdbManager.deleteApiKey();
        
        // 204 No Content should have empty body
        if (result.statusCode === 204) {
          return res.status(204).send();
        }
        
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to delete TMDB API key', `Delete TMDB API key error: ${error.message}`);
      }
    });

    /**
     * POST /api/tmdb/verify
     * Verify a TMDB API key
     */
    this.router.post('/verify', this._requireAuth, async (req, res) => {
      try {
        const { api_key } = req.body;

        if (!api_key) {
          return res.status(400).json({ 
            valid: false, 
            message: 'API key is required' 
          });
        }

        const result = await this._tmdbManager.verifyApiKey(api_key);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        this.logger.error('Verify TMDB API key error:', error);
        return res.status(500).json({ 
          valid: false, 
          message: `Error verifying API key: ${error.message}` 
        });
      }
    });

    /**
     * POST /api/tmdb/lists
     * Get TMDB lists for the authenticated user
     */
    this.router.post('/lists', this._requireAuth, async (req, res) => {
      try {
        const { api_key } = req.body;

        if (!api_key) {
          return this.returnErrorResponse(res, 400, 'API key is required');
        }

        const result = await this._tmdbManager.getLists(api_key);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get TMDB lists', `Get TMDB lists error: ${error.message}`);
      }
    });

    /**
     * POST /api/tmdb/lists/:list_id/items
     * Get items from a TMDB list
     */
    this.router.post('/lists/:list_id/items', this._requireAuth, async (req, res) => {
      try {
        const { list_id } = req.params;
        const { api_key } = req.body;

        if (!api_key) {
          return this.returnErrorResponse(res, 400, 'API key is required');
        }

        const result = await this._tmdbManager.getListItems(api_key, list_id);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get TMDB list items', `Get TMDB list items error: ${error.message}`);
      }
    });

    /**
     * GET /api/tmdb/stream/movies/:tmdb_id
     * Get TMDB movie stream
     */
    this.router.get('/stream/movies/:tmdb_id', this._requireAuth, async (req, res) => {
      try {
        const { tmdb_id } = req.params;
        const result = await this._tmdbManager.getMovieStream(tmdb_id);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get TMDB movie stream', `Get TMDB movie stream error: ${error.message}`);
      }
    });
  }
}

export default TMDBRouter;
