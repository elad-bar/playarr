# Channel Deduplication and Best Source Selection Feature [New]

## Overview

This feature implements channel deduplication at query/display time and best source selection at stream time for Live TV channels. When the same channel ID (or `tvg_id`) exists across multiple providers, only one entry is shown in the catalog/UI, and the system automatically selects the best available source when streaming, similar to how movies and TV shows handle multiple sources.

## Goals

1. **Deduplicate Channels in UI**: Show only one entry per unique channel in catalog/UI, even if available from multiple providers
2. **Best Source Selection**: Automatically select the best available source when streaming, with automatic failover
3. **Keep Sync Simple**: Maintain the simple "delete all + insert" sync process without cross-provider merge complexity
4. **Provider Priority**: Respect provider priority and availability when selecting sources
5. **Consistent Behavior**: Match the behavior of movies/tvshows best source selection

## Current Architecture

### Existing Implementation

**Channel Storage:**
- Channels stored per provider: `{ provider_id: 1, channel_id: 1 }` (unique compound key)
- Each provider's channels are stored separately
- Sync process: Delete all channels for provider → Insert new channels (simple and efficient)

**Current Behavior:**
- If channel ID "123" exists in Provider A and Provider B, both appear as separate entries in catalog/UI
- Each has its own `channel_key`: `live-A-123` and `live-B-123`
- Users can add both to watchlist independently
- Streaming uses the specific provider's URL directly

**Limitations:**
- Duplicate channels clutter the catalog/UI
- No automatic failover if one provider's source fails
- No best source selection based on provider priority/availability
- Users must manually choose which provider's channel to use

## Feature Requirements

### 1. Query/Display Time Deduplication

**Goal:** Show only one entry per unique channel in catalog/UI

**Deduplication Strategy:**
- **Primary:** Match by `tvg_id` (if available and consistent across providers)
- **Fallback:** Match by `channel_id` (if `tvg_id` not available)
- **Selection:** Keep the first occurrence when multiple matches found

**Implementation Points:**
- `ChannelManager.getAllChannels()` - Deduplicate before returning
- `StremioManager.getCatalog()` - Deduplicate for Stremio catalog
- `LiveTVRouter.get('/channels')` - Deduplicate for web UI
- `XtreamManager.getLiveStreams()` - Deduplicate for Xtream API

**Channel Key Selection:**
- Use the `channel_key` from the first occurrence as the representative key
- This key is used for watchlist and streaming requests

### 2. Stream Time Best Source Selection

**Goal:** Automatically select the best available source when streaming

**Source Selection Logic:**
- Find all channels matching the requested channel (by `tvg_id` or `channel_id`) across all enabled providers
- Build sources array with provider information
- Sort sources by:
  1. Provider type priority (Xtream > AGTV)
  2. Provider availability (for Xtream: connection availability)
  3. Provider priority (lower number = higher priority)
- Check each source URL for validity
- Return first valid source URL

**Implementation:**
- Add `getBestChannelSource(channelKey)` to `BaseFormattingManager`
- Add `_getChannelSources(channelKey)` private method
- Update `LiveTVRouter.get('/stream/:channelKey')` to use best source selection

### 3. No Sync Process Changes

**Key Principle:** Keep sync process simple

- **No changes** to `LiveTVProcessingManager` sync logic
- Continue using "delete all channels for provider → insert new channels" pattern
- No cross-provider merge logic during sync
- All deduplication and source selection happens at query/stream time

## Implementation Details

### 1. ChannelManager - Deduplication Helper

**File:** `web-api/src/managers/domain/ChannelManager.js`

**Add Method:**
```javascript
/**
 * Deduplicate channels by tvg_id or channel_id
 * Returns first occurrence of each unique channel
 * @private
 * @param {Array<Object>} channels - Array of channel objects
 * @returns {Array<Object>} Deduplicated array
 */
_deduplicateChannels(channels) {
  const seen = new Map();
  const deduplicated = [];
  
  for (const channel of channels) {
    // Use tvg_id if available, otherwise fallback to channel_id
    const key = channel.tvg_id || channel.channel_id;
    
    if (!seen.has(key)) {
      seen.set(key, channel);
      deduplicated.push(channel);
    }
  }
  
  return deduplicated;
}
```

**Update `getAllChannels()` Method:**
- Add deduplication step after fetching channels
- Apply deduplication before watchlist filtering and pagination

### 2. BaseFormattingManager - Best Source Selection

**File:** `web-api/src/managers/formatting/BaseFormattingManager.js`

**Add Method:**
```javascript
/**
 * Get the best source for a specific channel
 * @param {string} channelKey - Channel key from catalog (format: live-{providerId}-{channelId})
 * @returns {Promise<string|null>} Best valid stream URL or null if none found
 */
async getBestChannelSource(channelKey) {
  // Parse channel_key, find matching channels across providers
  // Get sources array, sort by priority, check validity
  // Return first valid source URL
}
```

**Add Private Method:**
```javascript
/**
 * Get all sources for a channel across all providers
 * @private
 * @param {string} channelKey - Channel key (format: live-{providerId}-{channelId})
 * @returns {Promise<Array<{url: string, providerType: string|null, provider_id: string}>>}
 */
async _getChannelSources(channelKey) {
  // 1. Parse channel_key to get original provider_id and channel_id
  // 2. Find the channel to get tvg_id (if available)
  // 3. Find all channels with same tvg_id or channel_id across enabled providers
  // 4. Build sources array with provider info and URL handling (absolute/relative)
  // 5. Sort sources by provider type, availability, and priority
  // 6. Return sorted sources array
}
```

### 3. LiveTVRouter - Update Stream Endpoint

**File:** `web-api/src/routes/LiveTVRouter.js`

**Update `/stream/:channelKey` endpoint:**
- Replace direct channel lookup with `getBestChannelSource()`
- Use `liveTVFormattingManager.getBestChannelSource()` instead of direct repository lookup
- Handle case where no valid source is found

### 4. StremioManager - Update Catalog

**File:** `web-api/src/managers/formatting/StremioManager.js`

**Update `getCatalog()` method:**
- Add deduplication step after fetching channels
- Use deduplicated channels for catalog generation
- Keep using `channel_key` from first occurrence as catalog ID

### 5. XtreamManager - Update Live Streams

**File:** `web-api/src/managers/formatting/XtreamManager.js`

**Update `getLiveStreams()` method:**
- Add deduplication step after fetching channels
- Use deduplicated channels for Xtream API response

## Technical Details

### Channel Matching Strategy

**Primary Matching (Preferred):**
- Use `tvg_id` field if available and non-empty
- `tvg_id` is typically consistent across providers for the same channel
- Example: "CNN.US" or "cnn" might be the same across providers

**Fallback Matching:**
- Use `channel_id` if `tvg_id` is not available
- Less reliable but better than showing duplicates
- Example: Channel ID "123" might be different channels in different providers

**Future Enhancement:**
- Could add fuzzy name matching as additional fallback
- Could add channel name normalization (lowercase, remove special chars)

### Source Selection Priority

**1. Provider Type Priority:**
- Xtream: Priority 0 (highest)
- AGTV: Priority 1
- Unknown: Priority 999 (lowest)

**2. Provider Availability (Xtream only):**
- Calculate: `1 - (active_connections / max_connections)`
- Higher availability = higher priority
- Only applies when both sources are Xtream type

**3. Provider Priority:**
- Use `provider.priority` field (lower number = higher priority)
- Default: 999 if not set

### URL Handling

**Absolute URLs:**
- If URL starts with `http://` or `https://`, use as-is

**Relative URLs:**
- If URL starts with `/`, concatenate with `provider.streams_urls` base URLs
- Create one source entry per base URL in `streams_urls` array

**Invalid URLs:**
- Skip sources with empty or invalid URLs
- Log warning for unexpected URL formats

### Source Validation

**URL Checking:**
- Use existing `_checkUrl()` method from `BaseFormattingManager`
- Supports provider-specific checking (Xtream vs AGTV)
- Returns first valid source found

**Error Handling:**
- If all sources fail validation, return `null`
- Log warnings for each failed source
- Log error if no sources found at all

## Data Flow

### Catalog/UI Display Flow

```
1. User requests channels (GET /api/livetv/channels)
2. ChannelManager.getAllChannels() fetches all channels from enabled providers
3. _deduplicateChannels() groups by tvg_id/channel_id, keeps first occurrence
4. Apply watchlist filtering and pagination
5. Return deduplicated channels to UI
```

### Streaming Flow

```
1. User requests stream (GET /api/livetv/stream/{channelKey})
2. LiveTVRouter calls liveTVFormattingManager.getBestChannelSource(channelKey)
3. _getChannelSources() finds all matching channels across providers
4. Build sources array with provider info and URLs
5. Sort sources by priority (type, availability, provider priority)
6. Check each source URL validity
7. Return first valid source URL
8. Redirect user to best source
```

## Benefits

### User Experience
- **Cleaner Catalog:** No duplicate channels cluttering the UI
- **Automatic Failover:** If one provider's source fails, automatically tries another
- **Best Quality:** Automatically selects best available source based on priority
- **Consistent Behavior:** Matches how movies/tvshows handle multiple sources

### Technical Benefits
- **Simple Sync:** No changes to sync process, keeps it fast and reliable
- **No Schema Changes:** Storage model remains the same
- **Query-Time Processing:** Deduplication happens at query time, no pre-processing needed
- **Stream-Time Selection:** Best source selection happens when needed, not pre-computed

### Operational Benefits
- **Provider Priority:** Respects provider priority settings
- **Availability Aware:** Considers provider availability for Xtream providers
- **Easy to Maintain:** Logic is isolated in formatting managers, easy to update

## Considerations

### Watchlist Management
- Watchlist still uses `channel_key` from first occurrence
- This is acceptable since deduplication keeps first occurrence
- Users add one channel to watchlist, but streaming uses best source

### EPG/Programs
- Programs are stored per provider: `{ provider_id, channel_id }`
- When displaying programs, may need to aggregate from all matching channels
- Current implementation shows programs from the channel's original provider
- Future enhancement: Aggregate programs from all matching channels

### Channel Identification
- `tvg_id` matching is preferred but not always available
- `channel_id` fallback is less reliable (same ID might be different channels)
- Consider adding channel name normalization for better matching

### Performance
- Deduplication is O(n) operation, acceptable for typical channel counts
- Source selection queries multiple providers, but only when streaming
- URL validation adds latency, but provides reliability

## Migration Notes

### No Data Migration Required
- Existing channels remain unchanged
- No schema changes needed
- Feature works with existing data structure

### Backward Compatibility
- Existing `channel_key` format remains: `live-{providerId}-{channelId}`
- Watchlist entries continue to work
- API endpoints remain the same

### Rollout Strategy
1. Deploy code changes
2. Feature activates automatically
3. Users see deduplicated channels immediately
4. Streaming uses best source selection automatically

## Future Enhancements

### 1. Channel Name Normalization
- Add fuzzy name matching for better deduplication
- Normalize channel names (lowercase, remove special chars, etc.)
- Use Levenshtein distance for similar names

### 2. Program Aggregation
- Aggregate EPG programs from all matching channels
- Show combined program guide for deduplicated channels
- Merge program data from multiple providers

### 3. Source Quality Metrics
- Track source quality metrics (bitrate, resolution, etc.)
- Use quality metrics in source selection priority
- Allow users to prefer higher quality sources

### 4. Manual Source Selection
- Allow users to manually select preferred provider for specific channels
- Store user preferences in user profile
- Override automatic selection with user preference

### 5. Channel Grouping
- Group channels by category/provider in UI
- Show which providers have the channel available
- Allow users to see all sources for a channel

## Testing Considerations

### Unit Tests
- Test `_deduplicateChannels()` with various channel arrays
- Test `_getChannelSources()` with different channel_key formats
- Test source sorting logic with different provider configurations
- Test URL handling (absolute, relative, invalid)

### Integration Tests
- Test catalog endpoint returns deduplicated channels
- Test stream endpoint uses best source selection
- Test with channels from multiple providers
- Test failover when primary source is unavailable

### Edge Cases
- Channels with no `tvg_id` (fallback to `channel_id`)
- Channels with same `tvg_id` but different names
- All sources invalid (should return 404)
- Provider disabled during streaming (should try next source)

## Related Features

- **Provider-Based Live Channels:** Foundation for this feature
- **Best Source Selection (Movies/TV Shows):** Similar logic for titles
- **Provider Priority:** Uses provider priority settings
- **Watchlist Management:** Works with existing watchlist system

