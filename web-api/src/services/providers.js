import { DatabaseCollections, DataProvider } from '../config/collections.js';
import { webSocketService } from './websocket.js';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get config directory from environment or use default
const CONFIG_DIR = process.env.CONFIG_DIR || path.join(__dirname, '../../configurations');
const PROVIDERS_DIR = path.join(CONFIG_DIR, 'providers');

/**
 * Providers service for handling IPTV provider operations
 * Reads/writes directly from configurations/providers/*.json files
 */
class ProvidersService {
  constructor() {
    this._providersDir = PROVIDERS_DIR;
    this._ensureProvidersDir();
  }

  /**
   * Ensure providers directory exists
   * @private
   */
  _ensureProvidersDir() {
    try {
      fs.ensureDirSync(this._providersDir);
    } catch (error) {
      console.error('Error ensuring providers directory:', error);
      throw error;
    }
  }

  /**
   * Get file path for a provider
   * @private
   */
  _getProviderFilePath(providerId) {
    return path.join(this._providersDir, `${providerId}.json`);
  }

  /**
   * Read all provider files
   * @private
   */
  async _readAllProviders() {
    try {
      await this._ensureProvidersDir();
      const files = await fs.readdir(this._providersDir);
      const providers = [];

      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this._providersDir, file);
          try {
            const provider = await fs.readJson(filePath);
            // Ensure id matches filename
            const providerId = file.replace('.json', '');
            provider.id = providerId;
            providers.push(provider);
          } catch (error) {
            console.error(`Error reading provider file ${file}:`, error);
          }
        }
      }

      return providers;
    } catch (error) {
      console.error('Error reading providers:', error);
      return [];
    }
  }

  /**
   * Write provider to file
   * @private
   */
  async _writeProvider(provider) {
    const filePath = this._getProviderFilePath(provider.id);
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeJson(filePath, provider, { spaces: 2 });
  }

  /**
   * Delete provider file
   * @private
   */
  async _deleteProvider(providerId) {
    const filePath = this._getProviderFilePath(providerId);
    if (await fs.pathExists(filePath)) {
      await fs.remove(filePath);
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
      console.error('Error getting providers:', error);
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
      const filePath = this._getProviderFilePath(providerId);
      
      if (!(await fs.pathExists(filePath))) {
        return {
          response: { error: 'Provider not found' },
          statusCode: 404,
        };
      }

      const provider = await fs.readJson(filePath);
      provider.id = providerId;

      return {
        response: provider,
        statusCode: 200,
      };
    } catch (error) {
      console.error('Error getting provider:', error);
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
      const filePath = this._getProviderFilePath(providedId);
      if (await fs.pathExists(filePath)) {
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
        const providersResponse = await this.getProviders();
        const maxPriority = Math.max(
          ...providersResponse.response.providers.map(p => p.priority || 0),
          0
        );
        providerData.priority = maxPriority + 1;
      }

      // Save provider
      await this._writeProvider(providerData);

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
      console.error('Error creating provider:', error);
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
      // Check if provider exists
      const filePath = this._getProviderFilePath(providerId);
      
      if (!(await fs.pathExists(filePath))) {
        return {
          response: { error: 'Provider not found' },
          statusCode: 404,
        };
      }

      const existingProvider = await fs.readJson(filePath);
      existingProvider.id = providerId;

      // Normalize URLs
      this._normalizeUrls(providerData, existingProvider);

      // Update provider data (preserve id)
      const updatedProvider = {
        ...existingProvider,
        ...providerData,
        id: providerId, // Ensure id doesn't change
      };

      // Save updated provider
      await this._writeProvider(updatedProvider);

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
      console.error('Error updating provider:', error);
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
      // Check if provider exists
      const filePath = this._getProviderFilePath(providerId);
      
      if (!(await fs.pathExists(filePath))) {
        return {
          response: { error: 'Provider not found' },
          statusCode: 404,
        };
      }

      // Delete provider
      await this._deleteProvider(providerId);

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
      console.error('Error deleting provider:', error);
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
      console.error('Error getting provider priorities:', error);
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
      const providers = prioritiesData.providers || [];

      // Update each provider's priority
      for (const provider of providers) {
        const providerId = provider.id;
        const priority = provider.priority;

        if (providerId && priority !== undefined && priority !== null) {
          const filePath = this._getProviderFilePath(providerId);
          if (await fs.pathExists(filePath)) {
            const existingProvider = await fs.readJson(filePath);
            existingProvider.priority = priority;
            existingProvider.id = providerId;
            await this._writeProvider(existingProvider);
          }
        }
      }

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
      console.error('Error updating provider priorities:', error);
      return {
        response: { error: 'Failed to update provider priorities' },
        statusCode: 500,
      };
    }
  }
}

// Export singleton instance
export const providersService = new ProvidersService();