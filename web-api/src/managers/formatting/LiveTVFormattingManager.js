import { BaseFormattingManager } from './BaseFormattingManager.js';
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
   */
  constructor(titlesManager, iptvProviderManager, channelManager, programManager) {
    super('LiveTVFormattingManager', titlesManager, iptvProviderManager);
    this._channelManager = channelManager;
    this._programManager = programManager;
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
   * Generate M3U playlist for user
   * @param {string} username - Username
   * @param {string} baseUrl - Base URL for stream endpoints
   * @returns {Promise<string>} M3U playlist content
   */
  async getM3UPlaylist(username, baseUrl) {
    try {
      const cachePath = path.join(this._getUserCacheDir(username), 'live.m3u');
      
      if (!await fs.pathExists(cachePath)) {
        throw new Error('M3U file not found in cache');
      }

      const content = await fs.readFile(cachePath, 'utf8');
      const playlist = parseM3U(content);
      const lines = ['#EXTM3U'];

      for (const channelData of playlist.channels) {
        // Build stream URL
        const channelId = channelData.tvgId || channelData.name || 'unknown';
        const streamUrl = `${baseUrl}/api/livetv/stream/${encodeURIComponent(channelId)}?api_key={API_KEY}`;

        // Build M3U metadata
        const paramsParts = [];
        if (channelData.tvgId) paramsParts.push(`tvg-id="${channelData.tvgId}"`);
        if (channelData.tvgName) paramsParts.push(`tvg-name="${channelData.tvgName}"`);
        if (channelData.tvgLogo) paramsParts.push(`tvg-logo="${channelData.tvgLogo}"`);
        if (channelData.groupTitle) paramsParts.push(`group-title="${channelData.groupTitle}"`);

        const params = paramsParts.join(' ');
        const duration = channelData.duration !== undefined ? channelData.duration : -1;
        const metadata = `#EXTINF:${duration} ${params},${channelData.name || 'Unknown'}`;

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
   * Get path to cached EPG file
   * @param {string} username - Username
   * @returns {Promise<string|null>} Path to EPG file or null if not found
   */
  async getEPGPath(username) {
    try {
      const epgPath = path.join(this._getUserCacheDir(username), 'epg.xml');
      if (await fs.pathExists(epgPath)) {
        return epgPath;
      }
      return null;
    } catch (error) {
      this.logger.error(`Error getting EPG path for ${username}: ${error.message}`);
      return null;
    }
  }
}

