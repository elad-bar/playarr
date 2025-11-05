import { parentPort, workerData } from 'worker_threads';
import { ProviderInitializer } from '../utils/ProviderInitializer.js';
import { CachePurgeJob } from '../jobs/CachePurgeJob.js';

/**
 * Bree.js worker file for purging expired cache files
 * This file is executed by Bree.js as a separate worker thread
 * 
 * Uses ProviderInitializer singleton to prevent redundant initialization
 * within the same worker thread context
 */
async function cachePurgeWorker() {
  const cacheDir = workerData.cacheDir;
  const dataDir = workerData.dataDir;

  // Initialize providers once (singleton pattern)
  await ProviderInitializer.initialize(cacheDir, dataDir);
  
  // Get initialized providers
  const cache = ProviderInitializer.getCache();
  const data = ProviderInitializer.getData();
  const providers = ProviderInitializer.getProviders();
  const tmdbProvider = ProviderInitializer.getTMDBProvider();

  const job = new CachePurgeJob(cache, data, providers, tmdbProvider);
  const results = await job.execute();

  return results;
}

// Execute worker and send result back to parent
cachePurgeWorker()
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

