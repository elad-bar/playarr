import { StorageManager } from '../managers/StorageManager.js';
import { BaseProvider } from '../providers/BaseProvider.js';
import { AGTVProvider } from '../providers/AGTVProvider.js';
import { XtreamProvider } from '../providers/XtreamProvider.js';
import { TMDBProvider } from '../providers/TMDBProvider.js';
import { createLogger } from '../utils/logger.js';
import MongoClientUtil from '../utils/mongo-client.js';
import { MongoDataService } from '../services/MongoDataService.js';

/**
 * Static Provider Initializer
 * Singleton pattern for initializing and retrieving providers
 * Prevents redundant initialization within the same execution context (worker thread)
 */
export class ProviderInitializer {
  // Static singleton instance
  static instance = null;
  static cache = null;
  static mongoClient = null;
  static mongoData = null;
  static providers = null; // Map<string, BaseIPTVProvider>
  static loadedProviders = null; // Map<string, { lastUpdated: Date }> - Track loaded providers with timestamps
  static tmdbProvider = null;
  static logger = createLogger('ProviderInitializer');
  static initialized = false;

  /**
   * Initialize providers (singleton - only initializes once)
   * @param {string} cacheDir - Directory path for cache storage
   * @returns {Promise<void>}
   */
  static async initialize(cacheDir) {
    // If already initialized, skip
    if (ProviderInitializer.initialized) {
      ProviderInitializer.logger.debug('Providers already initialized, skipping...');
      return;
    }

    ProviderInitializer.logger.info('Initializing providers...');

    // Initialize MongoDB connection
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
    const dbName = process.env.MONGODB_DB_NAME || 'playarr';
    
    try {
      ProviderInitializer.mongoClient = new MongoClientUtil(mongoUri, dbName);
      await ProviderInitializer.mongoClient.connect();
      ProviderInitializer.mongoData = new MongoDataService(ProviderInitializer.mongoClient);
      ProviderInitializer.logger.info('✓ MongoDB connection initialized');
    } catch (error) {
      ProviderInitializer.logger.error(`✗ Failed to connect to MongoDB: ${error.message}`);
      ProviderInitializer.logger.error('MongoDB is required. Please ensure MongoDB is running and MONGODB_URI is configured correctly.');
      throw new Error(`MongoDB connection failed: ${error.message}`);
    }

    // Initialize storage manager (cache directory remains file-based)
    ProviderInitializer.cache = new StorageManager(cacheDir, false, ProviderInitializer.mongoData);
    
    // Initialize cache policies (load once from MongoDB)
    await ProviderInitializer.cache.initialize();
    
    ProviderInitializer.logger.info('✓ Storage manager initialized');

    // Load settings from MongoDB (generic, for all components)
    let settings = {};
    try {
      settings = await ProviderInitializer.mongoData.getSettings();
      ProviderInitializer.logger.info('✓ Settings loaded from MongoDB');
    } catch (error) {
      ProviderInitializer.logger.warn(`Failed to load settings from MongoDB: ${error.message}`);
    }

    // Initialize IPTV providers
    ProviderInitializer.providers = new Map();
    ProviderInitializer.loadedProviders = new Map();
    const providerConfigs = await BaseProvider.loadProviders(ProviderInitializer.mongoData);
    ProviderInitializer.logger.info(`Found ${providerConfigs.length} enabled provider(s)`);

    for (const providerData of providerConfigs) {
      try {
        const instance = ProviderInitializer._createProviderInstance(providerData);
        
        // Initialize cache policies for this provider
        await instance.initializeCachePolicies();
        
        ProviderInitializer.providers.set(providerData.id, instance);
        ProviderInitializer.loadedProviders.set(providerData.id, {
          lastUpdated: providerData.lastUpdated ? new Date(providerData.lastUpdated) : new Date()
        });
        ProviderInitializer.logger.info(`✓ Loaded provider: ${providerData.id} (${providerData.type})`);
      } catch (error) {
        ProviderInitializer.logger.error(`✗ Failed to load provider ${providerData.id}: ${error.message}`);
      }
    }

    if (ProviderInitializer.providers.size === 0) {
      ProviderInitializer.logger.warn('No providers were successfully loaded');
    }

    // Initialize TMDB provider (singleton) - now async and requires settings
    ProviderInitializer.tmdbProvider = await TMDBProvider.getInstance(
      ProviderInitializer.cache,
      ProviderInitializer.mongoData,
      settings
    );
    ProviderInitializer.logger.info('✓ TMDB provider initialized');

    ProviderInitializer.initialized = true;
    ProviderInitializer.logger.info('Provider initialization completed');
  }

  /**
   * Get initialized IPTV providers
   * @returns {Map<string, import('../providers/BaseIPTVProvider.js').BaseIPTVProvider>} Map of provider ID to provider instance
   * @throws {Error} If providers are not initialized
   */
  static getProviders() {
    if (!ProviderInitializer.initialized || !ProviderInitializer.providers) {
      throw new Error('Providers not initialized. Call initialize() first.');
    }
    return ProviderInitializer.providers;
  }

  /**
   * Get initialized TMDB provider
   * @returns {import('../providers/TMDBProvider.js').TMDBProvider} TMDB provider instance
   * @throws {Error} If TMDB provider is not initialized
   */
  static getTMDBProvider() {
    if (!ProviderInitializer.initialized || !ProviderInitializer.tmdbProvider) {
      throw new Error('TMDB provider not initialized. Call initialize() first.');
    }
    return ProviderInitializer.tmdbProvider;
  }

  /**
   * Get initialized cache storage manager
   * @returns {import('../managers/StorageManager.js').StorageManager} Cache storage manager
   * @throws {Error} If not initialized
   */
  static getCache() {
    if (!ProviderInitializer.initialized || !ProviderInitializer.cache) {
      throw new Error('Cache not initialized. Call initialize() first.');
    }
    return ProviderInitializer.cache;
  }


  /**
   * Get initialized MongoDB data service
   * @returns {import('../services/MongoDataService.js').MongoDataService} MongoDB data service
   * @throws {Error} If not initialized
   */
  static getMongoData() {
    if (!ProviderInitializer.initialized || !ProviderInitializer.mongoData) {
      throw new Error('MongoDB data service not initialized. Call initialize() first.');
    }
    return ProviderInitializer.mongoData;
  }

  /**
   * Reload a provider by ID
   * @param {string} providerId - Provider ID to reload
   * @returns {Promise<void>}
   */
  static async reloadProvider(providerId) {
    if (!ProviderInitializer.initialized) {
      throw new Error('ProviderInitializer not initialized. Call initialize() first.');
    }

    try {
      // Load provider config from MongoDB
      const provider = await ProviderInitializer.mongoData.db.collection('iptv_providers')
        .findOne({ id: providerId });

      if (!provider) {
        ProviderInitializer.logger.warn(`Provider ${providerId} not found in MongoDB`);
        return;
      }

      // Check if provider should be loaded (enabled and not deleted)
      if (provider.enabled !== true || provider.deleted === true) {
        ProviderInitializer.logger.info(`Provider ${providerId} is disabled or deleted, removing from engine`);
        await ProviderInitializer.removeProvider(providerId);
        return;
      }

      // Create new instance
      const instance = ProviderInitializer._createProviderInstance(provider);
      
      // Initialize cache policies
      await instance.initializeCachePolicies();
      
      // Replace in providers Map
      ProviderInitializer.providers.set(providerId, instance);
      ProviderInitializer.loadedProviders.set(providerId, {
        lastUpdated: provider.lastUpdated ? new Date(provider.lastUpdated) : new Date()
      });
      
      ProviderInitializer.logger.info(`✓ Reloaded provider: ${providerId}`);
    } catch (error) {
      ProviderInitializer.logger.error(`✗ Failed to reload provider ${providerId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Remove a provider from the engine
   * @param {string} providerId - Provider ID to remove
   * @returns {Promise<void>}
   */
  static async removeProvider(providerId) {
    if (!ProviderInitializer.initialized) {
      throw new Error('ProviderInitializer not initialized. Call initialize() first.');
    }

    if (ProviderInitializer.providers.has(providerId)) {
      ProviderInitializer.providers.delete(providerId);
      ProviderInitializer.loadedProviders.delete(providerId);
      ProviderInitializer.logger.info(`✓ Removed provider: ${providerId}`);
    }
  }

  /**
   * Add a new provider to the engine
   * @param {Object} providerData - Provider configuration data
   * @returns {Promise<void>}
   */
  static async addProvider(providerData) {
    if (!ProviderInitializer.initialized) {
      throw new Error('ProviderInitializer not initialized. Call initialize() first.');
    }

    try {
      // Check if provider should be loaded
      if (providerData.enabled !== true || providerData.deleted === true) {
        ProviderInitializer.logger.debug(`Provider ${providerData.id} is disabled or deleted, skipping`);
        return;
      }

      // Create instance
      const instance = ProviderInitializer._createProviderInstance(providerData);
      
      // Initialize cache policies
      await instance.initializeCachePolicies();
      
      // Add to providers Map
      ProviderInitializer.providers.set(providerData.id, instance);
      ProviderInitializer.loadedProviders.set(providerData.id, {
        lastUpdated: providerData.lastUpdated ? new Date(providerData.lastUpdated) : new Date()
      });
      
      ProviderInitializer.logger.info(`✓ Added provider: ${providerData.id} (${providerData.type})`);
    } catch (error) {
      ProviderInitializer.logger.error(`✗ Failed to add provider ${providerData.id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Reload cache policies for all loaded providers
   * @returns {Promise<void>}
   */
  static async reloadCachePolicies() {
    if (!ProviderInitializer.initialized || !ProviderInitializer.providers) {
      throw new Error('ProviderInitializer not initialized. Call initialize() first.');
    }

    ProviderInitializer.logger.info('Reloading cache policies for all providers...');
    
    for (const [providerId, provider] of ProviderInitializer.providers) {
      try {
        await provider.initializeCachePolicies();
        ProviderInitializer.logger.debug(`✓ Reloaded cache policies for provider: ${providerId}`);
      } catch (error) {
        ProviderInitializer.logger.error(`✗ Failed to reload cache policies for provider ${providerId}: ${error.message}`);
      }
    }
    
    ProviderInitializer.logger.info('Cache policies reload completed');
  }

  /**
   * Reset initialization state (useful for testing)
   * @private
   */
  static _reset() {
    ProviderInitializer.cache = null;
    ProviderInitializer.mongoClient = null;
    ProviderInitializer.mongoData = null;
    ProviderInitializer.providers = null;
    ProviderInitializer.loadedProviders = null;
    ProviderInitializer.tmdbProvider = null;
    ProviderInitializer.initialized = false;
  }

  /**
   * Create a provider instance based on type
   * @private
   * @param {Object} providerData - Provider configuration data
   * @returns {import('../providers/BaseIPTVProvider.js').BaseIPTVProvider} Provider instance (AGTVProvider or XtreamProvider)
   */
  static _createProviderInstance(providerData) {
    if (providerData.type === 'agtv') {
      return new AGTVProvider(providerData, ProviderInitializer.cache, ProviderInitializer.mongoData);
    } else if (providerData.type === 'xtream') {
      return new XtreamProvider(providerData, ProviderInitializer.cache, ProviderInitializer.mongoData);
    } else {
      throw new Error(`Unknown provider type: ${providerData.type}`);
    }
  }
}

