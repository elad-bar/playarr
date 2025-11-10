import express from 'express';
import { createLogger } from './utils/logger.js';

const logger = createLogger('EngineServer');

/**
 * Engine HTTP server for job control API
 */
class EngineServer {
  /**
   * @param {import('bree').default} bree - Bree instance for job control
   * @param {import('./managers/JobsManager.js').JobsManager} jobsManager - Jobs manager for validation
   */
  constructor(bree, jobsManager) {
    this._bree = bree;
    this._jobsManager = jobsManager;
    this._app = null;
    this._server = null;
  }

  /**
   * Setup all routes
   * @private
   */
  _setupRoutes() {
    /**
     * GET /api/jobs
     * Returns list of available jobs with metadata
     */
    this._app.get('/api/jobs', (req, res) => {
      try {
        const allJobs = this._jobsManager.getAllJobsMetadata();
        const jobs = allJobs.map(job => ({
          name: job.name,
          description: job.description,
          schedule: job.schedule,
          interval: job.interval,
          skipIfOtherInProgress: job.skipIfOtherInProgress
        }));
        res.json({ jobs });
      } catch (error) {
        logger.error('Error getting jobs list:', error);
        res.status(500).json({ error: 'Failed to get jobs list' });
      }
    });

    /**
     * POST /api/jobs/:jobName/trigger
     * Triggers a job manually via bree.run()
     * Body parameter: { providerId: "provider-id" } to process all titles for a specific provider
     */
    this._app.post('/api/jobs/:jobName/trigger', async (req, res) => {
      try {
        const { jobName } = req.params;
        const providerId = req.body?.providerId || req.query?.providerId || null;

        // Validate job name
        const jobConfig = this._jobsManager.getJobMetadata(jobName);
        if (!jobConfig) {
          return res.status(404).json({ error: `Job '${jobName}' not found` });
        }

        logger.info(`Manual trigger requested for job: ${jobName}${providerId ? ` (providerId: ${providerId})` : ''}`);

        // Validate if job can run using JobsManager
        const validation = await this._jobsManager.canRunJob(jobName);
        
        if (!validation.canRun) {
          const status = validation.blockingJobs && validation.blockingJobs.length > 0 && 
                         validation.blockingJobs[0] !== jobName ? 'blocked' : 'running';
          return res.status(409).json({ 
            error: validation.reason,
            status,
            blockingJobs: validation.blockingJobs
          });
        }

        // Trigger the job with optional providerId parameter
        try {
          // Pass providerId in workerData if provided (for any job)
          const workerData = providerId 
            ? { providerId }
            : undefined;
          
          await this._bree.run(jobName, workerData);
          logger.info(`Job '${jobName}' triggered successfully${providerId ? ` for provider ${providerId}` : ''}`);
          res.json({ 
            success: true, 
            message: `Job '${jobName}' triggered successfully`,
            jobName,
            ...(providerId ? { providerId } : {})
          });
        } catch (error) {
          // Handle "already running" error from Bree (fallback for race conditions)
          // Check for both the custom error code and the error message
          if (error.code === 'JOB_ALREADY_RUNNING' || 
              error.isAlreadyRunning || 
              (error.message && error.message.includes('already running'))) {
            logger.debug(`Job '${jobName}' is already running (detected by Bree error)`);
            return res.status(409).json({ 
              error: `Job '${jobName}' is already running`,
              status: 'running'
            });
          }
          throw error;
        }
      } catch (error) {
        // Handle "already running" errors that might have slipped through
        if (error.code === 'JOB_ALREADY_RUNNING' || 
            error.isAlreadyRunning || 
            (error.message && error.message.includes('already running'))) {
          logger.debug(`Job '${jobName}' is already running (detected in outer catch)`);
          return res.status(409).json({ 
            error: `Job '${jobName}' is already running`,
            status: 'running'
          });
        }
        // Log and return 500 for unexpected errors
        logger.error(`Error triggering job '${req.params.jobName}':`, error);
        res.status(500).json({ 
          error: `Failed to trigger job: ${error.message}` 
        });
      }
    });

    /**
     * GET /api/health
     * Health check endpoint
     */
    this._app.get('/api/health', (req, res) => {
      res.json({ status: 'ok', service: 'engine-api' });
    });
  }

  /**
   * Create and configure Express app
   * @returns {Promise<express.Application>} Configured Express app
   */
  async createApp() {
    this._app = express();
    
    // No CORS needed - localhost only, isolated in Docker
    this._app.use(express.json());

    // No API key authentication - localhost only, isolated in Docker

    // Setup routes
    this._setupRoutes();

    return this._app;
  }

  /**
   * Start the HTTP server
   * @returns {Promise<import('http').Server>} HTTP server instance
   */
  async start() {
    try {
      if (!this._app) {
        await this.createApp();
      }

      const port = 3002; // Static port - localhost only
      
      return new Promise((resolve, reject) => {
        try {
          this._server = this._app.listen(port, '127.0.0.1', () => {
            logger.info(`Engine API server started on 127.0.0.1:${port}`);
            resolve(this._server);
          });

          this._server.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
              logger.error(`Port ${port} is already in use`);
            } else {
              logger.error('Server error:', error);
              logger.error('Error code:', error.code);
              logger.error('Error message:', error.message);
            }
            reject(error);
          });
        } catch (error) {
          logger.error('Error creating server:', error);
          reject(error);
        }
      });
    } catch (error) {
      logger.error('Error in start() method:', error);
      throw error;
    }
  }
}

export { EngineServer };
