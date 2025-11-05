import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createLogger } from '../utils/logger.js';

// Load environment variables before DATA_DIR is evaluated (since imports are hoisted)
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get data directory from environment or use default
// Path: from web-api/src/services/ to root: ../../../data
export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../../data');

const logger = createLogger('FileStorage');

/**
 * File-based storage service for API data
 * Uses the same data directories as the engine
 * Handles file I/O operations with internal caching via CacheService
 */
class FileStorageService {
  /**
   * @param {CacheService} cacheService - Cache service instance for internal caching
   */
  constructor(cacheService) {
    this._cache = cacheService;
    this.dataDir = DATA_DIR;
    this._ensureDirectories();
    
    // File mapping configuration: maps collection names to key fields for array-to-map conversion
    // When a file is loaded as an array, it will be automatically converted to a Map
    this._fileMappings = new Map([
      // Map titles collection to use title_key as the key
      ['titles', 'title_key'],
    ]);
  }

  /**
   * Ensure required directories exist
   * @private
   */
  _ensureDirectories() {
    try {
      fs.ensureDirSync(this.dataDir);
      fs.ensureDirSync(path.join(this.dataDir, 'settings'));
    } catch (error) {
      logger.error('Error ensuring directories:', error);
      throw error;
    }
  }

  /**
   * Get file path for a collection
   * @param {string} collectionName - Collection name (may be slugified)
   * @returns {string} File path
   */
  getCollectionPath(collectionName) {
    // Map collection names to file paths
    const collectionMap = {
      'users': path.join(this.dataDir, 'settings', 'users.json'),
      'settings': path.join(this.dataDir, 'settings', 'settings.json'),
      'stats': path.join(this.dataDir, 'stats.json'),
      'iptv-providers': path.join(this.dataDir, 'settings', 'iptv-providers.json'),
      'titles': path.join(this.dataDir, 'titles', 'main.json'), // Main titles file
    };

    // Handle provider-specific collections
    // Collection name format: "{providerId}.{collectionType}" (not slugified, uses dots)
    // File path format: "data/{directory}/{providerId}.{collectionType}.json"
    
    // Provider categories: categories/{providerId}.categories.json
    if (collectionName.endsWith('.categories')) {
      const providerId = collectionName.replace('.categories', '');
      return path.join(this.dataDir, 'categories', `${providerId}.categories.json`);
    }
    
    // Provider titles: titles/{providerId}.titles.json
    if (collectionName.endsWith('.titles')) {
      const providerId = collectionName.replace('.titles', '');
      return path.join(this.dataDir, 'titles', `${providerId}.titles.json`);
    }
    
    // Provider ignored: titles/{providerId}.ignored.json
    if (collectionName.endsWith('.ignored')) {
      const providerId = collectionName.replace('.ignored', '');
      return path.join(this.dataDir, 'titles', `${providerId}.ignored.json`);
    }

    return collectionMap[collectionName] || path.join(this.dataDir, `${collectionName}.json`);
  }

  /**
   * Get file path for a specific file (for provider-specific or custom files)
   * @param {string} relativePath - Relative path from dataDir (e.g., 'titles/main.json' or 'categories/provider.json')
   * @returns {string} Full file path
   */
  getFilePath(relativePath) {
    return path.join(this.dataDir, relativePath);
  }

  /**
   * Register a file mapping for automatic array-to-map conversion
   * @param {string} collectionName - Collection name
   * @param {string} keyField - Field name to use as the key in the Map
   */
  registerFileMapping(collectionName, keyField) {
    this._fileMappings.set(collectionName, keyField);
  }

  /**
   * Get the key field for a collection name
   * @private
   * @param {string} collectionName - Collection name
   * @returns {string|null} Key field name, or null if no mapping exists
   */
  _getMappingKey(collectionName) {
    return this._fileMappings.get(collectionName) || null;
  }

  /**
   * Convert array to Map using specified key field
   * @private
   * @param {Array} array - Array to convert
   * @param {string} keyField - Field name to use as key
   * @returns {Map} Map with keyField values as keys
   */
  _arrayToMap(array, keyField) {
    const map = new Map();
    for (const item of array) {
      if (item && item[keyField] !== undefined) {
        map.set(item[keyField], item);
      }
    }
    return map;
  }

  /**
   * Read JSON file, return empty array if file doesn't exist
   * Uses internal cache to avoid repeated disk reads
   * If a mapping is configured, arrays are automatically converted to Maps
   * @param {string} filePath - File path
   * @param {string} [collectionName] - Optional collection name for mapping lookup
   * @returns {Promise<Array|Map>} Array of data, or Map if mapping is configured
   */
  async readJsonFile(filePath, collectionName = null) {
    try {
      // Check cache first
      const cached = this._cache.get(filePath);
      if (cached !== undefined) {
        return cached;
      }

      // Read from disk if not cached
      let data = [];
      if (await fs.pathExists(filePath)) {
        const content = await fs.readJson(filePath);
        // Handle both array and object formats
        data = Array.isArray(content) ? content : [];
      }

      // Check if mapping is configured for this collection
      // Try to infer collection name from file path if not provided
      let mappingKey = null;
      if (collectionName) {
        mappingKey = this._getMappingKey(collectionName);
      } else {
        // Try to infer from file path (e.g., 'titles/main.json' -> 'titles')
        const fileName = path.basename(filePath, '.json');
        if (fileName === 'main') {
          const dirName = path.basename(path.dirname(filePath));
          mappingKey = this._getMappingKey(dirName);
        }
      }

      // Convert array to Map if mapping is configured
      if (mappingKey && Array.isArray(data) && data.length > 0) {
        const mappedData = this._arrayToMap(data, mappingKey);
        this._cache.set(filePath, mappedData);
        return mappedData;
      }

      // Store in cache as-is (array)
      this._cache.set(filePath, data);
      return data;
    } catch (error) {
      logger.error(`Error reading file ${filePath}:`, error);
      return [];
    }
  }

  /**
   * Read JSON file without caching (for provider-specific data loaded ad-hoc)
   * Alias for readJsonFile - kept for clarity and backward compatibility
   * @param {string} filePath - File path
   * @returns {Promise<Array>} Array of data
   */
  async readJsonFileNoCache(filePath) {
    return this.readJsonFile(filePath);
  }

  /**
   * Read JSON file as object, return empty object if file doesn't exist
   * Uses internal cache to avoid repeated disk reads
   * @param {string} filePath - File path
   * @returns {Promise<Object>} Object data
   */
  async readJsonObject(filePath) {
    try {
      // Check cache first
      const cached = this._cache.get(filePath);
      if (cached !== undefined) {
        return cached;
      }

      // Read from disk if not cached
      let data = {};
      if (await fs.pathExists(filePath)) {
        data = await fs.readJson(filePath);
      }

      // Store in cache
      this._cache.set(filePath, data);

      return data;
    } catch (error) {
      logger.error(`Error reading file ${filePath}:`, error);
      return {};
    }
  }

  /**
   * Read JSON file as object without caching (for provider-specific data loaded ad-hoc)
   * Alias for readJsonObject - kept for clarity and backward compatibility
   * @param {string} filePath - File path
   * @returns {Promise<Object>} Object data
   */
  async readJsonObjectNoCache(filePath) {
    return this.readJsonObject(filePath);
  }

  /**
   * Write JSON file atomically (as array)
   * Automatically invalidates cache after write
   * @param {string} filePath - File path
   * @param {*} data - Data to write
   */
  async writeJsonFile(filePath, data) {
    try {
      await fs.ensureDir(path.dirname(filePath));
      // Write to temp file first, then rename (atomic operation)
      const tempPath = `${filePath}.tmp`;
      await fs.writeJson(tempPath, data, { spaces: 2 });
      await fs.move(tempPath, filePath, { overwrite: true });

      // Invalidate cache after write
      this._cache.delete(filePath);
    } catch (error) {
      logger.error(`Error writing file ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Write JSON file atomically (as object)
   * Automatically invalidates cache after write
   * @param {string} filePath - File path
   * @param {Object} data - Data to write
   */
  async writeJsonObject(filePath, data) {
    return this.writeJsonFile(filePath, data);
  }

  /**
   * Initialize file storage (ensure directories exist)
   */
  async initialize() {
    this._ensureDirectories();
    logger.info(`File storage initialized at ${this.dataDir}`);
    return true;
  }
}

// Export class only
export { FileStorageService };

