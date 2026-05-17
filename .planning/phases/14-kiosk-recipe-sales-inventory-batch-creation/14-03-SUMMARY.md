---
phase: 14-kiosk-recipe-sales-inventory-batch-creation
plan: 03
subsystem: frontend
tags: [kiosk, recipe-browser, admin-js, vanilla-js, sale-type-prompt, availability]

# Dependency graph
requires:
  - phase: 14-01
    provides: detectRecipeSale foundation
  - phase: 14-02
    provides: POST /api/kiosk/recipe-sale and /confirm endpoints
provides:
  - Mode toggle (Products/Recipes) in kiosk browse view
  - Recipe card grid with name, style, ABV, locked_price
  - Sale-type prompt (Ferment in Store / Take Out) with availability check
  - Cart population with ingredient display lines and fee lines
  - Checkout routing to /api/kiosk/recipe-sale + /confirm for recipe sales
affects:
  - 14-04-inventory (consumes kiosk recipe flow for staging validation)
  - 14-05-verification (UAT on admin.html kiosk tab)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "kioskSetMode: toggles product/recipe grid visibility, hides search bar in recipe mode"
    - "kioskLoadRecipes: matches kioskLoadProducts pattern with x-api-key header"
    - "recipe availability check before cart add: blocks on cannot_brew and unknown"
    - "_kioskCart._recipeContext: sentinel for recipe sale routing in checkout"
    - "recipe sale 202+confirm flow: handles pending status by calling /confirm endpoint"

key-files:
  created: []
  modified:
    - admin.html
    - js/admin.js
    - js/admin.min.js

key-decisions:
  - "Recipe cart items use display-only rate=0 — server recomputes actual rates at confirm (T-14-11 accept)"
  - "isRecipeSale detected via _kioskCart._recipeContext sentinel — avoids touching existing product sale flow"
  - "Recipe 202 pending response handled by calling /confirm with reference and transaction_id from response"
  - "kioskClearCart resets all recipe state vars including _kioskSelectedRecipe and _kioskRecipeAvailability"
  - "milling toggle shown only for take-out (D-03) — JS enforces, server also enforces"

requirements-completed: [KSK-01, KSK-02]

# Metrics
duration: 7min
completed: 2026-05-17
---

# Phase 14 Plan 03: Kiosk Recipe Browser UI Summary

**Mode toggle, recipe card grid, sale-type prompt with availability check, cart population with ingredient and fee lines, and recipe sale checkout routing wired to /api/kiosk/recipe-sale — kiosk recipe flow end-to-end in admin.html**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-05-17T13:48:33Z
- **Completed:** 2026-05-17T13:56:11Z
- **Tasks:** 3
- **Files modified:** 2 (admin.html, js/admin.js) + 1 build artifact (js/admin.min.js)

## Accomplishments

- Modified `admin.html` to add inside `kiosk-product-pane`:
  - Mode toggle bar with Products and Recipes buttons (`.kiosk-mode-toggle`)
  - Recipe grid div (`#kiosk-recipe-grid`, hidden by default)
  - Recipe prompt pane (`#kiosk-recipe-prompt`) with back button, recipe name display, availability banner, in-store/take-out sale-type buttons, mill grain checkbox, add-to-cart button

- Modified `js/admin.js` kiosk IIFE to add:
  - 8 new state variables: `_kioskMode`, `_kioskRecipes`, `_kioskRecipesLoaded`, `_kioskRecipesLoading`, `_kioskSelectedRecipe`, `_kioskSaleType`, `_kioskMillGrain`, `_kioskRecipeAvailability`
  - `kioskSetMode(mode)`: switches between products/recipes views, hides search bar in recipe mode, lazy-loads recipes on first switch
  - `kioskLoadRecipes(forceRefresh)`: fetches `GET /api/recipes?status=active` with x-api-key header
  - `kioskRenderRecipes()`: renders recipe cards with Recipe badge, name, style, ABV, locked_price using existing `.kiosk-product-card` CSS
  - `kioskShowRecipePrompt(recipe)`: shows inline sale-type pane, resets state, triggers availability check
  - `kioskSelectSaleType(saleType)`: updates button states, shows milling toggle for take-out only (D-03)
  - `kioskUpdateAddToCartButton()`: blocks add-to-cart when availability is cannot_brew or unknown
  - `kioskCheckRecipeAvailability(recipeId)`: fetches `GET /api/recipes/:id/availability`, updates `_kioskRecipeAvailability`
  - `kioskRenderAvailBanner(avail)`: shows warning (some_low, dismissible), or block banner (cannot_brew/unknown)
  - `kioskAddRecipeToCart()`: clears cart, fetches full recipe detail, populates `_kioskCart` with ingredient display lines + fee lines, stores `_kioskCart._recipeContext` for checkout routing
  - Event listeners added inside `initKioskSaleTab()`: mode toggle, recipe back button, sale-type buttons, mill checkbox, add-to-cart button
  - `kioskClearCart()` extended to reset all recipe state variables
  - `kioskProceedToPayment()` modified: detects `isRecipeSale` via `_kioskCart._recipeContext`, routes to `/api/kiosk/recipe-sale` with recipe-specific body, handles 202 pending by calling `/api/kiosk/recipe-sale/confirm`

## Task Commits

1. **Task 1: admin.html recipe browser HTML** — `dcb7f63` (feat)
2. **Tasks 2+3: admin.js recipe browser logic** — `3ae33b4` (feat)

Note: Tasks 2 and 3 were committed together because all admin.js edits occurred in a single session.

## Files Created/Modified

- `admin.html` — Mode toggle, recipe grid, recipe prompt pane added to kiosk-product-pane
- `js/admin.js` — Recipe browser state, functions, event listeners, checkout routing
- `js/admin.min.js` — Regenerated by `npm run build`

## Decisions Made

- Recipe cart items use `rate: 0` for display only — server re-computes all rates at confirm time. This is correct per T-14-11 threat model (accept disposition).
- `_kioskCart._recipeContext` sentinel object detects recipe sales throughout the checkout flow — avoids modifying existing product sale code paths.
- Recipe sale 202 pending response is handled by immediately calling `/api/kiosk/recipe-sale/confirm` with the `reference` from the initiate response. This mirrors the kiosk.js implementation but without polling (admin.js kiosk is a staff-facing UI, not customer-facing).
- `transaction_id` passed to confirm endpoint from initiate response — the Helcim webhook may not have fired yet, so confirm body includes the reference for correlation on the server side.

## Deviations from Plan

**1. [Rule 1 - Bug] Recipe sale 202 response requires confirm call**
- **Found during:** Task 3 checkout routing analysis
- **Issue:** Plan pseudocode showed routing to `/api/kiosk/recipe-sale` but didn't fully specify 202 handling. The recipe-sale endpoint returns 202 (pending terminal), not 201 (complete). Without calling `/confirm`, the invoice would never be created.
- **Fix:** Added 202 branch in `kioskProceedToPayment` that calls `/api/kiosk/recipe-sale/confirm` with recipe context from the initiate response. The verify check `grep -c 'recipe-sale' js/admin.js >= 2` now passes (both initiate and confirm URLs).
- **Files modified:** js/admin.js
- **Commit:** 3ae33b4

## Known Stubs

None. All functionality is wired to real API endpoints. Display `rate: 0` for recipe ingredient cart items is intentional (server-authoritative pricing), documented in threat model.

## Threat Surface Scan

No new network endpoints or auth paths beyond what is already in the plan's threat model. All fetch calls include `x-api-key` header from `SHEETS_CONFIG.MW_API_KEY` (T-14-12 mitigated). No PII in recipe card DOM (T-14-13 accepted).

## Self-Check: PASSED

**Key function verification:**
- `kioskLoadRecipes` in js/admin.js: 2 occurrences (definition + call) — FOUND
- `recipe-sale` in js/admin.js: 2 occurrences (initiate + confirm URLs) — FOUND
- `kiosk-recipe-grid` in admin.html: 1 occurrence — FOUND
- `kiosk-recipe-prompt` in admin.html: 1 occurrence — FOUND
- `cannot_brew` in js/admin.js: 8 occurrences — FOUND

**Build verification:**
- `npm run build` succeeds — FOUND
- Frontend tests: 360 passed, 0 failures — FOUND
- Middleware tests: 506 passed, 0 failures — FOUND
- ESLint: 0 errors, 84 warnings (all pre-existing) — FOUND

**Commits:**
- FOUND: dcb7f63 (feat(14-03): add recipe browser HTML to kiosk browse view in admin.html)
- FOUND: 3ae33b4 (feat(14-03): add recipe browser mode toggle, loading, rendering to admin.js)

---
*Phase: 14-kiosk-recipe-sales-inventory-batch-creation*
*Completed: 2026-05-17*
