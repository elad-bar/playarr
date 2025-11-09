import { BaseJob } from './BaseJob.js';
import { ProviderInitializer } from '../utils/ProviderInitializer.js';

/**
 * Job for monitoring configuration changes (providers, settings, cache policies)
 * Runs every 1 minute to detect and apply configuration changes dynamically
 * @extends {BaseJob}
 */
export class MonitorConfigurationJob extends BaseJob {
  /**
   * @param {import('../managers/StorageManager.js').StorageManager} cache - Storage manager instance for temporary cache
   * @param {import('../services/MongoDataService.js').MongoDataService} mongoData - MongoDB data service instance
   * @param {Map<string, import('../providers/BaseIPTVProvider.js').BaseIPTVProvider>} providers - Map of providerId -> provider instance (already initialized)
   * @param {import('../providers/TMDBProvider.js').TMDBProvider} tmdbProvider - TMDB provider singleton instance
   */
  constructor(cache, mongoData, providers, tmdbProvider) {
    super('MonitorConfigurationJob', cache, mongoData, providers, tmdbProvider);
  }

  /**
   * Execute the job - monitor and apply configuration changes
   * @returns {Promise<{providersUpdated: number, settingsUpdated: boolean, cachePoliciesUpdated: boolean}>}
   */
  async execute() {
    // Validate only cache and mongoData (providers and tmdbProvider might not be initialized yet)
    if (!this.cache) {
      throw new Error('Cache storage manager is required');
    }
    if (!this.mongoData) {
      throw new Error('MongoDB data service is required');
    }

    const jobName = 'MonitorConfigurationJob';
    let providersUpdated = 0;
    let settingsUpdated = false;
    let cachePoliciesUpdated = false;

    try {
      // Get last check timestamps from job history
      const jobHistory = await this.mongoData.getJobHistory(jobName);
      const lastProviderCheck = jobHistory?.last_provider_check ? new Date(jobHistory.last_provider_check) : new Date(0);
      const lastSettingsCheck = jobHistory?.last_settings_check ? new Date(jobHistory.last_settings_check) : new Date(0);
      const lastPolicyCheck = jobHistory?.last_policy_check ? new Date(jobHistory.last_policy_check) : new Date(0);

      const now = new Date();

      // 1. Check providers for changes
      providersUpdated = await this._checkProviders(lastProviderCheck);

      // 2. Check settings for changes
      settingsUpdated = await this._checkSettings(lastSettingsCheck);

      // 3. Check cache policies for changes
      cachePoliciesUpdated = await this._checkCachePolicies(lastPolicyCheck);

      // Update job history with new check timestamps
      await this.mongoData.updateJobHistory(jobName, {
        last_provider_check: now,
        last_settings_check: now,
        last_policy_check: now,
        providers_updated: providersUpdated,
        settings_updated: settingsUpdated,
        cache_policies_updated: cachePoliciesUpdated
      });

      if (providersUpdated > 0 || settingsUpdated || cachePoliciesUpdated) {
        this.logger.info(`Configuration changes detected: ${providersUpdated} provider(s) updated, settings: ${settingsUpdated}, cache policies: ${cachePoliciesUpdated}`);
      }

      return { providersUpdated, settingsUpdated, cachePoliciesUpdated };
    } catch (error) {
      this.logger.error(`Job execution failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check providers for changes and update engine accordingly
   * @private
   * @param {Date} lastCheck - Last check timestamp
   * @returns {Promise<number>} Number of providers updated
   */
  async _checkProviders(lastCheck) {
    try {
      // Query providers updated since last check
      const updatedProviders = await this.mongoData.db.collection('iptv_providers')
        .find({
          lastUpdated: { $gt: lastCheck }
        })
        .toArray();

      if (updatedProviders.length === 0) {
        return 0;
      }

      this.logger.debug(`Found ${updatedProviders.length} provider(s) updated since last check`);

      let updatedCount = 0;
      const loadedProviders = ProviderInitializer.loadedProviders || new Map();
      const loadedProviderIds = new Set(loadedProviders.keys());

      for (const provider of updatedProviders) {
        try {
          const providerId = provider.id;
          const isLoaded = loadedProviderIds.has(providerId);
          const isEnabled = provider.enabled === true;
          const isDeleted = provider.deleted === true;

          if (isDeleted || !isEnabled) {
            // Provider was deleted or disabled - remove from engine
            if (isLoaded) {
              await ProviderInitializer.removeProvider(providerId);
              updatedCount++;
              this.logger.info(`Removed provider: ${providerId} (${isDeleted ? 'deleted' : 'disabled'})`);
            }
          } else {
            // Provider is enabled and not deleted
            if (isLoaded) {
              // Provider exists - reload it
              await ProviderInitializer.reloadProvider(providerId);
              updatedCount++;
              this.logger.info(`Reloaded provider: ${providerId}`);
            } else {
              // New provider - add it
              await ProviderInitializer.addProvider(provider);
              updatedCount++;
              this.logger.info(`Added new provider: ${providerId}`);
            }
          }
        } catch (error) {
          this.logger.error(`Error processing provider ${provider.id}: ${error.message}`);
        }
      }

      // Check for providers that were deleted/disabled but still loaded
      const allProviders = await this.mongoData.getIPTVProviders();
      const enabledProviderIds = new Set(allProviders.map(p => p.id));

      for (const [providerId] of loadedProviders) {
        if (!enabledProviderIds.has(providerId)) {
          // Provider is no longer enabled - remove it
          await ProviderInitializer.removeProvider(providerId);
          updatedCount++;
          this.logger.info(`Removed provider: ${providerId} (no longer enabled)`);
        }
      }

      return updatedCount;
    } catch (error) {
      this.logger.error(`Error checking providers: ${error.message}`);
      return 0;
    }
  }

  /**
   * Check settings for changes and update TMDB provider
   * @private
   * @param {Date} lastCheck - Last check timestamp
   * @returns {Promise<boolean>} True if settings were updated
   */
  async _checkSettings(lastCheck) {
    try {
      // Query settings updated since last check
      const updatedSettings = await this.mongoData.db.collection('settings')
        .find({
          lastUpdated: { $gt: lastCheck },
          _id: { $in: ['tmdb_token', 'tmdb_api_rate'] }
        })
        .toArray();

      if (updatedSettings.length === 0) {
        return false;
      }

      this.logger.debug(`Found ${updatedSettings.length} TMDB setting(s) updated since last check`);

      // Load all settings to get current values
      const allSettings = await this.mongoData.getSettings();
      
      // Update TMDB provider with new settings
      const tmdbSettings = {
        tmdb_token: allSettings.tmdb_token,
        tmdb_api_rate: allSettings.tmdb_api_rate
      };

      await this.tmdbProvider.updateSettings(tmdbSettings);
      this.logger.info('TMDB settings updated');

      return true;
    } catch (error) {
      this.logger.error(`Error checking settings: ${error.message}`);
      return false;
    }
  }

  /**
   * Check cache policies for changes and reload for all providers
   * @private
   * @param {Date} lastCheck - Last check timestamp
   * @returns {Promise<boolean>} True if cache policies were updated
   */
  async _checkCachePolicies(lastCheck) {
    try {
      // Query cache policies updated since last check
      const updatedPolicies = await this.mongoData.db.collection('cache_policy')
        .find({
          lastUpdated: { $gt: lastCheck }
        })
        .toArray();

      if (updatedPolicies.length === 0) {
        return false;
      }

      this.logger.debug(`Found ${updatedPolicies.length} cache policy/policies updated since last check`);

      // Reload cache policies for all providers
      await ProviderInitializer.reloadCachePolicies();
      this.logger.info('Cache policies reloaded for all providers');

      return true;
    } catch (error) {
      this.logger.error(`Error checking cache policies: ${error.message}`);
      return false;
    }
  }
}

