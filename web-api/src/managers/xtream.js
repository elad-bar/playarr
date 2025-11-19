import { BaseManager } from './BaseManager.js';
import { DatabaseCollections, toCollectionName } from '../config/collections.js';

/**
 * Xtream Code API manager for exposing movies and TV shows in Xtream Code format
 * Matches Xtream Code API response structure
 * Filters by user watchlist (same as playlist endpoints)
 */
class XtreamManager extends BaseManager {
  /**
   * @param {import('./titles.js').TitlesManager} titlesManager - Titles manager instance
   * @param {import('./liveTV.js').LiveTVManager} [liveTVManager] - Live TV manager instance (optional)
   */
  constructor(titlesManager, liveTVManager = null) {
    super('XtreamManager');
    this._titlesManager = titlesManager;
    this._liveTVManager = liveTVManager;
    this._titleRepo = titlesManager._titleRepo;
    this._titlesCollection = toCollectionName(DatabaseCollections.TITLES);
  }

  /**
   * Get watchlist titles for a specific media type
   * Optimized to query MongoDB directly for only watchlist titles
   * @private
   * @param {Object} user - Authenticated user object
   * @param {string} mediaType - Media type ('movies' or 'tvshows')
   * @returns {Promise<Map<string, Object>>} Map of title_key to title object
   */
  async _getWatchlistTitles(user, mediaType) {
    // Get titles in watchlist from user only (no fallbacks)
    if (!user || !user.watchlist || !Array.isArray(user.watchlist)) {
      return new Map();
    }

    const watchlistTitleKeys = user.watchlist.filter(key => key.startsWith(`${mediaType}-`));
    
    if (watchlistTitleKeys.length === 0) {
      return new Map();
    }

    // Query MongoDB directly for only the watchlist titles
    const titles = await this._titleRepo.findByTitleKeys(watchlistTitleKeys);

    if (!titles || titles.length === 0) {
      return new Map();
    }

    // Create a Map for quick lookup
    const watchlistTitles = new Map();
    for (const title of titles) {
      if (title.title_key) {
        watchlistTitles.set(title.title_key, title);
      }
    }

    return watchlistTitles;
  }

  /**
   * Get VOD (movie) categories
   * @param {Object} user - Authenticated user object
   * @returns {Promise<Array>} Array of category objects
   */
  async getVodCategories(user) {
    try {
      const watchlistTitles = await this._getWatchlistTitles(user, 'movies');
      const categories = new Map();

      // Extract unique categories from movies in watchlist
      for (const [titleKey, title] of watchlistTitles.entries()) {
        if (title.genres && Array.isArray(title.genres)) {
          title.genres.forEach(genre => {
            const genreName = typeof genre === 'string' ? genre : genre.name;
            if (genreName && !categories.has(genreName)) {
              categories.set(genreName, {
                category_id: categories.size + 1,
                category_name: genreName,
                parent_id: 0
              });
            }
          });
        }
      }

      return Array.from(categories.values());
    } catch (error) {
      this.logger.error('Error getting VOD categories:', error);
      return [];
    }
  }

  /**
   * Get VOD (movie) streams
   * @param {Object} user - Authenticated user object
   * @param {string} baseUrl - Base URL for stream endpoints
   * @param {number} [categoryId] - Optional category ID to filter
   * @returns {Promise<Array>} Array of movie stream objects
   */
  async getVodStreams(user, baseUrl, categoryId = null) {
    try {
      const watchlistTitles = await this._getWatchlistTitles(user, 'movies');
      const movies = [];

      for (const [titleKey, title] of watchlistTitles.entries()) {

        // Filter by category if specified
        if (categoryId) {
          const hasCategory = title.genres?.some(genre => {
            const genreName = typeof genre === 'string' ? genre : genre.name;
            // Simple category matching - you may need to adjust this
            return genreName && genreName.toLowerCase().includes(String(categoryId));
          });
          if (!hasCategory) continue;
        }

        // Generate stream URL in Xtream Code API standard format
        const streamUrl = `${baseUrl}/movie/${user.username}/${user.api_key}/movies-${title.title_id}.mp4`;

        const movie = {
          stream_id: title.title_id,
          name: title.title,
          title: title.title,
          container_extension: 'mp4',
          info: {
            tmdb_id: title.title_id,
            name: title.title,
            release_date: title.release_date || '',
            rating: title.vote_average?.toString() || '0',
            duration: title.runtime ? `${title.runtime} min` : '',
            plot: title.overview || '',
            cast: '',
            director: '',
            genre: (title.genres || []).map(g => typeof g === 'string' ? g : g.name).join(', '),
            last_modified: title.lastUpdated || title.createdAt || ''
          },
          category_id: this._getCategoryId(title.genres),
          category_name: this._getCategoryName(title.genres),
          stream_icon: title.poster_path ? `https://image.tmdb.org/t/p/w300${title.poster_path}` : '',
          rating: title.vote_average?.toString() || '0',
          rating_5based: ((title.vote_average || 0) / 2).toFixed(1),
          added: title.createdAt || '',
          release_date: title.release_date || '',
          backdrop_path: title.backdrop_path ? `https://image.tmdb.org/t/p/w1280${title.backdrop_path}` : '',
          stream_url: streamUrl
        };

        movies.push(movie);
      }

      return movies;
    } catch (error) {
      this.logger.error('Error getting VOD streams:', error);
      return [];
    }
  }

  /**
   * Get series (TV show) categories
   * @param {Object} user - Authenticated user object
   * @returns {Promise<Array>} Array of category objects
   */
  async getSeriesCategories(user) {
    try {
      const watchlistTitles = await this._getWatchlistTitles(user, 'tvshows');
      const categories = new Map();

      // Extract unique categories from TV shows in watchlist
      for (const [titleKey, title] of watchlistTitles.entries()) {
        if (title.genres && Array.isArray(title.genres)) {
          title.genres.forEach(genre => {
            const genreName = typeof genre === 'string' ? genre : genre.name;
            if (genreName && !categories.has(genreName)) {
              categories.set(genreName, {
                category_id: String(categories.size + 1),
                category_name: genreName,
                parent_id: 0,
                category_type: 'series'
              });
            }
          });
        }
      }

      return Array.from(categories.values());
    } catch (error) {
      this.logger.error('Error getting series categories:', error);
      return [];
    }
  }

  /**
   * Get series (TV shows)
   * @param {Object} user - Authenticated user object
   * @param {string} baseUrl - Base URL for stream endpoints
   * @param {number} [categoryId] - Optional category ID to filter
   * @returns {Promise<Array>} Array of series objects
   */
  async getSeries(user, baseUrl, categoryId = null) {
    try {
      const watchlistTitles = await this._getWatchlistTitles(user, 'tvshows');
      const series = [];

      for (const [titleKey, title] of watchlistTitles.entries()) {

        // Filter by category if specified
        if (categoryId) {
          const hasCategory = title.genres?.some(genre => {
            const genreName = typeof genre === 'string' ? genre : genre.name;
            return genreName && genreName.toLowerCase().includes(String(categoryId));
          });
          if (!hasCategory) continue;
        }

        const seriesObj = {
          series_id: title.title_id,
          name: title.title,
          series_name: title.title,
          cover: title.poster_path ? `https://image.tmdb.org/t/p/w300${title.poster_path}` : '',
          plot: title.overview || '',
          cast: '',
          director: '',
          genre: (title.genres || []).map(g => typeof g === 'string' ? g : g.name).join(', '),
          release_date: title.release_date || '',
          last_modified: title.lastUpdated || title.createdAt || '',
          rating: title.vote_average?.toString() || '0',
          rating_5based: ((title.vote_average || 0) / 2).toFixed(1),
          category_id: this._getCategoryId(title.genres),
          category_name: this._getCategoryName(title.genres),
          backdrop_path: title.backdrop_path ? `https://image.tmdb.org/t/p/w1280${title.backdrop_path}` : '',
          num: this._getEpisodeCount(title.media)
        };

        series.push(seriesObj);
      }

      return series;
    } catch (error) {
      this.logger.error('Error getting series:', error);
      return [];
    }
  }

  /**
   * Get VOD (movie) info
   * @param {Object} user - Authenticated user object
   * @param {string} baseUrl - Base URL for stream endpoints
   * @param {number} vodId - Movie ID
   * @returns {Promise<Object|null>} Movie info object
   */
  async getVodInfo(user, baseUrl, vodId) {
    try {
      const watchlistTitles = await this._getWatchlistTitles(user, 'movies');
      const titleKey = `movies-${vodId}`;
      const title = watchlistTitles.get(titleKey);

      if (!title) {
        return null;
      }

      // Build movie_image URL from poster_path
      const movieImage = title.poster_path 
        ? `https://image.tmdb.org/t/p/w300${title.poster_path}` 
        : '';

      // Build backdrop_path as string (not array)
      const backdropPath = title.backdrop_path 
        ? `https://image.tmdb.org/t/p/w1280${title.backdrop_path}`
        : '';

      // Calculate duration_secs and format duration
      const durationSecs = title.runtime ? title.runtime * 60 : 0;
      const duration = this._formatDuration(title.runtime);

      // Get category ID
      const categoryId = this._getCategoryId(title.genres);

      // Convert createdAt to Unix timestamp (as integer)
      const added = parseInt(this._toUnixTimestamp(title.createdAt), 10);

      // Build info object with conditional duration_secs
      const infoObj = {
        movie_image: movieImage,
        tmdb_id: title.title_id?.toString() || '',
        backdrop_path: backdropPath,
        genre: (title.genres || []).map(g => typeof g === 'string' ? g : g.name).join(' / ') || '',
        plot: title.overview || '',
        cast: '',
        rating: title.vote_average?.toString() || '0',
        rating_5based: ((title.vote_average || 0) / 2).toFixed(1),
        director: '',
        release_date: title.release_date || '',
        name: title.title,
        duration: duration
      };

      // Only include duration_secs if value > 0
      if (durationSecs > 0) {
        infoObj.duration_secs = durationSecs;
      }

      return {
        info: infoObj,
        movie_data: {
          stream_id: title.title_id,
          name: title.title,
          added: added,
          category_id: categoryId.toString(),
          container_extension: 'mp4',
          custom_sid: '',
          direct_source: ''
        }
      };
    } catch (error) {
      this.logger.error(`Error getting VOD info for ${vodId}:`, error);
      return null;
    }
  }

  /**
   * Get series info with episodes
   * @param {Object} user - Authenticated user object
   * @param {string} baseUrl - Base URL for stream endpoints
   * @param {number} seriesId - Series ID
   * @returns {Promise<Object|null>} Series info object with episodes
   */
  async getSeriesInfo(user, baseUrl, seriesId) {
    try {
      const watchlistTitles = await this._getWatchlistTitles(user, 'tvshows');
      const titleKey = `tvshows-${seriesId}`;
      const title = watchlistTitles.get(titleKey);

      if (!title) {
        return null;
      }

      // Group episodes by season
      const episodesBySeason = {};
      const seasonsMap = new Map();

      // Build episodes from media array (only available episodes)
      const media = title.media || [];
      if (Array.isArray(media) && media.length > 0) {
        for (const mediaItem of media) {
          // Skip movies (they don't have season/episode)
          if (mediaItem.season === null || mediaItem.season === undefined ||
              mediaItem.episode === null || mediaItem.episode === undefined) {
            continue;
          }

          const season = mediaItem.season;
          const episode = mediaItem.episode;
          
          // Track unique seasons with all required fields
          if (!seasonsMap.has(season)) {
            seasonsMap.set(season, {
              season_number: season,
              air_date: '',
              name: `Season ${season}`,
              overview: '',
              cover: '',
              cover_big: '',
              episode_count: 0,
              id: season,
              vote_average: 0
            });
          }
          
          // Initialize season array if needed
          if (!episodesBySeason[season]) {
            episodesBySeason[season] = [];
          }
          
          // Format season and episode numbers with padding (S01E01)
          const seasonPadded = String(season).padStart(2, '0');
          const episodePadded = String(episode).padStart(2, '0');

          episodesBySeason[season].push({
            id: `tvshows-${title.title_id}-${season}-${episode}`,
            episode_num: episode,
            season_num: season,
            season: season,
            title: mediaItem.name || `S${seasonPadded}E${episodePadded}`,
            episode_name: mediaItem.name || `S${seasonPadded}E${episodePadded}`,
            container_extension: 'mp4',
            info: {
              plot: mediaItem.overview || '',
              release_date: mediaItem.air_date || '',
              duration: ''
            }
          });
          
          // Update episode count for this season
          const seasonData = seasonsMap.get(season);
          seasonData.episode_count = episodesBySeason[season].length;
        }
      }

      // Build seasons as array (sorted by season_number)
      const seasons = Array.from(seasonsMap.values()).sort((a, b) => a.season_number - b.season_number);

      // Build episodes object (keyed by season number as string)
      const episodes = {};
      for (const [seasonNum, episodeList] of Object.entries(episodesBySeason)) {
        episodes[String(seasonNum)] = episodeList;
      }

      return {
        info: {
          tmdb_id: title.title_id,
          name: title.title,
          cover: title.poster_path ? `https://image.tmdb.org/t/p/w300${title.poster_path}` : '',
          backdrop_path: title.backdrop_path ? `https://image.tmdb.org/t/p/w1280${title.backdrop_path}` : '',
          plot: title.overview || '',
          cast: '',
          director: '',
          genre: (title.genres || []).map(g => typeof g === 'string' ? g : g.name).join(', '),
          release_date: title.release_date || '',
          last_modified: title.lastUpdated || title.createdAt || '',
          rating: title.vote_average?.toString() || '0',
          rating_5based: ((title.vote_average || 0) / 2).toFixed(1)
        },
        seasons: seasons,
        episodes: episodes
      };
    } catch (error) {
      this.logger.error(`Error getting series info for ${seriesId}:`, error);
      return null;
    }
  }

  /**
   * Format duration from minutes to HH:MM:SS format
   * @private
   * @param {number|null|undefined} runtimeMinutes - Runtime in minutes
   * @returns {string} Duration in HH:MM:SS format or empty string
   */
  _formatDuration(runtimeMinutes) {
    if (!runtimeMinutes || runtimeMinutes === 0) {
      return '';
    }

    const totalSeconds = runtimeMinutes * 60;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  /**
   * Convert ISO timestamp to Unix timestamp (seconds since epoch)
   * @private
   * @param {string|null|undefined} isoTimestamp - ISO timestamp string
   * @returns {string} Unix timestamp in seconds or current timestamp if not available
   */
  _toUnixTimestamp(isoTimestamp) {
    if (!isoTimestamp) {
      return Math.floor(Date.now() / 1000).toString();
    }

    try {
      const date = new Date(isoTimestamp);
      return Math.floor(date.getTime() / 1000).toString();
    } catch (error) {
      return Math.floor(Date.now() / 1000).toString();
    }
  }

  /**
   * Get category ID from genres
   * @private
   * @param {Array} genres - Array of genre objects or strings
   * @returns {string} Category ID as string
   */
  _getCategoryId(genres) {
    if (!genres || genres.length === 0) return '0';
    const firstGenre = genres[0];
    const genreName = typeof firstGenre === 'string' ? firstGenre : firstGenre.name;
    // Simple hash-based ID
    return String(Math.abs(genreName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) % 1000);
  }

  /**
   * Get category name from genres
   * @private
   * @param {Array} genres - Array of genre objects or strings
   * @returns {string} Category name
   */
  _getCategoryName(genres) {
    if (!genres || genres.length === 0) return 'Uncategorized';
    const firstGenre = genres[0];
    return typeof firstGenre === 'string' ? firstGenre : firstGenre.name;
  }

  /**
   * Get episode count from streams
   * @private
   * @param {Object} streams - Streams object
   * @returns {number} Episode count
   */
  _getEpisodeCount(media) {
    if (!media || !Array.isArray(media)) return 0;
    return media.length;
  }

  /**
   * Get Live TV categories (channel groups)
   * @param {Object} user - Authenticated user object
   * @returns {Promise<Array>} Array of category objects
   */
  async getLiveCategories(user) {
    try {
      if (!this._liveTVManager || !user?.liveTV?.m3u_url) {
        return [];
      }

      const channels = await this._liveTVManager.getUserChannels(user.username);
      const categories = new Map();

      // Extract unique group titles
      channels.forEach(channel => {
        if (channel.group_title && !categories.has(channel.group_title)) {
          categories.set(channel.group_title, {
            category_id: categories.size + 1,
            category_name: channel.group_title,
            parent_id: 0
          });
        }
      });

      return Array.from(categories.values());
    } catch (error) {
      this.logger.error('Error getting Live TV categories:', error);
      return [];
    }
  }

  /**
   * Get Live TV streams (channels)
   * @param {Object} user - Authenticated user object
   * @param {string} baseUrl - Base URL for stream endpoints
   * @param {number} [categoryId] - Optional category ID to filter by group
   * @returns {Promise<Array>} Array of channel stream objects
   */
  async getLiveStreams(user, baseUrl, categoryId = null) {
    try {
      if (!this._liveTVManager || !user?.liveTV?.m3u_url) {
        return [];
      }

      const channels = await this._liveTVManager.getUserChannels(user.username);
      const categories = new Map();
      let categoryCounter = 1;

      // Build category map
      channels.forEach(channel => {
        if (channel.group_title && !categories.has(channel.group_title)) {
          categories.set(channel.group_title, categoryCounter++);
        }
      });

      // Filter by category if specified
      let filteredChannels = channels;
      if (categoryId) {
        const categoryName = Array.from(categories.entries()).find(([_, id]) => id === categoryId)?.[0];
        if (categoryName) {
          filteredChannels = channels.filter(ch => ch.group_title === categoryName);
        } else {
          return [];
        }
      }

      // Convert to Xtream format
      return filteredChannels.map((channel, index) => {
        const channelId = encodeURIComponent(channel.channel_id);
        const streamUrl = `${baseUrl}/api/livetv/stream/${channelId}?api_key=${user.api_key}`;
        const categoryIdForChannel = channel.group_title ? categories.get(channel.group_title) : 0;

        return {
          num: index + 1,
          name: channel.name,
          stream_type: 'live',
          stream_id: channel.channel_id,
          stream_icon: channel.tvg_logo || '',
          epg_channel_id: channel.tvg_id || channel.channel_id,
          added: channel.createdAt ? this._toUnixTimestamp(channel.createdAt) : Math.floor(Date.now() / 1000).toString(),
          category_id: String(categoryIdForChannel),
          category_ids: [String(categoryIdForChannel)],
          custom_sid: '',
          tv_archive: 0,
          direct_source: streamUrl,
          tv_archive_duration: 0
        };
      });
    } catch (error) {
      this.logger.error('Error getting Live TV streams:', error);
      return [];
    }
  }

  /**
   * Get short EPG for Live TV channels
   * @param {Object} user - Authenticated user object
   * @returns {Promise<Array>} Array of EPG objects
   */
  async getShortEpg(user) {
    try {
      if (!this._liveTVManager || !user?.liveTV?.m3u_url) {
        return [];
      }

      const channels = await this._liveTVManager.getUserChannels(user.username);
      const now = new Date();
      const epgData = [];

      for (const channel of channels) {
        const programs = await this._liveTVManager.getChannelPrograms(user.username, channel.channel_id);
        
        // Get current and next program
        const currentProgram = programs.find(p => p.start <= now && p.stop >= now);
        const nextProgram = programs.find(p => p.start > now);

        if (currentProgram || nextProgram) {
          epgData.push({
            id: channel.channel_id,
            epg_listings: [
              ...(currentProgram ? [{
                id: `${channel.channel_id}_${currentProgram.start.getTime()}`,
                title: currentProgram.title,
                lang: 'en',
                start: this._toUnixTimestamp(currentProgram.start),
                end: this._toUnixTimestamp(currentProgram.stop),
                description: currentProgram.desc || '',
                channel_id: channel.channel_id,
                start_timestamp: this._toUnixTimestamp(currentProgram.start),
                stop_timestamp: this._toUnixTimestamp(currentProgram.stop),
                now_playing: 1,
                has_archive: 0
              }] : []),
              ...(nextProgram ? [{
                id: `${channel.channel_id}_${nextProgram.start.getTime()}`,
                title: nextProgram.title,
                lang: 'en',
                start: this._toUnixTimestamp(nextProgram.start),
                end: this._toUnixTimestamp(nextProgram.stop),
                description: nextProgram.desc || '',
                channel_id: channel.channel_id,
                start_timestamp: this._toUnixTimestamp(nextProgram.start),
                stop_timestamp: this._toUnixTimestamp(nextProgram.stop),
                now_playing: 0,
                has_archive: 0
              }] : [])
            ]
          });
        }
      }

      return epgData;
    } catch (error) {
      this.logger.error('Error getting short EPG:', error);
      return [];
    }
  }
}

export { XtreamManager };

