import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get data directory from environment or use default
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const CONFIG_DIR = process.env.CONFIG_DIR || path.join(__dirname, '../../configurations');

/**
 * File-based storage manager for API data
 * Uses the same data directories as the engine
 */
class FileStorageManager {
  constructor() {
    this.dataDir = DATA_DIR;
    this.configDir = CONFIG_DIR;
    this._ensureDirectories();
  }

  /**
   * Ensure required directories exist
   * @private
   */
  _ensureDirectories() {
    try {
      fs.ensureDirSync(this.dataDir);
      fs.ensureDirSync(this.configDir);
      fs.ensureDirSync(path.join(this.configDir, 'providers'));
    } catch (error) {
      console.error('Error ensuring directories:', error);
      throw error;
    }
  }

  /**
   * Get file path for a collection
   * @param {string} collectionName - Collection name
   * @returns {string} File path
   */
  _getCollectionPath(collectionName) {
    // Map collection names to file paths
    const collectionMap = {
      'users': path.join(this.dataDir, 'users.json'),
      'settings': path.join(this.dataDir, 'settings.json'),
      'stats': path.join(this.dataDir, 'stats.json'),
    };

    return collectionMap[collectionName] || path.join(this.dataDir, `${collectionName}.json`);
  }

  /**
   * Read JSON file, return empty array if file doesn't exist
   * @param {string} filePath - File path
   * @returns {Promise<Array>} Array of data
   */
  async _readJsonFile(filePath) {
    try {
      if (await fs.pathExists(filePath)) {
        const content = await fs.readJson(filePath);
        // Handle both array and object formats
        return Array.isArray(content) ? content : [];
      }
      return [];
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error);
      return [];
    }
  }

  /**
   * Read JSON file as object, return empty object if file doesn't exist
   * @param {string} filePath - File path
   * @returns {Promise<Object>} Object data
   */
  async _readJsonObject(filePath) {
    try {
      if (await fs.pathExists(filePath)) {
        return await fs.readJson(filePath);
      }
      return {};
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error);
      return {};
    }
  }

  /**
   * Write JSON file atomically
   * @param {string} filePath - File path
   * @param {*} data - Data to write
   */
  async _writeJsonFile(filePath, data) {
    try {
      await fs.ensureDir(path.dirname(filePath));
      // Write to temp file first, then rename (atomic operation)
      const tempPath = `${filePath}.tmp`;
      await fs.writeJson(tempPath, data, { spaces: 2 });
      await fs.move(tempPath, filePath, { overwrite: true });
    } catch (error) {
      console.error(`Error writing file ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Initialize file storage (ensure directories exist)
   */
  async initialize() {
    this._ensureDirectories();
    console.log(`File storage initialized at ${this.dataDir}`);
    return true;
  }

  /**
   * Get storage instance (for compatibility with old getDatabase pattern)
   */
  static getInstance() {
    if (!FileStorageManager.instance) {
      FileStorageManager.instance = new FileStorageManager();
    }
    return FileStorageManager.instance;
  }
}

// Export singleton instance
export const fileStorage = FileStorageManager.getInstance();

/**
 * Initialize database (file storage)
 * For compatibility with existing code
 */
export async function initializeDatabase() {
  try {
    await fileStorage.initialize();
    console.log('File storage initialized');
    return { fileStorage };
  } catch (error) {
    console.error('Failed to initialize file storage:', error);
    throw error;
  }
}

/**
 * Get database instance (file storage)
 * For compatibility with existing code
 */
export function getDatabase() {
  return fileStorage;
}

/**
 * Close database (no-op for file storage)
 */
export async function closeDatabase() {
  console.log('File storage closed');
}