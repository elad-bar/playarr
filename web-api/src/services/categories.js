import { cacheService } from './cache.js';
import { createLogger } from '../utils/logger.js';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get data directory from environment or use default
// Path: from web-api/src/services/ to root: ../../../data
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../../data');

const logger = createLogger('CategoriesService');

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
      logger.error(`Error getting provider ${providerId}:`, error);
      return null;
    }
  }

  /**
   * Load categories from engine file format
   * Reads from data/categories/{providerId}.categories.json (plain array format)
   * @private
   */
  async _loadCategoriesFromFiles(providerId) {
    const filePath = path.join(DATA_DIR, 'categories', `${providerId}.categories.json`);
    
    try {
      if (await fs.pathExists(filePath)) {
        const categories = await fs.readJson(filePath);
        
        if (Array.isArray(categories)) {
          // Transform categories to API format (no normalization - use engine format directly)
          const transformedCategories = categories.map(cat => {
            // Use category_key if available, otherwise generate from type and category_id
            const categoryKey = cat.category_key || `${cat.type}-${cat.category_id}`;
            
            return {
              key: categoryKey,
              type: cat.type, // Use engine type directly (tvshows or movies)
              category_id: cat.category_id,
              category_name: cat.category_name,
              enabled: cat.enabled !== undefined ? cat.enabled : false
            };
          });
          
          return transformedCategories;
        }
      }
    } catch (error) {
      logger.warn(`Error reading categories file ${filePath}:`, error.message);
    }

    return [];
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

      // Load categories from engine file format
      const categoriesList = await this._loadCategoriesFromFiles(providerId);

      // Update cache
      cacheService.setCategories(providerId, categoriesList);

      return {
        response: categoriesList,
        statusCode: 200,
      };
    } catch (error) {
      logger.error('Error getting categories:', error);
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
      
      const filePath = path.join(DATA_DIR, 'categories', `${providerId}.categories.json`);

      // Read the category file
      if (!(await fs.pathExists(filePath))) {
        return {
          response: { error: 'Category file not found' },
          statusCode: 404,
        };
      }

      const categories = await fs.readJson(filePath);
      
      if (!Array.isArray(categories)) {
        return {
          response: { error: 'Invalid category file format' },
          statusCode: 500,
        };
      }

      // Find and update the category by category_key
      const categoryIndex = categories.findIndex(
        cat => {
          const catKey = cat.category_key || `${cat.type}-${cat.category_id}`;
          return catKey === engineCategoryKey;
        }
      );

      if (categoryIndex === -1) {
        return {
          response: { error: 'Category not found' },
          statusCode: 404,
        };
      }

      // Update the category
      const updatedCategory = {
        ...categories[categoryIndex],
        enabled: categoryData.enabled,
        lastUpdated: new Date().toISOString()
      };
      
      categories[categoryIndex] = updatedCategory;

      // Write back to file
      await fs.writeJson(filePath, categories, { spaces: 2 });

      // Clear cache for this provider
      cacheService.clearCategories(providerId);

      // Return in engine format (no normalization)
      const categoryResponse = {
        key: categoryKey,
        type: categoryData.type, // Use engine type directly (tvshows or movies)
        category_id: updatedCategory.category_id,
        category_name: updatedCategory.category_name,
        enabled: updatedCategory.enabled,
      };

      // TODO: Broadcast WebSocket event for provider change

      return {
        response: categoryResponse,
        statusCode: 200,
      };
    } catch (error) {
      logger.error('Error updating category:', error);
      return {
        response: { error: 'Failed to update category' },
        statusCode: 500,
      };
    }
  }
}

// Export singleton instance
export const categoriesService = new CategoriesService();

