# Prometheus Metrics Exporter Feature [New]

## Overview

This feature adds Prometheus metrics export capability to the Playarr Web API, enabling comprehensive monitoring of system performance, content statistics, user activity, and provider health. The metrics endpoint is secured with Bearer token authentication and includes a dedicated admin settings page for token management and Prometheus configuration.

## Goals

1. **Comprehensive Monitoring**: Track key system metrics including content counts, user activity, provider health, and performance
2. **Secure Access**: Protect metrics endpoint with Bearer token authentication
3. **Easy Configuration**: Provide admin UI for token management and Prometheus configuration examples
4. **Auto-initialization**: Automatically generate metrics token on startup if not exists
5. **Standard Compliance**: Follow Prometheus best practices and HTTP standards

## Metrics to Track

### 1. Content Metrics

#### Provider Titles Count
- **Metric**: `playarr_provider_titles_count`
- **Type**: Gauge
- **Labels**: `provider_id`, `media_type` (movies/tvshows)
- **Description**: Number of provider titles per provider, per media type

#### Main Titles Count
- **Metric**: `playarr_main_titles_count`
- **Type**: Gauge
- **Labels**: `media_type` (movies/tvshows)
- **Description**: Number of main titles per media type

#### Episodes Count
- **Metric**: `playarr_episodes_count`
- **Type**: Gauge
- **Labels**: `source` (provider_id), `title_name`, `season`
- **Description**: Number of episodes in main titles per source, per title name, per season

#### Channels Count
- **Metric**: `playarr_channels_count`
- **Type**: Gauge
- **Labels**: `provider_id`, `category`
- **Description**: Number of channels per provider, per category

### 2. User Activity Metrics

#### Watchlist Titles Count
- **Metric**: `playarr_watchlist_titles_count`
- **Type**: Gauge
- **Labels**: `user` (username), `media_type` (movies/tvshows)
- **Description**: Number of main titles in watchlist, per media type, per user

#### Watchlist Channels Count
- **Metric**: `playarr_watchlist_channels_count`
- **Type**: Gauge
- **Labels**: `user` (username)
- **Description**: Number of channels in watchlist, per user

#### Stream Requests
- **Metric**: `playarr_stream_requests_total`
- **Type**: Counter
- **Labels**: `user` (username)
- **Description**: Total number of stream requests per user

### 3. Provider Performance Metrics

#### Best Source Selections
- **Metric**: `playarr_best_source_selections_total`
- **Type**: Counter
- **Labels**: `provider_id`
- **Description**: Number of times a provider was selected as best source

#### Provider Sync Success/Failure
- **Metric**: `playarr_provider_sync_total`
- **Type**: Counter
- **Labels**: `provider_id`, `status` (success/failure)
- **Description**: Provider sync job execution count

#### Provider Sync Duration
- **Metric**: `playarr_provider_sync_duration_seconds`
- **Type**: Histogram
- **Labels**: `provider_id`
- **Description**: Duration of provider sync operations

#### Provider API Errors
- **Metric**: `playarr_provider_api_errors_total`
- **Type**: Counter
- **Labels**: `provider_id`, `error_type` (502/timeout/other)
- **Description**: Provider API error count

### 4. Performance Metrics

#### Best Source Selection Duration
- **Metric**: `playarr_best_source_selection_duration_seconds`
- **Type**: Histogram
- **Labels**: `media_type` (movies/tvshows/live)
- **Description**: Time taken to find valid source

#### Stream Request Response Time
- **Metric**: `playarr_stream_request_duration_seconds`
- **Type**: Histogram
- **Labels**: `media_type` (movies/tvshows/live)
- **Description**: Stream request response time

#### Cache Hit Rate
- **Metric**: `playarr_cache_operations_total`
- **Type**: Counter
- **Labels**: `operation` (hit/miss)
- **Description**: Cache operation count for best source selection

### 5. System Metrics

#### Job Execution Count
- **Metric**: `playarr_job_executions_total`
- **Type**: Counter
- **Labels**: `job_type`, `status` (success/failure)
- **Description**: Job execution count per job type

#### Job Execution Duration
- **Metric**: `playarr_job_duration_seconds`
- **Type**: Histogram
- **Labels**: `job_type`
- **Description**: Job execution duration

#### Active Users
- **Metric**: `playarr_active_users`
- **Type**: Gauge
- **Description**: Number of active users (users with API key)

#### WebSocket Connections
- **Metric**: `playarr_websocket_connections`
- **Type**: Gauge
- **Description**: Current number of WebSocket connections

## Architecture

### Component Structure

```
Level 4: Infrastructure
├── services/metrics.js          # Metrics service (Prometheus client)
└── middleware/MetricsAuth.js    # Bearer token authentication middleware

Level 1: Entry Level
└── routes/MetricsRouter.js      # /metrics endpoint

Level 2: Business Logic
├── managers/domain/SettingsManager.js  # Token management (existing)
└── (Metrics collection in existing managers)
```

### Metrics Service (Level 4: Infrastructure)

**File**: `web-api/src/services/metrics.js`

- Singleton pattern
- Initializes Prometheus client (`prom-client`)
- Defines all metric collectors (Gauges, Counters, Histograms)
- Provides helper methods for metric updates
- Exposes metric registry

### Metrics Router (Level 1: Entry Level)

**File**: `web-api/src/routes/MetricsRouter.js`

- Extends `BaseRouter`
- Exposes `GET /metrics` endpoint
- Protected with Bearer token authentication
- Returns Prometheus format (`text/plain; version=0.0.4`)

### Metrics Collection Points

**Level 1 (Routers):**
- `StreamRouter` - Track stream requests
- `XtreamRouter` - Track Xtream API requests
- `LiveTVRouter` - Track Live TV stream requests

**Level 2 (Managers):**
- `BaseFormattingManager.getBestSource()` - Track best source selection
- `UserManager` - Track watchlist counts
- `TitlesManager` - Track title/episode counts
- `ProviderTitlesManager` - Track provider title counts
- `ChannelManager` - Track channel counts
- `ProvidersManager` - Track provider sync operations
- `JobsManager` - Track job executions

**Level 4 (Services):**
- `WebSocketService` - Track WebSocket connections

## Security

### Bearer Token Authentication

The `/metrics` endpoint is protected using Bearer token authentication (RFC 6750):

- **Header Format**: `Authorization: Bearer <token>`
- **Token Storage**: Stored in settings collection as `metrics_token`
- **Auto-generation**: Token automatically generated on startup if not exists
- **Token Format**: 64-character hex string (32 random bytes)

### Token Management

- **View**: Admin-only access via Settings > Metrics page
- **Regeneration**: Admin can regenerate token (invalidates old token)
- **Security**: Token never exposed in URLs or logs

### Authentication Flow

```javascript
// In MetricsRouter
const authHeader = req.headers.authorization;
if (!authHeader || !authHeader.startsWith('Bearer ')) {
  return res.status(401).json({ error: 'Missing or invalid Authorization header' });
}

const token = authHeader.substring(7); // Remove 'Bearer ' prefix
const validToken = await settingsManager.getSetting('metrics_token');

if (token !== validToken.value) {
  return res.status(401).json({ error: 'Invalid metrics token' });
}
```

## Implementation Details

### 1. Startup Token Generation

**File**: `web-api/src/index.js`

In the `initialize()` function, after `SettingsManager` is created:

```javascript
// Auto-generate metrics token if not exists
const metricsToken = await settingsManager.getSetting('metrics_token');
if (!metricsToken.value) {
  const crypto = await import('crypto');
  const newToken = crypto.randomBytes(32).toString('hex');
  await settingsManager.setSetting('metrics_token', newToken);
  logger.info('Generated new metrics token');
}
```

### 2. Metrics Service Implementation

**File**: `web-api/src/services/metrics.js`

```javascript
import { Registry, Counter, Gauge, Histogram } from 'prom-client';

class MetricsService {
  constructor() {
    this.register = new Registry();
    this._initializeMetrics();
  }

  _initializeMetrics() {
    // Content metrics
    this.providerTitlesCount = new Gauge({
      name: 'playarr_provider_titles_count',
      help: 'Number of provider titles per provider, per media type',
      labelNames: ['provider_id', 'media_type'],
      registers: [this.register]
    });

    this.mainTitlesCount = new Gauge({
      name: 'playarr_main_titles_count',
      help: 'Number of main titles per media type',
      labelNames: ['media_type'],
      registers: [this.register]
    });

    // ... (all other metrics)
  }

  async getMetrics() {
    return await this.register.metrics();
  }
}

export default new MetricsService();
```

### 3. Metrics Router

**File**: `web-api/src/routes/MetricsRouter.js`

```javascript
import BaseRouter from './BaseRouter.js';
import metricsService from '../services/metrics.js';
import { SettingsManager } from '../managers/domain/SettingsManager.js';

class MetricsRouter extends BaseRouter {
  constructor(settingsManager, middleware) {
    super(middleware, 'MetricsRouter');
    this._settingsManager = settingsManager;
  }

  initialize() {
    this.router.get('/', async (req, res) => {
      try {
        // Bearer token authentication
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ error: 'Missing or invalid Authorization header' });
        }

        const token = authHeader.substring(7);
        const metricsToken = await this._settingsManager.getSetting('metrics_token');
        
        if (token !== metricsToken.value) {
          return res.status(401).json({ error: 'Invalid metrics token' });
        }

        // Return Prometheus metrics
        res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        const metrics = await metricsService.getMetrics();
        return res.send(metrics);
      } catch (error) {
        this.logger.error('Metrics endpoint error:', error);
        return res.status(500).json({ error: 'Internal server error' });
      }
    });
  }
}
```

### 4. Settings Endpoints

**File**: `web-api/src/routes/SettingsRouter.js`

Add new endpoints:

```javascript
/**
 * GET /api/settings/metrics
 * Get metrics token (admin only)
 */
this.router.get('/metrics', this.middleware.requireAdmin, async (req, res) => {
  try {
    const result = await this._settingsManager.getSetting('metrics_token');
    return res.status(200).json(result);
  } catch (error) {
    return this.handleError(res, error, 'Failed to get metrics token');
  }
});

/**
 * POST /api/settings/metrics/regenerate
 * Regenerate metrics token (admin only)
 */
this.router.post('/metrics/regenerate', this.middleware.requireAdmin, async (req, res) => {
  try {
    const crypto = await import('crypto');
    const newToken = crypto.randomBytes(32).toString('hex');
    await this._settingsManager.setSetting('metrics_token', newToken);
    return res.status(200).json({ value: newToken });
  } catch (error) {
    return this.handleError(res, error, 'Failed to regenerate metrics token');
  }
});
```

### 5. Metrics Collection Integration

#### In BaseFormattingManager.getBestSource()

```javascript
// After best source is selected
metricsService.bestSourceSelections.inc({ provider_id: winner.provider_id });
metricsService.bestSourceSelectionDuration.observe(
  { media_type: mediaType },
  raceResults.duration / 1000 // Convert to seconds
);
```

#### In StreamRouter

```javascript
// Track stream requests
metricsService.streamRequests.inc({ user: username });
metricsService.streamRequestDuration.observe(
  { media_type: mediaType },
  responseTime / 1000
);
```

#### In ProvidersManager (sync operations)

```javascript
// Track provider sync
const startTime = Date.now();
try {
  await this.syncProvider(providerId);
  metricsService.providerSync.inc({ provider_id: providerId, status: 'success' });
} catch (error) {
  metricsService.providerSync.inc({ provider_id: providerId, status: 'failure' });
} finally {
  const duration = (Date.now() - startTime) / 1000;
  metricsService.providerSyncDuration.observe({ provider_id: providerId }, duration);
}
```

### 6. Periodic Metrics Updates

For Gauge metrics that need periodic updates (counts), create a background job or update on-demand:

**Option A: Background Job**
- Create `UpdateMetricsJob` that runs every 5-15 minutes
- Updates all gauge metrics (counts)

**Option B: On-Demand Updates**
- Update metrics when data changes (e.g., after sync jobs)
- Cache metric values to avoid frequent DB queries

## UI Implementation

### Settings Metrics Page

**File**: `web-ui/src/components/settings/SettingsMetrics.jsx`

Features:
- Display metrics token (with show/hide toggle)
- Copy-to-clipboard button
- "Regenerate Token" button with confirmation dialog
- Prometheus configuration example with current token
- Warning about token regeneration impact

### Menu Integration

**File**: `web-ui/src/components/layout/Sidebar.jsx`

Add to admin settings menu:
```javascript
{ path: '/settings/metrics', label: 'Metrics', icon: <BarChartIcon /> }
```

**File**: `web-ui/src/App.js`

Add route:
```javascript
<Route
  path="/settings/metrics"
  element={
    <PrivateRoute>
      <SettingsMetrics />
    </PrivateRoute>
  }
/>
```

### Prometheus Configuration Example

The UI will display:

```yaml
scrape_configs:
  - job_name: 'playarr'
    scrape_interval: 15s
    metrics_path: '/metrics'
    static_configs:
      - targets: ['localhost:3000']
    bearer_token: 'YOUR_TOKEN_HERE'
```

Or for file-based token (more secure):

```yaml
scrape_configs:
  - job_name: 'playarr'
    scrape_interval: 15s
    metrics_path: '/metrics'
    static_configs:
      - targets: ['localhost:3000']
    bearer_token_file: '/etc/prometheus/playarr-token'
```

## Dependencies

Add to `web-api/package.json`:

```json
{
  "dependencies": {
    "prom-client": "^15.0.0"
  }
}
```

## Benefits

### Operational Benefits
- **Comprehensive Monitoring**: Track all key system metrics
- **Performance Insights**: Identify bottlenecks and slow operations
- **Provider Health**: Monitor provider sync success/failure rates
- **User Activity**: Track usage patterns and popular content
- **System Health**: Monitor job execution and system resources

### Security Benefits
- **Bearer Token**: Standard, secure authentication
- **Admin-Only Access**: Token management restricted to admins
- **Auto-Generation**: No manual token setup required
- **Token Rotation**: Easy token regeneration for security

### Developer Benefits
- **Standard Format**: Prometheus-compatible metrics
- **Easy Integration**: Works with Grafana, AlertManager, etc.
- **Extensible**: Easy to add new metrics
- **Well-Documented**: Clear metric definitions and labels

## Considerations

### Performance
- **Metric Collection**: Should be lightweight and non-blocking
- **Update Frequency**: Gauge metrics updated periodically (not on every request)
- **Caching**: Cache metric values to avoid frequent DB queries

### Scalability
- **Label Cardinality**: Avoid high-cardinality labels (e.g., per-title metrics)
- **Metric Count**: Keep total metric count reasonable (< 100 metrics)
- **Update Strategy**: Use background jobs for expensive metric updates

### Security
- **Token Storage**: Token stored securely in MongoDB
- **Token Exposure**: Never log or expose token in error messages
- **HTTPS**: Recommend using HTTPS in production

## Future Enhancements

1. **Custom Metrics**: Allow admins to configure custom metrics
2. **Metric Filtering**: Filter metrics by label in UI
3. **Metric Export**: Export metrics to other formats (JSON, CSV)
4. **Alerting Rules**: Pre-configured Prometheus alerting rules
5. **Dashboard Templates**: Grafana dashboard templates for common use cases

