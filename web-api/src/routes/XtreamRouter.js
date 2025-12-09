import BaseRouter from './BaseRouter.js';

/**
 * Get the base URL from the request, respecting X-Forwarded-* headers
 * Matches Python's _get_base_url() and playlist router pattern
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
 * Convert various timestamp representations to Unix seconds
 * @param {number|string|Date|null|undefined} value - Incoming timestamp representation
 * @param {number|null} [fallbackSeconds] - Fallback Unix seconds if value is invalid
 * @returns {number} Unix timestamp in seconds
 */
function toUnixSeconds(value, fallbackSeconds = null) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (value === undefined || value === null || value === '') {
    return fallbackSeconds !== null ? fallbackSeconds : nowSeconds;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    // Assume milliseconds when it's too large
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return fallbackSeconds !== null ? fallbackSeconds : nowSeconds;
    }
    const numeric = Number(trimmed);
    if (!Number.isNaN(numeric)) {
      return trimmed.length >= 13 ? Math.floor(numeric / 1000) : Math.floor(numeric);
    }
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallbackSeconds !== null ? fallbackSeconds : nowSeconds;
  }
  return Math.floor(date.getTime() / 1000);
}

/**
 * Format Unix timestamp into Xtream-compatible human-readable time
 * @param {number} timestampSeconds - Unix timestamp seconds
 * @param {string} [timezone] - IANA timezone identifier (e.g., 'America/New_York', 'UTC')
 * @returns {string} Formatted time string (YYYY-MM-DD HH:mm:ss) in the specified timezone
 */
function formatServerTime(timestampSeconds, timezone = 'UTC') {
  const date = new Date(timestampSeconds * 1000);
  
  // Use Intl.DateTimeFormat to format in the specified timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  // Format the date - returns something like "01/15/2024, 14:30:45"
  const parts = formatter.formatToParts(date);
  
  // Extract parts and build YYYY-MM-DD HH:mm:ss format
  const year = parts.find(p => p.type === 'year').value;
  const month = parts.find(p => p.type === 'month').value;
  const day = parts.find(p => p.type === 'day').value;
  const hours = parts.find(p => p.type === 'hour').value;
  const minutes = parts.find(p => p.type === 'minute').value;
  const seconds = parts.find(p => p.type === 'second').value;
  
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Build server_info object for Xtream Codes API compliance
 * @param {Object} req - Express request object
 * @returns {Object} server_info object with url, port, https_port, server_protocol, timezone, timestamp_now
 */
function buildServerInfo(req) {
  const baseUrl = getBaseUrl(req);
  const urlObj = new URL(baseUrl);
  const scheme = urlObj.protocol.replace(':', '');
  const hostname = urlObj.hostname;
  const port = urlObj.port ? parseInt(urlObj.port, 10) : (scheme === 'https' ? 443 : 80);
  const httpsPort = scheme === 'https' ? port : 443;
  const httpPort = scheme === 'http' ? port : 80;
  const timezone = process.env.SERVER_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const timestampNow = Math.floor(Date.now() / 1000);
  const timeNow = formatServerTime(timestampNow, timezone);
  
  return {
    url: hostname,
    port: httpPort.toString(),
    https_port: httpsPort.toString(),
    server_protocol: scheme,
    rtmp_port: '0',
    timezone,
    timestamp_now: timestampNow.toString(),
    time_now: timeNow,
    server_time_now: timeNow
  };
}

/**
 * Xtream Code API router
 * Exposes movies and TV shows in Xtream Code API format
 * Authentication: username and API key (password parameter)
 */
class XtreamRouter extends BaseRouter {
  /**
   * @param {import('express').Application} app - Express app instance
   * @param {import('../managers/formatting/XtreamManager.js').XtreamManager} xtreamManager - Xtream manager instance (extends BaseFormattingManager, has getBestSource method)
   * @param {import('../middleware/Middleware.js').default} middleware - Middleware instance
   * @param {import('../managers/domain/ChannelManager.js').ChannelManager} channelManager - Channel manager instance (for LiveTV)
   * @param {import('../managers/domain/ProgramManager.js').ProgramManager} programManager - Program manager instance (for LiveTV)
   */
  constructor(app, xtreamManager, middleware, channelManager, programManager) {
    super(app, middleware, 'XtreamRouter');
    this._xtreamManager = xtreamManager;
    this._channelManager = channelManager;
    this._programManager = programManager;
    
    // Action handlers configuration map
    this._actionHandlers = {
      get_vod_categories: this._handleGetVodCategories.bind(this),
      get_vod_streams: this._handleGetVodStreams.bind(this),
      get_series_categories: this._handleGetSeriesCategories.bind(this),
      get_series: this._handleGetSeries.bind(this),
      get_vod_info: this._handleGetVodInfo.bind(this),
      get_series_info: this._handleGetSeriesInfo.bind(this),
      get_short_epg: this._handleGetShortEpg.bind(this),
      get_simple_data_table: this._handleGetSimpleDataTable.bind(this),
      get_live_categories: this._handleGetLiveCategories.bind(this),
      get_live_streams: this._handleGetLiveStreams.bind(this)
    };

    // Stream type handlers mapping (mount path -> handler method)
    this._streamTypeHandlers = {
      '/movie': this._handleMovieStream.bind(this),
      '/series': this._handleSeriesStream.bind(this),
      '/live': this._handleLiveStream.bind(this)
    };
  }

  /**
   * Get the base path(s) for this router
   * @returns {string[]} Base path(s) for this router
   */
  getBasePath() {
    return ['/player_api.php', '/movie', '/series', '/live'];
  }

  /**
   * Set up routes for this router
   */
  setupRoutes() {
    /**
     * GET /
     * Xtream Code API endpoint (mounted at /player_api.php)
     * Query parameters: username, password (API key), action
     */
    this.router.get('/', this.middleware.requireXtreamAuth, this._handleGetXtreamApi.bind(this));

    /**
     * GET /:username/:password/:streamId
     * Handle stream requests (direct mounting at /movie or /series)
     * Format: /{username}/{password}/movies-{title_id}.mp4 or /{username}/{password}/{title_id}.mp4 for movies
     * Format: /{username}/{password}/tvshows-{title_id}-{season}-{episode}.mp4 or /{username}/{password}/{title_id}-{season}-{episode}.mp4 for series
     * Format: /{username}/{password}/{channel_id}.m3u8 for Live TV channels
     */
    this.router.get('/:username/:password/:streamId', this.middleware.requireXtreamAuth, this._handleGetStream.bind(this));
  }

  /**
   * Handle GET / request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleGetXtreamApi(req, res) {
    try {
      // Set UTF-8 charset header for all JSON responses
      res.setHeader('Content-Type', 'application/json; charset=UTF-8');
      
      const { username, password, action } = req.query;

      // Get base URL for stream endpoints
      const baseUrl = getBaseUrl(req);

      // Handle action using config map
      const handler = action ? this._actionHandlers[action] : null;
      
      if (handler) {
        try {
          const response = await handler(req, baseUrl);
          return res.status(200).json(response);
        } catch (error) {
          // Handle specific errors from handlers
          if (error.message === 'vod_id parameter required' || error.message === 'series_id parameter required') {
            return this.returnErrorResponse(res, 400, error.message);
          }
          if (error.message === 'Movie not found' || error.message === 'Series not found') {
            return this.returnErrorResponse(res, 404, error.message);
          }
          throw error; // Re-throw to be caught by outer catch
        }
      }

      // Default: return user info if no action or unknown action
      const nowSeconds = Math.floor(Date.now() / 1000);
      const createdAtSeconds = toUnixSeconds(req.user?.created_at || req.user?.createdAt, nowSeconds);
      // Use far-future timestamp (2099-12-31 23:59:59 UTC) for unlimited accounts instead of 0
      const UNLIMITED_EXPIRY_SECONDS = 4102444799; // 2099-12-31 23:59:59 UTC
      const expDateSeconds =
        req.user?.expires_at || req.user?.exp_date
          ? toUnixSeconds(req.user.expires_at || req.user.exp_date, 0)
          : UNLIMITED_EXPIRY_SECONDS;

      return res.status(200).json({
        user_info: {
          username: username,
          password: password,
          message: 'Active',
          auth: '1',
          status: 'Active',
          exp_date: expDateSeconds.toString(),
          is_trial: (req.user?.is_trial ? '1' : '0'),
          active_cons: (req.user?.active_cons ?? 0).toString(),
          created_at: createdAtSeconds.toString(),
          max_connections: (req.user?.max_connections ?? 1).toString(),
          allowed_output_formats: ['m3u8', 'ts']
        },
        server_info: buildServerInfo(req)
      });
    } catch (error) {
      return this.returnErrorResponse(res, 500, 'Internal server error', `Xtream API error: ${error.message}`);
    }
  }

  /**
   * Handle GET /:username/:password/:streamId request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleGetStream(req, res) {
    try {
      const { streamId } = req.params;

      // Get handler based on mount path (req.baseUrl)
      const handler = this._streamTypeHandlers[req.baseUrl];
      if (!handler) {
        return this.returnErrorResponse(res, 404, 'Invalid stream type');
      }

      // Call the appropriate handler
      return await handler(req, res, streamId);
    } catch (error) {
      return this.returnErrorResponse(res, 500, 'Failed to get stream', `Stream error: ${error.message}`);
    }
  }

  /**
   * Handle get_vod_categories action
   * @private
   * @param {Object} req - Express request object (contains req.user from middleware)
   * @param {string} baseUrl - Base URL
   * @returns {Promise<Array>} VOD categories
   */
  async _handleGetVodCategories(req, baseUrl) {
    return await this._xtreamManager.getVodCategories(req.user);
  }

  /**
   * Handle get_vod_streams action
   * @private
   * @param {Object} req - Express request object (contains req.user from middleware)
   * @param {string} baseUrl - Base URL
   * @returns {Promise<Array>} VOD streams
   */
  async _handleGetVodStreams(req, baseUrl) {
    const categoryId = req.query.category_id ? parseInt(req.query.category_id, 10) : null;
    return await this._xtreamManager.getVodStreams(req.user, baseUrl, categoryId);
  }

  /**
   * Handle get_series_categories action
   * @private
   * @param {Object} req - Express request object (contains req.user from middleware)
   * @param {string} baseUrl - Base URL
   * @returns {Promise<Array>} Series categories
   */
  async _handleGetSeriesCategories(req, baseUrl) {
    return await this._xtreamManager.getSeriesCategories(req.user);
  }

  /**
   * Handle get_series action
   * @private
   * @param {Object} req - Express request object (contains req.user from middleware)
   * @param {string} baseUrl - Base URL
   * @returns {Promise<Array>} Series list
   */
  async _handleGetSeries(req, baseUrl) {
    const categoryId = req.query.category_id ? parseInt(req.query.category_id, 10) : null;
    return await this._xtreamManager.getSeries(req.user, baseUrl, categoryId);
  }

  /**
   * Handle get_vod_info action
   * @private
   * @param {Object} req - Express request object (contains req.user from middleware)
   * @param {string} baseUrl - Base URL
   * @returns {Promise<Object>} VOD info or error response
   */
  async _handleGetVodInfo(req, baseUrl) {
    const vodId = req.query.vod_id ? parseInt(req.query.vod_id, 10) : null;
    if (!vodId) {
      throw new Error('vod_id parameter required');
    }
    const response = await this._xtreamManager.getVodInfo(req.user, baseUrl, vodId);
    if (!response) {
      throw new Error('Movie not found');
    }
    return response;
  }

  /**
   * Handle get_series_info action
   * @private
   * @param {Object} req - Express request object (contains req.user from middleware)
   * @param {string} baseUrl - Base URL
   * @returns {Promise<Object>} Series info or error response
   */
  async _handleGetSeriesInfo(req, baseUrl) {
    const seriesId = req.query.series_id ? parseInt(req.query.series_id, 10) : null;
    if (!seriesId) {
      throw new Error('series_id parameter required');
    }
    const response = await this._xtreamManager.getSeriesInfo(req.user, baseUrl, seriesId);
    if (!response) {
      throw new Error('Series not found');
    }
    return response;
  }

  /**
   * Handle get_short_epg action
   * @private
   * @param {Object} req - Express request object (contains req.user from middleware)
   * @param {string} baseUrl - Base URL
   * @returns {Promise<Array>} EPG array
   */
  async _handleGetShortEpg(req, baseUrl) {
    return await this._xtreamManager.getShortEpg(req.user);
  }

  /**
   * Handle get_live_categories action
   * @private
   * @param {Object} req - Express request object (contains req.user from middleware)
   * @param {string} baseUrl - Base URL
   * @returns {Promise<Array>} Live TV categories
   */
  async _handleGetLiveCategories(req, baseUrl) {
    return await this._xtreamManager.getLiveCategories(req.user);
  }

  /**
   * Handle get_live_streams action
   * @private
   * @param {Object} req - Express request object (contains req.user from middleware)
   * @param {string} baseUrl - Base URL
   * @returns {Promise<Array>} Live TV streams
   */
  async _handleGetLiveStreams(req, baseUrl) {
    const categoryId = req.query.category_id ? parseInt(req.query.category_id, 10) : null;
    return await this._xtreamManager.getLiveStreams(req.user, baseUrl, categoryId);
  }

  /**
   * Handle get_simple_data_table action
   * @private
   * @param {Object} req - Express request object (contains req.user from middleware)
   * @param {string} baseUrl - Base URL
   * @returns {Promise<Object>} Empty object
   */
  async _handleGetSimpleDataTable(req, baseUrl) {
    // Not implemented, return empty object
    return {};
  }

  /**
   * Handle movie stream request
   * @private
   * @param {Object} req - Express request object (contains req.user from middleware)
   * @param {Object} res - Express response object
   * @param {string} streamId - Stream ID
   * @returns {Promise<void>}
   */
  async _handleMovieStream(req, res, streamId) {
    const { username } = req.params;

    // Parse stream ID to extract title ID
    const titleId = this._parseMovieStreamId(streamId);
    if (!titleId) {
      return this.returnErrorResponse(res, 400, 'Invalid stream ID format');
    }

    this.logger.info(`Movie stream request: username=${username}, streamId=${streamId}`);
    this.logger.debug(`Parsed movie stream: streamId=${streamId}, titleId=${titleId}`);

        const streamUrl = await this._xtreamManager.getBestSource(titleId, 'movies', null, null, username);
    if (!streamUrl) {
      this.logger.warn(`No stream available: username=${username}, titleId=${titleId}`);
      return this.returnErrorResponse(res, 503, 'No available providers');
    }

    this.logger.info(`Movie stream found: username=${username}, titleId=${titleId}, redirecting to provider stream`);
    return res.redirect(streamUrl);
  }

  /**
   * Handle series stream request
   * @private
   * @param {Object} req - Express request object (contains req.user from middleware)
   * @param {Object} res - Express response object
   * @param {string} streamId - Stream ID
   * @returns {Promise<void>}
   */
  async _handleSeriesStream(req, res, streamId) {
    const { username } = req.params;

    // Parse stream ID to extract title ID, season, and episode
    const parsed = this._parseSeriesStreamId(streamId);
    if (!parsed) {
      return this.returnErrorResponse(res, 400, 'Invalid stream ID format');
    }

    const { title_id, season, episode } = parsed;
    this.logger.info(`Series stream request: username=${username}, streamId=${streamId}`);
    this.logger.debug(`Parsed series stream: streamId=${streamId}, titleId=${title_id}, season=${season}, episode=${episode}`);

    const streamUrl = await this._xtreamManager.getBestSource(
      title_id,
      'tvshows',
      season,
      episode,
      username
    );

    if (!streamUrl) {
      this.logger.warn(`No stream available: username=${username}, titleId=${title_id}, season=${season}, episode=${episode}`);
      return this.returnErrorResponse(res, 503, 'No available providers');
    }

    this.logger.info(`Series stream found: username=${username}, titleId=${title_id}, season=${season}, episode=${episode}, redirecting to provider stream`);
    return res.redirect(streamUrl);
  }

  /**
   * Handle Live TV stream request
   * @private
   * @param {Object} req - Express request object (contains req.user from middleware)
   * @param {Object} res - Express response object
   * @param {string} streamId - Stream ID (channel ID with optional extension)
   * @returns {Promise<void>}
   */
  async _handleLiveStream(req, res, streamId) {
    const { username } = req.params;

    // Try to parse as Live TV channel
    let channelId = streamId;
    
    // Strip common video/stream file extensions (.m3u8, .ts, .mp4, etc.)
    const videoExtensions = ['.m3u8', '.ts', '.mp4', '.mkv', '.avi', '.m4v'];
    for (const ext of videoExtensions) {
      if (channelId.endsWith(ext)) {
        channelId = channelId.slice(0, -ext.length);
        break;
      }
    }
    
    // Decode the channel ID in case it's URL encoded
    try {
      channelId = decodeURIComponent(channelId);
    } catch (e) {
      // If decoding fails, use original channelId
      this.logger.debug(`Failed to decode channelId, using original: ${channelId}`);
    }
    
    // Try to find channel with stripped extension first
    let channel = await this._channelManager.getChannelByUsernameAndId(req.user.username, channelId);
    
    // If not found, try with original streamId (in case channel is stored with extension)
    if (!channel && channelId !== streamId) {
      try {
        const originalChannelId = decodeURIComponent(streamId);
        channel = await this._channelManager.getChannelByUsernameAndId(req.user.username, originalChannelId);
        if (channel) {
          channelId = originalChannelId; // Use original for logging
        }
      } catch (e) {
        // If decoding fails, ignore
      }
    }
    
    if (!channel) {
      this.logger.warn(`Live TV channel not found: username=${username}, channelId=${channelId}, streamId=${streamId}`);
      return this.returnErrorResponse(res, 404, 'Channel not found');
    }

    this.logger.debug(`Live TV stream request: username=${username}, channelId=${channelId}`);
    return res.redirect(channel.url);
  }

  /**
   * Parse movie stream ID to extract title ID
   * @private
   * @param {string} streamId - Stream ID in format: movies-{title_id}.mp4 or {title_id}.mp4
   * @returns {string|null} Title ID or null if invalid format
   */
  _parseMovieStreamId(streamId) {
    // Format 1: movies-{title_id}.mp4 (current format)
    // Format 2: {title_id}.mp4 (Xtream Code API standard format)
    
    if (!streamId || !streamId.endsWith('.mp4')) {
      return null;
    }
    
    let titleId;
    
    // Check if it's in format: movies-{title_id}.mp4
    if (streamId.startsWith('movies-')) {
      titleId = streamId.slice(7, -4); // Remove 'movies-' (7 chars) and '.mp4' (4 chars)
    } else {
      // Format: {title_id}.mp4 (standard Xtream Code API format)
      titleId = streamId.slice(0, -4); // Remove '.mp4' (4 chars)
    }
    
    if (!titleId || titleId.length === 0) {
      return null;
    }
    
    return titleId;
  }

  /**
   * Parse series stream ID to extract title ID, season, and episode
   * @private
   * @param {string} streamId - Stream ID in format: tvshows-{title_id}-{season}-{episode}.mp4 or {title_id}-{season}-{episode}.mp4
   * @returns {Object|null} Object with title_id, season, episode or null if invalid format
   */
  _parseSeriesStreamId(streamId) {
    // Format 1: tvshows-{title_id}-{season}-{episode}.mp4 (current format)
    // Format 2: {title_id}-{season}-{episode}.mp4 (Xtream Code API standard format)
    
    if (!streamId || !streamId.endsWith('.mp4')) {
      return null;
    }
    
    // Remove '.mp4' suffix
    let withoutSuffix = streamId.slice(0, -4);
    
    // Remove 'tvshows-' prefix if present
    if (withoutSuffix.startsWith('tvshows-')) {
      withoutSuffix = withoutSuffix.slice(8); // Remove 'tvshows-' (8 chars)
    }
    
    // Split by '-' to get components
    // Expected: {title_id}-{season}-{episode}
    const parts = withoutSuffix.split('-');
    
    // Need at least 3 parts: title_id, season, episode
    // But title_id might contain dashes, so we need to handle that
    // The last two parts should be season and episode (numbers)
    if (parts.length < 3) {
      return null;
    }
    
    // Last two parts should be season and episode
    const seasonStr = parts[parts.length - 2];
    const episodeStr = parts[parts.length - 1];
    
    const season = parseInt(seasonStr, 10);
    const episode = parseInt(episodeStr, 10);
    
    // Validate season and episode are valid numbers
    if (isNaN(season) || isNaN(episode) || season < 1 || episode < 1) {
      return null;
    }
    
    // Title ID is everything except the last two parts
    const titleId = parts.slice(0, -2).join('-');
    
    if (!titleId || titleId.length === 0) {
      return null;
    }
    
    return {
      title_id: titleId,
      season: season,
      episode: episode
    };
  }

}

export default XtreamRouter;

