import { StorageManager } from '../managers/StorageManager.js';
import { BaseProvider } from '../providers/BaseProvider.js';
import { AGTVProvider } from '../providers/AGTVProvider.js';
import { XtreamProvider } from '../providers/XtreamProvider.js';
import { TMDBProvider } from '../providers/TMDBProvider.js';
import { createLogger } from '../utils/logger.js';
import MongoClientUtil from '../utils/mongo-client.js';
import { MongoDataService } from '../services/MongoDataService.js';

/**
 * Application Context Singleton
 * Centralized initialization and access to all application dependencies
 * Provides a single source of truth for MongoDB, Cache, TMDBProvider, and IPTV Providers
 */
export class ApplicationContext {
  static instance = null;

  /**
   * Get the singleton instance
   * @returns {ApplicationContext} The singleton instance
   * @throws {Error} If context is not initialized
   */
  static getInstance() {
    if (!ApplicationContext.instance) {
      throw new Error('ApplicationContext not initialized. Call initialize() first.');
    }
    return ApplicationContext.instance;
  }

  /**
   * Initialize the application context
   * Initializes all dependencies in the correct order:
   * 1. MongoDB connection
   * 2. StorageManager (cache)
   * 3. Settings from MongoDB
   * 4. TMDBProvider
   * 5. IPTV Providers
   * 
   * @param {string} cacheDir - Directory path for cache storage
   * @returns {Promise<ApplicationContext>} The initialized context instance
   */
  static async initialize(cacheDir) {
    if (ApplicationContext.instance) {
      // Already initialized, return existing instance
      return ApplicationContext.instance;
    }

    const logger = createLogger('ApplicationContext');
    logger.debug('Initializing application context...');

    const context = new ApplicationContext();
    ApplicationContext.instance = context;
    context.logger = logger;

    // 1. Initialize MongoDB connection
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
    const dbName = process.env.MONGODB_DB_NAME || 'playarr';
    
    try {
      context.mongoClient = new MongoClientUtil(mongoUri, dbName);
      await context.mongoClient.connect();
      context.mongoData = new MongoDataService(context.mongoClient);
      logger.debug('✓ MongoDB connection initialized');
    } catch (error) {
      logger.error(`✗ Failed to connect to MongoDB: ${error.message}`);
      logger.error('MongoDB is required. Please ensure MongoDB is running and MONGODB_URI is configured correctly.');
      ApplicationContext.instance = null;
      throw new Error(`MongoDB connection failed: ${error.message}`);
    }

    // 2. Initialize storage manager (cache)
    context.cache = new StorageManager(cacheDir, false, context.mongoData);
    await context.cache.initialize();
    logger.debug('✓ Storage manager initialized');

    // 3. Load settings from MongoDB
    let settings = {};
    try {
      settings = await context.mongoData.getSettings();
      logger.debug('✓ Settings loaded from MongoDB');
    } catch (error) {
      logger.warn(`Failed to load settings from MongoDB: ${error.message}`);
    }

    // 4. Initialize TMDB provider (must be done before creating IPTV providers)
    context.tmdbProvider = await TMDBProvider.getInstance(
      context.cache,
      context.mongoData,
      settings
    );
    logger.debug('✓ TMDB provider initialized');

    // 5. Load and initialize IPTV providers
    context.providers = new Map();
    const providerConfigs = await BaseProvider.loadProviders(context.mongoData);
    logger.debug(`Found ${providerConfigs.length} enabled provider(s)`);

    for (const providerData of providerConfigs) {
      try {
        const instance = context._createProviderInstance(providerData);
        
        // Initialize cache policies for this provider
        await instance.initializeCachePolicies();
        
        context.providers.set(providerData.id, instance);
        logger.debug(`✓ Loaded provider: ${providerData.id} (${providerData.type})`);
      } catch (error) {
        logger.error(`✗ Failed to load provider ${providerData.id}: ${error.message}`);
      }
    }

    if (context.providers.size === 0) {
      logger.warn('No providers were successfully loaded');
    }

    logger.debug('Application context initialization completed');
    return context;
  }

  /**
   * Get MongoDB data service
   * @returns {import('../services/MongoDataService.js').MongoDataService} MongoDB data service
   */
  getMongoData() {
    return this.mongoData;
  }

  /**
   * Get cache storage manager
   * @returns {import('../managers/StorageManager.js').StorageManager} Cache storage manager
   */
  getCache() {
    return this.cache;
  }

  /**
   * Get TMDB provider instance
   * @returns {import('../providers/TMDBProvider.js').TMDBProvider} TMDB provider instance
   */
  getTMDBProvider() {
    return this.tmdbProvider;
  }

  /**
   * Get IPTV providers map
   * @returns {Map<string, import('../providers/BaseIPTVProvider.js').BaseIPTVProvider>} Map of provider ID to provider instance
   */
  getProviders() {
    return this.providers;
  }

  /**
   * Set current job data for a running job
   * Used when worker: false to pass data to worker functions (since workerData is not supported)
   * @param {string} jobName - Name of the job
   * @param {Object} data - Data to store for this job
   */
  setCurrentJobData(jobName, data) {
    if (!this._currentJobData) {
      this._currentJobData = new Map();
    }
    this._currentJobData.set(jobName, data);
  }

  /**
   * Get current job data for a running job
   * Used when worker: false to retrieve data in worker functions
   * @param {string} jobName - Name of the job
   * @returns {Object|null} Stored data for this job, or null if not found
   */
  getCurrentJobData(jobName) {
    return this._currentJobData?.get(jobName) || null;
  }

  /**
   * Clear current job data for a completed job
   * @param {string} jobName - Name of the job
   */
  clearCurrentJobData(jobName) {
    this._currentJobData?.delete(jobName);
  }

  /**
   * Create a provider instance based on type
   * @private
   * @param {Object} providerData - Provider configuration data
   * @returns {import('../providers/BaseIPTVProvider.js').BaseIPTVProvider} Provider instance (AGTVProvider or XtreamProvider)
   */
  _createProviderInstance(providerData) {
    if (providerData.type === 'agtv') {
      return new AGTVProvider(
        providerData,
        this.cache,
        this.cache,
        this.mongoData,
        this.tmdbProvider
      );
    } else if (providerData.type === 'xtream') {
      return new XtreamProvider(
        providerData,
        this.cache,
        this.cache,
        this.mongoData,
        this.tmdbProvider
      );
    } else {
      throw new Error(`Unknown provider type: ${providerData.type}`);
    }
  }
}

