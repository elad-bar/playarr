import { BaseDomainManager } from './BaseDomainManager.js';
import { DatabaseCollections, DataProvider, toCollectionName } from '../../config/collections.js';
import slugify from 'slugify';
import { NotFoundError, ValidationError, ConflictError, AppError } from '../../errors/AppError.js';

/**
 * IPTV Provider Manager (Domain Manager)
 * Manages IPTV provider domain operations
 * One domain = one repository (ProviderRepository)
 */
class IPTVProviderManager extends BaseDomainManager {
  /**
   * @param {import('../../repositories/ProviderRepository.js').ProviderRepository} providerRepo - Provider repository
   */
  constructor(providerRepo) {
    super('IPTVProviderManager', providerRepo);
    this._providersCollection = toCollectionName(DatabaseCollections.IPTV_PROVIDERS);
    
    // Cache for providers - null = cache invalid/empty, Array = cached providers data
    this._cachedProviders = null;
  }

  /**
   * Read all providers from collection (with caching)
   * @private
   * @returns {Promise<Array<Object>>} Array of provider objects
   */
  async _readAllProviders() {
    // Return cached data if available
    if (this._cachedProviders !== null) {
      return this._cachedProviders;
    }

    try {
      const providers = await this._repository.findByQuery({});
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
   * @private
   * @param {Array<Object>} providers - Array of provider objects
   */
  async _writeAllProviders(providers) {
    try {
      const now = new Date();
      
      // Get all existing providers to identify which ones to update vs insert
      const existingProviders = await this._repository.findByQuery({});
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
        await this._repository.bulkWrite(operations);
      }
      
      this.logger.info(`Saved ${providers.length} providers to MongoDB`);
    } catch (error) {
      this.logger.error('Error writing providers to MongoDB:', error);
      throw error;
    }
  }

  /**
   * Normalize provider URLs
   * @private
   * @param {Object} providerData - Provider data
   * @param {Object} [existingProvider] - Existing provider (for updates)
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
   * Get IPTV provider types
   * @private
   * @returns {Array<string>} Array of valid provider types
   */
  _getIPTVProviderTypes() {
    return [DataProvider.AGTV, DataProvider.XTREAM];
  }

  /**
   * Get all IPTV providers
   * @returns {Promise<{providers: Array}>} Providers object
   * @throws {AppError} If an error occurs
   */
  async getProviders() {
    try {
      const providers = await this._readAllProviders();

      return { providers };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      this.logger.error('Error getting providers:', error);
      throw new AppError('Failed to get providers', 500);
    }
  }

  /**
   * Get a specific IPTV provider
   * @param {string} providerId - Provider ID
   * @returns {Promise<Object>} Provider object
   * @throws {NotFoundError} If provider not found
   * @throws {AppError} If an error occurs
   */
  async getProvider(providerId) {
    try {
      const providers = await this._readAllProviders();
      const provider = providers.find(p => p.id === providerId);

      if (!provider) {
        throw new NotFoundError('Provider not found');
      }

      return provider;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      this.logger.error('Error getting provider:', error);
      throw new AppError('Failed to get provider', 500);
    }
  }

  /**
   * Get enabled provider IDs
   * @param {Object} [options={}] - Options
   * @param {boolean} [options.excludeDeleted=true] - Exclude deleted providers
   * @returns {Promise<Array<string>>} Array of enabled provider IDs
   */
  async getEnabledProviderIds(options = {}) {
    try {
      const { excludeDeleted = true } = options;
      const providers = await this._readAllProviders();
      return providers
        .filter(p => {
          if (p.enabled === false) return false;
          if (excludeDeleted && p.deleted) return false;
          return true;
        })
        .map(p => p.id);
    } catch (error) {
      this.logger.error('Error getting enabled provider IDs:', error);
      return [];
    }
  }

  /**
   * Get enabled providers
   * @param {Object} [options={}] - Options
   * @param {boolean} [options.excludeDeleted=true] - Exclude deleted providers
   * @returns {Promise<Array<Object>>} Array of enabled provider objects
   */
  async getEnabledProviders(options = {}) {
    try {
      const { excludeDeleted = true } = options;
      const providers = await this._readAllProviders();
      return providers
        .filter(p => {
          if (p.enabled === false) return false;
          if (excludeDeleted && p.deleted) return false;
          return true;
        });
    } catch (error) {
      this.logger.error('Error getting enabled providers:', error);
      return [];
    }
  }

  /**
   * Get enabled providers as a Map
   * @param {Object} [options={}] - Options
   * @param {boolean} [options.excludeDeleted=true] - Exclude deleted providers
   * @returns {Promise<Map<string, Object>>} Map of provider ID to provider object
   */
  async getEnabledProvidersMap(options = {}) {
    try {
      const providers = await this.getEnabledProviders(options);
      const providersMap = new Map();
      for (const provider of providers) {
        if (provider.id) {
          providersMap.set(provider.id, provider);
        }
      }
      return providersMap;
    } catch (error) {
      this.logger.error('Error getting enabled providers map:', error);
      return new Map();
    }
  }

  /**
   * Create a new IPTV provider (domain operation only, no orchestration)
   * @param {Object} providerData - Provider data
   * @returns {Promise<Object>} Created provider object
   * @throws {ValidationError} If validation fails
   * @throws {ConflictError} If provider already exists
   * @throws {AppError} If an error occurs
   */
  async createProvider(providerData) {
    try {
      // Validate provider type
      const providerType = providerData.type;
      const validTypes = this._getIPTVProviderTypes();
      if (!validTypes.includes(providerType)) {
        throw new ValidationError(`Invalid provider type. Must be one of: ${validTypes.join(', ')}`);
      }

      // Require manual ID on creation (no auto-generation)
      const providedId = (providerData.id || '').trim();
      if (!providedId) {
        throw new ValidationError('Provider id is required and must be unique');
      }
      // Slugify provider ID once at creation - use consistently everywhere after
      providerData.id = slugify(providedId, { lower: true, strict: true });

      // Check if provider already exists
      const providers = await this._readAllProviders();
      if (providers.some(p => p.id === providerData.id)) {
        throw new ConflictError('Provider with this id already exists');
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
        const providerTypeLower = providerData.type.toLowerCase();
        if (providerTypeLower === 'agtv') {
          providerData.api_rate = {
            concurrent: 10,
            duration_seconds: 1
          };
        } else if (providerTypeLower === 'xtream') {
          providerData.api_rate = {
            concurrent: 4,
            duration_seconds: 1
          };
        }
      }

      // Initialize provider_details as null - syncProviderDetails job will populate it
      providerData.provider_details = null;

      // Add provider to array and save
      providers.push(providerData);
      await this._writeAllProviders(providers);

      // Update cache with new data (no need to re-read from DB)
      this._cachedProviders = providers;

      return providerData;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      this.logger.error('Error creating provider:', error);
      // Invalidate cache on error
      this._invalidateProvidersCache();
      throw new AppError('Failed to create provider', 500);
    }
  }

  /**
   * Update an existing IPTV provider (domain operation only, no orchestration)
   * @param {string} providerId - Provider ID
   * @param {Object} providerData - Provider data
   * @returns {Promise<Object>} Updated provider object
   * @throws {NotFoundError} If provider not found
   * @throws {AppError} If an error occurs
   */
  async updateProvider(providerId, providerData) {
    try {
      // Get all providers
      const providers = await this._readAllProviders();
      
      // Find the provider to update
      const providerIndex = providers.findIndex(p => p.id === providerId);

      if (providerIndex === -1) {
        throw new NotFoundError('Provider not found');
      }

      const existingProvider = providers[providerIndex];

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

      // Reset provider_details to null if credentials changed - syncProviderDetails job will repopulate it
      const credentialsChanged = 
        ('username' in providerData && providerData.username !== existingProvider.username) ||
        ('password' in providerData && providerData.password !== existingProvider.password) ||
        ('streams_urls' in providerData && JSON.stringify(providerData.streams_urls || []) !== JSON.stringify(existingProvider.streams_urls || []));
      
      if (credentialsChanged) {
        updatedProvider.provider_details = null;
        this.logger.debug(`Provider ${providerId} credentials changed, resetting provider_details for re-authentication`);
      }

      // Update in array and save
      providers[providerIndex] = updatedProvider;
      await this._writeAllProviders(providers);

      // Update cache with new data (no need to re-read from DB)
      this._cachedProviders = providers;

      return updatedProvider;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      this.logger.error('Error updating provider:', error);
      // Invalidate cache on error
      this._invalidateProvidersCache();
      throw new AppError('Failed to update provider', 500);
    }
  }

  /**
   * Delete an IPTV provider (domain operation only, no orchestration)
   * @param {string} providerId - Provider ID
   * @returns {Promise<void>} Resolves when provider is deleted
   * @throws {NotFoundError} If provider not found
   * @throws {AppError} If an error occurs
   */
  async deleteProvider(providerId) {
    try {
      // Load all providers
      const providers = await this._readAllProviders();
      const providerIndex = providers.findIndex(p => p.id === providerId);

      if (providerIndex === -1) {
        throw new NotFoundError('Provider not found');
      }

      const provider = providers[providerIndex];

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
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      this.logger.error('Error deleting provider:', error);
      // Invalidate cache on error
      this._invalidateProvidersCache();
      throw new AppError('Failed to delete provider', 500);
    }
  }

  /**
   * Update provider details (expiration, connections) for a specific provider
   * @param {string} providerId - Provider ID
   * @param {Object} details - Provider details object
   * @returns {Promise<{provider_id: string, provider_details: Object}>} Provider details object
   * @throws {NotFoundError} If provider not found
   * @throws {AppError} If an error occurs
   */
  async updateProviderDetails(providerId, details) {
    try {
      // Validate provider exists
      const providers = await this._readAllProviders();
      const provider = providers.find(p => p.id === providerId);

      if (!provider) {
        throw new NotFoundError('Provider not found');
      }

      // Build provider_details object with last_checked timestamp
      const providerDetails = {
        expiration_date: details.expiration_date ?? null,
        max_connections: details.max_connections ?? 0,
        active_connections: details.active_connections ?? 0,
        last_checked: new Date().toISOString()
      };

      // Optionally include last_error if provided
      if (details.last_error !== undefined) {
        providerDetails.last_error = details.last_error;
      }

      // Update database via direct repository update ($set operator)
      await this._repository.updateOne(
        { id: providerId },
        { $set: { provider_details: providerDetails } }
      );

      // Update in-memory cache directly (no invalidation needed)
      if (this._cachedProviders) {
        const cachedProvider = this._cachedProviders.find(p => p.id === providerId);
        if (cachedProvider) {
          cachedProvider.provider_details = providerDetails;
        }
      }

      this.logger.debug(`Updated provider details for ${providerId}`);

      return { provider_id: providerId, provider_details: providerDetails };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      this.logger.error(`Error updating provider details for ${providerId}:`, error);
      throw new AppError('Failed to update provider details', 500);
    }
  }

  /**
   * Get provider priorities
   * @returns {Promise<{providers: Array}>} Priorities object
   * @throws {AppError} If an error occurs
   */
  async getProviderPriorities() {
    try {
      const providers = await this._readAllProviders();
      const priorities = providers.map(p => ({
        id: p.id,
        priority: p.priority || 0
      }));

      return { providers: priorities };
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
   * @param {Object} prioritiesData - Priorities data
   * @returns {Promise<Object>} Priorities data object
   * @throws {AppError} If an error occurs
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

      return prioritiesData;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      this.logger.error('Error updating provider priorities:', error);
      // Invalidate cache on error
      this._invalidateProvidersCache();
      throw new AppError('Failed to update provider priorities', 500);
    }
  }

  /**
   * Update enabled categories for a provider (domain operation only, no orchestration)
   * @param {string} providerId - Provider ID
   * @param {Object} enabledCategories - Object with movies and tvshows arrays of category keys
   * @returns {Promise<{success: boolean, message: string, enabled_categories: Object}>} Success object
   * @throws {AppError} If an error occurs
   */
  async updateEnabledCategories(providerId, enabledCategories) {
    try {
      // Validate provider exists
      await this.getProvider(providerId);

      // Validate enabledCategories structure
      if (!enabledCategories || typeof enabledCategories !== 'object') {
        throw new ValidationError('enabledCategories must be an object with movies and tvshows arrays');
      }

      if (!Array.isArray(enabledCategories.movies) || !Array.isArray(enabledCategories.tvshows)) {
        throw new ValidationError('enabledCategories must have movies and tvshows arrays');
      }

      // Update provider document's enabled_categories field
      const now = new Date();
      
      await this._repository.updateOne(
        { id: providerId },
        {
          $set: {
            enabled_categories: {
              movies: enabledCategories.movies,
              tvshows: enabledCategories.tvshows
            },
            lastUpdated: now
          }
        }
      );

      // Invalidate cache (uses direct repository update, not _writeAllProviders)
      this._invalidateProvidersCache();

      return {
        success: true,
        message: 'Categories updated successfully',
        enabled_categories: enabledCategories
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      this.logger.error('Error updating enabled categories:', error);
      this._invalidateProvidersCache();
      throw new AppError('Failed to update categories', 500);
    }
  }

  /**
   * Invalidate cache (for orchestration managers to call)
   * @public
   */
  invalidateCache() {
    this._invalidateProvidersCache();
  }

  /**
   * Get all providers (for orchestration managers)
   * @public
   * @returns {Promise<Array<Object>>} Array of provider objects
   */
  async getAllProviders() {
    return await this._readAllProviders();
  }

  /**
   * Find providers by query (exposes repository method for Processing Managers)
   * @param {Object} query - MongoDB query object
   * @param {Object} [options] - Query options (sort, limit, skip, projection, etc.)
   * @returns {Promise<Array<Object>>} Array of provider documents
   */
  async findByQuery(query, options = {}) {
    return await this._repository.findByQuery(query, options);
  }
}

export { IPTVProviderManager };

