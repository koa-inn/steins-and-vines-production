---
phase: 13-middleware-api-admin-recipe-management
plan: "02"
subsystem: api
tags: [express, redis, axios, apps-script, rest-api, caching]

# Dependency graph
requires:
  - phase: 12-recipe-data-foundation
    provides: Apps Script recipe CRUD functions (createRecipe, getRecipes, getRecipeDetail, updateRecipe, deleteRecipe)
  - phase: 13-middleware-api-admin-recipe-management plan 01
    provides: Server-token branch in Apps Script doPost accepts update_recipe and delete_recipe actions
provides:
  - Recipe CRUD REST API at /api/recipes (GET list, GET detail, POST create, PUT update, DELETE)
  - Recipe availability endpoint at /api/recipes/:id/availability with server-side stock computation
  - Redis caching with 10-minute TTL and explicit cache busting on mutations
  - Activation guardrail rejecting status=active without locked_price and ingredients (T-13-04)
affects: [13-middleware-api-admin-recipe-management plan 03, 14-kiosk-recipe-sales]

# Tech tracking
tech-stack:
  added: []
  patterns: [apps-script-proxy-route, server-side-stock-computation, activation-guardrail-middleware]

key-files:
  created:
    - zoho-middleware/routes/recipes.js
    - zoho-middleware/__tests__/recipes.test.js
  modified:
    - zoho-middleware/server.js

key-decisions:
  - "Method+path keyed mock handlers in test to avoid collision between GET/PUT/DELETE on same path pattern"
  - "Availability summary uses 'unknown' when ingredient cache is cold rather than triggering a Zoho refresh (fast fail, no blocking)"
  - "bustRecipeCache clears all 4 status variants (all/draft/active/inactive) at default pagination to cover admin UI default queries"

patterns-established:
  - "Apps Script proxy route: callAppsScriptGet/Post helpers with 15s timeout, server_token auth, maxRedirects:5"
  - "Cache bust on mutation: delete RECIPES_TS + all status-variant list keys + optional per-recipe key"
  - "Activation guardrail: middleware validates locked_price > 0 and ingredient_count >= 1 before allowing status=active"

requirements-completed: [API-01, API-02, API-03]

# Metrics
duration: 4min
completed: 2026-05-17
---

# Phase 13 Plan 02: Middleware Recipe API Summary

**Express route module with 6 recipe endpoints (CRUD + availability), Redis caching, server-side stock computation, and activation guardrails -- 14 unit tests passing**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-17T03:00:03Z
- **Completed:** 2026-05-17T03:03:56Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Recipe CRUD API (3 GET, 1 POST, 1 PUT, 1 DELETE) with Redis caching and explicit cache busting
- Server-side availability endpoint that fetches item_ids from Apps Script (client never supplies raw IDs -- API-02)
- Activation guardrail rejects status=active without locked_price > 0 and ingredient_count >= 1 (D-02, T-13-04)
- 14 unit tests covering cache hits/misses, error handling, stock computation, cold cache fallback, and guardrail enforcement

## Task Commits

Each task was committed atomically:

1. **Task 1: Create routes/recipes.js with CRUD + availability endpoints** - `6cc9756` (feat)
2. **Task 2: Create recipes.test.js and mount route in server.js** - `996170c` (test)

## Files Created/Modified
- `zoho-middleware/routes/recipes.js` - Recipe CRUD + availability Express route module (269 lines)
- `zoho-middleware/__tests__/recipes.test.js` - 14 unit tests for all 6 route handlers
- `zoho-middleware/server.js` - Mounted recipes router after promo, before webhooks

## Decisions Made
- Used method+path composite key in test mock handlers to avoid collision between GET/PUT/DELETE registrations on `/api/recipes/:id`
- Availability returns `summary: 'unknown'` when ingredient cache is cold rather than triggering a blocking Zoho refresh (Pitfall 5)
- bustRecipeCache clears all 4 status-variant list keys at `:0:0` pagination to cover default admin UI queries

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Initial test run failed because Express mock used path-only keys, causing PUT/DELETE handlers to overwrite GET handler at same path. Fixed by keying handlers as `METHOD:path` in the mock -- a standard approach when multiple HTTP verbs share a path pattern.

## User Setup Required

None - no external service configuration required. All env vars (`APPS_SCRIPT_URL`, `APPS_SCRIPT_SERVER_TOKEN`, `API_SECRET_KEY`) already configured in Railway.

## Next Phase Readiness
- API contract is stable for Plan 03 (admin UI) to consume
- All 6 endpoints are functional and tested
- Activation guardrail is enforced server-side (frontend guardrail in Plan 03 is UX sugar)
- Availability endpoint ready for admin recipe detail view to call on load (D-06)

---
*Phase: 13-middleware-api-admin-recipe-management*
*Completed: 2026-05-17*
