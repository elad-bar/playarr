import { createLogger } from '../utils/logger.js';

/**
 * Jobs manager for validating and checking job status
 * Handles job validation logic including running status checks and dependency blocking
 */
export class JobsManager {
  /**
   * @param {import('../services/MongoDataService.js').MongoDataService} mongoData - MongoDB data service for job history
   * @param {Object} jobsConfig - Jobs configuration from jobs.json
   * @param {import('bree').default} [bree] - Optional Bree instance for checking worker state
   */
  constructor(mongoData, jobsConfig, bree = null) {
    this.mongoData = mongoData;
    this.jobsConfig = jobsConfig;
    this.logger = createLogger('JobsManager');
    this._bree = bree;
    
    // Build job metadata lookup from config
    this._jobMetadata = {};
    this.jobsConfig.jobs.forEach(job => {
      this._jobMetadata[job.name] = {
        name: job.name,
        jobHistoryName: job.jobHistoryName,
        description: job.description,
        schedule: job.schedule,
        interval: job.interval,
        skipIfOtherInProgress: job.skipIfOtherInProgress || [],
        postExecute: job.postExecute || []
      };
    });
  }

  /**
   * Get job history name from config
   * @param {string} engineJobName - Engine job name
   * @returns {string} Job history name
   */
  getJobHistoryName(engineJobName) {
    const jobConfig = this._jobMetadata[engineJobName];
    return jobConfig?.jobHistoryName || engineJobName;
  }

  /**
   * Check if a job is currently running
   * Checks both Bree's worker state (most up-to-date) and MongoDB state
   * @param {string} engineJobName - Engine job name
   * @returns {Promise<boolean>} True if job is running
   */
  async isJobRunning(engineJobName) {
    // First check Bree's worker state (most up-to-date runtime state)
    if (this._bree && this._bree.workers && this._bree.workers.has(engineJobName)) {
      return true;
    }
    
    // Fallback to MongoDB state (persisted job history)
    if (!this.mongoData) {
      throw new Error('MongoDB data service is not available');
    }

    const historyJobName = this.getJobHistoryName(engineJobName);
    const jobHistory = await this.mongoData.getJobHistory(historyJobName);
    return jobHistory && jobHistory.status === 'running';
  }

  /**
   * Validate if a job can run
   * Checks if the job itself is running and if any blocking jobs are running
   * @param {string} engineJobName - Engine job name
   * @returns {Promise<{canRun: boolean, reason?: string, blockingJobs?: string[]}>} Validation result
   */
  async canRunJob(engineJobName) {
    // Check if job itself is running
    if (await this.isJobRunning(engineJobName)) {
      return {
        canRun: false,
        reason: `Job '${engineJobName}' is already running`,
        blockingJobs: [engineJobName]
      };
    }

    // Find job config to check skipIfOtherInProgress
    const jobConfig = this._jobMetadata[engineJobName];
    
    // Check if any blocking jobs are running
    if (jobConfig && jobConfig.skipIfOtherInProgress && jobConfig.skipIfOtherInProgress.length > 0) {
      const blockingJobs = [];
      for (const blockingJobName of jobConfig.skipIfOtherInProgress) {
        if (await this.isJobRunning(blockingJobName)) {
          blockingJobs.push(blockingJobName);
        }
      }

      if (blockingJobs.length > 0) {
        const blockingJobsList = blockingJobs.join(', ');
        return {
          canRun: false,
          reason: `Job '${engineJobName}' cannot run because the following job(s) are currently running: ${blockingJobsList}`,
          blockingJobs
        };
      }
    }

    return { canRun: true };
  }

  /**
   * Get job metadata
   * @param {string} engineJobName - Engine job name
   * @returns {Object|null} Job metadata or null if not found
   */
  getJobMetadata(engineJobName) {
    return this._jobMetadata[engineJobName] || null;
  }

  /**
   * Get all jobs metadata
   * @returns {Array} Array of job metadata objects
   */
  getAllJobsMetadata() {
    return Object.values(this._jobMetadata);
  }
}

