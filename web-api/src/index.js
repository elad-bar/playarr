import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Import logger
import { createLogger } from './utils/logger.js';

// Import service classes
import { CacheService } from './services/cache.js';
import { MongoDatabaseService } from './services/mongodb-database.js';
import { WebSocketService } from './services/websocket.js';
import { MongoClient } from 'mongodb';

// Import manager classes
import { UserManager } from './managers/users.js';
import { TitlesManager } from './managers/titles.js';
import { SettingsManager } from './managers/settings.js';
import { StatsManager } from './managers/stats.js';
import { ProvidersManager } from './managers/providers.js';
import { CategoriesManager } from './managers/categories.js';
import { StreamManager } from './managers/stream.js';
import { PlaylistManager } from './managers/playlist.js';
import { TMDBManager } from './managers/tmdb.js';
import { XtreamManager } from './managers/xtream.js';

// Import router classes
import AuthRouter from './routes/auth.js';
import UsersRouter from './routes/users.js';
import ProfileRouter from './routes/profile.js';
import SettingsRouter from './routes/settings.js';
import StatsRouter from './routes/stats.js';
import TitlesRouter from './routes/titles.js';
import CategoriesRouter from './routes/categories.js';
import ProvidersRouter from './routes/providers.js';
import StreamRouter from './routes/stream.js';
import PlaylistRouter from './routes/playlist.js';
import CacheRouter from './routes/cache.js';
import TMDBRouter from './routes/tmdb.js';
import HealthcheckRouter from './routes/healthcheck.js';
import XtreamRouter from './routes/xtream.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const logger = createLogger('Main');

// Create HTTP server for WebSocket support
const server = http.createServer(app);

// Module-level variables for graceful shutdown
let webSocketService = null;
let mongoClient = null;
let database = null;

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
    // 1. Create CacheService (no dependencies)
    const cacheService = new CacheService();

    // 2. Initialize MongoDB connection
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

    // 3. Create MongoDatabaseService (replaces FileStorageService + DatabaseService)
    database = new MongoDatabaseService(mongoClient, dbName, cacheService);
    await database.initialize();
    logger.info('MongoDB database service initialized');

    webSocketService = new WebSocketService();

    // Step 2: Initialize managers (dependency order)
    const userManager = new UserManager(database);
    const titlesManager = new TitlesManager(database, userManager);
    const settingsManager = new SettingsManager(database);
    const statsManager = new StatsManager(database);
    const providersManager = new ProvidersManager(database, webSocketService, titlesManager);
    const categoriesManager = new CategoriesManager(database, providersManager);
    const streamManager = new StreamManager(database);
    const playlistManager = new PlaylistManager(database);
    const tmdbManager = new TMDBManager(settingsManager);
    const xtreamManager = new XtreamManager(database, titlesManager);

    // Initialize user manager (creates default admin user)
    await userManager.initialize();
    logger.info('User manager initialized');

    // Step 3: Initialize routers (with dependencies)
    const authRouter = new AuthRouter(userManager, database);
    const usersRouter = new UsersRouter(userManager, database);
    const profileRouter = new ProfileRouter(userManager, database);
    const settingsRouter = new SettingsRouter(settingsManager, database);
    const statsRouter = new StatsRouter(statsManager, database);
    const titlesRouter = new TitlesRouter(titlesManager, database);
    const categoriesRouter = new CategoriesRouter(categoriesManager, database);
    const providersRouter = new ProvidersRouter(providersManager, database);
    const streamRouter = new StreamRouter(streamManager, database);
    const playlistRouter = new PlaylistRouter(playlistManager, database);
    const cacheRouter = new CacheRouter(cacheService, titlesManager, statsManager, categoriesManager, database);
    const tmdbRouter = new TMDBRouter(tmdbManager, database);
    const healthcheckRouter = new HealthcheckRouter(database, settingsManager);
    const xtreamRouter = new XtreamRouter(xtreamManager, database, streamManager);

    // Step 4: Register routes
    app.use('/api/auth', authRouter.router);
    app.use('/api/users', usersRouter.router);
    app.use('/api/profile', profileRouter.router);
    app.use('/api/settings', settingsRouter.router);
    app.use('/api/stats', statsRouter.router);
    app.use('/api/titles', titlesRouter.router);
    app.use('/api/iptv/providers', providersRouter.router); // Must come before /api/iptv
    app.use('/api/iptv', categoriesRouter.router);
    app.use('/api/stream', streamRouter.router);
    app.use('/api/playlist', playlistRouter.router);
    app.use('/api/cache', cacheRouter.router);
    app.use('/api/tmdb', tmdbRouter.router);
    app.use('/api/healthcheck', healthcheckRouter.router);
    app.use('/player_api.php', xtreamRouter.router); // Xtream Code API at specific path

    // Static file serving for React app
    // Serve static files from React build directory
    const staticPath = path.join(__dirname, '../../web-ui/build');
    app.use(express.static(staticPath));

    // React Router fallback - serve index.html for non-API routes
    app.get('*', (req, res) => {
      // Don't serve index.html for API routes
      if (req.path.startsWith('/api')) {
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
  
  // Set stopping flag on database
  if (database) {
    database.setStopping(true);
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
