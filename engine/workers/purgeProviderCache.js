import { parentPort, workerData } from 'worker_threads';
import { ProviderInitializer } from '../utils/ProviderInitializer.js';
import { PurgeProviderCacheJob } from '../jobs/PurgeProviderCacheJob.js';

/**
 * Bree.js worker file for purging provider cache
 * This file is executed by Bree.js as a separate worker thread
 * 
 * Uses ProviderInitializer singleton to prevent redundant initialization
 * within the same worker thread context
 */
async function purgeProviderCacheWorker() {
  const cacheDir = workerData.cacheDir;
  const providerId = workerData.providerId || null; // Optional provider ID

  // Initialize providers once (singleton pattern)
  await ProviderInitializer.initialize(cacheDir);
  
  // Get initialized providers
  const cache = ProviderInitializer.getCache();
  const mongoData = ProviderInitializer.getMongoData();
  const providers = ProviderInitializer.getProviders();
  const tmdbProvider = ProviderInitializer.getTMDBProvider();

  const job = new PurgeProviderCacheJob(cache, mongoData, providers, tmdbProvider);
  const results = await job.execute();

  return results;
}

// Execute worker and send result back to parent
purgeProviderCacheWorker()
  .then(result => {
    if (parentPort) {
      parentPort.postMessage({ success: true, result });
    }
  })
  .catch(error => {
    if (parentPort) {
      parentPort.postMessage({ success: false, error: error.message, stack: error.stack });
    }
  });

