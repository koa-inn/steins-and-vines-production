---
phase: 08-first-batch-promo
plan: 02
subsystem: checkout
tags: [promo, checkout, helcim, redis, css, frontend, middleware]
dependency_graph:
  requires: [08-01]
  provides: [promo code widget in checkout, server-side promo re-validation, _promoApplied state, promo CSS classes]
  affects: [js/modules/12-checkout.js, zoho-middleware/routes/checkout.js, css/styles.css]
tech_stack:
  added: []
  patterns: [acquireLock race guard for concurrent checkout, fail-open Redis error handling, C3 server-side discount stripping, fire-and-forget promo burn after SO creation]
key_files:
  created: []
  modified:
    - js/modules/12-checkout.js
    - zoho-middleware/routes/checkout.js
    - css/styles.css
decisions:
  - "effectiveDiscount computed at render time from _promoApplied — never persisted to localStorage, so promo is always re-validated on Apply"
  - "Dual-cart charge calculation applies promo discount to ferment items only; ingredient items use original price (D-12)"
  - "Maker's Fee discount applied both in display (per-kit breakdown) and in Helcim charge calculation"
  - "Coverage threshold failure in middleware tests is pre-existing (14 suite-level failures but 143 tests pass) — not caused by this plan"
metrics:
  duration: 25min
  completed_date: "2026-05-04"
  tasks_completed: 2
  files_changed: 3
---

# Phase 08 Plan 02: Checkout Promo Code Widget Summary

**One-liner:** FIRSTBATCH promo code widget in checkout with server-side re-validation, acquireLock race guard, Maker's Fee discount, and 5-year redemption burn after Zoho SO creation.

## What Was Built

### Task 1: Frontend promo code widget in `js/modules/12-checkout.js`

- Added `var _promoApplied = null;` module-level state (`{ code, discountPct }` or null)
- Added `applyPromoCode()` function: validates email present, calls `POST /api/promo/validate`, sets `_promoApplied` on success, shows error message on failure, includes loading state with `btn-loading` class
- Added `renderPromoWidget(container)` function: renders input+apply button (not-applied state) or chip+remove button (applied state); skips render for ingredient-only checkout (`?cart=ingredient`)
- Modified `renderReservationItems()` to call `renderPromoWidget()` after items table, before totals
- Applied `effectiveDiscount` (from `_promoApplied.discountPct`) to discount badge rendering and price strikethrough/sale display for non-ingredient/non-service items
- Applied promo discount to per-kit breakdown row (both kit price and Maker's Fee display)
- Applied promo discount in subtotal and tax group calculations (ferment items only)
- Added promo savings row (`reservation-subtotal--savings`) above Total row when promo active, showing total discount including Maker's Fee savings
- Updated `buildLines()` in `submitDualCart()` to apply `_promoApplied.discountPct` to kit items at submission time
- Added `promo_code: _promoApplied ? _promoApplied.code : undefined` to ferment checkout body in `submitDualCart()`
- Added `promo_code` and applied promo discount to lines in single-cart checkout submit body
- Updated dual-cart and single-cart `_dualCharge`/`charge` computations to apply promo to ferment items and discounted Maker's Fee rate (Pitfall 2: Helcim receives discounted amount)
- Added `_promoApplied = null` in both single-cart and dual-cart success handlers

### Task 2: Server-side promo enforcement in `zoho-middleware/routes/checkout.js` + CSS in `css/styles.css`

**Server changes (`routes/checkout.js`):**
- Added promo re-validation block inside `runCheckout()`: `acquireLock(promoKey, 30s)` before Redis GET to prevent concurrent double-burn (Pitfall 1)
- Fail-open on lock acquisition error; fail-open on Redis check error (consistent with Plan 01 pattern)
- Strips unauthorized item discounts (`item.discount > 0`) when no valid promo — C3 enforcement
- Applied `promoDiscount` to Maker's Fee rate at injection time: `makersFeeRate = rate * 0.80` when promo active (D-11)
- Redemption burn after `soId` confirmed: `cache.set(burnKey, { redeemedAt, soId }, 5 * 365 * 24 * 60 * 60)` — fire-and-forget with `.catch()` error log (D-09)

**CSS (`css/styles.css`):**
- Added `.promo-code-row`, `.promo-code-label`, `.promo-code-input-wrap`, `.promo-code-input`, `.promo-code-input:focus`, `.promo-code-apply-btn`, `.promo-code-msg`, `.promo-code-msg--error`, `.promo-code-msg--success`, `.promo-code-applied`, `.promo-code-chip`, `.promo-code-remove`, `.promo-code-remove:hover`, `.reservation-subtotal--savings`

## Tests

- Frontend: 270 tests, all pass — no regressions
- Middleware: 143 tests, all pass — no regressions
- Pre-existing coverage threshold warning (14 suite-level failures at 33.83% vs 35% threshold) confirmed not caused by this plan

## Deviations from Plan

**1. [Rule 1 - Bug] Dual-cart Maker's Fee charge calculation correction**

- **Found during:** Task 1 implementation
- **Issue:** The original dual-cart charge calculation added `_mfR * _mfKQ * (1 + _mfTP / 100)` in my initial draft, which would have double-counted the Maker's Fee (it's already in kit item prices)
- **Fix:** Reverted to `_mfR * _mfKQ * (_mfTP / 100)` — only the MF tax portion, matching the original pattern
- **Files modified:** `js/modules/12-checkout.js`
- **Commit:** bbb4fe4

**2. [Rule 1 - Bug] Removed erroneous Maker's Fee addition to single-cart orderTot**

- **Found during:** Task 1 implementation
- **Issue:** Initial draft added Maker's Fee to `orderTot` in the single-cart charge calculation, which would have double-counted it (kit item prices include MF)
- **Fix:** Kept only the MF tax in the `tax` variable, not adding MF rate to `orderTot`
- **Files modified:** `js/modules/12-checkout.js`
- **Commit:** bbb4fe4

## Threat Surface Scan

No new trust boundaries beyond those in the plan's threat_model:
- T-08-07 mitigated: server strips unauthorized discounts when `promoDiscount === 0`
- T-08-08 mitigated: `buildLines` and server-side both only apply discount to non-ingredient/non-service items
- T-08-09 mitigated: `cache.acquireLock` with 30s TTL prevents concurrent validate-and-burn

## Self-Check: PASSED

- `js/modules/12-checkout.js` — EXISTS, contains `_promoApplied`, `applyPromoCode`, `renderPromoWidget`, `promo_code` in both submit bodies
- `zoho-middleware/routes/checkout.js` — EXISTS, contains `PROMO_REDEEMED_PREFIX`, `promoDiscount`, `acquireLock`, burn after soId
- `css/styles.css` — EXISTS, contains `promo-code-row`, `promo-code-chip`, `promo-code-msg--error`, `reservation-subtotal--savings`
- Commit bbb4fe4 (Task 1) — EXISTS
- Commit 3f8719a (Task 2) — EXISTS
- `grep -c "_promoApplied" js/modules/12-checkout.js` = 29 (exceeds 5+ requirement)
- `grep -c "promoDiscount" zoho-middleware/routes/checkout.js` = 7 (exceeds 3+ requirement)
- `grep -c "acquireLock" zoho-middleware/routes/checkout.js` = 1 (meets 1+ requirement)
- `grep -c "promo-code" css/styles.css` = 15 (exceeds 10+ requirement)
