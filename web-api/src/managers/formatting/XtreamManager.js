import { BaseWatchlistFormattingManager } from './BaseWatchlistFormattingManager.js';
import { DatabaseCollections, toCollectionName } from '../../config/collections.js';

/**
 * Xtream Code API manager for exposing movies and TV shows in Xtream Code format
 * Matches Xtream Code API response structure
 * Filters by user watchlist (same as playlist endpoints)
 */
class XtreamManager extends BaseWatchlistFormattingManager {
  /**
   * @param {import('../domain/TitlesManager.js').TitlesManager} titlesManager - Titles manager instance
   * @param {import('../domain/IPTVProviderManager.js').IPTVProviderManager} iptvProviderManager - IPTV Provider manager instance
   * @param {import('../domain/ChannelManager.js').ChannelManager} channelManager - Channel manager instance
   * @param {import('../domain/ProgramManager.js').ProgramManager} programManager - Program manager instance
   * @param {import('../../managers/orchestration/MetricsManager.js').default} metricsManager - Metrics manager instance
   */
  constructor(titlesManager, iptvProviderManager, channelManager, programManager, metricsManager) {
    super('XtreamManager', titlesManager, iptvProviderManager, channelManager, programManager, metricsManager);
    this._titlesCollection = toCollectionName(DatabaseCollections.TITLES);
  }

  /**
   * Get VOD (movie) categories
   * @param {Object} user - Authenticated user object
   * @returns {Promise<Array>} Array of category objects
   */
  async getVodCategories(user) {
    try {
      const genres = await this._titlesManager.getUniqueGenresByType('movies');
      return genres.map(genre => ({
        category_id: String(genre.id),
        category_name: genre.name,
        parent_id: 0
      }));
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

      let index = 0;
      for (const [titleKey, title] of watchlistTitles.entries()) {
        // Check if movie has available media (media item with name === 'main')
        const media = title.media || [];
        const hasMainMedia = media.some(m => m.name === 'main');
        if (!hasMainMedia) {
          continue; // Skip movies without available streams
        }

        // Filter by category if specified
        if (categoryId) {
          const hasCategory = title.genres?.some(genre => {
            const genreName = typeof genre === 'string' ? genre : genre.name;
            // Simple category matching - you may need to adjust this
            return genreName && genreName.toLowerCase().includes(String(categoryId));
          });
          if (!hasCategory) continue;
        }

        // Get category ID and convert to array
        const categoryIdStr = this._getCategoryId(title.genres);
        const categoryIdNum = parseInt(categoryIdStr, 10) || 0;

        const movie = {
          num: ++index,
          name: title.title,
          stream_type: 'movie',
          stream_id: title.title_id,
          stream_icon: title.poster_path ? `https://image.tmdb.org/t/p/w300${title.poster_path}` : '',
          rating: title.vote_average?.toString() || '0',
          rating_5based: parseFloat(((title.vote_average || 0) / 2).toFixed(1)) || 0,
          tmdb: String(title.title_id || ''),
          trailer: '',
          added: this._toUnixTimestamp(title.createdAt),
          is_adult: 0,
          category_id: categoryIdStr,
          category_ids: [categoryIdNum],
          container_extension: 'mp4',
          custom_sid: null,
          direct_source: ''
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
      const genres = await this._titlesManager.getUniqueGenresByType('tvshows');
      return genres.map(genre => ({
        category_id: String(genre.id),
        category_name: genre.name,
        parent_id: 0
      }));
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

      let index = 0;
      for (const [titleKey, title] of watchlistTitles.entries()) {
        // Check if TV show has available media (at least one episode)
        const media = title.media || [];
        if (media.length === 0) {
          continue; // Skip TV shows without available episodes
        }

        // Filter by category if specified
        if (categoryId) {
          const hasCategory = title.genres?.some(genre => {
            const genreName = typeof genre === 'string' ? genre : genre.name;
            return genreName && genreName.toLowerCase().includes(String(categoryId));
          });
          if (!hasCategory) continue;
        }

        // Get category ID and convert to array
        const categoryIdStr = this._getCategoryId(title.genres);
        const categoryIdNum = parseInt(categoryIdStr, 10) || 0;

        // Convert backdrop_path to array
        const backdropPath = title.backdrop_path 
          ? [`https://image.tmdb.org/t/p/w1280${title.backdrop_path}`]
          : [];

        const seriesObj = {
          num: ++index,
          name: title.title,
          series_id: title.title_id,
          cover: title.poster_path ? `https://image.tmdb.org/t/p/w300${title.poster_path}` : '',
          plot: title.overview || '',
          cast: '',
          director: '',
          genre: (title.genres || []).map(g => typeof g === 'string' ? g : g.name).join(', '),
          releaseDate: title.release_date || '',
          release_date: title.release_date || '',
          last_modified: this._toUnixTimestamp(title.lastUpdated || title.createdAt),
          rating: title.vote_average?.toString() || '0',
          rating_5based: String(Math.round(((title.vote_average || 0) / 2) * 10) / 10),
          backdrop_path: backdropPath,
          youtube_trailer: '',
          tmdb: String(title.title_id || ''),
          episode_run_time: '0',
          category_id: categoryIdStr,
          category_ids: [categoryIdNum]
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

      // Build backdrop_path as array (not string)
      const backdropPath = title.backdrop_path 
        ? [`https://image.tmdb.org/t/p/w1280${title.backdrop_path}`]
        : [];

      // Calculate duration_secs and format duration
      const durationSecs = title.runtime ? title.runtime * 60 : 0;
      const duration = this._formatDuration(title.runtime);

      // Get category ID
      const categoryId = this._getCategoryId(title.genres);
      const categoryIdNum = parseInt(categoryId, 10) || 0;

      // Convert createdAt to Unix timestamp (as string)
      const added = this._toUnixTimestamp(title.createdAt);

      // Build info object with conditional duration_secs
      const infoObj = {
        tmdb_id: title.title_id?.toString() || '',
        name: title.title,
        o_name: title.title,
        cover_big: title.poster_path ? `https://image.tmdb.org/t/p/w500${title.poster_path}` : '',
        movie_image: movieImage,
        releasedate: title.release_date || '',
        youtube_trailer: '',
        director: '',
        actors: '',
        cast: '',
        description: title.overview || '',
        plot: title.overview || '',
        age: '',
        country: '',
        genre: (title.genres || []).map(g => typeof g === 'string' ? g : g.name).join(', ') || '',
        backdrop_path: backdropPath,
        duration: duration,
        rating: title.vote_average?.toString() || '0',
        status: 'Released'
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
          category_id: categoryId,
          category_ids: [categoryIdNum],
          container_extension: 'mp4',
          custom_sid: null,
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
              episode_count: '0',
              cover_tmdb: '',
              releaseDate: '',
              duration: '0'
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
            season: season,
            title: mediaItem.name || `S${seasonPadded}E${episodePadded}`,
            container_extension: 'mp4',
            info: {
              movie_image: '',
              crew: '',
              rating: '',
              releasedate: mediaItem.air_date || '',
              tmdb_id: '',
              duration_secs: 0,
              duration: '',
              plot: mediaItem.overview || '',
              bitrate: 0
            },
            custom_sid: null,
            added: this._toUnixTimestamp(mediaItem.createdAt || title.createdAt),
            direct_source: ''
          });
          
          // Update episode count for this season
          const seasonData = seasonsMap.get(season);
          seasonData.episode_count = String(episodesBySeason[season].length);
        }
      }

      // Build seasons as array (sorted by season_number)
      const seasons = Array.from(seasonsMap.values()).sort((a, b) => a.season_number - b.season_number);

      // Build episodes object (keyed by season number as string)
      const episodes = {};
      for (const [seasonNum, episodeList] of Object.entries(episodesBySeason)) {
        episodes[String(seasonNum)] = episodeList;
      }

      // Get category ID
      const categoryIdStr = this._getCategoryId(title.genres);
      const categoryIdNum = parseInt(categoryIdStr, 10) || 0;

      // Convert backdrop_path to array
      const backdropPath = title.backdrop_path 
        ? [`https://image.tmdb.org/t/p/w1280${title.backdrop_path}`]
        : [];

      // Return with seasons first, then info (standard order)
      return {
        seasons: seasons,
        info: {
          name: title.title,
          cover: title.poster_path ? `https://image.tmdb.org/t/p/w300${title.poster_path}` : '',
          plot: title.overview || '',
          cast: '',
          director: '',
          genre: (title.genres || []).map(g => typeof g === 'string' ? g : g.name).join(', '),
          releaseDate: title.release_date || '',
          release_date: title.release_date || '',
          last_modified: this._toUnixTimestamp(title.lastUpdated || title.createdAt),
          rating: title.vote_average?.toString() || '0',
          rating_5based: String(Math.round(((title.vote_average || 0) / 2) * 10) / 10),
          backdrop_path: backdropPath,
          tmdb: String(title.title_id || ''),
          youtube_trailer: '',
          episode_run_time: '0',
          category_id: categoryIdStr,
          category_ids: [categoryIdNum]
        },
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
      // Get active providers
      const activeProviders = await this._iptvProviderManager.findByQuery({
        type: { $in: ['agtv', 'xtream'] },
        enabled: { $ne: false },
        deleted: { $ne: true }
      });
      
      if (activeProviders.length === 0) {
        return [];
      }

      const activeProviderIds = activeProviders.map(p => p.id);
      const channels = await this._channelManager._repository.findByQuery({
        provider_id: { $in: activeProviderIds }
      });
      
      const categories = new Map();

      // Extract unique group titles
      channels.forEach(channel => {
        if (channel.group_title && !categories.has(channel.group_title)) {
          categories.set(channel.group_title, {
            category_id: String(categories.size + 1),
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
      // Get active providers
      const activeProviders = await this._iptvProviderManager.findByQuery({
        type: { $in: ['agtv', 'xtream'] },
        enabled: { $ne: false },
        deleted: { $ne: true }
      });
      
      if (activeProviders.length === 0) {
        return [];
      }

      const activeProviderIds = activeProviders.map(p => p.id);
      const channels = await this._channelManager._repository.findByQuery({
        provider_id: { $in: activeProviderIds }
      });
      
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
        // Use channel_key for stream URL: /api/livetv/stream/{channelKey}
        const streamUrl = `${baseUrl}/api/livetv/stream/${encodeURIComponent(channel.channel_key)}?api_key=${user.api_key}`;
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
          category_ids: [categoryIdForChannel],
          custom_sid: null,
          is_adult: 0,
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
      if (!this._channelManager || !user?.liveTV?.m3u_url) {
        return [];
      }

      const channels = await this._channelManager.getChannelsByUsername(user.username);
      const now = new Date();
      const epgData = [];

      for (const channel of channels) {
        const programs = await this._programManager.getProgramsByChannel(user.username, channel.channel_id);
        
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

