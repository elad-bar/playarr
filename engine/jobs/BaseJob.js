import { createLogger } from '../utils/logger.js';

/**
 * Base class for all jobs in the engine
 * Provides common functionality: cache, providers, TMDB provider, and logger
 * @abstract
 */
export class BaseJob {
  /**
   * @param {string} jobName - Name identifier for this job (used in logging)
   * @param {import('../managers/StorageManager.js').StorageManager} cache - Storage manager instance for temporary cache
   * @param {import('../services/MongoDataService.js').MongoDataService} mongoData - MongoDB data service instance
   * @param {Map<string, import('../providers/BaseIPTVProvider.js').BaseIPTVProvider>} providers - Map of providerId -> provider instance (already initialized)
   * @param {import('../providers/TMDBProvider.js').TMDBProvider} tmdbProvider - TMDB provider singleton instance
   */
  constructor(jobName, cache, mongoData, providers, tmdbProvider) {
    if (this.constructor === BaseJob) {
      throw new Error('BaseJob is an abstract class and cannot be instantiated directly');
    }

    this.jobName = jobName;
    this.cache = cache;
    this.mongoData = mongoData;
    this.providers = providers; // Map<string, BaseIPTVProvider>
    this.tmdbProvider = tmdbProvider;
    this.logger = createLogger(jobName);
  }

  /**
   * Execute the job
   * Must be implemented by subclasses
   * @abstract
   * @returns {Promise<any>} Job execution result
   */
  async execute() {
    throw new Error('execute() must be implemented by subclass');
  }

  /**
   * Validate that required dependencies are available
   * @protected
   * @throws {Error} If required dependencies are missing
   */
  _validateDependencies() {
    if (!this.cache) {
      throw new Error('Cache storage manager is required');
    }
    if (!this.mongoData) {
      throw new Error('MongoDB data service is required');
    }
    if (!this.providers || this.providers.size === 0) {
      throw new Error('At least one IPTV provider is required');
    }
    if (!this.tmdbProvider) {
      throw new Error('TMDB provider is required');
    }
  }
}

