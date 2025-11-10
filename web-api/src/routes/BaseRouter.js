import express from 'express';
import { createRequireAuth } from '../middleware/auth.js';
import { createRequireAdmin } from '../middleware/admin.js';
import { createRequireApiKey } from '../middleware/apiKey.js';
import { createLogger } from '../utils/logger.js';

/**
 * Base router class that standardizes route initialization and middleware
 * All route classes should extend this base class
 * 
 * @abstract
 */
class BaseRouter {
  /**
   * @param {DatabaseService} database - Database service instance
   * @param {string} className - Name of the extending class (used for logger)
   */
  constructor(database, className) {
    this._database = database;
    this._requireAuth = createRequireAuth(database);
    this._requireAdmin = createRequireAdmin(this._requireAuth);
    this._requireApiKey = createRequireApiKey(database);
    this.router = express.Router();
    this.logger = createLogger(className);
  }

  /**
   * Initialize routes for this router
   * Must be implemented by extending classes
   * Should be called explicitly after router instantiation
   * @abstract
   */
  initialize() {
    throw new Error('initialize() must be implemented by extending class');
  }

  /**
   * Standardized error response handler
   * Logs the error message and returns a JSON error response with the specified status code
   * 
   * @param {import('express').Response} res - Express response object
   * @param {number} statusCode - HTTP status code (e.g., 400, 401, 403, 404, 500)
   * @param {string} errorMessage - Error message to return in JSON response to consumer
   * @param {string} [logMessage] - Optional detailed log message. If not provided, uses errorMessage for logging
   * @returns {import('express').Response} Express response object
   */
  returnErrorResponse(res, statusCode, errorMessage, logMessage = null) {
    const messageToLog = logMessage || errorMessage;
    this.logger.error(messageToLog);
    return res.status(statusCode).json({ error: errorMessage });
  }
}

export default BaseRouter;

