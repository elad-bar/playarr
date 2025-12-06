# Sync Media Types Selection Feature [Done]

## Overview

This feature adds the ability to selectively enable or disable syncing of different media types (Movies, TV Shows, Live TV) per IPTV provider. Users can configure which media types should be synced from each provider, allowing for more granular control over content synchronization and reducing unnecessary API calls and storage usage.

## Goals

1. **Selective Media Type Syncing**: Allow users to choose which media types (Movies, TV Shows, Live TV) to sync per provider
2. **Reduced Resource Usage**: Skip syncing unused media types to reduce API calls, processing time, and storage
3. **Conditional Category Display**: Only show category selection step for enabled media types (Movies/TV Shows only, Live TV categories not shown)
4. **Clean Data Management**: Properly handle data cleanup when media types are disabled
5. **Backward Compatibility**: Existing providers automatically have all media types enabled via migration

## Current Architecture

### Existing Implementation

**Provider Configuration:**
- Providers have `enabled_categories` field with `movies` and `tvshows` arrays (v1 schema)
- **No `enabled_categories.live` field exists yet** (will be added in v2)
- **No `sync_media_types` field exists** - all media types are synced by default
- Schema version is `v1` (only movies and tvshows categories)
- Categories control which specific categories are synced within each media type

**Sync Jobs:**
- `SyncIPTVProviderTitlesJob`: Syncs both movies and TV shows from all enabled providers (no media type filtering)
- `SyncLiveTVJob`: Syncs Live TV channels from all enabled providers (no media type filtering)
- Jobs process all enabled providers regardless of media type preferences

**UI:**
- Uses `ProviderWizard` component with step-based navigation
- Category selection handled in `CategoriesStep` component (Movies and TV Shows only)
- No Live TV category selection (Live TV categories are extracted automatically from synced channels)
- No way to disable syncing of entire media types

**Cleanup Methods:**
- `_removeProviderFromTitles()`: Removes provider from titles based on enabled categories
- `_removeProviderFromChannels()`: Signature is `(providerId, isEnabled, enabledCategories)` - removes channels based on enabled live categories

**Limitations:**
- Cannot disable syncing of entire media types (only specific categories)
- All media types are always synced, even if not needed
- Wastes API calls and processing time for unused media types
- No way to selectively enable/disable media types per provider
- No Live TV category filtering in provider settings (v2 feature)

## Feature Requirements

### User Interface

1. **Provider Details Form:**
   - Add three checkboxes: "Sync Movies", "Sync TV Shows", "Sync Live TV"
   - Default state: All unchecked (false) for new providers
   - Checkboxes should be visible for both AGTV and Xtream providers
   - Save state as part of provider configuration

2. **Conditional Category Step:**
   - Categories step: Only show if `sync_media_types.movies === true` OR `sync_media_types.tvshows === true`
   - Categories step shows ONLY Movies and TV Shows categories (no Live TV categories)
   - Live TV categories are NOT shown in provider settings - they are extracted automatically from synced channels
   - Live TV category filtering is handled internally, not via user selection in settings

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
- Current: v1 (only has `enabled_categories.movies` and `enabled_categories.tvshows`)
- New: v2 (adds `enabled_categories.live` AND `sync_media_types`)

**Note on `enabled_categories.live`:**
- The `enabled_categories.live` array exists in the provider schema
- It is managed automatically during channel sync, NOT by user selection
- Users do NOT see or select Live TV categories in provider settings
- When channels are synced, their categories are automatically added to `enabled_categories.live`
- When channels are removed (due to category filtering or sync disable), categories are automatically removed

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
5. **Note**: Live TV categories are NOT user-selectable in provider settings. The `enabled_categories.live` array is managed automatically based on which channels are synced. When Live TV sync is disabled, all channels (and thus all categories) are removed.

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

**Update v2 Schema:**
```javascript
"v2": {
  "id": 2,
  "structure": {
    // ... existing v1 fields ...
    enabled_categories: {
      movies: Array,
      tvshows: Array,
      live: Array // NEW: Live channel categories (managed automatically)
    },
    sync_media_types: {  // NEW: Media type sync control
      movies: Boolean,
      tvshows: Boolean,
      live: Boolean
    }
  },
  "transformation": async (doc) => {
    // Migration: For existing providers (v1), add both new fields
    return {
      ...doc,
      enabled_categories: {
        ...doc.enabled_categories,
        live: doc.enabled_categories?.live || [] // Empty array, populated during sync
      },
      sync_media_types: {
        movies: true,  // Existing providers: enable all by default
        tvshows: true,
        live: true
      }
    };
  }
}
```

**Update Repository:**
- Update v2 schema definition to include both `enabled_categories.live` and `sync_media_types`
- Default schema version remains `v2` (already set)
- Transformation handles migration from v1 to v2 (adds both fields)
- Migration runs automatically when documents are accessed (via BaseRepository schema versioning system)

### 2. Backend Changes

#### IPTVProviderManager

**Update `createProvider()`:**
- Validate `sync_media_types` structure
- Default to `{ movies: false, tvshows: false, live: false }` if not provided (new providers)
- Store in provider document
- Also initialize `enabled_categories.live: []` for v2 schema

**Update `updateProvider()`:**
- Validate `sync_media_types` structure
- Allow partial updates (only update provided fields)

**Add Validation:**
```javascript
// Note: ValidationError is imported from '../../errors/AppError.js'
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
  // For existing providers without sync_media_types (v1), default to true (backward compatibility)
  // For new providers, default to false
  const existingSyncTypes = existingProvider.sync_media_types || { 
    movies: true,  // Default true for v1 providers
    tvshows: true,
    live: true
  };
  // For updates, if not provided, keep existing values (don't default to false)
  const newSyncTypes = providerData.sync_media_types !== undefined 
    ? { ...existingSyncTypes, ...providerData.sync_media_types } // Merge with existing
    : existingSyncTypes; // Keep existing if not provided
  
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
    // When disabling entire media type, pass isEnabled: false
    await this._removeProviderFromChannels(
      providerId, 
      false, // isEnabled: false means delete all
      { movies: [], tvshows: [], live: [] } // No enabled categories
    );
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

Process all enabled providers, but only fetch metadata for enabled media types per provider:

**Note:** The job processes all enabled providers (doesn't skip providers), but only fetches the media types that are enabled for each provider. If a provider has both movies and tvshows disabled, it will still be processed but will return 0 for both counts.

```javascript
async execute() {
  // ... existing setup code ...
  
  const results = await Promise.all(
    enabledHandlers.map(async ([providerId, handler]) => {
      try {
        this.logger.debug(`[${providerId}] Processing provider (${handler.getProviderType()})`);
        this.logger.info(`Fetching metadata from provider ${providerId}...`);
        
        // Get sync_media_types from provider config
        // Default to true for v1 providers (backward compatibility during migration)
        const syncTypes = handler.providerData.sync_media_types || { 
          movies: true,  // Default true for v1 providers
          tvshows: true,
          live: true
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

**Note on SyncProviderDetailsJob:**
- `SyncProviderDetailsJob` is NOT affected by `sync_media_types`
- It syncs provider metadata (expiration, connections, etc.), not content
- It continues to run for all enabled providers regardless of `sync_media_types` settings
- No changes needed to this job

#### SyncLiveTVJob

**Update `execute()` Method:**

Filter providers to only those with Live TV sync enabled:

**Note:** Providers with `sync_media_types.live === false` are NOT processed at all. The query filter ensures only providers with live TV enabled are included in the sync.

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

Only fetch categories for enabled media types (Movies and TV Shows only - NO Live TV):

**Note:** This method is used for the provider settings UI. Live TV categories are NOT shown in settings - they are extracted automatically from synced channels and managed internally.

```javascript
async getCategories(providerId) {
  try {
    // Validate provider exists
    const providerData = await this._iptvProviderManager.getProvider(providerId);
    
    // Get sync_media_types
    // Default to true for v1 providers (backward compatibility during migration)
    const syncTypes = providerData.sync_media_types || { 
      movies: true,  // Default true for v1 providers
      tvshows: true,
      live: true
    };
    
    // Fetch categories only for enabled types (Movies and TV Shows only)
    // NOTE: Live TV categories are NOT included - they are managed automatically
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
    
    // DO NOT fetch live categories - they are not shown in provider settings
    // Live TV categories are extracted automatically from synced channels
    
    // Get enabled categories from provider config (movies and tvshows only)
    const enabledCategories = providerData.enabled_categories || { movies: [], tvshows: [], live: [] };
    const enabledCategoryKeys = new Set([
      ...(enabledCategories.movies || []),
      ...(enabledCategories.tvshows || [])
      // Note: live categories excluded - not shown in UI
    ]);
    
    // Transform and combine categories (Movies and TV Shows only)
    const allCategories = [
      ...moviesCategories.map(cat => ({
        key: `movies-${cat.category_id}`,
        type: 'movies',
        category_id: cat.category_id,
        category_name: cat.category_name,
        enabled: enabledCategoryKeys.has(`movies-${cat.category_id}`)
      })),
      ...tvshowsCategories.map(cat => ({
        key: `tvshows-${cat.category_id}`,
        type: 'tvshows',
        category_id: cat.category_id,
        category_name: cat.category_name,
        enabled: enabledCategoryKeys.has(`tvshows-${cat.category_id}`)
      }))
      // Live TV categories NOT included
    ];
    
    return allCategories;
  } catch (error) {
    this.logger.error(`Error getting categories for ${providerId}: ${error.message}`);
    throw new AppError(`Failed to get categories: ${error.message}`, 500);
  }
}
```

**Important:** The `enabled_categories.live` array exists in the provider config and is managed automatically during channel sync. Users do NOT select Live TV categories in the provider settings.

### 3. Frontend Changes

#### ProviderDetailsStep.jsx (in ProviderWizard)

**Add Sync Media Types Checkboxes:**

The checkboxes should be added to the `ProviderDetailsStep` component within the wizard flow, after the `enabled` checkbox.

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
    Media Types
  </Typography>
  <FormControlLabel
    control={
      <Checkbox
        checked={formData.sync_media_types?.movies ?? false}
        onChange={handleSyncMediaTypeChange}
        name="sync_media_types.movies"
      />
    }
    label="Movies"
  />
  <FormControlLabel
    control={
      <Checkbox
        checked={formData.sync_media_types?.tvshows ?? false}
        onChange={handleSyncMediaTypeChange}
        name="sync_media_types.tvshows"
      />
    }
    label="TV Shows"
  />
  <FormControlLabel
    control={
      <Checkbox
        checked={formData.sync_media_types?.live ?? false}
        onChange={handleSyncMediaTypeChange}
        name="sync_media_types.live"
      />
    }
    label="Live TV"
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

#### ProviderWizard.jsx

**Update Step Logic:**

Conditionally include Categories step based on `sync_media_types`:

```jsx
// In step configuration or step rendering logic
const shouldShowCategoriesStep = (provider) => {
  // Only show Categories step if at least one media type (movies or tvshows) is enabled
  // Note: Live TV categories are NOT shown in settings
  return provider?.sync_media_types?.movies || provider?.sync_media_types?.tvshows;
};

// When building steps array or rendering steps:
const steps = [
  { component: BasicDetailsStep, ... },
  { component: ProviderDetailsStep, ... },
  { component: CleanupRulesStep, ... },
  // Only show Categories step if at least one media type is enabled
  ...(shouldShowCategoriesStep(provider) 
    ? [{ component: CategoriesStep, ... }] 
    : []),
  { component: IgnoredTitlesStep, ... }
];
```

#### CategoriesStep.jsx

**Update Component:**

The `CategoriesStep` component already exists and should:
- Filter categories to only show `type === 'movies'` or `type === 'tvshows'` (exclude any `type === 'live'` categories)
- Only display categories for enabled media types based on `sync_media_types`
- Filter out Live TV categories if they appear in the response

```jsx
// In CategoriesStep component, filter categories:
const filteredCategories = useMemo(() => {
  // First, filter out categories that don't have a valid type (movies or tvshows)
  // Also filter out live categories - they should never appear
  let filtered = categories.filter(cat => {
    const type = cat.type;
    return (type === 'movies' || type === 'tvshows') && type !== 'live';
  });

  // Filter by enabled sync_media_types
  if (provider?.sync_media_types) {
    filtered = filtered.filter(cat => {
      if (cat.type === 'movies') return provider.sync_media_types.movies;
      if (cat.type === 'tvshows') return provider.sync_media_types.tvshows;
      return false;
    });
  }

  // ... rest of existing filtering logic (mediaTypeFilter, searchQuery) ...
}, [categories, provider?.sync_media_types, mediaTypeFilter, searchQuery]);
```

**Note:** The `CategoriesStep` component should only display categories with `type === 'movies'` or `type === 'tvshows'`. Any categories with `type === 'live'` should be filtered out and not shown to the user.

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

**Note:** The `/api/iptv/providers/:provider_id/categories` route already exists and uses `getCategories()`. No changes needed to the route itself - the `getCategories()` method update handles the filtering automatically.

## Migration Strategy

### Schema Migration

1. **Update ProviderRepository:**
   - Update v2 schema definition to include both `enabled_categories.live` and `sync_media_types` fields
   - Update transformation function to add both fields when migrating from v1 to v2
   - Default schema version remains `v2` (already set)
   - Migration runs automatically when documents are accessed (via BaseRepository schema versioning system)

2. **Migration Execution:**
   - Automatic migration via BaseRepository schema versioning
   - All existing v1 providers get both:
     - `enabled_categories.live: []` (empty array, populated during channel sync)
     - `sync_media_types: { movies: true, tvshows: true, live: true }` (all enabled by default)
   - New providers default to:
     - `enabled_categories.live: []`
     - `sync_media_types: { movies: false, tvshows: false, live: false }` (set in IPTVProviderManager.createProvider)
   - Backups created automatically if needed (for configuration collections)

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
   - Verify only Movies categories shown in Categories step
   - Enable TV Shows
   - Verify TV Shows categories appear in Categories step
   - Verify Live TV categories are never shown in Categories step

### Edge Cases

1. **Provider with no media types enabled:**
   - This is a **valid situation** - provider can exist with all media types disabled
   - Should not crash
   - Provider is still considered "enabled" (can be enabled/disabled separately from media types)
   - `SyncIPTVProviderTitlesJob` will process provider but return 0 for both movies and tvshows (no API calls made)
   - `SyncLiveTVJob` will skip provider entirely (filtered by query - not processed)
   - Should not show Categories step in wizard
   - Optional UX improvement: Show a warning message in UI that no media types are enabled

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
1. Update ProviderRepository v2 schema (add both `enabled_categories.live` and `sync_media_types`)
2. Update IPTVProviderManager validation and defaults
3. Update ProvidersManager.updateProvider() logic
4. Update sync jobs to respect sync_media_types
5. Update ProvidersManager.getCategories() (exclude Live TV categories)

### Phase 2: Frontend Implementation
1. Update ProviderDetailsStep with sync_media_types checkboxes
2. Update ProviderWizard to conditionally show Categories step
3. Update CategoriesStep to filter by sync_media_types and exclude Live TV categories

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
- For v1 providers (during migration), `getCategories()` defaults to all `true` for backward compatibility
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

