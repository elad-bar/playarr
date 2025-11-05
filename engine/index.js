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

  // Configure Bree.js jobs with schedules
  const bree = new Bree({
    root: path.join(__dirname, 'workers'),
    defaultExtension: 'js',
    jobs: [
      {
        name: 'processProvidersTitles',
        path: 'processProvidersTitles.js',
        interval: '1h', // Every 1 hour
        timeout: 0, // Run immediately on startup
        closeWorkerAfterMs: 0, // Keep worker alive - prevents parallel execution
        worker: {
          workerData: {
            cacheDir: CACHE_DIR,
            dataDir: DATA_DIR
          }
        }
      },
      {
        name: 'processMainTitles',
        path: 'processMainTitles.js',
        interval: '30m', // Every 30 minutes
        timeout: '5m', // First run 5 minutes after startup
        closeWorkerAfterMs: 0, // Keep worker alive - prevents parallel execution
        worker: {
          workerData: {
            cacheDir: CACHE_DIR,
            dataDir: DATA_DIR
          }
        }
      },
      {
        name: 'cachePurge',
        path: 'cachePurge.js',
        interval: '15m', // Every 15 minutes
        timeout: 0, // Run immediately on startup
        closeWorkerAfterMs: 0, // Keep worker alive - prevents parallel execution
        worker: {
          workerData: {
            cacheDir: CACHE_DIR,
            dataDir: DATA_DIR
          }
        }
      }
    ]
  });

  // Handle job events
  bree.on('worker created', (name) => {
    logger.info(`Worker created: ${name}`);
  });

  bree.on('worker deleted', (name) => {
    logger.info(`Worker deleted: ${name}`);
  });

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
    logger.info('- processMainTitles: First run in 5 minutes, then every 30 minutes');
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
