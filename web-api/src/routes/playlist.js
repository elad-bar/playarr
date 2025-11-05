import express from 'express';
import { playlistService } from '../services/playlist.js';
import { requireApiKey } from '../middleware/apiKey.js';

const router = express.Router();

/**
 * Get the base URL from the request, respecting X-Forwarded-* headers
 * Matches Python's _get_base_url()
 */
function getBaseUrl(req) {
  // Check X-Forwarded-Proto header (set by reverse proxies like nginx)
  const scheme = req.headers['x-forwarded-proto'] || (req.protocol || 'http');

  // Check X-Forwarded-Host header (preferred over Host when behind proxy)
  let host = req.headers['x-forwarded-host'] || req.get('host');

  // Remove port from host if X-Forwarded-Port is provided separately
  const forwardedPort = req.headers['x-forwarded-port'];
  if (forwardedPort) {
    // Remove any port that might be in the host
    if (host.includes(':')) {
      host = host.split(':')[0];
    }
    // Add the forwarded port if it's not default (443 for https, 80 for http)
    if (forwardedPort !== '443' && forwardedPort !== '80') {
      host = `${host}:${forwardedPort}`;
    }
  } else {
    // If no X-Forwarded-Port, check if host includes port
    // For default ports with https, we might want to remove :443
    if (scheme === 'https' && host.endsWith(':443')) {
      host = host.slice(0, -4);
    } else if (scheme === 'http' && host.endsWith(':80')) {
      host = host.slice(0, -3);
    }
  }

  const baseUrl = `${scheme}://${host}`.replace(/\/$/, '');
  return baseUrl;
}

/**
 * GET /api/playlist/:title_type
 * Get M3U8 playlist for movies or tvshows (requires API key)
 */
router.get('/:title_type', requireApiKey, async (req, res) => {
  try {
    const { title_type } = req.params;

    if (!['movies', 'tvshows'].includes(title_type)) {
      return res.status(400).json({ error: "Invalid title type. Must be 'movies' or 'tvshows'" });
    }

    const baseUrl = getBaseUrl(req);
    const user = req.user; // Set by requireApiKey middleware

    const m3uContent = await playlistService.getM3u8Streams(baseUrl, title_type, user);

    res.setHeader('Content-Type', 'text/plain');
    return res.send(m3uContent);
  } catch (error) {
    console.error('Get M3U8 playlist error:', error);
    return res.status(500).json({ error: 'Failed to get playlist' });
  }
});

/**
 * GET /api/playlist/:title_type/data
 * Get media files mapping for movies or tvshows (requires API key)
 */
router.get('/:title_type/data', requireApiKey, async (req, res) => {
  try {
    const { title_type } = req.params;

    if (!['movies', 'tvshows'].includes(title_type)) {
      return res.status(400).json({ error: "Invalid title type. Must be 'movies' or 'tvshows'" });
    }

    const baseUrl = getBaseUrl(req);
    const user = req.user; // Set by requireApiKey middleware

    const mediaFiles = await playlistService.getMediaFilesMapping(baseUrl, title_type, user);

    return res.status(200).json(mediaFiles);
  } catch (error) {
    console.error('Get media files mapping error:', error);
    return res.status(500).json({ error: 'Failed to get media files mapping' });
  }
});

export default router;

