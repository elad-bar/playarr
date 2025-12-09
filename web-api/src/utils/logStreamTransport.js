import winston from 'winston';

/**
 * Winston log level hierarchy (simplified to 3 levels)
 */
const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2
};

/**
 * Custom Winston transport that streams logs via WebSocket
 * Maintains a circular buffer of the last 1000 log lines
 * Supports dynamic log level filtering
 */
class LogStreamTransport extends winston.Transport {
  constructor(options = {}) {
    super(options);
    this.maxLines = options.maxLines || 1000;
    this.logBuffer = [];
    
    if (!options.webSocketService) {
      throw new Error('webSocketService is required for LogStreamTransport');
    }
    this.webSocketService = options.webSocketService;
    this.currentLevel = options.level || 'info'; // Default to 'info'
  }

  /**
   * Set the log level for filtering
   * @param {string} level - Log level (error, warn, info, debug)
   */
  setLevel(level) {
    if (!LOG_LEVELS.hasOwnProperty(level)) {
      console.warn(`[LogStreamTransport] Invalid log level: ${level}. Using 'info' instead.`);
      this.currentLevel = 'info';
      return;
    }
    this.currentLevel = level;
    console.log(`[LogStreamTransport] Log stream level changed to: ${level}`);
    
    // Notify connected clients about level change
    if (this.webSocketService) {
      this.webSocketService.broadcastEvent('log:level_changed', {
        level: this.currentLevel
      }, 'default');
    }
  }

  /**
   * Get current log level
   * @returns {string} Current log level
   */
  getLevel() {
    return this.currentLevel;
  }

  /**
   * Get available log levels
   * @returns {Array<string>} Array of available log levels
   */
  getAvailableLogLevels() {
    return ['error', 'warn', 'info'];
  }

  /**
   * Check if a log level should be included based on current filter
   * @param {string} level - Log level to check
   * @returns {boolean} True if level should be included
   */
  shouldIncludeLevel(level) {
    // Map Winston's internal levels to our simplified levels
    const levelMap = {
      error: 'error',
      warn: 'warn',
      info: 'info',
      http: 'info',  // Map http to info
      verbose: 'info', // Map verbose to info (max level)
      debug: 'info', // Map debug to info (max level)
      silly: 'info'  // Map silly to info (max level)
    };
    
    const mappedLevel = levelMap[level] || 'info';
    const levelNum = LOG_LEVELS[mappedLevel] ?? LOG_LEVELS.info;
    const currentLevelNum = LOG_LEVELS[this.currentLevel] ?? LOG_LEVELS.info;
    return levelNum <= currentLevelNum;
  }

  /**
   * Get current log buffer (last 1000 lines), optionally filtered by level
   * @param {string} [filterLevel] - Optional level to filter by (defaults to currentLevel)
   * @returns {Array<string>} Array of log lines
   */
  getLogBuffer(filterLevel = null) {
    const level = filterLevel || this.currentLevel;
    const levelNum = LOG_LEVELS[level] ?? LOG_LEVELS.info;
    
    // Filter buffer by level
    return this.logBuffer.filter(line => {
      // Extract level from log line (format: timestamp [context] LEVEL: message)
      const upperLine = line.toUpperCase();
      let lineLevel = null;
      
      if (upperLine.includes('ERROR:')) {
        lineLevel = 'error';
      } else if (upperLine.includes('WARN:')) {
        lineLevel = 'warn';
      } else if (upperLine.includes('INFO:')) {
        lineLevel = 'info';
      } else if (upperLine.includes('DEBUG:')) {
        // Map DEBUG to info level (info is the maximum)
        lineLevel = 'info';
      } else {
        // If we can't determine level, include it (shouldn't happen)
        return true;
      }
      
      const lineLevelNum = LOG_LEVELS[lineLevel] ?? LOG_LEVELS.info;
      return lineLevelNum <= levelNum;
    });
  }

  /**
   * Clear the log buffer (called on startup)
   */
  clearBuffer() {
    this.logBuffer = [];
  }

  log(info, callback) {
    const { timestamp, level, message, context, ...metadata } = info;
    
    // Format the log message
    const contextStr = context ? `[${context}]` : '';
    let logLine = `${timestamp} ${contextStr} ${level.toUpperCase()}: ${message}`;
    
    // Include metadata if present
    const metadataKeys = Object.keys(metadata).filter(key => 
      !['splat', 'Symbol(level)', 'Symbol(message)', 'Symbol(splat)'].includes(key)
    );
    if (metadataKeys.length > 0) {
      const cleanMetadata = {};
      metadataKeys.forEach(key => {
        cleanMetadata[key] = metadata[key];
      });
      logLine += `\n${JSON.stringify(cleanMetadata, null, 2)}`;
    }

    // Add to buffer (circular, max 1000 lines) - store ALL logs regardless of filter level
    this.logBuffer.push(logLine);
    if (this.logBuffer.length > this.maxLines) {
      this.logBuffer.shift(); // Remove oldest line
    }

    // Only emit via WebSocket if log passes current filter level
    if (this.shouldIncludeLevel(level) && this.webSocketService) {
      this.webSocketService.broadcastEvent('log:message', {
        line: logLine,
        timestamp: timestamp,
        level: level,
        context: context,
        totalLines: this.logBuffer.length
      }, 'default');
    }

    // Call callback to indicate we processed the log
    if (callback) {
      callback(null, true);
    }
  }
}

export { LogStreamTransport, LOG_LEVELS };

