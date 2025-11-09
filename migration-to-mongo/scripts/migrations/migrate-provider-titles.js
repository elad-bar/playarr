import FileReader from '../utils/file-reader.js';
import BatchWriter from '../utils/batch-writer.js';
import { transformProviderTitle } from '../utils/transformers.js';
import Logger from '../utils/logger.js';

/**
 * Migrate provider titles to MongoDB (with ignored titles merged as flags)
 * @param {import('../utils/mongo-client.js').default} mongoClient - MongoDB client
 * @param {string} dataDir - Data directory path
 * @param {number} batchSize - Batch size for inserts
 * @param {boolean} dryRun - Dry run mode
 * @param {Logger} logger - Logger instance
 * @returns {Promise<{migrated: number, errors: number}>}
 */
export async function migrateProviderTitles(mongoClient, dataDir, batchSize = 1000, dryRun = false, logger = new Logger()) {
  logger.info('Starting migration: provider_titles');
  const startTime = Date.now();

  try {
    const fileReader = new FileReader(dataDir, logger);
    const collection = mongoClient.getCollection('provider_titles');
    const batchWriter = new BatchWriter(collection, logger, dryRun);

    // Find all provider title files
    const providerFiles = await fileReader.findProviderFiles('titles', '(.+)\\.titles\\.json');
    logger.info(`Found ${providerFiles.length} provider title files`);

    if (providerFiles.length === 0) {
      logger.warn('No provider title files found');
      return { migrated: 0, errors: 0 };
    }

    let totalMigrated = 0;
    let totalErrors = 0;

    for (const { providerId, filePath, relativePath } of providerFiles) {
      logger.info(`Processing provider: ${providerId}`);

      // Read titles array
      const titles = await fileReader.readJsonArray(relativePath);
      
      if (titles.length === 0) {
        logger.debug(`No titles found for provider ${providerId}`);
        continue;
      }

      // Load ignored titles for this provider
      const ignoredPath = `titles/${providerId}.ignored.json`;
      const ignoredTitles = await fileReader.readJsonObject(ignoredPath);
      const ignoredCount = Object.keys(ignoredTitles).length;
      
      if (ignoredCount > 0) {
        logger.debug(`Found ${ignoredCount} ignored titles for provider ${providerId}`);
      }

      // Transform titles (merge ignored flags)
      const transformedTitles = titles
        .map(title => {
          const transformed = transformProviderTitle(title, ignoredTitles);
          // Add provider_id if not present
          if (!transformed.provider_id) {
            transformed.provider_id = providerId;
          }
          return transformed;
        })
        .filter(title => title.title_key); // Filter out invalid titles

      if (transformedTitles.length === 0) {
        logger.warn(`No valid titles after transformation for provider ${providerId}`);
        continue;
      }

      // Count ignored titles
      const ignoredCountInTitles = transformedTitles.filter(t => t.ignored).length;
      if (ignoredCountInTitles > 0) {
        logger.debug(`Provider ${providerId}: ${ignoredCountInTitles} titles marked as ignored`);
      }

      // Batch insert
      const result = await batchWriter.batchInsert(transformedTitles, batchSize);
      totalMigrated += result.inserted;
      totalErrors += result.errors;

      if (result.errors > 0) {
        logger.warn(`Provider ${providerId}: ${result.errors} errors during migration`);
        if (result.errorDetails.length > 0) {
          logger.debug(`Error details: ${JSON.stringify(result.errorDetails.slice(0, 5))}`);
        }
      }

      logger.success(`Provider ${providerId}: Migrated ${result.inserted} titles (${ignoredCountInTitles} ignored)`);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.success(`Migration completed: ${totalMigrated} titles migrated in ${duration}s`);
    
    if (totalErrors > 0) {
      logger.warn(`Total errors: ${totalErrors}`);
    }

    return { migrated: totalMigrated, errors: totalErrors };
  } catch (error) {
    logger.error(`Migration failed: ${error.message}`);
    throw error;
  }
}

