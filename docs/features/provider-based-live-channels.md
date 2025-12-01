# Provider-Based Live Channels Feature

## Overview

This feature refactors Live TV channel management from user-level configuration to provider-level synchronization. Instead of users configuring their own M3U and EPG URLs, live channels are automatically fetched from active IPTV providers (AGTV and Xtream) and made available to all users. This centralizes channel management and eliminates the need for per-user Live TV configuration.

## Goals

1. **Centralized Channel Management**: Move live channels from user-level to provider-level storage
2. **Automatic Synchronization**: Sync channels from all active providers automatically via scheduled job
3. **Provider-Specific Implementation**: Support different channel fetching methods per provider type (AGTV vs Xtream)
4. **Simplified User Experience**: Remove Live TV configuration from user profiles
5. **Unified Channel Access**: All users access the same provider-sourced channels

## Current Architecture

### Existing Implementation

**User-Level Channels:**
- Channels stored in `channels` collection with `username` field
- Users configure `liveTV.m3u_url` and `liveTV.epg_url` in their profile
- `SyncLiveTVJob` syncs channels from user-configured M3U/EPG URLs
- Channels accessed via `LiveTVManager.getUserChannels(username)`
- Each user has their own set of channels

**Limitations:**
- Users must manually configure M3U/EPG URLs in their profile
- No automatic discovery of channels from configured IPTV providers
- Channels are isolated per user, preventing shared channel management

## Feature Requirements

### Provider Types

#### Xtream Providers
- **Live Categories**: Fetch via `get_live_categories` API action
- **Live Streams**: Fetch via `get_live_streams` API action
- **EPG Support**: May include EPG data in API responses or require separate EPG URL
- **Format**: JSON API responses
- **Category Control**: Categories fetched from API, controlled via `enabled_categories.live` in provider config
- **Category Keys**: Format `live-{category_id}` (e.g., `live-1`, `live-2`)

#### AGTV Providers
- **Live Channels**: Fetch via M3U8 endpoint (similar to movies/tvshows)
- **Endpoint**: `/api/list/{username}/{password}/m3u8/live` (or similar)
- **Format**: M3U8 playlist format
- **EPG Support**: May require separate EPG URL or M3U8 metadata
- **Category Control**: Categories extracted from M3U8 `group-title` attribute
- **Category Keys**: Format `live-{normalized_category_name}` (slugified, lowercase)

### Data Structure Changes

#### Channels Collection

**Before:**
```javascript
{
  _id: ObjectId,
  username: String,              // User-specific
  channel_id: String,
  name: String,
  url: String,
  tvg_id: String,
  tvg_name: String,
  tvg_logo: String,
  group_title: String,
  duration: Number,
  createdAt: ISODate,
  lastUpdated: ISODate
}
```

**After:**
```javascript
{
  _id: ObjectId,
  provider_id: String,          // Provider-specific (replaces username)
  channel_id: String,
  channel_key: String,          // NEW: Unique key per provider (format: "live-{providerId}-{channelId}")
  name: String,
  url: String,
  tvg_id: String,
  tvg_name: String,
  tvg_logo: String,
  group_title: String,
  duration: Number,
  createdAt: ISODate,
  lastUpdated: ISODate
}
```

**Index Changes:**
- Remove: `{ username: 1, channel_id: 1 }` (unique compound)
- Remove: `{ username: 1 }`
- Add: `{ provider_id: 1, channel_id: 1 }` (unique compound)
- Add: `{ provider_id: 1 }`
- Add: `{ channel_key: 1 }` (for watchlist queries)

#### Programs Collection

**Before:**
```javascript
{
  _id: ObjectId,
  username: String,              // User-specific
  channel_id: String,
  start: ISODate,
  stop: ISODate,
  title: String,
  desc: String,
  category: String,
  icon: String,
  episode: String,
  createdAt: ISODate,
  lastUpdated: ISODate
}
```

**After:**
```javascript
{
  _id: ObjectId,
  provider_id: String,          // Provider-specific (replaces username)
  channel_id: String,
  start: ISODate,
  stop: ISODate,
  title: String,
  desc: String,
  category: String,
  icon: String,
  episode: String,
  createdAt: ISODate,
  lastUpdated: ISODate
}
```

**Index Changes:**
- Remove: `{ username: 1, channel_id: 1, start: 1, stop: 1 }` (unique compound)
- Remove: `{ username: 1, channel_id: 1 }`
- Add: `{ provider_id: 1, channel_id: 1, start: 1, stop: 1 }` (unique compound)
- Add: `{ provider_id: 1, channel_id: 1 }`

### User Profile Changes

**Remove:**
- `user.liveTV.m3u_url` field
- `user.liveTV.epg_url` field
- Entire `user.liveTV` object (if no other fields)

**Add:**
- `user.watchlist_channels: Array<String>` - Array of channel keys in user's watchlist (format: `live-{providerId}-{channelId}`)

**Migration:**
- Existing user `liveTV` configurations will be ignored
- Channels will be migrated or cleared during transition
- Watchlist will be empty initially (users can add channels after migration)

### Provider Configuration Changes

**Extended `enabled_categories` Structure:**

**Before:**
```javascript
{
  enabled_categories: {
    movies: [],
    tvshows: []
  }
}
```

**After:**
```javascript
{
  enabled_categories: {
    movies: [],
    tvshows: [],
    live: []  // NEW: Live channel categories
  }
}
```

**Category Management:**
- Categories are fetched/extracted during provider sync
- Users can enable/disable categories via provider settings UI (same flow as movies/TV shows)
- Only channels from enabled categories are synced and stored
- When categories are disabled, channels from those categories are removed (see Phase 4.1)
- Category key formats: See Technical Details > Category Management > Category Key Format

## Implementation Plan

### Phase 1: Provider Implementation

#### 1.1 XtreamProvider Enhancement

**Add Live Channel Methods:**
```javascript
/**
 * Fetch live TV categories from Xtream provider
 * @param {string} providerId - Provider ID
 * @returns {Promise<Array>} Array of category objects
 */
async fetchLiveCategories(providerId) {
  const provider = this._getProviderConfig(providerId);
  const queryParams = new URLSearchParams({
    username: provider.username,
    password: provider.password,
    action: 'get_live_categories'
  });
  const url = `${provider.api_url}/player_api.php?${queryParams.toString()}`;
  const limiter = this._getLimiter(providerId);
  
  return await this._fetchJsonWithCacheAxios({
    providerId,
    type: 'live',
    endpoint: 'live_categories',
    url,
    headers: {},
    limiter
  });
}

/**
 * Fetch live TV streams from Xtream provider
 * @param {string} providerId - Provider ID
 * @param {number} [categoryId] - Optional category ID to filter
 * @returns {Promise<Array>} Array of channel stream objects
 */
async fetchLiveStreams(providerId, categoryId = null) {
  const provider = this._getProviderConfig(providerId);
  const queryParams = new URLSearchParams({
    username: provider.username,
    password: provider.password,
    action: 'get_live_streams'
  });
  if (categoryId) {
    queryParams.append('category_id', categoryId);
  }
  const url = `${provider.api_url}/player_api.php?${queryParams.toString()}`;
  const limiter = this._getLimiter(providerId);
  
  return await this._fetchJsonWithCacheAxios({
    providerId,
    type: 'live',
    endpoint: 'live_streams',
    cacheParams: categoryId ? { categoryId } : {},
    url,
    headers: {},
    limiter
  });
}
```

**Add Cache Configuration:**
- Add cache mappings for `live_categories` and `live_streams` endpoints
- TTL: 6 hours (similar to other metadata)

#### 1.2 AGTVProvider Enhancement

**Add Live Channel Method:**
```javascript
/**
 * Fetch live TV channels M3U8 from AGTV provider
 * @param {string} providerId - Provider ID
 * @returns {Promise<string>} M3U8 content as string
 */
async fetchLiveM3U8(providerId) {
  const provider = this._getProviderConfig(providerId);
  const url = `${provider.api_url}/api/list/${provider.username}/${provider.password}/m3u8/live`;
  const limiter = this._getLimiter(providerId);
  
  return await this._fetchTextWithCacheAxios({
    providerId,
    type: 'live',
    endpoint: 'm3u8',
    url,
    headers: {},
    limiter
  });
}
```

**Add Cache Configuration:**
- Add cache mapping for `m3u8-live` endpoint
- TTL: 6 hours

### Phase 2: Repository Updates

#### 2.1 ChannelRepository Refactoring

**Update Methods:**
- Change `buildExistenceQuery()` to use `provider_id` instead of `username`
- Change `buildKeyForCheck()` to use `provider_id` instead of `username`
- Update `getIndexDefinitions()` with new indexes

**New Methods:**
```javascript
/**
 * Get all channels for a provider
 * @param {string} providerId - Provider ID
 * @returns {Promise<Array>} Array of channel documents
 */
async findByProvider(providerId) {
  return await this.findByQuery({ provider_id: providerId });
}

/**
 * Get all channels from all active providers
 * @returns {Promise<Array>} Array of channel documents
 */
async findAll() {
  return await this.findByQuery({});
}

/**
 * Delete all channels for a provider
 * @param {string} providerId - Provider ID
 * @returns {Promise<number>} Number of deleted documents
 */
async deleteByProvider(providerId) {
  return await this.deleteMany({ provider_id: providerId });
}
```

#### 2.2 ProgramRepository Refactoring

**Similar Updates:**
- Change all `username` references to `provider_id`
- Update indexes
- Add provider-based query methods

### Phase 3: LiveTVManager Refactoring

#### 3.1 Method Signature Changes

**Before:**
```javascript
async getUserChannels(username)
async getChannel(username, channelId)
async getChannelPrograms(username, channelId)
async syncAllUsers()
```

**After:**
```javascript
async getProviderChannels(providerId)
async getAllChannels()  // Aggregate from all providers
async getChannel(providerId, channelId)
async getChannelPrograms(providerId, channelId)
async syncAllProviders()
```

#### 3.2 Sync Logic Refactoring

**New `syncAllProviders()` Method:**
```javascript
async syncAllProviders() {
  // Get all active, enabled providers (AGTV and Xtream only)
  const providers = await this._providerRepo.findByQuery({
    type: { $in: ['agtv', 'xtream'] },
    enabled: true,
    deleted: { $ne: true }
  });
  
  if (providers.length === 0) {
    this.logger.info('No active providers with live channels');
    return { providers_processed: 0, results: [] };
  }
  
  const results = [];
  
  for (const provider of providers) {
    try {
      if (provider.type === 'xtream') {
        await this._syncXtreamProvider(provider);
      } else if (provider.type === 'agtv') {
        await this._syncAGTVProvider(provider);
      }
      results.push({
        provider_id: provider.id,
        provider_name: provider.name,
        success: true
      });
    } catch (error) {
      this.logger.error(`Failed to sync provider ${provider.id}: ${error.message}`);
      results.push({
        provider_id: provider.id,
        provider_name: provider.name,
        success: false,
        error: error.message
      });
    }
  }
  
  return {
    providers_processed: providers.length,
    results
  };
}
```

**Provider-Specific Sync Methods:**
```javascript
async _syncXtreamProvider(provider) {
  // Fetch categories and streams
  const categories = await this._xtreamProvider.fetchLiveCategories(provider.id);
  const streams = await this._xtreamProvider.fetchLiveStreams(provider.id);
  
  // Get enabled categories from provider config
  const enabledCategories = provider.enabled_categories?.live || [];
  const enabledCategoryKeys = new Set(enabledCategories);
  
  // Filter streams by enabled categories
  const filteredStreams = streams.filter(stream => {
    if (enabledCategories.length === 0) {
      return false; // No categories enabled = no channels
    }
    const categoryKey = `live-${stream.category_id}`;
    return enabledCategoryKeys.has(categoryKey);
  });
  
  // Parse and store channels (with channel_key generation)
  const channels = this._parseXtreamChannels(filteredStreams, provider.id);
  await this._saveChannels(provider.id, channels);
  
  // Handle EPG if available
  // ...
}

async _syncAGTVProvider(provider) {
  // Fetch M3U8 content
  const m3u8Content = await this._agtvProvider.fetchLiveM3U8(provider.id);
  
  // Parse M3U8 and extract channels with categories
  const allChannels = await this._parseM3U8Channels(m3u8Content, provider.id);
  
  // Get enabled categories from provider config
  const enabledCategories = provider.enabled_categories?.live || [];
  const enabledCategoryKeys = new Set(enabledCategories);
  
  // Extract unique categories from channels (for category management)
  const availableCategories = this._extractCategoriesFromChannels(allChannels);
  
  // Filter channels by enabled categories
  const filteredChannels = allChannels.filter(channel => {
    if (enabledCategories.length === 0) {
      return false; // No categories enabled = no channels
    }
    if (!channel.group_title) {
      return false; // Channels without category are excluded
    }
    const categoryKey = `live-${this._normalizeCategoryName(channel.group_title)}`;
    return enabledCategoryKeys.has(categoryKey);
  });
  
  // Store channels (with channel_key generation)
  await this._saveChannels(provider.id, filteredChannels);
  
  // Handle EPG if available
  // ...
}

/**
 * Extract unique categories from channels (for AGTV)
 * @private
 * @param {Array} channels - Array of channel objects
 * @returns {Array} Array of category objects with keys
 */
_extractCategoriesFromChannels(channels) {
  const categoryMap = new Map();
  
  channels.forEach(channel => {
    if (channel.group_title) {
      const normalizedName = this._normalizeCategoryName(channel.group_title);
      const categoryKey = `live-${normalizedName}`;
      
      if (!categoryMap.has(categoryKey)) {
        categoryMap.set(categoryKey, {
          key: categoryKey,
          category_name: channel.group_title, // Original name for display
          normalized_name: normalizedName
        });
      }
    }
  });
  
  return Array.from(categoryMap.values());
}

/**
 * Normalize category name for AGTV (slugify, lowercase)
 * @private
 * @param {string} categoryName - Original category name
 * @returns {string} Normalized category name
 */
_normalizeCategoryName(categoryName) {
  return categoryName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
```

#### 3.3 Channel Access Methods

**Update for Provider-Based Access:**
```javascript
/**
 * Get all channels from all active providers
 * @returns {Promise<Array>} Array of channel objects
 */
async getAllChannels() {
  return await this._channelRepo.findAll();
}

/**
 * Get channels for a specific provider
 * @param {string} providerId - Provider ID
 * @returns {Promise<Array>} Array of channel objects
 */
async getProviderChannels(providerId) {
  return await this._channelRepo.findByProvider(providerId);
}

/**
 * Get a specific channel
 * @param {string} providerId - Provider ID
 * @param {string} channelId - Channel ID
 * @returns {Promise<Object|null>} Channel object or null
 */
async getChannel(providerId, channelId) {
  return await this._channelRepo.findOneByQuery({
    provider_id: providerId,
    channel_id: channelId
  });
}

/**
 * Generate channel key (unique per provider)
 * @param {string} providerId - Provider ID
 * @param {string} channelId - Channel ID
 * @returns {string} Channel key in format "live-{providerId}-{channelId}"
 */
_generateChannelKey(providerId, channelId) {
  return `live-${providerId}-${channelId}`;
}
```

#### 3.4 Watchlist Management

**Watchlist Methods:**
```javascript
/**
 * Get channels with optional watchlist filtering
 * @param {Object} options - Query options
 * @param {string} [options.userId] - User ID for watchlist filtering
 * @param {boolean} [options.watchlist] - Filter by watchlist (true = only watchlist, false = exclude watchlist, undefined = all)
 * @param {string} [options.providerId] - Filter by provider
 * @param {string} [options.search] - Search term
 * @returns {Promise<Array>} Array of channel objects
 */
async getAllChannels(options = {}) {
  let query = {};
  
  // Provider filter
  if (options.providerId) {
    query.provider_id = options.providerId;
  }
  
  // Search filter
  if (options.search) {
    query.name = { $regex: options.search, $options: 'i' };
  }
  
  let channels = await this._channelRepo.findByQuery(query);
  
  // Watchlist filtering
  if (options.userId && options.watchlist !== undefined) {
    const watchlistKeys = await this._getUserWatchlistKeys(options.userId);
    if (options.watchlist === true) {
      // Only show watchlist channels
      channels = channels.filter(ch => watchlistKeys.has(ch.channel_key));
    } else {
      // Exclude watchlist channels
      channels = channels.filter(ch => !watchlistKeys.has(ch.channel_key));
    }
  }
  
  return channels;
}

/**
 * Add channel to user watchlist
 * @param {string} userId - User ID
 * @param {string} channelKey - Channel key (format: "live-{providerId}-{channelId}")
 * @returns {Promise<Object>} Success response
 */
async addToWatchlist(userId, channelKey) {
  await this._userRepo.updateOne(
    { id: userId },
    { $addToSet: { watchlist_channels: channelKey } }
  );
  return { success: true };
}

/**
 * Remove channel from user watchlist
 * @param {string} userId - User ID
 * @param {string} channelKey - Channel key
 * @returns {Promise<Object>} Success response
 */
async removeFromWatchlist(userId, channelKey) {
  await this._userRepo.updateOne(
    { id: userId },
    { $pull: { watchlist_channels: channelKey } }
  );
  return { success: true };
}

/**
 * Get user's watchlist channel keys
 * @private
 * @param {string} userId - User ID
 * @returns {Promise<Set>} Set of channel keys
 */
async _getUserWatchlistKeys(userId) {
  const user = await this._userRepo.findOneByQuery({ id: userId });
  return new Set(user?.watchlist_channels || []);
}
```

**Channel Key Generation During Sync:**
- Update `_parseXtreamChannels()` to generate `channel_key` using `_generateChannelKey(providerId, channelId)` for each channel
- Update `_parseM3U8Channels()` to generate `channel_key` using `_generateChannelKey(providerId, channelId)` for each channel
- Store `channel_key` in channel documents during sync

### Phase 4: Category Management Integration

#### 4.1 ProvidersManager Updates

**Extend `getCategories()` Method:**
```javascript
async getCategories(providerId) {
  // ... existing movies/tvshows logic ...
  
  // Fetch live categories from provider
  let liveCategories = [];
  try {
    if (providerData.type === 'xtream') {
      liveCategories = await this.fetchLiveCategories(providerId);
    } else if (providerData.type === 'agtv') {
      // For AGTV, categories are extracted from channels during sync
      // Return empty array here - categories will be populated after first sync
      liveCategories = [];
    }
  } catch (error) {
    this.logger.warn(`Failed to fetch live categories for ${providerId}: ${error.message}`);
  }
  
  // Get enabled live categories from provider config
  const enabledLiveCategories = enabledCategories.live || [];
  const enabledLiveCategoryKeys = new Set(enabledLiveCategories);
  
  // Transform live categories
  const transformedLiveCategories = liveCategories.map(cat => {
    const categoryKey = providerData.type === 'xtream' 
      ? `live-${cat.category_id}`
      : `live-${this._normalizeCategoryName(cat.category_name)}`;
    
    return {
      key: categoryKey,
      type: 'live',
      category_id: cat.category_id || null,
      category_name: cat.category_name,
      enabled: enabledLiveCategoryKeys.has(categoryKey)
    };
  });
  
  // Combine all categories
  const allCategories = [
    ...moviesCategories.map(/* ... existing ... */),
    ...tvshowsCategories.map(/* ... existing ... */),
    ...transformedLiveCategories
  ];
  
  return { response: allCategories, statusCode: 200 };
}
```

**Extend `updateEnabledCategories()` Method:**
```javascript
async updateEnabledCategories(providerId, enabledCategories) {
  // Validate structure includes live array
  if (!Array.isArray(enabledCategories.live)) {
    return {
      response: { error: 'enabledCategories must have live array' },
      statusCode: 400
    };
  }
  
  // Update provider document
  await this._providerRepo.updateOne(
    { id: providerId },
    {
      $set: {
        enabled_categories: {
          movies: enabledCategories.movies,
          tvshows: enabledCategories.tvshows,
          live: enabledCategories.live  // NEW
        },
        lastUpdated: new Date()
      }
    }
  );
  
  // Cleanup disabled categories
  await this._removeProviderFromChannels(providerId, enabledCategories.live);
  
  // Trigger sync job
  this._triggerSyncJob('syncLiveTV');
  
  return { response: { success: true }, statusCode: 200 };
}
```

**New `_removeProviderFromChannels()` Method:**
```javascript
/**
 * Remove channels from disabled categories (similar to _removeProviderFromTitles)
 * Also cleans up watchlist entries for deleted channels
 * @private
 * @param {string} providerId - Provider ID
 * @param {Array<string>} enabledLiveCategories - Array of enabled live category keys
 * @returns {Promise<Object>} Cleanup statistics
 */
async _removeProviderFromChannels(providerId, enabledLiveCategories) {
  const enabledCategoryKeys = new Set(enabledLiveCategories);
  
  // Get all channels for this provider
  const allChannels = await this._channelRepo.findByProvider(providerId);
  
  let channelsDeleted = 0;
  let programsDeleted = 0;
  const deletedChannelKeys = [];
  
  for (const channel of allChannels) {
    // Determine category key based on provider type
    const provider = await this._providerRepo.findOneByQuery({ id: providerId });
    let categoryKey;
    
    if (provider.type === 'xtream') {
      // For Xtream, category_id should be stored in channel metadata
      // This may need to be added during parsing
      const categoryId = channel.category_id || this._extractCategoryIdFromChannel(channel);
      categoryKey = categoryId ? `live-${categoryId}` : null;
    } else if (provider.type === 'agtv') {
      // For AGTV, use normalized group_title
      categoryKey = channel.group_title 
        ? `live-${this._normalizeCategoryName(channel.group_title)}`
        : null;
    }
    
    // Delete channel if category is disabled
    if (categoryKey && !enabledCategoryKeys.has(categoryKey)) {
      // Track deleted channel key for watchlist cleanup
      if (channel.channel_key) {
        deletedChannelKeys.push(channel.channel_key);
      }
      
      // Delete associated programs first
      const deletedPrograms = await this._programRepo.deleteMany({
        provider_id: providerId,
        channel_id: channel.channel_id
      });
      programsDeleted += deletedPrograms;
      
      // Delete channel
      await this._channelRepo.deleteOne({
        provider_id: providerId,
        channel_id: channel.channel_id
      });
      channelsDeleted++;
    }
  }
  
  // Clean up watchlist entries for deleted channels
  let watchlistEntriesRemoved = 0;
  if (deletedChannelKeys.length > 0) {
    const users = await this._userRepo.findByQuery({});
    for (const user of users) {
      if (user.watchlist_channels && user.watchlist_channels.length > 0) {
        const originalLength = user.watchlist_channels.length;
        user.watchlist_channels = user.watchlist_channels.filter(
          key => !deletedChannelKeys.includes(key)
        );
        if (user.watchlist_channels.length !== originalLength) {
          await this._userRepo.updateOne(
            { id: user.id },
            { $set: { watchlist_channels: user.watchlist_channels } }
          );
          watchlistEntriesRemoved += (originalLength - user.watchlist_channels.length);
        }
      }
    }
  }
  
  return {
    channelsDeleted,
    programsDeleted,
    watchlistEntriesRemoved
  };
}
```

#### 4.2 Provider Disable/Delete Cleanup

**Extend `updateProvider()` Method:**
- When provider is disabled (`enabled: false`), channels remain in database
- Channels will be filtered out from API responses (see Technical Details: Provider Disable/Delete Handling)
- No immediate channel deletion needed for disabled providers

**Extend `deleteProvider()` Method:**
- Delete all channels for provider: `await this._channelRepo.deleteByProvider(providerId)`
- Delete all programs for provider: `await this._programRepo.deleteByProvider(providerId)`
- Clean up watchlist entries: Remove channel keys matching `live-{providerId}-*` from all users
- See Technical Details: Provider Disable/Delete Handling for implementation details

#### 4.3 AGTV Category Extraction

**For AGTV providers, categories are extracted on-demand from synced channels:**
- When fetching categories, query channels collection for the provider
- Extract unique `group_title` values
- Normalize category names and return as categories
- More flexible than storing category metadata separately

### Phase 5: SyncLiveTVJob Updates

#### 5.1 Job Refactoring

**Update Job Description:**
```json
{
  "name": "syncLiveTV",
  "jobHistoryName": "SyncLiveTVJob",
  "interval": "12h",
  "description": "Sync Live TV channels and EPG from active IPTV providers (AGTV and Xtream)",
  "schedule": "On startup and Every 12 hours"
}
```

**Update Job Implementation:**
```javascript
async execute() {
  try {
    this.logger.info('Starting Live TV sync job...');
    const result = await this.liveTVManager.syncAllProviders();
    this.logger.info(`Live TV sync completed: ${result.providers_processed} provider(s) processed`);
    return result;
  } catch (error) {
    this.logger.error(`Live TV sync job failed: ${error.message}`);
    throw error;
  }
}
```

### Phase 6: API/Routes Updates

#### 6.1 XtreamManager Updates

**Update Live Channel Methods:**
```javascript
/**
 * Get Live TV categories (aggregated from all providers)
 * @param {Object} user - Authenticated user object (for compatibility)
 * @returns {Promise<Array>} Array of category objects
 */
async getLiveCategories(user) {
  try {
    const channels = await this._liveTVManager.getAllChannels();
    const categories = new Map();
    
    channels.forEach(channel => {
      if (channel.group_title && !categories.has(channel.group_title)) {
        categories.set(channel.group_title, {
          category_id: categories.size + 1,
          category_name: channel.group_title,
          parent_id: 0
        });
      }
    });
    
    return Array.from(categories.values());
  } catch (error) {
    this.logger.error('Error getting Live TV categories:', error);
    return [];
  }
}

/**
 * Get Live TV streams (aggregated from all providers)
 * @param {Object} user - Authenticated user object
 * @param {string} baseUrl - Base URL for stream endpoints
 * @param {number} [categoryId] - Optional category ID to filter
 * @returns {Promise<Array>} Array of channel stream objects
 */
async getLiveStreams(user, baseUrl, categoryId = null) {
  try {
    const channels = await this._liveTVManager.getAllChannels();
    // Filter by category if specified
    // Convert to Xtream format
    // ...
  } catch (error) {
    this.logger.error('Error getting Live TV streams:', error);
    return [];
  }
}
```

**Remove User Dependency:**
- Remove checks for `user.liveTV.m3u_url`
- Channels are now available to all users

#### 6.2 LiveTVRouter Updates

**Update Endpoints:**
```javascript
// GET /api/livetv/channels
// Returns channels from all active providers
// Query params: watchlist (true/false, default: true), providerId, search
this.router.get('/channels', this.middleware.requireAuth, async (req, res) => {
  try {
    const { watchlist, providerId, search } = req.query;
    const userId = req.user.id;
    
    const options = {
      userId,
      watchlist: watchlist === 'true' ? true : watchlist === 'false' ? false : undefined,
      providerId,
      search
    };
    
    // Default to watchlist=true if not specified
    if (options.watchlist === undefined) {
      options.watchlist = true;
    }
    
    const channels = await this._liveTVManager.getAllChannels(options);
    return res.status(200).json(channels);
  } catch (error) {
    return this.returnErrorResponse(res, 500, 'Failed to get channels', error.message);
  }
});

// GET /api/livetv/providers/:providerId/channels
// Returns channels for a specific provider
this.router.get('/providers/:providerId/channels', this.middleware.requireAuth, async (req, res) => {
  try {
    const { providerId } = req.params;
    const { watchlist, search } = req.query;
    const userId = req.user.id;
    
    const options = {
      userId,
      providerId,
      watchlist: watchlist === 'true' ? true : watchlist === 'false' ? false : undefined,
      search
    };
    
    // Default to watchlist=true if not specified
    if (options.watchlist === undefined) {
      options.watchlist = true;
    }
    
    const channels = await this._liveTVManager.getAllChannels(options);
    return res.status(200).json(channels);
  } catch (error) {
    return this.returnErrorResponse(res, 500, 'Failed to get provider channels', error.message);
  }
});

// POST /api/livetv/watchlist
// Add channel to watchlist
this.router.post('/watchlist', this.middleware.requireAuth, async (req, res) => {
  try {
    const { channelKey } = req.body;
    if (!channelKey) {
      return this.returnErrorResponse(res, 400, 'channelKey is required', 'Missing channelKey');
    }
    const userId = req.user.id;
    await this._liveTVManager.addToWatchlist(userId, channelKey);
    return res.status(200).json({ success: true });
  } catch (error) {
    return this.returnErrorResponse(res, 500, 'Failed to add to watchlist', error.message);
  }
});

// DELETE /api/livetv/watchlist/:channelKey
// Remove channel from watchlist
this.router.delete('/watchlist/:channelKey', this.middleware.requireAuth, async (req, res) => {
  try {
    const { channelKey } = req.params;
    const userId = req.user.id;
    await this._liveTVManager.removeFromWatchlist(userId, channelKey);
    return res.status(200).json({ success: true });
  } catch (error) {
    return this.returnErrorResponse(res, 500, 'Failed to remove from watchlist', error.message);
  }
});
```

#### 6.3 ProfileRouter Updates

**Remove Live TV Configuration:**
- Remove `PUT /api/profile` endpoint support for `liveTV` field
- Remove Live TV configuration validation
- Update profile response to exclude `liveTV` field

### Phase 7: UI Updates

#### 7.1 Remove ProfileLiveTV Component

**Changes:**
- Remove `ProfileLiveTV.jsx` component
- Remove Live TV configuration section from profile page
- Update profile API calls to not send `liveTV` data

#### 7.2 Update ChannelsList Component

**Changes:**
- Update to show provider information for each channel
- Add provider filter/grouping option
- Update API calls to use new endpoints
- Remove user-specific channel assumptions
- Add watchlist toggle (default: show only watchlist channels)
- Add watchlist add/remove buttons for each channel
- Display watchlist status for each channel
- Support search and provider filtering

#### 7.3 Update Stremio Integration

**Changes:**
- Update `StremioManager.getCatalog('tv')` to use `getAllChannels()`
- Remove check for `user.liveTV.m3u_url`
- Channels available to all authenticated users

### Phase 8: Database Migration

**Removing old data starting as new feature** - Drop `channels` and `programs` collections, remove `liveTV` field from user profiles. Channels will be automatically repopulated from active providers on first sync job run.

## Technical Details

### Channel ID Uniqueness

**Challenge:** Channel IDs may conflict across providers.

**Solution:**
- Use composite key: `{ provider_id: 1, channel_id: 1 }` (unique compound index)
- Channel IDs are unique per provider, not globally
- When aggregating channels, include `provider_id` in response

### Channel Key Format

**Format:** `live-{providerId}-{channelId}`
- **Purpose**: Unique identifier per provider for watchlist management
- **Example**: `live-provider-123-channel-456`
- **Storage**: Stored in `channels.channel_key` field
- **Index**: Index on `channel_key` for efficient watchlist queries
- **Generation**: Created during sync using `_generateChannelKey(providerId, channelId)`

### Watchlist Management

**User Watchlist:**
- Stored in `user.watchlist_channels` array (channel keys)
- Default view shows only watchlist channels (`watchlist=true` by default)
- Users can toggle between watchlist and all channels via query parameter
- Watchlist filtering happens at API level after fetching channels

**Watchlist Operations:**
- **Add**: `POST /api/livetv/watchlist` with `{ channelKey: "live-{providerId}-{channelId}" }`
- **Remove**: `DELETE /api/livetv/watchlist/:channelKey`
- **Filter**: 
  - `GET /api/livetv/channels?watchlist=true` (default - only watchlist channels)
  - `GET /api/livetv/channels?watchlist=false` (all channels except watchlist)
  - `GET /api/livetv/channels` (defaults to watchlist=true)

**Default View Behavior:**
- When `watchlist` parameter is not specified, defaults to `true`
- This means users see only their watchlist channels by default
- Users can explicitly request all channels with `?watchlist=false`

### Category Management

#### Category Key Format

**Xtream:**
- Format: `live-{category_id}`
- Example: `live-1`, `live-5`, `live-12`
- Category ID comes directly from API response

**AGTV:**
- Format: `live-{normalized_category_name}`
- Example: `live-sports`, `live-news`, `live-entertainment`
- Normalization process:
  1. Convert to lowercase
  2. Trim whitespace
  3. Replace non-alphanumeric characters with hyphens
  4. Remove leading/trailing hyphens
  5. Collapse multiple hyphens to single hyphen

**Category Name Normalization Examples:**
- `"Sports & Entertainment"` → `"sports-entertainment"`
- `"News (HD)"` → `"news-hd"`
- `"Kids/Children"` → `"kids-children"`
- `"  Movies   "` → `"movies"`

#### Category Filtering During Sync

**Process:**
1. Fetch all channels/categories from provider
2. Check `provider.enabled_categories.live` array
3. Filter channels to only include those from enabled categories
4. Store only filtered channels
5. Delete channels from disabled categories (if any exist)

#### Category Extraction for AGTV

**Since AGTV doesn't have a category API, categories are extracted on-demand from synced channels:**
- Query channels collection for provider
- Extract unique `group_title` values
- Normalize category names using `_normalizeCategoryName()` (see Phase 3.2)
- Return as categories with original names preserved for display
- Always reflects current channel state

#### Category Lifecycle Changes

**When Categories are Enabled/Disabled:**
- **Enabled**: Channels from newly enabled categories are synced on next sync job run
- **Disabled**: Channels from disabled categories are immediately deleted via `_removeProviderFromChannels()`
- Watchlist entries for deleted channels should be cleaned up (channels no longer exist)
- Sync job is triggered automatically when categories are updated via `updateEnabledCategories()`

**When Category Names Change (AGTV):**
- **Problem**: AGTV categories come from `group_title` in M3U8, which can change
- **Impact**: Old category key becomes invalid, new category key is created
- **Behavior**:
  - Old channels with old category key are deleted (category no longer matches)
  - New channels with new category key are synced
  - If category is enabled, new channels appear; if disabled, they won't sync
- **Watchlist Impact**: Channels with old category keys are removed from watchlist (channels deleted)

**When Category Names Change (Xtream):**
- **Less Common**: Xtream uses numeric `category_id` which is more stable
- **If Category ID Changes**: Similar to AGTV - old channels deleted, new channels synced
- **If Only Name Changes**: Category key remains same (`live-{category_id}`), no impact

**When New Categories Appear:**
- **Xtream**: New categories appear in `get_live_categories` API response
- **AGTV**: New categories appear when channels with new `group_title` values are synced
- **Behavior**: 
  - New categories are available in category list
  - If auto-enabled (depends on UI logic), channels sync automatically
  - If manual enable required, channels won't sync until category is enabled

**When Categories Disappear:**
- **Xtream**: Category no longer in API response
- **AGTV**: No channels with that `group_title` in M3U8
- **Behavior**:
  - Category key remains in `enabled_categories.live` but has no channels
  - No channels to delete (already removed during sync)
  - Category can be manually removed from enabled list in UI

**Watchlist Cleanup on Category Changes:**
- When channels are deleted due to category changes, their channel keys are automatically removed from all users' watchlists
- Implementation: Handled by `_removeProviderFromChannels()` method (see Phase 4.1)
- The method tracks deleted channel keys and cleans up watchlist entries for all affected users

**Sync Behavior:**
- Sync job runs every 12 hours automatically
- When categories are updated via `updateEnabledCategories()`, sync job is triggered immediately
- Sync fetches latest categories/channels and applies current enabled category filter
- Channels are added/removed based on current enabled categories state

### EPG Handling

**Options:**
1. **Provider-Level EPG**: Each provider may have its own EPG URL
2. **Global EPG**: Single EPG source for all providers
3. **Hybrid**: Provider EPG if available, fallback to global

**Recommended:** Provider-level EPG stored in provider configuration:
```javascript
{
  id: "provider-id",
  type: "xtream",
  // ... other fields ...
  epg_url: "https://example.com/epg.xml"  // Optional
}
```

### Provider Disable/Delete Handling

**When Provider is Disabled:**
- Channels remain in the database (not deleted)
- Sync job skips disabled providers (`enabled: false`)
- Channels from disabled providers are filtered out from API responses
- User watchlist entries remain but channels won't appear (filtered out)
- If provider is re-enabled, channels will sync again on next job run

**When Provider is Deleted:**
- Provider is marked as `deleted: true` (logical delete)
- Channels and programs are deleted from database
- User watchlist entries containing channel keys from deleted provider are cleaned up
- Sync job skips deleted providers (`deleted: { $ne: true }`)

**Implementation Requirements:**

1. **Provider Disable Cleanup** (in `ProvidersManager.updateProvider()`):
   - When `enabled` changes from `true` to `false`:
     - Channels remain in database (no immediate deletion)
     - Channels will be filtered out from `getAllChannels()` responses
     - No watchlist cleanup needed (channels filtered but not deleted)

2. **Provider Delete Cleanup** (in `ProvidersManager.deleteProvider()`):
   - Delete all channels for provider: `await this._channelRepo.deleteByProvider(providerId)`
   - Delete all programs for provider: `await this._programRepo.deleteByProvider(providerId)`
   - Clean up watchlist entries: Remove channel keys matching `live-{providerId}-*` from all users' `watchlist_channels` arrays

3. **API Response Filtering**:
   - `getAllChannels()` should filter out channels from disabled/deleted providers
   - Check provider status before returning channels:
     ```javascript
     // Filter out channels from disabled/deleted providers
     const activeProviders = await this._providerRepo.findByQuery({
       enabled: true,
       deleted: { $ne: true }
     });
     const activeProviderIds = new Set(activeProviders.map(p => p.id));
     channels = channels.filter(ch => activeProviderIds.has(ch.provider_id));
     ```

4. **Watchlist Cleanup on Provider Delete**:
   - When provider is deleted, remove all channel keys matching pattern `live-{providerId}-*` from all users
   - This prevents orphaned watchlist entries
   - Example implementation:
     ```javascript
     // In ProvidersManager.deleteProvider()
     const watchlistPattern = `live-${providerId}-`;
     const users = await this._userRepo.findByQuery({});
     let watchlistEntriesRemoved = 0;

     for (const user of users) {
       if (user.watchlist_channels && user.watchlist_channels.length > 0) {
         const originalLength = user.watchlist_channels.length;
         user.watchlist_channels = user.watchlist_channels.filter(
           key => !key.startsWith(watchlistPattern)
         );
         if (user.watchlist_channels.length !== originalLength) {
           await this._userRepo.updateOne(
             { id: user.id },
             { $set: { watchlist_channels: user.watchlist_channels } }
           );
           watchlistEntriesRemoved += (originalLength - user.watchlist_channels.length);
         }
       }
     }
     ```

### Stream URL Generation

**Current:**
- Stream URLs use user API key: `/livetv/stream/{channelId}?api_key={api_key}`

**After:**
- Stream URLs include provider context: `/livetv/stream/{providerId}/{channelId}?api_key={api_key}`
- Or use existing format but resolve provider from channel lookup

### Error Handling

**Provider Sync Failures:**
- Log error but continue with other providers
- Don't fail entire job if one provider fails
- Track last successful sync per provider

**Missing Provider Methods:**
- Gracefully handle providers that don't support live channels
- Skip providers without live channel support
- Log warnings for unsupported providers

## API Changes

### Breaking Changes

1. **Channel Access:**
   - `GET /api/livetv/channels` - Now returns all provider channels (not user-specific)
   - Response format unchanged, but data source changed

2. **Profile API:**
   - `PUT /api/profile` - No longer accepts `liveTV` field
   - `GET /api/profile` - No longer returns `liveTV` field

3. **Channel Queries:**
   - Internal methods now use `provider_id` instead of `username`
   - External API remains compatible

### New Endpoints

1. **Provider Channels:**
   - `GET /api/livetv/providers/:providerId/channels` - Get channels for specific provider
   - Query params: `watchlist` (true/false, default: true), `search`

2. **Provider Programs:**
   - `GET /api/livetv/providers/:providerId/channels/:channelId/programs` - Get programs for provider channel

3. **Watchlist Management:**
   - `POST /api/livetv/watchlist` - Add channel to watchlist (body: `{ channelKey: "live-{providerId}-{channelId}" }`)
   - `DELETE /api/livetv/watchlist/:channelKey` - Remove channel from watchlist

### Updated Endpoints

1. **Channels Endpoint:**
   - `GET /api/livetv/channels` - Now supports query parameters:
     - `watchlist` (true/false, default: true) - Filter by watchlist
     - `providerId` - Filter by provider
     - `search` - Search channels by name

## Database Considerations

### Indexes

**Channels Collection:**
- `{ provider_id: 1, channel_id: 1 }` - Unique compound (primary lookup)
- `{ provider_id: 1 }` - Provider channels lookup
- `{ channel_key: 1 }` - Channel key lookup (for watchlist queries)

**Programs Collection:**
- `{ provider_id: 1, channel_id: 1, start: 1, stop: 1 }` - Unique compound
- `{ provider_id: 1, channel_id: 1 }` - Provider channel programs lookup

## Monitoring & Logging

### Job Logging

- Log number of providers processed
- Log success/failure for each provider
- Log number of channels synced per provider
- Track job execution time
- Log any provider-specific errors

### Provider Logging

- Log when provider channels are synced
- Log channel count per provider
- Log EPG sync status per provider
- Track last successful sync timestamp

## Future Enhancements

1. **Provider EPG Configuration**: Add EPG URL to provider configuration
2. **Channel Filtering**: Allow filtering channels by provider in UI
3. **Channel Groups**: Better organization of channels by provider
4. **EPG Merging**: Merge EPG data from multiple providers
5. **Channel Metadata**: Enhanced metadata per channel (language, quality, etc.)
6. **Bulk Watchlist Operations**: Add/remove multiple channels at once

## Testing Considerations

1. **Unit Tests**
   - Test provider-specific channel fetching methods
   - Test channel parsing (Xtream JSON vs AGTV M3U8)
   - Test repository methods with `provider_id`
   - Test error handling
   - Test category normalization (AGTV)
   - Test category key generation (both providers)
   - Test category filtering logic

2. **Integration Tests**
   - Test sync job execution
   - Test channel aggregation from multiple providers
   - Test API endpoints with provider-based channels
   - Test EPG synchronization
   - Test category management (enable/disable)
   - Test channel cleanup when categories disabled
   - Test category extraction for AGTV
   - Test watchlist filtering (true/false/undefined)
   - Test default watchlist view behavior
   - Test watchlist add/remove operations
   - Test channel key generation and uniqueness
   - Test provider disable (channels remain but filtered out)
   - Test provider delete (channels and programs deleted, watchlist cleaned up)
   - Test provider re-enable (channels sync again)
   - Test API filtering of disabled/deleted provider channels
   - Test category enable/disable (channels added/removed)
   - Test category name changes (AGTV and Xtream)
   - Test new categories appearing
   - Test categories disappearing
   - Test watchlist cleanup when channels deleted due to category changes

3. **Edge Cases**
   - Provider with invalid credentials (error handling)
   - Provider API changes breaking compatibility (error handling)
   - Network timeouts during sync (error handling)
   - Rate limiting scenarios (error handling)
   - Invalid channel keys in watchlist (data integrity)
   - Duplicate channel keys in watchlist array (data integrity)
   - Category name normalization logic changes (rare code change scenario)

## Dependencies

- Existing provider infrastructure (`XtreamProvider`, `AGTVProvider`)
- Existing job infrastructure (`BaseJob`, `EngineScheduler`)
- Existing repository infrastructure (`ChannelRepository`, `ProgramRepository`)
- Existing manager infrastructure (`LiveTVManager`, `ProvidersManager`)

## Timeline

1. **Phase 1**: Provider implementation (2-3 days)
2. **Phase 2**: Repository updates (1 day)
3. **Phase 3**: LiveTVManager refactoring (2-3 days)
4. **Phase 4**: Category management integration (2-3 days)
5. **Phase 5**: SyncLiveTVJob updates (1 day)
6. **Phase 6**: API/Routes updates (2 days)
7. **Phase 7**: UI updates (1-2 days)
8. **Phase 8**: Database migration (removing old data) (1 day)
9. **Phase 9**: Watchlist functionality (2 days)

**Total Estimated Time**: 14-19 days

## Migration Notes

### For Users

- **No Action Required**: Channels will automatically sync from providers
- **Configuration Removed**: Live TV M3U/EPG URLs no longer needed in profile
- **First Sync**: Channels may not be available until first sync job completes (up to 12 hours)

### For Administrators

- **Provider Configuration**: Ensure providers are properly configured and enabled
- **Sync Schedule**: Monitor sync job execution
- **Channel Availability**: Verify channels are syncing correctly from each provider
- **EPG Configuration**: Configure provider-level EPG URLs if needed

