import path from 'path';
import { fileURLToPath } from 'url';
import { pathToFileURL } from 'url';
import { createLogger } from './utils/logger.js';
import jobsConfig from './jobs.json' with { type: 'json' };
import { JobsManager } from './managers/JobsManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Engine scheduler class for the Playarr Engine
 * Manages job scheduling using native setInterval (replaces Bree.js)
 */
export class EngineScheduler {
  /**
   * @param {import('./services/MongoDataService.js').MongoDataService} mongoData - MongoDB data service
   */
  constructor(mongoData) {
    this._mongoData = mongoData;
    this._jobsManager = null;
    this._intervalId = null;
    this._runningJobs = new Map();
    this._workersDir = path.join(__dirname, 'workers');
    this.logger = createLogger('EngineScheduler');
  }

  /**
   * Initialize and start the scheduler
   * @returns {Promise<void>}
   */
  async initialize() {
    this.logger.info('Initializing EngineScheduler...');

    // Reset all in-progress jobs in case engine was interrupted
    try {
      const resetCount = await this._mongoData.resetInProgressJobs();
      if (resetCount > 0) {
        this.logger.info(`Reset ${resetCount} in-progress job(s) from previous session`);
      }
    } catch (error) {
      this.logger.error(`Error resetting in-progress jobs: ${error.message}`);
      // Continue initialization even if reset fails
    }

    const scheduledJobs = jobsConfig.jobs.filter(job => job.interval);
    this._jobsManager = new JobsManager(this._mongoData, jobsConfig, null);

    // Run scheduled jobs on startup
    for (const job of scheduledJobs) {
      const timeout = this._parseTime(job.timeout || '0');
      if (timeout > 0) {
        await new Promise(resolve => setTimeout(resolve, timeout));
      }
      try {
        await this.runJob(job.name);
      } catch (error) {
        this.logger.error(`Error running job '${job.name}' on startup: ${error.message}`);
      }
    }

    // Set up hourly interval
    if (scheduledJobs.length > 0) {
      const intervalMs = this._parseTime(scheduledJobs[0].interval);
      this._intervalId = setInterval(async () => {
        for (const job of scheduledJobs) {
          try {
            await this.runJob(job.name);
          } catch (error) {
            this.logger.error(`Error running scheduled job '${job.name}': ${error.message}`);
          }
        }
      }, intervalMs);
      this.logger.info(`Scheduler started (interval: ${scheduledJobs[0].interval})`);
    }

    this.logger.info('EngineScheduler initialized');
  }

  /**
   * Stop the scheduler
   * @returns {Promise<void>}
   */
  async stop() {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
      this.logger.info('Job scheduler stopped');
    }
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
    const jobConfig = jobsConfig.jobs.find(j => j.name === name);
    if (!jobConfig) {
      throw new Error(`Job "${name}" not found`);
    }

    this.logger.info(`Starting job '${name}'${workerData?.providerId ? ` (providerId: ${workerData.providerId})` : ''}`);

    try {
      const workerPath = path.join(this._workersDir, `${name}.js`);
      const jobModule = await import(pathToFileURL(workerPath).href);
      const jobFn = jobModule.default || jobModule;

      if (typeof jobFn !== 'function') {
        throw new Error(`Worker file ${name}.js does not export a default function`);
      }

      const result = await jobFn(workerData || {});

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
