import { createLogger } from './utils/logger.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { JobsManager } from './managers/orchestration/JobsManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const jobsConfig = JSON.parse(readFileSync(join(__dirname, 'jobs.json'), 'utf-8'));

/**
 * Engine scheduler class for the Playarr Web-API
 * Manages job scheduling using native setInterval timers
 */
export class EngineScheduler {
  /**
   * @param {Map<string, import('./jobs/BaseJob.js').BaseJob>} jobInstances - Map of jobName -> job instance
   * @param {import('./managers/domain/JobHistoryManager.js').JobHistoryManager} jobHistoryManager - Job history manager (for resetInProgress)
   */
  constructor(jobInstances, jobHistoryManager) {
    this._jobInstances = jobInstances; // Map<jobName, BaseJob>
    this._jobHistoryManager = jobHistoryManager;
    this._jobsManager = null;
    this._intervalIds = new Map(); // Map of jobName -> intervalId
    this._runningJobs = new Map();
    this._scheduledJobs = []; // Store scheduled jobs for later starting
    this.logger = createLogger('EngineScheduler');
  }

  /**
   * Initialize the scheduler (setup only, does not start jobs)
   * @returns {Promise<void>}
   */
  async initialize() {
    this.logger.info('Initializing EngineScheduler...');

    // Reset all in-progress jobs in case server was interrupted
    try {
      const resetCount = await this._jobHistoryManager.resetInProgress();
      if (resetCount > 0) {
        this.logger.info(`Reset ${resetCount} in-progress job(s) from previous session`);
      }
    } catch (error) {
      this.logger.error(`Error resetting in-progress jobs: ${error.message}`);
      // Continue initialization even if reset fails
    }

    const scheduledJobs = jobsConfig.jobs.filter(job => job.interval);
    // JobsManager will be initialized later with scheduler reference in index.js
    this._jobsManager = new JobsManager(jobsConfig, this._jobHistoryManager, null);

    // Store scheduled jobs configuration for later starting
    this._scheduledJobs = scheduledJobs.map(job => ({
      name: job.name,
      interval: job.interval,
      delay: job.delay || '0',
      intervalMs: this._parseTime(job.interval),
      delayMs: this._parseTime(job.delay || '0')
    }));

    if (scheduledJobs.length > 0) {
      this.logger.info(`Scheduler initialized with ${scheduledJobs.length} job(s) (not started yet)`);
    }

    this.logger.info('EngineScheduler initialized');
  }

  /**
   * Start the scheduler and begin executing jobs
   * @returns {Promise<void>}
   */
  async start() {
    if (this._scheduledJobs.length === 0) {
      this.logger.info('No scheduled jobs to start');
      return;
    }

    this.logger.info('Starting job scheduler...');

    // Set up individual intervals for each scheduled job
    this._scheduledJobs.forEach(job => {
      // Function to run the job
      const runJobAsync = async () => {
        try {
          await this.runJob(job.name);
        } catch (error) {
          this.logger.error(`Error running scheduled job '${job.name}': ${error.message}`);
        }
      };
      
      // Set up interval for recurring execution
      const intervalId = setInterval(runJobAsync, job.intervalMs);
      this._intervalIds.set(job.name, intervalId);
      this.logger.debug(`Scheduled job '${job.name}' to run every ${job.interval}`);
      
      // Run job on startup (with optional delay)
      // This ensures jobs run right away instead of waiting for the first interval
      (async () => {
        if (job.delayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, job.delayMs));
        }
        try {
          this.logger.info(`Running job '${job.name}' on startup${job.delayMs > 0 ? ` (after ${job.delay} delay)` : ''}`);
          await runJobAsync();
        } catch (error) {
          this.logger.error(`Error running job '${job.name}' on startup: ${error.message}`);
        }
      })();
    });

    this.logger.info(`Scheduler started with ${this._scheduledJobs.length} job(s) at their configured intervals`);
  }

  /**
   * Stop the scheduler
   * @returns {Promise<void>}
   */
  async stop() {
    // Clear all individual job intervals
    if (this._intervalIds && this._intervalIds.size > 0) {
      this._intervalIds.forEach((intervalId, jobName) => {
        clearInterval(intervalId);
        this.logger.debug(`Stopped interval for job '${jobName}'`);
      });
      this._intervalIds.clear();
    }
    this.logger.info('Job scheduler stopped');
  }

  /**
   * Run a job by name
   * @param {string} name - Job name
   * @param {Object} [workerData] - Optional worker data
   * @returns {Promise<any>} Job execution result
   */
  async runJob(name, workerData) {
    if (this._runningJobs.has(name)) {
      const error = new Error(`Job '${name}' is already running`);
      error.code = 'JOB_ALREADY_RUNNING';
      error.isAlreadyRunning = true;
      throw error;
    }

    const validation = await this._jobsManager.canRunJob(name);
    if (!validation.canRun) {
      const error = new Error(validation.reason);
      error.code = 'JOB_CANNOT_RUN';
      error.blockingJobs = validation.blockingJobs;
      throw error;
    }

    const promise = this._executeJob(name, workerData);
    this._runningJobs.set(name, promise);

    try {
      return await promise;
    } finally {
      this._runningJobs.delete(name);
    }
  }

  /**
   * Execute a job internally
   * @private
   */
  async _executeJob(name, workerData) {
    const job = this._jobInstances.get(name);
    if (!job) {
      throw new Error(`Job "${name}" not found`);
    }

    this.logger.info(`Starting job '${name}'${workerData?.providerId ? ` (providerId: ${workerData.providerId})` : ''}`);

    try {
      // Execute the job directly (handlers are created fresh in execute() method)
      const result = await job.execute();

      if (result !== undefined) {
        this.logger.info(`Job '${name}' completed successfully`);
        await this._handlePostExecute(name, workerData);
      }

      return result;
    } catch (error) {
      this.logger.error(`Error executing job '${name}': ${error.message}`);
      throw error;
    }
  }

  /**
   * Handle post-execution job chains
   * @private
   */
  async _handlePostExecute(jobName, workerData) {
    const jobConfig = this._jobsManager.getJobMetadata(jobName);
    if (jobConfig?.postExecute?.length > 0) {
      for (const postJobName of jobConfig.postExecute) {
        try {
          this.logger.info(`Triggering post-execute job '${postJobName}'`);
          await this.runJob(postJobName, workerData);
        } catch (error) {
          this.logger.error(`Failed to trigger post-execute job '${postJobName}': ${error.message}`);
        }
      }
    }
  }

  /**
   * Get the JobsManager instance
   * @returns {import('./managers/JobsManager.js').JobsManager|null}
   */
  getJobsManager() {
    return this._jobsManager;
  }

  /**
   * Parse time string to milliseconds
   * @private
   */
  _parseTime(timeStr) {
    if (typeof timeStr === 'number') return timeStr;
    const match = String(timeStr).match(/^(\d+)([smhd])?$/i);
    if (!match) return parseInt(timeStr, 10) || 0;
    const value = parseInt(match[1], 10);
    const unit = (match[2] || 'ms').toLowerCase();
    const multipliers = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
    return value * (multipliers[unit] || 1);
  }
}
