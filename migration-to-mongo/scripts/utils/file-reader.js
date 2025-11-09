import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import Logger from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * File reading utilities for migration scripts
 * Handles JSON file reading with error handling
 */
class FileReader {
  constructor(dataDir, logger = new Logger()) {
    this.dataDir = path.resolve(dataDir);
    this.logger = logger;
  }

  /**
   * Read JSON file as array
   * @param {string} filePath - File path (relative to dataDir or absolute)
   * @returns {Promise<Array>} Array of data
   */
  async readJsonArray(filePath) {
    try {
      const fullPath = this._resolvePath(filePath);
      if (!(await fs.pathExists(fullPath))) {
        this.logger.warn(`File not found: ${fullPath}`);
        return [];
      }

      const content = await fs.readJson(fullPath);
      if (!Array.isArray(content)) {
        this.logger.warn(`File ${filePath} is not an array, returning empty array`);
        return [];
      }

      return content;
    } catch (error) {
      this.logger.error(`Error reading file ${filePath}: ${error.message}`);
      return [];
    }
  }

  /**
   * Read JSON file as object
   * @param {string} filePath - File path (relative to dataDir or absolute)
   * @returns {Promise<Object>} Object data
   */
  async readJsonObject(filePath) {
    try {
      const fullPath = this._resolvePath(filePath);
      if (!(await fs.pathExists(fullPath))) {
        this.logger.warn(`File not found: ${fullPath}`);
        return {};
      }

      const content = await fs.readJson(fullPath);
      if (typeof content !== 'object' || Array.isArray(content)) {
        this.logger.warn(`File ${filePath} is not an object, returning empty object`);
        return {};
      }

      return content;
    } catch (error) {
      this.logger.error(`Error reading file ${filePath}: ${error.message}`);
      return {};
    }
  }

  /**
   * Read JSON file (handles both array and object)
   * @param {string} filePath - File path (relative to dataDir or absolute)
   * @returns {Promise<Array|Object>} File content
   */
  async readJsonFile(filePath) {
    try {
      const fullPath = this._resolvePath(filePath);
      if (!(await fs.pathExists(fullPath))) {
        this.logger.warn(`File not found: ${fullPath}`);
        return null;
      }

      return await fs.readJson(fullPath);
    } catch (error) {
      this.logger.error(`Error reading file ${filePath}: ${error.message}`);
      return null;
    }
  }

  /**
   * Find all provider-specific files matching pattern
   * @param {string} directory - Directory to search (relative to dataDir)
   * @param {string} pattern - File pattern (e.g., '*.titles.json', '*.categories.json')
   * @returns {Promise<Array<{providerId: string, filePath: string}>>} Array of provider files
   */
  async findProviderFiles(directory, pattern) {
    try {
      const fullDir = path.join(this.dataDir, directory);
      if (!(await fs.pathExists(fullDir))) {
        this.logger.warn(`Directory not found: ${fullDir}`);
        return [];
      }

      const files = await fs.readdir(fullDir);
      const regex = new RegExp(pattern.replace('*', '(.+)'));
      const providerFiles = [];

      for (const file of files) {
        const match = file.match(regex);
        if (match) {
          const providerId = match[1];
          providerFiles.push({
            providerId,
            filePath: path.join(fullDir, file),
            relativePath: path.join(directory, file),
          });
        }
      }

      return providerFiles;
    } catch (error) {
      this.logger.error(`Error finding provider files in ${directory}: ${error.message}`);
      return [];
    }
  }

  /**
   * Resolve file path (relative to dataDir or absolute)
   * @private
   * @param {string} filePath - File path
   * @returns {string} Resolved path
   */
  _resolvePath(filePath) {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    return path.join(this.dataDir, filePath);
  }

  /**
   * Check if file exists
   * @param {string} filePath - File path (relative to dataDir or absolute)
   * @returns {Promise<boolean>}
   */
  async fileExists(filePath) {
    const fullPath = this._resolvePath(filePath);
    return await fs.pathExists(fullPath);
  }
}

export default FileReader;

