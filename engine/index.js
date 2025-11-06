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
        closeWorkerAfterMs: 60000, // Close worker 60 seconds after completion
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
        interval: '1m', // Every 3 minutes
        timeout: '30s', // First run 5 minutes after startup
        closeWorkerAfterMs: 60000, // Close worker 60 seconds after completion
        worker: {
          workerData: {
            cacheDir: CACHE_DIR,
            dataDir: DATA_DIR
          }
        }
      },
      {
        name: 'cachePurge',
        path: path.join(__dirname, 'workers', 'cachePurge.js'),
        interval: '15m', // Every 15 minutes
        timeout: 0, // Run immediately on startup
        closeWorkerAfterMs: 60000, // Close worker 60 seconds after completion
        worker: {
          workerData: {
            cacheDir: CACHE_DIR,
            dataDir: DATA_DIR
          }
        }
      }
    ]
  });

  // Track processProvidersTitles execution state
  bree.on('worker created', (name) => {
    logger.info(`Worker created: ${name}`);
    if (name === 'processProvidersTitles') {
      isProcessProvidersTitlesRunning = true;
      logger.info('processProvidersTitles is now running - processMainTitles will be skipped until it completes');
    }
  });

  bree.on('worker deleted', (name) => {
    logger.info(`Worker deleted: ${name}`);
    if (name === 'processProvidersTitles') {
      isProcessProvidersTitlesRunning = false;
      logger.info('processProvidersTitles completed - processMainTitles can now run');
    }
  });

  // Override the run method to prevent processMainTitles from running when processProvidersTitles is active
  const originalRun = bree.run.bind(bree);
  bree.run = async function(name) {
    if (name === 'processMainTitles' && isProcessProvidersTitlesRunning) {
      logger.info('Skipping processMainTitles - processProvidersTitles is currently running');
      return;
    }
    return originalRun(name);
  };

  bree.on('worker message', (name, message) => {
    if (message.success) {
      logger.info(`Job ${name} completed successfully`);
      if (name === 'processProvidersTitles' && Array.isArray(message.result)) {
        logger.info('=== Fetch Results ===');
        message.result.forEach(result => {
          if (result.error) {
            logger.error(`${result.providerName}: ${result.error}`);
          } else {
            logger.info(`${result.providerName}: ${result.movies} movies, ${result.tvShows} TV shows`);
          }
        });
      } else if (name === 'processMainTitles' && message.result) {
        logger.info('=== Process Results ===');
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
    logger.info('- cachePurge: On startup and every 15 minutes');
    
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
