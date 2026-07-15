---
phase: 57-kiosk-sale-blocking-recovery
plan: 03
subsystem: ui
tags: [kiosk, es5, jest, catalog-freshness, client-error-beacon, pos]

# Dependency graph
requires:
  - phase: 57-02
    provides: 57-DIAGNOSIS.md — confirmed variant-2 cause (stale client catalog / phantom item)
provides:
  - "kioskLoadProducts(true) self-heal on wake/staleness — a loaded-but-stale kiosk catalog force-refreshes and drops phantom items without a manual product-list refresh"
  - "Pre-checkout phantom guard in kioskProceedToPayment — a cart line whose item_id is no longer in a LOADED catalog is blocked client-side before /api/kiosk/sale, server price-anchoring guard (pos.js:325-333) untouched as backstop"
  - "Sale server-error branch (non-202 result in _kioskPushToTerminal) now beacons _kcReportClientError with endpoint/http_status/message + a structured, length-capped item_id field parsed from the catalog-miss error text"
affects: [57-04, 57-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Catalog staleness clock: _kioskProductsLoadedAt + KIOSK_CATALOG_MAX_AGE_MS (10 min), checked in kioskRetryStalledLoads on visibilitychange/online/pageshow wake events"
    - "Client-side pre-flight checks never replace the server guard — they are additive fail-safes; Test C explicitly asserts the sale POST is suppressed while the server 400 remains reachable if the client check is ever bypassed"
    - "Beacon payload fields are added CONDITIONALLY (only when meaningful) to avoid changing the whitelisted key-set for existing call sites — item_id is omitted entirely rather than sent as an explicit undefined key"

key-files:
  created:
    - tests/frontend/kiosk-catalog-freshness.test.js
    - tests/frontend/kiosk-sale-beacon-servererror.test.js
  modified:
    - js/kiosk-core.js
    - js/kiosk-core.min.js
    - admin.html
    - kiosk.html

key-decisions:
  - "Pre-checkout phantom guard scoped to LOADED, non-empty _kioskProducts only (not an empty/never-fetched catalog) — an empty catalog means nothing authoritative exists yet to check against, not staleness; this also keeps every pre-existing test that never calls loadProducts() (kiosk-core-parity, kiosk-html-escaping) unaffected"
  - "Guard scoped to !isRecipeSale && !_kioskImportedSoId — recipe ingredients live in a separate catalog (_kioskIngredientCatalog) and an imported Sales Order's lines come straight from Zoho; neither is a candidate for THIS catalog going stale"
  - "KIOSK_CATALOG_MAX_AGE_MS = 10 minutes — bounds staleness without refetching on every wake (T-57-03-03 DoS mitigation)"
  - "pageshow listener added alongside the existing visibilitychange/online wake signals — iOS Safari bfcache restore does not always fire visibilitychange"
  - "item_id parsed from the server error message via /(\\d{15,})/ (Zoho item ids are 18-19 digits) rather than requiring the server to add a new structured field — no server-side change needed for this client half (57-04 covers the server half)"

requirements-completed: [REVIEW-01]

# Metrics
duration: ~15min
completed: 2026-07-15
---

# Phase 57 Plan 03: Kiosk Client Catalog Self-Heal + Phantom Guard + Sale-Error Beacon Summary

**Kiosk client now force-refreshes a stale product catalog on wake (visibilitychange/online/pageshow past a 10-minute bound), blocks a cart line whose item_id is missing from the loaded catalog before the sale POST, and beacons the sale-push 400 branch with a structured item_id — closing the confirmed variant-2 stale-catalog cause from 57-DIAGNOSIS.md, client half.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-15T11:28Z (worktree branch check)
- **Completed:** 2026-07-15T11:46Z
- **Tasks:** 3 (all completed)
- **Files modified:** 5 (2 new test files, js/kiosk-core.js, js/kiosk-core.min.js, admin.html, kiosk.html)

## Accomplishments
- The CONFIRMED variant-2 cause (a long-open kiosk holding a stale catalog with a phantom item_id, e.g. `1099000000000109115`, that no longer exists in Zoho) now self-heals: `kioskRetryStalledLoads` force-refreshes a loaded-but-stale catalog on the next wake event, riding the existing 7cbf856 keep-last-good `.catch` unchanged.
- A cart line carrying a phantom item_id is blocked client-side with a staff-facing message BEFORE the `/api/kiosk/sale` POST — the server's price-anchoring guard (`pos.js:325-333`) remains the backstop, untouched.
- The sale server-error branch (the exact 400 the owner photographed) now fires `_kcReportClientError` with the real endpoint/status/message plus a structured `item_id` field that survives PAN redaction (a 19-digit Zoho id would otherwise collide with the 13-19-digit card-number heuristic) — closing both 57-DIAGNOSIS.md beacon findings for the client half.

## Task Commits

Each task was committed atomically (RED then GREEN for the two TDD tasks):

1. **Task 1 RED — reproduce stale-catalog phantom sale rejection** - `59ead8cd` (test)
2. **Task 1 GREEN — self-heal stale kiosk catalog + block phantom cart lines** - `9a7fe5cf` (fix)
3. **Task 2 RED — sale server-error branch must beacon with item_id** - `5d1f70cc` (test)
4. **Task 2 GREEN — beacon kiosk sale server errors with structured item_id** - `0363c47a` (fix)
5. **Test-reliability fix (Rule 1, discovered before Task 3's build verification)** - `fb6c3577` (test)
6. **Task 3 — regenerate kiosk bundles** - `fe3af000` (build)

_Note: two TDD tasks each produced a RED commit followed by a GREEN commit, per the RED-first protocol._

## Files Created/Modified
- `tests/frontend/kiosk-catalog-freshness.test.js` - Task 1's 3 RED-first tests (staleness refresh, keep-last-good resilience, pre-checkout phantom guard)
- `tests/frontend/kiosk-sale-beacon-servererror.test.js` - Task 2's 2 RED-first tests (beacon fires on the non-202 sale branch; payload carries item_id)
- `js/kiosk-core.js` - `_kioskProductsLoadedAt` + `KIOSK_CATALOG_MAX_AGE_MS`; staleness branch in `kioskRetryStalledLoads`; `pageshow` listener; pre-checkout phantom guard in `kioskProceedToPayment`; beacon call + optional `item_id` whitelist field in the sale-push non-202 branch and `_kcReportClientError`
- `js/kiosk-core.min.js` - regenerated via `npm run build` (terser -c -m) from the above
- `admin.html`, `kiosk.html` - cache-bust query-string bump for `kiosk-core.min.js` only (both surfaces load it); all other incidental build churn on these and every other page was reverted (see Deviations)

## Decisions Made
- Scoped the pre-checkout phantom guard to a LOADED, non-empty catalog only — see key-decisions above. This was necessary to avoid false positives against every existing test that builds a cart without ever calling `kioskLoadProducts()` (`kiosk-core-parity.test.js`, `kiosk-html-escaping.test.js`), which would otherwise have been broken by a naive "item_id not found → block" check.
- Parsed `item_id` from the server's free-text error message via a digit-run regex rather than requiring a server-side contract change — keeps this plan's scope to the client half, per 57-DIAGNOSIS.md's split (57-04 owns the server half).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed flaky test timing margin + cross-test DOM listener leak in the new test file**
- **Found during:** Task 3 (pre-build full-suite verification — `npm test` run repeatedly surfaced intermittent failures in `kiosk-catalog-freshness.test.js` that did not reproduce on every isolated run)
- **Issue:** Two compounding test-harness bugs, both self-inflicted in the new RED test file: (a) `PAST_STALENESS_BOUND_MS` used only a `+1ms` buffer past `KIOSK_CATALOG_MAX_AGE_MS`, which the real (unmocked) wall-clock gap between capturing `realNow` and `_kioskProductsLoadedAt` actually being set inside the fetch promise chain occasionally exceeded under CPU contention; (b) `loadSurface()` (mirroring the existing pattern in `kiosk-load-recovery.test.js`/`kiosk-load-resilience.test.js`) creates a fresh `KioskCore` closure per test but never detaches the PREVIOUS closure's `document`/`window` listeners — harmless in the pre-existing tests (their retry guard is `!loaded`, a no-op once true) but not in this file's NEW staleness check, which a stale prior closure can also satisfy once `Date.now()` is mocked forward, racing the shared `global.fetch` mock queue.
- **Fix:** Widened the staleness buffer to `+5s`; added a `document.addEventListener`/`window.addEventListener` tracking wrapper that detaches all previously-registered listeners at the start of every `loadSurface()` call.
- **Files modified:** `tests/frontend/kiosk-catalog-freshness.test.js`
- **Verification:** 8 consecutive isolated runs + 3 consecutive full-suite (`npm test`, 1019 tests) runs, all green, no flakes observed after the fix.
- **Committed in:** `fb6c3577`

**2. [Rule 3 - Blocking, scope discipline] Reverted incidental `npm run build` churn unrelated to this plan**
- **Found during:** Task 3 (build step)
- **Issue:** `npm run build` unconditionally re-stamps a `BUILD_TIMESTAMP` in `js/admin.js`/`js/admin.min.js` and bumps a single shared cache-bust `?v=` query param across every HTML page's asset references, regardless of which source file actually changed. Since only `js/kiosk-core.js` changed (no `js/modules/*` or `js/admin.js` source edit), this produced diffs in `about.html`, `brewpad.html`, `contact.html`, `custom-labels.html`, `index.html`, `ingredients.html`, `products.html`, all 8 `products/*.html` subpages, `reservation.html`, and `js/admin.js`/`js/admin.min.js` — none of which reference or are affected by `kiosk-core.js`.
- **Fix:** `git checkout --` on every page/file unrelated to `kiosk-core.min.js`; hand-reverted the non-`kiosk-core.min.js` asset version bumps within `admin.html` and `kiosk.html` (the two pages that DO legitimately need the `kiosk-core.min.js` cache-bust) back to their prior values, leaving only the `kiosk-core.min.js?v=` bump.
- **Files modified:** (reverted, not committed) `about.html`, `brewpad.html`, `contact.html`, `custom-labels.html`, `index.html`, `ingredients.html`, `products.html`, `products/*.html` (8 files), `js/admin.js`, `js/admin.min.js`
- **Verification:** `git status --short` showed only `admin.html`, `kiosk.html`, `js/kiosk-core.min.js` before the Task 3 commit.
- **Committed in:** `fe3af000` (the narrowed diff)

### Notes (not deviations — pre-existing/environment, out of scope)

- **Plan's automated verify command for Task 3** (`grep -q "KIOSK_CATALOG_MAX_AGE_MS" js/kiosk-core.min.js`) does not pass, because terser mangles local variable/constant names inside the module IIFE by default — confirmed pre-existing for this codebase (`MAKERS_FEE_SKU`, an existing constant, is equally absent from the bundle both before and after this change). Verified instead via string-literal evidence that survives minification (`'pageshow'`, `'/api/kiosk/client-error'` both present, count 1 each) plus the full frontend test suite passing against the unminified source that the bundle is built from.
- **`cd zoho-middleware && npm test` could not run in this worktree** — `zoho-middleware/node_modules` does not exist in this parallel worktree checkout (a pre-existing worktree-provisioning gap, not caused by any change in this plan). This plan touches zero middleware files; the sibling 57-04 agent owns `zoho-middleware/` in its own separate worktree. Logged here for visibility, not acted on (installing dependencies is excluded from auto-fix and out of this plan's scope).

---

**Total deviations:** 2 auto-fixed (1 test-only bug fix, 1 scope-discipline revert of incidental build churn)
**Impact on plan:** Both deviations were necessary for correctness (a genuinely flaky test would have been a false safety net) and to honor CLAUDE.md's "don't touch unrelated code" rule. No behavior/source scope creep — `js/kiosk-core.js` changes are exactly what Tasks 1-2 specified.

## Issues Encountered
None beyond the two deviations above (both resolved).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Client half of the confirmed variant-2 cause (57-DIAGNOSIS.md) is fixed, RED-first, and verified via 5 new + 105 existing kiosk frontend tests, all green.
- 57-04 (server-side auto-reconcile safety net, `zoho-middleware/`) proceeds independently in its own worktree — no file overlap with this plan.
- 57-05 (live-iPad verification, SC#4) is next and depends on both 57-03 and 57-04 landing.
- No blockers.

## Self-Check: PASSED

All created files verified present on disk; all 7 task/summary commit hashes verified present in `git log --oneline --all`.

---
*Phase: 57-kiosk-sale-blocking-recovery*
*Completed: 2026-07-15*
