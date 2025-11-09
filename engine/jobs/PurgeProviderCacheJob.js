import { BaseJob } from './BaseJob.js';

/**
 * Job for purging cache files for deleted providers
 * Runs every 6 hours to clean up cache directories for providers marked as deleted
 * @extends {BaseJob}
 */
export class PurgeProviderCacheJob extends BaseJob {
  /**
   * @param {import('../managers/StorageManager.js').StorageManager} cache - Storage manager instance for temporary cache
   * @param {import('../services/MongoDataService.js').MongoDataService} mongoData - MongoDB data service instance
   * @param {Map<string, import('../providers/BaseIPTVProvider.js').BaseIPTVProvider>} providers - Map of providerId -> provider instance (already initialized)
   * @param {import('../providers/TMDBProvider.js').TMDBProvider} tmdbProvider - TMDB provider singleton instance
   */
  constructor(cache, mongoData, providers, tmdbProvider) {
    super('PurgeProviderCacheJob', cache, mongoData, providers, tmdbProvider);
  }

  /**
   * Execute the job - purge cache for deleted providers
   * @returns {Promise<{providersProcessed: number, cacheDirectoriesRemoved: number}>}
   */
  async execute() {
    this._validateDependencies();

    const jobName = 'PurgeProviderCacheJob';
    let providersProcessed = 0;
    let cacheDirectoriesRemoved = 0;

    try {
      // Get all deleted providers
      const deletedProviders = await this.mongoData.getDeletedProviders();

      if (deletedProviders.length === 0) {
        this.logger.info('No deleted providers found, skipping cache purge');
        return { providersProcessed: 0, cacheDirectoriesRemoved: 0 };
      }

      this.logger.info(`Found ${deletedProviders.length} deleted provider(s) to process`);

      // Process each deleted provider
      for (const provider of deletedProviders) {
        try {
          const providerId = provider.id;
          
          // Get all cache policies for this provider
          const policies = await this.mongoData.getCachePoliciesByProvider(providerId);
          
          if (policies.length === 0) {
            this.logger.debug(`No cache policies found for provider ${providerId}, skipping`);
            continue;
          }

          // Extract cache directory paths from policy keys
          // Policy keys format: "agtv/categories" -> cache dir "agtv/"
          const cacheDirs = new Set();
          for (const policy of policies) {
            const parts = policy._id.split('/');
            if (parts.length > 0 && parts[0]) {
              cacheDirs.add(parts[0]); // First part is provider ID
            }
          }

          // Remove cache directories
          for (const cacheDir of cacheDirs) {
            try {
              await this.cache.removeProviderCache(cacheDir);
              cacheDirectoriesRemoved++;
              this.logger.info(`Removed cache directory: ${cacheDir}`);
            } catch (error) {
              this.logger.error(`Error removing cache directory ${cacheDir}: ${error.message}`);
            }
          }

          providersProcessed++;
        } catch (error) {
          this.logger.error(`Error processing deleted provider ${provider.id}: ${error.message}`);
        }
      }

      // Update job history
      await this.mongoData.updateJobHistory(jobName, {
        providers_processed: providersProcessed,
        cache_directories_removed: cacheDirectoriesRemoved
      });

      this.logger.info(`Cache purge completed: ${cacheDirectoriesRemoved} cache directory/directories removed for ${providersProcessed} provider(s)`);

      return { providersProcessed, cacheDirectoriesRemoved };
    } catch (error) {
      this.logger.error(`Job execution failed: ${error.message}`);
      throw error;
    }
  }
}

