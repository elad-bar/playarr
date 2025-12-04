import { BaseManager } from '../BaseManager.js';
import { DataProvider } from '../../config/collections.js';
import { NotFoundError, AppError } from '../../errors/AppError.js';

/**
 * Providers Manager (Type D: Orchestration Manager)
 * Coordinates across domains: IPTV providers, provider titles, and titles
 * Handles orchestration: job triggering, WebSocket events, provider config reloading
 */
class ProvidersManager extends BaseManager {
  /**
   * @param {import('../services/websocket.js').WebSocketService} webSocketService - WebSocket service instance
   * @param {Object<string, import('../providers/BaseIPTVProvider.js').BaseIPTVProvider>} providerTypeMap - Map of provider type to provider instance
   * @param {import('./domain/IPTVProviderManager.js').IPTVProviderManager} iptvProviderManager - IPTV Provider domain manager
   * @param {import('./domain/ProviderTitlesManager.js').ProviderTitlesManager} providerTitlesManager - Provider titles manager instance
   * @param {import('../repositories/ProviderTitleRepository.js').ProviderTitleRepository} providerTitleRepo - Provider titles repository (for cross-domain cleanup)
   * @param {import('../repositories/TitleRepository.js').TitleRepository} titleRepo - Titles repository (for cross-domain cleanup)
   * @param {Function<string>} triggerJob - Function to trigger jobs by name
   * @param {import('./domain/ChannelManager.js').ChannelManager} channelManager - Channel manager (for live TV cleanup)
   * @param {import('./domain/ProgramManager.js').ProgramManager} programManager - Program manager (for live TV cleanup)
   * @param {import('./domain/UserManager.js').UserManager} userManager - User manager (for watchlist cleanup)
   */
  constructor(webSocketService, providerTypeMap, iptvProviderManager, providerTitlesManager, providerTitleRepo, titleRepo, triggerJob, channelManager, programManager, userManager) {
    super('ProvidersManager');
    this._webSocketService = webSocketService;
    this._providerTypeMap = providerTypeMap;
    
    // Domain Managers
    this._iptvProviderManager = iptvProviderManager;
    this._providerTitlesManager = providerTitlesManager;
    this._channelManager = channelManager;
    this._programManager = programManager;
    this._userManager = userManager;
    
    // Repositories for cross-domain cleanup operations only
    this._providerTitleRepo = providerTitleRepo;
    this._titleRepo = titleRepo;
    
    // Function to trigger jobs (passed via constructor)
    this._triggerJob = triggerJob;
  }

  /**
   * Trigger a job asynchronously (fire and forget)
   * @private
   * @param {string} jobName - Name of the job to trigger
   * @returns {void}
   */
  _triggerJobAsync(jobName) {
    if (!this._triggerJob) {
      this.logger.warn('Trigger job function not available');
      return;
    }
    
    // Fire job asynchronously without blocking
    setImmediate(async () => {
      try {
        await this._triggerJob(jobName);
        this.logger.info(`Triggered ${jobName} job`);
      } catch (error) {
        this.logger.error(`Failed to trigger ${jobName} job: ${error.message}`);
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
      const allProviders = await this._iptvProviderManager.getAllProviders();
      
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
    const provider = await this._iptvProviderManager.getProvider(providerId);
    
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
   * Get provider instance by type (for jobs that need direct access)
   * @param {string} providerType - Provider type ('xtream' or 'agtv')
   * @returns {BaseIPTVProvider|null} Provider instance or null if not found
   */
  getProviderInstance(providerType) {
    return this._providerTypeMap[providerType?.toLowerCase()] || null;
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
   * Remove provider from titles (main titles and optionally provider titles)
   * Coordinates: ProviderTitleRepository → TitleRepository (media array)
   * @private
   * @param {string} providerId - Provider ID
   * @param {boolean} isEnabled - Whether provider is enabled
   * @param {Object} enabledCategories - Enabled categories object
   * @param {boolean} [deleteProviderTitles=true] - Whether to delete provider titles (default: true for backward compatibility)
   * @returns {Promise<{titlesUpdated: number, streamsRemoved: number, titleKeys: Array, providerTitlesDeleted: number, emptyTitlesDeleted: number}>}
   */
  async _removeProviderFromTitles(providerId, isEnabled, enabledCategories, deleteProviderTitles = true) {
    try {
      if (!enabledCategories || typeof enabledCategories !== 'object') {
        throw new Error('enabledCategories must be provided and must be an object');
      }

      let query = {
        provider_id: providerId,
        tmdb_id: { $exists: true, $ne: null } // Only titles with TMDB match
      };

      // If provider is disabled/deleted, delete ALL titles
      // If provider is enabled, delete only titles from disabled categories
      if (isEnabled) {
        // Provider is enabled - delete only disabled category titles
        const enabledMovieKeys = enabledCategories.movies;
        const enabledTvshowKeys = enabledCategories.tvshows;
        const enabledMovieIds = this._extractCategoryIdsFromKeys(enabledMovieKeys);
        const enabledTvshowIds = this._extractCategoryIdsFromKeys(enabledTvshowKeys);

        // Build $or query to handle movies and tvshows separately
        const orConditions = [];

        // Movies: delete if category_id is NOT in enabled movie category IDs
        if (enabledMovieIds.length > 0) {
          orConditions.push({
            type: 'movies',
            category_id: { $nin: enabledMovieIds }
          });
        } else {
          // If no enabled movie categories, all movies are disabled
          orConditions.push({ type: 'movies' });
        }

        // TV shows: delete if category_id is NOT in enabled tvshow category IDs
        if (enabledTvshowIds.length > 0) {
          orConditions.push({
            type: 'tvshows',
            category_id: { $nin: enabledTvshowIds }
          });
        } else {
          // If no enabled tvshow categories, all tvshows are disabled
          orConditions.push({ type: 'tvshows' });
        }

        if (orConditions.length > 0) {
          query.$or = orConditions;
        }
      }
      // If provider is disabled, query remains: { provider_id: providerId, tmdb_id: { $exists: true, $ne: null } }
      // This means "all titles" (for disabled/deleted provider)

      // Step 1: Find provider titles using ProviderTitleRepository
      const providerTitles = await this._providerTitleRepo.findByQuery(query);

      if (providerTitles.length === 0) {
        return { titlesUpdated: 0, streamsRemoved: 0, titleKeys: [], providerTitlesDeleted: 0, emptyTitlesDeleted: 0 };
      }

      // Step 2: Build title_keys from provider titles
      const titleKeys = [...new Set(
        providerTitles
          .filter(t => t.tmdb_id && t.type)
          .map(t => `${t.type}-${t.tmdb_id}`)
      )];

      if (titleKeys.length === 0) {
        return { titlesUpdated: 0, streamsRemoved: 0, titleKeys: [], providerTitlesDeleted: 0, emptyTitlesDeleted: 0 };
      }

      // Step 3: Delete provider titles from provider_titles collection (only if deleteProviderTitles is true)
      let deletedProviderTitles = { deletedCount: 0 };
      if (deleteProviderTitles) {
        deletedProviderTitles = await this._providerTitleRepo.deleteManyByQuery(query);
      }

      // Step 4: Remove provider sources from titles.media[].sources using MongoDB $pull
      const collection = this._titleRepo.db.collection(this._titleRepo.collectionName);
      const pullResult = await collection.updateMany(
        { title_key: { $in: titleKeys } },
        { $pull: { 'media.$[].sources': { provider_id: providerId } } }
      );

      // Step 5: Remove empty media items (media items with no sources)
      await collection.updateMany(
        { title_key: { $in: titleKeys } },
        { $pull: { media: { sources: { $size: 0 } } } }
      );

      // Step 6: Delete titles that have no media items left
      const deleteResult = await collection.deleteMany({
        title_key: { $in: titleKeys },
        $or: [
          { media: { $size: 0 } },
          { media: { $exists: false } }
        ]
      });

      return {
        titlesUpdated: pullResult.modifiedCount || 0,
        streamsRemoved: pullResult.modifiedCount || 0,
        titleKeys,
        providerTitlesDeleted: deletedProviderTitles.deletedCount || 0,
        emptyTitlesDeleted: deleteResult.deletedCount || 0
      };
    } catch (error) {
      this.logger.error(`Error removing provider ${providerId} from titles: ${error.message}`);
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
   * Get ignored titles for a specific provider
   * Delegates to ProviderTitlesManager
   * @param {string} providerId - Provider ID
   * @returns {Promise<Array<Object>>} Array of ignored title objects
   * @throws {NotFoundError} If provider not found
   * @throws {AppError} If an error occurs
   */
  async getIgnoredTitles(providerId) {
    // Validate provider exists first
    await this.getProvider(providerId);

    // Delegate to ProviderTitlesManager
    try {
      return await this._providerTitlesManager.getIgnoredTitles(providerId);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      this.logger.error('Error getting ignored titles:', error);
      throw new AppError('Failed to get ignored titles', 500);
    }
  }


  /**
   * Get all IPTV providers
   * Delegates to IPTVProviderManager
   */
  async getProviders() {
    return await this._iptvProviderManager.getProviders();
  }

  /**
   * Get enabled provider IDs
   * Delegates to IPTVProviderManager
   */
  async getEnabledProviderIds(options = {}) {
    return await this._iptvProviderManager.getEnabledProviderIds(options);
  }

  /**
   * Get enabled providers
   * Delegates to IPTVProviderManager
   */
  async getEnabledProviders(options = {}) {
    return await this._iptvProviderManager.getEnabledProviders(options);
  }

  /**
   * Get enabled providers as a Map
   * Delegates to IPTVProviderManager
   */
  async getEnabledProvidersMap(options = {}) {
    return await this._iptvProviderManager.getEnabledProvidersMap(options);
  }

  /**
   * Get a specific IPTV provider
   * Delegates to IPTVProviderManager
   * @param {string} providerId - Provider ID
   * @returns {Promise<Object>} Provider object
   * @throws {NotFoundError} If provider not found
   * @throws {AppError} If an error occurs
   */
  async getProvider(providerId) {
    try {
      return await this._iptvProviderManager.getProvider(providerId);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      this.logger.error('Error getting provider:', error);
      throw new AppError('Failed to get provider', 500);
    }
  }

  /**
   * Create a new IPTV provider
   * Orchestrates domain operation with job triggering and WebSocket events
   */
  async createProvider(providerData) {
    // Delegate domain operation to IPTVProviderManager
    const createdProvider = await this._iptvProviderManager.createProvider(providerData);
    
    // Orchestration: Reload provider configs in provider instances
    await this._reloadProviderConfigs();

    // Orchestration: Trigger sync jobs if provider is enabled (async, non-blocking)
    if (createdProvider.enabled !== false) {
      this._triggerJobAsync('syncIPTVProviderTitles');
      this._triggerJobAsync('syncProviderDetails');
    }

    // Orchestration: Broadcast WebSocket event
    this._webSocketService.broadcastEvent('provider_changed', {
      provider_id: createdProvider.id,
      action: 'created'
    });
    
    return createdProvider;
  }

  /**
   * Update an existing IPTV provider
   * Orchestrates domain operation with cleanup, job triggering, and WebSocket events
   */
  async updateProvider(providerId, providerData) {
    // Get existing provider to check for enable/disable changes
    const existingProvider = await this._iptvProviderManager.getProvider(providerId);
    
    // Check if provider is being enabled/disabled
    const wasEnabled = existingProvider.enabled !== false;
    const willBeEnabled = providerData.enabled !== false;
    const enabledChanged = wasEnabled !== willBeEnabled;

    // Delegate domain operation to IPTVProviderManager
    const updatedProvider = await this._iptvProviderManager.updateProvider(providerId, providerData);

    // Orchestration: Handle enable/disable cleanup
    if (enabledChanged && !willBeEnabled) {
      // Provider being disabled - keep provider titles, only remove from main titles
      try {
        const { titlesUpdated, streamsRemoved, titleKeys, providerTitlesDeleted, emptyTitlesDeleted } = 
          await this._removeProviderFromTitles(providerId, willBeEnabled, updatedProvider.enabled_categories, false);
        
        this.logger.info(
          `Provider ${providerId} disabled cleanup: provider titles kept, ` +
          `${titlesUpdated} titles updated, ${streamsRemoved} streams removed, ${emptyTitlesDeleted} empty titles deleted`
        );
      } catch (error) {
        this.logger.error(`Error cleaning up disabled provider ${providerId}: ${error.message}`);
      }
    } else if (enabledChanged && willBeEnabled) {
      // Provider being enabled - incremental sync will work automatically since titles are kept
      // Trigger sync job to fetch updates (async, non-blocking)
      this._triggerJobAsync('syncIPTVProviderTitles');
    }

    // Orchestration: Reload provider configs in provider instances
    await this._reloadProviderConfigs();

    // Orchestration: Check if credentials changed for job triggering
    const credentialsChanged = 
      ('username' in providerData && providerData.username !== existingProvider.username) ||
      ('password' in providerData && providerData.password !== existingProvider.password) ||
      ('streams_urls' in providerData && JSON.stringify(providerData.streams_urls || []) !== JSON.stringify(existingProvider.streams_urls || []));

    // Orchestration: Trigger syncProviderDetails job if credentials changed or provider is enabled
    if (credentialsChanged || updatedProvider.enabled !== false) {
      this._triggerJobAsync('syncProviderDetails');
    }

      // Orchestration: Broadcast WebSocket event
      this._webSocketService.broadcastEvent('provider_changed', {
        provider_id: providerId,
        action: 'updated'
      });
    
    return updatedProvider;
  }

  /**
   * Update provider details (expiration, connections) for a specific provider
   * Delegates to IPTVProviderManager
   * @param {string} providerId - Provider ID
   * @param {Object} details - Provider details
   * @returns {Promise<{provider_id: string, provider_details: Object}>} Provider details object
   * @throws {NotFoundError} If provider not found
   * @throws {AppError} If an error occurs
   */
  async updateProviderDetails(providerId, details) {
    try {
      return await this._iptvProviderManager.updateProviderDetails(providerId, details);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      this.logger.error('Error updating provider details:', error);
      throw new AppError('Failed to update provider details', 500);
    }
  }

  /**
   * Delete an IPTV provider (logical delete)
   * Orchestrates domain operation with cleanup, cache clearing, and WebSocket events
   */
  async deleteProvider(providerId) {
    // Get provider before deletion for cleanup
    const provider = await this._iptvProviderManager.getProvider(providerId);

    // Orchestration: Perform cleanup operations before domain deletion
    try {
      // 1. Remove provider from titles.streams (and delete title_streams)
      const isProviderEnabled = provider.enabled !== false;
      const { titlesUpdated, streamsRemoved, titleKeys, emptyTitlesDeleted } = 
        await this._removeProviderFromTitles(providerId, isProviderEnabled, provider.enabled_categories);
      
      // 2. Delete all provider_titles for this provider (only on delete, not disable)
      const deletedTitles = await this._providerTitlesManager.deleteByProvider(providerId);
      
      // 3. Delete all channels and programs for this provider
      const deletedPrograms = await this._programManager.deleteByProvider(providerId);
      const deletedChannels = await this._channelManager.deleteByProvider(providerId);
      
      // Clean up watchlist entries matching provider pattern
      const watchlistPattern = `live-${providerId}-`;
      // Find all users with watchlist entries matching this pattern
      const users = await this._userManager._repository.findByQuery({
        'watchlist.live': { $regex: `^live-${providerId}-` }
      });
      
      // Filter watchlist arrays in JavaScript and update each user
      let watchlistEntriesRemoved = 0;
      for (const user of users) {
        if (user.watchlist && user.watchlist.live && Array.isArray(user.watchlist.live)) {
          const originalLength = user.watchlist.live.length;
          const filteredWatchlist = user.watchlist.live.filter(
            key => !key.startsWith(watchlistPattern)
          );
          
          if (filteredWatchlist.length !== originalLength) {
            await this._userManager._repository.updateOne(
              { id: user.id },
              { $set: { 'watchlist.live': filteredWatchlist } }
            );
            watchlistEntriesRemoved += (originalLength - filteredWatchlist.length);
          }
        }
      }
      
      if (watchlistEntriesRemoved > 0) {
        this.logger.info(`Removed ${watchlistEntriesRemoved} watchlist entries for deleted provider ${providerId}`);
      }
      
      // 4. Clear provider API cache (disk storage)
      // Get storage from any provider instance (they all share the same storage)
      const firstProvider = Object.values(this._providerTypeMap)[0];
      if (firstProvider && firstProvider._storage) {
        firstProvider._storage.clearProviderCache(providerId);
      }
      
      this.logger.info(
        `Provider ${providerId} cleanup: ${titlesUpdated} titles updated, ` +
        `${streamsRemoved} streams removed, ${deletedTitles} provider titles deleted, ` +
        `${emptyTitlesDeleted} empty titles deleted, ${deletedChannels} channels deleted, ${deletedPrograms} programs deleted, ` +
        `${watchlistEntriesRemoved} watchlist entries removed`
      );
    } catch (error) {
      // Log error but don't fail the provider deletion
      this.logger.error(`Error cleaning up provider ${providerId}: ${error.message}`);
    }

    // Delegate domain operation to IPTVProviderManager
    await this._iptvProviderManager.deleteProvider(providerId);
    
    // Orchestration: Reload provider configs in provider instances
    await this._reloadProviderConfigs();

    // Orchestration: Broadcast WebSocket event
    this._webSocketService.broadcastEvent('provider_changed', {
      provider_id: providerId,
      action: 'deleted'
    });
    
    // Return void for delete operations (204 No Content)
    return;
  }

  /**
   * Get all categories for a provider (movies + tvshows + live)
   * Fetches from provider API and merges with enabled_categories from provider config
   * @param {string} providerId - Provider ID
   * @returns {Promise<Array<Object>>}
   */
  async getCategories(providerId) {
    try {
      // Validate provider exists using IPTVProviderManager
      const providerData = await this._iptvProviderManager.getProvider(providerId);

      // Fetch categories from provider API (both movies and tvshows)
      const [moviesCategories, tvshowsCategories] = await Promise.all([
        this.fetchCategories(providerId, 'movies').catch(() => []),
        this.fetchCategories(providerId, 'tvshows').catch(() => [])
      ]);

      // Fetch live categories
      let liveCategories = [];
      try {
        const provider = await this._getProvider(providerId);
        if (providerData.type === 'xtream' && provider.fetchLiveCategories) {
          liveCategories = await provider.fetchLiveCategories(providerId);
        } else if (providerData.type === 'agtv') {
          // For AGTV, categories are extracted from channels during sync
          const channels = await this._channelManager.findByProvider(providerId);
          liveCategories = this._extractCategoriesFromChannels(channels);
        }
      } catch (error) {
        this.logger.warn(`Failed to fetch live categories for ${providerId}: ${error.message}`);
      }

      // Get enabled categories from provider config
      const enabledCategories = providerData.enabled_categories || { movies: [], tvshows: [], live: [] };
      const enabledCategoryKeys = new Set([
        ...(enabledCategories.movies || []),
        ...(enabledCategories.tvshows || []),
        ...(enabledCategories.live || [])
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
        })),
        ...liveCategories.map(cat => {
          const categoryKey = providerData.type === 'xtream' 
            ? `live-${cat.category_id}`
            : `live-${this._normalizeCategoryName(cat.category_name || cat.normalized_name)}`;
          
          return {
            key: categoryKey,
            type: 'live',
            category_id: cat.category_id || null,
            category_name: cat.category_name,
            enabled: enabledCategoryKeys.has(categoryKey)
          };
        })
      ];

      return allCategories;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      this.logger.error('Error getting categories:', error);
      throw new AppError('Failed to get categories', 500);
    }
  }

  /**
   * Extract categories from channels (for AGTV)
   * @private
   * @param {Array} channels - Array of channel objects
   * @returns {Array} Array of category objects
   */
  _extractCategoriesFromChannels(channels) {
    const categoryMap = new Map();
    
    channels.forEach(channel => {
      if (channel.group_title) {
        const normalizedName = this._normalizeCategoryName(channel.group_title);
        const categoryKey = `live-${normalizedName}`;
        
        if (!categoryMap.has(categoryKey)) {
          categoryMap.set(categoryKey, {
            category_name: channel.group_title,
            normalized_name: normalizedName
          });
        }
      }
    });
    
    return Array.from(categoryMap.values());
  }

  /**
   * Normalize category name (slugify, lowercase)
   * @private
   * @param {string} categoryName - Original category name
   * @returns {string} Normalized category name
   */
  _normalizeCategoryName(categoryName) {
    return categoryName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Update enabled categories for a provider
   * Orchestrates domain operation with cleanup, job triggering, and WebSocket events
   * @param {string} providerId - Provider ID
   * @param {Object} enabledCategories - Object with movies, tvshows, and live arrays of category keys
   * @returns {Promise<Object>}
   */
  async updateEnabledCategories(providerId, enabledCategories) {
    // Get provider before update for cleanup
    const provider = await this._iptvProviderManager.getProvider(providerId);

    // Delegate domain operation to IPTVProviderManager
    await this._iptvProviderManager.updateEnabledCategories(providerId, enabledCategories);
    
    // Orchestration: Perform cleanup for disabled categories using repositories
    try {
      // Remove provider from titles for disabled categories (movies/tvshows)
      const isProviderEnabled = provider.enabled !== false;
      const { titlesUpdated, streamsRemoved, titleKeys, providerTitlesDeleted, emptyTitlesDeleted } = 
        await this._removeProviderFromTitles(providerId, isProviderEnabled, enabledCategories);
      
      // Remove provider from channels for disabled live categories
      await this._removeProviderFromChannels(providerId, isProviderEnabled, enabledCategories);
      
      this.logger.info(
        `Provider ${providerId} categories changed cleanup: ${providerTitlesDeleted} provider titles deleted, ` +
        `${titlesUpdated} titles updated, ${streamsRemoved} streams removed, ${emptyTitlesDeleted} empty titles deleted`
      );
    } catch (error) {
      this.logger.error(`Error cleaning up categories for provider ${providerId}: ${error.message}`);
    }

    // Orchestration: Reload provider configs in provider instances (non-blocking - errors logged but don't fail the update)
    try {
      await this._reloadProviderConfigs();
    } catch (error) {
      this.logger.error(`Error reloading provider configs: ${error.message}`);
      // Continue - config reload failure shouldn't prevent category update from succeeding
    }

    // Orchestration: Trigger sync jobs to fetch fresh data with new categories (async, non-blocking)
    this._triggerJobAsync('syncIPTVProviderTitles');
    this._triggerJobAsync('syncLiveTV'); // Trigger Live TV sync for live category changes

    // Orchestration: Broadcast WebSocket event
    this._webSocketService.broadcastEvent('provider_changed', {
      provider_id: providerId,
      action: 'categories_updated'
    });
  
    return {
      success: true,
      message: 'Categories updated successfully',
      enabled_categories: enabledCategories
    };
  }

  /**
   * Remove provider from channels for disabled live categories
   * @private
   * @param {string} providerId - Provider ID
   * @param {boolean} isEnabled - Whether provider is enabled
   * @param {Object} enabledCategories - Enabled categories object
   * @returns {Promise<void>}
   */
  async _removeProviderFromChannels(providerId, isEnabled, enabledCategories) {
    try {
      const enabledLiveCategories = enabledCategories.live || [];
      const enabledLiveCategoryKeys = new Set(enabledLiveCategories);

      // Get all channels for this provider
      const channels = await this._channelManager.findByProvider(providerId);
      
      if (channels.length === 0) {
        return; // No channels to clean up
      }

      // Determine which channels to delete based on provider type
      const provider = await this._iptvProviderManager.getProvider(providerId);
      const channelsToDelete = [];

      for (const channel of channels) {
        let shouldDelete = false;

        if (provider.type === 'xtream') {
          // For Xtream, check category_id against enabled categories
          if (channel.category_id) {
            const categoryKey = `live-${channel.category_id}`;
            shouldDelete = !enabledLiveCategoryKeys.has(categoryKey);
          } else {
            // Channels without category are excluded
            shouldDelete = true;
          }
        } else if (provider.type === 'agtv') {
          // For AGTV, check group_title against enabled categories
          if (channel.group_title) {
            const normalizedName = this._normalizeCategoryName(channel.group_title);
            const categoryKey = `live-${normalizedName}`;
            shouldDelete = !enabledLiveCategoryKeys.has(categoryKey);
          } else {
            // Channels without category are excluded
            shouldDelete = true;
          }
        }

        // If provider is disabled, delete all channels
        if (!isEnabled) {
          shouldDelete = true;
        }

        if (shouldDelete) {
          channelsToDelete.push(channel.channel_id);
        }
      }

      // Delete channels and programs
      if (channelsToDelete.length > 0) {
        // Delete programs first (foreign key constraint)
        await this._programManager.deleteMany({
          provider_id: providerId,
          channel_id: { $in: channelsToDelete }
        });

        // Delete channels
        await this._channelManager._repository.deleteManyByQuery({
          provider_id: providerId,
          channel_id: { $in: channelsToDelete }
        });

        // Clean up watchlist entries for deleted channels
        const deletedChannelKeys = channelsToDelete.map(chId => `live-${providerId}-${chId}`);
        // Update all users to remove these channel keys from watchlist
        await this._userManager._repository.updateMany(
          { 'watchlist.live': { $in: deletedChannelKeys } },
          { $pull: { 'watchlist.live': { $in: deletedChannelKeys } } }
        );

        this.logger.info(`Deleted ${channelsToDelete.length} channels from disabled categories for provider ${providerId}`);
      }
    } catch (error) {
      this.logger.error(`Error removing provider ${providerId} from channels: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get all provider priorities
   * Delegates to IPTVProviderManager
   * @returns {Promise<{providers: Array}>} Priorities object
   * @throws {AppError} If an error occurs
   */
  async getProviderPriorities() {
    try {
      return await this._iptvProviderManager.getProviderPriorities();
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      this.logger.error('Error getting provider priorities:', error);
      throw new AppError('Failed to get provider priorities', 500);
    }
  }

  /**
   * Update provider priorities
   * Orchestrates domain operation with provider config reloading and WebSocket events
   * @param {Object} prioritiesData - Priorities data
   * @returns {Promise<Object>} Priorities data object
   * @throws {AppError} If an error occurs
   */
  async updateProviderPriorities(prioritiesData) {
    try {
      // Delegate domain operation to IPTVProviderManager
      const result = await this._iptvProviderManager.updateProviderPriorities(prioritiesData);
      
      // Orchestration: Reload provider configs in provider instances
      await this._reloadProviderConfigs();

      // Orchestration: Broadcast WebSocket event
      this._webSocketService.broadcastEvent('provider_changed', {
        provider_id: 'all',
        action: 'updated'
      });
      
      return result;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      this.logger.error('Error updating provider priorities:', error);
      throw new AppError('Failed to update provider priorities', 500);
    }
  }

}

// Export class
export { ProvidersManager };