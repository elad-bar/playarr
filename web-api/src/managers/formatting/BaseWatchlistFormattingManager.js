import { BaseFormattingManager } from './BaseFormattingManager.js';

/**
 * Base class for formatting managers that filter by user watchlist
 * Extends BaseFormattingManager with watchlist filtering functionality
 * @abstract
 */
class BaseWatchlistFormattingManager extends BaseFormattingManager {
  /**
   * @param {string} managerName - Manager name for logging
   * @param {import('../domain/TitlesManager.js').TitlesManager} titlesManager - Titles manager instance
   * @param {import('../domain/IPTVProviderManager.js').IPTVProviderManager} iptvProviderManager - IPTV Provider manager instance
   * @param {import('../domain/ChannelManager.js').ChannelManager} channelManager - Channel manager instance
   * @param {import('../domain/ProgramManager.js').ProgramManager} programManager - Program manager instance
   */
  constructor(managerName, titlesManager, iptvProviderManager, channelManager, programManager) {
    super(managerName, titlesManager, iptvProviderManager);
    this._channelManager = channelManager;
    this._programManager = programManager;
  }

  /**
   * Get watchlist titles for a specific media type
   * Uses TitlesManager to query titles by title keys
   * @protected
   * @param {Object} user - User object with watchlist
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

    // Use TitlesManager method, not direct repository access
    const titles = await this._titlesManager.findByTitleKeys(watchlistTitleKeys);

    if (!titles || titles.length === 0) {
      return new Map();
    }

    // Create a Map for quick lookup
    const titlesMap = new Map();
    for (const title of titles) {
      if (title.title_key) {
        titlesMap.set(title.title_key, title);
      }
    }

    return titlesMap;
  }

  /**
   * Get watchlist streams for a specific media type
   * Returns array of title-stream combinations from watchlist
   * @protected
   * @param {string} mediaType - Media type ('movies' or 'tvshows')
   * @param {Object} user - User object with watchlist
   * @returns {Promise<Array<{title: Object, streamId: string, seasonNumber?: number, episodeNumber?: number, mediaItem: Object}>>} Array of title-stream combinations
   */
  async _getWatchlistStreams(mediaType, user = null) {
    const titlesMap = await this._getWatchlistTitles(user, mediaType);
    
    if (titlesMap.size === 0) {
      return [];
    }

    // Retrieve unique streams for watchlist titles
    const relevantStreams = [];

    for (const [titleKey, title] of titlesMap.entries()) {
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
}

export { BaseWatchlistFormattingManager };

