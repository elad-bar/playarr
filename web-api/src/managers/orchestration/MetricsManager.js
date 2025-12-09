import { BaseManager } from '../BaseManager.js';
import { Registry, Counter, Gauge, Histogram } from 'prom-client';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const metricsConfig = JSON.parse(readFileSync(join(__dirname, '../../metrics.json'), 'utf-8'));

/**
 * Metrics Manager (Type D: Orchestration Manager)
 * Coordinates metrics collection across multiple domains
 * Provides Prometheus metrics collection and reporting
 */
export class MetricsManager extends BaseManager {
  /**
   * @param {import('../domain/ProviderTitlesManager.js').ProviderTitlesManager} providerTitlesManager - Provider titles manager
   * @param {import('../domain/TitlesManager.js').TitlesManager} titlesManager - Titles manager
   * @param {import('../domain/ChannelManager.js').ChannelManager} channelManager - Channel manager
   * @param {import('../domain/UserManager.js').UserManager} userManager - User manager
   * @param {import('../domain/IPTVProviderManager.js').IPTVProviderManager} iptvProviderManager - IPTV Provider manager
   * @param {import('../domain/SettingsManager.js').SettingsManager} settingsManager - Settings manager
   */
  constructor(providerTitlesManager, titlesManager, channelManager, userManager, iptvProviderManager, settingsManager) {
    super('MetricsManager');
    
    this.providerTitlesManager = providerTitlesManager;
    this.titlesManager = titlesManager;
    this.channelManager = channelManager;
    this.userManager = userManager;
    this.iptvProviderManager = iptvProviderManager;
    this._settingsManager = settingsManager;
    
    this.register = new Registry();
    this._metrics = new Map(); // Store all metric instances
    this._metricsToken = null; // Store metrics token for validation
    
    // Metric type mapping
    this._metricTypes = {
      'counter': Counter,
      'gauge': Gauge,
      'histogram': Histogram
    };
    
    this._initializeMetrics();
  }

  /**
   * Initialize MetricsManager by generating/loading metrics token
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      const metricsToken = await this._settingsManager.getSetting('metrics_token');
      if (!metricsToken.value) {
        // Generate new token if it doesn't exist
        const crypto = await import('crypto');
        const newToken = crypto.randomBytes(32).toString('hex');
        await this._settingsManager.setSetting('metrics_token', newToken);
        this._metricsToken = newToken;
        this.logger.info('Generated new metrics token');
      } else {
        this._metricsToken = metricsToken.value;
        this.logger.debug('Loaded existing metrics token from settings');
      }
    } catch (error) {
      this.logger.warn(`Could not check/generate metrics token: ${error.message}`);
    }
  }

  /**
   * Validate a metrics token
   * @param {string} token - Token to validate
   * @returns {boolean} True if token is valid
   */
  validateToken(token) {
    if (!this._metricsToken) {
      return false;
    }
    return token === this._metricsToken;
  }

  /**
   * Initialize all Prometheus metrics from metrics.json
   * @private
   */
  _initializeMetrics() {
    const metrics = metricsConfig.metrics || {};
    
    for (const [key, config] of Object.entries(metrics)) {
      const MetricClass = this._metricTypes[config.type];
      
      if (!MetricClass) {
        this.logger.warn(`Unknown metric type: ${config.type} for ${key}`);
        continue;
      }

      const options = {
        name: config.name,
        help: config.help,
        labelNames: config.labelNames || [],
        registers: [this.register]
      };

      // Add buckets for histograms
      if (config.type === 'histogram' && config.buckets) {
        options.buckets = config.buckets;
      }

      // Create metric instance using the mapped class
      const metric = new MetricClass(options);
      this._metrics.set(key, metric);
    }

    this.logger.info(`Metrics manager initialized with ${this._metrics.size} metrics`);
  }

  /**
   * Get all metrics in Prometheus format
   * @returns {Promise<string>} Prometheus metrics as text
   */
  async getMetrics() {
    return await this.register.metrics();
  }

  /**
   * Get all metrics in JSON format
   * @returns {Promise<Object>} Prometheus metrics as JSON object
   */
  async getMetricsAsJSON() {
    return await this.register.getMetricsAsJSON();
  }

  /**
   * Increment a counter metric
   * @param {string} metricName - Name of the counter metric
   * @param {Object} labels - Label values object
   * @param {number} [value=1] - Value to increment by
   */
  incrementCounter(metricName, labels, value = 1) {
    const metric = this._metrics.get(metricName);
    if (metric && metric instanceof Counter) {
      metric.inc(labels, value);
    } else {
      this.logger.warn(`Counter metric '${metricName}' not found`);
    }
  }

  /**
   * Observe a histogram metric
   * @param {string} metricName - Name of the histogram metric
   * @param {Object} labels - Label values object
   * @param {number} value - Value to observe
   */
  observeHistogram(metricName, labels, value) {
    const metric = this._metrics.get(metricName);
    if (metric && metric instanceof Histogram) {
      metric.observe(labels, value);
    } else {
      this.logger.warn(`Histogram metric '${metricName}' not found`);
    }
  }

  /**
   * Set a gauge metric value
   * @param {string} metricName - Name of the gauge metric
   * @param {Object} labels - Label values object
   * @param {number} value - Value to set
   */
  setGauge(metricName, labels, value) {
    const metric = this._metrics.get(metricName);
    if (metric && metric instanceof Gauge) {
      metric.set(labels, value);
    } else {
      this.logger.warn(`Gauge metric '${metricName}' not found`);
    }
  }

  /**
   * Reset a gauge metric
   * @param {string} metricName - Name of the gauge metric
   */
  resetGauge(metricName) {
    const metric = this._metrics.get(metricName);
    if (metric && metric instanceof Gauge) {
      metric.reset();
    } else {
      this.logger.warn(`Gauge metric '${metricName}' not found`);
    }
  }

  /**
   * Update all gauge metrics with current database counts
   * Uses managers injected via constructor
   */
  async updateGaugeMetrics() {
    try {
      this.logger.debug('Updating gauge metrics...');

      // Reset all gauges to 0 first
      const metrics = metricsConfig.metrics || {};
      for (const [key, config] of Object.entries(metrics)) {
        if (config.type === 'gauge') {
          this.resetGauge(key);
        }
      }

      // 1. Provider titles count per provider, per media type
      const providerTitlesCounts = await this.providerTitlesManager.getCountByProviderAndType();
      for (const item of providerTitlesCounts) {
        this.setGauge('provider_titles_count', {
          provider_id: item.provider_id,
          media_type: item.media_type
        }, item.count);
      }

      // 1a. Ignored provider titles count per provider, per media type
      const ignoredTitlesCounts = await this.providerTitlesManager.getIgnoredCountByProviderAndType();
      for (const item of ignoredTitlesCounts) {
        this.setGauge('ignored_provider_titles_count', {
          provider_id: item.provider_id,
          media_type: item.media_type
        }, item.count);
      }

      // 2. Main titles count per media type
      const mainTitlesCounts = await this.titlesManager.getCountByType();
      for (const item of mainTitlesCounts) {
        this.setGauge('main_titles_count', {
          media_type: item.media_type
        }, item.count);
      }

      // 3. Episodes count per source
      const episodesCounts = await this.titlesManager.getEpisodesCountBySource();
      for (const item of episodesCounts) {
        this.setGauge('episodes_count', {
          source: item.source
        }, item.count);
      }

      // 4. Channels count per provider, per category
      const channelsCounts = await this.channelManager.getCountByProviderAndCategory();
      for (const item of channelsCounts) {
        this.setGauge('channels_count', {
          provider_id: item.provider_id,
          category: item.category
        }, item.count);
      }

      // 5. Watchlist titles count per user, per media type
      const watchlistTitlesCounts = await this.userManager.getWatchlistTitlesCountByUserAndType();
      for (const item of watchlistTitlesCounts) {
        this.setGauge('watchlist_titles_count', {
          user: item.user,
          media_type: item.media_type
        }, item.count);
      }

      // 6. Watchlist channels count per user
      const watchlistChannelsCounts = await this.userManager.getWatchlistChannelsCountByUser();
      for (const item of watchlistChannelsCounts) {
        this.setGauge('watchlist_channels_count', {
          user: item.user
        }, item.count);
      }

      // 7. Active users (users with API key)
      const activeUsersCount = await this.userManager.getActiveUsersCount();
      this.setGauge('active_users', {}, activeUsersCount);

      // 8. Provider connection metrics (active_connections, max_connections, active status, expiration_days)
      const providerConnectionMetrics = await this.iptvProviderManager.getProviderConnectionMetrics();
      const now = Date.now();
      for (const item of providerConnectionMetrics) {
        const providerId = item.provider_id || 'unknown';
        
        if (item.active_connections !== undefined && item.active_connections !== null) {
          this.setGauge('provider_active_connections', { provider_id: providerId }, item.active_connections);
        }
        
        if (item.max_connections !== undefined && item.max_connections !== null) {
          this.setGauge('provider_max_connections', { provider_id: providerId }, item.max_connections);
        }
        
        if (item.active !== undefined && item.active !== null) {
          this.setGauge('provider_active', { provider_id: providerId }, item.active ? 1 : 0);
        }
        
        // Calculate and update expiration days
        const expirationDate = item.expiration_date;
        if (expirationDate !== null && expirationDate !== undefined) {
          const expirationTimestamp = expirationDate * 1000; // Convert to milliseconds
          const daysUntilExpiration = Math.floor((expirationTimestamp - now) / (1000 * 60 * 60 * 24));
          this.setGauge('provider_expiration_days', { provider_id: providerId }, daysUntilExpiration);
        } else {
          // Set to sentinel value to indicate no expiration date
          this.setGauge('provider_expiration_days', { provider_id: providerId }, -999999);
        }
      }

      this.logger.info('Gauge metrics updated successfully');
    } catch (error) {
      this.logger.error('Error updating gauge metrics:', error);
      // Don't throw - metrics update failure shouldn't break the app
    }
  }

  /**
   * Get provider counts (movies, tvshows, live) from cached metrics
   * @param {string} providerId - Provider ID
   * @returns {Promise<{movies: number, tvshows: number, live: number}>} Provider counts by media type
   */
  async getProviderCounts(providerId) {
    try {
      const metrics = await this.getMetricsAsJSON();
      
      // Initialize counts
      const counts = {
        movies: 0,
        tvshows: 0,
        live: 0
      };

      // Get provider titles count (movies and tvshows)
      const providerTitlesMetric = metrics.find(m => m.name === 'playarr_provider_titles_count');
      if (providerTitlesMetric && providerTitlesMetric.values) {
        for (const value of providerTitlesMetric.values) {
          if (value.labels && value.labels.provider_id === providerId) {
            const mediaType = value.labels.media_type;
            if (mediaType === 'movies') {
              counts.movies = value.value || 0;
            } else if (mediaType === 'tvshows') {
              counts.tvshows = value.value || 0;
            }
          }
        }
      }

      // Get channels count (live TV)
      const channelsMetric = metrics.find(m => m.name === 'playarr_channels_count');
      if (channelsMetric && channelsMetric.values) {
        for (const value of channelsMetric.values) {
          if (value.labels && value.labels.provider_id === providerId) {
            counts.live += value.value || 0;
          }
        }
      }

      return counts;
    } catch (error) {
      this.logger.error(`Error getting provider counts for ${providerId}:`, error);
      // Return zero counts on error
      return {
        movies: 0,
        tvshows: 0,
        live: 0
      };
    }
  }

  /**
   * Reset all metrics (useful for testing)
   * @private
   */
  reset() {
    this.register.resetMetrics();
  }
}

export default MetricsManager;

