# Open Issues

This document tracks known issues that need to be addressed in the Playarr project.

## Current Issues

### 1. Xtream Providers Not Syncing Movies

**Status:** Resolved  
**Priority:** High  
**Description:** Xtream providers were not properly syncing movies from the provider API. This affected the ability to aggregate movie content from Xtream-based IPTV providers.

**Root Cause:** The `_shouldSkipMovies` method in `BaseIPTVProcessingManager.js` was using strict equality (`!== null`) to check if a movie already exists. However, `Map.get()` returns `undefined` (not `null`) when a key doesn't exist, causing `undefined !== null` to evaluate to `true`, which incorrectly skipped all movies even when they didn't exist in the database.

**Solution:** Changed `existingTitle !== null` to `existingTitle != null` in the `_shouldSkipMovies` method. The loose equality operator correctly handles both `null` and `undefined` values.

**Impact:**
- Movies from Xtream providers are not available in the content library
- Users cannot access movies through any client interface (Stremio, M3U8, Xtream API, etc.)

**Related Components:**
- `BaseIPTVProcessingManager.js` (fixed)
- `XtreamProvider.js`
- `XtreamProcessingManager.js`
- `SyncIPTVProviderTitlesJob.js`

---

### 2. Stremio Endpoints for TV Shows Not Working

**Status:** Resolved  
**Priority:** High  
**Description:** The Stremio addon endpoints for TV shows appeared to not be functioning correctly, preventing users from accessing TV show content through Stremio.

**Root Cause:** The issue was not with the Stremio endpoints themselves, but was caused by a cleanup failure when providers are disabled or deleted. When a provider was disabled/deleted, its associated media sources were not being removed from the main `titles` collection. This left stale sources in the database that referenced disabled/deleted providers, causing the Stremio stream endpoint to correctly skip these invalid sources, resulting in empty stream responses.

**Solution:** Implemented a comprehensive cleanup mechanism that runs as part of the main title update job:
- Added cleanup methods to `TitleRepository.js` for removing provider sources, empty media items, and empty titles
- Added public wrapper methods to `TitlesManager.js` to expose cleanup functionality
- Fixed architecture violation in `ProvidersManager.js` by replacing direct database access with repository method calls
- Added `cleanupOutdatedMainTitles()` method to `TMDBProcessingManager.js` that uses `TitlesManager` public methods
- Updated `ProviderTitlesMonitorJob.js` to automatically cleanup disabled/deleted providers after processing main titles

**Impact:**
- TV shows are now accessible via Stremio addon
- Users can browse and stream TV shows through Stremio interface
- Cleanup now runs automatically during the main title update job, preventing stale data accumulation

**Related Components:**
- `StremioRouter.js` (was working correctly)
- `StremioManager.js` (was working correctly)
- `BaseFormattingManager.js` (correctly skips disabled/deleted providers)
- `TitleRepository.js` (added cleanup methods)
- `TitlesManager.js` (added cleanup wrapper methods)
- `ProvidersManager.js` (fixed architecture violation)
- `TMDBProcessingManager.js` (added cleanup method)
- `ProviderTitlesMonitorJob.js` (orchestrates cleanup)

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

### 4. Similar Titles Not Being Added to Titles

**Status:** Resolved  
**Priority:** Medium  
**Description:** Similar titles are not being populated in the titles collection. When titles are synced from providers, the `similar_titles` field is not being populated with related title keys, resulting in all titles having empty or missing similar titles data.

**Root Cause:** Two issues were identified:
1. **Field name mismatch:** The code was storing similar titles as `similar` but reading them as `similar_titles`, causing a mismatch between storage and retrieval.
2. **Processing logic limitation:** The enrichment process only processed newly created titles (where `createdAt === lastUpdated`), skipping existing titles that didn't have the `similar_titles` field set.

**Solution:** 
1. Fixed field name mismatch in `TMDBProcessingManager.js`:
   - Changed all references from `similar` to `similar_titles` (lines 291, 329, 404, 415, 416)
   - Updated JSDoc comments to reflect correct field name
2. Updated processing logic to process all titles without `similar_titles` field:
   - Simplified filter to `allMainTitles.filter(title => title.similar_titles === undefined)`
   - Removed the `createdAt === lastUpdated` restriction that was limiting processing to only newly created titles
   - This allows backfilling existing titles that don't have the field set

**Impact:**
- Similar titles are now properly stored and retrieved
- Users can discover related/similar content through the UI
- The "Recommendations" section in title details now displays similar titles
- Existing titles without similar_titles are automatically backfilled during job execution

**Related Components:**
- `TMDBProcessingManager.js` (fixed - field name and processing logic)
- `TitlesManager.js` (was correctly reading `similar_titles` field)
- `ProviderTitlesMonitorJob.js` (orchestrates similar titles enrichment)

---

## Notes

- Issues are listed in order of priority/severity
- When investigating, check related components and their interactions
- Consider testing with multiple providers/clients to isolate issues
- Document findings and solutions when issues are resolved

