import slugify from 'slugify';

/**
 * Database collection types matching Python DatabaseCollections enum
 */
export const DatabaseCollections = {
  TITLES: 'titles',
  CATEGORIES: 'categories',
  IPTV_PROVIDERS: 'iptv-providers',
  SETTINGS: 'settings',
  STATS: 'stats',
  USERS: 'users',
};

/**
 * Provider types matching Python DataProvider enum
 */
export const DataProvider = {
  TMDB_API: 'tmdb',
  AGTV: 'agtv',
  XTREAM: 'xtream',
  MAIN: 'main',
};

/**
 * Get collection key field name
 */
export function getCollectionKey(collection) {
  const keys = {
    [DatabaseCollections.CATEGORIES]: 'key',
    [DatabaseCollections.TITLES]: 'key',
    [DatabaseCollections.IPTV_PROVIDERS]: 'id',
    [DatabaseCollections.SETTINGS]: 'key',
    [DatabaseCollections.STATS]: 'key',
    [DatabaseCollections.USERS]: 'username',
  };
  return keys[collection] || 'key';
}

/**
 * Convert collection type to collection name with optional provider
 * Matches Python DatabaseCollections.to_collection_name()
 */
export function toCollectionName(collection, providerName = null) {
  let collectionName = collection;

  const isProviderCollection = [
    DatabaseCollections.CATEGORIES,
    DatabaseCollections.TITLES,
  ].includes(collection);

  // If provider is None, "main", or "tmdb-api", don't use provider prefix
  if (!providerName || 
      providerName === DataProvider.MAIN || 
      providerName === DataProvider.TMDB_API) {
    // For provider collections, still check if we should add prefix
    if (isProviderCollection && providerName && providerName !== DataProvider.MAIN && providerName !== DataProvider.TMDB_API) {
      collectionName = `${providerName}.${collection}`;
    }
  } else if (isProviderCollection) {
    collectionName = `${providerName}.${collection}`;
  }

  // Return collection name as-is - provider IDs are already slugified at creation
  return collectionName;
}

/**
 * Determine collection type from collection name
 * Matches Python DatabaseCollections.from_collection_name()
 */
export function fromCollectionName(collectionName) {
  const collectionNames = Object.values(DatabaseCollections);
  
  for (const collection of collectionNames) {
    if (collectionName.endsWith(collection)) {
      return collection;
    }
  }
  
  throw new Error(`Invalid collection name: ${collectionName}`);
}

