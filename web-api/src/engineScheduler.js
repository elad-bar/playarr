import { createLogger } from './utils/logger.js';
import { formatNumber } from './utils/numberFormat.js';
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
   * @param {import('./managers/orchestration/MetricsManager.js').default} metricsManager - Metrics manager instance
   */
  constructor(jobInstances, jobHistoryManager, metricsManager) {
    this._jobInstances = jobInstances; // Map<jobName, BaseJob>
    this._jobHistoryManager = jobHistoryManager;
    this._metricsManager = metricsManager;
    this._jobsManager = null;
    this._intervalIds = new Map(); // Map of jobName -> intervalId
    this._runningJobs = new Map();
    this._abortControllers = new Map(); // Map<jobName, AbortController>
    this._scheduledJobs = []; // Store scheduled jobs for later starting
    this._startupJobs = []; // Store jobs that should run on startup
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

    // JobsManager will be initialized later with scheduler reference in index.js
    this._jobsManager = new JobsManager(jobsConfig, this._jobHistoryManager, null);

    // Store jobs with intervals for recurring execution (delay removed, only applies to startup)
    const jobsWithInterval = jobsConfig.jobs.filter(job => job.interval);
    this._scheduledJobs = jobsWithInterval.map(job => ({
      name: job.name,
      interval: job.interval,
      intervalMs: this._parseTime(job.interval)
    }));

    // Store jobs that should run on startup (separate from interval jobs, include delay)
    const jobsOnStartup = jobsConfig.jobs.filter(job => job.runOnStartup === true);
    this._startupJobs = jobsOnStartup.map(job => ({
      name: job.name,
      delay: job.delay || '0',
      delayMs: this._parseTime(job.delay || '0')
    }));

    if (this._scheduledJobs.length > 0) {
      this.logger.info(`Scheduler initialized with ${formatNumber(this._scheduledJobs.length)} recurring job(s) (not started yet)`);
    }
    if (this._startupJobs.length > 0) {
      this.logger.info(`Scheduler initialized with ${formatNumber(this._startupJobs.length)} startup job(s) (not started yet)`);
    }

    this.logger.info('EngineScheduler initialized');
  }

  /**
   * Start the scheduler and begin executing jobs
   * @returns {Promise<void>}
   */
  async start() {
    this.logger.info('Starting job scheduler...');

    // Set up recurring intervals for jobs with interval (but don't run them yet if they also have runOnStartup)
    if (this._scheduledJobs.length > 0) {
      this._scheduledJobs.forEach(job => {
        // Function to run the job
        const runJobAsync = async () => {
          try {
            await this.runJob(job.name);
          } catch (error) {
            if (error.code === 'JOB_ALREADY_RUNNING' || error.isAlreadyRunning) {
              this.logger.info(`Skipping scheduled job '${job.name}': ${error.message}`);
            } else {
              this.logger.error(`Error running scheduled job '${job.name}': ${error.message}`);
            }
          }
        };
        
        // Check if this job also runs on startup
        const hasStartup = this._startupJobs.some(sj => sj.name === job.name);
        
        if (!hasStartup) {
          // Job has interval but NO runOnStartup: Start interval timer immediately
          const intervalId = setInterval(runJobAsync, job.intervalMs);
          this._intervalIds.set(job.name, intervalId);
          this.logger.debug(`Scheduled job '${job.name}' to run every ${job.interval} (starting immediately)`);
        } else {
          // Job has BOTH interval AND runOnStartup: Store interval config temporarily
          // Interval will be started after startup execution completes
          this._intervalIds.set(job.name, { runJobAsync, intervalMs: job.intervalMs, name: job.name });
          this.logger.debug(`Scheduled job '${job.name}' to run every ${job.interval} (will start after startup execution)`);
        }
      });

      this.logger.info(`Scheduled ${formatNumber(this._scheduledJobs.length)} recurring job(s)`);
    }

    // Run jobs that should execute on startup (with optional delay)
    if (this._startupJobs.length > 0) {
      this._startupJobs.forEach(job => {
        (async () => {
          // Apply delay if specified
          if (job.delayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, job.delayMs));
          }
          
          try {
            this.logger.info(`Running job '${job.name}' on startup${job.delayMs > 0 ? ` (after ${job.delay} delay)` : ''}`);
            await this.runJob(job.name);
            
            // If this job has an interval, start the interval timer NOW (after completion)
            const intervalConfig = this._intervalIds.get(job.name);
            if (intervalConfig && intervalConfig.runJobAsync) {
              const intervalId = setInterval(intervalConfig.runJobAsync, intervalConfig.intervalMs);
              this._intervalIds.set(job.name, intervalId);
              this.logger.debug(`Started interval for job '${job.name}' after startup execution completed`);
            }
          } catch (error) {
            if (error.code === 'JOB_ALREADY_RUNNING' || error.isAlreadyRunning) {
              this.logger.info(`Skipping job '${job.name}' on startup: ${error.message}`);
            } else {
              this.logger.error(`Error running job '${job.name}' on startup: ${error.message}`);
            }
            
            // Even if startup fails, start interval if configured
            const intervalConfig = this._intervalIds.get(job.name);
            if (intervalConfig && intervalConfig.runJobAsync) {
              const intervalId = setInterval(intervalConfig.runJobAsync, intervalConfig.intervalMs);
              this._intervalIds.set(job.name, intervalId);
              this.logger.debug(`Started interval for job '${job.name}' after startup execution (even though it failed)`);
            }
          }
        })();
      });

      this.logger.info(`Started ${formatNumber(this._startupJobs.length)} job(s) on startup`);
    }

    if (this._scheduledJobs.length === 0 && this._startupJobs.length === 0) {
      this.logger.info('No scheduled or startup jobs to start');
    }
  }

  /**
   * Stop the scheduler
   * @returns {Promise<void>}
   */
  async stop() {
    // Clear all individual job intervals
    if (this._intervalIds && this._intervalIds.size > 0) {
      this._intervalIds.forEach((intervalValue, jobName) => {
        // Only clear if it's an actual interval ID (number), not a config object
        if (typeof intervalValue === 'number') {
          clearInterval(intervalValue);
          this.logger.debug(`Stopped interval for job '${jobName}'`);
        }
      });
      this._intervalIds.clear();
    }
    this.logger.info('Job scheduler stopped');
  }

  /**
   * Abort a running job
   * @param {string} name - Job name
   * @returns {Promise<{success: boolean, message: string}>} Abort result
   */
  async abortJob(name) {
    if (!this._runningJobs.has(name)) {
      const error = new Error(`Job '${name}' is not running`);
      error.code = 'JOB_NOT_RUNNING';
      throw error;
    }

    const abortController = this._abortControllers.get(name);
    if (abortController) {
      abortController.abort();
      this.logger.info(`Abort signal sent to job '${name}'`);
      
      // Update job status to cancelled
      try {
        await this._jobHistoryManager.updateStatus(name, 'cancelled', null, {
          cancelled: true,
          cancelledAt: new Date()
        });
      } catch (error) {
        this.logger.error(`Error updating job status for ${name}:`, error.message);
      }
      
      return {
        success: true,
        message: `Job '${name}' abort signal sent`
      };
    }

    throw new Error(`No abort controller found for job '${name}'`);
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

    // Create AbortController for this job execution
    const abortController = new AbortController();
    this._abortControllers.set(name, abortController);

    const promise = this._executeJob(name, workerData, abortController.signal);
    this._runningJobs.set(name, promise);

    try {
      return await promise;
    } catch (error) {
      // Check if error is due to abortion
      if (error.name === 'AbortError' || abortController.signal.aborted) {
        this.logger.info(`Job '${name}' was aborted`);
        // Status already updated in abortJob method
        throw error;
      }
      throw error;
    } finally {
      this._runningJobs.delete(name);
      this._abortControllers.delete(name);
    }
  }

  /**
   * Execute a job internally
   * @private
   * @param {string} name - Job name
   * @param {Object} [workerData] - Optional worker data
   * @param {AbortSignal} [abortSignal] - AbortSignal for cancellation
   */
  async _executeJob(name, workerData, abortSignal) {
    const job = this._jobInstances.get(name);
    if (!job) {
      throw new Error(`Job "${name}" not found`);
    }

    this.logger.debug(`Starting job '${name}'${workerData?.providerId ? ` (providerId: ${workerData.providerId})` : ''}`);

    const startTime = Date.now();
    try {
      // Execute the job directly (handlers are created fresh in execute() method)
      // Pass abortSignal to job execution
      const result = await job.execute(abortSignal);

      if (result !== undefined && !abortSignal?.aborted) {
        // Track metrics - success
        const duration = (Date.now() - startTime) / 1000;
        this._metricsManager.incrementCounter('job_executions', { job_type: name, status: 'success' });
        this._metricsManager.observeHistogram('job_duration', { job_type: name }, duration);
        
        this.logger.info(`Job '${name}' completed successfully`);
        await this._handlePostExecute(name, workerData);
      }

      return result;
    } catch (error) {
      // Track metrics - failure or cancellation
      const duration = (Date.now() - startTime) / 1000;
      const status = abortSignal?.aborted ? 'cancelled' : 'failure';
      this._metricsManager.incrementCounter('job_executions', { job_type: name, status });
      this._metricsManager.observeHistogram('job_duration', { job_type: name }, duration);
      
      if (abortSignal?.aborted) {
        this.logger.info(`Job '${name}' was cancelled`);
      } else {
        this.logger.error(`Error executing job '${name}': ${error.message}`);
      }
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
          if (error.code === 'JOB_ALREADY_RUNNING' || error.isAlreadyRunning) {
            this.logger.info(`Skipping post-execute job '${postJobName}': ${error.message}`);
          } else {
            this.logger.error(`Failed to trigger post-execute job '${postJobName}': ${error.message}`);
          }
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
