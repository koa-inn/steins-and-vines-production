---
phase: 57-kiosk-sale-blocking-recovery
plan: 04
subsystem: api
tags: [express, jest, tdd, zoho-inventory, sentry, kiosk-pos]

# Dependency graph
requires:
  - phase: 57-02
    provides: 57-DIAGNOSIS.md — confirmed root cause (stale/phantom client catalog, "CRITICAL design nuance" variant 1 vs 2)
provides:
  - Bounded server-side auto-reconcile on a kiosk sale catalog-miss (routes/pos.js processSale)
  - Exported, shared rebuildKioskCatalog() in routes/catalog.js reused by both the ?bust=1 route and the sale auto-reconcile
  - Validated, un-redacted item_id tag on the /api/kiosk/client-error beacon
affects: [57-05 (live-iPad verification), kiosk-sale-blocking-recovery closeout]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Extract-and-share rebuild logic: a single exported rebuild function reused by both a manual admin-triggered route and an automatic server-side self-heal path, so behavior can never drift between the two"
    - "Bounded one-shot server self-heal: on a stale-cache miss, force exactly one authoritative rebuild and re-check before failing closed — never loop, never trust the client on the retry either"
    - "Narrow, purpose-specific validated fields beat loosening a broad security regex: item_id gets its own strict shape-check field instead of carving an exception into the PAN-redaction rule"

key-files:
  created:
    - zoho-middleware/__tests__/pos-sale-autoreconcile.test.js
    - zoho-middleware/__tests__/pos-client-error-itemid.test.js
  modified:
    - zoho-middleware/routes/pos.js
    - zoho-middleware/routes/catalog.js

key-decisions:
  - "Direct require of routes/catalog.js from routes/pos.js (not a new shared lib) — verified no require cycle (catalog.js never requires pos.js) and this reuses fetchAllItemsCached's 60s coalescing cache, which a separate lib copy would have silently lost"
  - "Narrowed the client-error item_id validation regex from the plan's suggested /^\\d{15,19}$/ to /^\\d{17,19}$/ — the plan's own Test B example (a 16-digit card-like value must be rejected) contradicted its own suggested regex, which would have accepted 16 digits; 17-19 satisfies both the real 19-digit diagnosis case and the reject-a-16-digit-card-number requirement"
  - "A rebuild-call failure (e.g. Zoho unreachable) falls back to the pre-existing 400 rather than a new error class — safer default, and not explicitly speced by the plan's four named tests"

requirements-completed: [REVIEW-01]

# Metrics
duration: ~20min
completed: 2026-07-15
---

# Phase 57 Plan 04: Bounded Server Catalog Auto-Reconcile + Un-redacted item_id Beacon Tag Summary

**Kiosk sale catalog-miss now self-heals via one bounded Zoho rebuild (reusing the manual `?bust=1` path) before rejecting, and the client-error beacon stores a validated item_id un-redacted without weakening PAN redaction on free text.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 2 completed (each RED→GREEN, 4 commits total)
- **Files modified:** 2 (routes/pos.js, routes/catalog.js)
- **Files created:** 2 (test files)

## Accomplishments

- **Task 1 — Bounded server auto-reconcile.** `routes/catalog.js`'s inline cold-Zoho-refetch logic (the `?bust=1` cache-miss path) was extracted into an exported `rebuildKioskCatalog()`, and the `?bust=1` route was refactored to call it (behavior unchanged — existing catalog tests still green). `routes/pos.js`'s `processSale` now calls `rebuildKioskCatalog()` exactly once on the first catalog-miss, re-checks the sale's items against the rebuilt catalog, and only then falls back to the existing 400. A genuinely phantom item (absent even after rebuild) still rejects; the catalog rate is used even on self-heal — client-supplied rates are never trusted.
- **Task 2 — Un-redacted validated item_id.** `POST /api/kiosk/client-error` now reads an optional `body.item_id`, validates it against `/^\d{17,19}$/` (a real Zoho item_id shape, narrower than a generic 13-19-digit PAN heuristic), and stores it un-redacted as `tags.item_id` when valid; otherwise omits it. `scrubClientErrorText` and the redaction on `message`/`endpoint`/etc. are completely untouched.

## Task Commits

1. **Task 1 RED — auto-reconcile regression tests** - `bff19a8b` (test)
2. **Task 1 GREEN — bounded catalog auto-reconcile** - `6593070c` (fix)
3. **Task 2 RED — item_id beacon regression tests** - `1bdac2c1` (test)
4. **Task 2 GREEN — un-redacted validated item_id** - `6d01b89f` (fix)

_Both tasks followed the full RED→GREEN TDD gate: the test commit precedes and is proven failing against the pre-fix code, the fix commit follows and turns it green._

## Files Created/Modified

- `zoho-middleware/routes/catalog.js` — extracted `rebuildKioskCatalog()` (the exact cold-Zoho-refetch + cache.set logic previously inline in the `?bust=1` cache-miss branch); refactored the route to call it; exported it via `router.rebuildKioskCatalog` (mirrors the existing `router.refreshProducts` pattern).
- `zoho-middleware/routes/pos.js` — requires `./catalog` (no cycle); added `buildKioskCatalogMap()` / `findMissingCatalogItem()` helpers; `processSale`'s catalog-miss branch now does a bounded one-shot `rebuildKioskCatalog()` + re-check before rejecting (wrapped the pre-existing gift-cert/GST/lineItems/discount/tax continuation in a `continueSaleWithCatalog(catalogMap)` closure so it can run either immediately or after a successful rebuild); `/api/kiosk/client-error` now validates and tags a structured `item_id`.
- `zoho-middleware/__tests__/pos-sale-autoreconcile.test.js` (new) — Test A (self-heal), Test B (phantom still rejects), Test C (bounded to one rebuild call even with two missing items), Test D (catalog rate charged, not client rate), plus a rebuild-failure fallback test.
- `zoho-middleware/__tests__/pos-client-error-itemid.test.js` (new) — Test A (valid Zoho-shaped id stored un-redacted), Test B1/B2/B3 (card-like / non-digit / absent all omitted), Test C (message field PAN redaction unchanged).

## Decisions Made

- **Direct require, not a new shared lib.** Verified `routes/catalog.js` never requires `routes/pos.js` (no cycle), and confirmed catalog.js's top-level code only registers Express routes (no load-time side effects), so requiring it directly from pos.js is safe across the existing pos.js test suite's varied `express`/`inventory-ledger` mocks. This also preserves `fetchAllItemsCached()`'s 60s cross-endpoint coalescing cache, which a duplicated shared-lib copy would have silently lost — a plan-anticipated fallback (`zoho-middleware/lib/kiosk-catalog.js`) was available but not needed.
- **Item_id regex narrowed to 17-19 digits** (see Deviations below).
- **Rebuild-call failure falls back to the original 400** — if `rebuildKioskCatalog()` itself rejects (e.g. Zoho unreachable), the sale still hard-rejects with the pre-existing message rather than hanging, 500ing, or silently trusting a stale catalog. Not one of the plan's four named tests, but covered by an additional test and consistent with the price-anchoring intent.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Narrowed the client-error item_id validation regex from `/^\d{15,19}$/` to `/^\d{17,19}$/`**
- **Found during:** Task 2 (writing Test B1 per the plan's own behavior spec)
- **Issue:** The plan's action text suggested `/^\d{15,19}$/` as "a strict Zoho-id shape," but the plan's own Test B behavior spec requires that "a 16-digit card-like" value be rejected — and 16 digits satisfies `\d{15,19}`. The plan's suggested regex and its own acceptance test contradicted each other.
- **Fix:** Used `/^\d{17,19}$/` instead, which still accepts the real 19-digit diagnosis item_id (`1099000000000109115`) and the ~18-digit "valid Zoho item IDs" the diagnosis describes, while rejecting the 16-digit card-shaped test vector.
- **Files modified:** `zoho-middleware/routes/pos.js`, `zoho-middleware/__tests__/pos-client-error-itemid.test.js` (comment wording only)
- **Verification:** Test B1 (16-digit card-like value omitted) passes; Test A/C (19-digit real item_id) pass.
- **Committed in:** `6d01b89f` (Task 2 fix commit)

**2. [Rule 1 - Bug] Test fixture correction in pos-sale-autoreconcile.test.js (Test D)**
- **Found during:** Task 1, first GREEN run
- **Issue:** The Test D fixture item had no `tax_id`, so `computeTax`'s implicit 5%-default-tax fallback applied, making the expected grandTotal 44.1 instead of the intended clean catalog rate of 42 — an assertion bug in the test fixture, not a bug in the implementation.
- **Fix:** Added `tax_id`/`tax_percentage: 0` to the fixture item so the default-tax fallback doesn't apply, keeping the assertion a clean read of "the catalog rate was used."
- **Files modified:** `zoho-middleware/__tests__/pos-sale-autoreconcile.test.js`
- **Verification:** Test D passes with `termCall[0] === 42`.
- **Committed in:** `6593070c` (Task 1 fix commit, alongside the GREEN implementation)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — correcting an internal contradiction in the plan's own regex-vs-test-spec, and a test-fixture tax assumption). No scope creep; both are within the two tasks' own files.

## Issues Encountered

- The worktree had no `node_modules` installed for either the root project or `zoho-middleware/` (fresh worktree checkout, `node_modules` is gitignored). Ran `npm install` in both before any test could execute. Not a plan defect — a normal worktree-freshness step.

## User Setup Required

None — no external service configuration required. This is a pure code change; deployment reality (per the plan's own note) is that it rides straight to the prod Railway instance in 57-05, after 57-03's client fix is verified.

## Next Phase Readiness

- Satisfies the SERVER safety-net half of Phase 57 SC#3 (variant 1 self-heals; price-anchoring intact) and the server half of the 57-DIAGNOSIS beacon finding 2 (item_id now observable un-redacted).
- 57-05 (live-iPad verification, SC#4) can proceed once 57-03 (client fix, sibling worktree) is also merged — this plan's safety net is deliberately scoped to go live only after 57-03's client-side fix is verified per the plan's "Deployment reality" note.
- No blockers. Full middleware suite (83 suites / 1301 tests) and full frontend suite (64 suites / 1014 tests) green; both lints clean.

---
*Phase: 57-kiosk-sale-blocking-recovery*
*Completed: 2026-07-15*
