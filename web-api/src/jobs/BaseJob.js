import { createLogger } from '../utils/logger.js';

/**
 * Base class for all jobs
 * Provides common functionality: job history, cancellation checks, and logger
 * @abstract
 */
export class BaseJob {
  /**
   * @param {string} jobName - Name identifier for this job (used in logging)
   * @param {import('../managers/domain/JobHistoryManager.js').JobHistoryManager} jobHistoryManager - Job history manager
   */
  constructor(jobName, jobHistoryManager) {
    if (this.constructor === BaseJob) {
      throw new Error('BaseJob is an abstract class and cannot be instantiated directly');
    }

    this.jobName = jobName;
    this.jobHistoryManager = jobHistoryManager;
    this.logger = createLogger(jobName);
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

