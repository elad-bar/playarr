import { WebSocketServer } from 'ws';

/**
 * WebSocket service for real-time updates
 * Matches Python's WebSocket implementation in API manager
 */
class WebSocketService {
  constructor() {
    this._connections = new Set();
    this._wss = null;
  }

  /**
   * Initialize WebSocket server
   * @param {object} server - HTTP server instance from Express
   */
  initialize(server) {
    if (this._wss) {
      console.warn('WebSocket server already initialized');
      return;
    }

    this._wss = new WebSocketServer({ server, path: '/ws' });

    this._wss.on('connection', (ws, req) => {
      this._handleConnection(ws, req);
    });

    console.log('WebSocket server initialized on /ws');
  }

  /**
   * Handle new WebSocket connection
   */
  _handleConnection(ws, req) {
    console.log('WebSocket client connected');

    // Add connection to set
    this._connections.add(ws);

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      message: 'WebSocket connection established',
    }));

    // Handle messages
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        console.log('Received WebSocket message:', data);

        // Handle ping/pong
        if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (error) {
        console.error('Error handling WebSocket message:', error);
      }
    });

    // Handle connection close
    ws.on('close', () => {
      console.log('WebSocket client disconnected');
      this._connections.delete(ws);
    });

    // Handle errors
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      this._connections.delete(ws);
    });
  }

  /**
   * Broadcast an event to all connected WebSocket clients
   * Matches Python's broadcast_event()
   * @param {string} event - Event name
   * @param {object} data - Event data
   */
  broadcastEvent(event, data) {
    if (this._connections.size === 0) {
      return;
    }

    const message = JSON.stringify({
      type: event,
      data,
    });

    // Send to all connected clients
    const disconnected = [];
    for (const ws of this._connections) {
      try {
        if (ws.readyState === ws.OPEN) {
          ws.send(message);
        } else {
          disconnected.push(ws);
        }
      } catch (error) {
        console.error('Error sending WebSocket message:', error);
        disconnected.push(ws);
      }
    }

    // Remove disconnected clients
    for (const ws of disconnected) {
      this._connections.delete(ws);
    }
  }

  /**
   * Close WebSocket server
   */
  close() {
    if (this._wss) {
      // Close all connections
      for (const ws of this._connections) {
        try {
          ws.close();
        } catch (error) {
          console.error('Error closing WebSocket connection:', error);
        }
      }
      this._connections.clear();

      // Close server
      this._wss.close(() => {
        console.log('WebSocket server closed');
      });
      this._wss = null;
    }
  }

  /**
   * Get number of connected clients
   */
  getConnectionCount() {
    return this._connections.size;
  }
}

// Export singleton instance
export const webSocketService = new WebSocketService();

