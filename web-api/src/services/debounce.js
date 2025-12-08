import { createLogger } from '../utils/logger.js';

const logger = createLogger('DebounceService');

/**
 * Debounce service for provider changes
 * Implements a 1-minute sliding window: any change resets the timer
 * On debounce trigger: automatically runs cleanup and provider details jobs
 */
class DebounceService {
  constructor(triggerJob) {
    this._triggerJob = triggerJob;
    this._lastChangeTimestamp = null;
    this._debounceTimer = null;
    this._debounceDelay = 60 * 1000; // 1 minute in milliseconds
  }

  /**
   * Record a provider change and reset the debounce timer
   * @param {string} [providerId] - Optional provider ID (for logging)
   */
  recordChange(providerId = null) {
    const now = Date.now();
    this._lastChangeTimestamp = now;

    // Clear existing timer
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }

    // Set new timer
    this._debounceTimer = setTimeout(() => {
      this._triggerDebouncedJobs(providerId);
    }, this._debounceDelay);

    logger.debug(`Provider change recorded${providerId ? ` for ${providerId}` : ''}. Debounce timer reset to ${this._debounceDelay}ms`);
  }

  /**
   * Trigger debounced jobs: cleanup and provider details
   * These jobs will trigger sync jobs (existing behavior)
   * @param {string} [providerId] - Optional provider ID (for logging)
   * @private
   */
  _triggerDebouncedJobs(providerId = null) {
    logger.info(`Debounce window expired${providerId ? ` for ${providerId}` : ''}. Triggering cleanup and provider details jobs...`);

    // Always trigger cleanup and provider details jobs
    // These jobs will trigger sync jobs (existing behavior)
    if (this._triggerJob) {
      // Trigger cleanup job (will trigger syncIPTVProviderTitles and syncLiveTV)
      this._triggerJob('cleanupUnwantedProviderTitles');
      
      // Trigger provider details sync
      this._triggerJob('syncProviderDetails');
    } else {
      logger.warn('Trigger job function not available, skipping debounced job triggers');
    }

    // Clear timer and timestamp
    this._debounceTimer = null;
    this._lastChangeTimestamp = null;
  }

  /**
   * Get the time remaining until debounce triggers (in milliseconds)
   * Returns 0 if no change is pending
   * @returns {number} Milliseconds until debounce triggers, or 0
   */
  getTimeRemaining() {
    if (!this._lastChangeTimestamp || !this._debounceTimer) {
      return 0;
    }

    const elapsed = Date.now() - this._lastChangeTimestamp;
    const remaining = this._debounceDelay - elapsed;
    return Math.max(0, remaining);
  }

  /**
   * Check if a debounce is currently pending
   * @returns {boolean} True if debounce is pending
   */
  isPending() {
    return this._debounceTimer !== null;
  }

  /**
   * Cancel any pending debounce
   */
  cancel() {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
      this._lastChangeTimestamp = null;
      logger.debug('Debounce cancelled');
    }
  }
}

export default DebounceService;

