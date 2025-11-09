/**
 * Simple logger utility for migration scripts
 * Supports log levels: debug, info, warn, error
 */

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  gray: '\x1b[90m',
};

class Logger {
  constructor(level = 'info') {
    this.level = LOG_LEVELS[level] || LOG_LEVELS.info;
  }

  /**
   * Log debug message
   * @param {string} message - Message to log
   * @param {...any} args - Additional arguments
   */
  debug(message, ...args) {
    if (this.level <= LOG_LEVELS.debug) {
      console.log(`${COLORS.gray}[DEBUG]${COLORS.reset} ${message}`, ...args);
    }
  }

  /**
   * Log info message
   * @param {string} message - Message to log
   * @param {...any} args - Additional arguments
   */
  info(message, ...args) {
    if (this.level <= LOG_LEVELS.info) {
      console.log(`${COLORS.blue}[INFO]${COLORS.reset} ${message}`, ...args);
    }
  }

  /**
   * Log warning message
   * @param {string} message - Message to log
   * @param {...any} args - Additional arguments
   */
  warn(message, ...args) {
    if (this.level <= LOG_LEVELS.warn) {
      console.log(`${COLORS.yellow}[WARN]${COLORS.reset} ${message}`, ...args);
    }
  }

  /**
   * Log error message
   * @param {string} message - Message to log
   * @param {...any} args - Additional arguments
   */
  error(message, ...args) {
    if (this.level <= LOG_LEVELS.error) {
      console.error(`${COLORS.red}[ERROR]${COLORS.reset} ${message}`, ...args);
    }
  }

  /**
   * Log success message
   * @param {string} message - Message to log
   * @param {...any} args - Additional arguments
   */
  success(message, ...args) {
    if (this.level <= LOG_LEVELS.info) {
      console.log(`${COLORS.green}[SUCCESS]${COLORS.reset} ${message}`, ...args);
    }
  }
}

export default Logger;

