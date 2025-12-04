import { BaseFormattingManager } from './BaseFormattingManager.js';

/**
 * Stremio manager for handling Stremio addon data transformation
 * Converts Playarr data format to Stremio addon protocol format
 */
class StremioManager extends BaseFormattingManager {
  /**
   * @param {import('../domain/TitlesManager.js').TitlesManager} titlesManager - Titles manager instance
   * @param {import('../domain/IPTVProviderManager.js').IPTVProviderManager} iptvProviderManager - IPTV Provider manager instance
   * @param {import('../domain/ChannelManager.js').ChannelManager} channelManager - Channel manager instance
   * @param {import('../domain/ProgramManager.js').ProgramManager} programManager - Program manager instance
   */
  constructor(titlesManager, iptvProviderManager, channelManager, programManager) {
    super('StremioManager', titlesManager, iptvProviderManager);
    this._channelManager = channelManager;
    this._programManager = programManager;
    this._tmdbPosterBase = 'https://image.tmdb.org/t/p/w300';
    this._tmdbBackdropBase = 'https://image.tmdb.org/t/p/w1280';
    
    // Type mapping: Stremio type -> Playarr type
    this._typeMap = {
      movie: 'movies',
      series: 'tvshows',
      tv: 'livetv'
    };
    
    // Playarr type constants
    this._playarrTypes = {
      MOVIES: 'movies',
      TVSHOWS: 'tvshows',
      LIVETV: 'livetv'
    };
  }

  /**
   * Convert Playarr title_key to Stremio ID
   * Extracts just the title_id number since type comes from endpoint path
   * @param {string} titleKey - Playarr title_key (e.g., "movies-12345" or "tvshows-67890")
   * @returns {string|null} Stremio ID (e.g., "12345") or null if invalid
   */
  titleKeyToStremioId(titleKey) {
    if (!titleKey) return null;
    // Extract title_id from "movies-12345" or "tvshows-67890"
    const match = titleKey.match(/^(movies|tvshows)-(\d+)$/);
    return match ? match[2] : null; // Return just the number
  }

  /**
   * Convert Stremio ID and type to Playarr title_key
   * Supports both TMDB IDs (numeric) and IMDB IDs (starting with "tt")
   * @param {string} stremioId - Stremio ID (TMDB ID number or IMDB ID like "tt0133093")
   * @param {string} stremioType - Stremio type from endpoint ('movie' or 'series')
   * @returns {Promise<string|null>} Playarr title_key (e.g., "movies-12345") or null if invalid
   */
  async stremioIdToTitleKey(stremioId, stremioType) {
    if (!stremioId || !stremioType) return null;
    
    // Check if stremioId is an IMDB ID (starts with "tt")
    if (stremioId.startsWith('tt')) {
      // Look up title by imdb_id
      const playarrType = this._typeMap[stremioType];
      if (!playarrType) return null;
      
      // Query MongoDB for title with matching imdb_id
      const title = await this._titlesManager.findTitleByQuery({
        type: playarrType,
        imdb_id: stremioId
      });
      
      if (title && title.title_key) {
        return title.title_key;
      }
      
      return null;
    }
    
    // Default: treat as TMDB ID (numeric)
    const playarrType = this._typeMap[stremioType];
    if (!playarrType) return null;
    return `${playarrType}-${stremioId}`;
  }

  /**
   * Get manifest for Stremio addon
   * @param {string} baseUrl - Base URL for the addon (e.g., "https://yourdomain.com/stremio/{api_key}")
   * @param {Object} user - User object (not used for Live TV check anymore)
   * @returns {Promise<Object>} Stremio manifest object
   */
  async getManifest(baseUrl, user = null) {
    // Use fixed addon name
    const addonName = 'Playarr';

    // Start with base types
    const types = ['movie', 'series'];
    
    // Build resources with all types merged (no duplicates)
    const resourceTypes = ['movie', 'series'];
    
    // Check if channels exist from active providers
    let hasChannels = false;
    try {
      const activeProviders = await this._iptvProviderManager.findByQuery({
        type: { $in: ['agtv', 'xtream'] },
        enabled: { $ne: false },
        deleted: { $ne: true }
      });
      
      if (activeProviders.length > 0) {
        const activeProviderIds = activeProviders.map(p => p.id);
        const channelCount = await this._channelManager._repository.count({
          provider_id: { $in: activeProviderIds }
        });
        hasChannels = channelCount > 0;
      }
    } catch (error) {
      this.logger.warn(`Error checking for channels in manifest: ${error.message}`);
      // Default to false if check fails
    }
    
    if (hasChannels) {
      resourceTypes.push('tv');
      types.push('tv');
    }

    const resources = [
      {
        name: 'catalog',
        types: resourceTypes
      },
      {
        name: 'meta',
        types: resourceTypes
      },
      {
        name: 'stream',
        types: resourceTypes
      }
    ];

    const catalogs = [
      {
        type: 'movie',
        id: 'movies',
        name: 'Playarr Movies'
      },
      {
        type: 'series',
        id: 'series',
        name: 'Playarr Series'
      }
    ];

    // Add Live TV catalog if channels exist
    if (hasChannels) {
      catalogs.push({
        type: 'tv',
        id: 'live-tv',
        name: 'Playarr Live TV'
      });
    }

    return {
      id: 'com.playarr.addon',
      version: '1.2.0',
      name: addonName,
      description: 'Playarr IPTV streaming addon',
      resources,
      types,
      catalogs,
      background: `${baseUrl}/background.jpg`,
      logo: `${baseUrl}/logo.png`,
      contactEmail: 'support@playarr.com'
    };
  }

  /**
   * Get catalog for a specific type
   * Returns all titles of the specified type (no watchlist filtering - handled by Stremio UI)
   * @param {string} type - Catalog type ('movie', 'series', or 'tv')
   * @param {Object} user - User object (used for authentication only, not for filtering)
   * @param {Object} options - Query options (page, perPage, etc.)
   * @returns {Promise<Object>} Stremio catalog response
   */
  async getCatalog(type, user, options = {}) {
    try {
      // Handle Live TV type
      if (type === 'tv') {
        // Get active providers
        const activeProviders = await this._iptvProviderManager.findByQuery({
          type: { $in: ['agtv', 'xtream'] },
          enabled: { $ne: false },
          deleted: { $ne: true }
        });
        
        if (activeProviders.length === 0) {
          return { metas: [] };
        }
        
        const activeProviderIds = activeProviders.map(p => p.id);
        const channels = await this._channelManager._repository.findByQuery({
          provider_id: { $in: activeProviderIds }
        });
        
        if (!channels || channels.length === 0) {
          this.logger.warn('No channels found. Make sure Live TV sync job has run.');
          return { metas: [] };
        }
        
        const metas = channels.map(channel => {
          // Use channel_key for ID (format: live-{providerId}-{channelId})
          const encodedId = encodeURIComponent(channel.channel_key);
          return {
            id: encodedId,
            type: 'tv',
            name: channel.name,
            poster: channel.tvg_logo || null,
            background: channel.tvg_logo || null,
            logo: channel.tvg_logo || null,
            description: channel.name,
            genres: channel.group_title ? [channel.group_title] : []
          };
        });
        
        return { metas };
      }

      // Map Stremio type to Playarr type using mapping object
      const playarrType = this._typeMap[type];
      if (!playarrType) {
        this.logger.warn(`Unknown Stremio type: ${type}`);
        return { metas: [] };
      }
      
      // Query all titles of this type (no watchlist filtering - handled by Stremio UI)
      const query = { type: playarrType };
      const allTitles = await this._titlesManager.findTitlesByQuery(query, {
        sort: { title: 1 }
      });
      
      if (!allTitles || allTitles.length === 0) {
        return { metas: [] };
      }

      // Apply pagination
      const page = options.page || 1;
      const perPage = options.perPage || 100;
      const startIdx = (page - 1) * perPage;
      const endIdx = startIdx + perPage;
      const paginatedTitles = allTitles.slice(startIdx, endIdx);

      // Transform titles to Stremio format
      const metas = paginatedTitles.map(title => this._titleToStremioMeta(title, type));

      return { metas };
    } catch (error) {
      this.logger.error(`Error getting catalog for type ${type}:`, error);
      return { metas: [] };
    }
  }

  /**
   * Get metadata for a specific title
   * @param {string} type - Content type ('movie', 'series', or 'tv') - comes from endpoint path
   * @param {string} stremioId - Stremio ID (TMDB ID number, e.g., "12345", IMDB ID, e.g., "tt0133093", or channel ID for 'tv')
   * @param {Object} user - User object
   * @returns {Promise<Object>} Stremio meta response
   */
  async getMeta(type, stremioId, user) {
    // Handle Live TV type
    if (type === 'tv') {
      
      try {
        // Decode the channel key (format: live-{providerId}-{channelId})
        const decodedChannelKey = decodeURIComponent(stremioId);
        
        // Find channel by channel_key
        const channel = await this._channelManager._repository.findOneByQuery({
          channel_key: decodedChannelKey
        });
        
        if (!channel) {
          return { meta: null };
        }
        
        // Get programs for this channel
        const programs = await this._programManager._repository.findByQuery({
          provider_id: channel.provider_id,
          channel_id: channel.channel_id
        }, { sort: { start: 1 } });
        
        const now = new Date();
        const currentProgram = programs.find(p => {
          const start = p.start instanceof Date ? p.start : new Date(p.start);
          const stop = p.stop instanceof Date ? p.stop : new Date(p.stop);
          return start <= now && stop >= now;
        });
        
        // Build videos array for EPG data (required for Stremio to recognize TV channels as playable)
        const videos = programs.map(program => {
          const startTime = program.start instanceof Date ? program.start : new Date(program.start);
          const stopTime = program.stop instanceof Date ? program.stop : new Date(program.stop);
          const duration = Math.floor((stopTime - startTime) / 1000); // Duration in seconds
          
          return {
            id: `${channel.channel_key}-${startTime.getTime()}`,
            title: program.title || 'Unknown Program',
            released: startTime.toISOString(),
            duration: duration > 0 ? duration : 3600 // Default to 1 hour if duration is invalid
          };
        });
        
        // Return meta with encoded channel_key to match catalog format
        return {
          meta: {
            id: encodeURIComponent(channel.channel_key), // Match the encoded ID from catalog
            type: 'tv',
            name: channel.name,
            poster: channel.tvg_logo || null,
            background: channel.tvg_logo || null, // Use logo as background if available
            logo: channel.tvg_logo || null,
            description: currentProgram ? `Now: ${currentProgram.title}${currentProgram.desc ? ` - ${currentProgram.desc}` : ''}` : channel.name,
            genres: channel.group_title ? [channel.group_title] : [],
            videos: videos.length > 0 ? videos : [
              // Fallback: if no EPG data, provide a single "live" entry
              {
                id: `${channelId}-live`,
                title: 'Live',
                released: new Date().toISOString(),
                duration: 0 // 0 duration indicates live stream
              }
            ]
          }
        };
      } catch (error) {
        this.logger.error(`Error getting meta for TV channel ${stremioId}:`, error);
        return { meta: null };
      }
    }
    try {
      // stremioId can be a TMDB ID (numeric) or IMDB ID (starting with "tt")
      const titleKey = await this.stremioIdToTitleKey(stremioId, type);
      if (!titleKey) {
        return { meta: null };
      }

      // Use TitlesManager method instead of accessing private repository
      const title = await this._titlesManager.findTitleByQuery({ title_key: titleKey });
      
      if (!title) {
        return { meta: null };
      }

      // Normalize the title to match what _titleToStremioMeta expects
      const normalizedTitle = {
        title_key: title.title_key || titleKey,
        title: title.title || '',
        release_date: title.release_date,
        poster_path: title.poster_path,
        backdrop_path: title.backdrop_path,
        overview: title.overview,
        vote_average: title.vote_average,
        genres: title.genres || [],
        runtime: title.runtime,
        imdb_id: title.imdb_id || null,
        // Get media array from title data
        media: title.media || []
      };

      const meta = this._titleToStremioMeta(normalizedTitle, type, true);

      return { meta };
    } catch (error) {
      this.logger.error(`Error getting meta for ${type} ${stremioId}:`, error);
      return { meta: null };
    }
  }

  /**
   * Get streams for a specific title
   * @param {string} type - Content type ('movie', 'series', or 'tv') - comes from endpoint path
   * @param {string} stremioId - Stremio ID (TMDB ID number, e.g., "12345", IMDB ID, e.g., "tt0133093", episode format with dashes, e.g., "tt0133093-S01-E01", Stremio colon format, e.g., "tt7491982:1:1", or channel ID for 'tv')
   * @param {Object} user - User object
   * @param {number} [season] - Season number (for series)
   * @param {number} [episode] - Episode number (for series)
   * @param {string} baseUrl - Base URL for stream endpoints
   * @returns {Promise<Object>} Stremio stream response
   */
  async getStreams(type, stremioId, user, season = null, episode = null, baseUrl = '') {
    // Handle Live TV type
    if (type === 'tv') {
      
      try {
        // For TV channels, stremioId might be:
        // 1. Channel key (e.g., "live-provider1-channel123")
        // 2. A program ID from videos array (e.g., "live-provider1-channel123-1234567890")
        // Extract the channel key by removing the timestamp suffix if present
        let channelKeyFromRequest = decodeURIComponent(stremioId);
        
        // Check if it's a program ID (format: channelKey-timestamp)
        const programIdMatch = channelKeyFromRequest.match(/^(.+)-(\d+)$/);
        const actualChannelKey = programIdMatch ? programIdMatch[1] : channelKeyFromRequest;
        
        // Find channel by channel_key
        let channel = await this._channelManager._repository.findOneByQuery({
          channel_key: actualChannelKey
        });
        
        // If not found, try with the key as-is (in case it wasn't in program format)
        if (!channel && actualChannelKey !== channelKeyFromRequest) {
          channel = await this._channelManager._repository.findOneByQuery({
            channel_key: channelKeyFromRequest
          });
        }
        
        if (!channel) {
          return { streams: [] };
        }
        
        // Remove /stremio/{api_key} from baseUrl to get the actual API base
        const apiBase = baseUrl.replace(/\/stremio\/[^/]+$/, '');
        const channelKey = encodeURIComponent(channel.channel_key);
        const streamUrl = `${apiBase}/api/livetv/stream/${channelKey}?api_key=${user.api_key}`;
        
        // For Live TV, always return the live stream URL regardless of which program was selected
        return {
          streams: [{
            url: streamUrl,
            title: channel.name,
            behaviorHints: {
              bingeGroup: `livetv-${channel.channel_key}`
            }
          }]
        };
      } catch (error) {
        this.logger.error(`Error getting stream for TV channel ${stremioId}:`, error);
        return { streams: [] };
      }
    }
    
    try {
      // For series, stremioId might be in format "101200-S01-E01", "tt0133093-S01-E01", or "tt7491982:1:1" (Stremio colon format)
      // For movies, stremioId is just the title_id number or IMDB ID
      // Check if type is series using mapping
      const isSeries = this._typeMap[type] === this._playarrTypes.TVSHOWS;
      
      let titleId, mediaType, parsedSeason = season, parsedEpisode = episode;
      
      if (isSeries) {
        // Try to parse episode ID format: "101200-S01-E01" or "tt0133093-S01-E01"
        const episodeIdMatch = stremioId.match(/^(.+?)-S(\d+)-E(\d+)$/);
        if (episodeIdMatch) {
          // Episode ID format includes season/episode
          const idPart = episodeIdMatch[1];
          parsedSeason = parseInt(episodeIdMatch[2], 10);
          parsedEpisode = parseInt(episodeIdMatch[3], 10);
          mediaType = this._typeMap[type]; // 'tvshows'
          
          // Check if idPart is IMDB ID or TMDB ID
          if (idPart.startsWith('tt')) {
            // Look up title by imdb_id to get title_id
            const titleKey = await this.stremioIdToTitleKey(idPart, type);
            if (titleKey) {
              const match = titleKey.match(/^(movies|tvshows)-(\d+)$/);
              titleId = match ? match[2] : null;
            }
            if (!titleId) {
              return { streams: [] };
            }
          } else {
            titleId = idPart;
          }
        } else {
          // Also try Stremio's colon format: "tt7491982:1:1" or "12345:1:1"
          const colonFormatMatch = stremioId.match(/^(.+?):(\d+):(\d+)$/);
          if (colonFormatMatch) {
            const idPart = colonFormatMatch[1];
            parsedSeason = parseInt(colonFormatMatch[2], 10);
            parsedEpisode = parseInt(colonFormatMatch[3], 10);
            mediaType = this._typeMap[type]; // 'tvshows'
            
            // Check if idPart is IMDB ID or TMDB ID
            if (idPart.startsWith('tt')) {
              // Look up title by imdb_id to get title_id
              const titleKey = await this.stremioIdToTitleKey(idPart, type);
              if (titleKey) {
                const match = titleKey.match(/^(movies|tvshows)-(\d+)$/);
                titleId = match ? match[2] : null;
              }
              if (!titleId) {
                return { streams: [] };
              }
            } else {
              titleId = idPart;
            }
          } else {
            // Fallback: treat as just title_id or IMDB ID, use season/episode from query params
            if (stremioId.startsWith('tt')) {
              // Look up title by imdb_id to get title_id
              const titleKey = await this.stremioIdToTitleKey(stremioId, type);
              if (titleKey) {
                const match = titleKey.match(/^(movies|tvshows)-(\d+)$/);
                titleId = match ? match[2] : null;
              }
              if (!titleId) {
                return { streams: [] };
              }
            } else {
              titleId = stremioId;
            }
            mediaType = this._typeMap[type];
          }
        }
      } else {
        // Movie: stremioId is just the title_id or IMDB ID
        if (stremioId.startsWith('tt')) {
          // Look up title by imdb_id to get title_id
          const titleKey = await this.stremioIdToTitleKey(stremioId, type);
          if (titleKey) {
            const match = titleKey.match(/^(movies|tvshows)-(\d+)$/);
            titleId = match ? match[2] : null;
          }
          if (!titleId) {
            return { streams: [] };
          }
        } else {
          titleId = stremioId;
        }
        mediaType = this._typeMap[type]; // 'movies'
      }
      
      if (!titleId) {
        return { streams: [] };
      }
      
      // Construct title_key for validation
      const titleKey = `${mediaType}-${titleId}`;

      // Get stream URL using parsed season/episode (inherited from BaseFormattingManager)
      const streamUrl = await this.getBestSource(
        titleId,
        mediaType,
        parsedSeason,
        parsedEpisode
      );

      if (!streamUrl) {
        return { streams: [] };
      }

      // For Stremio, we need to return a stream object that points to our proxy endpoint
      // Build proxy URL that includes API key
      const proxyUrl = this._buildStreamProxyUrl(baseUrl, mediaType, titleId, parsedSeason, parsedEpisode, user.api_key);

      const streams = [{
        title: `Playarr Stream`,
        url: proxyUrl,
        behaviorHints: {
          bingeGroup: isSeries ? titleId : undefined
        }
      }];

      return { streams };
    } catch (error) {
      this.logger.error(`Error getting streams for ${type} ${stremioId}:`, error);
      return { streams: [] };
    }
  }

  /**
   * Convert Playarr title to Stremio meta format
   * @private
   * @param {Object} title - Playarr title object
   * @param {string} type - Stremio type ('movie' or 'series')
   * @param {boolean} [includeDetails=false] - Whether to include detailed information
   * @returns {Object} Stremio meta object
   */
  _titleToStremioMeta(title, type, includeDetails = false) {
    // Use IMDB ID if available, otherwise use TMDB title_id
    const stremioId = title.imdb_id || this.titleKeyToStremioId(title.title_key);
    const year = title.release_date ? new Date(title.release_date).getFullYear() : null;

    // Check types using mapping
    const isMovie = this._typeMap[type] === this._playarrTypes.MOVIES;
    const isSeries = this._typeMap[type] === this._playarrTypes.TVSHOWS;

    // Handle poster/backdrop paths - they might be full URLs from getTitleDetails or relative paths
    const posterUrl = title.poster_path 
      ? (title.poster_path.startsWith('http') ? title.poster_path : `${this._tmdbPosterBase}${title.poster_path}`)
      : undefined;
    const backdropUrl = title.backdrop_path
      ? (title.backdrop_path.startsWith('http') ? title.backdrop_path : `${this._tmdbBackdropBase}${title.backdrop_path}`)
      : undefined;

    const meta = {
      id: stremioId,
      type: type,
      name: title.title,
      poster: posterUrl,
      background: backdropUrl,
      logo: posterUrl,
      description: title.overview || undefined,
      releaseInfo: year ? `${year}` : undefined,
      imdbRating: title.vote_average ? (title.vote_average / 10).toFixed(1) : undefined,
      genres: this._extractGenres(title.genres),
      runtime: isMovie && title.runtime ? `${title.runtime} min` : undefined
    };

    // For series, add episodes info if available (use media array to determine available episodes)
    if (isSeries && includeDetails && title.media && Array.isArray(title.media) && title.media.length > 0) {
      const episodes = this._extractEpisodes(title);
      if (episodes.length > 0) {
        meta.episodes = episodes;
      }
    }

    return meta;
  }

  /**
   * Reconstruct streams array from flatStreams array
   * @private
   * @param {Array} flatStreams - Array of stream objects from getTitleDetails
   * @returns {Array<string>} Array of stream IDs
   */
  _reconstructStreamsArray(flatStreams) {
    return flatStreams.map(stream => stream.id).filter(Boolean);
  }

  /**
   * Reconstruct episodes object from flatStreams array
   * @private
   * @param {Array} flatStreams - Array of stream objects from getTitleDetails
   * @returns {Object} Episodes object with "S01-E01" keys
   */
  _reconstructEpisodes(flatStreams) {
    const episodes = {};
    for (const stream of flatStreams) {
      if (stream.id && stream.season !== null && stream.episode !== null) {
        episodes[stream.id] = {
          name: stream.name,
          overview: stream.overview,
          air_date: stream.air_date,
          still_path: stream.still_path
        };
      }
    }
    return episodes;
  }

  /**
   * Extract genres from title
   * @private
   * @param {Array} genres - Genres array
   * @returns {Array<string>} Array of genre names
   */
  _extractGenres(genres) {
    if (!genres || !Array.isArray(genres)) {
      return [];
    }
    return genres.map(g => typeof g === 'string' ? g : g.name).filter(Boolean);
  }

  /**
   * Extract episodes from title media array
   * Only includes episodes that have sources available
   * @private
   * @param {Object} title - Playarr title object
   * @returns {Array<Object>} Array of episode objects
   */
  _extractEpisodes(title) {
    // Media is now an array of media items that have sources available
    const media = title.media || [];

    if (!Array.isArray(media) || media.length === 0) {
      return [];
    }

    const episodeList = [];
    for (const mediaItem of media) {
      // Skip movies (they don't have season/episode)
      if (mediaItem.season === null || mediaItem.season === undefined ||
          mediaItem.episode === null || mediaItem.episode === undefined) {
        continue;
      }

      const season = mediaItem.season;
      const episode = mediaItem.episode;
      
      // Handle still_path - might be full URL or relative path
      const thumbnailUrl = mediaItem.still_path
        ? (mediaItem.still_path.startsWith('http') 
            ? mediaItem.still_path 
            : `https://image.tmdb.org/t/p/w300${mediaItem.still_path}`)
        : undefined;

      // Extract title_id from title_key (e.g., "tvshows-101200" -> "101200")
      const titleIdMatch = title.title_key.match(/^(movies|tvshows)-(\d+)$/);
      const titleId = titleIdMatch ? titleIdMatch[2] : null;
      
      // Use IMDB ID format if available (Stremio colon format: "tt0295064:2:4")
      // Otherwise use TMDB title_id format: "15183-S02-E04"
      const seasonStr = String(season).padStart(2, '0');
      const episodeStr = String(episode).padStart(2, '0');
      let episodeId;
      
      if (title.imdb_id) {
        // Use IMDB ID with colon format: "tt0295064:2:4"
        episodeId = `${title.imdb_id}:${season}:${episode}`;
      } else if (titleId) {
        // Fallback to TMDB format: "15183-S02-E04"
        episodeId = `${titleId}-S${seasonStr}-E${episodeStr}`;
      } else {
        // Last resort: use title_key format
        episodeId = `${title.title_key}-S${seasonStr}-E${episodeStr}`;
      }
      
      const episodeObj = {
        id: episodeId,
        season: season,
        episode: episode,
        title: mediaItem.name || `Episode ${episode}`,
        overview: mediaItem.overview || undefined,
        released: mediaItem.air_date || undefined,
        thumbnail: thumbnailUrl
      };

      episodeList.push(episodeObj);
    }

    return episodeList.sort((a, b) => {
      if (a.season !== b.season) return a.season - b.season;
      return a.episode - b.episode;
    });
  }

  /**
   * Build stream proxy URL
   * @private
   * @param {string} baseUrl - Base URL
   * @param {string} mediaType - Media type ('movies' or 'tvshows')
   * @param {string} titleId - Title ID
   * @param {number|null} season - Season number
   * @param {number|null} episode - Episode number
   * @param {string} apiKey - User API key
   * @returns {string} Stream proxy URL
   */
  _buildStreamProxyUrl(baseUrl, mediaType, titleId, season, episode, apiKey) {
    // Remove /stremio/{api_key} from baseUrl to get the actual API base
    const apiBase = baseUrl.replace(/\/stremio\/[^/]+$/, '');
    
    // Check media type using constant
    const isMovies = mediaType === this._playarrTypes.MOVIES;
    
    if (isMovies) {
      return `${apiBase}/api/stream/movies/${titleId}?api_key=${encodeURIComponent(apiKey)}`;
    } else {
      return `${apiBase}/api/stream/tvshows/${titleId}/${season}/${episode}?api_key=${encodeURIComponent(apiKey)}`;
    }
  }
}

export { StremioManager };

