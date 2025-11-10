import { BaseManager } from './BaseManager.js';
import { DatabaseCollections, toCollectionName } from '../config/collections.js';
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
 * Stream manager for handling stream data operations
 * Matches Python's StreamService
 */
class StreamManager extends BaseManager {
  /**
   * @param {import('../services/database.js').DatabaseService} database - Database service instance
   */
  constructor(database) {
    super('StreamManager', database);
    this._timeout = 7500; // 7.5 seconds timeout for URL checks
  }

  /**
   * Get episode number in format E## (e.g., E01)
   * Matches Python's get_episode_number()
   */
  _getEpisodeNumber(episodeNum) {
    return this._getNumber(episodeNum, 'E');
  }

  /**
   * Get season number in format S## (e.g., S01)
   * Matches Python's get_season_number()
   */
  _getSeasonNumber(seasonNum) {
    return this._getNumber(seasonNum, 'S');
  }

  /**
   * Format number with prefix (e.g., S01, E01)
   * Matches Python's _get_number()
   */
  _getNumber(num, prefix) {
    const number = String(num).padStart(2, '0');
    return `${prefix}${number}`;
  }

  /**
   * Get the best source for a specific title
   * Matches Python's StreamService.get_best_source()
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

      this.logger.info(`Found ${sources.length} source(s) for title ${mediaType} ${titleId}`);

      // Check each source and return the first valid one
      for (let i = 0; i < sources.length; i++) {
        const source = sources[i];
        const sourceUrl = typeof source === 'string' ? source : source.url;
        const providerType = typeof source === 'object' ? source.providerType : null;
        this.logger.info(`Checking source ${i + 1}/${sources.length}: ${sourceUrl}`);
        if (await this._checkUrl(sourceUrl, providerType)) {
          this.logger.info(`Best source for title ${mediaType} ${titleId} is valid: ${sourceUrl}`);
          return sourceUrl;
        } else {
          this.logger.warn(`Source ${i + 1}/${sources.length} is invalid for title ${mediaType} ${titleId}: ${sourceUrl}`);
        }
      }

      this.logger.warn(`No valid sources found for title ${mediaType} ${titleId} after checking ${sources.length} source(s)`);
      return null;
    } catch (error) {
      this.logger.error(`Error getting best source for title ${mediaType} ${titleId}:`, error);
      return null;
    }
  }

  /**
   * Get sources for a specific title
   * Matches Python's StreamService._get_sources()
   * Enhanced to support multiple URLs and base URL concatenation for Xtream providers
   */
  async _getSources(titleId, mediaType, seasonNumber = null, episodeNumber = null) {
    try {
      // Build stream ID suffix
      let streamIdSuffix = 'main';
      if (mediaType === 'tvshows') {
        const seasonNum = this._getSeasonNumber(seasonNumber);
        const episodeNum = this._getEpisodeNumber(episodeNumber);
        streamIdSuffix = `${seasonNum}-${episodeNum}`;
      }
      
      // Build title_key for MongoDB query
      const titleKey = `${mediaType}-${titleId}`;
      
      // Query MongoDB title_streams collection directly
      const streams = await this._database.getDataList('title_streams', {
        title_key: titleKey,
        stream_id: streamIdSuffix
      });
      
      if (!streams || streams.length === 0) {
        this.logger.warn(`No streams found for title ${titleKey}, stream ${streamIdSuffix}`);
        return [];
      }

      this.logger.debug(`Found ${streams.length} stream(s) for title ${titleKey}, stream ${streamIdSuffix}`);

      // Get providers data to access streams_urls for base URL concatenation
      // Filter to only enabled providers
      const providersCollection = toCollectionName(DatabaseCollections.IPTV_PROVIDERS);
      const allProviders = await this._database.getDataList(providersCollection) || [];
      const providers = allProviders.filter(p => p.enabled !== false);
      const providersMap = new Map(providers.map(p => [p.id, p]));

      this.logger.debug(`Loaded ${providers.length} enabled provider(s) out of ${allProviders.length} total`);

      const sources = [];
      
      for (const streamEntry of streams) {
        const proxyUrl = streamEntry.proxy_url;
        if (!proxyUrl) {
          this.logger.debug(`Stream for provider ${streamEntry.provider_id} has no proxy_url, skipping`);
          continue;
        }

        const providerId = streamEntry.provider_id;
        const provider = providersMap.get(providerId);

          // Skip if provider is not found (disabled or deleted)
          if (!provider) {
            this.logger.debug(`Skipping stream for disabled/deleted provider ${providerId}`);
            continue;
          }

          this.logger.debug(`Processing stream for provider ${providerId}, proxy_url: ${proxyUrl}`);
          
          // Get provider type for optimized URL checking
          const providerType = provider.type || null;

          // Check if URL is already absolute (has base URL)
          if (proxyUrl.startsWith('http://') || proxyUrl.startsWith('https://')) {
            // Already absolute, use as-is
            this.logger.debug(`Using absolute URL: ${proxyUrl}`);
            sources.push({ url: proxyUrl, providerType });
          } else if (proxyUrl.startsWith('/')) {
            // Relative URL - need to concatenate with base URLs
            if (provider && provider.streams_urls && Array.isArray(provider.streams_urls) && provider.streams_urls.length > 0) {
              this.logger.debug(`Provider ${providerId} has ${provider.streams_urls.length} stream URL(s) configured`);
              // For each base URL in streams_urls, create a full URL
              for (const baseUrl of provider.streams_urls) {
                if (baseUrl && typeof baseUrl === 'string' && baseUrl.trim()) {
                  // Remove trailing slash from baseUrl if present, then add proxyUrl
                  const cleanBaseUrl = baseUrl.replace(/\/$/, '');
                  const fullUrl = `${cleanBaseUrl}${proxyUrl}`;
                  this.logger.debug(`Constructed full URL: ${fullUrl}`);
                  sources.push({ url: fullUrl, providerType });
                }
              }
            } else {
              // No streams_urls configured, log warning but still try the relative URL
              this.logger.warn(`Provider ${providerId} has relative stream URL but no streams_urls configured. Using relative URL: ${proxyUrl}`);
              sources.push({ url: proxyUrl, providerType });
            }
          } else {
            // Neither absolute nor relative (unexpected format), use as-is
            this.logger.warn(`Unexpected stream URL format for ${providerId}: ${proxyUrl}`);
            sources.push({ url: proxyUrl, providerType });
          }
      }

      this.logger.debug(`Found ${sources.length} source URL(s) for title ${titleId}`);
      return sources;
    } catch (error) {
      this.logger.error(`Error getting sources for title ${titleId}:`, error);
      return [];
    }
  }

  /**
   * Check if a URL is reachable
   * Uses HEAD request for AGTV providers (faster) and GET for others
   * Matches Python's StreamService._check_url()
   * @param {string} url - URL to check
   * @param {string|null} providerType - Provider type ('agtv' or 'xtream'), null for unknown
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

// Export class
export { StreamManager };

