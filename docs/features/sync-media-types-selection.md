# Sync Media Types Selection Feature [New]

## Overview

This feature adds the ability to selectively enable or disable syncing of different media types (Movies, TV Shows, Live TV) per IPTV provider. Users can configure which media types should be synced from each provider, allowing for more granular control over content synchronization and reducing unnecessary API calls and storage usage.

## Goals

1. **Selective Media Type Syncing**: Allow users to choose which media types (Movies, TV Shows, Live TV) to sync per provider
2. **Reduced Resource Usage**: Skip syncing unused media types to reduce API calls, processing time, and storage
3. **Conditional Category Display**: Only show category selection tabs for enabled media types
4. **Clean Data Management**: Properly handle data cleanup when media types are disabled
5. **Backward Compatibility**: Existing providers automatically have all media types enabled via migration

## Current Architecture

### Existing Implementation

**Provider Configuration:**
- Providers have `enabled_categories` field with `movies`, `tvshows`, and `live` arrays
- Categories control which specific categories are synced within each media type
- All media types are synced by default (no way to disable entire media type)

**Sync Jobs:**
- `SyncIPTVProviderTitlesJob`: Syncs both movies and TV shows from all enabled providers
- `SyncLiveTVJob`: Syncs Live TV channels from all enabled providers
- Jobs process all enabled providers regardless of media type preferences

**UI:**
- Category tabs (Movies, TV Shows) are always shown for Xtream providers
- No way to disable syncing of entire media types

**Limitations:**
- Cannot disable syncing of entire media types (only specific categories)
- All media types are always synced, even if not needed
- Wastes API calls and processing time for unused media types
- No way to selectively enable/disable media types per provider

## Feature Requirements

### User Interface

1. **Provider Details Form:**
   - Add three checkboxes: "Sync Movies", "Sync TV Shows", "Sync Live TV"
   - Default state: All unchecked (false) for new providers
   - Checkboxes should be visible for both AGTV and Xtream providers
   - Save state as part of provider configuration

2. **Conditional Category Tabs:**
   - Movies tab: Only show if `sync_media_types.movies === true`
   - TV Shows tab: Only show if `sync_media_types.tvshows === true`
   - Live TV categories: Handled differently (no separate tab, categories extracted from channels)

3. **Visual Feedback:**
   - Show which media types are enabled/disabled in provider card
   - Disable category selection if media type is disabled

### Data Structure Changes

#### iptv_providers Collection

**New Field:**
```javascript
{
  // ... existing fields ...
  sync_media_types: {
    movies: Boolean,      // Default: false (new providers), true (migrated)
    tvshows: Boolean,     // Default: false (new providers), true (migrated)
    live: Boolean         // Default: false (new providers), true (migrated)
  }
}
```

**Schema Version:**
- Current: v2 (includes `enabled_categories.live`)
- New: v3 (adds `sync_media_types`)

### Behavior Changes

#### When Media Type is Disabled

**Movies/TV Shows:**
1. **Stop Syncing**: Future `SyncIPTVProviderTitlesJob` runs skip this media type for this provider
2. **Keep Provider Titles**: Do NOT delete `provider_titles` entries (in case user re-enables later)
3. **Remove from Main Titles**: Remove provider streams from `titles.media[].sources` for this type
4. **Clean Up Empty Titles**: Delete titles that have no media items left after removal
5. **Preserve Categories**: Keep `enabled_categories` settings (user may re-enable later)

**Live TV:**
1. **Stop Syncing**: Future `SyncLiveTVJob` runs skip this provider for Live TV
2. **Delete Channels**: Delete all channels for this provider
3. **Delete Programs**: Delete associated programs
4. **Clean Up Watchlist**: Remove channel keys from all user watchlists

#### When Media Type is Enabled

**Movies/TV Shows:**
1. **Start Syncing**: Future `SyncIPTVProviderTitlesJob` runs include this media type
2. **Show Categories**: Category tabs become visible in UI
3. **Trigger Sync**: Optionally trigger sync job to fetch data immediately (async, non-blocking)
4. **Use Existing Categories**: If `enabled_categories` already has entries, use them; otherwise user selects categories

**Live TV:**
1. **Start Syncing**: Future `SyncLiveTVJob` runs include this provider
2. **Trigger Sync**: Optionally trigger Live TV sync job (async, non-blocking)

## Implementation Details

### 1. Database Schema Changes

#### ProviderRepository Schema Versioning

**Add v3 Schema:**
```javascript
"v3": {
  "id": 3,
  "structure": {
    // ... existing v2 fields ...
    sync_media_types: {
      movies: Boolean,
      tvshows: Boolean,
      live: Boolean
    }
  },
  "transformation": async (doc) => {
    // Migration: For existing providers, enable all media types
    return {
      ...doc,
      sync_media_types: {
        movies: true,
        tvshows: true,
        live: true
      }
    };
  }
}
```

**Update Repository:**
- Change default schema version from `v2` to `v3`
- Ensure transformation runs for all existing documents

### 2. Backend Changes

#### IPTVProviderManager

**Update `createProvider()`:**
- Validate `sync_media_types` structure
- Default to `{ movies: false, tvshows: false, live: false }` if not provided
- Store in provider document

**Update `updateProvider()`:**
- Validate `sync_media_types` structure
- Allow partial updates (only update provided fields)

**Add Validation:**
```javascript
if (providerData.sync_media_types) {
  if (typeof providerData.sync_media_types !== 'object') {
    throw new ValidationError('sync_media_types must be an object');
  }
  const validKeys = ['movies', 'tvshows', 'live'];
  for (const key of Object.keys(providerData.sync_media_types)) {
    if (!validKeys.includes(key)) {
      throw new ValidationError(`Invalid sync_media_types key: ${key}`);
    }
    if (typeof providerData.sync_media_types[key] !== 'boolean') {
      throw new ValidationError(`sync_media_types.${key} must be a boolean`);
    }
  }
}
```

#### ProvidersManager

**Update `updateProvider()` Method:**

Add logic to detect and handle `sync_media_types` changes:

```javascript
async updateProvider(providerId, providerData) {
  const existingProvider = await this._iptvProviderManager.getProvider(providerId);
  
  // Get existing and new sync_media_types
  const existingSyncTypes = existingProvider.sync_media_types || { 
    movies: false, tvshows: false, live: false 
  };
  const newSyncTypes = providerData.sync_media_types || { 
    movies: false, tvshows: false, live: false 
  };
  
  // Detect changes
  const moviesRemoved = existingSyncTypes.movies && !newSyncTypes.movies;
  const tvshowsRemoved = existingSyncTypes.tvshows && !newSyncTypes.tvshows;
  const liveRemoved = existingSyncTypes.live && !newSyncTypes.live;
  
  const moviesAdded = !existingSyncTypes.movies && newSyncTypes.movies;
  const tvshowsAdded = !existingSyncTypes.tvshows && newSyncTypes.tvshows;
  const liveAdded = !existingSyncTypes.live && newSyncTypes.live;
  
  // Update provider
  const updatedProvider = await this._iptvProviderManager.updateProvider(providerId, providerData);
  
  // Handle Movies/TV Shows removal
  if (moviesRemoved || tvshowsRemoved) {
    const typesToRemove = [];
    if (moviesRemoved) typesToRemove.push('movies');
    if (tvshowsRemoved) typesToRemove.push('tvshows');
    
    // Filter enabled_categories to only include enabled types
    const enabledCategories = {
      movies: newSyncTypes.movies ? (updatedProvider.enabled_categories?.movies || []) : [],
      tvshows: newSyncTypes.tvshows ? (updatedProvider.enabled_categories?.tvshows || []) : [],
      live: updatedProvider.enabled_categories?.live || []
    };
    
    // Remove from titles but keep provider_titles
    await this._removeProviderFromTitles(
      providerId,
      false,
      enabledCategories,
      false, // Don't delete provider_titles
      typesToRemove // Filter by type
    );
  }
  
  // Handle Live TV removal
  if (liveRemoved) {
    // Delete all channels and programs for this provider
    await this._removeProviderFromChannels(providerId, []);
  }
  
  // Handle Movies/TV Shows addition
  if (moviesAdded || tvshowsAdded) {
    // Trigger sync job to fetch data
    this._triggerJobAsync('syncIPTVProviderTitles');
  }
  
  // Handle Live TV addition
  if (liveAdded) {
    // Trigger sync job to fetch channels
    this._triggerJobAsync('syncLiveTV');
  }
  
  // ... rest of existing logic ...
}
```

**Update `_removeProviderFromTitles()` Method:**

Add `types` parameter to filter by media type:

```javascript
/**
 * Remove provider from titles (for specific media types)
 * @param {string} providerId - Provider ID
 * @param {boolean} isEnabled - Whether provider is enabled
 * @param {Object} enabledCategories - Enabled categories object
 * @param {boolean} deleteProviderTitles - Whether to delete provider_titles
 * @param {Array<string>} [types] - Optional array of types to filter (e.g., ['movies', 'tvshows'])
 * @returns {Promise<Object>} Cleanup statistics
 */
async _removeProviderFromTitles(providerId, isEnabled, enabledCategories, deleteProviderTitles = true, types = null) {
  // Build query - filter by type if specified
  const query = { provider_id: providerId };
  if (types && Array.isArray(types) && types.length > 0) {
    query.type = { $in: types };
  }
  
  // ... rest of existing logic ...
}
```

#### SyncIPTVProviderTitlesJob

**Update `execute()` Method:**

Only fetch metadata for enabled media types:

```javascript
async execute() {
  // ... existing setup code ...
  
  const results = await Promise.all(
    enabledHandlers.map(async ([providerId, handler]) => {
      try {
        this.logger.debug(`[${providerId}] Processing provider (${handler.getProviderType()})`);
        this.logger.info(`Fetching metadata from provider ${providerId}...`);
        
        // Get sync_media_types from provider config
        const syncTypes = handler.providerData.sync_media_types || { 
          movies: false, tvshows: false, live: false 
        };
        
        // Build fetch promises based on enabled types
        const fetchPromises = [];
        const results = {};
        
        if (syncTypes.movies) {
          fetchPromises.push(
            handler.fetchMetadata('movies')
              .then(count => { results.movies = count; })
              .catch(err => {
                this.logger.error(`[${providerId}] Error fetching movies: ${err.message}`);
                results.movies = 0;
              })
          );
        } else {
          results.movies = 0;
        }
        
        if (syncTypes.tvshows) {
          fetchPromises.push(
            handler.fetchMetadata('tvshows')
              .then(count => { results.tvShows = count; })
              .catch(err => {
                this.logger.error(`[${providerId}] Error fetching TV shows: ${err.message}`);
                results.tvShows = 0;
              })
          );
        } else {
          results.tvShows = 0;
        }
        
        // Wait for all enabled fetches
        await Promise.all(fetchPromises);
        
        return {
          providerId,
          providerName: providerId,
          movies: results.movies,
          tvShows: results.tvShows
        };
      } catch (error) {
        this.logger.error(`[${providerId}] Error processing provider: ${error.message}`);
        return {
          providerId,
          providerName: providerId,
          error: error.message
        };
      }
    })
  );
  
  // ... rest of existing code ...
}
```

#### SyncLiveTVJob

**Update `execute()` Method:**

Filter providers to only those with Live TV sync enabled:

```javascript
async execute() {
  try {
    this.logger.info('Starting Live TV sync job...');
    
    // Get active providers with Live TV sync enabled
    const providers = await this._iptvProviderManager.findByQuery({
      type: { $in: ['agtv', 'xtream'] },
      enabled: { $ne: false },
      deleted: { $ne: true },
      'sync_media_types.live': true // Only providers with live sync enabled
    });
    
    if (providers.length === 0) {
      this.logger.info('No active providers found for Live TV sync');
      return {
        providers_processed: 0,
        results: []
      };
    }
    
    // Sync Live TV for enabled providers
    const result = await this._liveTVProcessingManager.syncProviders(providers);
    
    this.logger.info(`Live TV sync completed: ${result.providers_processed} provider(s) processed`);
    return result;
  } catch (error) {
    this.logger.error(`Live TV sync job failed: ${error.message}`);
    throw error;
  }
}
```

#### ProvidersManager.getCategories()

**Update Method:**

Only fetch categories for enabled media types:

```javascript
async getCategories(providerId) {
  try {
    // Validate provider exists
    const providerData = await this._iptvProviderManager.getProvider(providerId);
    
    // Get sync_media_types
    const syncTypes = providerData.sync_media_types || { 
      movies: false, tvshows: false, live: false 
    };
    
    // Fetch categories only for enabled types
    const fetchPromises = [];
    
    if (syncTypes.movies) {
      fetchPromises.push(
        this.fetchCategories(providerId, 'movies').catch(() => [])
      );
    } else {
      fetchPromises.push(Promise.resolve([]));
    }
    
    if (syncTypes.tvshows) {
      fetchPromises.push(
        this.fetchCategories(providerId, 'tvshows').catch(() => [])
      );
    } else {
      fetchPromises.push(Promise.resolve([]));
    }
    
    const [moviesCategories, tvshowsCategories] = await Promise.all(fetchPromises);
    
    // Fetch live categories if enabled
    let liveCategories = [];
    if (syncTypes.live) {
      try {
        const provider = await this._getProvider(providerId);
        if (providerData.type === 'xtream' && provider.fetchLiveCategories) {
          liveCategories = await provider.fetchLiveCategories(providerId);
        } else if (providerData.type === 'agtv') {
          const channels = await this._channelManager.findByProvider(providerId);
          liveCategories = this._extractCategoriesFromChannels(channels);
        }
      } catch (error) {
        this.logger.warn(`Failed to fetch live categories for ${providerId}: ${error.message}`);
      }
    }
    
    // Get enabled categories from provider config
    const enabledCategories = providerData.enabled_categories || { movies: [], tvshows: [], live: [] };
    const enabledCategoryKeys = new Set([
      ...(enabledCategories.movies || []),
      ...(enabledCategories.tvshows || []),
      ...(enabledCategories.live || [])
    ]);
    
    // Transform and combine categories
    // ... rest of existing logic ...
  } catch (error) {
    this.logger.error(`Error getting categories for ${providerId}: ${error.message}`);
    throw new AppError(`Failed to get categories: ${error.message}`, 500);
  }
}
```

### 3. Frontend Changes

#### ProviderDetailsForm.jsx

**Add Sync Media Types Checkboxes:**

```jsx
// Add to formData state
const [formData, setFormData] = useState({
  // ... existing fields ...
  sync_media_types: {
    movies: false,
    tvshows: false,
    live: false
  }
});

// Add handler
const handleSyncMediaTypeChange = (e) => {
  const field = e.target.name; // e.g., "sync_media_types.movies"
  const [parent, child] = field.split('.');
  
  setFormData(prev => ({
    ...prev,
    [parent]: {
      ...prev[parent],
      [child]: e.target.checked
    }
  }));
};

// Add to form JSX (after enabled checkbox)
<Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 2 }}>
  <Typography variant="subtitle2" sx={{ mb: 1 }}>
    Sync Media Types
  </Typography>
  <FormControlLabel
    control={
      <Checkbox
        checked={formData.sync_media_types?.movies ?? false}
        onChange={handleSyncMediaTypeChange}
        name="sync_media_types.movies"
      />
    }
    label="Sync Movies"
  />
  <FormControlLabel
    control={
      <Checkbox
        checked={formData.sync_media_types?.tvshows ?? false}
        onChange={handleSyncMediaTypeChange}
        name="sync_media_types.tvshows"
      />
    }
    label="Sync TV Shows"
  />
  <FormControlLabel
    control={
      <Checkbox
        checked={formData.sync_media_types?.live ?? false}
        onChange={handleSyncMediaTypeChange}
        name="sync_media_types.live"
      />
    }
    label="Sync Live TV"
  />
</Box>
```

**Update Initialization:**

```jsx
useEffect(() => {
  if (provider?.id) {
    // ... existing initialization ...
    setFormData({
      // ... existing fields ...
      sync_media_types: provider.sync_media_types || {
        movies: false,
        tvshows: false,
        live: false
      }
    });
  } else {
    // New provider - default all to false
    setFormData({
      // ... existing fields ...
      sync_media_types: {
        movies: false,
        tvshows: false,
        live: false
      }
    });
  }
}, [provider]);
```

**Update Save Handler:**

```jsx
const handleSubmit = useCallback((e) => {
  // ... existing code ...
  
  const data = {
    // ... existing fields ...
    sync_media_types: formData.sync_media_types || {
      movies: false,
      tvshows: false,
      live: false
    }
  };
  
  onSave(data);
}, [formData, onSave]);
```

#### SettingsIPTVProviders.jsx

**Update `renderTabs()` Method:**

Conditionally show category tabs based on `sync_media_types`:

```jsx
const renderTabs = () => {
  const tabs = [
    <Tab
      key="details"
      value="details"
      label="Details"
      sx={{
        '&.Mui-selected': {
          color: 'primary.main',
        }
      }}
    />
  ];

  if (!isNewProvider && selectedProvider?.type?.toLowerCase() === 'xtream') {
    tabs.push(
      <Tab
        key="cleanup"
        value="cleanup"
        label="Cleanup Rules"
        sx={{
          '&.Mui-selected': {
            color: 'primary.main',
          }
        }}
      />
    );
    
    // Only show Movies tab if movies sync is enabled
    if (selectedProvider?.sync_media_types?.movies) {
      tabs.push(
        <Tab
          key="movies"
          value="movies"
          label="Movies"
          sx={{
            '&.Mui-selected': {
              color: 'primary.main',
            }
          }}
        />
      );
    }
    
    // Only show TV Shows tab if tvshows sync is enabled
    if (selectedProvider?.sync_media_types?.tvshows) {
      tabs.push(
        <Tab
          key="tvshows"
          value="tvshows"
          label="TV Shows"
          sx={{
            '&.Mui-selected': {
              color: 'primary.main',
            }
          }}
        />
      );
    }
  }

  // Ignored Titles tab available for all providers
  if (!isNewProvider) {
    tabs.push(
      <Tab
        key="ignored"
        value="ignored"
        label="Ignored Titles"
        sx={{
          '&.Mui-selected': {
            color: 'primary.main',
          }
        }}
      />
    );
  }

  return tabs;
};
```

**Update `renderTabContent()` Method:**

Add validation to prevent accessing disabled media type tabs:

```jsx
case 'movies':
  if (!isNewProvider && 
      selectedProvider?.type?.toLowerCase() === 'xtream' &&
      selectedProvider?.sync_media_types?.movies) {
    return (
      <ExcludedCategoriesForm
        provider={selectedProvider}
        categoryType="movies"
        categories={categories}
        loading={loadingCategories}
        onCategoryUpdate={loadCategories}
      />
    );
  }
  return null;
case 'tvshows':
  if (!isNewProvider && 
      selectedProvider?.type?.toLowerCase() === 'xtream' &&
      selectedProvider?.sync_media_types?.tvshows) {
    return (
      <ExcludedCategoriesForm
        provider={selectedProvider}
        categoryType="tvshows"
        categories={categories}
        loading={loadingCategories}
        onCategoryUpdate={loadCategories}
      />
    );
  }
  return null;
```

### 4. API Route Updates

#### ProvidersRouter

**Update Create/Update Routes:**

Accept and validate `sync_media_types`:

```javascript
// In POST /api/iptv/providers route
if (providerData.sync_media_types) {
  // Validation is handled by IPTVProviderManager
  // Just ensure it's passed through
}

// In PUT /api/iptv/providers/:provider_id route
// Same validation
```

## Migration Strategy

### Schema Migration

1. **Update ProviderRepository:**
   - Add v3 schema definition with `sync_media_types` field
   - Add transformation function that sets all to `true` for existing providers
   - Update default schema version to `v3`

2. **Migration Execution:**
   - Migration runs automatically when documents are accessed
   - All existing providers get `sync_media_types: { movies: true, tvshows: true, live: true }`
   - New providers default to `{ movies: false, tvshows: false, live: false }`

### Data Migration

**No manual data migration needed:**
- Existing providers automatically migrated via schema transformation
- All existing data remains intact
- No cleanup needed for existing provider_titles or channels

## Testing Considerations

### Unit Tests

1. **IPTVProviderManager:**
   - Test `createProvider()` with and without `sync_media_types`
   - Test `updateProvider()` with `sync_media_types` changes
   - Test validation of `sync_media_types` structure

2. **ProvidersManager:**
   - Test `updateProvider()` with media type removal
   - Test `updateProvider()` with media type addition
   - Test `_removeProviderFromTitles()` with type filtering
   - Test `getCategories()` with disabled media types

3. **Sync Jobs:**
   - Test `SyncIPTVProviderTitlesJob` with disabled media types
   - Test `SyncLiveTVJob` with disabled Live TV sync
   - Test job skips disabled types correctly

### Integration Tests

1. **Provider Update Flow:**
   - Create provider with all media types enabled
   - Disable movies sync
   - Verify movies removed from titles but provider_titles kept
   - Re-enable movies sync
   - Verify movies synced again

2. **Live TV Flow:**
   - Create provider with Live TV enabled
   - Sync channels
   - Disable Live TV sync
   - Verify channels deleted
   - Re-enable Live TV sync
   - Verify channels synced again

3. **Category Display:**
   - Provider with only movies enabled
   - Verify only Movies tab shown
   - Enable TV Shows
   - Verify TV Shows tab appears

### Edge Cases

1. **Provider with no media types enabled:**
   - Should not crash
   - Should skip provider in all sync jobs
   - Should show no category tabs

2. **Partial media type changes:**
   - Disable movies, keep TV Shows
   - Verify only movies removed from titles
   - Verify TV Shows still synced

3. **Migration edge cases:**
   - Provider with missing `sync_media_types` field
   - Provider with partial `sync_media_types` field
   - Provider with invalid `sync_media_types` values

## Rollout Plan

### Phase 1: Backend Implementation
1. Update ProviderRepository schema (v3)
2. Update IPTVProviderManager validation
3. Update ProvidersManager.updateProvider() logic
4. Update sync jobs to respect sync_media_types
5. Update ProvidersManager.getCategories()

### Phase 2: Frontend Implementation
1. Update ProviderDetailsForm with checkboxes
2. Update SettingsIPTVProviders with conditional tabs
3. Update category loading logic

### Phase 3: Testing
1. Unit tests for all changes
2. Integration tests for update flows
3. Manual testing of UI

### Phase 4: Deployment
1. Deploy backend changes
2. Run migration (automatic on first access)
3. Deploy frontend changes
4. Monitor for issues

## Backward Compatibility

### Existing Providers
- All existing providers automatically get all media types enabled via migration
- No breaking changes to existing functionality
- Existing sync jobs continue to work

### API Compatibility
- API endpoints accept `sync_media_types` but don't require it
- Missing `sync_media_types` defaults to all `false` for new providers
- Existing API calls continue to work

### Data Compatibility
- Existing `provider_titles` remain intact
- Existing `titles` remain intact
- Existing channels remain intact (until user disables Live TV)

## Future Enhancements

1. **Bulk Operations:**
   - Enable/disable media types for multiple providers at once
   - Bulk category selection

2. **Analytics:**
   - Show sync statistics per media type
   - Show which media types are most used

3. **Smart Defaults:**
   - Suggest media types based on provider capabilities
   - Auto-detect which media types provider supports

4. **UI Improvements:**
   - Show sync status per media type
   - Visual indicators for enabled/disabled types
   - Quick toggle buttons in provider list

