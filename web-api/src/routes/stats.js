import express from 'express';
import { statsService } from '../services/stats.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/stats
 * Get all statistics grouped by provider
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await statsService.getStats();
    return res.status(result.statusCode).json(result.response);
  } catch (error) {
    console.error('Get stats error:', error);
    return res.status(500).json({ error: 'Failed to get statistics' });
  }
});

export default router;

