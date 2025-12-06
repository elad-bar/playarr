import BaseRouter from './BaseRouter.js';
import { formatNumber } from '../utils/numberFormat.js';

/**
 * Jobs router for handling job management endpoints
 */
class JobsRouter extends BaseRouter {
  /**
   * @param {JobsManager} jobsManager - Jobs manager instance
   * @param {import('../middleware/Middleware.js').default} middleware - Middleware instance
   */
  constructor(jobsManager, middleware) {
    super(middleware, 'JobsRouter');
    this._jobsManager = jobsManager;
  }

  /**
   * Initialize routes for this router
   */
  initialize() {
    /**
     * GET /api/jobs
     * List all jobs with details and status (admin only)
     */
    this.router.get('/', this.middleware.requireAdmin, async (req, res) => {
      try {
        this.logger.debug('Calling getAllJobs() from JobsManager');
        const result = await this._jobsManager.getAllJobs();
        this.logger.debug(`GET /api/jobs - Returning jobs count: ${formatNumber(result.jobs?.length || 0)}`);
        return res.status(200).json(result);
      } catch (error) {
        return this.handleError(res, error, 'Failed to get jobs');
      }
    });

    /**
     * POST /api/jobs/:jobName/trigger
     * Trigger a job manually (admin only)
     */
    this.router.post('/:jobName/trigger', this.middleware.requireAdmin, async (req, res) => {
      try {
        const { jobName } = req.params;

        if (!jobName) {
          return this.returnErrorResponse(res, 400, 'Job name is required');
        }

        const result = await this._jobsManager.triggerJob(jobName);
        return res.status(200).json(result);
      } catch (error) {
        return this.handleError(res, error, 'Failed to trigger job');
      }
    });
  }
}

export default JobsRouter;

