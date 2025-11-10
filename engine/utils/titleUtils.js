/**
 * Utility functions for parsing and manipulating title strings
 */

/**
 * Extract year from title string (e.g., "Movie Title (2024)" -> 2024)
 * @param {string} title - Title string that may contain year
 * @returns {number|null} Extracted year or null if not found
 */
export function extractYearFromTitle(title) {
  if (!title) return null;
  // Match pattern like "(2024)" or "(2024-2025)"
  const match = title.match(/\((\d{4})/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Extract base title name without year and season/episode (e.g., "Movie Title (2024)" -> "Movie Title", "Show S01 E01" -> "Show")
 * @param {string} title - Title string that may contain year and/or season/episode
 * @returns {string} Base title name without year and season/episode
 */
export function extractBaseTitle(title) {
  if (!title) return title;
  
  // Remove year patterns like "(2024)" or "(2024-2025)" from the end
  let cleaned = title.replace(/\s*\(\d{4}(?:-\d{4})?\)\s*$/, '').trim();
  
  // Remove invalid year patterns like "(0)", "(1)", etc. (1-3 digits that aren't valid years)
  // This handles cases like "Visioneers (0)" -> "Visioneers"
  cleaned = cleaned.replace(/\s*\(\d{1,3}\)\s*$/, '').trim();
  
  // Remove season/episode patterns like "S01 E01", "S1 E1", "S 01 E 01" from the end
  // Case-insensitive, handles various spacing
  cleaned = cleaned.replace(/\s*S\d+\s*E\d+\s*$/i, '').trim();
  
  return cleaned;
}

/**
 * Extract year from release_date string (e.g., "2025-10-15" -> 2025)
 * @param {string} releaseDate - Release date string in format "YYYY-MM-DD" or similar
 * @returns {number|null} Extracted year or null if not found
 */
export function extractYearFromReleaseDate(releaseDate) {
  if (!releaseDate) return null;
  // Match YYYY-MM-DD format (e.g., "2025-10-15")
  const match = releaseDate.match(/^(\d{4})/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Generate title_key from type and title_id
 * @param {string} type - Media type ('movies' or 'tvshows')
 * @param {number|string} titleId - Title ID
 * @returns {string} Formatted title_key: {type}-{title_id}
 */
export function generateTitleKey(type, titleId) {
  return `${type}-${titleId}`;
}

/**
 * Generate category_key from type and category_id
 * @param {string} type - Category type ('movies' or 'tvshows')
 * @param {number|string} categoryId - Category ID
 * @returns {string} Formatted category_key: {type}-{category_id}
 */
export function generateCategoryKey(type, categoryId) {
  return `${type}-${categoryId}`;
}

