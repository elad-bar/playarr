import { BaseJob } from './BaseJob.js';

/**
 * Job for processing provider titles (fetching metadata from IPTV providers)
 * Handles fetching categories and metadata from all configured IPTV providers
 * @extends {BaseJob}
 */
export class ProcessProvidersTitlesJob extends BaseJob {
  /**
   * @param {import('../managers/StorageManager.js').StorageManager} cache - Storage manager instance for temporary cache
   * @param {import('../managers/StorageManager.js').StorageManager} data - Storage manager instance for persistent data storage
   * @param {Map<string, import('../providers/BaseIPTVProvider.js').BaseIPTVProvider>} providers - Map of providerId -> provider instance (already initialized)
   * @param {import('../providers/TMDBProvider.js').TMDBProvider} tmdbProvider - TMDB provider singleton instance
   */
  constructor(cache, data, providers, tmdbProvider) {
    super('ProcessProvidersTitlesJob', cache, data, providers, tmdbProvider);
  }

  /**
   * Execute the job - fetch categories and metadata from all IPTV providers
   * @returns {Promise<Array<{providerId: string, providerName: string, movies?: number, tvShows?: number, error?: string}>>} Array of fetch results
   */
  async execute() {
    this._validateDependencies();

    // Fetch categories from all providers first
    await this.fetchAllCategories();

    // Then fetch metadata from all providers
    const results = await this.fetchAllMetadata();

    return results;
  }

  /**
   * Fetch categories from a provider instance
   * @param {import('../providers/BaseIPTVProvider.js').BaseIPTVProvider} providerInstance - Provider instance
   * @param {string} providerId - Provider ID
   * @returns {Promise<{movieCats: Array, tvShowCats: Array}>} Categories for movies and TV shows
   */
  async fetchCategoriesFromProvider(providerInstance, providerId) {
    try {
      this.logger.debug(`Fetching categories from provider ${providerId}...`);
      const [movieCats, tvShowCats] = await Promise.all([
        providerInstance.fetchCategories('movies').catch(() => []),
        providerInstance.fetchCategories('tvshows').catch(() => [])
      ]);
      this.logger.info(`Found ${movieCats.length} movie categories, ${tvShowCats.length} TV show categories`);
      return { movieCats, tvShowCats };
    } catch (error) {
      this.logger.error(`Error fetching categories from ${providerId}: ${error.message}`);
      return { movieCats: [], tvShowCats: [] };
    }
  }

  /**
   * Fetch categories from all providers
   * @returns {Promise<void>}
   */
  async fetchAllCategories() {
    this.logger.info(`Fetching categories from ${this.providers.size} provider(s)...`);
    
    for (const [providerId, providerInstance] of this.providers) {
      await this.fetchCategoriesFromProvider(providerInstance, providerId);
    }
  }

  /**
   * Fetch titles metadata (movies and TV shows) from a specific provider instance
   * Fetches movies and TV shows in parallel for better performance
   * @param {import('../providers/BaseIPTVProvider.js').BaseIPTVProvider} providerInstance - Provider instance (AGTVProvider or XtreamProvider)
   * @param {string} providerId - Provider ID
   * @returns {Promise<{movies: number, tvShows: number}>} Count of fetched movies and TV shows
   */
  async fetchMetadataFromProvider(providerInstance, providerId) {
    // Fetch and save movies and TV shows metadata in parallel
    this.logger.info(`Fetching metadata from provider ${providerId}...`);
    
    const [moviesCount, tvShowsCount] = await Promise.all([
      providerInstance.fetchMetadata('movies').catch(err => {
        this.logger.error(`[${providerId}] Error fetching movies: ${err.message}`);
        return 0;
      }),
      providerInstance.fetchMetadata('tvshows').catch(err => {
        this.logger.error(`[${providerId}] Error fetching TV shows: ${err.message}`);
        return 0;
      })
    ]);

    return {
      movies: moviesCount,
      tvShows: tvShowsCount
    };
  }

  /**
   * Fetch metadata from all providers
   * @returns {Promise<Array<{providerId: string, providerName: string, movies?: number, tvShows?: number, error?: string}>>} Array of fetch results
   */
  async fetchAllMetadata() {
    this.logger.info(`Starting metadata fetch process for ${this.providers.size} provider(s)...`);
    const results = [];

    for (const [providerId, providerInstance] of this.providers) {
      try {
        this.logger.debug(`[${providerId}] Processing provider (${providerInstance.getProviderType()})`);
        const result = await this.fetchMetadataFromProvider(providerInstance, providerId);
        results.push({
          providerId,
          providerName: providerId,
          ...result
        });
      } catch (error) {
        this.logger.error(`[${providerId}] Error processing provider: ${error.message}`);
        results.push({
          providerId,
          providerName: providerId,
          error: error.message
        });
      }
    }

    return results;
  }
}

