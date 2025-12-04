import BaseRouter from './BaseRouter.js';

/**
 * Stremio addon router
 * Implements Stremio addon protocol endpoints
 */
class StremioRouter extends BaseRouter {
  /**
   * @param {import('../managers/stremio.js').StremioManager} stremioManager - Stremio manager instance
   * @param {import('../middleware/Middleware.js').default} middleware - Middleware instance
   */
  constructor(stremioManager, middleware) {
    super(middleware, 'StremioRouter');
    this._stremioManager = stremioManager;
  }

  /**
   * Initialize routes for this router
   */
  initialize() {
    /**
     * OPTIONS handler for CORS preflight (must be before other routes)
     */
    this.router.options('*', (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Max-Age', '86400');
      res.status(200).send();
    });

    /**
     * GET /stremio/:api_key/manifest.json
     * Stremio addon manifest endpoint
     */
    this.router.get('/:api_key/manifest.json', this.middleware.requireApiKey, async (req, res) => {
      try {
        // Verify API key matches the one in URL
        if (req.params.api_key !== req.user.api_key) {
          return this.returnErrorResponse(res, 401, 'Invalid API key');
        }

        // Build base URL for this addon instance
        const baseUrl = this._getBaseUrl(req);
        
        // Pass user to personalize the addon name
        const manifest = await this._stremioManager.getManifest(baseUrl, req.user);
        
        // Set CORS headers for Stremio
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        
        return res.status(200).json(manifest);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get manifest', `Get manifest error: ${error.message}`);
      }
    });

    /**
     * GET /stremio/:api_key/catalog/:type/:id.json
     * Stremio catalog endpoint
     */
    this.router.get('/:api_key/catalog/:type/:id.json', this.middleware.requireApiKey, async (req, res) => {
      try {
        // Verify API key
        if (req.params.api_key !== req.user.api_key) {
          return this.returnErrorResponse(res, 401, 'Invalid API key');
        }

        const { type, id } = req.params;
        
        // Validate type
        if (type !== 'movie' && type !== 'series' && type !== 'tv') {
          return this.returnErrorResponse(res, 400, 'Invalid catalog type. Must be "movie", "series", or "tv"');
        }

        // Get catalog
        const catalog = await this._stremioManager.getCatalog(type, req.user, {
          page: parseInt(req.query.page) || 1,
          perPage: parseInt(req.query.perPage) || 100
        });

        // Set CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        
        return res.status(200).json(catalog);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get catalog', `Get catalog error: ${error.message}`);
      }
    });

    /**
     * GET /stremio/:api_key/meta/:type/:id.json
     * Stremio metadata endpoint
     * Note: Using * for id to handle special characters in channel IDs
     */
    this.router.get('/:api_key/meta/:type/*', this.middleware.requireApiKey, async (req, res) => {
      try {
        // Verify API key
        if (req.params.api_key !== req.user.api_key) {
          return this.returnErrorResponse(res, 401, 'Invalid API key');
        }

        const { type } = req.params;
        
        // Validate type
        if (type !== 'movie' && type !== 'series' && type !== 'tv') {
          return this.returnErrorResponse(res, 400, 'Invalid meta type. Must be "movie", "series", or "tv"');
        }

        // Extract ID from the wildcard parameter (remove .json extension if present)
        let id = req.params[0] || '';
        if (id.endsWith('.json')) {
          id = id.slice(0, -5);
        }

        // Get meta
        const meta = await this._stremioManager.getMeta(type, id, req.user);

        // Set CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        
        return res.status(200).json(meta);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get meta', `Get meta error: ${error.message}`);
      }
    });

    /**
     * GET /stremio/:api_key/stream/:type/:id.json
     * Stremio stream endpoint
     * Note: Using * for id to handle special characters in channel IDs
     */
    this.router.get('/:api_key/stream/:type/*', this.middleware.requireApiKey, async (req, res) => {
      try {
        // Verify API key
        if (req.params.api_key !== req.user.api_key) {
          return this.returnErrorResponse(res, 401, 'Invalid API key');
        }

        const { type } = req.params;
        
        // Validate type
        if (type !== 'movie' && type !== 'series' && type !== 'tv') {
          return this.returnErrorResponse(res, 400, 'Invalid stream type. Must be "movie", "series", or "tv"');
        }

        // Extract ID from the wildcard parameter (remove .json extension if present)
        let id = req.params[0] || '';
        if (id.endsWith('.json')) {
          id = id.slice(0, -5);
        }

        // Parse season/episode from query params (for series)
        const season = req.query.season ? parseInt(req.query.season, 10) : null;
        const episode = req.query.episode ? parseInt(req.query.episode, 10) : null;

        // Get base URL
        const baseUrl = this._getBaseUrl(req);

        // Get streams
        const streams = await this._stremioManager.getStreams(type, id, req.user, season, episode, baseUrl);

        // Set CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        
        return res.status(200).json(streams);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get streams', `Get streams error: ${error.message}`);
      }
    });
  }

  /**
   * Get base URL for the addon
   * @private
   * @param {import('express').Request} req - Express request object
   * @returns {string} Base URL
   */
  _getBaseUrl(req) {
    const protocol = req.protocol || 'http';
    const host = req.get('host');
    const apiKey = req.params.api_key || req.user?.api_key;
    return `${protocol}://${host}/stremio/${apiKey}`;
  }
}

export default StremioRouter;

