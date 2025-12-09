import { Server } from 'socket.io';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('WebSocketService');

// Maximum number of messages to buffer before server initialization
const MAX_BUFFER_SIZE = 10000;

/**
 * WebSocket service for real-time updates using Socket.IO
 * Provides compatibility with socket.io-client in the UI
 */
class WebSocketService {
  /**
   * @param {object} handlers - Map of event names to handler functions (e.g., { 'log:subscribe': handlerFn })
   */
  constructor(handlers) {
    this._io = null;
    this._apiNamespace = null;
    this._handlers = handlers;
    // Message buffer for events broadcast before server initialization
    this._messageBuffer = [];
    this._isInitialized = false;
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
      logger.debug('Socket.IO client connected to default namespace');
      this._handleConnection(this._io, socket);
    });

    // API namespace handlers
    this._apiNamespace = this._io.of('/api');
    this._apiNamespace.on('connection', (socket) => {
      logger.debug('Socket.IO client connected to API namespace');
      this._handleConnection(this._apiNamespace, socket);
    });

    logger.info('Socket.IO server initialized on /socket.io');
    logger.info('API namespace available at /socket.io/api');

    // Mark as initialized and flush buffered messages
    this._isInitialized = true;
    this._flushBuffer();
  }

  /**
   * Flush buffered messages to Socket.IO server
   * @private
   */
  _flushBuffer() {
    if (!this._isInitialized || this._messageBuffer.length === 0) {
      return;
    }

    const messageCount = this._messageBuffer.length;
    logger.info(`Flushing ${messageCount} buffered message(s) to Socket.IO clients`);

    // Send all buffered messages
    for (const { event, data, namespace } of this._messageBuffer) {
      this._sendEvent(event, data, namespace);
    }

    // Clear buffer after flushing
    this._messageBuffer = [];
    logger.debug('Message buffer cleared');
  }

  /**
   * Send event to Socket.IO server (internal method, assumes server is initialized)
   * @private
   * @param {string} event - Event name
   * @param {object} data - Event data
   * @param {string|null} namespace - Optional namespace ('default' or 'api'), defaults to both
   */
  _sendEvent(event, data, namespace = null) {
    const message = { ...data };

    if (namespace === 'api') {
      // Send to API namespace only
      if (this._apiNamespace) {
        this._apiNamespace.emit(event, message);
      }
    } else if (namespace === 'default') {
      // Send to default namespace only
      this._io.emit(event, message);
    } else {
      // Send to both namespaces
      this._io.emit(event, message);
      if (this._apiNamespace) {
        this._apiNamespace.emit(event, message);
      }
    }
  }

  /**
   * Add message to buffer (FIFO, with max size limit)
   * @private
   * @param {string} event - Event name
   * @param {object} data - Event data
   * @param {string|null} namespace - Optional namespace
   */
  _addToBuffer(event, data, namespace) {
    // If buffer is at max size, remove oldest message (FIFO)
    if (this._messageBuffer.length >= MAX_BUFFER_SIZE) {
      const removed = this._messageBuffer.shift();
      logger.debug(`Buffer full (${MAX_BUFFER_SIZE}), dropped oldest message: ${removed.event}`);
    }

    // Add new message to end of buffer
    this._messageBuffer.push({ event, data, namespace });
    
    if (this._messageBuffer.length % 1000 === 0) {
      logger.debug(`Message buffer size: ${this._messageBuffer.length}/${MAX_BUFFER_SIZE}`);
    }
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

    // Register custom event handlers if provided
    if (this._handlers && Object.keys(this._handlers).length > 0) {
      for (const [event, handler] of Object.entries(this._handlers)) {
        socket.on(event, handler.bind(null, socket));
      }
      logger.debug(`Registered ${Object.keys(this._handlers).length} custom event handler(s)`);
    }
  }

  /**
   * Get the default namespace Socket.IO instance
   * @returns {object|null} Socket.IO instance or null if not initialized
   */
  getDefaultNamespace() {
    return this._io;
  }

  /**
   * Broadcast an event to all connected Socket.IO clients
   * If server is not initialized, message is buffered and sent once server is ready
   * @param {string} event - Event name
   * @param {object} data - Event data
   * @param {string} namespace - Optional namespace ('default' or 'api'), defaults to both
   */
  broadcastEvent(event, data, namespace = null) {
    if (!this._isInitialized || !this._io) {
      // Server not initialized, buffer the message
      this._addToBuffer(event, data, namespace);
      return;
    }

    // Server is initialized, send immediately
    this._sendEvent(event, data, namespace);
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
      this._handlers = null;
      this._isInitialized = false;
      this._messageBuffer = [];
    }
  }

}

// Export class only
export { WebSocketService };

