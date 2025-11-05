import { DatabaseCollections, toCollectionName } from '../config/collections.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('TitlesManager');

/**
 * @typedef {Object} MainTitle
 * @property {string} title_key - Unique key combining type and title_id: {type}-{title_id}
 * @property {number|string} title_id - TMDB ID for the title
 * @property {'movies'|'tvshows'} type - Media type
 * @property {string} title - Title name
 * @property {string} [release_date] - Release date in YYYY-MM-DD format
 * @property {number} [vote_average] - TMDB vote average
 * @property {number} [vote_count] - TMDB vote count
 * @property {string} [overview] - Plot overview
 * @property {string} [poster_path] - TMDB poster path (relative path, e.g., "/abc123.jpg")
 * @property {string} [backdrop_path] - TMDB backdrop path (relative path)
 * @property {Array<{name: string}|string>} [genres] - Array of genre objects or strings
 * @property {number} [runtime] - Runtime in minutes (movies only)
 * @property {Object<string, StreamData>} streams - Stream data object
 * @property {string[]} [similar_titles] - Array of title_key strings for similar titles
 * @property {string} [createdAt] - ISO timestamp when title was first created
 * @property {string} [lastUpdated] - ISO timestamp when title was last updated
 */

/**
 * @typedef {Object} StreamData
 * @property {string[]} [sources] - Array of provider IDs that have this stream
 * @property {string[]} [main] - Array of provider IDs (legacy format, used directly as value for movies)
 * 
 * Stream data structure:
 * - For movies: streams.main can be either string[] OR { sources: string[] }
 * - For TV shows: streams["S01-E01"] contains stream data objects
 */

/**
 * Titles manager for handling titles data operations
 * Matches Python's TitlesService
 */
class TitlesManager {
  /**
   * @param {import('../services/database.js').DatabaseService} database - Database service instance
   * @param {import('./users.js').UserManager} userManager - User manager instance (for watchlist operations)
   */
  constructor(database, userManager) {
    this._database = database;
    this._userManager = userManager;
    this._titlesCollection = toCollectionName(DatabaseCollections.TITLES);
    this._settingsCollection = toCollectionName(DatabaseCollections.SETTINGS);
    this._providersCollection = toCollectionName(DatabaseCollections.IPTV_PROVIDERS);
    this._tmdbPosterPath = 'https://image.tmdb.org/t/p/w300';
    this._tmdbBackdropPath = 'https://image.tmdb.org/t/p/w300';
  }

  /**
   * Get titles from database
   * Returns Map<titleKey, MainTitle>
   * FileStorageService (via databaseService) handles file-level caching
   * Data is automatically mapped to Map format via storage mapping
   * @returns {Promise<Map<string, MainTitle>>} Map of title_key to MainTitle object
   */
  async getTitlesData() {
    try {
      // Get main titles from database service
      // With mapping configured, this returns a Map directly
      const titlesData = await this._database.getDataList(this._titlesCollection);
      
      if (!titlesData) {
        logger.info('No titles found in main.json');
        return new Map();
      }

      // Should always be a Map when mapping is configured
      if (titlesData instanceof Map) {
        logger.info(`Loaded ${titlesData.size} titles from main.json`);
        return titlesData;
      }

      // This should never happen if mapping is configured correctly
      logger.warn('Titles data is not a Map - mapping may not be configured correctly');
      return new Map();
    } catch (error) {
      logger.error('Error loading titles:', error);
      return new Map();
    }
  }

  /**
   * Get poster path URL
   * Matches Python's TMDBProvider.get_poster_path()
   * Note: _loadTmdbConfiguration() must be called first
   */
  _getPosterPath(imagePath) {
    if (!imagePath) {
      return null;
    }
    return `${this._tmdbPosterPath}${imagePath}`;
  }

  /**
   * Get backdrop path URL
   * Matches Python's TMDBProvider.get_backdrop_path()
   * Note: _loadTmdbConfiguration() must be called first
   */
  _getBackdropPath(imagePath) {
    if (!imagePath) {
      return null;
    }
    return `${this._tmdbBackdropPath}${imagePath}`;
  }

  /**
   * Get enabled provider IDs from database
   * Uses database service which caches data in memory
   * @private
   * @returns {Promise<Set<string>>} Set of enabled provider IDs
   */
  async _getEnabledProviders() {
    try {
      // Get all providers from database (cached by database service)
      const providers = await this._database.getDataList(this._providersCollection);
      
      if (!providers || providers.length === 0) {
        return new Set();
      }
      
      // Filter enabled providers and return as Set
      return new Set(
        providers
          .filter(p => p.enabled !== false)
          .map(p => p.id)
      );
    } catch (error) {
      logger.error('Error loading enabled providers:', error);
      return new Set();
    }
  }

  /**
   * Check if a stream has active sources (enabled providers)
   * @private
   * @param {Array|Object} streamData - Stream data (can be array of provider IDs or object with sources)
   * @param {Set<string>} enabledProviders - Set of enabled provider IDs
   * @returns {boolean} True if stream has at least one enabled source
   */
  _hasActiveSource(streamData, enabledProviders) {
    if (Array.isArray(streamData)) {
      // Handle: { "main": [array of provider IDs] }
      return streamData.some(providerId => enabledProviders.has(providerId));
    } else if (streamData && typeof streamData === 'object') {
      // Handle: { "main": { "sources": [array] } } or { "S01-E01": { "sources": [...] } }
      if (streamData.sources && Array.isArray(streamData.sources)) {
        return streamData.sources.some(providerId => enabledProviders.has(providerId));
      }
    }
    return false;
  }

  /**
   * Calculate number of seasons and episodes from streams data
   * Only counts streams that have active sources (enabled providers)
   */
  async _getShowInfo(streams) {
    if (!streams || typeof streams !== 'object') {
      return { seasons: 0, episodes: 0 };
    }

    const enabledProviders = await this._getEnabledProviders();
    const uniqueSeasons = new Set();
    let totalEpisodes = 0;

    for (const [key, streamData] of Object.entries(streams)) {
      // Skip if no active sources
      if (!this._hasActiveSource(streamData, enabledProviders)) {
        continue;
      }

      // For shows, key is like S01-E01
      const match = key.match(/^S(\d+)-E(\d+)$/i);
      if (match) {
        uniqueSeasons.add(parseInt(match[1], 10));
        totalEpisodes += 1;
      } else if (key === 'main') {
        // For movies, just one 'main' key
        continue;
      } else {
        // Unknown format, count as episode if has active source
        totalEpisodes += 1;
      }
    }

    return {
      seasons: uniqueSeasons.size,
      episodes: totalEpisodes,
    };
  }

  /**
   * Parse year filter string
   */
  _parseYearFilter(yearFilter) {
    if (!yearFilter) {
      return null;
    }

    const cleanInput = yearFilter.replace(/\s/g, '');

    try {
      // Check if it's a range (e.g., "2020-2024")
      if (cleanInput.includes('-')) {
        const [start, end] = cleanInput.split('-').map(Number);
        return { type: 'range', years: [start, end] };
      }

      // Check if it's a comma-separated list
      if (cleanInput.includes(',')) {
        const years = cleanInput.split(',').map(Number);
        return { type: 'list', years };
      }

      // Single year
      return { type: 'single', years: [Number(cleanInput)] };
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if a release date matches the year filter
   */
  _matchesYearFilter(releaseDate, yearConfig) {
    if (!releaseDate || !yearConfig) {
      return false;
    }

    try {
      const year = parseInt(releaseDate.split('-')[0], 10);
      const { type, years } = yearConfig;

      if (type === 'range') {
        return years[0] <= year && year <= years[1];
      } else if (type === 'list') {
        return years.includes(year);
      } else if (type === 'single') {
        return year === years[0];
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get paginated list of titles with filtering
   */
  async getTitles({
    user = null,
    page = 1,
    perPage = 50,
    searchQuery = '',
    yearFilter = '',
    watchlist = null,
    mediaType = null,
    startsWith = '',
  }) {
    try {
      // Validate media type (use engine format: tvshows)
      if (mediaType && !['movies', 'tvshows'].includes(mediaType)) {
        return {
          response: { error: "Invalid media type. Must be 'movies' or 'tvshows'" },
          statusCode: 400,
        };
      }

      // Parse year filter
      const yearConfig = this._parseYearFilter(yearFilter);

      // Get titles data
      const titlesData = await this.getTitlesData();

      if (!titlesData || titlesData.size === 0) {
        return {
          response: {
            items: [],
            pagination: {
              page: 1,
              per_page: perPage,
              total: 0,
              total_pages: 0,
            },
          },
          statusCode: 200,
        };
      }

      // Get user watchlist if needed
      let userWatchlist = new Set();
      if (user || watchlist !== null) {
        if (user) {
          const userData = await this._userManager.getUserByUsername(user.username);
          if (userData && userData.watchlist) {
            userWatchlist = new Set(userData.watchlist);
          }
        }
      }

      // Filter titles
      const filteredTitles = [];

      // Get enabled providers once for all titles
      const enabledProviders = await this._getEnabledProviders();

      for (const [titleKey, titleData] of titlesData.entries()) {
        const titleName = titleData.title || '';
        const titleType = titleData.type || '';
        const titleId = titleData.title_id || '';
        const releaseDate = titleData.release_date || '';

        // Apply media type filter
        if (mediaType && titleType !== mediaType) {
          continue;
        }

        // Apply search filter
        if (searchQuery && !titleName.toLowerCase().includes(searchQuery.toLowerCase())) {
          continue;
        }

        // Apply year filter
        if (yearConfig && !this._matchesYearFilter(releaseDate, yearConfig)) {
          continue;
        }

        // Apply watchlist filter
        if (watchlist !== null) {
          const isInWatchlist = userWatchlist.has(titleKey);
          if (watchlist !== isInWatchlist) {
            continue;
          }
        }

        // Apply starts_with filter
        if (startsWith) {
          const firstChar = titleName[0]?.toUpperCase() || '';
          if (startsWith === 'special') {
            if (firstChar && firstChar.match(/[A-Z0-9]/)) {
              continue;
            }
          } else {
            if (firstChar !== startsWith.toUpperCase()) {
              continue;
            }
          }
        }

        // Count streams - handle both array and object formats
        const streams = titleData.streams || {};
        let streamsCount = 0;
        
        for (const [streamKey, streamGroup] of Object.entries(streams)) {
          if (Array.isArray(streamGroup)) {
            // Handle: { "main": [array] }
            streamsCount += streamGroup.filter(id => enabledProviders.has(id)).length;
          } else if (typeof streamGroup === 'object' && streamGroup !== null) {
            // Handle: { "main": { "sources": [array] } } or { "S01-E01": {...} }
            if (streamGroup.sources && Array.isArray(streamGroup.sources)) {
              streamsCount += streamGroup.sources.filter(id => enabledProviders.has(id)).length;
            } else {
              // For TV shows, count each episode as 1 stream if has active source
              if (this._hasActiveSource(streamGroup, enabledProviders)) {
                streamsCount += 1;
              }
            }
          }
        }

        // Get TMDB data - fields are at root level
        const posterPath = titleData.poster_path;

        // Build title response
        const titleResponse = {
          key: titleKey,
          id: String(titleId),
          name: titleName,
          type: titleType,
          image: this._getPosterPath(posterPath),
          release_date: releaseDate,
          streams_count: streamsCount,
          watchlist: userWatchlist.has(titleKey),
          vote_average: parseFloat(titleData.vote_average || 0),
          vote_count: parseInt(titleData.vote_count || 0, 10),
        };

        // Add show-specific fields
        if (titleType === 'tvshows') {
          const { seasons, episodes } = await this._getShowInfo(streams);
          titleResponse.number_of_seasons = seasons;
          titleResponse.number_of_episodes = episodes;
        }

        filteredTitles.push(titleResponse);
      }

      // Note: Python doesn't sort after filtering - it relies on the sorted order from database
      // Since we load titles sorted by name from database, filteredTitles should already be sorted
      // No need to sort again here

      // Calculate pagination
      const total = filteredTitles.length;
      const totalPages = Math.max(1, Math.ceil(total / perPage));

      // Ensure page is within valid range
      const validPage = Math.max(1, Math.min(page, totalPages));

      // Get paginated items
      const startIdx = (validPage - 1) * perPage;
      const endIdx = Math.min(startIdx + perPage, total);
      const items = filteredTitles.slice(startIdx, endIdx);

      return {
        response: {
          items,
          pagination: {
            page: validPage,
            per_page: perPage,
            total,
            total_pages: totalPages,
          },
        },
        statusCode: 200,
      };
    } catch (error) {
      logger.error('Error getting titles:', error);
      return {
        response: { error: 'Failed to read titles data' },
        statusCode: 500,
      };
    }
  }

  /**
   * Get detailed information for a specific title
   */
  async getTitleDetails(titleKey, user = null) {
    try {
      const titlesData = await this.getTitlesData();
      const titleData = titlesData.get(titleKey);

      if (!titleData) {
        return {
          response: { error: 'Title not found' },
          statusCode: 404,
        };
      }

      // Get user watchlist if needed
      let userWatchlist = new Set();
      if (user) {
        const userData = await this._userManager.getUserByUsername(user.username);
        if (userData && userData.watchlist) {
          userWatchlist = new Set(userData.watchlist);
        }
      }

      // TMDB fields are at root level
      const mediaType = titleData.type || '';
      const streams = titleData.streams || {};
      const enabledProviders = await this._getEnabledProviders();

      // Get seasons and episodes count for tvshows (from streams with active sources)
      let numSeasons = null;
      let numEpisodes = null;
      if (mediaType === 'tvshows') {
        const showInfo = await this._getShowInfo(streams);
        numSeasons = showInfo.seasons;
        numEpisodes = showInfo.episodes;
      }

      const posterPath = titleData.poster_path;
      const backdropPath = titleData.backdrop_path;

      // Build streams list - parse season/episode from key
      const flatStreams = [];
      for (const [streamId, streamData] of Object.entries(streams)) {
        let season = null;
        let episode = null;
        
        // Parse season/episode from key (e.g., "S01-E01")
        if (streamId !== 'main') {
          const match = streamId.match(/^S(\d+)-E(\d+)$/i);
          if (match) {
            season = parseInt(match[1], 10);
            episode = parseInt(match[2], 10);
          }
        }
        
        // Check if stream has active sources
        const hasActiveSource = this._hasActiveSource(streamData, enabledProviders);
        
        flatStreams.push({
          id: streamId,
          season: season,
          episode: episode,
          has_active_source: hasActiveSource, // Add flag for download icon
        });
      }

      // Build similar titles
      const similarKeys = titleData.similar_titles || [];
      const seenKeys = new Set();
      const expandedSimilarTitles = [];

      for (const key of similarKeys) {
        if (!key || seenKeys.has(key)) {
          continue;
        }

        const similarTitle = titlesData.get(key);
        if (!similarTitle) {
          continue;
        }

        seenKeys.add(key);
        const similarPosterPath = similarTitle.poster_path || null;

        expandedSimilarTitles.push({
          key,
          name: similarTitle.title || '',
          poster_path: this._getPosterPath(similarPosterPath),
          release_date: similarTitle.release_date,
          type: similarTitle.type,
        });
      }

      const details = {
        key: titleKey,
        id: titleData.title_id,
        name: titleData.title,
        type: mediaType,
        release_date: titleData.release_date,
        overview: titleData.overview || '',
        poster_path: this._getPosterPath(posterPath),
        backdrop_path: this._getBackdropPath(backdropPath),
        vote_average: titleData.vote_average || 0.0,
        vote_count: titleData.vote_count || 0,
        genres: (titleData.genres || []).map(g => g.name || g),
        runtime: mediaType === 'movies' ? titleData.runtime : null,
        number_of_seasons: numSeasons,
        number_of_episodes: numEpisodes,
        watchlist: userWatchlist.has(titleKey),
        streams: flatStreams,
        similar_titles: expandedSimilarTitles,
      };

      return {
        response: details,
        statusCode: 200,
      };
    } catch (error) {
      logger.error('Error getting title details:', error);
      return {
        response: { error: 'Failed to get title details' },
        statusCode: 500,
      };
    }
  }

  /**
   * Update watchlist status for a title
   */
  async updateWatchlist(user, titleKey, watchlist) {
    const title = { key: titleKey, watchlist };
    return this.updateWatchlistBulk(user, [title]);
  }

  /**
   * Update watchlist status for multiple titles
   */
  async updateWatchlistBulk(user, titles) {
    try {
      if (!user) {
        return {
          response: { error: 'User authentication required' },
          statusCode: 401,
        };
      }

      const titlesData = await this.getTitlesData();
      const updatedCount = 0;
      const notFound = [];

      const titlesToWatchlist = [];
      const titlesToUnwatchlist = [];

      for (const titleUpdate of titles) {
        const titleKey = titleUpdate.key;
        const watchlist = titleUpdate.watchlist;

        // Verify title exists
        if (!titlesData.has(titleKey)) {
          notFound.push(titleKey);
          continue;
        }

        if (watchlist) {
          titlesToWatchlist.push(titleKey);
        } else {
          titlesToUnwatchlist.push(titleKey);
        }
      }

      // Update user's watchlist
      let totalUpdated = 0;
      if (titlesToWatchlist.length > 0) {
        const success = await this._userManager.updateUserWatchlist(user.username, titlesToWatchlist, true);
        if (success) {
          totalUpdated += titlesToWatchlist.length;
        }
      }

      if (titlesToUnwatchlist.length > 0) {
        const success = await this._userManager.updateUserWatchlist(user.username, titlesToUnwatchlist, false);
        if (success) {
          totalUpdated += titlesToUnwatchlist.length;
        }
      }

      const response = {
        message: `Updated ${totalUpdated} titles successfully`,
        updated_count: totalUpdated,
      };

      if (notFound.length > 0) {
        response.not_found = notFound;
      }

      return {
        response,
        statusCode: totalUpdated > 0 ? 200 : 404,
      };
    } catch (error) {
      logger.error('Error updating watchlist:', error);
      return {
        response: { error: 'Failed to update watchlist status' },
        statusCode: 500,
      };
    }
  }

  /**
   * Refresh titles (called by Python engine via cache refresh endpoint)
   * Database service handles cache invalidation automatically
   */
  async refreshCache() {
    // No-op - database service handles caching internally
  }
}

// Export class
export { TitlesManager };

