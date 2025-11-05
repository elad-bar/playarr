import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure logs directory exists
const logsDir = path.join(__dirname, '../../logs');
fs.ensureDirSync(logsDir);

/**
 * Create logger instance with formatted output to console and file
 * @param {string} context - Context/component name (e.g., providerId, 'ProcessProvidersTitlesJob')
 * @returns {winston.Logger} Winston logger instance
 */
export function createLogger(context) {
  const logFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      const contextStr = context ? `[${context}]` : '';
      return `${timestamp} ${contextStr} ${level.toUpperCase()}: ${message}`;
    })
  );

  return winston.createLogger({
    format: logFormat,
    transports: [
      // Console transport with colors - info level and above
      new winston.transports.Console({
        level: 'info',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, ...meta }) => {
            const contextStr = context ? `[${context}]` : '';
            return `${timestamp} ${contextStr} ${level}: ${message}`;
          })
        )
      }),
      // File transport - debug level and above (more verbose)
      new winston.transports.File({
        level: 'debug',
        filename: path.join(logsDir, 'app.log'),
        format: logFormat,
        maxsize: 10485760, // 10MB
        maxFiles: 5 // Keep last 5 files
      })
    ]
  });
}

