import express from 'express';
import { cacheService } from '../services/cache.js';
import { titlesService } from '../services/titles.js';
import { statsService } from '../services/stats.js';
import { categoriesService } from '../services/categories.js';

const router = express.Router();

/**
 * POST /api/cache/refresh/titles
 * Refresh titles cache (internal endpoint, called by Python engine)
 */
router.post('/refresh/titles', async (req, res) => {
  try {
    // Clear titles cache in cache service
    cacheService.clearTitles();

    // Refresh titles in titles service
    await titlesService.refreshCache();

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
router.post('/refresh/categories', async (req, res) => {
  try {
    const { provider } = req.query;

    if (!provider) {
      return res.status(400).json({ error: 'Provider parameter is required' });
    }

    // Clear categories cache for the provider
    cacheService.clearCategories(provider);

    // The categories will be reloaded from database on next request
    // If needed, we can add a refreshCategories method to categoriesService

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
router.post('/refresh/stats', async (req, res) => {
  try {
    // Clear stats cache in cache service
    cacheService.clearStats();

    // The stats will be reloaded from database on next request
    // The statsService.getStats() will automatically reload if cache is empty

    return res.status(200).json({ success: true, message: 'Stats cache refreshed' });
  } catch (error) {
    console.error('Refresh stats cache error:', error);
    return res.status(500).json({ error: 'Failed to refresh stats cache' });
  }
});

export default router;

