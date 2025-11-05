/**
 * Generic in-memory cache service
 * Provides key-value caching for any data type
 */
class CacheService {
  constructor() {
    this._cache = new Map(); // key -> value
  }

  /**
   * Get cached value by key
   * @param {string} key - Cache key
   * @returns {*} Cached value or undefined if not found
   */
  get(key) {
    return this._cache.get(key);
  }

  /**
   * Set cached value by key
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   */
  set(key, value) {
    this._cache.set(key, value);
  }

  /**
   * Delete cached value by key
   * @param {string} key - Cache key
   * @returns {boolean} True if key existed and was deleted, false otherwise
   */
  delete(key) {
    return this._cache.delete(key);
  }

  /**
   * Check if key exists in cache
   * @param {string} key - Cache key
   * @returns {boolean} True if key exists, false otherwise
   */
  has(key) {
    return this._cache.has(key);
  }

  /**
   * Clear all cache entries
   */
  clear() {
    this._cache.clear();
  }
}

// Export class only
export { CacheService };
