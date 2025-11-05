import express from 'express';
import { categoriesService } from '../services/categories.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';

const router = express.Router();

/**
 * GET /api/iptv/providers/:provider_id/categories
 * Get categories for a specific IPTV provider
 */
router.get('/providers/:provider_id/categories', requireAuth, async (req, res) => {
  try {
    const { provider_id } = req.params;
    const result = await categoriesService.getCategories(provider_id);
    return res.status(result.statusCode).json(result.response);
  } catch (error) {
    console.error('Get provider categories error:', error);
    return res.status(500).json({ error: 'Failed to get categories' });
  }
});

/**
 * PUT /api/iptv/providers/:provider_id/categories/:category_key
 * Update a specific category for an IPTV provider (admin only)
 */
router.put('/providers/:provider_id/categories/:category_key', requireAdmin, async (req, res) => {
  try {
    const { provider_id, category_key } = req.params;
    const categoryData = req.body;

    if (!categoryData || Object.keys(categoryData).length === 0) {
      return res.status(400).json({ error: 'Request body is required' });
    }

    const result = await categoriesService.updateCategory(provider_id, category_key, categoryData);
    return res.status(result.statusCode).json(result.response);
  } catch (error) {
    console.error('Update provider category error:', error);
    return res.status(500).json({ error: 'Failed to update category' });
  }
});

export default router;

