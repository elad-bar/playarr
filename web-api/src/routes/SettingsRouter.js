import BaseRouter from './BaseRouter.js';
import crypto from 'crypto';

/**
 * Settings router for handling settings endpoints
 * Uses parameterized routes to support any setting key dynamically
 */
class SettingsRouter extends BaseRouter {
  /**
   * @param {import('express').Application} app - Express app instance
   * @param {SettingsManager} settingsManager - Settings manager instance
   * @param {import('../middleware/Middleware.js').default} middleware - Middleware instance
   * @param {import('../utils/logStreamTransport.js').LogStreamTransport} logStreamTransport - Log stream transport instance
   */
  constructor(app, settingsManager, middleware, logStreamTransport) {
    super(app, middleware, 'SettingsRouter');
    this._settingsManager = settingsManager;
    this._logStreamTransport = logStreamTransport;
  }

  /**
   * Get the base path(s) for this router
   * @returns {string[]} Base path(s) for this router
   */
  getBasePath() {
    return ['/api/settings'];
  }

  /**
   * Set up routes for this router
   */
  setupRoutes() {
    /**
     * GET /api/settings/log_stream_level
     * Get current log stream level
     */
    this.router.get('/log_stream_level', this.middleware.requireAuth, this._handleGetLogStreamLevel.bind(this));

    /**
     * POST /api/settings/log_stream_level
     * Set log stream level with validation
     */
    this.router.post('/log_stream_level', this.middleware.requireAuth, this._handleSetLogStreamLevel.bind(this));

    /**
     * GET /api/settings/metrics
     * Get metrics token (admin only)
     * Must be defined BEFORE /:key route to avoid route matching conflicts
     */
    this.router.get('/metrics', this.middleware.requireAdmin, this._handleGetMetricsToken.bind(this));

    /**
     * POST /api/settings/metrics/regenerate
     * Regenerate metrics token (admin only)
     * Must be defined BEFORE /:key route to avoid route matching conflicts
     */
    this.router.post('/metrics/regenerate', this.middleware.requireAdmin, this._handleRegenerateMetricsToken.bind(this));

    /**
     * GET /api/settings/:key
     * Get any setting by key
     */
    this.router.get('/:key', this.middleware.requireAuth, this._handleGetSettingByKey.bind(this));

    /**
     * POST /api/settings/:key
     * Set any setting by key
     */
    this.router.post('/:key', this.middleware.requireAuth, this._handleSetSettingByKey.bind(this));

    /**
     * DELETE /api/settings/:key
     * Delete any setting by key
     */
    this.router.delete('/:key', this.middleware.requireAuth, this._handleDeleteSettingByKey.bind(this));
  }

  /**
   * Handle GET /log_stream_level request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleGetLogStreamLevel(req, res) {
    try {
      const level = this._logStreamTransport.getLevel();
      return res.status(200).json({ level });
    } catch (error) {
      return this.returnErrorResponse(res, 500, 'Failed to get log stream level', error.message);
    }
  }

  /**
   * Handle POST /log_stream_level request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleSetLogStreamLevel(req, res) {
    try {
      const { level } = req.body;
      
      if (!level) {
        return this.returnErrorResponse(res, 400, 'level is required');
      }

      const availableLevels = this._logStreamTransport.getAvailableLogLevels();
      if (!availableLevels.includes(level)) {
        return this.returnErrorResponse(res, 400, `Invalid log level. Must be one of: ${availableLevels.join(', ')}`);
      }

      // Update the log stream transport
      this._logStreamTransport.setLevel(level);
      
      // Also save to settings for persistence
      await this._settingsManager.setSetting('log_stream_level', level);
      
      return res.status(200).json({ level, message: `Log stream level set to ${level}` });
    } catch (error) {
      return this.returnErrorResponse(res, 500, 'Failed to set log stream level', error.message);
    }
  }

  /**
   * Handle GET /metrics request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleGetMetricsToken(req, res) {
    try {
      const result = await this._settingsManager.getSetting('metrics_token');
      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(res, error, 'Failed to get metrics token');
    }
  }

  /**
   * Handle POST /metrics/regenerate request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleRegenerateMetricsToken(req, res) {
    try {
      const newToken = crypto.randomBytes(32).toString('hex');
      await this._settingsManager.setSetting('metrics_token', newToken);
      return res.status(200).json({ value: newToken });
    } catch (error) {
      return this.handleError(res, error, 'Failed to regenerate metrics token');
    }
  }

  /**
   * Handle GET /:key request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleGetSettingByKey(req, res) {
    try {
      const { key } = req.params;
      const result = await this._settingsManager.getSetting(key);
      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(res, error, 'Failed to get setting');
    }
  }

  /**
   * Handle POST /:key request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleSetSettingByKey(req, res) {
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
  }

  /**
   * Handle DELETE /:key request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleDeleteSettingByKey(req, res) {
    try {
      const { key } = req.params;
      const result = await this._settingsManager.deleteSetting(key);
      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(res, error, 'Failed to delete setting');
    }
  }
}

export default SettingsRouter;
