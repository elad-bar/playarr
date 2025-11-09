import { parentPort, workerData } from 'worker_threads';
import { ProviderInitializer } from '../utils/ProviderInitializer.js';
import { MonitorConfigurationJob } from '../jobs/MonitorConfigurationJob.js';

/**
 * Bree.js worker file for monitoring configuration changes
 * This file is executed by Bree.js as a separate worker thread
 * 
 * Uses ProviderInitializer singleton to prevent redundant initialization
 * within the same worker thread context
 */
async function monitorConfigurationWorker() {
  const cacheDir = workerData.cacheDir;

  // Initialize providers once (singleton pattern)
  await ProviderInitializer.initialize(cacheDir);
  
  // Get initialized providers
  const cache = ProviderInitializer.getCache();
  const mongoData = ProviderInitializer.getMongoData();
  const providers = ProviderInitializer.getProviders();
  const tmdbProvider = ProviderInitializer.getTMDBProvider();

  const job = new MonitorConfigurationJob(cache, mongoData, providers, tmdbProvider);
  const results = await job.execute();

  return results;
}

// Execute worker and send result back to parent
monitorConfigurationWorker()
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

