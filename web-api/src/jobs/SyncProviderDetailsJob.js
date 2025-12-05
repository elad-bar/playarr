import { BaseJob } from './BaseJob.js';
import { formatNumber } from '../utils/numberFormat.js';

/**
 * Job for syncing provider account details (expiration, connections) from authentication endpoints
 * Runs every 1 minute to update provider details
 * Xtream providers: checked every minute
 * AGTV providers: checked only if details missing or last_checked > 1 day old
 * @extends {BaseJob}
 */
export class SyncProviderDetailsJob extends BaseJob {
  /**
   * @param {string} jobName - Name identifier for this job (used in logging)
   * @param {import('../managers/domain/JobHistoryManager.js').JobHistoryManager} jobHistoryManager - Job history manager
   * @param {import('../managers/orchestration/ProvidersManager.js').ProvidersManager} providersManager - Providers manager for direct API calls
   * @param {import('../managers/domain/TMDBManager.js').TMDBManager} tmdbManager - TMDB manager for API calls
   * @param {import('../managers/domain/TitlesManager.js').TitlesManager} titlesManager - Titles manager
   * @param {import('../managers/domain/ProviderTitlesManager.js').ProviderTitlesManager} providerTitlesManager - Provider titles manager
   */
  constructor(jobName, jobHistoryManager, providersManager, tmdbManager, titlesManager, providerTitlesManager) {
    super(jobName, jobHistoryManager, providersManager, tmdbManager, titlesManager, providerTitlesManager);
  }

  /**
   * Execute the job - sync provider details for all active providers
   * Xtream providers: checked every minute
   * AGTV providers: checked only if details missing or last_checked > 1 day old
   * @returns {Promise<Array<{providerId: string, success: boolean, error?: string}>>} Array of sync results
   */
  async execute() {
    const executionStartTime = Date.now();

    try {
      // Set status to "running" at start
      await this.setJobStatus('running');

      // Fetch enabled, non-deleted providers
      const activeProviders = await this.providersManager.getEnabledProviders({ excludeDeleted: true });

      // Filter providers based on type and last_checked
      const providersToProcess = activeProviders.filter(provider => {
        const providerType = provider.type?.toLowerCase();
        
        // Always process Xtream providers
        if (providerType === 'xtream') {
          return true;
        }
        
        // For AGTV: only process if details missing or last_checked > 1 day old
        if (providerType === 'agtv') {
          const details = provider.provider_details;
          
          // Process if details are missing
          if (!details || !details.last_checked) {
            this.logger.debug(`[${provider.id}] AGTV provider: processing (details missing)`);
            return true;
          }
          
          // Process if last_checked is older than 1 day
          const lastChecked = new Date(details.last_checked);
          const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
          const shouldProcess = lastChecked < oneDayAgo;
          
          if (shouldProcess) {
            this.logger.debug(`[${provider.id}] AGTV provider: processing (last_checked: ${details.last_checked} is older than 1 day)`);
          } else {
            this.logger.debug(`[${provider.id}] AGTV provider: skipping (last_checked: ${details.last_checked} is less than 1 day old)`);
          }
          
          return shouldProcess;
        }
        
        // Skip unknown provider types
        this.logger.debug(`[${provider.id}] Unknown provider type: ${providerType}, skipping`);
        return false;
      });

      this.logger.info(`Starting provider details sync for ${formatNumber(providersToProcess.length)} provider(s) (${formatNumber(activeProviders.length)} total active)...`);

      if (providersToProcess.length === 0) {
        this.logger.info('No providers to process. Skipping sync.');
        await this.setJobStatus('completed', {
          providers_processed: 0,
          results: []
        });
        return [];
      }

      const results = [];

      // Process each provider
      for (const provider of providersToProcess) {
        const providerId = provider.id;
        const providerType = provider.type?.toLowerCase();
        try {
          // Get provider instance
          const providerInstance = this.providersManager.getProviderInstance(providerType);
          if (!providerInstance) {
            this.logger.warn(`[${providerId}] Provider instance not found for type: ${providerType}`);
            results.push({
              providerId,
              success: false,
              error: `Provider instance not found for type: ${providerType}`
            });
            continue;
          }

          // Authenticate and get provider details
          this.logger.debug(`[${providerId}] Authenticating with ${providerType} provider...`);
          const authDetails = await providerInstance.authenticate(providerId);

          // Check if provider is inactive (active === false)
          if (authDetails.active === false && provider.enabled !== false) {
            this.logger.warn(`[${providerId}] Provider is inactive, disabling provider automatically`);
            try {
              await this.providersManager.updateProvider(providerId, { enabled: false });
              this.logger.info(`[${providerId}] Provider disabled due to inactive status`);
            } catch (disableError) {
              this.logger.error(`[${providerId}] Failed to disable provider: ${disableError.message}`);
            }
          }

          // Prepare details object for update
          const details = {
            expiration_date: authDetails.expiration_date ?? null,
            max_connections: authDetails.max_connections ?? 0,
            active_connections: authDetails.active_connections ?? 0,
            active: authDetails.active ?? null
          };

          // Update provider details via lightweight method
          await this.providersManager.updateProviderDetails(providerId, details);

          this.logger.debug(`[${providerId}] Provider details updated successfully`);
          results.push({
            providerId,
            success: true
          });
        } catch (error) {
          // Log authentication error
          this.logger.error(`[${providerId}] Error syncing provider details: ${error.message}`);
          
          // Update provider details with error tracking
          try {
            await this.providersManager.updateProviderDetails(providerId, {
              expiration_date: null,
              max_connections: 0,
              active_connections: 0,
              active: null,
              last_error: error.message
            });
          } catch (updateError) {
            this.logger.error(`[${providerId}] Failed to update provider details with error: ${updateError.message}`);
          }

          results.push({
            providerId,
            success: false,
            error: error.message
          });
        }
      }

      const executionTime = Date.now() - executionStartTime;
      const successCount = results.filter(r => r.success).length;
      const failureCount = results.filter(r => !r.success).length;

      this.logger.info(
        `Provider details sync completed: ${providersToProcess.length} processed, ` +
        `${successCount} succeeded, ${failureCount} failed (${executionTime}ms)`
      );

      // Set status to completed with results
      await this.setJobStatus('completed', {
        providers_processed: providersToProcess.length,
        success_count: successCount,
        failure_count: failureCount,
        execution_time_ms: executionTime,
        results: results
      });

      return results;
    } catch (error) {
      const executionTime = Date.now() - executionStartTime;
      this.logger.error(`Job execution failed after ${executionTime}ms: ${error.message}`);
      
      // Set status to failed with error result
      await this.setJobStatus('failed', {
        error: error.message,
        execution_time_ms: executionTime
      }).catch(err => {
        this.logger.error(`Failed to update job history: ${err.message}`);
      });
      throw error;
    }
  }
}

