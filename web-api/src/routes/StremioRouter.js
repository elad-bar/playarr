import BaseRouter from './BaseRouter.js';

/**
 * Stremio addon router
 * Implements Stremio addon protocol endpoints
 */
class StremioRouter extends BaseRouter {
  /**
   * @param {import('express').Application} app - Express app instance
   * @param {import('../managers/stremio.js').StremioManager} stremioManager - Stremio manager instance
   * @param {import('../middleware/Middleware.js').default} middleware - Middleware instance
   */
  constructor(app, stremioManager, middleware) {
    super(app, middleware, 'StremioRouter');
    this._stremioManager = stremioManager;
  }

  /**
   * Get the base path(s) for this router
   * @returns {string[]} Base path(s) for this router
   */
  getBasePath() {
    return ['/stremio'];
  }

  /**
   * Set up routes for this router
   */
  setupRoutes() {
    /**
     * OPTIONS handler for CORS preflight (must be before other routes)
     */
    this.router.options('*', this._handleOptions.bind(this));

    /**
     * GET /stremio/:api_key/manifest.json
     * Stremio addon manifest endpoint
     */
    this.router.get('/:api_key/manifest.json', this.middleware.requireApiKey, this._handleGetManifest.bind(this));

    /**
     * GET /stremio/:api_key/catalog/:type/:id.json
     * Stremio catalog endpoint
     */
    this.router.get('/:api_key/catalog/:type/:id.json', this.middleware.requireApiKey, this.middleware.validateStremioType, this._handleGetCatalog.bind(this));

    /**
     * GET /stremio/:api_key/meta/:type/*
     * Stremio metadata endpoint
     * Note: Using * for id to handle special characters in channel IDs
     */
    this.router.get('/:api_key/meta/:type/*', this.middleware.requireApiKey, this.middleware.validateStremioType, this._handleGetMeta.bind(this));

    /**
     * GET /stremio/:api_key/stream/:type/:id.json
     * Stremio stream endpoint
     * Note: Using * for id to handle special characters in channel IDs
     */
    this.router.get('/:api_key/stream/:type/*', this.middleware.requireApiKey, this.middleware.validateStremioType, this._handleGetStreams.bind(this));
  }

  /**
   * Handle OPTIONS * request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  _handleOptions(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.status(200).send();
  }

  /**
   * Handle GET /:api_key/manifest.json request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleGetManifest(req, res) {
    try {
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
  }

  /**
   * Handle GET /:api_key/catalog/:type/:id.json request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleGetCatalog(req, res) {
    try {
      const { type, id } = req.params;
      
      // Get catalog (type validation handled by middleware)
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
  }

  /**
   * Handle GET /:api_key/meta/:type/* request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleGetMeta(req, res) {
    try {
      const { type } = req.params;
      
      // Extract ID from the wildcard parameter (remove .json extension if present)
      // Type validation handled by middleware
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
  }

  /**
   * Handle GET /:api_key/stream/:type/* request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleGetStreams(req, res) {
    try {
      const { type } = req.params;
      
      // Extract ID from the wildcard parameter (remove .json extension if present)
      // Type validation handled by middleware
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

