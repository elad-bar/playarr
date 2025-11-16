import { BaseManager } from './BaseManager.js';

/**
 * Stremio manager for handling Stremio addon data transformation
 * Converts Playarr data format to Stremio addon protocol format
 */
class StremioManager extends BaseManager {
  /**
   * @param {import('./titles.js').TitlesManager} titlesManager - Titles manager instance
   * @param {import('./stream.js').StreamManager} streamManager - Stream manager instance
   * @param {import('./users.js').UserManager} userManager - User manager instance
   */
  constructor(titlesManager, streamManager, userManager) {
    super('StremioManager');
    this._titlesManager = titlesManager;
    this._streamManager = streamManager;
    this._userManager = userManager;
    this._tmdbPosterBase = 'https://image.tmdb.org/t/p/w300';
    this._tmdbBackdropBase = 'https://image.tmdb.org/t/p/w1280';
    
    // Type mapping: Stremio type -> Playarr type
    this._typeMap = {
      movie: 'movies',
      series: 'tvshows'
    };
    
    // Playarr type constants
    this._playarrTypes = {
      MOVIES: 'movies',
      TVSHOWS: 'tvshows'
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
   * @param {Object} user - User object with first_name and last_name
   * @returns {Object} Stremio manifest object
   */
  getManifest(baseUrl, user = null) {
    // Build personalized addon name
    let addonName = 'Playarr';
    if (user && (user.first_name || user.last_name)) {
      const nameParts = [];
      if (user.first_name) nameParts.push(user.first_name);
      if (user.last_name) nameParts.push(user.last_name);
      if (nameParts.length > 0) {
        addonName = `Playarr (${nameParts.join(' ')})`;
      }
    }

    return {
      id: 'com.playarr.addon',
      version: '1.0.0',
      name: addonName,
      description: 'Playarr IPTV streaming addon',
      resources: [
        {
          name: 'catalog',
          types: ['movie', 'series']
        },
        {
          name: 'meta',
          types: ['movie', 'series']
        },
        {
          name: 'stream',
          types: ['movie', 'series']
        }
      ],
      types: ['movie', 'series'],
      catalogs: [
        {
          type: 'movie',
          id: 'top',
          name: 'Playarr Movies'
        },
        {
          type: 'series',
          id: 'top',
          name: 'Playarr Series'
        }
      ],
      background: `${baseUrl}/background.jpg`,
      logo: `${baseUrl}/logo.png`,
      contactEmail: 'support@playarr.com'
    };
  }

  /**
   * Get catalog for a specific type
   * Returns all titles of the specified type (no watchlist filtering - handled by Stremio UI)
   * @param {string} type - Catalog type ('movie' or 'series')
   * @param {Object} user - User object (used for authentication only, not for filtering)
   * @param {Object} options - Query options (page, perPage, etc.)
   * @returns {Promise<Object>} Stremio catalog response
   */
  async getCatalog(type, user, options = {}) {
    try {
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
   * @param {string} type - Content type ('movie' or 'series') - comes from endpoint path
   * @param {string} stremioId - Stremio ID (TMDB ID number, e.g., "12345", or IMDB ID, e.g., "tt0133093")
   * @param {Object} user - User object
   * @returns {Promise<Object>} Stremio meta response
   */
  async getMeta(type, stremioId, user) {
    try {
      // stremioId can be a TMDB ID (numeric) or IMDB ID (starting with "tt")
      const titleKey = await this.stremioIdToTitleKey(stremioId, type);
      if (!titleKey) {
        return { meta: null };
      }

      // Get title details
      const result = await this._titlesManager.getTitleDetails(titleKey, user);
      
      // getTitleDetails returns details directly in result.response, not result.response.title
      if (result.statusCode !== 200 || !result.response) {
        return { meta: null };
      }

      // Normalize the response from getTitleDetails to match what _titleToStremioMeta expects
      const details = result.response;
      const normalizedTitle = {
        title_key: details.key || titleKey,
        title: details.name || '',
        release_date: details.release_date,
        poster_path: details.poster_path,
        backdrop_path: details.backdrop_path,
        overview: details.overview,
        vote_average: details.vote_average,
        genres: details.genres || [],
        runtime: details.runtime,
        imdb_id: details.imdb_id || null,
        // Reconstruct streams object from flatStreams for episode extraction
        streams: this._reconstructStreamsFromFlat(details.streams || [])
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
   * @param {string} type - Content type ('movie' or 'series') - comes from endpoint path
   * @param {string} stremioId - Stremio ID (TMDB ID number, e.g., "12345", IMDB ID, e.g., "tt0133093", episode format with dashes, e.g., "tt0133093-S01-E01", or Stremio colon format, e.g., "tt7491982:1:1")
   * @param {Object} user - User object
   * @param {number} [season] - Season number (for series)
   * @param {number} [episode] - Episode number (for series)
   * @param {string} baseUrl - Base URL for stream endpoints
   * @returns {Promise<Object>} Stremio stream response
   */
  async getStreams(type, stremioId, user, season = null, episode = null, baseUrl = '') {
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

      // Get stream URL using parsed season/episode
      const streamUrl = await this._streamManager.getBestSource(
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

    // For series, add episodes info if available
    if (isSeries && includeDetails && title.streams) {
      const episodes = this._extractEpisodes(title);
      if (episodes.length > 0) {
        meta.episodes = episodes;
      }
    }

    return meta;
  }

  /**
   * Reconstruct streams object from flatStreams array for episode extraction
   * @private
   * @param {Array} flatStreams - Array of stream objects from getTitleDetails
   * @returns {Object} Streams object with "S01-E01" keys
   */
  _reconstructStreamsFromFlat(flatStreams) {
    const streams = {};
    for (const stream of flatStreams) {
      if (stream.season !== null && stream.episode !== null) {
        const seasonStr = String(stream.season).padStart(2, '0');
        const episodeStr = String(stream.episode).padStart(2, '0');
        const streamId = `S${seasonStr}-E${episodeStr}`;
        streams[streamId] = {
          name: stream.name,
          overview: stream.overview,
          air_date: stream.air_date,
          still_path: stream.still_path
        };
      }
    }
    return streams;
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
   * Extract episodes from title streams
   * @private
   * @param {Object} title - Playarr title object
   * @returns {Array<Object>} Array of episode objects
   */
  _extractEpisodes(title) {
    if (!title.streams || typeof title.streams !== 'object') {
      return [];
    }

    const episodes = [];
    for (const [streamId, streamData] of Object.entries(title.streams)) {
      // Parse streamId like "S01-E01"
      const match = streamId.match(/^S(\d+)-E(\d+)$/);
      if (!match) continue;

      const [, season, episode] = match;
      // Handle still_path - might be full URL or relative path
      const thumbnailUrl = streamData.still_path
        ? (streamData.still_path.startsWith('http') 
            ? streamData.still_path 
            : `https://image.tmdb.org/t/p/w300${streamData.still_path}`)
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
        episodeId = `${title.imdb_id}:${parseInt(season, 10)}:${parseInt(episode, 10)}`;
      } else if (titleId) {
        // Fallback to TMDB format: "15183-S02-E04"
        episodeId = `${titleId}-S${seasonStr}-E${episodeStr}`;
      } else {
        // Last resort: use title_key format
        episodeId = `${title.title_key}-S${seasonStr}-E${episodeStr}`;
      }
      
      const episodeObj = {
        id: episodeId,
        season: parseInt(season, 10),
        episode: parseInt(episode, 10),
        title: streamData.name || `Episode ${episode}`,
        overview: streamData.overview || undefined,
        released: streamData.air_date || undefined,
        thumbnail: thumbnailUrl
      };

      episodes.push(episodeObj);
    }

    return episodes.sort((a, b) => {
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

