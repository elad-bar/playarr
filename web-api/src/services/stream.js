import { titlesService } from './titles.js';

/**
 * Constants for stream endpoint
 * Matches Python's STREAM_HEADERS
 */
const STREAM_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
  'Accept': '*/*',
  'Connection': 'keep-alive',
};

/**
 * Stream service for handling stream data operations
 * Matches Python's StreamService
 */
class StreamService {
  constructor() {
    this._timeout = 3000; // 3 seconds timeout for URL checks
  }

  /**
   * Get episode number in format E## (e.g., E01)
   * Matches Python's get_episode_number()
   */
  _getEpisodeNumber(episodeNum) {
    return this._getNumber(episodeNum, 'E');
  }

  /**
   * Get season number in format S## (e.g., S01)
   * Matches Python's get_season_number()
   */
  _getSeasonNumber(seasonNum) {
    return this._getNumber(seasonNum, 'S');
  }

  /**
   * Format number with prefix (e.g., S01, E01)
   * Matches Python's _get_number()
   */
  _getNumber(num, prefix) {
    const number = String(num).padStart(2, '0');
    return `${prefix}${number}`;
  }

  /**
   * Get the best source for a specific title
   * Matches Python's StreamService.get_best_source()
   */
  async getBestSource(titleId, mediaType, seasonNumber = null, episodeNumber = null) {
    console.log(
      `Getting best source for title ID: ${titleId}, media type: ${mediaType}, season: ${seasonNumber}, episode: ${episodeNumber}`
    );

    const sources = await this._getSources(titleId, mediaType, seasonNumber, episodeNumber);

    if (!sources || sources.length === 0) {
      return null;
    }

    // Check each source and return the first valid one
    for (const source of sources) {
      if (await this._checkUrl(source)) {
        return source;
      }
    }

    return null;
  }

  /**
   * Get sources for a specific title
   * Matches Python's StreamService._get_sources()
   */
  async _getSources(titleId, mediaType, seasonNumber = null, episodeNumber = null) {
    const titleKey = `${mediaType}-${titleId}`;
    const titlesData = await titlesService.getTitlesData();
    const titleData = titlesData.get(titleKey);

    if (!titleData) {
      console.warn(`Title data not found for title key: ${titleKey}`);
      return [];
    }

    const streams = titleData.streams || {};
    let streamId = 'main';

    if (mediaType === 'shows') {
      const seasonNum = this._getSeasonNumber(seasonNumber);
      const episodeNum = this._getEpisodeNumber(episodeNumber);
      streamId = `${seasonNum}-${episodeNum}`;
    }

    const streamData = streams[streamId];
    if (!streamData) {
      console.warn(`Stream data not found for stream ID: ${streamId}`);
      return [];
    }

    const streamSources = streamData.sources || {};
    const sources = [];

    // Extract URLs from all providers
    for (const providerName of Object.keys(streamSources)) {
      const streamSourceData = streamSources[providerName];
      const streamUrl = streamSourceData?.url;

      if (streamUrl && !sources.includes(streamUrl)) {
        sources.push(streamUrl);
      }
    }

    return sources;
  }

  /**
   * Check if a URL is reachable using GET
   * Matches Python's StreamService._check_url()
   */
  async _checkUrl(url) {
    try {
      console.log(`Checking URL: ${url}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this._timeout);

      const response = await fetch(url, {
        method: 'GET',
        headers: STREAM_HEADERS,
        redirect: 'follow',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Read a small amount to ensure connection works
      const reader = response.body.getReader();
      const { done } = await reader.read();
      reader.releaseLock();

      const isValid = response.ok;
      console.log(`URL is valid: ${isValid}`);

      return isValid;
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log(`URL check timed out: ${url}`);
      } else {
        console.error(`Error checking URL: ${url}`, error);
      }
      return false;
    }
  }
}

// Export singleton instance
export const streamService = new StreamService();

