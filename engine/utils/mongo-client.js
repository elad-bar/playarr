import { MongoClient } from 'mongodb';
import { createLogger } from './logger.js';

const logger = createLogger('MongoClient');

/**
 * MongoDB client utility for engine
 * Handles connection, database access, and cleanup
 */
class MongoClientUtil {
  /**
   * @param {string} uri - MongoDB connection URI
   * @param {string} dbName - Database name
   */
  constructor(uri, dbName) {
    this.uri = uri;
    this.dbName = dbName;
    this.client = null;
    this.db = null;
  }

  /**
   * Connect to MongoDB
   * @returns {Promise<void>}
   * @throws {Error} If connection fails
   */
  async connect() {
    try {
      logger.info(`Connecting to MongoDB: ${this.uri}`);
      this.client = new MongoClient(this.uri, {
        serverSelectionTimeoutMS: 5000,
      });

      await this.client.connect();
      this.db = this.client.db(this.dbName);
      logger.info(`Connected to MongoDB database: ${this.dbName}`);
    } catch (error) {
      logger.error(`Failed to connect to MongoDB: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get database instance
   * @returns {import('mongodb').Db}
   * @throws {Error} If not connected
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
        logger.info('MongoDB connection closed');
      } catch (error) {
        logger.error(`Error closing MongoDB connection: ${error.message}`);
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

