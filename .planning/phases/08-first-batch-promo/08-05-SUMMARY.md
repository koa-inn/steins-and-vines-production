---
phase: 08-first-batch-promo
plan: 05
subsystem: checkout
tags: [localStorage, form-persistence, checkout, tdd, vanilla-js]

# Dependency graph
requires:
  - phase: 08-first-batch-promo
    provides: [12-checkout.js with dual-cart and promo code infrastructure]
provides:
  - saveCheckoutFormDraft / restoreCheckoutFormDraft / clearCheckoutFormDraft functions in 12-checkout.js
  - Auto-save of name/email/phone on input, auto-restore on page load
  - Form draft cleared on successful checkout (both dual-cart and single-cart paths)
affects: [checkout, reservation.html, form UX]

# Tech tracking
tech-stack:
  added: []
  patterns: [localStorage draft key sv-checkout-form-draft, named key constant _FORM_DRAFT_KEY following FERMENT_CART_KEY/INGREDIENT_CART_KEY convention, try/catch wrapping all localStorage operations]

key-files:
  created:
    - tests/frontend/checkout-form-persistence.test.js
  modified:
    - js/modules/12-checkout.js
    - js/main.js
    - js/main.min.js

key-decisions:
  - "Used named constant _FORM_DRAFT_KEY instead of inlining the string literal — consistent with FERMENT_CART_KEY / INGREDIENT_CART_KEY pattern in the codebase"
  - "Guard against all-empty draft in restoreCheckoutFormDraft — prevents overwriting pre-filled inputs when user navigates back with an empty draft"
  - "saveCheckoutFormDraft removes the key when all three fields are empty — avoids stale empty-object drifting in localStorage"

patterns-established:
  - "Form draft pattern: save on input event, restore after first renderReservationItems(), clear on success — reusable pattern for other forms"

requirements-completed: [FORM-01]

# Metrics
duration: 20min
completed: "2026-05-04"
---

# Phase 08 Plan 05: Checkout Form Draft Persistence Summary

**localStorage-based form auto-save for name/email/phone on the checkout page, with restore on load and clear on successful checkout.**

## Performance

- **Duration:** 20 min
- **Started:** 2026-05-04
- **Completed:** 2026-05-04
- **Tasks:** 2 (TDD RED + GREEN)
- **Files modified:** 4

## Accomplishments

- Three new functions in `js/modules/12-checkout.js`: `saveCheckoutFormDraft`, `restoreCheckoutFormDraft`, `clearCheckoutFormDraft`
- Auto-restore wired in `initReservationPage()` after first `renderReservationItems()` call
- Auto-save wired via input listeners in `setupReservationForm()` for `res-name`, `res-email`, `res-phone`
- Form draft cleared in both the dual-cart success handler and the single-cart success handler
- Honeypot field (`res-website`) is never saved — only name/email/phone persisted
- 11 new unit tests covering save, restore, clear, edge cases (empty draft, partial draft, missing DOM elements)

## Task Commits

1. **Task 1: TDD RED — add failing tests** - `3d3bc8f` (test)
2. **Task 2: TDD GREEN — implement form draft persistence** - `ac8e519` (feat)

## Files Created/Modified

- `tests/frontend/checkout-form-persistence.test.js` — 11 unit tests for save/restore/clear behavior (181 lines)
- `js/modules/12-checkout.js` — Added _FORM_DRAFT_KEY constant and three draft functions; wired into initReservationPage, setupReservationForm, and both success handlers; exported from module.exports
- `js/main.js` / `js/main.min.js` — Regenerated build artifacts

## Decisions Made

- Used `_FORM_DRAFT_KEY = 'sv-checkout-form-draft'` as a named constant (follows `FERMENT_CART_KEY` / `INGREDIENT_CART_KEY` pattern)
- `restoreCheckoutFormDraft` is a no-op when draft is all-empty strings `{name:'',email:'',phone:''}` — prevents overwriting inputs on back-navigation with a stale empty draft
- `saveCheckoutFormDraft` removes the localStorage key when all three fields are empty (not just skips writing) — ensures clean state when user clears all inputs

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — form persistence is fully wired to real DOM inputs and real localStorage.

## Threat Surface Scan

No new trust boundaries introduced beyond what the plan's threat model documented (T-08-17 and T-08-18 both accepted). Saved data (name/email/phone) is user-supplied and subject to the same server-side validation as manually typed values.

## Self-Check: PASSED

- `tests/frontend/checkout-form-persistence.test.js` — EXISTS, 181 lines
- `js/modules/12-checkout.js` — EXISTS, contains `_FORM_DRAFT_KEY`, `saveCheckoutFormDraft`, `restoreCheckoutFormDraft`, `clearCheckoutFormDraft`
- `clearCheckoutFormDraft()` called in 3 locations (dual-cart success, single-cart success, and function definition)
- `restoreCheckoutFormDraft()` called after `renderReservationItems()` in `initReservationPage()`
- Input listeners attached in `setupReservationForm()`
- Commit `3d3bc8f` (RED) — EXISTS
- Commit `ac8e519` (GREEN) — EXISTS
- 286 frontend tests pass (11 new), 426 middleware tests pass, lint 0 errors

---
*Phase: 08-first-batch-promo*
*Completed: 2026-05-04*
