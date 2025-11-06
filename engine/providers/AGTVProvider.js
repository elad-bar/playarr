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
   */
  constructor(providerData, cache, data) {
    // AGTV uses 10k batch size since everything is in-memory and extremely fast
    super(providerData, cache, data, 10000);
        
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
        isPaginated: false
      },
      tvshows: {
        enabled: true,
        idField: 'stream_id',
        shouldSkip: this._shouldSkipTVShows.bind(this),
        mediaTypeSegment: 'tvshows',
        isPaginated: true,
        pageSizeThreshold: 5000 // Continue pagination if >= this many items
      }
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
   * Parse M3U8 content and extract title information
   * For TV shows: Groups streams by tvg-id, extracts season/episode from name
   * For movies: Each stream is a separate title
   * @private
   * @param {string} content - M3U8 file content
   * @param {string} type - Content type ('movies' or 'tvshows')
   * @returns {TitleData[]} Array of parsed title data objects
   */
  _parseM3U8Content(content, type) {
    const lines = content.split('\n');
    const isTVShows = type === 'tvshows';
    
    if (isTVShows) {
      // For TV shows: group streams by tvg-id
      const showsMap = new Map();
      let currentStream = null;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (line.startsWith('#EXTINF:')) {
          // Parse EXTINF line
          const extinfMatch = line.match(/#EXTINF:(-?\d+)(?:\s+(.+))?/);
          if (!extinfMatch) continue;

          const duration = parseInt(extinfMatch[1]) || 0;
          const attributes = extinfMatch[2] || '';
          
          currentStream = {
            duration,
            type: 'tvshows',
          };

          // Parse attributes (e.g., tvg-id, tvg-name, group-title, etc.)
          const attrPattern = /([\w-]+)="([^"]+)"/g;
          let attrMatch;
          while ((attrMatch = attrPattern.exec(attributes)) !== null) {
            const [, key, value] = attrMatch;
            currentStream[key] = value;
          }

          // Extract title name (last part after comma)
          const titleMatch = attributes.match(/,(.+)$/);
          if (titleMatch) {
            currentStream.titleName = titleMatch[1].trim();
          }

        } else if (line && !line.startsWith('#') && currentStream) {
          // URL line
          const streamUrl = line;
          const tvgId = currentStream['tvg-id'];
          const groupTitle = currentStream['group-title'];
          
          if (!tvgId) {
            currentStream = null;
            continue;
          }

          // Get or create show object
          if (!showsMap.has(tvgId)) {
            showsMap.set(tvgId, {
              stream_id: tvgId, // Use tvg-id as title_id
              name: groupTitle || tvgId,
              title: groupTitle || tvgId,
              type: 'tvshows',
              streams: {},
              category_name: groupTitle || null
            });
          }

          const show = showsMap.get(tvgId);
          
          // Extract season/episode from title name and add stream
          if (currentStream.titleName) {
            const streamKey = this._extractSeasonEpisode(currentStream.titleName);
            if (streamKey) {
              show.streams[streamKey] = streamUrl;
            } else {
              // Fallback: use stream_id from URL if no season/episode found
              const streamId = streamUrl.substring(streamUrl.lastIndexOf('/') + 1).split('?')[0];
              show.streams[streamId] = streamUrl;
            }
          }
          
          currentStream = null;
        }
      }

      return Array.from(showsMap.values());
    } else {
      // For movies: each stream is a separate title
      const titles = [];
      let currentTitle = null;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (line.startsWith('#EXTINF:')) {
          // Parse EXTINF line
          const extinfMatch = line.match(/#EXTINF:(-?\d+)(?:\s+(.+))?/);
          if (!extinfMatch) continue;

          const duration = parseInt(extinfMatch[1]) || 0;
          const attributes = extinfMatch[2] || '';
          
          currentTitle = {
            duration,
            type: 'movies',
          };

          // Parse attributes (e.g., tvg-id, tvg-name, group-title, etc.)
          const attrPattern = /(\w+)="([^"]+)"/g;
          let attrMatch;
          while ((attrMatch = attrPattern.exec(attributes)) !== null) {
            const [, key, value] = attrMatch;
            currentTitle[key] = value;
          }

          // Extract title name (last part after comma or last attribute)
          const titleMatch = attributes.match(/,(.+)$/);
          if (titleMatch) {
            currentTitle.title = titleMatch[1].trim();
            currentTitle.name = currentTitle.title;
          } else if (currentTitle['tvg-name']) {
            currentTitle.title = currentTitle['tvg-name'];
            currentTitle.name = currentTitle.title;
          }

          // Extract category from group-title
          if (currentTitle['group-title']) {
            currentTitle.category_name = currentTitle['group-title'];
          }

        } else if (line && !line.startsWith('#') && currentTitle) {
          // URL line
          const streamUrl = line;
          const streamId = streamUrl.substring(streamUrl.lastIndexOf('/') + 1).split('?')[0];
          
          currentTitle.url = streamUrl;
          currentTitle.stream_id = streamId;
          currentTitle.streams = { main: streamUrl };
          
          titles.push(currentTitle);
          currentTitle = null;
        }
      }

      return titles;
    }
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
    // Check cache first (if file exists, it's valid - purge job handles expiration)
    const cached = this.cache.getText(...cacheKeyParts);
    if (cached) {
      this.logger.debug(`Loading M3U8 from cache: ${cacheKeyParts.join('/')}`);
      return cached;
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
      this.cache.setText(response.data, ttl, ...cacheKeyParts);
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
            [this.providerId, `${type}_${page}.m3u8`]
          );

          const titles = this._parseM3U8Content(m3u8Content, type);

          if (!titles || titles.length === 0) {
            break;
          }
          
          allTitles.push(...titles);

          // If less than threshold, we've reached the end
          if (titles.length < config.pageSizeThreshold) {
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
          [this.providerId, `${type}.m3u8`]
        );

        const titles = this._parseM3U8Content(m3u8Content, type);
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
    const existingTitleIds = new Set(existingTitles.map(t => t.title_id).filter(Boolean));

    // Create empty category map (AGTV doesn't support categories)
    const categoryMap = new Map();

    // Filter titles using shouldSkip function
    const filteredTitles = titles.filter(title => {
      const titleId = title[config.idField];
      return titleId && !config.shouldSkip(title, existingTitleIds, categoryMap);
    });
    
    this.logger.info(`${type}: Filtered to ${filteredTitles.length} titles to process`);

    return filteredTitles;
  }

  /**
   * Process a single title: clean title name
   * @private
   * @param {Object} title - Raw title object
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Promise<Object|null>} Processed title object or null if processing fails
   */
  async _processSingleTitle(title, type) {
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
      
      return title;
    } catch (error) {
      this.logger.warn(`Failed to process ${type} ${titleId}: ${error.message}`);
      return null;
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
      tmdb_id: null, // AGTV doesn't provide extended info
      category_id: title.category_id || null,
      release_date: null, // AGTV doesn't provide extended info
      streams: title.streams || {}
    };
  }
}

