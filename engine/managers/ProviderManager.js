import { createLogger } from '../utils/logger.js';
import { ApplicationContext } from '../context/ApplicationContext.js';

/**
 * Provider manager for handling provider lifecycle events
 * Manages provider creation, deletion, updates, and state changes
 */
export class ProviderManager {
  /**
   * @param {import('../services/MongoDataService.js').MongoDataService} mongoData - MongoDB data service
   */
  constructor(mongoData) {
    this.mongoData = mongoData;
    this.logger = createLogger('ProviderManager');
    
    // Action to handler method mapping
    this.actionHandlers = {
      'created': this.handleCreated.bind(this),
      'deleted': this.handleDeleted.bind(this),
      'enabled': this.handleEnabled.bind(this),
      'disabled': this.handleDisabled.bind(this),
      'categories-changed': this.handleCategoriesChanged.bind(this),
      'updated': this.handleUpdated.bind(this)
    };
  }

  /**
   * Handle provider changed event
   * @param {string} providerId - Provider ID
   * @param {string} action - Action type
   * @param {Object} [providerConfig] - Optional provider configuration
   * @returns {Promise<{providerId: string, actions: Array<{type: string, jobName?: string, data?: Object}>}>} Result object with actions to execute
   */
  async handleProviderChanged(providerId, action, providerConfig = null) {
    const handler = this.actionHandlers[action];
    if (!handler) {
      throw new Error(`Invalid action: ${action}. Must be one of: ${Object.keys(this.actionHandlers).join(', ')}`);
    }

    this.logger.info(`Provider changed event: ${action} for provider ${providerId}`);
    return await handler(providerId, providerConfig);
  }

  /**
   * Handle provider created
   * @param {string} providerId - Provider ID
   * @param {Object} [providerConfig] - Optional provider configuration
   * @returns {Promise<{providerId: string, actions: Array<{type: string, jobName?: string, data?: Object}>}>} Result object with actions to execute
   */
  async handleCreated(providerId, providerConfig = null) {
    const context = ApplicationContext.getInstance();
    
    // Fetch provider config if not provided
    if (!providerConfig) {
      providerConfig = await this.mongoData.getProviderConfig(providerId);
    }

    if (!providerConfig) {
      throw new Error(`Provider ${providerId} not found in database`);
    }

    // Get or create provider instance
    let providerInstance = context.providers.get(providerId);
    if (providerInstance) {
      this.logger.info(`Provider ${providerId} already exists in context, updating configuration`);
      await providerInstance.updateConfiguration(providerConfig);
    } else {
      // Create new provider instance
      providerInstance = context.createProviderInstance(providerConfig);
      await providerInstance.initializeCachePolicies();
      context.providers.set(providerId, providerInstance);
      this.logger.info(`Added provider ${providerId} to ApplicationContext`);
    }

    // Build result with actions
    const result = {
      providerId,
      actions: []
    };

    // If enabled, add trigger job action
    if (providerConfig.enabled) {
      result.actions.push({
        type: 'triggerJob',
        jobName: 'syncIPTVProviderTitles',
        data: { providerId }
      });
    }

    return result;
  }

  /**
   * Handle provider deleted
   * @param {string} providerId - Provider ID
   * @param {Object} [providerConfig] - Optional provider configuration (unused for delete)
   * @returns {Promise<{providerId: string, actions: Array}>} Result object with actions to execute
   */
  async handleDeleted(providerId, providerConfig = null) {
    const context = ApplicationContext.getInstance();
    const providerInstance = context.providers.get(providerId);

    if (providerInstance) {
      // Cleanup cache files
      await providerInstance.cleanup();
      
      // Delete cache policies
      await providerInstance.deleteCachePolicies();
      
      // Remove from ApplicationContext
      context.providers.delete(providerId);
      this.logger.info(`Removed provider ${providerId} from ApplicationContext`);
    } else {
      this.logger.warn(`Provider ${providerId} instance not found in ApplicationContext, skipping cleanup`);
    }

    return {
      providerId,
      actions: []
    };
  }

  /**
   * Handle provider enabled
   * @param {string} providerId - Provider ID
   * @param {Object} [providerConfig] - Optional provider configuration
   * @returns {Promise<{providerId: string, actions: Array<{type: string, jobName?: string, data?: Object}>}>} Result object with actions to execute
   */
  async handleEnabled(providerId, providerConfig = null) {
    const context = ApplicationContext.getInstance();
    
    // Fetch provider config if not provided
    if (!providerConfig) {
      providerConfig = await this.mongoData.getProviderConfig(providerId);
    }

    if (!providerConfig) {
      throw new Error(`Provider ${providerId} not found in database`);
    }

    // Get or create provider instance
    let providerInstance = context.providers.get(providerId);
    if (!providerInstance) {
      providerInstance = context.createProviderInstance(providerConfig);
      await providerInstance.initializeCachePolicies();
      context.providers.set(providerId, providerInstance);
      this.logger.info(`Created provider instance for ${providerId}`);
    }

    // Update configuration
    await providerInstance.updateConfiguration(providerConfig);

    // Reset lastUpdated for all provider titles
    const titlesUpdated = await providerInstance.resetTitlesLastUpdated();
    this.logger.info(`Reset lastUpdated for ${titlesUpdated} provider titles for ${providerId}`);

    return {
      providerId,
      actions: [{
        type: 'triggerJob',
        jobName: 'syncIPTVProviderTitles',
        data: { providerId }
      }]
    };
  }

  /**
   * Handle provider disabled
   * @param {string} providerId - Provider ID
   * @param {Object} [providerConfig] - Optional provider configuration
   * @returns {Promise<{providerId: string, actions: Array}>} Result object with actions to execute
   */
  async handleDisabled(providerId, providerConfig = null) {
    const context = ApplicationContext.getInstance();
    
    // Fetch provider config if not provided
    if (!providerConfig) {
      providerConfig = await this.mongoData.getProviderConfig(providerId);
    }

    if (!providerConfig) {
      throw new Error(`Provider ${providerId} not found in database`);
    }

    // Get or create provider instance
    let providerInstance = context.providers.get(providerId);
    if (!providerInstance) {
      providerInstance = context.createProviderInstance(providerConfig);
      await providerInstance.initializeCachePolicies();
      context.providers.set(providerId, providerInstance);
      this.logger.info(`Created provider instance for ${providerId}`);
    }

    // Update configuration
    await providerInstance.updateConfiguration(providerConfig);

    return {
      providerId,
      actions: []
    };
  }

  /**
   * Handle provider categories changed
   * @param {string} providerId - Provider ID
   * @param {Object} [providerConfig] - Optional provider configuration
   * @returns {Promise<{providerId: string, actions: Array<{type: string, jobName?: string, data?: Object}>}>} Result object with actions to execute
   */
  async handleCategoriesChanged(providerId, providerConfig = null) {
    const context = ApplicationContext.getInstance();
    
    // Fetch provider config if not provided
    if (!providerConfig) {
      providerConfig = await this.mongoData.getProviderConfig(providerId);
    }

    if (!providerConfig) {
      throw new Error(`Provider ${providerId} not found in database`);
    }

    // Get or create provider instance
    let providerInstance = context.providers.get(providerId);
    if (!providerInstance) {
      providerInstance = context.createProviderInstance(providerConfig);
      await providerInstance.initializeCachePolicies();
      context.providers.set(providerId, providerInstance);
      this.logger.info(`Created provider instance for ${providerId}`);
    }

    // Update configuration
    await providerInstance.updateConfiguration(providerConfig);

    return {
      providerId,
      actions: [{
        type: 'triggerJob',
        jobName: 'syncIPTVProviderTitles',
        data: { providerId }
      }]
    };
  }

  /**
   * Handle provider updated (general update, no state change)
   * @param {string} providerId - Provider ID
   * @param {Object} [providerConfig] - Optional provider configuration
   * @returns {Promise<{providerId: string, actions: Array}>} Result object with actions to execute
   */
  async handleUpdated(providerId, providerConfig = null) {
    const context = ApplicationContext.getInstance();
    
    // Fetch provider config if not provided
    if (!providerConfig) {
      providerConfig = await this.mongoData.getProviderConfig(providerId);
    }

    if (!providerConfig) {
      throw new Error(`Provider ${providerId} not found in database`);
    }

    // Update configuration if instance exists
    const providerInstance = context.providers.get(providerId);
    if (providerInstance) {
      await providerInstance.updateConfiguration(providerConfig);
      this.logger.info(`Updated provider ${providerId} configuration in ApplicationContext`);
    } else {
      this.logger.debug(`Provider ${providerId} instance not in context, will be loaded on next sync`);
    }

    return {
      providerId,
      actions: []
    };
  }
}

