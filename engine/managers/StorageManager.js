import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Storage manager for storing and retrieving cached data
 * Handles path building, validation, and file operations
 */
export class StorageManager {
  /**
   * @param {string} storageDir - Base storage directory path
   * @param {boolean} [wrapData=false] - If true, wraps data in {data: ..., metadata: ...} format (for cache directory)
   */
  constructor(storageDir, wrapData = false) {
    this.storageDir = storageDir;
    this.wrapData = wrapData;
    this.logger = createLogger('StorageManager');
    this.cachePolicyPath = path.join(__dirname, '../../data/settings/cache-policy.json');
  }

  /**
   * Convert cache key parts to file path
   * @private
   * @param {...string} keyParts - Variable number of path parts (all parts except last are directories, last is filename)
   * @returns {string} Full path to cache file
   */
  _buildPath(...keyParts) {
    if (keyParts.length === 0) {
      throw new Error('At least one key part is required');
    }

    const fileName = keyParts[keyParts.length - 1];
    const directoryParts = keyParts.slice(0, -1);
    
    // Last part must be a filename with extension
    if (!fileName.includes('.')) {
      throw new Error(`Last part must be a filename with extension, got: ${fileName}`);
    }

    // Build directory path
    const dir = path.join(this.storageDir, ...directoryParts);
    fs.ensureDirSync(dir);
    
    // Return full file path - lastPart is already filename with extension
    return path.join(dir, fileName);
  }

  /**
   * Build cache policy key from keyParts (excluding filename)
   * @private
   * @param {...string} keyParts - Cache key parts
   * @returns {string} Policy key (e.g., "tmdb/search/movie")
   */
  _buildPolicyKey(...keyParts) {
    if (keyParts.length === 0) {
      throw new Error('At least one key part is required');
    }

    // Exclude filename (last part) and join remaining parts with '/'
    const directoryParts = keyParts.slice(0, -1);
    return directoryParts.join('/');
  }

  /**
   * Load cache policy file
   * @private
   * @returns {Object} Cache policy object
   */
  _loadCachePolicy() {
    try {
      if (fs.existsSync(this.cachePolicyPath)) {
        return fs.readJsonSync(this.cachePolicyPath);
      }
      return {};
    } catch (error) {
      this.logger.error(`Error loading cache policy: ${error.message}`);
      return {};
    }
  }

  /**
   * Update cache policy file with new TTL value
   * @private
   * @param {string} policyKey - Policy key (e.g., "tmdb/search/movie")
   * @param {number|null} ttlHours - TTL in hours (null for Infinity)
   */
  _updateCachePolicy(policyKey, ttlHours) {
    try {
      const policy = this._loadCachePolicy();
      
      // Only update if key doesn't exist or value changed
      if (!policy.hasOwnProperty(policyKey) || policy[policyKey] !== ttlHours) {
        policy[policyKey] = ttlHours;
        fs.writeJsonSync(this.cachePolicyPath, policy, { spaces: 2 });
        this.logger.debug(`Updated cache policy: ${policyKey} = ${ttlHours === null ? 'Infinity' : `${ttlHours}h`}`);
      }
    } catch (error) {
      this.logger.error(`Error updating cache policy: ${error.message}`);
      // Don't throw - policy update failure shouldn't break caching
    }
  }

  /**
   * Get TTL value for a cache key from policy
   * @param {...string} keyParts - Cache key parts
   * @returns {number|null} TTL in hours (null for Infinity), or null if not found
   */
  getCacheTTL(...keyParts) {
    const policyKey = this._buildPolicyKey(...keyParts);
    const policy = this._loadCachePolicy();
    return policy[policyKey] ?? null;
  }

  /**
   * Check if cache is valid (exists and not expired)
   * @param {number} [maxAgeHours=24] - Maximum age in hours before cache is considered invalid
   * @param {...string} keyParts - Cache key parts (providerId is optional)
   * @returns {boolean} True if cache is valid, false otherwise
   */
  isValid(maxAgeHours = 24, ...keyParts) {
    try {
      const cachePath = this._buildPath(...keyParts);
      if (!fs.existsSync(cachePath)) {
        return false;
      }

      const stats = fs.statSync(cachePath);
      const ageMs = Date.now() - stats.mtimeMs;
      const maxAgeMs = maxAgeHours * 60 * 60 * 1000;

      return ageMs < maxAgeMs;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get data from cache
   * @param {...string} keyParts - Cache key parts (providerId is optional)
   * @returns {*|null} Cached data or null if cache doesn't exist
   */
  get(...keyParts) {
    try {
      const cachePath = this._buildPath(...keyParts);
      if (!fs.existsSync(cachePath)) {
        return null;
      }

      const cacheData = fs.readJsonSync(cachePath);
      // If wrapData is false, return data directly (no wrapper)
      // Handle old files that might still have wrapper for backward compatibility
      if (!this.wrapData) {
        // If old format with wrapper, unwrap it
        return cacheData.data !== undefined ? cacheData.data : cacheData;
      }
      // If wrapData is true, unwrap from {data: ..., metadata: ...} format
      return cacheData.data || cacheData; // Support both formats for backward compatibility
    } catch (error) {
      this.logger.error(`Error loading cache: ${error.message}`);
      return null;
    }
  }

  /**
   * Set data in cache
   * @param {*} data - Data to cache
   * @param {number|null} [ttlHours] - TTL in hours (null for Infinity). If not provided, will use policy or default.
   * @param {...string} keyParts - Cache key parts (providerId is optional)
   * @throws {Error} If cache save fails
   */
  set(data, ttlHours, ...keyParts) {
    // Handle case where ttlHours is not provided (backward compatibility)
    if (typeof ttlHours !== 'number' && ttlHours !== null) {
      // ttlHours is actually the first keyPart
      keyParts = [ttlHours, ...keyParts];
      ttlHours = undefined;
    }

    if (keyParts.length === 0) {
      throw new Error('At least one key part is required');
    }

    try {
      const cachePath = this._buildPath(...keyParts);
      // If wrapData is false, save data directly without wrapper
      // If wrapData is true, wrap in {data: ..., metadata: ...} format
      if (!this.wrapData) {
        fs.writeJsonSync(cachePath, data, { spaces: 2 });
      } else {
        const cacheData = {
          data,
          metadata: {
            storedAt: new Date().toISOString()
          }
        };
        fs.writeJsonSync(cachePath, cacheData, { spaces: 2 });
      }

      // Update cache policy if TTL is provided
      if (ttlHours !== undefined) {
        const policyKey = this._buildPolicyKey(...keyParts);
        this._updateCachePolicy(policyKey, ttlHours);
      }
    } catch (error) {
      this.logger.error(`Error saving cache: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get metadata from cache file
   * @param {...string} keyParts - Cache key parts (providerId is optional)
   * @returns {Object|null} Cache metadata or null if cache doesn't exist
   */
  getMetadata(...keyParts) {
    try {
      const cachePath = this._buildPath(...keyParts);
      if (!fs.existsSync(cachePath)) {
        return null;
      }

      const cacheData = fs.readJsonSync(cachePath);
      return cacheData.metadata || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Save raw text data (like M3U8) to cache
   * @param {string} textData - Text data to cache
   * @param {number|null} [ttlHours] - TTL in hours (null for Infinity). If not provided, will use policy or default.
   * @param {...string} keyParts - Cache key parts (last part should be 'filename.ext' format, e.g., 'movies.m3u8')
   * @throws {Error} If cache save fails
   */
  setText(textData, ttlHours, ...keyParts) {
    // Handle case where ttlHours is not provided (backward compatibility)
    if (typeof ttlHours !== 'number' && ttlHours !== null) {
      // ttlHours is actually the first keyPart
      keyParts = [ttlHours, ...keyParts];
      ttlHours = undefined;
    }

    try {
      const cachePath = this._buildPath(...keyParts);
      fs.writeFileSync(cachePath, textData, 'utf8');

      // Update cache policy if TTL is provided
      if (ttlHours !== undefined) {
        const policyKey = this._buildPolicyKey(...keyParts);
        this._updateCachePolicy(policyKey, ttlHours);
      }
    } catch (error) {
      this.logger.error(`Error saving text cache: ${error.message}`);
      throw error;
    }
  }

  /**
   * Load raw text data (like M3U8) from cache
   * @param {...string} keyParts - Cache key parts (last part should be 'filename.ext' format, e.g., 'movies.m3u8')
   * @returns {string|null} Cached text data or null if cache doesn't exist
   */
  getText(...keyParts) {
    try {
      const cachePath = this._buildPath(...keyParts);
      if (!fs.existsSync(cachePath)) {
        return null;
      }
      return fs.readFileSync(cachePath, 'utf8');
    } catch (error) {
      this.logger.error(`Error loading text cache: ${error.message}`);
      return null;
    }
  }

  /**
   * Clear cache for specific key parts (e.g., all cache for a provider)
   * @param {...string} keyParts - Cache key parts (providerId is optional)
   */
  clear(...keyParts) {
    try {
      const cachePath = this._buildPath(...keyParts);
      const targetPath = fs.existsSync(cachePath) && fs.statSync(cachePath).isDirectory()
        ? cachePath
        : path.dirname(cachePath);
      
      if (fs.existsSync(targetPath)) {
        fs.removeSync(targetPath);
      }
    } catch (error) {
      this.logger.error(`Error clearing cache: ${error.message}`);
    }
  }
}

