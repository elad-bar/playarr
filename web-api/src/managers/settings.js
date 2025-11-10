import { BaseManager } from './BaseManager.js';
import { DatabaseCollections, toCollectionName } from '../config/collections.js';

/**
 * Settings manager for managing application settings
 * Matches Python's SettingsService
 * Uses DatabaseService collection-based methods for all data access
 */
class SettingsManager extends BaseManager {
  /**
   * @param {import('../services/database.js').DatabaseService} database - Database service instance
   */
  constructor(database) {
    super('SettingsManager', database);
    this._settingsCollection = toCollectionName(DatabaseCollections.SETTINGS);
  }

  /**
   * Read settings from collection
   * Uses DatabaseService collection-based methods
   * Settings are stored as an object, not an array
   * @private
   * @returns {Promise<Object>} Settings object
   */
  async _readSettings() {
    try {
      // Settings are stored as an object, not an array
      const settings = await this._database.getDataObject(this._settingsCollection);
      return settings || {};
    } catch (error) {
      this.logger.error(`Error reading settings: ${error.message}`);
      return {};
    }
  }

  /**
   * Write settings to collection
   * Uses DatabaseService collection-based methods
   * Settings are stored as an object, not an array
   * @private
   * @param {Object} settings - Settings object to write
   */
  async _writeSettings(settings) {
    try {
      // Settings are stored as an object, write directly
      await this._database.updateDataObject(this._settingsCollection, settings);
    } catch (error) {
      this.logger.error(`Error writing settings: ${error.message}`);
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
      this.logger.error(`Error getting setting ${key}:`, error);
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
      // Read existing settings
      const settings = await this._readSettings();
      // Update the specific key
      settings[key] = value;
      // Write back (this merges/overwrites the entire object)
      await this._writeSettings(settings);

      return {
        response: { value },
        statusCode: 200,
      };
    } catch (error) {
      this.logger.error(`Error setting ${key}:`, error);
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
      // Read current settings
      const settings = await this._readSettings();
      // Remove the key
      delete settings[key];
      // Write back
      await this._writeSettings(settings);
      
      return {
        response: { success: true },
        statusCode: 200,
      };
    } catch (error) {
      this.logger.error(`Error deleting ${key}:`, error);
      return {
        response: { error: `Failed to delete ${key}` },
        statusCode: 500,
      };
    }
  }
}

// Export class
export { SettingsManager };

