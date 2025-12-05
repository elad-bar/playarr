# Open Issues

This document tracks known issues that need to be addressed in the Playarr project.

## Current Issues

### 1. Xtream Providers Not Syncing Movies

**Status:** Open  
**Priority:** High  
**Description:** Xtream providers are not properly syncing movies from the provider API. This affects the ability to aggregate movie content from Xtream-based IPTV providers.

**Impact:**
- Movies from Xtream providers are not available in the content library
- Users cannot access movies through any client interface (Stremio, M3U8, Xtream API, etc.)

**Related Components:**
- `XtreamProvider.js`
- `XtreamProcessingManager.js`
- `SyncIPTVProviderTitlesJob.js`

---

### 2. Stremio Endpoints for TV Shows Not Working

**Status:** Open  
**Priority:** High  
**Description:** The Stremio addon endpoints for TV shows are not functioning correctly. This prevents users from accessing TV show content through Stremio.

**Impact:**
- TV shows are not accessible via Stremio addon
- Users cannot browse or stream TV shows through Stremio interface
- Movies may still work (needs verification)

**Related Components:**
- `StremioRouter.js`
- `StremioManager.js`
- TV show formatting/processing logic

---

### 3. TiviMate Using Xtream Endpoints Not Working

**Status:** Open  
**Priority:** Medium  
**Description:** TiviMate clients using Xtream Code API endpoints are experiencing issues. This affects users who prefer TiviMate as their IPTV player.

**Impact:**
- TiviMate users cannot connect to Playarr via Xtream API
- Content may not be accessible or properly formatted for TiviMate
- May affect other Xtream API-compatible clients as well

**Related Components:**
- `XtreamRouter.js`
- `XtreamManager.js`
- Xtream API endpoint implementation

---

## Notes

- Issues are listed in order of priority/severity
- When investigating, check related components and their interactions
- Consider testing with multiple providers/clients to isolate issues
- Document findings and solutions when issues are resolved

