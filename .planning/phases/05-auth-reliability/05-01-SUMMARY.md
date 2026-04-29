---
phase: 05-auth-reliability
plan: 01
subsystem: auth
tags: [google-oauth, gsi, visibility-api, ipad-safari, session-persistence, mutex]

# Dependency graph
requires: []
provides:
  - tryRefreshToken() mutex function — single entry point for all token refresh triggers
  - _refreshInFlight boolean mutex preventing concurrent requestAccessToken calls
  - visibilitychange listener detecting iPad wake-from-sleep and triggering refresh if >45min elapsed
  - 7-day session persistence via login_at field in sv-brewpad-session localStorage
  - error_callback on gsiInitTokenClient for popup failure detection
  - bp-auth-dot--refreshing CSS animation (pulsing green during refresh)
  - bp-session-overlay CSS styles (centered blocking overlay, z-index 1000)
affects:
  - 05-02 (form state protection — uses tryRefreshToken and session overlay infrastructure)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Refresh mutex pattern: _refreshInFlight boolean guards all requestAccessToken call sites
    - Visibility-based wake detection: visibilitychange + elapsed time check against _lastTokenTime
    - Decoupled session persistence: email/login_at survives token expiry (7 days), token stored separately
    - Single-entry-point refresh: all trigger paths (visibility, interval, warning timer, 401) route through tryRefreshToken()

key-files:
  created: []
  modified:
    - js/brewpad.js
    - css/brewpad.css
    - css/brewpad.min.css
    - js/brewpad.min.js
    - brewpad.html

key-decisions:
  - "D-07 implemented: 5-min warning timer calls tryRefreshToken() instead of showToast — silent auto-refresh with no interruption"
  - "D-08 implemented: silent success path shows no toast — auth dot returns to green without user interruption"
  - "D-04 resolved: app stays interactive during refresh window (no overlay during normal refresh, only on failure per D-09)"
  - "Preserve login_at across token refreshes by reading raw localStorage before saveSession — avoids circular dependency with loadSession()"

patterns-established:
  - "Mutex guard: check _refreshInFlight || _handlingUnauthorized before any requestAccessToken call"
  - "Auth dot class swap: bp-auth-dot--refreshing during in-flight, bp-auth-dot--online on success, bp-auth-dot--offline on failure"
  - "Session decoupling: login_at persists for 7 days regardless of token expiry; loadSession() returns non-null with tokenValid:false when within 7 days"

requirements-completed:
  - AUTH-01
  - AUTH-03
  - AUTH-04

# Metrics
duration: 13min
completed: 2026-04-29
---

# Phase 5 Plan 01: Auth Refresh Mutex + 7-Day Session Summary

**BrewPad auth hardened: _refreshInFlight mutex, visibilitychange wake detection, 7-day login_at session persistence, and auth dot refreshing animation — all four refresh trigger paths now route through tryRefreshToken()**

## Performance

- **Duration:** 13 min
- **Started:** 2026-04-29T21:27:00Z
- **Completed:** 2026-04-29T21:40:08Z
- **Tasks:** 2
- **Files modified:** 5 (js/brewpad.js, css/brewpad.css + 3 build artifacts)

## Accomplishments
- Single `tryRefreshToken()` function gates all four refresh trigger paths (visibilitychange, 50-min timer, 5-min warning, API 401) behind `_refreshInFlight` mutex — concurrent popup storms are now impossible
- `loadSession()` now returns email + login_at for 7 days even when the 1-hour token has expired, so `login_hint` works on wake-from-sleep without requiring staff to re-enter their Google account
- 5-min warning timer silently auto-refreshes (D-07) instead of showing a toast — zero interruption during normal use
- `error_callback` on `gsiInitTokenClient` clears mutex on popup failure (popup_failed_to_open, popup_closed)
- Auth dot has a 4th pulsing-green `--refreshing` state during active token refresh; session overlay CSS is in place for Plan 02 JS wiring

## Task Commits

Each task was committed atomically:

1. **Task 1: Add refresh mutex, visibility handler, and modified session persistence** - `b2d1863` (feat)
2. **Task 2: Add auth dot refreshing animation, session overlay styles, and build** - `844da87` (feat)

## Files Created/Modified
- `js/brewpad.js` — Added _refreshInFlight, _lastTokenTime, _visibilityListenerAdded state vars; tryRefreshToken() function; modified saveSession/loadSession for 7-day persistence; updated 50-min timer, 5-min warning timer, and onTokenResponse
- `css/brewpad.css` — Added .bp-auth-dot--refreshing with @keyframes bp-auth-dot-pulse; added .bp-session-overlay, .bp-session-overlay--visible, .bp-session-overlay-card styles
- `css/brewpad.min.css` — Rebuilt from source
- `js/brewpad.min.js` — Rebuilt from source
- `brewpad.html` — Cache version bumped by build stamp

## Decisions Made
- D-07 auto-refresh: the 5-min warning `setTimeout` body now calls `tryRefreshToken()` — no toast shown on success (D-08). The existing toast for "Session expiring soon" has been removed from this path.
- D-04 resolved as "interactive during refresh": the app stays fully interactive while `_refreshInFlight` is true. The `--refreshing` dot pulse is the only visual signal. No overlay during normal refresh — overlay is only for the D-09 session-expired state (Plan 02).
- `login_at` preservation: before calling `saveSession()` in `onTokenResponse()`, the raw localStorage value is read to extract the existing `login_at`. This avoids circular dependency with the newly-shaped `loadSession()` return value.

## Deviations from Plan

None - plan executed exactly as written. The `_visibilityListenerAdded` flag, `_lastTokenTime` initialization, and `login_at` preservation approach all matched the plan's specified implementation exactly.

## Issues Encountered
None. Lint passes (0 errors, 79 pre-existing warnings). All 254 frontend tests pass. Build succeeds.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Auth dot now has all 4 states (online, warning, refreshing, offline) implemented in CSS
- Session overlay CSS (.bp-session-overlay + .bp-session-overlay-card) is ready for Plan 02 JS wiring
- tryRefreshToken() is the established entry point for Plan 02 to call from handleUnauthorized() after form-save
- Plan 02 (form state protection) can reference: `_refreshInFlight`, `tryRefreshToken()`, `bp-session-overlay` styles

## Threat Flags

No new security surface introduced beyond what the plan's threat model covers. All T-05-01 through T-05-05 dispositions applied as specified (see plan frontmatter).

## Self-Check: PASSED

- `js/brewpad.js` — FOUND (modified in place)
- `css/brewpad.css` — FOUND (modified in place)
- commit `b2d1863` — FOUND
- commit `844da87` — FOUND
- `grep -c "_refreshInFlight" js/brewpad.js` returns 6 (>= 4 required)
- `grep -c "tryRefreshToken" js/brewpad.js` returns 4 (>= 3 required)
- `grep -c "visibilitychange" js/brewpad.js` returns 1 (>= 1 required)
- `grep -c "login_at" js/brewpad.js` returns 5 (>= 3 required)
- `grep -c "bp-auth-dot--refreshing" css/brewpad.css` returns 1 (>= 1 required)
- `grep -c "bp-session-overlay" css/brewpad.css` returns 5 (>= 3 required)
- npm run lint: 0 errors
- npm test: 254 passed

---
*Phase: 05-auth-reliability*
*Completed: 2026-04-29*
