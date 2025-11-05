import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';

/**
 * Providers router for handling IPTV provider endpoints
 */
class ProvidersRouter {
  /**
   * @param {ProvidersManager} providersManager - Providers manager instance
   */
  constructor(providersManager) {
    this._providersManager = providersManager;
    this.router = express.Router();
    this._setupRoutes();
  }

  /**
   * Setup all routes for this router
   * @private
   */
  _setupRoutes() {
    /**
     * GET /api/iptv/providers
     * Get all IPTV providers
     */
    this.router.get('/', requireAuth, async (req, res) => {
      try {
        const result = await this._providersManager.getProviders();
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        console.error('Get providers error:', error);
        return res.status(500).json({ error: 'Failed to get providers' });
      }
    });

    /**
     * POST /api/iptv/providers
     * Create a new IPTV provider (admin only)
     */
    this.router.post('/', requireAdmin, async (req, res) => {
      try {
        const providerData = req.body;

        if (!providerData || Object.keys(providerData).length === 0) {
          return res.status(400).json({ error: 'Request body is required' });
        }

        const result = await this._providersManager.createProvider(providerData);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        console.error('Create provider error:', error);
        return res.status(500).json({ error: 'Failed to create provider' });
      }
    });

    /**
     * GET /api/iptv/providers/priorities
     * Get all provider priorities
     */
    this.router.get('/priorities', requireAuth, async (req, res) => {
      try {
        const result = await this._providersManager.getProviderPriorities();
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        console.error('Get provider priorities error:', error);
        return res.status(500).json({ error: 'Failed to get provider priorities' });
      }
    });

    /**
     * PUT /api/iptv/providers/priorities
     * Update provider priorities (admin only)
     */
    this.router.put('/priorities', requireAdmin, async (req, res) => {
      try {
        const prioritiesData = req.body;

        if (!prioritiesData || !prioritiesData.providers) {
          return res.status(400).json({ error: 'Request body must contain providers array' });
        }

        const result = await this._providersManager.updateProviderPriorities(prioritiesData);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        console.error('Update provider priorities error:', error);
        return res.status(500).json({ error: 'Failed to update provider priorities' });
      }
    });

    /**
     * GET /api/iptv/providers/:provider_id
     * Get a specific IPTV provider
     */
    this.router.get('/:provider_id', requireAuth, async (req, res) => {
      try {
        const { provider_id } = req.params;
        const result = await this._providersManager.getProvider(provider_id);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        console.error('Get provider error:', error);
        return res.status(500).json({ error: 'Failed to get provider' });
      }
    });

    /**
     * PUT /api/iptv/providers/:provider_id
     * Update an existing IPTV provider (admin only)
     */
    this.router.put('/:provider_id', requireAdmin, async (req, res) => {
      try {
        const { provider_id } = req.params;
        const providerData = req.body;

        if (!providerData || Object.keys(providerData).length === 0) {
          return res.status(400).json({ error: 'Request body is required' });
        }

        const result = await this._providersManager.updateProvider(provider_id, providerData);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        console.error('Update provider error:', error);
        return res.status(500).json({ error: 'Failed to update provider' });
      }
    });

    /**
     * DELETE /api/iptv/providers/:provider_id
     * Delete an IPTV provider (admin only)
     */
    this.router.delete('/:provider_id', requireAdmin, async (req, res) => {
      try {
        const { provider_id } = req.params;
        const result = await this._providersManager.deleteProvider(provider_id);
        
        // 204 No Content should have empty body
        if (result.statusCode === 204) {
          return res.status(204).send();
        }
        
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        console.error('Delete provider error:', error);
        return res.status(500).json({ error: 'Failed to delete provider' });
      }
    });
  }
}

export default ProvidersRouter;
