import { createLogger } from '../utils/logger.js';
import { DatabaseCollections, toCollectionName } from '../config/collections.js';

const logger = createLogger('SettingsManager');

/**
 * Settings manager for managing application settings
 * Matches Python's SettingsService
 * Uses DatabaseService collection-based methods for all data access
 */
class SettingsManager {
  /**
   * @param {import('../services/database.js').DatabaseService} database - Database service instance
   */
  constructor(database) {
    this._database = database;
    this._settingsCollection = toCollectionName(DatabaseCollections.SETTINGS);
  }

  /**
   * Read settings from collection
   * Uses DatabaseService collection-based methods
   * @private
   * @returns {Promise<Object>} Settings object
   */
  async _readSettings() {
    try {
      const settingsArray = await this._database.getDataList(this._settingsCollection);
      // Convert array to object
      const settings = {};
      for (const setting of settingsArray) {
        settings[setting.key] = setting.value;
      }
      return settings;
    } catch (error) {
      logger.error(`Error reading settings: ${error.message}`);
      return {};
    }
  }

  /**
   * Write settings to collection
   * Uses DatabaseService collection-based methods
   * @private
   * @param {Object} settings - Settings object to write
   */
  async _writeSettings(settings) {
    try {
      // Convert object to array format
      const settingsArray = Object.entries(settings).map(([key, value]) => ({
        key,
        value,
      }));

      // Get existing settings
      const existingSettings = await this._database.getDataList(this._settingsCollection);
      
      // Delete all existing
      for (const setting of existingSettings) {
        await this._database.deleteData(this._settingsCollection, { key: setting.key });
      }
      
      // Insert all new
      if (settingsArray.length > 0) {
        await this._database.insertDataList(this._settingsCollection, settingsArray);
      }
    } catch (error) {
      logger.error(`Error writing settings: ${error.message}`);
      throw error;
    }
  }

  async getSetting(key) {
    try {
      const settings = await this._readSettings();
      const value = settings[key] !== undefined ? settings[key] : null;
      
      return {
        response: { value },
        statusCode: 200,
      };
    } catch (error) {
      logger.error(`Error getting setting ${key}:`, error);
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
      const settings = await this._readSettings();
      settings[key] = value;
      await this._writeSettings(settings);

      return {
        response: { value },
        statusCode: 200,
      };
    } catch (error) {
      logger.error(`Error setting ${key}:`, error);
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
      // Delete directly from collection
      await this._database.deleteData(this._settingsCollection, { key });
      
      return {
        response: { success: true },
        statusCode: 200,
      };
    } catch (error) {
      logger.error(`Error deleting ${key}:`, error);
      return {
        response: { error: `Failed to delete ${key}` },
        statusCode: 500,
      };
    }
  }
}

// Export class
export { SettingsManager };

