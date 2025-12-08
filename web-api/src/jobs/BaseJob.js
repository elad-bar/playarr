import { createLogger } from '../utils/logger.js';
import { formatNumber } from '../utils/numberFormat.js';
import { AGTVProcessingManager } from '../managers/processing/AGTVProcessingManager.js';
import { XtreamProcessingManager } from '../managers/processing/XtreamProcessingManager.js';
import { TMDBProcessingManager } from '../managers/processing/TMDBProcessingManager.js';

/**
 * Processing manager registry mapping provider types to processing manager classes
 * @private
 */
const PROCESSING_MANAGER_REGISTRY = {
  'agtv': AGTVProcessingManager,
  'xtream': XtreamProcessingManager,
  'tmdb': TMDBProcessingManager
};

/**
 * Base class for all jobs
 * Provides common functionality: handlers, managers, and logger
 * Jobs create handler instances dynamically based on provider configurations
 * @abstract
 */
export class BaseJob {
  /**
   * @param {string} jobName - Name identifier for this job (used in logging)
   * @param {import('../managers/domain/JobHistoryManager.js').JobHistoryManager} jobHistoryManager - Job history manager
   * @param {import('../managers/orchestration/ProvidersManager.js').ProvidersManager} providersManager - Providers manager for direct API calls
   * @param {import('../managers/domain/TMDBManager.js').TMDBManager} tmdbManager - TMDB manager (for API calls and API key management)
   * @param {import('../managers/domain/TitlesManager.js').TitlesManager} titlesManager - Titles manager (for saving titles)
   * @param {import('../managers/domain/ProviderTitlesManager.js').ProviderTitlesManager} providerTitlesManager - Provider titles manager (for saving provider titles)
   */
  constructor(jobName, jobHistoryManager, providersManager, tmdbManager, titlesManager, providerTitlesManager, metricsService) {
    if (this.constructor === BaseJob) {
      throw new Error('BaseJob is an abstract class and cannot be instantiated directly');
    }

    this.jobName = jobName;
    this.jobHistoryManager = jobHistoryManager;
    this.providersManager = providersManager;
    this.tmdbManager = tmdbManager;
    this.titlesManager = titlesManager;
    this.providerTitlesManager = providerTitlesManager;
    this.metricsService = metricsService;
    this.logger = createLogger(jobName);
    
    // Processing managers will be created dynamically in execute() method
    this.handlers = null; // Map<string, BaseIPTVProcessingManager> - created per job execution
    this.tmdbProcessingManager = null; // TMDBProcessingManager - created per job execution
  }

  /**
   * Execute the job
   * Must be implemented by subclasses
   * @abstract
   * @param {AbortSignal} [abortSignal] - AbortSignal for cancellation
   * @returns {Promise<any>} Job execution result
   */
  async execute(abortSignal) {
    throw new Error('execute() must be implemented by subclass');
  }

  /**
   * Check if job execution should be cancelled
   * @protected
   * @param {AbortSignal} [abortSignal] - AbortSignal to check
   * @throws {Error} If job is aborted
   */
  _checkCancellation(abortSignal) {
    if (abortSignal && abortSignal.aborted) {
      const error = new Error(`Job '${this.jobName}' was cancelled`);
      error.name = 'AbortError';
      error.cancelled = true;
      throw error;
    }
  }

  /**
   * Helper to check cancellation periodically in loops
   * @protected
   * @param {AbortSignal} [abortSignal] - AbortSignal to check
   * @param {number} [checkInterval=100] - How often to check (every N iterations)
   * @param {number} [currentIteration] - Current iteration number
   * @returns {boolean} True if cancellation should be checked
   */
  _shouldCheckCancellation(abortSignal, checkInterval = 100, currentIteration = 0) {
    return abortSignal && currentIteration % checkInterval === 0;
  }

  /**
   * Create handler instances for all configured providers
   * Uses registry pattern to create handlers based on provider type
   * @protected
   * @returns {Promise<Map<string, import('../managers/processing/BaseIPTVProcessingManager.js').BaseIPTVProcessingManager>>} Map of providerId -> processing manager instance
   */
  async _createHandlers() {
    const handlers = new Map();
    
    try {
      // Create TMDB processing manager first (needed by IPTV processing managers)
      this.tmdbProcessingManager = this._createTMDBProcessingManager();
      
      // Load enabled provider configurations using ProvidersManager (uses cache)
      const providers = await this.providersManager.getEnabledProviders({ excludeDeleted: true });
      
      // Sort by priority (lower number = higher priority)
      providers.sort((a, b) => (a.priority || 999) - (b.priority || 999));
      
      if (providers.length === 0) {
        this.logger.warn('No providers found in database');
        return handlers;
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
          const processingManager = new ProcessingManagerClass(
            providerData,
            this.providerTitlesManager,
            this.providersManager,
            this.tmdbManager,
            this.tmdbProcessingManager
          );
          
          handlers.set(providerId, processingManager);
          this.logger.debug(`Created ${providerType} processing manager for provider ${providerId}`);
        } catch (error) {
          this.logger.error(`Error creating processing manager for provider ${providerId}: ${error.message}`);
        }
      }
      
      this.logger.info(`Created ${formatNumber(handlers.size)} processing manager(s)`);
      return handlers;
    } catch (error) {
      this.logger.error(`Error creating handlers: ${error.message}`);
      throw error;
    }
  }

  /**
   * Create TMDB processing manager instance
   * @protected
   * @returns {import('../managers/processing/TMDBProcessingManager.js').TMDBProcessingManager} TMDB processing manager instance
   */
  _createTMDBProcessingManager() {
    const providerData = {
      id: 'tmdb',
      type: 'tmdb',
      api_rate: {
        concurrent: 45,
        duration_seconds: 1
      }
    };
    
    return new TMDBProcessingManager(providerData, this.titlesManager, this.tmdbManager, this.providerTitlesManager);
  }

  /**
   * Get provider configuration from MongoDB
   * @param {string} providerId - Provider ID
   * @returns {Promise<Object|null>} Provider configuration document or null if not found
   */
  async getProviderConfig(providerId) {
    try {
      const provider = await this.providersManager.getProvider(providerId);
      if (provider && !provider.deleted) {
        return provider;
      }
      return null;
    } catch (error) {
      this.logger.error(`Error getting provider config for ${providerId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get last execution time from job history
   * @param {Object} [options] - Options for getting last execution
   * @param {Date|null} [options.fallbackDate] - Fallback date if no execution found (null means no fallback)
   * @param {string} [options.logMessage] - Log message template with {date} placeholder
   * @param {string} [options.noExecutionMessage] - Message to log when no execution found
   * @returns {Promise<Date|null>} Last execution date or fallback date or null
   */
  async getLastExecution(options = {}) {
    return await this.jobHistoryManager.getLastExecution(this.jobName, options);
  }

  /**
   * Update job status in MongoDB
   * If result is provided, also updates job history in the same operation
   * @param {string} status - Job status: "running" | "cancelled" | "completed" | "failed"
   * @param {Object|null} [result=null] - Optional execution result object (if provided, updates both status and history)
   * @param {string} [providerId=null] - Optional provider ID for provider-specific jobs
   * @returns {Promise<void>}
   */
  async setJobStatus(status, result = null, providerId = null) {
    await this.jobHistoryManager.updateStatus(this.jobName, status, providerId, result);
  }
}

