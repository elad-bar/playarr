import { BaseManager } from './BaseManager.js';

/**
 * Playlist manager for handling M3U8 playlist generation
 * Matches Python's PlaylistService
 */
class PlaylistManager extends BaseManager {
  /**
   * @param {import('../repositories/TitleRepository.js').TitleRepository} titleRepo - Title repository
   * @param {import('./liveTV.js').LiveTVManager} [liveTVManager] - Live TV manager instance (optional)
   */
  constructor(titleRepo, liveTVManager = null) {
    super('PlaylistManager');
    this._titleRepo = titleRepo;
    this._liveTVManager = liveTVManager;
  }

  /**
   * Get relevant titles and their unique streams for user watchlist filtered by media type
   * Optimized to query MongoDB directly for only watchlist titles
   * @private
   * @param {string} mediaType - Media type ('movies' or 'tvshows')
   * @param {Object} user - User object with watchlist
   * @returns {Promise<Array<{title: Object, streamId: string, seasonNumber?: number, episodeNumber?: number}>>} Array of title-stream combinations
   */
  async _getWatchlistStreams(mediaType, user = null) {
    // Get titles in watchlist from user only (no fallbacks)
    if (!user || !user.watchlist || !Array.isArray(user.watchlist)) {
      return [];
    }

    const watchlistTitleKeys = user.watchlist.filter(key => key.startsWith(`${mediaType}-`));
    
    if (watchlistTitleKeys.length === 0) {
      return [];
    }

    // Query MongoDB directly for only the watchlist titles
    const titles = await this._titleRepo.findByTitleKeys(watchlistTitleKeys);

    if (!titles || titles.length === 0) {
      return [];
    }

    // Create a Map for quick lookup
    const titlesMap = new Map();
    for (const title of titles) {
      if (title.title_key) {
        titlesMap.set(title.title_key, title);
      }
    }

    // Retrieve unique streams for watchlist titles
    const relevantStreams = [];

    for (const titleKey of watchlistTitleKeys) {
      // Get title from titles map
      const title = titlesMap.get(titleKey);
      if (!title) {
        continue;
      }

      // Check media array (all items in array have sources available)
      const media = title.media || [];
      if (media.length === 0) {
        continue; // Skip titles without media
      }

      // For movies: find media item with name === 'main'
      if (mediaType === 'movies') {
        const mainMedia = media.find(m => m.name === 'main');
        if (mainMedia) {
          relevantStreams.push({
            title,
            mediaItem: mainMedia,
            streamId: 'main',
            seasonNumber: null,
            episodeNumber: null
          });
        }
      } else {
        // For TV shows: iterate media array (only available episodes)
        for (const mediaItem of media) {
          relevantStreams.push({
            title,
            mediaItem,
            streamId: `S${String(mediaItem.season).padStart(2, '0')}-E${String(mediaItem.episode).padStart(2, '0')}`,
            seasonNumber: mediaItem.season,
            episodeNumber: mediaItem.episode
          });
        }
      }
    }

    return relevantStreams;
  }

  /**
   * Get media files mapping for all titles in watchlist
   * Matches Python's PlaylistService.get_media_files_mapping()
   */
  async getMediaFilesMapping(baseUrl, mediaType, user = null) {
    const mediaFiles = {};
    const relevantStreams = await this._getWatchlistStreams(mediaType, user);

    // Build output format: { proxyPath: streamUrl }
    for (const { title, mediaItem, streamId, seasonNumber, episodeNumber } of relevantStreams) {
      // Get proxy path from mediaItem.proxy_path
      const proxyPath = mediaItem?.proxy_path;
      if (!proxyPath) {
        continue; // Skip if no stream path
      }

      // Build stream URL
      let streamUrl = '';
      if (mediaType === 'movies') {
        streamUrl = `${baseUrl}/api/stream/movies/${title.title_id}?api_key=${user.api_key}`;
      } else {
        streamUrl = `${baseUrl}/api/stream/tvshows/${title.title_id}/${seasonNumber}/${episodeNumber}?api_key=${user.api_key}`;
      }

      mediaFiles[proxyPath] = streamUrl;
    }

    // Add Live TV channels if user has Live TV configured
    if (user?.liveTV?.m3u_url && this._liveTVManager) {
      try {
        const channels = await this._liveTVManager.getUserChannels(user.username);
        channels.forEach(channel => {
          const channelId = encodeURIComponent(channel.channel_id);
          mediaFiles[`livetv/${channel.channel_id}.m3u`] = 
            `${baseUrl}/api/livetv/stream/${channelId}?api_key=${user.api_key}`;
        });
      } catch (error) {
        this.logger.error(`Error adding Live TV channels to media files mapping: ${error.message}`);
      }
    }

    return mediaFiles;
  }

  /**
   * Generate unified M3U8 playlist from all titles in watchlist
   * Matches Python's PlaylistService.get_m3u8_streams()
   */
  async getM3u8Streams(baseUrl, mediaType, user = null) {
    const lines = ['#EXTM3U'];
    const relevantStreams = await this._getWatchlistStreams(mediaType, user);

    // Build output format: M3U playlist lines
    for (const { title, streamId, seasonNumber, episodeNumber } of relevantStreams) {
      // Build stream URL
      let streamUrl = '';
      if (mediaType === 'movies') {
        streamUrl = `${baseUrl}/api/stream/movies/${title.title_id}?api_key=${user.api_key}`;
      } else {
        streamUrl = `${baseUrl}/api/stream/tvshows/${title.title_id}/${seasonNumber}/${episodeNumber}?api_key=${user.api_key}`;
      }

      // Build M3U metadata
      const tvgName = mediaType === 'movies' 
        ? title.title 
        : `${title.title} - S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}`;
      
      const tvgId = `${mediaType}-${title.title_id}${mediaType === 'tvshows' ? `-${streamId}` : ''}`;
      const tvgLogo = title.poster_path ? `https://image.tmdb.org/t/p/w300${title.poster_path}` : '';
      const groupTitle = title.genres && title.genres.length > 0 
        ? title.genres.map(g => typeof g === 'string' ? g : g.name).join(', ')
        : '';

      const paramsParts = [];
      if (tvgId) paramsParts.push(`tvg-id="${tvgId}"`);
      if (tvgName) paramsParts.push(`tvg-name="${tvgName}"`);
      if (tvgLogo) paramsParts.push(`tvg-logo="${tvgLogo}"`);
      if (groupTitle) paramsParts.push(`group-title="${groupTitle}"`);

      const params = paramsParts.join(' ');
      const metadata = `#EXTINF:-1 ${params},${tvgName}`;

      lines.push(metadata);
      lines.push(streamUrl);
    }

    return lines.join('\n');
  }

}

// Export class
export { PlaylistManager };

