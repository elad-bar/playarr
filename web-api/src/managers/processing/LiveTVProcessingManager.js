import { BaseProcessingManager } from './BaseProcessingManager.js';
import { formatNumber, formatFileSize, formatPercentage } from '../../utils/numberFormat.js';
import fs from 'fs-extra';
import path from 'path';
import { createReadStream, createWriteStream } from 'fs';
import { createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { parseXmltv } from '@iptv/xmltv';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const sax = require('sax');

/**
 * LiveTVProcessingManager for processing Live TV channels from providers
 * Type C: Processing Manager
 * Extends BaseProcessingManager
 */
export class LiveTVProcessingManager extends BaseProcessingManager {
  /**
   * @param {import('../domain/ChannelManager.js').ChannelManager} channelManager - Channel manager instance
   * @param {import('../domain/ProgramManager.js').ProgramManager} programManager - Program manager instance
   * @param {import('../domain/IPTVProviderManager.js').IPTVProviderManager} iptvProviderManager - IPTV Provider manager instance
   * @param {Object<string, import('../../providers/BaseIPTVProvider.js').BaseIPTVProvider>} providerTypeMap - Map of provider type to provider instance
   */
  constructor(channelManager, programManager, iptvProviderManager, providerTypeMap) {
    // BaseProcessingManager expects providerData and loggerContext
    // For LiveTV, we use a minimal providerData object and pass loggerContext
    const providerData = { id: 'livetv', type: 'livetv' };
    super(providerData, 'LiveTVProcessingManager');
    this._channelManager = channelManager;
    this._programManager = programManager;
    this._iptvProviderManager = iptvProviderManager;
    this._cacheDir = process.env.CACHE_DIR || '/app/cache';
    
    // Use providerTypeMap directly (same as ProvidersManager)
    this._providerInstanceMap = providerTypeMap;
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
   * Normalize category name for AGTV (slugify, lowercase)
   * @private
   * @param {string} categoryName - Original category name
   * @returns {string} Normalized category name
   */
  _normalizeCategoryName(categoryName) {
    return categoryName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Extract unique categories from channels (for AGTV)
   * @private
   * @param {Array} channels - Array of channel objects
   * @returns {Array} Array of category objects with keys
   */
  _extractCategoriesFromChannels(channels) {
    const categoryMap = new Map();
    
    channels.forEach(channel => {
      if (channel.group_title) {
        const normalizedName = this._normalizeCategoryName(channel.group_title);
        const categoryKey = `live-${normalizedName}`;
        
        if (!categoryMap.has(categoryKey)) {
          categoryMap.set(categoryKey, {
            key: categoryKey,
            category_name: channel.group_title, // Original name for display
            normalized_name: normalizedName
          });
        }
      }
    });
    
    return Array.from(categoryMap.values());
  }

  /**
   * Parse EPG XML file and extract programs using streaming parser for large files
   * Deduplicates programs by provider_id, channel_id, start, and stop
   * Only includes programs for channels that exist in the database for this provider
   * Processes in batches to prevent memory issues and stack overflow
   * @param {string} filePath - Path to EPG XML file
   * @param {string} providerId - Provider ID
   * @returns {Promise<Array>} Array of program objects (deduplicated)
   */
  async parseEPG(filePath, providerId) {
    try {
      // Get channels for this provider from database to filter EPG programs
      const channels = await this._channelManager.findByProvider(providerId);
      // Use tvg_id for EPG matching (EPG XML uses tvg_id values in <programme channel="...">)
      const channelIds = new Set(channels.map(ch => ch.tvg_id).filter(id => id != null));
      this.logger.debug(`Found ${formatNumber(channelIds.size)} channels in database for provider ${providerId}, filtering EPG programs`);
      
      // Log sample channel IDs for debugging
      if (channelIds.size > 0) {
        const sampleIds = Array.from(channelIds).slice(0, 5);
        this.logger.debug(`Sample channel IDs from database (using tvg_id): ${sampleIds.join(', ')}`);
      }
      
      // Check file size - use streaming parser for files > 10MB
      const stats = await fs.stat(filePath);
      const useStreaming = stats.size > 10 * 1024 * 1024; // 10MB threshold

      if (useStreaming) {
        this.logger.info(`EPG file for provider ${providerId} is large (${formatFileSize(stats.size)}), using streaming parser`);
        return await this._parseEPGStreaming(filePath, providerId, channelIds);
      } else {
        // Try standard parser first for smaller files
        try {
          return await this._parseEPGStandard(filePath, providerId, channelIds);
        } catch (error) {
          // If standard parser fails with stack overflow, fall back to streaming
          if (error.message.includes('stack') || error.message.includes('Maximum call stack')) {
            this.logger.warn(`Standard parser failed for provider ${providerId}, falling back to streaming parser`);
            return await this._parseEPGStreaming(filePath, providerId, channelIds);
          }
          throw error;
        }
      }
    } catch (error) {
      this.logger.error(`Error parsing EPG file ${filePath}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Parse EPG using standard @iptv/xmltv library (for smaller files)
   * @private
   * @param {string} filePath - Path to EPG XML file
   * @param {string} providerId - Provider ID
   * @param {Set<string>} validChannelIds - Set of valid channel IDs from database
   * @returns {Promise<Array>} Array of program objects
   */
  async _parseEPGStandard(filePath, providerId, validChannelIds) {
    const content = await fs.readFile(filePath, 'utf8');
    const epg = parseXmltv(content);
    const programs = [];
    const programKeys = new Set();
    const BATCH_SIZE = 5000; // Process in batches

    // Use validChannelIds from database instead of building from EPG
    // This ensures we only process programs for channels we actually have

    // Process programmes in batches to avoid memory issues
    if (epg.programmes) {
      const totalProgrammes = epg.programmes.length;
      this.logger.debug(`Processing ${formatNumber(totalProgrammes)} programmes for provider ${providerId} in batches of ${formatNumber(BATCH_SIZE)}`);

      for (let i = 0; i < epg.programmes.length; i += BATCH_SIZE) {
        const batch = epg.programmes.slice(i, i + BATCH_SIZE);
        
        for (const prog of batch) {
          const program = this._extractProgram(prog, providerId, validChannelIds, programKeys);
          if (program) {
            programs.push(program);
          }
        }

        if ((i + BATCH_SIZE) % (BATCH_SIZE * 10) === 0) {
          this.logger.debug(`Processed ${formatNumber(Math.min(i + BATCH_SIZE, totalProgrammes))}/${formatNumber(totalProgrammes)} programmes for provider ${providerId}`);
        }
      }
    }

    return programs;
  }

  /**
   * Parse XMLTV date format (YYYYMMDDHHmmss +TZ) to Date object
   * XMLTV format stores times in a specific timezone. We convert to UTC.
   * @private
   * @param {string} xmltvDate - XMLTV date string (e.g., "20241204163000 +0000")
   * @returns {Date|null} Parsed date or null if invalid
   */
  _parseXMLTVDate(xmltvDate) {
    if (!xmltvDate || typeof xmltvDate !== 'string') return null;
    
    // XMLTV format: YYYYMMDDHHmmss +TZ (e.g., "20241204163000 +0000")
    // Match: YYYYMMDDHHmmss and optional timezone
    const match = xmltvDate.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-]\d{4}))?$/);
    if (!match) {
      // Try standard Date parsing as fallback
      const date = new Date(xmltvDate);
      if (isNaN(date.getTime())) return null;
      // Validate date is within reasonable range (1970-2100)
      const year = date.getUTCFullYear();
      if (year < 1970 || year > 2100) return null;
      return date;
    }
    
    const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr, tz] = match;
    
    // Parse components with validation
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const day = parseInt(dayStr, 10);
    const hour = parseInt(hourStr, 10);
    const minute = parseInt(minuteStr, 10);
    const second = parseInt(secondStr, 10);
    
    // Validate ranges
    if (year < 1970 || year > 2100) return null;
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > 31) return null;
    if (hour < 0 || hour > 23) return null;
    if (minute < 0 || minute > 59) return null;
    if (second < 0 || second > 59) return null;
    
    // Parse timezone offset (e.g., "+0500" means 5 hours ahead of UTC)
    let tzOffsetMs = 0;
    if (tz) {
      const tzSign = tz.startsWith('+') ? 1 : -1;
      const tzHours = parseInt(tz.substring(1, 3), 10);
      const tzMinutes = parseInt(tz.substring(3, 5), 10);
      
      // Validate timezone offset (should be -12 to +14 hours)
      if (tzHours > 14 || tzMinutes > 59) return null;
      
      tzOffsetMs = tzSign * (tzHours * 60 + tzMinutes) * 60000; // Convert to milliseconds
    }
    
    // Create date from components (treating as UTC initially)
    const date = new Date(Date.UTC(
      year,
      month - 1, // Month is 0-indexed
      day,
      hour,
      minute,
      second
    ));
    
    // Validate date was created successfully
    if (isNaN(date.getTime())) return null;
    
    // Adjust for timezone: if timezone is +0500, the time is 5 hours ahead of UTC,
    // so we subtract 5 hours to get UTC (tzOffsetMs is positive, so subtract it)
    date.setTime(date.getTime() - tzOffsetMs);
    
    // Final validation: ensure date is still valid and within reasonable range
    if (isNaN(date.getTime())) return null;
    const finalYear = date.getUTCFullYear();
    if (finalYear < 1970 || finalYear > 2100) return null;
    
    return date;
  }

  /**
   * Parse EPG using streaming SAX parser (for large files)
   * @private
   * @param {string} filePath - Path to EPG XML file
   * @param {string} providerId - Provider ID
   * @param {Set<string>} validChannelIds - Set of valid channel IDs from database
   * @returns {Promise<Array>} Array of program objects
   */
  async _parseEPGStreaming(filePath, providerId, validChannelIds) {
    return new Promise((resolve, reject) => {
      const programs = [];
      const programKeys = new Set();
      let currentProgram = null;
      let currentElement = null;
      let currentText = '';
      let elementStack = [];
      let processedCount = 0;
      let matchedCount = 0;
      let lastProgressLog = Date.now();
      const PROGRESS_INTERVAL = 30000; // Log progress every 30 seconds
      let isCompleted = false;

      const parser = sax.createStream(true, { trim: true, normalize: true });
      const stream = createReadStream(filePath, { encoding: 'utf8' });

      // Add timeout (30 minutes for very large files)
      const timeout = setTimeout(() => {
        stream.destroy();
        parser.end();
        reject(new Error(`EPG parsing timeout after 30 minutes (processed ${formatNumber(processedCount)} programmes, matched ${formatNumber(matchedCount)} channels)`));
      }, 30 * 60 * 1000);

      // Helper function to complete parsing (prevent double completion)
      const completeParsing = () => {
        if (isCompleted) return;
        isCompleted = true;
        clearTimeout(timeout);
        const matchRate = processedCount > 0 ? ((matchedCount / processedCount) * 100) : 0;
        this.logger.info(`Streaming parser completed: ${formatNumber(programs.length)} programs extracted from ${formatNumber(processedCount)} programmes (${formatNumber(matchedCount)} matched channels, ${formatPercentage(matchRate)} match rate) for provider ${providerId}`);
        
        if (matchedCount === 0 && processedCount > 0) {
          this.logger.warn(`No channel ID matches found! This suggests EPG channel IDs don't match database channel IDs. Check channel_id field mapping.`);
          // Log sample channel IDs for debugging
          const sampleChannelIds = Array.from(validChannelIds).slice(0, 10);
          this.logger.debug(`Sample channel IDs from database: ${sampleChannelIds.join(', ')}`);
        }
        
        resolve(programs);
      };

      // Handle stream errors
      stream.on('error', (error) => {
        clearTimeout(timeout);
        this.logger.error(`Stream error for provider ${providerId}: ${error.message}`);
        reject(error);
      });

      parser.onopentag = (node) => {
        elementStack.push(node.name);
        currentElement = node.name;

        if (node.name === 'programme') {
          currentProgram = {
            channel: node.attributes.channel || null,
            start: node.attributes.start || null,
            stop: node.attributes.stop || null,
            title: null,
            desc: null,
            category: null,
            icon: null,
            episode: null
          };
          currentText = '';
          processedCount++;
          
          // Log progress periodically
          const now = Date.now();
          if (now - lastProgressLog >= PROGRESS_INTERVAL) {
            this.logger.info(`EPG parsing progress for ${providerId}: processed ${formatNumber(processedCount)} programmes, matched ${formatNumber(matchedCount)} channels, extracted ${formatNumber(programs.length)} programs`);
            lastProgressLog = now;
          }
        } else if (node.name === 'icon' && currentProgram) {
          currentProgram.icon = node.attributes.src || null;
        }
      };

      parser.ontext = (text) => {
        if (currentProgram) {
          currentText += text;
        }
      };

      parser.onclosetag = (tagName) => {
        if (tagName === 'programme' && currentProgram) {
          // Process the completed programme
          const channelId = currentProgram.channel;
          // Only process if channel exists in our database
          if (channelId && validChannelIds.has(channelId)) {
            matchedCount++;
            try {
              // Parse XMLTV date format
              const start = this._parseXMLTVDate(currentProgram.start);
              const stop = this._parseXMLTVDate(currentProgram.stop);

              // Validate dates are valid and stop is after start
              if (start && stop && !isNaN(start.getTime()) && !isNaN(stop.getTime())) {
                // Additional validation: ensure stop is after start
                if (stop.getTime() <= start.getTime()) {
                  // Log first few invalid date ranges for debugging
                  if (matchedCount <= 5) {
                    this.logger.debug(`Invalid date range for channel ${channelId}: start="${currentProgram.start}", stop="${currentProgram.stop}"`);
                  }
                  return; // Skip this program
                }
                
                const programKey = `${providerId}-${channelId}-${start.getTime()}-${stop.getTime()}`;
                
                if (!programKeys.has(programKey)) {
                  programKeys.add(programKey);

                  const program = {
                    provider_id: providerId,
                    channel_id: channelId,
                    start: start,
                    stop: stop,
                    title: currentProgram.title || 'Unknown',
                    desc: currentProgram.desc || null,
                    category: currentProgram.category || null,
                    icon: currentProgram.icon || null,
                    episode: currentProgram.episode || null,
                    createdAt: new Date(),
                    lastUpdated: new Date()
                  };
                  programs.push(program);
                }
              } else {
                // Log first few date parsing failures for debugging
                if (matchedCount <= 5) {
                  this.logger.debug(`Date parsing failed for channel ${channelId}: start="${currentProgram.start}", stop="${currentProgram.stop}"`);
                }
              }
            } catch (error) {
              // Skip invalid program
              this.logger.debug(`Skipping invalid program: ${error.message}`);
            }
          }
          currentProgram = null;
          currentText = '';
        } else if (currentProgram && tagName === 'title') {
          currentProgram.title = currentText.trim() || 'Unknown';
          currentText = '';
        } else if (currentProgram && tagName === 'desc') {
          currentProgram.desc = currentText.trim() || null;
          currentText = '';
        } else if (currentProgram && tagName === 'category') {
          currentProgram.category = currentText.trim() || null;
          currentText = '';
        } else if (currentProgram && tagName === 'episode-num') {
          currentProgram.episode = currentText.trim() || null;
          currentText = '';
        }

        elementStack.pop();
        if (elementStack.length === 0) {
          currentElement = null;
        }
      };

      parser.onerror = (error) => {
        clearTimeout(timeout);
        this.logger.error(`Streaming parser error for provider ${providerId}: ${error.message}`);
        reject(error);
      };

      parser.onend = () => {
        this.logger.debug(`Parser onend called for provider ${providerId}`);
        completeParsing();
      };

      // Handle stream end - add fallback if parser.onend doesn't fire
      stream.on('end', () => {
        this.logger.debug(`Stream ended for provider ${providerId}, waiting for parser to finish`);
        // Give parser a moment to finish, then force completion if needed
        setTimeout(() => {
          if (!isCompleted) {
            this.logger.debug(`Parser did not call onend after stream ended, forcing completion for provider ${providerId}`);
            completeParsing();
          }
        }, 2000); // Wait 2 seconds for parser to finish
      });

      stream.pipe(parser);
    });
  }

  /**
   * Extract program data from parsed programme object
   * @private
   * @param {Object} prog - Programme object from parser
   * @param {string} providerId - Provider ID
   * @param {Set<string>} validChannelIds - Set of valid channel IDs from database
   * @param {Set} programKeys - Set of already processed program keys
   * @returns {Object|null} Program object or null if invalid/duplicate
   */
  _extractProgram(prog, providerId, validChannelIds, programKeys) {
    const channelId = prog.channel;
    if (!channelId || !validChannelIds.has(channelId)) return null;

    // Parse dates safely - use XMLTV date parser
    let start, stop;
    try {
      if (prog.start instanceof Date) {
        start = prog.start;
      } else if (typeof prog.start === 'string') {
        start = this._parseXMLTVDate(prog.start);
        if (!start || isNaN(start.getTime())) return null;
      } else if (typeof prog.start === 'number') {
        start = new Date(prog.start);
        if (isNaN(start.getTime())) return null;
      } else {
        return null;
      }

      if (prog.stop instanceof Date) {
        stop = prog.stop;
      } else if (typeof prog.stop === 'string') {
        stop = this._parseXMLTVDate(prog.stop);
        if (!stop || isNaN(stop.getTime())) return null;
      } else if (typeof prog.stop === 'number') {
        stop = new Date(prog.stop);
        if (isNaN(stop.getTime())) return null;
      } else {
        return null;
      }
    } catch (dateError) {
      return null;
    }

    // Create unique key for deduplication
    const startTime = start.getTime();
    const stopTime = stop.getTime();
    const programKey = `${providerId}-${channelId}-${startTime}-${stopTime}`;

    // Skip if we've already seen this program
    if (programKeys.has(programKey)) {
      return null;
    }
    programKeys.add(programKey);

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

    return {
      provider_id: providerId,
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
  }

  /**
   * Sync Live TV channels from all active providers
   * @param {Array<Object>} providers - Array of provider objects (passed from job)
   * @returns {Promise<Object>} Sync results
   */
  async syncProviders(providers) {
    try {
      if (!providers || providers.length === 0) {
        this.logger.info('No active providers with live channels');
        return { providers_processed: 0, results: [] };
      }

      this.logger.info(`Syncing Live TV for ${formatNumber(providers.length)} provider(s)...`);

      const results = [];

      for (const provider of providers) {
        try {
          await this._syncProvider(provider);

          results.push({
            provider_id: provider.id,
            provider_name: provider.name,
            success: true
          });
        } catch (error) {
          this.logger.error(`Failed to sync provider ${provider.id}: ${error.message}`);
          results.push({
            provider_id: provider.id,
            provider_name: provider.name,
            success: false,
            error: error.message
          });
        }
      }

      return {
        providers_processed: providers.length,
        results
      };
    } catch (error) {
      this.logger.error(`Error in syncProviders: ${error.message}`);
      throw error;
    }
  }

  /**
   * Sync EPG (Electronic Program Guide) for a provider
   * @private
   * @param {Object} provider - Provider object with id, type, name, etc.
   * @param {Object} providerInstance - Provider instance (XtreamProvider or AGTVProvider)
   * @returns {Promise<void>}
   */
  async _syncProviderEPG(provider, providerInstance) {
    try {
      this.logger.info(`Fetching EPG for ${provider.type} provider ${provider.id}...`);
      const epgContent = await providerInstance.fetchLiveEPG(provider.id);
      this.logger.debug(`EPG content fetched: ${formatFileSize(epgContent.length)}`);
      
      // EPG is already cached by the provider via _httpGet -> _setCache
      // Use the provider's cache path: {cacheDir}/{providerId}/live/metadata/epg.xml
      const epgPath = path.join(this._cacheDir, provider.id, 'live', 'metadata', 'epg.xml');
      
      // Verify the cached file exists
      if (!await fs.pathExists(epgPath)) {
        throw new Error(`EPG file was not cached at ${epgPath}`);
      }
      
      const stats = await fs.stat(epgPath);
      this.logger.info(`EPG file cached at: ${epgPath} (${formatFileSize(stats.size)})`);
      
      if (!stats.isFile()) {
        throw new Error(`EPG file was not created at ${epgPath}`);
      }
      
      this.logger.info(`Parsing EPG file for provider ${provider.id}...`);
      const programs = await this.parseEPG(epgPath, provider.id);
      this.logger.info(`Parsed ${formatNumber(programs.length)} programs from EPG for provider ${provider.id}`);
      
      if (programs.length > 0) {
        // Filter out any programs with invalid dates before inserting
        const validPrograms = programs.filter(program => {
          if (!program.start || !program.stop) return false;
          if (!(program.start instanceof Date) || !(program.stop instanceof Date)) return false;
          if (isNaN(program.start.getTime()) || isNaN(program.stop.getTime())) return false;
          // Ensure dates are within reasonable range (1970-2100)
          const startYear = program.start.getUTCFullYear();
          const stopYear = program.stop.getUTCFullYear();
          if (startYear < 1970 || startYear > 2100 || stopYear < 1970 || stopYear > 2100) return false;
          // Ensure stop is after start
          if (program.stop.getTime() <= program.start.getTime()) return false;
          return true;
        });
        
        if (validPrograms.length < programs.length) {
          this.logger.warn(`Filtered out ${formatNumber(programs.length - validPrograms.length)} invalid programs (invalid dates)`);
        }
        
        if (validPrograms.length > 0) {
          // Delete old programs for this provider
          await this._programManager.deleteByProvider(provider.id);
          
          // Insert new programs
          const result = await this._programManager.insertPrograms(validPrograms);
          this.logger.info(`Synced ${formatNumber(validPrograms.length)} programs (${formatNumber(result.inserted)} inserted, ${formatNumber(result.updated)} updated) from ${provider.type} provider ${provider.id}`);
        } else {
          this.logger.warn(`No valid programs to sync for provider ${provider.id} (all programs had invalid dates)`);
        }
      } else {
        this.logger.warn(`No programs found in EPG for provider ${provider.id} (check channel ID matching)`);
      }
    } catch (epgError) {
      this.logger.error(`Failed to sync EPG for ${provider.type} provider ${provider.id}: ${epgError.message}`, epgError);
      // Don't fail the entire sync if EPG fails
    }
  }

  /**
   * Sync channels from provider (unified for both Xtream and AGTV)
   * @private
   * @param {Object} provider - Provider object with type, id, name, etc.
   * @returns {Promise<void>}
   */
  async _syncProvider(provider) {
    try {
      this.logger.info(`Syncing ${provider.type} provider ${provider.id}...`);

      // Get provider instance from mapping (initialized in constructor)
      const providerInstance = this._providerInstanceMap[provider.type];

      if (!providerInstance) {
        throw new Error(`Unsupported provider type: ${provider.type}`);
      }

      // Fetch channels from provider (already parsed and formatted)
      const channels = await providerInstance.fetchLiveChannels(provider.id);
      
      // Load existing channels map (channel_key -> url)
      const existingChannelsMap = await this._channelManager.getChannelsMapByKey(provider.id);
      
      // Build new channels map for comparison
      const newChannelsMap = new Map();
      for (const channel of channels) {
        newChannelsMap.set(channel.channel_key, channel);
      }
      
      // Categorize channels
      const toInsert = [];
      const toUpdate = [];
      const toRemove = [];
      
      // Check new channels
      for (const [channelKey, newChannel] of newChannelsMap.entries()) {
        const existing = existingChannelsMap.get(channelKey);
        
        if (!existing) {
          // New channel - doesn't exist in DB
          toInsert.push(newChannel);
        } else if (existing.url !== newChannel.url) {
          // Existing channel but URL changed
          toUpdate.push(newChannel);
        }
        // If exists and URL same - no action needed
      }
      
      // Check existing channels - find ones to remove
      for (const [channelKey] of existingChannelsMap.entries()) {
        if (!newChannelsMap.has(channelKey)) {
          // Exists in DB but not in new data - remove it
          toRemove.push(channelKey);
        }
      }
      
      // Execute bulk operations
      if (toInsert.length > 0 || toUpdate.length > 0 || toRemove.length > 0) {
        const result = await this._channelManager.syncChannels({
          toInsert,
          toUpdate,
          toRemove
        });
        this.logger.info(`Synced channels from ${provider.type} provider ${provider.id}: ${formatNumber(result.inserted)} inserted, ${formatNumber(result.updated)} updated, ${formatNumber(result.deleted)} deleted`);
      } else {
        this.logger.info(`No channels to sync for ${provider.type} provider ${provider.id} (no changes detected)`);
      }

      // Sync EPG
      await this._syncProviderEPG(provider, providerInstance);
    } catch (error) {
      this.logger.error(`Error syncing ${provider.type} provider ${provider.id}: ${error.message}`);
      throw error;
    }
  }
}

