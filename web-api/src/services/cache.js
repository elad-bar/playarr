/**
 * Cache service for in-memory caching of frequently accessed data
 * Used for titles, categories, and stats
 */
class CacheService {
  constructor() {
    this._titlesCache = null;
    this._categoriesCache = {}; // provider -> categories
    this._statsCache = null;
    this._cacheTimestamps = {
      titles: null,
      categories: {},
      stats: null,
    };
  }

  /**
   * Get cached titles
   */
  getTitles() {
    return this._titlesCache;
  }

  /**
   * Set titles cache
   */
  setTitles(titles) {
    this._titlesCache = titles;
    this._cacheTimestamps.titles = Date.now();
  }

  /**
   * Clear titles cache
   */
  clearTitles() {
    this._titlesCache = null;
    this._cacheTimestamps.titles = null;
  }

  /**
   * Get cached categories for provider
   */
  getCategories(providerId) {
    return this._categoriesCache[providerId] || null;
  }

  /**
   * Set categories cache for provider
   */
  setCategories(providerId, categories) {
    this._categoriesCache[providerId] = categories;
    this._cacheTimestamps.categories[providerId] = Date.now();
  }

  /**
   * Clear categories cache for provider
   */
  clearCategories(providerId) {
    if (providerId) {
      delete this._categoriesCache[providerId];
      delete this._cacheTimestamps.categories[providerId];
    } else {
      // Clear all categories
      this._categoriesCache = {};
      this._cacheTimestamps.categories = {};
    }
  }

  /**
   * Get cached stats
   */
  getStats() {
    return this._statsCache;
  }

  /**
   * Set stats cache
   */
  setStats(stats) {
    this._statsCache = stats;
    this._cacheTimestamps.stats = Date.now();
  }

  /**
   * Clear stats cache
   */
  clearStats() {
    this._statsCache = null;
    this._cacheTimestamps.stats = null;
  }

  /**
   * Clear all caches
   */
  clearAll() {
    this.clearTitles();
    this.clearCategories();
    this.clearStats();
  }

  /**
   * Get cache timestamp for entity
   */
  getCacheTimestamp(entity, providerId = null) {
    if (entity === 'categories' && providerId) {
      return this._cacheTimestamps.categories[providerId] || null;
    }
    return this._cacheTimestamps[entity] || null;
  }
}

// Export singleton instance
export const cacheService = new CacheService();

