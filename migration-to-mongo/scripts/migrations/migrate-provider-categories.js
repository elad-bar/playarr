import FileReader from '../utils/file-reader.js';
import BatchWriter from '../utils/batch-writer.js';
import { transformProviderCategory } from '../utils/transformers.js';
import Logger from '../utils/logger.js';

/**
 * Migrate provider categories to MongoDB
 * @param {import('../utils/mongo-client.js').default} mongoClient - MongoDB client
 * @param {string} dataDir - Data directory path
 * @param {number} batchSize - Batch size for inserts
 * @param {boolean} dryRun - Dry run mode
 * @param {Logger} logger - Logger instance
 * @returns {Promise<{migrated: number, errors: number}>}
 */
export async function migrateProviderCategories(mongoClient, dataDir, batchSize = 1000, dryRun = false, logger = new Logger()) {
  logger.info('Starting migration: provider_categories');
  const startTime = Date.now();

  try {
    const fileReader = new FileReader(dataDir, logger);
    const collection = mongoClient.getCollection('provider_categories');
    const batchWriter = new BatchWriter(collection, logger, dryRun);

    // Find all provider category files
    const providerFiles = await fileReader.findProviderFiles('categories', '(.+)\\.categories\\.json');
    logger.info(`Found ${providerFiles.length} provider category files`);

    if (providerFiles.length === 0) {
      logger.warn('No provider category files found');
      return { migrated: 0, errors: 0 };
    }

    let totalMigrated = 0;
    let totalErrors = 0;

    for (const { providerId, filePath, relativePath } of providerFiles) {
      logger.info(`Processing provider: ${providerId}`);

      // Read categories array
      const categories = await fileReader.readJsonArray(relativePath);
      
      if (categories.length === 0) {
        logger.debug(`No categories found for provider ${providerId}`);
        continue;
      }

      // Transform categories
      const transformedCategories = categories
        .map(category => transformProviderCategory(category, providerId))
        .filter(category => category.category_key); // Filter out invalid categories

      if (transformedCategories.length === 0) {
        logger.warn(`No valid categories after transformation for provider ${providerId}`);
        continue;
      }

      // Batch insert
      const result = await batchWriter.batchInsert(transformedCategories, batchSize);
      totalMigrated += result.inserted;
      totalErrors += result.errors;

      if (result.errors > 0) {
        logger.warn(`Provider ${providerId}: ${result.errors} errors during migration`);
        if (result.errorDetails.length > 0) {
          logger.debug(`Error details: ${JSON.stringify(result.errorDetails.slice(0, 5))}`);
        }
      }

      logger.success(`Provider ${providerId}: Migrated ${result.inserted} categories`);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.success(`Migration completed: ${totalMigrated} categories migrated in ${duration}s`);
    
    if (totalErrors > 0) {
      logger.warn(`Total errors: ${totalErrors}`);
    }

    return { migrated: totalMigrated, errors: totalErrors };
  } catch (error) {
    logger.error(`Migration failed: ${error.message}`);
    throw error;
  }
}

