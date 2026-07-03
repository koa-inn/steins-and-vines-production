---
phase: 46-auth-re-architecture-critical-split-from-phase-45
plan: 04
subsystem: auth
tags: [auth, express, middleware, kiosk, requireTiers, device-token, session]

# Dependency graph
requires:
  - phase: 46-03
    provides: lib/authTiers.js (requireTiers/resolveTier/allowKiosk/allowAdmin), req.authTier global guard
provides:
  - All 13 in-route apiKeyGuard.matches checks in pos.js migrated to inline authTiers.requireTiers wraps
  - Admin-grade in-route checks in consignment.js (report) and catalog.js (include_internal gate) tier-aware
  - pos-auth-tier.test.js integration coverage proving post-rotation kiosk survival + admin-grade device rejection
affects: [46-10 (API_SECRET_KEY rotation/cutover), 46-05..46-09 (remaining auth re-arch plans)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Inline requireTiers wrap: router.<verb>(path, function(req,res){ authTiers.requireTiers([...])(req,res,function(){ /* body */ }); }) — preserves 2-arg handler signature for existing findHandler-based unit test harnesses"
    - "GET routes resolve their own tier inline (never read req.authTier) since the global 46-03 guard exempts all GET requests"

key-files:
  created:
    - zoho-middleware/__tests__/pos-auth-tier.test.js
  modified:
    - zoho-middleware/routes/pos.js
    - zoho-middleware/routes/consignment.js
    - zoho-middleware/routes/catalog.js

key-decisions:
  - "catalog.js's include_internal=1 admin gate (hasValidApiKey) rewritten as async isAdminGrade() using authTiers.resolveTier + allowAdmin, extracting the public-response branch into servePublicIngredients() so the async gate can dispatch without duplicating existing fallback logic — the only one of the 15 gates in this plan that required a structural (not just inline-wrap) change, since its caller was a synchronous boolean check"
  - "Gift-card void was NOT touched in pos.js — it lives in gift-cards.js and is already enforced by the 46-03 global guard's non-kiosk device rejection; pos-auth-tier.test.js still exercises it for regression coverage at the pos-focused suite"

requirements-completed: [AUDIT-CRITICAL-AUTH, D-46-02, D-46-11]

# Metrics
duration: 25min
completed: 2026-07-02
---

# Phase 46 Plan 04: In-Route Tier Migration (pos.js/consignment.js/catalog.js) Summary

**Migrated all 13 in-route `apiKeyGuard.matches` credential checks in pos.js (plus consignment.js and catalog.js) to an inline `authTiers.requireTiers([...])` wrap, so the kiosk device token and staff session cookie both satisfy the second enforcement layer the moment the legacy API key is rotated.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-02T17:58:00-07:00
- **Completed:** 2026-07-02T18:15:00-07:00
- **Tasks:** 3
- **Files modified:** 4 (3 modified, 1 created)

## Accomplishments
- All 13 pos.js in-route gates (`/api/orders/recent`, `/api/admin/inventory-ledger`, `/api/kiosk/salesorders`, `/api/kiosk/salesorder/:id`, `/api/kiosk/salesorder-update`, `/api/contacts/search`, and 7 `/api/batch/*` routes) now consult `authTiers.requireTiers([...])` instead of re-requiring the legacy `x-api-key`, closing the "remove key = one-line fix" pitfall from the audit
- Kiosk-scoped routes accept `legacy|device|session`; BrewPad/admin routes accept `legacy|session` only (device explicitly rejected)
- `consignment.js`'s admin report route and `catalog.js`'s `include_internal=1` admin gate are both tier-aware and reject device
- New `pos-auth-tier.test.js` (12 tests, full-app supertest) proves: kiosk device token survives simulated post-rotation (no `API_SECRET_KEY` set), admin-grade routes (`gift-card/void`, `orders/recent`) reject device but accept legacy/session, BrewPad GETs are session-only, and kiosk/admin GETs correctly resolve their own tier since the global guard exempts all GETs
- All 5 pre-existing unit test files (`kiosk-salesorders`, `batch-customer`, `batch-scan-invoices`, `batch-reassign-customer`, `batch-bottling-invite`, `consignment`, `catalog`) pass **unedited** — the inline-wrap pattern preserves the 2-arg `router.<verb>(path, handler)` signature the `findHandler` test harnesses depend on

## Task Commits

1. **Task 1: Migrate pos.js in-route checks to inline requireTiers wrap** - `2ff4e4a` (feat)
2. **Task 2: Admin-grade in-route checks in consignment.js and catalog.js** - `4c0a829` (feat)
3. **Task 3: pos.js tier-acceptance integration test** - `3056fbd` (test)

_No separate plan-metadata commit — SUMMARY.md is committed as part of the worktree merge by the orchestrator._

## Files Created/Modified
- `zoho-middleware/routes/pos.js` - All 13 `apiKeyGuard.matches` checks replaced with inline `authTiers.requireTiers([...])` wraps; `apiKeyGuard` import removed (no longer referenced), replaced with `authTiers`
- `zoho-middleware/routes/consignment.js` - `/api/admin/consignment-report` wrapped inline with `requireTiers(['legacy','session'])`
- `zoho-middleware/routes/catalog.js` - `include_internal=1` admin gate rewritten as async `isAdminGrade()` (accepts legacy|session, rejects device); public-response branch extracted into `servePublicIngredients(req, res)`
- `zoho-middleware/__tests__/pos-auth-tier.test.js` - New integration suite (12 tests) covering kiosk/admin/BrewPad tier acceptance and post-rotation survival

## Decisions Made
- **catalog.js structural change:** Unlike the other 14 gates in this plan (simple inline-wrap, no structural change needed), catalog.js's `include_internal=1` gate was a synchronous boolean helper consumed by a plain `if` statement — not an early-return 401 guard. Session lookup is inherently async (`session.getSession` always returns a Promise, even in its in-process fallback), so making this gate accept `session` tier required: (a) converting the boolean helper to return a Promise, and (b) extracting the existing "else" branch (public ingredient list, ~85 lines of cache/file/snapshot fallback logic) into a named `servePublicIngredients(req, res)` function so both the admin and public paths could be reached from inside a `.then()`. The extracted function's internal logic is byte-for-byte unchanged — only its entry point moved.
- **Gift-card void left untouched:** Confirmed (per plan's `<interfaces>` note) that `/api/kiosk/gift-card/void` lives in `gift-cards.js`, not `pos.js`, and is already covered by the 46-03 global guard's device-tier rejection on non-kiosk paths. `pos-auth-tier.test.js` still includes regression tests against it since Task 3's acceptance criteria required proving admin-grade device rejection at this suite too.

## Deviations from Plan

None - plan executed exactly as written. The catalog.js async refactor was explicitly anticipated and guided by the plan's own task text ("a bare boolean helper can call a synchronous legacy-key check plus, where a request object is available, the session"); implementing it as a full `authTiers.resolveTier`-backed async gate (rather than a partial synchronous-only check) was the correct, safe interpretation since `authTiers.resolveTier` already centralizes exactly this dispatch logic and no test depended on the old synchronous-only contract.

## Issues Encountered
- The worktree had no installed `node_modules` for either `zoho-middleware/` or the frontend — symlinked both to the main repo's `node_modules` (`ln -s`) to run `npm test`/`npx jest`/`npm run lint` locally, then removed the symlinks before finishing (they were never staged/committed; both are `.gitignore`d).

## User Setup Required

None - no external service configuration required. This plan's routes now work correctly against whichever credential tier(s) are configured; no new env vars introduced (reuses `API_SECRET_KEY`/`MW_API_KEY`, `KIOSK_DEVICE_TOKEN`, and `sv_session` cookie session store, all already provisioned in 46-01/46-02/46-03).

## Next Phase Readiness
- pos.js/consignment.js/catalog.js's in-route checks are now the second enforcement layer that will NOT break when 46-10 rotates `API_SECRET_KEY` — the kiosk device token alone is sufficient on every kiosk-scoped route in this plan's scope.
- Verified via `cd zoho-middleware && npm test`: full suite green — 61 suites, 1174 tests, all coverage thresholds met.
- Frontend suite (`npm test` at repo root) also verified green (947 tests) — unaffected by this backend-only change, run out of an abundance of caution per CLAUDE.md rule #1.
- No blockers for 46-05 through 46-09 or the 46-10 cutover plan.

---
*Phase: 46-auth-re-architecture-critical-split-from-phase-45*
*Completed: 2026-07-02*
