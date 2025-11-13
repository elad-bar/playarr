import { BaseIPTVProvider } from './BaseIPTVProvider.js';
import { serverApiClient } from '../utils/serverApiClient.js';

/**
 * Xtream Codec provider implementation
 * Fetches movies and TV shows via Xtream API with extended information support
 * @extends {BaseIPTVProvider}
 */
export class XtreamProvider extends BaseIPTVProvider {
  /**
   * @param {Object} providerData - Provider configuration data
   * @param {import('../managers/StorageManager.js').StorageManager} cache - Storage manager instance for temporary cache
   * @param {import('../managers/StorageManager.js').StorageManager} data - Storage manager instance for persistent data storage
   * @param {import('../services/MongoDataService.js').MongoDataService} mongoData - MongoDB data service instance
   * @param {import('../providers/TMDBProvider.js').TMDBProvider} tmdbProvider - TMDB provider instance for matching TMDB IDs (required)
   */
  constructor(providerData, cache, data, mongoData, tmdbProvider) {
    super(providerData, cache, data, mongoData, undefined, tmdbProvider);
    
    // Xtream supports categories
    this.supportsCategories = true;
        
    /**
     * Configuration for each media type
     * @private
     * @type {Object<string, Object>}
     */
    this._typeConfig = {
      movies: {
        enabled: true,
        categoryAction: 'get_vod_categories',
        metadataAction: 'get_vod_streams',
        dataKey: 'movie_data',
        cacheKey: 'movies',
        extendedInfoAction: 'get_vod_info',
        extendedInfoParam: 'vod_id',
        idField: 'stream_id',
        mediaEndpoint: 'movie',
        shouldCheckUpdates: false, // Movies skip existing, no update check needed
        shouldSkip: this._shouldSkipMovies.bind(this),
        parseExtendedInfo: this._parseExtendedInfoMovies.bind(this)
      },
      tvshows: {
        enabled: true,
        categoryAction: 'get_series_categories',
        metadataAction: 'get_series',
        dataKey: 'series_data',
        cacheKey: 'series',
        extendedInfoAction: 'get_series_info',
        extendedInfoParam: 'series_id',
        idField: 'series_id',
        mediaEndpoint: 'series',
        shouldCheckUpdates: false, // Not used - modification dates are checked during filtering
        shouldSkip: this._shouldSkipTVShows.bind(this),
        parseExtendedInfo: this._parseExtendedInfoTVShows.bind(this)
      },
      live: {
        enabled: false, // Future support for live streams
        categoryAction: 'get_live_categories',
        metadataAction: 'get_live_streams',
        dataKey: 'streams',
        cacheKey: 'live',
        extendedInfoAction: null, // Live streams may not have extended info
        extendedInfoParam: null,
        idField: 'stream_id',
        shouldCheckUpdates: false,
        shouldSkip: this._shouldSkipLive.bind(this),
        parseExtendedInfo: this._parseExtendedInfoLive.bind(this)
      }
    };
  }

  /**
   * Check if a TV show title should be skipped (not modified)
   * @private
   * @param {TitleData} title - Title data to check
   * @param {Object|null} existingTitle - Existing title object from DB (null if doesn't exist)
   * @returns {boolean} True if title should be skipped
   */
  _shouldSkipTVShows(title, existingTitle) {
    // If title doesn't exist, process it
    if (!existingTitle) {
      return false;
    }
    
    // Skip if not modified since last update
    if (existingTitle.lastUpdated) {
      const showModified = title.info?.modified || title.modified;
      if (showModified) {
        const showModifiedTime = new Date(showModified).getTime();
        const existingUpdatedTime = new Date(existingTitle.lastUpdated).getTime();
        if (showModifiedTime <= existingUpdatedTime) {
          return true; // Skip if not modified
        }
      }
    }
    
    return false;
  }

  /**
   * Check if a live stream title should be skipped (already exists)
   * @private
   * @param {TitleData} title - Title data to check
   * @param {Object|null} existingTitle - Existing title object from DB (null if doesn't exist)
   * @returns {boolean} True if title should be skipped
   */
  _shouldSkipLive(title, existingTitle) {
    // Skip if already exists
    if (existingTitle) {
      return true;
    }
    
    return false;
  }

  /**
   * Parse and enrich extended info for movies
   * Extracts metadata fields and builds stream URL for the movie
   * @private
   * @param {TitleData} title - Title data to enrich
   * @param {Object} extResponse - Extended info API response
   */
  _parseExtendedInfoMovies(title, extResponse) {
    const config = this._typeConfig.movies;
    const movieData = extResponse.movie_data;

    if(!movieData) {
      throw new Error('No movie data found in extended info response');
    }

    const extInfo = extResponse.info;

    if(!extInfo) {
      throw new Error('No extended info found in extended info response');
    }
    
    // Initialize streams object
    if (!title.streams) {
      title.streams = {};
    }

    // Build stream URL for movie
    const streamId = movieData.stream_id;
    const containerExtension = movieData.container_extension;

    if(!streamId) {
      throw new Error('No stream ID found in movie data');
    }
    
    title.streams.main = this._buildStreamUrl(streamId, containerExtension, config.mediaEndpoint);

    // Extract and store metadata fields directly on title object
    // Ensure tmdb_id is stored as a number if it exists and is not null
    title.tmdb_id = extInfo.tmdb_id != null ? Number(extInfo.tmdb_id) : null;
    title.release_date = extInfo.releasedate;
  }

  /**
   * Parse and enrich extended info for TV shows
   * Extracts episodes, builds stream URLs for each episode, and extracts metadata fields
   * @private
   * @param {TitleData} title - Title data to enrich
   * @param {Object} extResponse - Extended info API response
   */
  _parseExtendedInfoTVShows(title, extResponse) {
    const config = this._typeConfig.tvshows;
    const seasonsData = extResponse.seasons;

    if(!seasonsData) {
      throw new Error('No seasons data found in extended info response');
    }

    const extInfo = extResponse.info;

    if(!extInfo) {
      throw new Error('No extended info found in extended info response');
    }

    const episodesData = extResponse.episodes;

    if(!episodesData) {
      throw new Error('No episodes found in extended info response');
    }

    if(typeof episodesData !== 'object') {
      throw new Error('Episodes data is not an object');
    }

    let episodesList = Object.values(episodesData).flat();

    // Initialize streams object
    if (!title.streams) {
      title.streams = {};
    }

    // Build stream URLs for each episode
    const seriesId = title.series_id;
    
    if (seriesId && episodesList.length > 0) {
      episodesList.forEach(episode => {
        const season = episode.season_num || episode.season || 1;
        const episodeNum = episode.episode_num || episode.episode || 1;
        
        // Format key as Sxx-Exx (e.g., S01-E01)
        const seasonStr = String(season).padStart(2, '0');
        const episodeStr = String(episodeNum).padStart(2, '0');
        const key = `S${seasonStr}-E${episodeStr}`;

        // Build stream URL using episode ID
        const episodeId = episode.id;
        // Use episode's container_extension
        const episodeContainerExtension = episode.container_extension || 'mp4';
        
        if (episodeId) {
          const streamUrl = this._buildStreamUrl(episodeId, episodeContainerExtension, config.mediaEndpoint);
          if (streamUrl) {
            title.streams[key] = streamUrl;
          }
        }
      });
    }

    // Extract and store metadata fields directly on title object (only release_date for TV shows)
    title.release_date = extInfo.releaseDate;
  }

  /**
   * Parse and enrich extended info for live streams
   * @private
   * @param {TitleData} title - Title data to enrich
   * @param {Object} extResponse - Extended info API response
   */
  _parseExtendedInfoLive(title, extResponse) {
    // Live streams may not have extended info parsing
  }

  /**
   * Get default cache policies for Xtream provider
   * Cache policies are now handled by server, return empty object
   * @returns {Object} Empty cache policy object
   */
  getDefaultCachePolicies() {
    return {};
  }

  /**
   * @returns {string} 'xtream'
   * @override
   */
  getProviderType() {
    return 'xtream';
  }

  /**
   * Build stream URL for any media type
   * Format: /{media_endpoint}/{username}/{password}/{stream_id}.{ext}
   * Returns relative path only (base URL will be added later when needed)
   * @private
   * @param {string} streamId - Stream ID (movie ID or episode ID)
   * @param {string} containerExtension - Container extension (e.g., 'mp4', 'mkv')
   * @param {string} mediaEndpoint - Media endpoint ('movie' or 'series')
   * @returns {string|null} Relative stream URL path or null if streamId is missing
   */
  _buildStreamUrl(streamId, containerExtension, mediaEndpoint) {
    if (!streamId) {
      return null;
    }

    const username = this.providerData.username;
    const password = this.providerData.password;
    const extension = containerExtension || 'mp4';
    const resource = `${streamId}.${extension}`;
    
    return `/${mediaEndpoint}/${username}/${password}/${resource}`;
  }



  /**
   * Fetch titles metadata from server API
   * @private
   * @param {string} type - Media type ('movies', 'tvshows', or 'live')
   * @returns {Promise<Array>} Array of raw title objects
   */
  async _fetchTitlesMetadata(type) {
    const config = this._typeConfig[type];
    if (!config) {
      throw new Error(`Unsupported type: ${type}`);
    }

    // Skip if type is disabled
    if (!config.enabled) {
      return [];
    }

    // Fetch metadata from server API
    const response = await serverApiClient.fetchMetadata(this.providerId, type);
    
    // Extract array from response (Xtream API may return object with dataKey or array directly)
    let titles = [];
    if (Array.isArray(response)) {
      titles = response;
    } else if (response && response[config.dataKey]) {
      titles = response[config.dataKey];
    } else {
      throw new Error(`Unexpected response format from server API for ${type}: expected array or object with ${config.dataKey}`);
    }
    
    this.logger.info(`${type}: Loaded ${titles.length} titles`);

    return titles;
  }


  /**
   * Process a single title: fetch extended info and clean title name
   * @private
   * @param {Object} title - Title object to process
   * @param {string} type - Media type ('movies', 'tvshows', or 'live')
   * @returns {Promise<Object|null>} Processed title object or null if should be skipped
   */
  async _processSingleTitle(title, type, processedTitles) {
    const config = this._typeConfig[type];
    if (!config) {
      throw new Error(`Unsupported type: ${type}`);
    }

    const titleData = title;
    const titleId = titleData[config.idField];
    this.logger.debug(`${type}: Processing title ${titleId}`);

    // Fetch extended info
    if (!config.extendedInfoAction) {
      this.logger.debug(`${type}: No extended info action for title ${titleId}`);
      // Still need to match TMDB ID and build processed data even if no extended info
      titleData.type = type;
    } else {
      try {
        this.logger.debug(`${type}: Fetching extended info for title ${titleId}`);

        // Fetch extended info from server API
        const fullResponseData = await serverApiClient.fetchExtendedInfo(
          this.providerId,
          type,
          titleId
        );

        if (config.parseExtendedInfo) {
          config.parseExtendedInfo(titleData, fullResponseData);
        }

        // Clean title name
        if (titleData.name) {
          titleData.name = this.cleanupTitle(titleData.name);
        }
      } catch (error) {
        const errorMessage = error.message || 'Unknown error';
        this.logger.warn(`Failed to fetch extended info for ${type} ${titleId}: ${errorMessage}`);
        
        // Mark as ignored but still save to database
        const reason = `Extended info fetch failed: ${errorMessage}`;
        titleData.ignored = true;
        titleData.ignored_reason = reason;
        this.addIgnoredTitle(type, titleId, reason);
        // Continue processing so title gets saved with ignored flag
      }
    }

    // Ensure type is set
    titleData.type = type;

    // Match TMDB ID if needed (common logic from BaseIPTVProvider)
    // This will set ignored flags on titleData if matching fails, but still return true
    await this._matchAndUpdateTMDBId(titleData, type, titleId);

    // Always build and save the processed title, even if it has ignored: true
    const processedTitle = this._buildProcessedTitleData(titleData, type);
    
    // Push to processedTitles array
    processedTitles.push(processedTitle);
    
    return true;
  }

  /**
   * Build processed title data object with only required fields
   * @private
   * @param {Object} title - Title object after processing
   * @param {string} type - Media type ('movies', 'tvshows', or 'live')
   * @returns {Object} Clean title data object
   */
  _buildProcessedTitleData(title, type) {
    const config = this._typeConfig[type];
    if (!config) {
      throw new Error(`Unsupported type: ${type}`);
    }

    return {
      title_id: title[config.idField] || null,
      title: title.name,
      tmdb_id: title.tmdb_id || null,
      category_id: title.category_id || null,
      release_date: title.release_date || null,
      streams: title.streams || {},
      ignored: title.ignored || false,
      ignored_reason: title.ignored_reason || null
    };
  }

}

