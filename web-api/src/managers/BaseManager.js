import { createLogger } from '../utils/logger.js';

/**
 * Base class for all managers in the web API
 * Provides common functionality: database and logger
 * @abstract
 */
export class BaseManager {
  /**
   * @param {string} managerName - Name identifier for this manager (used in logging)
   * @param {import('../services/database.js').DatabaseService} database - Database service instance
   */
  constructor(managerName, database) {
    if (this.constructor === BaseManager) {
      throw new Error('BaseManager is an abstract class and cannot be instantiated directly');
    }

    if (!managerName) {
      throw new Error('Manager name is required');
    }

    if (!database) {
      throw new Error('Database service is required');
    }

    this.managerName = managerName;
    this._database = database;
    this.logger = createLogger(managerName);
  }
}

