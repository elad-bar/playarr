import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logsDir = process.env.LOGS_DIR || path.join(__dirname, '../../../logs');
const apiLogPath = path.join(logsDir, 'api.log');

fs.ensureDirSync(logsDir);

if (fs.existsSync(apiLogPath)) {
  fs.truncateSync(apiLogPath, 0);
}

/**
 * Logger class that manages all logging functionality
 */
export class Logger {
  constructor() {
    this.loggerCache = new Map();
    this.baseLogger = this._createBaseLogger();
  }

  _createBaseLogger() {
    const baseFormat = winston.format.combine(
      winston.format.timestamp(),
      winston.format.printf((info) => {
        const { timestamp, level, message, context, ...metadata } = info;
        const contextStr = context ? `[${context}]` : '';
        let output = `${timestamp} ${contextStr} ${level.toUpperCase()}: ${message}`;
        
        const metadataKeys = Object.keys(metadata).filter(key => 
          !['splat', 'Symbol(level)', 'Symbol(message)', 'Symbol(splat)'].includes(key)
        );
        if (metadataKeys.length > 0) {
          const cleanMetadata = {};
          metadataKeys.forEach(key => {
            cleanMetadata[key] = metadata[key];
          });
          output += `\n${JSON.stringify(cleanMetadata, null, 2)}`;
        }
        
        return output;
      })
    );

    return winston.createLogger({
      format: baseFormat,
      transports: [
        new winston.transports.Console({
          level: 'info',
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.printf((info) => {
              const { timestamp, level, message, context, ...metadata } = info;
              const contextStr = context ? `[${context}]` : '';
              let output = `${timestamp} ${contextStr} ${level}: ${message}`;
              
              const metadataKeys = Object.keys(metadata).filter(key => 
                !['splat', 'Symbol(level)', 'Symbol(message)', 'Symbol(splat)'].includes(key)
              );
              if (metadataKeys.length > 0) {
                const cleanMetadata = {};
                metadataKeys.forEach(key => {
                  cleanMetadata[key] = metadata[key];
                });
                output += `\n${JSON.stringify(cleanMetadata, null, 2)}`;
              }
              
              return output;
            })
          )
        }),
        new winston.transports.File({
          level: 'debug',
          filename: apiLogPath,
          maxsize: 10485760,
          maxFiles: 5,
          tailable: true
        })
      ]
    });
  }

  /**
   * Create a logger instance for a specific context
   * @param {string} context - Context name for the logger
   * @returns {winston.Logger} Winston logger instance
   */
  createLogger(context) {
    if (!this.loggerCache.has(context)) {
      const child = this.baseLogger.child({ context });
      this.loggerCache.set(context, child);
    }
    return this.loggerCache.get(context);
  }

  /**
   * Add a transport to the logger
   * @param {winston.Transport} transport - Transport instance to add
   */
  addTransport(transport) {
    this.baseLogger.add(transport);
  }
}

// Export singleton instance for backward compatibility
const loggerInstance = new Logger();
export const createLogger = (context) => loggerInstance.createLogger(context);
