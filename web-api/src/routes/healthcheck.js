import express from 'express';
import os from 'os';
import checkDiskSpace from 'check-disk-space';
import fs from 'fs-extra';
import { getDatabase } from '../config/database.js';
import { databaseService } from '../services/database.js';
import { toCollectionName, DatabaseCollections } from '../config/collections.js';

const router = express.Router();

// Track server start time for uptime calculation
const START_TIME = Date.now() / 1000; // Unix timestamp in seconds

/**
 * GET /api/healthcheck
 * System health check endpoint matching Python's healthcheck format
 */
router.get('/', async (req, res) => {
  try {
    // Check database connectivity (file system access)
    let dbStatus = false;
    let dbMessage = 'Not connected';
    try {
      const fileStorage = getDatabase();
      const dataDir = fileStorage.dataDir;
      
      // Check if data directory is accessible
      await fs.access(dataDir, fs.constants.R_OK | fs.constants.W_OK);
      dbStatus = true;
      dbMessage = 'Connected';
    } catch (error) {
      dbMessage = error.message || 'Connection failed';
    }

    // Check TMDB service (simplified - just check if configuration exists in settings)
    let tmdbStatus = false;
    let tmdbMessage = 'Not configured';
    try {
      const settingsCollection = toCollectionName(DatabaseCollections.SETTINGS);
      const tmdbConfig = await databaseService.getData(settingsCollection, { key: 'tmdb_configuration' });
      if (tmdbConfig) {
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
      console.warn('Failed to get disk usage:', error);
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
    console.error('Health check failed:', error);
    return res.status(500).json({ error: `Health check failed: ${error.message}` });
  }
});

export default router;