import { BaseManager } from './BaseManager.js';
import { createLogger } from '../utils/logger.js';
import fs from 'fs-extra';
import path from 'path';
import { createReadStream, createWriteStream } from 'fs';
import { createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { parseM3U } from '@iptv/playlist';
import { parseXmltv } from '@iptv/xmltv';

/**
 * Live TV Manager for handling user-configured M3U playlists and EPG data
 */
export class LiveTVManager extends BaseManager {
  /**
   * @param {import('../repositories/UserRepository.js').UserRepository} userRepo - User repository
   * @param {import('../repositories/ChannelRepository.js').ChannelRepository} channelRepo - Channel repository
   * @param {import('../repositories/ProgramRepository.js').ProgramRepository} programRepo - Program repository
   */
  constructor(userRepo, channelRepo, programRepo) {
    super('LiveTVManager');
    this._userRepo = userRepo;
    this._channelRepo = channelRepo;
    this._programRepo = programRepo;
    this._cacheDir = process.env.CACHE_DIR || '/app/cache';
  }

  /**
   * Get cache directory for a user
   * @param {string} username - Username
   * @returns {string} Cache directory path
   */
  _getUserCacheDir(username) {
    return path.join(this._cacheDir, 'liveTV', username);
  }

  /**
   * Fetch and cache M3U file for a user
   * @param {string} username - Username
   * @param {string} m3uUrl - M3U URL
   * @returns {Promise<string>} Path to cached file
   */
  async fetchM3U(username, m3uUrl) {
    const cacheDir = this._getUserCacheDir(username);
    await fs.ensureDir(cacheDir);
    const cachePath = path.join(cacheDir, 'live.m3u');

    try {
      const response = await fetch(m3uUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch M3U: ${response.statusText}`);
      }
      const content = await response.text();
      await fs.writeFile(cachePath, content, 'utf8');
      this.logger.info(`Cached M3U for user ${username}`);
      return cachePath;
    } catch (error) {
      this.logger.error(`Error fetching M3U for ${username}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fetch and cache EPG file for a user
   * @param {string} username - Username
   * @param {string} epgUrl - EPG URL
   * @returns {Promise<string>} Path to cached file
   */
  async fetchEPG(username, epgUrl) {
    const cacheDir = this._getUserCacheDir(username);
    await fs.ensureDir(cacheDir);
    const cachePath = path.join(cacheDir, 'epg.xml');
    const tempPath = path.join(cacheDir, 'epg.tmp');

    try {
      const response = await fetch(epgUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch EPG: ${response.statusText}`);
      }

      // Check if response is gzipped
      const contentType = response.headers.get('content-type') || '';
      const isGzipped = epgUrl.endsWith('.gz') || 
                        contentType.includes('gzip') ||
                        contentType.includes('application/x-gzip');

      if (isGzipped) {
        // Decompress gzip
        const writeStream = createWriteStream(tempPath);
        const bodyStream = response.body;
        await pipeline(
          bodyStream,
          createGunzip(),
          writeStream
        );
        await fs.move(tempPath, cachePath, { overwrite: true });
      } else {
        // Save as-is
        const content = await response.text();
        await fs.writeFile(cachePath, content, 'utf8');
      }

      this.logger.info(`Cached EPG for user ${username}`);
      return cachePath;
    } catch (error) {
      this.logger.error(`Error fetching EPG for ${username}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Parse M3U file and extract channels using @iptv/playlist library
   * @param {string} filePath - Path to M3U file
   * @param {string} username - Username
   * @returns {Promise<Array>} Array of channel objects
   */
  async parseM3U(filePath, username) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const playlist = parseM3U(content);
      const channels = [];

      for (const channelData of playlist.channels) {
        const channel = {
          username,
          channel_id: channelData.tvgId || `channel_${channels.length}`,
          name: channelData.name || 'Unknown Channel',
          url: channelData.url || '',
          tvg_id: channelData.tvgId || null,
          tvg_name: channelData.tvgName || null,
          tvg_logo: channelData.tvgLogo || null,
          group_title: channelData.groupTitle || null,
          duration: channelData.duration || -1,
          createdAt: new Date(),
          lastUpdated: new Date()
        };
        channels.push(channel);
      }

      return channels;
    } catch (error) {
      this.logger.error(`Error parsing M3U file ${filePath}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Parse EPG XML file and extract programs using @iptv/xmltv library
   * @param {string} filePath - Path to EPG XML file
   * @param {string} username - Username
   * @returns {Promise<Array>} Array of program objects
   */
  async parseEPG(filePath, username) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const epg = parseXmltv(content);
      const programs = [];

      // Build channel ID mapping
      const channelMap = new Map();
      if (epg.channels) {
        for (const channel of epg.channels) {
          if (channel.id) {
            channelMap.set(channel.id, channel.id);
          }
        }
      }

      // Parse programmes
      if (epg.programmes) {
        for (const prog of epg.programmes) {
          const channelId = prog.channel;
          if (!channelId || !channelMap.has(channelId)) continue;

          const start = prog.start instanceof Date ? prog.start : new Date(prog.start);
          const stop = prog.stop instanceof Date ? prog.stop : new Date(prog.stop);

          // Extract title - can be array of objects with _value and lang, or string
          let title = 'Unknown';
          if (prog.title) {
            if (Array.isArray(prog.title) && prog.title.length > 0) {
              title = prog.title[0]._value || prog.title[0] || 'Unknown';
            } else if (typeof prog.title === 'string') {
              title = prog.title;
            } else if (prog.title._value) {
              title = prog.title._value;
            }
          }

          // Extract description
          let desc = null;
          if (prog.desc) {
            if (Array.isArray(prog.desc) && prog.desc.length > 0) {
              desc = prog.desc[0]._value || prog.desc[0] || null;
            } else if (typeof prog.desc === 'string') {
              desc = prog.desc;
            } else if (prog.desc._value) {
              desc = prog.desc._value;
            }
          }

          // Extract category
          let category = null;
          if (prog.category) {
            if (Array.isArray(prog.category) && prog.category.length > 0) {
              category = prog.category[0]._value || prog.category[0] || null;
            } else if (typeof prog.category === 'string') {
              category = prog.category;
            } else if (prog.category._value) {
              category = prog.category._value;
            }
          }

          // Extract icon
          let icon = null;
          if (prog.icon && Array.isArray(prog.icon) && prog.icon.length > 0) {
            icon = prog.icon[0].src || null;
          }

          // Extract episode number
          let episode = null;
          if (prog.episodeNum && Array.isArray(prog.episodeNum) && prog.episodeNum.length > 0) {
            episode = prog.episodeNum[0]._value || null;
          }

          const program = {
            username,
            channel_id: channelId,
            start: start,
            stop: stop,
            title: title,
            desc: desc,
            category: category,
            icon: icon,
            episode: episode,
            createdAt: new Date(),
            lastUpdated: new Date()
          };
          programs.push(program);
        }
      }

      return programs;
    } catch (error) {
      this.logger.error(`Error parsing EPG file ${filePath}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Sync Live TV for all users
   * @returns {Promise<Object>} Sync results
   */
  async syncAllUsers() {
    try {
      // Get all users with liveTV configured
      const users = await this._userRepo.findMany({
        'liveTV.m3u_url': { $exists: true, $ne: null, $ne: '' }
      });

      if (users.length === 0) {
        this.logger.info('No users with Live TV configured');
        return { users_processed: 0, results: [] };
      }

      this.logger.info(`Syncing Live TV for ${users.length} user(s)...`);

      // Group users by URL to avoid duplicate downloads
      const m3uUrlMap = new Map(); // m3uUrl -> { content, users: [] }
      const epgUrlMap = new Map(); // epgUrl -> { content, users: [] }
      
      // Collect all unique URLs
      users.forEach(user => {
        if (user.liveTV?.m3u_url) {
          if (!m3uUrlMap.has(user.liveTV.m3u_url)) {
            m3uUrlMap.set(user.liveTV.m3u_url, { users: [] });
          }
          m3uUrlMap.get(user.liveTV.m3u_url).users.push({
            username: user.username,
            epg_url: user.liveTV?.epg_url
          });
        }
      });

      // Fetch all unique M3U files in parallel
      const m3uFetchPromises = Array.from(m3uUrlMap.entries()).map(async ([m3uUrl, data]) => {
        try {
          const response = await fetch(m3uUrl);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          data.content = await response.text();
          return { url: m3uUrl, success: true };
        } catch (error) {
          this.logger.error(`Error fetching M3U ${m3uUrl}: ${error.message}`);
          return { url: m3uUrl, success: false, error: error.message };
        }
      });

      await Promise.all(m3uFetchPromises);

      // Group EPG URLs
      users.forEach(user => {
        if (user.liveTV?.epg_url) {
          const epgUrl = user.liveTV.epg_url;
          if (!epgUrlMap.has(epgUrl)) {
            epgUrlMap.set(epgUrl, { users: [] });
          }
          epgUrlMap.get(epgUrl).users.push(user.username);
        }
      });

      // Fetch all unique EPG files in parallel
      const epgFetchPromises = Array.from(epgUrlMap.entries()).map(async ([epgUrl, data]) => {
        try {
          const response = await fetch(epgUrl);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          
          const contentType = response.headers.get('content-type') || '';
          const isGzipped = epgUrl.endsWith('.gz') || 
                            contentType.includes('gzip') ||
                            contentType.includes('application/x-gzip');

          if (isGzipped) {
            // For gzipped, we'll need to decompress per user, so store the response
            data.response = response;
            data.isGzipped = true;
          } else {
            data.content = await response.text();
            data.isGzipped = false;
          }
          return { url: epgUrl, success: true };
        } catch (error) {
          this.logger.error(`Error fetching EPG ${epgUrl}: ${error.message}`);
          return { url: epgUrl, success: false, error: error.message };
        }
      });

      await Promise.all(epgFetchPromises);

      // Process each user's data
      const results = await Promise.all(
        users.map(async (user) => {
          try {
            const m3uUrl = user.liveTV.m3u_url;
            const urlData = m3uUrlMap.get(m3uUrl);
            
            if (!urlData || !urlData.content) {
              throw new Error('Failed to fetch M3U content');
            }

            // Save M3U to cache
            const cacheDir = this._getUserCacheDir(user.username);
            await fs.ensureDir(cacheDir);
            await fs.writeFile(path.join(cacheDir, 'live.m3u'), urlData.content, 'utf8');

            // Parse channels
            const channels = await this.parseM3U(
              path.join(cacheDir, 'live.m3u'),
              user.username
            );

            // Delete old channels for this user
            await this._channelRepo.deleteMany({ username: user.username });

            // Insert new channels
            if (channels.length > 0) {
              await this._channelRepo.insertMany(channels, { batch: true });
            }

            // Handle EPG if configured
            let programsCount = 0;
            if (user.liveTV?.epg_url) {
              try {
                const epgUrl = user.liveTV.epg_url;
                const epgData = epgUrlMap.get(epgUrl);
                
                if (epgData && epgData.content) {
                  // Save EPG to cache
                  await fs.writeFile(path.join(cacheDir, 'epg.xml'), epgData.content, 'utf8');
                  const programs = await this.parseEPG(path.join(cacheDir, 'epg.xml'), user.username);

                  // Delete old programs for this user
                  await this._programRepo.deleteMany({ username: user.username });

                  // Insert new programs
                  if (programs.length > 0) {
                    await this._programRepo.insertMany(programs, { batch: true });
                    programsCount = programs.length;
                  }
                } else if (epgData && epgData.isGzipped && epgData.response) {
                  // Handle gzipped EPG per user
                  const tempPath = path.join(cacheDir, 'epg.tmp');
                  const writeStream = createWriteStream(tempPath);
                  await pipeline(
                    epgData.response.body,
                    createGunzip(),
                    writeStream
                  );
                  await fs.move(tempPath, path.join(cacheDir, 'epg.xml'), { overwrite: true });
                  
                  const programs = await this.parseEPG(path.join(cacheDir, 'epg.xml'), user.username);

                  // Delete old programs for this user
                  await this._programRepo.deleteMany({ username: user.username });

                  // Insert new programs
                  if (programs.length > 0) {
                    await this._programRepo.insertMany(programs, { batch: true });
                    programsCount = programs.length;
                  }
                }
              } catch (error) {
                this.logger.error(`Error processing EPG for ${user.username}: ${error.message}`);
              }
            }

            return {
              username: user.username,
              channels: channels.length,
              programs: programsCount,
              success: true
            };
          } catch (error) {
            this.logger.error(`Error syncing Live TV for ${user.username}: ${error.message}`);
            return {
              username: user.username,
              success: false,
              error: error.message
            };
          }
        })
      );

      return {
        users_processed: users.length,
        results
      };
    } catch (error) {
      this.logger.error(`Error in syncAllUsers: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get user's channels with current program if available
   * @param {string} username - Username
   * @returns {Promise<Array>} Array of channel objects with current program
   */
  async getUserChannels(username) {
    try {
      const channels = await this._channelRepo.findMany({ username });
      const now = new Date();

      // Get current programs for all channels
      const programs = await this._programRepo.findMany({
        username,
        start: { $lte: now },
        stop: { $gte: now }
      });

      // Map programs by channel_id
      const programMap = new Map();
      programs.forEach(prog => {
        if (!programMap.has(prog.channel_id)) {
          programMap.set(prog.channel_id, prog);
        }
      });

      // Add current program to channels
      return channels.map(channel => ({
        ...channel,
        currentProgram: programMap.get(channel.channel_id) || null
      }));
    } catch (error) {
      this.logger.error(`Error getting user channels for ${username}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get programs for a specific channel
   * @param {string} username - Username
   * @param {string} channelId - Channel ID
   * @returns {Promise<Array>} Array of program objects
   */
  async getChannelPrograms(username, channelId) {
    try {
      return await this._programRepo.findMany(
        { username, channel_id: channelId },
        { sort: { start: 1 } }
      );
    } catch (error) {
      this.logger.error(`Error getting programs for channel ${channelId}: ${error.message}`);
      throw error;
    }
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

  /**
   * Get channel by ID for streaming
   * @param {string} username - Username
   * @param {string} channelId - Channel ID
   * @returns {Promise<Object|null>} Channel object or null
   */
  async getChannel(username, channelId) {
    try {
      return await this._channelRepo.findOne({ username, channel_id: channelId });
    } catch (error) {
      this.logger.error(`Error getting channel ${channelId} for ${username}: ${error.message}`);
      return null;
    }
  }
}

