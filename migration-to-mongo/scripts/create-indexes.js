import dotenv from 'dotenv';
import MongoClientUtil from './utils/mongo-client.js';
import Logger from './utils/logger.js';

/**
 * Create all indexes for MongoDB collections
 * Based on schema defined in MIGRATION_PLAN.md
 */

// Load environment variables
dotenv.config();

const logger = new Logger(process.env.LOG_LEVEL || 'info');
const dryRun = process.env.DRY_RUN === 'true';

/**
 * Index definitions for each collection
 */
const INDEX_DEFINITIONS = {
  titles: [
    { keys: { title_key: 1 }, options: { unique: true, name: 'title_key_unique' } },
    { keys: { type: 1 }, options: { name: 'type' } },
    { keys: { title: 'text' }, options: { name: 'title_text' } },
    { keys: { release_date: 1 }, options: { name: 'release_date' } },
    { keys: { type: 1, release_date: 1 }, options: { name: 'type_release_date' } },
  ],
  title_streams: [
    { keys: { title_key: 1, stream_id: 1 }, options: { name: 'title_key_stream_id' } },
    { keys: { provider_id: 1 }, options: { name: 'provider_id' } },
    { keys: { title_key: 1, provider_id: 1 }, options: { name: 'title_key_provider_id' } },
  ],
  provider_titles: [
    { keys: { provider_id: 1, type: 1 }, options: { name: 'provider_id_type' } },
    { keys: { provider_id: 1, tmdb_id: 1 }, options: { name: 'provider_id_tmdb_id' } },
    { keys: { title_key: 1 }, options: { name: 'title_key' } },
    { keys: { provider_id: 1, ignored: 1 }, options: { name: 'provider_id_ignored' } },
  ],
  provider_categories: [
    { keys: { provider_id: 1, type: 1 }, options: { name: 'provider_id_type' } },
    { keys: { provider_id: 1, category_key: 1 }, options: { unique: true, name: 'provider_id_category_key_unique' } },
    { keys: { provider_id: 1, enabled: 1 }, options: { name: 'provider_id_enabled' } },
  ],
  users: [
    { keys: { username: 1 }, options: { unique: true, name: 'username_unique' } },
    { keys: { role: 1 }, options: { name: 'role' } },
  ],
  iptv_providers: [
    { keys: { id: 1 }, options: { unique: true, name: 'id_unique' } },
    { keys: { enabled: 1 }, options: { name: 'enabled' } },
    { keys: { priority: 1 }, options: { name: 'priority' } },
  ],
  job_history: [
    { keys: { job_name: 1, provider_id: 1 }, options: { name: 'job_name_provider_id' } },
  ],
  // settings, cache_policy: _id is automatically indexed (key is the _id)
  // stats: single document collection, no additional indexes needed
};

/**
 * Create indexes for a collection
 * @param {import('mongodb').Collection} collection - MongoDB collection
 * @param {string} collectionName - Collection name
 * @param {Array} indexes - Array of index definitions
 * @returns {Promise<{created: number, skipped: number, errors: number}>}
 */
async function createIndexesForCollection(collection, collectionName, indexes) {
  if (dryRun) {
    logger.info(`[DRY RUN] Would create ${indexes.length} indexes for ${collectionName}`);
    return { created: indexes.length, skipped: 0, errors: 0 };
  }

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const indexDef of indexes) {
    try {
      const indexName = indexDef.options.name || Object.keys(indexDef.keys).join('_');
      
      // Check if index already exists
      const existingIndexes = await collection.indexes();
      const indexExists = existingIndexes.some(idx => idx.name === indexName);
      
      if (indexExists) {
        logger.debug(`Index ${indexName} already exists on ${collectionName}, skipping`);
        skipped++;
        continue;
      }

      // Create index
      await collection.createIndex(indexDef.keys, indexDef.options);
      logger.success(`Created index ${indexName} on ${collectionName}`);
      created++;
    } catch (error) {
      errors++;
      logger.error(`Failed to create index on ${collectionName}: ${error.message}`);
    }
  }

  return { created, skipped, errors };
}

/**
 * Main function
 */
async function main() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
  const dbName = process.env.MONGODB_DB_NAME || 'playarr';

  if (dryRun) {
    logger.info('Running in DRY RUN mode - no indexes will be created');
  }

  const mongoClient = new MongoClientUtil(mongoUri, dbName, logger);

  try {
    await mongoClient.connect();
    const db = mongoClient.getDatabase();

    logger.info('Creating indexes for all collections...');
    const startTime = Date.now();

    let totalCreated = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    // Create indexes for each collection
    for (const [collectionName, indexes] of Object.entries(INDEX_DEFINITIONS)) {
      logger.info(`Creating indexes for ${collectionName}...`);
      const collection = db.collection(collectionName);
      const result = await createIndexesForCollection(collection, collectionName, indexes);
      
      totalCreated += result.created;
      totalSkipped += result.skipped;
      totalErrors += result.errors;
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    logger.info('Index creation summary:');
    logger.info(`  Created: ${totalCreated}`);
    logger.info(`  Skipped: ${totalSkipped}`);
    if (totalErrors > 0) {
      logger.warn(`  Errors: ${totalErrors}`);
    }
    logger.success(`Index creation completed in ${duration}s`);

  } catch (error) {
    logger.error(`Failed to create indexes: ${error.message}`);
    process.exit(1);
  } finally {
    await mongoClient.close();
  }
}

// Run if called directly
const isMainModule = import.meta.url === `file://${process.argv[1]}` || 
                     process.argv[1]?.includes('create-indexes.js') ||
                     process.argv[1]?.endsWith('create-indexes.js');

if (isMainModule) {
  main().catch(error => {
    logger.error(`Unhandled error: ${error.message}`);
    process.exit(1);
  });
}

export default main;

