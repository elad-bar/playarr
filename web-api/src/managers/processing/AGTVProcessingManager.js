import { BaseIPTVProcessingManager } from './BaseIPTVProcessingManager.js';
import { formatNumber } from '../../utils/numberFormat.js';

/**
 * Apollo Group TV handler implementation
 * Fetches movies and TV shows via M3U8 format
 * @extends {BaseIPTVProcessingManager}
 */
export class AGTVProcessingManager extends BaseIPTVProcessingManager {
  /**
   * @param {Object} providerData - Provider configuration data
   * @param {import('../domain/ProviderTitlesManager.js').ProviderTitlesManager} providerTitlesManager - Provider titles manager
   * @param {import('../orchestration/ProvidersManager.js').ProvidersManager} providersManager - Providers manager for direct API calls
   * @param {import('../domain/TMDBManager.js').TMDBManager} tmdbManager - TMDB manager (legacy, not used directly)
   * @param {import('./TMDBProcessingManager.js').TMDBProcessingManager} tmdbProcessingManager - TMDB processing manager instance (required)
   * @param {number} [metadataBatchSize=500] - Batch size for processing metadata (default: 500)
   */
  constructor(providerData, providerTitlesManager, providersManager, tmdbManager, tmdbProcessingManager, metadataBatchSize = 500) {
    // AGTV uses 500 batch size since everything is in-memory and extremely fast
    super(providerData, providerTitlesManager, providersManager, tmdbManager, tmdbProcessingManager, metadataBatchSize);
        
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
   * @param {Array<string>} lines - M3U8 file content as array of lines
   * @param {string} type - Content type ('movies' or 'tvshows')
   * @returns {{titles: TitleData[], streamCount: number}} Object containing parsed titles and stream count
   */
  _parseM3U8Content(lines, type) {
    const config = this._typeConfig[type];
    if (!config || !config.parseFunction) {
      throw new Error(`No parse function configured for type: ${type}`);
    }

    // Parse M3U8 lines and create stream objects
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
   * Fetch paginated M3U8 content from all pages and aggregate into array of lines
   * Collects all M3U8 lines from all pages first, then returns aggregated lines array
   * @private
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @param {number} pageSizeThreshold - Threshold to determine if there are more pages
   * @returns {Promise<Array<string>>} Aggregated M3U8 lines array from all pages
   */
  async _fetchPaginatedM3U8(type, pageSizeThreshold) {
    const allM3U8Lines = [];
    let page = 1;

    while (true) {
      try {
        // Fetch M3U8 content from providersManager (rate limiting handled by provider)
        this.logger.debug(`Fetching M3U8 from providersManager: ${this.providerId}/${type}${page ? `/${page}` : ''}`);
        const m3u8Content = await this.providersManager.fetchM3U8(this.providerId, type, page);
        
        if (!m3u8Content || m3u8Content.trim().length === 0) {
          break;
        }

        // Count "#EXTINF:" lines to determine if there are more pages
        const extinfCount = (m3u8Content.match(/#EXTINF:/g) || []).length;
        
        if (extinfCount === 0) {
          break; // No streams in this page
        }

        // Collect lines from this page
        const lines = m3u8Content.split('\n');

        if (allM3U8Lines.length == 0) {
          allM3U8Lines.push(lines[0]);
        }

        const linesWithoutHeader = lines.filter(line => !line.trim().startsWith('#EXTM3U'));
        allM3U8Lines.push(...linesWithoutHeader);

        // Check if we have more pages (if count >= threshold, there's another page)
        if (extinfCount < pageSizeThreshold) {
          break; // Last page
        }

        page++;
      } catch (error) {
        if (error.message && error.message.includes('Page not found')) {
          // End of pagination
          break;
        }
        this.logger.error(`Error fetching AGTV ${type} page ${page}: ${error.message}`);
        break;
      }
    }

    // Return aggregated M3U8 lines array
    return allM3U8Lines;
  }

  /**
   * Fetch titles metadata from AGTV provider via M3U8 (using providersManager directly)
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

    let m3u8ContentLines;
    
    if (config.isPaginated) {
      // Paginated endpoint (TV shows) - already returns complete array of lines
      m3u8ContentLines = await this._fetchPaginatedM3U8(type, config.pageSizeThreshold);
    } else {
      // Single endpoint (movies)
      try {
        this.logger.debug(`Fetching M3U8 from providersManager: ${this.providerId}/${type}`);
        const m3u8Content = await this.providersManager.fetchM3U8(this.providerId, type, null);
        m3u8ContentLines = m3u8Content.split('\n');
      } catch (error) {
        this.logger.error(`Error fetching AGTV ${type}: ${error.message}`);
        throw error;
      }
    }

    const { titles } = this._parseM3U8Content(m3u8ContentLines, type);
          
    this.logger.info(`${type}: Loaded ${formatNumber(titles.length)} titles`);

    return titles;
  }

  /**
   * Check if a TV show title should be skipped (compare stream keys)
   * @private
   * @param {TitleData} title - Title data from API
   * @param {Object|null} existingTitle - Existing title object from DB (null if doesn't exist)
   * @returns {boolean} True if title should be skipped
   */
  _shouldSkipTVShows(title, existingTitle) {
    // If title doesn't exist, process it
    if (!existingTitle) {
      return false;
    }
    
    // Compare stream keys: sort and join to strings for comparison
    // Get stream keys from existing title in DB
    const existingStreamKeys = Object.keys(existingTitle.streams || {}).sort().join(',');
    
    // Get stream keys from provider title (from API call)
    const providerStreamKeys = Object.keys(title.streams || {}).sort().join(',');

    const shouldSkip = existingStreamKeys === providerStreamKeys;

    return shouldSkip;
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

      // Match TMDB ID if needed (common logic from BaseIPTVProcessingManager)
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
}

