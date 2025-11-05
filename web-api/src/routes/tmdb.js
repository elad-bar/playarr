import express from 'express';
import { tmdbService } from '../services/tmdb.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';

const router = express.Router();

/**
 * GET /api/tmdb/api-key
 * Get the TMDB API key
 */
router.get('/api-key', requireAuth, async (req, res) => {
  try {
    const result = await tmdbService.getApiKey();
    return res.status(result.statusCode).json(result.response);
  } catch (error) {
    console.error('Get TMDB API key error:', error);
    return res.status(500).json({ error: 'Failed to get TMDB API key' });
  }
});

/**
 * PUT /api/tmdb/api-key
 * Set the TMDB API key (admin only)
 */
router.put('/api-key', requireAdmin, async (req, res) => {
  try {
    const { api_key } = req.body;

    if (!api_key) {
      return res.status(400).json({ error: 'Missing api_key field' });
    }

    const result = await tmdbService.setApiKey(api_key);
    return res.status(result.statusCode).json(result.response);
  } catch (error) {
    console.error('Set TMDB API key error:', error);
    return res.status(500).json({ error: 'Failed to set TMDB API key' });
  }
});

/**
 * DELETE /api/tmdb/api-key
 * Delete the TMDB API key (admin only)
 */
router.delete('/api-key', requireAdmin, async (req, res) => {
  try {
    const result = await tmdbService.deleteApiKey();
    
    // 204 No Content should have empty body
    if (result.statusCode === 204) {
      return res.status(204).send();
    }
    
    return res.status(result.statusCode).json(result.response);
  } catch (error) {
    console.error('Delete TMDB API key error:', error);
    return res.status(500).json({ error: 'Failed to delete TMDB API key' });
  }
});

/**
 * POST /api/tmdb/verify
 * Verify a TMDB API key
 */
router.post('/verify', requireAuth, async (req, res) => {
  try {
    const { api_key } = req.body;

    if (!api_key) {
      return res.status(400).json({ 
        valid: false, 
        message: 'API key is required' 
      });
    }

    const result = await tmdbService.verifyApiKey(api_key);
    return res.status(result.statusCode).json(result.response);
  } catch (error) {
    console.error('Verify TMDB API key error:', error);
    return res.status(500).json({ 
      valid: false, 
      message: `Error verifying API key: ${error.message}` 
    });
  }
});

/**
 * POST /api/tmdb/lists
 * Get TMDB lists for the authenticated user
 */
router.post('/lists', requireAuth, async (req, res) => {
  try {
    const { api_key } = req.body;

    if (!api_key) {
      return res.status(400).json({ error: 'API key is required' });
    }

    const result = await tmdbService.getLists(api_key);
    return res.status(result.statusCode).json(result.response);
  } catch (error) {
    console.error('Get TMDB lists error:', error);
    return res.status(500).json({ error: 'Failed to get TMDB lists' });
  }
});

/**
 * POST /api/tmdb/lists/:list_id/items
 * Get items from a TMDB list
 */
router.post('/lists/:list_id/items', requireAuth, async (req, res) => {
  try {
    const { list_id } = req.params;
    const { api_key } = req.body;

    if (!api_key) {
      return res.status(400).json({ error: 'API key is required' });
    }

    const result = await tmdbService.getListItems(api_key, list_id);
    return res.status(result.statusCode).json(result.response);
  } catch (error) {
    console.error('Get TMDB list items error:', error);
    return res.status(500).json({ error: 'Failed to get TMDB list items' });
  }
});

/**
 * GET /api/tmdb/stream/movies/:tmdb_id
 * Get TMDB movie stream
 */
router.get('/stream/movies/:tmdb_id', requireAuth, async (req, res) => {
  try {
    const { tmdb_id } = req.params;
    const result = await tmdbService.getMovieStream(tmdb_id);
    return res.status(result.statusCode).json(result.response);
  } catch (error) {
    console.error('Get TMDB movie stream error:', error);
    return res.status(500).json({ error: 'Failed to get TMDB movie stream' });
  }
});

export default router;

