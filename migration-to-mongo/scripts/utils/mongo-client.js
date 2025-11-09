import { MongoClient } from 'mongodb';
import Logger from './logger.js';

/**
 * MongoDB client utility for migration scripts
 * Handles connection, database access, and cleanup
 */
class MongoClientUtil {
  constructor(uri, dbName, logger = new Logger()) {
    this.uri = uri;
    this.dbName = dbName;
    this.logger = logger;
    this.client = null;
    this.db = null;
  }

  /**
   * Connect to MongoDB
   * @returns {Promise<void>}
   */
  async connect() {
    try {
      this.logger.info(`Connecting to MongoDB: ${this.uri}`);
      this.client = new MongoClient(this.uri, {
        serverSelectionTimeoutMS: 5000,
      });

      await this.client.connect();
      this.db = this.client.db(this.dbName);
      this.logger.success(`Connected to MongoDB database: ${this.dbName}`);
    } catch (error) {
      this.logger.error(`Failed to connect to MongoDB: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get database instance
   * @returns {import('mongodb').Db}
   */
  getDatabase() {
    if (!this.db) {
      throw new Error('Not connected to MongoDB. Call connect() first.');
    }
    return this.db;
  }

  /**
   * Get collection
   * @param {string} collectionName - Collection name
   * @returns {import('mongodb').Collection}
   */
  getCollection(collectionName) {
    return this.getDatabase().collection(collectionName);
  }

  /**
   * Close MongoDB connection
   * @returns {Promise<void>}
   */
  async close() {
    if (this.client) {
      try {
        await this.client.close();
        this.logger.info('MongoDB connection closed');
      } catch (error) {
        this.logger.error(`Error closing MongoDB connection: ${error.message}`);
      }
    }
  }

  /**
   * Check if connected
   * @returns {boolean}
   */
  isConnected() {
    return this.client !== null && this.db !== null;
  }
}

export default MongoClientUtil;

