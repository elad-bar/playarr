import BaseRouter from './BaseRouter.js';
import os from 'os';
import checkDiskSpace from 'check-disk-space';

// Track server start time for uptime calculation
const START_TIME = Date.now() / 1000; // Unix timestamp in seconds

/**
 * Healthcheck router for handling health check endpoints
 */
class HealthcheckRouter extends BaseRouter {
  /**
   * @param {SettingsManager} settingsManager - Settings manager instance
   * @param {import('../middleware/Middleware.js').default} middleware - Middleware instance
   */
  constructor(settingsManager, middleware) {
    super(middleware, 'HealthcheckRouter');
    this._settingsManager = settingsManager;
  }

  /**
   * Initialize routes for this router
   */
  initialize() {
    /**
     * GET /api/healthcheck
     * System health check endpoint matching Python's healthcheck format
     */
    this.router.get('/', async (req, res) => {
      try {
        // Check MongoDB connectivity
        let dbStatus = false;
        let dbMessage = 'Not connected';
        try {
          // Test MongoDB connection using SettingsManager
          await this._settingsManager.testConnection();
          dbStatus = true;
          dbMessage = 'Connected';
        } catch (error) {
          dbMessage = error.message || 'Connection failed';
        }

        // Check TMDB service - check if tmdb_token exists in settings
        let tmdbStatus = false;
        let tmdbMessage = 'Not configured';
        try {
          const tmdbResult = await this._settingsManager.getSetting('tmdb_token');
          if (tmdbResult.statusCode === 200 && tmdbResult.response.value) {
            tmdbStatus = true;
            tmdbMessage = 'Configured';
          }
        } catch (error) {
          tmdbMessage = error.message || 'Check failed';
        }

        // Get system metrics using Node.js os module
        const totalMemory = os.totalmem();
        const freeMemory = os.freemem();
        const usedMemory = totalMemory - freeMemory;
        const memoryPercent = (usedMemory / totalMemory) * 100;

        // Get disk usage using check-disk-space package
        let diskTotal = 0;
        let diskFree = 0;
        let diskUsed = 0;
        let diskPercent = 0;
        try {
          // On Windows, use C:\ or root path
          const diskInfo = await checkDiskSpace(process.platform === 'win32' ? 'C:\\' : '/');
          diskTotal = diskInfo.size;
          diskFree = diskInfo.free;
          diskUsed = diskTotal - diskFree;
          diskPercent = (diskUsed / diskTotal) * 100;
        } catch (error) {
          this.logger.warn('Failed to get disk usage:', error);
          // Fallback to memory values if disk check fails
          diskTotal = totalMemory;
          diskFree = freeMemory;
          diskUsed = usedMemory;
          diskPercent = memoryPercent;
        }

        // Calculate uptime
        const uptimeSeconds = Math.floor(Date.now() / 1000 - START_TIME);
        const uptimeDays = Math.floor(uptimeSeconds / 86400);
        const uptimeHours = Math.floor((uptimeSeconds % 86400) / 3600);
        const uptimeMinutes = Math.floor((uptimeSeconds % 3600) / 60);
        const uptimeSecs = uptimeSeconds % 60;
        const uptimeFormatted = `${uptimeDays} days, ${uptimeHours}:${String(uptimeMinutes).padStart(2, '0')}:${String(uptimeSecs).padStart(2, '0')}`;

        // Format timestamp to match Python's datetime.now(UTC).isoformat() (no Z suffix)
        const timestamp = new Date().toISOString().replace('Z', '');
        
        const response = {
          status: dbStatus && tmdbStatus ? 'healthy' : 'degraded',
          timestamp: timestamp,
          uptime: {
            seconds: uptimeSeconds,
            formatted: uptimeFormatted,
          },
          memory: {
            total: totalMemory,
            available: freeMemory,
            percent: parseFloat(memoryPercent.toFixed(1)),
            used: usedMemory,
          },
          disk: {
            total: diskTotal,
            free: diskFree,
            used: diskUsed,
            percent: parseFloat(diskPercent.toFixed(1)),
          },
          services: {
            database: {
              status: dbStatus ? 'healthy' : 'unhealthy',
              message: dbMessage,
            },
            tmdb: {
              status: tmdbStatus ? 'healthy' : 'unhealthy',
              message: tmdbMessage,
            },
          },
        };

        const statusCode = dbStatus && tmdbStatus ? 200 : 503;
        return res.status(statusCode).json(response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, `Health check failed: ${error.message}`, `Health check error: ${error.message}`);
      }
    });
  }
}

export default HealthcheckRouter;
