import express from 'express';
import { titlesService } from '../services/titles.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/titles
 * Get paginated list of titles with filtering
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const {
      page = 1,
      per_page = 50,
      search = '',
      year = '',
      watchlist,
      media_type,
      starts_with = '',
    } = req.query;

    const result = await titlesService.getTitles({
      user: req.user,
      page: parseInt(page, 10),
      perPage: parseInt(per_page, 10),
      searchQuery: search,
      yearFilter: year,
      watchlist: watchlist === 'true' ? true : watchlist === 'false' ? false : null,
      mediaType: media_type,
      startsWith: starts_with,
    });

    return res.status(result.statusCode).json(result.response);
  } catch (error) {
    console.error('Get titles error:', error);
    return res.status(500).json({ error: 'Failed to get titles' });
  }
});

/**
 * GET /api/titles/:title_key
 * Get detailed information for a specific title
 */
router.get('/:title_key', requireAuth, async (req, res) => {
  try {
    const { title_key } = req.params;
    const result = await titlesService.getTitleDetails(title_key, req.user);
    return res.status(result.statusCode).json(result.response);
  } catch (error) {
    console.error('Get title details error:', error);
    return res.status(500).json({ error: 'Failed to get title details' });
  }
});

/**
 * PUT /api/titles/:title_key/watchlist
 * Update watchlist status for a single title
 */
router.put('/:title_key/watchlist', requireAuth, async (req, res) => {
  try {
    const { title_key } = req.params;
    const { watchlist } = req.body;

    if (typeof watchlist !== 'boolean') {
      return res.status(400).json({ error: 'watchlist must be a boolean' });
    }

    const result = await titlesService.updateWatchlist(req.user, title_key, watchlist);
    return res.status(result.statusCode).json(result.response);
  } catch (error) {
    console.error('Update watchlist error:', error);
    return res.status(500).json({ error: 'Failed to update watchlist' });
  }
});

/**
 * PUT /api/titles/watchlist/bulk
 * Update watchlist status for multiple titles
 */
router.put('/watchlist/bulk', requireAuth, async (req, res) => {
  try {
    const { titles } = req.body;

    if (!Array.isArray(titles)) {
      return res.status(400).json({ error: 'titles must be an array' });
    }

    // Validate each title object
    for (const title of titles) {
      if (!title.key || typeof title.watchlist !== 'boolean') {
        return res.status(400).json({ 
          error: 'Each title must have "key" (string) and "watchlist" (boolean) fields' 
        });
      }
    }

    const result = await titlesService.updateWatchlistBulk(req.user, titles);
    return res.status(result.statusCode).json(result.response);
  } catch (error) {
    console.error('Bulk update watchlist error:', error);
    return res.status(500).json({ error: 'Failed to update watchlist' });
  }
});

export default router;

