import dotenv from 'dotenv';
import Bree from 'bree';
import path from 'path';
import fs from 'fs';
import fsExtra from 'fs-extra';
import { fileURLToPath } from 'url';
import { createLogger } from './utils/logger.js';
import { EngineServer } from './server.js';
import MongoClientUtil from './utils/mongo-client.js';
import { MongoDataService } from './services/MongoDataService.js';
import { JobsManager } from './managers/JobsManager.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, '../cache');

// Rotate log file on startup using the log file's creation date
const logsDir = process.env.LOGS_DIR || path.join(__dirname, '../logs');
const engineLogPath = path.join(logsDir, 'engine.log');
if (fsExtra.existsSync(engineLogPath)) {
  const stats = fsExtra.statSync(engineLogPath);
  const creationDate = stats.birthtime || stats.mtime; // Use birthtime if available, fallback to mtime
  const timestamp = creationDate.toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const rotatedLogPath = path.join(logsDir, `engine-${timestamp}.log`);
  fsExtra.moveSync(engineLogPath, rotatedLogPath);
}

const logger = createLogger('Main');

// Load jobs configuration
const jobsConfigPath = path.join(__dirname, 'jobs.json');
const jobsConfig = JSON.parse(fs.readFileSync(jobsConfigPath, 'utf8'));

// MongoDB connection for job validation
let mongoClient = null;
let mongoData = null;
let jobsManager = null;

/**
 * Initialize MongoDB connection for job history checks
 * @returns {Promise<void>}
 */
async function initializeMongoDB() {
  if (mongoClient && mongoClient.isConnected()) {
    return; // Already connected
  }

  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
  const dbName = process.env.MONGODB_DB_NAME || 'playarr';
  
  try {
    mongoClient = new MongoClientUtil(mongoUri, dbName);
    await mongoClient.connect();
    mongoData = new MongoDataService(mongoClient);
    logger.debug('MongoDB connection initialized for job validation');
  } catch (error) {
    logger.error(`Failed to connect to MongoDB: ${error.message}`);
    logger.warn('Job validation will not work without MongoDB connection');
    throw error;
  }
}

/**
 * Main application entry point
 * Uses Bree.js to schedule and run jobs automatically
 */
async function main() {
  logger.info('Starting Playarr Engine with Bree.js job scheduler...');

  // Initialize MongoDB connection for job validation
  await initializeMongoDB();

  // Configure Bree.js jobs
  // Register all jobs so they can be triggered manually
  // Only schedule jobs that have an interval (manual-only jobs don't have interval)
  const bree = new Bree({
    root: path.join(__dirname, 'workers'),
    defaultExtension: 'js',
    jobs: jobsConfig.jobs.map(job => {
      const jobConfig = {
        name: job.name,
        path: path.join(__dirname, 'workers', `${job.name}.js`),
        worker: {
          workerData: {
            cacheDir: CACHE_DIR
          }
        }
      };
      
      // Only include interval if it exists (scheduled jobs)
      // Jobs without interval are manual-only and won't be scheduled
      if (job.interval) {
        jobConfig.interval = job.interval;
      }
      
      // Prevent manual-only jobs from running on startup
      // They should only run via postExecute or manual trigger
      if (!job.interval) {
        jobConfig.runOnInit = false;
      }
      
      // Only include timeout if it's a valid non-zero value
      // Bree.js doesn't accept "0" as a timeout value
      if (job.timeout && job.timeout !== '0' && job.timeout !== 0) {
        jobConfig.timeout = job.timeout;
      }
      
      return jobConfig;
    })
  });

  // Initialize JobsManager with MongoDB, jobs config, and Bree instance
  jobsManager = new JobsManager(mongoData, jobsConfig, bree);

  // Store workerData for each running job to pass through to postExecute jobs
  const jobWorkerDataMap = new Map();

  // Override the run method to prevent any job from running if it's already running
  // Uses MongoDB job_history as single source of truth
  const originalRun = bree.run.bind(bree);
  bree.run = async function(name, workerData) {
    // Validate if job can run using JobsManager
    const validation = await jobsManager.canRunJob(name);
    
    if (!validation.canRun) {
      logger.debug(`Skipping ${name} - ${validation.reason}`);
      return;
    }
    
    try {
      // Merge workerData with existing job config workerData (preserving cacheDir)
      if (workerData) {
        const jobConfig = bree.config.jobs.find(j => j.name === name);
        if (jobConfig && jobConfig.worker && jobConfig.worker.workerData) {
          workerData = { ...jobConfig.worker.workerData, ...workerData };
        }
      } else {
        const jobConfig = bree.config.jobs.find(j => j.name === name);
        if (jobConfig && jobConfig.worker && jobConfig.worker.workerData) {
          workerData = { ...jobConfig.worker.workerData };
        }
      }
      
      // Store workerData for this job (excluding cacheDir as it's always present)
      if (workerData) {
        const { cacheDir, ...dataToStore } = workerData;
        if (Object.keys(dataToStore).length > 0) {
          jobWorkerDataMap.set(name, dataToStore);
        }
      }
      
      // Log job start with workerData
      const workerDataStr = workerData ? JSON.stringify(workerData) : 'none';
      logger.info(`Starting job '${name}' with workerData: ${workerDataStr}`);
      
      const result = await originalRun(name, workerData);
            
      return result;
    } catch (error) {
      // If Bree throws "already running" error, throw a custom error that can be handled upstream
      if (error.message && error.message.includes('already running')) {
        logger.debug(`Skipping ${name} - Bree detected it is already running`);
        const alreadyRunningError = new Error(`Job '${name}' is already running`);
        alreadyRunningError.code = 'JOB_ALREADY_RUNNING';
        alreadyRunningError.isAlreadyRunning = true;
        throw alreadyRunningError;
      }
      throw error;
    }
  };

  bree.on('worker message', async (name, message) => {
    if (message.success) {
      logger.info(`Job ${name} completed successfully`);
      
      // Handle job-specific result logging
      if (name === 'processProvidersTitles' && Array.isArray(message.result)) {
        logger.debug('=== Fetch Results ===');
        message.result.forEach(result => {
          if (result.error) {
            logger.error(`${result.providerName}: ${result.error}`);
          } else {
            logger.info(`${result.providerName}: ${result.movies} movies, ${result.tvShows} TV shows`);
          }
        });
      } else if (name === 'processMainTitles' && message.result) {
        logger.debug('=== Process Results ===');
        logger.info(`Generated: ${message.result.movies} movies, ${message.result.tvShows} TV shows`);
      }

      logger.info(`Job '${name}' completed successfully`);
      
      // Generic postExecute handler - trigger jobs listed in postExecute array
      const jobConfig = jobsManager.getJobMetadata(name);
      if (jobConfig && jobConfig.postExecute && jobConfig.postExecute.length > 0) {
        // Get stored workerData for this job to pass through to post-execute jobs
        const workerDataToPass = jobWorkerDataMap.get(name);
        
        for (const postJobName of jobConfig.postExecute) {
          try {
            const logMsg = `Job '${name}' completed. Triggering post-execute job '${postJobName}'`;
            const logMsgWithProvider = workerDataToPass?.providerId 
              ? `${logMsg} with providerId: ${workerDataToPass.providerId}`
              : logMsg;
            logger.info(`${logMsgWithProvider}...`);
            await bree.run(postJobName, workerDataToPass);
          } catch (error) {
            logger.error(`Failed to trigger post-execute job '${postJobName}' after '${name}': ${error.message}`);
          }
        }
        
        // Clean up stored workerData after postExecute jobs are triggered
        jobWorkerDataMap.delete(name);
      } else {
        // Clean up stored workerData if no postExecute jobs
        jobWorkerDataMap.delete(name);
      }
    } else {
      logger.error(`Job ${name} failed: ${message.error}`);
      // Clean up stored workerData on failure
      jobWorkerDataMap.delete(name);
    }
  });

  try {
    // Start Bree.js scheduler
    await bree.start();

    logger.info('Job scheduler started. Jobs will run according to schedule.');
    jobsConfig.jobs
      .filter(job => job.interval) // Only show scheduled jobs
      .forEach(job => {
        logger.info(`- ${job.name}: ${job.schedule}`);
      });
    
    // Log manual-only jobs separately
    const manualJobs = jobsConfig.jobs.filter(job => !job.interval);
    if (manualJobs.length > 0) {
      logger.info('Manual-only jobs (available for trigger):');
      manualJobs.forEach(job => {
        logger.info(`- ${job.name}: ${job.schedule || 'Manual trigger only'}`);
      });
    }
    
    // Create and start HTTP server for job control API
    let engineServer = null;
    try {
      engineServer = new EngineServer(bree, jobsManager);
      await engineServer.start();
      logger.info('Engine HTTP API server is ready');
    } catch (serverError) {
      logger.error('Server error details:', serverError);
      process.exit(1);
    }
    
    // Graceful shutdown handler
    const shutdown = async (signal) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      
      if (engineServer && engineServer._server) {
        engineServer._server.close(() => {
          logger.info('HTTP server closed');
        });
      }
      
      await bree.stop();
      logger.info('Job scheduler stopped');
      process.exit(0);
    };
    
    // Keep the process running
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    
  } catch (error) {
    logger.error(`Error starting job scheduler: ${error.message}`);
    logger.error(error.stack);
    await bree.stop();
    process.exit(1);
  }
}

main();
