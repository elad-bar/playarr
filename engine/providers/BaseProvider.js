import { createLogger } from '../utils/logger.js';
import axios from 'axios';
import Bottleneck from 'bottleneck';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Base class for all providers (IPTV, TMDB, etc.)
 * Provides generic API communication, caching, and data storage functionality
 * @abstract
 */
export class BaseProvider {
  /**
   * Load all enabled provider configurations from JSON files
   * @returns {Promise<Object[]>} Array of provider configuration objects, sorted by priority
   */
  static async loadProviders() {
    const providersDir = path.join(__dirname, '../../configurations/providers');
    const files = await fs.readdir(providersDir);
    
    const providers = [];
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(providersDir, file);
        const providerData = await fs.readJson(filePath);
        
        // Only load enabled providers
        if (providerData.enabled !== false) {
          providers.push(providerData);
        }
      }
    }
    
    // Sort by priority (lower number = higher priority)
    return providers.sort((a, b) => (a.priority || 999) - (b.priority || 999));
  }

  /**
   * Load a specific provider configuration by ID
   * @param {string} providerId - Provider identifier
   * @returns {Promise<Object>} Provider configuration object
   * @throws {Error} If provider is not found
   */
  static async loadProvider(providerId) {
    const providerPath = path.join(__dirname, '../../configurations/providers', `${providerId}.json`);
    
    if (await fs.pathExists(providerPath)) {
      return await fs.readJson(providerPath);
    }
    
    throw new Error(`Provider ${providerId} not found`);
  }
  /**
   * @param {Object} providerData - Provider configuration data
   * @param {import('../managers/StorageManager.js').StorageManager} cache - Storage manager instance for temporary cache
   * @param {import('../managers/StorageManager.js').StorageManager} data - Storage manager instance for persistent data storage
   * @param {string} [loggerContext] - Optional logger context override
   */
  constructor(providerData, cache, data, loggerContext = null) {
    this.providerData = providerData;
    this.cache = cache;
    this.data = data;
    this.providerId = providerData.id || 'default';

    // Create logger with custom context or default to provider type
    const context = loggerContext || `${providerData.type?.toUpperCase() || 'PROVIDER'}::${this.providerId}`;
    this.logger = createLogger(context);

    // Create rate limiter from provider config
    const rateConfig = providerData.api_rate || { concurrent: 1, duration_seconds: 1 };
    const concurrent = rateConfig.concurrent || rateConfig.concurrect || 1; // Handle typo "concurrect"
    const durationSeconds = rateConfig.duration_seconds || 1;
    
    // Use reservoir pattern for true rate limiting (N requests per duration_seconds)
    // This prevents bursts and ensures exactly N requests per time window
    this.limiter = new Bottleneck({
      reservoir: concurrent, // Number of requests allowed
      reservoirRefreshInterval: durationSeconds * 1000, // Refresh interval in ms
      reservoirRefreshAmount: concurrent, // How many requests to add back
      maxConcurrent: concurrent, // Max concurrent requests
      minTime: 0 // No minimum time between requests, reservoir handles it
    });
    
    this.logger.debug(`Rate limiter configured: ${concurrent} requests per ${durationSeconds} second(s)`);
    
    // Instance-level progress tracking: { 'movies': { count: 642, saveCallback: fn } }
    this._progressTracking = {};
    
    // Single progress interval per provider instance
    this._progressInterval = null;
  }

  /**
   * Start progress interval if not already running
   * @private
   */
  _startProgressInterval() {
    if (this._progressInterval) {
      return; // Already running
    }

    this._progressInterval = setInterval(() => {
      this._logProgress();
    }, 30000); // 30 seconds

    this.logger.debug('Progress interval started');
  }

  /**
   * Stop progress interval if running
   * @private
   */
  _stopProgressInterval() {
    if (this._progressInterval) {
      clearInterval(this._progressInterval);
      this._progressInterval = null;
      this.logger.debug('Progress interval stopped');
    }
  }

  /**
   * Log progress for all active types and trigger save callbacks
   * @private
   */
  _logProgress() {
    const activeTypes = Object.entries(this._progressTracking)
      .filter(([type, data]) => data.count > 0)
      .map(([type, data]) => `${type}: ${data.count}`);

    if (activeTypes.length > 0) {
      this.logger.info(`Progress update - ${activeTypes.join(', ')} title(s) remaining to process`);
      
      // Call save callbacks for each active type (every 30 seconds)
      Object.entries(this._progressTracking).forEach(([type, data]) => {
        if (data.count > 0 && data.saveCallback) {
          data.saveCallback();
        }
      });
    } else {
      // Stop interval if no active types
      this._stopProgressInterval();
    }
  }

  /**
   * Register a type for progress tracking
   * @param {string} type - Media type ('movies', 'tvshows', etc.)
   * @param {number} count - Initial remaining count
   * @param {Function} [saveCallback] - Optional callback to save accumulated titles
   */
  registerProgress(type, count, saveCallback = null) {
    this._progressTracking[type] = { count, saveCallback };
    if (count > 0) {
      this._startProgressInterval();
    }
  }

  /**
   * Update progress for a type
   * @param {string} type - Media type ('movies', 'tvshows', etc.)
   * @param {number} count - Updated remaining count
   */
  updateProgress(type, count) {
    if (this._progressTracking[type]) {
      this._progressTracking[type].count = count;
    }
    
    // Check if all types are done
    const allDone = Object.values(this._progressTracking).every(data => data.count === 0);
    if (allDone) {
      this._stopProgressInterval();
    }
  }

  /**
   * Unregister a type from progress tracking
   * @param {string} type - Media type ('movies', 'tvshows', etc.)
   */
  unregisterProgress(type) {
    // Call save callback one last time before unregistering
    const data = this._progressTracking[type];
    if (data && data.saveCallback) {
      data.saveCallback();
    }
    
    delete this._progressTracking[type];
    
    // Check if all types are done
    const allDone = Object.values(this._progressTracking).every(data => data.count === 0);
    if (allDone) {
      this._stopProgressInterval();
    }
  }

  /**
   * Fetch data from API with caching support
   * Checks cache first (file existence), then fetches from API if cache doesn't exist or forceRefresh is true
   * Cache expiration is handled by CachePurgeJob based on cache-policy.json
   * @param {string} url - API URL to fetch from
   * @param {string[]} cacheKeyParts - Cache key parts array (e.g., [providerId, 'metadata', 'movies.json'])
   * @param {number|null} [ttlHours=1] - TTL in hours (null for Infinity). Used to update cache policy.
   * @param {boolean} [forceRefresh=false] - Force refresh even if cache exists
   * @param {Object} [options] - Additional axios options (headers, etc.)
   * @returns {Promise<Object>} API response data
   */
  async fetchWithCache(url, cacheKeyParts, ttlHours = 1, forceRefresh = false, options = {}) {
    // Convert Infinity to null for JSON storage
    const ttl = ttlHours === Infinity ? null : ttlHours;

    // Check cache first (if file exists, it's valid - purge job handles expiration)
    if (!forceRefresh && cacheKeyParts.length > 0) {
      const cached = this.cache.get(...cacheKeyParts);
      if (cached) {
        this.logger.debug(`Loading from cache: ${cacheKeyParts.join('/')}`);
        return cached;
      }
    }

    this.logger.debug(`Fetching from API: ${url}`);
    // Wrap API call with rate limiter
    const response = await this.limiter.schedule(() => axios.get(url, options));
    
    if (cacheKeyParts.length > 0) {
      // Pass TTL to cache.set() to update policy file
      this.cache.set(response.data, ttl, ...cacheKeyParts);
    }

    return response.data;
  }
}
