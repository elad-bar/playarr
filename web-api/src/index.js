import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Import database
import { initializeDatabase as connectDB } from './config/database.js';

// Import services
import { userService } from './services/users.js';
import { webSocketService } from './services/websocket.js';

// Import routes
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import profileRoutes from './routes/profile.js';
import settingsRoutes from './routes/settings.js';
import statsRoutes from './routes/stats.js';
import titlesRoutes from './routes/titles.js';
import categoriesRoutes from './routes/categories.js';
import providersRoutes from './routes/providers.js';
import streamRoutes from './routes/stream.js';
import playlistRoutes from './routes/playlist.js';
import cacheRoutes from './routes/cache.js';
import tmdbRoutes from './routes/tmdb.js';
import healthcheckRoutes from './routes/healthcheck.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Create HTTP server for WebSocket support
const server = http.createServer(app);

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : true,
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Routes (must be before static file serving)
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/titles', titlesRoutes);
app.use('/api/iptv/providers', providersRoutes); // Must come before /api/iptv
app.use('/api/iptv', categoriesRoutes);
app.use('/api/stream', streamRoutes);
app.use('/api/playlist', playlistRoutes);
app.use('/api/cache', cacheRoutes);
app.use('/api/tmdb', tmdbRoutes);
app.use('/api/healthcheck', healthcheckRoutes);

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

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

// Initialize application
async function initialize() {
  try {
    console.log('Initializing application...');

    // Initialize file storage
    await connectDB();
    console.log('File storage initialized');

    // Initialize user service (creates default admin user)
    await userService.initialize();
    console.log('User service initialized');

    // Initialize WebSocket server
    webSocketService.initialize(server);
    console.log('WebSocket server initialized');

    // Start HTTP server
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`API available at http://localhost:${PORT}/api`);
      console.log(`WebSocket available at ws://localhost:${PORT}/ws`);
    });
  } catch (error) {
    console.error('Failed to initialize application:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('HTTP server closed');
    webSocketService.close();
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  server.close(() => {
    console.log('HTTP server closed');
    webSocketService.close();
    process.exit(0);
  });
});

// Start the application
initialize();

