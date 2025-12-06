import { BaseProvider } from './BaseProvider.js';
import { formatNumber } from '../utils/numberFormat.js';

/**
 * Base class for all IPTV providers (Xtream, AGTV)
 * Provides common functionality for accessing provider configurations and storage
 * Includes rate limiting per providerId
 * Provider configs are loaded once on startup and can be reloaded via reloadProviderConfigs()
 * @abstract
 * @extends {BaseProvider}
 */
export class BaseIPTVProvider extends BaseProvider {
  /**
   * @param {string} loggerName - Logger name (required)
   * @param {Object<string, Object>} providerConfigs - Map of provider ID to provider configuration
   * @param {string} [cacheDir] - Optional cache directory path (defaults to CACHE_DIR env var or '/app/cache')
   */
  constructor(loggerName, providerConfigs = {}, cacheDir = null) {
    super(loggerName, cacheDir);
    
    // Store provider configs as Map<providerId, config>
    // Filter out deleted providers
    this._providerConfigs = new Map();
    this._loadConfigs(providerConfigs);
    
    // Initialize cache directories for all providers
    for (const providerId of this._providerConfigs.keys()) {
      this.initialize(providerId);
    }
  }

  /**
   * Load provider configurations into internal map
   * @private
   * @param {Object<string, Object>} providerConfigs - Map of provider ID to provider configuration
   */
  _loadConfigs(providerConfigs) {
    this._providerConfigs.clear();
    
    for (const [providerId, config] of Object.entries(providerConfigs)) {
      // Only store non-deleted providers
      if (!config.deleted) {
        this._providerConfigs.set(providerId, config);
        
        // Create or update limiter for this provider
        const rateConfig = config.api_rate || { concurrent: 1, duration_seconds: 1 };
        this._getOrCreateLimiter(providerId, rateConfig);
      }
    }
    
    this.logger.debug(`Loaded ${formatNumber(this._providerConfigs.size)} provider config(s)`);
  }

  /**
   * Reload provider configurations
   * Called when providers are updated/created/deleted
   * @param {Object<string, Object>} providerConfigs - Map of provider ID to provider configuration
   */
  reloadProviderConfigs(providerConfigs) {
    // Get current provider IDs
    const currentProviderIds = new Set(this._providerConfigs.keys());
    
    // Load new configs
    this._loadConfigs(providerConfigs);
    
    // Remove limiters for providers that no longer exist or were deleted
    const newProviderIds = new Set(this._providerConfigs.keys());
    for (const providerId of currentProviderIds) {
      if (!newProviderIds.has(providerId)) {
        this._removeLimiter(providerId);
      }
    }
    
    // Initialize cache directories for newly added providers
    for (const providerId of newProviderIds) {
      if (!currentProviderIds.has(providerId)) {
        this.initialize(providerId);
      }
    }
    
    this.logger.debug(`Reloaded provider configs: ${formatNumber(this._providerConfigs.size)} provider(s)`);
  }

  /**
   * Get or create rate limiter for a provider
   * @protected
   * @param {string} providerId - Provider ID
   * @returns {Bottleneck} Rate limiter instance
   */
  _getLimiter(providerId) {
    // Get provider config to read rate limiting settings
    const provider = this._getProviderConfig(providerId);
    const rateConfig = provider.api_rate || { concurrent: 1, duration_seconds: 1 };
    
    return this._getOrCreateLimiter(providerId, rateConfig);
  }

  /**
   * HTTP request with caching and rate limiting (IPTV-specific override)
   * Automatically resolves per-provider limiter if not provided
   * @protected
   * @override
   * @param {Object} options - Request options (same as BaseProvider._httpRequest)
   * @returns {Promise<any>} Response data
   */
  async _httpRequest(options) {
    // Extract limiter based on providerId if not provided
    if (!options.limiter && options.providerId) {
      options.limiter = this._getLimiter(options.providerId);
    }
    
    // Call parent implementation with resolved limiter
    return super._httpRequest(options);
  }

  /**
   * Get provider configuration from internal map
   * @protected
   * @param {string} providerId - Provider ID
   * @returns {Object} Provider configuration
   */
  _getProviderConfig(providerId) {
    const provider = this._providerConfigs.get(providerId);
    
    if (!provider) {
      throw new Error(`Provider ${providerId} not found`);
    }
    
    if (provider.deleted) {
      throw new Error(`Provider ${providerId} is deleted`);
    }
    
    return provider;
  }

  /**
   * Fetch categories from provider
   * @param {string} providerId - Provider ID
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Promise<Array>} Array of category objects
   * @abstract
   */
  async fetchCategories(providerId, type) {
    return []
  }

  /**
   * Fetch metadata from provider
   * @param {string} providerId - Provider ID
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Promise<Array>} Array of title objects
   * @abstract
   */
  async fetchMetadata(providerId, type) {
    throw new Error('fetchMetadata() must be implemented by subclass');
  }

  /**
   * Fetch extended info from provider
   * @param {string} providerId - Provider ID
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @param {string} titleId - Title ID
   * @returns {Promise<Object>} Extended info object
   * @abstract
   */
  async fetchExtendedInfo(providerId, type, titleId) {
    throw new Error('fetchExtendedInfo() must be implemented by subclass');
  }

  /**
   * Fetch M3U8 content from provider
   * @param {string} providerId - Provider ID
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @param {number} [page] - Page number (for paginated types)
   * @returns {Promise<string>} M3U8 content as string
   * @abstract
   */
  async fetchM3U8(providerId, type, page = null) {
    throw new Error('fetchM3U8() must be implemented by subclass');
  }

  /**
   * Fetch live TV channels from provider
   * @param {string} providerId - Provider ID
   * @returns {Promise<Array>} Array of channel objects with uniform structure:
   *   - provider_id: string
   *   - channel_id: string
   *   - channel_key: string (format: "live-{providerId}-{channelId}")
   *   - name: string
   *   - url: string
   *   - tvg_id: string | null
   *   - tvg_name: string | null
   *   - tvg_logo: string | null
   *   - group_title: string | null
   *   - duration: number
   *   - createdAt: Date
   *   - lastUpdated: Date
   * @abstract
   */
  async fetchLiveChannels(providerId) {
    throw new Error('fetchLiveChannels() must be implemented by subclass');
  }
}

