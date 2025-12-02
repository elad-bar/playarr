import { BaseDomainManager } from './BaseDomainManager.js';

/**
 * Job History Manager (Domain Manager)
 * Manages job_history domain operations
 * One domain = one repository (JobHistoryRepository)
 */
class JobHistoryManager extends BaseDomainManager {
  /**
   * @param {import('../../repositories/JobHistoryRepository.js').JobHistoryRepository} jobHistoryRepo - Job history repository
   */
  constructor(jobHistoryRepo) {
    super('JobHistoryManager', jobHistoryRepo);
  }

  /**
   * Get last execution time from job history
   * @param {string} jobName - Job name
   * @param {Object} [options={}] - Options for getting last execution
   * @param {Date|null} [options.fallbackDate] - Fallback date if no execution found (null means no fallback)
   * @param {string} [options.logMessage] - Log message template with {date} placeholder
   * @param {string} [options.noExecutionMessage] - Message to log when no execution found
   * @returns {Promise<Date|null>} Last execution date or fallback date or null
   */
  async getLastExecution(jobName, options = {}) {
    const { fallbackDate = null, logMessage, noExecutionMessage } = options;
    
    try {
      const jobHistory = await this._repository.findOneByQuery({ job_name: jobName });
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
      this.logger.error(`Error getting last execution for ${jobName}:`, error);
      return fallbackDate;
    }
  }

  /**
   * Update job status with optional result
   * @param {string} jobName - Job name
   * @param {string} status - Job status: "running" | "cancelled" | "completed" | "failed"
   * @param {string} [providerId=null] - Optional provider ID
   * @param {Object|null} [result=null] - Optional execution result
   * @returns {Promise<void>}
   */
  async updateStatus(jobName, status, providerId = null, result = null) {
    const now = new Date();
    
    const filter = {
      job_name: jobName,
      ...(providerId && { provider_id: providerId })
    };
    
    // Start with base update object for status only
    const update = {
      $set: {
        status: status,
        lastUpdated: now
      },
      $setOnInsert: {
        createdAt: now
      }
    };
    
    // Modify update object if result is provided
    if (result !== null) {
      const { last_provider_check, last_settings_check, last_policy_check, ...resultData } = result;
      
      update.$set.last_result = resultData;
      update.$inc = { execution_count: 1 };
      
      if (last_provider_check !== undefined) {
        update.$set.last_provider_check = last_provider_check;
      }
      if (last_settings_check !== undefined) {
        update.$set.last_settings_check = last_settings_check;
      }
      if (last_policy_check !== undefined) {
        update.$set.last_policy_check = last_policy_check;
      }
      
      if (!result.error) {
        update.$set.last_execution = now;
      }
    } else {
      // Only set execution_count to 0 on insert when result is null
      update.$setOnInsert.execution_count = 0;
    }
    
    await this._repository.updateOne(filter, update, { upsert: true });
  }

  /**
   * Get job history document
   * @param {string} jobName - Job name
   * @returns {Promise<Object|null>} Job history document or null if not found
   */
  async getJobHistory(jobName) {
    try {
      return await this._repository.findOneByQuery({ job_name: jobName });
    } catch (error) {
      this.logger.error(`Error getting job history for ${jobName}:`, error);
      return null;
    }
  }

  /**
   * Reset all in-progress jobs to cancelled status
   * Called on startup to handle jobs that were interrupted by a crash/restart
   * @returns {Promise<number>} Number of jobs reset
   */
  async resetInProgress() {
    const now = new Date();
    
    const result = await this._repository.updateManyByQuery(
      { status: 'running' },
      {
        $set: {
          status: 'cancelled',
          lastUpdated: now
        }
      }
    );
    
    return result.modifiedCount || 0;
  }

  /**
   * Check if a job is currently running
   * @param {string} jobName - Job name
   * @returns {Promise<boolean>} True if job is running
   */
  async isJobRunning(jobName) {
    try {
      const jobHistory = await this._repository.findOneByQuery({ job_name: jobName });
      return jobHistory && jobHistory.status === 'running';
    } catch (error) {
      this.logger.error(`Error checking if job ${jobName} is running:`, error);
      return false;
    }
  }
}

export { JobHistoryManager };

