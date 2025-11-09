import FileReader from '../utils/file-reader.js';
import BatchWriter from '../utils/batch-writer.js';
import { ensureTimestamps } from '../utils/transformers.js';
import Logger from '../utils/logger.js';

/**
 * Migrate IPTV providers to MongoDB
 * @param {import('../utils/mongo-client.js').default} mongoClient - MongoDB client
 * @param {string} dataDir - Data directory path
 * @param {number} batchSize - Batch size for inserts
 * @param {boolean} dryRun - Dry run mode
 * @param {Logger} logger - Logger instance
 * @returns {Promise<{migrated: number, errors: number}>}
 */
export async function migrateIptvProviders(mongoClient, dataDir, batchSize = 1000, dryRun = false, logger = new Logger()) {
  logger.info('Starting migration: iptv_providers');
  const startTime = Date.now();

  try {
    const fileReader = new FileReader(dataDir, logger);
    const collection = mongoClient.getCollection('iptv_providers');
    const batchWriter = new BatchWriter(collection, logger, dryRun);

    // Read providers
    const providers = await fileReader.readJsonArray('settings/iptv-providers.json');
    
    if (providers.length === 0) {
      logger.warn('No providers found in iptv-providers.json');
      return { migrated: 0, errors: 0 };
    }

    logger.info(`Found ${providers.length} providers`);

    // Ensure timestamps and preserve all fields
    const transformedProviders = providers.map(provider => ensureTimestamps({ ...provider }));

    // Batch insert (use upsert to handle duplicates by id)
    const result = await batchWriter.batchUpsert(transformedProviders, 'id', batchSize);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    if (result.errors > 0) {
      logger.warn(`Migration completed with ${result.errors} errors in ${duration}s`);
    } else {
      logger.success(`Migration completed: ${result.upserted} providers migrated in ${duration}s`);
    }

    return { migrated: result.upserted, errors: result.errors };
  } catch (error) {
    logger.error(`Migration failed: ${error.message}`);
    throw error;
  }
}

