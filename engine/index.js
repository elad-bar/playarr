import dotenv from 'dotenv';
import Bree from 'bree';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from './utils/logger.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, '../cache');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const logger = createLogger('Main');

/**
 * Main application entry point
 * Uses Bree.js to schedule and run jobs automatically
 */
async function main() {
  logger.info('Starting Playarr Engine with Bree.js job scheduler...');

  // Track job execution state to prevent concurrent execution
  const runningJobs = new Set();
  let isProcessProvidersTitlesRunning = false;

  // Configure Bree.js jobs with schedules
  const bree = new Bree({
    root: path.join(__dirname, 'workers'),
    defaultExtension: 'js',
    jobs: [
      {
        name: 'processProvidersTitles',
        path: path.join(__dirname, 'workers', 'processProvidersTitles.js'),
        interval: '1h', // Every 1 hour
        timeout: 0, // Run immediately on startup
        worker: {
          workerData: {
            cacheDir: CACHE_DIR,
            dataDir: DATA_DIR
          }
        }
      },
      {
        name: 'processMainTitles',
        path: path.join(__dirname, 'workers', 'processMainTitles.js'),
        interval: '5m', // Every 5 minutes
        timeout: '1m', // First run 1 minute after startup
        worker: {
          workerData: {
            cacheDir: CACHE_DIR,
            dataDir: DATA_DIR
          }
        }
      }
      // Cache purge job disabled - expiration is now checked on-demand when cache is accessed
      // {
      //   name: 'cachePurge',
      //   path: path.join(__dirname, 'workers', 'cachePurge.js'),
      //   interval: '15m', // Every 15 minutes
      //   timeout: 0, // Run immediately on startup
      //   worker: {
      //     workerData: {
      //       cacheDir: CACHE_DIR,
      //       dataDir: DATA_DIR
      //     }
      //   }
      // }
    ]
  });

  // Track job execution state
  bree.on('worker created', (name) => {
    logger.debug(`Worker created: ${name}`);
    runningJobs.add(name);
    if (name === 'processProvidersTitles') {
      isProcessProvidersTitlesRunning = true;
      logger.debug('processProvidersTitles is now running - processMainTitles will be skipped until it completes');
    }
  });

  bree.on('worker deleted', (name) => {
    logger.debug(`Worker deleted: ${name}`);
    runningJobs.delete(name);
    if (name === 'processProvidersTitles') {
      isProcessProvidersTitlesRunning = false;
      logger.debug('processProvidersTitles completed - processMainTitles can now run');
    }
  });

  // Override the run method to prevent any job from running if it's already running
  // Also prevent processMainTitles from running when processProvidersTitles is active
  const originalRun = bree.run.bind(bree);
  bree.run = async function(name) {
    // Prevent any job from running if it's already running
    if (runningJobs.has(name)) {
      logger.debug(`Skipping ${name} - already running`);
      return;
    }
    
    // Special case: prevent processMainTitles from running when processProvidersTitles is active
    if (name === 'processMainTitles' && isProcessProvidersTitlesRunning) {
      logger.debug('Skipping processMainTitles - processProvidersTitles is currently running');
      return;
    }
    
    try {
      return await originalRun(name);
    } catch (error) {
      // If Bree throws "already running" error, ignore it (we're already tracking it)
      if (error.message && error.message.includes('already running')) {
        logger.debug(`Skipping ${name} - Bree detected it is already running`);
        return;
      }
      throw error;
    }
  };

  bree.on('worker message', (name, message) => {
    if (message.success) {
      logger.info(`Job ${name} completed successfully`);
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
    } else {
      logger.error(`Job ${name} failed: ${message.error}`);
    }
  });

  try {
    // Start Bree.js scheduler
    await bree.start();

    logger.info('Job scheduler started. Jobs will run according to schedule.');
    logger.info('- processProvidersTitles: On startup and every 1 hour');
    logger.info('- processMainTitles: First run in 5 minutes, then every 3 minutes (skipped if processProvidersTitles is running)');
    
    // Keep the process running
    process.on('SIGINT', async () => {
      logger.info('Shutting down job scheduler...');
      await bree.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Shutting down job scheduler...');
      await bree.stop();
      process.exit(0);
    });
    
  } catch (error) {
    logger.error(`Error starting job scheduler: ${error.message}`);
    logger.error(error.stack);
    await bree.stop();
    process.exit(1);
  }
}

main();
