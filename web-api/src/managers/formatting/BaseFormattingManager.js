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
    
    // Load balancing state
    this._errorHistory = new Map(); // provider_id -> Array<{timestamp: number, statusCode: number}>
    this._selectionCache = new Map(); // cacheKey -> {provider_id: string, url: string, timestamp: number}
    this._selectionHistory = new Map(); // provider_id -> Array<timestamp> (for AGTV round-robin)
    this._lastSelectedProvider = new Map(); // titleKey -> provider_id (for round-robin)
    this._selectionCacheTTL = 30 * 1000; // 30 seconds cache TTL
    this._errorWindowMs = 60 * 1000; // 1 minute window for error tracking
    this._cleanupInterval = 5 * 60 * 1000; // Clean up old cache entries every 5 minutes
    
    // Start cleanup interval
    if (typeof setInterval !== 'undefined') {
      setInterval(() => this._cleanupCaches(), this._cleanupInterval);
    }
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
   * Generate cache key for title/episode with username
   * @private
   * @param {string|number} titleId - Title ID
   * @param {string} mediaType - Media type
   * @param {number|null} seasonNumber - Season number
   * @param {number|null} episodeNumber - Episode number
   * @param {string} username - Username (required)
   * @returns {string} Cache key
   */
  _getCacheKey(titleId, mediaType, seasonNumber, episodeNumber, username) {
    if (seasonNumber !== null && episodeNumber !== null) {
      return `${mediaType}-${titleId}-S${seasonNumber}-E${episodeNumber}-user:${username}`;
    }
    return `${mediaType}-${titleId}-user:${username}`;
  }

  /**
   * Get cached selection if still valid
   * @private
   * @param {string} cacheKey - Cache key
   * @returns {{provider_id: string, url: string}|null} Cached selection or null
   */
  _getCachedSelection(cacheKey) {
    const cached = this._selectionCache.get(cacheKey);
    if (!cached) {
      return null;
    }
    
    const age = Date.now() - cached.timestamp;
    if (age > this._selectionCacheTTL) {
      // Cache expired
      this._selectionCache.delete(cacheKey);
      return null;
    }
    
    // Check if provider still has recent 502 errors (invalidate cache if so)
    const recent502Errors = this._getRecent502Errors(cached.provider_id);
    if (recent502Errors > 0) {
      this.logger.debug(`Invalidating cache for ${cacheKey} due to recent 502 errors from provider ${cached.provider_id}`);
      this._selectionCache.delete(cacheKey);
      return null;
    }
    
    return {
      provider_id: cached.provider_id,
      url: cached.url
    };
  }

  /**
   * Cache provider selection
   * @private
   * @param {string} cacheKey - Cache key
   * @param {string} providerId - Provider ID
   * @param {string} url - Stream URL
   */
  _cacheSelection(cacheKey, providerId, url) {
    this._selectionCache.set(cacheKey, {
      provider_id: providerId,
      url: url,
      timestamp: Date.now()
    });
    
    // Track selection for AGTV round-robin
    this._recordSelection(providerId);
    
    // Clean up old cache entries if cache is too large
    if (this._selectionCache.size > 1000) {
      const now = Date.now();
      for (const [key, value] of this._selectionCache.entries()) {
        if (now - value.timestamp > this._selectionCacheTTL) {
          this._selectionCache.delete(key);
        }
      }
    }
  }

  /**
   * Track recent provider selections (for AGTV round-robin)
   * @private
   * @param {string} providerId - Provider ID
   */
  _recordSelection(providerId) {
    if (!this._selectionHistory.has(providerId)) {
      this._selectionHistory.set(providerId, []);
    }
    
    const selections = this._selectionHistory.get(providerId);
    selections.push(Date.now());
    
    // Keep only last 5 minutes
    const cutoff = Date.now() - (5 * 60 * 1000);
    const recent = selections.filter(t => t > cutoff);
    this._selectionHistory.set(providerId, recent);
  }

  /**
   * Get count of recent selections (for AGTV)
   * @private
   * @param {string} providerId - Provider ID
   * @returns {number} Count of selections in last minute
   */
  _getRecentSelections(providerId) {
    const selections = this._selectionHistory?.get(providerId) || [];
    const cutoff = Date.now() - (60 * 1000); // Last minute
    return selections.filter(t => t > cutoff).length;
  }

  /**
   * Record error for a provider
   * @private
   * @param {string} providerId - Provider ID
   * @param {number} statusCode - HTTP status code (502, etc.)
   */
  _recordError(providerId, statusCode) {
    if (!this._errorHistory.has(providerId)) {
      this._errorHistory.set(providerId, []);
    }
    
    const errors = this._errorHistory.get(providerId);
    errors.push({
      timestamp: Date.now(),
      statusCode
    });
    
    // Keep only recent errors (last 5 minutes)
    const cutoff = Date.now() - (5 * 60 * 1000);
    const recentErrors = errors.filter(e => e.timestamp > cutoff);
    this._errorHistory.set(providerId, recentErrors);
    
    this.logger.debug(`Recorded ${statusCode} error for provider ${providerId} (${recentErrors.length} errors in last 5 minutes)`);
  }

  /**
   * Get count of recent 502 errors (within error window)
   * @private
   * @param {string} providerId - Provider ID
   * @returns {number} Count of 502 errors in last minute
   */
  _getRecent502Errors(providerId) {
    const errors = this._errorHistory.get(providerId) || [];
    const cutoff = Date.now() - this._errorWindowMs;
    return errors.filter(e => 
      e.timestamp > cutoff && e.statusCode === 502
    ).length;
  }

  /**
   * Get the best source for a specific title
   * @param {string|number} titleId - Title ID (TMDB ID)
   * @param {string} mediaType - Media type ('movies' or 'tvshows')
   * @param {number|null} [seasonNumber=null] - Season number (for TV shows)
   * @param {number|null} [episodeNumber=null] - Episode number (for TV shows)
   * @param {string} username - Username (required for user-specific caching)
   * @returns {Promise<string|null>} Best valid stream URL or null if none found
   */
  async getBestSource(titleId, mediaType, seasonNumber = null, episodeNumber = null, username) {
    if (!username) {
      throw new Error('Username is required for getBestSource');
    }

    const titleKey = seasonNumber !== null && episodeNumber !== null
      ? `${mediaType}-${titleId}-S${seasonNumber}-E${episodeNumber}`
      : `${mediaType}-${titleId}`;

    this.logger.info(
      `Getting best source for title: ${titleKey}, user: ${username}`
    );

    try {
      // Create cache key including username for user-specific caching
      const cacheKey = this._getCacheKey(titleId, mediaType, seasonNumber, episodeNumber, username);
      
      // Check cache first
      const cached = this._getCachedSelection(cacheKey);
      if (cached) {
        this.logger.info(`Using cached provider selection for ${titleKey} (user: ${username}, provider: ${cached.provider_id})`);
        return cached.url;
      }

      // Get sources and apply load balancing
      const sources = await this._getSources(titleId, mediaType, seasonNumber, episodeNumber);

      if (!sources || sources.length === 0) {
        this.logger.warn(`No sources found for title ${titleKey}`);
        return null;
      }

      this.logger.info(`Found ${formatNumber(sources.length)} source(s) for title ${titleKey}`);

      // Apply load balancing: re-sort sources based on availability, errors, etc.
      const balancedSources = this._applyLoadBalancing(sources, titleKey);

      // Race top N sources in parallel - return the FIRST valid one (fastest response)
      const topSourcesToRace = balancedSources.slice(0, 5); // Race top 5 sources
      
      // Initialize race results for logging
      const raceResults = {
        titleKey: titleKey,
        username: username,
        totalSources: sources.length,
        racedSources: topSourcesToRace.length,
        startTime: Date.now(),
        providers: [],
        winner: null,
        duration: null
      };

      const racePromises = topSourcesToRace.map((source, index) => 
        this._checkUrlWithErrorTrackingAndCancel(
          source.url, 
          source.providerType, 
          source.provider_id,
          source,
          index,
          raceResults // Pass race results for logging
        )
      );

      // Race: return the first valid source that responds
      const winner = await this._raceToFirstValid(racePromises, raceResults);
      
      // Calculate total duration
      raceResults.duration = Date.now() - raceResults.startTime;
      raceResults.winner = winner;

      // Log comprehensive race results
      this._logRaceResults(raceResults);

      if (winner && winner.isValid) {
        // Cache the selection
        this._cacheSelection(cacheKey, winner.provider_id, winner.url);
        
        this.logger.info(
          `Best source for ${titleKey} selected: ${winner.url} ` +
          `(user: ${username}, provider: ${winner.provider_id}, response time: ${winner.responseTime}ms, cached for 30s)`
        );
        return winner.url;
      }

      // If top sources all failed, continue with remaining sources sequentially
      for (let i = topSourcesToRace.length; i < balancedSources.length; i++) {
        const source = balancedSources[i];
        const sourceUrl = typeof source === 'string' ? source : source.url;
        const providerType = typeof source === 'object' ? source.providerType : null;
        
        this.logger.info(`Checking source ${formatNumber(i + 1)}/${formatNumber(balancedSources.length)}: ${sourceUrl}`);
        
        const result = await this._checkUrlWithErrorTracking(sourceUrl, providerType, source.provider_id);
        if (result.isValid) {
          // Cache the selection
          this._cacheSelection(cacheKey, source.provider_id, sourceUrl);
          
          this.logger.info(`Best source for ${titleKey} is valid: ${sourceUrl} (user: ${username}, provider: ${source.provider_id}, cached for 30s)`);
          return sourceUrl;
        } else if (result.statusCode === 502) {
          this._recordError(source.provider_id, 502);
        }
      }

      this.logger.warn(`No valid sources found for title ${titleKey} after checking ${formatNumber(balancedSources.length)} source(s)`);
      return null;
    } catch (error) {
      this.logger.error(`Error getting best source for title ${titleKey}:`, error);
      return null;
    }
  }

  /**
   * Apply load balancing to sources
   * Re-sorts sources based on:
   * 1. Recent 502 errors (deprioritize providers with recent 502s)
   * 2. Active request count (for Xtream: prefer providers with fewer active requests relative to available connections)
   * 3. Connection availability (for Xtream: prefer providers with more available connections)
   * 4. Round-robin (ensure all providers get requests)
   * @private
   * @param {Array<{url: string, providerType: string|null, provider_id: string, provider: Object}>} sources - Sources array
   * @param {string} titleKey - Title key for round-robin tracking
   * @returns {Array<{url: string, providerType: string|null, provider_id: string, provider: Object, loadScore: number}>} Re-sorted sources
   */
  _applyLoadBalancing(sources, titleKey) {
    const now = Date.now();
    
    // Calculate load scores for each source
    const sourcesWithScores = sources.map(source => {
      const providerId = source.provider_id;
      const providerType = source.providerType?.toLowerCase();
      const provider = source.provider;
      
      let loadScore = 0;
      
      // 1. Heavy penalty for recent 502 errors (applies to both Xtream and AGTV)
      const recent502Errors = this._getRecent502Errors(providerId);
      if (recent502Errors > 0) {
        loadScore += 10000 * recent502Errors; // Heavy penalty
      }
      
      // 2. For Xtream: Use real connection availability from provider_details
      if (providerType === 'xtream') {
        const details = provider?.provider_details || {};
        const maxConn = details.max_connections ?? 0;
        const activeConn = details.active_connections ?? 0;
        
        // Calculate available connections
        const availableConn = maxConn > 0 ? maxConn - activeConn : 0;
        
        // Prefer providers with MORE available connections
        // Lower score = better (so we subtract available connections)
        loadScore -= availableConn * 100; // Negative = better, more available = much better
        
        // If provider is near capacity, add penalty
        if (maxConn > 0) {
          const utilization = activeConn / maxConn;
          if (utilization > 0.8) { // More than 80% utilized
            loadScore += 500; // Penalty for high utilization
          }
        }
      }
      
      // 3. For AGTV: Use round-robin to distribute (no real connection data)
      // Track recent selections to avoid always picking same provider
      if (providerType === 'agtv') {
        const recentSelections = this._getRecentSelections(providerId);
        loadScore += recentSelections * 50; // Penalty for recent selections
      }
      
      return {
        ...source,
        loadScore,
        recent502Errors,
        // For Xtream: include connection info for logging
        ...(providerType === 'xtream' && {
          activeConnections: provider?.provider_details?.active_connections ?? 0,
          maxConnections: provider?.provider_details?.max_connections ?? 0,
          availableConnections: (provider?.provider_details?.max_connections ?? 0) - 
                               (provider?.provider_details?.active_connections ?? 0)
        })
      };
    });

    // Sort by load score (lower is better)
    sourcesWithScores.sort((a, b) => a.loadScore - b.loadScore);

    // Apply round-robin for providers with similar scores
    const topScore = sourcesWithScores[0]?.loadScore || 0;
    const similarProviders = sourcesWithScores.filter(s => 
      Math.abs(s.loadScore - topScore) < 200 // Within 200 points
    );
    
    if (similarProviders.length > 1) {
      // Round-robin: rotate selection
      const lastProvider = this._lastSelectedProvider.get(titleKey);
      const lastIndex = similarProviders.findIndex(s => s.provider_id === lastProvider);
      const nextIndex = lastIndex >= 0 ? (lastIndex + 1) % similarProviders.length : 0;
      const selectedProvider = similarProviders[nextIndex];
      
      // Move selected provider to front
      const selectedIndex = sourcesWithScores.findIndex(s => s.provider_id === selectedProvider.provider_id);
      if (selectedIndex > 0) {
        const [selected] = sourcesWithScores.splice(selectedIndex, 1);
        sourcesWithScores.unshift(selected);
      }
      // Always update tracking map for round-robin, even if provider is already at index 0
      this._lastSelectedProvider.set(titleKey, selectedProvider.provider_id);
    }

    return sourcesWithScores;
  }

  /**
   * Race multiple URL checks and return the first valid one
   * Cancels remaining checks once a valid source is found
   * @private
   * @param {Array<Promise>} promises - Array of validation promises
   * @param {Object} raceResults - Race results object to populate
   * @returns {Promise<{isValid: boolean, url: string, provider_id: string, responseTime: number}|null>}
   */
  async _raceToFirstValid(promises, raceResults) {
    const startTime = Date.now();
    let winner = null;
    let resolved = false;
    let completed = 0;
    
    return new Promise((resolve) => {
      promises.forEach((promise, index) => {
        promise.then((result) => {
          if (resolved) return; // Already found winner
          
          completed++;
          const responseTime = Date.now() - startTime;
          result.responseTime = responseTime;
          
          // Add to race results for logging
          raceResults.providers.push({
            provider_id: result.provider_id,
            provider_type: result.providerType || 'unknown',
            url: result.url,
            isValid: result.isValid,
            statusCode: result.statusCode || null,
            responseTime: responseTime,
            position: index + 1, // Position in race
            won: false
          });
          
          // If this is valid, it's our winner!
          if (result.isValid) {
            resolved = true;
            winner = result;
            
            // Mark as winner in race results
            raceResults.providers[raceResults.providers.length - 1].won = true;
            
            resolve(winner);
          } else if (completed === promises.length) {
            // All completed, none were valid
            resolve(null);
          }
        }).catch((error) => {
          if (resolved) return;
          
          completed++;
          const responseTime = Date.now() - startTime;
          
          // Add failed result to race results
          raceResults.providers.push({
            provider_id: 'unknown',
            provider_type: 'unknown',
            url: 'unknown',
            isValid: false,
            statusCode: null,
            responseTime: responseTime,
            position: index + 1,
            won: false,
            error: error.message
          });
          
          if (completed === promises.length && !winner) {
            resolve(null);
          }
        });
      });
    });
  }

  /**
   * Log comprehensive race results
   * @private
   * @param {Object} raceResults - Race results object
   */
  _logRaceResults(raceResults) {
    const { titleKey, username, totalSources, racedSources, duration, providers, winner } = raceResults;
    
    // Sort providers by response time
    const sortedProviders = [...providers].sort((a, b) => a.responseTime - b.responseTime);
    
    // Build detailed log message
    const logLines = [
      `=== Race Results for ${titleKey} (user: ${username}) ===`,
      `Total sources available: ${totalSources}, Raced: ${racedSources}, Duration: ${duration}ms`,
      winner 
        ? `✅ Winner: ${winner.provider_id} (${winner.responseTime}ms)`
        : `❌ No valid source found`,
      ``,
      `Provider Results (sorted by response time):`
    ];
    
    sortedProviders.forEach((provider, index) => {
      const status = provider.isValid ? '✅ VALID' : '❌ INVALID';
      const statusCode = provider.statusCode ? ` (HTTP ${provider.statusCode})` : '';
      const winnerMark = provider.won ? ' 🏆 WINNER' : '';
      const error = provider.error ? ` - Error: ${provider.error}` : '';
      
      logLines.push(
        `  ${index + 1}. ${provider.provider_id} (${provider.provider_type}) - ${status}${statusCode}${winnerMark}`
      );
      logLines.push(
        `     Response time: ${provider.responseTime}ms, Position: ${provider.position}`
      );
      if (error) {
        logLines.push(`     ${error}`);
      }
    });
    
    logLines.push(`=== End Race Results ===`);
    
    // Log as info
    this.logger.info(logLines.join('\n'));
  }

  /**
   * Clean up expired cache entries
   * @private
   */
  _cleanupCaches() {
    const now = Date.now();
    let cleaned = 0;
    
    // Clean selection cache
    for (const [key, value] of this._selectionCache.entries()) {
      if (now - value.timestamp > this._selectionCacheTTL) {
        this._selectionCache.delete(key);
        cleaned++;
      }
    }
    
    // Clean error history
    const errorCutoff = now - (5 * 60 * 1000); // 5 minutes
    for (const [providerId, errors] of this._errorHistory.entries()) {
      const recentErrors = errors.filter(e => e.timestamp > errorCutoff);
      if (recentErrors.length === 0) {
        this._errorHistory.delete(providerId);
        cleaned++;
      } else {
        this._errorHistory.set(providerId, recentErrors);
      }
    }
    
    // Clean selection history
    const selectionCutoff = now - (5 * 60 * 1000); // 5 minutes
    for (const [providerId, selections] of this._selectionHistory.entries()) {
      const recentSelections = selections.filter(t => t > selectionCutoff);
      if (recentSelections.length === 0) {
        this._selectionHistory.delete(providerId);
        cleaned++;
      } else {
        this._selectionHistory.set(providerId, recentSelections);
      }
    }
    
    if (cleaned > 0) {
      this.logger.debug(`Cleaned up ${cleaned} expired cache entries`);
    }
  }

  /**
   * Get sources for a specific title
   * @private
   * @param {string|number} titleId - Title ID (TMDB ID)
   * @param {string} mediaType - Media type ('movies' or 'tvshows')
   * @param {number|null} [seasonNumber=null] - Season number (for TV shows)
   * @param {number|null} [episodeNumber=null] - Episode number (for TV shows)
   * @returns {Promise<Array<{url: string, providerType: string|null, provider_id: string, provider: Object}>>} Array of source objects
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
          sources.push({ url: providerUrl, providerType, provider_id: providerId, provider: provider });
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
                sources.push({ url: fullUrl, providerType, provider_id: providerId, provider: provider });
              }
            }
          } else {
            // No streams_urls configured, log warning but still try the relative URL
            this.logger.warn(`Provider ${providerId} has relative stream URL but no streams_urls configured. Using relative URL: ${providerUrl}`);
            sources.push({ url: providerUrl, providerType, provider_id: providerId, provider: provider });
          }
        } else {
          // Neither absolute nor relative (unexpected format), use as-is
          this.logger.warn(`Unexpected stream URL format for ${providerId}: ${providerUrl}`);
          sources.push({ url: providerUrl, providerType, provider_id: providerId, provider: provider });
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
   * Check URL and track errors (especially 502)
   * @private
   * @param {string} url - URL to check
   * @param {string|null} providerType - Provider type
   * @param {string} providerId - Provider ID
   * @returns {Promise<{isValid: boolean, statusCode: number|null}>}
   */
  async _checkUrlWithErrorTracking(url, providerType, providerId) {
    try {
      const useHead = providerType === 'agtv';
      
      if (useHead) {
        const result = await this._checkUrlWithFetchAndStatus(url, 'HEAD');
        if (!result.isValid && result.statusCode === 502) {
          this._recordError(providerId, 502);
        }
        return result;
      } else {
        const result = await this._checkUrlWithNativeAndStatus(url);
        if (!result.isValid && result.statusCode === 502) {
          this._recordError(providerId, 502);
        }
        return result;
      }
    } catch (error) {
      // Network errors might indicate 502-like issues
      if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
        this._recordError(providerId, 502); // Treat as 502-like error
      }
      return { isValid: false, statusCode: null };
    }
  }

  /**
   * Check URL using fetch and return status code
   * @private
   * @param {string} url - URL to check
   * @param {string} method - HTTP method
   * @returns {Promise<{isValid: boolean, statusCode: number}>}
   */
  async _checkUrlWithFetchAndStatus(url, method) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this._timeout);

    try {
      const response = await fetch(url, {
        method: method,
        headers: STREAM_HEADERS,
        redirect: 'follow',
        signal: controller.signal,
      });

      const isValid = response.ok;
      return { isValid, statusCode: response.status };
    } catch (error) {
      return { isValid: false, statusCode: null };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Check URL using native http/https and return status code
   * @private
   * @param {string} url - URL to check
   * @param {number} [redirectDepth=0] - Current redirect depth (max 3)
   * @returns {Promise<{isValid: boolean, statusCode: number|null}>}
   */
  async _checkUrlWithNativeAndStatus(url, redirectDepth = 0) {
    const MAX_REDIRECTS = 3;
    
    if (redirectDepth > MAX_REDIRECTS) {
      this.logger.warn(`URL check exceeded max redirects (${MAX_REDIRECTS}): ${url}`);
      return { isValid: false, statusCode: null };
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
              
              // Recursively follow redirect
              return this._checkUrlWithNativeAndStatus(redirectUrl, redirectDepth + 1)
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
              resolve({ isValid, statusCode });
            }
          });

          res.on('end', () => {
            if (!resolved) {
              resolved = true;
              resolve({ isValid, statusCode });
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

  /**
   * Check URL with error tracking and return result with metadata
   * @private
   * @param {string} url - URL to check
   * @param {string|null} providerType - Provider type
   * @param {string} providerId - Provider ID
   * @param {Object} source - Full source object
   * @param {number} index - Index in race array
   * @param {Object} raceResults - Race results object (for logging)
   * @returns {Promise<{isValid: boolean, url: string, provider_id: string, statusCode: number|null, responseTime: number, providerType: string}>}
   */
  async _checkUrlWithErrorTrackingAndCancel(url, providerType, providerId, source, index, raceResults) {
    const startTime = Date.now();
    
    try {
      const result = await this._checkUrlWithErrorTracking(url, providerType, providerId);
      const responseTime = Date.now() - startTime;
      
      return {
        ...result,
        url: url,
        provider_id: providerId,
        providerType: providerType,
        responseTime: responseTime
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      return {
        isValid: false,
        url: url,
        provider_id: providerId,
        providerType: providerType,
        statusCode: null,
        responseTime: responseTime,
        error: error.message
      };
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

