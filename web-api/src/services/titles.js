import { databaseService } from './database.js';
import { cacheService } from './cache.js';
import { userService } from './users.js';
import { DatabaseCollections, toCollectionName } from '../config/collections.js';

/**
 * Titles service for handling titles data operations
 * Matches Python's TitlesService
 */
class TitlesService {
  constructor() {
    this._titlesCollection = toCollectionName(DatabaseCollections.TITLES);
    this._settingsCollection = toCollectionName(DatabaseCollections.SETTINGS);
    this._titlesCache = null; // Map<titleKey, titleData>
    this._lockPromise = null;
    this._tmdbPosterPath = null; // Loaded from settings collection
    this._tmdbBackdropPath = null; // Loaded from settings collection
    this._tmdbConfigLoaded = false;
  }

  /**
   * Load TMDB configuration from settings collection
   * Matches Python's TMDBProvider._load_configuration()
   */
  async _loadTmdbConfiguration() {
    if (this._tmdbConfigLoaded) {
      return;
    }

    try {
      const configurationKey = 'tmdb_configuration';
      const config = await databaseService.getData(this._settingsCollection, { key: configurationKey });

      if (config && config.images) {
        const secureBaseUrl = config.images.secure_base_url || '';
        const posterWidth = 'w300'; // TMDB_POSTER_WIDTH constant

        // Both poster and backdrop use the same width (matching Python)
        this._tmdbPosterPath = `${secureBaseUrl}${posterWidth}`;
        this._tmdbBackdropPath = `${secureBaseUrl}${posterWidth}`;
      } else {
        // Fallback to default if configuration not found
        this._tmdbPosterPath = 'https://image.tmdb.org/t/p/w300';
        this._tmdbBackdropPath = 'https://image.tmdb.org/t/p/w300';
      }

      this._tmdbConfigLoaded = true;
    } catch (error) {
      console.error('Error loading TMDB configuration:', error);
      // Fallback to default
      this._tmdbPosterPath = 'https://image.tmdb.org/t/p/w300';
      this._tmdbBackdropPath = 'https://image.tmdb.org/t/p/w300';
      this._tmdbConfigLoaded = true;
    }
  }

  /**
   * Get titles from cache or database
   * Returns Map<titleKey, titleData>
   * Public method for other services to access titles data
   */
  async getTitlesData() {
    // Check cache first
    if (this._titlesCache) {
      return this._titlesCache;
    }

    // Load from cache service
    const cachedTitles = cacheService.getTitles();
    if (cachedTitles && Array.isArray(cachedTitles)) {
      // Convert array to Map for faster lookups
      this._titlesCache = new Map();
      for (const title of cachedTitles) {
        this._titlesCache.set(title.key, title);
      }
      return this._titlesCache;
    }

    // Load from database
    await this._loadTitles();
    return this._titlesCache;
  }

  /**
   * Load titles from database into cache
   * Sorts by name (alphabetically ascending) to match Python's behavior
   */
  async _loadTitles() {
    try {
      // Load titles sorted by name (matching Python's sort_by_name = {"name": 1})
      const titlesList = await databaseService.getDataList(
        this._titlesCollection,
        {}, // query
        null, // projection
        { name: 1 } // sort by name ascending
      );
      
      if (!titlesList) {
        this._titlesCache = new Map();
        return;
      }

      // Convert array to Map (preserving sorted order from database)
      this._titlesCache = new Map();
      for (const title of titlesList) {
        if (title.key) {
          this._titlesCache.set(title.key, title);
        }
      }

      // Update cache service
      cacheService.setTitles(Array.from(this._titlesCache.values()));
    } catch (error) {
      console.error('Error loading titles:', error);
      this._titlesCache = new Map();
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
   * Calculate number of seasons and episodes from streams data
   */
  _getShowInfo(streams) {
    if (!streams || typeof streams !== 'object') {
      return { seasons: 0, episodes: 0 };
    }

    const uniqueSeasons = new Set();
    let totalEpisodes = 0;

    for (const key of Object.keys(streams)) {
      // For shows, key is like S01-E01
      const match = key.match(/^S(\d+)-E\d+$/i);
      if (match) {
        uniqueSeasons.add(parseInt(match[1], 10));
        totalEpisodes += 1;
      } else if (key === 'main') {
        // For movies, just one 'main' key
        continue;
      } else {
        // Unknown format, count as episode
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
      // Validate media type
      if (mediaType && !['movies', 'shows'].includes(mediaType)) {
        return {
          response: { error: "Invalid media type. Must be 'movies' or 'shows'" },
          statusCode: 400,
        };
      }

      // Preload TMDB configuration
      await this._loadTmdbConfiguration();

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
          const userData = await userService.getUserByUsername(user.username);
          if (userData && userData.watchlist) {
            userWatchlist = new Set(userData.watchlist);
          }
        }
      }

      // Filter titles
      const filteredTitles = [];

      for (const [titleKey, titleData] of titlesData.entries()) {
        const titleName = titleData.name || '';
        const titleType = titleData.type || '';
        const titleId = titleData.id || '';
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

        // Count streams
        const streams = titleData.streams || {};
        let streamsCount = 0;
        for (const streamGroup of Object.values(streams)) {
          if (typeof streamGroup === 'object' && streamGroup !== null) {
            streamsCount += Object.keys(streamGroup).length;
          }
        }

        // Get TMDB data
        const tmdbData = titleData.data || {};
        const posterPath = tmdbData.poster_path;

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
          vote_average: parseFloat(tmdbData.vote_average || 0),
          vote_count: parseInt(tmdbData.vote_count || 0, 10),
        };

        // Add show-specific fields
        if (titleType === 'shows') {
          const { seasons, episodes } = this._getShowInfo(streams);
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
      console.error('Error getting titles:', error);
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
      // Preload TMDB configuration
      await this._loadTmdbConfiguration();

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
        const userData = await userService.getUserByUsername(user.username);
        if (userData && userData.watchlist) {
          userWatchlist = new Set(userData.watchlist);
        }
      }

      const tmdbData = titleData.data || {};
      const mediaType = titleData.type || '';
      const streams = titleData.streams || {};

      // Get seasons and episodes count for shows
      let numSeasons = null;
      let numEpisodes = null;
      if (mediaType === 'shows') {
        const showInfo = this._getShowInfo(streams);
        numSeasons = showInfo.seasons;
        numEpisodes = showInfo.episodes;
      }

      const posterPath = tmdbData.poster_path;
      const backdropPath = tmdbData.backdrop_path;

      // Build streams list
      const flatStreams = [];
      for (const [streamId, streamData] of Object.entries(streams)) {
        flatStreams.push({
          id: streamId,
          season: streamData.season || null,
          episode: streamData.episode || null,
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
        const similarTmdbData = similarTitle.data || {};

        expandedSimilarTitles.push({
          key,
          name: similarTitle.name,
          poster_path: this._getPosterPath(similarTmdbData.poster_path),
          release_date: similarTitle.release_date,
          type: similarTitle.type,
        });
      }

      const details = {
        key: titleKey,
        id: titleData.id,
        name: titleData.name,
        type: mediaType,
        release_date: titleData.release_date,
        overview: tmdbData.overview || '',
        poster_path: this._getPosterPath(posterPath),
        backdrop_path: this._getBackdropPath(backdropPath),
        vote_average: tmdbData.vote_average || 0.0,
        vote_count: tmdbData.vote_count || 0,
        genres: (tmdbData.genres || []).map(g => g.name || g),
        runtime: mediaType === 'movies' ? tmdbData.runtime : null,
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
      console.error('Error getting title details:', error);
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

      const titlesData = await this._getTitlesData();
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
        const success = await userService.updateUserWatchlist(user.username, titlesToWatchlist, true);
        if (success) {
          totalUpdated += titlesToWatchlist.length;
        }
      }

      if (titlesToUnwatchlist.length > 0) {
        const success = await userService.updateUserWatchlist(user.username, titlesToUnwatchlist, false);
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
      console.error('Error updating watchlist:', error);
      return {
        response: { error: 'Failed to update watchlist status' },
        statusCode: 500,
      };
    }
  }

  /**
   * Refresh titles cache (called by Python engine via cache refresh endpoint)
   */
  async refreshCache() {
    this._titlesCache = null;
    await this._loadTitles();
  }
}

// Export singleton instance
export const titlesService = new TitlesService();

