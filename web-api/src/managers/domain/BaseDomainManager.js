import { BaseManager } from '../BaseManager.js';

/**
 * Base class for all Domain Managers (Type A)
 * Provides common functionality: repository reference and bulk upsert operations
 * One domain = one repository per manager
 * @abstract
 */
export class BaseDomainManager extends BaseManager {
  /**
   * @param {string} managerName - Name identifier for this manager (used in logging)
   * @param {import('../../repositories/BaseRepository.js').BaseRepository} repository - Repository instance for this domain
   */
  constructor(managerName, repository) {
    super(managerName);
    
    if (!repository) {
      throw new Error('Repository is required for BaseDomainManager');
    }
    
    this._repository = repository; // One domain = one repository
  }

  /**
   * Perform bulk upsert operation (insert if not exists, update if exists)
   * This is a domain-level operation that combines insert and update logic
   * @param {Array<Object>} documents - Array of documents to upsert
   * @param {Object} [options={}] - Upsert options
   * @param {string|Array<string>} [options.matchFields] - Field(s) to match on for upsert (default: ['_id'])
   * @param {boolean} [options.setTimestamps=true] - Whether to set createdAt/lastUpdated timestamps
   * @returns {Promise<{inserted: number, updated: number}>} Upsert result
   */
  async bulkUpsert(documents, options = {}) {
    const {
      matchFields = ['_id'],
      setTimestamps = true
    } = options;

    if (!Array.isArray(documents) || documents.length === 0) {
      return { inserted: 0, updated: 0 };
    }

    const now = new Date();
    const matchFieldsArray = Array.isArray(matchFields) ? matchFields : [matchFields];

    // Prepare documents with timestamps if needed
    const documentsWithTimestamps = documents.map(doc => {
      const docCopy = { ...doc };
      if (setTimestamps) {
        if (!docCopy.createdAt) {
          docCopy.createdAt = now;
        }
        docCopy.lastUpdated = now;
      }
      return docCopy;
    });

    // Check which documents already exist
    const existingDocs = await this._checkExistenceForUpsert(documentsWithTimestamps, matchFieldsArray);

    // Separate into inserts and updates
    const { inserts, updates } = this._separateInsertsAndUpdatesForUpsert(
      documentsWithTimestamps,
      existingDocs,
      matchFieldsArray
    );

    // Execute bulk operations
    return await this._executeBulkUpsert(inserts, updates, matchFieldsArray);
  }

  /**
   * Check which documents already exist in the repository
   * @private
   * @param {Array<Object>} documents - Documents to check
   * @param {Array<string>} matchFields - Fields to match on
   * @returns {Promise<Array<Object>>} Array of existing documents
   */
  async _checkExistenceForUpsert(documents, matchFields) {
    if (documents.length === 0) {
      return [];
    }

    // Batch size to prevent BSON document size limit (16MB) from being exceeded
    // Each document in the $or array can be ~100-200 bytes, so ~50k documents = ~10MB
    // Use 10k to be safe and leave room for Date serialization overhead
    const BATCH_SIZE = 10000;
    const allExistingDocs = [];

    // Process in batches to avoid BSON document size limit
    for (let i = 0; i < documents.length; i += BATCH_SIZE) {
      const batch = documents.slice(i, i + BATCH_SIZE);
      
      // Build query to find existing documents for this batch
      const query = { $or: [] };
      
      for (const doc of batch) {
        const matchQuery = {};
        let hasMatchFields = false;
        
        for (const field of matchFields) {
          if (doc[field] !== undefined && doc[field] !== null) {
            matchQuery[field] = doc[field];
            hasMatchFields = true;
          }
        }
        
        if (hasMatchFields) {
          query.$or.push(matchQuery);
        }
      }

      if (query.$or.length > 0) {
        // Query repository for existing documents in this batch
        const batchExisting = await this._repository.findByQuery(query);
        allExistingDocs.push(...batchExisting);
      }
    }

    return allExistingDocs;
  }

  /**
   * Separate documents into inserts and updates based on existing documents
   * @private
   * @param {Array<Object>} documents - Documents to separate
   * @param {Array<Object>} existingDocs - Existing documents from repository
   * @param {Array<string>} matchFields - Fields to match on
   * @returns {{inserts: Array<Object>, updates: Array<Object>}} Separated documents
   */
  _separateInsertsAndUpdatesForUpsert(documents, existingDocs, matchFields) {
    const inserts = [];
    const updates = [];
    const insertKeys = new Set(); // Track insert keys to prevent duplicates

    // Create a map of existing documents for quick lookup
    const existingMap = new Map();
    for (const existing of existingDocs) {
      const key = this._buildMatchKey(existing, matchFields);
      if (key) {
        existingMap.set(key, existing);
      }
    }

    // Separate documents
    for (const doc of documents) {
      const key = this._buildMatchKey(doc, matchFields);
      if (key && existingMap.has(key)) {
        // Document exists, prepare for update
        const existing = existingMap.get(key);
        updates.push({
          filter: this._buildFilterFromDoc(existing, matchFields),
          update: doc
        });
      } else if (key && !insertKeys.has(key)) {
        // Document doesn't exist and we haven't seen this key in inserts yet
        insertKeys.add(key);
        inserts.push(doc);
      }
      // If key is null or we've already added this key to inserts, skip it
    }

    return { inserts, updates };
  }

  /**
   * Build a match key from a document and match fields
   * @private
   * @param {Object} doc - Document
   * @param {Array<string>} matchFields - Fields to match on
   * @returns {string|null} Match key or null if no valid match fields
   */
  _buildMatchKey(doc, matchFields) {
    const keyParts = [];
    for (const field of matchFields) {
      if (doc[field] !== undefined && doc[field] !== null) {
        keyParts.push(`${field}:${String(doc[field])}`);
      }
    }
    return keyParts.length > 0 ? keyParts.join('|') : null;
  }

  /**
   * Build a filter object from a document and match fields
   * @private
   * @param {Object} doc - Document
   * @param {Array<string>} matchFields - Fields to match on
   * @returns {Object} Filter object
   */
  _buildFilterFromDoc(doc, matchFields) {
    const filter = {};
    for (const field of matchFields) {
      if (doc[field] !== undefined && doc[field] !== null) {
        filter[field] = doc[field];
      }
    }
    return filter;
  }

  /**
   * Execute bulk upsert operations
   * @private
   * @param {Array<Object>} inserts - Documents to insert
   * @param {Array<{filter: Object, update: Object}>} updates - Documents to update
   * @param {Array<string>} matchFields - Fields to match on
   * @returns {Promise<{inserted: number, updated: number}>} Upsert result
   */
  async _executeBulkUpsert(inserts, updates, matchFields) {
    let insertedCount = 0;
    let updatedCount = 0;

    // Perform inserts
    if (inserts.length > 0) {
      try {
        await this._repository.insertMany(inserts);
        insertedCount = inserts.length;
      } catch (error) {
        this.logger.error('Error inserting documents in bulkUpsert:', error);
        throw error;
      }
    }

    // Perform updates
    if (updates.length > 0) {
      const bulkOps = updates.map(({ filter, update }) => ({
        updateOne: {
          filter,
          update: { $set: update }
        }
      }));

      try {
        const result = await this._repository.bulkWrite(bulkOps);
        updatedCount = result.modifiedCount || 0;
        
        // Log warning if documents weren't modified as expected
        if (updatedCount === 0 && updates.length > 0) {
          this.logger.warn(`bulkUpsert: 0 documents modified out of ${updates.length} update operations. Check for write errors or documents with no changes.`);
        } else if (updatedCount < updates.length) {
          this.logger.warn(`bulkUpsert: Only ${updatedCount} documents modified out of ${updates.length} update operations (${updates.length - updatedCount} unchanged).`);
        }
      } catch (error) {
        this.logger.error('Error updating documents in bulkUpsert:', error);
        throw error;
      }
    }

    return {
      inserted: insertedCount,
      updated: updatedCount
    };
  }
}

