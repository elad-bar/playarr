# IPTV Provider Settings Wizard Redesign [New]

## Overview

This feature redesigns the IPTV provider settings UI from a card-based interface with tabs to a vertical wizard-based interface. The wizard provides a step-by-step guided experience for adding and editing IPTV providers, with validation at each step, preview of upcoming steps, and the ability to save progress incrementally.

## Goals

1. **Improved User Experience**: Replace tab-based interface with intuitive wizard flow
2. **Progressive Disclosure**: Show only relevant information at each step
3. **Early Validation**: Validate inputs at each step before proceeding
4. **Incremental Saving**: Allow users to save progress at any step
5. **Clear Progress Indication**: Show preview of all steps with current position
6. **Type-Specific Steps**: Show/hide steps based on provider type (Xtream vs AGTV)
7. **Unified Categories View**: Combine movies and TV shows categories with filtering instead of separate tabs

## Current Architecture

### Existing Implementation

**UI Structure:**
- Card-based provider list with "Add New Provider" card
- Dialog-based editor with horizontal tabs:
  - **Details Tab**: Provider ID, type, URLs, username, password, enabled checkbox
  - **Cleanup Rules Tab** (Xtream only): Pattern/replacement rules
  - **Movies Tab** (Xtream only): Category selection for movies
  - **TV Shows Tab** (Xtream only): Category selection for TV shows
  - **Ignored Titles Tab**: Read-only list of ignored titles

**Current Flow:**
1. User clicks provider card or "Add New Provider"
2. Dialog opens with tabs
3. User navigates between tabs freely
4. Save button in header saves current tab's data
5. Categories are loaded per tab (separate API calls for movies/tvshows)

**Limitations:**
- All tabs visible at once can be overwhelming
- No validation before proceeding to next step
- Categories split into two separate tabs
- No preview of what's coming next
- No way to save partial progress in add mode

## Feature Requirements

### Wizard Structure

#### Add Mode Steps

**Step 1: Basic Details**
- Provider ID (name) - text input, required, must be unique
- Provider Type - dropdown (Xtream / AGTV), required
- Validation:
  - ID must be non-empty
  - ID must be unique (check against existing providers)
  - Type must be selected
- Buttons: Continue only (no back button on first step)

**Step 2: Provider Details**
- For Xtream:
  - Multiple URLs input (add/remove URLs)
  - API URL selection (star icon to mark which URL is the API URL)
  - Username - text input, required
  - Password - password input, required
- For AGTV:
  - Single URL input
  - Username - text input, required
  - Password - password input, required
- Validation:
  - On "Continue" or "Save & Continue": Validate credentials with selected API URL
  - Show loading state during validation
  - If validation fails: Show error message, prevent proceeding
  - If validation succeeds: Allow proceeding to next step
- Buttons: Back, Continue, Save & Continue

**Step 3: Cleanup Rules** (Xtream only, hidden for AGTV)
- Same form as current CleanupRulesForm
- Pattern/replacement rules management
- Buttons: Back, Continue, Save & Continue

**Step 4: Categories** (Xtream only, hidden for AGTV)
- Media Type Filter: Dropdown/buttons (All, Movies, TV Shows)
- Search: Text input to filter categories (client-side filtering)
- Category Grid: Two-column layout with switches (same as current)
- Load all categories (movies + tvshows) on step load
- Pre-populate enabled state based on provider config (in edit mode)
- Buttons: Back, Continue, Save & Continue

**Step 5: Ignored Titles** (Edit mode only, not shown in add mode)
- Same read-only table as current IgnoredTitlesForm
- Buttons: Back only (read-only step)

#### Edit Mode Steps

**Step 1: Provider Details** (replaces Basic Details)
- Provider ID shown as header/preview (read-only, not editable)
- Provider Type shown as header/preview (read-only, not editable)
- Same form fields as Add Mode Step 2
- Validation: Same credential validation on Continue/Save & Continue
- Buttons: Continue, Save & Continue (no back button)

**Step 2: Cleanup Rules** (Xtream only)
- Same as Add Mode Step 3
- Buttons: Back, Continue, Save & Continue

**Step 3: Categories** (Xtream only)
- Same as Add Mode Step 4
- Buttons: Back, Continue, Save & Continue

**Step 4: Ignored Titles**
- Same as Add Mode Step 5
- Buttons: Back only

### Wizard Behavior

#### Step Preview

**Visual Design:**
- Vertical list of all steps on left side (or top in mobile)
- Current step: Expanded with full form
- Previous steps: Collapsed, showing step title and completion status (checkmark if completed)
- Future steps: Collapsed, showing step title only (preview mode)
- Clicking on collapsed step: Expand it (with unsaved changes warning if applicable)

**Step States:**
- **Active**: Current step, fully expanded
- **Completed**: Previous step, collapsed with checkmark
- **Preview**: Future step, collapsed, title only
- **Disabled**: Step not applicable (e.g., Cleanup Rules for AGTV)

#### Navigation

**Back Button:**
- Available on all steps except first step
- Collapses current step, expands previous step
- Shows warning if there are unsaved changes (optional)

**Continue Button:**
- Validates current step
- If validation passes: Collapse current step, expand next step
- If validation fails: Show error, keep current step expanded

**Save & Continue Button:**
- Validates current step
- Calls add/update API endpoint
- If successful:
  - In add mode: Switch to edit mode (provider now exists)
  - In edit mode: Update local state
  - Collapse current step, expand next step
- If failed: Show error, keep current step expanded

#### Validation Logic

**Step 1 (Add Mode - Basic Details):**
- ID validation:
  - Non-empty
  - Unique (check against existing providers via API)
  - Valid format (alphanumeric, hyphens, underscores)
- Type validation:
  - Must be selected (Xtream or AGTV)

**Step 2 (Provider Details):**
- URL validation:
  - At least one URL required
  - Valid URL format
  - For Xtream: API URL must be selected from URLs list
- Credential validation:
  - Triggered on Continue or Save & Continue
  - Call validation API endpoint with selected API URL, username, password
  - Show loading spinner during validation
  - On success: Allow proceeding
  - On failure: Show error message, prevent proceeding

**Step 3 (Cleanup Rules):**
- No specific validation (optional step)
- Pattern/replacement can be empty

**Step 4 (Categories):**
- No validation required (all categories optional)
- Auto-save on toggle (or batch save on Save & Continue)

**Step 5 (Ignored Titles):**
- Read-only, no validation

#### Save & Continue Behavior

**Add Mode:**
- First Save & Continue creates the provider
- After first save, wizard switches to edit mode
- All subsequent steps behave as in edit mode
- Provider ID and type become read-only (shown in header)

**Edit Mode:**
- Save & Continue updates the provider
- Provider ID and type remain read-only
- Updates are persisted immediately

#### Step Collapsing/Expanding

**Auto-Collapse:**
- When moving to next step: Previous step auto-collapses
- Collapsed step shows:
  - Step title
  - Completion indicator (checkmark if data saved)
  - Summary of entered data (optional, e.g., "3 URLs configured")

**Manual Expand:**
- User can click on collapsed step to expand it
- If there are unsaved changes in current step: Show warning dialog
- If no unsaved changes: Expand clicked step, collapse current step

## Implementation Details

### Frontend Changes

#### New Component: ProviderWizard.jsx

**Structure:**
```jsx
<ProviderWizard
  provider={provider} // null for add mode, provider object for edit mode
  onSave={handleSave}
  onCancel={handleCancel}
/>
```

**State Management:**
- `currentStep`: Current active step index
- `completedSteps`: Set of completed step indices
- `stepData`: Object storing data for each step
- `validationErrors`: Object storing validation errors per step
- `isValidating`: Boolean for credential validation loading state

**Step Components:**
- `BasicDetailsStep.jsx` - Step 1 (Add mode only)
- `ProviderDetailsStep.jsx` - Step 2 (Add) / Step 1 (Edit)
- `CleanupRulesStep.jsx` - Step 3 (Add) / Step 2 (Edit), Xtream only
- `CategoriesStep.jsx` - Step 4 (Add) / Step 3 (Edit), Xtream only
- `IgnoredTitlesStep.jsx` - Step 5 (Edit mode only)

**Wizard Navigation:**
- `WizardStepper.jsx` - Vertical stepper component showing all steps
- `WizardStepContent.jsx` - Container for step content with buttons

#### Updated Component: SettingsIPTVProviders.jsx

**Changes:**
- Replace Dialog with ProviderWizard component
- Remove tab-based navigation
- Update provider list to open wizard instead of dialog

#### New API Endpoint: Validate Credentials

**Endpoint:** `POST /api/iptv/providers/validate`

**Request:**
```json
{
  "api_url": "https://example.com:8080",
  "username": "user123",
  "password": "pass123",
  "type": "xtream" // or "agtv"
}
```

**Response (Success):**
```json
{
  "success": true,
  "valid": true,
  "provider_details": {
    "expiration_date": 1234567890,
    "max_connections": 5,
    "active_connections": 2
  }
}
```

**Response (Failure):**
```json
{
  "success": false,
  "valid": false,
  "error": "Invalid credentials"
}
```

#### Updated API Endpoint: Get Categories

**Endpoint:** `GET /api/iptv/providers/:providerId/categories`

**Changes:**
- Return all categories (movies + tvshows) in single response
- Include `type` field in each category object
- Frontend filters by type and search query client-side

**Response:**
```json
{
  "success": true,
  "categories": [
    {
      "key": "movies-1",
      "type": "movies",
      "category_name": "Action",
      "enabled": true
    },
    {
      "key": "tvshows-2",
      "type": "tvshows",
      "category_name": "Drama",
      "enabled": false
    }
  ]
}
```

### Backend Changes

#### New Route: Validate Credentials

**File:** `web-api/src/routes/ProvidersRouter.js`

**Implementation:**
```javascript
router.post('/validate', async (req, res) => {
  try {
    const { api_url, username, password, type } = req.body;
    
    // Validate required fields
    if (!api_url || !username || !password || !type) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }
    
    // Create temporary provider config
    const tempProvider = {
      api_url,
      username,
      password,
      type: type.toLowerCase()
    };
    
    // Get provider instance based on type
    const provider = type.toLowerCase() === 'xtream' 
      ? new XtreamProvider({ temp: tempProvider })
      : new AGTVProvider({ temp: tempProvider });
    
    // Attempt authentication
    const providerDetails = await provider.authenticate('temp');
    
    return res.json({
      success: true,
      valid: true,
      provider_details: providerDetails
    });
  } catch (error) {
    return res.status(200).json({
      success: false,
      valid: false,
      error: error.message || 'Invalid credentials'
    });
  }
});
```

#### Updated Route: Get Categories

**File:** `web-api/src/routes/ProvidersRouter.js`

**Changes:**
- Ensure all categories (movies + tvshows) are returned in single call
- No filtering needed (frontend handles it)

### UI/UX Enhancements

#### Step Preview Component

**Design:**
- Vertical stepper on left (desktop) or top (mobile)
- Each step shows:
  - Step number
  - Step title
  - Status icon (active, completed, preview, disabled)
  - Optional summary text for completed steps

**Interaction:**
- Click to expand (with unsaved changes warning)
- Visual indication of current step
- Disabled state for non-applicable steps

#### Validation Feedback

**Inline Validation:**
- Show error messages below fields
- Highlight invalid fields with red border
- Disable Continue/Save & Continue buttons if validation fails

**Credential Validation:**
- Show loading spinner during validation
- Display success/error message
- Prevent navigation on failure

#### Responsive Design

**Mobile:**
- Vertical stepper at top instead of side
- Full-width step content
- Stack buttons vertically if needed

**Desktop:**
- Side-by-side layout (stepper left, content right)
- Collapsible stepper for more content space

## Migration Strategy

### Backward Compatibility

**No Breaking Changes:**
- Existing API endpoints remain unchanged
- New endpoints are additive
- Existing provider data structure unchanged

### Gradual Rollout

**Phase 1:**
- Implement wizard UI alongside existing tab UI
- Add feature flag to toggle between wizard and tabs
- Test with beta users

**Phase 2:**
- Make wizard default, keep tabs as fallback
- Gather user feedback

**Phase 3:**
- Remove tab-based UI
- Wizard becomes only interface

## Testing Considerations

### Unit Tests

1. **Step Validation:**
   - Test ID uniqueness validation
   - Test credential validation success/failure
   - Test step navigation logic

2. **Wizard State:**
   - Test step collapsing/expanding
   - Test save & continue in add mode
   - Test mode switching (add → edit)

3. **Step Components:**
   - Test each step component independently
   - Test conditional rendering (Xtream vs AGTV)

### Integration Tests

1. **Full Wizard Flow:**
   - Add new Xtream provider through all steps
   - Add new AGTV provider (fewer steps)
   - Edit existing provider
   - Save & continue at each step

2. **Validation:**
   - Test credential validation with valid/invalid credentials
   - Test ID uniqueness check
   - Test error handling

3. **Categories:**
   - Test filtering by media type
   - Test search functionality
   - Test batch save

### Edge Cases

1. **Network Errors:**
   - Credential validation fails due to network
   - Save & continue fails due to network
   - Show appropriate error messages

2. **Concurrent Edits:**
   - User A editing provider while User B also editing
   - Handle conflicts gracefully

3. **Large Category Lists:**
   - Performance with 1000+ categories
   - Client-side filtering performance

## Future Enhancements

1. **Auto-Save:**
   - Auto-save on step completion
   - Restore unsaved changes on wizard reopen

2. **Step Skipping:**
   - Allow skipping optional steps (with confirmation)

3. **Bulk Operations:**
   - Import provider configuration from file
   - Export provider configuration

4. **Validation Improvements:**
   - Real-time validation as user types
   - Suggest available provider IDs

5. **Tutorial Mode:**
   - First-time user guide
   - Tooltips explaining each step

## Rollout Plan

### Phase 1: Backend (Week 1)
1. Implement credential validation endpoint
2. Update categories endpoint to return all categories
3. Add unit tests

### Phase 2: Frontend Core (Week 2)
1. Create ProviderWizard component
2. Implement step components
3. Implement wizard navigation logic
4. Add basic styling

### Phase 3: Validation & Polish (Week 3)
1. Implement all validation logic
2. Add loading states and error handling
3. Implement step preview/collapse
4. Polish UI/UX

### Phase 4: Testing & Refinement (Week 4)
1. Comprehensive testing
2. Bug fixes
3. Performance optimization
4. User feedback collection

### Phase 5: Deployment (Week 5)
1. Deploy with feature flag
2. Monitor for issues
3. Gather user feedback
4. Iterate based on feedback

