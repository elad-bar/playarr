import { BaseManager } from './BaseManager.js';

/**
 * M3U8 parameters that should be included in playlist entries
 * Matches Python's M3U8_PARAMETERS
 */
const M3U8_PARAMETERS = [
  'tvg-id',
  'tvg-name',
  'tvg-logo',
  'group-title',
];

/**
 * Playlist manager for handling M3U8 playlist generation
 * Matches Python's PlaylistService
 */
class PlaylistManager extends BaseManager {
  /**
   * @param {import('../services/database.js').DatabaseService} database - Database service instance
   */
  constructor(database) {
    super('PlaylistManager', database);
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
    const collection = this._database.getCollection('titles');
    const titles = await collection.find({
      title_key: { $in: watchlistTitleKeys }
    }).toArray();

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
      if (!title || !title.streams) {
        continue;
      }

      // Extract unique stream IDs from title.streams
      // For movies: "main"
      // For tvshows: "S01-E01", "S01-E02", etc.
      for (const [streamId, streamData] of Object.entries(title.streams)) {
        // Skip if stream has no sources
        const hasSources = Array.isArray(streamData) 
          ? streamData.length > 0 
          : (streamData?.sources && Array.isArray(streamData.sources) && streamData.sources.length > 0);
        
        if (!hasSources) {
          continue;
        }

        // Parse season/episode from stream ID for TV shows
        let seasonNumber = null;
        let episodeNumber = null;
        
        if (mediaType === 'tvshows' && streamId !== 'main') {
          const match = streamId.match(/^S(\d+)-E(\d+)$/i);
          if (match) {
            seasonNumber = parseInt(match[1], 10);
            episodeNumber = parseInt(match[2], 10);
          }
        }

        relevantStreams.push({
          title,
          streamId,
          seasonNumber,
          episodeNumber
        });
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
    for (const { title, streamId, seasonNumber, episodeNumber } of relevantStreams) {
      // Build proxy path
      let proxyPath = '';
      const year = title.release_date ? new Date(title.release_date).getFullYear() : '';
      
      if (mediaType === 'movies') {
        proxyPath = `${mediaType}/${title.title} (${year}) [tmdb=${title.title_id}]/${title.title} (${year}).strm`;
      } else {
        // TV show
        const seasonStr = `Season ${seasonNumber}`;
        proxyPath = `${mediaType}/${title.title} (${year}) [tmdb=${title.title_id}]/${seasonStr}/${title.title} (${year}) ${streamId}.strm`;
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

