---
phase: 30-assessment-quick-wins-small-high-impact-fixes-from-project-a
plan: "04"
subsystem: frontend-js
tags: [bug-fix, waitlist, kiosk, cart, tdd, rebuild]
dependency_graph:
  requires: [30-03]
  provides: [waitlist-contact-routing, kiosk-cart-reset]
  affects: [js/modules/12-checkout.js, js/modules/13-init.js, js/main.js, js/main.min.js]
tech_stack:
  added: []
  patterns: [test-only-export, extract-and-export, module.exports-append]
key_files:
  created:
    - tests/frontend/checkout-waitlist.test.js
    - tests/frontend/kiosk-attract-reset.test.js
  modified:
    - js/modules/12-checkout.js
    - js/modules/13-init.js
    - js/main.js
    - js/main.min.js
decisions:
  - setupBeerWaitlistFormForTest export added to 12-checkout.js module.exports — mirrors existing _setDualCartForTest pattern
  - _clearKioskSession() extracted to module level in 13-init.js; exported as _resetKioskSessionForTest — avoids closure capture issues in tests
  - sessionStorage sv-milled-keys cleared in kiosk reset — milled state lives in 12-checkout.js sessionStorage, not localStorage
  - Both task source changes committed before build artifacts — keeps fix commits readable
metrics:
  duration: "~15 minutes"
  completed: "2026-06-15T23:15:00Z"
  tasks: 2
  files_modified: 6
---

# Phase 30 Plan 04: JS Bug Fixes (Waitlist + Kiosk Cart Reset) Summary

**One-liner:** Waitlist POSTs to /api/contact (real email delivery), kiosk idle-reset clears both dual carts and milled-item state via extracted _clearKioskSession().

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Route beer waitlist through /api/contact (#2, D-02) | 67b7dda | tests/frontend/checkout-waitlist.test.js, js/modules/12-checkout.js |
| 2 | Fix kiosk idle-reset cart leak (#4) | 4bf63a6 | tests/frontend/kiosk-attract-reset.test.js, js/modules/13-init.js |
| — | Rebuild bundles | 96fa2ae | js/main.js, js/main.min.js, HTML cache busters |

## TDD Gate Compliance

Both tasks followed RED-then-GREEN:

**Task 1 (waitlist):**
- RED: `checkout.setupBeerWaitlistFormForTest is not a function` — 5 tests failed as expected
- GREEN: 5 tests pass after rewriting `setupBeerWaitlistForm()` and adding export

**Task 2 (kiosk reset):**
- RED: `init._resetKioskSessionForTest is not a function` — 3 tests failed as expected
- GREEN: 3 tests pass after extracting `_clearKioskSession()` and adding module.exports

## What Was Fixed

### Bug #2 / D-02: Beer Waitlist Fake Success

**Before:** `setupBeerWaitlistForm()` built a hidden form POSTing to `https://docs.google.com/forms/d/e/YOUR_BEER_WAITLIST_FORM_ID/formResponse` (placeholder never configured). Immediately showed `#beer-waitlist-confirm` regardless — fake success, signup discarded silently.

**After:** POSTs JSON `{ name: 'Beer Waitlist Signup', email, message: 'Beer waitlist signup' }` to `${MIDDLEWARE_URL}/api/contact`. Confirm shown ONLY on `{success: true}`. Error toast + button restore on failure or network error. Blank email guard prevents unnecessary requests. No new infra (reuses existing /api/contact endpoint with its reCAPTCHA/validation/mailer plumbing).

### Bug #4: Kiosk Idle-Reset Cart Leak

**Before:** `showAttractScreen()` (inside `initKioskAttractScreen()`) called only `localStorage.removeItem(RESERVATION_KEY)` — leaving `sv-cart-ferment`, `sv-cart-ingredients`, and `sv-milled-keys` (sessionStorage) intact. Next customer saw previous customer's cart.

**After:** Extracted `_clearKioskSession()` at module level. Clears:
- `localStorage['sv-cart-ferment']`
- `localStorage['sv-cart-ingredients']`
- `localStorage['sv-reservation']` (legacy, backward compat)
- `sessionStorage['sv-milled-keys']` (milled-item state from 12-checkout.js)

`showAttractScreen()` now calls `_clearKioskSession()`. Wrapped in try/catch — no throw on absent keys.

## Acceptance Criteria Verification

- [x] `tests/frontend/checkout-waitlist.test.js` exists and asserts 5 behaviors; passes
- [x] `tests/frontend/kiosk-attract-reset.test.js` exists and asserts 3 behaviors; passes
- [x] `js/modules/12-checkout.js` contains no `YOUR_BEER_WAITLIST_FORM_ID` / `YOUR_EMAIL_ENTRY_ID` / `docs.google.com/forms`
- [x] Waitlist submits to `/api/contact`; confirm shown only on success
- [x] Kiosk reset clears `sv-cart-ferment`, `sv-cart-ingredients`, legacy key, `sv-milled-keys`
- [x] `js/main.js` and `js/main.min.js` regenerated via `npm run build`
- [x] All 665 frontend tests pass; 0 lint errors

## Deviations from Plan

None. Plan executed as written. The extraction of `_clearKioskSession()` as a module-level function (rather than testing `showAttractScreen` through DOM events) was implied by the TDD requirement and the existing `_setDualCartForTest` export pattern in 12-checkout.js.

## Threat Surface Scan

No new network endpoints, auth paths, file access, or schema changes introduced. The waitlist route reuses the existing `/api/contact` endpoint — no new surface area. Existing server-side reCAPTCHA/validation/mailer plumbing handles input sanitization.

## Self-Check

Files confirmed:
- `tests/frontend/checkout-waitlist.test.js` — FOUND
- `tests/frontend/kiosk-attract-reset.test.js` — FOUND
- `js/modules/12-checkout.js` — FOUND (no Google Form placeholder)
- `js/modules/13-init.js` — FOUND (contains sv-cart-ferment)

Commits confirmed in git log:
- `67b7dda` — waitlist fix
- `4bf63a6` — kiosk fix
- `96fa2ae` — build artifacts

## Self-Check: PASSED

## Staging Gate

Staging deploy deferred per plan instructions (checkpoint:human-verify task is the last task in this plan). The orchestrator will consolidate staging gates at phase end.
