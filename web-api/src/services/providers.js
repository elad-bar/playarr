import { DatabaseCollections, DataProvider } from '../config/collections.js';
import { webSocketService } from './websocket.js';
import { createLogger } from '../utils/logger.js';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get config directory from environment or use default
// Path: from web-api/src/services/ to root: ../../../data/settings
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../../data');
const PROVIDERS_FILE = path.join(DATA_DIR, 'settings', 'iptv-providers.json');

const logger = createLogger('ProvidersService');

/**
 * Providers service for handling IPTV provider operations
 * Reads/writes from data/settings/iptv-providers.json (single file with array of providers)
 */
class ProvidersService {
  constructor() {
    this._providersFile = PROVIDERS_FILE;
    this._ensureProvidersFile();
  }

  /**
   * Ensure providers file and directory exist
   * @private
   */
  _ensureProvidersFile() {
    try {
      fs.ensureDirSync(path.dirname(this._providersFile));
      // Create empty array file if it doesn't exist
      if (!fs.pathExistsSync(this._providersFile)) {
        fs.writeJsonSync(this._providersFile, [], { spaces: 2 });
      }
    } catch (error) {
      logger.error('Error ensuring providers file:', error);
      throw error;
    }
  }

  /**
   * Get IPTV provider types
   */
  _getIPTVProviderTypes() {
    return [DataProvider.AGTV, DataProvider.XTREAM];
  }

  /**
   * Normalize provider URLs (backward compatibility)
   */
  _normalizeUrls(providerData, existingProvider = null) {
    const providerType = providerData.type || (existingProvider ? existingProvider.type : null);
    let urls = providerData.urls || providerData.streams_urls || (existingProvider ? (existingProvider.urls || existingProvider.streams_urls) : null);
    const url = providerData.url || providerData.api_url || (existingProvider ? (existingProvider.url || existingProvider.api_url) : null);

    // If no urls array, create from single url
    if (!urls || urls.length === 0) {
      urls = url ? [url] : [];
    }

    // Only Xtream supports multiple stream URLs
    if (providerType !== DataProvider.XTREAM && urls.length > 1) {
      urls = urls.slice(0, 1);
    }

    // First URL mirrors API url field
    if (urls.length > 0) {
      providerData.api_url = urls[0];
      providerData.url = urls[0]; // For backward compatibility
    }

    providerData.streams_urls = urls;
    providerData.urls = urls; // For backward compatibility
    return providerData;
  }

  /**
   * Read all providers from file
   * @private
   */
  async _readAllProviders() {
    try {
      await this._ensureProvidersFile();
      if (await fs.pathExists(this._providersFile)) {
        const providers = await fs.readJson(this._providersFile);
        return Array.isArray(providers) ? providers : [];
      }
      return [];
    } catch (error) {
      logger.error('Error reading providers:', error);
      return [];
    }
  }

  /**
   * Write all providers to file
   * @private
   */
  async _writeAllProviders(providers) {
    await this._ensureProvidersFile();
    // Write to temp file first, then rename (atomic operation)
    const tempPath = `${this._providersFile}.tmp`;
    await fs.writeJson(tempPath, providers, { spaces: 2 });
    await fs.move(tempPath, this._providersFile, { overwrite: true });
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
      logger.error('Error getting providers:', error);
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
      logger.error('Error getting provider:', error);
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
      providerData.id = providedId;

      // Check if provider already exists
      const providers = await this._readAllProviders();
      if (providers.some(p => p.id === providedId)) {
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

      // Add provider to array and save
      providers.push(providerData);
      await this._writeAllProviders(providers);

      // Broadcast WebSocket event
      webSocketService.broadcastEvent('provider_changed', {
        provider_id: providerData.id,
        action: 'created'
      });

      return {
        response: providerData,
        statusCode: 201,
      };
    } catch (error) {
      logger.error('Error creating provider:', error);
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
      // Load all providers
      const providers = await this._readAllProviders();
      const providerIndex = providers.findIndex(p => p.id === providerId);

      if (providerIndex === -1) {
        return {
          response: { error: 'Provider not found' },
          statusCode: 404,
        };
      }

      const existingProvider = providers[providerIndex];

      // Normalize URLs
      this._normalizeUrls(providerData, existingProvider);

      // Update provider data (preserve id)
      const updatedProvider = {
        ...existingProvider,
        ...providerData,
        id: providerId, // Ensure id doesn't change
      };

      // Update in array and save
      providers[providerIndex] = updatedProvider;
      await this._writeAllProviders(providers);

      // Broadcast WebSocket event
      webSocketService.broadcastEvent('provider_changed', {
        provider_id: providerId,
        action: 'updated'
      });

      return {
        response: updatedProvider,
        statusCode: 200,
      };
    } catch (error) {
      logger.error('Error updating provider:', error);
      return {
        response: { error: 'Failed to update provider' },
        statusCode: 500,
      };
    }
  }

  /**
   * Delete an IPTV provider
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

      // Remove provider from array and save
      providers.splice(providerIndex, 1);
      await this._writeAllProviders(providers);

      // Broadcast WebSocket event
      webSocketService.broadcastEvent('provider_changed', {
        provider_id: providerId,
        action: 'deleted'
      });

      return {
        response: {},
        statusCode: 204,
      };
    } catch (error) {
      logger.error('Error deleting provider:', error);
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
      logger.error('Error getting provider priorities:', error);
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
      webSocketService.broadcastEvent('provider_changed', {
        provider_id: 'all',
        action: 'updated'
      });

      return {
        response: prioritiesData,
        statusCode: 200,
      };
    } catch (error) {
      logger.error('Error updating provider priorities:', error);
      return {
        response: { error: 'Failed to update provider priorities' },
        statusCode: 500,
      };
    }
  }
}

// Export singleton instance
export const providersService = new ProvidersService();