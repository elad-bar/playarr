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
- **Labels**: `source` (provider_id)
- **Description**: Number of episodes in main titles per source

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

#### Provider Titles Processed
- **Metric**: `playarr_provider_titles_processed_total`
- **Type**: Counter
- **Labels**: `provider_id`, `media_type` (movies/tvshows)
- **Description**: Total number of provider titles processed per provider and media type

#### Main Titles Processed
- **Metric**: `playarr_main_titles_processed_total`
- **Type**: Counter
- **Labels**: `provider_id`, `media_type` (movies/tvshows)
- **Description**: Total number of main titles processed per provider and media type

#### Provider API Requests
- **Metric**: `playarr_provider_api_requests_total`
- **Type**: Counter
- **Labels**: `provider_id`, `endpoint`, `status_code`
- **Description**: Total number of provider API requests per provider, endpoint, and status code

#### Provider API Request Duration
- **Metric**: `playarr_provider_api_request_duration_seconds`
- **Type**: Histogram
- **Labels**: `provider_id`, `endpoint`, `status_code`
- **Description**: Duration of provider API requests per provider, endpoint, and status code

#### Provider Connection Metrics
- **Metric**: `playarr_provider_active_connections`
- **Type**: Gauge
- **Labels**: `provider_id`
- **Description**: Number of active connections per provider

- **Metric**: `playarr_provider_max_connections`
- **Type**: Gauge
- **Labels**: `provider_id`
- **Description**: Number of maximum connections per provider

- **Metric**: `playarr_provider_active`
- **Type**: Gauge
- **Labels**: `provider_id`
- **Description**: Provider active status (1 = active, 0 = inactive)

- **Metric**: `playarr_provider_expiration_days`
- **Type**: Gauge
- **Labels**: `provider_id`
- **Description**: Number of days until provider expiration (negative if expired, -999999 if no expiration date)

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

### 6. HTTP Request Metrics

#### HTTP Requests
- **Metric**: `playarr_http_requests_total`
- **Type**: Counter
- **Labels**: `endpoint`, `status_code`, `username`
- **Description**: Total number of HTTP requests per endpoint

#### HTTP Request Duration
- **Metric**: `playarr_http_request_duration_seconds`
- **Type**: Histogram
- **Labels**: `endpoint`, `username`
- **Description**: HTTP request duration in seconds

#### Managed Errors
- **Metric**: `playarr_managed_errors_total`
- **Type**: Counter
- **Labels**: `endpoint`, `error_type`, `username`
- **Description**: Total number of managed errors (AppError instances) by error type

#### Authentication Failures
- **Metric**: `playarr_authentication_failures_total`
- **Type**: Counter
- **Labels**: `endpoint`, `username`
- **Description**: Total number of authentication failures

### 7. User Operations Metrics

#### Watchlist Operations
- **Metric**: `playarr_watchlist_operations_total`
- **Type**: Counter
- **Labels**: `operation` (add/remove), `media_type`, `username`
- **Description**: Total number of watchlist operations

#### Provider Operations
- **Metric**: `playarr_provider_operations_total`
- **Type**: Counter
- **Labels**: `operation`, `username`
- **Description**: Total number of provider CRUD operations

#### User Operations
- **Metric**: `playarr_user_operations_total`
- **Type**: Counter
- **Labels**: `operation`, `username`
- **Description**: Total number of user CRUD operations

## Architecture

### Component Structure

```
Level 4: Infrastructure
├── services/metrics.js              # Metrics service (Prometheus client)
├── middleware/MetricsMiddleware.js  # HTTP request tracking middleware
└── metrics.json                      # Metrics configuration file

Level 1: Entry Level
└── routes/MetricsRouter.js          # /metrics endpoint

Level 2: Business Logic
├── managers/domain/SettingsManager.js  # Token management (existing)
└── (Metrics collection in existing managers)
```

### Metrics Service (Level 4: Infrastructure)

**File**: `web-api/src/services/metrics.js`

- Class-based service (not singleton - instantiated in `index.js`)
- Initializes Prometheus client (`prom-client`)
- Loads metric definitions from `metrics.json` configuration file
- Dynamically creates metric collectors (Gauges, Counters, Histograms) from JSON config
- Provides helper methods for metric updates: `incrementCounter()`, `observeHistogram()`, `setGauge()`, `resetGauge()`
- Exposes `updateGaugeMetrics()` method for bulk gauge updates from database
- Exposes metric registry for Prometheus scraping

### Metrics Configuration (Level 4: Infrastructure)

**File**: `web-api/src/metrics.json`

- JSON configuration file defining all metrics
- Each metric entry includes: `type`, `name`, `help`, `labelNames`, and optional `buckets` (for histograms)
- Metrics are referenced by key (e.g., `provider_titles_count`) rather than direct property access
- Makes it easy to add/modify metrics without code changes

### Metrics Middleware (Level 4: Infrastructure)

**File**: `web-api/src/middleware/MetricsMiddleware.js`

- Tracks HTTP request metrics automatically
- Tracks request count, duration, errors, and authentication failures
- Must be added to Express app before routes are registered
- Normalizes endpoint paths (replaces IDs with `:id` pattern)
- Tracks username from authenticated requests

### Metrics Router (Level 1: Entry Level)

**File**: `web-api/src/routes/MetricsRouter.js`

- Extends `BaseRouter`
- Exposes `GET /metrics` endpoint (Bearer token authentication)
- Exposes `GET /metrics/json` endpoint (JWT authentication via cookie)
- Exposes `GET /metrics/test` endpoint (for testing routing)
- Returns Prometheus format (`text/plain; version=0.0.4`) for `/metrics`
- Returns JSON format for `/metrics/json`

### Metrics Collection Points

**Level 1 (Routers):**
- `StreamRouter` - Track stream requests and duration
- `LiveTVRouter` - Track Live TV stream requests
- `TitlesRouter` - Track watchlist operations
- `UsersRouter` - Track user operations
- `ProvidersRouter` - Track provider operations
- `MetricsMiddleware` (via Express middleware) - Track all HTTP requests, errors, and auth failures

**Level 2 (Managers):**
- `BaseFormattingManager.getBestSource()` - Track best source selection and duration
- `UserManager` - Provides data for watchlist counts (via `updateGaugeMetrics()`)
- `TitlesManager` - Provides data for title/episode counts (via `updateGaugeMetrics()`)
- `ProviderTitlesManager` - Provides data for provider title counts (via `updateGaugeMetrics()`)
- `ChannelManager` - Provides data for channel counts (via `updateGaugeMetrics()`)
- `IPTVProviderManager` - Provides data for provider connection metrics (via `updateGaugeMetrics()`)

**Level 3 (Providers):**
- `BaseProvider` - Track provider API requests and duration

**Level 1 (Jobs):**
- `BaseJob` - Track job executions and duration
- `SyncIPTVProviderTitlesJob` - Track provider titles processed
- `ProviderTitlesMonitorJob` - Track main titles processed
- `SyncProviderDetailsJob` - Update provider connection metrics

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

### 1. Startup Initialization

**File**: `web-api/src/index.js`

In the `initialize()` function:

```javascript
// Step 1: Create metrics service (before other services that depend on it)
const metricsService = new MetricsService();
const metricsMiddleware = new MetricsMiddleware(metricsService);

// ... create other managers and services ...

// Step 2: Auto-generate metrics token if not exists (after SettingsManager is created)
try {
  const metricsToken = await settingsManager.getSetting('metrics_token');
  if (!metricsToken.value) {
    const crypto = await import('crypto');
    const newToken = crypto.randomBytes(32).toString('hex');
    await settingsManager.setSetting('metrics_token', newToken);
    logger.info('Generated new metrics token');
  }
} catch (error) {
  logger.warn('Could not check/generate metrics token on startup:', error.message);
}

// Step 3: Add metrics middleware to Express app (before routes)
app.use(metricsMiddleware.trackRequest);

// Step 4: Update gauge metrics on startup (after managers are created)
try {
  await metricsService.updateGaugeMetrics({
    providerTitlesManager,
    titlesManager,
    channelManager,
    userManager,
    iptvProviderManager
  });
} catch (error) {
  logger.warn('Failed to update gauge metrics on startup:', error.message);
}
```

### 2. Metrics Service Implementation

**File**: `web-api/src/services/metrics.js`

The metrics service uses a JSON-based configuration approach:

```javascript
import { Registry, Counter, Gauge, Histogram } from 'prom-client';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const metricsConfig = JSON.parse(readFileSync(join(__dirname, '../metrics.json'), 'utf-8'));

class MetricsService {
  constructor() {
    this.register = new Registry();
    this._metrics = new Map(); // Store all metric instances
    this._metricTypes = {
      'counter': Counter,
      'gauge': Gauge,
      'histogram': Histogram
    };
    this._initializeMetrics();
  }

  _initializeMetrics() {
    const metrics = metricsConfig.metrics || {};
    
    for (const [key, config] of Object.entries(metrics)) {
      const MetricClass = this._metricTypes[config.type];
      const options = {
        name: config.name,
        help: config.help,
        labelNames: config.labelNames || [],
        registers: [this.register]
      };

      if (config.type === 'histogram' && config.buckets) {
        options.buckets = config.buckets;
      }

      const metric = new MetricClass(options);
      this._metrics.set(key, metric);
    }
  }

  async getMetrics() {
    return await this.register.metrics();
  }

  async getMetricsAsJSON() {
    return await this.register.getMetricsAsJSON();
  }

  incrementCounter(metricName, labels, value = 1) {
    const metric = this._metrics.get(metricName);
    if (metric && metric instanceof Counter) {
      metric.inc(labels, value);
    }
  }

  observeHistogram(metricName, labels, value) {
    const metric = this._metrics.get(metricName);
    if (metric && metric instanceof Histogram) {
      metric.observe(labels, value);
    }
  }

  setGauge(metricName, labels, value) {
    const metric = this._metrics.get(metricName);
    if (metric && metric instanceof Gauge) {
      metric.set(labels, value);
    }
  }

  resetGauge(metricName) {
    const metric = this._metrics.get(metricName);
    if (metric && metric instanceof Gauge) {
      metric.reset();
    }
  }

  async updateGaugeMetrics({ providerTitlesManager, titlesManager, channelManager, userManager, iptvProviderManager }) {
    // Resets all gauges, then updates from database
    // ... (implementation details)
  }
}

export default MetricsService; // Export class, not instance
```

**File**: `web-api/src/metrics.json`

```json
{
  "metrics": {
    "provider_titles_count": {
      "type": "gauge",
      "name": "playarr_provider_titles_count",
      "help": "Number of provider titles per provider, per media type",
      "labelNames": ["provider_id", "media_type"]
    },
    "main_titles_count": {
      "type": "gauge",
      "name": "playarr_main_titles_count",
      "help": "Number of main titles per media type",
      "labelNames": ["media_type"]
    },
    "best_source_selection_duration": {
      "type": "histogram",
      "name": "playarr_best_source_selection_duration_seconds",
      "help": "Time taken to find valid source",
      "labelNames": ["media_type"],
      "buckets": [0.1, 0.5, 1, 2, 5, 10, 30]
    }
    // ... (all other metrics)
  }
}
```

### 3. Metrics Router

**File**: `web-api/src/routes/MetricsRouter.js`

```javascript
import BaseRouter from './BaseRouter.js';

class MetricsRouter extends BaseRouter {
  constructor(settingsManager, middleware, metricsService) {
    super(middleware, 'MetricsRouter');
    this._settingsManager = settingsManager;
    this._metricsService = metricsService;
  }

  initialize() {
    /**
     * GET /metrics
     * Prometheus metrics endpoint
     * Requires Bearer token authentication via Authorization header
     */
    this.router.get('/', async (req, res) => {
      try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return this.returnErrorResponse(
            res,
            401,
            'Missing or invalid Authorization header. Expected: Authorization: Bearer <token>'
          );
        }

        const token = authHeader.substring(7);
        const metricsToken = await this._settingsManager.getSetting('metrics_token');
        
        if (!metricsToken.value || token !== metricsToken.value) {
          return this.returnErrorResponse(res, 401, 'Invalid metrics token');
        }

        res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        const metrics = await this._metricsService.getMetrics();
        return res.send(metrics);
      } catch (error) {
        this.logger.error('Metrics endpoint error:', error);
        return this.returnErrorResponse(res, 500, 'Internal server error', error.message);
      }
    });

    /**
     * GET /metrics/json
     * Prometheus metrics endpoint in JSON format
     * Requires JWT authentication via cookie
     */
    this.router.get('/json', this.middleware.requireAuth, async (req, res) => {
      try {
        const metrics = await this._metricsService.getMetricsAsJSON();
        return res.json(metrics);
      } catch (error) {
        this.logger.error('Metrics JSON endpoint error:', error);
        return this.returnErrorResponse(res, 500, 'Internal server error', error.message);
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
this._metricsService.incrementCounter('best_source_selections', { 
  provider_id: winner.provider_id 
});
this._metricsService.observeHistogram('best_source_selection_duration', 
  { media_type: mediaType }, 
  raceResults.duration / 1000 // Convert to seconds
);
```

#### In StreamRouter

```javascript
const startTime = Date.now();
// ... stream resolution logic ...

// Track stream requests
if (username) {
  this._metricsService.incrementCounter('stream_requests', { user: username });
}
const duration = (Date.now() - startTime) / 1000;
this._metricsService.observeHistogram('stream_request_duration', 
  { media_type: mediaType }, 
  duration
);
```

#### In BaseJob (job execution tracking)

```javascript
// In BaseJob.execute()
const startTime = Date.now();
try {
  await this.run();
  this.metricsService.incrementCounter('job_executions', { 
    job_type: this.jobName, 
    status: 'success' 
  });
} catch (error) {
  this.metricsService.incrementCounter('job_executions', { 
    job_type: this.jobName, 
    status: 'failure' 
  });
  throw error;
} finally {
  const duration = (Date.now() - startTime) / 1000;
  this.metricsService.observeHistogram('job_duration', 
    { job_type: this.jobName }, 
    duration
  );
}
```

#### In MetricsMiddleware (HTTP request tracking)

```javascript
// Automatically tracks all HTTP requests
trackRequest(req, res, next) {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = (Date.now() - startTime) / 1000;
    const endpoint = this._getEndpoint(req);
    const username = this._getUsername(req);
    
    this.metricsService.incrementCounter('http_requests', {
      endpoint,
      status_code: res.statusCode.toString(),
      username
    });
    
    this.metricsService.observeHistogram('http_request_duration', {
      endpoint,
      username
    }, duration);
  });
  
  next();
}
```

### 6. Gauge Metrics Updates

Gauge metrics (counts) are updated using the `updateGaugeMetrics()` method:

**File**: `web-api/src/index.js`

```javascript
// Update gauge metrics on startup
try {
  await metricsService.updateGaugeMetrics({
    providerTitlesManager,
    titlesManager,
    channelManager,
    userManager,
    iptvProviderManager
  });
} catch (error) {
  logger.warn('Failed to update gauge metrics on startup:', error.message);
}
```

**Implementation Details**:
- `updateGaugeMetrics()` resets all gauge metrics to 0 first
- Then queries managers for current counts and updates gauges
- Updates the following metrics:
  - Provider titles count (per provider, per media type)
  - Main titles count (per media type)
  - Episodes count (per source)
  - Channels count (per provider, per category)
  - Watchlist titles count (per user, per media type)
  - Watchlist channels count (per user)
  - Active users count
  - Provider connection metrics (active connections, max connections, active status, expiration days)

**Update Strategy**:
- Called on application startup
- Can be called after sync jobs complete to refresh counts
- Consider adding a periodic job (every 5-15 minutes) for production environments

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

## Notes on Missing Metrics

The following metrics were originally planned but are not currently implemented:

- `playarr_provider_sync_total` - Provider sync success/failure counter (not implemented)
- `playarr_provider_sync_duration_seconds` - Provider sync duration histogram (not implemented)
- `playarr_provider_api_errors_total` - Provider API error counter (replaced by `playarr_provider_api_requests_total` with status_code label)
- `playarr_websocket_connections` - WebSocket connections gauge (not implemented)

These may be added in future updates if needed.

## Future Enhancements

1. **Custom Metrics**: Allow admins to configure custom metrics via UI
2. **Metric Filtering**: Filter metrics by label in UI
3. **Metric Export**: Export metrics to other formats (JSON, CSV)
4. **Alerting Rules**: Pre-configured Prometheus alerting rules
5. **Dashboard Templates**: Grafana dashboard templates for common use cases
6. **Periodic Gauge Updates**: Background job to periodically update gauge metrics
7. **WebSocket Metrics**: Track WebSocket connection counts
8. **Provider Sync Metrics**: Add dedicated provider sync success/failure and duration metrics

