import FileReader from '../utils/file-reader.js';
import BatchWriter from '../utils/batch-writer.js';
import { transformTitleStream } from '../utils/transformers.js';
import Logger from '../utils/logger.js';

/**
 * Migrate title streams to MongoDB
 * @param {import('../utils/mongo-client.js').default} mongoClient - MongoDB client
 * @param {string} dataDir - Data directory path
 * @param {number} batchSize - Batch size for inserts
 * @param {boolean} dryRun - Dry run mode
 * @param {Logger} logger - Logger instance
 * @returns {Promise<{migrated: number, errors: number}>}
 */
export async function migrateTitleStreams(mongoClient, dataDir, batchSize = 1000, dryRun = false, logger = new Logger()) {
  logger.info('Starting migration: title_streams');
  const startTime = Date.now();

  try {
    const fileReader = new FileReader(dataDir, logger);
    const collection = mongoClient.getCollection('title_streams');
    const batchWriter = new BatchWriter(collection, logger, dryRun);

    // Read main-titles-streams.json (object format)
    const streamsData = await fileReader.readJsonObject('titles/main-titles-streams.json');
    
    if (!streamsData || Object.keys(streamsData).length === 0) {
      logger.warn('No streams found in main-titles-streams.json, creating empty collection');
      // Create empty collection by inserting and immediately deleting a placeholder
      // This ensures the collection exists even if empty
      if (!dryRun) {
        try {
          await collection.insertOne({ _placeholder: true });
          await collection.deleteOne({ _placeholder: true });
          logger.info('Created empty title_streams collection');
        } catch (error) {
          logger.warn(`Failed to create empty collection: ${error.message}`);
        }
      }
      return { migrated: 0, errors: 0 };
    }

    const streamKeys = Object.keys(streamsData);
    logger.info(`Found ${streamKeys.length} stream entries`);

    // Transform streams
    const transformedStreams = [];
    let invalidCount = 0;

    for (const [key, value] of Object.entries(streamsData)) {
      const transformed = transformTitleStream(key, value);
      if (transformed) {
        transformedStreams.push(transformed);
      } else {
        invalidCount++;
      }
    }

    if (invalidCount > 0) {
      logger.warn(`Skipped ${invalidCount} invalid stream entries`);
    }

    if (transformedStreams.length === 0) {
      logger.warn('No valid streams after transformation');
      return { migrated: 0, errors: 0 };
    }

    logger.debug(`Transformed ${transformedStreams.length} stream entries`);

    // Batch insert
    const result = await batchWriter.batchInsert(transformedStreams, batchSize);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    if (result.errors > 0) {
      logger.warn(`Migration completed with ${result.errors} errors in ${duration}s`);
      if (result.errorDetails.length > 0) {
        logger.debug(`Error details: ${JSON.stringify(result.errorDetails.slice(0, 5))}`);
      }
    } else {
      logger.success(`Migration completed: ${result.inserted} streams migrated in ${duration}s`);
    }

    return { migrated: result.inserted, errors: result.errors };
  } catch (error) {
    logger.error(`Migration failed: ${error.message}`);
    throw error;
  }
}

