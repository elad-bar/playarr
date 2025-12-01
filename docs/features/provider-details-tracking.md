# Provider Details Tracking Feature

## Overview

This feature tracks provider account information including expiration dates, maximum connections, and active connections for IPTV providers (Xtream and AGTV). It provides real-time monitoring of provider account health and connection status.

## Goals

1. **Track Provider Account Status**: Monitor expiration dates to identify providers that may expire soon
2. **Monitor Connection Limits**: Track maximum and active connections for Xtream providers
3. **Real-time Updates**: Automatically update provider details on a regular schedule
4. **Initial Population**: Fetch and store provider details when providers are added or edited

## Feature Requirements

### Provider Types

#### Xtream Providers
- **Maximum Connections**: Retrieved from authentication endpoint response (`max_connections`)
- **Active Connections**: Retrieved from authentication endpoint response (`active_cons`)
- **Expiration Date**: Retrieved from authentication endpoint response (`exp_date` - Unix timestamp)
- **Update Frequency**: Every 1 minute via scheduled job

#### AGTV Providers
- **Maximum Connections**: Hardcoded to 5 (not available from API)
- **Active Connections**: Always 0 (cannot be retrieved from API)
- **Expiration Date**: Retrieved from authentication endpoint response (if available)
- **Update Frequency**: Only on add/edit (not tracked by job since active connections cannot be retrieved)

### Data Structure

Provider documents will include a new `provider_details` field:

```javascript
{
  id: "provider-id",
  type: "xtream" | "agtv",
  api_url: "...",
  username: "...",
  password: "...",
  enabled: true,
  // ... other existing fields ...
  provider_details: {
    expiration_date: 1735689600,        // Unix timestamp (seconds)
    max_connections: 3,                 // Number
    active_connections: 1,              // Number
    last_checked: "2024-01-15T10:30:00Z" // ISO 8601 date string
  }
}
```

### Authentication Endpoints

#### Xtream
- **Endpoint**: `{api_url}/player_api.php?username={username}&password={password}`
- **Method**: GET
- **Response**: JSON with `user_info` object containing:
  - `exp_date`: Unix timestamp (string)
  - `max_connections`: Number (string)
  - `active_cons`: Number (string)

#### AGTV
- **Endpoint**: TBD (to be determined during implementation)
- **Method**: GET
- **Response**: TBD
- **Fallback**: If no authentication endpoint exists, use hardcoded values

## Implementation Plan

### Phase 1: Provider Authentication Methods

1. **XtreamProvider Enhancement**
   - Add `authenticate()` method to call `/player_api.php` without action parameter
   - Parse `user_info` from response
   - Extract `exp_date`, `max_connections`, `active_cons`
   - Return structured provider details object

2. **AGTVProvider Enhancement**
   - Add `authenticate()` method (if endpoint exists)
   - If no endpoint: return hardcoded values (max_connections: 5, active_connections: 0)
   - Extract expiration date if available

### Phase 2: Provider Data Model Update

1. **ProviderRepository**
   - No schema changes needed (MongoDB is schema-less)
   - Ensure `provider_details` field is properly handled in update operations

2. **ProvidersManager**
   - Update `createProvider()` to call authentication and store initial details
   - Update `updateProvider()` to call authentication and update details
   - Add new public method `updateProviderDetails(providerId, details)` for lightweight updates
     - Updates only the `provider_details` field
     - Uses direct repository update for efficiency
     - Updates in-memory cache directly (no cache invalidation needed)
     - No side effects (doesn't trigger sync jobs, WebSocket broadcasts, or config reloads)
     - This method will be used by the scheduled job for frequent updates

### Phase 3: Scheduled Job

1. **Create SyncProviderDetailsJob**
   - Extends `BaseJob`
   - Runs on startup (with 1 minute delay) and every 1 minute thereafter
   - Fetches all active Xtream providers
   - Calls authentication endpoint for each provider
   - Updates provider documents with new details
   - Handles errors gracefully (logs but doesn't fail entire job)
   - Skips AGTV providers (only tracked on add/edit)

2. **Job Configuration**
   - Add to `jobs.json`:
     ```json
     {
       "name": "syncProviderDetails",
       "jobHistoryName": "SyncProviderDetailsJob",
       "interval": "1m",
       "delay": "1m",
       "description": "Sync provider account details (expiration, connections) from authentication endpoints",
       "schedule": "1 minute after startup and Every 1 minute"
     }
     ```

3. **Job Registration**
   - Register job in `index.js` with other jobs
   - Ensure job instance is created and passed to scheduler

### Phase 4: Error Handling & Edge Cases

- **Authentication Failures**: Log error, don't fail entire job, optionally track `last_error`
- **Missing Fields**: Use defaults, log warnings
- **Rate Limiting**: Handled by existing limiter infrastructure
- **Network Errors**: Timeout handling, graceful degradation

## Technical Details

### ProvidersManager.updateProviderDetails() Method

Lightweight method to update only the `provider_details` field:

```javascript
/**
 * Update provider details (expiration, connections) for a specific provider
 * @param {string} providerId - Provider ID
 * @param {Object} details - { expiration_date, max_connections, active_connections }
 * @returns {Promise<Object>} Result object with statusCode and response
 */
async updateProviderDetails(providerId, details) {
  // Updates DB via direct repository update ($set operator)
  // Updates in-memory cache directly (no invalidation needed)
  // No side effects (doesn't trigger sync jobs, WebSocket broadcasts, or config reloads)
}
```

### Execution Flows

**Scheduled Job Flow:**
1. Job runs every 1 minute (startup + recurring)
2. Fetches active Xtream providers from cache
3. For each provider: authenticate → extract details → call `updateProviderDetails()`
4. Cache updated directly, no side effects

**Provider Add/Edit Flow:**
1. User adds/edits provider via UI
2. Authenticate → extract details → merge into provider object
3. Save via `createProvider()`/`updateProvider()` (full update with side effects)
4. Cache updated via `_writeAllProviders()`

**Update Strategy:**
- **Job updates**: Use `updateProviderDetails()` (lightweight, no side effects)
- **User updates**: Use `createProvider()`/`updateProvider()` (full update, includes side effects)

## API Changes

### No Breaking Changes
- Existing API endpoints remain unchanged
- New `provider_details` field is additive
- Backward compatible with existing provider documents

### Response Enhancements
- Provider GET endpoints will include `provider_details` if available
- Provider list endpoints will include `provider_details` for all providers

## Database Considerations

### Indexes
- No new indexes required (provider lookups already indexed by `id`)
- `provider_details.last_checked` could be indexed if needed for queries

### Data Migration
- Existing providers will have `provider_details` populated on first job run
- No migration script needed (job handles population)


## Monitoring & Logging

### Job Logging
- Log number of providers processed
- Log success/failure for each provider
- Log any authentication errors
- Track job execution time

### Provider Logging
- Log when provider details are updated
- Log authentication failures
- Optionally track last successful check vs last failed check

## Stream Selection Strategy

### Overview

The provider details (connection information) enable intelligent stream selection that prioritizes providers based on their current availability. This ensures optimal load distribution and better user experience.

### Stream Selection Flow

All entry points (StreamRouter, StremioRouter, XtreamRouter) call `StreamManager.getBestSource()`:
1. `_getSources()` retrieves sources from title documents (`media[].sources[]`)
2. Sources sorted by availability and priority (see algorithm below)
3. Each source URL validated via `_checkUrl()`
4. Returns first valid source

**Implementation**: `web-api/src/managers/stream.js` → `_getSources()` method

### Priority Algorithm

Sources are sorted using a multi-level priority system:

**Priority Levels:**
1. **Provider Type**: Xtream (0) > AGTV (1)
2. **Availability Score** (Xtream only): `1 - (active_connections / max_connections)` (descending)
3. **Provider Priority**: Existing `priority` field as tiebreaker (lower = higher priority)

**AGTV**: Always 100% available (0/5 hardcoded), sorted by priority only, serves as fallback

### Implementation Details

#### Sorting Logic

```javascript
sources.sort((a, b) => {
  const providerA = providersMap.get(a.provider_id);
  const providerB = providersMap.get(b.provider_id);
  
  // 1. Provider type priority: Xtream > AGTV
  const typePriority = { 'xtream': 0, 'agtv': 1 };
  const typeDiff = (typePriority[providerA?.type] || 999) - 
                   (typePriority[providerB?.type] || 999);
  if (typeDiff !== 0) return typeDiff;
  
  // 2. For Xtream: sort by availability (higher is better)
  if (providerA?.type === 'xtream' && providerB?.type === 'xtream') {
    const detailsA = providerA.provider_details || {};
    const detailsB = providerB.provider_details || {};
    
    const maxConnA = detailsA.max_connections || 1;
    const activeConnA = detailsA.active_connections || 0;
    const availabilityA = maxConnA > 0 ? 1 - (activeConnA / maxConnA) : 0;
    
    const maxConnB = detailsB.max_connections || 1;
    const activeConnB = detailsB.active_connections || 0;
    const availabilityB = maxConnB > 0 ? 1 - (activeConnB / maxConnB) : 0;
    
    const availabilityDiff = availabilityB - availabilityA; // Descending
    if (availabilityDiff !== 0) return availabilityDiff;
  }
  
  // 3. Provider priority as tiebreaker (lower number = higher priority)
  const priorityA = providerA?.priority || 999;
  const priorityB = providerB?.priority || 999;
  return priorityA - priorityB;
});
```

**Edge Cases**: Missing `provider_details` → 0% available; missing `max_connections` → defaults to 1; missing `active_connections` → defaults to 0

**Benefits**: Load balancing across Xtream providers, reduced connection limit errors, AGTV fallback, backward compatible, real-time adaptation (updates every minute)

**Examples**:
- Multiple Xtream: Provider with higher availability selected first
- Xtream + AGTV: Xtream tried first (type priority), AGTV as fallback
- All Xtream at capacity: AGTV serves as reliable fallback

## Future Enhancements

1. **Alerting**: Notify when provider is about to expire
2. **Connection Tracking**: More detailed connection tracking per provider
3. **Historical Data**: Track provider details over time
4. **UI Display**: Show provider details in provider management UI
5. **AGTV Support**: If AGTV adds authentication endpoint, support it in job
6. **Dynamic Priority Adjustment**: Automatically adjust provider priority based on connection availability trends
7. **Connection Reservation**: Reserve connections for high-priority users or content

## Testing Considerations

1. **Unit Tests**
   - Test authentication method parsing
   - Test error handling
   - Test data transformation

2. **Integration Tests**
   - Test job execution
   - Test provider add/edit flow
   - Test with mock provider responses

3. **Edge Cases**
   - Provider with invalid credentials
   - Provider with missing fields in response
   - Network timeouts
   - Rate limiting scenarios

## Dependencies

- Existing provider infrastructure (`XtreamProvider`, `AGTVProvider`)
- Existing job infrastructure (`BaseJob`, `EngineScheduler`)
- Existing repository infrastructure (`ProviderRepository`)
- Existing manager infrastructure (`ProvidersManager`)

## Timeline

1. **Phase 1**: Provider authentication methods (1-2 days)
2. **Phase 2**: Data model and manager updates (1 day)
3. **Phase 3**: Job implementation (1-2 days)
4. **Phase 4**: Error handling and testing (1 day)

**Total Estimated Time**: 4-6 days

