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
   * @param {import('../services/database.js').DatabaseService} database - Database service instance
   * @param {import('../services/websocket.js').WebSocketService} webSocketService - WebSocket service instance
   * @param {import('./titles.js').TitlesManager} titlesManager - Titles manager instance
   * @param {Object<string, import('../providers/BaseIPTVProvider.js').BaseIPTVProvider>} providerTypeMap - Map of provider type to provider instance
   */
  constructor(database, webSocketService, titlesManager, providerTypeMap) {
    super('ProvidersManager', database);
    this._webSocketService = webSocketService;
    this._titlesManager = titlesManager;
    this._providerTypeMap = providerTypeMap;
    this._providersCollection = toCollectionName(DatabaseCollections.IPTV_PROVIDERS);
  }

  /**
   * Get provider type from database
   * @private
   * @param {string} providerId - Provider ID
   * @returns {Promise<string>} Provider type ('xtream' or 'agtv')
   */
  async _getProviderType(providerId) {
    const provider = await this._database.getData(this._providersCollection, { id: providerId });
    
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
      const collection = this._database.getCollection('provider_titles');
      const ignoredTitles = await collection.find({
        provider_id: providerId,
        ignored: true
      }).toArray();

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
   * Read all providers from collection
   * Uses DatabaseService collection-based methods
   * @private
   */
  async _readAllProviders() {
    try {
      const providers = await this._database.getDataList(this._providersCollection);
      return Array.isArray(providers) ? providers : [];
    } catch (error) {
      this.logger.error('Error reading providers:', error);
      return [];
    }
  }

  /**
   * Write all providers to MongoDB
   * Deletes all existing providers and inserts new ones
   * @private
   */
  async _writeAllProviders(providers) {
    try {
      const collection = this._database.getCollection('iptv_providers');
      const now = new Date();
      
      // Delete all existing providers
      await collection.deleteMany({});
      
      // Insert all new providers with timestamps
      if (providers.length > 0) {
        const providersWithTimestamps = providers.map(p => ({
          ...p,
          lastUpdated: now,
          createdAt: p.createdAt || now
        }));
        await collection.insertMany(providersWithTimestamps);
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

      // Trigger engine notification for provider created
      await this._notifyEngineProviderChanged(providerData.id, 'created', providerData);

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
            await this._database.removeProviderFromTitles(providerId);
          
          // removeProviderFromTitles already deletes title_streams, so no need to call deleteProviderTitleStreams
          const deletedEmptyTitles = await this._database.deleteTitlesWithoutStreams(titleKeys);
          
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
          const updatedCount = await this._database.resetProviderTitlesLastUpdated(providerId);
          this.logger.info(`Reset lastUpdated for ${updatedCount} provider titles for ${providerId}`);
        } catch (error) {
          this.logger.error(`Error resetting titles lastUpdated for provider ${providerId}: ${error.message}`);
        }
      }

      // Update in array and save
      providers[providerIndex] = updatedProvider;
      await this._writeAllProviders(providers);

      // Trigger engine notification based on changes
      if (enabledChanged) {
        const action = willBeEnabled ? 'enabled' : 'disabled';
        await this._notifyEngineProviderChanged(providerId, action, updatedProvider);
      } else {
        // General update (no state change)
        await this._notifyEngineProviderChanged(providerId, 'updated', updatedProvider);
      }

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

      // Perform cleanup operations using unified functions
      try {
        // 1. Remove provider from titles.streams (and delete title_streams)
        const { titlesUpdated, streamsRemoved, titleKeys } = 
          await this._database.removeProviderFromTitles(providerId);
        
        // 2. Delete all provider_titles for this provider (only on delete, not disable)
        const deletedTitles = await this._database.deleteProviderTitles(providerId);
        
        // 3. Delete titles without streams (optional, can be async/background)
        const deletedEmptyTitles = await this._database.deleteTitlesWithoutStreams(titleKeys);
        
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

      // Trigger engine notification for provider deleted
      await this._notifyEngineProviderChanged(providerId, 'deleted');

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
      return {
        response: { error: 'Failed to delete provider' },
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
      return {
        response: { error: 'Failed to update provider priorities' },
        statusCode: 500,
      };
    }
  }

  /**
   * Notify engine of provider change
   * @private
   * @param {string} providerId - Provider ID
   * @param {string} action - Action type: 'created' | 'deleted' | 'enabled' | 'disabled' | 'categories-changed' | 'updated'
   * @param {Object} [providerConfig] - Optional provider config (engine can fetch if needed)
   */
  async _notifyEngineProviderChanged(providerId, action, providerConfig = null) {
    try {
      const axios = (await import('axios')).default;
      const engineApiUrl = process.env.ENGINE_API_URL || 'http://127.0.0.1:3002';
      
      await axios.post(
        `${engineApiUrl}/api/providers/${providerId}/changed`,
        {
          action,
          providerId,
          ...(providerConfig && { providerConfig })
        },
        { timeout: 5000 }
      );
      
      this.logger.info(`Notified engine: provider ${providerId} ${action}`);
    } catch (error) {
      this.logger.error(`Failed to notify engine for provider ${providerId}: ${error.message}`);
      // Don't throw - provider operation should succeed even if engine notification fails
    }
  }
}

// Export class
export { ProvidersManager };