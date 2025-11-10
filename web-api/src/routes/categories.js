import BaseRouter from './BaseRouter.js';

/**
 * Categories router for handling category endpoints
 */
class CategoriesRouter extends BaseRouter {
  /**
   * @param {CategoriesManager} categoriesManager - Categories manager instance
   * @param {DatabaseService} database - Database service instance
   */
  constructor(categoriesManager, database) {
    super(database, 'CategoriesRouter');
    this._categoriesManager = categoriesManager;
  }

  /**
   * Initialize routes for this router
   */
  initialize() {
    /**
     * GET /api/iptv/providers/:provider_id/categories
     * Get categories for a specific IPTV provider
     */
    this.router.get('/providers/:provider_id/categories', this._requireAuth, async (req, res) => {
      try {
        const { provider_id } = req.params;
        const result = await this._categoriesManager.getCategories(provider_id);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get categories', `Get provider categories error: ${error.message}`);
      }
    });

    /**
     * PUT /api/iptv/providers/:provider_id/categories/:category_key
     * Update a specific category for an IPTV provider (admin only)
     */
    this.router.put('/providers/:provider_id/categories/:category_key', this._requireAdmin, async (req, res) => {
      try {
        const { provider_id, category_key } = req.params;
        const categoryData = req.body;

        if (!categoryData || Object.keys(categoryData).length === 0) {
          return this.returnErrorResponse(res, 400, 'Request body is required');
        }

        const result = await this._categoriesManager.updateCategory(provider_id, category_key, categoryData);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to update category', `Update provider category error: ${error.message}`);
      }
    });
  }
}

export default CategoriesRouter;
