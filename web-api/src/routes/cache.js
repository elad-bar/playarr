import express from 'express';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('CacheRouter');

/**
 * Cache router for handling cache refresh endpoints
 */
class CacheRouter {
  /**
   * @param {CacheService} cacheService - Cache service instance
   * @param {TitlesManager} titlesManager - Titles manager instance
   * @param {StatsManager} statsManager - Stats manager instance
   * @param {CategoriesManager} categoriesManager - Categories manager instance
   * @param {MongoDatabaseService} database - Database service instance
   */
  constructor(cacheService, titlesManager, statsManager, categoriesManager, database) {
    this._cacheService = cacheService;
    this._titlesManager = titlesManager;
    this._statsManager = statsManager;
    this._categoriesManager = categoriesManager;
    this._database = database;
    this.router = express.Router();
    this._setupRoutes();
  }

  /**
   * Setup all routes for this router
   * @private
   */
  _setupRoutes() {
    /**
     * POST /api/cache/refresh/:key
     * Refresh cache for a specific collection
     * Supports:
     * - Main collections: titles, stats, categories, users, settings, iptv-providers
     * - Provider collections: {providerId}.titles, {providerId}.categories
     * 
     * Special handling for 'titles':
     * - Refreshes regular titles cache
     * - Also refreshes API titles cache (with provider URLs)
     * 
     * Examples:
     * - POST /api/cache/refresh/titles
     * - POST /api/cache/refresh/my-provider.titles
     * - POST /api/cache/refresh/my-provider.categories
     */
    this.router.post('/refresh/:key', async (req, res) => {
      try {
        const { key } = req.params;
        
        if (!key) {
          return res.status(400).json({ error: 'Collection key is required' });
        }

        // Invalidate cache for the collection
        this._database.invalidateCollectionCache(key);

        // Special handling for titles: also refresh API titles cache
        if (key === 'titles') {
          await this._refreshAPITitlesCache();
        }

        return res.status(200).json({ 
          success: true, 
          message: `Cache refreshed for collection: ${key}` 
        });
      } catch (error) {
        logger.error(`Refresh cache error for ${req.params.key}:`, error);
        return res.status(500).json({ 
          error: `Failed to refresh cache for collection: ${req.params.key}` 
        });
      }
    });
  }

  /**
   * Refresh API titles cache (with provider URLs)
   * Called when titles collection is refreshed
   * @private
   */
  async _refreshAPITitlesCache() {
    try {
      const apiTitles = await this._titlesManager.getTitlesForAPI();
      this._cacheService.set('titles-api', apiTitles);
      logger.info(`Refreshed API titles cache: ${apiTitles.size} titles`);
      
      // Also load streams cache
      const streamsData = await this._database.getDataObject('titles-streams') || {};
      this._cacheService.set('titles-streams-api', streamsData);
      logger.info(`Refreshed API streams cache: ${Object.keys(streamsData).length} streams`);
    } catch (error) {
      logger.error('Error refreshing API titles cache:', error);
      throw error;
    }
  }

  /**
   * Initialize API titles cache
   * Called on startup after all services are initialized
   */
  async initializeAPITitlesCache() {
    try {
      await this._refreshAPITitlesCache();
      logger.info('API titles cache initialized');
    } catch (error) {
      logger.error('Error initializing API titles cache:', error);
      // Don't throw - allow startup to continue
    }
  }
}

export default CacheRouter;
