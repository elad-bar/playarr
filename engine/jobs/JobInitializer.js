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
 * - Cache storage manager
 * - IPTV provider instances
 * - TMDB provider singleton
 */
export class JobInitializer {
  /**
   * @param {string} cacheDir - Directory path for cache storage
   */
  constructor(cacheDir) {
    this.cacheDir = cacheDir;
    this.cache = null;
    this.mongoClient = null;
    this.mongoData = null;
    this.providers = null; // Map<string, BaseIPTVProvider>
    this.tmdbProvider = null;
    this.logger = createLogger('JobInitializer');
  }

  /**
   * Initialize all dependencies
   * @returns {Promise<{cache: StorageManager, mongoData: MongoDataService, providers: Map<string, BaseIPTVProvider>, tmdbProvider: TMDBProvider}>} Initialized dependencies
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

    // Initialize storage manager (cache directory remains file-based)
    this.cache = new StorageManager(this.cacheDir, false, this.mongoData); // false = wrapData, saves raw API response without wrapper
    
    // Initialize cache policies (load once from MongoDB)
    await this.cache.initialize();
    
    this.logger.info('✓ Storage manager initialized');

    // Load settings from MongoDB (generic, for all components)
    let settings = {};
    try {
      settings = await this.mongoData.getSettings();
      this.logger.info('✓ Settings loaded from MongoDB');
    } catch (error) {
      this.logger.warn(`Failed to load settings from MongoDB: ${error.message}`);
    }

    // Initialize IPTV providers
    this.providers = new Map();
    const providerConfigs = await BaseProvider.loadProviders(this.mongoData);
    this.logger.info(`Found ${providerConfigs.length} enabled provider(s)`);

    for (const providerData of providerConfigs) {
      try {
        const instance = this._createProviderInstance(providerData);
        
        // Initialize cache policies for this provider
        await instance.initializeCachePolicies();
        
        this.providers.set(providerData.id, instance);
        this.logger.info(`✓ Loaded provider: ${providerData.id} (${providerData.type})`);
      } catch (error) {
        this.logger.error(`✗ Failed to load provider ${providerData.id}: ${error.message}`);
      }
    }

    if (this.providers.size === 0) {
      this.logger.warn('No providers were successfully loaded');
    }

    // Initialize TMDB provider (singleton) - now async and requires settings
    this.tmdbProvider = await TMDBProvider.getInstance(this.cache, this.mongoData, settings);
    this.logger.info('✓ TMDB provider initialized');

    this.logger.info('Job dependencies initialization completed');

    return {
      cache: this.cache,
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
      return new AGTVProvider(providerData, this.cache, this.mongoData);
    } else if (providerData.type === 'xtream') {
      return new XtreamProvider(providerData, this.cache, this.mongoData);
    } else {
      throw new Error(`Unknown provider type: ${providerData.type}`);
    }
  }

  /**
   * Get initialized dependencies
   * @returns {{cache: StorageManager, mongoData: MongoDataService, providers: Map<string, BaseIPTVProvider>, tmdbProvider: TMDBProvider}} Initialized dependencies
   * @throws {Error} If dependencies are not initialized
   */
  getDependencies() {
    if (!this.cache || !this.mongoData || !this.providers || !this.tmdbProvider) {
      throw new Error('Dependencies not initialized. Call initialize() first.');
    }

    return {
      cache: this.cache,
      mongoData: this.mongoData,
      providers: this.providers,
      tmdbProvider: this.tmdbProvider
    };
  }
}

