/**
 * Data transformation utilities for migration scripts
 * Transforms JSON data to MongoDB document format
 */

/**
 * Generate title_key from type and title_id
 * @param {string} type - Media type ('movies' or 'tvshows')
 * @param {number|string} titleId - Title ID
 * @returns {string} Formatted title_key: {type}-{title_id}
 */
export function generateTitleKey(type, titleId) {
  if (!type || titleId === undefined || titleId === null) {
    return null;
  }
  return `${type}-${titleId}`;
}

/**
 * Generate category_key from type and category_id
 * @param {string} type - Category type ('movies' or 'tvshows')
 * @param {number|string} categoryId - Category ID
 * @returns {string} Formatted category_key: {type}-{category_id}
 */
export function generateCategoryKey(type, categoryId) {
  if (!type || categoryId === undefined || categoryId === null) {
    return null;
  }
  return `${type}-${categoryId}`;
}

/**
 * Build streams summary from main-titles-streams.json
 * Groups streams by title_key and stream_id, collecting provider_ids
 * @param {Object} streamsData - Parsed main-titles-streams.json object
 * @returns {Object} Map of title_key to streams summary: { title_key: { stream_id: [provider_ids] } }
 */
export function buildStreamsSummary(streamsData) {
  const summary = {};
  
  if (!streamsData || typeof streamsData !== 'object') {
    return summary;
  }
  
  // Iterate through all stream entries
  for (const [key, value] of Object.entries(streamsData)) {
    // Parse key: {type}-{tmdbId}-{streamId}-{providerId}
    const parts = key.split('-');
    if (parts.length < 4) {
      continue; // Skip invalid keys
    }
    
    const type = parts[0]; // 'movies' or 'tvshows'
    const tmdbId = parts[1];
    const streamId = parts.slice(2, -1).join('-'); // Handle stream IDs like 'S01-E01'
    const providerId = parts[parts.length - 1];
    
    // Generate title_key
    const title_key = generateTitleKey(type, tmdbId);
    if (!title_key) {
      continue; // Skip invalid title keys
    }
    
    // Initialize summary entry for this title_key if not exists
    if (!summary[title_key]) {
      summary[title_key] = {};
    }
    
    // Initialize array for this stream_id if not exists
    if (!summary[title_key][streamId]) {
      summary[title_key][streamId] = [];
    }
    
    // Add provider_id to the array (avoid duplicates)
    if (!summary[title_key][streamId].includes(providerId)) {
      summary[title_key][streamId].push(providerId);
    }
  }
  
  return summary;
}

/**
 * Transform main title - preserve streams summary, ensure title_key
 * @param {Object} title - Title object from main.json
 * @param {Object} streamsSummary - Optional streams summary object: { stream_id: [provider_ids] }
 * @returns {Object} Transformed title document
 */
export function transformTitle(title, streamsSummary = {}) {
  const transformed = { ...title };
  
  // Set streams field from summary (or empty object if not provided)
  transformed.streams = streamsSummary || {};
  
  // Ensure title_key is present
  if (!transformed.title_key && transformed.type && transformed.title_id !== undefined) {
    transformed.title_key = generateTitleKey(transformed.type, transformed.title_id);
  }
  
  // Normalize timestamps (convert snake_case to camelCase and remove old fields)
  if (transformed.created_at && !transformed.createdAt) {
    transformed.createdAt = transformed.created_at instanceof Date 
      ? transformed.created_at 
      : new Date(transformed.created_at);
    delete transformed.created_at;
  }
  if (transformed.updated_at && !transformed.lastUpdated) {
    transformed.lastUpdated = transformed.updated_at instanceof Date 
      ? transformed.updated_at 
      : new Date(transformed.updated_at);
    delete transformed.updated_at;
  }
  
  // Ensure timestamps are Date objects (MongoDB will store as ISODate)
  if (transformed.createdAt && !(transformed.createdAt instanceof Date)) {
    transformed.createdAt = new Date(transformed.createdAt);
  }
  if (transformed.lastUpdated && !(transformed.lastUpdated instanceof Date)) {
    transformed.lastUpdated = new Date(transformed.lastUpdated);
  }
  
  return transformed;
}

/**
 * Transform title stream entry from main-titles-streams.json
 * Parses key format: {type}-{tmdbId}-{streamId}-{providerId}
 * @param {string} key - Stream key
 * @param {Object} value - Stream value object
 * @returns {Object|null} Transformed stream document or null if invalid
 */
export function transformTitleStream(key, value) {
  // Parse key: {type}-{tmdbId}-{streamId}-{providerId}
  const parts = key.split('-');
  if (parts.length < 4) {
    return null;
  }
  
  const type = parts[0]; // 'movies' or 'tvshows'
  const tmdbId = parts[1];
  const streamId = parts.slice(2, -1).join('-'); // Handle stream IDs like 'S01-E01'
  const providerId = parts[parts.length - 1];
  
  // Generate title_key
  const title_key = generateTitleKey(type, tmdbId);
  if (!title_key) {
    return null;
  }
  
  // Extract proxy_url from value object
  const proxy_url = value?.proxy_url || value?.proxyUrl || null;
  
  // Build document
  const document = {
    title_key,
    stream_id: streamId,
    provider_id: providerId,
    proxy_url,
  };
  
  // Preserve timestamps if present (as Date objects)
  if (value?.createdAt) {
    document.createdAt = value.createdAt instanceof Date ? value.createdAt : new Date(value.createdAt);
  }
  if (value?.lastUpdated) {
    document.lastUpdated = value.lastUpdated instanceof Date ? value.lastUpdated : new Date(value.lastUpdated);
  }
  
  return document;
}

/**
 * Transform provider title - merge ignored flags, ensure title_key
 * @param {Object} title - Provider title object
 * @param {Object} ignoredTitles - Object mapping title_key to issue
 * @returns {Object} Transformed provider title document
 */
export function transformProviderTitle(title, ignoredTitles = {}) {
  const transformed = { ...title };
  
  // Ensure title_key is present
  if (!transformed.title_key && transformed.type && transformed.tmdb_id !== undefined) {
    transformed.title_key = generateTitleKey(transformed.type, transformed.tmdb_id);
  }
  
  // Check if title is ignored
  const titleKey = transformed.title_key;
  if (titleKey && ignoredTitles[titleKey]) {
    transformed.ignored = true;
    transformed.ignored_reason = ignoredTitles[titleKey];
  } else {
    transformed.ignored = false;
    transformed.ignored_reason = null;
  }
  
  // Normalize timestamps (convert snake_case to camelCase and remove old fields)
  if (transformed.created_at && !transformed.createdAt) {
    transformed.createdAt = transformed.created_at instanceof Date 
      ? transformed.created_at 
      : new Date(transformed.created_at);
    delete transformed.created_at;
  }
  if (transformed.updated_at && !transformed.lastUpdated) {
    transformed.lastUpdated = transformed.updated_at instanceof Date 
      ? transformed.updated_at 
      : new Date(transformed.updated_at);
    delete transformed.updated_at;
  }
  
  // Ensure timestamps are Date objects (MongoDB will store as ISODate)
  if (transformed.createdAt && !(transformed.createdAt instanceof Date)) {
    transformed.createdAt = new Date(transformed.createdAt);
  }
  if (transformed.lastUpdated && !(transformed.lastUpdated instanceof Date)) {
    transformed.lastUpdated = new Date(transformed.lastUpdated);
  }
  
  return transformed;
}

/**
 * Transform provider category - generate category_key
 * @param {Object} category - Category object
 * @param {string} providerId - Provider ID
 * @returns {Object} Transformed category document
 */
export function transformProviderCategory(category, providerId) {
  const transformed = { ...category };
  
  // Add provider_id
  transformed.provider_id = providerId;
  
  // Generate category_key if not present
  if (!transformed.category_key && transformed.type && transformed.category_id !== undefined) {
    transformed.category_key = generateCategoryKey(transformed.type, transformed.category_id);
  }
  
  // Normalize timestamps (convert snake_case to camelCase and remove old fields)
  if (transformed.created_at && !transformed.createdAt) {
    transformed.createdAt = transformed.created_at instanceof Date 
      ? transformed.created_at 
      : new Date(transformed.created_at);
    delete transformed.created_at;
  }
  if (transformed.updated_at && !transformed.lastUpdated) {
    transformed.lastUpdated = transformed.updated_at instanceof Date 
      ? transformed.updated_at 
      : new Date(transformed.updated_at);
    delete transformed.updated_at;
  }
  
  // Ensure timestamps are Date objects (MongoDB will store as ISODate)
  if (transformed.createdAt && !(transformed.createdAt instanceof Date)) {
    transformed.createdAt = new Date(transformed.createdAt);
  }
  if (transformed.lastUpdated && !(transformed.lastUpdated instanceof Date)) {
    transformed.lastUpdated = new Date(transformed.lastUpdated);
  }
  
  return transformed;
}

/**
 * Ensure document has required timestamps (normalized to camelCase)
 * Handles both snake_case (created_at, updated_at) and camelCase (createdAt, lastUpdated) formats
 * @param {Object} document - Document to process
 * @returns {Object} Document with normalized timestamps
 */
export function ensureTimestamps(document) {
  const now = new Date(); // Keep as Date object (MongoDB stores as ISODate)
  
  // Handle createdAt - check both camelCase and snake_case
  if (document.createdAt) {
    // Already has camelCase, convert to Date if needed
    if (!(document.createdAt instanceof Date)) {
      document.createdAt = new Date(document.createdAt);
    }
  } else if (document.created_at) {
    // Has snake_case, convert to camelCase and Date
    document.createdAt = document.created_at instanceof Date 
      ? document.created_at 
      : new Date(document.created_at);
    delete document.created_at; // Remove old snake_case field
  } else {
    // No timestamp found, use current time
    document.createdAt = now;
  }
  
  // Handle lastUpdated - check both camelCase and snake_case (updated_at)
  if (document.lastUpdated) {
    // Already has camelCase, convert to Date if needed
    if (!(document.lastUpdated instanceof Date)) {
      document.lastUpdated = new Date(document.lastUpdated);
    }
  } else if (document.updated_at) {
    // Has snake_case, convert to camelCase and Date
    document.lastUpdated = document.updated_at instanceof Date 
      ? document.updated_at 
      : new Date(document.updated_at);
    delete document.updated_at; // Remove old snake_case field
  } else {
    // No timestamp found, use current time
    document.lastUpdated = now;
  }
  
  return document;
}

