import { createLogger } from '../utils/logger.js';
import { AGTVHandler } from '../handlers/AGTVHandler.js';
import { XtreamHandler } from '../handlers/XtreamHandler.js';
import { TMDBHandler } from '../handlers/TMDBHandler.js';

/**
 * Handler registry mapping provider types to handler classes
 * @private
 */
const HANDLER_REGISTRY = {
  'agtv': AGTVHandler,
  'xtream': XtreamHandler,
  'tmdb': TMDBHandler
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
   * @param {import('../repositories/ProviderRepository.js').ProviderRepository} providerRepo - Provider repository
   * @param {import('../repositories/ProviderTitleRepository.js').ProviderTitleRepository} providerTitleRepo - Provider title repository
   * @param {import('../repositories/TitleRepository.js').TitleRepository} titleRepo - Title repository
   * @param {import('../repositories/TitleStreamRepository.js').TitleStreamRepository} titleStreamRepo - Title stream repository
   * @param {import('../repositories/JobHistoryRepository.js').JobHistoryRepository} jobHistoryRepo - Job history repository
   * @param {import('../managers/providers.js').ProvidersManager} providersManager - Providers manager for direct API calls
   * @param {import('../managers/tmdb.js').TMDBManager} tmdbManager - TMDB manager (for API key management, kept for routes)
   * @param {import('../providers/TMDBProvider.js').TMDBProvider} tmdbProvider - TMDB provider for direct API calls
   */
  constructor(jobName, providerRepo, providerTitleRepo, titleRepo, titleStreamRepo, jobHistoryRepo, providersManager, tmdbManager, tmdbProvider) {
    if (this.constructor === BaseJob) {
      throw new Error('BaseJob is an abstract class and cannot be instantiated directly');
    }

    this.jobName = jobName;
    this.providerRepo = providerRepo;
    this.providerTitleRepo = providerTitleRepo;
    this.titleRepo = titleRepo;
    this.titleStreamRepo = titleStreamRepo;
    this.jobHistoryRepo = jobHistoryRepo;
    this.providersManager = providersManager;
    this.tmdbManager = tmdbManager;
    this.tmdbProvider = tmdbProvider;
    this.logger = createLogger(jobName);
    
    // Handlers will be created dynamically in execute() method
    this.handlers = null; // Map<string, BaseIPTVHandler> - created per job execution
    this.tmdbHandler = null; // TMDBHandler - created per job execution
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
    if (!this.providerRepo) {
      throw new Error('ProviderRepository is required');
    }
    if (!this.providerTitleRepo) {
      throw new Error('ProviderTitleRepository is required');
    }
    if (!this.titleRepo) {
      throw new Error('TitleRepository is required');
    }
    if (!this.titleStreamRepo) {
      throw new Error('TitleStreamRepository is required');
    }
    if (!this.jobHistoryRepo) {
      throw new Error('JobHistoryRepository is required');
    }
    if (!this.providersManager) {
      throw new Error('Providers manager is required');
    }
    if (!this.tmdbManager) {
      throw new Error('TMDB manager is required');
    }
    if (!this.tmdbProvider) {
      throw new Error('TMDB provider is required');
    }
  }

  /**
   * Create handler instances for all configured providers
   * Uses registry pattern to create handlers based on provider type
   * @protected
   * @returns {Promise<Map<string, import('../handlers/BaseIPTVHandler.js').BaseIPTVHandler>>} Map of providerId -> handler instance
   */
  async _createHandlers() {
    const handlers = new Map();
    
    try {
      // Create TMDB handler first (needed by IPTV handlers)
      this.tmdbHandler = this._createTMDBHandler();
      
      // Load all provider configurations using ProvidersManager (uses cache)
      const providersResult = await this.providersManager.getProviders();
      const providers = (providersResult.response?.providers || [])
        .filter(p => !p.deleted)
        .sort((a, b) => (a.priority || 999) - (b.priority || 999));
      
      if (providers.length === 0) {
        this.logger.warn('No providers found in database');
        return handlers;
      }
      
      this.logger.info(`Creating handlers for ${providers.length} provider(s)...`);
      
      // Create handler for each provider
      for (const providerData of providers) {
        const providerId = providerData.id;
        const providerType = providerData.type;
        
        // Get handler class from registry
        const HandlerClass = HANDLER_REGISTRY[providerType];
        
        if (!HandlerClass) {
          this.logger.warn(`No handler registered for provider type "${providerType}" (provider: ${providerId})`);
          continue;
        }
        
        try {
          // Create handler instance with dependency injection
          const handler = new HandlerClass(
            providerData,
            this.providerTitleRepo,
            this.providerRepo,
            this.providersManager,
            this.tmdbManager,
            this.tmdbHandler
          );
          
          handlers.set(providerId, handler);
          this.logger.debug(`Created ${providerType} handler for provider ${providerId}`);
        } catch (error) {
          this.logger.error(`Error creating handler for provider ${providerId}: ${error.message}`);
        }
      }
      
      this.logger.info(`Created ${handlers.size} handler(s)`);
      return handlers;
    } catch (error) {
      this.logger.error(`Error creating handlers: ${error.message}`);
      throw error;
    }
  }

  /**
   * Create TMDB handler instance
   * @protected
   * @returns {import('../handlers/TMDBHandler.js').TMDBHandler} TMDB handler instance
   */
  _createTMDBHandler() {
    const providerData = {
      id: 'tmdb',
      type: 'tmdb',
      api_rate: {
        concurrent: 45,
        duration_seconds: 1
      }
    };
    
    return new TMDBHandler(providerData, this.titleRepo, this.titleStreamRepo, this.tmdbProvider, this.providerTitleRepo);
  }

  /**
   * Get provider configuration from MongoDB
   * @param {string} providerId - Provider ID
   * @returns {Promise<Object|null>} Provider configuration document or null if not found
   */
  async getProviderConfig(providerId) {
    try {
      const providerResult = await this.providersManager.getProvider(providerId);
      if (providerResult.statusCode === 200 && !providerResult.response.deleted) {
        return providerResult.response;
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
    const { fallbackDate = null, logMessage, noExecutionMessage } = options;
    
    try {
      const jobHistory = await this.jobHistoryRepo.findOneByQuery({ job_name: this.jobName });
      if (jobHistory && jobHistory.last_execution) {
        const lastExecution = new Date(jobHistory.last_execution);
        if (logMessage) {
          this.logger.info(logMessage.replace('{date}', lastExecution.toISOString()));
        }
        return lastExecution;
      } else {
        if (noExecutionMessage) {
          this.logger.info(noExecutionMessage);
        }
        return fallbackDate;
      }
    } catch (error) {
      this.logger.error(`Error getting last execution: ${error.message}`);
      return fallbackDate;
    }
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
    await this.jobHistoryRepo.updateStatus(this.jobName, status, providerId, result);
  }
}

