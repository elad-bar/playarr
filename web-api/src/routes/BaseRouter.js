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
   * @param {import('express').Application} app - Express app instance
   * @param {import('../middleware/Middleware.js').default} middleware - Middleware instance
   * @param {string} className - Name of the extending class (used for logger)
   */
  constructor(app, middleware, className) {
    this.app = app;
    this.middleware = middleware;
    this.router = express.Router();
    this.logger = createLogger(className);
  }

  /**
   * Initialize routes for this router and automatically register them with the app
   * Template method: calls setupRoutes() (implemented by subclasses) then registers routes
   */
  initialize() {
    this.setupRoutes();
    this.registerRoutes();
  }

  /**
   * Set up routes for this router
   * Must be implemented by extending classes
   * @abstract
   */
  setupRoutes() {
    throw new Error('setupRoutes() must be implemented by extending class');
  }

  /**
   * Get the base path(s) for this router
   * Must be implemented by extending classes
   * @abstract
   * @returns {string[]} Base path(s) for this router (always returns an array)
   */
  getBasePath() {
    throw new Error('getBasePath() must be implemented by extending class');
  }

  /**
   * Register this router to the app at the specified base path(s)
   * Called automatically by initialize()
   */
  registerRoutes() {
    const paths = this.getBasePath();
    paths.forEach(path => {
      this.app.use(path, this.router);
      this.logger.debug(`Registered routes at ${path}`);
    });
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

