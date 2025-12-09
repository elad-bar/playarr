import { BaseManager } from '../BaseManager.js';
import { formatNumber } from '../../utils/numberFormat.js';

/**
 * Job Save Coordinator Manager (Type D: Orchestration Manager)
 * Coordinates periodic saves across all providers during job execution
 * Runs a single 30-second interval per job to save all collections
 * Triggers updateMetrics job after each save operation
 */
export class JobSaveCoordinatorManager extends BaseManager {
  /**
   * @param {import('../domain/ProviderTitlesManager.js').ProviderTitlesManager} providerTitlesManager - Provider titles manager
   * @param {import('../domain/TitlesManager.js').TitlesManager} titlesManager - Titles manager
   * @param {Function<string>} triggerJob - Function to trigger jobs by name
   */
  constructor(providerTitlesManager, titlesManager, triggerJob) {
    super('JobSaveCoordinatorManager');
    
    this.providerTitlesManager = providerTitlesManager;
    this.titlesManager = titlesManager;
    this._triggerJob = triggerJob;
    
    // Accumulators: providerId -> data
    this._providerTitles = new Map(); // Map<providerId, Array<titles>>
    this._ignoredTitles = new Map();  // Map<providerId, Object<titleKey, reason>>
    this._mainTitles = [];            // Array<mainTitles> (all providers combined)
    this._existingMainTitleMap = null; // Store reference for main titles
    
    // Single 30-second interval per job execution
    this._interval = null;
  }
  
  /**
   * Start the 30-second save interval
   */
  start() {
    if (this._interval) {
      this.logger.warn('Save interval already started');
      return;
    }
    
    this._interval = setInterval(() => {
      this._saveAll().catch(error => {
        this.logger.error(`Error in periodic save: ${error.message}`);
      });
    }, 30000); // 30 seconds
    
    this.logger.debug('Save interval started (30 seconds)');
  }
  
  /**
   * Stop the save interval
   */
  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
      this.logger.debug('Save interval stopped');
    }
  }
  
  /**
   * Accumulate provider titles for a specific provider
   * @param {string} providerId - Provider ID
   * @param {Array<Object>} titles - Array of title objects to accumulate
   */
  accumulateProviderTitles(providerId, titles) {
    if (!titles || titles.length === 0) {
      return;
    }
    
    if (!this._providerTitles.has(providerId)) {
      this._providerTitles.set(providerId, []);
    }
    
    this._providerTitles.get(providerId).push(...titles);
  }
  
  /**
   * Accumulate ignored titles for a specific provider
   * @param {string} providerId - Provider ID
   * @param {Object<string, string>} ignoredByTitleKey - Object mapping title_key to reason
   */
  accumulateIgnoredTitles(providerId, ignoredByTitleKey) {
    if (!ignoredByTitleKey || typeof ignoredByTitleKey !== 'object' || Object.keys(ignoredByTitleKey).length === 0) {
      return;
    }
    
    if (!this._ignoredTitles.has(providerId)) {
      this._ignoredTitles.set(providerId, {});
    }
    
    // Merge with existing ignored titles for this provider
    Object.assign(this._ignoredTitles.get(providerId), ignoredByTitleKey);
  }
  
  /**
   * Accumulate main titles (all providers combined)
   * @param {Array<Object>} titles - Array of main title objects
   * @param {Map<string, Object>} [existingMainTitleMap] - Optional map of existing titles (for reference)
   */
  accumulateMainTitles(titles, existingMainTitleMap = null) {
    if (!titles || titles.length === 0) {
      return;
    }
    
    this._mainTitles.push(...titles);
    
    // Store existingMainTitleMap reference if provided (used for preserving createdAt)
    if (existingMainTitleMap && !this._existingMainTitleMap) {
      this._existingMainTitleMap = existingMainTitleMap;
    }
  }
  
  /**
   * Save all accumulated data to collections
   * Called every 30 seconds and on final save
   * @private
   * @returns {Promise<void>}
   */
  async _saveAll() {
    let hasSaves = false;
    
    // Save provider_titles collection (all providers combined)
    for (const [providerId, titles] of this._providerTitles.entries()) {
      if (titles.length > 0) {
        try {
          await this.providerTitlesManager.saveProviderTitles(providerId, titles);
          this.logger.debug(`Saved ${formatNumber(titles.length)} provider titles for provider ${providerId}`);
          this._providerTitles.set(providerId, []); // Clear after saving
          hasSaves = true;
        } catch (error) {
          this.logger.error(`Error saving provider titles for ${providerId}: ${error.message}`);
        }
      }
    }
    
    // Save ignored_titles (all providers combined)
    for (const [providerId, ignored] of this._ignoredTitles.entries()) {
      if (Object.keys(ignored).length > 0) {
        try {
          await this._saveIgnoredTitles(providerId, ignored);
          const count = Object.keys(ignored).length;
          this.logger.debug(`Saved ${formatNumber(count)} ignored titles for provider ${providerId}`);
          this._ignoredTitles.set(providerId, {}); // Clear after saving
          hasSaves = true;
        } catch (error) {
          this.logger.error(`Error saving ignored titles for ${providerId}: ${error.message}`);
        }
      }
    }
    
    // Save main_titles collection (all providers combined)
    if (this._mainTitles.length > 0) {
      try {
        await this.titlesManager.saveMainTitles(this._mainTitles);
        this.logger.debug(`Saved ${formatNumber(this._mainTitles.length)} main titles`);
        this._mainTitles = []; // Clear after saving
        hasSaves = true;
      } catch (error) {
        this.logger.error(`Error saving main titles: ${error.message}`);
      }
    }
    
    // Trigger updateMetrics job if any saves occurred
    if (hasSaves) {
      this._triggerUpdateMetrics();
    }
  }
  
  /**
   * Save ignored titles for a specific provider
   * Updates provider_titles collection to set ignored: true
   * @private
   * @param {string} providerId - Provider ID
   * @param {Object<string, string>} ignoredByTitleKey - Object mapping title_key to reason
   * @returns {Promise<void>}
   */
  async _saveIgnoredTitles(providerId, ignoredByTitleKey) {
    if (!ignoredByTitleKey || typeof ignoredByTitleKey !== 'object' || Object.keys(ignoredByTitleKey).length === 0) {
      return;
    }
    
    const now = new Date();
    
    // Group titles by reason for bulk updates
    const titlesByReason = {};
    for (const [titleKey, reason] of Object.entries(ignoredByTitleKey)) {
      if (!titlesByReason[reason]) {
        titlesByReason[reason] = [];
      }
      titlesByReason[reason].push(titleKey);
    }
    
    // Build bulk operations: one updateMany per reason group
    const operations = [];
    for (const [reason, titleKeys] of Object.entries(titlesByReason)) {
      if (!Array.isArray(titleKeys) || titleKeys.length === 0) {
        continue;
      }
      
      // Process in batches if a single reason has too many titles (MongoDB $in limit)
      const batchSize = 1000; // MongoDB $in operator limit is much higher, but 1000 is safe
      for (let i = 0; i < titleKeys.length; i += batchSize) {
        const titleKeysBatch = titleKeys.slice(i, i + batchSize);
        operations.push({
          updateMany: {
            filter: {
              provider_id: providerId,
              title_key: { $in: titleKeysBatch }
            },
            update: {
              $set: {
                ignored: true,
                ignored_reason: reason,
                lastUpdated: now
              }
            }
          }
        });
      }
    }
    
    if (operations.length === 0) {
      return;
    }
    
    // Execute bulk operations using ProviderTitlesManager's bulkWrite method
    // Process operations in batches of 1000 (MongoDB bulkWrite limit)
    for (let i = 0; i < operations.length; i += 1000) {
      const batch = operations.slice(i, i + 1000);
      if (Array.isArray(batch) && batch.length > 0) {
        await this.providerTitlesManager.bulkWrite(batch, { ordered: false });
      }
    }
  }
  
  /**
   * Final save of all remaining accumulated data
   * Called at the end of job execution
   * @returns {Promise<void>}
   */
  async finalSave() {
    // Stop interval first to prevent concurrent saves
    this.stop();
    
    // One final save of all remaining data
    await this._saveAll();
  }
  
  /**
   * Trigger updateMetrics job asynchronously (fire and forget)
   * @private
   */
  _triggerUpdateMetrics() {
    if (!this._triggerJob) {
      this.logger.warn('Trigger job function not available, skipping metrics update');
      return;
    }
    
    // Fire job asynchronously without blocking
    setImmediate(async () => {
      try {
        await this._triggerJob('updateMetrics');
        this.logger.debug('Triggered updateMetrics job after save');
      } catch (error) {
        this.logger.error(`Failed to trigger updateMetrics job: ${error.message}`);
        // Don't throw - allow save operation to continue even if metrics trigger fails
      }
    });
  }
}

