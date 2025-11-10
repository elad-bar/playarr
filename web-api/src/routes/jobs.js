import BaseRouter from './BaseRouter.js';

/**
 * Jobs router for handling job management endpoints
 */
class JobsRouter extends BaseRouter {
  /**
   * @param {JobsManager} jobsManager - Jobs manager instance
   * @param {DatabaseService} database - Database service instance
   */
  constructor(jobsManager, database) {
    super(database, 'JobsRouter');
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
    this.router.get('/', this._requireAdmin, async (req, res) => {
      try {
        this.logger.debug('Calling getAllJobs() from JobsManager');
        const result = await this._jobsManager.getAllJobs();
        this.logger.debug(`GET /api/jobs - Returning status ${result.statusCode}, engineReachable: ${result.response.engineReachable}, jobs count: ${result.response.jobs?.length || 0}`);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get jobs', `Get jobs error: ${error.message}`);
      }
    });

    /**
     * POST /api/jobs/:jobName/trigger
     * Trigger a job manually (admin only)
     */
    this.router.post('/:jobName/trigger', this._requireAdmin, async (req, res) => {
      try {
        const { jobName } = req.params;

        if (!jobName) {
          return this.returnErrorResponse(res, 400, 'Job name is required');
        }

        const result = await this._jobsManager.triggerJob(jobName);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to trigger job', `Trigger job error: ${error.message}`);
      }
    });
  }
}

export default JobsRouter;

