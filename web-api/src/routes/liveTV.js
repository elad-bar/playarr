import BaseRouter from './BaseRouter.js';

/**
 * Get the base URL from the request, respecting X-Forwarded-* headers
 */
function getBaseUrl(req) {
  const scheme = req.headers['x-forwarded-proto'] || (req.protocol || 'http');
  let host = req.headers['x-forwarded-host'] || req.get('host');
  const forwardedPort = req.headers['x-forwarded-port'];
  
  if (forwardedPort) {
    if (host.includes(':')) {
      host = host.split(':')[0];
    }
    if (forwardedPort !== '443' && forwardedPort !== '80') {
      host = `${host}:${forwardedPort}`;
    }
  } else {
    if (scheme === 'https' && host.endsWith(':443')) {
      host = host.slice(0, -4);
    } else if (scheme === 'http' && host.endsWith(':80')) {
      host = host.slice(0, -3);
    }
  }

  return `${scheme}://${host}`.replace(/\/$/, '');
}

/**
 * Live TV router for handling Live TV endpoints
 */
class LiveTVRouter extends BaseRouter {
  /**
   * @param {import('../managers/liveTV.js').LiveTVManager} liveTVManager - Live TV manager instance
   * @param {import('../middleware/Middleware.js').default} middleware - Middleware instance
   */
  constructor(liveTVManager, middleware) {
    super(middleware, 'LiveTVRouter');
    this._liveTVManager = liveTVManager;
  }

  /**
   * Initialize routes for this router
   */
  initialize() {
    /**
     * GET /api/livetv/channels
     * Get user's Live TV channels (with current program if EPG available)
     */
    this.router.get('/channels', this.middleware.requireAuth, async (req, res) => {
      try {
        const user = req.user;
        const channels = await this._liveTVManager.getUserChannels(user.username);
        return res.status(200).json(channels);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get channels', error.message);
      }
    });

    /**
     * GET /api/livetv/channels/:channelId/programs
     * Get programs for a channel
     */
    this.router.get('/channels/:channelId/programs', this.middleware.requireApiKey, async (req, res) => {
      try {
        const user = req.user;
        const { channelId } = req.params;
        const programs = await this._liveTVManager.getChannelPrograms(user.username, decodeURIComponent(channelId));
        return res.status(200).json(programs);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get programs', error.message);
      }
    });

    /**
     * GET /api/livetv/m3u
     * Get M3U playlist for user
     */
    this.router.get('/m3u', this.middleware.requireApiKey, async (req, res) => {
      try {
        const user = req.user;
        const baseUrl = getBaseUrl(req);
        const m3uContent = await this._liveTVManager.getM3UPlaylist(user.username, baseUrl);
        // Replace {API_KEY} placeholder with actual API key
        const finalContent = m3uContent.replace(/{API_KEY}/g, user.api_key);
        res.setHeader('Content-Type', 'text/plain');
        return res.send(finalContent);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get M3U playlist', error.message);
      }
    });

    /**
     * GET /api/livetv/epg
     * Get EPG XML for user
     */
    this.router.get('/epg', this.middleware.requireApiKey, async (req, res) => {
      try {
        const user = req.user;
        const epgPath = await this._liveTVManager.getEPGPath(user.username);
        if (!epgPath) {
          return this.returnErrorResponse(res, 404, 'EPG not available');
        }
        res.setHeader('Content-Type', 'application/xml');
        return res.sendFile(epgPath);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get EPG', error.message);
      }
    });

    /**
     * GET /api/livetv/stream/:channelId
     * Stream redirect for channel
     */
    this.router.get('/stream/:channelId', this.middleware.requireApiKey, async (req, res) => {
      try {
        const user = req.user;
        const { channelId } = req.params;
        const decodedChannelId = decodeURIComponent(channelId);
        
        const channel = await this._liveTVManager.getChannel(user.username, decodedChannelId);
        if (!channel) {
          return this.returnErrorResponse(res, 404, 'Channel not found');
        }

        // Add CORS headers for streaming support
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');

        return res.redirect(channel.url);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get stream', error.message);
      }
    });

    /**
     * OPTIONS handler for CORS preflight
     */
    this.router.options('*', (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.status(200).send();
    });
  }
}

export default LiveTVRouter;

