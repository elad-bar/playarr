import { BaseJob } from './BaseJob.js';
import { formatNumber } from '../utils/numberFormat.js';
import { AGTVProcessingManager } from '../managers/processing/AGTVProcessingManager.js';
import { XtreamProcessingManager } from '../managers/processing/XtreamProcessingManager.js';

/**
 * Processing manager registry mapping provider types to processing manager classes
 * @private
 */
const PROCESSING_MANAGER_REGISTRY = {
  'agtv': AGTVProcessingManager,
  'xtream': XtreamProcessingManager
};

/**
 * Base class for jobs that require a save coordinator and handler creation
 * Extends BaseJob and adds save coordinator functionality and handler creation
 * @abstract
 */
export class BaseJobWithSaveCoordinator extends BaseJob {
  /**
   * @param {string} jobName - Name identifier for this job (used in logging)
   * @param {import('../managers/domain/JobHistoryManager.js').JobHistoryManager} jobHistoryManager - Job history manager
   * @param {import('../managers/orchestration/JobSaveCoordinatorManager.js').JobSaveCoordinatorManager} saveCoordinator - Save coordinator instance
   * @param {import('../managers/orchestration/ProvidersManager.js').ProvidersManager} providersManager - Providers manager for direct API calls
   * @param {import('../managers/processing/TMDBProcessingManager.js').TMDBProcessingManager} tmdbProcessingManager - TMDB processing manager instance
   */
  constructor(jobName, jobHistoryManager, saveCoordinator, providersManager, tmdbProcessingManager) {
    super(jobName, jobHistoryManager);
    this._saveCoordinator = saveCoordinator;
    this.providersManager = providersManager;
    this.tmdbProcessingManager = tmdbProcessingManager;
  }

  /**
   * Start the save coordinator interval
   * @protected
   */
  _startSaveCoordinator() {
    this._saveCoordinator.start();
  }

  /**
   * Stop the save coordinator interval and perform final save
   * @protected
   */
  async _stopSaveCoordinator() {
    await this._saveCoordinator.finalSave();
    this._saveCoordinator.stop();
  }

  /**
   * Create handler instances for all configured providers
   * Uses registry pattern to create handlers based on provider type
   * Note: This method expects tmdbManager and providerTitlesManager to be available on the subclass instance
   * @protected
   * @returns {Promise<{handlers: Map<string, import('../managers/processing/BaseIPTVProcessingManager.js').BaseIPTVProcessingManager>}>} Handlers map
   */
  async _createHandlers() {
    const handlers = new Map();
    
    try {
      // Load enabled provider configurations using ProvidersManager (uses cache)
      const providers = await this.providersManager.getEnabledProviders({ excludeDeleted: true });
      
      // Sort by priority (lower number = higher priority)
      providers.sort((a, b) => (a.priority || 999) - (b.priority || 999));
      
      if (providers.length === 0) {
        this.logger.warn('No providers found in database');
        return { handlers };
      }
      
      this.logger.info(`Creating processing managers for ${formatNumber(providers.length)} provider(s)...`);
      
      // Create processing manager for each provider
      for (const providerData of providers) {
        const providerId = providerData.id;
        const providerType = providerData.type;
        
        // Get processing manager class from registry
        const ProcessingManagerClass = PROCESSING_MANAGER_REGISTRY[providerType];
        
        if (!ProcessingManagerClass) {
          this.logger.warn(`No processing manager registered for provider type "${providerType}" (provider: ${providerId})`);
          continue;
        }
        
        try {
          // Create processing manager instance with dependency injection
          // tmdbManager and providerTitlesManager are expected to be on the subclass instance
          const processingManager = new ProcessingManagerClass(
            providerData,
            this.providerTitlesManager,
            this.providersManager,
            this.tmdbManager,
            this.tmdbProcessingManager,
            this._saveCoordinator
          );
          
          handlers.set(providerId, processingManager);
          this.logger.debug(`Created ${providerType} processing manager for provider ${providerId}`);
        } catch (error) {
          this.logger.error(`Error creating processing manager for provider ${providerId}: ${error.message}`);
        }
      }
      
      this.logger.info(`Created ${formatNumber(handlers.size)} processing manager(s)`);
      return { handlers };
    } catch (error) {
      this.logger.error(`Error creating handlers: ${error.message}`);
      throw error;
    }
  }
}

