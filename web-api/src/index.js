import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import dotenv from 'dotenv';
import fsExtra from 'fs-extra';

// Load environment variables
dotenv.config();

// Rotate log file on startup using the log file's creation date (before logger is created)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import logger
import { createLogger } from './utils/logger.js';

// Import service classes
import { WebSocketService } from './services/websocket.js';
import { MongoClient } from 'mongodb';

// Import repositories
import { ProviderTitleRepository } from './repositories/ProviderTitleRepository.js';
import { TitleStreamRepository } from './repositories/TitleStreamRepository.js';
import { TitleRepository } from './repositories/TitleRepository.js';
import { ProviderRepository } from './repositories/ProviderRepository.js';
import { JobHistoryRepository } from './repositories/JobHistoryRepository.js';
import { SettingsRepository } from './repositories/SettingsRepository.js';
import { UserRepository } from './repositories/UserRepository.js';
import { StatsRepository } from './repositories/StatsRepository.js';
import { EngineScheduler } from './engineScheduler.js';
import { readFileSync } from 'fs';
const jobsConfig = JSON.parse(readFileSync(path.join(__dirname, 'jobs.json'), 'utf-8'));

// Import job classes
import { SyncIPTVProviderTitlesJob } from './jobs/SyncIPTVProviderTitlesJob.js';
import { ProviderTitlesMonitorJob } from './jobs/ProviderTitlesMonitorJob.js';

// Import manager classes
import { UserManager } from './managers/users.js';
import { TitlesManager } from './managers/titles.js';
import { SettingsManager } from './managers/settings.js';
import { StatsManager } from './managers/stats.js';
import { ProvidersManager } from './managers/providers.js';
import { StreamManager } from './managers/stream.js';
import { PlaylistManager } from './managers/playlist.js';
import { TMDBManager } from './managers/tmdb.js';
import { XtreamManager } from './managers/xtream.js';
import { JobsManager } from './managers/jobs.js';

// Import middleware
import Middleware from './middleware/Middleware.js';

// Import router classes
import AuthRouter from './routes/auth.js';
import UsersRouter from './routes/users.js';
import ProfileRouter from './routes/profile.js';
import SettingsRouter from './routes/settings.js';
import StatsRouter from './routes/stats.js';
import TitlesRouter from './routes/titles.js';
import ProvidersRouter from './routes/providers.js';
import StreamRouter from './routes/stream.js';
import PlaylistRouter from './routes/playlist.js';
import TMDBRouter from './routes/tmdb.js';
import HealthcheckRouter from './routes/healthcheck.js';
import XtreamRouter from './routes/xtream.js';
import JobsRouter from './routes/jobs.js';
import { XtreamProvider } from './providers/XtreamProvider.js';
import { AGTVProvider } from './providers/AGTVProvider.js';
import { TMDBProvider } from './providers/TMDBProvider.js';
import { DataProvider } from './config/collections.js';

const app = express();
const PORT = process.env.PORT || 3000;
const logger = createLogger('Main');

// Create HTTP server for WebSocket support
const server = http.createServer(app);

// Module-level variables for graceful shutdown
let webSocketService = null;
let mongoClient = null;
let jobScheduler = null;

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : true,
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

// Initialize application
async function initialize() {
  try {
    logger.info('Initializing application...');

    // Step 1: Initialize services (bottom-up)
    // 1. Initialize MongoDB connection
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
    const dbName = process.env.MONGODB_DB_NAME || 'playarr';
    
    try {
      logger.info(`Connecting to MongoDB: ${mongoUri}`);
      mongoClient = new MongoClient(mongoUri, {
        serverSelectionTimeoutMS: 5000,
      });
      await mongoClient.connect();
      logger.info(`Connected to MongoDB database: ${dbName}`);
    } catch (error) {
      logger.error(`Failed to connect to MongoDB: ${error.message}`);
      logger.error('MongoDB is required. Please ensure MongoDB is running and MONGODB_URI is configured correctly.');
      throw new Error(`MongoDB connection failed: ${error.message}`);
    }

    // 2. Create all repository instances
    const providerTitleRepo = new ProviderTitleRepository(mongoClient);
    const titleStreamRepo = new TitleStreamRepository(mongoClient);
    const titleRepo = new TitleRepository(mongoClient);
    const providerRepo = new ProviderRepository(mongoClient);
    const jobHistoryRepo = new JobHistoryRepository(mongoClient);
    const settingsRepo = new SettingsRepository(mongoClient);
    const userRepo = new UserRepository(mongoClient);
    const statsRepo = new StatsRepository(mongoClient);
    logger.info('All repositories created');

    // 2.1. Initialize database indexes for all repositories
    logger.info('Initializing database indexes...');
    try {
      await Promise.all([
        titleRepo.initializeIndexes(),
        providerTitleRepo.initializeIndexes(),
        titleStreamRepo.initializeIndexes(),
        userRepo.initializeIndexes(),
        providerRepo.initializeIndexes(),
        jobHistoryRepo.initializeIndexes(),
        settingsRepo.initializeIndexes(),
        // statsRepo doesn't need indexes (single document collection)
        // cachePolicyRepo is skipped (will be removed)
      ]);
      logger.info('All database indexes initialized');
    } catch (error) {
      logger.error(`Error initializing database indexes: ${error.message}`);
      // Don't throw - allow app to start even if index creation fails
      // Indexes will be created on next startup or can be created manually
    }

    webSocketService = new WebSocketService();

    // Get cache directory for providers
    const cacheDir = process.env.CACHE_DIR || '/app/cache';

    // Load all provider configurations from database
    const allProviders = await providerRepo.findByQuery({}) || [];
    logger.info(`Loaded ${allProviders.length} provider(s) from database`);

    // Group providers by type for each provider type
    const xtreamConfigs = {};
    const agtvConfigs = {};
    
    for (const provider of allProviders) {
      if (provider.deleted) continue; // Skip deleted providers
      
      if (provider.type === DataProvider.XTREAM) {
        xtreamConfigs[provider.id] = provider;
      } else if (provider.type === DataProvider.AGTV) {
        agtvConfigs[provider.id] = provider;
      }
    }

    // Initialize provider instances with their configs (singletons)
    const xtreamProvider = new XtreamProvider(xtreamConfigs, cacheDir);
    const agtvProvider = new AGTVProvider(agtvConfigs, cacheDir);
    const providerTypeMap = {
      [DataProvider.XTREAM]: xtreamProvider,
      [DataProvider.AGTV]: agtvProvider
    };

    // Step 2: Initialize managers (dependency order)
    const userManager = new UserManager(userRepo);
    const settingsManager = new SettingsManager(settingsRepo);
    
    // Load TMDB API key from settings and initialize TMDB provider
    const tmdbTokenKey = 'tmdb_token';
    let tmdbApiKey = null;
    try {
      const apiKeyResult = await settingsManager.getSetting(tmdbTokenKey);
      if (apiKeyResult.statusCode === 200 && apiKeyResult.response.value) {
        tmdbApiKey = apiKeyResult.response.value;
      }
    } catch (error) {
      logger.warn('Could not load TMDB API key on startup:', error.message);
    }
    const tmdbProvider = new TMDBProvider(tmdbApiKey, cacheDir);
    const statsManager = new StatsManager(statsRepo);
    const titlesManager = new TitlesManager(userManager, titleRepo, providerRepo);
    
    // Declare jobsManager early for closure
    let jobsManager;
    
    // Create generic triggerJob function (closure will capture jobsManager when assigned)
    const triggerJob = async (jobName) => {
      if (!jobsManager) {
        throw new Error('JobsManager not initialized');
      }
      await jobsManager.triggerJob(jobName);
    };
    
    const providersManager = new ProvidersManager(
      webSocketService,
      titlesManager,
      providerTypeMap,
      providerTitleRepo,
      titleStreamRepo,
      titleRepo,
      providerRepo,
      triggerJob
    );
    const streamManager = new StreamManager(titleStreamRepo, providerRepo);
    const playlistManager = new PlaylistManager(titleRepo);
    const tmdbManager = new TMDBManager(settingsManager, tmdbProvider);
    const xtreamManager = new XtreamManager(titlesManager);
    
    // Create job instances with all dependencies
    const jobInstances = new Map();
    jobInstances.set('syncIPTVProviderTitles', new SyncIPTVProviderTitlesJob(
      'syncIPTVProviderTitles',
      providerRepo,
      providerTitleRepo,
      titleRepo,
      titleStreamRepo,
      jobHistoryRepo,
      providersManager,
      tmdbManager,
      tmdbProvider
    ));
    jobInstances.set('providerTitlesMonitor', new ProviderTitlesMonitorJob(
      'providerTitlesMonitor',
      providerRepo,
      providerTitleRepo,
      titleRepo,
      titleStreamRepo,
      jobHistoryRepo,
      providersManager,
      tmdbManager,
      tmdbProvider
    ));
    
    // Initialize EngineScheduler with job instances
    jobScheduler = new EngineScheduler(jobInstances, jobHistoryRepo);
    await jobScheduler.initialize();
    logger.info('Job scheduler initialized and started');
    
    // Initialize JobsManager
    jobsManager = new JobsManager(jobsConfig, jobScheduler, jobHistoryRepo);

    // Initialize user manager (creates default admin user)
    await userManager.initialize();
    logger.info('User manager initialized');

    // Step 3: Initialize middleware (after UserManager is initialized)
    const middleware = new Middleware(userManager);
    logger.info('Middleware initialized');

    // Step 4: Initialize routers (with dependencies)
    const authRouter = new AuthRouter(userManager, middleware);
    const usersRouter = new UsersRouter(userManager, middleware);
    const profileRouter = new ProfileRouter(userManager, middleware);
    const settingsRouter = new SettingsRouter(settingsManager, middleware);
    const statsRouter = new StatsRouter(statsManager, middleware);
    const titlesRouter = new TitlesRouter(titlesManager, middleware);
    const providersRouter = new ProvidersRouter(providersManager, middleware);
    const streamRouter = new StreamRouter(streamManager, middleware);
    const playlistRouter = new PlaylistRouter(playlistManager, middleware);
    const tmdbRouter = new TMDBRouter(tmdbManager, middleware);
    const healthcheckRouter = new HealthcheckRouter(settingsManager, middleware);
    const xtreamRouter = new XtreamRouter(xtreamManager, streamManager, middleware);
    const jobsRouter = new JobsRouter(jobsManager, middleware);

    // Initialize all routers
    authRouter.initialize();
    usersRouter.initialize();
    profileRouter.initialize();
    settingsRouter.initialize();
    statsRouter.initialize();
    titlesRouter.initialize();
    providersRouter.initialize();
    streamRouter.initialize();
    playlistRouter.initialize();
    tmdbRouter.initialize();
    healthcheckRouter.initialize();
    xtreamRouter.initialize();
    jobsRouter.initialize();

    // Step 5: Register routes
    app.use('/api/auth', authRouter.router);
    app.use('/api/users', usersRouter.router);
    app.use('/api/profile', profileRouter.router);
    app.use('/api/settings', settingsRouter.router);
    app.use('/api/stats', statsRouter.router);
    app.use('/api/titles', titlesRouter.router);
    app.use('/api/jobs', jobsRouter.router);
    app.use('/api/iptv/providers', providersRouter.router);
    app.use('/api/stream', streamRouter.router);
    app.use('/api/playlist', playlistRouter.router);
    app.use('/api/tmdb', tmdbRouter.router);
    app.use('/api/healthcheck', healthcheckRouter.router);
    app.use('/player_api.php', xtreamRouter.router); // Xtream Code API at specific path
    
    // Add direct stream routes (Xtream Code API standard format)
    // These must come before the React Router fallback
    app.use('/movie', xtreamRouter.router);
    app.use('/series', xtreamRouter.router);

    // Static file serving for React app
    // Serve static files from React build directory
    const staticPath = path.join(__dirname, '../../web-ui/build');
    app.use(express.static(staticPath));

    // React Router fallback - serve index.html for non-API routes
    app.get('*', (req, res) => {
      // Don't serve index.html for API routes or stream routes
      if (req.path.startsWith('/api') || 
          req.path.startsWith('/movie') || 
          req.path.startsWith('/series') ||
          req.path.startsWith('/player_api.php')) {
        return res.status(404).json({ error: 'Not found' });
      }
      
      // Serve React app for all other routes
      res.sendFile(path.join(staticPath, 'index.html'));
    });

    // Initialize Socket.IO server
    webSocketService.initialize(server);
    logger.info('Socket.IO server initialized');

    // Start HTTP server
    server.listen(PORT, async () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`API available at http://localhost:${PORT}/api`);
      logger.info(`Socket.IO available at ws://localhost:${PORT}/socket.io`);
    });
  } catch (error) {
    logger.error('Failed to initialize application:', error);
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown() {
  logger.info('Shutting down gracefully...');
  
  // Stop job scheduler
  if (jobScheduler) {
    await jobScheduler.stop();
    logger.info('Job scheduler stopped');
  }
  
  // Close HTTP server
  server.close(() => {
    logger.info('HTTP server closed');
  });
  
  // Close WebSocket service
  if (webSocketService) {
    webSocketService.close();
  }
  
  // Close MongoDB connection
  if (mongoClient) {
    await mongoClient.close();
    logger.info('MongoDB connection closed');
  }
  
  process.exit(0);
}

process.on('SIGTERM', () => {
  logger.info('SIGTERM received');
  shutdown();
});

process.on('SIGINT', () => {
  logger.info('SIGINT received');
  shutdown();
});

// Start the application
initialize();
