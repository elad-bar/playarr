import { ApplicationContext } from '../context/ApplicationContext.js';
import { PurgeProviderCacheJob } from '../jobs/PurgeProviderCacheJob.js';

/**
 * Bree.js worker file for purging provider cache
 * Runs in main thread (worker: false) to access shared ApplicationContext
 * 
 * @param {Object} [params={}] - Optional parameters (workerData equivalent)
 * @returns {Promise<Object>} Purge results with providersProcessed and cacheDirectoriesRemoved
 */
export default async function(params = {}) {
  const context = ApplicationContext.getInstance();

  // Get initialized dependencies from context
  const cache = context.getCache();
  const mongoData = context.getMongoData();
  const providers = context.getProviders();
  const tmdbProvider = context.getTMDBProvider();

  const job = new PurgeProviderCacheJob(cache, mongoData, providers, tmdbProvider);
  const results = await job.execute();

  return results;
}
