import BaseRouter from './BaseRouter.js';
import { NotFoundError, ValidationError } from '../errors/AppError.js';

/**
 * Provider Titles router for handling provider titles endpoints
 */
class ProviderTitlesRouter extends BaseRouter {
  /**
   * @param {import('express').Application} app - Express app instance
   * @param {import('../managers/domain/ProviderTitlesManager.js').ProviderTitlesManager} providerTitlesManager - Provider titles manager instance
   * @param {import('../managers/domain/TMDBManager.js').TMDBManager} tmdbManager - TMDB manager instance
   * @param {import('../repositories/ProviderRepository.js').ProviderRepository} providerRepo - Provider repository for joining provider names
   * @param {import('../middleware/Middleware.js').default} middleware - Middleware instance
   */
  constructor(app, providerTitlesManager, tmdbManager, providerRepo, middleware) {
    super(app, middleware, 'ProviderTitlesRouter');
    this._providerTitlesManager = providerTitlesManager;
    this._tmdbManager = tmdbManager;
    this._providerRepo = providerRepo;
  }

  /**
   * Get the base path(s) for this router
   * @returns {string[]} Base path(s) for this router
   */
  getBasePath() {
    return ['/api/provider-titles'];
  }

  /**
   * Set up routes for this router
   */
  setupRoutes() {
    /**
     * GET /api/provider-titles/ignored
     * Get paginated list of ignored titles with filters
     */
    this.router.get('/ignored', this.middleware.requireAuth, this._handleGetIgnoredTitles.bind(this));

    /**
     * GET /api/provider-titles/ignored/:id
     * Get single provider title details by MongoDB _id
     */
    this.router.get('/ignored/:id', this.middleware.requireAuth, this._handleGetIgnoredTitleById.bind(this));

    /**
     * POST /api/provider-titles/ignored/:id/validate-tmdb
     * Validate TMDB ID for a provider title
     */
    this.router.post('/ignored/:id/validate-tmdb', this.middleware.requireAuth, this._handleValidateTmdb.bind(this));

    /**
     * PUT /api/provider-titles/ignored/:id
     * Update provider title with TMDB ID and unignore it
     */
    this.router.put('/ignored/:id', this.middleware.requireAuth, this._handleUpdateIgnoredTitle.bind(this));
  }

  /**
   * Handle GET /ignored request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleGetIgnoredTitles(req, res) {
    try {
      const {
        page = 1,
        per_page = 50,
        media_type,
        issue_type,
        provider_id,
        search = ''
      } = req.query;

      const result = await this._providerTitlesManager.getIgnoredTitlesPaginated({
        page: parseInt(page, 10),
        perPage: parseInt(per_page, 10),
        mediaType: media_type,
        issueType: issue_type,
        providerId: provider_id,
        search: search
      }, this._providerRepo);

      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(res, error, 'Failed to get ignored titles');
    }
  }

  /**
   * Handle GET /ignored/:id request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleGetIgnoredTitleById(req, res) {
    try {
      const { id } = req.params;

      const result = await this._providerTitlesManager.getIgnoredTitleById(id, this._providerRepo);
      return res.status(200).json(result);
    } catch (error) {
      return this.handleError(res, error, 'Failed to get ignored title');
    }
  }

  /**
   * Handle POST /ignored/:id/validate-tmdb request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleValidateTmdb(req, res) {
    try {
      const { id } = req.params;
      const { type, tmdbId } = req.body;

      if (!type || !tmdbId) {
        return this.returnErrorResponse(res, 400, 'Type and tmdbId are required');
      }

      if (!['movie', 'tv'].includes(type)) {
        return this.returnErrorResponse(res, 400, "Invalid type. Must be 'movie' or 'tv'");
      }

      if (typeof tmdbId !== 'number' || tmdbId <= 0) {
        return this.returnErrorResponse(res, 400, 'Invalid TMDB ID');
      }

      // Validate TMDB ID by fetching details
      try {
        const tmdbDetails = await this._tmdbManager.getDetails(type, tmdbId);
        
        // Extract relevant info for preview
        const preview = {
          id: tmdbDetails.id,
          title: type === 'movie' ? tmdbDetails.title : tmdbDetails.name,
          release_date: type === 'movie' ? tmdbDetails.release_date : tmdbDetails.first_air_date,
          poster_path: tmdbDetails.poster_path,
          overview: tmdbDetails.overview,
          vote_average: tmdbDetails.vote_average,
          vote_count: tmdbDetails.vote_count
        };

        return res.status(200).json({
          valid: true,
          preview: preview
        });
      } catch (error) {
        // TMDB API error - ID not found or invalid
        return res.status(200).json({
          valid: false,
          error: error.message || 'TMDB ID not found'
        });
      }
    } catch (error) {
      return this.handleError(res, error, 'Failed to validate TMDB ID');
    }
  }

  /**
   * Handle PUT /ignored/:id request
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   */
  async _handleUpdateIgnoredTitle(req, res) {
    try {
      const { id } = req.params;
      const { tmdbId, type } = req.body;

      if (!tmdbId || !type) {
        return this.returnErrorResponse(res, 400, 'tmdbId and type are required');
      }

      // Convert TMDB type to our format
      const mediaType = type === 'movie' ? 'movies' : type === 'tv' ? 'tvshows' : type;
      
      if (!['movies', 'tvshows'].includes(mediaType)) {
        return this.returnErrorResponse(res, 400, "Invalid type. Must be 'movie', 'tv', 'movies', or 'tvshows'");
      }

      // Validate TMDB ID first
      const tmdbType = type === 'movie' ? 'movie' : type === 'tv' ? 'tv' : (mediaType === 'movies' ? 'movie' : 'tv');
      try {
        await this._tmdbManager.getDetails(tmdbType, tmdbId);
      } catch (error) {
        return this.returnErrorResponse(res, 400, `Invalid TMDB ID: ${error.message}`);
      }

      // Update provider title
      const updatedTitle = await this._providerTitlesManager.updateProviderTitleWithTMDB(id, tmdbId, mediaType);

      return res.status(200).json({
        success: true,
        title: updatedTitle
      });
    } catch (error) {
      return this.handleError(res, error, 'Failed to update provider title');
    }
  }
}

export default ProviderTitlesRouter;

