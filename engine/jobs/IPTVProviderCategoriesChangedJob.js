import { BaseJob } from './BaseJob.js';
import { ApplicationContext } from '../context/ApplicationContext.js';

/**
 * Job for handling IPTV provider categories enabled state changed events
 * Updates ApplicationContext config, deletes provider titles for disabled categories, deletes title streams, removes provider from sources, deletes titles without sources, triggers process provider titles
 * @extends {BaseJob}
 */
export class IPTVProviderCategoriesChangedJob extends BaseJob {
  /**
   * @param {import('../managers/StorageManager.js').StorageManager} cache - Storage manager instance for temporary cache
   * @param {import('../services/MongoDataService.js').MongoDataService} mongoData - MongoDB data service instance
   * @param {Map<string, import('../providers/BaseIPTVProvider.js').BaseIPTVProvider>} providers - Map of providerId -> provider instance (already initialized)
   * @param {import('../providers/TMDBProvider.js').TMDBProvider} tmdbProvider - TMDB provider singleton instance
   */
  constructor(cache, mongoData, providers, tmdbProvider) {
    super('IPTVProviderCategoriesChangedJob', cache, mongoData, providers, tmdbProvider);
  }

  /**
   * Execute the job - handle provider categories changed events
   * @returns {Promise<{processed: number, errors: Array}>} Processing results
   */
  async execute() {
    this._validateDependencies();

    const context = ApplicationContext.getInstance();

    try {
      await this.setJobStatus('running');

      // Get providers from action queue
      const providerIds = context.getAndClearProviderActionQueue('iptvProviderCategoriesChanged');

      if (providerIds.size === 0) {
        this.logger.info('No providers to process');
        await this.setJobStatus('completed', {});
        return { processed: 0, errors: [] };
      }

      this.logger.info(`Processing ${providerIds.size} provider(s) categories changed event(s)`);

      const errors = [];
      let processed = 0;
      const providersWithDisabledCategories = []; // Track providers that had disabled categories

      for (const providerId of providerIds) {
        try {
          this.logger.info(`Processing categories changed for provider ${providerId}`);

          // 1. Update ApplicationContext - provider configuration
          const providerConfig = await this.getProviderConfig(providerId);

          if (!providerConfig) {
            this.logger.warn(`Provider ${providerId} not found in database`);
            continue;
          }

          // Get or create provider instance
          let providerInstance = this.providers.get(providerId);
          if (!providerInstance) {
            // Create instance if it doesn't exist
            providerInstance = context.createProviderInstance(providerConfig);
            await providerInstance.initializeCachePolicies();
            this.providers.set(providerId, providerInstance);
            this.logger.info(`Created provider instance for ${providerId}`);
          }

          // 1. Update provider configuration
          await providerInstance.updateConfiguration(providerConfig);

          // 2. Get enabled categories from provider config
          const enabledCategories = providerConfig.enabled_categories || { movies: [], tvshows: [] };
          const enabledCategoryKeys = new Set([
            ...(enabledCategories.movies || []),
            ...(enabledCategories.tvshows || [])
          ]);

          // 3. Get all categories for this provider using provider instance
          const allCategories = await providerInstance.getAllCategories();

          const disabledCategoryKeys = allCategories
            .map(cat => cat.category_key)
            .filter(key => !enabledCategoryKeys.has(key));

          if (disabledCategoryKeys.length > 0) {
            this.logger.info(`Found ${disabledCategoryKeys.length} disabled categories for ${providerId}`);

            // 4. Delete provider titles for disabled categories using provider instance
            await providerInstance.deleteTitlesByCategories(disabledCategoryKeys);

            // Track this provider and its enabled categories for batch operations
            providersWithDisabledCategories.push({
              providerId,
              enabledCategories
            });
          }

          // 5. Trigger process provider titles using provider instance
          await providerInstance.processProviderTitles();

          processed++;
        } catch (error) {
          this.logger.error(`Error processing provider ${providerId}: ${error.message}`);
          errors.push({ providerId, error: error.message });
        }
      }

      // Batch operations: run once after all providers are processed
      if (providersWithDisabledCategories.length > 0) {
        try {
          const allTitleKeys = [];

          // Process each provider individually to use its enabled_categories
          for (const { providerId, enabledCategories } of providersWithDisabledCategories) {
            // Remove provider from title sources for disabled categories
            // This efficiently queries provider_titles to find disabled category titles
            const result = await this.tmdbProvider.removeProviderFromTitleSourcesByDisabledCategories(
              providerId,
              enabledCategories
            );

            this.logger.info(
              `Removed provider ${providerId} from ${result.titlesUpdated} titles, ` +
              `${result.streamsRemoved} streams removed for disabled categories`
            );

            // Collect title_keys for checking titles without streams
            allTitleKeys.push(...result.titleKeys);
          }

          // Delete titles that have no streams left in title_streams collection
          const uniqueTitleKeys = [...new Set(allTitleKeys)];
          if (uniqueTitleKeys.length > 0) {
            const deletedTitles = await this.tmdbProvider.deleteTitlesWithoutStreams(uniqueTitleKeys);
            this.logger.info(`Deleted ${deletedTitles} titles without streams`);
          }
        } catch (error) {
          this.logger.error(`Error in batch operations: ${error.message}`);
          // Don't fail the entire job, but log the error
        }
      }

      // Set status to completed on success with result
      await this.setJobStatus('completed', {
        providers_processed: processed,
        errors: errors
      });
      return { processed, errors };
    } catch (error) {
      this.logger.error(`Job execution failed: ${error.message}`);
      // Set status to failed with error result
      await this.setJobStatus('failed', {
        error: error.message
      }).catch(err => {
        this.logger.error(`Failed to update job history: ${err.message}`);
      });
      throw error;
    }
  }
}

