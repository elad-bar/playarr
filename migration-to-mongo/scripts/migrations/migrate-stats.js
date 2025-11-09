import FileReader from '../utils/file-reader.js';
import BatchWriter from '../utils/batch-writer.js';
import { ensureTimestamps } from '../utils/transformers.js';
import Logger from '../utils/logger.js';

/**
 * Migrate stats to MongoDB (single document)
 * @param {import('../utils/mongo-client.js').default} mongoClient - MongoDB client
 * @param {string} dataDir - Data directory path
 * @param {number} batchSize - Batch size (not used for single document, but required for consistency)
 * @param {boolean} dryRun - Dry run mode
 * @param {Logger} logger - Logger instance
 * @returns {Promise<{migrated: number, errors: number}>}
 */
export async function migrateStats(mongoClient, dataDir, batchSize = 1000, dryRun = false, logger = new Logger()) {
  logger.info('Starting migration: stats');
  const startTime = Date.now();

  try {
    const fileReader = new FileReader(dataDir, logger);
    const collection = mongoClient.getCollection('stats');
    const batchWriter = new BatchWriter(collection, logger, dryRun);

    // Read stats (object format)
    const stats = await fileReader.readJsonObject('stats.json');
    
    let transformedStats;
    if (!stats || Object.keys(stats).length === 0) {
      logger.warn('No stats found in stats.json, creating empty document');
      transformedStats = ensureTimestamps({});
    } else {
      logger.info('Found stats document');
      // Ensure timestamps and preserve all fields
      transformedStats = ensureTimestamps({ ...stats });
    }

    // Upsert single document (this will create the collection if it doesn't exist)
    const result = await batchWriter.upsertOne(transformedStats, {});
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    if (result.upserted || result.modified) {
      logger.success(`Migration completed: stats document ${result.upserted ? 'created' : 'updated'} in ${duration}s`);
    } else {
      logger.warn(`Migration completed: stats document unchanged in ${duration}s`);
    }

    // Ensure collection exists (verify by checking count)
    if (!dryRun) {
      const count = await collection.countDocuments();
      if (count === 0) {
        logger.warn('Warning: stats collection exists but has no documents');
      }
    }

    return { migrated: result.upserted ? 1 : (result.modified ? 1 : 0), errors: 0 };
  } catch (error) {
    logger.error(`Migration failed: ${error.message}`);
    logger.error(`Stack trace: ${error.stack}`);
    throw error;
  }
}

