import express from 'express';
import { settingsService } from '../services/settings.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// TMDB token key constant matching Python
const TMDB_TOKEN_KEY = 'tmdb_token';

/**
 * GET /api/settings/tmdb_token
 * Get TMDB token setting
 */
router.get('/tmdb_token', requireAuth, async (req, res) => {
  try {
    const result = await settingsService.getSetting(TMDB_TOKEN_KEY);
    return res.status(result.statusCode).json(result.response);
  } catch (error) {
    console.error('Get TMDB token error:', error);
    return res.status(500).json({ error: 'Failed to get TMDB token' });
  }
});

/**
 * POST /api/settings/tmdb_token
 * Set TMDB token setting
 */
router.post('/tmdb_token', requireAuth, async (req, res) => {
  try {
    const { value } = req.body;

    if (value === undefined) {
      return res.status(400).json({ error: 'value is required' });
    }

    const result = await settingsService.setSetting(TMDB_TOKEN_KEY, value);
    return res.status(result.statusCode).json(result.response);
  } catch (error) {
    console.error('Set TMDB token error:', error);
    return res.status(500).json({ error: 'Failed to set TMDB token' });
  }
});

/**
 * DELETE /api/settings/tmdb_token
 * Delete TMDB token setting
 */
router.delete('/tmdb_token', requireAuth, async (req, res) => {
  try {
    const result = await settingsService.deleteSetting(TMDB_TOKEN_KEY);
    return res.status(result.statusCode).json(result.response);
  } catch (error) {
    console.error('Delete TMDB token error:', error);
    return res.status(500).json({ error: 'Failed to delete TMDB token' });
  }
});

export default router;

