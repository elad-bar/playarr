import { createLogger } from '../utils/logger.js';
import { DatabaseCollections, toCollectionName } from '../config/collections.js';

const logger = createLogger('StreamManager');

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
class StreamManager {
  /**
   * @param {import('../services/database.js').DatabaseService} database - Database service instance
   */
  constructor(database) {
    this._database = database;
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
    logger.info(
      `Getting best source for title ID: ${titleId}, media type: ${mediaType}, season: ${seasonNumber}, episode: ${episodeNumber}`
    );

    try {
      const sources = await this._getSources(titleId, mediaType, seasonNumber, episodeNumber);

      if (!sources || sources.length === 0) {
        logger.warn(`No sources found for title ${mediaType} ${titleId}`);
        return null;
      }

      logger.info(`Found ${sources.length} source(s) for title ${mediaType} ${titleId}`);

      // Check each source and return the first valid one
      for (let i = 0; i < sources.length; i++) {
        const source = sources[i];
        logger.info(`Checking source ${i + 1}/${sources.length}: ${source}`);
        if (await this._checkUrl(source)) {
          logger.info(`Best source for title ${mediaType} ${titleId} is valid: ${source}`);
          return source;
        } else {
          logger.warn(`Source ${i + 1}/${sources.length} is invalid for title ${mediaType} ${titleId}: ${source}`);
        }
      }

      logger.warn(`No valid sources found for title ${mediaType} ${titleId} after checking ${sources.length} source(s)`);
      return null;
    } catch (error) {
      logger.error(`Error getting best source for title ${mediaType} ${titleId}:`, error);
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
      // Build stream key prefix: {mediaType}-{titleId}-{streamId}-
      const titlePrefix = `${mediaType}-${titleId}-`;
      
      // Build stream ID suffix
      let streamIdSuffix = 'main';
      if (mediaType === 'tvshows') {
        const seasonNum = this._getSeasonNumber(seasonNumber);
        const episodeNum = this._getEpisodeNumber(episodeNumber);
        streamIdSuffix = `${seasonNum}-${episodeNum}`;
      }
      
      // Get streams from database
      const streamsData = await this._database.getDataObject('titles-streams') || {};
      if (!streamsData || Object.keys(streamsData).length === 0) {
        logger.warn('Streams data not available');
        return [];
      }

      logger.debug(`Streams data contains ${Object.keys(streamsData).length} entries`);

      // Get providers data to access streams_urls for base URL concatenation
      // Filter to only enabled providers
      const providersCollection = toCollectionName(DatabaseCollections.IPTV_PROVIDERS);
      const allProviders = await this._database.getDataList(providersCollection) || [];
      const providers = allProviders.filter(p => p.enabled !== false);
      const providersMap = new Map(providers.map(p => [p.id, p]));

      logger.debug(`Loaded ${providers.length} enabled provider(s) out of ${allProviders.length} total`);

      // Find all streams matching this title and stream ID
      // Stream key format: {type}-{tmdbId}-{streamId}-{providerId}
      const streamPrefix = `${titlePrefix}${streamIdSuffix}-`;
      logger.debug(`Looking for streams with prefix: ${streamPrefix}`);
      const sources = [];
      
      for (const [streamKey, streamEntry] of Object.entries(streamsData)) {
        if (streamKey.startsWith(streamPrefix)) {
          logger.debug(`Found matching stream key: ${streamKey}`);
          const proxyUrl = streamEntry.proxy_url;
          if (!proxyUrl) {
            logger.debug(`Stream key ${streamKey} has no proxy_url, skipping`);
            continue;
          }

          // Extract providerId from stream key (last part after final dash)
          const parts = streamKey.split('-');
          const providerId = parts[parts.length - 1];
          const provider = providersMap.get(providerId);

          // Skip if provider is not found (disabled or deleted)
          if (!provider) {
            logger.debug(`Skipping stream for disabled/deleted provider ${providerId}`);
            continue;
          }

          logger.debug(`Processing stream for provider ${providerId}, proxy_url: ${proxyUrl}`);

          // Check if URL is already absolute (has base URL)
          if (proxyUrl.startsWith('http://') || proxyUrl.startsWith('https://')) {
            // Already absolute, use as-is
            logger.debug(`Using absolute URL: ${proxyUrl}`);
            sources.push(proxyUrl);
          } else if (proxyUrl.startsWith('/')) {
            // Relative URL - need to concatenate with base URLs
            if (provider && provider.streams_urls && Array.isArray(provider.streams_urls) && provider.streams_urls.length > 0) {
              logger.debug(`Provider ${providerId} has ${provider.streams_urls.length} stream URL(s) configured`);
              // For each base URL in streams_urls, create a full URL
              for (const baseUrl of provider.streams_urls) {
                if (baseUrl && typeof baseUrl === 'string' && baseUrl.trim()) {
                  // Remove trailing slash from baseUrl if present, then add proxyUrl
                  const cleanBaseUrl = baseUrl.replace(/\/$/, '');
                  const fullUrl = `${cleanBaseUrl}${proxyUrl}`;
                  logger.debug(`Constructed full URL: ${fullUrl}`);
                  sources.push(fullUrl);
                }
              }
            } else {
              // No streams_urls configured, log warning but still try the relative URL
              logger.warn(`Provider ${providerId} has relative stream URL but no streams_urls configured. Using relative URL: ${proxyUrl}`);
              sources.push(proxyUrl);
            }
          } else {
            // Neither absolute nor relative (unexpected format), use as-is
            logger.warn(`Unexpected stream URL format for ${streamKey}: ${proxyUrl}`);
            sources.push(proxyUrl);
          }
        }
      }

      logger.debug(`Found ${sources.length} source URL(s) for title ${titleId}`);
      return sources;
    } catch (error) {
      logger.error(`Error getting sources for title ${titleId}:`, error);
      return [];
    }
  }

  /**
   * Check if a URL is reachable using GET
   * Matches Python's StreamService._check_url()
   */
  async _checkUrl(url) {
    try {
      logger.info(`Checking URL: ${url}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this._timeout);

      const response = await fetch(url, {
        method: 'GET',
        headers: STREAM_HEADERS,
        redirect: 'follow',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Read a small amount to ensure connection works
      const reader = response.body.getReader();
      const { done } = await reader.read();
      reader.releaseLock();

      const isValid = response.ok;
      if (isValid) {
        logger.info(`URL check successful: ${url} (status: ${response.status})`);
      } else {
        logger.warn(`URL check failed: ${url} (status: ${response.status})`);
      }

      return isValid;
    } catch (error) {
      if (error.name === 'AbortError') {
        logger.warn(`URL check timed out after ${this._timeout}ms: ${url}`);
      } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
        logger.warn(`URL check network error (${error.code}): ${url} - ${error.message}`);
      } else if (error.message) {
        // Node.js fetch errors might have different structure
        const errorMsg = error.message || String(error);
        logger.warn(`URL check failed: ${url} - ${errorMsg}`);
      } else {
        logger.error(`Error checking URL: ${url}`, error);
      }
      return false;
    }
  }
}

// Export class
export { StreamManager };

