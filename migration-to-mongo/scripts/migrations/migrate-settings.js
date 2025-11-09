import FileReader from '../utils/file-reader.js';
import BatchWriter from '../utils/batch-writer.js';
import { ensureTimestamps } from '../utils/transformers.js';
import Logger from '../utils/logger.js';

/**
 * Migrate settings to MongoDB (one document per key)
 * Each key-value pair becomes a document: { _id: key, value: value, createdAt, lastUpdated }
 * @param {import('../utils/mongo-client.js').default} mongoClient - MongoDB client
 * @param {string} dataDir - Data directory path
 * @param {number} batchSize - Batch size for inserts
 * @param {boolean} dryRun - Dry run mode
 * @param {Logger} logger - Logger instance
 * @returns {Promise<{migrated: number, errors: number}>}
 */
export async function migrateSettings(mongoClient, dataDir, batchSize = 1000, dryRun = false, logger = new Logger()) {
  logger.info('Starting migration: settings');
  const startTime = Date.now();

  try {
    const fileReader = new FileReader(dataDir, logger);
    const collection = mongoClient.getCollection('settings');
    const batchWriter = new BatchWriter(collection, logger, dryRun);

    // Read settings (object format)
    const settings = await fileReader.readJsonObject('settings/settings.json');
    
    if (!settings || Object.keys(settings).length === 0) {
      logger.warn('No settings found in settings.json');
      return { migrated: 0, errors: 0 };
    }

    logger.info(`Found ${Object.keys(settings).length} settings keys`);

    // Transform each key-value pair into a document
    const transformedSettings = Object.entries(settings).map(([key, value]) => {
      const doc = {
        _id: key,  // Use key as _id
        value: value,  // Store value
      };
      return ensureTimestamps(doc);
    });

    // Batch upsert using _id as the filter field
    const result = await batchWriter.batchUpsert(transformedSettings, '_id', batchSize);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    if (result.errors > 0) {
      logger.warn(`Migration completed with ${result.errors} errors in ${duration}s`);
      if (result.errorDetails.length > 0) {
        logger.debug(`Error details: ${JSON.stringify(result.errorDetails.slice(0, 5))}`);
      }
    } else {
      logger.success(`Migration completed: ${result.upserted + result.modified} settings migrated in ${duration}s`);
    }

    return { migrated: result.upserted + result.modified, errors: result.errors };
  } catch (error) {
    logger.error(`Migration failed: ${error.message}`);
    logger.error(`Stack trace: ${error.stack}`);
    throw error;
  }
}

