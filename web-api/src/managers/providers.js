import { BaseManager } from './BaseManager.js';
import { DatabaseCollections, DataProvider } from '../config/collections.js';
import { toCollectionName } from '../config/collections.js';
import slugify from 'slugify';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Providers manager for handling IPTV provider operations
 * Uses DatabaseService collection-based methods for all data access
 * Manages provider instances and routes API calls to appropriate providers
 */
class ProvidersManager extends BaseManager {
  /**
   * @param {import('../services/websocket.js').WebSocketService} webSocketService - WebSocket service instance
   * @param {import('./titles.js').TitlesManager} titlesManager - Titles manager instance
   * @param {Object<string, import('../providers/BaseIPTVProvider.js').BaseIPTVProvider>} providerTypeMap - Map of provider type to provider instance
   * @param {import('../repositories/ProviderTitleRepository.js').ProviderTitleRepository} providerTitleRepo - Provider titles repository
   * @param {import('../repositories/TitleStreamRepository.js').TitleStreamRepository} titleStreamRepo - Title streams repository
   * @param {import('../repositories/TitleRepository.js').TitleRepository} titleRepo - Titles repository
   * @param {import('../repositories/ProviderRepository.js').ProviderRepository} providerRepo - Provider repository
   * @param {Function<string>} triggerJob - Function to trigger jobs by name
   */
  constructor(webSocketService, titlesManager, providerTypeMap, providerTitleRepo, titleStreamRepo, titleRepo, providerRepo, triggerJob) {
    super('ProvidersManager');
    this._webSocketService = webSocketService;
    this._titlesManager = titlesManager;
    this._providerTypeMap = providerTypeMap;
    this._providersCollection = toCollectionName(DatabaseCollections.IPTV_PROVIDERS);
    
    // Repositories for composite operations
    this._providerTitleRepo = providerTitleRepo;
    this._titleStreamRepo = titleStreamRepo;
    this._titleRepo = titleRepo;
    this._providerRepo = providerRepo;
    
    // Function to trigger jobs (passed via constructor)
    this._triggerJob = triggerJob;
    
    // Cache for providers - null = cache invalid/empty, Array = cached providers data
    this._cachedProviders = null;
  }

  /**
   * Trigger syncIPTVProviderTitles job asynchronously (fire and forget)
   * @private
   * @returns {void}
   */
  _triggerSyncJob() {
    if (!this._triggerJob) {
      this.logger.warn('Trigger job function not available');
      return;
    }
    
    // Fire job asynchronously without blocking
    setImmediate(async () => {
      try {
        await this._triggerJob('syncIPTVProviderTitles');
        this.logger.info('Triggered syncIPTVProviderTitles job');
      } catch (error) {
        this.logger.error(`Failed to trigger syncIPTVProviderTitles job: ${error.message}`);
        // Don't throw - allow provider operation to continue even if job trigger fails
      }
    });
  }

  /**
   * Reload provider configs in all provider instances
   * Called after providers are created, updated, or deleted
   * @private
   */
  async _reloadProviderConfigs() {
    try {
      const allProviders = await this._readAllProviders();
      
      // Group providers by type
      const xtreamConfigs = {};
      const agtvConfigs = {};
      
      for (const provider of allProviders) {
        if (provider.deleted) continue; // Skip deleted providers
        
        if (provider.type === DataProvider.XTREAM) {
          xtreamConfigs[provider.id] = provider;
        } else if (provider.type === DataProvider.AGTV) {
          agtvConfigs[provider.id] = provider;
        }
      }
      
      // Reload configs in each provider instance
      if (this._providerTypeMap[DataProvider.XTREAM]) {
        this._providerTypeMap[DataProvider.XTREAM].reloadProviderConfigs(xtreamConfigs);
      }
      if (this._providerTypeMap[DataProvider.AGTV]) {
        this._providerTypeMap[DataProvider.AGTV].reloadProviderConfigs(agtvConfigs);
      }
      
      this.logger.debug('Reloaded provider configs in all provider instances');
    } catch (error) {
      this.logger.error('Error reloading provider configs:', error);
    }
  }

  /**
   * Get provider type from database
   * @private
   * @param {string} providerId - Provider ID
   * @returns {Promise<string>} Provider type ('xtream' or 'agtv')
   */
  async _getProviderType(providerId) {
    const provider = await this._providerRepo.findOneByQuery({ id: providerId });
    
    if (!provider) {
      throw new Error(`Provider ${providerId} not found`);
    }
    
    if (provider.deleted) {
      throw new Error(`Provider ${providerId} is deleted`);
    }
    
    return provider.type;
  }

  /**
   * Get appropriate provider instance based on provider type
   * @private
   * @param {string} providerId - Provider ID
   * @returns {Promise<BaseIPTVProvider>} Provider instance (XtreamProvider or AGTVProvider)
   */
  async _getProvider(providerId) {
    const providerType = await this._getProviderType(providerId);
    
    if (!this._providerTypeMap[providerType]) {
      throw new Error(`Unsupported provider type: ${providerType}`);
    }

    return this._providerTypeMap[providerType];
  }

  /**
   * Extract category IDs from category keys
   * Category keys format: "movies-1", "tvshows-5"
   * Returns: [1, 5] (numeric IDs)
   * @private
   * @param {Array<string>} categoryKeys - Array of category keys
   * @returns {Array<number>} Array of category IDs
   */
  _extractCategoryIdsFromKeys(categoryKeys) {
    if (!categoryKeys || categoryKeys.length === 0) {
      return [];
    }

    return categoryKeys
      .map(key => {
        const parts = key.split('-');
        return parts.length > 1 ? parseInt(parts[1]) : null;
      })
      .filter(id => id !== null && !isNaN(id));
  }

  /**
   * Remove provider from all title sources (composite operation)
   * Coordinates: ProviderTitleRepository → TitleStreamRepository → TitleRepository
   * @private
   * @param {string} providerId - Provider ID
   * @param {Array<string>} [categoryKeys=null] - Optional: specific category keys
   * @param {Object} [enabledCategories=null] - Optional: enabled categories object
   * @returns {Promise<{titlesUpdated: number, streamsRemoved: number, titleKeys: Array<string>}>}
   */
  async _removeProviderFromTitles(providerId, categoryKeys = null, enabledCategories = null) {
    try {
      let query = {
        provider_id: providerId,
        tmdb_id: { $exists: true, $ne: null } // Only titles with TMDB match
      };

      // Build query filter based on parameters
      if (enabledCategories) {
        // Categories-changed scenario: remove from disabled categories
        const enabledCategoryKeys = [
          ...(enabledCategories.movies || []),
          ...(enabledCategories.tvshows || [])
        ];
        const enabledCategoryIds = this._extractCategoryIdsFromKeys(enabledCategoryKeys);
        
        if (enabledCategoryIds.length > 0) {
          query.category_id = { $nin: enabledCategoryIds }; // NOT in enabled = disabled
        }
        // If no enabled categories, all are disabled, so query remains as-is
      } else if (categoryKeys && categoryKeys.length > 0) {
        // Specific categories scenario
        const categoryIds = this._extractCategoryIdsFromKeys(categoryKeys);
        if (categoryIds.length > 0) {
          query.category_id = { $in: categoryIds };
        } else {
          // Invalid category keys, return early
          return { titlesUpdated: 0, streamsRemoved: 0, titleKeys: [] };
        }
      }
      // If categoryKeys is null and enabledCategories is null, query remains:
      // { provider_id: providerId, tmdb_id: { $exists: true, $ne: null } }
      // This means "all categories" (for delete/disable provider)

      // Step 1: Find provider titles using ProviderTitleRepository
      const providerTitles = await this._providerTitleRepo.findByQuery(query);

      if (providerTitles.length === 0) {
        return { titlesUpdated: 0, streamsRemoved: 0, titleKeys: [] };
      }

      // Step 2: Build title_keys from provider titles
      const titleKeys = [...new Set(
        providerTitles
          .filter(t => t.tmdb_id && t.type)
          .map(t => `${t.type}-${t.tmdb_id}`)
      )];

      if (titleKeys.length === 0) {
        return { titlesUpdated: 0, streamsRemoved: 0, titleKeys: [] };
      }

      // Step 3: Delete title_streams using TitleStreamRepository
      const deletedStreams = await this._titleStreamRepo.deleteByProviderAndTitleKeys(providerId, titleKeys);

      // Step 4: Update titles.streams using TitleRepository
      const { titlesUpdated, streamsRemoved } = await this._titleRepo.removeProviderFromStreams(providerId, titleKeys);

      return {
        titlesUpdated,
        streamsRemoved: deletedStreams.deletedCount || 0,
        titleKeys
      };
    } catch (error) {
      this.logger.error(`Error removing provider ${providerId} from titles: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete titles without streams (composite operation)
   * Coordinates: TitleStreamRepository → TitleRepository
   * @private
   * @param {Array<string>} titleKeys - Title keys to check
   * @returns {Promise<number>} Number of deleted titles
   */
  async _deleteTitlesWithoutStreams(titleKeys) {
    if (!titleKeys || titleKeys.length === 0) {
      return 0;
    }

    try {
      // Step 1: Check title_streams using TitleStreamRepository
      const titleStreams = await this._titleStreamRepo.findByTitleKeys(titleKeys);
      const titleKeysWithStreams = new Set(titleStreams.map(ts => ts.title_key));

      // Step 2 & 3: Check titles.streams and delete empty titles using TitleRepository
      return await this._titleRepo.deleteWithoutStreams(titleKeys, titleKeysWithStreams);
    } catch (error) {
      this.logger.error(`Error deleting titles without streams: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fetch categories from provider
   * @param {string} providerId - Provider ID
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Promise<Array>} Array of category objects
   */
  async fetchCategories(providerId, type) {
    const provider = await this._getProvider(providerId);
    return await provider.fetchCategories(providerId, type);
  }

  /**
   * Fetch metadata from provider
   * @param {string} providerId - Provider ID
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Promise<Array>} Array of title objects
   */
  async fetchMetadata(providerId, type) {
    const provider = await this._getProvider(providerId);
    return await provider.fetchMetadata(providerId, type);
  }

  /**
   * Fetch extended info from provider
   * @param {string} providerId - Provider ID
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @param {string} titleId - Title ID
   * @returns {Promise<Object>} Extended info object
   */
  async fetchExtendedInfo(providerId, type, titleId) {
    const provider = await this._getProvider(providerId);
    return await provider.fetchExtendedInfo(providerId, type, titleId);
  }

  /**
   * Fetch M3U8 content from provider
   * @param {string} providerId - Provider ID
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @param {number} [page] - Page number (for paginated types)
   * @returns {Promise<string>} M3U8 content as string
   */
  async fetchM3U8(providerId, type, page = null) {
    const provider = await this._getProvider(providerId);
    return await provider.fetchM3U8(providerId, type, page);
  }

  /**
   * Get IPTV provider types
   */
  _getIPTVProviderTypes() {
    return [DataProvider.AGTV, DataProvider.XTREAM];
  }

  /**
   * Get ignored titles for a specific provider
   * Optimized to query MongoDB directly for ignored titles only
   * @param {string} providerId - Provider ID
   * @returns {Promise<{response: object, statusCode: number}>}
   */
  async getIgnoredTitles(providerId) {
    try {
      // Validate provider exists
      const providerResult = await this.getProvider(providerId);
      if (providerResult.statusCode !== 200) {
        return {
          response: { error: 'Provider not found' },
          statusCode: 404,
        };
      }

      // Query MongoDB directly for ignored titles for this provider
      // Ignored titles are in provider_titles collection with ignored: true
      const ignoredTitles = await this._providerTitleRepo.findByQuery({
        provider_id: providerId,
        ignored: true
      });

      if (!ignoredTitles || ignoredTitles.length === 0) {
        return {
          response: [],
          statusCode: 200,
        };
      }

      // Transform to array format: [{ title_key, issue, name, year }]
      // The issue/reason is stored in the ignored_reason field, or we can use a default
      const ignoredList = ignoredTitles.map(title => {
        const year = title.release_date ? new Date(title.release_date).getFullYear() : null;
        const titleKey = title.title_key || `${title.type}-${title.tmdb_id}`;
        
        return {
          title_key: titleKey,
          issue: title.ignored_reason || 'Unknown issue',
          name: title.title || null,
          year: year || null
        };
      });

      return {
        response: ignoredList,
        statusCode: 200,
      };
    } catch (error) {
      this.logger.error(`Error getting ignored titles for provider ${providerId}:`, error);
      return {
        response: { error: 'Failed to get ignored titles' },
        statusCode: 500,
      };
    }
  }

  /**
   * Normalize provider URLs
   */
  _normalizeUrls(providerData, existingProvider = null) {
    const providerType = providerData.type || (existingProvider ? existingProvider.type : null);
    
    // Use streams_urls as provided
    let urls = providerData.streams_urls || [];

    // Only Xtream supports multiple stream URLs
    if (providerType !== DataProvider.XTREAM && urls.length > 1) {
      urls = urls.slice(0, 1);
    }

    providerData.streams_urls = urls;

    return providerData;
  }

  /**
   * Read all providers from collection (with caching)
   * Uses DatabaseService collection-based methods
   * @private
   */
  async _readAllProviders() {
    // Return cached data if available
    if (this._cachedProviders !== null) {
      return this._cachedProviders;
    }

    try {
      const providers = await this._providerRepo.findByQuery({});
      this._cachedProviders = Array.isArray(providers) ? providers : [];
      return this._cachedProviders;
    } catch (error) {
      this.logger.error('Error reading providers:', error);
      // Cache empty array on error to prevent repeated DB calls
      this._cachedProviders = [];
      return [];
    }
  }

  /**
   * Invalidate providers cache
   * @private
   */
  _invalidateProvidersCache() {
    this._cachedProviders = null;
  }

  /**
   * Write all providers to MongoDB
   * Uses bulkWrite to safely update existing, insert new, and delete removed providers
   * @private
   */
  async _writeAllProviders(providers) {
    try {
      const now = new Date();
      
      // Get all existing providers to identify which ones to update vs insert
      const existingProviders = await this._providerRepo.findByQuery({});
      const existingIds = new Set(
        (existingProviders || []).map(p => p.id).filter(Boolean)
      );
      
      // Build bulk operations
      const operations = [];
      
      // Process each provider: replace existing or insert new
      // Note: Providers use soft delete (deleted: true), so they remain in the array
      // and are never physically deleted from the database
      for (const provider of providers) {
        if (!provider.id) {
          this.logger.warn('Skipping provider without id:', provider);
          continue;
        }
        
        const providerWithTimestamps = {
          ...provider,
          lastUpdated: now,
          createdAt: provider.createdAt || now
        };
        
        if (existingIds.has(provider.id)) {
          // Update existing provider
          operations.push({
            replaceOne: {
              filter: { id: provider.id },
              replacement: providerWithTimestamps
            }
          });
        } else {
          // Insert new provider
          operations.push({
            insertOne: {
              document: providerWithTimestamps
            }
          });
        }
      }
      
      // Execute all operations atomically per document
      if (operations.length > 0) {
        await this._providerRepo.bulkWrite(operations);
      }
      
      this.logger.info(`Saved ${providers.length} providers to MongoDB`);
    } catch (error) {
      this.logger.error('Error writing providers to MongoDB:', error);
      throw error;
    }
  }

  /**
   * Get all IPTV providers
   */
  async getProviders() {
    try {
      const providers = await this._readAllProviders();

      return {
        response: { providers },
        statusCode: 200,
      };
    } catch (error) {
      this.logger.error('Error getting providers:', error);
      return {
        response: { error: 'Failed to get providers', providers: [] },
        statusCode: 500,
      };
    }
  }

  /**
   * Get a specific IPTV provider
   */
  async getProvider(providerId) {
    try {
      const providers = await this._readAllProviders();
      const provider = providers.find(p => p.id === providerId);

      if (!provider) {
        return {
          response: { error: 'Provider not found' },
          statusCode: 404,
        };
      }

      return {
        response: provider,
        statusCode: 200,
      };
    } catch (error) {
      this.logger.error('Error getting provider:', error);
      return {
        response: { error: 'Failed to get provider' },
        statusCode: 500,
      };
    }
  }

  /**
   * Create a new IPTV provider
   */
  async createProvider(providerData) {
    try {
      // Validate provider type
      const providerType = providerData.type;
      const validTypes = this._getIPTVProviderTypes();
      if (!validTypes.includes(providerType)) {
        return {
          response: {
            error: `Invalid provider type. Must be one of: ${validTypes.join(', ')}`
          },
          statusCode: 400,
        };
      }

      // Require manual ID on creation (no auto-generation)
      const providedId = (providerData.id || '').trim();
      if (!providedId) {
        return {
          response: { error: 'Provider id is required and must be unique' },
          statusCode: 400,
        };
      }
      // Slugify provider ID once at creation - use consistently everywhere after
      providerData.id = slugify(providedId, { lower: true, strict: true });

      // Check if provider already exists
      const providers = await this._readAllProviders();
      if (providers.some(p => p.id === providerData.id)) {
        return {
          response: { error: 'Provider with this id already exists' },
          statusCode: 409,
        };
      }

      // Normalize URLs
      this._normalizeUrls(providerData);

      // Set default values
      if (providerData.enabled === undefined) {
        providerData.enabled = true;
      }

      if (providerData.priority === undefined) {
        const maxPriority = Math.max(
          ...providers.map(p => p.priority || 0),
          0
        );
        providerData.priority = maxPriority + 1;
      }

      // Set default api_rate based on provider type
      if (!providerData.api_rate) {
        const providerType = providerData.type.toLowerCase();
        if (providerType === 'agtv') {
          providerData.api_rate = {
            concurrent: 10,
            duration_seconds: 1
          };
        } else if (providerType === 'xtream') {
          providerData.api_rate = {
            concurrent: 4,
            duration_seconds: 1
          };
        }
      }

      // Add provider to array and save
      providers.push(providerData);
      await this._writeAllProviders(providers);

      // Update cache with new data (no need to re-read from DB)
      this._cachedProviders = providers;

      // Reload provider configs in provider instances
      await this._reloadProviderConfigs();

      // Trigger sync job if provider is enabled (async, non-blocking)
      if (providerData.enabled !== false) {
        this._triggerSyncJob();
      }

      // Broadcast WebSocket event
      this._webSocketService.broadcastEvent('provider_changed', {
        provider_id: providerData.id,
        action: 'created'
      });

      return {
        response: providerData,
        statusCode: 201,
      };
    } catch (error) {
      this.logger.error('Error creating provider:', error);
      return {
        response: { error: 'Failed to create provider' },
        statusCode: 500,
      };
    }
  }

  /**
   * Update an existing IPTV provider
   */
  async updateProvider(providerId, providerData) {
    try {
      // Get all providers
      const providers = await this._readAllProviders();
      
      // Find the provider to update
      const providerIndex = providers.findIndex(p => p.id === providerId);

      if (providerIndex === -1) {
        return {
          response: { error: 'Provider not found' },
          statusCode: 404,
        };
      }

      const existingProvider = providers[providerIndex];

      // Check if provider is being enabled/disabled
      const wasEnabled = existingProvider.enabled !== false;
      const willBeEnabled = providerData.enabled !== false;
      const enabledChanged = wasEnabled !== willBeEnabled;

      // Normalize URLs
      this._normalizeUrls(providerData, existingProvider);

      // Update provider data (preserve id and other fields)
      const now = new Date();
      const updatedProvider = {
        ...existingProvider,
        ...providerData,
        id: providerId, // Ensure id doesn't change
        lastUpdated: now // Update timestamp
      };

      // Set default api_rate if missing (backward compatibility)
      if (!updatedProvider.api_rate) {
        const providerType = updatedProvider.type?.toLowerCase();
        if (providerType === 'agtv') {
          updatedProvider.api_rate = {
            concurrent: 10,
            duration_seconds: 1
          };
        } else if (providerType === 'xtream') {
          updatedProvider.api_rate = {
            concurrent: 4,
            duration_seconds: 1
          };
        }
      }

      // Handle enable/disable cleanup
      if (enabledChanged && !willBeEnabled) {
        // Provider being disabled - perform cleanup
        try {
          const { titlesUpdated, streamsRemoved, titleKeys } = 
            await this._removeProviderFromTitles(providerId);
          
          // removeProviderFromTitles already deletes title_streams, so no need to call deleteProviderTitleStreams
          const deletedEmptyTitles = await this._deleteTitlesWithoutStreams(titleKeys);
          
          this.logger.info(
            `Provider ${providerId} disabled cleanup: ${titlesUpdated} titles updated, ` +
            `${streamsRemoved} streams removed, ${deletedEmptyTitles} empty titles deleted`
          );
        } catch (error) {
          this.logger.error(`Error cleaning up disabled provider ${providerId}: ${error.message}`);
        }
      } else if (enabledChanged && willBeEnabled) {
        // Provider being enabled - reset titles lastUpdated
        try {
          const updatedCount = await this._providerTitleRepo.resetLastUpdated(providerId);
          this.logger.info(`Reset lastUpdated for ${updatedCount} provider titles for ${providerId}`);
        } catch (error) {
          this.logger.error(`Error resetting titles lastUpdated for provider ${providerId}: ${error.message}`);
        }
        
        // Trigger sync job to fetch fresh data (async, non-blocking)
        this._triggerSyncJob();
      }

      // Update in array and save
      providers[providerIndex] = updatedProvider;
      await this._writeAllProviders(providers);

      // Update cache with new data (no need to re-read from DB)
      this._cachedProviders = providers;

      // Reload provider configs in provider instances
      await this._reloadProviderConfigs();

      // Broadcast WebSocket event
      this._webSocketService.broadcastEvent('provider_changed', {
        provider_id: providerId,
        action: 'updated'
      });

      return {
        response: updatedProvider,
        statusCode: 200,
      };
    } catch (error) {
      this.logger.error('Error updating provider:', error);
      // Invalidate cache on error
      this._invalidateProvidersCache();
      return {
        response: { error: 'Failed to update provider' },
        statusCode: 500,
      };
    }
  }

  /**
   * Delete an IPTV provider (logical delete)
   */
  async deleteProvider(providerId) {
    try {
      // Load all providers
      const providers = await this._readAllProviders();
      const providerIndex = providers.findIndex(p => p.id === providerId);

      if (providerIndex === -1) {
        return {
          response: { error: 'Provider not found' },
          statusCode: 404,
        };
      }

      const provider = providers[providerIndex];

      // Perform cleanup operations using repositories
      try {
        // 1. Remove provider from titles.streams (and delete title_streams)
        const { titlesUpdated, streamsRemoved, titleKeys } = 
          await this._removeProviderFromTitles(providerId);
        
        // 2. Delete all provider_titles for this provider (only on delete, not disable)
        const deletedTitles = await this._providerTitleRepo.deleteByProvider(providerId);
        
        // 3. Delete titles without streams (optional, can be async/background)
        const deletedEmptyTitles = await this._deleteTitlesWithoutStreams(titleKeys);
        
        // 4. Clear provider API cache (disk storage)
        // Get storage from any provider instance (they all share the same storage)
        const firstProvider = Object.values(this._providerTypeMap)[0];
        if (firstProvider && firstProvider._storage) {
          firstProvider._storage.clearProviderCache(providerId);
        }
        
        this.logger.info(
          `Provider ${providerId} cleanup: ${titlesUpdated} titles updated, ` +
          `${streamsRemoved} streams removed, ${deletedTitles} provider titles deleted, ` +
          `${deletedEmptyTitles} empty titles deleted`
        );
      } catch (error) {
        // Log error but don't fail the provider deletion
        this.logger.error(`Error cleaning up provider ${providerId}: ${error.message}`);
      }

      // Set deleted: true and update lastUpdated timestamp
      const now = new Date();
      providers[providerIndex] = {
        ...provider,
        deleted: true,
        lastUpdated: now
      };
      
      await this._writeAllProviders(providers);

      // Update cache with new data (no need to re-read from DB)
      this._cachedProviders = providers;

      // Reload provider configs in provider instances
      await this._reloadProviderConfigs();

      // Broadcast WebSocket event
      this._webSocketService.broadcastEvent('provider_changed', {
        provider_id: providerId,
        action: 'deleted'
      });

      return {
        response: {},
        statusCode: 204,
      };
    } catch (error) {
      this.logger.error('Error deleting provider:', error);
      // Invalidate cache on error
      this._invalidateProvidersCache();
      return {
        response: { error: 'Failed to delete provider' },
        statusCode: 500,
      };
    }
  }

  /**
   * Get all categories for a provider (movies + tvshows)
   * Fetches from provider API and merges with enabled_categories from provider config
   * @param {string} providerId - Provider ID
   * @returns {Promise<{response: Array, statusCode: number}>}
   */
  async getCategories(providerId) {
    try {
      // Validate provider exists
      const provider = await this.getProvider(providerId);
      if (provider.statusCode !== 200) {
        return {
          response: { error: 'Provider not found' },
          statusCode: 404,
        };
      }

      const providerData = provider.response;

      // Fetch categories from provider API (both movies and tvshows)
      const [moviesCategories, tvshowsCategories] = await Promise.all([
        this.fetchCategories(providerId, 'movies').catch(() => []),
        this.fetchCategories(providerId, 'tvshows').catch(() => [])
      ]);

      // Get enabled categories from provider config
      const enabledCategories = providerData.enabled_categories || { movies: [], tvshows: [] };
      const enabledCategoryKeys = new Set([
        ...(enabledCategories.movies || []),
        ...(enabledCategories.tvshows || [])
      ]);

      // Transform and combine categories
      const allCategories = [
        ...moviesCategories.map(cat => ({
          key: `movies-${cat.category_id}`,
          type: 'movies',
          category_id: cat.category_id,
          category_name: cat.category_name,
          enabled: enabledCategoryKeys.has(`movies-${cat.category_id}`)
        })),
        ...tvshowsCategories.map(cat => ({
          key: `tvshows-${cat.category_id}`,
          type: 'tvshows',
          category_id: cat.category_id,
          category_name: cat.category_name,
          enabled: enabledCategoryKeys.has(`tvshows-${cat.category_id}`)
        }))
      ];

      return {
        response: allCategories,
        statusCode: 200,
      };
    } catch (error) {
      this.logger.error('Error getting categories:', error);
      return {
        response: { error: 'Failed to get categories' },
        statusCode: 500,
      };
    }
  }

  /**
   * Update enabled categories for a provider
   * Updates provider config and performs cleanup for disabled categories
   * @param {string} providerId - Provider ID
   * @param {Object} enabledCategories - Object with movies and tvshows arrays of category keys
   * @returns {Promise<{response: Object, statusCode: number}>}
   */
  async updateEnabledCategories(providerId, enabledCategories) {
    try {
      // Validate provider exists
      const providerResult = await this.getProvider(providerId);
      if (providerResult.statusCode !== 200) {
        return {
          response: { error: 'Provider not found' },
          statusCode: 404,
        };
      }

      // Validate enabledCategories structure
      if (!enabledCategories || typeof enabledCategories !== 'object') {
        return {
          response: { error: 'enabledCategories must be an object with movies and tvshows arrays' },
          statusCode: 400,
        };
      }

      if (!Array.isArray(enabledCategories.movies) || !Array.isArray(enabledCategories.tvshows)) {
        return {
          response: { error: 'enabledCategories must have movies and tvshows arrays' },
          statusCode: 400,
        };
      }

      // Update provider document's enabled_categories field
      const now = new Date();
      
      await this._providerRepo.updateOne(
        { id: providerId },
        {
          $set: {
            enabled_categories: {
              movies: enabledCategories.movies || [],
              tvshows: enabledCategories.tvshows || []
            },
            lastUpdated: now
          }
        }
      );

      // Invalidate cache (uses direct repository update, not _writeAllProviders)
      this._invalidateProvidersCache();

      // Perform cleanup for disabled categories using repositories
      try {
        // Remove provider from titles for disabled categories
        const { titlesUpdated, streamsRemoved, titleKeys } = 
          await this._removeProviderFromTitles(providerId, null, enabledCategories);
        
        // Delete titles without streams
        const deletedEmptyTitles = await this._deleteTitlesWithoutStreams(titleKeys);
        
        this.logger.info(
          `Provider ${providerId} categories changed cleanup: ${titlesUpdated} titles updated, ` +
          `${streamsRemoved} streams removed, ${deletedEmptyTitles} empty titles deleted`
        );
      } catch (error) {
        this.logger.error(`Error cleaning up categories for provider ${providerId}: ${error.message}`);
      }

      // Reload provider configs in provider instances (non-blocking - errors logged but don't fail the update)
      try {
        await this._reloadProviderConfigs();
      } catch (error) {
        this.logger.error(`Error reloading provider configs: ${error.message}`);
        // Continue - config reload failure shouldn't prevent category update from succeeding
      }

      // Trigger sync job to fetch fresh data with new categories (async, non-blocking)
      this._triggerSyncJob();

      // Broadcast WebSocket event
      this._webSocketService.broadcastEvent('provider_changed', {
        provider_id: providerId,
        action: 'categories_updated'
      });

      return {
        response: {
          success: true,
          message: 'Categories updated successfully',
          enabled_categories: enabledCategories
        },
        statusCode: 200,
      };
    } catch (error) {
      this.logger.error('Error updating enabled categories:', error);
      return {
        response: { error: 'Failed to update categories' },
        statusCode: 500,
      };
    }
  }

  /**
   * Get all provider priorities
   */
  async getProviderPriorities() {
    try {
      return await this.getProviders();
    } catch (error) {
      this.logger.error('Error getting provider priorities:', error);
      return {
        response: { error: 'Failed to get provider priorities' },
        statusCode: 500,
      };
    }
  }

  /**
   * Update provider priorities
   */
  async updateProviderPriorities(prioritiesData) {
    try {
      const allProviders = await this._readAllProviders();
      const priorityUpdates = prioritiesData.providers || [];

      // Update each provider's priority
      for (const update of priorityUpdates) {
        const providerId = update.id;
        const priority = update.priority;

        if (providerId && priority !== undefined && priority !== null) {
          const providerIndex = allProviders.findIndex(p => p.id === providerId);
          if (providerIndex !== -1) {
            allProviders[providerIndex].priority = priority;
          }
        }
      }

      // Save all providers
      await this._writeAllProviders(allProviders);

      // Update cache with new data (no need to re-read from DB)
      this._cachedProviders = allProviders;

      // Reload provider configs in provider instances
      await this._reloadProviderConfigs();

      // Broadcast WebSocket event
      this._webSocketService.broadcastEvent('provider_changed', {
        provider_id: 'all',
        action: 'updated'
      });

      return {
        response: prioritiesData,
        statusCode: 200,
      };
    } catch (error) {
      this.logger.error('Error updating provider priorities:', error);
      // Invalidate cache on error
      this._invalidateProvidersCache();
      return {
        response: { error: 'Failed to update provider priorities' },
        statusCode: 500,
      };
    }
  }

}

// Export class
export { ProvidersManager };