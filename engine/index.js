import dotenv from "dotenv";
import path from "path";
import fsExtra from "fs-extra";
import { fileURLToPath } from "url";
import { createLogger } from "./utils/logger.js";
import { EngineServer } from "./engineServer.js";
import { ApplicationContext } from "./context/ApplicationContext.js";
import { EngineScheduler } from "./engineScheduler.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, "../cache");

// Rotate log file on startup - rename previous log to engine-previous.log
const logsDir = process.env.LOGS_DIR || path.join(__dirname, "../logs");
const engineLogPath = path.join(logsDir, "engine.log");

// Ensure log directory exists
if (!fsExtra.existsSync(logsDir)) {
  fsExtra.mkdirSync(logsDir);
}

// If a previous log exists, rename it with a timestamp
if (fsExtra.existsSync(engineLogPath)) {
  const stats = fsExtra.statSync(engineLogPath);
  const createdAt = stats.birthtime; // file creation time
  const timestamp = createdAt
    .toISOString()
    .replace(/[:.]/g, '-') // make it filename-safe
    .replace('T', '_')
    .replace('Z', '');
  const archivedLog = path.join(logsDir, `engine_${timestamp}.log`);
  fsExtra.renameSync(engineLogPath, archivedLog);
}

const logger = createLogger("Main");

/**
 * Main application entry point
 * Initializes and runs both the job scheduler and HTTP server
 */
async function main() {
  logger.info("Starting Playarr Engine...");

  try {
    // Initialize ApplicationContext (MongoDB, Cache, TMDBProvider, IPTV Providers)
    await ApplicationContext.initialize(CACHE_DIR);
    const context = ApplicationContext.getInstance();
    const mongoData = context.getMongoData();

    // Create and initialize EngineScheduler
    const engineScheduler = new EngineScheduler(mongoData);
    await engineScheduler.initialize();

    // Get JobsManager instance
    const jobsManager = engineScheduler.getJobsManager();

    // Create and start HTTP server for job control API
    const engineServer = new EngineServer(engineScheduler, jobsManager);
    await engineServer.start();
    logger.info("Engine HTTP API server is ready");

    // Graceful shutdown handler
    const shutdown = async (signal) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);

      if (engineServer && engineServer._server) {
        engineServer._server.close(() => {
          logger.info("HTTP server closed");
        });
      }

      await engineScheduler.stop();
      process.exit(0);
    };

    // Keep the process running
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  } catch (error) {
    logger.error(`Error starting engine: ${error.message}`);
    logger.error(error.stack);
    process.exit(1);
  }
}

main();
