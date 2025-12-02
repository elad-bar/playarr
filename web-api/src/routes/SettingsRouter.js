import BaseRouter from './BaseRouter.js';

/**
 * Settings router for handling settings endpoints
 * Uses parameterized routes to support any setting key dynamically
 */
class SettingsRouter extends BaseRouter {
  /**
   * @param {SettingsManager} settingsManager - Settings manager instance
   * @param {import('../middleware/Middleware.js').default} middleware - Middleware instance
   */
  constructor(settingsManager, middleware) {
    super(middleware, 'SettingsRouter');
    this._settingsManager = settingsManager;
  }

  /**
   * Initialize routes for this router
   */
  initialize() {
    /**
     * GET /api/settings/log_stream_level
     * Get current log stream level
     */
    this.router.get('/log_stream_level', this.middleware.requireAuth, async (req, res) => {
      try {
        const { getLogStreamLevel } = await import('../utils/logger.js');
        const level = getLogStreamLevel();
        return res.status(200).json({ level });
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get log stream level', error.message);
      }
    });

    /**
     * POST /api/settings/log_stream_level
     * Set log stream level with validation
     */
    this.router.post('/log_stream_level', this.middleware.requireAuth, async (req, res) => {
      try {
        const { level } = req.body;
        const { setLogStreamLevel, getAvailableLogLevels } = await import('../utils/logger.js');
        
        if (!level) {
          return this.returnErrorResponse(res, 400, 'level is required');
        }

        const availableLevels = getAvailableLogLevels();
        if (!availableLevels.includes(level)) {
          return this.returnErrorResponse(res, 400, `Invalid log level. Must be one of: ${availableLevels.join(', ')}`);
        }

        // Update the logger
        setLogStreamLevel(level);
        
        // Also save to settings for persistence
        await this._settingsManager.setSetting('log_stream_level', level);
        
        return res.status(200).json({ level, message: `Log stream level set to ${level}` });
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to set log stream level', error.message);
      }
    });

    /**
     * GET /api/settings/:key
     * Get any setting by key
     */
    this.router.get('/:key', this.middleware.requireAuth, async (req, res) => {
      try {
        const { key } = req.params;
        const result = await this._settingsManager.getSetting(key);
        return res.status(200).json(result);
      } catch (error) {
        return this.handleError(res, error, 'Failed to get setting');
      }
    });

    /**
     * POST /api/settings/:key
     * Set any setting by key
     */
    this.router.post('/:key', this.middleware.requireAuth, async (req, res) => {
      try {
        const { key } = req.params;
        const { value } = req.body;

        if (value === undefined) {
          return this.returnErrorResponse(res, 400, 'value is required');
        }

        const result = await this._settingsManager.setSetting(key, value);
        return res.status(200).json(result);
      } catch (error) {
        return this.handleError(res, error, 'Failed to set setting');
      }
    });

    /**
     * DELETE /api/settings/:key
     * Delete any setting by key
     */
    this.router.delete('/:key', this.middleware.requireAuth, async (req, res) => {
      try {
        const { key } = req.params;
        const result = await this._settingsManager.deleteSetting(key);
        return res.status(200).json(result);
      } catch (error) {
        return this.handleError(res, error, 'Failed to delete setting');
      }
    });
  }
}

export default SettingsRouter;
