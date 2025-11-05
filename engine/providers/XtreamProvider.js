import { BaseIPTVProvider } from './BaseIPTVProvider.js';

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
   */
  constructor(providerData, cache, data) {
    super(providerData, cache, data);
        
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
   * Check if a movie title should be skipped (already exists or category disabled)
   * @private
   * @param {TitleData} title - Title data to check
   * @param {Set} existingTitleMap - Set of existing title IDs
   * @param {Map<number, boolean>} categoryMap - Map of category ID to enabled status
   * @returns {boolean} True if title should be skipped
   */
  _shouldSkipMovies(title, existingTitleMap, categoryMap) {
    const config = this._typeConfig.movies;
    
    // Skip if already exists
    if (existingTitleMap.has(title[config.idField])) {
      return true;
    }
    
    // Skip if category is disabled
    const categoryId = title.category_id;
    const categoryEnabled = categoryMap.get(categoryId) ?? false;
    return !categoryEnabled;
  }

  /**
   * Check if a TV show title should be skipped (not modified or category disabled)
   * @private
   * @param {TitleData} title - Title data to check
   * @param {Map} existingTitleMap - Map of existing titles with lastUpdated timestamps
   * @param {Map<number, boolean>} categoryMap - Map of category ID to enabled status
   * @returns {boolean} True if title should be skipped
   */
  _shouldSkipTVShows(title, existingTitleMap, categoryMap) {
    const config = this._typeConfig.tvshows;
    const seriesId = title[config.idField];
    
    // Handle both Set and Map (for backward compatibility)
    let existing = null;
    if (existingTitleMap instanceof Map) {
      existing = existingTitleMap.get(seriesId);
    } else if (existingTitleMap instanceof Set) {
      // If it's a Set, we can't check lastUpdated, so just check if it exists
      if (existingTitleMap.has(seriesId)) {
        return true; // Skip if exists (for Set, we can't check modification date)
      }
    }
    
    // Skip if not modified since last update (only if we have a Map with lastUpdated)
    if (existing && existing.lastUpdated) {
      const showModified = title.info?.modified || title.modified;
      if (showModified) {
        const showModifiedTime = new Date(showModified).getTime();
        const existingUpdatedTime = new Date(existing.lastUpdated).getTime();
        if (showModifiedTime <= existingUpdatedTime) {
          return true; // Skip if not modified
        }
      }
    }
    
    // Skip if category is disabled
    const categoryId = title.category_id;
    const categoryEnabled = categoryMap.get(categoryId) ?? false;
    return !categoryEnabled;
  }

  /**
   * Check if a live stream title should be skipped (already exists or category disabled)
   * @private
   * @param {TitleData} title - Title data to check
   * @param {Set} existingTitleMap - Set of existing title IDs
   * @param {Map<number, boolean>} categoryMap - Map of category ID to enabled status
   * @returns {boolean} True if title should be skipped
   */
  _shouldSkipLive(title, existingTitleMap, categoryMap) {
    const config = this._typeConfig.live;
    
    // Skip if already exists
    if (existingTitleMap.has(title[config.idField])) {
      return true;
    }
    
    // Skip if category is disabled
    const categoryId = title.category_id;
    const categoryEnabled = categoryMap.get(categoryId) ?? false;
    return !categoryEnabled;
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
   * @private
   * @param {string} action
   * @param {Object} [params={}]
   * @returns {string}
   */
  _getApiUrl(action, params = {}) {
    const baseUrl = this.providerData.api_url;
    const username = this.providerData.username;
    const password = this.providerData.password;
    
    const queryParams = new URLSearchParams({
      username,
      password,
      action,
      ...params
    });

    return `${baseUrl}/player_api.php?${queryParams.toString()}`;
  }

  /**
   * Fetch categories from Xtream provider
   * Raw API data is cached for 1 hour, enabled status comes from data directory
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Promise<Array<{category_id: number, category_name: string, enabled: boolean}>>} Array of category data
   * @override
   */
  async fetchCategories(type) {
    try {
      const config = this._typeConfig[type];
      if (!config) {
        throw new Error(`Unsupported type: ${type}`);
      }

      // Skip if type is disabled
      if (!config.enabled) {
        return [];
      }

      // Fetch categories from API with caching
      const categoriesUrl = this._getApiUrl(config.categoryAction);
      const categoriesResponse = await this.fetchWithCache(
        categoriesUrl,
        [this.providerId, 'categories', `${type}.json`]
      );
      
      // Normalize raw categories to standard format
      const normalizedCategories = categoriesResponse.map(cat => ({
        category_id: cat.category_id || cat.id,
        category_name: cat.category_name || cat.name
      }));

      this.logger.debug(`${type}: Normalized categories: ${normalizedCategories.length}`);

      // Merge with data directory to get enabled status
      this.saveCategories(type, normalizedCategories);
      
      // Load merged categories with enabled status from data directory
      const categoriesWithStatus = this.loadCategories(type);
      
      return categoriesWithStatus;
    } catch (error) {
      this.logger.error(`Error fetching ${type} categories: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fetch titles metadata from cache or API
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

    const metadataUrl = this._getApiUrl(config.metadataAction);
    const responseData = await this.fetchWithCache(
      metadataUrl,
      [this.providerId, 'metadata', `${type}.json`]
    );
    
    // Handle both array and object formats for backward compatibility
    let titles = [];
    if (Array.isArray(responseData)) {
      titles = responseData;
    } else if (responseData && responseData[config.dataKey]) {
      titles = responseData[config.dataKey];
    } else if (responseData && typeof responseData === 'object') {
      // Fallback: try to extract any array from the response
      const keys = Object.keys(responseData);
      const arrayKey = keys.find(key => Array.isArray(responseData[key]));
      if (arrayKey) {
        titles = responseData[arrayKey];
      }
    }

    this.logger.info(`${type}: Loaded ${titles.length} titles`);

    return titles;
  }

  /**
   * Filter titles based on existing titles and category enabled status
   * @private
   * @param {Array} titles - Array of raw title objects
   * @param {string} type - Media type ('movies', 'tvshows', or 'live')
   * @returns {Promise<Array>} Array of filtered title objects
   */
  async _filterTitles(titles, type) {
    const config = this._typeConfig[type];
    if (!config) {
      throw new Error(`Unsupported type: ${type}`);
    }

    this.logger.debug(`${type}: Filtering titles`);

    // Load existing titles and categories for filtering decisions
    const existingTitles = this.loadTitles(type);
    
    // Load ignored titles to skip them
    const ignoredTitles = this.loadIgnoredTitles(type);
    
    // Create appropriate data structure for checking existing titles
    const existingTitleMap = config.shouldCheckUpdates
      ? new Map(existingTitles.map(t => [
          t.title_id,
          { lastUpdated: t.lastUpdated }
        ]))
      : new Set(existingTitles.map(t => t.title_id));

    // Load categories for filtering
    const categories = this.loadCategories(type);
    const categoryMap = new Map(categories.map(cat => [cat.category_id, cat.enabled]));

    // Filter titles using existing shouldSkip function and ignore list
    const filteredTitles = titles.filter(title => {
      const titleId = title[config.idField];
      
      // Skip if already ignored
      if (titleId && ignoredTitles.hasOwnProperty(titleId)) {
        this.logger.debug(`${type}: Skipping ignored title ${titleId}: ${ignoredTitles[titleId]}`);
        return false;
      }
      
      return titleId && !config.shouldSkip(title, existingTitleMap, categoryMap);
    });
    
    this.logger.info(`${type}: Filtered to ${filteredTitles.length} titles to process`);

    return filteredTitles;
  }

  /**
   * Process a single title: fetch extended info and clean title name
   * @private
   * @param {Object} title - Title object to process
   * @param {string} type - Media type ('movies', 'tvshows', or 'live')
   * @returns {Promise<Object|null>} Processed title object or null if should be skipped
   */
  async _processSingleTitle(title, type) {
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
      return titleData;
    }
    
    try {
      const extendedUrl = this._getApiUrl(config.extendedInfoAction, {
        [config.extendedInfoParam]: titleId
      });

      this.logger.debug(`${type}: Fetching extended info for title ${titleId}`);

      // Use different TTL for movies (Infinity) vs tvshows (6h)
      const ttlHours = type === 'movies' ? null : 6;
      
      const fullResponseData = await this.fetchWithCache(
        extendedUrl,
        [this.providerId, 'extended', type, `${titleId}.json`],
        ttlHours
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
      
      // Add to ignored list since extended info fetch failure indicates content issue
      this.addIgnoredTitle(type, titleId, `Extended info fetch failed: ${errorMessage}`);
      
      return null;
    }        

    return titleData;
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
      streams: title.streams || {}
    };
  }

}

