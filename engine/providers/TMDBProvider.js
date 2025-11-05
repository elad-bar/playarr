import { BaseProvider } from './BaseProvider.js';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractYearFromTitle, extractBaseTitle, extractYearFromReleaseDate } from '../utils/titleUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
   * @param {import('../managers/StorageManager.js').StorageManager} data - Storage manager instance for persistent data storage
   * @returns {TMDBProvider} Singleton instance
   */
  static getInstance(cache, data) {
    if (!TMDBProvider.instance) {
      const settingsPath = path.join(__dirname, '../../configurations/settings.json');
      const settings = fs.readJsonSync(settingsPath);
      
      const providerData = {
        id: 'tmdb',
        type: 'tmdb',
        api_rate: settings.tmdb_api_rate,
        token: settings.tmdb_token
      };

      TMDBProvider.instance = new TMDBProvider(providerData, cache, data);
    }
    return TMDBProvider.instance;
  }

  /**
   * Private constructor - use getInstance() instead
   * @param {Object} providerData - Provider configuration data
   * @param {import('../managers/StorageManager.js').StorageManager} cache - Storage manager instance for temporary cache
   * @param {import('../managers/StorageManager.js').StorageManager} data - Storage manager instance for persistent data storage
   */
  constructor(providerData, cache, data) {
    super(providerData, cache, data, 'TMDB');
    this.apiBaseUrl = 'https://api.themoviedb.org/3';
    this.apiToken = providerData.token;
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
      ['tmdb', 'search', type, `${title}_${year || 'no-year'}.json`],
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
  async findByIMDBId(imdbId) {
    const url = this._buildApiUrl('/find/' + imdbId, {
      external_source: 'imdb_id'
    });
    
    return await this.fetchWithCache(
      url,
      ['tmdb', 'find', 'imdb', `${imdbId}.json`],
      null, // Cache forever (null = Infinity)
      false, // forceRefresh
      { headers: this._getAuthHeaders() }
    );
  }

  /**
   * Find TMDB ID by IMDB ID for movies
   * @param {string} imdbId - IMDB ID (e.g., 'tt0133093')
   * @returns {Promise<Object|null>} First movie result or null if not found
   */
  async findMovieByIMDBId(imdbId) {
    const result = await this.findByIMDBId(imdbId);
    if (result.movie_results && result.movie_results.length > 0) {
      return result.movie_results[0];
    }
    return null;
  }

  /**
   * Find TMDB ID by IMDB ID for TV shows
   * @param {string} imdbId - IMDB ID (e.g., 'tt0944947')
   * @returns {Promise<Object|null>} First TV show result or null if not found
   */
  async findTVShowByIMDBId(imdbId) {
    const result = await this.findByIMDBId(imdbId);
    if (result.tv_results && result.tv_results.length > 0) {
      return result.tv_results[0];
    }
    return null;
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
      ['tmdb', type, `${tmdbId}.json`],
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
      ['tmdb', 'tv', `${tmdbId}`, 'season', `${seasonNumber}.json`],
      6, // Cache for 6 hours
      false, // forceRefresh
      { headers: this._getAuthHeaders() }
    );
  }

  /**
   * Get similar movies or TV shows by TMDB ID
   * @param {string} type - Media type: 'movie' or 'tv'
   * @param {number} tmdbId - TMDB ID
   * @returns {Promise<Object>} Similar media results
   */
  async getSimilar(type, tmdbId) {
    const endpoint = type === 'movie' 
      ? `/movie/${tmdbId}/similar` 
      : `/tv/${tmdbId}/similar`;
    
    const url = this._buildApiUrl(endpoint);
    
    return await this.fetchWithCache(
      url,
      ['tmdb', type, String(tmdbId), 'similar.json'],
      null, // Cache forever (null = Infinity)
      false, // forceRefresh
      { headers: this._getAuthHeaders() }
    );
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
          const result = await this.findByIMDBId(title.title_id);
          
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
   * @returns {Promise<Object|null>} Main title object or null if API call fails
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
        title: type === 'movies' ? apiData.title : apiData.name,
        release_date: type === 'movies' ? apiData.release_date : apiData.first_air_date,
        vote_average: apiData.vote_average || null,
        overview: apiData.overview || null,
        poster_path: apiData.poster_path || null,
        genres: apiData.genres || [],
        streams: {},
        createdAt: now,
        lastUpdated: now
      };

      // Process streams based on type
      if (type === 'movies') {
        // For movies: collect provider IDs that have "main" stream
        const providersWithMainStream = providerTitleGroups
          .filter(group => group.title.streams && group.title.streams.main)
          .map(group => group.providerId);
        
        if (providersWithMainStream.length > 0) {
          mainTitle.streams.main = { sources: providersWithMainStream };
        }
      } else {
        // For TV shows: get all episodes from TMDB seasons API
        await this._buildTVShowStreams(mainTitle, tmdbId, providerTitleGroups);
      }

      return mainTitle;
    } catch (error) {
      this.logger.error(`Error generating main title for ${tmdbType} ID ${tmdbId}: ${error.message}`);
      return null;
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

