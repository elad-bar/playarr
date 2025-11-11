import { BaseManager } from './BaseManager.js';
import axios from 'axios';

/**
 * Jobs manager for managing engine jobs
 * Reads job history from MongoDB and triggers jobs via engine HTTP API
 */
class JobsManager extends BaseManager {
  /**
   * @param {import('../services/database.js').DatabaseService} database - Database service instance
   */
  constructor(database) {
    super('JobsManager', database);
    
    // Engine API configuration - static localhost port, no API key needed
    // Engine is always on localhost:3002 in Docker, not configurable
    this._engineApiUrl = 'http://127.0.0.1:3002';
  }

  /**
   * Get job history from MongoDB
   * @param {string} jobName - Job name (e.g., "SyncIPTVProviderTitlesJob")
   * @returns {Promise<Object|null>} Job history document or null if not found
   */
  async _getJobHistory(jobName) {
    try {
      const collection = this._database.getCollection('job_history');
      const jobHistory = await collection.findOne({ job_name: jobName });
      return jobHistory;
    } catch (error) {
      this.logger.error(`Error getting job history for ${jobName}:`, error);
      return null;
    }
  }


  /**
   * Format job data for UI
   * @param {Object} engineJob - Job metadata from engine
   * @param {Object|null} jobHistory - Job history from MongoDB
   * @returns {Object} Formatted job data
   */
  _formatJobData(engineJob, jobHistory) {
    return {
      name: engineJob.name,
      description: engineJob.description,
      schedule: engineJob.schedule,
      interval: engineJob.interval,
      status: jobHistory?.status || 'unknown',
      lastExecution: jobHistory?.last_execution || null,
      executionCount: jobHistory?.execution_count || 0,
      lastResult: jobHistory?.last_result || null,
      lastError: jobHistory?.last_error || null,
      createdAt: jobHistory?.createdAt || null,
      lastUpdated: jobHistory?.lastUpdated || null
    };
  }

  /**
   * Get all jobs with their details and status
   * @returns {Promise<{response: object, statusCode: number}>}
   */
  async getAllJobs() {
    try {
      // Get job list from engine API
      const engineApiUrl = `${this._engineApiUrl}/api/jobs`;
      
      let engineJobs = [];
      try {
        const response = await axios.get(engineApiUrl, { 
          timeout: 5000 
        });
        engineJobs = response.data.jobs || [];
      } catch (error) {
        this.logger.error('Error fetching jobs from engine API, error:', error);
        // Return jobs with "engine unreachable" status
        return {
          response: {
            jobs: [],
            error: 'Engine API is not reachable',
            engineReachable: false
          },
          statusCode: 503
        };
      }

      // Get job history for each job from MongoDB
      const jobsWithHistory = await Promise.all(
        engineJobs.map(async (engineJob) => {
          const jobHistory = await this._getJobHistory(engineJob.jobHistoryName);
          return this._formatJobData(engineJob, jobHistory);
        })
      );

      return {
        response: {
          jobs: jobsWithHistory,
          engineReachable: true
        },
        statusCode: 200
      };
    } catch (error) {
      this.logger.error('Error getting all jobs:', error);
      return {
        response: { error: 'Failed to get jobs' },
        statusCode: 500
      };
    }
  }

  /**
   * Trigger a job via engine API
   * @param {string} jobName - Job name (e.g., "syncIPTVProviderTitles")
   * @param {Object} [options] - Optional parameters
   * @param {string} [options.providerId] - Provider ID to process all titles for
   * @returns {Promise<{response: object, statusCode: number}>}
   */
  async triggerJob(jobName, options = {}) {
    try {
      const { providerId } = options;
      const engineApiUrl = `${this._engineApiUrl}/api/jobs/${jobName}/trigger`;

      try {
        const response = await axios.post(engineApiUrl, { providerId: providerId || null }, { 
          timeout: 10000 
        });
        
        return {
          response: {
            success: true,
            message: response.data.message || `Job '${jobName}' triggered successfully`,
            jobName: response.data.jobName || jobName,
            ...(response.data.providerId ? { providerId: response.data.providerId } : {})
          },
          statusCode: 200
        };
      } catch (error) {
        // Handle specific error cases
        if (error.response) {
          const statusCode = error.response.status;
          const errorData = error.response.data;
          
          if (statusCode === 409) {
            // Job already running
            return {
              response: {
                success: false,
                error: errorData.error || `Job '${jobName}' is already running`,
                status: errorData.status || 'running'
              },
              statusCode: 409
            };
          } else if (statusCode === 404) {
            // Job not found
            return {
              response: {
                success: false,
                error: errorData.error || `Job '${jobName}' not found`
              },
              statusCode: 404
            };
          }
        }
        
        // Network or other errors
        this.logger.error(`Error triggering job ${jobName}:`, error.message);
        return {
          response: {
            success: false,
            error: `Failed to trigger job: ${error.message}`,
            engineReachable: false
          },
          statusCode: 503
        };
      }
    } catch (error) {
      this.logger.error(`Error triggering job ${jobName}:`, error);
      return {
        response: { 
          success: false,
          error: 'Failed to trigger job',
          engineReachable: false
        },
        statusCode: 500
      };
    }
  }
}

export { JobsManager };

