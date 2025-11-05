import { databaseService } from './database.js';
import { DatabaseCollections, toCollectionName } from '../config/collections.js';

/**
 * Settings service for managing application settings
 * Matches Python's SettingsService
 */
class SettingsService {
  constructor() {
    this._settingsCollection = toCollectionName(DatabaseCollections.SETTINGS);
  }

  /**
   * Get a setting value
   * @param {string} key - Setting key
   * @returns {Promise<{response: object, statusCode: number}>}
   */
  async getSetting(key) {
    try {
      const query = { key };
      const data = await databaseService.getData(this._settingsCollection, query);
      
      return {
        response: { value: data?.token || null },
        statusCode: 200,
      };
    } catch (error) {
      console.error(`Error getting setting ${key}:`, error);
      return {
        response: { error: `Failed to get setting ${key}` },
        statusCode: 500,
      };
    }
  }

  /**
   * Set a setting value
   * @param {string} key - Setting key
   * @param {string} value - Setting value
   * @returns {Promise<{response: object, statusCode: number}>}
   */
  async setSetting(key, value) {
    try {
      const query = { key };
      const data = { key, token: value };

      const currentData = await databaseService.getData(this._settingsCollection, query);
      
      if (!currentData) {
        await databaseService.insertData(this._settingsCollection, data);
      } else {
        await databaseService.updateData(this._settingsCollection, data, query);
      }

      return {
        response: { value },
        statusCode: 200,
      };
    } catch (error) {
      console.error(`Error setting ${key}:`, error);
      return {
        response: { error: `Failed to set ${key}` },
        statusCode: 500,
      };
    }
  }

  /**
   * Delete a setting
   * @param {string} key - Setting key
   * @returns {Promise<{response: object, statusCode: number}>}
   */
  async deleteSetting(key) {
    try {
      const query = { key };
      await databaseService.deleteData(this._settingsCollection, query);
      
      return {
        response: { success: true },
        statusCode: 200,
      };
    } catch (error) {
      console.error(`Error deleting ${key}:`, error);
      return {
        response: { error: `Failed to delete ${key}` },
        statusCode: 500,
      };
    }
  }
}

// Export singleton instance
export const settingsService = new SettingsService();

