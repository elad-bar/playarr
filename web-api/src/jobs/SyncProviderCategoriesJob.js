import { BaseJob } from './BaseJob.js';
import { formatNumber } from '../utils/numberFormat.js';

/**
 * Job for syncing provider categories from IPTV providers
 * Syncs categories for movies and TV shows into provider_categories collection
 * @extends {BaseJob}
 */
export class SyncProviderCategoriesJob extends BaseJob {
  /**
   * @param {string} jobName - Name identifier for this job (used in logging)
   * @param {import('../managers/domain/JobHistoryManager.js').JobHistoryManager} jobHistoryManager - Job history manager
   * @param {import('../managers/orchestration/ProvidersManager.js').ProvidersManager} providersManager - Providers manager for direct API calls
   * @param {import('../managers/domain/TMDBManager.js').TMDBManager} tmdbManager - TMDB manager (required by BaseJob)
   * @param {import('../managers/domain/TitlesManager.js').TitlesManager} titlesManager - Titles manager (required by BaseJob)
   * @param {import('../managers/domain/ProviderTitlesManager.js').ProviderTitlesManager} providerTitlesManager - Provider titles manager (required by BaseJob)
   * @param {import('../services/metrics.js').default} metricsService - Metrics service for recording counters
   * @param {import('../managers/domain/ProviderCategoryManager.js').ProviderCategoryManager} providerCategoryManager - Provider category manager
   */
  constructor(jobName, jobHistoryManager, providersManager, tmdbManager, titlesManager, providerTitlesManager, metricsService, providerCategoryManager) {
    super(jobName, jobHistoryManager, providersManager, tmdbManager, titlesManager, providerTitlesManager, metricsService);
    this._providerCategoryManager = providerCategoryManager;
  }

  /**
   * Execute the job - sync categories from all enabled IPTV providers
   * @param {AbortSignal} [abortSignal] - AbortSignal for cancellation
   * @returns {Promise<Array<{providerId: string, providerName: string, movies?: number, tvshows?: number, error?: string}>>} Array of sync results
   */
  async execute(abortSignal) {
    try {
      // Set status to "running" at start
      await this.setJobStatus('running');
      
      // Check for cancellation after setting status
      this._checkCancellation(abortSignal);

      this.logger.info('Starting provider categories sync...');

      // Get all enabled, non-deleted Xtream providers only
      // Note: Categories are only available for Xtream providers
      const providersResult = await this.providersManager.getProviders();
      const allProviders = providersResult.providers || [];
      
      const enabledProviders = allProviders.filter(p => 
        p.enabled !== false && 
        !p.deleted && 
        p.type?.toLowerCase() === 'xtream'
      );

      if (enabledProviders.length === 0) {
        this.logger.info('No enabled providers found. Skipping categories sync.');
        await this.setJobStatus('completed', {
          providers_processed: 0,
          results: []
        });
        return [];
      }

      this.logger.info(`Syncing categories for ${formatNumber(enabledProviders.length)} enabled provider(s)...`);

      // Check for cancellation before processing providers
      this._checkCancellation(abortSignal);

      // Process each provider
      const results = await Promise.all(
        enabledProviders.map(async (provider) => {
          // Check for cancellation before processing each provider
          this._checkCancellation(abortSignal);
          const providerId = provider.id;
          try {
            this.logger.debug(`[${providerId}] Processing provider categories`);

            const result = {
              providerId,
              providerName: providerId,
              movies: 0,
              tvshows: 0
            };

            // Fetch and sync ALL categories regardless of sync_media_types
            // This allows users to configure categories separately from sync state
            const syncPromises = [
              this._syncCategoriesForType(providerId, 'movies')
                .then(count => { result.movies = count; })
                .catch(err => {
                  this.logger.error(`[${providerId}] Error syncing movies categories: ${err.message}`);
                  result.movies = 0;
                }),
              this._syncCategoriesForType(providerId, 'tvshows')
                .then(count => { result.tvshows = count; })
                .catch(err => {
                  this.logger.error(`[${providerId}] Error syncing tvshows categories: ${err.message}`);
                  result.tvshows = 0;
                })
            ];

            // Wait for all category syncs
            await Promise.all(syncPromises);

            return result;
          } catch (error) {
            this.logger.error(`[${providerId}] Error processing provider: ${error.message}`);
            return {
              providerId,
              providerName: providerId,
              error: error.message
            };
          }
        })
      );

      // Update metrics
      let index = 0;
      for (const result of results) {
        // Periodic cancellation check in metrics loop
        if (this._shouldCheckCancellation(abortSignal, 100, index)) {
          this._checkCancellation(abortSignal);
        }
        index++;
        
        if (result.error) {
          continue;
        }
        if (result.movies !== undefined && result.movies !== null) {
          this.metricsService.incrementCounter('provider_categories_synced', { 
            provider_id: result.providerId, 
            media_type: 'movies' 
          }, result.movies);
        }
        if (result.tvshows !== undefined && result.tvshows !== null) {
          this.metricsService.incrementCounter('provider_categories_synced', { 
            provider_id: result.providerId, 
            media_type: 'tvshows' 
          }, result.tvshows);
        }
      }

      // Set status to completed on success with result
      await this.setJobStatus('completed', {
        providers_processed: enabledProviders.length,
        results: results
      });

      this.logger.info(`Categories sync completed for ${formatNumber(enabledProviders.length)} provider(s)`);
      return results;
    } catch (error) {
      // Check if error is due to cancellation
      if (error.cancelled || error.name === 'AbortError') {
        this.logger.info(`Job execution cancelled: ${error.message}`);
        await this.setJobStatus('cancelled', {
          cancelled: true
        }).catch(err => {
          this.logger.error(`Failed to update job history: ${err.message}`);
        });
      } else {
        this.logger.error(`Job execution failed: ${error.message}`);
        
        // Set status to failed with error result
        await this.setJobStatus('failed', {
          error: error.message
        }).catch(err => {
          this.logger.error(`Failed to update job history: ${err.message}`);
        });
      }
      throw error;
    }
  }

  /**
   * Sync categories for a specific provider and media type
   * @private
   * @param {string} providerId - Provider ID
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Promise<number>} Number of categories synced
   */
  async _syncCategoriesForType(providerId, type) {
    try {
      // Fetch categories from provider API
      const apiCategories = await this.providersManager.fetchCategories(providerId, type);
      
      if (!Array.isArray(apiCategories) || apiCategories.length === 0) {
        this.logger.debug(`[${providerId}] No ${type} categories found from API`);
        // Delete existing categories for this type (provider removed all categories)
        const deleteResult = await this._providerCategoryManager.deleteCategoriesByProviderAndType(providerId, type);
        return 0;
      }

      // Transform to collection format
      const categoriesToUpsert = apiCategories.map(cat => ({
        provider_id: providerId,
        type: type,
        category_id: cat.category_id || cat.id,
        category_name: cat.category_name || cat.name,
        category_key: `${type}-${cat.category_id || cat.id}`
      }));

      // Bulk upsert categories
      const upsertResult = await this._providerCategoryManager.bulkUpsertCategories(providerId, categoriesToUpsert);
      
      // Get existing categories from DB for this provider and type
      const existingCategories = await this._providerCategoryManager.getCategoriesByProvider(providerId, type);
      const existingCategoryIds = new Set(existingCategories.map(c => c.category_id));
      const apiCategoryIds = new Set(categoriesToUpsert.map(c => c.category_id));

      // Find categories that exist in DB but not in API response (provider removed category)
      const categoriesToDelete = existingCategories.filter(c => !apiCategoryIds.has(c.category_id));

      // Delete removed categories using bulk delete
      let deletedCount = 0;
      if (categoriesToDelete.length > 0) {
        const categoryIdsToDelete = categoriesToDelete.map(c => c.category_id);
        // Use repository's deleteMany to delete specific categories
        const deleteResult = await this._providerCategoryManager._repository.deleteMany({
          provider_id: providerId,
          type: type,
          category_id: { $in: categoryIdsToDelete }
        });
        deletedCount = deleteResult.deletedCount || 0;
        this.logger.debug(`[${providerId}] Deleted ${formatNumber(deletedCount)} removed ${type} categories`);
      }

      const totalSynced = upsertResult.inserted + upsertResult.updated;
      this.logger.info(`[${providerId}] Synced ${formatNumber(totalSynced)} ${type} categories (${upsertResult.inserted} inserted, ${upsertResult.updated} updated, ${deletedCount} deleted)`);
      
      return totalSynced;
    } catch (error) {
      this.logger.error(`[${providerId}] Error syncing ${type} categories: ${error.message}`);
      throw error;
    }
  }
}

