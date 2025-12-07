import { BaseDomainManager } from './BaseDomainManager.js';

/**
 * ProviderCategoryManager for managing provider category data
 * Type A: Domain Manager
 * Extends BaseDomainManager to use ProviderCategoryRepository
 */
export class ProviderCategoryManager extends BaseDomainManager {
  /**
   * @param {import('../../repositories/ProviderCategoryRepository.js').ProviderCategoryRepository} providerCategoryRepo - Provider category repository
   */
  constructor(providerCategoryRepo) {
    super('ProviderCategoryManager', providerCategoryRepo);
  }

  /**
   * Get categories for a provider
   * @param {string} providerId - Provider ID
   * @param {string} [type] - Optional media type filter ('movies' or 'tvshows')
   * @returns {Promise<Array<Object>>} Array of category objects
   */
  async getCategoriesByProvider(providerId, type = null) {
    try {
      return await this._repository.findByProvider(providerId, type);
    } catch (error) {
      this.logger.error(`Error getting categories for provider ${providerId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Bulk upsert categories for a provider
   * @param {string} providerId - Provider ID
   * @param {Array<Object>} categories - Array of category objects with structure: { provider_id, type, category_id, category_name, category_key }
   * @returns {Promise<{inserted: number, updated: number}>} Upsert result
   */
  async bulkUpsertCategories(providerId, categories) {
    try {
      if (!Array.isArray(categories) || categories.length === 0) {
        return { inserted: 0, updated: 0 };
      }

      // Ensure all categories have provider_id set
      const categoriesWithProviderId = categories.map(cat => ({
        ...cat,
        provider_id: providerId
      }));

      // Use bulkUpsert with matchFields for provider_id, type, and category_id
      return await this.bulkUpsert(categoriesWithProviderId, {
        matchFields: ['provider_id', 'type', 'category_id'],
        setTimestamps: true
      });
    } catch (error) {
      this.logger.error(`Error bulk upserting categories for provider ${providerId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete all categories for a provider
   * @param {string} providerId - Provider ID
   * @returns {Promise<Object>} Delete result with deletedCount
   */
  async deleteCategoriesByProvider(providerId) {
    try {
      return await this._repository.deleteByProvider(providerId);
    } catch (error) {
      this.logger.error(`Error deleting categories for provider ${providerId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete categories for a provider and specific media type
   * @param {string} providerId - Provider ID
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Promise<Object>} Delete result with deletedCount
   */
  async deleteCategoriesByProviderAndType(providerId, type) {
    try {
      return await this._repository.deleteByProviderAndType(providerId, type);
    } catch (error) {
      this.logger.error(`Error deleting categories for provider ${providerId} and type ${type}: ${error.message}`);
      throw error;
    }
  }
}

