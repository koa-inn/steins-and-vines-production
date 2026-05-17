---
phase: 14-kiosk-recipe-sales-inventory-batch-creation
plan: 02
subsystem: api
tags: [pos, recipe-sale, redis-mutex, zoho-invoice, batch-creation, helcim]

# Dependency graph
requires:
  - phase: 14-01
    provides: LOCK_KEYS.RECIPE_SALE constant and detectRecipeSale() function
  - phase: 13-middleware-api-admin-recipe-management
    provides: recipe API endpoints and ingredient availability patterns
provides:
  - POST /api/kiosk/recipe-sale — initiate recipe sale (mutex + terminal push)
  - POST /api/kiosk/recipe-sale/confirm — validate + invoice + batch fire-and-forget
  - route mounted in server.js between recipes and webhooks
affects:
  - 14-03-kiosk-ui (consumes new API endpoints)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "pos-recipe.js: dedicated route file for recipe sales, isolated from pos.js"
    - "server-authoritative pricing: sum of ingredient catalog rates + fees (not locked_price)"
    - "void-on-Zoho-failure: voidTransaction + mailer.sendVoidFailureAlert + Redis sv:void-failure persistence"
    - "dual cache bust: both KIOSK_PRODUCTS and INGREDIENTS busted after sale"
    - "detectRecipeSale fire-and-forget: in-store only, never take-out"

key-files:
  created:
    - zoho-middleware/routes/pos-recipe.js
    - zoho-middleware/__tests__/pos-recipe.test.js
  modified:
    - zoho-middleware/server.js

key-decisions:
  - "pos-recipe.js is a standalone route file — not modifying pos.js avoids branching in an already complex handler"
  - "Terminal charge = sum of ingredient Zoho rates + applicable fees (not locked_price per D-08 resolution in RESEARCH.md)"
  - "Redis lock acquired at initiate endpoint, released in all exit paths: terminal failure, Zoho failure, void path, and success"
  - "mill_grain is ignored for in-store sales — milling fee only added for take-out (server enforces, client toggle is UX only)"
  - "detectRecipeSale called only for in-store sales per D-09; take-out creates no batch"
  - "RECIPES_TS cache also busted after sale to ensure freshness of recipe availability data"

requirements-completed: [KSK-03, KSK-04, INV-01, INV-02, INV-03]

# Metrics
duration: 15min
completed: 2026-05-17
---

# Phase 14 Plan 02: Recipe Sale Route Summary

**New pos-recipe.js route with initiate + confirm endpoints: Redis mutex, server-authoritative pricing from ingredient catalog, per-ingredient Zoho invoice, void-on-failure, detectRecipeSale fire-and-forget for in-store — 14 unit tests all passing**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-17T13:40:21Z
- **Completed:** 2026-05-17T14:00:00Z
- **Tasks:** 2
- **Files:** 3 (2 created, 1 modified)

## Accomplishments

- Created `zoho-middleware/routes/pos-recipe.js` with two endpoints:
  - `POST /api/kiosk/recipe-sale` — BEER_SALES_ENABLED gate, terminal check, input validation, recipe fetch from Apps Script, server-authoritative total from ingredient catalog, Redis mutex acquisition (30s TTL), terminal push, 202 response with pending reference
  - `POST /api/kiosk/recipe-sale/confirm` — feature gate, re-fetch recipe server-side, re-compute total from cached catalog, per-ingredient invoice line items + fee lines (Brewing Fee + Materials Fee for in-store, Milling Fee for take-out when configured), Zoho invoice create, submit (fire-and-forget), customer payment recording, dual cache bust (KIOSK_PRODUCTS + INGREDIENTS + RECIPES_TS), lock release, detectRecipeSale fire-and-forget for in-store only
- Void-on-failure pattern: matches pos.js exactly — voidTransaction, mailer.sendVoidFailureAlert, Redis sv:void-failure persistence
- Lock released on ALL exit paths: terminal failure, Zoho invoice failure (after void), cache error, Apps Script error
- Created `zoho-middleware/__tests__/pos-recipe.test.js` with 14 unit tests (all passing)
- Modified `zoho-middleware/server.js` to mount pos-recipe between recipes and webhooks

## Task Commits

1. **Task 1: Create pos-recipe.js** — `62849c3` (feat)
2. **Task 2: Tests and server.js mount** — `ae74f9a` (feat)

## Files Created/Modified

- `zoho-middleware/routes/pos-recipe.js` — 413 lines, new file
- `zoho-middleware/__tests__/pos-recipe.test.js` — 403 lines, new file
- `zoho-middleware/server.js` — 1 line added (route mount)

## Decisions Made

- Terminal charge uses sum of ingredient Zoho catalog rates + applicable fees, not `locked_price` (D-08 resolution: locked_price is display-only)
- `callAppsScriptPost` is defined locally in pos-recipe.js (not imported from recipes.js which doesn't export it) — matches existing isolation pattern
- `RECIPES_TS` cache also busted alongside `KIOSK_PRODUCTS` and `INGREDIENTS` after sale — ensures availability data freshness for subsequent recipe lookups
- `mill_grain` boolean coerced server-side; milling fee guard checks `MILLING_FEE_ITEM_ID` env var before building line item (returns 400 with clear admin message if missing)

## Deviations from Plan

None — plan executed exactly as written.

## Threat Model Compliance

All STRIDE threats mitigated as specified:
- **T-14-03** (client-supplied rate): Server re-fetches recipe + ingredient catalog, client total ignored
- **T-14-04** (inactive recipe): `status === 'active'` check on both initiate and confirm
- **T-14-05** (unauthorized access): Covered by existing `requireApiKey` in server.js
- **T-14-06** (mutex held indefinitely): 30s TTL + releaseLock on all exit paths
- **T-14-07** (BEER_SALES_ENABLED bypass): Server-side check at top of BOTH handlers
- **T-14-08** (mill_grain manipulation): Server ignores mill_grain for in-store; validates env var for take-out
- **T-14-09** (void failure): mailer.sendVoidFailureAlert + Redis sv:void-failure persistence
- **T-14-10** (recipe_snapshot PII): snapshot contains only recipe metadata (name, style, ABV, fees, ingredients) — no customer PII

## Known Stubs

None — all functionality is fully wired.

## Threat Flags

None — no new network endpoints or auth paths beyond what's documented in the threat model.

## Self-Check: PASSED

**Created files:**
- FOUND: zoho-middleware/routes/pos-recipe.js
- FOUND: zoho-middleware/__tests__/pos-recipe.test.js
- FOUND: .planning/phases/14-kiosk-recipe-sales-inventory-batch-creation/14-02-SUMMARY.md

**Commits:**
- FOUND: 62849c3 (feat(14-02): create pos-recipe.js with recipe sale initiate and confirm endpoints)
- FOUND: ae74f9a (feat(14-02): add pos-recipe tests (14 passing) and mount route in server.js)

**Test verification:**
- 14/14 pos-recipe.test.js tests pass
- 506/506 middleware tests pass (24 suites)

**Verification commands:**
- `grep -c 'BEER_SALES_ENABLED' routes/pos-recipe.js` = 3 (>= 2 required)
- `grep -c 'releaseLock' routes/pos-recipe.js` = 5 (>= 3 required)
- `grep -c 'voidTransaction' routes/pos-recipe.js` = 1 (>= 1 required)
- `grep -c 'detectRecipeSale' routes/pos-recipe.js` = 1 (>= 1 required)
- `grep 'pos-recipe' server.js` = mount line present

---
*Phase: 14-kiosk-recipe-sales-inventory-batch-creation*
*Completed: 2026-05-17*
