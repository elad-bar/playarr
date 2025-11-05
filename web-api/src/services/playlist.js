import { titlesService } from './titles.js';

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
 * Playlist service for handling M3U8 playlist generation
 * Matches Python's PlaylistService
 */
class PlaylistService {
  constructor() {
    // No initialization needed
  }

  /**
   * Get media files mapping for all titles in watchlist
   * Matches Python's PlaylistService.get_media_files_mapping()
   */
  async getMediaFilesMapping(baseUrl, mediaType, user = null) {
    const mediaFiles = {};

    // Get titles in watchlist
    let watchlistTitleKeys = [];
    if (user && user.watchlist) {
      watchlistTitleKeys = user.watchlist;
    } else {
      // If no user, get all titles with watchlist flag set to true
      // This matches backward compatibility behavior
      watchlistTitleKeys = await this._getTitlesInWatchlist(mediaType);
    }

    const titlesData = await titlesService.getTitlesData();

    for (const titleKey of watchlistTitleKeys) {
      const title = titlesData.get(titleKey);

      if (!title) {
        continue;
      }

      const currentTitleType = title.type;

      if (currentTitleType !== mediaType) {
        continue;
      }

      const streams = title.streams || {};

      for (const [streamKey, streamData] of Object.entries(streams)) {
        const streamProxyData = streamData.proxy;

        if (!streamProxyData) {
          continue;
        }

        const streamProxyPath = streamProxyData.path;
        const streamProxyUrl = streamProxyData.url;

        if (!streamProxyPath || !streamProxyUrl) {
          continue;
        }

        const streamUrl = `${baseUrl}/api/stream/${streamProxyUrl}`;

        mediaFiles[streamProxyPath] = streamUrl;
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

    // Get titles in watchlist
    let watchlistTitleKeys = [];
    if (user && user.watchlist) {
      watchlistTitleKeys = user.watchlist;
    } else {
      // If no user, get all titles with watchlist flag set to true
      // This matches backward compatibility behavior
      watchlistTitleKeys = await this._getTitlesInWatchlist(mediaType);
    }

    const titlesData = await titlesService.getTitlesData();

    for (const titleKey of watchlistTitleKeys) {
      const title = titlesData.get(titleKey);

      if (!title) {
        continue;
      }

      const currentTitleType = title.type;

      if (currentTitleType !== mediaType) {
        continue;
      }

      const streams = title.streams || {};

      for (const [streamKey, streamData] of Object.entries(streams)) {
        const streamLines = this._getM3u8Item(streamData, baseUrl);
        lines.push(...streamLines);
      }
    }

    return lines.join('\n');
  }

  /**
   * Get M3U8 item for a specific stream
   * Matches Python's PlaylistService._get_m3u8_item()
   */
  _getM3u8Item(streamData, baseUrl) {
    const streamProxyData = streamData.proxy;

    if (!streamProxyData) {
      return [];
    }

    const tvgName = streamProxyData['tvg-name'];
    const proxyStreamUrl = streamProxyData.url;

    if (!tvgName || !proxyStreamUrl) {
      return [];
    }

    const streamUrl = `${baseUrl}/api/stream/${proxyStreamUrl}`;

    // Build parameters from proxy data, only including M3U8 parameters
    const paramsParts = [];
    for (const [key, value] of Object.entries(streamProxyData)) {
      if (M3U8_PARAMETERS.includes(key)) {
        paramsParts.push(`${key}="${value}"`);
      }
    }

    const params = paramsParts.join(' ');

    const metadata = `#EXTINF:-1 ${params},${tvgName}`;

    return [metadata, streamUrl];
  }

  /**
   * Get all titles in watchlist (for backward compatibility when no user provided)
   * Matches Python's TMDBProvider.get_titles_in_watchlist()
   */
  async _getTitlesInWatchlist(mediaType) {
    const titlesData = await titlesService.getTitlesData();
    const watchlistTitleKeys = [];

    for (const [titleKey, titleData] of titlesData.entries()) {
      // Filter by media type
      if (titleData.type !== mediaType) {
        continue;
      }

      // Check if title has watchlist flag set to true
      if (titleData.watchlist === true) {
        watchlistTitleKeys.push(titleKey);
      }
    }

    return watchlistTitleKeys;
  }
}

// Export singleton instance
export const playlistService = new PlaylistService();

