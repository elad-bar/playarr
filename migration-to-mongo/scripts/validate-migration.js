import dotenv from 'dotenv';
import MongoClientUtil from './utils/mongo-client.js';
import FileReader from './utils/file-reader.js';
import Logger from './utils/logger.js';

// Load environment variables
dotenv.config();

const logger = new Logger(process.env.LOG_LEVEL || 'info');

/**
 * Count documents in source files
 */
async function countSourceFiles(fileReader) {
  const counts = {};

  // Count titles
  const titles = await fileReader.readJsonArray('titles/main.json');
  counts.titles = titles.length;

  // Count title_streams
  const streams = await fileReader.readJsonObject('titles/main-titles-streams.json');
  counts.title_streams = Object.keys(streams).length;

  // Count provider_titles
  const providerTitleFiles = await fileReader.findProviderFiles('titles', '(.+)\\.titles\\.json');
  let providerTitlesCount = 0;
  for (const { relativePath } of providerTitleFiles) {
    const titles = await fileReader.readJsonArray(relativePath);
    providerTitlesCount += titles.length;
  }
  counts.provider_titles = providerTitlesCount;

  // Count provider_categories
  const providerCategoryFiles = await fileReader.findProviderFiles('categories', '(.+)\\.categories\\.json');
  let providerCategoriesCount = 0;
  for (const { relativePath } of providerCategoryFiles) {
    const categories = await fileReader.readJsonArray(relativePath);
    providerCategoriesCount += categories.length;
  }
  counts.provider_categories = providerCategoriesCount;

  // Count users
  const users = await fileReader.readJsonArray('settings/users.json');
  counts.users = users.length;

  // Count iptv_providers
  const providers = await fileReader.readJsonArray('settings/iptv-providers.json');
  counts.iptv_providers = providers.length;

  // Count settings (number of keys = number of documents)
  const settings = await fileReader.readJsonObject('settings/settings.json');
  counts.settings = settings && Object.keys(settings).length > 0 ? Object.keys(settings).length : 0;

  // Count cache_policy (number of keys = number of documents)
  const cachePolicy = await fileReader.readJsonObject('settings/cache-policy.json');
  counts.cache_policy = cachePolicy && Object.keys(cachePolicy).length > 0 ? Object.keys(cachePolicy).length : 0;

  // Count stats (1 if exists)
  const stats = await fileReader.readJsonObject('stats.json');
  counts.stats = Object.keys(stats).length > 0 ? 1 : 0;

  return counts;
}

/**
 * Count documents in MongoDB collections
 */
async function countMongoCollections(mongoClient) {
  const db = mongoClient.getDatabase();
  const counts = {};

  const collections = [
    'titles',
    'title_streams',
    'provider_titles',
    'provider_categories',
    'users',
    'iptv_providers',
    'settings',
    'cache_policy',
    'stats',
  ];

  for (const collectionName of collections) {
    try {
      const collection = db.collection(collectionName);
      counts[collectionName] = await collection.countDocuments();
    } catch (error) {
      logger.warn(`Failed to count ${collectionName}: ${error.message}`);
      counts[collectionName] = 0;
    }
  }

  return counts;
}

/**
 * Validate data integrity - sample checks
 */
async function validateDataIntegrity(mongoClient, logger) {
  const db = mongoClient.getDatabase();
  const issues = [];

  // Check title_key format in titles
  logger.info('Validating title_key formats...');
  const titlesCollection = db.collection('titles');
  const sampleTitle = await titlesCollection.findOne({});
  if (sampleTitle) {
    if (!sampleTitle.title_key) {
      issues.push('Some titles missing title_key');
    } else if (!/^(movies|tvshows)-\d+$/.test(sampleTitle.title_key)) {
      issues.push(`Invalid title_key format: ${sampleTitle.title_key}`);
    }
  }

  // Check ignored titles merged correctly
  logger.info('Validating ignored titles...');
  const providerTitlesCollection = db.collection('provider_titles');
  const ignoredCount = await providerTitlesCollection.countDocuments({ ignored: true });
  const ignoredWithReason = await providerTitlesCollection.countDocuments({
    ignored: true,
    ignored_reason: { $exists: true, $ne: null },
  });
  
  if (ignoredCount > 0 && ignoredWithReason !== ignoredCount) {
    issues.push(`Some ignored titles missing ignored_reason (${ignoredCount - ignoredWithReason})`);
  }

  // Check stream key parsing
  logger.info('Validating stream key parsing...');
  const streamsCollection = db.collection('title_streams');
  const sampleStream = await streamsCollection.findOne({});
  if (sampleStream) {
    if (!sampleStream.title_key || !sampleStream.stream_id || !sampleStream.provider_id) {
      issues.push('Some streams missing required fields (title_key, stream_id, provider_id)');
    }
  }

  // Check streams summary in titles
  logger.info('Validating streams summary in titles...');
  const sampleTitleWithStreams = await titlesCollection.findOne({
    streams: { $exists: true, $ne: {} }
  });
  
  if (sampleTitleWithStreams) {
    // Verify streams field exists and is an object
    if (!sampleTitleWithStreams.streams || typeof sampleTitleWithStreams.streams !== 'object') {
      issues.push('Some titles have invalid streams field (should be object)');
    } else {
      // Sample validation: check if stream_ids in summary match title_streams entries
      const titleKey = sampleTitleWithStreams.title_key;
      const streamIds = Object.keys(sampleTitleWithStreams.streams);
      
      if (streamIds.length > 0) {
        // Check if at least one stream_id from summary exists in title_streams
        const matchingStreams = await streamsCollection.countDocuments({
          title_key: titleKey,
          stream_id: { $in: streamIds }
        });
        
        if (matchingStreams === 0) {
          issues.push(`Title ${titleKey} has streams summary but no matching entries in title_streams`);
        } else {
          // Verify provider_ids in summary exist in title_streams
          for (const [streamId, providerIds] of Object.entries(sampleTitleWithStreams.streams)) {
            if (Array.isArray(providerIds) && providerIds.length > 0) {
              const matchingProviders = await streamsCollection.countDocuments({
                title_key: titleKey,
                stream_id: streamId,
                provider_id: { $in: providerIds }
              });
              
              if (matchingProviders < providerIds.length) {
                issues.push(`Title ${titleKey} stream ${streamId} has ${providerIds.length} providers in summary but only ${matchingProviders} in title_streams`);
              }
            }
          }
        }
      }
    }
  } else {
    // Check if any titles are missing streams field
    const titlesWithoutStreams = await titlesCollection.countDocuments({
      $or: [
        { streams: { $exists: false } },
        { streams: null }
      ]
    });
    
    if (titlesWithoutStreams > 0) {
      issues.push(`${titlesWithoutStreams} titles missing streams field (should be empty object if no streams)`);
    }
  }

  // Check category_key format
  logger.info('Validating category_key formats...');
  const categoriesCollection = db.collection('provider_categories');
  const sampleCategory = await categoriesCollection.findOne({});
  if (sampleCategory) {
    if (!sampleCategory.category_key) {
      issues.push('Some categories missing category_key');
    } else if (!/^(movies|tvshows)-\d+$/.test(sampleCategory.category_key)) {
      issues.push(`Invalid category_key format: ${sampleCategory.category_key}`);
    }
  }

  return issues;
}

/**
 * Main validation function
 */
async function main() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
  const dbName = process.env.MONGODB_DB_NAME || 'playarr';
  const dataDir = process.env.DATA_DIR || './data';

  const mongoClient = new MongoClientUtil(mongoUri, dbName, logger);
  const fileReader = new FileReader(dataDir, logger);

  try {
    await mongoClient.connect();
    logger.info('Starting migration validation...');

    // Count source files
    logger.info('Counting source files...');
    const sourceCounts = await countSourceFiles(fileReader);

    // Count MongoDB collections
    logger.info('Counting MongoDB collections...');
    const mongoCounts = await countMongoCollections(mongoClient);

    // Compare counts
    logger.info('\n=== Validation Results ===');
    let allMatch = true;

    for (const [collectionName, sourceCount] of Object.entries(sourceCounts)) {
      const mongoCount = mongoCounts[collectionName] || 0;
      const match = sourceCount === mongoCount;
      const status = match ? '✓' : '✗';

      logger.info(`${status} ${collectionName}:`);
      logger.info(`  Source: ${sourceCount}`);
      logger.info(`  MongoDB: ${mongoCount}`);
      
      if (!match) {
        const diff = mongoCount - sourceCount;
        logger.warn(`  Difference: ${diff > 0 ? '+' : ''}${diff}`);
        allMatch = false;
      }
    }

    // Data integrity checks
    logger.info('\n=== Data Integrity Checks ===');
    const integrityIssues = await validateDataIntegrity(mongoClient, logger);

    if (integrityIssues.length === 0) {
      logger.success('All data integrity checks passed');
    } else {
      logger.warn(`Found ${integrityIssues.length} integrity issues:`);
      integrityIssues.forEach(issue => logger.warn(`  - ${issue}`));
    }

    // Summary
    logger.info('\n=== Summary ===');
    if (allMatch && integrityIssues.length === 0) {
      logger.success('Validation PASSED: All counts match and no integrity issues found');
    } else {
      logger.warn('Validation completed with issues (see above)');
    }

  } catch (error) {
    logger.error(`Validation failed: ${error.message}`);
    process.exit(1);
  } finally {
    await mongoClient.close();
  }
}

// Run if called directly
const isMainModule = import.meta.url === `file://${process.argv[1]}` || 
                     process.argv[1]?.includes('validate-migration.js') ||
                     process.argv[1]?.endsWith('validate-migration.js');

if (isMainModule) {
  main().catch(error => {
    logger.error(`Unhandled error: ${error.message}`);
    process.exit(1);
  });
}

export default main;

