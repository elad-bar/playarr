import { BaseDomainManager } from './BaseDomainManager.js';
import { formatNumber } from '../../utils/numberFormat.js';
import { DatabaseCollections, toCollectionName } from '../../config/collections.js';
import { NotFoundError, ValidationError, AppError } from '../../errors/AppError.js';

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
class TitlesManager extends BaseDomainManager {
  /**
   * @param {import('../repositories/TitleRepository.js').TitleRepository} titleRepo - Title repository
   */
  constructor(titleRepo) {
    super('TitlesManager', titleRepo);
    this._titlesCollection = toCollectionName(DatabaseCollections.TITLES);
    this._titlesStreamsCollection = toCollectionName(DatabaseCollections.TITLES_STREAMS);
    this._settingsCollection = toCollectionName(DatabaseCollections.SETTINGS);
    this._providersCollection = toCollectionName(DatabaseCollections.IPTV_PROVIDERS);
    this._tmdbPosterPath = 'https://image.tmdb.org/t/p/w300';
    this._tmdbBackdropPath = 'https://image.tmdb.org/t/p/w300';
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
      const titlesArray = await this._repository.findByQuery({});
      
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
      
      this.logger.info(`Loaded ${formatNumber(titlesMap.size)} titles`);
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

    if (inWatchlist !== undefined && inWatchlist !== null) {
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

    // Build title filters (searchQuery and startsWith can be combined)
    const titleFilters = [];
    
    // Search query filter (case-insensitive regex)
    if (searchQuery) {
      titleFilters.push({ title: { $regex: searchQuery, $options: 'i' } });
    }

    // Starts with filter
    if (startsWith) {
      if (startsWith === 'special') {
        // Special characters: not starting with A-Z or 0-9
        titleFilters.push({ title: { $not: { $regex: '^[A-Z0-9]', $options: 'i' } } });
      } else {
        // Specific letter
        titleFilters.push({ title: { $regex: `^${startsWith}`, $options: 'i' } });
      }
    }

    // Combine title filters using $and if multiple, otherwise set directly
    if (titleFilters.length === 1) {
      Object.assign(query, titleFilters[0]);
    } else if (titleFilters.length > 1) {
      query.$and = titleFilters;
    }

    // Year filter
    if (yearConfig) {
      const { type, years } = yearConfig;
      if (type === 'range' && years.length >= 2) {
        // Range: match years between start and end
        const startYear = `${years[0]}-01-01`;
        const endYear = `${years[1]}-12-31`;
        query.release_date = {
          $gte: startYear,
          $lte: endYear
        };

      } else if (type === 'list' && years.length > 0) {
        // List: match any of the years using $or with range queries
        query.$or = years.map(year => ({
          release_date: {
            $gte: `${year}-01-01`,
            $lte: `${year}-12-31`
          }
        }));

      } else if (type === 'single' && years.length > 0) {
        // Single year
        const startYear = `${years[0]}-01-01`;
        const endYear = `${years[0]}-12-31`;
        query.release_date = {
          $gte: startYear,
          $lte: endYear
        };
      }
    }

    return query;
  }

  /**
   * Get paginated list of titles with filtering
   * Optimized to use MongoDB queries instead of loading all titles into memory
   * @param {Object} options - Options object
   * @param {Object} options.user - User object (for watchlist)
   * @param {number} options.page - Page number
   * @param {number} options.perPage - Items per page
   * @param {string} options.searchQuery - Search query
   * @param {string} options.yearFilter - Year filter
   * @param {string|null} options.inWatchlist - Watchlist filter ('true', 'false', or null)
   * @param {string|null} options.mediaType - Media type filter ('movies' or 'tvshows')
   * @param {string} options.startsWith - Starts with filter
   * @param {Array<string>} [options.enabledProviderIds] - Array of enabled provider IDs (optional, for future filtering)
   */
  async getTitles({
    watchlist = [],
    page = 1,
    perPage = 50,
    searchQuery = '',
    yearFilter = '',
    inWatchlist = null,
    mediaType = null,
    startsWith = '',
    enabledProviderIds = null,
  }) {
    try {
      // Validate media type (use engine format: tvshows)
      if (mediaType && !['movies', 'tvshows'].includes(mediaType)) {
        throw new ValidationError("Invalid media type. Must be 'movies' or 'tvshows'");
      }

      // Parse year filter
      const yearConfig = this._parseYearFilter(yearFilter);
      
      const watchlistTitleKeys = Array.isArray(watchlist) ? watchlist : [];

      // Build MongoDB query
      const mongoQuery = this._buildTitlesQuery({ mediaType, searchQuery, yearConfig, startsWith, inWatchlist, watchlistTitleKeys });

      // Get total count for pagination
      let totalCount = await this._repository.count(mongoQuery);
      
      // Build findMany options
      const findOptions = {
        sort: { title: 1 }
      };
      
      findOptions.skip = (page - 1) * perPage;
      findOptions.limit = perPage;
      
      const titlesData = await this._repository.findMany(mongoQuery, findOptions);

      // Process titles and build response
      const items = [];

      for (const titleData of titlesData) {
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
        items,
        pagination: {
          page: validPage,
          per_page: perPage,
          total: totalCount,
          total_pages: totalPages,
        },
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      this.logger.error('Error getting titles:', error);
      throw new AppError('Failed to read titles data', 500);
    }
  }

  /**
   * Get detailed information for a specific title
   * Optimized to query MongoDB directly for just the requested title
   * @param {string} titleKey - Title key
   * @param {Array<string>} [watchlist=[]] - Array of title keys in user's watchlist
   * @param {Array<string>} [enabledProviderIds] - Array of enabled provider IDs (optional, for future filtering)
   */
  async getTitleDetails(titleKey, watchlist = [], enabledProviderIds = null) {
    try {
      // Query MongoDB directly for just this title
      const titleData = await this._repository.findOneByQuery({ title_key: titleKey });

      if (!titleData) {
        throw new NotFoundError('Title not found');
      }

      // Get user watchlist
      const userWatchlist = new Set(Array.isArray(watchlist) ? watchlist : []);

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
        const similarTitles = await this._repository.findByTitleKeys(similarKeys);

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

      return details;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      this.logger.error('Error getting title details:', error);
      throw new AppError('Failed to get title details', 500);
    }
  }

  /**
   * Update watchlist status for a title
   */
  /**
   * Find a single title by query
   * @param {Object} query - MongoDB query object
   * @param {Object} [options] - Query options (projection, sort, etc.)
   * @returns {Promise<Object|null>} Title document or null if not found
   */
  async findTitleByQuery(query, options = {}) {
    return await this._repository.findOneByQuery(query, options);
  }

  /**
   * Find multiple titles by query
   * @param {Object} query - MongoDB query object
   * @param {Object} [options] - Query options (sort, limit, skip, projection, etc.)
   * @returns {Promise<Array<Object>>} Array of title documents
   */
  async findTitlesByQuery(query, options = {}) {
    return await this._repository.findByQuery(query, options);
  }

  /**
   * Find titles by title keys
   * @param {Array<string>} keys - Array of title keys (e.g., ['movies-123', 'tvshows-456'])
   * @returns {Promise<Array<Object>>} Array of title documents
   */
  async findByTitleKeys(keys) {
    return await this._repository.findByTitleKeys(keys);
  }

  /**
   * Find titles by keys (exposes repository method for Processing Managers)
   * @param {Array<string>} keys - Array of keys
   * @param {string} keyField - Field name for keys (default: 'title_key')
   * @returns {Promise<Array<Object>>} Array of title documents
   */
  async findByKeys(keys, keyField = 'title_key') {
    return await this._repository.findByKeys(keys, keyField);
  }

  /**
   * Get main titles with lastUpdated timestamp
   * Returns title_key, title_id, type, and lastUpdated for change detection
   * @returns {Promise<Array<Object>>} Array of title documents with lastUpdated information
   */
  async getMainTitlesLastUpdated() {
    return await this._repository.getMainTitlesLastUpdated();
  }

  /**
   * Delete many titles by query (exposes repository method for Processing Managers)
   * @param {Object} filter - Filter query
   * @param {Object} [options={}] - Delete options
   * @returns {Promise<import('mongodb').DeleteResult>}
   */
  async deleteManyByQuery(filter, options = {}) {
    return await this._repository.deleteManyByQuery(filter, options);
  }

  /**
   * Remove provider sources from all media items in specified titles
   * @param {Array<string>} titleKeys - Array of title_key values
   * @param {string} providerId - Provider ID to remove
   * @returns {Promise<import('mongodb').UpdateResult>} Update result
   */
  async removeProviderSourcesFromTitles(titleKeys, providerId) {
    return await this._repository.removeProviderSourcesFromTitles(titleKeys, providerId);
  }

  /**
   * Remove empty media items (media items with no sources) from specified titles
   * @param {Array<string>} titleKeys - Array of title_key values
   * @returns {Promise<import('mongodb').UpdateResult>} Update result
   */
  async removeEmptyMediaItems(titleKeys) {
    return await this._repository.removeEmptyMediaItems(titleKeys);
  }

  /**
   * Delete titles that have no media items left
   * @param {Array<string>} titleKeys - Array of title_key values to check
   * @returns {Promise<import('mongodb').DeleteResult>} Delete result
   */
  async deleteEmptyTitles(titleKeys) {
    return await this._repository.deleteEmptyTitles(titleKeys);
  }

  /**
   * Save main titles (bulk upsert)
   * Used by processing managers to save titles from TMDB
   * @param {Array<Object>} titles - Array of title objects
   * @returns {Promise<{inserted: number, updated: number}>}
   */
  async saveMainTitles(titles) {
    if (!titles || titles.length === 0) {
      return { inserted: 0, updated: 0 };
    }

    // Add timestamps to each title
    const now = new Date();
    const titlesWithTimestamps = titles.map(title => ({
      ...title,
      createdAt: title.createdAt || now,
      lastUpdated: now
    }));

    // Use bulkUpsert from BaseDomainManager
    // Match on title_key
    return await this.bulkUpsert(titlesWithTimestamps, {
      matchFields: ['title_key'],
      setTimestamps: false // Already set above
    });
  }

}

// Export class
export { TitlesManager };

