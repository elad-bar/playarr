import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import logger
import { createLogger, loggerInstance } from './utils/logger.js';
import { LogStreamTransport } from './utils/logStreamTransport.js';
import { formatNumber } from './utils/numberFormat.js';

// Import service classes
import { WebSocketService } from './services/websocket.js';
import MetricsManager from './managers/orchestration/MetricsManager.js';
import { MongoClient } from 'mongodb';

// Import repositories
import { ProviderTitleRepository } from './repositories/ProviderTitleRepository.js';
import { TitleRepository } from './repositories/TitleRepository.js';
import { ProviderRepository } from './repositories/ProviderRepository.js';
import { JobHistoryRepository } from './repositories/JobHistoryRepository.js';
import { SettingsRepository } from './repositories/SettingsRepository.js';
import { UserRepository } from './repositories/UserRepository.js';
import { StatsRepository } from './repositories/StatsRepository.js';
import { ChannelRepository } from './repositories/ChannelRepository.js';
import { ProgramRepository } from './repositories/ProgramRepository.js';
import { ProviderCategoryRepository } from './repositories/ProviderCategoryRepository.js';
import { EngineScheduler } from './engineScheduler.js';

// Import job classes
import { SyncIPTVProviderTitlesJob } from './jobs/SyncIPTVProviderTitlesJob.js';
import { ProviderTitlesMonitorJob } from './jobs/ProviderTitlesMonitorJob.js';
import { SyncLiveTVJob } from './jobs/SyncLiveTVJob.js';
import { SyncProviderDetailsJob } from './jobs/SyncProviderDetailsJob.js';
import { CleanupUnwantedProviderTitlesJob } from './jobs/CleanupUnwantedProviderTitlesJob.js';
import { SyncProviderCategoriesJob } from './jobs/SyncProviderCategoriesJob.js';
import { UpdateMetricsJob } from './jobs/UpdateMetricsJob.js';

// Import manager classes
import { UserManager } from './managers/domain/UserManager.js';
import { TitlesManager } from './managers/domain/TitlesManager.js';
import { SettingsManager } from './managers/domain/SettingsManager.js';
import { StatsManager } from './managers/domain/StatsManager.js';
import { ProviderTitlesManager } from './managers/domain/ProviderTitlesManager.js';
import { ProviderCategoryManager } from './managers/domain/ProviderCategoryManager.js';
import { IPTVProviderManager } from './managers/domain/IPTVProviderManager.js';
import { JobHistoryManager } from './managers/domain/JobHistoryManager.js';
import { ProvidersManager } from './managers/orchestration/ProvidersManager.js';
import { PlaylistManager } from './managers/formatting/PlaylistManager.js';
import { TMDBManager } from './managers/domain/TMDBManager.js';
import { XtreamManager } from './managers/formatting/XtreamManager.js';
import { JobsManager } from './managers/orchestration/JobsManager.js';
import { StremioManager } from './managers/formatting/StremioManager.js';
import { ChannelManager } from './managers/domain/ChannelManager.js';
import { ProgramManager } from './managers/domain/ProgramManager.js';
import { LiveTVProcessingManager } from './managers/processing/LiveTVProcessingManager.js';
import { LiveTVFormattingManager } from './managers/formatting/LiveTVFormattingManager.js';
import { JobSaveCoordinatorManager } from './managers/orchestration/JobSaveCoordinatorManager.js';
import { TMDBProcessingManager } from './managers/processing/TMDBProcessingManager.js';

// Import middleware
import Middleware from './middleware/Middleware.js';
import MetricsMiddleware from './middleware/MetricsMiddleware.js';
import { AppError, JobAlreadyRunningError } from './errors/AppError.js';

// Import router classes
import AuthRouter from './routes/AuthRouter.js';
import UsersRouter from './routes/UsersRouter.js';
import ProfileRouter from './routes/ProfileRouter.js';
import SettingsRouter from './routes/SettingsRouter.js';
import StatsRouter from './routes/StatsRouter.js';
import TitlesRouter from './routes/TitlesRouter.js';
import ProvidersRouter from './routes/ProvidersRouter.js';
import StreamRouter from './routes/StreamRouter.js';
import PlaylistRouter from './routes/PlaylistRouter.js';
import TMDBRouter from './routes/TMDBRouter.js';
import HealthcheckRouter from './routes/HealthcheckRouter.js';
import XtreamRouter from './routes/XtreamRouter.js';
import JobsRouter from './routes/JobsRouter.js';
import StremioRouter from './routes/StremioRouter.js';
import LiveTVRouter from './routes/LiveTVRouter.js';
import MetricsRouter from './routes/MetricsRouter.js';
import ProviderTitlesRouter from './routes/ProviderTitlesRouter.js';
import { XtreamProvider } from './providers/XtreamProvider.js';
import { AGTVProvider } from './providers/AGTVProvider.js';
import { TMDBProvider } from './providers/TMDBProvider.js';
import { DataProvider } from './config/collections.js';

/**
 * Main Application class
 * Handles initialization, configuration, and lifecycle of the Express server
 */
class Application {
  /**
   * @param {number} port - Server port (defaults to 3000 or from env)
   */
  constructor(port = process.env.PORT || 3000) {
    this.port = port;
    this.logger = createLogger('Main');
    
    // Express app and server
    this.app = express();
    this.server = http.createServer(this.app);
    
    // Core services (initialized during setup)
    this.mongoClient = null;
    this.webSocketService = null;
    this.logStreamTransport = null;
    this.jobScheduler = null;
    this.jobsManager = null;
    this.saveCoordinator = null;
    
    // Repositories (initialized during setup)
    this.repositories = {};
    
    // Managers (initialized during setup)
    this.managers = {};
    
    // Providers (initialized during setup)
    this.providers = {};
    
    // Jobs config
    this.jobsConfig = JSON.parse(
      readFileSync(path.join(__dirname, 'jobs.json'), 'utf-8')
    );
    
    // Static path
    this.staticPath = path.join(__dirname, '../../web-ui/build');
    
    // API paths collected from routers (populated in initializeRouters)
    this.apiPaths = [];

    // Socket event handlers mapping
    this.socketHandlers = {
      'log:subscribe': this.handleLogSubscribe.bind(this),
      'log:set_level': this.handleLogSetLevel.bind(this)
    };
  }

  /**
   * Initialize the application
   */
  async initialize() {
    try {
      this.logger.info('──────────────────────────────────────────────');
      this.logger.info(`🟢 Application started at ${new Date().toISOString()}`);
      this.logger.info('──────────────────────────────────────────────');

      this.logger.debug('Initializing application...');

      this.setupMiddleware();
      await this.initializeDatabase();
      await this.initializeRepositories();
      await this.initializeManagers();
      await this.initializeProviders();
      await this.initializeSocket();
      await this.initializeProcessingManagers();
      await this.initializeJobs();
      this.setupRoutes();
      await this.start();
    } catch (error) {
      this.logger.error('Failed to initialize application:', error);
      process.exit(1);
    }
  }

  /**
   * Setup Express middleware
   */
  setupMiddleware() {
    this.app.use(cors({
      origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : true,
      credentials: true,
    }));
    this.app.use(cookieParser());
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
  }

  /**
   * Initialize MongoDB connection
   */
  async initializeDatabase() {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
    const dbName = process.env.MONGODB_DB_NAME || 'playarr';

    try {
      this.logger.debug(`Connecting to MongoDB: ${mongoUri}`);
      this.mongoClient = new MongoClient(mongoUri, {
        serverSelectionTimeoutMS: 5000,
      });
      await this.mongoClient.connect();
      this.logger.info(`Connected to MongoDB database: ${dbName}`);
    } catch (error) {
      this.logger.error(`Failed to connect to MongoDB: ${error.message}. MongoDB is required. Please ensure MongoDB is running and MONGODB_URI is configured correctly.`);
      throw new Error(`MongoDB connection failed: ${error.message}`);
    }

    // Initialize metadata collection
    await this.initializeMetadataCollection(dbName);
  }

  /**
   * Initialize metadata collection for schema versioning
   * @param {string} dbName - Database name
   */
  async initializeMetadataCollection(dbName) {
    try {
      this.logger.debug('Initializing metadata collection...');
      const metadataCollection = this.mongoClient.db(dbName).collection('_collection_metadata');
      await metadataCollection.createIndex({ _id: 1 });
      this.logger.debug('Metadata collection initialized');
    } catch (error) {
      this.logger.warn(`Error initializing metadata collection: ${error.message}`);
      // Continue - metadata collection will be created on first use
    }
  }

  /**
   * Initialize all repositories
   */
  async initializeRepositories() {
    this.repositories.providerTitle = new ProviderTitleRepository(this.mongoClient);
    this.repositories.title = new TitleRepository(this.mongoClient);
    this.repositories.provider = new ProviderRepository(this.mongoClient);
    this.repositories.jobHistory = new JobHistoryRepository(this.mongoClient);
    this.repositories.settings = new SettingsRepository(this.mongoClient);
    this.repositories.user = new UserRepository(this.mongoClient);
    this.repositories.stats = new StatsRepository(this.mongoClient);
    this.repositories.channel = new ChannelRepository(this.mongoClient);
    this.repositories.program = new ProgramRepository(this.mongoClient);
    this.repositories.providerCategory = new ProviderCategoryRepository(this.mongoClient);
    this.logger.info('All repositories created');

    // Initialize database indexes
    await this.initializeDatabaseIndexes();
  }

  /**
   * Initialize database indexes for all repositories
   */
  async initializeDatabaseIndexes() {
    this.logger.debug('Initializing database indexes...');
    try {
      const indexPromises = Object.values(this.repositories).map(repo => repo.initializeIndexes());
      
      await Promise.all(indexPromises);
      this.logger.info('All database indexes initialized');
    } catch (error) {
      this.logger.error(`Error initializing database indexes: ${error.message}`);
    }
  }

  /**
   * Initialize all managers
   */
  async initializeManagers() {
    // Domain managers
    this.managers.jobHistory = new JobHistoryManager(this.repositories.jobHistory);
    this.managers.user = new UserManager(this.repositories.user);
    this.managers.settings = new SettingsManager(this.repositories.settings);
    this.managers.stats = new StatsManager(this.repositories.stats);
    this.managers.titles = new TitlesManager(this.repositories.title);
    this.managers.providerTitles = new ProviderTitlesManager(this.repositories.providerTitle);
    this.managers.iptvProvider = new IPTVProviderManager(this.repositories.provider);
    this.managers.providerCategory = new ProviderCategoryManager(this.repositories.providerCategory);
    this.managers.channel = new ChannelManager(this.repositories.channel);
    this.managers.program = new ProgramManager(this.repositories.program);

    // Create MetricsManager after domain managers
    this.managers.metrics = new MetricsManager(
      this.managers.providerTitles,
      this.managers.titles,
      this.managers.channel,
      this.managers.user,
      this.managers.iptvProvider,
      this.managers.settings
    );
    await this.managers.metrics.initialize();

    // Initialize metrics middleware
    this.managers.metricsMiddleware = new MetricsMiddleware(this.managers.metrics);
    this.app.use(this.managers.metricsMiddleware.trackRequest);

    // Initialize user manager (creates default admin user)
    await this.managers.user.initialize();

    // Initialize main middleware
    this.managers.middleware = new Middleware(
      this.managers.user,
      this.managers.metricsMiddleware
    );
    this.logger.info('Middleware initialized');
  }

  /**
   * Initialize provider instances
   */
  async initializeProviders() {
    // Load provider configurations from database
    const allProviders = await this.repositories.provider.findByQuery({}) || [];
    this.logger.info(`Loaded ${formatNumber(allProviders.length)} provider(s) from database`);

    // Group providers by type
    const providerConfigs = this.groupProvidersByType(allProviders);

    // Get cache directory
    const cacheDir = process.env.CACHE_DIR || '/app/cache';

    // Initialize provider instances
    this.providers.xtream = new XtreamProvider(
      providerConfigs.xtream,
      cacheDir,
      this.managers.metrics
    );
    this.providers.agtv = new AGTVProvider(
      providerConfigs.agtv,
      cacheDir,
      this.managers.metrics
    );
    this.providers.tmdb = new TMDBProvider(
      this.managers.settings,
      cacheDir,
      this.managers.metrics
    );
    await this.providers.tmdb.initialize();

    // Create provider type map
    this.providers.typeMap = {
      [DataProvider.XTREAM]: this.providers.xtream,
      [DataProvider.AGTV]: this.providers.agtv
    };
  }

  /**
   * Group providers by type
   * @param {Array} allProviders - All providers from database
   * @returns {Object} Grouped provider configurations
   */
  groupProvidersByType(allProviders) {
    const configs = {
      xtream: {},
      agtv: {}
    };

    for (const provider of allProviders) {
      if (provider.deleted || ![DataProvider.AGTV, DataProvider.XTREAM].includes(provider.type)) continue;

      configs[provider.type][provider.id] = provider;
    }

    return configs;
  }

  /**
   * Initialize WebSocket service and log stream transport
   */
  async initializeSocket() {
    // Create WebSocket service with handlers (needed for ProvidersManager and log streaming)
    this.webSocketService = new WebSocketService(this.socketHandlers);

    // Create LogStreamTransport with WebSocketService (required dependency)
    this.logStreamTransport = new LogStreamTransport({
      maxLines: 100000,
      level: 'info',
      webSocketService: this.webSocketService
    });

    // Setup log stream level from settings (needed for handlers)
    await this.setupLogStreamLevel();

    // Add transport to the singleton logger instance (used by all createLogger() calls)
    // Set transport level to 'silly' (most verbose) so it receives all messages
    // The transport will filter based on its own currentLevel setting
    this.logStreamTransport.level = 'silly';
    loggerInstance.addTransport(this.logStreamTransport);
    this.logStreamTransport.clearBuffer();

    // Initialize Socket.IO server (attach to HTTP server)
    this.webSocketService.initialize(this.server);
    this.logger.info('Socket.IO server initialized');
  }

  /**
   * Initialize processing and formatting managers
   */
  async initializeProcessingManagers() {
    // Create formatting and processing managers
    this.managers.providers = new ProvidersManager(
      this.webSocketService,
      this.providers.typeMap,
      this.managers.iptvProvider,
      this.managers.providerTitles,
      this.repositories.providerTitle,
      this.repositories.title,
      this.triggerJob.bind(this),
      this.managers.channel,
      this.managers.program,
      this.managers.user,
      this.managers.providerCategory
    );

    this.managers.liveTVProcessing = new LiveTVProcessingManager(
      this.managers.channel,
      this.managers.program,
      this.managers.iptvProvider,
      this.providers.typeMap
    );

    this.managers.liveTVFormatting = new LiveTVFormattingManager(
      this.managers.titles,
      this.managers.iptvProvider,
      this.managers.channel,
      this.managers.program,
      this.managers.user,
      this.managers.metrics
    );

    this.managers.playlist = new PlaylistManager(
      this.managers.titles,
      this.managers.iptvProvider,
      this.managers.channel,
      this.managers.program,
      this.managers.metrics
    );

    this.managers.tmdb = new TMDBManager(this.providers.tmdb);
    this.managers.xtream = new XtreamManager(
      this.managers.titles,
      this.managers.iptvProvider,
      this.managers.channel,
      this.managers.program,
      this.managers.metrics
    );
    this.managers.stremio = new StremioManager(
      this.managers.titles,
      this.managers.iptvProvider,
      this.managers.channel,
      this.managers.program,
      this.managers.metrics
    );

    // Create save coordinator for jobs that need it
    this.saveCoordinator = new JobSaveCoordinatorManager(
      this.managers.providerTitles,
      this.managers.titles,
      this.triggerJob.bind(this)
    );

    // Create TMDB processing manager (singleton instance, needed by jobs)
    this.managers.tmdbProcessing = new TMDBProcessingManager(
      this.managers.titles,
      this.managers.tmdb,
      this.managers.providerTitles,
      this.saveCoordinator
    );
  }

  /**
   * Initialize jobs and scheduler
   */
  async initializeJobs() {
    // Create job instances
    const jobs = this.createJobInstances();

    // Initialize scheduler
    const jobInstances = new Map();
    jobs.forEach(job => jobInstances.set(job.jobName, job));

    this.jobScheduler = new EngineScheduler(
      jobInstances,
      this.managers.jobHistory,
      this.managers.metrics
    );
    await this.jobScheduler.initialize();

    // Initialize JobsManager
    this.jobsManager = new JobsManager(
      this.jobsConfig,
      this.managers.jobHistory,
      this.jobScheduler
    );
  }

  /**
   * Create all job instances
   * @returns {Array} Array of job instances
   */
  createJobInstances() {
    return [
      new SyncIPTVProviderTitlesJob(
        'syncIPTVProviderTitles',
        this.managers.jobHistory,
        this.saveCoordinator,
        this.managers.providers,
        this.managers.tmdbProcessing,
        this.managers.tmdb,
        this.managers.providerTitles,
        this.managers.metrics
      ),
      new ProviderTitlesMonitorJob(
        'providerTitlesMonitor',
        this.managers.jobHistory,
        this.saveCoordinator,
        this.managers.providers,
        this.managers.tmdbProcessing,
        this.managers.tmdb,
        this.managers.providerTitles,
        this.managers.metrics
      ),
      new SyncLiveTVJob(
        'syncLiveTV',
        this.managers.jobHistory,
        this.managers.iptvProvider,
        this.managers.liveTVProcessing
      ),
      new SyncProviderDetailsJob(
        'syncProviderDetails',
        this.managers.jobHistory,
        this.managers.providers,
        this.managers.metrics
      ),
      new CleanupUnwantedProviderTitlesJob(
        'cleanupUnwantedProviderTitles',
        this.managers.jobHistory,
        this.managers.providers,
        this.managers.titles,
        this.managers.providerTitles,
        this.managers.channel,
        this.managers.program,
        this.managers.user,
        this.managers.providerCategory
      ),
      new SyncProviderCategoriesJob(
        'syncProviderCategories',
        this.managers.jobHistory,
        this.managers.providers,
        this.managers.metrics,
        this.managers.providerCategory
      ),
      new UpdateMetricsJob(
        'updateMetrics',
        this.managers.jobHistory,
        this.managers.metrics
      )
    ];
  }

  /**
   * Trigger a job asynchronously
   * @param {string} jobName - Name of the job to trigger
   */
  triggerJob(jobName) {
    if (!this.jobsManager) {
      this.logger.error('JobsManager not initialized, cannot trigger job:', jobName);
      return;
    }

    // Fire job asynchronously without blocking
    setImmediate(async () => {
      try {
        await this.jobsManager.triggerJob(jobName);
        this.logger.info(`Triggered ${jobName} job`);
      } catch (error) {
        // Job already running is not an error, just a debug message
        if (error instanceof JobAlreadyRunningError) {
          this.logger.debug(`Job ${jobName} is already running, skipping trigger`);
        } else {
          this.logger.error(`Failed to trigger ${jobName} job: ${error.message}`);
        }
        // Don't throw - allow caller to continue even if job trigger fails
      }
    });
  }

  /**
   * Setup all routes
   */
  setupRoutes() {
    // Initialize routers
    this.initializeRouters();

    // Setup unmanaged endpoint logging
    this.setupUnmanagedEndpointLogging();

    // Setup static file serving
    this.setupStaticFiles();

    // Setup React Router fallback
    this.setupReactRouterFallback();

    // Setup error handling middleware
    this.setupErrorHandling();
  }

  /**
   * Initialize all routers
   */
  initializeRouters() {
    const routers = [
      new AuthRouter(this.app, this.managers.user, this.managers.middleware),
      new UsersRouter(this.app, this.managers.user, this.managers.middleware, this.managers.metrics),
      new ProfileRouter(this.app, this.managers.user, this.managers.middleware),
      new SettingsRouter(this.app, this.managers.settings, this.managers.middleware, this.logStreamTransport),
      new StatsRouter(this.app, this.managers.stats, this.managers.middleware),
      new TitlesRouter(this.app, this.managers.titles, this.managers.providers, this.managers.user, this.managers.middleware, this.managers.metrics),
      new ProvidersRouter(this.app, this.managers.providers, this.managers.middleware, this.managers.metrics, this.managers.providerCategory),
      new StreamRouter(this.app, this.managers.stremio, this.managers.middleware, this.managers.metrics),
      new PlaylistRouter(this.app, this.managers.playlist, this.managers.middleware),
      new TMDBRouter(this.app, this.managers.tmdb, this.managers.settings, this.managers.middleware),
      new HealthcheckRouter(this.app, this.managers.settings, this.managers.middleware),
      new XtreamRouter(this.app, this.managers.xtream, this.managers.middleware, this.managers.channel, this.managers.program),
      new JobsRouter(this.app, this.jobsManager, this.managers.middleware),
      new StremioRouter(this.app, this.managers.stremio, this.managers.middleware),
      new LiveTVRouter(this.app, this.managers.channel, this.managers.program, this.managers.liveTVFormatting, this.managers.user, this.managers.iptvProvider, this.managers.middleware, this.managers.metrics),
      new MetricsRouter(this.app, this.managers.middleware, this.managers.metrics),
      new ProviderTitlesRouter(this.app, this.managers.providerTitles, this.managers.tmdb, this.repositories.provider, this.managers.middleware)
    ];

    // Collect all base paths from routers
    this.apiPaths = [];
    routers.forEach(router => {
      const paths = router.getBasePath();
      this.apiPaths.push(...paths);
    });

    // Initialize all routers
    routers.forEach(router => router.initialize());
  }

  /**
   * Setup unmanaged endpoint logging middleware
   */
  setupUnmanagedEndpointLogging() {
    this.app.use(async (req, res, next) => {
      if (this.apiPaths.some(apiPath => req.path.startsWith(apiPath))) {
        try {
          const logUnmanagedResult = await this.managers.settings.getSetting('log_unmanaged_endpoints');
          const isEnabled = logUnmanagedResult.response?.value === true;

          if (isEnabled) {
            const unmanagedLogger = createLogger('UnmanagedEndpointLogger');
            unmanagedLogger.info('Unmanaged endpoint called', {
              method: req.method,
              url: req.url,
              path: req.path,
              query: req.query,
              body: req.body,
              headers: req.headers
            });
          }
        } catch (error) {
          this.logger.error('Error checking log_unmanaged_endpoints setting:', error);
        }
      }

      next();
    });
  }

  /**
   * Setup static file serving
   */
  setupStaticFiles() {
    const staticMiddleware = express.static(this.staticPath);
    this.app.use((req, res, next) => {
      if (this.apiPaths.some(apiPath => req.path.startsWith(apiPath))) {
        return next();
      }
      return staticMiddleware(req, res, next);
    });
  }

  /**
   * Setup React Router fallback
   */
  setupReactRouterFallback() {
    this.app.all('*', (req, res, next) => {
      if (this.apiPaths.some(apiPath => req.path.startsWith(apiPath))) {
        return next();
      }

      if (req.method === 'GET') {
        return res.sendFile(path.join(this.staticPath, 'index.html'));
      }

      return res.status(404).json({ error: 'Not found' });
    });
  }

  /**
   * Setup error handling middleware
   */
  setupErrorHandling() {
    this.app.use((err, req, res, next) => {
      // Track managed errors
      if (err instanceof AppError) {
        this.managers.metricsMiddleware.trackManagedError(req, err);
      }

      this.logger.error('Error:', err);
      res.status(err.status || 500).json({
        error: err.message || 'Internal server error',
      });
    });
  }

  /**
   * Setup log stream level from settings
   */
  async setupLogStreamLevel() {
    try {
      const logLevelResult = await this.managers.settings.getSetting('log_stream_level');
      let logLevel = logLevelResult.response?.value || 'info';
      if (logLevel === 'debug') {
        logLevel = 'info';
        await this.managers.settings.setSetting('log_stream_level', 'info');
        this.logger.info('Converted log_stream_level from "debug" to "info" (debug is no longer supported)');
      }
      this.logStreamTransport.setLevel(logLevel);
      this.logger.info(`Log stream level initialized to: ${logLevel}`);
    } catch (error) {
      this.logger.warn(`Failed to load log stream level from settings, using default 'info': ${error.message}`);
      this.logStreamTransport.setLevel('info');
    }
  }

  /**
   * Handle log subscription request from WebSocket client
   * @param {object} socket - Socket.IO socket instance
   */
  async handleLogSubscribe(socket) {
    try {
      const level = this.logStreamTransport.getLevel();
      const buffer = this.logStreamTransport.getLogBuffer(level);
      socket.emit('log:buffer', {
        lines: buffer,
        totalLines: buffer.length,
        level: level
      });
    } catch (error) {
      this.logger.error('Error sending log buffer:', error);
      socket.emit('log:error', { message: 'Failed to retrieve log buffer' });
    }
  }

  /**
   * Handle log level change request from WebSocket client
   * @param {object} socket - Socket.IO socket instance
   * @param {object} data - Event data containing the new log level
   */
  async handleLogSetLevel(socket, data) {
    try {
      const { level } = data;
      const availableLevels = this.logStreamTransport.getAvailableLogLevels();

      if (!availableLevels.includes(level)) {
        socket.emit('log:error', { message: `Invalid log level: ${level}. Must be one of: ${availableLevels.join(', ')}` });
        return;
      }

      this.logStreamTransport.setLevel(level);
      await this.managers.settings.setSetting('log_stream_level', level);

      const filteredBuffer = this.logStreamTransport.getLogBuffer(level);
      socket.emit('log:level_changed', {
        level,
        lines: filteredBuffer,
        totalLines: filteredBuffer.length
      });
    } catch (error) {
      this.logger.error('Error setting log level:', error);
      socket.emit('log:error', { message: `Failed to set log level: ${error.message}` });
    }
  }

  /**
   * Start the HTTP server
   */
  async start() {
    this.server.listen(this.port, async () => {
      this.logger.info(`Server running on port ${this.port}`);
      this.logger.info(`API available at http://localhost:${this.port}/api`);
      this.logger.info(`Socket.IO available at ws://localhost:${this.port}/socket.io`);

      // Start job scheduler after server is ready
      await this.jobScheduler.start();
    });
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    this.logger.info('Shutting down gracefully...');

    // Stop job scheduler
    if (this.jobScheduler) {
      await this.jobScheduler.stop();
      this.logger.info('Job scheduler stopped');
    }

    // Close HTTP server
    this.server.close(() => {
      this.logger.info('HTTP server closed');
    });

    // Close WebSocket service
    if (this.webSocketService) {
      this.webSocketService.close();
    }

    // Close MongoDB connection
    if (this.mongoClient) {
      await this.mongoClient.close();
      this.logger.info('MongoDB connection closed');
    }

    process.exit(0);
  }
}

// Create application instance
const app = new Application();

// Setup graceful shutdown handlers
process.on('SIGTERM', () => {
  app.logger.info('SIGTERM received');
  app.shutdown();
});

process.on('SIGINT', () => {
  app.logger.info('SIGINT received');
  app.shutdown();
});

// Start the application
app.initialize();
