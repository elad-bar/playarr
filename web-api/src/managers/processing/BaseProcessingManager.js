import { createLogger } from '../utils/logger.js';
import Bottleneck from 'bottleneck';

/**
 * Base class for all processing managers (IPTV, TMDB, etc.)
 * Provides generic functionality for rate limiting and progress tracking
 * @abstract
 */
export class BaseProcessingManager {
  /**
   * Load all provider configurations from MongoDB (non-deleted only)
   * @param {import('../domain/IPTVProviderManager.js').IPTVProviderManager} iptvProviderManager - IPTV Provider manager
   * @returns {Promise<Object[]>} Array of provider configuration objects, sorted by priority
   */
  static async loadProviders(iptvProviderManager) {
    if (!iptvProviderManager) {
      const logger = createLogger('BaseProcessingManager');
      logger.error('IPTVProviderManager is required to load providers');
      throw new Error('IPTVProviderManager is required');
    }

    try {
      // Query all non-deleted providers from MongoDB, sorted by priority
      const providers = await iptvProviderManager.findByQuery({ deleted: { $ne: true } }, { sort: { priority: 1 } });
      
      // Sort by priority (lower number = higher priority)
      return providers.sort((a, b) => (a.priority || 999) - (b.priority || 999));
    } catch (error) {
      const logger = createLogger('BaseProcessingManager');
      logger.error(`Error loading providers from MongoDB: ${error.message}`);
      throw error;
    }
  }

  /**
   * @param {Object} providerData - Provider configuration data
   * @param {string} loggerContext - Logger context override
   */
  constructor(providerData, loggerContext) {
    this.providerData = providerData;
    this.providerId = providerData.id || 'default';

    // Create logger with provided context
    this.logger = createLogger(loggerContext);

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
    
    // Single progress interval per handler instance
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
}

