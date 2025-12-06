# Align Architecture of Web API [Done]

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
- `ChannelManager` - Channels domain
- `ProgramManager` - Programs domain
- `IPTVProviderManager` - IPTV Provider domain (configuration, categories, priorities, CRUD operations)
- `ProviderTitlesManager` - Provider titles domain
- `JobHistoryManager` - Job history domain
- `JobHistoryManager` - Job history domain
- `JobHistoryManager` - Job history domain
- `JobHistoryManager` - Job history domain
- `JobHistoryManager` - Job history domain
- `JobHistoryManager` - Job history domain
- `JobHistoryManager` - Job history domain
- `JobHistoryManager` - Job history domain
- `JobHistoryManager` - Job history domain
- `JobHistoryManager` - Job history domain
- `JobHistoryManager` - Job history domain
- `JobHistoryManager` - Job history domain
- `JobHistoryManager` - Job history domain
- `JobHistoryManager` - Job history domain
- `JobHistoryManager` - Job history domain
- `JobHistoryManager` - Job history domain
- `JobHistoryManager` - Job history domain
- `JobHistoryManager` - Job history domain
- `JobHistoryManager` - Job history domainlist format
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

- `AGTVProcessingManager` - Processes AGTV provider data
- `AGTVProcessingManager` - Processes AGTV provider data
- `XtreamProcessingManager` - Processes Xtream provider data
- `TMDBProcessingManager` - Processes TMDB data for matching
- `LiveTVProcessingManager` - Processes M3U/EPG files for Live TV

**Dependencies:**
- ✅ Can depend on: Providers (Level 3), Domain Managers, Orchestration Managers (Type D), other Processing Managers (Type C)
- ✅ Can depend on: Providers (Level 3), Domain Managers, Orchestration Managers (Type D), other Processing Managers (Type C), Orchestration Managers (Type D), other Processing Managers (Type C), Orchestration Managers (Type D), other Processing Managers (Type C), Orchestration Managers (Type D), other Processing Managers (Type C)
- ✅ Should use Domain Managers for saving data (e.g., `TitlesManager.saveMainTitles()`, `ProviderTitlesManager.saveProviderTitles()`)
- ✅ Can use Orchestration Managers for cross-domain operations (e.g., `ProvidersManager` for provider configuration updates)
- ✅ Can use Orchestration Managers for cross-domain operations (e.g., `ProvidersManager` for provider configuration updates)
- ✅ Can use other Processing Managers for shared business logic (e.g., `TMDBProcessingManager` for TMDB matching)
- ✅ Can use Orchestration Managers for cross-domain operations (e.g., `ProvidersManager` for provider configuration updates)
- ✅ Can use other Processing Managers for shared business logic (e.g., `TMDBProcessingManager` for TMDB matching)
- ✅ Can use Orchestration Managers for cross-domain operations (e.g., `ProvidersManager` for provider configuration updates)
- ✅ Can use other Processing Managers for shared business logic (e.g., `TMDBProcessingManager` for TMDB matching)
- ✅ Can use Orchestration Managers for cross-domain operations (e.g., `ProvidersManager` for provider configuration updates)
- ✅ Can use other Processing Managers for shared business logic (e.g., `TMDBProcessingManager` for TMDB matching)
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
- Processing Managers depend on Providers (Level 3), Domain Managers, Orchestration Managers (Type D), and other Processing Managers (Type C) (NOT Repositories - they should use Domain Managers for data operations)
- Processing Managers depend on Providers (Level 3), Domain Managers, Orchestration Managers (Type D), and other Processing Managers (Type C) (NOT Repositories - they should use Domain Managers for data operations)

- Processing Managers depend on Providers (Level 3), Domain Managers, Orchestration Managers (Type D), and other Processing Managers (Type C) (NOT Repositories - they should use Domain Managers for data operations)
- Repositories only depend on MongoDB Client
- Processing Managers depend on Providers (Level 3), Domain Managers, Orchestration Managers (Type D), and other Processing Managers (Type C) (NOT Repositories - they should use Domain Managers for data operations)
- No business logic in repositories or providers

#### Level 4 (Infrastructure)
- Services are standalone infrastructure
- Middleware depends only on UserManager (for authentication)

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

## Manager Type Classifications

### Domain Managers (Type A)
- `UserManager`
- `SettingsManager`
- `ChannelManager`
- `ProgramManager`
- `IPTVProviderManager`
- `ProviderTitlesManager`
- `JobHistoryManager`r`
- `ProviderTitlesManager`
- `JobHistoryManager`

### Formatting Managers (Type B)
- `PlaylistManager` (extends `BaseWatchlistFormattingManager`)
- `XtreamManager` (extends `BaseWatchlistFormattingManager`)
- `StremioManager` (extends `BaseFormattingManager`)
- `TMDBManager` (extends `BaseFormattingManager`)

**Base Classes:**
- `BaseFormattingManager` (extends `BaseManager`) - Base for all Formatting Managers, includes stream URL resolution
- `BaseWatchlistFormattingManager` (extends `BaseFormattingManager`) - Adds watchlist filtering on top of stream functionality
- `AGTVProcessingManager`
- `XtreamProcessingManager`
- `TMDBProcessingManager`
- `LiveTVProcessingManager`
- `TMDBProcessingManager`
- `LiveTVProcessingManager`

- `ProvidersManager`nagers (Type D)
- `JobsManager`
- `ProvidersManager`

**Note:** `LiveTVManager` has been split into:
- `LiveTVProcessingManager` (Type C: Processing Manager) - for M3U/EPG file processing in jobs
- `LiveTVFormattingManager` (Type B: Formatting Manager) - for M3U playlist formatting in routers

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
│ │ • Orchestration Managers (Type D) ✓                │  │
│ │ • Other Processing Managers (Type C) ✓             │  │
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

**BaseIPTVProcessingManager**
- Dependencies: `ProviderTitlesManager` (Domain Manager), `ProvidersManager` (Orchestration Manager), `TMDBManager` (Domain Manager), `TMDBProcessingManager` (Processing Manager)
- Extends: `BaseProcessingManager`
- Note: Can depend on Orchestration Managers (e.g., `ProvidersManager` for provider configuration updates) and other Processing Managers (e.g., `TMDBProcessingManager` for TMDB matching logic). Should NOT depend on Repositories directly.

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

