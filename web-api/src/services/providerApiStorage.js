import fs from 'fs-extra';
import path from 'path';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ProviderApiStorage');

/**
 * Provider API Storage Manager
 * Disk-based cache for provider API responses using StorageManager pattern
 * Stores cache files in: {CACHE_DIR}/{providerId}/{type}/{endpoint}/{filename}
 */
export class ProviderApiStorage {
  /**
   * Path mapping configuration for different endpoint types
   * @private
   * @type {Object<string, Function>}
   */
  _pathMappings = {
    categories: (providerId, type) => {
      const dirPath = path.join(this.cacheDir, providerId, 'categories');
      fs.ensureDirSync(dirPath);
      return path.join(dirPath, `${type}.json`);
    },
    metadata: (providerId, type) => {
      const dirPath = path.join(this.cacheDir, providerId, 'metadata');
      fs.ensureDirSync(dirPath);
      return path.join(dirPath, `${type}.json`);
    },
    extended: (providerId, type, params) => {
      if (!params.titleId) {
        throw new Error('titleId is required for extended endpoint');
      }
      const dirPath = path.join(this.cacheDir, providerId, 'extended', type);
      fs.ensureDirSync(dirPath);
      return path.join(dirPath, `${params.titleId}.json`);
    },
    m3u8: (providerId, type, params) => {
      const dirPath = path.join(this.cacheDir, providerId, type, 'metadata');
      fs.ensureDirSync(dirPath);
      const filename = params.page ? `list-${params.page}.m3u8` : 'list.m3u8';
      return path.join(dirPath, filename);
    }
  };

  /**
   * @param {string} cacheDir - Base cache directory path (from CACHE_DIR env var)
   */
  constructor(cacheDir) {
    this.cacheDir = cacheDir || process.env.CACHE_DIR || '/app/cache';
    this.logger = logger;
    
    // Ensure cache directory exists
    fs.ensureDirSync(this.cacheDir);
  }

  /**
   * Build cache file path from parts using path mapping configuration
   * @private
   * @param {string} providerId - Provider ID
   * @param {string} type - Media type (movies, tvshows)
   * @param {string} endpoint - Endpoint type (categories, metadata, extended, m3u8)
   * @param {Object} params - Additional parameters (titleId, page, etc.)
   * @returns {string} Full path to cache file
   */
  _buildPath(providerId, type, endpoint, params = {}) {
    const pathBuilder = this._pathMappings[endpoint];
    if (!pathBuilder) {
      throw new Error(`Unknown endpoint: ${endpoint}`);
    }
    return pathBuilder(providerId, type, params);
  }

  /**
   * Get TTL in hours for endpoint type
   * @private
   * @param {string} endpoint - Endpoint type
   * @param {string} type - Media type (for extended info)
   * @returns {number|null} TTL in hours, null for never expire
   */
  _getTTL(endpoint, type = null) {
    const ttlMap = {
      categories: 1, // 1 hour
      metadata: 1, // 1 hour
      extended: type === 'movies' ? null : 6, // null for movies (never), 6h for tvshows
      m3u8: 6 // 6 hours
    };
    
    return ttlMap[endpoint] || null;
  }

  /**
   * Check if cache file is expired
   * @private
   * @param {string} filePath - Path to cache file
   * @param {number|null} ttlHours - TTL in hours (null for never expire)
   * @returns {boolean} True if expired or doesn't exist
   */
  _isExpired(filePath, ttlHours) {
    if (!fs.existsSync(filePath)) {
      return true;
    }
    
    if (ttlHours === null) {
      return false; // Never expires
    }
    
    const stats = fs.statSync(filePath);
    const ageMs = Date.now() - stats.mtimeMs;
    const maxAgeMs = ttlHours * 60 * 60 * 1000;
    
    return ageMs >= maxAgeMs;
  }

  /**
   * Get cached data from disk
   * @param {string} providerId - Provider ID
   * @param {string} type - Media type
   * @param {string} endpoint - Endpoint type
   * @param {Object} params - Additional parameters
   * @returns {any|null} Cached data or null if not found/expired
   */
  get(providerId, type, endpoint, params = {}) {
    try {
      const filePath = this._buildPath(providerId, type, endpoint, params);
      const ttlHours = this._getTTL(endpoint, type);
      
      if (this._isExpired(filePath, ttlHours)) {
        return null;
      }
      
      // Read based on file extension
      if (filePath.endsWith('.m3u8')) {
        return fs.readFileSync(filePath, 'utf8');
      } else {
        return fs.readJsonSync(filePath);
      }
    } catch (error) {
      this.logger.error(`Error reading cache: ${error.message}`);
      return null;
    }
  }

  /**
   * Set cached data to disk
   * @param {string} providerId - Provider ID
   * @param {string} type - Media type
   * @param {string} endpoint - Endpoint type
   * @param {any} data - Data to cache
   * @param {Object} params - Additional parameters
   */
  set(providerId, type, endpoint, data, params = {}) {
    try {
      const filePath = this._buildPath(providerId, type, endpoint, params);
      
      // Write based on data type
      if (typeof data === 'string') {
        // M3U8 content
        fs.writeFileSync(filePath, data, 'utf8');
      } else {
        // JSON data
        fs.writeJsonSync(filePath, data, { spaces: 2 });
      }
      
      this.logger.debug(`Cached data to: ${filePath}`);
    } catch (error) {
      this.logger.error(`Error writing cache: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check if cache entry is expired
   * @param {string} providerId - Provider ID
   * @param {string} type - Media type
   * @param {string} endpoint - Endpoint type
   * @param {Object} params - Additional parameters
   * @returns {boolean} True if expired or not found
   */
  isExpired(providerId, type, endpoint, params = {}) {
    try {
      const filePath = this._buildPath(providerId, type, endpoint, params);
      const ttlHours = this._getTTL(endpoint, type);
      return this._isExpired(filePath, ttlHours);
    } catch (error) {
      return true; // Treat errors as expired
    }
  }

  /**
   * Clear all cache entries for a provider
   * @param {string} providerId - Provider ID
   */
  clearProviderCache(providerId) {
    try {
      const providerCacheDir = path.join(this.cacheDir, providerId);
      
      if (fs.existsSync(providerCacheDir)) {
        fs.removeSync(providerCacheDir);
        this.logger.info(`Cleared cache directory for provider ${providerId}`);
      } else {
        this.logger.debug(`No cache directory found for provider ${providerId}`);
      }
    } catch (error) {
      this.logger.error(`Error clearing cache for provider ${providerId}: ${error.message}`);
      throw error;
    }
  }
}

