import BaseRouter from './BaseRouter.js';
import { createRequireApplicationToken } from '../middleware/applicationToken.js';

/**
 * Provider API router for engine to fetch provider data
 * All routes require application token and localhost access
 */
class ProviderApiRouter extends BaseRouter {
  /**
   * @param {import('../managers/providers.js').ProvidersManager} providersManager - Providers manager instance
   * @param {import('../services/mongodb-database.js').MongoDatabaseService} database - Database service instance
   */
  constructor(providersManager, database) {
    super(database, 'ProviderApiRouter');
    this._providersManager = providersManager;
    this._requireApplicationToken = createRequireApplicationToken();
  }

  /**
   * Initialize routes for this router
   */
  initialize() {
    /**
     * GET /api/provider/:providerId/metadata?type={type}
     * Fetch metadata from provider (Xtream: get_vod_streams/get_series)
     */
    this.router.get('/:providerId/metadata', this._requireApplicationToken, async (req, res) => {
      try {
        const { providerId } = req.params;
        const { type } = req.query;

        if (!type || !['movies', 'tvshows'].includes(type)) {
          return this.returnErrorResponse(res, 400, 'Invalid type parameter. Must be "movies" or "tvshows"');
        }

        const metadata = await this._providersManager.fetchMetadata(providerId, type);
        return res.status(200).json(metadata);
      } catch (error) {
        if (error.message.includes('not found')) {
          return this.returnErrorResponse(res, 404, error.message);
        }
        return this.returnErrorResponse(res, 500, 'Failed to fetch metadata', `Fetch metadata error: ${error.message}`);
      }
    });

    /**
     * GET /api/provider/:providerId/extended/:titleId?type={type}
     * Fetch extended info from provider (Xtream only)
     */
    this.router.get('/:providerId/extended/:titleId', this._requireApplicationToken, async (req, res) => {
      try {
        const { providerId, titleId } = req.params;
        const { type } = req.query;

        if (!type || !['movies', 'tvshows'].includes(type)) {
          return this.returnErrorResponse(res, 400, 'Invalid type parameter. Must be "movies" or "tvshows"');
        }

        const extendedInfo = await this._providersManager.fetchExtendedInfo(providerId, type, titleId);
        return res.status(200).json(extendedInfo);
      } catch (error) {
        if (error.message.includes('not found')) {
          return this.returnErrorResponse(res, 404, error.message);
        }
        if (error.message.includes('only supported')) {
          return this.returnErrorResponse(res, 400, error.message);
        }
        return this.returnErrorResponse(res, 500, 'Failed to fetch extended info', `Fetch extended info error: ${error.message}`);
      }
    });

    /**
     * GET /api/provider/:providerId/m3u8?type={type}&page={page}
     * Fetch M3U8 content from provider (AGTV only)
     */
    this.router.get('/:providerId/m3u8', this._requireApplicationToken, async (req, res) => {
      try {
        const { providerId } = req.params;
        const { type, page } = req.query;

        if (!type || !['movies', 'tvshows'].includes(type)) {
          return this.returnErrorResponse(res, 400, 'Invalid type parameter. Must be "movies" or "tvshows"');
        }

        const pageNum = page ? parseInt(page, 10) : null;
        if (page && (isNaN(pageNum) || pageNum < 1)) {
          return this.returnErrorResponse(res, 400, 'Invalid page parameter. Must be a positive integer');
        }

        const m3u8Content = await this._providersManager.fetchM3U8(providerId, type, pageNum);
        
        // Return as text/plain for M3U8 content
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send(m3u8Content);
      } catch (error) {
        if (error.message.includes('not found')) {
          return this.returnErrorResponse(res, 404, error.message);
        }
        if (error.message.includes('only supported')) {
          return this.returnErrorResponse(res, 400, error.message);
        }
        if (error.message.includes('Page not found')) {
          return this.returnErrorResponse(res, 404, error.message);
        }
        return this.returnErrorResponse(res, 500, 'Failed to fetch M3U8', `Fetch M3U8 error: ${error.message}`);
      }
    });
  }
}

export default ProviderApiRouter;

