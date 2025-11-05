import { fromCollectionName, getCollectionKey } from '../config/collections.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('DatabaseService');

/**
 * Database service for file-based storage
 * Provides MongoDB-like interface but uses JSON files
 * Uses FileStorageService for file access (caching handled internally by FileStorageService)
 */
class DatabaseService {
  /**
   * @param {FileStorageService} fileStorage - File storage service instance
   */
  constructor(fileStorage) {
    this._isStopping = false;
    this._fileStorage = fileStorage;
  }

  setStopping(value) {
    this._isStopping = value;
  }

  /**
   * Get file path for collection
   * @private
   */
  _getCollectionPath(collectionName) {
    return this._fileStorage.getCollectionPath(collectionName);
  }

  /**
   * Match query object against data object
   * @private
   */
  _matchesQuery(item, query) {
    if (!query || Object.keys(query).length === 0) {
      return true;
    }

    for (const [key, value] of Object.entries(query)) {
      if (item[key] !== value) {
        return false;
      }
    }
    return true;
  }

  /**
   * Apply projection to object
   * @private
   */
  _applyProjection(item, projection) {
    if (!projection) {
      return item;
    }

    const result = {};
    for (const key of Object.keys(projection)) {
      if (projection[key] === 1 && item.hasOwnProperty(key)) {
        result[key] = item[key];
      }
    }
    return result;
  }

  /**
   * Get a single document by query
   */
  async getData(collectionName, query) {
    try {
      if (this._isStopping) {
        return null;
      }

      const filePath = this._getCollectionPath(collectionName);
      const items = await this._fileStorage.readJsonFile(filePath, collectionName);

      // Handle Map return type (when mapping is enabled)
      if (items instanceof Map) {
        // Find first matching item in Map
        for (const item of items.values()) {
          if (this._matchesQuery(item, query)) {
            return item;
          }
        }
        return null;
      }

      // Handle array return type (backward compatibility)
      for (const item of items) {
        if (this._matchesQuery(item, query)) {
          return item;
        }
      }
      return null;
    } catch (error) {
      logger.error(`Error getting data from collection ${collectionName}:`, error);
      return null;
    }
  }

  /**
   * Get multiple documents by query
   */
  async getDataList(collectionName, query = {}, projection = null, sort = null) {
    try {
      if (this._isStopping) {
        return null;
      }

      const filePath = this._getCollectionPath(collectionName);
      let items = await this._fileStorage.readJsonFile(filePath, collectionName);

      // Handle Map return type (when mapping is enabled)
      const isMap = items instanceof Map;
      const hasOperations = (query && Object.keys(query).length > 0) || projection || sort;
      
      // If Map and no operations needed, return Map directly
      if (isMap && !hasOperations) {
        return items;
      }

      // Convert Map to array for query/projection/sort operations
      if (isMap) {
        items = Array.from(items.values());
      }

      // Filter by query
      if (query && Object.keys(query).length > 0) {
        items = items.filter(item => this._matchesQuery(item, query));
      }

      // Apply projection
      if (projection) {
        items = items.map(item => this._applyProjection(item, projection));
      }

      // Apply sort
      if (sort) {
        items.sort((a, b) => {
          for (const [key, direction] of Object.entries(sort)) {
            const aVal = a[key];
            const bVal = b[key];
            if (aVal < bVal) return direction === 1 ? -1 : 1;
            if (aVal > bVal) return direction === 1 ? 1 : -1;
          }
          return 0;
        });
      }

      return items;
    } catch (error) {
      logger.error(`Error getting data list from collection ${collectionName}:`, error);
      return null;
    }
  }

  /**
   * Get item by ID using collection key
   */
  async getItemById(collectionName, itemId) {
    try {
      const collection = fromCollectionName(collectionName);
      const key = getCollectionKey(collection);
      const query = { [key]: itemId };
      return await this.getData(collectionName, query);
    } catch (error) {
      logger.error(`Error getting item by ID from collection ${collectionName}:`, error);
      return null;
    }
  }

  /**
   * Insert a single document
   */
  async insertData(collectionName, data) {
    try {
      if (this._isStopping) {
        return;
      }

      const collection = fromCollectionName(collectionName);
      const key = getCollectionKey(collection);
      const itemId = data[key];

      const filePath = this._getCollectionPath(collectionName);
      let items = await this._fileStorage.readJsonFile(filePath, collectionName);

      // Handle Map return type (when mapping is enabled)
      if (items instanceof Map) {
        items = Array.from(items.values());
      }

      // Check if item already exists
      const exists = items.some(item => item[key] === itemId);
      if (exists) {
        // Ignore duplicate (like MongoDB duplicate key error)
        return;
      }

      // Add new item
      items.push(data);
      await this._fileStorage.writeJsonFile(filePath, items);
    } catch (error) {
      logger.error(`Error inserting data into collection ${collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Insert multiple documents
   */
  async insertDataList(collectionName, dataItems) {
    try {
      if (this._isStopping) {
        return;
      }

      const collection = fromCollectionName(collectionName);
      const key = getCollectionKey(collection);

      const filePath = this._getCollectionPath(collectionName);
      let items = await this._fileStorage.readJsonFile(filePath, collectionName);

      // Handle Map return type (when mapping is enabled)
      if (items instanceof Map) {
        items = Array.from(items.values());
      }

      // Filter out duplicates
      const existingIds = new Set(items.map(item => item[key]));
      const newItems = dataItems.filter(item => !existingIds.has(item[key]));

      if (newItems.length > 0) {
        items.push(...newItems);
        await this._fileStorage.writeJsonFile(filePath, items);
      }
    } catch (error) {
      logger.error(`Error inserting data list into collection ${collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Update a single document
   */
  async updateData(collectionName, data, query) {
    try {
      if (this._isStopping) {
        return 0;
      }

      const collection = fromCollectionName(collectionName);
      const key = getCollectionKey(collection);

      const filePath = this._getCollectionPath(collectionName);
      let items = await this._fileStorage.readJsonFile(filePath, collectionName);

      // Handle Map return type (when mapping is enabled)
      if (items instanceof Map) {
        items = Array.from(items.values());
      }

      // Find and update matching item
      let modified = 0;
      for (let i = 0; i < items.length; i++) {
        if (this._matchesQuery(items[i], query)) {
          items[i] = { ...items[i], ...data };
          modified = 1;
          break;
        }
      }

      // If not found and upsert needed, insert
      if (modified === 0 && data[key]) {
        items.push({ ...data, ...query });
        modified = 1;
      }

      if (modified > 0) {
        await this._fileStorage.writeJsonFile(filePath, items);
      }

      return modified;
    } catch (error) {
      logger.error(`Error updating data in collection ${collectionName}:`, error);
      return 0;
    }
  }

  /**
   * Update multiple documents
   */
  async updateDataList(collectionName, data, query) {
    try {
      if (this._isStopping) {
        return;
      }

      const filePath = this._getCollectionPath(collectionName);
      let items = await this._fileStorage.readJsonFile(filePath, collectionName);

      // Handle Map return type (when mapping is enabled)
      if (items instanceof Map) {
        items = Array.from(items.values());
      }

      // Update all matching items
      let modified = false;
      for (let i = 0; i < items.length; i++) {
        if (this._matchesQuery(items[i], query)) {
          items[i] = { ...items[i], ...data };
          modified = true;
        }
      }

      if (modified) {
        await this._fileStorage.writeJsonFile(filePath, items);
      }
    } catch (error) {
      logger.error(`Error updating data list in collection ${collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Delete a single document
   */
  async deleteData(collectionName, query) {
    try {
      if (this._isStopping) {
        return;
      }

      const filePath = this._getCollectionPath(collectionName);
      let items = await this._fileStorage.readJsonFile(filePath, collectionName);

      // Handle Map return type (when mapping is enabled)
      if (items instanceof Map) {
        items = Array.from(items.values());
      }

      // Remove first matching item
      const index = items.findIndex(item => this._matchesQuery(item, query));
      if (index !== -1) {
        items.splice(index, 1);
        await this._fileStorage.writeJsonFile(filePath, items);
      }
    } catch (error) {
      logger.error(`Error deleting data from collection ${collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Delete multiple documents
   */
  async deleteDataList(collectionName, query) {
    try {
      if (this._isStopping) {
        return;
      }

      const filePath = this._getCollectionPath(collectionName);
      let items = await this._fileStorage.readJsonFile(filePath, collectionName);

      // Handle Map return type (when mapping is enabled)
      if (items instanceof Map) {
        items = Array.from(items.values());
      }

      // Remove all matching items
      const filtered = items.filter(item => !this._matchesQuery(item, query));

      if (filtered.length !== items.length) {
        await this._fileStorage.writeJsonFile(filePath, filtered);
      }
    } catch (error) {
      logger.error(`Error deleting data list from collection ${collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Get count of documents
   */
  async getCount(collectionName, query, limit = null) {
    try {
      if (this._isStopping) {
        return 0;
      }

      const filePath = this._getCollectionPath(collectionName);
      let items = await this._fileStorage.readJsonFile(filePath, collectionName);

      // Handle Map return type (when mapping is enabled)
      if (items instanceof Map) {
        items = Array.from(items.values());
      }

      // Filter by query
      if (query && Object.keys(query).length > 0) {
        items = items.filter(item => this._matchesQuery(item, query));
      }

      // Apply limit
      if (limit) {
        items = items.slice(0, limit);
      }

      return items.length;
    } catch (error) {
      logger.error(`Error getting count from collection ${collectionName}:`, error);
      return 0;
    }
  }

  /**
   * Get data keys only
   */
  async getDataKeys(collectionName, query) {
    try {
      if (this._isStopping) {
        return null;
      }

      const collection = fromCollectionName(collectionName);
      const key = getCollectionKey(collection);

      const filePath = this._getCollectionPath(collectionName);
      let items = await this._fileStorage.readJsonFile(filePath, collectionName);

      // Handle Map return type (when mapping is enabled)
      if (items instanceof Map) {
        items = Array.from(items.values());
      }

      // Filter by query
      if (query && Object.keys(query).length > 0) {
        items = items.filter(item => this._matchesQuery(item, query));
      }

      // Extract keys
      return items.map(item => item[key]);
    } catch (error) {
      logger.error(`Error getting data keys from collection ${collectionName}:`, error);
      return null;
    }
  }

  /**
   * Read JSON file as array (for arbitrary file paths, not just collections)
   * Uses FileStorageService for file access (caching handled internally)
   * @param {string} filePath - Full file path
   * @returns {Promise<Array>} Array of data
   */
  async readFile(filePath) {
    try {
      if (this._isStopping) {
        return [];
      }
      return await this._fileStorage.readJsonFile(filePath);
    } catch (error) {
      logger.error(`Error reading file ${filePath}:`, error);
      return [];
    }
  }

  /**
   * Read JSON file as object (for arbitrary file paths, not just collections)
   * Uses FileStorageService for file access (caching handled internally)
   * @param {string} filePath - Full file path
   * @returns {Promise<Object>} Object data
   */
  async readObject(filePath) {
    try {
      if (this._isStopping) {
        return {};
      }
      return await this._fileStorage.readJsonObject(filePath);
    } catch (error) {
      logger.error(`Error reading file ${filePath}:`, error);
      return {};
    }
  }

  /**
   * Write JSON file as array (for arbitrary file paths, not just collections)
   * Uses FileStorageService for file access (caching handled internally)
   * @param {string} filePath - Full file path
   * @param {Array} data - Data to write
   */
  async writeFile(filePath, data) {
    try {
      if (this._isStopping) {
        return;
      }
      await this._fileStorage.writeJsonFile(filePath, data);
    } catch (error) {
      logger.error(`Error writing file ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Write JSON file as object (for arbitrary file paths, not just collections)
   * Uses FileStorageService for file access (caching handled internally)
   * @param {string} filePath - Full file path
   * @param {Object} data - Data to write
   */
  async writeObject(filePath, data) {
    try {
      if (this._isStopping) {
        return;
      }
      await this._fileStorage.writeJsonObject(filePath, data);
    } catch (error) {
      logger.error(`Error writing file ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Get file path helper (for building paths)
   * @param {string} relativePath - Relative path from dataDir
   * @returns {string} Full file path
   */
  getFilePath(relativePath) {
    return this._fileStorage.getFilePath(relativePath);
  }

  /**
   * Create indices for users collection (no-op for file storage)
   * Indices are handled by application logic
   */
  async createIndices() {
    // No-op for file-based storage
    // Uniqueness is enforced by application logic
    return;
  }

  /**
   * Initialize database (ensure file storage is initialized)
   */
  async initialize() {
    await this._fileStorage.initialize();
    logger.info('Database service initialized');
  }
}

// Export class
export { DatabaseService };

