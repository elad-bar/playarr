import { databaseService } from './database.js';
import { cacheService } from './cache.js';
import { DatabaseCollections, toCollectionName } from '../config/collections.js';

/**
 * Categories service for handling IPTV provider categories
 * Matches Python's CategoriesService
 */
class CategoriesService {
  constructor() {
  }

  /**
   * Get provider by ID (from providers service)
   */
  async _getProviderById(providerId) {
    try {
      // Import providers service dynamically to avoid circular dependency
      const { providersService } = await import('./providers.js');
      const result = await providersService.getProvider(providerId);
      return result.statusCode === 200 ? result.response : null;
    } catch (error) {
      console.error(`Error getting provider ${providerId}:`, error);
      return null;
    }
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

      // Check cache first
      const cachedCategories = cacheService.getCategories(providerId);
      if (cachedCategories) {
        return {
          response: cachedCategories,
          statusCode: 200,
        };
      }

      // Get categories for the provider
      const collectionName = toCollectionName(DatabaseCollections.CATEGORIES, providerId);
      const categories = await databaseService.getDataList(collectionName);

      if (!categories) {
        return {
          response: [],
          statusCode: 200,
        };
      }

      // Remove any _id fields if present (for compatibility)
      const categoriesList = categories.map(category => {
        const { _id, ...categoryData } = category;
        return categoryData;
      });

      // Update cache
      cacheService.setCategories(providerId, categoriesList);

      return {
        response: categoriesList,
        statusCode: 200,
      };
    } catch (error) {
      console.error('Error getting categories:', error);
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

      // Validate type value
      if (!['movies', 'shows'].includes(categoryData.type)) {
        return {
          response: {
            error: "Invalid type. Must be one of: movies, shows",
          },
          statusCode: 400,
        };
      }

      // Get categories collection
      const collectionName = toCollectionName(DatabaseCollections.CATEGORIES, providerId);

      // Find the category to update
      const query = { key: categoryKey };
      const existingCategory = await databaseService.getData(collectionName, query);

      if (!existingCategory) {
        return {
          response: { error: 'Category not found' },
          statusCode: 404,
        };
      }

      // Update category data
      const updatedCategory = {
        ...existingCategory,
        ...categoryData,
      };

      // Save updated category
      await databaseService.updateData(collectionName, updatedCategory, query);

      // Remove any _id field if present (for compatibility)
      const { _id, ...categoryResponse } = updatedCategory;

      // Clear cache for this provider
      cacheService.clearCategories(providerId);

      // TODO: Broadcast WebSocket event for provider change

      return {
        response: categoryResponse,
        statusCode: 200,
      };
    } catch (error) {
      console.error('Error updating category:', error);
      return {
        response: { error: 'Failed to update category' },
        statusCode: 500,
      };
    }
  }
}

// Export singleton instance
export const categoriesService = new CategoriesService();

