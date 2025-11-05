import express from 'express';
import { userService } from '../services/users.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/profile
 * Get current user's profile
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const username = req.user.username;
    const result = await userService.getProfile(username);
    return res.status(result.statusCode).json(result.response);
  } catch (error) {
    console.error('Get profile error:', error);
    return res.status(500).json({ error: 'Failed to get profile' });
  }
});

/**
 * PUT /api/profile
 * Update current user's profile
 */
router.put('/', requireAuth, async (req, res) => {
  try {
    const username = req.user.username;
    const { first_name, last_name } = req.body;

    const updates = {};
    if (first_name !== undefined) updates.first_name = first_name;
    if (last_name !== undefined) updates.last_name = last_name;

    const result = await userService.updateProfile(username, updates);
    return res.status(result.statusCode).json(result.response);
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
});

/**
 * POST /api/profile/regenerate-api-key
 * Regenerate API key for current user
 */
router.post('/regenerate-api-key', requireAuth, async (req, res) => {
  try {
    const username = req.user.username;
    const result = await userService.regenerateApiKey(username);
    return res.status(result.statusCode).json(result.response);
  } catch (error) {
    console.error('Regenerate API key error:', error);
    return res.status(500).json({ error: 'Failed to regenerate API key' });
  }
});

/**
 * POST /api/profile/change-password
 * Change password for current user (requires current password verification)
 */
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const username = req.user.username;
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    const result = await userService.changePassword(username, current_password, new_password);
    return res.status(result.statusCode).json(result.response);
  } catch (error) {
    console.error('Change password error:', error);
    return res.status(500).json({ error: 'Failed to change password' });
  }
});

export default router;

