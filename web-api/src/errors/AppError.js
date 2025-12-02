/**
 * Base error class for application errors
 * All custom errors should extend this class
 */
export class AppError extends Error {
  /**
   * @param {string} message - Error message
   * @param {number} [statusCode=500] - HTTP status code (for reference, not used by managers)
   */
  constructor(message, statusCode = 500) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Error thrown when a resource is not found
 * Maps to HTTP 404
 */
export class NotFoundError extends AppError {
  /**
   * @param {string} [message='Resource not found'] - Error message
   */
  constructor(message = 'Resource not found') {
    super(message, 404);
  }
}

/**
 * Error thrown when validation fails
 * Maps to HTTP 400
 */
export class ValidationError extends AppError {
  /**
   * @param {string} [message='Validation failed'] - Error message
   */
  constructor(message = 'Validation failed') {
    super(message, 400);
  }
}

/**
 * Error thrown when a resource conflict occurs (e.g., duplicate entry)
 * Maps to HTTP 409
 */
export class ConflictError extends AppError {
  /**
   * @param {string} [message='Resource conflict'] - Error message
   */
  constructor(message = 'Resource conflict') {
    super(message, 409);
  }
}

/**
 * Error thrown when access is forbidden
 * Maps to HTTP 403
 */
export class ForbiddenError extends AppError {
  /**
   * @param {string} [message='Access forbidden'] - Error message
   */
  constructor(message = 'Access forbidden') {
    super(message, 403);
  }
}

/**
 * Error thrown when a job is not found
 * Maps to HTTP 404
 */
export class JobNotFoundError extends AppError {
  /**
   * @param {string} [message='Job not found'] - Error message
   */
  constructor(message = 'Job not found') {
    super(message, 404);
  }
}

/**
 * Error thrown when a job is already running
 * Maps to HTTP 409
 */
export class JobAlreadyRunningError extends AppError {
  /**
   * @param {string} [message='Job is already running'] - Error message
   */
  constructor(message = 'Job is already running') {
    super(message, 409);
  }
}

/**
 * Error thrown when job scheduler is unavailable
 * Maps to HTTP 503
 */
export class JobSchedulerUnavailableError extends AppError {
  /**
   * @param {string} [message='Job scheduler is unavailable'] - Error message
   */
  constructor(message = 'Job scheduler is unavailable') {
    super(message, 503);
  }
}

