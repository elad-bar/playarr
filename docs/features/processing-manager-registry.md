# Processing Manager Registry Refactoring [New]

## Overview

Refactor processing managers from per-execution instances to singleton instances managed by a registry. Processing managers will become stateless, with execution-scoped state passed via a context object. This aligns with the provider pattern where instances are created once on startup and reused.

## Goals

- Create processing manager instances once on startup (one per provider)
- Make processing managers stateless by passing execution context as parameters
- Reduce object allocations per job execution
- Improve consistency with provider pattern (singleton instances)
- Maintain clean separation between stateless processing logic and execution-scoped state

## Current Architecture

### Current State

- Processing managers are created dynamically in `BaseJob._createHandlers()` for each job execution
- Each processing manager instance stores:
  - `providerData` - Provider configuration (read-only during execution)
  - `_titlesCache` - Execution-scoped cache loaded at start
  - `_ignoredCache` - Execution-scoped cache loaded at start
  - `_accumulatedIgnoredTitles` - Execution-scoped accumulation during processing
  - `_progressTracking` - Execution-scoped progress tracking
  - `limiter` - Rate limiter (tied to provider config, should remain in instance)

### Problems

- Processing managers are recreated for every job execution
- State is mixed between instance-level (rate limiter) and execution-level (caches)
- No reuse of processing manager instances across job executions
- Inconsistent with provider pattern (providers are singletons)

## Proposed Architecture

### New Components

1. **ProcessingManagerRegistry** - Service that manages processing manager instances
2. **ProcessingContext** - Class containing execution-scoped state

### Processing Manager Lifecycle

- **Startup**: Create one processing manager instance per provider, stored in registry
- **Job Execution**: Get processing manager from registry, create fresh context, pass context to methods
- **Provider Updates**: Update or recreate processing manager in registry when provider config changes

### State Management

- **Instance State** (stays in processing manager):
  - `limiter` - Rate limiter tied to provider config
  - Dependencies (managers, repositories)
  
- **Execution State** (moves to context):
  - `providerData` - Provider configuration
  - `providerId` - Provider ID
  - `titlesCache` - Titles loaded for this execution
  - `ignoredCache` - Ignored titles loaded for this execution
  - `accumulatedIgnoredTitles` - Titles ignored during this execution
  - `progressTracking` - Progress tracking for this execution
  - `progressInterval` - Progress interval timer for this execution

## Implementation Plan

### Phase 1: Create New Components

#### 1.1 Create ProcessingContext Class

**File**: `web-api/src/managers/processing/ProcessingContext.js`

```javascript
/**
 * Execution context for processing managers
 * Contains execution-scoped state that is created fresh for each job execution
 */
export class ProcessingContext {
  constructor(providerId, providerData) {
    this.providerId = providerId;
    this.providerData = providerData;
    
    // Execution-scoped caches
    this.titlesCache = null;
    this.ignoredCache = null;
    
    // Accumulated ignored titles by type
    // Format: { 'movies': { titleId: reason }, 'tvshows': { titleId: reason } }
    this.accumulatedIgnoredTitles = {};
    
    // Progress tracking: { 'movies': { count: 642, saveCallback: fn } }
    this.progressTracking = {};
    this.progressInterval = null;
  }

  /**
   * Reset context for reuse (optional, if you want to reuse contexts)
   */
  reset() {
    this.titlesCache = null;
    this.ignoredCache = null;
    this.accumulatedIgnoredTitles = {};
    this.progressTracking = {};
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
  }
}
```

#### 1.2 Create ProcessingManagerRegistry Service

**File**: `web-api/src/services/ProcessingManagerRegistry.js`

- Map structure: `Map<providerId, ProcessingManager>`
- Methods:
  - `initialize(providers, dependencies)` - Create processing managers for all providers
  - `get(providerId)` - Get processing manager for a provider
  - `getAll()` - Get all processing managers
  - `update(provider, dependencies)` - Update or create processing manager for a provider
  - `remove(providerId)` - Remove processing manager for a provider
  - `getTMDBProcessingManager()` - Get shared TMDB processing manager

### Phase 2: Refactor Base Classes

#### 2.1 Refactor BaseProcessingManager

**File**: `web-api/src/managers/processing/BaseProcessingManager.js`

**Changes**:
- Remove instance state: `this._progressTracking`, `this._progressInterval`
- Update methods to accept `context` parameter:
  - `_startProgressInterval(context)`
  - `_stopProgressInterval(context)`
  - `_logProgress(context)`
  - `registerProgress(context, type, count, saveCallback)`
  - `updateProgress(context, type, count)`
  - `unregisterProgress(context, type)`
- Keep `this.limiter` in instance (tied to provider config rate limits)
- Keep `this.logger` but will be created per execution with context

#### 2.2 Refactor BaseIPTVProcessingManager

**File**: `web-api/src/managers/processing/BaseIPTVProcessingManager.js`

**Changes**:
- Remove `providerData` from constructor (will come from context)
- Remove instance state: `this._titlesCache`, `this._ignoredCache`, `this._accumulatedIgnoredTitles`
- Update constructor signature:
  ```javascript
  constructor(providerTitlesManager, providersManager, tmdbManager, tmdbProcessingManager, metadataBatchSize = 100)
  ```
- Update all methods to accept `context` as first parameter:
  - `fetchMetadata(context, type)`
  - `loadProviderTitles(context, queryOptions, includeIgnored)`
  - `getAllTitles(context)`
  - `loadTitles(context, type)`
  - `saveTitles(context, type, titles)`
  - `getAllIgnored(context)`
  - `loadIgnoredTitles(context, type)`
  - `addIgnoredTitle(context, type, titleId, reason)`
  - `unloadTitles(context)` - becomes context reset
- Replace all references:
  - `this.providerData` → `context.providerData`
  - `this.providerId` → `context.providerId`
  - `this._titlesCache` → `context.titlesCache`
  - `this._ignoredCache` → `context.ignoredCache`
  - `this._accumulatedIgnoredTitles` → `context.accumulatedIgnoredTitles`
- Create logger per execution: `createLogger(\`${context.providerData.type?.toUpperCase()}::${context.providerId}\`)`

### Phase 3: Refactor Concrete Processing Managers

#### 3.1 Refactor AGTVProcessingManager

**File**: `web-api/src/managers/processing/AGTVProcessingManager.js`

**Changes**:
- Update constructor to match BaseIPTVProcessingManager (remove `providerData`)
- Update all method calls to pass context parameter
- Update any direct references to `this.providerData` or instance state

#### 3.2 Refactor XtreamProcessingManager

**File**: `web-api/src/managers/processing/XtreamProcessingManager.js`

**Changes**:
- Update constructor to match BaseIPTVProcessingManager (remove `providerData`)
- Update all method calls to pass context parameter
- Update any direct references to `this.providerData` or instance state

#### 3.3 Review TMDBProcessingManager

**File**: `web-api/src/managers/processing/TMDBProcessingManager.js`

**Changes**:
- Review if `_mainTitlesCache` is execution-scoped (likely yes)
- If yes, add context parameter to relevant methods
- Update constructor if needed

### Phase 4: Update Jobs

#### 4.1 Update BaseJob

**File**: `web-api/src/jobs/BaseJob.js`

**Changes**:
- Add `processingManagerRegistry` parameter to constructor
- Update `_createHandlers()`:
  - Get TMDB processing manager from registry: `this.tmdbProcessingManager = this.processingManagerRegistry.getTMDBProcessingManager()`
  - Get enabled providers from `providersManager`
  - Get processing managers from registry instead of creating new instances
  - Change log message from "Creating" to "Getting" processing managers
- Remove `_createTMDBProcessingManager()` method

#### 4.2 Update SyncIPTVProviderTitlesJob

**File**: `web-api/src/jobs/SyncIPTVProviderTitlesJob.js`

**Changes**:
- In `execute()`, create `ProcessingContext` for each handler:
  ```javascript
  const contexts = new Map();
  for (const [providerId, handler] of this.handlers) {
    const providerData = await this.providersManager.getProvider(providerId);
    contexts.set(providerId, new ProcessingContext(providerId, providerData));
  }
  ```
- Pass context to `fetchMetadata()` calls: `handler.fetchMetadata(context, 'movies')`
- Update filter to use `context.providerData` instead of `handler.providerData`
- Update finally block to call `context.reset()` instead of `handler.unloadTitles()`

#### 4.3 Update ProviderTitlesMonitorJob

**File**: `web-api/src/jobs/ProviderTitlesMonitorJob.js`

**Changes**:
- In `execute()`, create `ProcessingContext` for each handler
- Pass context to `loadProviderTitles()`: `handler.loadProviderTitles(context, lastExecution)`
- Pass context to `getAllTitles()`: `handler.getAllTitles(context)`
- Update filter to use `context.providerData`
- Update finally block to reset contexts

### Phase 5: Initialize Registry

#### 5.1 Update index.js

**File**: `web-api/src/index.js`

**Changes**:
- Import `ProcessingManagerRegistry` and `ProcessingContext`
- After providers are created (around line 209), create registry instance:
  ```javascript
  const processingManagerRegistry = new ProcessingManagerRegistry();
  ```
- After all managers are created, initialize registry:
  ```javascript
  await processingManagerRegistry.initialize(allProviders, {
    providerTitlesManager,
    providersManager: null, // Will be set after ProvidersManager is created
    tmdbManager,
    titlesManager,
    providerTitlesManager
  });
  ```
- After ProvidersManager is created, update registry dependencies (if needed)
- Pass registry to all job constructors that extend BaseJob:
  ```javascript
  jobInstances.set('syncIPTVProviderTitles', new SyncIPTVProviderTitlesJob(
    'syncIPTVProviderTitles',
    jobHistoryManager,
    providersManager,
    tmdbManager,
    titlesManager,
    providerTitlesManager,
    processingManagerRegistry // Add registry
  ));
  ```

### Phase 6: Update ProvidersManager

#### 6.1 Update ProvidersManager

**File**: `web-api/src/managers/orchestration/ProvidersManager.js`

**Changes**:
- Add `processingManagerRegistry` parameter to constructor
- Store as `this._processingManagerRegistry`
- Update `createProvider()`:
  - After provider is created, call `this._processingManagerRegistry.update(createdProvider, dependencies)`
- Update `updateProvider()`:
  - After provider is updated, call `this._processingManagerRegistry.update(updatedProvider, dependencies)`
- Update `deleteProvider()`:
  - After provider is deleted, call `this._processingManagerRegistry.remove(providerId)`
- Pass registry when creating ProvidersManager in `index.js`

## Implementation Order

1. Create `ProcessingContext.js` class
2. Create `ProcessingManagerRegistry.js` service
3. Refactor `BaseProcessingManager.js` to use context
4. Refactor `BaseIPTVProcessingManager.js` to use context
5. Refactor `AGTVProcessingManager.js` and `XtreamProcessingManager.js`
6. Review and update `TMDBProcessingManager.js` if needed
7. Update `BaseJob.js` to use registry
8. Update `SyncIPTVProviderTitlesJob.js` and `ProviderTitlesMonitorJob.js` execute methods
9. Initialize registry in `index.js`
10. Update `ProvidersManager.js` to maintain registry

## Key Considerations

### State Management

- **Instance State** (stays in processing manager):
  - Rate limiters (tied to provider config)
  - Dependencies (managers, repositories)
  - Logger name pattern (but logger created per execution)

- **Execution State** (moves to context):
  - Provider configuration and ID
  - All caches (titles, ignored titles)
  - Progress tracking
  - Accumulated ignored titles

### Logger Creation

- Logger should be created per execution with provider context
- Pattern: `createLogger(\`${context.providerData.type?.toUpperCase()}::${context.providerId}\`)`
- This ensures logs show correct provider context for each execution

### Context Lifecycle

- Context objects are created fresh for each job execution
- Contexts are reset/cleaned up in job `finally` blocks
- Contexts are not reused across executions (fresh state each time)

### Registry Updates

- Registry is updated when providers are created/updated/deleted
- This ensures processing managers always have current provider configuration
- TMDB processing manager is shared singleton (not per-provider)

### Backward Compatibility

- All method signatures change (add context parameter)
- Jobs must be updated to create and pass contexts
- No breaking changes to external APIs (jobs are internal)

## Benefits

1. **Reduced Object Allocations**: Processing managers created once, not per execution
2. **Clearer Separation**: Stateless processing logic vs. execution-scoped state
3. **Easier Testing**: No instance state to reset between tests
4. **Consistency**: Matches provider pattern (singleton instances)
5. **Better Resource Management**: Rate limiters persist across executions (correct behavior)

## Testing Considerations

- Test that processing managers are reused across job executions
- Test that contexts are fresh for each execution
- Test that registry updates correctly when providers change
- Test that rate limiters work correctly with reused instances
- Test that logger context is correct for each execution

## Migration Notes

- This is a breaking change for all processing manager methods (add context parameter)
- All jobs using processing managers must be updated
- No changes needed to external APIs or database schema
- Can be implemented incrementally (one processing manager at a time)

