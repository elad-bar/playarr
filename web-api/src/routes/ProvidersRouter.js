import BaseRouter from './BaseRouter.js';

/**
 * Providers router for handling IPTV provider endpoints
 */
class ProvidersRouter extends BaseRouter {
  /**
   * @param {ProvidersManager} providersManager - Providers manager instance
   * @param {import('../middleware/Middleware.js').default} middleware - Middleware instance
   */
  constructor(providersManager, middleware) {
    super(middleware, 'ProvidersRouter');
    this._providersManager = providersManager;
    // In-memory cache for categories: Map<`${providerId}:${type}`, { categories: Array, lastUpdated: string }>
    this._categoriesCache = new Map();
  }

  /**
   * Initialize routes for this router
   */
  initialize() {
    /**
     * GET /api/iptv/providers
     * Get all IPTV providers
     */
    this.router.get('/', this.middleware.requireAuth, async (req, res) => {
      try {
        const result = await this._providersManager.getProviders();
        return res.status(200).json(result);
      } catch (error) {
        return this.handleError(res, error, 'Failed to get providers');
      }
    });

    /**
     * POST /api/iptv/providers
     * Create a new IPTV provider (admin only)
     */
    this.router.post('/', this.middleware.requireAdmin, async (req, res) => {
      try {
        const providerData = req.body;

        if (!providerData || Object.keys(providerData).length === 0) {
          return this.returnErrorResponse(res, 400, 'Request body is required');
        }

        const result = await this._providersManager.createProvider(providerData);
        return res.status(201).json(result);
      } catch (error) {
        return this.handleError(res, error, 'Failed to create provider');
      }
    });

    /**
     * GET /api/iptv/providers/priorities
     * Get all provider priorities
     */
    this.router.get('/priorities', this.middleware.requireAuth, async (req, res) => {
      try {
        const result = await this._providersManager.getProviderPriorities();
        return res.status(200).json(result);
      } catch (error) {
        return this.handleError(res, error, 'Failed to get provider priorities');
      }
    });

    /**
     * PUT /api/iptv/providers/priorities
     * Update provider priorities (admin only)
     */
    this.router.put('/priorities', this.middleware.requireAdmin, async (req, res) => {
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
    });

    /**
     * GET /api/iptv/providers/:provider_id
     * Get a specific IPTV provider
     */
    this.router.get('/:provider_id', this.middleware.requireAuth, async (req, res) => {
      try {
        const { provider_id } = req.params;
        const result = await this._providersManager.getProvider(provider_id);
        return res.status(200).json(result);
      } catch (error) {
        return this.handleError(res, error, 'Failed to get provider');
      }
    });

    /**
     * PUT /api/iptv/providers/:provider_id
     * Update an existing IPTV provider (admin only)
     */
    this.router.put('/:provider_id', this.middleware.requireAdmin, async (req, res) => {
      try {
        const { provider_id } = req.params;
        const providerData = req.body;

        if (!providerData || Object.keys(providerData).length === 0) {
          return this.returnErrorResponse(res, 400, 'Request body is required');
        }

        const result = await this._providersManager.updateProvider(provider_id, providerData);
        return res.status(200).json(result);
      } catch (error) {
        return this.handleError(res, error, 'Failed to update provider');
      }
    });

    /**
     * DELETE /api/iptv/providers/:provider_id
     * Delete an IPTV provider (admin only)
     */
    this.router.delete('/:provider_id', this.middleware.requireAdmin, async (req, res) => {
      try {
        const { provider_id } = req.params;
        await this._providersManager.deleteProvider(provider_id);
        
        // 204 No Content should have empty body
        return res.status(204).send();
      } catch (error) {
        return this.handleError(res, error, 'Failed to delete provider');
      }
    });

    /**
     * GET /api/iptv/providers/:provider_id/ignored
     * Get ignored titles for a specific provider
     */
    this.router.get('/:provider_id/ignored', this.middleware.requireAuth, async (req, res) => {
      try {
        const { provider_id } = req.params;
        const result = await this._providersManager.getIgnoredTitles(provider_id);
        return res.status(200).json(result);
      } catch (error) {
        return this.handleError(res, error, 'Failed to get ignored titles');
      }
    });

    /**
     * GET /api/iptv/providers/:provider_id/categories
     * Get categories for a provider
     * - If type query param is provided: Get categories by type (cached, backward compatibility)
     * - If no type query param: Get all categories (movies + tvshows) with enabled status
     */
    this.router.get('/:provider_id/categories', this.middleware.requireAuth, async (req, res) => {
      try {
        const { provider_id } = req.params;
        const { type } = req.query;

        // If type query param is provided, use the old cached route (backward compatibility)
        if (type && ['movies', 'tvshows'].includes(type)) {
          // Check in-memory cache with daily invalidation
          const cacheKey = `${provider_id}:${type}`;
          const today = new Date().toISOString().split('T')[0];
          const cached = this._categoriesCache.get(cacheKey);
          
          let categories;
          if (cached && cached.lastUpdated === today) {
            // Cache hit - use cached categories
            categories = cached.categories;
          } else {
            // Cache miss or expired - fetch from provider API
            categories = await this._providersManager.fetchCategories(provider_id, type);
            
            // Store in cache with today's date
            this._categoriesCache.set(cacheKey, {
              categories,
              lastUpdated: today
            });
          }

          // Get provider config to merge enabled status (always fresh, not cached)
          const provider = await this._providersManager.getProvider(provider_id);
          const enabledCategories = provider.enabled_categories || { movies: [], tvshows: [] };
          const enabledCategoryKeys = new Set(enabledCategories[type] || []);

          // Merge enabled status into categories
          const categoriesWithStatus = categories.map(cat => {
            // Generate category_key (same format as engine)
            const categoryKey = `${type}-${cat.category_id}`;
            return {
              ...cat,
              enabled: enabledCategoryKeys.has(categoryKey)
            };
          });

          return res.status(200).json(categoriesWithStatus);
        }

        // If no type query param, use the new getCategories method (all categories)
        const result = await this._providersManager.getCategories(provider_id);
        return res.status(200).json(result);
      } catch (error) {
        return this.handleError(res, error, 'Failed to get categories');
      }
    });

    /**
     * POST /api/iptv/providers/:provider_id/categories/batch
     * Update enabled categories for a provider (admin only)
     */
    this.router.post('/:provider_id/categories/batch', this.middleware.requireAdmin, async (req, res) => {
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
    });
  }
}

export default ProvidersRouter;
