import { getDatabase } from '../config/database.js';
import { fromCollectionName, getCollectionKey } from '../config/collections.js';
import fs from 'fs-extra';
import path from 'path';

/**
 * Database service for file-based storage
 * Provides MongoDB-like interface but uses JSON files
 */
class DatabaseService {
  constructor() {
    this._isStopping = false;
    this._fileStorage = getDatabase();
  }

  setStopping(value) {
    this._isStopping = value;
  }

  /**
   * Get file path for collection
   * @private
   */
  _getCollectionPath(collectionName) {
    return this._fileStorage._getCollectionPath(collectionName);
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
      const items = await this._fileStorage._readJsonFile(filePath);

      // Find first matching item
      for (const item of items) {
        if (this._matchesQuery(item, query)) {
          return item;
        }
      }
      return null;
    } catch (error) {
      console.error(`Error getting data from collection ${collectionName}:`, error);
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
      let items = await this._fileStorage._readJsonFile(filePath);

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
      console.error(`Error getting data list from collection ${collectionName}:`, error);
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
      console.error(`Error getting item by ID from collection ${collectionName}:`, error);
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
      const items = await this._fileStorage._readJsonFile(filePath);

      // Check if item already exists
      const exists = items.some(item => item[key] === itemId);
      if (exists) {
        // Ignore duplicate (like MongoDB duplicate key error)
        return;
      }

      // Add new item
      items.push(data);
      await this._fileStorage._writeJsonFile(filePath, items);
    } catch (error) {
      console.error(`Error inserting data into collection ${collectionName}:`, error);
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
      const items = await this._fileStorage._readJsonFile(filePath);

      // Filter out duplicates
      const existingIds = new Set(items.map(item => item[key]));
      const newItems = dataItems.filter(item => !existingIds.has(item[key]));

      if (newItems.length > 0) {
        items.push(...newItems);
        await this._fileStorage._writeJsonFile(filePath, items);
      }
    } catch (error) {
      console.error(`Error inserting data list into collection ${collectionName}:`, error);
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
      const items = await this._fileStorage._readJsonFile(filePath);

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
        await this._fileStorage._writeJsonFile(filePath, items);
      }

      return modified;
    } catch (error) {
      console.error(`Error updating data in collection ${collectionName}:`, error);
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
      const items = await this._fileStorage._readJsonFile(filePath);

      // Update all matching items
      let modified = false;
      for (let i = 0; i < items.length; i++) {
        if (this._matchesQuery(items[i], query)) {
          items[i] = { ...items[i], ...data };
          modified = true;
        }
      }

      if (modified) {
        await this._fileStorage._writeJsonFile(filePath, items);
      }
    } catch (error) {
      console.error(`Error updating data list in collection ${collectionName}:`, error);
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
      const items = await this._fileStorage._readJsonFile(filePath);

      // Remove first matching item
      const index = items.findIndex(item => this._matchesQuery(item, query));
      if (index !== -1) {
        items.splice(index, 1);
        await this._fileStorage._writeJsonFile(filePath, items);
      }
    } catch (error) {
      console.error(`Error deleting data from collection ${collectionName}:`, error);
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
      const items = await this._fileStorage._readJsonFile(filePath);

      // Remove all matching items
      const filtered = items.filter(item => !this._matchesQuery(item, query));

      if (filtered.length !== items.length) {
        await this._fileStorage._writeJsonFile(filePath, filtered);
      }
    } catch (error) {
      console.error(`Error deleting data list from collection ${collectionName}:`, error);
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
      let items = await this._fileStorage._readJsonFile(filePath);

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
      console.error(`Error getting count from collection ${collectionName}:`, error);
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
      let items = await this._fileStorage._readJsonFile(filePath);

      // Filter by query
      if (query && Object.keys(query).length > 0) {
        items = items.filter(item => this._matchesQuery(item, query));
      }

      // Extract keys
      return items.map(item => item[key]);
    } catch (error) {
      console.error(`Error getting data keys from collection ${collectionName}:`, error);
      return null;
    }
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
}

// Export singleton instance
export const databaseService = new DatabaseService();