import { ApplicationContext } from '../context/ApplicationContext.js';
import { ProcessMainTitlesJob } from '../jobs/ProcessMainTitlesJob.js';

/**
 * Bree.js worker file for processing main titles
 * Runs in main thread (worker: false) to access shared ApplicationContext
 * 
 * @param {Object} [params={}] - Optional parameters (workerData equivalent)
 * @returns {Promise<Object>} Count of generated main titles by type
 */
export default async function(params = {}) {
  const context = ApplicationContext.getInstance();
  
  // Get providerId from params
  const providerId = params?.providerId || null; // Optional provider ID

  // Get initialized dependencies from context
  const cache = context.getCache();
  const mongoData = context.getMongoData();
  const providers = context.getProviders();
  const tmdbProvider = context.getTMDBProvider();

  const job = new ProcessMainTitlesJob(cache, mongoData, providers, tmdbProvider);
  const results = await job.execute(providerId);

  return results;
}
