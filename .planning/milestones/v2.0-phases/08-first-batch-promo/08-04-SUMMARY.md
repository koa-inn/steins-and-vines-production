---
phase: 08-first-batch-promo
plan: 04
subsystem: checkout
tags: [promo, checkout, dual-cart, tdd, regression]
dependency_graph:
  requires: [08-02]
  provides: [promo discount flows to dual-cart combined totals, regression test coverage]
  affects: [js/modules/12-checkout.js]
tech_stack:
  added: []
  patterns: [TDD RED/GREEN, jest.resetModules + jest.isolateModules for module state isolation, global stub injection for browser-global functions]
key_files:
  created:
    - tests/frontend/checkout-promo-totals.test.js
  modified:
    - js/modules/12-checkout.js
    - js/main.js
    - js/main.min.js
decisions:
  - "Re-render trigger placed immediately after renderReservationItems() in both applyPromoCode() and Remove handler — same synchronous call pattern, no event-based indirection"
  - "Test helpers _setDualCartForTest/_setPromoAppliedForTest added to module.exports under Node env guard — allows direct state injection without calling initReservationPage()"
  - "Test uses Promise.resolve() flush chain (3 ticks) to wait for fetch mock promise chain before asserting DOM state"
metrics:
  duration: 25min
  completed_date: "2026-05-04"
  tasks_completed: 2
  files_changed: 4
---

# Phase 08 Plan 04: Promo Dual-Cart Combined Total Re-render Fix Summary

**One-liner:** Two one-line fixes in 12-checkout.js ensure both combined total displays (ingredient section + bottom summary) update immediately when FIRSTBATCH promo is applied or removed in dual-cart checkout mode.

## What Was Built

### Task 1 (TDD RED): Regression test

Created `tests/frontend/checkout-promo-totals.test.js` (324 lines) proving the bug:

- **Suite 1**: `renderCheckoutIngredientSection` direct calculation tests (3 tests) — verify correct combined totals with/without promo via `_setPromoAppliedForTest()`
- **Suite 2**: `applyPromoCode` regression test (2 tests) — key test calls `applyPromoCode()` with `_isDualCart=true`, mock fetch returning `{ ok: true, code: 'FIRSTBATCH', discountPct: 20 }`, then asserts combined total in ingredient section DOM updates from $295.75 to $239.75

Test demonstrated the bug clearly: after `applyPromoCode()` resolved, the `.dual-cart-grand-total` element still showed `$295.75` instead of `$239.75`.

Test infrastructure built:
- `_setDualCartForTest(v)` and `_setPromoAppliedForTest(v)` exported from `module.exports` for direct state injection
- `applyPromoCode` and `renderCheckoutIngredientSection` added to `module.exports`
- Full global stub set: `getCartKey`, `getCartKeyForTab`, `showToast`, `formatCurrency`, `escapeHTML`, `isWeightUnit`, `getEffectiveMax`, `getReservation`, `saveReservation`, `refreshAllReserveControls`, etc.

Committed as: `8b47279` (test/RED)

### Task 2 (TDD GREEN): Fix

Two one-line additions to `js/modules/12-checkout.js`:

**Edit 1** — `applyPromoCode()` success handler (line 354):
```javascript
if (_isDualCart) renderCheckoutIngredientSection();
```

**Edit 2** — Remove Code click handler in `renderPromoWidget()` (line 390):
```javascript
if (_isDualCart) renderCheckoutIngredientSection();
```

Root cause: `renderCheckoutIngredientSection()` (which calculates combined total at lines 1332-1362) was never re-called after promo state changed. `renderReservationItems()` dispatches `reservation-changed` which triggers `updateDualCartTotalSummary()` (bottom summary near submit) via listener — that path was already working after commit `970333b`. But the ingredient section's own "Combined Total (both orders)" label had no re-render trigger.

Also regenerated `js/main.js` and `js/main.min.js` via `npm run build`.

Committed as: `48fdf3f` (feat/GREEN)

## Tests

- Frontend: 275 tests, all pass (up from 270 in plan 02 — new regression suite adds 5 tests)
- Middleware: 426 tests, all pass — no regressions
- Coverage: 33.15% lines > 5% threshold
- Lint: 0 errors (79 pre-existing warnings unchanged)

## TDD Gate Compliance

- RED gate: commit `8b47279` (`test(08-04)`) — 1 failing test proving the bug
- GREEN gate: commit `48fdf3f` (`feat(08-04)`) — all 5 tests pass after fix

## Deviations from Plan

**1. [Rule 2 - Missing functionality] Added getCartKey and showToast global stubs to regression test**

- **Found during:** Task 1 test execution debugging
- **Issue:** `renderReservationItems()` called `getCartKey(item)` (from 11-cart.js, browser global) which was not stubbed in test env. The ReferenceError was silently swallowed by `applyPromoCode()`'s `.catch()`, preventing `renderCheckoutIngredientSection()` from ever executing — so the test could not distinguish between "bug exists" and "test setup error"
- **Fix:** Added `global.getCartKey`, `global.getCartKeyForTab`, `global.showToast` to global stub setup at top of test file
- **Files modified:** `tests/frontend/checkout-promo-totals.test.js`
- **Commit:** `48fdf3f`

## Known Stubs

None — all values are wired to real cart data from localStorage.

## Threat Surface Scan

No new trust boundaries. Display-only fix — the actual charge amount sent to Helcim (already correct per commit `970333b`) is not affected. Consistent with T-08-16 disposition: accept (display-only, no new data exposed).

## Self-Check: PASSED

- `tests/frontend/checkout-promo-totals.test.js` — EXISTS, 324 lines
- `js/modules/12-checkout.js` — EXISTS, contains `if (_isDualCart) renderCheckoutIngredientSection()` at lines 354 and 390
- `js/main.js` / `js/main.min.js` — EXISTS, regenerated by build
- Commit `8b47279` (RED) — EXISTS
- Commit `48fdf3f` (GREEN) — EXISTS
- `grep -n "_isDualCart.*renderCheckoutIngredientSection"` finds 2 occurrences (lines 354, 390)
- All 275 frontend tests pass, all 426 middleware tests pass
