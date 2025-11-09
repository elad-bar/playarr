import { BaseProvider } from './BaseProvider.js';
import { createLogger } from '../utils/logger.js';
import { extractYearFromTitle, extractBaseTitle, extractYearFromReleaseDate, generateTitleKey } from '../utils/titleUtils.js';

/**
 * TMDB API provider
 * Singleton pattern - only one instance should exist
 * Provides TMDB API integration for metadata enrichment
 */
export class TMDBProvider extends BaseProvider {
  static instance = null;

  /**
   * Get or create the singleton instance of TMDBProvider
   * @param {import('../managers/StorageManager.js').StorageManager} cache - Storage manager instance for temporary cache
   * @param {import('../services/MongoDataService.js').MongoDataService} mongoData - MongoDB data service instance
   * @param {Object} settings - Settings object (loaded from MongoDB at higher level)
   * @returns {Promise<TMDBProvider>} Singleton instance
   */
  static async getInstance(cache, mongoData, settings = {}) {
    if (!TMDBProvider.instance) {
      const providerData = {
        id: 'tmdb',
        type: 'tmdb',
        api_rate: settings.tmdb_api_rate,
        token: settings.tmdb_token
      };

      TMDBProvider.instance = new TMDBProvider(providerData, cache, mongoData);
      
      // Initialize cache policies
      await TMDBProvider.instance.initializeCachePolicies();
    }
    return TMDBProvider.instance;
  }

  /**
   * Private constructor - use getInstance() instead
   * @param {Object} providerData - Provider configuration data
   * @param {import('../managers/StorageManager.js').StorageManager} cache - Storage manager instance for temporary cache
   * @param {import('../services/MongoDataService.js').MongoDataService} mongoData - MongoDB data service instance
   */
  constructor(providerData, cache, mongoData) {
    super(providerData, cache, 'TMDB');
    if (!mongoData) {
      throw new Error('MongoDataService is required');
    }
    this.mongoData = mongoData;
    this.apiBaseUrl = 'https://api.themoviedb.org/3';
    this.apiToken = providerData.token;
    
    // In-memory cache for main titles
    // Loaded once at the start of job execution and kept in memory
    this._mainTitlesCache = null;
    
    /**
     * Configuration for each media type
     * @private
     * @type {Object<string, Object>}
     */
    this._typeConfig = {
      movies: {
        buildStreams: this._buildMovieStreams.bind(this),
        tvgType: 'movie'
      },
      tvshows: {
        buildStreams: this._buildTVShowStreams.bind(this),
        tvgType: 'series'
      }
    };
  }

  /**
   * Get default cache policies for TMDB provider
   * @returns {Object} Cache policy object
   */
  getDefaultCachePolicies() {
    return {
      'tmdb/search/movie': null,           // Never expire
      'tmdb/search/tv': null,              // Never expire
      'tmdb/find/imdb': null,              // Never expire
      'tmdb/movie/details': null,           // Never expire
      'tmdb/tv/details': null,             // Never expire
      'tmdb/tv/season': 6,                 // 6 hours
      'tmdb/movie/similar': null,          // Never expire
      'tmdb/tv/similar': null,            // Never expire
    };
  }

  /**
   * Get the provider type identifier
   * @returns {string} 'tmdb'
   */
  getProviderType() {
    return 'tmdb';
  }

  /**
   * Build TMDB API URL with authentication
   * @param {string} endpoint - API endpoint (e.g., '/movie/123')
   * @param {Object} [params={}] - Query parameters
   * @returns {string} Complete API URL
   */
  _buildApiUrl(endpoint, params = {}) {
    const url = new URL(`${this.apiBaseUrl}${endpoint}`);
    // Note: Authentication is done via Bearer token in headers, not query parameter
    
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, value);
      }
    }
    
    return url.toString();
  }

  /**
   * Get authentication headers for TMDB API requests
   * @returns {Object} Headers object with Authorization Bearer token
   */
  _getAuthHeaders() {
    return {
      'Authorization': `Bearer ${this.apiToken}`,
      'Accept': 'application/json'
    };
  }

  /**
   * Search for a movie or TV show by title
   * @param {string} type - Media type: 'movie' or 'tv'
   * @param {string} title - Title to search for
   * @param {number} [year] - Optional release year (for movies) or first air date year (for TV shows)
   * @returns {Promise<Object>} TMDB search results
   */
  async search(type, title, year = null) {
    const endpoint = type === 'movie' ? '/search/movie' : '/search/tv';
    const params = { query: title };
    
    if (year) {
      if (type === 'movie') {
        params.year = year;
      } else {
        params.first_air_date_year = year;
      }
    }
    
    const url = this._buildApiUrl(endpoint, params);
    return await this.fetchWithCache(
      url,
      ['tmdb', type,'search', `${title}_${year || 'no-year'}.json`],
      null, // Cache forever (null = Infinity)
      false, // forceRefresh
      { headers: this._getAuthHeaders() }
    );
  }

  /**
   * Search for a movie by title
   * @param {string} title - Movie title to search for
   * @param {number} [year] - Optional release year
   * @returns {Promise<Object>} TMDB search results
   */
  async searchMovie(title, year = null) {
    return await this.search('movie', title, year);
  }

  /**
   * Search for a TV show by title
   * @param {string} title - TV show title to search for
   * @param {number} [year] - Optional first air date year
   * @returns {Promise<Object>} TMDB search results
   */
  async searchTVShow(title, year = null) {
    return await this.search('tv', title, year);
  }

  /**
   * Find TMDB ID by IMDB ID (returns both movies and TV shows)
   * Note: TMDB find endpoint returns both movie_results and tv_results
   * @param {string} imdbId - IMDB ID (e.g., 'tt0133093')
   * @returns {Promise<Object>} TMDB find results with movie_results and tv_results arrays
   */
  async findByIMDBId(imdbId, type) {
    const url = this._buildApiUrl('/find/' + imdbId, {
      external_source: 'imdb_id'
    });

    const type_caches_mapping = {
      'movies': 'movie',
      'tvshows': 'tv'
    };

    const type_cache_key = type_caches_mapping[type];
    const cache_key = ['tmdb', type_cache_key, 'imdb', `${imdbId}.json`];

    return await this.fetchWithCache(
      url,
      cache_key,
      null, // Cache forever (null = Infinity)
      false, // forceRefresh
      { headers: this._getAuthHeaders() }
    );
  }

  
  /**
   * Get details by TMDB ID (movies or TV shows)
   * @param {string} type - Media type: 'movie' or 'tv'
   * @param {number} tmdbId - TMDB ID
   * @returns {Promise<Object>} Media details
   */
  async getDetails(type, tmdbId) {
    const endpoint = type === 'movie' ? `/movie/${tmdbId}` : `/tv/${tmdbId}`;
    const url = this._buildApiUrl(endpoint);
    
    return await this.fetchWithCache(
      url,
      ['tmdb', type, 'details', `${tmdbId}.json`],
      null, // Cache forever (null = Infinity)
      false, // forceRefresh
      { headers: this._getAuthHeaders() }
    );
  }

  /**
   * Get movie details by TMDB ID
   * @param {number} tmdbId - TMDB movie ID
   * @returns {Promise<Object>} Movie details
   */
  async getMovieDetails(tmdbId) {
    return await this.getDetails('movie', tmdbId);
  }

  /**
   * Get TV show details by TMDB ID
   * @param {number} tmdbId - TMDB TV show ID
   * @returns {Promise<Object>} TV show details
   */
  async getTVShowDetails(tmdbId) {
    return await this.getDetails('tv', tmdbId);
  }

  /**
   * Get TV show season details by TMDB ID and season number
   * @param {number} tmdbId - TMDB TV show ID
   * @param {number} seasonNumber - Season number
   * @returns {Promise<Object>} Season details
   */
  async getTVShowSeasonDetails(tmdbId, seasonNumber) {
    const url = this._buildApiUrl(`/tv/${tmdbId}/season/${seasonNumber}`);
    
    return await this.fetchWithCache(
      url,
      ['tmdb', 'tv', 'season', `${tmdbId}-S${seasonNumber}.json`],
      6, // Cache for 6 hours
      false, // forceRefresh
      { headers: this._getAuthHeaders() }
    );
  }

  /**
   * Get similar movies or TV shows by TMDB ID
   * @param {string} type - Media type: 'movie' or 'tv'
   * @param {number} tmdbId - TMDB ID
   * @param {number} [page=1] - Page number for pagination
   * @returns {Promise<Object>} Similar media results with pagination info
   */
  async getSimilar(type, tmdbId, page = 1) {
    const endpoint = type === 'movie' 
      ? `/movie/${tmdbId}/similar` 
      : `/tv/${tmdbId}/similar`;
    
    const url = this._buildApiUrl(endpoint, { page });
    
    return await this.fetchWithCache(
      url,
      ['tmdb', type, 'similar', `${tmdbId}-${page}.json`],
      null, // Cache forever (null = Infinity)
      false, // forceRefresh
      { headers: this._getAuthHeaders() }
    );
  }

  /**
   * Get all similar titles across multiple pages with pagination handling
   * @param {string} type - Media type: 'movie' or 'tv'
   * @param {number} tmdbId - TMDB ID
   * @param {number} [maxPages=10] - Maximum number of pages to fetch
   * @returns {Promise<Array<Object>>} Array of similar title objects (from response.results)
   */
  async getSimilarAllPages(type, tmdbId, maxPages = 10) {
    const allResults = [];
    let page = 1;
    let consecutiveFailures = 0;

    while (page <= maxPages) {
      try {
        const response = await this.getSimilar(type, tmdbId, page);
        if (!response?.results) break;

        allResults.push(...response.results);
        consecutiveFailures = 0;

        const totalPages = response.total_pages || 1;
        if (page >= totalPages || page >= maxPages) break;
        page++;
      } catch (error) {
        consecutiveFailures++;
        
        if (consecutiveFailures >= 3) {
          this.logger.warn(`Failed 3 times in a row for ${type} ID ${tmdbId}, returning ${allResults.length} similar titles`);
          break;
        } else {
          this.logger.warn(`Error fetching similar titles page ${page} for ${type} ID ${tmdbId}: ${error.message}`);
        }

        page++;
      }
    }

    return allResults;
  }

  /**
   * Get similar title IDs filtered by available titles
   * Fetches similar titles from TMDB API and filters to only include titles that exist in the available set
   * Returns title_keys for the filtered similar titles
   * @param {string} tmdbType - TMDB media type: 'movie' or 'tv'
   * @param {number} tmdbId - TMDB ID
   * @param {Set<number>} availableTitleIds - Set of available TMDB IDs to filter against
   * @param {string} type - Media type ('movies' or 'tvshows') for title key generation
   * @param {number} [maxPages=10] - Maximum number of pages to fetch
   * @returns {Promise<Array<string>>} Array of title_keys for similar titles that exist in availableTitleIds
   */
  async getSimilarTitleKeys(tmdbType, tmdbId, availableTitleIds, type, maxPages = 10) {
    // Get all similar titles across pages (pagination handled internally)
    const allResults = await this.getSimilarAllPages(tmdbType, tmdbId, maxPages);

    // Filter results to only include titles that exist in main titles
    // Convert matching IDs to title_keys
    const similarTitleKeys = allResults
      .map(result => result.id)
      .filter(id => availableTitleIds.has(id))
      .map(id => generateTitleKey(type, id));

    return similarTitleKeys;
  }

  /**
   * Load all main titles from MongoDB into memory cache
   * Should be called once at the start of job execution
   * @param {Object} [query={}] - Optional MongoDB query to filter titles
   * @returns {Promise<Array<Object>>} Array of all main title objects
   */
  async loadMainTitles(query = {}) {
    try {
      const allMainTitles = await this.mongoData.getMainTitles(query);
      this._mainTitlesCache = allMainTitles;
      return allMainTitles;
    } catch (error) {
      this.logger.error(`Error loading main titles from MongoDB: ${error.message}`);
      this._mainTitlesCache = [];
      return [];
    }
  }

  /**
   * Get all main titles from memory cache
   * If cache is not loaded, returns empty array (should call loadMainTitles first)
   * @returns {Array<Object>} Array of all main title objects
   */
  getMainTitles() {
    if (this._mainTitlesCache === null) {
      this.logger.warn('Main titles cache not loaded. Call loadMainTitles() first.');
      this._mainTitlesCache = [];
      return [];
    }
    return this._mainTitlesCache;
  }

  /**
   * Get main titles by title_key array (efficient lookup)
   * @param {Array<string>} titleKeys - Array of title_key values
   * @returns {Promise<Array<Object>>} Array of main title objects
   */
  async getMainTitlesByKeys(titleKeys) {
    try {
      return await this.mongoData.getMainTitlesByKeys(titleKeys);
    } catch (error) {
      this.logger.error(`Error loading main titles by keys from MongoDB: ${error.message}`);
      return [];
    }
  }

  /**
   * Unload main titles from memory cache
   * Clears in-memory cache to free memory after job execution
   * Safe to call multiple times (idempotent)
   */
  unloadMainTitles() {
    this._mainTitlesCache = null;
    this.logger.debug('Unloaded main titles from memory cache');
  }

  /**
   * Enrich main titles with similar titles
   * Fetches similar titles from TMDB API, filters to only include titles available in main titles,
   * and stores the filtered title_keys under the 'similar' property as an array
   * @returns {Promise<void>}
   */
  async enrichSimilarTitles() {
    this.logger.info('Starting similar titles enrichment process...');
    const batchSize = this.getRecommendedBatchSize();

    // Process all titles together
    await this._enrichSimilarTitles(batchSize);

    this.logger.info('Similar titles enrichment completed');
  }

  /**
   * Enrich similar titles for all main titles
   * @private
   * @param {number} batchSize - Batch size for processing
   * @returns {Promise<void>}
   */
  async _enrichSimilarTitles(batchSize) {
    // Get main titles from memory cache
    const allMainTitles = this.getMainTitles();
    
    if (allMainTitles.length === 0) {
      this.logger.info('No main titles found for similar titles enrichment');
      return;
    }

    // Filter to only process newly created titles (createdAt == lastUpdated)
    // Titles without similar data that aren't newly created were already processed
    // and just didn't find matches, so we skip them to avoid unnecessary API calls
    const titlesToProcess = allMainTitles.filter(title => {
      // Skip titles without createdAt or lastUpdated (legacy data)
      if (!title.createdAt || !title.lastUpdated) {
        return false;
      }
      
      // Skip titles that already have similar data (already processed)
      if (title.similar !== undefined) {
        return false;
      }
      
      // Only process if title was just created (createdAt == lastUpdated)
      return title.createdAt === title.lastUpdated;
    });

    if (titlesToProcess.length === 0) {
      this.logger.info('No titles need similar titles enrichment (no newly created titles)');
      return;
    }

    // Create a Set of available title_ids for fast lookup (for filtering similar titles)
    // Include all titles, not just one type
    const availableTitleIds = new Set(allMainTitles.map(t => t.title_id));
    
    // Create a Set of available title_keys for matching similar titles
    const availableTitleKeys = new Set(allMainTitles.map(t => t.title_key || generateTitleKey(t.type, t.title_id)));
    
    this.logger.info(`Enriching similar titles for ${titlesToProcess.length} newly created titles (${allMainTitles.length - titlesToProcess.length} skipped)...`);

    const updatedTitles = [];
    let processedCount = 0;

    // Load existing main titles to preserve other properties
    const existingMainTitleMap = new Map(
      allMainTitles.map(t => [t.title_key || generateTitleKey(t.type, t.title_id), t])
    );

    // Save callback for progress tracking
    const saveCallback = async () => {
      if (updatedTitles.length > 0) {
        try {
          await this._saveMainTitles(updatedTitles, existingMainTitleMap);
          this.logger.debug(`Saved ${updatedTitles.length} accumulated titles with similar titles via progress callback`);
          updatedTitles.length = 0; // Clear after saving
        } catch (error) {
          this.logger.error(`Error saving accumulated titles: ${error.message}`);
        }
      }
    };

    // Register for progress tracking
    const progressKey = 'similar_titles';
    let totalRemaining = titlesToProcess.length;
    this.registerProgress(progressKey, totalRemaining, saveCallback);

    try {
      // Process in batches
      for (let i = 0; i < titlesToProcess.length; i += batchSize) {
        const batch = titlesToProcess.slice(i, i + batchSize);

        await Promise.all(batch.map(async (mainTitle) => {
          try {
            // Determine tmdbType from each title's type
            const tmdbType = mainTitle.type === 'movies' ? 'movie' : 'tv';
            const type = mainTitle.type;
            
            const similarTitleIds = await this.getSimilarTitleKeys(
              tmdbType,
              mainTitle.title_id,
              availableTitleIds,
              type
            );

            const titleKey = mainTitle.title_key || generateTitleKey(mainTitle.type, mainTitle.title_id);
            
            // Create updated title with similar titles (store as title_keys)
            const updatedTitle = {
              ...existingMainTitleMap.get(titleKey) || mainTitle,
              similar: similarTitleIds,
              lastUpdated: new Date().toISOString() // Update lastUpdated to mark as processed
            };

            updatedTitles.push(updatedTitle);
            processedCount++;
          } catch (error) {
            const titleKey = mainTitle.title_key || generateTitleKey(mainTitle.type, mainTitle.title_id);
            this.logger.error(`Error enriching similar titles for ID ${mainTitle.title_id}: ${error.message}`);
            // Still add the title without similar titles to preserve it
            const existingTitle = existingMainTitleMap.get(titleKey) || mainTitle;
            if (!existingTitle.similar) {
              existingTitle.similar = [];
            }
            // Update lastUpdated even on error to prevent reprocessing
            existingTitle.lastUpdated = new Date().toISOString();
            updatedTitles.push(existingTitle);
          }
        }));

        totalRemaining = titlesToProcess.length - processedCount;
        this.updateProgress(progressKey, totalRemaining);

        // Log progress
        if ((i + batchSize) % 100 === 0 || i + batchSize >= titlesToProcess.length) {
          this.logger.debug(
            `Progress: ${Math.min(i + batchSize, titlesToProcess.length)}/${titlesToProcess.length} titles processed for similar titles enrichment`
          );
        }
      }
    } finally {
      // Save any remaining accumulated titles
      await saveCallback();
      
      // Unregister from progress tracking
      this.unregisterProgress(progressKey);
    }

    // Final save to ensure all titles are saved
    if (updatedTitles.length > 0) {
      await this._saveMainTitles(updatedTitles, existingMainTitleMap);
    }

    this.logger.info(`Similar titles enrichment completed for ${processedCount} titles`);
  }

  /**
   * Process main titles: generate, enrich similar, and generate streams
   * Orchestrates the complete main title processing workflow after TMDB ID matching
   * @param {Map<string, Array<Object>>} providerTitlesByProvider - Map of providerId -> titles array
   * @returns {Promise<{movies: number, tvShows: number}>} Count of generated main titles by type
   */
  async processMainTitles(providerTitlesByProvider) {
    if (!providerTitlesByProvider || providerTitlesByProvider.size === 0) {
      this.logger.warn('No provider titles available for main title processing.');
      return { movies: 0, tvShows: 0 };
    }

    // Generate main titles from provider titles with TMDB IDs
    // Streams dictionary is now saved during title generation in _generateMainTitles
    const result = await this.generateMainTitles(providerTitlesByProvider);

    // Run enrichSimilarTitles
    await this.enrichSimilarTitles();

    return result;
  }

  /**
   * Generate main titles from all provider titles with TMDB IDs
   * Groups provider titles by TMDB ID and creates main titles using TMDB API data
   * @param {Map<string, Array<Object>>} providerTitlesByProvider - Map of providerId -> titles array
   * @returns {Promise<{movies: number, tvShows: number}>} Count of generated main titles by type for reporting
   */
  async generateMainTitles(providerTitlesByProvider) {
    if (!providerTitlesByProvider || providerTitlesByProvider.size === 0) {
      this.logger.warn('No providers available for main title generation.');
      return { movies: 0, tvShows: 0 };
    }

    this.logger.info('Starting main title generation process...');
    const batchSize = this.getRecommendedBatchSize();

    // Group all titles by TMDB ID (key: {type}-{tmdbId}, value: {type, providerTitleGroups})
    const providerTitlesByTMDB = new Map(); // Map<string, {type: string, providerTitleGroups: Array<{providerId, title}>}>

    for (const [providerId, allTitles] of providerTitlesByProvider) {
      for (const title of allTitles) {
        if (title.tmdb_id && title.type) {
          const tmdbId = title.tmdb_id;
          const type = title.type;
          const key = `${type}-${tmdbId}`;
          
          if (!providerTitlesByTMDB.has(key)) {
            providerTitlesByTMDB.set(key, {
              type,
              providerTitleGroups: []
            });
          }
          
          providerTitlesByTMDB.get(key).providerTitleGroups.push({
            providerId,
            title
          });
        }
      }
    }

    // Get existing main titles from memory cache
    const allMainTitles = this.getMainTitles();
    const existingMainTitleMap = new Map(
      allMainTitles.map(t => [t.title_key || generateTitleKey(t.type, t.title_id), t])
    );

    // Process all titles together
    const countsByType = await this._generateMainTitles(batchSize, providerTitlesByTMDB, existingMainTitleMap);

    const totalCount = countsByType.movies + countsByType.tvShows;
    this.logger.info(
      `Main title generation completed: ${totalCount} titles processed`
    );

    return { movies: countsByType.movies, tvShows: countsByType.tvShows };
  }

  /**
   * Check if main title needs regeneration based on provider title updates
   * @private
   * @param {Object|null} existingMainTitle - Existing main title or null
   * @param {Array<Object>} providerTitleGroups - Array of provider title groups
   * @returns {boolean} True if regeneration is needed
   */
  _needsRegeneration(existingMainTitle, providerTitleGroups) {
    // If main title doesn't exist, needs regeneration
    if (!existingMainTitle || !existingMainTitle.lastUpdated) {
      return true;
    }

    const mainLastUpdated = new Date(existingMainTitle.lastUpdated).getTime();

    // Check if any provider title has been updated after main title
    for (const group of providerTitleGroups) {
      const providerLastUpdated = group.title.lastUpdated 
        ? new Date(group.title.lastUpdated).getTime() 
        : 0;
      
      if (providerLastUpdated > mainLastUpdated) {
        return true; // At least one provider title is newer
      }
    }

    return false; // All provider titles are older or equal to main title
  }

  /**
   * Generate main titles from provider titles grouped by TMDB ID
   * @private
   * @param {number} batchSize - Batch size for processing
   * @param {Map<string, {type: string, providerTitleGroups: Array}>} providerTitlesByTMDB - Pre-grouped provider titles by {type}-{tmdbId} key
   * @param {Map<string, Object>} existingMainTitleMap - Map of existing main titles by title_key
   * @returns {Promise<{movies: number, tvShows: number}>} Count of generated main titles by type for reporting
   */
  async _generateMainTitles(batchSize, providerTitlesByTMDB, existingMainTitleMap) {
    if (providerTitlesByTMDB.size === 0) {
      this.logger.info('No titles with TMDB IDs found for main title generation');
      return { movies: 0, tvShows: 0 };
    }

    // Filter titles that need regeneration
    const titlesToProcess = [];
    let skippedCount = 0;
    
    for (const [key, value] of providerTitlesByTMDB) {
      const { type, providerTitleGroups } = value;
      const match = key.match(/^(movies|tvshows)-(\d+)$/);
      if (!match) continue;
      
      const tmdbId = parseInt(match[2], 10);
      const titleKey = generateTitleKey(type, tmdbId);
      const existingMainTitle = existingMainTitleMap.get(titleKey);
      
      if (this._needsRegeneration(existingMainTitle, providerTitleGroups)) {
        titlesToProcess.push({ key, type, tmdbId, providerTitleGroups });
      } else {
        skippedCount++;
      }
    }
    
    if (skippedCount > 0) {
      this.logger.debug(`Skipping ${skippedCount} main titles (no provider updates since last generation)`);
    }
    
    if (titlesToProcess.length === 0) {
      this.logger.info('No main titles need regeneration');
      return { movies: 0, tvShows: 0 };
    }
    
    this.logger.info(`Generating ${titlesToProcess.length} main titles (${skippedCount} skipped)...`);

    const mainTitles = [];
    let processedCount = 0;
    const processedCountByType = { movies: 0, tvShows: 0 };

    // Accumulate streams as array of stream documents
    const allStreams = [];

    // Track remaining titles for progress
    let totalRemaining = titlesToProcess.length;

    // Save callback for progress tracking
    const saveCallback = async () => {
      // Save main titles
      if (mainTitles.length > 0) {
        try {
          await this._saveMainTitles(mainTitles, existingMainTitleMap);
          this.logger.debug(`Saved ${mainTitles.length} accumulated main titles via progress callback`);
          mainTitles.length = 0; // Clear after saving
        } catch (error) {
          this.logger.error(`Error saving accumulated main titles: ${error.message}`);
        }
      }
      
      // Save streams to MongoDB
      if (allStreams.length > 0) {
        try {
          const result = await this.mongoData.saveTitleStreams(allStreams);
          this.logger.debug(`Saved ${result.inserted + result.updated} accumulated stream entries via progress callback (${result.inserted} inserted, ${result.updated} updated)`);
          // Clear saved streams
          allStreams.length = 0;
        } catch (error) {
          this.logger.error(`Error saving accumulated streams: ${error.message}`);
        }
      }
    };

    // Register for progress tracking
    const progressKey = 'main_titles';
    this.registerProgress(progressKey, totalRemaining, saveCallback);

    try {
      // Process in batches
      for (let i = 0; i < titlesToProcess.length; i += batchSize) {
        const batch = titlesToProcess.slice(i, i + batchSize);

        await Promise.all(batch.map(async ({ type, tmdbId, providerTitleGroups }) => {
          const result = await this.generateMainTitle(
            tmdbId,
            type,
            providerTitleGroups
          );

          if (result && result.mainTitle) {
            const mainTitle = result.mainTitle;
            
            // Type and title_key should already be set by TMDBProvider, but ensure they exist
            if (!mainTitle.type) mainTitle.type = type;
            if (!mainTitle.title_key) mainTitle.title_key = generateTitleKey(type, tmdbId);
            
            // Preserve createdAt if title already exists
            const titleKey = mainTitle.title_key;
            const existing = existingMainTitleMap.get(titleKey);
            if (existing && existing.createdAt) {
              mainTitle.createdAt = existing.createdAt;
            }
            
            mainTitles.push(mainTitle);
            
            // Convert streams dictionary to stream documents and accumulate
            if (result.streamsDict) {
              const streamDocs = this._convertStreamsDictToDocuments(result.streamsDict);
              allStreams.push(...streamDocs);
            }
            
            processedCount++;
            
            // Track by type for return value
            if (type === 'movies') processedCountByType.movies++;
            else if (type === 'tvshows') processedCountByType.tvShows++;
          }
        }));

        totalRemaining = titlesToProcess.length - processedCount;
        this.updateProgress(progressKey, totalRemaining);

        // Log progress
        if ((i + batchSize) % 100 === 0 || i + batchSize >= titlesToProcess.length) {
          this.logger.debug(
            `Progress: ${Math.min(i + batchSize, titlesToProcess.length)}/${titlesToProcess.length} main titles processed`
          );
        }
      }
    } finally {
      // Save any remaining accumulated titles
      await saveCallback();
      
      // Unregister from progress tracking
      this.unregisterProgress(progressKey);
    }

    // Final save to ensure all titles are saved
    if (mainTitles.length > 0) {
      await this._saveMainTitles(mainTitles, existingMainTitleMap);
    }

    // Final save of streams to MongoDB
    if (allStreams.length > 0) {
      try {
        const result = await this.mongoData.saveTitleStreams(allStreams);
        this.logger.info(`Saved ${result.inserted + result.updated} stream entries to MongoDB (${result.inserted} inserted, ${result.updated} updated)`);
      } catch (error) {
        this.logger.error(`Error saving streams to MongoDB: ${error.message}`);
      }
    }

    // Refresh API cache after both titles and streams are saved
    await this.refreshAPICache('titles');

    return processedCountByType;
  }

  /**
   * Convert streams dictionary to MongoDB stream documents
   * Dictionary format: { "movies-12345-main-providerId": streamObj, ... }
   * @private
   * @param {Object} streamsDict - Dictionary of stream entries
   * @returns {Array<Object>} Array of stream documents for MongoDB
   */
  _convertStreamsDictToDocuments(streamsDict) {
    const streamDocs = [];
    
    for (const [streamKey, streamObj] of Object.entries(streamsDict)) {
      // Parse streamKey: "type-tmdb_id-stream_id-provider_id"
      const parts = streamKey.split('-');
      if (parts.length < 4) {
        this.logger.warn(`Invalid stream key format: ${streamKey}`);
        continue;
      }
      
      const type = parts[0]; // 'movies' or 'tvshows'
      const tmdbId = parts[1];
      const streamId = parts[2];
      const providerId = parts.slice(3).join('-'); // Handle provider IDs with dashes
      
      // Generate title_key
      const titleKey = generateTitleKey(type, tmdbId);
      
      // Create stream document
      const streamDoc = {
        title_key: titleKey,
        stream_id: streamId,
        provider_id: providerId,
        ...streamObj
      };
      
      streamDocs.push(streamDoc);
    }
    
    return streamDocs;
  }

  /**
   * Extract streams dictionary entries for a single main title
   * @private
   * @param {Object} mainTitle - Main title object
   * @param {Array<Object>} providerTitleGroups - Array of objects with { providerId, title } structure
   * @returns {Object} Dictionary of stream entries
   */
  _extractMainTitleStreamsDict(mainTitle, providerTitleGroups) {
    const { type, title_id, title, release_date, poster_path, genres, streams } = mainTitle;
    
    const streamsDict = {};
    
    if (!streams || Object.keys(streams).length === 0) {
      return streamsDict;
    }

    // Extract year from release_date
    const year = release_date ? release_date.split('-')[0] : '';
    const titleWithYear = year ? `${title} (${year})` : title;
    
    // Extract genre names from objects with id and name
    const genreNames = (genres || [])
      .map(g => g.name)
      .filter(Boolean)
      .join(', ');
    
    // Process each stream
    for (const [streamId, streamData] of Object.entries(streams)) {
      // Get provider IDs from stream data
      let providerIds = [];
      if (Array.isArray(streamData)) {
        providerIds = streamData;
      } else if (streamData && typeof streamData === 'object' && streamData.sources) {
        providerIds = streamData.sources;
      }
      
      if (providerIds.length === 0) {
        continue;
      }

      // Extract season/episode for TV shows
      let seasonNumber = null;
      let episodeNumber = null;
      let tvgId = `tmdb-${title_id}`;
      let tvgName = titleWithYear;
      const tvgType = this._typeConfig[type].tvgType;

      const streamSeasonEpisode = {
        season: null,
        seasonNumber: null,
        episode: null,
        episodeNumber: null,
        cleanStreamId: null
      }

      const tvShowStreamObj = {}
      
      if (type === 'tvshows' && streamId !== 'main') {
        // Parse Sxx-Exx format
        const match = streamId.match(/^S(\d+)-E(\d+)$/);
        if (match) {
          streamSeasonEpisode.season = match[1];
          streamSeasonEpisode.episode = match[2];
          streamSeasonEpisode.seasonNumber = parseInt(match[1], 10);
          streamSeasonEpisode.episodeNumber = parseInt(match[2], 10);
          streamSeasonEpisode.cleanStreamId = streamId.replace("-", "");
          
          tvgId = `tmdb-${title_id}-S${streamSeasonEpisode.cleanStreamId}`;
          tvgName = `${titleWithYear} S${streamSeasonEpisode.cleanStreamId}`;

          tvShowStreamObj['tvg-season-num'] = streamSeasonEpisode.seasonNumber;
          tvShowStreamObj['tvg-episode-num'] = streamSeasonEpisode.episodeNumber;
        }
      }

      // Process each provider for this stream
      for (const providerId of providerIds) {
        // Find provider title from providerTitleGroups
        const providerGroup = providerTitleGroups.find(group => group.providerId === providerId);
        
        if (!providerGroup || !providerGroup.title || 
            !providerGroup.title.streams || 
            !providerGroup.title.streams[streamId]) {
          continue;
        }

        const streamUrl = providerGroup.title.streams[streamId];
        
        // Generate key: type-tmdb_id-stream_id-provider
        const streamKey = `${type}-${title_id}-${streamId}-${providerId}`;
        
        // Generate proxy_path
        let proxyPath = '';
        if (type === 'movies') {
          proxyPath = `${type}/${title} (${year}) [tmdb=${title_id}]/${title} (${year}).strm`;
        } else {
          // TV show
          const seasonStr = `Season ${streamSeasonEpisode.season}`;
          const episodeStr =`S${streamSeasonEpisode.episode}`;
          proxyPath = `${type}/${title} (${year}) [tmdb=${title_id}]/${seasonStr}/${title} (${year}) ${streamId}.strm`;
        }

        // Build stream object
        const streamObj = {
          'tvg-id': tvgId,
          'tvg-name': tvgName,
          'tvg-type': tvgType,
          'tvg-logo': poster_path || '',
          'group-title': genreNames,
          'proxy_url': streamUrl,
          'proxy_path': proxyPath,
          ...tvShowStreamObj
        };

        streamsDict[streamKey] = streamObj;
      }
    }
    
    return streamsDict;
  }

  /**
   * Save main titles to MongoDB
   * Called periodically (every 30 seconds) or at end of process
   * @private
   * @param {Array<Object>} newMainTitles - Array of new main titles to save (can be mixed types)
   * @param {Map<string, Object>} existingMainTitleMap - Map of existing main titles by title_key (unused, kept for compatibility)
   * @returns {Promise<Array<Object>>} Updated titles array
   */
  async _saveMainTitles(newMainTitles, existingMainTitleMap) {
    if (!newMainTitles || newMainTitles.length === 0) {
      return this._mainTitlesCache || [];
    }

    // Ensure all new titles have title_key
    const processedTitles = newMainTitles.map(t => {
      if (!t.title_key && t.type && t.title_id) {
        t.title_key = generateTitleKey(t.type, t.title_id);
      }
      return t;
    }).filter(t => t.title_key);

    if (processedTitles.length === 0) {
      return this._mainTitlesCache || [];
    }

    try {
      // Save to MongoDB using bulk operations
      const result = await this.mongoData.saveMainTitles(processedTitles);
      
      // Reload from MongoDB to get updated cache (includes all titles, not just new ones)
      const allTitles = await this.mongoData.getMainTitles();
      this._mainTitlesCache = allTitles;
      
      this.logger.info(`Saved ${result.inserted + result.updated} main titles to MongoDB (${result.inserted} inserted, ${result.updated} updated, total: ${allTitles.length} titles)`);
      
      return allTitles;
    } catch (error) {
      this.logger.error(`Error saving main titles to MongoDB: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get similar movies by TMDB ID
   * @param {number} tmdbId - TMDB movie ID
   * @returns {Promise<Object>} Similar movies results
   */
  async getSimilarMovies(tmdbId) {
    return await this.getSimilar('movie', tmdbId);
  }

  /**
   * Get similar TV shows by TMDB ID
   * @param {number} tmdbId - TMDB TV show ID
   * @returns {Promise<Object>} Similar TV shows results
   */
  async getSimilarTVShows(tmdbId) {
    return await this.getSimilar('tv', tmdbId);
  }

  /**
   * Get recommended batch size for processing titles based on rate limit configuration
   * The batch size is calculated from the API rate limit settings to optimize throughput
   * while avoiding memory issues. The limiter handles actual rate limiting internally.
   * @returns {number} Recommended batch size for processing
   */
  getRecommendedBatchSize() {
    const rateLimit = this.providerData.api_rate || {};
    const concurrent = rateLimit.concurrent || rateLimit.concurrect || 40; // Default to 40 if not configured
    // Use a reasonable batch size based on rate limit (not too large to avoid memory issues)
    return Math.min(concurrent * 2, 100);
  }

  /**
   * Match TMDB ID for a title using multiple strategies
   * Uses caching internally through fetchWithCache for all API calls
   * @param {Object} title - Title object with title_id, title, etc.
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @param {string} providerType - Provider type ('agtv', 'xtream', etc.)
   * @returns {Promise<number|null>} TMDB ID if matched, null otherwise
   */
  async matchTMDBIdForTitle(title, type, providerType) {
    const tmdbType = type === 'movies' ? 'movie' : 'tv';

    // Strategy 1: For AGTV provider, try using title_id (IMDB ID) directly
    if (providerType === 'agtv' && title.title_id) {
      try {
        // Check if title_id looks like an IMDB ID (starts with 'tt')
        if (title.title_id.startsWith('tt')) {
          const result = await this.findByIMDBId(title.title_id, type);
          
          if (type === 'movies' && result.movie_results && result.movie_results.length > 0) {
            return result.movie_results[0].id;
          } else if (type === 'tvshows' && result.tv_results && result.tv_results.length > 0) {
            return result.tv_results[0].id;
          }
        }
      } catch (error) {
        this.logger.debug(`IMDB ID lookup failed for ${title.title_id}: ${error.message}`);
      }
    }

    // Strategy 2: Search by title name
    if (title.title) {
      try {
        // Prefer release_date year if available (for Xtream providers), otherwise extract from title
        const year = title.release_date 
          ? extractYearFromReleaseDate(title.release_date) 
          : extractYearFromTitle(title.title);
        const baseTitle = extractBaseTitle(title.title);
        
        // Try searching with base title and year first
        let searchResult = await this.search(tmdbType, baseTitle, year);
        
        // If no results with year, try without year
        if (!searchResult.results || searchResult.results.length === 0) {
          searchResult = await this.search(tmdbType, baseTitle, null);
        }
        
        if (searchResult.results && searchResult.results.length > 0) {
          // Return the first result (best match)
          return searchResult.results[0].id;
        }
      } catch (error) {
        this.logger.debug(`Search failed for "${title.title}": ${error.message}`);
      }
    }

    return null;
  }

  /**
   * Generate main title from TMDB API data and provider titles
   * @param {number} tmdbId - TMDB ID
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @param {Array<Object>} providerTitleGroups - Array of objects with { providerId, title } structure
   * @returns {Promise<{mainTitle: Object, streamsDict: Object}|null>} Object with main title and streams dictionary, or null if API call fails
   */
  async generateMainTitle(tmdbId, type, providerTitleGroups) {
    const tmdbType = type === 'movies' ? 'movie' : 'tv';
    
    try {
      // Fetch TMDB details
      const apiData = await this.getDetails(tmdbType, tmdbId);
      
      if (!apiData) {
        this.logger.warn(`No TMDB data found for ${tmdbType} ID ${tmdbId}`);
        return null;
      }

      const now = new Date().toISOString();
      
      // Build base main title structure
      const mainTitle = {
        title_id: tmdbId,
        type: type,
        title_key: generateTitleKey(type, tmdbId),
        title: type === 'movies' ? apiData.title : apiData.name,
        release_date: type === 'movies' ? apiData.release_date : apiData.first_air_date,
        vote_average: apiData.vote_average || null,
        vote_count: apiData.vote_count || null,
        overview: apiData.overview || null,
        poster_path: apiData.poster_path || null,
        genres: apiData.genres || [],
        streams: {},
        createdAt: now,
        lastUpdated: now
      };

      // Process streams based on type
      const typeConfig = this._typeConfig[type];
      if (typeConfig && typeConfig.buildStreams) {
        await typeConfig.buildStreams(mainTitle, tmdbId, providerTitleGroups);
      }

      // Extract streams dictionary
      const streamsDict = this._extractMainTitleStreamsDict(mainTitle, providerTitleGroups);

      return { mainTitle, streamsDict };
    } catch (error) {
      this.logger.error(`Error generating main title for ${tmdbType} ID ${tmdbId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Build movie streams by collecting provider IDs that have "main" stream
   * @private
   * @param {Object} mainTitle - Main title object to populate
   * @param {number} tmdbId - TMDB movie ID (unused, kept for signature consistency)
   * @param {Array<Object>} providerTitleGroups - Array of objects with { providerId, title } structure
   */
  _buildMovieStreams(mainTitle, tmdbId, providerTitleGroups) {
    // Collect provider IDs that have "main" stream
    const providersWithMainStream = providerTitleGroups
      .filter(group => group.title.streams && group.title.streams.main)
      .map(group => group.providerId);
    
    if (providersWithMainStream.length > 0) {
      mainTitle.streams.main = { sources: providersWithMainStream };
    }
  }

  /**
   * Build TV show streams by fetching seasons/episodes from TMDB and matching with provider streams
   * @private
   * @param {Object} mainTitle - Main title object to populate
   * @param {number} tmdbId - TMDB TV show ID
   * @param {Array<Object>} providerTitleGroups - Array of objects with { providerId, title } structure
   * @returns {Promise<void>}
   */
  async _buildTVShowStreams(mainTitle, tmdbId, providerTitleGroups) {
    try {
      // Get TV show details to get number of seasons
      const tvShowDetails = await this.getTVShowDetails(tmdbId);
      
      if (!tvShowDetails || !tvShowDetails.seasons) {
        this.logger.warn(`No seasons data found for TV show ID ${tmdbId}`);
        return;
      }

      // Fetch all seasons in parallel
      const seasonPromises = tvShowDetails.seasons
        .filter(season => season.season_number >= 0) // Filter out specials (season_number < 0)
        .map(season => this.getTVShowSeasonDetails(tmdbId, season.season_number));

      const seasonsData = await Promise.all(seasonPromises);

      // Build streams object: key is Sxx-Exx, value is object with episode metadata and sources array
      const streamsMap = new Map();

      // Initialize all episodes from TMDB with episode metadata and empty sources array
      seasonsData.forEach(seasonData => {
        if (seasonData && seasonData.episodes) {
          seasonData.episodes.forEach(episode => {
            const seasonStr = String(episode.season_number).padStart(2, '0');
            const episodeStr = String(episode.episode_number).padStart(2, '0');
            const streamKey = `S${seasonStr}-E${episodeStr}`;
            
            if (!streamsMap.has(streamKey)) {
              streamsMap.set(streamKey, {
                air_date: episode.air_date || null,
                name: episode.name || null,
                overview: episode.overview || null,
                still_path: episode.still_path || null,
                sources: []
              });
            }
          });
        }
      });

      // Match provider streams to episodes
      providerTitleGroups.forEach(group => {
        const providerId = group.providerId;
        const providerStreams = group.title.streams || {};
        
        Object.keys(providerStreams).forEach(streamKey => {
          // Stream key should be in Sxx-Exx format
          if (streamsMap.has(streamKey)) {
            const streamData = streamsMap.get(streamKey);
            if (!streamData.sources.includes(providerId)) {
              streamData.sources.push(providerId);
            }
          }
        });
      });

      // Convert map to object and only include episodes with at least one provider
      streamsMap.forEach((streamData, streamKey) => {
        if (streamData.sources.length > 0) {
          mainTitle.streams[streamKey] = streamData;
        }
      });
    } catch (error) {
      this.logger.error(`Error building TV show streams for ID ${tmdbId}: ${error.message}`);
    }
  }
}

