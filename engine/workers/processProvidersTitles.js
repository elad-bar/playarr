import { parentPort, workerData } from 'worker_threads';
import { ProviderInitializer } from '../utils/ProviderInitializer.js';
import { ProcessProvidersTitlesJob } from '../jobs/ProcessProvidersTitlesJob.js';

/**
 * Bree.js worker file for processing provider titles
 * This file is executed by Bree.js as a separate worker thread
 * 
 * Uses ProviderInitializer singleton to prevent redundant initialization
 * within the same worker thread context
 */
async function processProvidersTitlesWorker() {
  const cacheDir = workerData.cacheDir;
  const dataDir = workerData.dataDir;

  // Initialize providers once (singleton pattern)
  await ProviderInitializer.initialize(cacheDir, dataDir);
  
  // Get initialized providers
  const cache = ProviderInitializer.getCache();
  const data = ProviderInitializer.getData();
  const providers = ProviderInitializer.getProviders();
  const tmdbProvider = ProviderInitializer.getTMDBProvider();

  const job = new ProcessProvidersTitlesJob(cache, data, providers, tmdbProvider);
  const results = await job.execute();

  return results;
}

// Execute worker and send result back to parent
processProvidersTitlesWorker()
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

