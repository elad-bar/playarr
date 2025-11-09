import dotenv from 'dotenv';
import MongoClientUtil from './utils/mongo-client.js';
import Logger from './utils/logger.js';

// Import migration functions
import { migrateProviderCategories } from './migrations/migrate-provider-categories.js';
import { migrateProviderTitles } from './migrations/migrate-provider-titles.js';
import { migrateTitles } from './migrations/migrate-titles.js';
import { migrateTitleStreams } from './migrations/migrate-title-streams.js';
import { migrateUsers } from './migrations/migrate-users.js';
import { migrateIptvProviders } from './migrations/migrate-iptv-providers.js';
import { migrateSettings } from './migrations/migrate-settings.js';
import { migrateCachePolicy } from './migrations/migrate-cache-policy.js';
import { migrateStats } from './migrations/migrate-stats.js';
import createIndexes from './create-indexes.js';
import validateMigration from './validate-migration.js';

// Load environment variables
dotenv.config();

const logger = new Logger(process.env.LOG_LEVEL || 'info');

/**
 * Migration steps in order
 */
const MIGRATION_STEPS = [
  {
    name: 'provider_categories',
    fn: migrateProviderCategories,
    description: 'Provider Categories',
  },
  {
    name: 'provider_titles',
    fn: migrateProviderTitles,
    description: 'Provider Titles',
  },
  {
    name: 'titles',
    fn: migrateTitles,
    description: 'Main Titles',
  },
  {
    name: 'title_streams',
    fn: migrateTitleStreams,
    description: 'Title Streams',
  },
  {
    name: 'iptv_providers',
    fn: migrateIptvProviders,
    description: 'IPTV Providers',
  },
  {
    name: 'users',
    fn: migrateUsers,
    description: 'Users',
  },
  {
    name: 'settings',
    fn: migrateSettings,
    description: 'Settings',
  },
  {
    name: 'cache_policy',
    fn: migrateCachePolicy,
    description: 'Cache Policy',
  },
  {
    name: 'stats',
    fn: migrateStats,
    description: 'Stats',
  },
];

/**
 * Main migration function
 */
async function main() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
  const dbName = process.env.MONGODB_DB_NAME || 'playarr';
  const dataDir = process.env.DATA_DIR || './data';
  const batchSize = parseInt(process.env.BATCH_SIZE || '1000', 10);
  const dryRun = process.env.DRY_RUN === 'true';

  if (dryRun) {
    logger.info('='.repeat(60));
    logger.info('RUNNING IN DRY RUN MODE - NO DATA WILL BE WRITTEN');
    logger.info('='.repeat(60));
  }

  logger.info('Starting MongoDB migration...');
  logger.info(`MongoDB URI: ${mongoUri}`);
  logger.info(`Database: ${dbName}`);
  logger.info(`Data Directory: ${dataDir}`);
  logger.info(`Batch Size: ${batchSize}`);
  logger.info('');

  const mongoClient = new MongoClientUtil(mongoUri, dbName, logger);
  const overallStartTime = Date.now();

  try {
    // Connect to MongoDB
    await mongoClient.connect();

    // Run migrations in order
    const migrationResults = {};
    let hasErrors = false;

    for (const step of MIGRATION_STEPS) {
      logger.info(`\n${'='.repeat(60)}`);
      logger.info(`Migration Step: ${step.description}`);
      logger.info(`${'='.repeat(60)}`);

      try {
        const stepStartTime = Date.now();
        
        // Call migration function
        const result = await step.fn(mongoClient, dataDir, batchSize, dryRun, logger);
        
        const stepDuration = ((Date.now() - stepStartTime) / 1000).toFixed(2);
        migrationResults[step.name] = {
          ...result,
          duration: stepDuration,
          success: result.errors === 0,
        };

        if (result.errors > 0) {
          hasErrors = true;
          logger.warn(`Step ${step.description} completed with ${result.errors} errors`);
        } else {
          logger.success(`Step ${step.description} completed successfully in ${stepDuration}s`);
        }
      } catch (error) {
        hasErrors = true;
        logger.error(`Step ${step.description} failed: ${error.message}`);
        migrationResults[step.name] = {
          migrated: 0,
          errors: 1,
          duration: 0,
          success: false,
          error: error.message,
        };
        // Continue with next migration
      }
    }

    // Create indexes
    logger.info(`\n${'='.repeat(60)}`);
    logger.info('Creating Indexes');
    logger.info(`${'='.repeat(60)}`);
    try {
      await createIndexes();
      logger.success('Index creation completed');
    } catch (error) {
      hasErrors = true;
      logger.error(`Index creation failed: ${error.message}`);
    }

    // Run validation
    logger.info(`\n${'='.repeat(60)}`);
    logger.info('Running Validation');
    logger.info(`${'='.repeat(60)}`);
    try {
      await validateMigration();
    } catch (error) {
      hasErrors = true;
      logger.error(`Validation failed: ${error.message}`);
    }

    // Summary
    const overallDuration = ((Date.now() - overallStartTime) / 1000).toFixed(2);
    
    logger.info(`\n${'='.repeat(60)}`);
    logger.info('Migration Summary');
    logger.info(`${'='.repeat(60)}`);
    
    let totalMigrated = 0;
    let totalErrors = 0;

    for (const [stepName, result] of Object.entries(migrationResults)) {
      const step = MIGRATION_STEPS.find(s => s.name === stepName);
      const status = result.success ? '✓' : '✗';
      logger.info(`${status} ${step?.description || stepName}:`);
      logger.info(`  Migrated: ${result.migrated}`);
      logger.info(`  Errors: ${result.errors}`);
      logger.info(`  Duration: ${result.duration}s`);
      
      totalMigrated += result.migrated;
      totalErrors += result.errors;
    }

    logger.info('');
    logger.info(`Total migrated: ${totalMigrated}`);
    logger.info(`Total errors: ${totalErrors}`);
    logger.info(`Total duration: ${overallDuration}s`);

    if (hasErrors || totalErrors > 0) {
      logger.warn('\nMigration completed with errors. Please review the logs above.');
      process.exit(1);
    } else {
      logger.success('\nMigration completed successfully!');
    }

  } catch (error) {
    logger.error(`Migration failed: ${error.message}`);
    logger.error(error.stack);
    process.exit(1);
  } finally {
    await mongoClient.close();
  }
}

// Run if called directly
const isMainModule = import.meta.url === `file://${process.argv[1]}` || 
                     process.argv[1]?.includes('migrate.js') ||
                     process.argv[1]?.endsWith('migrate.js');

if (isMainModule) {
  main().catch(error => {
    logger.error(`Unhandled error: ${error.message}`);
    logger.error(error.stack);
    process.exit(1);
  });
}

export default main;

