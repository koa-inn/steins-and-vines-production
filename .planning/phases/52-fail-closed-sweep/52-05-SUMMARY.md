---
phase: 52-fail-closed-sweep
plan: 05
subsystem: api
tags: [express, auth-tiers, redis-cache, dos-mitigation, apps-script, zoho]

# Dependency graph
requires:
  - phase: 46-auth-re-architecture-critical-split-from-phase-45
    provides: lib/authTiers.js (requireTiers inline-wrap middleware factory, KIOSK_ROUTES allowlist)
provides:
  - "GET /api/kiosk/products?bust=1 requires a credential (legacy|session) — normal cached read stays public"
  - "GET /api/recipes/:id/availability requires a credential (legacy|device|session) + read-through cache (RECIPES_CACHE_TTL)"
  - "GET /api/kiosk/gift-card/next-number requires a credential + short (30s) read-through cache"
  - "GET /api/kiosk/gift-card/lookup requires a credential, deliberately NOT cached (stale-balance risk)"
affects: [phase-52 fail-closed-sweep verification, any future kiosk GET route needing quota-DoS protection]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Inline requireTiers wrap on a GET route: `return authTiers.requireTiers([...])(req, res, function () { return proceed(); });` — preserves 2-arg handler-capture test harness signature"
    - "Read-through cache around an Apps-Script proxy: cache.get(key) -> hit ? res.json : fetch, then cache.set(key, result, ttl) before res.json — mirrors recipes.js get_recipe pattern"

key-files:
  created:
    - zoho-middleware/__tests__/catalog-bust-auth.test.js
    - zoho-middleware/__tests__/appsscript-proxy-auth-cache.test.js
  modified:
    - zoho-middleware/routes/catalog.js
    - zoho-middleware/routes/recipes.js
    - zoho-middleware/routes/gift-cards.js
    - zoho-middleware/lib/constants.js
    - zoho-middleware/__tests__/recipes.test.js
    - zoho-middleware/__tests__/gift-cards.test.js

key-decisions:
  - "M7: gate ONLY the bustCache branch of GET /api/kiosk/products behind requireTiers(['legacy','session']); the normal cached read stays public (matches /api/orders/recent admin-grade precedent)"
  - "M8 availability + next-number use requireTiers(['legacy','device','session']) — kiosk-scoped, since the kiosk device legitimately calls both"
  - "M8 gift-card lookup returns a live BALANCE — deliberately left uncached (auth alone stops the DoS; caching risks a stale value feeding a redemption, i.e. over-redemption) instead of a ≤15s cache"
  - "Updated __tests__/recipes.test.js and __tests__/gift-cards.test.js to add x-api-key headers to existing success-path requests (no assertion changed) — required because these two routes were previously UNAUTHENTICATED, so the old tests encoded the exact insecure behavior being closed; followed the established in-repo precedent (commit 313b91a, Phase 45-01 D-09) for guarding a previously-public GET for the first time"

requirements-completed: [RESIL-01]

# Metrics
duration: 24min
completed: 2026-07-03
---

# Phase 52 Plan 05: Fail-Closed Sweep — Catalog Bust + Apps-Script Proxy Auth Summary

**Closed M7 (unauth `?bust=1` cold-Zoho-refetch DoS) and M8 (unauth/uncached Apps-Script proxy DoS) by gating three GET routes behind `authTiers.requireTiers` and adding read-through caching to the two that lacked it.**

## Performance

- **Duration:** 24 min
- **Started:** 2026-07-03T05:20:00Z
- **Completed:** 2026-07-03T05:44:00Z
- **Tasks:** 2
- **Files modified:** 6 (2 route files + catalog.js + lib/constants.js + 2 new test files; 2 pre-existing test files updated as a documented deviation)

## Accomplishments
- `GET /api/kiosk/products?bust=1` now requires an admin-grade credential (`legacy`/`session`) before busting the cache / forcing a cold Zoho refetch; the normal cached read is untouched and stays public
- `GET /api/recipes/:id/availability` now requires a kiosk-scoped credential (`legacy`/`device`/`session`) and is wrapped in a read-through cache (mirrors the existing `get_recipe` route's pattern; the "cache cold" / "not found" paths are intentionally NOT cached)
- `GET /api/kiosk/gift-card/next-number` requires the same kiosk-scoped credential and a short (30s) read-through cache
- `GET /api/kiosk/gift-card/lookup` requires the credential; deliberately left uncached with an explicit code comment documenting the stale-balance/over-redemption rationale (T-52-M8b)
- New `lib/constants.js` cache keys: `RECIPE_AVAILABILITY`, `GIFT_CARD_NEXT_NUMBER` (additive only, no existing key changed)

## Task Commits

Each task followed the TDD RED→GREEN cycle:

1. **Task 1: M7 — require the key for ?bust=1**
   - `aaa767a` test(52-05): failing test — ?bust=1 forces cold refetch unauth (RED)
   - `ab1ed19` fix(52-05): require key for ?bust=1 on kiosk products (M7) (GREEN)
2. **Task 2: M8 — auth + cache the Apps-Script GET proxies**
   - `cd39d5a` test(52-05): failing test — Apps-Script proxies unauth + uncached (RED)
   - `fe8e094` fix(52-05): auth + cache recipe availability and gift-card proxies (M8) (GREEN; includes the necessary `__tests__/recipes.test.js` + `__tests__/gift-cards.test.js` updates — see Deviations)

_Both tasks were `tdd="true"`; each RED commit was verified failing before its GREEN commit._

## Files Created/Modified
- `zoho-middleware/routes/catalog.js` - `bustCache` branch of `/api/kiosk/products` gated behind `requireTiers(['legacy','session'])`; normal read untouched
- `zoho-middleware/routes/recipes.js` - `/api/recipes/:id/availability` gated behind `requireTiers(['legacy','device','session'])` + read-through cache
- `zoho-middleware/routes/gift-cards.js` - `next-number` (auth+30s cache) and `lookup` (auth only, no cache) gated behind `requireTiers(['legacy','device','session'])`
- `zoho-middleware/lib/constants.js` - added `CACHE_KEYS.RECIPE_AVAILABILITY` and `CACHE_KEYS.GIFT_CARD_NEXT_NUMBER`
- `zoho-middleware/__tests__/catalog-bust-auth.test.js` - NEW: asserts `?bust=1` requires a credential, normal read stays public
- `zoho-middleware/__tests__/appsscript-proxy-auth-cache.test.js` - NEW: asserts all three M8 routes require a credential and Apps Script is never called unauth; availability's cache-hit-on-repeat behavior
- `zoho-middleware/__tests__/recipes.test.js` - deviation: added credential header to the 3 existing availability success-path requests + 1 new 401 test (see Deviations)
- `zoho-middleware/__tests__/gift-cards.test.js` - deviation: added credential header to the 7 existing next-number/lookup requests + 2 new 401 tests, plus a `cache` mock default (see Deviations)

## Decisions Made
- Tier choice for M7 (`['legacy','session']`, admin-grade) mirrors the existing `/api/orders/recent` precedent — a kiosk device token should not be able to force a cold Zoho refetch.
- Tier choice for M8 (`['legacy','device','session']`, kiosk-scoped) because the kiosk legitimately calls availability, next-number, and lookup with a bare device token (confirmed via `KIOSK_ROUTES` in `lib/authTiers.js`, which already lists `/api/kiosk/gift-card/lookup` and `/api/kiosk/gift-card/next-number`).
- Gift-card lookup: chose "auth-only, no cache" over "cache ≤15s" for simplicity and to fully eliminate the stale-balance/over-redemption risk (CLAUDE.md working principle 2: simplest solution for a simple problem) — documented in a code comment per the plan's acceptance criteria.
- Next-number: 30s cache is safe because it's a *suggestion* only — the server still enforces uniqueness on issue (pre-existing comment, unchanged).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] catalog.js M7 wrap did not propagate the inner promise**
- **Found during:** Task 2, while fixing the identical issue in gift-cards.js/recipes.js
- **Issue:** `return authTiers.requireTiers(...)(req, res, function () { proceed(); });` — the inner callback didn't `return proceed()`'s promise. Harmless in production (nothing consumed the handler's return value) but inconsistent with the fix applied to recipes.js/gift-cards.js.
- **Fix:** Changed to `function () { return proceed(); }` for consistent promise propagation.
- **Files modified:** `zoho-middleware/routes/catalog.js`
- **Verification:** `__tests__/catalog-bust-auth.test.js` + `__tests__/catalog.test.js` still pass (37 tests).
- **Committed in:** `fe8e094` (folded into the Task 2 GREEN commit)

**2. [Rule 2 — Missing critical functionality, test-infrastructure necessity] Updated `__tests__/recipes.test.js` and `__tests__/gift-cards.test.js`**
- **Found during:** Task 2, after wrapping the availability/next-number/lookup handlers in `requireTiers`
- **Issue:** These two routes were previously **unauthenticated** — that is the exact M8 vulnerability this plan closes. The pre-existing `__tests__/recipes.test.js` "GET /api/recipes/:id/availability" describe block (3 tests) and `__tests__/gift-cards.test.js` "next-number"/"lookup" describe blocks (7 tests) called the route handlers directly with no credential headers, asserting a 200/400/404 *unauthenticated* success — i.e. they encoded the vulnerable behavior itself. Adding the required auth gate necessarily turned all 10 of those assertions into `401`, since there is no code-only way to distinguish "a unit test calling the handler directly" from "an unauthenticated production request" — both are the same bare `req` object.
  - This differs from CLAUDE.md rule 10's usual application (don't weaken/game a test to hide a bug) — here the *fix itself* obsoletes an unauth-success assumption baked into the old tests, by design.
- **Resolution:** Followed the established in-repo precedent for exactly this situation — commit `313b91a` (Phase 45-01, D-09), which added an `x-api-key` header to `kiosk-salesorders.test.js`'s existing success-path requests (no assertion changed) plus new 401-without-key tests, when `GET /api/kiosk/salesorders` was auth-gated for the first time. Applied the identical minimal-edit pattern here:
  - `recipes.test.js`: added `process.env.API_SECRET_KEY` setup/teardown + `x-api-key` header to the 3 existing availability requests; added 1 new 401 test; added `RECIPE_AVAILABILITY` to the file's mocked `CACHE_KEYS` (pure infra parity, no assertion touched).
  - `gift-cards.test.js`: added `process.env.API_SECRET_KEY` setup/teardown + `x-api-key` header to all 7 existing next-number/lookup requests; added 2 new 401 tests; added a `cache` mock (`get`/`set` default-resolved) since next-number now calls `lib/cache` for the first time.
  - **No existing assertion was changed** — every pre-existing `expect(...)` in both files is byte-identical; only request `headers`/env-setup and net-new tests were added.
- **Files modified:** `zoho-middleware/__tests__/recipes.test.js`, `zoho-middleware/__tests__/gift-cards.test.js`
- **Verification:** Both files pass in full (25/25 and 13/13 respectively); full middleware suite is 64 suites / 1199 tests green (was 62/1187 at phase start); `npm run lint` clean (60 pre-existing warnings, 0 errors, no new warnings).
- **Committed in:** `fe8e094` (folded into the Task 2 GREEN commit, per CLAUDE.md rule 4 "make ONE logical change per commit" — the test updates are inseparable from the route change they exist to keep green)

---

**Total deviations:** 2 auto-fixed (1 Rule 1 bug, 1 Rule 2 test-infrastructure necessity)
**Impact on plan:** Both essential — the catalog.js fix is a minor consistency correction; the test updates were unavoidable to close a real security hole (M8) while keeping the full suite honestly green (not achievable via any code-only technique, confirmed against a real in-repo precedent for the identical scenario). No scope creep — no other test files touched, no assertions weakened.

## Issues Encountered
None beyond the deviation above — TDD RED→GREEN proceeded as planned for both tasks; the RED test for the caching assertion initially failed for an unrelated reason (test didn't seed the `INGREDIENTS_ALL` cache, so the code correctly took the uncacheable "unknown" branch) — fixed the test setup, not the code.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- M7 and M8 are fully closed on this branch; full middleware suite (64/1199) and lint (0 errors) are green.
- No dependency on the other wave-1 plans in Phase 52 (52-03 pos.js, 52-04 items.js/taxes.js) — this plan touched a disjoint file set (`catalog.js`, `recipes.js`, `gift-cards.js`, `lib/constants.js`) as required by the phase's parallel-safe wave-reshape note.
- 52-02 (wave 2, M1/M4/M5) depends on 52-01's shared helper, not on this plan.

---
*Phase: 52-fail-closed-sweep*
*Completed: 2026-07-03*

## Self-Check: PASSED

All 9 claimed files verified present on disk; all 5 claimed commit hashes (`aaa767a`, `ab1ed19`, `cd39d5a`, `fe8e094`, `389d520`) verified present in `git log --oneline --all`.
