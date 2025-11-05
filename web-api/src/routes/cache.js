import express from 'express';

/**
 * Cache router for handling cache refresh endpoints
 */
class CacheRouter {
  /**
   * @param {CacheService} cacheService - Cache service instance
   * @param {FileStorageService} fileStorage - File storage service instance
   * @param {TitlesManager} titlesManager - Titles manager instance
   * @param {StatsManager} statsManager - Stats manager instance
   * @param {CategoriesManager} categoriesManager - Categories manager instance
   */
  constructor(cacheService, fileStorage, titlesManager, statsManager, categoriesManager) {
    this._cacheService = cacheService;
    this._fileStorage = fileStorage;
    this._titlesManager = titlesManager;
    this._statsManager = statsManager;
    this._categoriesManager = categoriesManager;
    this.router = express.Router();
    this._setupRoutes();
  }

  /**
   * Setup all routes for this router
   * @private
   */
  _setupRoutes() {
    /**
     * POST /api/cache/refresh/titles
     * Refresh titles cache (internal endpoint, called by Python engine)
     * Invalidates cache via CacheService - FileStorageService will automatically re-cache on next read
     */
    this.router.post('/refresh/titles', async (req, res) => {
      try {
        // Invalidate cache for titles file directly via CacheService
        // When FileStorageService reads this file next time:
        // - Cache will be empty (cache miss)
        // - FileStorageService reads from disk
        // - FileStorageService automatically re-caches the fresh data
        const titlesFilePath = this._fileStorage.getCollectionPath('titles');
        this._cacheService.delete(titlesFilePath);

        // Refresh titles in titles manager (clears Map transformation cache)
        await this._titlesManager.refreshCache();

        return res.status(200).json({ success: true, message: 'Titles cache refreshed' });
      } catch (error) {
        console.error('Refresh titles cache error:', error);
        return res.status(500).json({ error: 'Failed to refresh titles cache' });
      }
    });

    /**
     * POST /api/cache/refresh/categories?provider={name}
     * Refresh categories cache for a specific provider (internal endpoint, called by Python engine)
     */
    this.router.post('/refresh/categories', async (req, res) => {
      try {
        const { provider } = req.query;

        if (!provider) {
          return res.status(400).json({ error: 'Provider parameter is required' });
        }

        // Categories cache is handled by database service automatically
        // File cache invalidation happens when files are written

        return res.status(200).json({
          success: true,
          message: `Categories cache refreshed for provider: ${provider}`,
        });
      } catch (error) {
        console.error('Refresh categories cache error:', error);
        return res.status(500).json({ error: 'Failed to refresh categories cache' });
      }
    });

    /**
     * POST /api/cache/refresh/stats
     * Refresh stats cache (internal endpoint, called by Python engine)
     */
    this.router.post('/refresh/stats', async (req, res) => {
      try {
        // Stats cache is handled by database service automatically
        // File cache invalidation happens when files are written

        return res.status(200).json({ success: true, message: 'Stats cache refreshed' });
      } catch (error) {
        console.error('Refresh stats cache error:', error);
        return res.status(500).json({ error: 'Failed to refresh stats cache' });
      }
    });
  }
}

export default CacheRouter;
