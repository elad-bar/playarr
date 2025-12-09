import { createLogger } from '../utils/logger.js';
import { formatNumber } from '../utils/numberFormat.js';
import Bottleneck from 'bottleneck';
import fs from 'fs-extra';
import path from 'path';

/**
 * Base class for all providers (IPTV, TMDB, etc.)
 * Provides common rate limiting and caching functionality using Bottleneck and disk storage
 * @abstract
 */
export class BaseProvider {
  /**
   * @param {string} loggerName - Logger name (required)
   * @param {string} [cacheDir] - Optional cache directory path (defaults to CACHE_DIR env var or '/app/cache')
   * @param {import('../managers/orchestration/MetricsManager.js').default} metricsManager - Metrics manager instance (optional)
   */
  constructor(loggerName, cacheDir = null, metricsManager) {
    this.logger = createLogger(loggerName);
    
    // Rate limiters per providerId: Map<providerId, Bottleneck>
    // Used by IPTV providers that need per-provider limiters
    this._limiters = new Map();
    
    // Single limiter instance (used by TMDB provider)
    this.limiter = null;
    
    // Cache directory for disk-based caching
    this._cacheDir = cacheDir || process.env.CACHE_DIR || '/app/cache';
    if (this._cacheDir) {
      fs.ensureDirSync(this._cacheDir);
    }
    
    // Track initialized directories to avoid redundant I/O
    this._initializedDirs = new Set();
    
    /**
     * Response type resolver map
     * Maps responseType string to function that extracts data from fetch Response
     * @private
     * @type {Object<string, Function>}
     */
    this._responseResolverMap = {
      json: (response) => response.json(),
      text: (response) => response.text(),
      arraybuffer: (response) => response.arrayBuffer()
    };
    
    // Metrics service for tracking API request metrics
    this.metricsManager = metricsManager;
  }

  /**
   * Get or create rate limiter for a provider
   * @protected
   * @param {string} providerId - Provider ID
   * @param {Object} rateConfig - Rate limiting configuration
   * @param {number} [rateConfig.concurrent] - Number of concurrent requests
   * @param {number} [rateConfig.duration_seconds] - Duration in seconds for rate limit window
   * @returns {Bottleneck} Rate limiter instance
   */
  _getOrCreateLimiter(providerId, rateConfig = {}) {
    // Check if limiter already exists
    if (this._limiters.has(providerId)) {
      return this._limiters.get(providerId);
    }

    // Handle typo "concurrect" for backward compatibility
    const normalizedConfig = {
      concurrent: rateConfig.concurrent || rateConfig.concurrect || 1,
      duration_seconds: rateConfig.duration_seconds || 1
    };

    // Create new limiter for this provider using shared creation method
    const limiter = this._createLimiter(normalizedConfig);
    
    this._limiters.set(providerId, limiter);
    this.logger.debug(`Created rate limiter for provider ${providerId}: ${formatNumber(normalizedConfig.concurrent)} requests per ${formatNumber(normalizedConfig.duration_seconds)} second(s)`);
    
    return limiter;
  }

  /**
   * Create a single limiter instance (for providers like TMDB)
   * @protected
   * @param {Object} rateConfig - Rate limiting configuration
   * @param {number} [rateConfig.concurrent] - Number of concurrent requests
   * @param {number} [rateConfig.duration_seconds] - Duration in seconds for rate limit window
   * @returns {Bottleneck} Rate limiter instance
   */
  _createLimiter(rateConfig = {}) {
    const concurrent = rateConfig.concurrent || 1;
    const durationSeconds = rateConfig.duration_seconds || 1;

    const limiter = new Bottleneck({
      reservoir: concurrent,
      reservoirRefreshInterval: durationSeconds * 1000,
      reservoirRefreshAmount: concurrent,
      maxConcurrent: concurrent,
      minTime: 0
    });

    this.logger.debug(`Created rate limiter: ${formatNumber(concurrent)} requests per ${formatNumber(durationSeconds)} second(s)`);
    
    return limiter;
  }

  /**
   * Update or recreate a limiter for a provider
   * @protected
   * @param {string} providerId - Provider ID
   * @param {Object} rateConfig - Rate limiting configuration
   */
  _updateLimiter(providerId, rateConfig) {
    // Remove existing limiter
    if (this._limiters.has(providerId)) {
      const oldLimiter = this._limiters.get(providerId);
      oldLimiter.disconnect();
      this._limiters.delete(providerId);
    }

    // Create new limiter with updated config
    this._getOrCreateLimiter(providerId, rateConfig);
  }

  /**
   * Remove a limiter for a provider
   * @protected
   * @param {string} providerId - Provider ID
   */
  _removeLimiter(providerId) {
    if (this._limiters.has(providerId)) {
      const limiter = this._limiters.get(providerId);
      limiter.disconnect();
      this._limiters.delete(providerId);
      this.logger.debug(`Removed rate limiter for provider ${providerId}`);
    }
  }

  /**
   * Cleanup all limiters
   * @protected
   */
  _cleanupLimiters() {
    for (const [providerId, limiter] of this._limiters.entries()) {
      limiter.disconnect();
    }
    this._limiters.clear();
    
    if (this.limiter) {
      this.limiter.disconnect();
      this.limiter = null;
    }
  }

  /**
   * Get cache key mappings for this provider
   * Must be implemented by subclasses to return their specific cache key configurations
   * @private
   * @abstract
   * @param {string} providerId - Provider ID
   * @returns {Object<string, {type: string, endpoint: string, dirBuilder: Function, fileBuilder: Function, cacheParams?: Object, ttl: number|null}>} Mapping of cache key identifier to cache configuration
   */
  _getCacheKeyMappings(providerId) {
    throw new Error('_getCacheKeyMappings() must be implemented by subclass');
  }

  /**
   * Initialize cache directories
   * Should be called once after provider construction to pre-create all cache directories
   * @param {string} [providerId] - Optional provider ID (for IPTV providers that support multiple)
   */
  initialize(providerId = null) {
    if (!this._cacheDir) {
      return;
    }

    try {
      const mappings = this._getCacheKeyMappings(providerId || 'default');
      
      for (const [cacheKey, { dirBuilder, cacheParams = {} }] of Object.entries(mappings)) {
        if (!dirBuilder) {
          continue;
        }
        
        try {
          // For static paths, use empty params
          // For dynamic paths, we'll ensure base directory exists
          const dirPath = dirBuilder(this._cacheDir, providerId || 'default', cacheParams);
          const dirKey = `${providerId || 'default'}:${dirPath}`;
          
          if (!this._initializedDirs.has(dirKey)) {
            fs.ensureDirSync(dirPath);
            this._initializedDirs.add(dirKey);
            this.logger.debug(`Initialized cache directory: ${dirPath}`);
          }
        } catch (error) {
          this.logger.warn(`Failed to initialize cache directory for ${cacheKey}: ${error.message}`);
        }
      }
    } catch (error) {
      // Provider might not implement mappings yet, that's okay
      this.logger.debug(`Could not initialize cache directories: ${error.message}`);
    }
  }


  /**
   * Get TTL in hours for a cache key
   * @private
   * @param {string} providerId - Provider ID
   * @param {string} cacheKey - Cache key identifier
   * @param {string} type - Media type (for fallback)
   * @returns {number|null} TTL in hours, null for never expire
   */
  _getTTL(providerId, cacheKey, type = null) {
    try {
      const mappings = this._getCacheKeyMappings(providerId);
      const mapping = mappings[cacheKey];
      if (mapping && mapping.ttl !== undefined) {
        return mapping.ttl;
      }
    } catch (error) {
      // If provider doesn't implement mappings, fall back to default
    }
    return null; // Default: never expire
  }

  /**
   * Check if cache file is expired
   * @private
   * @param {string} filePath - Path to cache file
   * @param {number|null} ttlHours - TTL in hours (null for never expire)
   * @returns {boolean} True if expired or doesn't exist
   */
  _isCacheExpired(filePath, ttlHours) {
    if (!fs.existsSync(filePath)) {
      return true;
    }
    
    if (ttlHours === null) {
      return false; // Never expires
    }
    
    const stats = fs.statSync(filePath);
    const ageMs = Date.now() - stats.mtimeMs;
    const maxAgeMs = ttlHours * 60 * 60 * 1000;
    
    return ageMs >= maxAgeMs;
  }

  /**
   * Get cached data from disk
   * @protected
   * @param {string} providerId - Provider ID
   * @param {string} type - Media type
   * @param {string} endpoint - Endpoint type
   * @param {Object} params - Additional parameters
   * @returns {any|null} Cached data or null if not found/expired
   */
  _getCache(providerId, type, endpoint, params = {}) {
    if (!this._cacheDir) {
      return null;
    }

    try {
      // Get cache key mappings from provider
      const mappings = this._getCacheKeyMappings(providerId);
      
      // Find the mapping for this endpoint and type
      let mapping = null;
      let cacheKey = null;
      for (const [key, value] of Object.entries(mappings)) {
        if (value.endpoint === endpoint && value.type === type) {
          mapping = value;
          cacheKey = key;
          break;
        }
      }

      if (!mapping || !mapping.fileBuilder) {
        return null;
      }

      const filePath = mapping.fileBuilder(this._cacheDir, providerId, type, params);
      
      // Ensure directory exists (for dynamic paths that weren't pre-initialized)
      const dirPath = path.dirname(filePath);
      const dirKey = `${providerId}:${dirPath}`;
      if (!this._initializedDirs.has(dirKey)) {
        fs.ensureDirSync(dirPath);
        this._initializedDirs.add(dirKey);
      }
      const ttlHours = mapping.ttl !== undefined ? mapping.ttl : null;
      
      if (this._isCacheExpired(filePath, ttlHours)) {
        return null;
      }
      
      // Read based on file extension
      if (filePath.endsWith('.m3u8') || filePath.endsWith('.xml')) {
        return fs.readFileSync(filePath, 'utf8');
      } else {
        return fs.readJsonSync(filePath);
      }
    } catch (error) {
      this.logger.error(`Error reading cache: ${error.message}`);
      return null;
    }
  }

  /**
   * Set cached data to disk
   * @private
   * @param {string} providerId - Provider ID
   * @param {string} type - Media type
   * @param {string} endpoint - Endpoint type
   * @param {any} data - Data to cache
   * @param {Object} params - Additional parameters
   */
  _setCache(providerId, type, endpoint, data, params = {}) {
    if (!this._cacheDir) {
      return;
    }

    try {
      // Get cache key mappings from provider
      const mappings = this._getCacheKeyMappings(providerId);
      
      // Find the mapping for this endpoint and type
      let mapping = null;
      for (const [key, value] of Object.entries(mappings)) {
        if (value.endpoint === endpoint && value.type === type) {
          mapping = value;
          break;
        }
      }

      if (!mapping || !mapping.fileBuilder) {
        this.logger.warn(`No cache mapping found for ${endpoint}: ${providerId}/${type}`);
        return;
      }

      const filePath = mapping.fileBuilder(this._cacheDir, providerId, type, params);
      
      // Ensure directory exists (for dynamic paths that weren't pre-initialized)
      const dirPath = path.dirname(filePath);
      const dirKey = `${providerId}:${dirPath}`;
      if (!this._initializedDirs.has(dirKey)) {
        fs.ensureDirSync(dirPath);
        this._initializedDirs.add(dirKey);
      }
      
      // Write based on data type
      if (typeof data === 'string') {
        // M3U8 content
        fs.writeFileSync(filePath, data, 'utf8');
      } else {
        // JSON data
        fs.writeJsonSync(filePath, data, { spaces: 2 });
      }
      
      this.logger.debug(`Cached data to: ${filePath}`);
    } catch (error) {
      this.logger.error(`Error writing cache: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get cache keys and their corresponding cache paths for a provider
   * Returns a mapping of cache key identifiers to their cache file paths (relative to cacheDir)
   * @param {string} providerId - Provider ID
   * @returns {Object<string, {path: string, ttl: number|null}>} Mapping of cache key to cache path info
   */
  getCacheKeys(providerId) {
    if (!this._cacheDir) {
      return {};
    }

    try {
      // Call the abstract method implemented by subclasses
      const cacheKeyMappings = this._getCacheKeyMappings(providerId);
      
      // Convert logical cache keys to actual file paths
      const result = {};
      for (const [cacheKey, { type, endpoint, fileBuilder, cacheParams = {}, ttl }] of Object.entries(cacheKeyMappings)) {
        try {
          const cachePath = fileBuilder(this._cacheDir, providerId, type, cacheParams);
          // Return relative path from cacheDir for easier cleanup
          const relativePath = cachePath.replace(this._cacheDir + path.sep, '');
          result[cacheKey] = {
            path: relativePath,
            ttl: ttl !== undefined ? ttl : null
          };
        } catch (error) {
          this.logger.warn(`Failed to build cache path for key ${cacheKey}: ${error.message}`);
        }
      }
      
      return result;
    } catch (error) {
      this.logger.warn(`Failed to get cache keys for provider ${providerId}: ${error.message}`);
      return {};
    }
  }

  /**
   * HTTP request with caching and rate limiting
   * Core implementation - method-agnostic, accepts prepared fetch options
   * @protected
   * @param {Object} options - Request options
   * @param {string} options.providerId - Provider ID
   * @param {string} options.type - Media type
   * @param {string} options.endpoint - Cache endpoint name
   * @param {Object} [options.cacheParams={}] - Parameters for cache key uniqueness
   * @param {string} options.url - Full URL to fetch
   * @param {Object} options.fetchOptions - Prepared fetch options (method, headers, body, signal)
   * @param {Bottleneck} [options.limiter] - Rate limiter (uses this.limiter if not provided)
   * @param {string} [options.responseType='json'] - Response type: 'json', 'text', or 'arraybuffer'
   * @param {Function} [options.transform] - Optional transform function for response data (receives data, responseStatus)
   * @param {boolean} [options.skipCache=false] - Skip reading from cache
   * @param {number} [options.timeout] - Request timeout in milliseconds
   * @param {AbortSignal} [options.signal] - AbortSignal for request cancellation
   * @param {boolean} [options.allowNonOk=false] - Allow non-OK responses
   * @returns {Promise<any>} Response data (parsed based on responseType)
   */
  async _httpRequest({ 
    providerId, type, endpoint, cacheParams = {}, url, fetchOptions,
    limiter = null, responseType = 'json', transform = null, 
    skipCache = false, timeout = null, signal = null, allowNonOk = false 
  }) {
    // Simple fallback to single limiter (for TMDB and other non-IPTV providers)
    const limiterToUse = limiter || this.limiter;
    if (!limiterToUse) {
      throw new Error('Rate limiter is required');
    }

    // Check cache first (unless skipping cache)
    if (!skipCache) {
      const cached = this._getCache(providerId, type, endpoint, cacheParams);
      if (cached !== null) {
        this.logger.debug(`Cache hit for ${endpoint}: ${providerId}/${type}`);
        return cached;
      }
    }

    // Set up timeout if provided
    let controller = null;
    let timeoutId = null;
    let abortSignal = signal || fetchOptions.signal;
    
    if (timeout && !abortSignal) {
      controller = new AbortController();
      abortSignal = controller.signal;
      timeoutId = setTimeout(() => {
        this.logger.debug(`Timeout for ${url}`);
        controller.abort();
      }, timeout);
    }

    // Merge abort signal into fetch options
    const finalFetchOptions = {
      ...fetchOptions,
      signal: abortSignal
    };

    try {
      // Make API call with rate limiting
      let responseStatus = null;
      const totalStartTime = Date.now();
      let requestDuration = 0;
      const cacheKey = cacheParams.titleId ? `/${cacheParams.titleId}` : '';
      
      const rawData = await limiterToUse.schedule(async () => {
        const requestStartTime = Date.now();
        const response = await fetch(url, finalFetchOptions);
        requestDuration = Date.now() - requestStartTime;
        responseStatus = response.status;
        
        if (!response.ok && !allowNonOk) {
          const errorData = await response.json().catch(() => ({ 
            status_message: `HTTP ${response.status}` 
          }));
          throw new Error(errorData.status_message || `API error: ${response.status}`);
        }
        
        // Use resolver map
        const resolver = this._responseResolverMap[responseType] || this._responseResolverMap.json;
        return await resolver(response);
      });

      const totalDuration = Date.now() - totalStartTime;
      const waitTime = totalDuration - requestDuration;
      this.logger.debug(
        `API ${finalFetchOptions.method} request: ${endpoint} ${providerId}/${type}${cacheKey} - ` +
        `${formatNumber(requestDuration)}ms (Waited: ${formatNumber(waitTime)}ms, total ${formatNumber(totalDuration)}ms)`
      );

      // Clear timeout if it was set
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      // Transform data if transform function provided
      const finalData = transform ? await transform(rawData, responseStatus) : rawData;

      this._setCache(providerId, type, endpoint, finalData, cacheParams);

      // Track metrics for successful requests
      if (this.metricsManager && responseStatus) {
        try {
          const statusCode = String(responseStatus);
          const providerIdLabel = providerId || 'unknown';
          const endpointLabel = endpoint || 'unknown';
          
          this.metricsManager.incrementCounter('provider_api_requests', {
            provider_id: providerIdLabel,
            endpoint: endpointLabel,
            status_code: statusCode
          });
          this.metricsManager.observeHistogram('provider_api_request_duration', {
            provider_id: providerIdLabel,
            endpoint: endpointLabel,
            status_code: statusCode
          }, requestDuration / 1000); // Convert ms to seconds
        } catch (metricsError) {
          // Don't let metrics tracking errors affect request flow
          this.logger.debug(`Error tracking metrics: ${metricsError.message}`);
        }
      }

      return finalData;
    } catch (error) {
      // Clear timeout if it was set
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      
      // Handle AbortError (timeout)
      if (error.name === 'AbortError') {
        // Track timeout metrics
        if (this.metricsManager) {
          try {
            const providerIdLabel = providerId || 'unknown';
            const endpointLabel = endpoint || 'unknown';
            const timeoutValue = timeout || 60000; // Default 60s if not specified
            
            this.metricsManager.incrementCounter('provider_api_requests', {
              provider_id: providerIdLabel,
              endpoint: endpointLabel,
              status_code: 'timeout'
            });
            this.metricsManager.observeHistogram('provider_api_request_duration', {
              provider_id: providerIdLabel,
              endpoint: endpointLabel,
              status_code: 'timeout'
            }, timeoutValue / 1000);
          } catch (metricsError) {
            this.logger.debug(`Error tracking timeout metrics: ${metricsError.message}`);
          }
        }
        throw new Error('Request timeout');
      } else {
        this.logger.error(`Error ${finalFetchOptions.method} ${url}: ${error.message}`);
        
        // Track error metrics
        if (this.metricsManager) {
          try {
            let errorStatusCode = 'error';
            
            // Try to extract status code from error
            if (error.status || error.statusCode) {
              errorStatusCode = String(error.status || error.statusCode);
            } else if (error.message && error.message.includes('HTTP')) {
              // Try to extract status code from error message like "HTTP 502"
              const match = error.message.match(/HTTP (\d+)/);
              if (match) {
                errorStatusCode = match[1];
              }
            } else if (error.code) {
              // Check for network error codes
              if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') {
                errorStatusCode = 'network_error';
              }
            }
            
            const providerIdLabel = providerId || 'unknown';
            const endpointLabel = endpoint || 'unknown';
            const errorDuration = requestDuration > 0 ? requestDuration : (timeout || 60000);
            
            this.metricsManager.incrementCounter('provider_api_requests', {
              provider_id: providerIdLabel,
              endpoint: endpointLabel,
              status_code: errorStatusCode
            });
            this.metricsManager.observeHistogram('provider_api_request_duration', {
              provider_id: providerIdLabel,
              endpoint: endpointLabel,
              status_code: errorStatusCode
            }, errorDuration / 1000);
          } catch (metricsError) {
            this.logger.debug(`Error tracking error metrics: ${metricsError.message}`);
          }
        }
      }
      
      throw error;
    }
  }

  /**
   * HTTP GET request (convenience wrapper)
   * @protected
   * @param {Object} options - Same options as _httpRequest, except fetchOptions are prepared here
   * @param {string} options.providerId - Provider ID
   * @param {string} options.type - Media type
   * @param {string} options.endpoint - Cache endpoint name
   * @param {Object} [options.cacheParams={}] - Parameters for cache key uniqueness
   * @param {string} options.url - Full URL to fetch
   * @param {Object} [options.headers={}] - Request headers
   * @param {Bottleneck} [options.limiter] - Rate limiter (uses this.limiter if not provided)
   * @param {string} [options.responseType='json'] - Response type: 'json', 'text', or 'arraybuffer'
   * @param {Function} [options.transform] - Optional transform function for response data
   * @param {boolean} [options.skipCache=false] - Skip reading from cache
   * @param {number} [options.timeout] - Request timeout in milliseconds
   * @param {AbortSignal} [options.signal] - AbortSignal for request cancellation
   * @param {boolean} [options.allowNonOk=false] - Allow non-OK responses
   * @returns {Promise<any>} Response data
   */
  async _httpGet({ headers = {}, ...restOptions }) {
    const fetchOptions = {
      method: 'GET',
      headers
    };
    
    return this._httpRequest({ 
      ...restOptions, 
      fetchOptions 
    });
  }

  /**
   * HTTP POST request (convenience wrapper)
   * @protected
   * @param {Object} options - Same options as _httpRequest, except fetchOptions are prepared here
   * @param {string} options.providerId - Provider ID
   * @param {string} options.type - Media type
   * @param {string} options.endpoint - Cache endpoint name
   * @param {Object} [options.cacheParams={}] - Parameters for cache key uniqueness
   * @param {string} options.url - Full URL to fetch
   * @param {Object} options.data - Request body data (will be JSON stringified)
   * @param {Object} [options.headers={}] - Request headers
   * @param {Bottleneck} [options.limiter] - Rate limiter (uses this.limiter if not provided)
   * @param {string} [options.responseType='json'] - Response type: 'json', 'text', or 'arraybuffer'
   * @param {Function} [options.transform] - Optional transform function for response data
   * @param {boolean} [options.skipCache=false] - Skip reading from cache
   * @param {number} [options.timeout] - Request timeout in milliseconds
   * @param {AbortSignal} [options.signal] - AbortSignal for request cancellation
   * @param {boolean} [options.allowNonOk=false] - Allow non-OK responses
   * @returns {Promise<any>} Response data
   */
  async _httpPost({ data, headers = {}, ...restOptions }) {
    const fetchOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };
    
    // Add body if data is provided
    if (data) {
      fetchOptions.body = JSON.stringify(data);
    }
    
    return this._httpRequest({ 
      ...restOptions, 
      fetchOptions 
    });
  }

}

