import { BaseManager } from './BaseManager.js';
import { DatabaseCollections, toCollectionName } from '../config/collections.js';

/**
 * @typedef {Object} MediaStreamSource
 * @property {string} provider_id - Provider identifier
 * @property {string} provider_title_id - Provider's original title ID
 * @property {string} provider_url - Stream URL from provider
 */

/**
 * @typedef {Object} MediaStream
 * @property {string} name - Stream name ('main' for movies, episode name for TV shows)
 * @property {string} proxy_path - File path for the STRM file
 * @property {Array<MediaStreamSource>} sources - Array of provider sources
 * @property {number} [season] - Season number (TV shows only)
 * @property {number} [episode] - Episode number (TV shows only)
 * @property {string} [air_date] - Episode air date (TV shows only)
 * @property {string} [overview] - Episode overview (TV shows only)
 * @property {string} [still_path] - Episode still image path (TV shows only)
 */

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
 * @property {string} [imdb_id] - IMDB ID (e.g., "tt0133093") if available
 * @property {Array<MediaStream>} media - Array of media streams with sources
 * @property {string[]} [similar_titles] - Array of title_key strings for similar titles
 * @property {string} [createdAt] - ISO timestamp when title was first created
 * @property {string} [lastUpdated] - ISO timestamp when title was last updated
 */

/**
 * Titles manager for handling titles data operations
 * Matches Python's TitlesService
 */
class TitlesManager extends BaseManager {
  /**
   * @param {import('./users.js').UserManager} userManager - User manager instance (for watchlist operations)
   * @param {import('../repositories/TitleRepository.js').TitleRepository} titleRepo - Title repository
   * @param {import('../repositories/ProviderRepository.js').ProviderRepository} providerRepo - Provider repository
   * @param {import('./providers.js').ProvidersManager} [providersManager] - Providers manager instance (optional, can be set later via setter)
   */
  constructor(userManager, titleRepo, providerRepo, providersManager = null) {
    super('TitlesManager');
    this._userManager = userManager;
    this._titleRepo = titleRepo;
    this._providerRepo = providerRepo;
    this._providersManager = providersManager;
    this._titlesCollection = toCollectionName(DatabaseCollections.TITLES);
    this._titlesStreamsCollection = toCollectionName(DatabaseCollections.TITLES_STREAMS);
    this._settingsCollection = toCollectionName(DatabaseCollections.SETTINGS);
    this._providersCollection = toCollectionName(DatabaseCollections.IPTV_PROVIDERS);
    this._tmdbPosterPath = 'https://image.tmdb.org/t/p/w300';
    this._tmdbBackdropPath = 'https://image.tmdb.org/t/p/w300';
  }

  /**
   * Set ProvidersManager instance (for lazy injection to resolve circular dependency)
   * @param {import('./providers.js').ProvidersManager} providersManager - Providers manager instance
   */
  setProvidersManager(providersManager) {
    this._providersManager = providersManager;
  }

  /**
   * Get titles from database
   * Returns Map<titleKey, MainTitle>
   * MongoDatabaseService handles MongoDB operations and caching
   * Data is automatically mapped to Map format via storage mapping
   * @returns {Promise<Map<string, MainTitle>>} Map of title_key to MainTitle object
   */
  async getTitlesData() {
    try {
      // Get main titles from database service
      // With mapping configured, this returns a Map directly
      const titlesArray = await this._titleRepo.findByQuery({});
      
      if (!titlesArray || titlesArray.length === 0) {
        this.logger.info('No titles found');
        return new Map();
      }

      // Convert array to Map
      const titlesMap = new Map();
      for (const title of titlesArray) {
        if (title.title_key) {
          titlesMap.set(title.title_key, title);
        }
      }
      
      this.logger.info(`Loaded ${titlesMap.size} titles`);
      return titlesMap;
    } catch (error) {
      this.logger.error('Error loading titles:', error);
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
      let providers;
      
      // Use ProvidersManager if available (uses cache), otherwise fallback to direct repo access
      if (this._providersManager) {
        const providersResult = await this._providersManager.getProviders();
        providers = providersResult.response?.providers || [];
      } else {
        // Fallback to direct repository access (for initialization before ProvidersManager is created)
        providers = await this._providerRepo.findByQuery({});
      }
      
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
      this.logger.error('Error loading enabled providers:', error);
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
   * Build MongoDB query for filtering titles
   * @private
   * @param {Object} filters - Filter options
   * @returns {Object} MongoDB query object
   */
  _buildTitlesQuery({ mediaType, searchQuery, yearConfig, startsWith, inWatchlist, watchlistTitleKeys }) {
    const query = {};

    if (inWatchlist !== null) {
      if (inWatchlist === 'true') {
        query.title_key = { $in: watchlistTitleKeys };
      } else {
        query.title_key = { $nin: watchlistTitleKeys };
      }
    }

    // Media type filter
    if (mediaType) {
      query.type = mediaType;
    }

    // Search query filter (case-insensitive regex)
    if (searchQuery) {
      query.title = { $regex: searchQuery, $options: 'i' };
    }

    // Year filter
    if (yearConfig) {
      const { type, years } = yearConfig;
      if (type === 'range') {
        // Range: match years between start and end
        const startYear = `${years[0]}-01-01`;
        const endYear = `${years[1]}-12-31`;
        query.release_date = {
          $gte: startYear,
          $lte: endYear
        };
      } else if (type === 'list') {
        // List: match any of the years
        const yearRegex = years.map(y => `^${y}-`).join('|');
        query.release_date = { $regex: yearRegex };
      } else if (type === 'single') {
        // Single year
        const yearRegex = `^${years[0]}-`;
        query.release_date = { $regex: yearRegex };
      }
    }

    // Starts with filter
    if (startsWith) {
      if (startsWith === 'special') {
        // Special characters: not starting with A-Z or 0-9
        query.title = {
          ...(query.title || {}),
          $not: { $regex: '^[A-Z0-9]', $options: 'i' }
        };
      } else {
        // Specific letter
        query.title = {
          ...(query.title || {}),
          $regex: `^${startsWith}`,
          $options: 'i'
        };
      }
    }

    return query;
  }

  /**
   * Get paginated list of titles with filtering
   * Optimized to use MongoDB queries instead of loading all titles into memory
   */
  async getTitles({
    user = null,
    page = 1,
    perPage = 50,
    searchQuery = '',
    yearFilter = '',
    inWatchlist = null,
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
      let watchlistTitleKeys = [];
      
      if (inWatchlist !== null) {
        const userData = await this._userManager.getUserByUsername(user.username);
        watchlistTitleKeys = userData.watchlist || [];

        this.logger.info(`Watchlist title keys: ${watchlistTitleKeys}`);
      }

      // Build MongoDB query
      const mongoQuery = this._buildTitlesQuery({ mediaType, searchQuery, yearConfig, startsWith, inWatchlist, watchlistTitleKeys });

      // Get total count for pagination (before watchlist filter, as watchlist is applied in memory)
      let totalCount = await this._titleRepo.count(mongoQuery);
      
      // Build findMany options
      const findOptions = {
        sort: { title: 1 }
      };
      
      findOptions.skip = (page - 1) * perPage;
      findOptions.limit = perPage;

      this.logger.info(`Mongo query: ${JSON.stringify(mongoQuery)}`);
      
      const titlesData = await this._titleRepo.findMany(mongoQuery, findOptions);

      // Process titles and build response
      const items = [];
      const startIdx = inWatchlist === null ? 0 : (page - 1) * perPage;
      const endIdx = inWatchlist === null ? titlesData.length : startIdx + perPage;
      const titlesToProcess = titlesData.slice(startIdx, endIdx);

      for (const titleData of titlesToProcess) {
        const titleKey = titleData.title_key || `${titleData.type}-${titleData.title_id}`;
        const titleName = titleData.title || '';
        const titleType = titleData.type || '';
        const titleId = titleData.title_id || '';
        const releaseDate = titleData.release_date || '';

        // Count streams - media is now an array of media items
        const media = titleData.media || [];
        let streamsCount = 0;
        
        if (titleType === 'movies') {
          // Movies: count 1 if there's a media item with name === 'main'
          streamsCount = media.some(m => m.name === 'main') ? 1 : 0;
        } else {
          // TV shows: count is the number of available episodes (media array length)
          streamsCount = media.length;
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
          watchlist: watchlistTitleKeys.includes(titleKey),
          vote_average: parseFloat(titleData.vote_average || 0),
          vote_count: parseInt(titleData.vote_count || 0, 10),
        };

        // Add show-specific fields
        if (titleType === 'tvshows') {
          const uniqueSeasons = new Set();
          media.forEach(m => {
            if (m.season !== null && m.season !== undefined) {
              uniqueSeasons.add(m.season);
            }
          });
          titleResponse.number_of_seasons = uniqueSeasons.size;
          titleResponse.number_of_episodes = media.length;
        }

        items.push(titleResponse);
      }

      // Calculate pagination
      const totalPages = Math.max(1, Math.ceil(totalCount / perPage));
      const validPage = Math.max(1, Math.min(page, totalPages));

      return {
        response: {
          items,
          pagination: {
            page: validPage,
            per_page: perPage,
            total: totalCount,
            total_pages: totalPages,
          },
        },
        statusCode: 200,
      };
    } catch (error) {
      this.logger.error('Error getting titles:', error);
      return {
        response: { error: 'Failed to read titles data' },
        statusCode: 500,
      };
    }
  }

  /**
   * Get detailed information for a specific title
   * Optimized to query MongoDB directly for just the requested title
   */
  async getTitleDetails(titleKey, user = null) {
    try {
      // Query MongoDB directly for just this title
      const titleData = await this._titleRepo.findOneByQuery({ title_key: titleKey });

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
      const media = titleData.media || [];

      // Get seasons and episodes count for tvshows (from media array)
      let numSeasons = null;
      let numEpisodes = null;
      if (mediaType === 'tvshows') {
        const uniqueSeasons = new Set();
        media.forEach(m => {
          if (m.season !== null && m.season !== undefined) {
            uniqueSeasons.add(m.season);
          }
        });
        numSeasons = uniqueSeasons.size;
        numEpisodes = media.length;
      }

      const posterPath = titleData.poster_path;
      const backdropPath = titleData.backdrop_path;

      // Build streams list - iterate media array
      const flatStreams = [];
      for (const mediaItem of media) {
        // Extract episode details from media item
        const episodeDetails = {
          id: mediaType === 'movies' ? 'main' : `S${String(mediaItem.season).padStart(2, '0')}-E${String(mediaItem.episode).padStart(2, '0')}`,
          season: mediaItem.season || null,
          episode: mediaItem.episode || null,
          has_stream: true, // All items in media array have sources
        };

        // Add episode metadata from media item (for TV shows)
        if (mediaType === 'tvshows') {
          if (mediaItem.name) {
            episodeDetails.name = mediaItem.name;
          }
          if (mediaItem.air_date) {
            episodeDetails.air_date = mediaItem.air_date;
          }
          if (mediaItem.overview) {
            episodeDetails.overview = mediaItem.overview;
          }
          if (mediaItem.still_path) {
            episodeDetails.still_path = this._getPosterPath(mediaItem.still_path);
          }
        }
        
        flatStreams.push(episodeDetails);
      }

      // Build similar titles - query only the similar titles we need
      const similarKeys = titleData.similar_titles || [];
      const expandedSimilarTitles = [];

      if (similarKeys.length > 0) {
        // Query MongoDB for only the similar titles
        const similarTitles = await this._titleRepo.findByTitleKeys(similarKeys);

        const seenKeys = new Set();
        for (const similarTitle of similarTitles) {
          const key = similarTitle.title_key;
          if (!key || seenKeys.has(key)) {
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
        imdb_id: titleData.imdb_id || null,
      };

      return {
        response: details,
        statusCode: 200,
      };
    } catch (error) {
      this.logger.error('Error getting title details:', error);
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
   * Find a single title by query
   * @param {Object} query - MongoDB query object
   * @param {Object} [options] - Query options (projection, sort, etc.)
   * @returns {Promise<Object|null>} Title document or null if not found
   */
  async findTitleByQuery(query, options = {}) {
    return await this._titleRepo.findOneByQuery(query, options);
  }

  /**
   * Find multiple titles by query
   * @param {Object} query - MongoDB query object
   * @param {Object} [options] - Query options (sort, limit, skip, projection, etc.)
   * @returns {Promise<Array<Object>>} Array of title documents
   */
  async findTitlesByQuery(query, options = {}) {
    return await this._titleRepo.findByQuery(query, options);
  }

  /**
   * Update watchlist status for multiple titles
   * Optimized to query MongoDB directly for only the titles we need to verify
   */
  async updateWatchlistBulk(user, titles) {
    try {
      if (!user) {
        return {
          response: { error: 'User authentication required' },
          statusCode: 401,
        };
      }

      // Extract all title keys to verify
      const titleKeys = titles.map(t => t.key).filter(Boolean);
      
      if (titleKeys.length === 0) {
        return {
          response: { error: 'No title keys provided' },
          statusCode: 400,
        };
      }

      // Query MongoDB directly for only the titles we need to verify
      const existingTitles = await this._titleRepo.findMany(
        { title_key: { $in: titleKeys } },
        { projection: { title_key: 1, _id: 0 } }
      );

      // Create a Set of existing title keys for quick lookup
      const existingKeys = new Set(existingTitles.map(t => t.title_key));

      const notFound = [];
      const titlesToWatchlist = [];
      const titlesToUnwatchlist = [];

      for (const titleUpdate of titles) {
        const titleKey = titleUpdate.key;
        const watchlist = titleUpdate.watchlist;

        // Verify title exists
        if (!existingKeys.has(titleKey)) {
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
      this.logger.error('Error updating watchlist:', error);
      return {
        response: { error: 'Failed to update watchlist status' },
        statusCode: 500,
      };
    }
  }


}

// Export class
export { TitlesManager };

