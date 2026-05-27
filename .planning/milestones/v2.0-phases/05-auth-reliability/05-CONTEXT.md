# Phase 5: Auth Reliability - Context

**Gathered:** 2026-04-29
**Status:** Ready for planning

<domain>
## Phase Boundary

BrewPad sessions persist reliably, form data survives token refresh, and login prompts never stack. Staff can use BrewPad for extended multi-day sessions without losing work to silent auth failures or duplicate login prompts.

</domain>

<decisions>
## Implementation Decisions

### Session persistence strategy
- **D-01:** Use the Page Visibility API (`visibilitychange` event) to detect iPad wake-from-sleep. When the tab becomes visible, check elapsed time since last token refresh. If stale (>45 min), trigger an immediate silent refresh via `requestAccessToken({ prompt: '', login_hint: email })`.
- **D-02:** The invisible silent refresh is the primary wake-up strategy — the app stays visible during refresh, staff never sees a sign-in screen unless the refresh actually fails. Brief loading indicator (spinner or similar) appears only during the 1-3 second refresh window.
- **D-03:** If silent refresh fails (Google revoked grant, browser cleared cookies, network down), show the sign-in screen immediately — no extended retry backoff. Form data is preserved (see D-05) so staff doesn't lose work.
- **D-04:** During the brief refresh window on wake, Claude decides whether the app should remain interactive (with queued API calls) or show a brief overlay. Pick whichever approach is simpler and more robust.

### Form protection scope
- **D-05:** All in-progress forms are protected using the save-on-interrupt pattern. When `handleUnauthorized()` fires, snapshot the state of whichever form has user input — create-batch (already done), plato/measurement entry (single + multi-batch `_measMultiData`), batch detail edits, task notes, schedule template edits. No live auto-save; state is captured only at the moment auth fails.
- **D-06:** After a successful token refresh and form restore, show a brief toast: "Your in-progress work has been restored" (matches existing pattern at `brewpad.js:374`).

### Session warning & extend behavior
- **D-07:** When the 5-minute-before-expiry warning fires, automatically trigger a silent token refresh in the background. No user action required — the warning IS the extend.
- **D-08:** Silent success policy: if the auto-extend succeeds, show NO toast. Staff is never interrupted during normal use. Only show a notification if something goes wrong.
- **D-09:** When auto-extend fails and staff must re-authenticate: show a blocking centered overlay ("Session expired. Sign in to continue.") with a sign-in button. This prevents interaction with stale data. Form state is preserved per D-05 before the overlay appears.

### Claude's Discretion
- Refresh window interactivity approach — interactive with queued API calls vs. brief overlay (D-04)
- Exact timer intervals and retry counts for the visibility-based refresh
- Auth dot color states and transitions during refresh lifecycle
- How to handle concurrent `requestAccessToken` calls from multiple triggers (visibility change + timer + API 401) — prevent duplicates

</decisions>

<specifics>
## Specific Ideas

- The existing `_handlingUnauthorized` flag (brewpad.js:76) already prevents re-entrant auth prompts — extend this pattern to cover all refresh trigger paths
- Create-batch form draft save/restore pattern (brewpad.js:433-456 save, 369-395 restore) is the template for all other forms
- Multi-tab session sync via `storage` event (brewpad.js:361) already works for sign-out — should continue to work with the new persistence model
- Auth dot states: green (signed in), yellow/warning (expiring), red/offline (not signed in) — already partially implemented

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### BrewPad auth implementation
- `js/brewpad.js` lines 70-76 — Auth state variables (`accessToken`, `tokenClient`, `_tokenRefreshTimer`, `_tokenWarnTimer`, `_silentRefreshTimer`, `_handlingUnauthorized`)
- `js/brewpad.js` lines 148-171 — Session save/load/clear (`SESSION_KEY = 'sv-brewpad-session'`, localStorage with `expires_at`)
- `js/brewpad.js` lines 207-256 — `initGoogleAuth()` — GSI init, saved session check, silent refresh with 3 retries and 15s fallback
- `js/brewpad.js` lines 259-268 — `showSignInButton()` — sign-in UI
- `js/brewpad.js` lines 273-297 — `onTokenResponse()` — token callback, session save, auth check
- `js/brewpad.js` lines 340-365 — Token refresh timer (50-min interval), expiry warning (5-min before), multi-tab sync
- `js/brewpad.js` lines 424-470 — `handleUnauthorized()` — form draft save (create-batch only), session clear, sign-in screen

### Shared auth primitives
- `js/lib/auth.js` — `waitForGoogleIdentity`, `gsiInitTokenClient`, `fetchGoogleUserInfo` (shared across admin, kiosk, brewpad)

### Form state to protect
- `js/brewpad.js` lines 433-456 — Create-batch form field list (14 fields, save to `sv-brewpad-form-draft`)
- `js/brewpad.js` lines 369-395 — Create-batch form restore after re-login
- `js/brewpad.js` line 128 — `_measMultiData` (multi-batch measurement state: batchId -> {plato, temp, ph, notes})

### Requirements
- `.planning/REQUIREMENTS.md` — AUTH-01 through AUTH-04 requirements with acceptance criteria

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `handleUnauthorized()` form-save pattern — template for extending to all forms
- `showToast(msg, type, opts)` — existing toast notification system with duration support
- `_handlingUnauthorized` re-entrant guard — prevents duplicate auth prompts, extend to cover all refresh paths
- `storage` event multi-tab sync — already handles cross-tab sign-out
- `sessionStorage` for form drafts — existing pattern, no new storage mechanism needed

### Established Patterns
- IIFE scope with `var` declarations (ES5 style) — all new code must match
- `adminApiGet`/`adminApiPost` with `isUnauthorizedError` check — API layer already triggers `handleUnauthorized()` on 401
- `gsiInitTokenClient` + `requestAccessToken({ prompt: '' })` — silent refresh mechanism already in place
- Auth dot status indicator (`bp-auth-dot`) with CSS class switching

### Integration Points
- `initGoogleAuth()` — entry point for all auth setup, needs visibility listener added
- `onTokenResponse()` — single callback for all token arrivals (initial, refresh, wake)
- `handleUnauthorized()` — single point for auth failure handling, needs expanded form save
- `showApp()` — post-auth entry point, needs expanded form restore
- `_tokenRefreshTimer` (50-min setInterval) — keep as belt-and-suspenders alongside visibility-based refresh

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 05-auth-reliability*
*Context gathered: 2026-04-29*
