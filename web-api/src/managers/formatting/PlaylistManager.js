import { BaseWatchlistFormattingManager } from './BaseWatchlistFormattingManager.js';

/**
 * Playlist manager for handling M3U8 playlist generation
 * Matches Python's PlaylistService
 */
class PlaylistManager extends BaseWatchlistFormattingManager {
  /**
   * @param {import('../domain/TitlesManager.js').TitlesManager} titlesManager - Titles manager instance
   * @param {import('../domain/IPTVProviderManager.js').IPTVProviderManager} iptvProviderManager - IPTV Provider manager instance
   * @param {import('../domain/ChannelManager.js').ChannelManager} channelManager - Channel manager instance
   * @param {import('../domain/ProgramManager.js').ProgramManager} programManager - Program manager instance
   */
  constructor(titlesManager, iptvProviderManager, channelManager, programManager) {
    super('PlaylistManager', titlesManager, iptvProviderManager, channelManager, programManager);
  }

  /**
   * Get media files mapping for all titles in watchlist
   * Matches Python's PlaylistService.get_media_files_mapping()
   */
  async getMediaFilesMapping(baseUrl, mediaType, user = null) {
    const mediaFiles = {};
    // Use inherited _getWatchlistStreams from BaseWatchlistFormattingManager
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
    if (user?.liveTV?.m3u_url && this._channelManager) {
      try {
        const channels = await this._channelManager.getChannelsByUsername(user.username);
        
        // Get current programs for all channels
        const now = new Date();
        const currentPrograms = await this._programManager?.getCurrentPrograms(user.username, now) || [];
        
        // Map programs by channel_id
        const programMap = new Map();
        currentPrograms.forEach(prog => {
          if (!programMap.has(prog.channel_id)) {
            programMap.set(prog.channel_id, prog);
          }
        });
        
        // Add current program to channels
        const channelsWithPrograms = channels.map(channel => ({
          ...channel,
          currentProgram: programMap.get(channel.channel_id) || null
        }));
        
        channelsWithPrograms.forEach(channel => {
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
    // Use inherited _getWatchlistStreams from BaseWatchlistFormattingManager
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

