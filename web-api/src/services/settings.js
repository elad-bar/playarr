import { createLogger } from '../utils/logger.js';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get data directory from environment or use default
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../../data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings', 'settings.json');

const logger = createLogger('SettingsService');

/**
 * Settings service for managing application settings
 * Matches Python's SettingsService
 */
class SettingsService {
  constructor() {
    this._settingsFile = SETTINGS_FILE;
  }

  /**
   * Read settings file as object
   * @private
   * @returns {Promise<Object>} Settings object
   */
  async _readSettingsFile() {
    try {
      if (await fs.pathExists(this._settingsFile)) {
        const content = await fs.readJson(this._settingsFile);
        return content && typeof content === 'object' && !Array.isArray(content) ? content : {};
      }
      return {};
    } catch (error) {
      logger.error(`Error reading settings file: ${error.message}`);
      return {};
    }
  }

  /**
   * Write settings file
   * @private
   * @param {Object} settings - Settings object to write
   */
  async _writeSettingsFile(settings) {
    try {
      await fs.ensureDir(path.dirname(this._settingsFile));
      await fs.writeJson(this._settingsFile, settings, { spaces: 2 });
    } catch (error) {
      logger.error(`Error writing settings file: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get a setting value
   * @param {string} key - Setting key
   * @returns {Promise<{response: object, statusCode: number}>}
   */
  async getSetting(key) {
    try {
      const settings = await this._readSettingsFile();
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
      const settings = await this._readSettingsFile();
      settings[key] = value;
      await this._writeSettingsFile(settings);

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
      const settings = await this._readSettingsFile();
      if (settings.hasOwnProperty(key)) {
        delete settings[key];
        await this._writeSettingsFile(settings);
      }
      
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

// Export singleton instance
export const settingsService = new SettingsService();

