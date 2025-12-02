import { BaseManager } from '../BaseManager.js';
import { JobNotFoundError, JobAlreadyRunningError, JobSchedulerUnavailableError, AppError } from '../../errors/AppError.js';

/**
 * Jobs manager for managing jobs
 * Type D: Orchestration Manager
 * Handles job listing, triggering, and validation logic
 */
export class JobsManager extends BaseManager {
  /**
   * @param {Object} jobsConfig - Jobs configuration from jobs.json
   * @param {import('../domain/JobHistoryManager.js').JobHistoryManager} jobHistoryManager - Job history manager
   * @param {import('../engineScheduler.js').EngineScheduler} scheduler - Scheduler instance for triggering jobs
   */
  constructor(jobsConfig, jobHistoryManager, scheduler) {
    super('JobsManager');
    this.jobsConfig = jobsConfig;
    this._jobHistoryManager = jobHistoryManager;
    this._scheduler = scheduler;
    
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
   * Checks MongoDB state (persisted job history)
   * @param {string} engineJobName - Engine job name
   * @returns {Promise<boolean>} True if job is running
   */
  async isJobRunning(engineJobName) {
    if (!this._jobHistoryManager) {
      this.logger.warn('No jobHistoryManager available for checking job status');
      return false;
    }
    
    const historyJobName = this.getJobHistoryName(engineJobName);
    return await this._jobHistoryManager.isJobRunning(historyJobName);
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

  /**
   * Format job data for UI
   * @param {Object} engineJob - Job metadata from engine
   * @param {Object|null} jobHistory - Job history from MongoDB
   * @returns {Object} Formatted job data
   */
  _formatJobData(engineJob, jobHistory) {
    return {
      name: engineJob.name,
      description: engineJob.description,
      schedule: engineJob.schedule,
      interval: engineJob.interval,
      status: jobHistory?.status || 'unknown',
      lastExecution: jobHistory?.last_execution || null,
      executionCount: jobHistory?.execution_count || 0,
      lastResult: jobHistory?.last_result || null,
      lastError: jobHistory?.last_error || null,
      createdAt: jobHistory?.createdAt || null,
      lastUpdated: jobHistory?.lastUpdated || null
    };
  }

  /**
   * Get all jobs with their details and status
   * Reads from jobs.json and MongoDB job history
   * @returns {Promise<{jobs: Array}>} Jobs object
   * @throws {AppError} If an error occurs
   */
  async getAllJobs() {
    try {
      // Get job list from jobs.json
      const jobs = this.jobsConfig.jobs || [];

      // Get job history for each job from MongoDB
      // Use job.name because that's what's stored in the database (BaseJob uses this.jobName)
      const jobsWithHistory = await Promise.all(
        jobs.map(async (job) => {
          let jobHistory = null;
          if (this._jobHistoryManager) {
            try {
              jobHistory = await this._jobHistoryManager.getJobHistory(job.name);
            } catch (error) {
              this.logger.warn(`Error getting job history for ${job.name}: ${error.message}`);
            }
          }
          return this._formatJobData(job, jobHistory);
        })
      );

      return { jobs: jobsWithHistory };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      this.logger.error('Error getting all jobs:', error);
      throw new AppError('Failed to get jobs', 500);
    }
  }

  /**
   * Trigger a job via scheduler
   * @param {string} jobName - Job name (e.g., "syncIPTVProviderTitles")
   * @param {Object} [options] - Optional parameters
   * @param {string} [options.providerId] - Provider ID to process all titles for
   * @returns {Promise<{success: boolean, message: string, jobName: string, providerId?: string}>} Success object
   * @throws {JobSchedulerUnavailableError} If scheduler is not available
   * @throws {JobAlreadyRunningError} If job is already running
   * @throws {JobNotFoundError} If job not found
   * @throws {AppError} If an error occurs
   */
  async triggerJob(jobName, options = {}) {
    try {
      if (!this._scheduler) {
        throw new JobSchedulerUnavailableError('Job scheduler is not available');
      }

      const { providerId } = options;
      const workerData = providerId ? { providerId } : {};

      try {
        await this._scheduler.runJob(jobName, workerData);
        
        return {
          success: true,
          message: `Job '${jobName}' triggered successfully`,
          jobName: jobName,
          ...(providerId ? { providerId } : {})
        };
      } catch (error) {
        // Handle specific error cases
        if (error.code === 'JOB_ALREADY_RUNNING' || error.isAlreadyRunning) {
          throw new JobAlreadyRunningError(error.message || `Job '${jobName}' is already running`);
        } else if (error.code === 'JOB_CANNOT_RUN') {
          throw new JobAlreadyRunningError(error.message || `Job '${jobName}' cannot run`);
        } else if (error.message && error.message.includes('not found')) {
          throw new JobNotFoundError(error.message || `Job '${jobName}' not found`);
        }
        
        // Other errors
        this.logger.error(`Error triggering job ${jobName}:`, error.message);
        throw new AppError(`Failed to trigger job: ${error.message}`, 500);
      }
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      this.logger.error(`Error triggering job ${jobName}:`, error);
      throw new AppError('Failed to trigger job', 500);
    }
  }
}

