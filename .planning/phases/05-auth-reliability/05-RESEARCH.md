# Phase 5: Auth Reliability - Research

**Researched:** 2026-04-29
**Domain:** Google Identity Services OAuth2 (implicit flow), Page Visibility API, iPad Safari, form state management
**Confidence:** HIGH

## Summary

Phase 5 hardens BrewPad's authentication layer so staff can maintain multi-day sessions on an iPad without losing work. The existing codebase already has the foundation: `requestAccessToken({ prompt: '' })` silent refresh, `_handlingUnauthorized` re-entrant guard, create-batch form draft save/restore, `storage` event multi-tab sync, and auth dot status indicator. The work is primarily about extending these patterns to cover more forms, adding the Page Visibility API wake-detection layer, and preventing concurrent refresh triggers from producing duplicate prompts.

The critical technical constraint is that Google Identity Services (GIS) implicit flow does NOT support truly invisible silent refresh. `requestAccessToken({ prompt: '' })` opens a popup that auto-closes when prior consent exists. On iPad Safari, popups can be blocked unless triggered by a user gesture. The existing code already works around this by triggering the call from `initGoogleAuth()` on page load with a 15-second fallback timer, but the wake-from-sleep refresh path must handle the case where the popup is blocked by Safari by falling back to showing the sign-in button with form state preserved.

**Primary recommendation:** Layer visibility-based refresh on top of the existing 50-minute interval timer (belt-and-suspenders), extend the create-batch draft save pattern to all five form types, and use a single mutex (`_refreshInFlight`) to deduplicate all refresh triggers.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Use the Page Visibility API (`visibilitychange` event) to detect iPad wake-from-sleep. When the tab becomes visible, check elapsed time since last token refresh. If stale (>45 min), trigger an immediate silent refresh via `requestAccessToken({ prompt: '', login_hint: email })`.
- **D-02:** The invisible silent refresh is the primary wake-up strategy -- the app stays visible during refresh, staff never sees a sign-in screen unless the refresh actually fails. Brief loading indicator (spinner or similar) appears only during the 1-3 second refresh window.
- **D-03:** If silent refresh fails (Google revoked grant, browser cleared cookies, network down), show the sign-in screen immediately -- no extended retry backoff. Form data is preserved (see D-05) so staff doesn't lose work.
- **D-04:** During the brief refresh window on wake, Claude decides whether the app should remain interactive (with queued API calls) or show a brief overlay. Pick whichever approach is simpler and more robust.
- **D-05:** All in-progress forms are protected using the save-on-interrupt pattern. When `handleUnauthorized()` fires, snapshot the state of whichever form has user input -- create-batch (already done), plato/measurement entry (single + multi-batch `_measMultiData`), batch detail edits, task notes, schedule template edits. No live auto-save; state is captured only at the moment auth fails.
- **D-06:** After a successful token refresh and form restore, show a brief toast: "Your in-progress work has been restored" (matches existing pattern at `brewpad.js:374`).
- **D-07:** When the 5-minute-before-expiry warning fires, automatically trigger a silent token refresh in the background. No user action required -- the warning IS the extend.
- **D-08:** Silent success policy: if the auto-extend succeeds, show NO toast. Staff is never interrupted during normal use. Only show a notification if something goes wrong.
- **D-09:** When auto-extend fails and staff must re-authenticate: show a blocking centered overlay ("Session expired. Sign in to continue.") with a sign-in button. This prevents interaction with stale data. Form state is preserved per D-05 before the overlay appears.

### Claude's Discretion
- Refresh window interactivity approach -- interactive with queued API calls vs. brief overlay (D-04)
- Exact timer intervals and retry counts for the visibility-based refresh
- Auth dot color states and transitions during refresh lifecycle
- How to handle concurrent `requestAccessToken` calls from multiple triggers (visibility change + timer + API 401) -- prevent duplicates

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-01 | Staff session persists for at least 7 days without re-login | Session persistence via localStorage `sv-brewpad-session` needs modified expiry logic: store email separately from token expiry so `login_hint` survives across token refreshes. Visibility-based + timer-based refresh keeps tokens alive during active use. |
| AUTH-02 | If a token expires mid-session, form data is preserved through the refresh flow | Five form types identified for save-on-interrupt pattern. Existing create-batch draft at `brewpad.js:433-456` is the template. `sessionStorage` storage for drafts. |
| AUTH-03 | Only one login prompt appears at a time (no stacked/duplicate auth dialogs) | Single `_refreshInFlight` mutex across all three trigger paths (visibility, timer, 401). `_handlingUnauthorized` guard already exists at `brewpad.js:76`. |
| AUTH-04 | Staff sees a clear warning before session expires with option to extend | Existing 5-min warning timer at `brewpad.js:345-357` becomes auto-refresh trigger (D-07). Auth dot transitions: online(green) -> refreshing(pulse) -> online(green) or warning(yellow) -> offline(grey). |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Token refresh lifecycle | Browser / Client | -- | All OAuth implicit flow state lives in the browser; GIS library runs client-side only |
| Form state snapshot/restore | Browser / Client | -- | `sessionStorage` is the persistence layer; no server involvement |
| Session persistence (7-day) | Browser / Client | -- | `localStorage` stores email + session metadata for `login_hint` across refreshes |
| Duplicate prompt prevention | Browser / Client | -- | Mutex state is purely in-memory JS variables within the IIFE |
| Auth status indicator | Browser / Client | -- | CSS class toggling on `.bp-auth-dot` element |
| API 401 detection | Browser / Client | API / Backend | Client detects via `isUnauthorizedError()`; server (Apps Script) returns the 401-equivalent |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Google Identity Services (GIS) | Current (loaded from accounts.google.com/gsi/client) | OAuth2 implicit flow token management | Already in use; `requestAccessToken` with `prompt: ''` is the established silent refresh mechanism [VERIFIED: brewpad.html line 25] |
| Page Visibility API | Web standard (no library) | Detect iPad wake-from-sleep and tab focus | W3C standard, supported in Safari iOS 7+; already partially used (`document.hidden` check at brewpad.js:645) [VERIFIED: codebase grep] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| sessionStorage | Web standard | Temporary form draft persistence | For save-on-interrupt pattern; already used for create-batch drafts [VERIFIED: brewpad.js:456] |
| localStorage | Web standard | Long-lived session metadata (email, last refresh time) | For 7-day session persistence; already used for `sv-brewpad-session` [VERIFIED: brewpad.js:150-158] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Page Visibility API | `focus`/`blur` events | Visibility API fires on iPad sleep/wake; focus/blur only fires on window focus changes. Visibility API is the correct choice per D-01. |
| `sessionStorage` for drafts | `localStorage` for drafts | `sessionStorage` is correct: drafts should not persist across explicit sign-out or new tabs. Matches existing pattern. |
| GIS implicit flow | GIS code flow (server-side refresh tokens) | Code flow would give true refresh tokens but requires middleware changes and adds complexity. Existing implicit flow works well for this use case where staff are actively using the iPad. |

**No installation needed.** All dependencies are already present (GIS loaded via CDN, Web APIs are browser-native).

## Architecture Patterns

### System Architecture Diagram

```
iPad Safari Browser
  |
  |-- [visibilitychange event] ----+
  |-- [50-min setInterval timer] --+---> refreshGuard() mutex
  |-- [5-min-before-expiry timer] -+         |
  |-- [API 401 response] ---------+         |
                                             v
                                    _refreshInFlight?
                                     /           \
                                   YES            NO
                                    |              |
                                  (skip)     set _refreshInFlight = true
                                              |
                                              v
                                    requestAccessToken({
                                      prompt: '',
                                      login_hint: email
                                    })
                                              |
                                    +---------+---------+
                                    |                   |
                                  success             error
                                    |                   |
                              onTokenResponse()    D-03: show sign-in
                                    |              (form state preserved)
                              save session
                              reset timers
                              restore forms (if saved)
                              _refreshInFlight = false
```

### Recommended Project Structure
```
js/
  brewpad.js          # All auth reliability changes go here (IIFE scope)
css/
  brewpad.css         # Auth dot animation + session overlay styles
tests/frontend/
  brewpad-auth.test.js  # New test file for auth reliability unit tests
```

No new files beyond one test file. All auth logic stays within the existing `brewpad.js` IIFE.

### Pattern 1: Refresh Mutex (Concurrent Trigger Deduplication)
**What:** A single boolean flag (`_refreshInFlight`) that prevents multiple simultaneous `requestAccessToken` calls from any trigger source.
**When to use:** Every time any code path wants to refresh the token.
**Example:**
```javascript
// Source: Pattern derived from existing _handlingUnauthorized guard (brewpad.js:76, 424-426)
var _refreshInFlight = false;

function tryRefreshToken() {
  if (_refreshInFlight || _handlingUnauthorized) return;
  _refreshInFlight = true;
  try {
    tokenClient.requestAccessToken({ prompt: '', login_hint: userEmail });
  } catch (err) {
    _refreshInFlight = false;
    handleUnauthorized();
  }
}
```

### Pattern 2: Visibility-Based Wake Detection
**What:** `visibilitychange` listener that checks elapsed time since last successful token response and triggers refresh if stale.
**When to use:** Added once in `showApp()` after successful auth.
**Example:**
```javascript
// Source: W3C Page Visibility API (https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event)
var _lastTokenTime = Date.now();

document.addEventListener('visibilitychange', function () {
  if (document.hidden) return;
  if (!accessToken) return;  // not signed in
  var elapsed = Date.now() - _lastTokenTime;
  if (elapsed > 45 * 60 * 1000) {  // 45 minutes
    tryRefreshToken();
  }
});
```

### Pattern 3: Form State Save-on-Interrupt (Generalized)
**What:** A registry of form snapshot functions, each called from `handleUnauthorized()` before clearing session.
**When to use:** Each form type registers its own snapshot/restore function.
**Example:**
```javascript
// Source: Existing pattern at brewpad.js:430-458 (create-batch draft save)
// Generalized to support all form types via a registry array

var _formSavers = [];   // array of { key: string, save: function, restore: function }

function saveAllFormDrafts() {
  _formSavers.forEach(function (saver) {
    var data = saver.save();
    if (data) {
      try { sessionStorage.setItem(saver.key, JSON.stringify(data)); } catch (e) {}
    }
  });
}

function restoreAllFormDrafts() {
  var restored = false;
  _formSavers.forEach(function (saver) {
    try {
      var raw = sessionStorage.getItem(saver.key);
      if (raw) {
        saver.restore(JSON.parse(raw));
        sessionStorage.removeItem(saver.key);
        restored = true;
      }
    } catch (e) {}
  });
  return restored;
}
```

### Pattern 4: Session Expiry Overlay (D-09)
**What:** A blocking centered overlay that prevents interaction when re-authentication is required.
**When to use:** When auto-extend fails AND form state has been preserved.
**Example:**
```javascript
// Source: Design decision D-09
function showSessionExpiredOverlay() {
  var overlay = document.createElement('div');
  overlay.id = 'bp-session-overlay';
  overlay.className = 'bp-session-overlay';
  overlay.innerHTML =
    '<div class="bp-session-overlay-card">' +
    '<h2>Session expired</h2>' +
    '<p>Sign in to continue. Your in-progress work has been saved.</p>' +
    '<button type="button" class="btn" id="bp-session-overlay-signin">Sign in with Google</button>' +
    '</div>';
  document.body.appendChild(overlay);
  document.getElementById('bp-session-overlay-signin').addEventListener('click', function () {
    tokenClient.requestAccessToken();
  });
}
```

### Anti-Patterns to Avoid
- **Multiple `requestAccessToken` calls in parallel:** GIS opens a popup for each call. The mutex pattern MUST be used. Calling from visibility + timer + 401 simultaneously would produce 3 popups.
- **Storing access tokens in localStorage for 7 days:** Access tokens expire in 1 hour and cannot be extended. Store the *email* for 7 days (for `login_hint`), not the token.
- **Retry backoff loops on refresh failure:** D-03 explicitly says NO extended retry. If silent refresh fails, show sign-in immediately.
- **Auto-saving form state on a timer:** D-05 explicitly says NO live auto-save. State is captured only at the moment auth fails.
- **Calling `requestAccessToken` from non-user-gesture context on first visit:** iPad Safari blocks popups not triggered by user gestures. The `visibilitychange` path calls `requestAccessToken({ prompt: '' })` which *may* be blocked on first use. The existing 15-second fallback pattern (brewpad.js:232-236) handles this correctly by showing the sign-in button.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Visibility detection | Custom `focus`/`blur`/`mousemove` idle tracker | `document.addEventListener('visibilitychange')` | W3C standard; fires on iPad sleep/wake; handles all edge cases [CITED: MDN visibilitychange docs] |
| OAuth token management | Custom token refresh via fetch to Google endpoints | GIS `requestAccessToken({ prompt: '' })` | Already handles consent state, popup management, and error callbacks. Reimplementing is fragile. |
| Session persistence | Custom cookie or IndexedDB storage | `localStorage` with JSON | Already the established pattern in `saveSession`/`loadSession`/`clearSession` (brewpad.js:150-172) |
| Duplicate popup prevention | DOM inspection for popup windows | In-memory boolean mutex (`_refreshInFlight`) | Simpler, no DOM dependency, no race conditions with popup lifecycle |

**Key insight:** Every building block already exists in the codebase. This phase is about *composing* existing patterns, not creating new infrastructure.

## Common Pitfalls

### Pitfall 1: iPad Safari Popup Blocking on Wake
**What goes wrong:** `requestAccessToken({ prompt: '' })` called from `visibilitychange` (not a user gesture) gets popup-blocked by Safari. The callback never fires and the app hangs in a loading state.
**Why it happens:** Safari requires popups to be triggered by user gestures. `visibilitychange` is not considered a user gesture.
**How to avoid:** Keep the existing 15-second fallback timer pattern. If `onTokenResponse` is not called within N seconds after `tryRefreshToken()`, assume the popup was blocked and show the sign-in button (which IS triggered by a user gesture). The brief overlay (D-02) serves as the loading state during this window.
**Warning signs:** `error_callback` with `popup_failed_to_open` or `popup_closed` (if `error_callback` is wired up). Alternatively, the 15-second timer fires.

### Pitfall 2: Multiple Concurrent Refresh Triggers
**What goes wrong:** Visibility change fires, then the 50-min timer fires 2 seconds later, then an API 401 arrives -- three `requestAccessToken` calls produce three popup windows.
**Why it happens:** The existing `_handlingUnauthorized` guard only covers the 401 path. The timer and visibility paths have no guard.
**How to avoid:** Single `_refreshInFlight` mutex checked by ALL paths before calling `requestAccessToken`. Reset in `onTokenResponse` callback (both success and error).
**Warning signs:** Multiple popup windows appearing, or `popup_closed` errors in the console.

### Pitfall 3: `loadSession()` Rejecting Valid Sessions
**What goes wrong:** `loadSession()` returns `null` for sessions expiring within 5 minutes (brewpad.js:165). This means after a token expires (1 hour), `loadSession()` will always return `null` and the email for `login_hint` is lost.
**Why it happens:** The current implementation ties token validity to session validity. For 7-day persistence, the "is this session still usable" check and the "do I have an email for login_hint" check need to be separated.
**How to avoid:** Store email and last-login timestamp separately from token expiry. `loadSession()` should return the email even if the token is expired, so `requestAccessToken({ login_hint: email })` can be called. Only clear the email on explicit sign-out or after 7 days.
**Warning signs:** Staff having to re-enter their Google account every time they return to BrewPad after 1+ hour idle.

### Pitfall 4: `sessionStorage` Cleared on iPad Safari Tab Close
**What goes wrong:** Form drafts saved in `sessionStorage` are lost if the user closes the Safari tab and reopens the bookmark.
**Why it happens:** `sessionStorage` is scoped to the tab lifecycle. If BrewPad is a home screen bookmark (web app), closing and reopening creates a new `sessionStorage` context.
**How to avoid:** This is acceptable per D-05 -- drafts are only meant to survive brief auth interruptions, not full app restarts. The CONTEXT says "no live auto-save" and state is captured "only at the moment auth fails." `sessionStorage` is the correct choice. `localStorage` would risk stale drafts persisting indefinitely.
**Warning signs:** None -- this is expected behavior.

### Pitfall 5: Timer Drift After iPad Sleep
**What goes wrong:** `setInterval` and `setTimeout` timers pause when iPad sleeps. After waking, the 50-minute refresh timer may be behind, or the 5-minute warning timer may have "expired" in sleep time but never fired.
**Why it happens:** iOS suspends JavaScript execution during sleep. Timers resume but their intended wall-clock deadlines have passed.
**How to avoid:** The `visibilitychange` handler IS the solution to this -- it checks elapsed wall-clock time, not timer state. On wake, it sees "45+ minutes have passed" regardless of whether the 50-minute timer fired. Keep BOTH: visibility handler for wake-from-sleep, interval timer for active-use refresh. Reset all timers on successful token response.
**Warning signs:** Token expiry without a refresh attempt after iPad wake.

### Pitfall 6: Form Restore Timing
**What goes wrong:** `showApp()` calls form restore before the DOM has rendered the form elements, so `getElementById` returns `null` and draft data is silently lost.
**Why it happens:** The existing create-batch restore uses a 150ms `setTimeout` (brewpad.js:378) to wait for DOM rendering. Other forms may need similar timing.
**How to avoid:** Use the same `setTimeout(fn, 150)` pattern used by the existing create-batch restore. Or, check if the form elements exist and defer restore until the appropriate tab/panel is switched to.
**Warning signs:** Draft data in `sessionStorage` but form fields are empty after restore.

## Code Examples

### GIS `requestAccessToken` with `prompt: ''` (Existing Pattern)
```javascript
// Source: brewpad.js:240 (existing silent refresh on page load)
tokenClient.requestAccessToken({ prompt: '', login_hint: saved.email });
```
Per official GIS docs: `prompt: ''` means "The user will be prompted only the first time your app requests access." [CITED: https://developers.google.com/identity/oauth2/web/reference/js-reference]

This opens a popup that auto-closes if consent was previously granted. It is NOT truly invisible -- a brief popup flicker may be visible. On iPad Safari, this popup may be blocked if not triggered by a user gesture.

### GIS `error_callback` (Not Currently Used)
```javascript
// Source: GIS JS reference (https://developers.google.com/identity/oauth2/web/reference/js-reference)
// error_callback receives non-OAuth errors: popup_failed_to_open, popup_closed, unknown
tokenClient = gsiInitTokenClient({
  client_id: SHEETS_CONFIG.CLIENT_ID,
  scope: SHEETS_CONFIG.SCOPES + ' https://www.googleapis.com/auth/userinfo.email',
  callback: onTokenResponse,
  error_callback: function (err) {
    // err.type is one of: 'popup_failed_to_open', 'popup_closed', 'unknown'
    _refreshInFlight = false;
    if (accessToken) {
      // Was signed in, refresh failed -- show sign-in per D-03
      handleUnauthorized();
    }
  }
});
```
**Recommendation:** Add `error_callback` to the existing `gsiInitTokenClient` call. This provides faster detection of popup failures than the 15-second timeout fallback. [CITED: https://developers.google.com/identity/oauth2/web/reference/js-reference]

### Page Visibility API
```javascript
// Source: MDN (https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event)
document.addEventListener('visibilitychange', function () {
  if (!document.hidden) {
    // Page became visible -- check if refresh needed
  }
});
```
Supported in Safari iOS 7+ (iPadOS 7+). [CITED: MDN Page Visibility API compatibility table]

### Existing Form Save Pattern (Template for Extension)
```javascript
// Source: brewpad.js:430-458 (existing create-batch form save)
var createSheet = document.getElementById('bp-create-sheet');
if (createSheet && createSheet.style.display !== 'none') {
  var formState = {};
  var draftFields = [
    ['bp-new-product-text', 'productText'],
    // ... 14 fields total
  ];
  var hasData = false;
  for (var i = 0; i < draftFields.length; i++) {
    var el = document.getElementById(draftFields[i][0]);
    if (el && el.value) { formState[draftFields[i][1]] = el.value; hasData = true; }
  }
  if (hasData) {
    try { sessionStorage.setItem('sv-brewpad-form-draft', JSON.stringify(formState)); } catch (e) {}
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `gapi.auth2` with automatic token refresh | GIS `requestAccessToken` (no auto-refresh) | 2022 (Google deprecated gapi.auth2) | Must manually manage token refresh via `requestAccessToken` calls |
| Third-party cookie silent iframe refresh | `requestAccessToken({ prompt: '' })` popup | 2024 (Chrome 3P cookie phase-out) | Silent iframe approach deprecated; popup is the only GIS mechanism |
| `webkitVisibilityState` (vendor prefix) | Standard `document.visibilityState` | Safari 6.1+ (2013) | No prefix needed; standard API fully supported on all target devices |

**Deprecated/outdated:**
- `gapi.auth2.init()` with `ux_mode: 'none'`: Deprecated by Google, replaced by GIS library. The existing codebase correctly uses GIS.
- `document.webkitHidden`: Safari dropped the prefix years ago. Use `document.hidden`.

## Five Form Types Requiring Save-on-Interrupt

This inventory maps to D-05 and AUTH-02. Each form type needs a save function (called from `handleUnauthorized()`) and a restore function (called from `showApp()` after re-login).

| # | Form Type | Current Save? | Storage Key | State to Capture | Restore Trigger |
|---|-----------|--------------|-------------|-----------------|-----------------|
| 1 | Create-batch sheet | YES (brewpad.js:430-458) | `sv-brewpad-form-draft` | 14 input fields | `showApp()` with 150ms delay |
| 2 | Multi-batch measurement grid | NO | `sv-brewpad-meas-draft` | `_measMultiData` object + `_measSharedDate` | Tab switch to measurements |
| 3 | Batch detail (location + notes) | NO | `sv-brewpad-detail-draft` | vessel, shelf, bin, notes textarea, `_detailBatchId` | `openBatchDetail()` after re-login |
| 4 | Single-reading entry (in batch detail) | NO | `sv-brewpad-reading-draft` | 5 input fields (date, plato, temp, pH, notes) + staging array `_detailPlatoStaging` + `_detailBatchId` | `renderBatchDetail()` after re-login |
| 5 | Schedule template editor | NO | `sv-brewpad-sched-draft` | name, description, category, `_schedSteps` array, packaging title/desc, editing schedule_id | `openSchedSheet()` after re-login |

[VERIFIED: All form types identified by reading brewpad.js source code]

## Auth Dot State Machine

Current states (brewpad.css:293-295):
- `bp-auth-dot--online` (green): Signed in, token valid
- `bp-auth-dot--warning` (yellow): Session expiring soon
- `bp-auth-dot--offline` (grey): Not signed in

**Recommended additions for refresh lifecycle:**
- `bp-auth-dot--refreshing`: Pulsing green (CSS animation) during active token refresh
- Transitions: online -> refreshing -> online (success) or refreshing -> offline (failure)
- Warning timer now triggers auto-refresh (D-07), so: online -> refreshing -> online (silent success, no warning shown)

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `requestAccessToken({ prompt: '' })` from `visibilitychange` handler will work on iPad Safari (popup auto-closes) because the Google session cookie persists | Pitfall 1 | If popup is always blocked from non-gesture context, the visibility-based refresh will never work silently and staff will always need to tap a button. Mitigated by the sign-in button fallback (D-03). |
| A2 | iPad Safari fires `visibilitychange` when waking from sleep/screen-off | Architecture Patterns | If it doesn't fire, the 50-min interval timer is the only refresh trigger after wake. Staff would see an expired session until the next timer tick or API 401. Risk is LOW because Safari iOS is documented as detecting "screen is off" via visibility API. |
| A3 | Google OAuth access tokens expire in 3600 seconds (1 hour) | Common Pitfalls | If Google changes this, the 45-minute staleness threshold may need adjustment. Very unlikely to change without notice. |
| A4 | `sessionStorage` persists across `visibilitychange` cycles (iPad sleep/wake) within the same tab | Form Protection | If sessionStorage is cleared on iPad sleep, form drafts would be lost. This would be a Safari bug, not expected behavior. |

## Open Questions

1. **iPad Safari popup behavior with `prompt: ''` from non-gesture context**
   - What we know: The GIS reference says `prompt: ''` means "prompted only first time." The existing code uses this pattern on page load (brewpad.js:240) and it works.
   - What's unclear: Whether Safari treats `visibilitychange` handlers the same as page load for popup allowlisting. Testing on real iPad needed.
   - Recommendation: Implement with fallback timer. If the popup is blocked, the error_callback (if wired) or the fallback timer catches it and shows sign-in button. This is exactly the existing pattern.

2. **D-04: Overlay vs. interactive during refresh window**
   - What we know: The refresh via `requestAccessToken({ prompt: '' })` typically takes 1-3 seconds. During this time, the user could interact with the app and trigger API calls that would fail with 401.
   - What's unclear: Whether queuing API calls during refresh is worth the complexity.
   - Recommendation: **Brief semi-transparent overlay** (no interaction blocking). Simpler and more robust. If refresh succeeds (1-3 sec), overlay disappears. If it fails, overlay transitions to the D-09 blocking sign-in overlay. No need to build API call queuing infrastructure.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Build (`npm run build`) | Yes | v20.17.0 | -- |
| npm | Test + Build | Yes | 10.9.0 | -- |
| Jest (jsdom) | Frontend tests | Yes | In package.json | -- |
| GIS library (CDN) | OAuth | Yes (CDN) | Current | -- |
| iPad Safari | Target runtime | N/A (deployment target) | iPadOS 16+ | -- |

No missing dependencies.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes | Google Identity Services (OAuth2 implicit flow via GIS) -- delegated to Google |
| V3 Session Management | Yes | `localStorage` session with 7-day expiry; `clearSession()` on sign-out; `storage` event multi-tab sync |
| V4 Access Control | No | Authorization is handled by Apps Script `check_auth` -- not in scope for this phase |
| V5 Input Validation | No | No user-facing input changes; form data is existing fields |
| V6 Cryptography | No | No crypto operations in this phase |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Token stored in localStorage accessible to XSS | Information Disclosure | Existing risk accepted (GitHub Pages CSP, no user-generated content). Token expires in 1 hour. No change in this phase. |
| Session fixation via crafted `sv-brewpad-session` localStorage value | Spoofing | `checkAuthorization()` call after every token response verifies the token against Apps Script. Forged sessions fail auth check. |
| Form draft data in sessionStorage | Information Disclosure | Drafts contain batch data (not PII beyond customer names already visible in the UI). sessionStorage is cleared on tab close. Acceptable risk. |
| Stale token used for API call during refresh window | Elevation of Privilege | `isUnauthorizedError()` check on every API response triggers `handleUnauthorized()`. Server rejects stale tokens. |

## Sources

### Primary (HIGH confidence)
- `js/brewpad.js` (3868 lines) -- complete auth implementation read and analyzed
- `js/lib/auth.js` -- shared OAuth primitives read
- `brewpad.html` -- DOM structure for auth elements verified
- `css/brewpad.css` -- auth dot CSS classes verified
- [GIS JS Reference](https://developers.google.com/identity/oauth2/web/reference/js-reference) -- `requestAccessToken` overrideConfig, `prompt` parameter values, `error_callback` types
- [GIS Token Model Guide](https://developers.google.com/identity/oauth2/web/guides/use-token-model) -- token expiry behavior, user gesture requirements
- [MDN Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event) -- event specification and browser support

### Secondary (MEDIUM confidence)
- [Page Visibility API Quirks (Matt Joseph)](https://mattj.io/posts/2023-02-01-page-visibility-api/) -- iPad Safari specific behavior (detects screen-off, misses some dialogs)
- [GIS popup issues (GitHub #816)](https://github.com/google/google-api-javascript-client/issues/816) -- popup_closed/popup_failed_to_open error handling
- [GIS popup blocking on iOS (GitHub #925)](https://github.com/google/google-api-javascript-client/issues/925) -- Safari blocks popups not from user gesture

### Tertiary (LOW confidence)
- A1/A2 assumptions about iPad Safari behavior with GIS popups from visibilitychange -- needs real-device testing

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in use, no new dependencies
- Architecture: HIGH -- extending well-established patterns in existing codebase
- Pitfalls: HIGH -- identified from official docs, codebase analysis, and known iPad Safari quirks
- Form inventory: HIGH -- all five form types identified and analyzed from source code
- iPad Safari popup behavior: MEDIUM -- documented in community sources but needs device testing

**Research date:** 2026-04-29
**Valid until:** 2026-05-29 (stable domain; GIS API changes are infrequent)
