import { Server } from 'socket.io';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('WebSocketService');

/**
 * WebSocket service for real-time updates using Socket.IO
 * Provides compatibility with socket.io-client in the UI
 */
class WebSocketService {
  constructor() {
    this._io = null;
    this._apiNamespace = null;
  }

  /**
   * Initialize Socket.IO server
   * @param {object} server - HTTP server instance from Express
   */
  initialize(server) {
    if (this._io) {
      logger.warn('Socket.IO server already initialized');
      return;
    }

    // Initialize Socket.IO server
    this._io = new Server(server, {
      path: '/socket.io',
      cors: {
        origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : true,
        credentials: true,
      },
      transports: ['websocket', 'polling'],
      pingTimeout: 60000,
      pingInterval: 25000,
    });

    // Default namespace handlers
    this._io.on('connection', (socket) => {
      logger.info('Socket.IO client connected to default namespace');
      this._handleConnection(this._io, socket);
    });

    // API namespace handlers
    this._apiNamespace = this._io.of('/api');
    this._apiNamespace.on('connection', (socket) => {
      logger.info('Socket.IO client connected to API namespace');
      this._handleConnection(this._apiNamespace, socket);
    });

    logger.info('Socket.IO server initialized on /socket.io');
    logger.info('API namespace available at /socket.io/api');
  }

  /**
   * Handle new Socket.IO connection
   * @param {object} namespace - Socket.IO namespace (default or /api)
   * @param {object} socket - Socket.IO socket instance
   */
  _handleConnection(namespace, socket) {
    // Handle disconnect
    socket.on('disconnect', (reason) => {
      logger.info(`Socket.IO client disconnected: ${reason}`);
    });

    // Handle errors
    socket.on('error', (error) => {
      logger.error('Socket.IO error:', error);
    });

    // Handle ping/pong (Socket.IO handles this internally, but we can add custom handlers)
    socket.on('ping', () => {
      socket.emit('pong');
    });
  }

  /**
   * Broadcast an event to all connected Socket.IO clients
   * @param {string} event - Event name
   * @param {object} data - Event data
   * @param {string} namespace - Optional namespace ('default' or 'api'), defaults to both
   */
  broadcastEvent(event, data, namespace = null) {
    if (!this._io) {
      logger.warn('Socket.IO server not initialized');
      return;
    }

    const message = { ...data };

    if (namespace === 'api') {
      // Send to API namespace only
      if (this._apiNamespace) {
        this._apiNamespace.emit(event, message);
        logger.debug(`Broadcasted event '${event}' to API namespace`);
      }
    } else if (namespace === 'default') {
      // Send to default namespace only
      this._io.emit(event, message);
      logger.debug(`Broadcasted event '${event}' to default namespace`);
    } else {
      // Send to both namespaces
      this._io.emit(event, message);
      if (this._apiNamespace) {
        this._apiNamespace.emit(event, message);
      }
      logger.debug(`Broadcasted event '${event}' to all namespaces`);
    }
  }

  /**
   * Close Socket.IO server
   */
  close() {
    if (this._io) {
      this._io.close(() => {
        logger.info('Socket.IO server closed');
      });
      this._io = null;
      this._apiNamespace = null;
    }
  }

  /**
   * Get number of connected clients
   */
  getConnectionCount() {
    if (!this._io) {
      return 0;
    }

    const defaultCount = this._io.sockets.sockets.size;
    const apiCount = this._apiNamespace ? this._apiNamespace.sockets.sockets.size : 0;
    return defaultCount + apiCount;
  }
}

// Export class only
export { WebSocketService };

