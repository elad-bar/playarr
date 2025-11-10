import axios from 'axios';
import { BaseIPTVProvider } from './BaseIPTVProvider.js';

/**
 * Apollo Group TV provider implementation
 * Fetches movies and TV shows via M3U8 format
 * @extends {BaseIPTVProvider}
 */
export class AGTVProvider extends BaseIPTVProvider {
  /**
   * @param {Object} providerData - Provider configuration data
   * @param {import('../managers/StorageManager.js').StorageManager} cache - Storage manager instance for temporary cache
   * @param {import('../managers/StorageManager.js').StorageManager} data - Storage manager instance for persistent data storage
   * @param {import('../services/MongoDataService.js').MongoDataService} mongoData - MongoDB data service instance
   * @param {import('../providers/TMDBProvider.js').TMDBProvider} tmdbProvider - TMDB provider instance for matching TMDB IDs (required)
   */
  constructor(providerData, cache, data, mongoData, tmdbProvider) {
    // AGTV uses 10k batch size since everything is in-memory and extremely fast
    super(providerData, cache, data, mongoData, 500, tmdbProvider);
        
    /**
     * Configuration for each media type
     * @private
     * @type {Object<string, Object>}
     */
    this._typeConfig = {
      movies: {
        enabled: true,
        idField: 'stream_id',
        shouldSkip: this._shouldSkipMovies.bind(this),
        mediaTypeSegment: 'movies',
        isPaginated: false,
        parseFunction: this._parseM3U8Movies.bind(this)
      },
      tvshows: {
        enabled: true,
        idField: 'stream_id',
        shouldSkip: this._shouldSkipTVShows.bind(this),
        mediaTypeSegment: 'tvshows',
        isPaginated: true,
        pageSizeThreshold: 5000, // Continue pagination if >= this many items
        parseFunction: this._parseM3U8TVShows.bind(this)
      }
    };
  }

  /**
   * Get default cache policies for AGTV provider
   * @returns {Object} Cache policy object
   */
  getDefaultCachePolicies() {
    const providerId = this.providerId;
    return {
      [`${providerId}/movies/metadata`]: 6,           // 6 hours (for M3U8 list.m3u8)
      [`${providerId}/tvshows/metadata`]: 6,          // 6 hours (for M3U8 list-{page}.m3u8)
    };
  }

  /**
   * @returns {string} 'agtv'
   * @override
   */
  getProviderType() {
    return 'agtv';
  }

  /**
   * Fetch categories from AGTV provider
   * AGTV doesn't support categories via API, returns empty array
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Promise<Array>} Empty array (categories not supported)
   * @override
   */
  async fetchCategories(type) {
    // AGTV doesn't have category API, return empty array
    return [];
  }

  /**
   * Extract season/episode from title name (e.g., "Show Name S01 E01" -> "S01-E01")
   * @private
   * @param {string} titleName - Title name that may contain season/episode
   * @returns {string|null} Formatted season/episode key (e.g., "S01-E01") or null if not found
   */
  _extractSeasonEpisode(titleName) {
    // Match pattern like "S01 E01", "S1 E1", etc.
    const match = titleName.match(/S(\d+)\s+E(\d+)/i);
    if (!match) {
      return null;
    }

    const season = String(match[1]).padStart(2, '0');
    const episode = String(match[2]).padStart(2, '0');
    return `S${season}-E${episode}`;
  }

  /**
   * Parse M3U8 content for movies
   * Each stream is a separate title
   * @private
   * @param {Array<Object>} streams - Array of stream objects with metadata and URL
   * @returns {TitleData[]} Array of parsed title data objects
   */
  _parseM3U8Movies(streams) {
    const titles = [];

    for (const stream of streams) {
      const streamUrl = stream.url;
      const tvgId = stream['tvg-id'];
      const tvgName = stream['tvg-name'];
      const tvgType = stream['tvg-type'];
      const groupTitle = stream['group-title'];
      
      const title = {
        stream_id: tvgId, // Use tvg-id as title_id
        name: tvgName,
        title: stream.titleName,
        type: tvgType,
        streams: {
          main: streamUrl
        },
        category_name: groupTitle
      };

      titles.push(title);
    }

    return titles;
  }

  /**
   * Parse M3U8 content for TV shows
   * Groups streams by tvg-id, extracts season/episode from name
   * @private
   * @param {Array<Object>} streams - Array of stream objects with metadata and URL
   * @returns {TitleData[]} Array of parsed title data objects
   */
  _parseM3U8TVShows(streams) {
    const showsMap = new Map();

    for (const stream of streams) {
      const streamUrl = stream.url;
      const tvgId = stream['tvg-id'];
      const tvgName = stream['tvg-name'];
      const tvgType = stream['tvg-type'];
      const groupTitle = stream['group-title'];

      // Get or create show object
      if (!showsMap.has(tvgId)) {
        showsMap.set(tvgId, {
          stream_id: tvgId,
          name: tvgName,
          title: stream.titleName,
          type: tvgType,
          streams: {},
          category_name: groupTitle
        });
      }

      const show = showsMap.get(tvgId);
      const streamUrlParts = streamUrl.split('/');
      const seasonNumber = parseInt(streamUrlParts[streamUrlParts.length - 2]);
      const episodeNumber = parseInt(streamUrlParts[streamUrlParts.length - 1]);
      
      // Format key as Sxx-Exx (e.g., S01-E01)
      const seasonStr = String(seasonNumber).padStart(2, '0');
      const episodeStr = String(episodeNumber).padStart(2, '0');
      const key = `S${seasonStr}-E${episodeStr}`;

      show.streams[key] = streamUrl;
    }

    return Array.from(showsMap.values());
  }

  /**
   * Parse M3U8 content and extract title information
   * Iterates through lines, creates stream objects, and routes to type-specific parser
   * @private
   * @param {string} content - M3U8 file content
   * @param {string} type - Content type ('movies' or 'tvshows')
   * @returns {{titles: TitleData[], streamCount: number}} Object containing parsed titles and stream count
   */
  _parseM3U8Content(content, type) {
    const config = this._typeConfig[type];
    if (!config || !config.parseFunction) {
      throw new Error(`No parse function configured for type: ${type}`);
    }

    // Parse M3U8 lines and create stream objects
    const lines = content.split('\n');
    const streams = [];
    let currentMetadata = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith('#EXTINF:')) {
        // Parse EXTINF line
        const extinfMatch = line.match(/#EXTINF:(-?\d+)(?:\s+(.+))?/);
        if (!extinfMatch) continue;

        const duration = parseInt(extinfMatch[1]) || 0;
        const attributes = extinfMatch[2] || '';
        
        currentMetadata = {
          duration,
          type: type,
        };

        // Parse attributes (e.g., tvg-id, tvg-name, group-title, etc.)
        const attrPattern = /([\w-]+)="([^"]+)"/g;
        let attrMatch;
        while ((attrMatch = attrPattern.exec(attributes)) !== null) {
          const [, key, value] = attrMatch;
          currentMetadata[key] = value;
        }

        // Extract title name (last part after comma)
        const titleMatch = attributes.match(/,(.+)$/);
        if (titleMatch) {
          currentMetadata.titleName = titleMatch[1].trim();
        }

      } else if (line && !line.startsWith('#') && currentMetadata) {
        // URL line - create stream object with metadata and URL
        streams.push({
          ...currentMetadata,
          url: line
        });
        currentMetadata = null;
      }
    }
    
    // Route to type-specific parser
    const titles = config.parseFunction(streams);
    
    return {
      titles,
      streamCount: streams.length
    };
  }

  /**
   * Fetch M3U8 content from cache or API
   * @private
   * @param {string} url - URL to fetch
   * @param {string[]} cacheKeyParts - Cache key parts for storing/retrieving
   * @param {number|null} [maxAgeHours=6] - Maximum cache age in hours (default 6h for M3U8)
   * @returns {Promise<string>} M3U8 content as string
   */
  async _fetchM3U8WithCache(url, cacheKeyParts, maxAgeHours = 6) {
    // Check cache first - verify it exists AND is not expired
    const cached = this.cache.getText(...cacheKeyParts);
    if (cached) {
      // Check if cache is expired based on policy
      const isExpired = this.cache.isExpired(...cacheKeyParts);
      if (!isExpired) {
        this.logger.debug(`Loading M3U8 from cache: ${cacheKeyParts.join('/')}`);
        return cached;
      } else {
        this.logger.debug(`M3U8 cache expired for: ${cacheKeyParts.join('/')}, fetching fresh data`);
      }
    }

    // Fetch from API with rate limiting
    this.logger.debug(`Fetching M3U8 from API: ${url}`);
    const response = await this.limiter.schedule(() => axios.get(url, {
      responseType: 'text',
      timeout: 30000,
    }));

    // Cache the response with TTL
    if (cacheKeyParts.length > 0) {
      // Convert Infinity to null for JSON storage
      const ttl = maxAgeHours === Infinity ? null : maxAgeHours;
      await this.cache.setText(response.data, ttl, ...cacheKeyParts);
    }

    return response.data;
  }

  /**
   * Build M3U8 URL for a media type and optional page
   * @private
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @param {number} [page] - Page number for paginated types
   * @returns {string} Full URL for fetching M3U8 content
   */
  _buildM3U8Url(type, page) {
    const config = this._typeConfig[type];
    const apiUrl = this.providerData.api_url;
    const username = this.providerData.username;
    const password = this.providerData.password;
    const mediaTypeSegment = config.mediaTypeSegment;
    
    let url = `${apiUrl}/api/list/${username}/${password}/m3u8/${mediaTypeSegment}`;
    
    if (config.isPaginated && page) {
      url += `/${page}`;
    }
    
    return url;
  }

  /**
   * Fetch titles metadata from AGTV provider via M3U8
   * @private
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Promise<Array>} Array of raw title objects
   */
  async _fetchTitlesMetadata(type) {
    const config = this._typeConfig[type];
    if (!config || !config.enabled) {
      this.logger.warn(`${type}: Type not enabled or not configured`);
      return [];
    }

    const apiUrl = this.providerData.api_url;
    if (!apiUrl) {
      this.logger.error('API URL not configured');
      return [];
    }

    const allTitles = [];
    
    if (config.isPaginated) {
      // Paginated endpoint (TV shows)
      let page = 1;

      while (true) {
        const m3u8Url = this._buildM3U8Url(type, page);

        try {
          const m3u8Content = await this._fetchM3U8WithCache(
            m3u8Url,
            [this.providerId, type, 'metadata', `list-${page}.m3u8`]
          );

          const { titles, streamCount } = this._parseM3U8Content(m3u8Content, type);

          if (!titles || titles.length === 0) {
            break;
          }
          
          allTitles.push(...titles);

          // Check stream count (not title count) against threshold
          // For TV shows, multiple streams are grouped into one title,
          // so we need to check the actual stream count to determine if there are more pages
          if (streamCount < config.pageSizeThreshold) {
            break;
          }

          page++;
        } catch (error) {
          if (error.response && error.response.status === 404) {
            // End of pagination
            break;
          }
          this.logger.error(`Error fetching AGTV ${type} page ${page}: ${error.message}`);
          break;
        }
      }

      this.logger.info(`${type}: Loaded ${allTitles.length} titles`);
    } else {
      // Single endpoint (movies)
      const m3u8Url = this._buildM3U8Url(type);

      try {
        const m3u8Content = await this._fetchM3U8WithCache(
          m3u8Url,
          [this.providerId, type, 'metadata', 'list.m3u8']
        );

        const { titles } = this._parseM3U8Content(m3u8Content, type);
        allTitles.push(...titles);
        this.logger.info(`${type}: Loaded ${titles.length} titles`);
      } catch (error) {
        this.logger.error(`Error fetching AGTV ${type}: ${error.message}`);
        throw error;
      }
    }

    return allTitles;
  }

  /**
   * Check if a movie title should be skipped (already exists)
   * @private
   * @param {TitleData} title - Title data to check
   * @param {Set} existingTitleMap - Set of existing title IDs
   * @param {Map<number, boolean>} categoryMap - Map of category ID to enabled status (not used for AGTV)
   * @returns {boolean} True if title should be skipped
   */
  _shouldSkipMovies(title, existingTitleMap, categoryMap) {
    const config = this._typeConfig.movies;
    
    // Skip if already exists
    if (existingTitleMap.has(title[config.idField])) {
      return true;
    }
    
    return false;
  }

  /**
   * Check if a TV show title should be skipped (already exists)
   * @private
   * @param {TitleData} title - Title data to check
   * @param {Set} existingTitleMap - Set of existing title IDs
   * @param {Map<number, boolean>} categoryMap - Map of category ID to enabled status (not used for AGTV)
   * @returns {boolean} True if title should be skipped
   */
  _shouldSkipTVShows(title, existingTitleMap, categoryMap) {
    const config = this._typeConfig.tvshows;
    
    // Skip if already exists
    if (existingTitleMap.has(title[config.idField])) {
      return true;
    }
    
    return false;
  }

  /**
   * Filter titles based on existing titles
   * @private
   * @param {Array} titles - Array of raw title objects
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Promise<Array>} Array of filtered title objects
   */
  async _filterTitles(titles, type) {
    const config = this._typeConfig[type];
    if (!config) {
      throw new Error(`Unsupported type: ${type}`);
    }

    this.logger.debug(`${type}: Filtering titles`);

    // Load existing titles to check for duplicates
    const existingTitles = this.loadTitles(type);
    
    // Create Map for O(1) lookup of existing titles (for ignored check)
    const existingTitlesMap = new Map(existingTitles.map(t => [t.title_id, t]));
    const existingTitleIds = new Set(existingTitles.map(t => t.title_id).filter(Boolean));

    // Create empty category map (AGTV doesn't support categories)
    const categoryMap = new Map();

    // Filter titles using shouldSkip function
    const filteredTitles = titles.filter(title => {
      const titleId = title[config.idField];
      
      if (!titleId) {
        return false;
      }
      
      // Get existing title if it exists (O(1) lookup)
      const existingTitle = existingTitlesMap.get(titleId);
      
      // Skip if exists and is ignored
      if (existingTitle && existingTitle.ignored === true) {
        this.logger.debug(`${type}: Skipping ignored title ${titleId}: ${existingTitle.ignored_reason || 'Unknown reason'}`);
        return false;
      }
      
      return !config.shouldSkip(title, existingTitleIds, categoryMap);
    });
    
    this.logger.info(`${type}: Filtered to ${filteredTitles.length} titles to process`);

    return filteredTitles;
  }

  /**
   * Process a single title: clean title name, match TMDB ID, build processed data, and push to processedTitles
   * @private
   * @param {Object} title - Raw title object
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @param {Array<Object>} processedTitles - Array to push processed titles to
   * @returns {Promise<boolean>} true if processed and pushed, false if skipped/ignored
   */
  async _processSingleTitle(title, type, processedTitles) {
    const config = this._typeConfig[type];
    if (!config) {
      throw new Error(`Unsupported type: ${type}`);
    }

    const titleId = title[config.idField];
    this.logger.debug(`${type}: Processing title ${titleId}`);

    try {
      // Clean title name
      if (title.title) {
        title.title = this.cleanupTitle(title.title);
        title.name = title.title;
      }
      
      // Ensure type is set
      title.type = type;
      
      // Set title_id from idField for TMDB matching (AGTV uses stream_id as idField, which contains IMDB ID)
      title.title_id = title[config.idField];

      // Match TMDB ID if needed (common logic from BaseIPTVProvider)
      // This will set ignored flags on title if matching fails, but still return true
      await this._matchAndUpdateTMDBId(title, type, titleId);

      // Always build and save the processed title, even if it has ignored: true
      const processedTitle = this._buildProcessedTitleData(title, type);
      
      // Push to processedTitles array
      processedTitles.push(processedTitle);
      
      return true;
    } catch (error) {
      this.logger.warn(`Failed to process ${type} ${titleId}: ${error.message}`);
      return false;
    }
  }

  /**
   * Build processed title data object
   * @private
   * @param {Object} title - Title object after processing
   * @param {string} type - Media type ('movies' or 'tvshows')
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

