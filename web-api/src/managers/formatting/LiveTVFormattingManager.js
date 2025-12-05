import { BaseFormattingManager } from './BaseFormattingManager.js';
import { formatNumber } from '../../utils/numberFormat.js';
import fs from 'fs-extra';
import path from 'path';
import { parseM3U } from '@iptv/playlist';

/**
 * LiveTVFormattingManager for formatting Live TV data for API responses
 * Type B: Formatting Manager
 * Extends BaseFormattingManager
 */
export class LiveTVFormattingManager extends BaseFormattingManager {
  /**
   * @param {import('../domain/TitlesManager.js').TitlesManager} titlesManager - Titles manager instance
   * @param {import('../domain/IPTVProviderManager.js').IPTVProviderManager} iptvProviderManager - IPTV Provider manager instance
   * @param {import('../domain/ChannelManager.js').ChannelManager} channelManager - Channel manager instance
   * @param {import('../domain/ProgramManager.js').ProgramManager} programManager - Program manager instance
   * @param {import('../domain/UserManager.js').UserManager} userManager - User manager instance
   */
  constructor(titlesManager, iptvProviderManager, channelManager, programManager, userManager) {
    super('LiveTVFormattingManager', titlesManager, iptvProviderManager);
    this._channelManager = channelManager;
    this._programManager = programManager;
    this._userManager = userManager;
    this._cacheDir = process.env.CACHE_DIR || '/app/cache';
  }

  /**
   * Get cache directory for a user
   * @private
   * @param {string} username - Username
   * @returns {string} Cache directory path
   */
  _getUserCacheDir(username) {
    return path.join(this._cacheDir, 'liveTV', username);
  }

  /**
   * Generate M3U playlist for user (watchlist-based, provider-based)
   * @param {string} username - Username
   * @param {string} baseUrl - Base URL for stream endpoints
   * @returns {Promise<string>} M3U playlist content
   */
  async getM3UPlaylist(username, baseUrl) {
    try {
      // Get user's watchlist channel keys
      const watchlistKeys = await this._userManager.getWatchlistChannelKeys(username);
      
      if (!watchlistKeys || watchlistKeys.length === 0) {
        // Return empty M3U if no channels in watchlist
        return '#EXTM3U\n';
      }

      // Get enabled provider IDs
      const enabledProviderIds = await this._iptvProviderManager.getEnabledProviderIds();
      
      if (!enabledProviderIds || enabledProviderIds.length === 0) {
        // Return empty M3U if no enabled providers
        return '#EXTM3U\n';
      }

      // Query channels matching watchlist and enabled providers
      const channels = await this._channelManager._repository.findByQuery({
        channel_key: { $in: watchlistKeys },
        provider_id: { $in: enabledProviderIds }
      });

      if (!channels || channels.length === 0) {
        // Return empty M3U if no matching channels
        return '#EXTM3U\n';
      }

      // Generate M3U dynamically
      const lines = ['#EXTM3U'];

      for (const channel of channels) {
        // Build stream URL using channel_key
        const streamUrl = `${baseUrl}/api/livetv/stream/${encodeURIComponent(channel.channel_key)}?api_key={API_KEY}`;

        // Build M3U metadata from channel object
        const paramsParts = [];
        if (channel.tvg_id) paramsParts.push(`tvg-id="${channel.tvg_id}"`);
        if (channel.tvg_name) paramsParts.push(`tvg-name="${channel.tvg_name}"`);
        if (channel.tvg_logo) paramsParts.push(`tvg-logo="${channel.tvg_logo}"`);
        if (channel.group_title) paramsParts.push(`group-title="${channel.group_title}"`);

        const params = paramsParts.join(' ');
        const duration = channel.duration !== undefined && channel.duration >= 0 ? channel.duration : -1;
        const metadata = `#EXTINF:${duration} ${params},${channel.name || 'Unknown'}`;

        lines.push(metadata);
        lines.push(streamUrl);
      }

      return lines.join('\n');
    } catch (error) {
      this.logger.error(`Error generating M3U playlist for ${username}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate EPG XML content for user (watchlist-based, provider-based)
   * @param {string} username - Username
   * @returns {Promise<string>} EPG XML content
   */
  async getEPGContent(username) {
    try {
      // Get user's watchlist channel keys
      const watchlistKeys = await this._userManager.getWatchlistChannelKeys(username);
      
      if (!watchlistKeys || watchlistKeys.length === 0) {
        // Return empty EPG if no channels in watchlist
        return '<?xml version="1.0" encoding="UTF-8"?>\n<tv>\n</tv>';
      }

      // Get enabled provider IDs
      const enabledProviderIds = await this._iptvProviderManager.getEnabledProviderIds();
      
      if (!enabledProviderIds || enabledProviderIds.length === 0) {
        // Return empty EPG if no enabled providers
        return '<?xml version="1.0" encoding="UTF-8"?>\n<tv>\n</tv>';
      }

      // Query channels matching watchlist and enabled providers
      const channels = await this._channelManager._repository.findByQuery({
        channel_key: { $in: watchlistKeys },
        provider_id: { $in: enabledProviderIds }
      });

      if (!channels || channels.length === 0) {
        // Return empty EPG if no matching channels
        return '<?xml version="1.0" encoding="UTF-8"?>\n<tv>\n</tv>';
      }

      // Build channel map for efficient lookup
      const channelMap = new Map();
      
      for (const channel of channels) {
        channelMap.set(`${channel.provider_id}-${channel.channel_id}`, channel);
      }

      // Query programs for those channels using public method
      const programs = await this._programManager.getProgramsByChannels(channels, { sort: { start: 1 } });

      this.logger.debug(`EPG generation for ${username}: Found ${formatNumber(channels.length)} channels, ${formatNumber(programs.length)} programs`);

      // Group programs by channel
      const programsByChannel = new Map();
      for (const program of programs) {
        const key = `${program.provider_id}-${program.channel_id}`;
        if (channelMap.has(key)) {
          if (!programsByChannel.has(key)) {
            programsByChannel.set(key, []);
          }
          programsByChannel.get(key).push(program);
        }
      }

      this.logger.debug(`EPG generation for ${username}: Grouped programs into ${formatNumber(programsByChannel.size)} channels with programs`);
      
      // Log if we have channels but no programs (for debugging)
      if (channels.length > 0 && programs.length === 0) {
        this.logger.warn(`EPG generation for ${username}: Found ${formatNumber(channels.length)} channels but no programs in database`);
      }

      // Generate XMLTV EPG XML format
      const xmlLines = ['<?xml version="1.0" encoding="UTF-8"?>', '<tv>'];

      // Add channel definitions
      for (const channel of channels) {
        const channelId = channel.tvg_id || channel.channel_id;
        const displayName = channel.tvg_name || channel.name || 'Unknown';
        const icon = channel.tvg_logo || '';
        
        xmlLines.push('  <channel id="' + this._escapeXml(channelId) + '">');
        xmlLines.push('    <display-name>' + this._escapeXml(displayName) + '</display-name>');
        if (icon) {
          xmlLines.push('    <icon src="' + this._escapeXml(icon) + '" />');
        }
        xmlLines.push('  </channel>');
      }

      // Add programmes
      for (const [channelKey, channelPrograms] of programsByChannel.entries()) {
        const channel = channelMap.get(channelKey);
        const channelId = channel.tvg_id || channel.channel_id;

        for (const program of channelPrograms) {
          const start = program.start instanceof Date ? program.start : new Date(program.start);
          const stop = program.stop instanceof Date ? program.stop : new Date(program.stop);
          
          // Format dates as XMLTV format: YYYYMMDDHHmmss +TZ
          const startStr = this._formatXMLTVDate(start);
          const stopStr = this._formatXMLTVDate(stop);

          xmlLines.push(`  <programme start="${startStr}" stop="${stopStr}" channel="${this._escapeXml(channelId)}">`);
          xmlLines.push('    <title>' + this._escapeXml(program.title || 'Unknown') + '</title>');
          if (program.desc) {
            xmlLines.push('    <desc>' + this._escapeXml(program.desc) + '</desc>');
          }
          if (program.category) {
            xmlLines.push('    <category>' + this._escapeXml(program.category) + '</category>');
          }
          if (program.icon) {
            xmlLines.push('    <icon src="' + this._escapeXml(program.icon) + '" />');
          }
          if (program.episode) {
            xmlLines.push('    <episode-num>' + this._escapeXml(program.episode) + '</episode-num>');
          }
          xmlLines.push('  </programme>');
        }
      }

      xmlLines.push('</tv>');
      return xmlLines.join('\n');
    } catch (error) {
      this.logger.error(`Error generating EPG content for ${username}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Format date as XMLTV format: YYYYMMDDHHmmss +TZ
   * @private
   * @param {Date} date - Date object
   * @returns {string} XMLTV formatted date string
   */
  _formatXMLTVDate(date) {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
      return '19700101000000 +0000';
    }

    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hour = String(date.getUTCHours()).padStart(2, '0');
    const minute = String(date.getUTCMinutes()).padStart(2, '0');
    const second = String(date.getUTCSeconds()).padStart(2, '0');

    return `${year}${month}${day}${hour}${minute}${second} +0000`;
  }

  /**
   * Escape XML special characters
   * @private
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   */
  _escapeXml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

