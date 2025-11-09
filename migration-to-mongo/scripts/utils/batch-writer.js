import Logger from './logger.js';
import { ensureTimestamps } from './transformers.js';

/**
 * Batch writing utilities for MongoDB operations
 * Handles batch inserts and upserts with progress reporting
 */
class BatchWriter {
  constructor(collection, logger = new Logger(), dryRun = false) {
    this.collection = collection;
    this.logger = logger;
    this.dryRun = dryRun;
  }

  /**
   * Insert documents in batches
   * @param {Array<Object>} documents - Documents to insert
   * @param {number} batchSize - Batch size (default: 1000)
   * @returns {Promise<{inserted: number, errors: number, errorDetails: Array}>}
   */
  async batchInsert(documents, batchSize = 1000) {
    if (this.dryRun) {
      this.logger.info(`[DRY RUN] Would insert ${documents.length} documents`);
      return { inserted: documents.length, errors: 0, errorDetails: [] };
    }

    if (!documents || documents.length === 0) {
      return { inserted: 0, errors: 0, errorDetails: [] };
    }

    let inserted = 0;
    let errors = 0;
    const errorDetails = [];

    // Ensure all documents have timestamps
    const processedDocs = documents.map(doc => ensureTimestamps({ ...doc }));

    // Process in batches
    for (let i = 0; i < processedDocs.length; i += batchSize) {
      const batch = processedDocs.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(processedDocs.length / batchSize);

      try {
        const result = await this.collection.insertMany(batch, { ordered: false });
        inserted += result.insertedCount;
        this.logger.debug(
          `Batch ${batchNum}/${totalBatches}: Inserted ${result.insertedCount}/${batch.length} documents`
        );
      } catch (error) {
        // Handle partial batch failures
        if (error.writeErrors) {
          const successful = batch.length - error.writeErrors.length;
          inserted += successful;
          errors += error.writeErrors.length;
          
          error.writeErrors.forEach(writeError => {
            errorDetails.push({
              index: i + writeError.index,
              error: writeError.errmsg,
            });
          });
          
          this.logger.warn(
            `Batch ${batchNum}/${totalBatches}: Inserted ${successful}/${batch.length}, ${error.writeErrors.length} errors`
          );
        } else {
          errors += batch.length;
          this.logger.error(`Batch ${batchNum}/${totalBatches} failed: ${error.message}`);
          errorDetails.push({
            batch: batchNum,
            error: error.message,
          });
        }
      }

      // Progress reporting for large batches
      if (processedDocs.length > batchSize * 10) {
        const progress = ((i + batch.length) / processedDocs.length * 100).toFixed(1);
        this.logger.info(`Progress: ${progress}% (${i + batch.length}/${processedDocs.length})`);
      }
    }

    return { inserted, errors, errorDetails };
  }

  /**
   * Upsert documents in batches
   * @param {Array<Object>} documents - Documents to upsert
   * @param {string|Array<string>} filterFields - Field(s) to use for matching (for upsert filter)
   * @param {number} batchSize - Batch size (default: 1000)
   * @returns {Promise<{upserted: number, modified: number, errors: number, errorDetails: Array}>}
   */
  async batchUpsert(documents, filterFields, batchSize = 1000) {
    if (this.dryRun) {
      this.logger.info(`[DRY RUN] Would upsert ${documents.length} documents`);
      return { upserted: documents.length, modified: 0, errors: 0, errorDetails: [] };
    }

    if (!documents || documents.length === 0) {
      return { upserted: 0, modified: 0, errors: 0, errorDetails: [] };
    }

    let upserted = 0;
    let modified = 0;
    let errors = 0;
    const errorDetails = [];

    // Ensure all documents have timestamps
    const processedDocs = documents.map(doc => ensureTimestamps({ ...doc }));

    // Normalize filterFields to array
    const filterFieldsArray = Array.isArray(filterFields) ? filterFields : [filterFields];

    // Process in batches
    for (let i = 0; i < processedDocs.length; i += batchSize) {
      const batch = processedDocs.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(processedDocs.length / batchSize);

      const operations = batch.map(doc => {
        // Build filter from filterFields
        const filter = {};
        for (const field of filterFieldsArray) {
          if (doc[field] !== undefined && doc[field] !== null) {
            filter[field] = doc[field];
          }
        }

        return {
          updateOne: {
            filter,
            update: { $set: doc },
            upsert: true,
          },
        };
      });

      try {
        const result = await this.collection.bulkWrite(operations, { ordered: false });
        upserted += result.upsertedCount;
        modified += result.modifiedCount;
        this.logger.debug(
          `Batch ${batchNum}/${totalBatches}: Upserted ${result.upsertedCount}, Modified ${result.modifiedCount}/${batch.length} documents`
        );
      } catch (error) {
        errors += batch.length;
        this.logger.error(`Batch ${batchNum}/${totalBatches} failed: ${error.message}`);
        errorDetails.push({
          batch: batchNum,
          error: error.message,
        });
      }

      // Progress reporting for large batches
      if (processedDocs.length > batchSize * 10) {
        const progress = ((i + batch.length) / processedDocs.length * 100).toFixed(1);
        this.logger.info(`Progress: ${progress}% (${i + batch.length}/${processedDocs.length})`);
      }
    }

    return { upserted, modified, errors, errorDetails };
  }

  /**
   * Insert or replace a single document (for single-document collections)
   * @param {Object} document - Document to insert/replace
   * @param {Object} filter - Filter for finding existing document
   * @returns {Promise<{upserted: boolean, modified: boolean}>}
   */
  async upsertOne(document, filter = {}) {
    if (this.dryRun) {
      this.logger.info(`[DRY RUN] Would upsert single document`);
      return { upserted: true, modified: false };
    }

    const processedDoc = ensureTimestamps({ ...document });

    try {
      const result = await this.collection.replaceOne(filter, processedDoc, { upsert: true });
      return {
        upserted: result.upsertedCount > 0,
        modified: result.modifiedCount > 0,
      };
    } catch (error) {
      this.logger.error(`Failed to upsert document: ${error.message}`);
      throw error;
    }
  }
}

export default BatchWriter;

