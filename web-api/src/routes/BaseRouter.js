import express from 'express';
import { createLogger } from '../utils/logger.js';
import { AppError } from '../errors/AppError.js';

/**
 * Base router class that standardizes route initialization and middleware
 * All route classes should extend this base class
 * 
 * @abstract
 */
class BaseRouter {
  /**
   * @param {import('../middleware/Middleware.js').default} middleware - Middleware instance
   * @param {string} className - Name of the extending class (used for logger)
   */
  constructor(middleware, className) {
    this.middleware = middleware;
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

  /**
   * Handle errors from managers and map them to HTTP status codes
   * Catches AppError instances and maps them to appropriate HTTP responses
   * 
   * @param {import('express').Response} res - Express response object
   * @param {Error} error - Error thrown by manager
   * @param {string} [defaultMessage='Internal server error'] - Default error message if error is not an AppError
   * @returns {import('express').Response} Express response object
   */
  handleError(res, error, defaultMessage = 'Internal server error') {
    if (error instanceof AppError) {
      this.logger.error(`${error.name}: ${error.message}`);
      return res.status(error.statusCode).json({ error: error.message });
    }
    
    // Unknown error - log and return 500
    this.logger.error(`Unexpected error: ${error.message}`, error);
    return res.status(500).json({ error: defaultMessage });
  }
}

export default BaseRouter;

