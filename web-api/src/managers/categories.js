import { BaseManager } from './BaseManager.js';
import { DatabaseCollections, toCollectionName, getCollectionKey } from '../config/collections.js';

/**
 * Categories manager for handling IPTV provider categories
 * Matches Python's CategoriesService
 * Uses DatabaseService collection-based methods for all data access
 */
class CategoriesManager extends BaseManager {
  /**
   * @param {import('../services/database.js').DatabaseService} database - Database service instance
   * @param {import('./providers.js').ProvidersManager} providersManager - Providers manager instance
   */
  constructor(database, providersManager) {
    super('CategoriesManager', database);
    this._providersManager = providersManager;
  }

  /**
   * Get provider by ID (from providers manager)
   */
  async _getProviderById(providerId) {
    try {
      const result = await this._providersManager.getProvider(providerId);
      return result.statusCode === 200 ? result.response : null;
    } catch (error) {
      this.logger.error(`Error getting provider ${providerId}:`, error);
      return null;
    }
  }

  /**
   * Get collection name for provider-specific categories
   * @private
   */
  _getCategoriesCollectionName(providerId) {
    return toCollectionName(DatabaseCollections.CATEGORIES, providerId);
  }

  /**
   * Transform category from engine format to API format
   * @private
   */
  _transformCategoryToApiFormat(cat) {
    const categoryKey = cat.category_key || `${cat.type}-${cat.category_id}`;
    return {
      key: categoryKey,
      type: cat.type, // Use engine type directly (tvshows or movies)
      category_id: cat.category_id,
      category_name: cat.category_name,
      enabled: cat.enabled !== undefined ? cat.enabled : false
    };
  }

  /**
   * Get categories for a specific provider
   * Matches Python's CategoriesService.get_categories()
   */
  async getCategories(providerId) {
    try {
      // Validate provider exists
      const provider = await this._getProviderById(providerId);
      if (!provider) {
        return {
          response: { error: 'Provider not found' },
          statusCode: 404,
        };
      }

      // Load categories from collection (database service handles caching internally)
      const collectionName = this._getCategoriesCollectionName(providerId);
      const categories = await this._database.getDataList(collectionName);

      if (!categories || !Array.isArray(categories)) {
        return {
          response: [],
          statusCode: 200,
        };
      }

      // Transform categories to API format
      const transformedCategories = categories.map(cat => this._transformCategoryToApiFormat(cat));

      return {
        response: transformedCategories,
        statusCode: 200,
      };
    } catch (error) {
      this.logger.error('Error getting categories:', error);
      return {
        response: { error: 'Failed to get categories' },
        statusCode: 500,
      };
    }
  }

  /**
   * Update a category for a specific provider
   * Matches Python's CategoriesService.update_category()
   */
  async updateCategory(providerId, categoryKey, categoryData) {
    try {
      // Validate provider exists
      const provider = await this._getProviderById(providerId);
      if (!provider) {
        return {
          response: { error: 'Provider not found' },
          statusCode: 404,
        };
      }

      // Validate required fields
      if (categoryData.enabled === undefined) {
        return {
          response: { error: 'Missing required field: enabled' },
          statusCode: 400,
        };
      }

      if (categoryData.type === undefined) {
        return {
          response: { error: 'Missing required field: type' },
          statusCode: 400,
        };
      }

      // Validate type value (use engine format: tvshows)
      if (!['movies', 'tvshows'].includes(categoryData.type)) {
        return {
          response: {
            error: "Invalid type. Must be one of: movies, tvshows",
          },
          statusCode: 400,
        };
      }

      // Parse category key: format is "{type}-{category_id}"
      const keyParts = categoryKey.split('-');
      if (keyParts.length < 2) {
        return {
          response: { error: 'Invalid category key format' },
          statusCode: 400,
        };
      }

      // Use type directly (no normalization)
      const categoryId = keyParts.slice(1).join('-'); // Handle category_id that might contain dashes
      const engineCategoryKey = `${categoryData.type}-${categoryId}`;

      // Get collection name and key field
      const collectionName = this._getCategoriesCollectionName(providerId);
      const keyField = getCollectionKey(DatabaseCollections.CATEGORIES); // 'key'

      // Find category by category_key
      const category = await this._database.getData(collectionName, { [keyField]: engineCategoryKey });

      if (!category) {
        // Try finding by category_key field directly
        const categoryByKey = await this._database.getData(collectionName, { category_key: engineCategoryKey });
        if (!categoryByKey) {
          return {
            response: { error: 'Category not found' },
            statusCode: 404,
          };
        }
        // Update category
        const updatedCategory = {
          ...categoryByKey,
          enabled: categoryData.enabled,
          lastUpdated: new Date().toISOString()
        };

        await this._database.updateData(
          collectionName,
          updatedCategory,
          { category_key: engineCategoryKey }
        );

        // Return in API format
        const categoryResponse = this._transformCategoryToApiFormat(updatedCategory);
        return {
          response: categoryResponse,
          statusCode: 200,
        };
      }

      // Update category
      const updatedCategory = {
        ...category,
        enabled: categoryData.enabled,
        lastUpdated: new Date().toISOString()
      };

      await this._database.updateData(
        collectionName,
        updatedCategory,
        { [keyField]: engineCategoryKey }
      );

      // Return in API format
      const categoryResponse = this._transformCategoryToApiFormat(updatedCategory);

      // TODO: Broadcast WebSocket event for provider change

      return {
        response: categoryResponse,
        statusCode: 200,
      };
    } catch (error) {
      this.logger.error('Error updating category:', error);
      return {
        response: { error: 'Failed to update category' },
        statusCode: 500,
      };
    }
  }
}

// Export class
export { CategoriesManager };

