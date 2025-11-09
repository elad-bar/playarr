import FileReader from '../utils/file-reader.js';
import BatchWriter from '../utils/batch-writer.js';
import { transformTitle, buildStreamsSummary, generateTitleKey } from '../utils/transformers.js';
import Logger from '../utils/logger.js';

/**
 * Migrate main titles to MongoDB (with embedded streams summary)
 * @param {import('../utils/mongo-client.js').default} mongoClient - MongoDB client
 * @param {string} dataDir - Data directory path
 * @param {number} batchSize - Batch size for inserts
 * @param {boolean} dryRun - Dry run mode
 * @param {Logger} logger - Logger instance
 * @returns {Promise<{migrated: number, errors: number}>}
 */
export async function migrateTitles(mongoClient, dataDir, batchSize = 1000, dryRun = false, logger = new Logger()) {
  logger.info('Starting migration: titles');
  const startTime = Date.now();

  try {
    const fileReader = new FileReader(dataDir, logger);
    const collection = mongoClient.getCollection('titles');
    const batchWriter = new BatchWriter(collection, logger, dryRun);

    // Read streams data first to build summary
    logger.info('Reading streams data to build summary...');
    const streamsData = await fileReader.readJsonObject('titles/main-titles-streams.json');
    
    let streamsSummary = {};
    if (streamsData && Object.keys(streamsData).length > 0) {
      streamsSummary = buildStreamsSummary(streamsData);
      const summaryCount = Object.keys(streamsSummary).length;
      logger.info(`Built streams summary for ${summaryCount} titles`);
    } else {
      logger.warn('No streams data found in main-titles-streams.json, titles will have empty streams field');
    }

    // Read main titles
    const titles = await fileReader.readJsonArray('titles/main.json');
    
    if (titles.length === 0) {
      logger.warn('No titles found in main.json');
      return { migrated: 0, errors: 0 };
    }

    logger.info(`Found ${titles.length} titles`);

    // Transform titles with streams summary
    const transformedTitles = titles
      .map(title => {
        // Get title_key for this title
        const titleKey = title.title_key || generateTitleKey(title.type, title.title_id);
        // Get streams summary for this title (or empty object if not found)
        const titleStreamsSummary = streamsSummary[titleKey] || {};
        // Transform with streams summary
        return transformTitle(title, titleStreamsSummary);
      })
      .filter(title => title.title_key); // Filter out invalid titles

    if (transformedTitles.length === 0) {
      logger.warn('No valid titles after transformation');
      return { migrated: 0, errors: 0 };
    }

    // Count titles with streams
    const titlesWithStreams = transformedTitles.filter(title => 
      title.streams && Object.keys(title.streams).length > 0
    ).length;
    logger.debug(`Transformed ${transformedTitles.length} titles (${titlesWithStreams} with streams summary)`);

    // Batch insert
    const result = await batchWriter.batchInsert(transformedTitles, batchSize);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    if (result.errors > 0) {
      logger.warn(`Migration completed with ${result.errors} errors in ${duration}s`);
      if (result.errorDetails.length > 0) {
        logger.debug(`Error details: ${JSON.stringify(result.errorDetails.slice(0, 5))}`);
      }
    } else {
      logger.success(`Migration completed: ${result.inserted} titles migrated in ${duration}s`);
    }

    return { migrated: result.inserted, errors: result.errors };
  } catch (error) {
    logger.error(`Migration failed: ${error.message}`);
    throw error;
  }
}

