import { BaseJob } from './BaseJob.js';
import { formatNumber } from '../utils/numberFormat.js';
import { ProviderTypeConfig } from '../config/providers.js';

/**
 * Job for cleaning up unwanted provider titles
 * Removes provider titles from disabled/deleted providers, disabled media types, and disabled categories
 * Uses postExecute configuration to trigger subsequent jobs
 * @extends {BaseJob}
 */
export class CleanupUnwantedProviderTitlesJob extends BaseJob {
  /**
   * @param {string} jobName - Name identifier for this job (used in logging)
   * @param {import('../managers/domain/JobHistoryManager.js').JobHistoryManager} jobHistoryManager - Job history manager
   * @param {import('../managers/orchestration/ProvidersManager.js').ProvidersManager} providersManager - Providers manager for direct API calls
   * @param {import('../managers/domain/TitlesManager.js').TitlesManager} titlesManager - Titles manager
   * @param {import('../managers/domain/ProviderTitlesManager.js').ProviderTitlesManager} providerTitlesManager - Provider titles manager
   * @param {import('../managers/domain/ChannelManager.js').ChannelManager} channelManager - Channel manager for Live TV cleanup
   * @param {import('../managers/domain/ProgramManager.js').ProgramManager} programManager - Program manager for Live TV cleanup
   * @param {import('../managers/domain/UserManager.js').UserManager} userManager - User manager for watchlist cleanup
   * @param {import('../managers/domain/ProviderCategoryManager.js').ProviderCategoryManager} providerCategoryManager - Provider category manager
   */
  constructor(jobName, jobHistoryManager, providersManager, titlesManager, providerTitlesManager, channelManager, programManager, userManager, providerCategoryManager) {
    super(jobName, jobHistoryManager);
    this.providersManager = providersManager;
    this.titlesManager = titlesManager;
    this.providerTitlesManager = providerTitlesManager;
    this._channelManager = channelManager;
    this._programManager = programManager;
    this._userManager = userManager;
    this._providerCategoryManager = providerCategoryManager;
  }

  /**
   * Extract category IDs from category keys
   * Category keys format: "movies-1", "tvshows-5"
   * Returns: [1, 5] (numeric IDs)
   * @private
   * @param {Array<string>} categoryKeys - Array of category keys
   * @returns {Array<number>} Array of category IDs
   */
  _extractCategoryIdsFromKeys(categoryKeys) {
    if (!categoryKeys || categoryKeys.length === 0) {
      return [];
    }

    return categoryKeys
      .map(key => {
        const parts = key.split('-');
        return parts.length > 1 ? parseInt(parts[1]) : null;
      })
      .filter(id => id !== null && !isNaN(id));
  }


  /**
   * Cleanup all channels for a provider (used when provider is disabled/deleted or Live TV is disabled)
   * @private
   * @param {string} providerId - Provider ID
   * @returns {Promise<number>} Number of channels deleted
   */
  async _cleanupAllChannelsForProvider(providerId) {
    try {
      // Get all channels for this provider
      const channels = await this._channelManager.findByProvider(providerId);

      if (channels.length === 0) {
        return 0; // No channels to clean up
      }

      const channelIds = channels.map(c => c.channel_id);

      // Delete programs first (foreign key constraint)
      await this._programManager.deleteMany({
        provider_id: providerId,
        channel_id: { $in: channelIds }
      });

      // Delete channels
      await this._channelManager.deleteByProvider(providerId);

      // Clean up watchlist entries for deleted channels
      const deletedChannelKeys = channelIds.map(chId => `live-${providerId}-${chId}`);
      await this._userManager.removeChannelKeysFromAllWatchlists(deletedChannelKeys);

      this.logger.info(`Deleted ${formatNumber(channelIds.length)} channels for provider ${providerId}`);
      return channelIds.length;
    } catch (error) {
      this.logger.error(`Error cleaning up channels for provider ${providerId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Execute the job - cleanup unwanted provider titles
   * @param {AbortSignal} [abortSignal] - AbortSignal for cancellation
   * @returns {Promise<Object>} Cleanup statistics
   */
  async execute(abortSignal) {
    try {
      // Set status to "running" at start
      await this.setJobStatus('running');
      
      // Check for cancellation after setting status
      this._checkCancellation(abortSignal);

      this.logger.info('Starting cleanup of unwanted provider titles...');

      // Step 1: Get all providers (including disabled/deleted)
      const allProvidersResult = await this.providersManager.getProviders();
      const allProviders = allProvidersResult.providers || [];

      if (allProviders.length === 0) {
        this.logger.info('No providers found. Skipping cleanup.');
        await this.setJobStatus('completed', {
          providers_processed: 0,
          titles_deleted: 0,
          titles_updated: 0,
          empty_titles_deleted: 0,
          categories_deleted: 0
        });
        return {
          providers_processed: 0,
          titles_deleted: 0,
          titles_updated: 0,
          empty_titles_deleted: 0,
          categories_deleted: 0
        };
      }

      // Step 2: Initialize collection for titles to delete
      const titlesToDelete = []; // Array of { provider_id, title_key, tmdb_id, type }
      const providerDeletionCounts = new Map(); // Track per-provider counts for summary

      // Step 3: For each provider, determine which provider titles should be deleted
      for (const provider of allProviders) {
        // Check for cancellation before processing each provider
        this._checkCancellation(abortSignal);
        
        const providerId = provider.id;
        const isEnabled = provider.enabled !== false;
        const syncTypes = provider.sync_media_types || { 
          movies: true,  // Default true for v1 providers
          tvshows: true,
          live: true
        };
        const enabledCategories = provider.enabled_categories || { movies: [], tvshows: [], live: [] };

        // Check if provider supports categories
        const providerType = provider.type?.toLowerCase();
        const supportsCategories = ProviderTypeConfig[providerType]?.supportsCategories === true;
        
        // Build query for provider titles that should be deleted
        let deleteQuery = null;
        const deletionReasons = []; // Track reasons for debugging

        // Log provider configuration
        this.logger.debug(`[${providerId}] Provider config: enabled=${isEnabled}, deleted=${provider.deleted || false}, sync_types=${JSON.stringify(syncTypes)}, enabled_categories={movies:${enabledCategories.movies?.length || 0}, tvshows:${enabledCategories.tvshows?.length || 0}}, supports_categories=${supportsCategories}`);

        // If provider is disabled/deleted, delete ALL titles
        if (!isEnabled || provider.deleted) {
          deleteQuery = { provider_id: providerId };
          deletionReasons.push(`provider_disabled_or_deleted (enabled: ${isEnabled}, deleted: ${provider.deleted || false})`);
          this.logger.debug(`[${providerId}] Deletion criteria: Provider is disabled or deleted - will delete ALL titles`);
        } else {
          // Provider is enabled - check media types and categories
          const typesToDelete = [];
          if (!syncTypes.movies) {
            typesToDelete.push('movies');
            deletionReasons.push('media_type_disabled (movies)');
          }
          if (!syncTypes.tvshows) {
            typesToDelete.push('tvshows');
            deletionReasons.push('media_type_disabled (tvshows)');
          }

          // Also check disabled categories (only if provider supports categories)
          const orConditions = [];
          
          if (supportsCategories) {
            const enabledMovieIds = this._extractCategoryIdsFromKeys(enabledCategories.movies || []);
            const enabledTvshowIds = this._extractCategoryIdsFromKeys(enabledCategories.tvshows || []);

            if (syncTypes.movies) {
              if (enabledMovieIds.length > 0) {
                // Convert to strings to match database type (category_id is stored as string)
                const enabledMovieIdsAsStrings = enabledMovieIds.map(id => String(id));
                orConditions.push({ type: 'movies', category_id: { $nin: enabledMovieIdsAsStrings } });
                deletionReasons.push(`category_disabled (movies: enabled_categories=${enabledCategories.movies?.length || 0}, enabled_ids=[${enabledMovieIds.join(',')}])`);
              } else {
                orConditions.push({ type: 'movies' });
                deletionReasons.push('no_enabled_categories (movies: sync enabled but enabled_categories is empty)');
              }
            }

            if (syncTypes.tvshows) {
              if (enabledTvshowIds.length > 0) {
                // Convert to strings to match database type (category_id is stored as string)
                const enabledTvshowIdsAsStrings = enabledTvshowIds.map(id => String(id));
                orConditions.push({ type: 'tvshows', category_id: { $nin: enabledTvshowIdsAsStrings } });
                deletionReasons.push(`category_disabled (tvshows: enabled_categories=${enabledCategories.tvshows?.length || 0}, enabled_ids=[${enabledTvshowIds.join(',')}])`);
              } else {
                orConditions.push({ type: 'tvshows' });
                deletionReasons.push('no_enabled_categories (tvshows: sync enabled but enabled_categories is empty)');
              }
            }
          }

          // Build delete query only if we have deletion criteria
          if (typesToDelete.length > 0 || orConditions.length > 0) {
            deleteQuery = { provider_id: providerId };
            
            if (typesToDelete.length > 0) {
              this.logger.debug(`[${providerId}] Deletion criteria: Media types disabled - ${typesToDelete.join(', ')}`);
            }

            if (typesToDelete.length > 0 && orConditions.length > 0) {
              // Use $or to match titles that are EITHER disabled media types OR disabled categories
              deleteQuery = {
                provider_id: providerId,
                $or: [
                  { type: { $in: typesToDelete } },
                  ...orConditions
                ]
              };
            } else if (typesToDelete.length > 0) {
              deleteQuery.type = { $in: typesToDelete };
            } else if (orConditions.length > 0) {
              deleteQuery.$or = orConditions;
            }
          }
        }

        // Find provider titles matching the delete query (skip if no deletion criteria)
        const providerTitlesToDelete = deleteQuery ? await this.providerTitlesManager.findByQuery(deleteQuery, {
          projection: { title_key: 1, tmdb_id: 1, type: 1, provider_id: 1, category_id: 1 }
        }) : [];

        // Count by type and category for debugging
        const countByType = {};
        const countByCategory = {};
        for (const pt of providerTitlesToDelete) {
          countByType[pt.type] = (countByType[pt.type] || 0) + 1;
          if (pt.category_id !== undefined && pt.category_id !== null) {
            const key = `${pt.type}-${pt.category_id}`;
            countByCategory[key] = (countByCategory[key] || 0) + 1;
          }
        }

        if (providerTitlesToDelete.length > 0) {
          this.logger.info(`[${providerId}] Found ${formatNumber(providerTitlesToDelete.length)} titles to delete. Reasons: ${deletionReasons.join('; ')}. Breakdown by type: ${JSON.stringify(countByType)}. Breakdown by category: ${JSON.stringify(countByCategory)}`);
          providerDeletionCounts.set(providerId, {
            count: providerTitlesToDelete.length,
            reasons: deletionReasons,
            breakdown: countByType
          });
        }

        // Add to collection
        let deleteIndex = 0;
        for (const pt of providerTitlesToDelete) {
          // Periodic cancellation check in titlesToDelete processing loop
          if (this._shouldCheckCancellation(abortSignal, 100, deleteIndex)) {
            this._checkCancellation(abortSignal);
          }
          deleteIndex++;
          
          if (pt.title_key && pt.type) {
            titlesToDelete.push({
              provider_id: pt.provider_id,
              title_key: pt.title_key,
              tmdb_id: pt.tmdb_id,
              type: pt.type
            });
          }
        }
      }

      // Log summary of deletions by provider
      if (providerDeletionCounts.size > 0) {
        this.logger.debug('Deletion summary by provider:');
        for (const [providerId, stats] of providerDeletionCounts.entries()) {
          this.logger.debug(`  [${providerId}]: ${formatNumber(stats.count)} titles - ${stats.reasons.join('; ')} - Types: ${JSON.stringify(stats.breakdown)}`);
        }
      }

      // Step 4: Delete all provider titles at once using bulkWrite
      let deletedCount = 0;
      let titlesUpdated = 0;
      let emptyTitlesDeleted = 0;

      if (titlesToDelete.length > 0) {
        this.logger.info(`Deleting ${formatNumber(titlesToDelete.length)} unwanted provider title(s)...`);
        
        // Build bulk write operations for deletion
        const deleteOperations = titlesToDelete.map(t => ({
          deleteOne: {
            filter: {
              provider_id: t.provider_id,
              title_key: t.title_key
            }
          }
        }));

        const deleteResult = await this.providerTitlesManager.bulkWrite(deleteOperations);
        deletedCount = deleteResult.deletedCount || 0;
        this.logger.info(`Deleted ${formatNumber(deletedCount)} provider title(s)`);

        // Step 5: Group by provider and remove sources from main titles
        const titleKeysByProvider = new Map(); // provider_id -> Set of title_keys with TMDB matches
        
        for (const t of titlesToDelete) {
          if (t.tmdb_id) {
            if (!titleKeysByProvider.has(t.provider_id)) {
              titleKeysByProvider.set(t.provider_id, new Set());
            }
            titleKeysByProvider.get(t.provider_id).add(t.title_key);
          }
        }

        // Remove sources from main titles per provider
        for (const [providerId, titleKeysSet] of titleKeysByProvider.entries()) {
          // Check for cancellation before processing each provider
          this._checkCancellation(abortSignal);
          
          const titleKeys = Array.from(titleKeysSet);
          const pullResult = await this.titlesManager.removeProviderSourcesFromTitles(titleKeys, providerId);
          titlesUpdated += pullResult.modifiedCount || 0;
        }

        // Step 6: Global cleanup of empty media items and empty titles
        const allTitleKeys = [...new Set(titlesToDelete.filter(t => t.tmdb_id).map(t => t.title_key))];
        
        if (allTitleKeys.length > 0) {
          await this.titlesManager.removeEmptyMediaItems(allTitleKeys);
          const deleteResult = await this.titlesManager.deleteEmptyTitles(allTitleKeys);
          emptyTitlesDeleted = deleteResult.deletedCount || 0;
        }
      } else {
        this.logger.info('No unwanted provider titles found to cleanup');
      }

      // Step 6.5: Cleanup categories for disabled/deleted providers or disabled media types
      let categoriesDeleted = 0;
      for (const provider of allProviders) {
        // Check for cancellation before processing each provider
        this._checkCancellation(abortSignal);
        
        const providerId = provider.id;
        const isEnabled = provider.enabled !== false;
        const syncTypes = provider.sync_media_types || { 
          movies: true,
          tvshows: true,
          live: true
        };

        // Determine which categories to delete
        const shouldDeleteAll = !isEnabled || provider.deleted;
        
        if (shouldDeleteAll) {
          // Delete all categories for disabled/deleted provider
          const deleteResult = await this._providerCategoryManager.deleteCategoriesByProvider(providerId);
          const deleted = deleteResult.deletedCount || 0;
          categoriesDeleted += deleted;
          if (deleted > 0) {
            this.logger.info(`[${providerId}] Deleted ${formatNumber(deleted)} categories (provider disabled/deleted)`);
          }
        } else {
          // Delete categories for disabled media types
          if (!syncTypes.movies) {
            const deleteResult = await this._providerCategoryManager.deleteCategoriesByProviderAndType(providerId, 'movies');
            const deleted = deleteResult.deletedCount || 0;
            categoriesDeleted += deleted;
            if (deleted > 0) {
              this.logger.info(`[${providerId}] Deleted ${formatNumber(deleted)} movies categories (media type disabled)`);
            }
          }
          if (!syncTypes.tvshows) {
            const deleteResult = await this._providerCategoryManager.deleteCategoriesByProviderAndType(providerId, 'tvshows');
            const deleted = deleteResult.deletedCount || 0;
            categoriesDeleted += deleted;
            if (deleted > 0) {
              this.logger.info(`[${providerId}] Deleted ${formatNumber(deleted)} tvshows categories (media type disabled)`);
            }
          }
        }
      }

      if (categoriesDeleted > 0) {
        this.logger.info(`Deleted ${formatNumber(categoriesDeleted)} category/categories total`);
      }

      // Step 7: Cleanup Live TV channels for disabled providers/media types
      let channelsDeleted = 0;
      for (const provider of allProviders) {
        // Check for cancellation before processing each provider
        this._checkCancellation(abortSignal);
        
        const providerId = provider.id;
        const isEnabled = provider.enabled !== false;
        const syncTypes = provider.sync_media_types || { 
          movies: true,  // Default true for v1 providers
          tvshows: true,
          live: true
        };

        // If provider is disabled/deleted OR Live TV is disabled, delete ALL channels
        // Note: Live TV doesn't use category filtering - only media type on/off
        if (!isEnabled || provider.deleted || !syncTypes.live) {
          const deleted = await this._cleanupAllChannelsForProvider(providerId);
          channelsDeleted += deleted;
        }
      }

      if (channelsDeleted > 0) {
        this.logger.info(`Deleted ${formatNumber(channelsDeleted)} channel(s) from disabled providers/media types`);
      }

      // Set status to completed on success with result
      await this.setJobStatus('completed', {
        providers_processed: allProviders.length,
        titles_deleted: deletedCount,
        titles_updated: titlesUpdated,
        empty_titles_deleted: emptyTitlesDeleted,
        channels_deleted: channelsDeleted,
        categories_deleted: categoriesDeleted
      });

      return {
        providers_processed: allProviders.length,
        titles_deleted: deletedCount,
        titles_updated: titlesUpdated,
        empty_titles_deleted: emptyTitlesDeleted,
        channels_deleted: channelsDeleted,
        categories_deleted: categoriesDeleted
      };
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
}

