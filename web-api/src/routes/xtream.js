import BaseRouter from './BaseRouter.js';
import { DatabaseCollections, toCollectionName } from '../config/collections.js';

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
  
  return {
    url: hostname,
    port: httpPort,
    https_port: httpsPort,
    server_protocol: scheme,
    timezone: 'UTC',
    timestamp_now: Math.floor(Date.now() / 1000)
  };
}

/**
 * Xtream Code API router
 * Exposes movies and TV shows in Xtream Code API format
 * Authentication: username and API key (password parameter)
 */
class XtreamRouter extends BaseRouter {
  /**
   * @param {import('../managers/xtream.js').XtreamManager} xtreamManager - Xtream manager instance
   * @param {import('../services/database.js').DatabaseService} database - Database service instance
   * @param {import('../managers/stream.js').StreamManager} streamManager - Stream manager instance
   */
  constructor(xtreamManager, database, streamManager) {
    super(database, 'XtreamRouter');
    this._xtreamManager = xtreamManager;
    this._streamManager = streamManager;
    
    // Action handlers configuration map
    this._actionHandlers = {
      get_vod_categories: this._handleGetVodCategories.bind(this),
      get_vod_streams: this._handleGetVodStreams.bind(this),
      get_series_categories: this._handleGetSeriesCategories.bind(this),
      get_series: this._handleGetSeries.bind(this),
      get_vod_info: this._handleGetVodInfo.bind(this),
      get_series_info: this._handleGetSeriesInfo.bind(this),
      get_short_epg: this._handleGetShortEpg.bind(this),
      get_simple_data_table: this._handleGetSimpleDataTable.bind(this)
    };
  }

  /**
   * Initialize routes for this router
   */
  initialize() {
    /**
     * GET /
     * Xtream Code API endpoint (mounted at /player_api.php)
     * Query parameters: username, password (API key), action
     */
    this.router.get('/', async (req, res) => {
      try {
        // Set UTF-8 charset header for all JSON responses
        res.setHeader('Content-Type', 'application/json; charset=UTF-8');
        
        const { username, password, action } = req.query;

        // Validate required parameters
        if (!username || !password) {
          return res.status(401).json({ 
            user_info: { 
              auth: 0,
              status: 'Blocked',
              message: 'Username or password incorrect'
            }
          });
        }

        // Authenticate user (password is the API key)
        const user = await this._authenticateUser(username, password);
        if (!user) {
          return res.status(401).json({ 
            user_info: { 
              auth: 0,
              status: 'Blocked',
              message: 'Username or password incorrect'
            }
          });
        }

        // Get base URL for stream endpoints
        const baseUrl = getBaseUrl(req);

        // Handle action using config map
        const handler = action ? this._actionHandlers[action] : null;
        
        if (handler) {
          try {
            const response = await handler(req, user, baseUrl);
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
        return res.status(200).json({
          user_info: {
            username: username,
            password: password,
            message: 'Active',
            auth: 1,
            status: 'Active',
            exp_date: 'Unlimited',
            is_trial: 0,
            active_cons: 0,
            created_at: user.createdAt || null,
            max_connections: 1,
            allowed_output_formats: ['m3u8', 'ts']
          },
          server_info: buildServerInfo(req)
        });
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Internal server error', `Xtream API error: ${error.message}`);
      }
    });

    /**
     * GET /movie/:username/:password/:streamId
     * Handle movie stream requests in Xtream Code API format
     * Format: /movie/{username}/{password}/movies-{title_id}.mp4
     */
    this.router.get('/movie/:username/:password/:streamId', async (req, res) => {
      try {
        const { username, password, streamId } = req.params;

        // Authenticate user
        const user = await this._authenticateUser(username, password);
        if (!user) {
          return this.returnErrorResponse(res, 401, 'Unauthorized');
        }

        this.logger.info(`Movie stream request: username=${username}, streamId=${streamId}`);

        // Parse stream ID to extract title ID
        const titleId = this._parseMovieStreamId(streamId);
        if (!titleId) {
          return this.returnErrorResponse(res, 400, 'Invalid stream ID format');
        }

        this.logger.debug(`Parsed movie stream: streamId=${streamId}, titleId=${titleId}`);

        // Get best source for the movie
        const streamUrl = await this._streamManager.getBestSource(titleId, 'movies');

        if (!streamUrl) {
          this.logger.warn(`No stream available: username=${username}, titleId=${titleId}`);
          return this.returnErrorResponse(res, 503, 'No available providers');
        }

        this.logger.info(`Movie stream found: username=${username}, titleId=${titleId}, redirecting to provider stream`);

        // Redirect to the actual stream URL
        return res.redirect(streamUrl);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get stream', `Movie stream error: ${error.message}`);
      }
    });

    /**
     * GET /series/:username/:password/:streamId
     * Handle series stream requests in Xtream Code API format
     * Format: /series/{username}/{password}/tvshows-{title_id}-{season}-{episode}.mp4
     */
    this.router.get('/series/:username/:password/:streamId', async (req, res) => {
      try {
        const { username, password, streamId } = req.params;

        // Authenticate user
        const user = await this._authenticateUser(username, password);
        if (!user) {
          return this.returnErrorResponse(res, 401, 'Unauthorized');
        }

        this.logger.info(`Series stream request: username=${username}, streamId=${streamId}`);

        // Parse stream ID to extract title ID, season, and episode
        const parsed = this._parseSeriesStreamId(streamId);
        if (!parsed) {
          return this.returnErrorResponse(res, 400, 'Invalid stream ID format');
        }

        const { title_id, season, episode } = parsed;

        this.logger.debug(`Parsed series stream: streamId=${streamId}, titleId=${title_id}, season=${season}, episode=${episode}`);

        // Get best source for the TV show episode
        const streamUrl = await this._streamManager.getBestSource(
          title_id,
          'tvshows',
          season,
          episode
        );

        if (!streamUrl) {
          this.logger.warn(`No stream available: username=${username}, titleId=${title_id}, season=${season}, episode=${episode}`);
          return this.returnErrorResponse(res, 503, 'No available providers');
        }

        this.logger.info(`Series stream found: username=${username}, titleId=${title_id}, season=${season}, episode=${episode}, redirecting to provider stream`);

        // Redirect to the actual stream URL
        return res.redirect(streamUrl);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get stream', `Series stream error: ${error.message}`);
      }
    });
  }

  /**
   * Handle get_vod_categories action
   * @private
   * @param {Object} req - Express request object
   * @param {Object} user - Authenticated user
   * @param {string} baseUrl - Base URL
   * @returns {Promise<Array>} VOD categories
   */
  async _handleGetVodCategories(req, user, baseUrl) {
    return await this._xtreamManager.getVodCategories(user);
  }

  /**
   * Handle get_vod_streams action
   * @private
   * @param {Object} req - Express request object
   * @param {Object} user - Authenticated user
   * @param {string} baseUrl - Base URL
   * @returns {Promise<Array>} VOD streams
   */
  async _handleGetVodStreams(req, user, baseUrl) {
    const categoryId = req.query.category_id ? parseInt(req.query.category_id, 10) : null;
    return await this._xtreamManager.getVodStreams(user, baseUrl, categoryId);
  }

  /**
   * Handle get_series_categories action
   * @private
   * @param {Object} req - Express request object
   * @param {Object} user - Authenticated user
   * @param {string} baseUrl - Base URL
   * @returns {Promise<Array>} Series categories
   */
  async _handleGetSeriesCategories(req, user, baseUrl) {
    return await this._xtreamManager.getSeriesCategories(user);
  }

  /**
   * Handle get_series action
   * @private
   * @param {Object} req - Express request object
   * @param {Object} user - Authenticated user
   * @param {string} baseUrl - Base URL
   * @returns {Promise<Array>} Series list
   */
  async _handleGetSeries(req, user, baseUrl) {
    const categoryId = req.query.category_id ? parseInt(req.query.category_id, 10) : null;
    return await this._xtreamManager.getSeries(user, baseUrl, categoryId);
  }

  /**
   * Handle get_vod_info action
   * @private
   * @param {Object} req - Express request object
   * @param {Object} user - Authenticated user
   * @param {string} baseUrl - Base URL
   * @returns {Promise<Object>} VOD info or error response
   */
  async _handleGetVodInfo(req, user, baseUrl) {
    const vodId = req.query.vod_id ? parseInt(req.query.vod_id, 10) : null;
    if (!vodId) {
      throw new Error('vod_id parameter required');
    }
    const response = await this._xtreamManager.getVodInfo(user, baseUrl, vodId);
    if (!response) {
      throw new Error('Movie not found');
    }
    return response;
  }

  /**
   * Handle get_series_info action
   * @private
   * @param {Object} req - Express request object
   * @param {Object} user - Authenticated user
   * @param {string} baseUrl - Base URL
   * @returns {Promise<Object>} Series info or error response
   */
  async _handleGetSeriesInfo(req, user, baseUrl) {
    const seriesId = req.query.series_id ? parseInt(req.query.series_id, 10) : null;
    if (!seriesId) {
      throw new Error('series_id parameter required');
    }
    const response = await this._xtreamManager.getSeriesInfo(user, baseUrl, seriesId);
    if (!response) {
      throw new Error('Series not found');
    }
    return response;
  }

  /**
   * Handle get_short_epg action
   * @private
   * @param {Object} req - Express request object
   * @param {Object} user - Authenticated user
   * @param {string} baseUrl - Base URL
   * @returns {Promise<Array>} Empty EPG array
   */
  async _handleGetShortEpg(req, user, baseUrl) {
    // EPG not implemented, return empty array
    return [];
  }

  /**
   * Handle get_simple_data_table action
   * @private
   * @param {Object} req - Express request object
   * @param {Object} user - Authenticated user
   * @param {string} baseUrl - Base URL
   * @returns {Promise<Object>} Empty object
   */
  async _handleGetSimpleDataTable(req, user, baseUrl) {
    // Not implemented, return empty object
    return {};
  }

  /**
   * Parse movie stream ID to extract title ID
   * @private
   * @param {string} streamId - Stream ID in format: movies-{title_id}.mp4
   * @returns {string|null} Title ID or null if invalid format
   */
  _parseMovieStreamId(streamId) {
    // Format: movies-{title_id}.mp4
    if (!streamId || !streamId.startsWith('movies-') || !streamId.endsWith('.mp4')) {
      return null;
    }
    
    // Remove 'movies-' prefix and '.mp4' suffix
    const titleId = streamId.slice(7, -4); // Remove 'movies-' (7 chars) and '.mp4' (4 chars)
    
    if (!titleId || titleId.length === 0) {
      return null;
    }
    
    return titleId;
  }

  /**
   * Parse series stream ID to extract title ID, season, and episode
   * @private
   * @param {string} streamId - Stream ID in format: tvshows-{title_id}-{season}-{episode}.mp4
   * @returns {Object|null} Object with title_id, season, episode or null if invalid format
   */
  _parseSeriesStreamId(streamId) {
    // Format: tvshows-{title_id}-{season}-{episode}.mp4
    if (!streamId || !streamId.startsWith('tvshows-') || !streamId.endsWith('.mp4')) {
      return null;
    }
    
    // Remove 'tvshows-' prefix and '.mp4' suffix
    const withoutPrefix = streamId.slice(8); // Remove 'tvshows-' (8 chars)
    const withoutSuffix = withoutPrefix.slice(0, -4); // Remove '.mp4' (4 chars)
    
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

  /**
   * Authenticate user by username and API key
   * @private
   * @param {string} username - Username
   * @param {string} apiKey - API key (passed as password parameter)
   * @returns {Promise<Object|null>} User object or null if invalid
   */
  async _authenticateUser(username, apiKey) {
    try {
      const usersCollection = toCollectionName(DatabaseCollections.USERS);
      const user = await this._database.getData(usersCollection, { 
        username: username,
        api_key: apiKey 
      });

      if (!user || user.status !== 'active') {
        return null;
      }

      // Remove sensitive data
      const { password_hash, _id, ...userPublic } = user;
      return userPublic;
    } catch (error) {
      logger.error('Authentication error:', error);
      return null;
    }
  }
}

export default XtreamRouter;

