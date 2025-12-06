import { BaseManager } from '../BaseManager.js';
import { formatNumber } from '../../utils/numberFormat.js';
import http from 'http';
import https from 'https';
import { URL } from 'url';

/**
 * Constants for stream endpoint
 * Matches Python's STREAM_HEADERS
 */
const STREAM_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
  'Accept': '*/*',
  'Connection': 'keep-alive',
};

/**
 * Base class for all formatting managers
 * Provides stream URL resolution functionality
 * @abstract
 */
class BaseFormattingManager extends BaseManager {
  /**
   * @param {string} managerName - Manager name for logging
   * @param {import('../domain/TitlesManager.js').TitlesManager} titlesManager - Titles manager instance
   * @param {import('../domain/IPTVProviderManager.js').IPTVProviderManager} iptvProviderManager - IPTV Provider manager instance
   */
  constructor(managerName, titlesManager, iptvProviderManager) {
    super(managerName);
    this._titlesManager = titlesManager;
    this._iptvProviderManager = iptvProviderManager;
    this._timeout = 7500; // 7.5 seconds timeout for URL checks
  }

  /**
   * Get episode number in format E## (e.g., E01)
   * @private
   */
  _getEpisodeNumber(episodeNum) {
    return this._getNumber(episodeNum, 'E');
  }

  /**
   * Get season number in format S## (e.g., S01)
   * @private
   */
  _getSeasonNumber(seasonNum) {
    return this._getNumber(seasonNum, 'S');
  }

  /**
   * Format number with prefix (e.g., S01, E01)
   * @private
   */
  _getNumber(num, prefix) {
    const number = String(num).padStart(2, '0');
    return `${prefix}${number}`;
  }

  /**
   * Get the best source for a specific title
   * @param {string|number} titleId - Title ID (TMDB ID)
   * @param {string} mediaType - Media type ('movies' or 'tvshows')
   * @param {number|null} [seasonNumber=null] - Season number (for TV shows)
   * @param {number|null} [episodeNumber=null] - Episode number (for TV shows)
   * @returns {Promise<string|null>} Best valid stream URL or null if none found
   */
  async getBestSource(titleId, mediaType, seasonNumber = null, episodeNumber = null) {
    this.logger.info(
      `Getting best source for title ID: ${titleId}, media type: ${mediaType}, season: ${seasonNumber}, episode: ${episodeNumber}`
    );

    try {
      const sources = await this._getSources(titleId, mediaType, seasonNumber, episodeNumber);

      if (!sources || sources.length === 0) {
        this.logger.warn(`No sources found for title ${mediaType} ${titleId}`);
        return null;
      }

      this.logger.info(`Found ${formatNumber(sources.length)} source(s) for title ${mediaType} ${titleId}`);

      // Check each source and return the first valid one
      for (let i = 0; i < sources.length; i++) {
        const source = sources[i];
        const sourceUrl = typeof source === 'string' ? source : source.url;
        const providerType = typeof source === 'object' ? source.providerType : null;
        this.logger.info(`Checking source ${formatNumber(i + 1)}/${formatNumber(sources.length)}: ${sourceUrl}`);
        if (await this._checkUrl(sourceUrl, providerType)) {
          this.logger.info(`Best source for title ${mediaType} ${titleId} is valid: ${sourceUrl}`);
          return sourceUrl;
        } else {
          this.logger.warn(`Source ${formatNumber(i + 1)}/${formatNumber(sources.length)} is invalid for title ${mediaType} ${titleId}: ${sourceUrl}`);
        }
      }

      this.logger.warn(`No valid sources found for title ${mediaType} ${titleId} after checking ${formatNumber(sources.length)} source(s)`);
      return null;
    } catch (error) {
      this.logger.error(`Error getting best source for title ${mediaType} ${titleId}:`, error);
      return null;
    }
  }

  /**
   * Get sources for a specific title
   * @private
   * @param {string|number} titleId - Title ID (TMDB ID)
   * @param {string} mediaType - Media type ('movies' or 'tvshows')
   * @param {number|null} [seasonNumber=null] - Season number (for TV shows)
   * @param {number|null} [episodeNumber=null] - Episode number (for TV shows)
   * @returns {Promise<Array<{url: string, providerType: string|null, provider_id: string}>>} Array of source objects
   */
  async _getSources(titleId, mediaType, seasonNumber = null, episodeNumber = null) {
    try {
      // Find title by tmdb_id and type using TitlesManager
      const titles = await this._titlesManager.findTitlesByQuery({
        title_id: parseInt(titleId, 10),
        type: mediaType
      });
      
      if (!titles || titles.length === 0) {
        this.logger.warn(`No title found for ${mediaType} ${titleId}`);
        return [];
      }
      
      const titleData = titles[0];
      const media = titleData.media || [];
      
      if (media.length === 0) {
        this.logger.warn(`No media found for ${mediaType} ${titleId}`);
        return [];
      }

      // Find the matching media item
      let mediaItem = null;
      if (mediaType === 'movies') {
        // For movies, find media item with name === 'main'
        mediaItem = media.find(m => m.name === 'main');
      } else {
        // For TV shows, find media item matching season and episode
        const season = parseInt(seasonNumber, 10);
        const episode = parseInt(episodeNumber, 10);
        mediaItem = media.find(m => m.season === season && m.episode === episode);
      }
      
      if (!mediaItem || !mediaItem.sources || mediaItem.sources.length === 0) {
        this.logger.warn(`No sources found for ${mediaType} ${titleId}, season ${seasonNumber}, episode ${episodeNumber}`);
        return [];
      }

      this.logger.debug(`Found ${formatNumber(mediaItem.sources.length)} source(s) for ${mediaType} ${titleId}`);

      // Get enabled providers using IPTVProviderManager
      const providersMap = await this._iptvProviderManager.getEnabledProvidersMap({ excludeDeleted: true });

      this.logger.debug(`Loaded ${formatNumber(providersMap.size)} enabled provider(s)`);

      const sources = [];
      
      for (const sourceEntry of mediaItem.sources) {
        const providerUrl = sourceEntry.provider_url;
        if (!providerUrl) {
          this.logger.debug(`Source for provider ${sourceEntry.provider_id} has no provider_url, skipping`);
          continue;
        }

        const providerId = sourceEntry.provider_id;
        const provider = providersMap.get(providerId);

        // Skip if provider is not found (disabled or deleted)
        if (!provider) {
          this.logger.debug(`Skipping stream for disabled/deleted provider ${providerId}`);
          continue;
        }

        this.logger.debug(`Processing stream for provider ${providerId}, provider_url: ${providerUrl}`);
        
        // Get provider type for optimized URL checking
        const providerType = provider.type || null;

        // Check if URL is already absolute (has base URL)
        if (providerUrl.startsWith('http://') || providerUrl.startsWith('https://')) {
          // Already absolute, use as-is
          this.logger.debug(`Using absolute URL: ${providerUrl}`);
          sources.push({ url: providerUrl, providerType, provider_id: providerId });
        } else if (providerUrl.startsWith('/')) {
          // Relative URL - need to concatenate with base URLs
          if (provider && provider.streams_urls && Array.isArray(provider.streams_urls) && provider.streams_urls.length > 0) {
            this.logger.debug(`Provider ${providerId} has ${formatNumber(provider.streams_urls.length)} stream URL(s) configured`);
            // For each base URL in streams_urls, create a full URL
            for (const baseUrl of provider.streams_urls) {
              if (baseUrl && typeof baseUrl === 'string' && baseUrl.trim()) {
                // Remove trailing slash from baseUrl if present, then add providerUrl
                const cleanBaseUrl = baseUrl.replace(/\/$/, '');
                const fullUrl = `${cleanBaseUrl}${providerUrl}`;
                this.logger.debug(`Constructed full URL: ${fullUrl}`);
                sources.push({ url: fullUrl, providerType, provider_id: providerId });
              }
            }
          } else {
            // No streams_urls configured, log warning but still try the relative URL
            this.logger.warn(`Provider ${providerId} has relative stream URL but no streams_urls configured. Using relative URL: ${providerUrl}`);
            sources.push({ url: providerUrl, providerType, provider_id: providerId });
          }
        } else {
          // Neither absolute nor relative (unexpected format), use as-is
          this.logger.warn(`Unexpected stream URL format for ${providerId}: ${providerUrl}`);
          sources.push({ url: providerUrl, providerType, provider_id: providerId });
        }
      }

      // Sort sources by provider type, availability, and priority
      sources.sort((a, b) => {
        const providerA = providersMap.get(a.provider_id);
        const providerB = providersMap.get(b.provider_id);
        
        // 1. Provider type priority: Xtream (0) > AGTV (1) > unknown (999)
        const typePriority = { 'xtream': 0, 'agtv': 1 };
        const typeA = typePriority[providerA?.type?.toLowerCase()] ?? 999;
        const typeB = typePriority[providerB?.type?.toLowerCase()] ?? 999;
        const typeDiff = typeA - typeB;
        if (typeDiff !== 0) return typeDiff;
        
        // 2. For Xtream: sort by availability (higher is better)
        if (providerA?.type?.toLowerCase() === 'xtream' && providerB?.type?.toLowerCase() === 'xtream') {
          const detailsA = providerA.provider_details || {};
          const detailsB = providerB.provider_details || {};
          
          const maxConnA = detailsA.max_connections ?? 1;
          const activeConnA = detailsA.active_connections ?? 0;
          const availabilityA = maxConnA > 0 ? 1 - (activeConnA / maxConnA) : 0;
          
          const maxConnB = detailsB.max_connections ?? 1;
          const activeConnB = detailsB.active_connections ?? 0;
          const availabilityB = maxConnB > 0 ? 1 - (activeConnB / maxConnB) : 0;
          
          const availabilityDiff = availabilityB - availabilityA; // Descending (higher availability first)
          if (availabilityDiff !== 0) return availabilityDiff;
        }
        
        // 3. Provider priority as tiebreaker (lower number = higher priority)
        const priorityA = providerA?.priority ?? 999;
        const priorityB = providerB?.priority ?? 999;
        return priorityA - priorityB;
      });

      this.logger.debug(`Found ${formatNumber(sources.length)} source URL(s) for title ${titleId} (sorted by priority)`);
      return sources;
    } catch (error) {
      this.logger.error(`Error getting sources for title ${titleId}:`, error);
      return [];
    }
  }

  /**
   * Check if a URL is reachable
   * Uses HEAD request for AGTV providers (faster) and GET for others
   * @param {string} url - URL to check
   * @param {string|null} providerType - Provider type ('agtv' or 'xtream'), null for unknown
   * @returns {Promise<boolean>} True if URL is reachable
   */
  async _checkUrl(url, providerType = null) {
    try {
      // Use HEAD request for AGTV providers (faster, no body download)
      // Use native http/https for GET requests (more efficient, reads only 100 bytes)
      const useHead = providerType === 'agtv';
      
      if (useHead) {
        return await this._checkUrlWithFetch(url, 'HEAD');
      } else {
        return await this._checkUrlWithNative(url);
      }
    } catch (error) {
      if (error.name === 'AbortError' || error.code === 'ETIMEDOUT') {
        this.logger.warn(`URL check timed out after ${this._timeout}ms: ${url}`);
      } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        this.logger.warn(`URL check network error (${error.code}): ${url} - ${error.message}`);
      } else if (error.message) {
        this.logger.warn(`URL check failed: ${url} - ${error.message}`);
      } else {
        this.logger.error(`Error checking URL: ${url}`, error);
      }
      return false;
    }
  }

  /**
   * Check URL using fetch (for HEAD requests)
   * @private
   * @param {string} url - URL to check
   * @param {string} method - HTTP method ('HEAD')
   * @returns {Promise<boolean>} True if URL is reachable
   */
  async _checkUrlWithFetch(url, method) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this._timeout);

    try {
      this.logger.info(`Checking URL: ${url} (method: ${method})`);

      const response = await fetch(url, {
        method: method,
        headers: STREAM_HEADERS,
        redirect: 'follow',
        signal: controller.signal,
      });

      const isValid = response.ok;
      if (isValid) {
        this.logger.info(`URL check successful: ${url} (status: ${response.status}, method: ${method})`);
      } else {
        this.logger.warn(`URL check failed: ${url} (status: ${response.status}, method: ${method})`);
      }

      return isValid;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Check URL using native http/https modules (for GET requests)
   * Reads only first 100 bytes then destroys connection
   * @private
   * @param {string} url - URL to check
   * @param {number} [redirectDepth=0] - Current redirect depth (max 3)
   * @returns {Promise<boolean>} True if URL is reachable
   */
  async _checkUrlWithNative(url, redirectDepth = 0) {
    const MAX_REDIRECTS = 3;
    
    if (redirectDepth > MAX_REDIRECTS) {
      this.logger.warn(`URL check exceeded max redirects (${MAX_REDIRECTS}): ${url}`);
      return false;
    }

    return new Promise((resolve, reject) => {
      let resolved = false;
      
      try {
        const urlObj = new URL(url);
        const isHttps = urlObj.protocol === 'https:';
        const httpModule = isHttps ? https : http;

        const options = {
          hostname: urlObj.hostname,
          port: urlObj.port || (isHttps ? 443 : 80),
          path: urlObj.pathname + urlObj.search,
          method: 'GET',
          headers: STREAM_HEADERS,
        };

        let bytesRead = 0;
        const maxBytes = 100; // Only read first 100 bytes
        const chunks = [];

        this.logger.info(`Checking URL: ${url} (method: GET, redirect depth: ${redirectDepth})`);

        const req = httpModule.get(options, (res) => {
          const statusCode = res.statusCode || 0;
          const isValid = statusCode >= 200 && statusCode < 400;

          // Handle redirects (status 3xx)
          if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
            if (!resolved) {
              resolved = true;
              req.destroy();
              
              // Resolve redirect URL (handle both absolute and relative)
              let redirectUrl = res.headers.location;
              if (!redirectUrl.startsWith('http://') && !redirectUrl.startsWith('https://')) {
                // Relative redirect - construct absolute URL
                const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
                redirectUrl = new URL(redirectUrl, baseUrl).href;
              }
              
              this.logger.debug(`Following redirect to: ${redirectUrl}`);
              // Recursively follow redirect
              return this._checkUrlWithNative(redirectUrl, redirectDepth + 1)
                .then(resolve)
                .catch(reject);
            }
            return;
          }

          res.on('data', (chunk) => {
            if (resolved) return;

            chunks.push(chunk);
            bytesRead += chunk.length;

            // Stop reading after we have enough bytes
            if (bytesRead >= maxBytes) {
              resolved = true;
              req.destroy(); // Stop downloading

              if (isValid) {
                this.logger.info(`URL check successful: ${url} (status: ${statusCode}, read ${bytesRead} bytes)`);
              } else {
                this.logger.warn(`URL check failed: ${url} (status: ${statusCode}, read ${bytesRead} bytes)`);
              }

              resolve(isValid);
            }
          });

          res.on('end', () => {
            if (!resolved) {
              resolved = true;

              if (isValid) {
                this.logger.info(`URL check successful: ${url} (status: ${statusCode}, read ${bytesRead} bytes)`);
              } else {
                this.logger.warn(`URL check failed: ${url} (status: ${statusCode}, read ${bytesRead} bytes)`);
              }

              resolve(isValid);
            }
          });

          res.on('error', (error) => {
            if (!resolved) {
              resolved = true;
              reject(error);
            }
          });
        });

        req.on('error', (error) => {
          if (!resolved) {
            resolved = true;
            reject(error);
          }
        });

        req.on('timeout', () => {
          if (!resolved) {
            resolved = true;
            req.destroy();
            const timeoutError = new Error('Request timeout');
            timeoutError.code = 'ETIMEDOUT';
            reject(timeoutError);
          }
        });

        // Set timeout
        req.setTimeout(this._timeout);
      } catch (error) {
        if (!resolved) {
          resolved = true;
          reject(error);
        }
      }
    });
  }
}

export { BaseFormattingManager };

