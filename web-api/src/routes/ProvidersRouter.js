import BaseRouter from './BaseRouter.js';
import { XtreamProvider } from '../providers/XtreamProvider.js';
import { AGTVProvider } from '../providers/AGTVProvider.js';

/**
 * Providers router for handling IPTV provider endpoints
 */
class ProvidersRouter extends BaseRouter {
  /**
   * @param {import('express').Application} app - Express app instance
   * @param {ProvidersManager} providersManager - Providers manager instance
   * @param {import('../middleware/Middleware.js').default} middleware - Middleware instance
   * @param {import('../managers/orchestration/MetricsManager.js').default} metricsManager - Metrics manager instance
   * @param {import('../managers/domain/ProviderCategoryManager.js').ProviderCategoryManager} providerCategoryManager - Provider category manager instance
   */
  constructor(app, providersManager, middleware, metricsManager, providerCategoryManager) {
    super(app, middleware, 'ProvidersRouter');
    this._providersManager = providersManager;
    this._metricsManager = metricsManager;
    this._providerCategoryManager = providerCategoryManager;
  }

  /**
   * Get the base path(s) for this router
   * @returns {string[]} Base path(s) for this router
   */
  getBasePath() {
    return ['/api/iptv/providers'];
  }

  /**
   * Set up routes for this router
   */
  setupRoutes() {
    /**
     * GET /api/iptv/providers
     * Get all IPTV providers
     */
    this.router.get('/', this.middleware.requireAuth, this._handleGetProviders.bind(this));

    /**
     * POST /api/iptv/providers
     * Create a new IPTV provider (admin only)
     */
    this.router.post('/', this.middleware.requireAdmin, this._handleCreateProvider.bind(this));

    /**
     * GET /api/iptv/providers/priorities
     * Get all provider priorities
     */
    this.router.get('/priorities', this.middleware.requireAuth, this._handleGetProviderPriorities.bind(this));

    /**
     * PUT /api/iptv/providers/priorities
     * Update provider priorities (admin only)
     */
    this.router.put('/priorities', this.middleware.requireAdmin, this._handleUpdateProviderPriorities.bind(this));

    /**
     * POST /api/iptv/providers/validate
     * Validate IPTV provider credentials without creating a provider
     */
    this.router.post('/validate', this.middleware.requireAuth, this._handleValidateProvider.bind(this));

    /**
     * GET /api/iptv/providers/:provider_id
     * Get a specific IPTV provider
     */
    this.router.get('/:provider_id', this.middleware.requireAuth, this._handleGetProviderById.bind(this));

    /**
     * PUT /api/iptv/providers/:provider_id
     * Update an existing IPTV provider (admin only)
     */
    this.router.put('/:provider_id', this.middleware.requireAdmin, this._handleUpdateProvider.bind(this));

    /**
     * DELETE /api/iptv/providers/:provider_id
     * Delete an IPTV provider (admin only)
     */
    this.router.delete('/:provider_id', this.middleware.requireAdmin, this._handleDeleteProvider.bind(this));

    /**
     * GET /api/iptv/providers/:provider_id/ignored
     * Get ignored titles for a specific provider
     */
    this.router.get('/:provider_id/ignored', this.middleware.requireAuth, this._handleGetIgnoredTitles.bind(this));

    /**
     * GET /api/iptv/providers/:provider_id/counts
     * Get provider counts (movies, tvshows, live) from cached metrics
     */
    this.router.get('/:provider_id/counts', this.middleware.requireAuth, this._handleGetProviderCounts.bind(this));

    /**
     * PUT /api/iptv/providers/:provider_id/enabled
     * Toggle provider enabled state (admin only)
     */
    this.router.put('/:provider_id/enabled', this.middleware.requireAdmin, this._handleUpdateProviderEnabled.bind(this));

    /**
     * PUT /api/iptv/providers/:provider_id/sync-media-types
     * Update sync media types for a provider (admin only)
     */
    this.router.put('/:provider_id/sync-media-types', this.middleware.requireAdmin, this._handleUpdateSyncMediaTypes.bind(this));

    /**
     * GET /api/iptv/providers/:provider_id/categories
     * Get categories for a provider
     */
    this.router.get('/:provider_id/categories', this.middleware.requireAuth, this._handleGetProviderCategories.bind(this));

    /**
     * POST /api/iptv/providers/:provider_id/categories/batch
     * Update enabled categories for a provider (admin only)
     */
    this.router.post('/:provider_id/categories/batch', this.middleware.requireAdmin, this._handleUpdateCategoriesBatch.bind(this));
  }

  /**
   * Handle GET / request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleGetProviders(req, res) {
    try {
      const result = await this._providersManager.getProviders();
      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(res, error, 'Failed to get providers');
    }
  }

  /**
   * Handle POST / request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleCreateProvider(req, res) {
    try {
      const providerData = req.body;

      if (!providerData || Object.keys(providerData).length === 0) {
        return this.returnErrorResponse(res, 400, 'Request body is required');
      }

      const result = await this._providersManager.createProvider(providerData);
      
      // Track provider operation
      this._metricsManager.incrementCounter('provider_operations', {
        operation: 'create',
        username: req.user.username
      });
      
      return res.status(201).json(result);
    } catch (error) {
      return this.handleError(res, error, 'Failed to create provider');
    }
  }

  /**
   * Handle GET /priorities request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleGetProviderPriorities(req, res) {
    try {
      const result = await this._providersManager.getProviderPriorities();
      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(res, error, 'Failed to get provider priorities');
    }
  }

  /**
   * Handle PUT /priorities request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleUpdateProviderPriorities(req, res) {
    try {
      const prioritiesData = req.body;

      if (!prioritiesData || !prioritiesData.providers) {
        return this.returnErrorResponse(res, 400, 'Request body must contain providers array');
      }

      const result = await this._providersManager.updateProviderPriorities(prioritiesData);
      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(res, error, 'Failed to update provider priorities');
    }
  }

  /**
   * Handle POST /validate request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleValidateProvider(req, res) {
    try {
      const { api_url, username, password, type } = req.body;

      // Validate required fields
      if (!api_url || !username || !password || !type) {
        return res.status(200).json({
          success: false,
          valid: false,
          error: 'Missing required fields: api_url, username, password, and type are required'
        });
      }

      // Validate type
      const providerType = type.toLowerCase();
      if (providerType !== 'xtream' && providerType !== 'agtv') {
        return res.status(200).json({
          success: false,
          valid: false,
          error: 'Invalid provider type. Must be "xtream" or "agtv"'
        });
      }

      // Create temporary provider config
      const tempProviderConfig = {
        temp: {
          id: 'temp',
          api_url,
          username,
          password,
          type: providerType,
          enabled: true,
          deleted: false
        }
      };

      // Create temporary provider instance
      let provider;
      if (providerType === 'xtream') {
        provider = new XtreamProvider(tempProviderConfig, null, this._metricsManager);
      } else {
        provider = new AGTVProvider(tempProviderConfig, null, this._metricsManager);
      }

      // Attempt authentication
      const providerDetails = await provider.authenticate('temp');

      return res.status(200).json({
        success: true,
        valid: true,
        provider_details: providerDetails
      });
    } catch (error) {
      // Return error response (200 status with success: false)
      return res.status(200).json({
        success: false,
        valid: false,
        error: error.message || 'Invalid credentials'
      });
    }
  }

  /**
   * Handle GET /:provider_id request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleGetProviderById(req, res) {
    try {
      const { provider_id } = req.params;
      const result = await this._providersManager.getProvider(provider_id);
      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(res, error, 'Failed to get provider');
    }
  }

  /**
   * Handle PUT /:provider_id request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleUpdateProvider(req, res) {
    try {
      const { provider_id } = req.params;
      const providerData = req.body;

      if (!providerData || Object.keys(providerData).length === 0) {
        return this.returnErrorResponse(res, 400, 'Request body is required');
      }

      const result = await this._providersManager.updateProvider(provider_id, providerData);
      
      // Track provider operation
      this._metricsManager.incrementCounter('provider_operations', {
        operation: 'update',
        username: req.user.username
      });
      
      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(res, error, 'Failed to update provider');
    }
  }

  /**
   * Handle DELETE /:provider_id request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleDeleteProvider(req, res) {
    try {
      const { provider_id } = req.params;
      await this._providersManager.deleteProvider(provider_id);
      
      // Track provider operation
      this._metricsManager.incrementCounter('provider_operations', {
        operation: 'delete',
        username: req.user.username
      });
      
      // 204 No Content should have empty body
      return res.status(204).send();
    } catch (error) {
      return this.handleError(res, error, 'Failed to delete provider');
    }
  }

  /**
   * Handle GET /:provider_id/ignored request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleGetIgnoredTitles(req, res) {
    try {
      const { provider_id } = req.params;
      const result = await this._providersManager.getIgnoredTitles(provider_id);
      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(res, error, 'Failed to get ignored titles');
    }
  }

  /**
   * Handle GET /:provider_id/counts request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleGetProviderCounts(req, res) {
    try {
      const { provider_id } = req.params;
      const counts = await this._metricsManager.getProviderCounts(provider_id);
      return res.status(200).json(counts);
    } catch (error) {
      return this.handleError(res, error, 'Failed to get provider counts');
    }
  }

  /**
   * Handle PUT /:provider_id/enabled request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleUpdateProviderEnabled(req, res) {
    try {
      const { provider_id } = req.params;
      const { enabled } = req.body;

      if (typeof enabled !== 'boolean') {
        return this.returnErrorResponse(res, 400, 'enabled must be a boolean');
      }

      const result = await this._providersManager.updateProvider(provider_id, { enabled });
      
      // Track provider operation
      this._metricsManager.incrementCounter('provider_operations', {
        operation: 'update',
        username: req.user.username
      });
      
      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(res, error, 'Failed to update provider enabled state');
    }
  }

  /**
   * Handle PUT /:provider_id/sync-media-types request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleUpdateSyncMediaTypes(req, res) {
    try {
      const { provider_id } = req.params;
      const { sync_media_types } = req.body;

      if (!sync_media_types || typeof sync_media_types !== 'object') {
        return this.returnErrorResponse(res, 400, 'sync_media_types must be an object');
      }

      // Validate sync_media_types structure
      const validKeys = ['movies', 'tvshows', 'live'];
      for (const key of Object.keys(sync_media_types)) {
        if (!validKeys.includes(key)) {
          return this.returnErrorResponse(res, 400, `Invalid key in sync_media_types: ${key}. Valid keys are: ${validKeys.join(', ')}`);
        }
        if (typeof sync_media_types[key] !== 'boolean') {
          return this.returnErrorResponse(res, 400, `sync_media_types.${key} must be a boolean`);
        }
      }

      const result = await this._providersManager.updateProvider(provider_id, { sync_media_types });
      
      // Track provider operation
      this._metricsManager.incrementCounter('provider_operations', {
        operation: 'update',
        username: req.user.username
      });
      
      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(res, error, 'Failed to update sync media types');
    }
  }

  /**
   * Handle GET /:provider_id/categories request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleGetProviderCategories(req, res) {
    try {
      const { provider_id } = req.params;
      const { type } = req.query;

      // If type query param is provided, get categories by type (backward compatibility)
      if (type && ['movies', 'tvshows'].includes(type)) {
        // Query categories from database
        const dbCategories = await this._providerCategoryManager.getCategoriesByProvider(provider_id, type);
        
        // Get provider config to merge enabled status
        const provider = await this._providersManager.getProvider(provider_id);
        const enabledCategories = provider.enabled_categories || { movies: [], tvshows: [] };
        const enabledCategoryKeys = new Set(enabledCategories[type] || []);

        // Transform to API format and merge enabled status
        const categoriesWithStatus = dbCategories.map(cat => ({
          category_id: cat.category_id,
          category_name: cat.category_name,
          enabled: enabledCategoryKeys.has(cat.category_key)
        }));

        return res.status(200).json(categoriesWithStatus);
      }

      // If no type query param, use the new getCategories method (all categories)
      const result = await this._providersManager.getCategories(provider_id);
      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(res, error, 'Failed to get categories');
    }
  }

  /**
   * Handle POST /:provider_id/categories/batch request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleUpdateCategoriesBatch(req, res) {
    try {
      const { provider_id } = req.params;
      const { enabled_categories } = req.body;

      if (!enabled_categories) {
        return this.returnErrorResponse(res, 400, 'enabled_categories is required in request body');
      }

      const result = await this._providersManager.updateEnabledCategories(provider_id, enabled_categories);
      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(res, error, 'Failed to update categories');
    }
  }
}

export default ProvidersRouter;
