---
phase: 35-batch-scaling-engine
plan: 06
subsystem: frontend/kiosk-recipe-prompt
tags: [gap-closure, scale-01, kiosk, recipe-quote, scaled-pricing, frontend, middleware]
dependency_graph:
  requires: [35-03, 35-04, 35-05]
  provides: [SCALE-01-client-display, GET /api/kiosk/recipe-quote]
  affects: [js/admin.js, js/admin.min.js, zoho-middleware/routes/pos-recipe.js]
tech_stack:
  added: []
  patterns: [server-authoritative-quote, debounced-fetch, dom-injection-testing]
key_files:
  created:
    - tests/frontend/kiosk-recipe-quote.test.js
  modified:
    - js/admin.js
    - js/admin.min.js
    - zoho-middleware/routes/pos-recipe.js
    - zoho-middleware/__tests__/pos-recipe.test.js
    - admin.html (cache-bust stamps only, no new markup)
decisions:
  - "Server-quote approach: client fetches /api/kiosk/recipe-quote (dry-run, same math as real sale) instead of computing scaled price client-side — guarantees displayed price === charged price with zero drift"
  - "Debounce 350ms on volume changes to avoid spamming the API on slider/input events"
  - "Fall-back to base recipe price (computed_price/locked_price) when no quote is available or recipe_id mismatches — prevents stale-quote leakage across recipes"
  - "DOM-interaction tests use real jsdom elements (injectEl) rather than jest.fn mocks, because jsdom environment does not honour global.document overrides from within module scope"
metrics:
  duration: ~25min
  completed: 2026-06-20
  tasks_completed: 2
  files_modified: 6
---

# Phase 35 Plan 06: Quote-Driven Kiosk Recipe Prompt — Summary

**One-liner:** Added GET /api/kiosk/recipe-quote dry-run endpoint + wired admin kiosk prompt to display server-authoritative scaled price on the Add-to-Cart button and use scaled ingredient quantities in the cart, fixing the display/charge mismatch at non-1x scale factors.

## What Was Built

### Task 1 (prior execution): Middleware — GET /api/kiosk/recipe-quote

`zoho-middleware/routes/pos-recipe.js` was extended with:

- **`computeRecipeQuote` helper**: shared by the recipe-sale handler AND the new quote endpoint. Fetches recipe from Apps Script, validates `target_volume_l`, reads `INGREDIENTS_ALL` catalog, scales ingredients via `lib/recipe-scaling.js`, checks stock, and computes the server-authoritative grand total.
- **GET `/api/kiosk/recipe-quote`**: dry-run endpoint that runs `computeRecipeQuote` and returns `{ ok, recipe_id, base_volume_l, target_volume_l, scale_factor, pricing_mode, total, ingredients[{item_id, item_name, unit, base_quantity, quantity, rate, line_total}], stock }`. No terminal charge, no Redis lock, no Zoho invoice.
- **Same feature gate** as `POST /api/kiosk/recipe-sale` (`BEER_SALES_ENABLED`), mirrors validation rules (batch_size_l > 0, target > 0, <= 10x base, 400/404/503 errors).
- **Red/Green TDD**: `pos-recipe.test.js` extended with quote-specific assertions: same total as recipe-sale for identical inputs; does NOT call `helcimLib.terminalPurchase` or `cache.acquireLock`; stock conflict propagation; 400 on invalid target.

Commits: `dcdd857` (RED) → `139de48` (GREEN)

### Task 2 (this execution): Frontend — Quote-Driven Price + Cart

`js/admin.js` changes (ES5 only, inside the kiosk IIFE):

**New state vars:**
- `var _kioskQuote = null;` — stores the last successful quote response.
- `var _kioskQuoteTimer = null;` — debounce timer.

**New functions:**
- `kioskFetchRecipeQuote()`: GETs `/api/kiosk/recipe-quote` with `recipe_id`, `sale_type`, `target_volume_l`, and `x-api-key` header. On 200 success with matching `recipe_id`: stores `_kioskQuote` and calls `kioskUpdateAddToCartButton()`. On error/non-200: clears `_kioskQuote`, calls `kioskUpdateAddToCartButton()` (triggers fallback).
- `kioskScheduleRecipeQuote()`: Wraps `kioskFetchRecipeQuote` with a 350ms debounce via `_kioskQuoteTimer`.

**Wiring:**
- Called at the end of `kioskShowRecipePrompt` (initial quote for base volume when the prompt opens).
- Called inside `volInput.oninput` after updating `_kioskTargetVolumeL` (re-quote on volume change).
- Called inside `kioskSelectSaleType` so switching between in-store/take-out re-quotes.

**`kioskUpdateAddToCartButton` updated:**
When `_kioskQuote` is present and `_kioskQuote.recipe_id === _kioskSelectedRecipe.recipe_id` and `_kioskQuote.total > 0`: button shows `'Add to Cart — $' + quote.total.toFixed(2)`. Falls back to `kioskRecipePriceForContext()` (base price) when no quote.

**`processRecipeData` (inside `kioskAddRecipeToCart`) updated:**
When `_kioskQuote` is present and matches the recipe being added to cart:
- **Dynamic pricing branch**: iterates `_kioskQuote.ingredients` (not `data.ingredients`) — uses SCALED `quantity` in the display name and `line_total` for the line rate.
- **Locked pricing branch**: iterates `_kioskQuote.ingredients` for info-only ingredient lines (showing scaled quantities), uses `_kioskQuote.total` for the single package-price line (not `recipe.locked_price`).
- Falls back to base data in both branches when `_kioskQuote` is null/mismatched.

**Quote reset (stale-quote prevention):**
- `kioskClearCart()`: sets `_kioskQuote = null`, cancels debounce timer.
- Back button handler (`kiosk-recipe-back`): same reset.

**Test helpers exported** (for jsdom tests):
`_kioskGetQuote`, `_kioskSetQuote`, `_kioskGetSelectedRecipe`, `_kioskSetSelectedRecipe`, `_kioskGetSaleType`, `_kioskSetSaleType`, `_kioskGetTargetVolumeL`, `_kioskSetTargetVolumeL`, `_kioskGetCart`, `_kioskClearCart`, `_kioskSetRecipeAvailability`, `kioskFetchRecipeQuote`, `kioskUpdateAddToCartButton`.

**Frontend test suite** (`tests/frontend/kiosk-recipe-quote.test.js`, 17 tests):
- T1a-e: `kioskFetchRecipeQuote` hits correct URL, includes `x-api-key`, guards on missing recipe/sale-type, propagates sale-type.
- T2a-d: `kioskUpdateAddToCartButton` shows scaled total from quote; falls back to base when no quote; handles mismatched recipe_id; hides button when no recipe/sale-type.
- T3a-d: Quote state management (get/set/clear/ingredients carry scaled quantities).
- T4a-b: Locked-price recipe shows scaled total from quote (not base `locked_price`).
- T5a-b: URL construction (target_volume_l defaults to batch_size_l; guard on missing recipe).

**Build**: `npm run build` ran; `js/admin.min.js` regenerated; cache-bust stamps updated on admin.html and all page HTML files.

Commit: `ca568e1`

## Receipt Path

The receipt is displayed after a confirmed recipe sale via `kioskShowReceipt(saleData, totals, items, [])`. The `totals` and `items` args come from `_kioskCart` (via `kioskCalcTotals()` and `kioskProceedToPayment`). Since `processRecipeData` now builds `_kioskCart` from `_kioskQuote.ingredients` (scaled), the receipt line items automatically reflect scaled quantities. The grand total line uses `saleData.total` from the server confirm response, which is always authoritative — so even if the cart display diverged, the bottom-line total is always correct.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing] Add `_kioskSetRecipeAvailability` export for test isolation**
- **Found during:** Test development — `_kioskRecipeAvailability` is set internally by `kioskCheckRecipeAvailability` and persists between tests, causing `kioskUpdateAddToCartButton` to early-return with `display: 'none'` when availability is `'unknown'`.
- **Fix:** Added `_kioskSetRecipeAvailability` to module exports so tests can reset the availability state.
- **Files modified:** `js/admin.js`
- **Commit:** ca568e1

**2. [Rule 2 - Missing] Use real jsdom DOM elements for DOM-interaction tests**
- **Found during:** Test debugging — setting `global.document = { getElementById: jest.fn(...) }` does NOT replace `document` inside admin.js when running in the jsdom Jest environment. The jsdom `document` is injected directly into the module scope, not via `global.document`.
- **Fix:** DOM-interaction tests (T2/T4 groups) use `document.createElement` + `document.body.appendChild` to inject real jsdom elements that admin.js can find via the real `document.getElementById`.
- **Files modified:** `tests/frontend/kiosk-recipe-quote.test.js`
- **Commit:** ca568e1 (same test file, resolved during development)

**3. [Rule 2 - Missing] Trigger re-quote on sale-type change**
- **Found during:** Plan review — plan specified quote on prompt open + volume change. But sale type also affects the quote (in-store vs take-out changes the total via service/materials fees). Added `kioskScheduleRecipeQuote()` call inside `kioskSelectSaleType`.
- **Files modified:** `js/admin.js`
- **Commit:** ca568e1

## Deploy Requirements

This plan requires TWO separate deploys before the Phase 35 UAT can complete:

1. **Railway middleware**: `railway up` from `zoho-middleware/` — to publish the GET `/api/kiosk/recipe-quote` endpoint. Until this runs, the client's quote fetch returns a 404 and the client falls back to base prices (graceful degradation).
2. **Staging frontend**: `git push origin main` — to publish `js/admin.min.js` with the quote wiring.

The client gracefully degrades (shows base prices) when the endpoint is unavailable, so the deploys are independent and can be done in any order.

## Self-Check

**Created files:**
- [x] `tests/frontend/kiosk-recipe-quote.test.js` — EXISTS

**Modified files:**
- [x] `js/admin.js` — MODIFIED (contains `recipe-quote`, `_kioskQuote`, `kioskFetchRecipeQuote`)
- [x] `js/admin.min.js` — REBUILT (via `npm run build`)

**Commits:**
- [x] `dcdd857` — test(35-06): RED
- [x] `139de48` — feat(35-06): GET /api/kiosk/recipe-quote (Task 1)
- [x] `ca568e1` — feat(35-06): frontend wiring (Task 2)

**Test suites:**
- [x] Frontend: 768 passed (38 suites)
- [x] Middleware: 867 passed (39 suites)
- [x] Lint: 0 errors

## Self-Check: PASSED
