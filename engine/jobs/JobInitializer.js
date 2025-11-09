import { StorageManager } from '../managers/StorageManager.js';
import { BaseProvider } from '../providers/BaseProvider.js';
import { AGTVProvider } from '../providers/AGTVProvider.js';
import { XtreamProvider } from '../providers/XtreamProvider.js';
import { TMDBProvider } from '../providers/TMDBProvider.js';
import { createLogger } from '../utils/logger.js';
import MongoClientUtil from '../utils/mongo-client.js';
import { MongoDataService } from '../services/MongoDataService.js';

/**
 * Job Initializer
 * Handles initialization of all dependencies required by jobs:
 * - Cache and data storage managers
 * - IPTV provider instances
 * - TMDB provider singleton
 */
export class JobInitializer {
  /**
   * @param {string} cacheDir - Directory path for cache storage
   * @param {string} dataDir - Directory path for data storage
   */
  constructor(cacheDir, dataDir) {
    this.cacheDir = cacheDir;
    this.dataDir = dataDir;
    this.cache = null;
    this.data = null;
    this.mongoClient = null;
    this.mongoData = null;
    this.providers = null; // Map<string, BaseIPTVProvider>
    this.tmdbProvider = null;
    this.logger = createLogger('JobInitializer');
  }

  /**
   * Initialize all dependencies
   * @returns {Promise<{cache: StorageManager, data: StorageManager, mongoData: MongoDataService, providers: Map<string, BaseIPTVProvider>, tmdbProvider: TMDBProvider}>} Initialized dependencies
   */
  async initialize() {
    this.logger.info('Initializing job dependencies...');

    // Initialize MongoDB connection
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
    const dbName = process.env.MONGODB_DB_NAME || 'playarr';
    
    try {
      this.mongoClient = new MongoClientUtil(mongoUri, dbName);
      await this.mongoClient.connect();
      this.mongoData = new MongoDataService(this.mongoClient);
      this.logger.info('✓ MongoDB connection initialized');
    } catch (error) {
      this.logger.error(`✗ Failed to connect to MongoDB: ${error.message}`);
      this.logger.error('MongoDB is required. Please ensure MongoDB is running and MONGODB_URI is configured correctly.');
      throw new Error(`MongoDB connection failed: ${error.message}`);
    }

    // Initialize storage managers (cache directory remains file-based)
    this.cache = new StorageManager(this.cacheDir, false); // false = wrapData, saves raw API response without wrapper
    this.data = new StorageManager(this.dataDir, false); // false = wrapData, saves directly without wrapper (for backward compatibility, but not used for data)
    this.logger.info('✓ Storage managers initialized');

    // Initialize IPTV providers
    this.providers = new Map();
    const providerConfigs = await BaseProvider.loadProviders(this.mongoData);
    this.logger.info(`Found ${providerConfigs.length} enabled provider(s)`);

    for (const providerData of providerConfigs) {
      try {
        const instance = this._createProviderInstance(providerData);
        this.providers.set(providerData.id, instance);
        this.logger.info(`✓ Loaded provider: ${providerData.id} (${providerData.type})`);
      } catch (error) {
        this.logger.error(`✗ Failed to load provider ${providerData.id}: ${error.message}`);
      }
    }

    if (this.providers.size === 0) {
      this.logger.warn('No providers were successfully loaded');
    }

    // Initialize TMDB provider (singleton)
    this.tmdbProvider = TMDBProvider.getInstance(this.cache, this.data, this.mongoData);
    this.logger.info('✓ TMDB provider initialized');

    this.logger.info('Job dependencies initialization completed');

    return {
      cache: this.cache,
      data: this.data,
      mongoData: this.mongoData,
      providers: this.providers,
      tmdbProvider: this.tmdbProvider
    };
  }

  /**
   * Create a provider instance based on type
   * @private
   * @param {Object} providerData - Provider configuration data
   * @returns {import('../providers/BaseIPTVProvider.js').BaseIPTVProvider} Provider instance (AGTVProvider or XtreamProvider)
   */
  _createProviderInstance(providerData) {
    if (providerData.type === 'agtv') {
      return new AGTVProvider(providerData, this.cache, this.data, this.mongoData);
    } else if (providerData.type === 'xtream') {
      return new XtreamProvider(providerData, this.cache, this.data, this.mongoData);
    } else {
      throw new Error(`Unknown provider type: ${providerData.type}`);
    }
  }

  /**
   * Get initialized dependencies
   * @returns {{cache: StorageManager, data: StorageManager, mongoData: MongoDataService, providers: Map<string, BaseIPTVProvider>, tmdbProvider: TMDBProvider}} Initialized dependencies
   * @throws {Error} If dependencies are not initialized
   */
  getDependencies() {
    if (!this.cache || !this.data || !this.mongoData || !this.providers || !this.tmdbProvider) {
      throw new Error('Dependencies not initialized. Call initialize() first.');
    }

    return {
      cache: this.cache,
      data: this.data,
      mongoData: this.mongoData,
      providers: this.providers,
      tmdbProvider: this.tmdbProvider
    };
  }
}

