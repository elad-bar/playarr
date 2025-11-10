import BaseRouter from './BaseRouter.js';

/**
 * Providers router for handling IPTV provider endpoints
 */
class ProvidersRouter extends BaseRouter {
  /**
   * @param {ProvidersManager} providersManager - Providers manager instance
   * @param {DatabaseService} database - Database service instance
   */
  constructor(providersManager, database) {
    super(database, 'ProvidersRouter');
    this._providersManager = providersManager;
  }

  /**
   * Initialize routes for this router
   */
  initialize() {
    /**
     * GET /api/iptv/providers
     * Get all IPTV providers
     */
    this.router.get('/', this._requireAuth, async (req, res) => {
      try {
        const result = await this._providersManager.getProviders();
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get providers', `Get providers error: ${error.message}`);
      }
    });

    /**
     * POST /api/iptv/providers
     * Create a new IPTV provider (admin only)
     */
    this.router.post('/', this._requireAdmin, async (req, res) => {
      try {
        const providerData = req.body;

        if (!providerData || Object.keys(providerData).length === 0) {
          return this.returnErrorResponse(res, 400, 'Request body is required');
        }

        const result = await this._providersManager.createProvider(providerData);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to create provider', `Create provider error: ${error.message}`);
      }
    });

    /**
     * GET /api/iptv/providers/priorities
     * Get all provider priorities
     */
    this.router.get('/priorities', this._requireAuth, async (req, res) => {
      try {
        const result = await this._providersManager.getProviderPriorities();
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get provider priorities', `Get provider priorities error: ${error.message}`);
      }
    });

    /**
     * PUT /api/iptv/providers/priorities
     * Update provider priorities (admin only)
     */
    this.router.put('/priorities', this._requireAdmin, async (req, res) => {
      try {
        const prioritiesData = req.body;

        if (!prioritiesData || !prioritiesData.providers) {
          return this.returnErrorResponse(res, 400, 'Request body must contain providers array');
        }

        const result = await this._providersManager.updateProviderPriorities(prioritiesData);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to update provider priorities', `Update provider priorities error: ${error.message}`);
      }
    });

    /**
     * GET /api/iptv/providers/:provider_id
     * Get a specific IPTV provider
     */
    this.router.get('/:provider_id', this._requireAuth, async (req, res) => {
      try {
        const { provider_id } = req.params;
        const result = await this._providersManager.getProvider(provider_id);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get provider', `Get provider error: ${error.message}`);
      }
    });

    /**
     * PUT /api/iptv/providers/:provider_id
     * Update an existing IPTV provider (admin only)
     */
    this.router.put('/:provider_id', this._requireAdmin, async (req, res) => {
      try {
        const { provider_id } = req.params;
        const providerData = req.body;

        if (!providerData || Object.keys(providerData).length === 0) {
          return this.returnErrorResponse(res, 400, 'Request body is required');
        }

        const result = await this._providersManager.updateProvider(provider_id, providerData);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to update provider', `Update provider error: ${error.message}`);
      }
    });

    /**
     * DELETE /api/iptv/providers/:provider_id
     * Delete an IPTV provider (admin only)
     */
    this.router.delete('/:provider_id', this._requireAdmin, async (req, res) => {
      try {
        const { provider_id } = req.params;
        const result = await this._providersManager.deleteProvider(provider_id);
        
        // 204 No Content should have empty body
        if (result.statusCode === 204) {
          return res.status(204).send();
        }
        
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to delete provider', `Delete provider error: ${error.message}`);
      }
    });

    /**
     * GET /api/iptv/providers/:provider_id/ignored
     * Get ignored titles for a specific provider
     */
    this.router.get('/:provider_id/ignored', this._requireAuth, async (req, res) => {
      try {
        const { provider_id } = req.params;
        const result = await this._providersManager.getIgnoredTitles(provider_id);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get ignored titles', `Get ignored titles error: ${error.message}`);
      }
    });
  }
}

export default ProvidersRouter;
