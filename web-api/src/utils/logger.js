import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure logs directory exists
// Path: from web-api/src/utils/ to root: ../../../logs
const logsDir = process.env.LOGS_DIR || path.join(__dirname, '../../../logs');
const apiLogPath = path.join(logsDir, 'api.log');

// Ensure log directory exists
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// If a previous log exists, rename it with a timestamp
if (fs.existsSync(apiLogPath)) {
  const stats = fs.statSync(apiLogPath);
  const createdAt = stats.birthtime; // file creation time
  const timestamp = createdAt
    .toISOString()
    .replace(/[:.]/g, '-') // make it filename-safe
    .replace('T', '_')
    .replace('Z', '');
  const archivedLog = path.join(logsDir, `api_${timestamp}.log`);
  fs.renameSync(apiLogPath, archivedLog);
}

/**
 * Create logger instance with formatted output to console and file
 * @param {string} context - Context/component name (e.g., 'UserService', 'ProvidersService')
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
        filename: apiLogPath,
        format: logFormat,
        maxsize: 10485760, // 10MB
        maxFiles: 5 // Keep last 5 files
      })
    ]
  });
}
