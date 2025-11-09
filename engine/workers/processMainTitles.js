import { parentPort, workerData } from 'worker_threads';
import { ProviderInitializer } from '../utils/ProviderInitializer.js';
import { ProcessMainTitlesJob } from '../jobs/ProcessMainTitlesJob.js';

/**
 * Bree.js worker file for processing main titles
 * This file is executed by Bree.js as a separate worker thread
 * 
 * Uses ProviderInitializer singleton to prevent redundant initialization
 * within the same worker thread context
 */
async function processMainTitlesWorker() {
  const cacheDir = workerData.cacheDir;
  const dataDir = workerData.dataDir;

  // Initialize providers once (singleton pattern)
  await ProviderInitializer.initialize(cacheDir, dataDir);
  
  // Get initialized providers
  const cache = ProviderInitializer.getCache();
  const data = ProviderInitializer.getData();
  const mongoData = ProviderInitializer.getMongoData();
  const providers = ProviderInitializer.getProviders();
  const tmdbProvider = ProviderInitializer.getTMDBProvider();

  const job = new ProcessMainTitlesJob(cache, data, mongoData, providers, tmdbProvider);
  const results = await job.execute();

  return results;
}

// Execute worker and send result back to parent
processMainTitlesWorker()
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

