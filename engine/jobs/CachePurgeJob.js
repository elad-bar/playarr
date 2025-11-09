import { BaseJob } from '../jobs/BaseJob.js';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Job for purging expired cache files based on cache policy
 * Runs every 15 minutes to remove cache files that have expired according to their TTL
 * @extends {BaseJob}
 */
export class CachePurgeJob extends BaseJob {
  /**
   * @param {import('../managers/StorageManager.js').StorageManager} cache - Storage manager instance for temporary cache
   * @param {import('../managers/StorageManager.js').StorageManager} data - Storage manager instance for persistent data storage
   * @param {import('../services/MongoDataService.js').MongoDataService} mongoData - MongoDB data service instance (not used, but required by BaseJob)
   * @param {Map<string, import('../providers/BaseIPTVProvider.js').BaseIPTVProvider>} providers - Map of providerId -> provider instance (not used, but required by BaseJob)
   * @param {import('../providers/TMDBProvider.js').TMDBProvider} tmdbProvider - TMDB provider singleton instance (not used, but required by BaseJob)
   */
  constructor(cache, data, mongoData, providers, tmdbProvider) {
    super('CachePurgeJob', cache, data, mongoData, providers, tmdbProvider);
    this.cachePolicyPath = path.join(__dirname, '../../data/settings/cache-policy.json');
    // Check environment variable for actual deletion (default: false = dry-run mode)
    this.enableDeletion = process.env.CACHE_PURGE_ENABLED === 'true';
  }

  /**
   * Execute the cache purge job
   * @returns {Promise<{purged: number, errors: number, filesToDelete: string[]}>} Count of purged files, errors, and list of files to delete
   */
  async execute() {
    this._validateDependencies();

    const mode = this.enableDeletion ? 'DELETE' : 'DRY-RUN';
    this.logger.info(`Starting cache purge job (${mode} mode)...`);

    try {
      // Load cache policy
      const policy = this._loadCachePolicy();
      if (Object.keys(policy).length === 0) {
        this.logger.warn('No cache policy found, skipping purge');
        return { purged: 0, errors: 0, filesToDelete: [] };
      }

      // Scan cache directory and purge expired files
      const result = await this._purgeExpiredFiles(policy);
      
      const mode = this.enableDeletion ? 'DELETE' : 'DRY-RUN';
      const action = this.enableDeletion ? 'purged' : 'would be deleted';
      const message = `Cache purge completed (Mode: ${mode}),  ${result.filesToDelete.length} file(s) ${action}, ${result.errors} error(s)`;

      this.logger.info(message);
      
      if (result.filesToDelete.length > 0) {
        this.logger.info(`Files that ${action}:`);
        result.filesToDelete.forEach(file => {
          this.logger.info(`  - ${file}`);
        });
      }

      return result;
    } catch (error) {
      this.logger.error(`Error during cache purge: ${error.message}`);
      throw error;
    }
  }

  /**
   * Load cache policy file
   * @private
   * @returns {Object} Cache policy object
   */
  _loadCachePolicy() {
    try {
      if (fs.existsSync(this.cachePolicyPath)) {
        return fs.readJsonSync(this.cachePolicyPath);
      }
      return {};
    } catch (error) {
      this.logger.error(`Error loading cache policy: ${error.message}`);
      return {};
    }
  }

  /**
   * Purge expired cache files based on policy
   * @private
   * @param {Object} policy - Cache policy object
   * @returns {Promise<{purged: number, errors: number, filesToDelete: string[]}>} Count of purged files, errors, and list of files to delete
   */
  async _purgeExpiredFiles(policy) {
    let purgedCount = 0;
    let errorCount = 0;
    const filesToDelete = [];

    try {
      // Recursively scan cache directory
      const cacheDir = this.cache.storageDir;
      if (!fs.existsSync(cacheDir)) {
        this.logger.debug('Cache directory does not exist, nothing to purge');
        return { purged: 0, errors: 0, filesToDelete: [] };
      }

      const files = await this._getAllFiles(cacheDir);
      const now = Date.now();

      for (const filePath of files) {
        try {
          const relativePath = path.relative(cacheDir, filePath);
          const pathParts = relativePath.split(path.sep);
          
          // Build policy key (all parts except filename)
          if (pathParts.length === 0) continue;
          
          const fileName = pathParts[pathParts.length - 1];
          const directoryParts = pathParts.slice(0, -1);
          const filePathKey = directoryParts.join('/');

          // Find TTL from policy (handles dynamic keys like {providerId} and {tmdbId})
          const ttlHours = this._findTTLForPath(policy, filePathKey);

          // Skip if no policy found (keep file)
          if (ttlHours === undefined) {
            continue;
          }

          // Skip if TTL is null (Infinity - never expires)
          if (ttlHours === null) {
            continue;
          }

          // Check if file is expired
          const stats = fs.statSync(filePath);
          const ageMs = now - stats.mtimeMs;
          const maxAgeMs = ttlHours * 60 * 60 * 1000;

          if (ageMs >= maxAgeMs) {
            // File is expired, add to deletion list
            filesToDelete.push(relativePath);
            
            if (this.enableDeletion) {
              // Actually delete the file
              fs.removeSync(filePath);
              purgedCount++;
              this.logger.debug(`Purged expired cache file: ${relativePath} (age: ${Math.round(ageMs / 3600000)}h, TTL: ${ttlHours}h)`);
            } else {
              // Dry-run mode: just log what would be deleted
              this.logger.debug(`Would purge expired cache file: ${relativePath} (age: ${Math.round(ageMs / 3600000)}h, TTL: ${ttlHours}h)`);
            }
          }
        } catch (error) {
          errorCount++;
          this.logger.error(`Error processing file ${filePath}: ${error.message}`);
        }
      }

      // Clean up empty directories (only if deletion is enabled)
      if (this.enableDeletion) {
        await this._cleanupEmptyDirectories(cacheDir);
      }

    } catch (error) {
      this.logger.error(`Error during file purge: ${error.message}`);
      errorCount++;
    }

    return { purged: purgedCount, errors: errorCount, filesToDelete };
  }

  /**
   * Find matching policy key for a given file path
   * Handles dynamic keys like {providerId} and {tmdbId}
   * @private
   * @param {string} policyKey - Policy key to check (e.g., "tmdb/tv/{tmdbId}/season")
   * @param {string} filePathKey - File path key (e.g., "tmdb/tv/12345/season")
   * @returns {boolean} True if policy key matches file path
   */
  _matchesPolicyKey(policyKey, filePathKey) {
    // Replace dynamic segments in policy key with regex pattern
    const regexPattern = policyKey
      .replace(/\{providerId\}/g, '[^/]+')
      .replace(/\{tmdbId\}/g, '[^/]+');
    
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(filePathKey);
  }

  /**
   * Find TTL for a file path by matching against policy keys
   * @private
   * @param {Object} policy - Cache policy object
   * @param {string} filePathKey - File path key (e.g., "tmdb/tv/12345/season")
   * @returns {number|null|undefined} TTL in hours, null for Infinity, or undefined if not found
   */
  _findTTLForPath(policy, filePathKey) {
    // Try exact match first
    if (policy.hasOwnProperty(filePathKey)) {
      return policy[filePathKey];
    }

    // Try pattern matching for dynamic keys
    for (const [policyKey, ttlHours] of Object.entries(policy)) {
      if (this._matchesPolicyKey(policyKey, filePathKey)) {
        return ttlHours;
      }
    }

    return undefined;
  }

  /**
   * Get all files recursively from a directory
   * @private
   * @param {string} dir - Directory path
   * @returns {Promise<string[]>} Array of file paths
   */
  async _getAllFiles(dir) {
    const files = [];
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          const subFiles = await this._getAllFiles(fullPath);
          files.push(...subFiles);
        } else if (entry.isFile()) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      this.logger.error(`Error reading directory ${dir}: ${error.message}`);
    }

    return files;
  }

  /**
   * Clean up empty directories after purging files
   * @private
   * @param {string} dir - Directory path to clean
   * @returns {Promise<void>}
   */
  async _cleanupEmptyDirectories(dir) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const fullPath = path.join(dir, entry.name);
          
          // Recursively clean subdirectories
          await this._cleanupEmptyDirectories(fullPath);
          
          // Check if directory is now empty
          const subEntries = await fs.readdir(fullPath);
          if (subEntries.length === 0) {
            fs.removeSync(fullPath);
            this.logger.debug(`Removed empty directory: ${fullPath}`);
          }
        }
      }
    } catch (error) {
      // Ignore errors during cleanup
      this.logger.debug(`Error cleaning up directories: ${error.message}`);
    }
  }
}

