import { ApplicationContext } from '../context/ApplicationContext.js';
import { ProcessProvidersTitlesJob } from '../jobs/ProcessProvidersTitlesJob.js';
import { createLogger } from '../utils/logger.js';

/**
 * Bree.js worker file for processing provider titles
 * Runs in main thread (worker: false) to access shared ApplicationContext
 * 
 * @param {Object} [params={}] - Optional parameters (workerData equivalent)
 * @returns {Promise<Array>} Array of fetch results
 */
export default async function(params = {}) {
  // Create logger inside function so it's available when Bree.js evaluates the function
  const logger = createLogger('processProvidersTitles');
  
  try {
    logger.debug('Worker function called');
    const context = ApplicationContext.getInstance();
    
    logger.debug('Getting dependencies from context');
    // Get initialized dependencies from context
    const cache = context.getCache();
    const mongoData = context.getMongoData();
    const providers = context.getProviders();
    const tmdbProvider = context.getTMDBProvider();

    logger.debug('Creating job instance');
    const job = new ProcessProvidersTitlesJob(cache, mongoData, providers, tmdbProvider);
    
    logger.debug('Executing job...');
    const results = await job.execute();
    
    logger.debug('Job completed, returning results');
    return results;
  } catch (error) {
    logger.error(`Error in worker: ${error.message}`);
    if (error.stack) {
      logger.error(`Stack trace: ${error.stack}`);
    }
    throw error;
  }
}
