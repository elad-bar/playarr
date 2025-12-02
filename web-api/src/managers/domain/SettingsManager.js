import { BaseDomainManager } from './BaseDomainManager.js';
import { DatabaseCollections, toCollectionName } from '../config/collections.js';
import { AppError } from '../errors/AppError.js';

/**
 * Settings manager for managing application settings
 * Matches Python's SettingsService
 * Uses DatabaseService collection-based methods for all data access
 */
class SettingsManager extends BaseDomainManager {
  /**
   * @param {import('../repositories/SettingsRepository.js').SettingsRepository} settingsRepo - Settings repository
   */
  constructor(settingsRepo) {
    super('SettingsManager', settingsRepo);
    this._settingsCollection = toCollectionName(DatabaseCollections.SETTINGS);
    
    // Cache for settings - null = cache invalid/empty, Object = cached settings data
    this._cachedSettings = null;
  }

  /**
   * Read settings from collection (with caching)
   * Uses DatabaseService collection-based methods
   * Settings are stored as an object, not an array
   * @private
   * @returns {Promise<Object>} Settings object
   */
  async _readSettings() {
    // Return cached data if available
    if (this._cachedSettings !== null) {
      return this._cachedSettings;
    }

    try {
      // Settings are stored as an object, not an array
      // Get all settings and transform to object
      const settingsArray = await this._repository.findByQuery({});
      const settings = {};
      for (const setting of settingsArray) {
        if (setting._id) {
          settings[setting._id] = setting.value;
        }
      }
      this._cachedSettings = settings || {};
      return this._cachedSettings;
    } catch (error) {
      this.logger.error(`Error reading settings: ${error.message}`);
      // Cache empty object on error to prevent repeated DB calls
      this._cachedSettings = {};
      return {};
    }
  }

  /**
   * Invalidate settings cache
   * @private
   */
  _invalidateCache() {
    this._cachedSettings = null;
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
      // Update each setting individually
      for (const [key, value] of Object.entries(settings)) {
        const now = new Date();
        await this._repository.updateOne(
          { _id: key },
          { $set: { value, lastUpdated: now, createdAt: settings[key] ? undefined : now } },
          { upsert: true }
        );
      }
    } catch (error) {
      this.logger.error(`Error writing settings: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get a setting value
   * @param {string} key - Setting key
   * @returns {Promise<{value: string|null}>} Setting value object
   * @throws {AppError} If an error occurs
   */
  async getSetting(key) {
    try {
      const settings = await this._readSettings();
      const value = settings[key] !== undefined ? settings[key] : null;
      
      return { value };
    } catch (error) {
      this.logger.error(`Error getting setting ${key}:`, error);
      throw new AppError(`Failed to get setting ${key}`, 500);
    }
  }

  /**
   * Set a setting value
   * @param {string} key - Setting key
   * @param {string} value - Setting value
   * @returns {Promise<{value: string}>} Setting value object
   * @throws {AppError} If an error occurs
   */
  async setSetting(key, value) {
    try {
      // Read existing settings
      const settings = await this._readSettings();
      // Update the specific key
      settings[key] = value;
      // Write back (this merges/overwrites the entire object)
      await this._writeSettings(settings);

      // Update cache with new data (no need to re-read from DB)
      this._cachedSettings = settings;

      return { value };
    } catch (error) {
      this.logger.error(`Error setting ${key}:`, error);
      // Invalidate cache on error
      this._invalidateCache();
      throw new AppError(`Failed to set ${key}`, 500);
    }
  }

  /**
   * Delete a setting
   * @param {string} key - Setting key
   * @returns {Promise<{success: boolean}>} Success object
   * @throws {AppError} If an error occurs
   */
  async deleteSetting(key) {
    try {
      // Read current settings
      const settings = await this._readSettings();
      // Remove the key
      delete settings[key];
      // Write back
      await this._writeSettings(settings);
      
      // Update cache with new data (no need to re-read from DB)
      this._cachedSettings = settings;

      return { success: true };
    } catch (error) {
      this.logger.error(`Error deleting ${key}:`, error);
      // Invalidate cache on error
      this._invalidateCache();
      throw new AppError(`Failed to delete ${key}`, 500);
    }
  }

  /**
   * Test database connectivity
   * Performs a simple query to verify the database connection is working
   * Used by healthcheck endpoint
   * @returns {Promise<void>} Resolves if connected, throws if disconnected
   */
  async testConnection() {
    // Perform a simple query to test database connectivity
    // This will throw an error if the database is disconnected
    await this._repository.findOneByQuery({});
  }
}

// Export class
export { SettingsManager };

