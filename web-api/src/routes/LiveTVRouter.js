import BaseRouter from './BaseRouter.js';
import { formatNumber } from '../utils/numberFormat.js';

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
   * @param {import('../managers/domain/ChannelManager.js').ChannelManager} channelManager - Channel manager instance
   * @param {import('../managers/domain/ProgramManager.js').ProgramManager} programManager - Program manager instance
   * @param {import('../managers/formatting/LiveTVFormattingManager.js').LiveTVFormattingManager} liveTVFormattingManager - Live TV formatting manager instance
   * @param {import('../managers/domain/UserManager.js').UserManager} userManager - User manager instance (for watchlist operations)
   * @param {import('../managers/domain/IPTVProviderManager.js').IPTVProviderManager} iptvProviderManager - IPTV Provider manager instance (for getting enabled provider IDs)
   * @param {import('../middleware/Middleware.js').default} middleware - Middleware instance
   * @param {import('../services/metrics.js').default} metricsService - Metrics service instance
   */
  constructor(channelManager, programManager, liveTVFormattingManager, userManager, iptvProviderManager, middleware, metricsService) {
    super(middleware, 'LiveTVRouter');
    this._channelManager = channelManager;
    this._programManager = programManager;
    this._liveTVFormattingManager = liveTVFormattingManager;
    this._userManager = userManager;
    this._iptvProviderManager = iptvProviderManager;
    this._metricsService = metricsService;
  }

  /**
   * Initialize routes for this router
   */
  initialize() {
    /**
     * GET /api/livetv/categories
     * Get all unique categories from all channels (across all enabled providers)
     */
    this.router.get('/categories', this.middleware.requireAuth, async (req, res) => {
      try {
        // Get enabled provider IDs
        const enabledProviderIds = await this._iptvProviderManager.getEnabledProviderIds();
        
        if (!enabledProviderIds || enabledProviderIds.length === 0) {
          this.logger.warn('No enabled providers found, returning empty categories');
          return res.status(200).json({ categories: [] });
        }
        
        // Get all unique group_title values from channels
        const categories = await this._channelManager.getUniqueCategories(enabledProviderIds);
        
        this.logger.debug(`Found ${formatNumber(categories.length)} unique categories from ${formatNumber(enabledProviderIds.length)} enabled providers`);
        
        return res.status(200).json({ categories });
      } catch (error) {
        this.logger.error(`Error fetching categories: ${error.message}`, error);
        return this.returnErrorResponse(res, 500, 'Failed to get categories', error.message);
      }
    });

    /**
     * GET /api/livetv/channels
     * Get Live TV channels from all active providers
     * Query params: watchlist (true/false, default: true), providerId, search, category (can be multiple), page, per_page
     */
    this.router.get('/channels', this.middleware.requireAuth, async (req, res) => {
      try {
        const user = req.user;
        const { watchlist, providerId, search, category, page = 1, per_page = 50 } = req.query;
        
        // Parse watchlist param (default: undefined to show all channels)
        const watchlistFilter = watchlist !== undefined ? watchlist === 'true' : undefined;
        
        // Parse category param (can be single value or array)
        let categoryArray = undefined;
        if (category) {
          categoryArray = Array.isArray(category) ? category : [category];
        }
        
        // Get enabled provider IDs
        const enabledProviderIds = await this._iptvProviderManager.getEnabledProviderIds();
        
        // Get user data for watchlist filtering
        const userData = await this._userManager.getUserByUsername(user.username);
        const userWatchlist = userData?.watchlist || { movies: [], tvshows: [], live: [] };
        
        // Get channels with filtering and pagination
        const options = {
          userId: user.username,
          watchlistFilter: watchlistFilter,
          providerId: providerId || undefined,
          search: search || undefined,
          category: categoryArray,
          watchlist: userWatchlist,
          page: parseInt(page, 10),
          perPage: parseInt(per_page, 10),
          enabledProviderIds
        };
        
        const result = await this._channelManager.getAllChannels(options);
        const channels = result.items;
        
        // Get current programs for channels (by provider_id and channel_id)
        const now = new Date();
        const programMap = new Map();
        
        // Group channels by provider_id for efficient program lookup
        const providerChannelMap = new Map();
        channels.forEach(ch => {
          if (!providerChannelMap.has(ch.provider_id)) {
            providerChannelMap.set(ch.provider_id, []);
          }
          providerChannelMap.get(ch.provider_id).push(ch.channel_id);
        });
        
        // Fetch programs for each provider
        for (const [providerId, channelIds] of providerChannelMap.entries()) {
          try {
            const programs = await this._programManager._repository.findByQuery({
              provider_id: providerId,
              channel_id: { $in: channelIds },
              start: { $lte: now },
              stop: { $gte: now }
            });
            
            programs.forEach(prog => {
              const key = `${prog.provider_id}-${prog.channel_id}`;
              if (!programMap.has(key)) {
                programMap.set(key, prog);
              }
            });
          } catch (error) {
            // Log but continue
            this.logger.warn(`Error fetching programs for provider ${providerId}: ${error.message}`);
          }
        }
        
        // Get watchlist keys for status
        const watchlistKeys = new Set(userWatchlist.live || []);
        
        // Add current program and watchlist status to channels
        const channelsWithPrograms = channels.map(channel => ({
          ...channel,
          currentProgram: programMap.get(`${channel.provider_id}-${channel.channel_id}`) || null,
          watchlist: watchlistKeys.has(channel.channel_key)
        }));
        
        return res.status(200).json({
          items: channelsWithPrograms,
          pagination: result.pagination
        });
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get channels', error.message);
      }
    });

    /**
     * GET /api/livetv/providers/:providerId/channels
     * Get channels for a specific provider
     */
    this.router.get('/providers/:providerId/channels', this.middleware.requireAuth, async (req, res) => {
      try {
        const user = req.user;
        const { providerId } = req.params;
        const { watchlist, search } = req.query;
        
        const watchlistFilter = watchlist !== undefined ? watchlist === 'true' : undefined;
        
        // Get user data for watchlist filtering
        const userData = await this._userManager.getUserByUsername(user.username);
        const userWatchlist = userData?.watchlist || { movies: [], tvshows: [], live: [] };
        
        const options = {
          userId: user.username,
          watchlistFilter: watchlistFilter,
          providerId: providerId,
          search: search || undefined,
          watchlist: userWatchlist
        };
        
        const channels = await this._channelManager.getAllChannels(options);
        return res.status(200).json(channels);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get channels', error.message);
      }
    });

    /**
     * POST /api/livetv/watchlist
     * Add channel to user's watchlist
     * Body: { channelKey }
     */
    this.router.post('/watchlist', this.middleware.requireAuth, async (req, res) => {
      try {
        const user = req.user;
        const { channelKey } = req.body;
        
        if (!channelKey) {
          return this.returnErrorResponse(res, 400, 'channelKey is required');
        }
        
        await this._userManager.addChannelToWatchlist(user.username, channelKey);
        
        // Track watchlist operation
        this._metricsService.incrementCounter('watchlist_operations', {
          operation: 'add',
          media_type: 'live',
          username: user.username
        });
        
        return res.status(200).json({ success: true, message: 'Channel added to watchlist' });
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to add channel to watchlist', error.message);
      }
    });

    /**
     * DELETE /api/livetv/watchlist/:channelKey
     * Remove channel from user's watchlist
     */
    this.router.delete('/watchlist/:channelKey', this.middleware.requireAuth, async (req, res) => {
      try {
        const user = req.user;
        const { channelKey } = req.params;
        const decodedChannelKey = decodeURIComponent(channelKey);
        
        await this._userManager.removeChannelFromWatchlist(user.username, decodedChannelKey);
        
        // Track watchlist operation
        this._metricsService.incrementCounter('watchlist_operations', {
          operation: 'remove',
          media_type: 'live',
          username: user.username
        });
        
        return res.status(200).json({ success: true, message: 'Channel removed from watchlist' });
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to remove channel from watchlist', error.message);
      }
    });

    /**
     * GET /api/livetv/channels/:channelKey/programs
     * Get programs for a channel (channelKey format: live-{providerId}-{channelId})
     */
    this.router.get('/channels/:channelKey/programs', this.middleware.requireApiKey, async (req, res) => {
      try {
        const { channelKey } = req.params;
        const decodedChannelKey = decodeURIComponent(channelKey);
        
        // Parse channel key: live-{providerId}-{channelId}
        const match = decodedChannelKey.match(/^live-(.+?)-(.+)$/);
        if (!match) {
          return this.returnErrorResponse(res, 400, 'Invalid channel key format');
        }
        
        const [, providerId, channelId] = match;
        const programs = await this._programManager._repository.findByQuery({
          provider_id: providerId,
          channel_id: channelId
        }, { sort: { start: 1 } });
        
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
        const m3uContent = await this._liveTVFormattingManager.getM3UPlaylist(user.username, baseUrl);
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
        const epgContent = await this._liveTVFormattingManager.getEPGContent(user.username);
        res.setHeader('Content-Type', 'application/xml');
        return res.send(epgContent);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get EPG', error.message);
      }
    });

    /**
     * GET /api/livetv/stream/:channelKey
     * Stream redirect for channel (channelKey format: live-{providerId}-{channelId})
     */
    this.router.get('/stream/:channelKey', this.middleware.requireApiKey, async (req, res) => {
      try {
        const { channelKey } = req.params;
        const decodedChannelKey = decodeURIComponent(channelKey);
        
        // Parse channel key: live-{providerId}-{channelId}
        const match = decodedChannelKey.match(/^live-(.+?)-(.+)$/);
        if (!match) {
          return this.returnErrorResponse(res, 400, 'Invalid channel key format');
        }
        
        const [, providerId, channelId] = match;
        const channel = await this._channelManager._repository.findOneByQuery({
          provider_id: providerId,
          channel_id: channelId
        });
        
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

