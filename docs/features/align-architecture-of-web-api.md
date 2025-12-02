# Align Architecture of Web API

## Overview

This document defines the aligned architecture for the Playarr Web API, establishing clear layer definitions, class types, and dependency rules to prevent circular dependencies and maintain clean separation of concerns.

## 4-Level Architecture

### Level 1: Entry Level
**Purpose:** Entry points into the system

**Class Types:**
- **Routers** - HTTP API endpoints (all in `routes/`)
- **Jobs** - Offline background tasks (all in `jobs/`)

**Dependencies:**
- ✅ Can depend on: Managers (Level 2), Middleware (Level 4), BaseRouter/BaseJob
- ❌ Cannot depend on: Repositories, Providers (data access layer)
- ❌ Cannot depend on: Other Routers, other Jobs (Level 1 components cannot depend on Level 1)
- ❌ Data access layer (Repositories, Providers) is not accessed by entry points

---

### Level 2: Business Logic (Managers)
**Purpose:** Business rules, orchestration, and data processing

**Class Types:** Four types of managers:

#### Type A: Domain Managers
**Purpose:** Manage a specific domain

**Examples:**
- `UserManager` - User domain
- `SettingsManager` - Settings domain
- `StatsManager` - Statistics domain
- `TitlesManager` - Titles domain (main titles)
- `ChannelManager` - Channels domain (to be created)
- `ProgramManager` - Programs domain (to be created)
- `IPTVProviderManager` - IPTV Provider domain (configuration, categories, priorities, CRUD operations)
- `ProviderTitlesManager` - **MISSING** (should exist for provider_titles domain)

**Dependencies:**
- ✅ Can depend on: Repositories (Level 3), Services (Level 4), other Domain Managers (with caution)
- ❌ Cannot depend on: Routers, Jobs, Formatting Managers, Processing Managers

**Responsibilities:**
- CRUD operations for domain entities
- Domain-specific business logic
- Data validation
- Domain event publishing (via Services)

---

#### Type B: Formatting Managers
**Purpose:** Transform data for external API formats or format provider responses for endpoints

**Examples:**
- `PlaylistManager` - Formats to M3U8 playlist format
- `XtreamManager` - Formats to Xtream Code API format
- `StremioManager` - Formats to Stremio addon format
- `TMDBManager` - Formats TMDB provider responses for API endpoints (verification, etc.)

**Dependencies:**
- ✅ Can depend on: Domain Managers, Providers (Level 3, for formatting provider responses)
- ❌ Cannot depend on: Repositories (Level 3, for data access - should use Domain Managers instead), Routers, Jobs, Processing Managers, UserManager, IPTVProviderManager, ProvidersManager
- ✅ When formatting managers need user configuration (watchlist, preferences) or provider configuration, they should receive these as input parameters (configuration/data objects, not manager instances)

**Responsibilities:**
- Transform internal data format to external API format
- Format provider responses for API endpoints
- Filter data based on user context (watchlist, etc.) received as parameters
- Format-specific validation

**Note:** These managers receive user objects and configuration data as parameters, not manager instances. They should not depend on UserManager, IPTVProviderManager, or ProvidersManager directly. Some formatting managers (like `TMDBManager`) format provider responses directly rather than domain data.

---

#### Type C: Processing Managers
**Purpose:** Process and transform data during sync jobs

**Current State:** Currently called "Handlers" - should be renamed to Managers

**Examples:**
- `AGTVProcessingManager` (currently `AGTVHandler`) - Processes AGTV provider data
- `XtreamProcessingManager` (currently `XtreamHandler`) - Processes Xtream provider data
- `TMDBProcessingManager` (currently `TMDBHandler`) - Processes TMDB data for matching

**Dependencies:**
- ✅ Can depend on: Providers (Level 3), Domain Managers
- ❌ Cannot depend on: Routers, Jobs, Formatting Managers, **Repositories (Level 3)**
- ✅ Should use Domain Managers for saving data (e.g., `TitlesManager.saveMainTitles()`, `ProviderTitlesManager.saveProviderTitles()`)

**Responsibilities:**
- Transform provider data to internal format
- Match provider titles with TMDB IDs
- Batch processing and saving via Domain Managers (not repositories directly)
- Progress tracking during sync operations

**Note:** Processing Managers should NOT access Repositories directly. They should use Domain Managers for all data operations. This follows the same principle as Routers/Jobs - entry points and processing components should not access the data access layer directly.

---

#### Type D: Orchestration Managers
**Purpose:** Coordinate operations across multiple domains

**Examples:**
- `JobsManager` - Orchestrates job scheduling and execution
- `ProvidersManager` - Orchestrates provider operations across domains (jobs, WebSocket, cleanup, provider instances)

**Dependencies:**
- ✅ Can depend on: Domain Managers, Services (Level 4), Repositories (Level 3)
- ❌ Cannot depend on: Routers, Jobs, Formatting Managers, Processing Managers

**Responsibilities:**
- Coordinate complex workflows across domains
- Manage scheduling and execution
- Handle cross-domain transactions
- Coordinate provider lifecycle (jobs, WebSocket notifications, cleanup)

---

### Level 3: Data Access Layer
**Purpose:** Data access and external API integration

**Class Types:**
- **Repositories** - Database access (all in `repositories/`)
- **Providers** - External API access (all in `providers/`)

**Dependencies:**
- ✅ Can depend on: MongoDB Client, BaseRepository, BaseProvider, utilities
- ❌ Cannot depend on: Managers, Routers, Jobs, Services

---

### Level 4: Infrastructure
**Purpose:** Cross-cutting infrastructure concerns

**Class Types:**
- **Services** - Infrastructure services (`WebSocketService`, `EngineScheduler`)
- **Middleware** - Authentication/authorization middleware

**Dependencies:**
- ✅ Can depend on: Other Services, utilities
- ❌ Cannot depend on: Managers, Repositories, Providers, Routers

**Responsibilities:**
- Real-time communication (WebSocket)
- Job scheduling infrastructure
- Authentication/authorization
- Logging and monitoring

---

## Directory Structure

The Web API follows a structured directory layout organized by architectural layers and manager types:

```
web-api/src/
├── routes/                    # Level 1: Entry Level - Routers
├── jobs/                      # Level 1: Entry Level - Jobs
├── managers/                  # Level 2: Business Logic
│   ├── BaseManager.js         # Base class for all managers
│   ├── domain/               # Type A: Domain Managers
│   │   ├── BaseDomainManager.js  # Base class for domain managers (bulk upsert, repository reference)
│   │   ├── UserManager.js
│   │   ├── SettingsManager.js
│   │   ├── TitlesManager.js
│   │   ├── ChannelManager.js
│   │   ├── ProgramManager.js
│   │   ├── IPTVProviderManager.js
│   │   ├── ProviderTitlesManager.js
│   │   └── JobHistoryManager.js
│   ├── formatting/            # Type B: Formatting Managers
│   │   ├── BaseFormattingManager.js
│   │   ├── BaseWatchlistFormattingManager.js
│   │   ├── PlaylistManager.js
│   │   ├── XtreamManager.js
│   │   ├── StremioManager.js
│   │   ├── TMDBManager.js
│   │   └── LiveTVFormattingManager.js
│   ├── processing/            # Type C: Processing Managers
│   │   ├── AGTVProcessingManager.js
│   │   ├── XtreamProcessingManager.js
│   │   ├── TMDBProcessingManager.js
│   │   └── LiveTVProcessingManager.js
│   └── orchestration/         # Type D: Orchestration Managers
│       ├── JobsManager.js
│       └── ProvidersManager.js
├── repositories/              # Level 3: Data Access Layer - Repositories
├── providers/                 # Level 3: Data Access Layer - Providers
├── services/                  # Level 4: Infrastructure - Services
└── middleware/                # Level 4: Infrastructure - Middleware
```

---

## Dependency Rules

### General Rules

1. **No Circular Dependencies:** Managers cannot have circular dependencies with other managers
2. **No Lazy Injection:** All dependencies must be injected via constructor (no setters)
3. **Downward Dependencies Only:** Each level can only depend on levels below it
4. **Explicit Dependencies:** All dependencies must be declared in constructor
5. **No Instance Parameters:** Instances are never transferred as parameters to functions. All dependencies must be injected via constructor only.
6. **No Optional Dependencies:** Dependencies are either required or not present. If a dependency is needed, it must be provided in the constructor. If it's not always needed, the class design should be reconsidered (e.g., split into separate classes, use a different pattern, or always provide the dependency). Default values like `= null` or `= undefined` are not allowed for dependencies.

### Level-Specific Rules

#### Level 1 (Entry Level)
- Routers depend on Managers and Middleware
- Jobs depend on Managers only (NOT Repositories or Providers)
- Data access layer (Repositories, Providers) is not accessed by entry points
- Level 1 components cannot depend on other Level 1 components
- When routers need user watchlist or provider configuration, they should receive these as input parameters (data/configuration objects, not manager instances) to avoid forcing managers to own these dependencies

#### Level 2 (Business Logic)
- Domain Managers can depend on Repositories (Level 3) and Services (Level 4)
- Formatting Managers depend on Domain Managers (not UserManager or ProvidersManager directly)
- Formatting Managers receive user configuration and provider configuration as input parameters (data/configuration objects, not instances)
- Processing Managers depend on Providers (Level 3) and Domain Managers (NOT Repositories - they should use Domain Managers for data operations)
- No circular dependencies between managers

#### Level 3 (Data Access Layer)
- Repositories only depend on MongoDB Client
- Providers only depend on BaseProvider and utilities
- No business logic in repositories or providers

#### Level 4 (Infrastructure)
- Services are standalone infrastructure
- Middleware depends only on UserManager (for authentication)

---

## Current Issues and Gaps

### 1. Circular Dependencies

**Issue:** `TitlesManager` ↔ `ProvidersManager` circular dependency

**Current State:**
- `TitlesManager` calls `ProvidersManager.getProviders()` to get enabled providers
- `ProvidersManager` stores `TitlesManager` but never uses it (dead dependency)

**Solution:**
- Remove `TitlesManager` dependency on `ProvidersManager`
- Remove `setProvidersManager()` setter from `TitlesManager`
- Remove `_titlesManager` from `ProvidersManager` (dead dependency - will be removed when splitting ProvidersManager)
- When `TitlesManager` methods need enabled provider configuration, they should receive it as an input parameter (data/configuration objects, not manager instances)
- Routers that call `TitlesManager` methods should:
  1. Get enabled provider IDs from `IPTVProviderManager` (Level 2 → Level 2 is allowed, Domain Manager to Domain Manager)
  2. Pass enabled provider IDs as a parameter to `TitlesManager` methods (e.g., `getTitles({ enabledProviderIds: [...] })`)

**Note:** `StreamManager` will be removed - stream URL resolution functionality will be moved to `BaseFormattingManager` (see Issue #15)

---

### 2. Dead Dependencies

**Issue:** Managers storing dependencies they never use

**Current State:**
- `ProvidersManager._titlesManager` - stored but never called
- `StremioManager._userManager` - stored but never called

**Solution:**
- Remove unused dependencies from constructors
- Update all initialization code in `index.js`

---

### 3. Missing Domain Manager

**Issue:** No dedicated manager for `provider_titles` domain

**Current State:**
- `ProviderTitleRepository` exists
- `ProvidersManager` handles provider title operations directly
- No clear separation of concerns

**Solution:**
- Create `ProviderTitlesManager` as a Domain Manager
- Move provider title operations from `ProvidersManager` to `ProviderTitlesManager`
- `ProvidersManager` should use `ProviderTitlesManager` for provider title operations

---

### 4. Formatting Managers Should Not Depend on UserManager

**Issue:** Formatting managers should receive user objects as parameters, not depend on UserManager

**Current State:**
- `StremioManager` stores `UserManager` but never uses it
- `PlaylistManager` and `XtreamManager` correctly receive user objects as parameters

**Solution:**
- Remove `UserManager` dependency from `StremioManager`
- Ensure all formatting managers receive user objects as parameters

---

### 5. Handler Naming

**Issue:** "Handlers" should be renamed to "Processing Managers" for consistency

**Current State:**
- `AGTVHandler`, `XtreamHandler`, `TMDBHandler` are called "Handlers"
- They are actually managers that process data during sync jobs

**Solution:**
- Rename all handlers to Processing Managers:
  - `AGTVHandler` → `AGTVProcessingManager`
  - `XtreamHandler` → `XtreamProcessingManager`
  - `TMDBHandler` → `TMDBProcessingManager`
- Rename base classes:
  - `BaseHandler` → `BaseProcessingManager`
  - `BaseIPTVHandler` → `BaseIPTVProcessingManager`

---

### 6. Overlapping Functionality and Direct Repository Access

**Issue:** `PlaylistManager`, `XtreamManager`, and `StremioManager` have overlapping functionality and violate architecture by accessing repositories directly

**Current State:**
- `PlaylistManager` and `XtreamManager`:
  - Both filter by user watchlist (duplicate logic)
  - Both query `TitleRepository.findByTitleKeys()` directly (violates architecture - should use `TitlesManager`)
  - Both format data (M3U8 vs Xtream Code API)
- `StremioManager`:
  - Uses `TitlesManager.findTitlesByQuery()` and `TitlesManager.findTitleByQuery()` (correct)
  - But also accesses `_titlesManager._titleRepo.findOneByQuery()` directly (violates OOP encapsulation - accessing private member)

**Problems:**
1. Duplicate watchlist filtering logic in `PlaylistManager` and `XtreamManager`
2. Direct repository access: `PlaylistManager` and `XtreamManager` access `TitleRepository` directly (violates architecture - Formatting Managers should use Domain Managers)
3. OOP violation: `StremioManager` accesses `_titlesManager._titleRepo` (private member access - violates encapsulation)
4. Missing method: `TitlesManager` doesn't expose `findByTitleKeys()` method that formatting managers need

**Solution:**
1. Add `findByTitleKeys()` method to `TitlesManager`:
   ```javascript
   async findByTitleKeys(keys) {
     return await this._titleRepo.findByTitleKeys(keys);
   }
   ```

2. Create `BaseFormattingManager` base class:
   ```javascript
   class BaseFormattingManager extends BaseManager {
     constructor(managerName, titlesManager, iptvProviderManager) {
       super(managerName);
       this._titlesManager = titlesManager; // Use Domain Manager, not Repository
       this._iptvProviderManager = iptvProviderManager; // Use Domain Manager, not Repository
     }

     // Stream URL resolution methods (all Formatting Managers inherit this)
     async getBestSource(titleId, mediaType, seasonNumber, episodeNumber) {
       // Get sources and return first valid URL
     }

     async _getSources(titleId, mediaType, seasonNumber, episodeNumber) {
       // Use TitlesManager and IPTVProviderManager to get sources
     }

     async _checkUrl(url, providerType) {
       // Validate URL is reachable
     }
   }
   ```

3. Create `BaseWatchlistFormattingManager` base class:
   ```javascript
   class BaseWatchlistFormattingManager extends BaseFormattingManager {
     constructor(managerName, titlesManager, iptvProviderManager, liveTVManager = null) {
       super(managerName, titlesManager, iptvProviderManager);
       this._liveTVManager = liveTVManager;
     }

     // Common: Get watchlist titles using TitlesManager
     async _getWatchlistTitles(user, mediaType) {
       if (!user || !user.watchlist || !Array.isArray(user.watchlist)) {
         return new Map();
       }
       const watchlistTitleKeys = user.watchlist.filter(key => key.startsWith(`${mediaType}-`));
       if (watchlistTitleKeys.length === 0) {
         return new Map();
       }
       // Use TitlesManager method, not direct repository access
       const titles = await this._titlesManager.findByTitleKeys(watchlistTitleKeys);
       // Convert to Map
       const titlesMap = new Map();
       for (const title of titles) {
         if (title.title_key) {
           titlesMap.set(title.title_key, title);
         }
       }
       return titlesMap;
     }

     // Common: Get watchlist streams (for PlaylistManager)
     async _getWatchlistStreams(mediaType, user) {
       // Uses _getWatchlistTitles() and processes media array
     }
   }
   ```

4. Update concrete classes:
   - `PlaylistManager extends BaseWatchlistFormattingManager` - watchlist filtering + stream URL resolution + M3U8 formatting
   - `XtreamManager extends BaseWatchlistFormattingManager` - watchlist filtering + stream URL resolution + Xtream Code API formatting
   - `StremioManager extends BaseFormattingManager` - stream URL resolution + Stremio addon formatting (no watchlist filtering)
   - `TMDBManager extends BaseFormattingManager` - formats TMDB provider responses (may not use stream, but inherits it)

4. Fix `StremioManager` OOP violation:
   - Replace `_titlesManager._titleRepo.findOneByQuery()` with `_titlesManager.findTitleByQuery()`

**Benefits:**
- Removes duplicate watchlist filtering logic
- Follows architecture: Formatting Managers use Domain Managers (TitlesManager), not Repositories directly
- Fixes OOP violation: No private member access
- Single source of truth for watchlist filtering
- Easier to maintain and test

---

### 7. Duplicate Enabled Provider Filtering Logic

**Issue:** Multiple places in the code filter enabled providers individually instead of using a single function in `ProvidersManager`

**Current State:**
- `TitlesManager._getEnabledProviders()` - Gets all providers, filters `p.enabled !== false`, returns `Set<string>` of IDs
- Formatting Managers (via `BaseFormattingManager._getSources()`) - Gets all providers, filters `p.enabled !== false`, creates `Map<string, Provider>`
- `BaseJob._createHandlers()` - Gets all providers, filters `!p.deleted` (not specifically enabled)
- `SyncIPTVProviderTitlesJob.execute()` - Filters handlers: `config.enabled && !config.deleted`
- `SyncProviderDetailsJob.execute()` - Gets all providers, filters `p.enabled !== false && !p.deleted`
- `ProviderTitlesMonitorJob.execute()` - Filters handlers: `config.enabled && !config.deleted`

**Problems:**
1. Duplicate filtering logic: `p.enabled !== false` appears in multiple places
2. Inconsistent filtering: Some check `enabled !== false`, some check `enabled && !deleted`
3. Direct repository access: `TitlesManager` and Formatting Managers (via `BaseFormattingManager`) fall back to `ProviderRepository` directly (violates architecture)
4. No single source of truth for enabled provider logic

**Solution:**
Add dedicated methods to `ProvidersManager` (Level 2) to provide enabled providers:

```javascript
/**
 * Get enabled provider IDs only
 * @returns {Promise<Set<string>>} Set of enabled provider IDs
 */
async getEnabledProviderIds() {
  const providers = await this._readAllProviders();
  return new Set(
    providers
      .filter(p => p.enabled !== false)
      .map(p => p.id)
  );
}

/**
 * Get enabled provider objects
 * @param {Object} options - Filter options
 * @param {boolean} options.excludeDeleted - Exclude deleted providers (default: false)
 * @returns {Promise<Array>} Array of enabled provider objects
 */
async getEnabledProviders(options = {}) {
  const { excludeDeleted = false } = options;
  const providers = await this._readAllProviders();
  return providers.filter(p => {
    if (p.enabled === false) return false;
    if (excludeDeleted && p.deleted) return false;
    return true;
  });
}

/**
 * Get enabled providers as a Map (id -> provider)
 * @param {Object} options - Filter options
 * @param {boolean} options.excludeDeleted - Exclude deleted providers (default: false)
 * @returns {Promise<Map<string, Object>>} Map of enabled providers
 */
async getEnabledProvidersMap(options = {}) {
  const providers = await this.getEnabledProviders(options);
  return new Map(providers.map(p => [p.id, p]));
}
```

**Implementation Steps:**
1. Add the three methods above to `IPTVProviderManager` (after split from `ProvidersManager`)
2. Remove `TitlesManager._getEnabledProviders()` - methods should accept `enabledProviderIds` as parameter
3. Remove provider filtering from `BaseFormattingManager._getSources()` - methods should use `IPTVProviderManager.getEnabledProvidersMap()` directly
4. Update Jobs to call `IPTVProviderManager.getEnabledProviders({ excludeDeleted: true })` and pass results to managers
5. Update Routers to call `IPTVProviderManager.getEnabledProviderIds()` and pass to manager methods

**Benefits:**
- Single source of truth for enabled provider logic
- Consistent filtering across the codebase
- Follows architecture: Level 2 (Managers) provides the data, Level 1 (Jobs/Routers) passes it as parameters
- Removes direct repository access from managers
- Easier to maintain and test

---

### 8. ProvidersManager Mixing Domain and Orchestration Concerns

**Issue:** `ProvidersManager` is currently classified as a Domain Manager but performs both domain operations and orchestration operations

**Current State:**
- `ProvidersManager` handles:
  - **Domain operations:** Provider CRUD (`createProvider`, `updateProvider`, `deleteProvider`, `getProvider`, `getProviders`), configuration, categories, priorities, details
  - **Orchestration operations:** Job triggering (`_triggerJobAsync`), provider instance lifecycle (`_reloadProviderConfigs`), WebSocket notifications, cross-domain cleanup (`_removeProviderFromTitles`), provider type instance management

**Problems:**
1. Violates Single Responsibility Principle - one manager doing both domain and orchestration
2. Makes it unclear what `ProvidersManager` is responsible for
3. Difficult to test - domain logic mixed with orchestration logic
4. Harder to maintain - changes to domain affect orchestration and vice versa

**Solution:**
Split `ProvidersManager` into two managers:

1. **`IPTVProviderManager`** (Type A: Domain Manager)
   - **Purpose:** Manage IPTV Provider domain
   - **Responsibilities:**
     - Provider CRUD operations
     - Provider configuration (credentials, URLs, rate limits)
     - Provider categories management (`getCategories`, `updateEnabledCategories`)
     - Provider priorities management (`getProviderPriorities`, `updateProviderPriorities`)
     - Provider details management (`updateProviderDetails`, `getIgnoredTitles`)
   - **Dependencies:** `ProviderRepository` (Level 3)
   - **Methods:** `createProvider()`, `updateProvider()`, `deleteProvider()`, `getProvider()`, `getProviders()`, `getCategories()`, `updateEnabledCategories()`, `getProviderPriorities()`, `updateProviderPriorities()`, `updateProviderDetails()`, `getEnabledProviderIds()`, `getEnabledProviders()`, `getEnabledProvidersMap()`
   - **Note:** `getIgnoredTitles()` belongs to `ProviderTitlesManager`, not `IPTVProviderManager`

2. **`ProvidersManager`** (Type D: Orchestration Manager)
   - **Purpose:** Coordinate provider operations across domains
   - **Responsibilities:**
     - Trigger jobs when providers change (`_triggerJobAsync`)
     - Manage provider instance lifecycle (`_reloadProviderConfigs`)
     - WebSocket event broadcasting (`broadcastEvent`)
     - Coordinate cross-domain cleanup (`_removeProviderFromTitles` - coordinates with `TitleRepository`, `ProviderTitleRepository`)
     - Manage provider type instances (`providerTypeMap`)
   - **Dependencies:** `IPTVProviderManager`, `ProviderTitlesManager`, `TitleRepository`, `ProviderTitleRepository`, `WebSocketService`, `triggerJob`, `providerTypeMap`
   - **Methods:** Wraps `IPTVProviderManager` methods and adds orchestration (job triggering, WebSocket, cleanup)

**Implementation:**
- `ProvidersManager` will delegate domain operations to `IPTVProviderManager`
- `ProvidersManager` adds orchestration layer (jobs, WebSocket, cleanup) on top of domain operations
- Routers/Jobs can use `IPTVProviderManager` directly for simple domain operations
- Routers/Jobs use `ProvidersManager` when orchestration is needed (e.g., create provider and trigger sync job)

**Benefits:**
- Clear separation: domain vs orchestration
- Single responsibility per manager
- Easier testing: domain logic isolated from orchestration
- Better maintainability: changes to domain don't affect orchestration
- Follows architecture: domain managers handle domain, orchestration managers coordinate

---

### 9. TMDBManager Wrapping SettingsManager Instead of Direct Router Dependency

**Issue:** `TMDBManager` has wrapper functions that just delegate to `SettingsManager` instead of having `SettingsManager` as a direct dependency in the router. After removing wrappers, `TMDBManager` only formats provider responses, making it a Formatting Manager (Type B), not a Domain Manager (Type A).

**Current State:**
- `TMDBManager` wraps `SettingsManager` methods:
  - `getApiKey()` - wraps `SettingsManager.getSetting('tmdb_token')`
  - `setApiKey()` - wraps `SettingsManager.setSetting('tmdb_token')` and updates provider
  - `deleteApiKey()` - wraps `SettingsManager.deleteSetting('tmdb_token')`
- `TMDBRouter` depends only on `TMDBManager`, not `SettingsManager`
- `TMDBManager` also has `verifyApiKey()` which calls `TMDBProvider` and formats the response

**Problems:**
1. Unnecessary wrapper layer - `TMDBManager` just delegates to `SettingsManager` for storage operations
2. Violates architecture - routers should depend on the managers they need directly, not through wrappers
3. Makes code less clear - extra indirection without added value
4. `TMDBManager` mixes concerns - both settings storage (via wrapper) and formatting provider responses
5. Misclassified - after removing wrappers, `TMDBManager` only formats provider responses, so it should be a Formatting Manager (Type B), not a Domain Manager (Type A)

**Solution:**
1. Remove wrapper functions from `TMDBManager`:
   - Remove `getApiKey()`, `setApiKey()`, `deleteApiKey()`
   - Keep `verifyApiKey()` (calls `TMDBProvider` and formats response - this is formatting logic)
   - Add `updateProviderApiKey(apiKey)` method to update provider when API key is set (needed because routers shouldn't access providers directly)

2. Reclassify `TMDBManager` as Formatting Manager (Type B):
   - It only formats provider responses for API endpoints
   - It doesn't handle domain logic or CRUD operations
   - It depends on `TMDBProvider` (Level 3) to get data and formats it for the router

3. Update `TMDBRouter` to depend on `SettingsManager` directly:
   - Add `SettingsManager` as constructor dependency
   - Router calls `SettingsManager.getSetting('tmdb_token')` directly for GET
   - Router calls `SettingsManager.setSetting('tmdb_token', apiKey)` + `TMDBManager.updateProviderApiKey(apiKey)` for PUT
   - Router calls `SettingsManager.deleteSetting('tmdb_token')` directly for DELETE
   - Router still uses `TMDBManager.verifyApiKey()` for verification (formatting provider response)

4. Update `TMDBManager` constructor:
   - Remove `SettingsManager` dependency
   - Keep only `TMDBProvider` dependency

**Benefits:**
- Cleaner architecture: routers depend on domain managers directly, not through unnecessary wrappers
- Correct classification: `TMDBManager` is a Formatting Manager (formats provider responses), not a Domain Manager
- No data access layer exposure: routers use `SettingsManager` (Level 2), not providers directly
- Better maintainability: fewer indirection layers

---

### 10. Managers Using HTTP Status Codes

**Issue:** Managers are returning HTTP status codes in their responses, which violates separation of concerns. Managers are internal application code and should not be aware of HTTP semantics.

**Current State:**
All managers return `{ response: {...}, statusCode: number }` format:
- `SettingsManager` - All methods (`getSetting`, `setSetting`, `deleteSetting`)
- `UserManager` - All methods (`getAllUsers`, `getUser`, `createUser`, `updateUser`, `deleteUser`, `authenticateUser`, etc.)
- `StatsManager` - `getStats()`
- `JobsManager` - `getAllJobs()`, `triggerJob()`
- `TMDBManager` - All methods (wrapper functions)
- `TitlesManager` - Multiple methods (`getTitles`, `getTitle`, `updateTitleWatchlist`, etc.)
- `ProvidersManager` - All methods (`getProviders`, `getProvider`, `createProvider`, `updateProvider`, `deleteProvider`, etc.)

**Current Pattern:**
```javascript
// Manager
async getProvider(providerId) {
  const provider = providers.find(p => p.id === providerId);
  if (!provider) {
    return { response: { error: 'Provider not found' }, statusCode: 404 };
  }
  return { response: provider, statusCode: 200 };
}

// Router
const result = await this._providersManager.getProvider(providerId);
return res.status(result.statusCode).json(result.response);
```

**Problems:**
1. **Violates Separation of Concerns:** Managers shouldn't know about HTTP status codes - they're internal application code
2. **Hard to Reuse:** Managers can't be used in non-HTTP contexts (CLI, jobs, WebSocket, etc.)
3. **Tight Coupling:** Managers are tightly coupled to HTTP semantics
4. **Inconsistent Error Handling:** Some managers use status codes, some throw errors, creating inconsistency
5. **Routers are Just Pass-Through:** Routers don't make decisions, they just forward status codes from managers

**Solution:**
Managers should:
- Return data directly (or `null`/`undefined` if not found)
- Throw errors for exceptional cases (use custom error classes if needed)
- Return success/error indicators when needed (but not HTTP status codes)

Routers should:
- Map manager results/errors to appropriate HTTP status codes
- Handle business logic outcomes (not found → 404, validation error → 400, server error → 500, etc.)

**Recommended Pattern:**
```javascript
// Manager
async getProvider(providerId) {
  const providers = await this._readAllProviders();
  const provider = providers.find(p => p.id === providerId);
  if (!provider) {
    return null; // Simple: return null for not found
  }
  return provider; // Return data directly
}

// Router
try {
  const provider = await this._providersManager.getProvider(providerId);
  if (!provider) {
    return res.status(404).json({ error: 'Provider not found' });
  }
  return res.status(200).json(provider);
} catch (error) {
  this.logger.error('Error getting provider:', error);
  return this.returnErrorResponse(res, 500, 'Failed to get provider', error.message);
}
```

**Alternative Pattern (for complex cases):**
```javascript
// Manager - throw custom errors
async getProvider(providerId) {
  const providers = await this._readAllProviders();
  const provider = providers.find(p => p.id === providerId);
  if (!provider) {
    throw new NotFoundError('Provider not found'); // Custom error class
  }
  return provider;
}

// Router - map errors to status codes
try {
  const provider = await this._providersManager.getProvider(providerId);
  return res.status(200).json(provider);
} catch (error) {
  if (error instanceof NotFoundError) {
    return res.status(404).json({ error: error.message });
  }
  return this.returnErrorResponse(res, 500, 'Failed to get provider', error.message);
}
```

**Refactoring Recommendations by Manager:**

1. **SettingsManager:**
   - `getSetting(key)` → Return `{ value: string | null }` or throw on error
   - `setSetting(key, value)` → Return `{ value: string }` or throw on error
   - `deleteSetting(key)` → Return `{ success: true }` or throw on error
   - Router maps: success → 200, error → 500

2. **UserManager:**
   - `getAllUsers()` → Return `{ users: [] }` or throw on error
   - `getUser(username)` → Return user object or `null` (router maps to 404)
   - `createUser(...)` → Return user object or throw `ValidationError`/`ConflictError`
   - `updateUser(...)` → Return user object or throw `NotFoundError`/`ValidationError`
   - `deleteUser(...)` → Return `{ success: true }` or throw `NotFoundError`/`ForbiddenError`
   - Router maps: not found → 404, validation → 400, conflict → 409, forbidden → 403, error → 500

3. **StatsManager:**
   - `getStats()` → Return stats object or throw on error
   - Router maps: success → 200, error → 500

4. **JobsManager:**
   - `getAllJobs()` → Return `{ jobs: [] }` or throw on error
   - `triggerJob(jobName, options)` → Return `{ success: true, message: string }` or throw custom errors:
     - `JobNotFoundError` → router maps to 404
     - `JobAlreadyRunningError` → router maps to 409
     - `JobSchedulerUnavailableError` → router maps to 503
   - Router maps errors to appropriate status codes

5. **TMDBManager:**
   - After removing wrapper functions (Issue #9), only `verifyApiKey()` remains
   - `verifyApiKey(apiKey)` → Return `{ valid: boolean, message: string }` or throw on error
   - Router maps: success → 200, error → 500

6. **TitlesManager:**
   - `getTitles(...)` → Return `{ titles: [], total: number }` or throw on error
   - `getTitle(titleKey)` → Return title object or `null` (router maps to 404)
   - `updateTitleWatchlist(...)` → Return updated title or throw `NotFoundError`
   - Router maps: not found → 404, validation → 400, error → 500

7. **ProvidersManager:**
   - `getProviders()` → Return `{ providers: [] }` or throw on error
   - `getProvider(providerId)` → Return provider object or `null` (router maps to 404)
   - `createProvider(...)` → Return provider object or throw `ValidationError`/`ConflictError`
   - `updateProvider(...)` → Return provider object or throw `NotFoundError`/`ValidationError`
   - `deleteProvider(...)` → Return `{ success: true }` or throw `NotFoundError`
   - Router maps: not found → 404, validation → 400, conflict → 409, error → 500

**Benefits:**
- Clean separation: managers handle business logic, routers handle HTTP concerns
- Reusable: managers can be used in any context (HTTP, CLI, jobs, WebSocket)
- Consistent: all managers follow the same pattern
- Testable: easier to test managers without HTTP concerns
- Maintainable: HTTP status code logic centralized in routers

**Implementation Notes:**
- Consider creating custom error classes: `NotFoundError`, `ValidationError`, `ConflictError`, `ForbiddenError`
- Routers should have helper methods to map errors to status codes
- Keep error messages in managers (business context), but let routers format HTTP responses
- For backward compatibility during migration, can temporarily support both patterns

---

### 11. Business Logic in Repositories

**Issue:** Repositories contain business logic that should be in managers. Repositories should only handle data access (atomic operations), not business decisions.

**Current State:**
Repositories contain several types of business logic:

1. **Auto-timestamping** (`BaseRepository.insertOne()`, `insertMany()`, `updateOne()`, `updateMany()`)
   - Automatically adds `createdAt` and `lastUpdated` timestamps
   - This is business logic - managers should decide when to add timestamps

2. **Duplicate Key Handling** (`BaseRepository.insertOne()`, `insertMany()`)
   - Catches duplicate key errors (code 11000) and decides to ignore/return null
   - This is business logic - managers should decide how to handle duplicates

3. **Bulk Save with Existence Checking** (`BaseRepository.bulkSave()`)
   - Complex upsert pattern: checks existence, separates inserts/updates, executes both
   - This is complex business logic - should be in managers

4. **Query Building with Business Filters** (`ProviderTitleRepository.getProviderTitles()`)
   - Builds queries based on business filters (since, type, ignored)
   - This is business logic - managers should build queries

5. **Business Operations** (`ProviderTitleRepository.resetLastUpdated()`, `deleteByProvider()`)
   - Domain-specific operations, not generic data access
   - Should be in managers using generic repository methods

6. **Data Transformation** (`SettingsRepository.getAllAsObject()`, `StatsRepository.getAsObject()`)
   - Transforms data format (array to object)
   - This is presentation/transformation logic - should be in managers

**Problems:**
1. **Violates Separation of Concerns:** Repositories should only do data access, not business logic
2. **Hard to Reuse:** Business logic in repositories makes them less reusable
3. **Tight Coupling:** Repositories are coupled to business rules
4. **Inconsistent:** Some repositories have business logic, some don't
5. **Hard to Test:** Business logic mixed with data access is harder to test

**Solution:**

1. **Remove Auto-timestamping from Repositories:**
   - Managers should add timestamps before calling repository methods
   - Repositories should only store what managers provide

2. **Remove Duplicate Key Handling from Repositories:**
   - Managers should catch duplicate key errors and decide the business response
   - Repositories should throw errors, managers handle them

3. **Move Bulk Upsert Logic to BaseDomainManager:**
   - Create `BaseDomainManager` class for domain managers (in `managers/domain/`)
   - `BaseDomainManager` extends `BaseManager` and holds repository reference (one domain = one repository per manager)
   - Add `bulkUpsert()` method to `BaseDomainManager` for domain-specific bulk operations
   - Domain managers extend `BaseDomainManager` instead of `BaseManager`
   - Repositories only provide atomic operations (`insertMany()`, `bulkWrite()`, `findByQuery()`)

4. **Remove Business Query Building from Repositories:**
   - Managers should build queries and pass them to repositories
   - Repositories should only execute queries

5. **Remove Business Operations from Repositories:**
   - Managers should call generic repository methods directly
   - Remove methods like `resetLastUpdated()`, `deleteByProvider()` from repositories

6. **Move Data Transformation to Managers:**
   - Managers should handle data transformation
   - Repositories return raw data

**BaseDomainManager Solution:**

Create `BaseDomainManager` class that:
- Extends `BaseManager`
- Holds repository reference (one domain = one repository per manager)
- Provides `bulkUpsert()` method for domain managers
- Domain managers extend `BaseDomainManager` instead of `BaseManager`

**Example: BaseDomainManager**

```javascript
// web-api/src/managers/domain/BaseDomainManager.js

export class BaseDomainManager extends BaseManager {
  constructor(managerName, repository) {
    super(managerName);
    this._repository = repository; // One domain = one repository
  }

  /**
   * Perform bulk upsert operation (insert if not exists, update if exists)
   * This is domain business logic, specific to domain managers
   */
  async bulkUpsert(documents, options = {}) {
    // 1. Build existence queries
    // 2. Check which documents exist (using repository's findByQuery)
    // 3. Separate into inserts and updates
    // 4. Execute using repository's atomic methods (insertMany, bulkWrite)
  }
}
```

**Example: ProviderTitlesManager Usage**

```javascript
// web-api/src/managers/domain/ProviderTitlesManager.js

export class ProviderTitlesManager extends BaseDomainManager {
  constructor(providerTitleRepo) {
    super('ProviderTitlesManager', providerTitleRepo);
  }

  async saveProviderTitles(providerId, titles) {
    // Use inherited bulkUpsert from BaseDomainManager
    return await this.bulkUpsert(titles, {
      keyBuilder: (doc) => `${providerId}|${doc.title_key}`,
      buildExistenceQuery: (doc) => ({
        provider_id: providerId,
        title_key: doc.title_key
      }),
      buildUpdateOperation: (doc) => ({
        updateOne: {
          filter: { provider_id: providerId, title_key: doc.title_key },
          update: { $set: { ...doc, lastUpdated: new Date() } }
        }
      }),
      addTimestamps: true
    });
  }

  async getProviderTitles(providerId, options = {}) {
    // Build query in manager (business logic)
    const query = { provider_id: providerId };
    if (options.since) query.lastUpdated = { $gt: options.since };
    if (options.type) query.type = options.type;
    if (options.ignored !== undefined) query.ignored = options.ignored;
    
    // Use repository's atomic method
    return await this._repository.findByQuery(query);
  }
}
```

**Refactored Repository (ProviderTitleRepository):**

```javascript
// Remove: saveProviderTitles(), getProviderTitles(), resetLastUpdated(), deleteByProvider()
// Keep only: atomic operations
- findByQuery()
- findOneByQuery()
- insertMany()
- bulkWrite()
- updateManyByQuery()
- deleteManyByQuery()
```

**Benefits:**
- Clean separation: repositories = data access, managers = business logic
- Reusable: repositories are pure data access, can be used in any context
- Testable: business logic and data access can be tested separately
- Consistent: all repositories follow the same pattern (atomic operations only)
- Domain-focused: bulk upsert logic in domain managers where it belongs
- Repository reference: BaseDomainManager holds repository (one domain = one repo)

---

### 12. Jobs Accessing JobHistoryRepository Directly

**Issue:** Jobs (Level 1) are directly accessing `JobHistoryRepository` (Level 3), which violates the architectural rule that Level 1 should not access Level 3 directly.

**Current State:**
- `BaseJob` constructor takes `JobHistoryRepository` as a dependency
- Jobs call `jobHistoryRepo.findOneByQuery()` to get last execution time
- Jobs call `jobHistoryRepo.updateStatus()` to update job status
- `JobsManager` (Orchestration Manager) also uses `JobHistoryRepository` directly

**Code Examples:**

```javascript
// BaseJob.js - Current violation
constructor(jobName, providerRepo, providerTitleRepo, titleRepo, jobHistoryRepo, ...) {
  this.jobHistoryRepo = jobHistoryRepo; // Level 1 → Level 3 violation
}

async getLastExecution(options = {}) {
  const jobHistory = await this.jobHistoryRepo.findOneByQuery({ job_name: this.jobName });
  // ...
}

async setJobStatus(status, result = null, providerId = null) {
  await this.jobHistoryRepo.updateStatus(this.jobName, status, providerId, result);
}
```

```javascript
// JobsManager.js - Current violation
constructor(jobsConfig, scheduler = null, jobHistoryRepo = null) {
  this._jobHistoryRepo = jobHistoryRepo; // Orchestration Manager → Level 3 violation
}

async _getJobHistory(jobName) {
  const jobHistory = await this._jobHistoryRepo.findOneByQuery({ job_name: jobName });
  // ...
}

async isJobRunning(engineJobName) {
  const jobHistory = await this._jobHistoryRepo.findOneByQuery({ job_name: historyJobName });
  // ...
}
```

**Problems:**
1. **Violates Architecture Rules:** Level 1 (Jobs) should not access Level 3 (Repositories) directly
2. **Violates Dependency Rules:** Orchestration Managers should use Domain Managers, not Repositories directly
3. **Inconsistent:** Other entry points (Routers) don't access repositories directly
4. **Hard to Maintain:** Job history operations scattered across multiple classes
5. **No Business Logic Layer:** Job history operations bypass the business logic layer

**Solution:**
Create `JobHistoryManager` (Type A: Domain Manager) to handle job history operations:

1. **Create JobHistoryManager:**
   - Extends `BaseDomainManager`
   - Holds `JobHistoryRepository` reference
   - Provides methods:
     - `getLastExecution(jobName, options)` - Get last execution time with fallback options
     - `updateStatus(jobName, status, providerId, result)` - Update job status
     - `getJobHistory(jobName)` - Get job history document
     - `resetInProgress()` - Reset in-progress jobs (for startup)
     - `isJobRunning(jobName)` - Check if job is running

2. **Update Jobs:**
   - Remove `JobHistoryRepository` from `BaseJob` constructor
   - Add `JobHistoryManager` as dependency
   - Update `getLastExecution()` to use `jobHistoryManager.getLastExecution()`
   - Update `setJobStatus()` to use `jobHistoryManager.updateStatus()`

3. **Update JobsManager:**
   - Remove `JobHistoryRepository` from constructor
   - Add `JobHistoryManager` as dependency
   - Update `_getJobHistory()` to use `jobHistoryManager.getJobHistory()`
   - Update `isJobRunning()` to use `jobHistoryManager.isJobRunning()`

**Refactored Code:**

```javascript
// JobHistoryManager.js - New Domain Manager
import { BaseDomainManager } from './domain/BaseDomainManager.js';

export class JobHistoryManager extends BaseDomainManager {
  constructor(jobHistoryRepository) {
    super('JobHistoryManager', jobHistoryRepository);
  }

  async getLastExecution(jobName, options = {}) {
    const { fallbackDate = null, logMessage, noExecutionMessage } = options;
    
    try {
      const jobHistory = await this.repository.findOneByQuery({ job_name: jobName });
      if (jobHistory && jobHistory.last_execution) {
        const lastExecution = new Date(jobHistory.last_execution);
        if (logMessage) {
          this.logger.info(logMessage.replace('{date}', lastExecution.toISOString()));
        }
        return lastExecution;
      } else {
        if (noExecutionMessage) {
          this.logger.info(noExecutionMessage);
        }
        return fallbackDate;
      }
    } catch (error) {
      this.logger.error(`Error getting last execution: ${error.message}`);
      return fallbackDate;
    }
  }

  async updateStatus(jobName, status, providerId = null, result = null) {
    await this.repository.updateStatus(jobName, status, providerId, result);
  }

  async getJobHistory(jobName) {
    return await this.repository.findOneByQuery({ job_name: jobName });
  }

  async resetInProgress() {
    return await this.repository.resetInProgress();
  }

  async isJobRunning(jobName) {
    const jobHistory = await this.repository.findOneByQuery({ job_name: jobName });
    return jobHistory && jobHistory.status === 'running';
  }
}
```

```javascript
// BaseJob.js - Refactored
constructor(jobName, jobHistoryManager, ...) {
  this.jobHistoryManager = jobHistoryManager; // Level 1 → Level 2 ✓
}

async getLastExecution(options = {}) {
  return await this.jobHistoryManager.getLastExecution(this.jobName, options);
}

async setJobStatus(status, result = null, providerId = null) {
  await this.jobHistoryManager.updateStatus(this.jobName, status, providerId, result);
}
```

```javascript
// JobsManager.js - Refactored
constructor(jobsConfig, scheduler = null, jobHistoryManager = null) {
  this._jobHistoryManager = jobHistoryManager; // Orchestration → Domain ✓
}

async _getJobHistory(jobName) {
  return await this._jobHistoryManager.getJobHistory(jobName);
}

async isJobRunning(engineJobName) {
  const historyJobName = this.getJobHistoryName(engineJobName);
  return await this._jobHistoryManager.isJobRunning(historyJobName);
}
```

**Benefits:**
- Follows architecture: Level 1 → Level 2 → Level 3
- Consistent: All entry points use managers, not repositories
- Maintainable: Job history operations centralized in one manager
- Testable: Can mock `JobHistoryManager` instead of repository
- Reusable: `JobHistoryManager` can be used by other components

---

### 13. TitlesManager Depending on UserManager

**Issue:** `TitlesManager` (Domain Manager) depends on `UserManager` (another Domain Manager) for watchlist operations, which violates the architectural principle that Domain Managers should manage their own domain only.

**Current State:**
- `TitlesManager` constructor takes `UserManager` as a dependency
- `TitlesManager.getTitles()` calls `_userManager.getUserByUsername()` to get user watchlist
- `TitlesManager.getTitleDetails()` calls `_userManager.getUserByUsername()` to get user watchlist
- `TitlesManager.updateWatchlistBulk()` calls `_userManager.updateUserWatchlist()` to update watchlist

**Code Examples:**

```javascript
// TitlesManager.js - Current violation
constructor(userManager, titleRepo, providerRepo, providersManager = null) {
  this._userManager = userManager; // Domain Manager → Domain Manager violation
}

async getTitles({ user = null, ... }) {
  const userData = await this._userManager.getUserByUsername(user.username);
  const watchlistTitleKeys = userData.watchlist || [];
  // Use watchlist for filtering...
}

async updateWatchlistBulk(user, titles) {
  // ...
  await this._userManager.updateUserWatchlist(user.username, titlesToWatchlist, true);
  await this._userManager.updateUserWatchlist(user.username, titlesToUnwatchlist, false);
}
```

**Problems:**
1. **Violates Domain Separation:** Domain Managers should manage their own domain only
2. **Violates Dependency Rules:** Domain Managers depending on other Domain Managers creates tight coupling
3. **Violates Architecture Principle:** According to Level 1 rules, "When routers need user watchlist or provider configuration, they should receive these as input parameters (data/configuration objects, not manager instances)"
4. **Mixing Concerns:** `TitlesManager` is managing user watchlist operations, which is `UserManager`'s responsibility
5. **Hard to Test:** Requires `UserManager` to be available when testing `TitlesManager`
6. **Circular Dependency Risk:** Creates potential for circular dependencies between domain managers

**Solution:**
Remove `UserManager` dependency from `TitlesManager` and have routers coordinate between managers:

1. **For Getting Watchlist Data:**
   - Routers should call `UserManager.getUserByUsername()` to get user data
   - Routers should pass watchlist array as a parameter to `TitlesManager` methods
   - `TitlesManager.getTitles()` should accept `watchlist` as a parameter instead of `user`
   - `TitlesManager.getTitleDetails()` should accept `watchlist` as a parameter instead of `user`

2. **For Updating Watchlist:**
   - Routers should call `UserManager.updateUserWatchlist()` directly
   - Remove `TitlesManager.updateWatchlist()` and `updateWatchlistBulk()` methods
   - Or, if watchlist update needs title validation, routers should:
     - Call `TitlesManager.findTitlesByQuery()` to validate titles exist
     - Then call `UserManager.updateUserWatchlist()` to update watchlist

**Refactored Code:**

```javascript
// TitlesManager.js - Refactored
constructor(titleRepo, providerRepo) {
  // No UserManager dependency ✓
  this._titleRepo = titleRepo;
  this._providerRepo = providerRepo;
}

async getTitles({
  watchlist = [], // Receive watchlist as data, not user object
  page = 1,
  perPage = 50,
  searchQuery = '',
  yearFilter = '',
  inWatchlist = null,
  mediaType = null,
  startsWith = '',
}) {
  // Use watchlist directly, no UserManager call
  const watchlistTitleKeys = watchlist || [];
  // ...
}

async getTitleDetails(titleKey, watchlist = []) {
  // Use watchlist directly, no UserManager call
  const userWatchlist = new Set(watchlist);
  // ...
}

// Remove updateWatchlist() and updateWatchlistBulk() methods
// These should be handled by routers calling UserManager directly
```

```javascript
// TitlesRouter.js - Refactored
async getTitles(req, res) {
  const user = req.user;
  
  // Router coordinates between managers
  const userData = await this._userManager.getUserByUsername(user.username);
  const watchlist = userData.watchlist || [];
  
  // Pass watchlist as data to TitlesManager
  const result = await this._titlesManager.getTitles({
    watchlist, // Pass as data, not user object
    page: req.query.page,
    // ...
  });
  
  return res.status(result.statusCode).json(result.response);
}

async updateWatchlist(req, res) {
  const user = req.user;
  const { titles } = req.body;
  
  // Router coordinates: validate titles first, then update watchlist
  const titleKeys = titles.map(t => t.key);
  const existingTitles = await this._titlesManager.findTitlesByQuery(
    { title_key: { $in: titleKeys } },
    { projection: { title_key: 1 } }
  );
  
  const existingKeys = new Set(existingTitles.map(t => t.title_key));
  const notFound = titleKeys.filter(key => !existingKeys.has(key));
  
  if (notFound.length > 0) {
    return res.status(404).json({ not_found: notFound });
  }
  
  // Update watchlist via UserManager
  for (const title of titles) {
    await this._userManager.updateUserWatchlist(
      user.username,
      [title.key],
      title.watchlist
    );
  }
  
  return res.status(200).json({ success: true });
}
```

**Benefits:**
- Clean separation: Each Domain Manager manages only its own domain
- No cross-domain dependencies: Domain Managers don't depend on each other
- Follows architecture: Routers coordinate between managers, managers receive data as parameters
- Testable: `TitlesManager` can be tested without `UserManager`
- Flexible: Watchlist data can come from any source (user, cache, etc.)
- Maintainable: Clear responsibility boundaries

---

### 14. IPTVProviderManager Accessing ProviderTitleRepository

**Issue:** `IPTVProviderManager` (Domain Manager) has access to `ProviderTitleRepository`, which violates the architectural principle that Domain Managers should manage only their own domain. According to `BaseDomainManager` principle: one domain = one repository per manager.

**Current State:**
- `IPTVProviderManager` is listed as having `ProviderTitleRepository` as a dependency (for domain operations)
- `IPTVProviderManager` has `getIgnoredTitles()` method that queries `ProviderTitleRepository`
- `getIgnoredTitles()` queries the `provider_titles` collection, which is the provider_titles domain
- `ProviderTitlesManager` should manage the provider_titles domain, not `IPTVProviderManager`

**Code Examples:**

```javascript
// IPTVProviderManager.js - Current violation (proposed)
constructor(providerRepo, providerTitleRepo) {
  this._providerRepo = providerRepo;
  this._providerTitleRepo = providerTitleRepo; // Domain violation: provider_titles is not IPTV Provider domain
}

async getIgnoredTitles(providerId) {
  // Query MongoDB directly for ignored titles for this provider
  // Ignored titles are in provider_titles collection with ignored: true
  const ignoredTitles = await this._providerTitleRepo.findByQuery({
    provider_id: providerId,
    ignored: true
  });
  // ...
}
```

**Problems:**
1. **Violates Domain Separation:** `IPTVProviderManager` should only manage IPTV Provider domain (configuration, CRUD, categories, priorities)
2. **Violates BaseDomainManager Principle:** One domain = one repository per manager
3. **Mixing Concerns:** `getIgnoredTitles()` queries provider titles, which is `ProviderTitlesManager`'s responsibility
4. **Unclear Ownership:** It's unclear which manager owns provider title operations
5. **Hard to Maintain:** Provider title operations scattered across multiple managers

**Solution:**
Remove `ProviderTitleRepository` from `IPTVProviderManager` and move `getIgnoredTitles()` to `ProviderTitlesManager`:

1. **Remove ProviderTitleRepository from IPTVProviderManager:**
   - `IPTVProviderManager` should only have `ProviderRepository` as dependency
   - Remove `getIgnoredTitles()` from `IPTVProviderManager`

2. **Move getIgnoredTitles() to ProviderTitlesManager:**
   - `ProviderTitlesManager` should have `getIgnoredTitles(providerId)` method
   - This method queries `ProviderTitleRepository` for ignored titles

3. **Update Routers/Orchestration:**
   - If a router needs to validate provider exists AND get ignored titles:
     - Call `IPTVProviderManager.getProvider()` to validate provider exists
     - Call `ProviderTitlesManager.getIgnoredTitles()` to get ignored titles
   - Or have `ProvidersManager` (orchestration) coordinate between the two domain managers

**Refactored Code:**

```javascript
// IPTVProviderManager.js - Refactored
constructor(providerRepo) {
  // Only ProviderRepository - one domain = one repository ✓
  this._providerRepo = providerRepo;
}

// Remove getIgnoredTitles() - this belongs to ProviderTitlesManager
```

```javascript
// ProviderTitlesManager.js - Refactored
constructor(providerTitleRepo) {
  super('ProviderTitlesManager', providerTitleRepo);
}

async getIgnoredTitles(providerId) {
  // Query provider titles for ignored titles
  const ignoredTitles = await this.repository.findByQuery({
    provider_id: providerId,
    ignored: true
  });
  
  if (!ignoredTitles || ignoredTitles.length === 0) {
    return [];
  }
  
  // Transform to array format
  return ignoredTitles.map(title => {
    const year = title.release_date ? new Date(title.release_date).getFullYear() : null;
    const titleKey = title.title_key || `${title.type}-${title.tmdb_id}`;
    
    return {
      title_key: titleKey,
      issue: title.ignored_reason || 'Unknown issue',
      name: title.title || null,
      year: year || null
    };
  });
}
```

```javascript
// ProvidersRouter.js - Refactored (if needed)
async getIgnoredTitles(req, res) {
  const { providerId } = req.params;
  
  // Validate provider exists
  const provider = await this._iptvProviderManager.getProvider(providerId);
  if (!provider) {
    return res.status(404).json({ error: 'Provider not found' });
  }
  
  // Get ignored titles from ProviderTitlesManager
  const ignoredTitles = await this._providerTitlesManager.getIgnoredTitles(providerId);
  
  return res.status(200).json(ignoredTitles);
}
```

**Benefits:**
- Clean domain separation: Each Domain Manager manages only its own domain
- Follows BaseDomainManager principle: One domain = one repository per manager
- Clear ownership: `ProviderTitlesManager` owns all provider title operations
- Maintainable: Provider title operations centralized in one manager
- Testable: Each manager can be tested independently

---

## Repository Usage Analysis

### Current ProvidersManager (to be split)

**Used Repositories:**
- `ProviderRepository` - Provider configurations (CRUD operations)
- `ProviderTitleRepository` - Provider-specific titles (for cleanup operations)
- `TitleRepository` - Main titles (for removing provider sources when provider deleted)

**WebSocket Usage:**
- Only publishes events: `broadcastEvent('provider_changed', ...)` - 5 occurrences
- Used for real-time notifications when providers are created/updated/deleted

**Conclusion:** Current `ProvidersManager` mixes domain and orchestration concerns. After split:
- `IPTVProviderManager` (Domain) will use `ProviderRepository` for CRUD operations
- `ProvidersManager` (Orchestration) will coordinate across `IPTVProviderManager`, `ProviderTitlesManager`, `TitleRepository`, and `WebSocketService`

---

### 15. StreamManager Should Not Be Standalone - Should Be in BaseFormattingManager

**Issue:** `StreamManager` is currently a standalone class, but stream URL resolution functionality is used by multiple Formatting Managers (`XtreamManager`, `StremioManager`) and routers. This functionality should be in `BaseFormattingManager` so all Formatting Managers inherit it, not as a separate class.

**Current State:**
- `StreamManager` is a standalone class extending `BaseDomainManager` (incorrect)
- `StreamManager` directly accesses `TitleRepository` and `ProviderRepository` (violates architecture)
- `StreamManager` is used by:
  - `XtreamRouter` (which uses `XtreamManager` - Formatting Manager)
  - `StremioManager` (Formatting Manager)
  - `StreamRouter` (Entry Level)
- Stream URL resolution functionality is duplicated/separated instead of being in base class

**Code Examples:**

```javascript
// StreamManager.js - Current violation
class StreamManager extends BaseDomainManager {
  constructor(titleRepo, providerRepo, providersManager = null) {
    // Wrong: extends BaseDomainManager, accesses repositories directly
    this._titleRepo = titleRepo; // Level 2 → Level 3 violation
    this._providerRepo = providerRepo; // Level 2 → Level 3 violation
  }

  async getBestSource(titleId, mediaType, seasonNumber, episodeNumber) {
    // Stream URL resolution logic
  }
}
```

**Problems:**
1. **Wrong Classification:** `StreamManager` is not a Domain Manager - it doesn't manage a domain entity
2. **Violates Architecture:** Directly accesses repositories instead of using Domain Managers
3. **Wrong Base Class:** Extends `BaseDomainManager` but has no domain
4. **Unnecessary Standalone Class:** Stream URL resolution should be in base class, not separate class
5. **Dependency Violation:** Formatting Managers depending on another Formatting Manager (`StremioManager` → `StreamManager`)

**Solution:**
Remove `StreamManager` as standalone class and move stream URL resolution to `BaseFormattingManager`:

1. **Create BaseFormattingManager:**
   - Extends `BaseManager`
   - Includes stream URL resolution methods: `getBestSource()`, `_getSources()`, `_checkUrl()`, `_checkUrlWithFetch()`, `_checkUrlWithNative()`
   - Dependencies: `TitlesManager`, `IPTVProviderManager` (Domain Managers, not Repositories)

2. **Update BaseWatchlistFormattingManager:**
   - Extends `BaseFormattingManager` (not `BaseManager` directly)
   - Adds watchlist filtering methods on top of stream functionality

3. **Update Formatting Managers:**
   - `PlaylistManager extends BaseWatchlistFormattingManager` (watchlist + stream)
   - `XtreamManager extends BaseWatchlistFormattingManager` (watchlist + stream)
   - `StremioManager extends BaseFormattingManager` (stream, no watchlist)
   - `TMDBManager extends BaseFormattingManager` (may not use stream, but inherits it)

4. **Update Routers:**
   - `StreamRouter` can use any Formatting Manager (e.g., `XtreamManager` or `StremioManager`) for stream resolution
   - Or create a minimal utility if needed, but prefer using existing Formatting Managers

**Refactored Code:**

```javascript
// managers/formatting/BaseFormattingManager.js
import { BaseManager } from '../BaseManager.js';

class BaseFormattingManager extends BaseManager {
  constructor(managerName, titlesManager, iptvProviderManager) {
    super(managerName);
    this._titlesManager = titlesManager; // Use Domain Manager, not Repository
    this._iptvProviderManager = iptvProviderManager; // Use Domain Manager, not Repository
    this._timeout = 7500; // 7.5 seconds timeout for URL checks
  }

  /**
   * Get the best source for a specific title
   * @param {string} titleId - Title ID
   * @param {string} mediaType - Media type ('movies' or 'tvshows')
   * @param {number} [seasonNumber] - Season number (TV shows only)
   * @param {number} [episodeNumber] - Episode number (TV shows only)
   * @returns {Promise<string|null>} Best valid source URL or null
   */
  async getBestSource(titleId, mediaType, seasonNumber = null, episodeNumber = null) {
    const sources = await this._getSources(titleId, mediaType, seasonNumber, episodeNumber);
    
    if (!sources || sources.length === 0) {
      return null;
    }
    
    // Check each source and return the first valid one
    for (const source of sources) {
      const sourceUrl = typeof source === 'string' ? source : source.url;
      const providerType = typeof source === 'object' ? source.providerType : null;
      if (await this._checkUrl(sourceUrl, providerType)) {
        return sourceUrl;
      }
    }
    
    return null;
  }

  /**
   * Get sources for a specific title
   * @protected
   */
  async _getSources(titleId, mediaType, seasonNumber, episodeNumber) {
    // Use TitlesManager instead of repository
    const titles = await this._titlesManager.findTitlesByQuery({
      title_id: parseInt(titleId, 10),
      type: mediaType
    });
    
    if (!titles || titles.length === 0) {
      return [];
    }
    
    const titleData = titles[0];
    const media = titleData.media || [];
    
    // Find matching media item (movies: 'main', TV: season/episode)
    let mediaItem = null;
    if (mediaType === 'movies') {
      mediaItem = media.find(m => m.name === 'main');
    } else {
      const season = parseInt(seasonNumber, 10);
      const episode = parseInt(episodeNumber, 10);
      mediaItem = media.find(m => m.season === season && m.episode === episode);
    }
    
    if (!mediaItem || !mediaItem.sources || mediaItem.sources.length === 0) {
      return [];
    }
    
    // Use IPTVProviderManager instead of repository
    const enabledProviders = await this._iptvProviderManager.getEnabledProvidersMap();
    
    // Build sources array with full URLs
    const sources = [];
    for (const sourceEntry of mediaItem.sources) {
      const providerId = sourceEntry.provider_id;
      const provider = enabledProviders.get(providerId);
      
      if (!provider) continue; // Skip disabled/deleted providers
      
      const providerUrl = sourceEntry.provider_url;
      const providerType = provider.type || null;
      
      // Construct full URL (absolute or relative with base URL)
      if (providerUrl.startsWith('http://') || providerUrl.startsWith('https://')) {
        sources.push({ url: providerUrl, providerType, provider_id: providerId });
      } else if (providerUrl.startsWith('/') && provider.streams_urls) {
        for (const baseUrl of provider.streams_urls) {
          const fullUrl = `${baseUrl.replace(/\/$/, '')}${providerUrl}`;
          sources.push({ url: fullUrl, providerType, provider_id: providerId });
        }
      } else {
        sources.push({ url: providerUrl, providerType, provider_id: providerId });
      }
    }
    
    // Sort by priority
    sources.sort((a, b) => {
      const providerA = enabledProviders.get(a.provider_id);
      const providerB = enabledProviders.get(b.provider_id);
      // Sort logic: type priority, availability, provider priority
      // ...
    });
    
    return sources;
  }

  /**
   * Check if a URL is reachable
   * @protected
   */
  async _checkUrl(url, providerType = null) {
    // Use HEAD for AGTV, GET for others
    const useHead = providerType === 'agtv';
    if (useHead) {
      return await this._checkUrlWithFetch(url, 'HEAD');
    } else {
      return await this._checkUrlWithNative(url);
    }
  }

  /**
   * Check URL using fetch (for HEAD requests)
   * @protected
   */
  async _checkUrlWithFetch(url, method) {
    // Implementation using fetch API
  }

  /**
   * Check URL using native http/https (for GET requests)
   * @protected
   */
  async _checkUrlWithNative(url, redirectDepth = 0) {
    // Implementation using native http/https modules
  }
}
```

```javascript
// managers/formatting/BaseWatchlistFormattingManager.js
import { BaseFormattingManager } from './BaseFormattingManager.js';

class BaseWatchlistFormattingManager extends BaseFormattingManager {
  constructor(managerName, titlesManager, iptvProviderManager, liveTVManager = null) {
    super(managerName, titlesManager, iptvProviderManager);
    this._liveTVManager = liveTVManager;
  }

  /**
   * Get watchlist titles using TitlesManager
   * @protected
   */
  async _getWatchlistTitles(user, mediaType) {
    if (!user || !user.watchlist || !Array.isArray(user.watchlist)) {
      return new Map();
    }
    const watchlistTitleKeys = user.watchlist.filter(key => key.startsWith(`${mediaType}-`));
    if (watchlistTitleKeys.length === 0) {
      return new Map();
    }
    const titles = await this._titlesManager.findByTitleKeys(watchlistTitleKeys);
    // Convert to Map
    const titlesMap = new Map();
    for (const title of titles) {
      if (title.title_key) {
        titlesMap.set(title.title_key, title);
      }
    }
    return titlesMap;
  }

  /**
   * Get watchlist streams (for PlaylistManager)
   * @protected
   */
  async _getWatchlistStreams(mediaType, user) {
    const titlesMap = await this._getWatchlistTitles(user, mediaType);
    // Process media array from titles
    // ...
  }
}
```

**Benefits:**
- No standalone class: Stream functionality in base class where it belongs
- All Formatting Managers inherit stream URL resolution automatically
- Follows architecture: Uses Domain Managers, not Repositories
- Clear hierarchy: BaseFormattingManager → BaseWatchlistFormattingManager
- No dependency violations: Formatting Managers don't depend on other Formatting Managers
- Maintainable: Single source of truth for stream URL resolution

---

### 16. LiveTVManager Violates BaseDomainManager Principle and Architecture

**Issue:** `LiveTVManager` is currently classified as a Domain Manager (Type A) and extends `BaseDomainManager`, but it manages multiple domains (channels, programs) and directly accesses repositories. It also queries `UserRepository` to find users with LiveTV configuration, violating the architectural principle that managers should receive data as parameters rather than querying for it.

**Current State:**
- `LiveTVManager` is classified as Domain Manager (Type A)
- `LiveTVManager` extends `BaseDomainManager` (incorrect - manages multiple domains)
- `LiveTVManager` directly accesses three repositories:
  - `UserRepository` - to find users with LiveTV configuration
  - `ChannelRepository` - to manage channels
  - `ProgramRepository` - to manage programs
- `LiveTVManager.syncAllUsers()` queries `UserRepository` directly to find users with LiveTV config

**Code Examples:**

```javascript
// LiveTVManager.js - Current violation
class LiveTVManager extends BaseDomainManager {
  constructor(userRepo, channelRepo, programRepo) {
    // Wrong: extends BaseDomainManager but manages multiple domains
    this._userRepo = userRepo; // Level 2 → Level 3 violation
    this._channelRepo = channelRepo; // Level 2 → Level 3 violation
    this._programRepo = programRepo; // Level 2 → Level 3 violation
  }

  async syncAllUsers() {
    // Violates architecture: queries UserRepository directly
    const users = await this._userRepo.findMany({
      $and: [
        { 'liveTV': { $exists: true } },
        { 'liveTV.m3u_url': { $exists: true } },
        // ...
      ]
    });
    // ...
  }
}
```

**Problems:**
1. **Violates BaseDomainManager Principle:** One domain = one repository per manager. `LiveTVManager` manages three domains (user config, channels, programs)
2. **Wrong Classification:** Not a Domain Manager - it orchestrates multiple domains
3. **Violates Architecture:** Directly accesses repositories instead of using Domain Managers
4. **Violates Data Parameter Pattern:** Queries for user data instead of receiving it as parameters
5. **Wrong Base Class:** Extends `BaseDomainManager` but has no single domain

**Solution:**
Split into Domain Managers, Processing Manager, and Formatting Manager:

1. **Create ChannelManager (Domain Manager):**
   - Extends `BaseDomainManager`
   - Uses `ChannelRepository` only
   - Manages channels domain: CRUD operations for channels

2. **Create ProgramManager (Domain Manager):**
   - Extends `BaseDomainManager`
   - Uses `ProgramRepository` only
   - Manages programs domain: CRUD operations for programs

3. **Create LiveTVProcessingManager (Type C: Processing Manager):**
   - Extends `BaseProcessingManager`
   - Dependencies: `ChannelManager`, `ProgramManager` (Domain Managers)
   - Does NOT depend on `UserManager` or `UserRepository`
   - Methods: `syncUsers(users)`, `fetchM3U()`, `fetchEPG()`, `parseM3U()`, `parseEPG()`
   - Processes M3U/EPG files: fetches from URLs, parses content, and stores via Domain Managers
   - Used by `SyncLiveTVJob`

4. **Create LiveTVFormattingManager (Type B: Formatting Manager):**
   - Extends `BaseFormattingManager`
   - Dependencies: `ChannelManager`, `ProgramManager` (Domain Managers)
   - Methods: `getM3UPlaylist()`, `getEPGPath()`
   - Formats M3U playlists with stream URLs and provides EPG file paths
   - Used by `LiveTVRouter`

5. **Update Jobs:**
   - `SyncLiveTVJob` should depend on `UserManager` and `LiveTVProcessingManager`
   - `SyncLiveTVJob` gets users with LiveTV config from `UserManager`
   - `SyncLiveTVJob` passes users to `LiveTVProcessingManager.syncUsers(users)`

**Refactored Code:**

```javascript
// managers/domain/ChannelManager.js
import { BaseDomainManager } from './BaseDomainManager.js';

class ChannelManager extends BaseDomainManager {
  constructor(channelRepository) {
    super('ChannelManager', channelRepository);
  }

  async getChannelsByUsername(username) {
    return await this.repository.findByQuery({ username });
  }

  async getChannelByUsernameAndId(username, channelId) {
    return await this.repository.findOneByQuery({ username, channel_id: channelId });
  }

  async deleteChannelsByUsernames(usernames) {
    return await this.repository.deleteManyByQuery({ username: { $in: usernames } });
  }

  async insertChannels(channels) {
    return await this.repository.insertMany(channels, { batch: true });
  }
}
```

```javascript
// managers/domain/ProgramManager.js
import { BaseDomainManager } from './BaseDomainManager.js';

class ProgramManager extends BaseDomainManager {
  constructor(programRepository) {
    super('ProgramManager', programRepository);
  }

  async getProgramsByUsername(username, options = {}) {
    const { start, stop } = options;
    const query = { username };
    if (start && stop) {
      query.start = { $lte: start };
      query.stop = { $gte: stop };
    }
    return await this.repository.findByQuery(query);
  }

  async getProgramsByChannel(username, channelId) {
    return await this.repository.findByQuery(
      { username, channel_id: channelId },
      { sort: { start: 1 } }
    );
  }

  async deleteProgramsByUsernames(usernames) {
    return await this.repository.deleteManyByQuery({ username: { $in: usernames } });
  }

  async insertPrograms(programs) {
    return await this.repository.insertMany(programs, { batch: true });
  }
}
```

```javascript
// managers/processing/LiveTVProcessingManager.js
import { BaseProcessingManager } from './BaseProcessingManager.js';

class LiveTVProcessingManager extends BaseProcessingManager {
  constructor(channelManager, programManager) {
    super('LiveTVProcessingManager');
    this._channelManager = channelManager; // Use Domain Manager, not Repository
    this._programManager = programManager; // Use Domain Manager, not Repository
    this._cacheDir = process.env.CACHE_DIR || '/app/cache';
  }

  /**
   * Sync Live TV for provided users
   * Receives users as parameter (doesn't query for them)
   * @param {Array<Object>} users - Array of user objects with liveTV configuration
   * @returns {Promise<Object>} Sync results
   */
  async syncUsers(users) {
    if (!users || users.length === 0) {
      this.logger.info('No users with Live TV configured');
      return { users_processed: 0, results: [] };
    }

    this.logger.info(`Syncing Live TV for ${users.length} user(s)...`);

    // Group users by URL to avoid duplicate downloads
    const m3uUrlMap = new Map();
    const epgUrlMap = new Map();
    
    users.forEach(user => {
      if (user.liveTV?.m3u_url) {
        if (!m3uUrlMap.has(user.liveTV.m3u_url)) {
          m3uUrlMap.set(user.liveTV.m3u_url, { users: [] });
        }
        m3uUrlMap.get(user.liveTV.m3u_url).users.push(user);
      }
      
      if (user.liveTV?.epg_url) {
        if (!epgUrlMap.has(user.liveTV.epg_url)) {
          epgUrlMap.set(user.liveTV.epg_url, { users: [] });
        }
        epgUrlMap.get(user.liveTV.epg_url).users.push(user);
      }
    });

    // Process M3U and EPG files, parse, and store via Domain Managers
    // ... rest of logic using this._channelManager and this._programManager
  }

  // Processing methods: fetchM3U, fetchEPG, parseM3U, parseEPG
  // These work with files and call Domain Managers to store data
}
```

```javascript
// managers/formatting/LiveTVFormattingManager.js
import { BaseFormattingManager } from './BaseFormattingManager.js';

class LiveTVFormattingManager extends BaseFormattingManager {
  constructor(channelManager, programManager, titlesManager, iptvProviderManager) {
    super('LiveTVFormattingManager', titlesManager, iptvProviderManager);
    this._channelManager = channelManager; // Use Domain Manager, not Repository
    this._programManager = programManager; // Use Domain Manager, not Repository
    this._cacheDir = process.env.CACHE_DIR || '/app/cache';
  }

  /**
   * Generate M3U playlist for user
   * @param {string} username - Username
   * @param {string} baseUrl - Base URL for stream endpoints
   * @returns {Promise<string>} M3U playlist content
   */
  async getM3UPlaylist(username, baseUrl) {
    // Format M3U playlist with stream URLs
    // Uses cached M3U file and formats with stream URLs
  }

  /**
   * Get path to cached EPG file
   * @param {string} username - Username
   * @returns {Promise<string|null>} Path to EPG file or null if not found
   */
  async getEPGPath(username) {
    // Returns path to cached EPG file
  }
}
```

```javascript
// jobs/SyncLiveTVJob.js
class SyncLiveTVJob extends BaseJob {
  constructor(jobContext, userManager, liveTVProcessingManager) {
    super(jobContext);
    this._userManager = userManager; // Get users from UserManager
    this._liveTVProcessingManager = liveTVProcessingManager;
  }

  async execute() {
    // Get users with LiveTV config from UserManager
    const users = await this._userManager.getUsersWithLiveTVConfig();
    
    // Pass users to LiveTVProcessingManager (doesn't query for them)
    const result = await this._liveTVProcessingManager.syncUsers(users);
    return result;
  }
}
```

**Benefits:**
- Follows BaseDomainManager principle: One domain = one repository per manager
- Correct classification: Processing Manager for jobs, Formatting Manager for routers
- Follows architecture: Uses Domain Managers, not Repositories
- Follows data parameter pattern: Receives user data as parameters
- Clear separation: ChannelManager and ProgramManager manage domains, LiveTVProcessingManager processes files, LiveTVFormattingManager formats output
- Maintainable: Single responsibility for each manager
- Proper type classification: Processing Manager (Type C) for jobs, Formatting Manager (Type B) for routers

---

## Manager Type Classifications

### Domain Managers (Type A)
- `UserManager`
- `SettingsManager`
- `StatsManager`
- `TitlesManager`
- `ChannelManager` (to be created)
- `ProgramManager` (to be created)
- `IPTVProviderManager` (to be created from current `ProvidersManager`)
- `ProviderTitlesManager` (to be created)
- `JobHistoryManager` (to be created)

### Formatting Managers (Type B)
- `PlaylistManager` (extends `BaseWatchlistFormattingManager`)
- `XtreamManager` (extends `BaseWatchlistFormattingManager`)
- `StremioManager` (extends `BaseFormattingManager`)
- `TMDBManager` (extends `BaseFormattingManager`)

**Base Classes:**
- `BaseFormattingManager` (extends `BaseManager`) - Base for all Formatting Managers, includes stream URL resolution
- `BaseWatchlistFormattingManager` (extends `BaseFormattingManager`) - Adds watchlist filtering on top of stream functionality

### Processing Managers (Type C)
- `AGTVProcessingManager` (currently `AGTVHandler`)
- `XtreamProcessingManager` (currently `XtreamHandler`)
- `TMDBProcessingManager` (currently `TMDBHandler`)
- `LiveTVProcessingManager` (to be created from current `LiveTVManager` - processing methods only)

### Orchestration Managers (Type D)
- `JobsManager`
- `ProvidersManager` (to be refactored from current `ProvidersManager` - orchestration only)

**Note:** `LiveTVManager` has been split into:
- `LiveTVProcessingManager` (Type C: Processing Manager) - for M3U/EPG file processing in jobs
- `LiveTVFormattingManager` (Type B: Formatting Manager) - for M3U playlist formatting in routers

---

## Implementation Plan

### Phase 1: Remove Circular Dependencies
**Covers Issue #1**

**Note:** After Phase 7 (split ProvidersManager), references to `ProvidersManager` for domain operations should use `IPTVProviderManager` instead.

1. Remove `TitlesManager` dependency on `ProvidersManager`
2. Remove `setProvidersManager()` from `TitlesManager`
3. Update `TitlesManager` methods to accept enabled provider IDs as parameters (instead of accessing `ProvidersManager` or `ProviderRepository` directly)
4. Update routers that call `TitlesManager` to:
   - Get enabled provider IDs from `ProvidersManager` (Level 2 → Level 2 is allowed, will be `IPTVProviderManager` after split)
   - Pass enabled provider IDs as parameters to `TitlesManager` methods
5. **Note:** `StreamManager` will be removed - stream functionality will be in `BaseFormattingManager` (see Issue #15)
9. Remove `_titlesManager` from `ProvidersManager` constructor (dead dependency - will be removed when splitting)
10. Update `index.js` to remove lazy injection code

### Phase 2: Remove Dead Dependencies and Fix Formatting Manager Dependencies
**Covers Issues #2 and #4**

1. Remove `_userManager` from `StremioManager` constructor (dead dependency - Issue #2 and architectural violation - Issue #4)
2. Ensure all formatting managers receive user objects as parameters, not UserManager instances (Issue #4)
3. Update `index.js` initialization

### Phase 3: Create ProviderTitlesManager
**Covers Issue #14 (partially - getIgnoredTitles will be moved here)**

1. Create `ProviderTitlesManager` class
2. Move provider title operations from `ProvidersManager`:
   - `saveProviderTitles()`, `getProviderTitles()`, `resetLastUpdated()`, `deleteByProvider()`
   - `getIgnoredTitles()` (moved from `IPTVProviderManager` - see Issue #14)
3. Update `ProvidersManager` to use `ProviderTitlesManager`
4. Update all references

### Phase 4: Rename Handlers to Processing Managers
1. Rename `BaseHandler` → `BaseProcessingManager`
2. Rename `BaseIPTVHandler` → `BaseIPTVProcessingManager`
3. Rename `AGTVHandler` → `AGTVProcessingManager`
4. Rename `XtreamHandler` → `XtreamProcessingManager`
5. Rename `TMDBHandler` → `TMDBProcessingManager`
6. Update all imports and references
7. Update `BaseJob` handler registry

### Phase 5: Consolidate Enabled Provider Filtering
**Note:** After Phase 7 (split ProvidersManager), these methods will be in `IPTVProviderManager`.

1. Add `getEnabledProviderIds()`, `getEnabledProviders()`, and `getEnabledProvidersMap()` methods to `ProvidersManager` (will move to `IPTVProviderManager` after split)
2. Remove `TitlesManager._getEnabledProviders()` method
3. Update `TitlesManager` methods to accept `enabledProviderIds` as parameter
4. **Note:** Stream functionality will be in `BaseFormattingManager` (see Issue #15) - will use `IPTVProviderManager.getEnabledProvidersMap()` directly
6. Update `BaseJob._createHandlers()` to use `ProvidersManager.getEnabledProviders()` (will be `IPTVProviderManager` after split)
7. Update `SyncIPTVProviderTitlesJob.execute()` to use `ProvidersManager.getEnabledProviders({ excludeDeleted: true })` (will be `IPTVProviderManager` after split)
8. Update `SyncProviderDetailsJob.execute()` to use `ProvidersManager.getEnabledProviders({ excludeDeleted: true })` (will be `IPTVProviderManager` after split)
9. Update `ProviderTitlesMonitorJob.execute()` to use `ProvidersManager.getEnabledProviders({ excludeDeleted: true })` (will be `IPTVProviderManager` after split)
10. Update all routers that call `TitlesManager` or Formatting Managers to get enabled providers from `ProvidersManager` (will be `IPTVProviderManager` after split) and pass as parameters

### Phase 6: Fix Formatting Managers Architecture and OOP Violations
1. Add `findByTitleKeys(keys)` method to `TitlesManager` to expose repository functionality through Domain Manager
2. **Create `BaseFormattingManager` base class:**
   - Extends `BaseManager`
   - Dependencies: `TitlesManager`, `IPTVProviderManager` (Domain Managers)
   - Includes stream URL resolution methods: `getBestSource()`, `_getSources()`, `_checkUrl()`, `_checkUrlWithFetch()`, `_checkUrlWithNative()`
   - Move stream functionality from `StreamManager` (see Issue #15)
3. **Create `BaseWatchlistFormattingManager` base class:**
   - Extends `BaseFormattingManager` (not `BaseManager` directly)
   - Dependencies: `TitlesManager`, `IPTVProviderManager`, `ChannelManager`, `ProgramManager` (Domain Managers)
   - Includes watchlist filtering methods: `_getWatchlistTitles()`, `_getWatchlistStreams()`
   - Uses `TitlesManager.findByTitleKeys()` instead of direct `TitleRepository` access
   - Uses `ChannelManager` and `ProgramManager` for LiveTV channel/program data when needed
4. Refactor `PlaylistManager` to extend `BaseWatchlistFormattingManager` (only M3U8 formatting logic remains)
5. Refactor `XtreamManager` to extend `BaseWatchlistFormattingManager` (only Xtream Code API formatting logic remains)
6. Refactor `StremioManager` to extend `BaseFormattingManager` (no watchlist filtering, inherits stream functionality)
7. Fix `StremioManager` OOP violation: Replace `_titlesManager._titleRepo.findOneByQuery()` with `_titlesManager.findTitleByQuery()`
8. Update `TMDBManager` to extend `BaseFormattingManager` (may not use stream, but inherits it)
9. Update all formatting managers to use `TitlesManager` methods exclusively (no direct repository access)

### Phase 7: Split ProvidersManager into Domain and Orchestration
**Covers Issue #8**

1. Create `IPTVProviderManager` class (Type A: Domain Manager)
2. Move domain operations from `ProvidersManager` to `IPTVProviderManager`:
   - `createProvider()`, `updateProvider()`, `deleteProvider()`, `getProvider()`, `getProviders()`
   - `getCategories()`, `updateEnabledCategories()`
   - `getProviderPriorities()`, `updateProviderPriorities()`
   - `updateProviderDetails()`
   - `getEnabledProviderIds()`, `getEnabledProviders()`, `getEnabledProvidersMap()`
   - **Note:** `getIgnoredTitles()` should be moved to `ProviderTitlesManager` (see Issue #14)
3. **Remove ProviderTitleRepository from IPTVProviderManager:**
   - `IPTVProviderManager` should only have `ProviderRepository` as dependency
   - Follows BaseDomainManager principle: one domain = one repository per manager
   - Do NOT add `ProviderTitleRepository` to `IPTVProviderManager` constructor
4. Update `ProvidersManager` to be Type D: Orchestration Manager:
   - Keep orchestration operations: `_triggerJobAsync()`, `_reloadProviderConfigs()`, WebSocket broadcasting, `_removeProviderFromTitles()`
   - Add dependency on `IPTVProviderManager`
   - Delegate domain operations to `IPTVProviderManager`
   - Add orchestration layer (jobs, WebSocket, cleanup) on top of domain operations
5. Update `ProvidersManager` constructor to accept `IPTVProviderManager` instead of managing repositories directly
6. Update all references to `ProvidersManager` domain methods to use `IPTVProviderManager` where appropriate
7. Update routers to use `IPTVProviderManager` for simple domain operations, `ProvidersManager` for operations requiring orchestration
8. Update routers that need `getIgnoredTitles()` to call `ProviderTitlesManager.getIgnoredTitles()` instead of `IPTVProviderManager.getIgnoredTitles()`
9. Update `index.js` initialization to create both managers
10. Update all imports and references throughout the codebase

### Phase 8: Remove TMDBManager Wrapper Functions and Reclassify as Formatting Manager
**Covers Issue #9**

1. Remove wrapper functions from `TMDBManager`:
   - Remove `getApiKey()`, `setApiKey()`, `deleteApiKey()`
   - Keep `verifyApiKey()` (calls `TMDBProvider` and formats response - formatting logic)
   - Add `updateProviderApiKey(apiKey)` method to update provider when API key is set
2. Reclassify `TMDBManager` as Formatting Manager (Type B):
   - It only formats provider responses for API endpoints
   - Move from Domain Managers to Formatting Managers in documentation
3. Remove `SettingsManager` dependency from `TMDBManager` constructor
4. Update `TMDBRouter` to depend on `SettingsManager` directly:
   - Add `SettingsManager` as constructor dependency
   - Update GET `/api-key` to call `SettingsManager.getSetting('tmdb_token')` directly
   - Update PUT `/api-key` to call `SettingsManager.setSetting('tmdb_token', apiKey)` + `TMDBManager.updateProviderApiKey(apiKey)`
   - Update DELETE `/api-key` to call `SettingsManager.deleteSetting('tmdb_token')` directly
   - Keep POST `/verify` using `TMDBManager.verifyApiKey()` (formats provider response)
5. Update `index.js` to pass `SettingsManager` to `TMDBRouter` constructor

### Phase 9: Remove HTTP Status Codes from Managers
**Covers Issue #10**

**General Approach:**
1. Create custom error classes: `NotFoundError`, `ValidationError`, `ConflictError`, `ForbiddenError`, `JobNotFoundError`, `JobAlreadyRunningError`, `JobSchedulerUnavailableError`
2. Update routers to have helper methods for mapping errors to HTTP status codes
3. Refactor each manager to return data directly or throw errors (no status codes)
4. Update routers to map manager results/errors to HTTP status codes

**By Manager:**

1. **SettingsManager:**
   - Refactor `getSetting()`, `setSetting()`, `deleteSetting()` to return data directly or throw errors
   - Update `SettingsRouter` to map results/errors to status codes

2. **UserManager:**
   - Refactor all methods to return data/null or throw custom errors (`NotFoundError`, `ValidationError`, `ConflictError`, `ForbiddenError`)
   - Update `UsersRouter` and `ProfileRouter` to map errors to status codes (404, 400, 409, 403, 500)

3. **StatsManager:**
   - Refactor `getStats()` to return stats object or throw error
   - Update `StatsRouter` to map to status codes

4. **JobsManager:**
   - Refactor `getAllJobs()` to return `{ jobs: [] }` or throw error
   - Refactor `triggerJob()` to return `{ success: true, message: string }` or throw custom errors (`JobNotFoundError`, `JobAlreadyRunningError`, `JobSchedulerUnavailableError`)
   - Update `JobsRouter` to map errors to status codes (404, 409, 503, 500)

5. **TMDBManager:**
   - After Phase 8, only `verifyApiKey()` remains
   - Refactor `verifyApiKey()` to return `{ valid: boolean, message: string }` or throw error
   - Update `TMDBRouter` to map to status codes

6. **TitlesManager:**
   - Refactor `getTitles()`, `getTitle()`, `updateTitleWatchlist()`, etc. to return data/null or throw errors
   - Update `TitlesRouter` to map errors to status codes (404, 400, 500)

7. **ProvidersManager (will be IPTVProviderManager after Phase 7):**
   - Refactor all methods to return data/null or throw custom errors
   - Update `ProvidersRouter` to map errors to status codes (404, 400, 409, 500)

**Migration Strategy:**
- Can temporarily support both patterns during migration for backward compatibility
- Update one manager/router pair at a time
- Test thoroughly after each refactoring

### Phase 10: Remove Business Logic from Repositories
**Covers Issue #11**

1. **Create BaseDomainManager:**
   - Create `web-api/src/managers/domain/BaseDomainManager.js`
   - Extends `BaseManager`
   - Holds repository reference (one domain = one repository per manager)
   - Implements `bulkUpsert()` method for domain managers
   - Implements helper methods: `_checkExistenceForUpsert()`, `_separateInsertsAndUpdatesForUpsert()`, `_executeBulkUpsert()`

2. **Update Domain Managers to Extend BaseDomainManager:**
   - Update `TitlesManager` to extend `BaseDomainManager` instead of `BaseManager`
   - Update `UserManager` to extend `BaseDomainManager`
   - Update `SettingsManager` to extend `BaseDomainManager`
   - Update `StatsManager` to extend `BaseDomainManager`
   - Update `ProviderTitlesManager` (when created) to extend `BaseDomainManager`
   - Update `IPTVProviderManager` (when created) to extend `BaseDomainManager`
   - **Note:** `StreamManager` will be removed - stream functionality will be in `BaseFormattingManager` (see Issue #15)
   - **Note:** `LiveTVManager` will be split into `LiveTVProcessingManager` (Type C) and `LiveTVFormattingManager` (Type B) (see Issue #16)

3. **Remove Auto-timestamping from BaseRepository:**
   - Remove automatic timestamp addition from `insertOne()`, `insertMany()`, `updateOne()`, `updateMany()`
   - Managers should add timestamps before calling repository methods

4. **Remove Duplicate Key Handling from BaseRepository:**
   - Remove duplicate key error handling from `insertOne()`, `insertMany()`
   - Let errors propagate to managers, managers decide how to handle

5. **Remove Bulk Save Logic from BaseRepository:**
   - Remove `bulkSave()` method and all related methods:
     - `buildExistenceQueries()`
     - `buildExistenceQuery()`
     - `getDocumentKey()`
     - `separateInsertsAndUpdates()`
     - `buildKeyForCheck()`
     - `buildUpdateOperation()`
     - `executeBulkSave()`
   - Keep `checkExistenceBatch()` if it's useful for managers (or move to BaseDomainManager)

6. **Update Managers to Use bulkUpsert from BaseDomainManager:**
   - Update `TitlesManager.saveMainTitles()` to use `this.bulkUpsert()`
   - Update `ProviderTitlesManager.saveProviderTitles()` to use `this.bulkUpsert()`
   - Update `BaseIPTVHandler` (Processing Manager) - if it needs bulk upsert, it should use a domain manager or implement its own
   - Update `TMDBHandler` to use `TitlesManager.saveMainTitles()` instead of calling repository directly

7. **Remove Business Query Building from Repositories:**
   - Remove `ProviderTitleRepository.getProviderTitles()` - move query building to `ProviderTitlesManager`
   - Managers build queries and pass to repository's `findByQuery()`

8. **Remove Business Operations from Repositories:**
   - Remove `ProviderTitleRepository.resetLastUpdated()` - managers call `updateManyByQuery()` directly
   - Remove `ProviderTitleRepository.deleteByProvider()` - managers call `deleteManyByQuery()` directly
   - Remove `ProviderTitleRepository.saveProviderTitles()` - use `ProviderTitlesManager.saveProviderTitles()` instead

9. **Move Data Transformation to Managers:**
   - Remove `SettingsRepository.getAllAsObject()` - managers transform data
   - Remove `StatsRepository.getAsObject()` - managers transform data
   - Update `SettingsManager` and `StatsManager` to handle transformation

10. **Update All Domain Managers to Add Timestamps:**
    - Update all domain managers to add `createdAt` and `lastUpdated` before calling repository methods
    - Ensure consistency across all managers

**Migration Strategy:**
- Update one repository/manager pair at a time
- Test thoroughly after each refactoring
- Can temporarily keep old methods in repositories during migration for backward compatibility

### Phase 11: Create JobHistoryManager and Remove Direct Repository Access from Jobs
**Covers Issue #12**

1. **Create JobHistoryManager:**
   - Create `web-api/src/managers/domain/JobHistoryManager.js`
   - Extends `BaseDomainManager`
   - Holds `JobHistoryRepository` reference
   - Implements methods:
     - `getLastExecution(jobName, options)` - Get last execution time with fallback options
     - `updateStatus(jobName, status, providerId, result)` - Update job status
     - `getJobHistory(jobName)` - Get job history document
     - `resetInProgress()` - Reset in-progress jobs (for startup)
     - `isJobRunning(jobName)` - Check if job is running

2. **Update BaseJob:**
   - Remove `JobHistoryRepository` from constructor
   - Add `JobHistoryManager` as dependency
   - Update `getLastExecution()` to use `jobHistoryManager.getLastExecution()`
   - Update `setJobStatus()` to use `jobHistoryManager.updateStatus()`

3. **Update All Job Classes:**
   - Update `SyncIPTVProviderTitlesJob` constructor to use `JobHistoryManager`
   - Update `SyncProviderDetailsJob` constructor to use `JobHistoryManager`
   - Update `ProviderTitlesMonitorJob` constructor to use `JobHistoryManager`
   - Update `SyncLiveTVJob` constructor (if it uses job history)

4. **Update JobsManager:**
   - Remove `JobHistoryRepository` from constructor
   - Add `JobHistoryManager` as dependency
   - Update `_getJobHistory()` to use `jobHistoryManager.getJobHistory()`
   - Update `isJobRunning()` to use `jobHistoryManager.isJobRunning()`

5. **Update index.js:**
   - Create `JobHistoryManager` instance
   - Pass `JobHistoryManager` to `BaseJob` constructors instead of `JobHistoryRepository`
   - Pass `JobHistoryManager` to `JobsManager` constructor instead of `JobHistoryRepository`

**Migration Strategy:**
- Update one job at a time
- Test thoroughly after each refactoring
- Ensure job history operations continue to work correctly

### Phase 12: Remove UserManager Dependency from TitlesManager
**Covers Issue #13**

1. **Update TitlesManager:**
   - Remove `UserManager` from constructor
   - Update `getTitles()` to accept `watchlist` array parameter instead of `user` object
   - Update `getTitleDetails()` to accept `watchlist` array parameter instead of `user` object
   - Remove `updateWatchlist()` and `updateWatchlistBulk()` methods (routers will call `UserManager` directly)

2. **Update TitlesRouter:**
   - Add `UserManager` as constructor dependency
   - Update `getTitles()` route handler to:
     - Call `UserManager.getUserByUsername()` to get user data
     - Extract watchlist array from user data
     - Pass watchlist array to `TitlesManager.getTitles()`
   - Update `getTitleDetails()` route handler to:
     - Call `UserManager.getUserByUsername()` to get user data
     - Extract watchlist array from user data
     - Pass watchlist array to `TitlesManager.getTitleDetails()`
   - Update `updateWatchlist()` route handler to:
     - Call `TitlesManager.findTitlesByQuery()` to validate titles exist
     - Call `UserManager.updateUserWatchlist()` directly to update watchlist
     - Handle validation errors and return appropriate responses

3. **Update index.js:**
   - Remove `UserManager` from `TitlesManager` constructor
   - Add `UserManager` to `TitlesRouter` constructor

**Migration Strategy:**
- Update `TitlesManager` first, then update router
- Test thoroughly to ensure watchlist operations continue to work
- Ensure backward compatibility during migration if needed

### Phase 13: Remove StreamManager and Move Stream Functionality to BaseFormattingManager
**Covers Issue #15**

1. **Create BaseFormattingManager:**
   - Create `managers/formatting/BaseFormattingManager.js`
   - Extends `BaseManager`
   - Dependencies: `TitlesManager`, `IPTVProviderManager` (Domain Managers)
   - Move all stream URL resolution methods from `StreamManager`:
     - `getBestSource()`, `_getSources()`, `_checkUrl()`, `_checkUrlWithFetch()`, `_checkUrlWithNative()`
   - Update methods to use `TitlesManager` and `IPTVProviderManager` instead of repositories

2. **Update BaseWatchlistFormattingManager:**
   - Change to extend `BaseFormattingManager` (not `BaseManager` directly)
   - Update constructor to accept `TitlesManager` and `IPTVProviderManager` and pass to super
   - Keep watchlist filtering methods: `_getWatchlistTitles()`, `_getWatchlistStreams()`

3. **Update Formatting Managers:**
   - `PlaylistManager`: Update to extend `BaseWatchlistFormattingManager` (already has watchlist, now gets stream functionality)
   - `XtreamManager`: Update to extend `BaseWatchlistFormattingManager` (already has watchlist, now gets stream functionality)
   - `StremioManager`: Update to extend `BaseFormattingManager` (gets stream functionality, no watchlist)
   - `TMDBManager`: Update to extend `BaseFormattingManager` (may not use stream, but inherits it)

4. **Remove StreamManager:**
   - Delete `managers/stream.js` file
   - Remove `StreamManager` from all dependency maps
   - Remove `StreamManager` from `index.js` initialization

5. **Update Routers:**
   - `StreamRouter`: Update to use a Formatting Manager (e.g., `XtreamManager` or `StremioManager`) for stream resolution, or create minimal utility if needed
   - `XtreamRouter`: Remove `StreamManager` dependency, use `XtreamManager.getBestSource()` directly
   - Update all references to `StreamManager` in routers

6. **Update index.js:**
   - Remove `StreamManager` import and initialization
   - Update `StreamRouter` constructor to use a Formatting Manager
   - Update `XtreamRouter` constructor (remove `StreamManager` parameter)
   - Update `StremioManager` constructor (remove `StreamManager` parameter, it now inherits from `BaseFormattingManager`)

**Migration Strategy:**
- Create `BaseFormattingManager` first with stream functionality
- Update `BaseWatchlistFormattingManager` to extend it
- Update all Formatting Managers to extend appropriate base class
- Remove `StreamManager` and update all references
- Test thoroughly: Xtream Code API, Stremio addon, and direct stream endpoints

### Phase 14: Split LiveTVManager into Processing and Formatting Managers
**Covers Issue #16**

1. **Create ChannelManager (Domain Manager):**
   - Create `managers/domain/ChannelManager.js`
   - Extends `BaseDomainManager`
   - Uses `ChannelRepository` only
   - Methods: `getChannelsByUsername()`, `getChannelByUsernameAndId()`, `deleteChannelsByUsernames()`, `insertChannels()`

2. **Create ProgramManager (Domain Manager):**
   - Create `managers/domain/ProgramManager.js`
   - Extends `BaseDomainManager`
   - Uses `ProgramRepository` only
   - Methods: `getProgramsByUsername()`, `getProgramsByChannel()`, `deleteProgramsByUsernames()`, `insertPrograms()`

3. **Create LiveTVProcessingManager (Processing Manager):**
   - Create `managers/processing/LiveTVProcessingManager.js`
   - Extends `BaseProcessingManager`
   - Dependencies: `ChannelManager`, `ProgramManager` (Domain Managers)
   - Methods: `syncUsers(users)`, `fetchM3U()`, `fetchEPG()`, `parseM3U()`, `parseEPG()`
   - Move processing methods from current `LiveTVManager`: file fetching, parsing, and storing via Domain Managers

4. **Create LiveTVFormattingManager (Formatting Manager):**
   - Create `managers/formatting/LiveTVFormattingManager.js`
   - Extends `BaseFormattingManager`
   - Dependencies: `ChannelManager`, `ProgramManager`, `TitlesManager`, `IPTVProviderManager` (Domain Managers)
   - Methods: `getM3UPlaylist()`, `getEPGPath()`
   - Move formatting methods from current `LiveTVManager`: M3U playlist formatting and EPG path retrieval

5. **Update UserManager:**
   - Add method `getUsersWithLiveTVConfig()` to get users with LiveTV configuration
   - This method queries `UserRepository` for users with `liveTV.m3u_url` configured

6. **Update SyncLiveTVJob:**
   - Remove `LiveTVManager` dependency
   - Add `UserManager` and `LiveTVProcessingManager` dependencies
   - Update `execute()` to get users from `UserManager.getUsersWithLiveTVConfig()`
   - Pass users to `LiveTVProcessingManager.syncUsers(users)`

7. **Update LiveTVRouter:**
   - Remove `LiveTVManager` dependency
   - Add `ChannelManager`, `ProgramManager`, and `LiveTVFormattingManager` dependencies
   - Update route handlers to use:
     - `ChannelManager` and `ProgramManager` for channel/program data access
     - `LiveTVFormattingManager` for M3U playlist formatting and EPG path retrieval

8. **Update Formatting Managers:**
   - `PlaylistManager`, `XtreamManager`, `StremioManager`: Update to use `ChannelManager` and `ProgramManager` instead of `LiveTVManager`
   - Remove `LiveTVManager` dependencies from all Formatting Managers

9. **Update XtreamRouter:**
   - Remove `LiveTVManager` dependency
   - Add `ChannelManager` and `ProgramManager` dependencies
   - Update to use Domain Managers for LiveTV channel/program data

10. **Update index.js:**
    - Create `ChannelManager` and `ProgramManager` instances
    - Create `LiveTVProcessingManager` instance (for jobs)
    - Create `LiveTVFormattingManager` instance (for routers)
    - Remove `LiveTVManager` import and initialization
    - Update `SyncLiveTVJob` constructor to use `LiveTVProcessingManager`
    - Update `LiveTVRouter` constructor to use `ChannelManager`, `ProgramManager`, and `LiveTVFormattingManager`
    - Update `XtreamRouter` constructor (remove `LiveTVManager`, add `ChannelManager` and `ProgramManager`)
    - Update Formatting Managers constructors (remove `LiveTVManager`, add `ChannelManager` and `ProgramManager`)

**Migration Strategy:**
- Create Domain Managers first (`ChannelManager`, `ProgramManager`)
- Create Processing Manager (`LiveTVProcessingManager`) for jobs
- Create Formatting Manager (`LiveTVFormattingManager`) for routers
- Update `UserManager` to add `getUsersWithLiveTVConfig()` method
- Update all consumers to use appropriate managers
- Remove `LiveTVManager` and update all references
- Test thoroughly: M3U/EPG parsing, channel/program storage, LiveTV sync job, M3U playlist generation, EPG retrieval

---

## Visual Dependency Flow

```
┌─────────────────────────────────────────────────────────┐
│ Level 1: Entry Level                                     │
│ ┌──────────┐  ┌──────┐                                  │
│ │ Routers  │  │ Jobs │                                  │
│ └────┬─────┘  └──┬───┘                                  │
│      │           │                                       │
│      └─────┬─────┘                                       │
│            ↓                                             │
│      Managers (Level 2) ONLY                            │
└──────────────────────────────────────────────────────────┘
             │
             ↓
┌─────────────────────────────────────────────────────────┐
│ Level 2: Business Logic (Managers)                       │
│                                                          │
│ ┌────────────────────────────────────────────────────┐  │
│ │ Type A: Domain Managers                            │  │
│ │ ↓                                                   │  │
│ │ • Repositories (Level 3) ✓                         │  │
│ │ • Services (Level 4) ✓                             │  │
│ │ • Other Domain Managers (with caution) ✓            │  │
│ └────────────────────────────────────────────────────┘  │
│                                                          │
│ ┌────────────────────────────────────────────────────┐  │
│ │ Type B: Formatting Managers                       │  │
│ │ ↓                                                   │  │
│ │ • Domain Managers ✓                                │  │
│ │ • Repositories (Level 3) ✓                         │  │
│ │ • Providers (Level 3) ✓                            │  │
│ └────────────────────────────────────────────────────┘  │
│                                                          │
│ ┌────────────────────────────────────────────────────┐  │
│ │ Type C: Processing Managers                       │  │
│ │ ↓                                                   │  │
│ │ • Providers (Level 3) ✓                            │  │
│ │ • Domain Managers ✓                                │  │
│ │ • Repositories (Level 3) ✗ (ANTI-PATTERN)          │  │
│ └────────────────────────────────────────────────────┘  │
│                                                          │
│ ┌────────────────────────────────────────────────────┐  │
│ │ Type D: Orchestration Managers                    │  │
│ │ ↓                                                   │  │
│ │ • Domain Managers ✓                                │  │
│ │ • Services (Level 4) ✓                             │  │
│ │ • Repositories (Level 3) ✓ (for cross-domain)     │  │
│ └────────────────────────────────────────────────────┘  │
└────────────┬─────────────────────────────────────────────┘
             │
             ↓
┌─────────────────────────────────────────────────────────┐
│ Level 3: Data Access Layer                              │
│ ┌──────────────┐  ┌──────────┐                          │
│ │ Repositories │  │Providers │                          │
│ └──────────────┘  └──────────┘                          │
│ ↓                ↓                                      │
│ • MongoDB Client • BaseProvider                         │
│ • BaseRepository • Utilities                            │
│ • Utilities                                              │
└─────────────────────────────────────────────────────────┘
             ↑
             │
┌────────────┼─────────────────────────────────────────────┐
│ Level 4: Infrastructure                                  │
│ ┌──────────────┐  ┌──────────────┐                      │
│ │ Services     │  │ Middleware   │                      │
│ │ (WebSocket,  │  │ (Auth)       │                      │
│ │  Scheduler)  │  │              │                      │
│ └──────────────┘  └──────┬───────┘                      │
│                          │                                │
│                          ↓                                │
│                   • UserManager (only for Middleware)    │
└──────────────────────────────────────────────────────────┘
```

---

## Detailed Dependency Map

### Level 1: Entry Level

#### Routers

**AuthRouter**
- Dependencies: `UserManager` (Domain Manager), `Middleware`

**UsersRouter**
- Dependencies: `UserManager` (Domain Manager), `Middleware`

**ProfileRouter**
- Dependencies: `UserManager` (Domain Manager), `Middleware`, `JobsManager` (Orchestration Manager)

**SettingsRouter**
- Dependencies: `SettingsManager` (Domain Manager), `Middleware`

**StatsRouter**
- Dependencies: `StatsManager` (Domain Manager), `Middleware`

**TitlesRouter**
- Dependencies: `TitlesManager` (Domain Manager), `UserManager` (Domain Manager, for watchlist operations), `Middleware`

**ProvidersRouter**
- Dependencies: `ProvidersManager` (Orchestration Manager), `IPTVProviderManager` (Domain Manager), `Middleware`
- Note: Depends on both managers. `ProvidersManager` handles orchestration operations (job triggering, WebSocket notifications). `IPTVProviderManager` handles direct domain operations when needed. Router coordinates between them based on the operation.

**StreamRouter**
- Dependencies: `XtreamManager` (Formatting Manager), `StremioManager` (Formatting Manager), `Middleware`
- Note: Depends on both Formatting Managers. Router determines which manager to use based on request context (user preferences, API endpoint, etc.). Uses Formatting Manager's `getBestSource()` method for stream URL resolution.

**PlaylistRouter**
- Dependencies: `PlaylistManager` (Formatting Manager), `Middleware`

**XtreamRouter**
- Dependencies: `XtreamManager` (Formatting Manager), `Middleware`, `ChannelManager` (Domain Manager), `ProgramManager` (Domain Manager)
- Note: Uses `XtreamManager.getBestSource()` directly for stream URL resolution. Uses `ChannelManager` and `ProgramManager` for LiveTV channel/program data when needed.

**StremioRouter**
- Dependencies: `StremioManager` (Formatting Manager), `Middleware`

**TMDBRouter**
- Dependencies: `SettingsManager` (Domain Manager), `TMDBManager` (Formatting Manager), `Middleware`

**JobsRouter**
- Dependencies: `JobsManager` (Orchestration Manager), `Middleware`

**LiveTVRouter**
- Dependencies: `ChannelManager` (Domain Manager), `ProgramManager` (Domain Manager), `LiveTVFormattingManager` (Formatting Manager), `Middleware`
- Note: Uses `ChannelManager` and `ProgramManager` for channel/program data access. Uses `LiveTVFormattingManager` for M3U playlist formatting and EPG path retrieval.

**HealthcheckRouter**
- Dependencies: `SettingsManager` (Domain Manager), `Middleware`

---

#### Jobs

**SyncIPTVProviderTitlesJob**
- Dependencies: `IPTVProviderManager` (Domain Manager), `ProviderTitlesManager` (Domain Manager), `TitlesManager` (Domain Manager), `TMDBProcessingManager` (Processing Manager), `JobHistoryManager` (Domain Manager)

**SyncProviderDetailsJob**
- Dependencies: `IPTVProviderManager` (Domain Manager), `ProviderTitlesManager` (Domain Manager), `JobHistoryManager` (Domain Manager)

**ProviderTitlesMonitorJob**
- Dependencies: `IPTVProviderManager` (Domain Manager), `ProviderTitlesManager` (Domain Manager), `TitlesManager` (Domain Manager), `JobHistoryManager` (Domain Manager)

**SyncLiveTVJob**
- Dependencies: `UserManager` (Domain Manager), `LiveTVProcessingManager` (Processing Manager), `JobHistoryManager` (Domain Manager)
- Note: Gets users with LiveTV config from `UserManager` and passes them to `LiveTVProcessingManager.syncUsers(users)`. `JobHistoryManager` is always required for job execution tracking.

**Note:** Jobs should NOT have direct access to Repositories. They should use Domain Managers instead, including `JobHistoryManager` for job history tracking.

---

### Level 2: Business Logic (Managers)

#### Type A: Domain Managers

**UserManager**
- Dependencies: `UserRepository` (Level 3)
- Extends: `BaseDomainManager`

**SettingsManager**
- Dependencies: `SettingsRepository` (Level 3)
- Extends: `BaseDomainManager`

**StatsManager**
- Dependencies: `StatsRepository` (Level 3)
- Extends: `BaseDomainManager`

**TitlesManager**
- Dependencies: `TitleRepository` (Level 3)
- Extends: `BaseDomainManager`
- Note: Receives watchlist data as parameters (from routers), does not depend on `UserManager`

**ChannelManager**
- Dependencies: `ChannelRepository` (Level 3)
- Extends: `BaseDomainManager`
- Note: One domain = one repository. Manages channels domain.

**ProgramManager**
- Dependencies: `ProgramRepository` (Level 3)
- Extends: `BaseDomainManager`
- Note: One domain = one repository. Manages programs domain.

**IPTVProviderManager**
- Dependencies: `ProviderRepository` (Level 3)
- Extends: `BaseDomainManager`
- Note: One domain = one repository. Does not access `ProviderTitleRepository` (that's `ProviderTitlesManager`'s domain)

**ProviderTitlesManager**
- Dependencies: `ProviderTitleRepository` (Level 3)
- Extends: `BaseDomainManager`
- Methods: `saveProviderTitles()`, `getProviderTitles()`, `getIgnoredTitles()`, `resetLastUpdated()`, `deleteByProvider()`, etc.

**JobHistoryManager**
- Dependencies: `JobHistoryRepository` (Level 3)
- Extends: `BaseDomainManager`

---

#### Type B: Formatting Managers

**BaseFormattingManager**
- Dependencies: `TitlesManager` (Domain Manager), `IPTVProviderManager` (Domain Manager)
- Extends: `BaseManager`
- Methods: `getBestSource()`, `_getSources()`, `_checkUrl()`, `_checkUrlWithFetch()`, `_checkUrlWithNative()`
- Note: Base class for all Formatting Managers. Provides stream URL resolution functionality.

**BaseWatchlistFormattingManager**
- Dependencies: `TitlesManager` (Domain Manager), `IPTVProviderManager` (Domain Manager), `ChannelManager` (Domain Manager), `ProgramManager` (Domain Manager)
- Extends: `BaseFormattingManager`
- Methods: `_getWatchlistTitles()`, `_getWatchlistStreams()`
- Note: Adds watchlist filtering functionality on top of stream URL resolution. Uses `ChannelManager` and `ProgramManager` for LiveTV channel/program data when needed.

**PlaylistManager**
- Dependencies: `TitlesManager` (Domain Manager), `IPTVProviderManager` (Domain Manager), `ChannelManager` (Domain Manager), `ProgramManager` (Domain Manager)
- Extends: `BaseWatchlistFormattingManager` (which extends `BaseFormattingManager`)
- Note: Receives user object as parameter (not `UserManager` instance). Inherits watchlist filtering and stream URL resolution from base classes. Uses `ChannelManager` and `ProgramManager` for LiveTV channels in playlists.

**XtreamManager**
- Dependencies: `TitlesManager` (Domain Manager), `IPTVProviderManager` (Domain Manager), `ChannelManager` (Domain Manager), `ProgramManager` (Domain Manager)
- Extends: `BaseWatchlistFormattingManager` (which extends `BaseFormattingManager`)
- Note: Receives user object as parameter (not `UserManager` instance). Inherits watchlist filtering and stream URL resolution from base classes. Uses `ChannelManager` and `ProgramManager` for LiveTV channels and EPG data in Xtream Code API format.

**StremioManager**
- Dependencies: `TitlesManager` (Domain Manager), `IPTVProviderManager` (Domain Manager), `ChannelManager` (Domain Manager), `ProgramManager` (Domain Manager)
- Extends: `BaseFormattingManager`
- Note: Receives user object as parameter (not `UserManager` instance). Inherits stream URL resolution from `BaseFormattingManager`. Uses `ChannelManager` and `ProgramManager` for LiveTV channels and EPG data in Stremio addon format.

**TMDBManager**
- Dependencies: `TMDBProvider` (Level 3)
- Extends: `BaseFormattingManager`
- Note: Formats provider responses, not domain data. Inherits `TitlesManager` and `IPTVProviderManager` dependencies from `BaseFormattingManager` (may not use them). Only explicitly depends on `TMDBProvider` for formatting provider responses.

**LiveTVFormattingManager**
- Dependencies: `ChannelManager` (Domain Manager), `ProgramManager` (Domain Manager)
- Extends: `BaseFormattingManager`
- Methods: `getM3UPlaylist()`, `getEPGPath()`
- Note: Formatting Manager. Formats M3U playlists with stream URLs and provides EPG file paths for API responses. Used by `LiveTVRouter`.

---

#### Type C: Processing Managers

**AGTVProcessingManager**
- Dependencies: `AGTVProvider` (Level 3), `TitlesManager` (Domain Manager), `ProviderTitlesManager` (Domain Manager), `IPTVProviderManager` (Domain Manager)
- Extends: `BaseIPTVProcessingManager` (which extends `BaseProcessingManager`)
- Note: Should NOT depend on `ProviderTitleRepository` or `TitleRepository` directly

**XtreamProcessingManager**
- Dependencies: `XtreamProvider` (Level 3), `TitlesManager` (Domain Manager), `ProviderTitlesManager` (Domain Manager), `IPTVProviderManager` (Domain Manager)
- Extends: `BaseIPTVProcessingManager` (which extends `BaseProcessingManager`)
- Note: Should NOT depend on `ProviderTitleRepository` or `TitleRepository` directly

**TMDBProcessingManager**
- Dependencies: `TMDBProvider` (Level 3), `TitlesManager` (Domain Manager)
- Extends: `BaseProcessingManager`
- Note: Should NOT depend on `TitleRepository` directly

**LiveTVProcessingManager**
- Dependencies: `ChannelManager` (Domain Manager), `ProgramManager` (Domain Manager)
- Extends: `BaseProcessingManager`
- Methods: `syncUsers(users)`, `fetchM3U()`, `fetchEPG()`, `parseM3U()`, `parseEPG()`
- Note: Processes M3U/EPG files: fetches from URLs, parses content, and stores channels/programs via Domain Managers. Used by `SyncLiveTVJob`.

---

#### Type D: Orchestration Managers

**JobsManager**
- Dependencies: `EngineScheduler` (Service, Level 4), `JobHistoryManager` (Domain Manager)
- Extends: `BaseManager`
- Note: `JobHistoryManager` is always required for job execution tracking and history management.

**ProvidersManager**
- Dependencies: `IPTVProviderManager` (Domain Manager), `ProviderTitlesManager` (Domain Manager), `TitlesManager` (Domain Manager), `TitleRepository` (Level 3, for cross-domain cleanup), `ProviderTitleRepository` (Level 3, for cross-domain cleanup), `WebSocketService` (Service, Level 4), `triggerJob` function, `providerTypeMap` (Provider instances)
- Extends: `BaseManager`
- Note: Orchestration Manager that coordinates provider operations. Uses direct repository access (`TitleRepository`, `ProviderTitleRepository`) for cross-domain cleanup operations (`_removeProviderFromTitles()`) that need to efficiently delete provider data from multiple collections atomically. This is an exception for orchestration managers performing cross-domain cleanup that would be inefficient through multiple Domain Manager calls. Uses `TitlesManager` for normal title operations, but repositories for bulk cross-domain cleanup.

---

### Level 3: Data Access Layer

#### Repositories

**UserRepository**
- Dependencies: `MongoDB Client`, `BaseRepository`

**SettingsRepository**
- Dependencies: `MongoDB Client`, `BaseRepository`

**StatsRepository**
- Dependencies: `MongoDB Client`, `BaseRepository`

**TitleRepository**
- Dependencies: `MongoDB Client`, `BaseRepository`

**ProviderRepository**
- Dependencies: `MongoDB Client`, `BaseRepository`

**ProviderTitleRepository**
- Dependencies: `MongoDB Client`, `BaseRepository`

**ChannelRepository**
- Dependencies: `MongoDB Client`, `BaseRepository`

**ProgramRepository**
- Dependencies: `MongoDB Client`, `BaseRepository`

**JobHistoryRepository**
- Dependencies: `MongoDB Client`, `BaseRepository`

---

#### Providers

**TMDBProvider**
- Dependencies: `BaseProvider`, external API client, utilities

**XtreamProvider**
- Dependencies: `BaseIPTVProvider` (which extends `BaseProvider`), external API client, utilities

**AGTVProvider**
- Dependencies: `BaseIPTVProvider` (which extends `BaseProvider`), external API client, utilities

---

### Level 4: Infrastructure

#### Services

**WebSocketService**
- Dependencies: Other Services (if any), utilities

**EngineScheduler**
- Dependencies: Other Services (if any), utilities

---

#### Middleware

**Middleware**
- Dependencies: `UserManager` (Domain Manager, for authentication)

---

## Benefits of Aligned Architecture

1. **Clear Separation of Concerns:** Each layer has a well-defined purpose
2. **No Circular Dependencies:** Dependency flow is unidirectional
3. **Easier Testing:** Dependencies are explicit and injectable
4. **Better Maintainability:** Clear understanding of where code belongs
5. **Scalability:** Easy to add new managers following established patterns
6. **Type Safety:** Clear categorization helps with code organization

---

## Notes

- All managers extend `BaseManager` for consistency
- Formatting managers should receive user objects as parameters, not depend on UserManager
- Processing managers are created dynamically by Jobs during execution
- Infrastructure services are singleton instances used across the application
- Middleware is a utility class used by all Routers

---

## References

- Base classes: `BaseRouter`, `BaseManager`, `BaseRepository`, `BaseProvider`, `BaseProcessingManager`
- Initialization: `web-api/src/index.js`
- Dependency injection: All dependencies passed via constructor

