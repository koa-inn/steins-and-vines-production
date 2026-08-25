---
phase: 73-recipe-dynamic-pricing-unit-conversion-correctness-unit-awar
plan: 06
subsystem: middleware
tags: [inventory, stock-gate, unit-conversion, recipe-scaling, availability, gap-closure]

requires:
  - phase: 73-01
    provides: "ingredientLineCost/classifyUnit shared unit-conversion helper (D-01/D-02) in zoho-middleware/lib/recipe-scaling.js"
  - phase: 73-03
    provides: "checkScaledStock call sites in pos-recipe.js quote/confirm handlers"
provides:
  - "checkScaledStock compares ingredientLineCost(entry, ing).convertedQty against stock_on_hand, not the raw unconverted recipe-line quantity"
  - "checkScaledStock fails CLOSED on a non-convertible unit pair (reported as a conflict, never a silent pass or raw-quantity fallback)"
  - "GET /api/recipes/:id/availability computes batches_possible from unit-converted needed quantity, retaining the catalog entry's unit instead of a stock-only map"
affects: [pos-recipe-kiosk-stock-gate, recipe-availability-endpoint]

tech-stack:
  added: []
  patterns:
    - "checkScaledStock/availability handler both reuse the single ingredientLineCost/classifyUnit helper for stock-gate conversion — same pattern the pricing sum-sites (computeScaledRecipeTotal, computeModifiedRecipeTotal) already used (D-01/D-02), now extended to inventory comparisons (CR-01/WR-01)"
    - "pos-recipe.js confirm handler: unpriceable-line detection (POST-CHARGE void safety net) now runs BEFORE the stock re-check, so a non-convertible unit hits the void-and-502 path rather than a bare 409 that would leave an already-charged card un-voided"

key-files:
  created: []
  modified:
    - zoho-middleware/lib/recipe-scaling.js
    - zoho-middleware/__tests__/recipe-scaling.test.js
    - zoho-middleware/routes/recipes.js
    - zoho-middleware/__tests__/recipes.test.js
    - zoho-middleware/routes/pos-recipe.js

key-decisions:
  - "checkScaledStock fails CLOSED (reports a conflict) on ingredientLineCost ok:false rather than falling back to the raw ing.quantity — the 73-REVIEW.md suggested-fix snippet used a raw-quantity fallback; this plan explicitly rejected that in favor of the phase-wide D-02 fail-closed pattern"
  - "Reordered the pos-recipe.js /confirm handler so the unpriceable-line (POST-CHARGE void safety net) check runs before checkScaledStock — without this, a non-convertible-unit line would now be caught by the stricter stock gate first and return a bare 409, silently leaving an already-charged card un-voided (discovered via the pre-existing U4c regression test)"
  - "Existing checkScaledStock/availability test fixtures (recipe-scaling.test.js, recipes.test.js) were updated to add a `unit` field to catalogMap/catalog entries that previously omitted it — production catalog entries always carry `unit` (routes/catalog.js); the omission was an unrealistic fixture gap that would otherwise trip the new fail-closed path on same-unit cases. No assertions were changed, only fixture data made realistic."
  - "Availability endpoint's non-convertible fail-closed badge uses batches_possible: 0 / status 'out' (informational-only surface, WR-01 lower severity than CR-01, per plan's threat register T-73-06-03 accept-after-fix disposition)"

requirements-completed: [CR-01, WR-01]

duration: ~25min
completed: 2026-08-25
---

# Phase 73 Plan 06: Gap Closure — Unit-Aware Stock Gate (CR-01/WR-01) Summary

**`checkScaledStock` and the recipe availability endpoint now compare unit-CONVERTED quantities against `stock_on_hand` via the existing `ingredientLineCost` helper instead of raw unconverted recipe-line quantities, fail closed on non-convertible units, and the `pos-recipe.js` confirm handler was reordered so the POST-CHARGE void safety net still fires correctly on a non-convertible line.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-08-25
- **Tasks:** 2 (both TDD: RED regression test, then GREEN implementation)
- **Files modified:** 5

## Accomplishments

- `checkScaledStock` (zoho-middleware/lib/recipe-scaling.js) now calls `ingredientLineCost(entry, ing)` per line and compares `.convertedQty` (in the catalog item's own stocking unit) against `stock_on_hand`, closing the exact bug class CR-01 named: a per-kg item at 2kg on hand with a 500g recipe line is no longer falsely blocked (`500 > 2` raw comparison), and a per-kg item at 0.4kg on hand with a 500g line, plus the inverse direction (g-stocked item, kg-unit line), both correctly report a conflict.
- Non-convertible unit pairs (e.g. a `pcs`-stocked item against a `g` recipe line) fail CLOSED — `checkScaledStock` reports a conflict, never falling back to the raw mismatched quantity (rejecting the 73-REVIEW.md suggested-fix snippet's raw-quantity fallback, per the plan's explicit instruction).
- Both `pos-recipe.js` call sites (quote-time gate ~L240, confirm-time gate) consume the unchanged `{ item_id, item_name, needed, stock, unit }` conflict shape — no caller-side changes needed for the conflict rendering itself.
- `GET /api/recipes/:id/availability` (routes/recipes.js) now retains the full catalog entry (`unit` + `stock_on_hand`) instead of a stock-only map, and computes `batches_possible` from the unit-converted needed quantity; a mixed-unit case (per-kg item, 500g line, 1kg on hand) now correctly reports 2 batches / `'low'` instead of the pre-fix `floor(1/500) = 0` / `'out'`. Non-convertible lines fail closed to `0` batches / `'out'` (informational-only, conservative badge — WR-01 is lower severity than CR-01 per the plan's threat register).
- Discovered and fixed a real ordering regression during Task 1: the `pos-recipe.js` `/confirm` handler previously ran the stock re-check (`checkScaledStock`) BEFORE the unpriceable-line detection loop that triggers the POST-CHARGE void safety net. With the stock gate now failing closed on non-convertible units, a non-convertible line would hit the stricter stock check first and return a bare 409 — leaving an already-charged card un-voided. Reordered so unpriceable-line detection (and its void-transaction safety net) runs first; the existing `U4c` regression test (post-charge safety net voids the transaction) caught this immediately.

## Task Commits

Each task was committed atomically (TDD RED → GREEN per task):

1. **Task 1: Make checkScaledStock unit-aware (fail-closed)** — `763c2172` (test, RED) → `686757f6` (feat, GREEN; also includes the `pos-recipe.js` confirm-handler reorder fix and existing-fixture `unit` additions)
2. **Task 2: Unit-convert the recipe availability endpoint (WR-01)** — `6389e744` (test, RED) → `e1ae3e0b` (feat, GREEN; also includes existing-fixture `unit` additions)

_TDD gate compliance: each task's `test(73-06)` commit precedes its `feat(73-06)` commit — RED → GREEN sequence verified in git log (`git log --oneline` above)._

## Files Created/Modified

- `zoho-middleware/lib/recipe-scaling.js` — `checkScaledStock` now calls `ingredientLineCost` per line; fails closed on `ok:false`.
- `zoho-middleware/__tests__/recipe-scaling.test.js` — 6 new `checkScaledStock` regression tests (false-block, both oversell directions, non-convertible fail-closed, 2 same-unit regressions); 4 pre-existing tests updated to add `catalogMap[id].unit` (fixture realism, no assertion changes).
- `zoho-middleware/routes/recipes.js` — availability handler retains full catalog entry (`entryMap`, was `stockMap`), computes `needed` via `scaling.ingredientLineCost(entry, ing).convertedQty`, fails closed to 0 batches on non-convertible.
- `zoho-middleware/__tests__/recipes.test.js` — 3 new WR-01 regression tests (mixed-unit, non-convertible, same-unit regression); 2 pre-existing availability tests updated to add catalog `unit` (fixture realism, no assertion changes).
- `zoho-middleware/routes/pos-recipe.js` — reordered the `/confirm` handler so the unpriceable-line detection/void safety net runs before the (now stricter) `checkScaledStock` re-check.

## Decisions Made

- See `key-decisions` in frontmatter. Primary judgment calls: (1) fail-closed with no raw-quantity fallback, exactly as the plan mandated against the review's suggested snippet; (2) fixing the confirm-handler check ordering rather than softening `checkScaledStock`'s fail-closed behavior, since softening it would have reopened CR-01 for that call site; (3) adding `unit` to pre-existing test fixtures rather than leaving them broken, since the omission was unrealistic (production catalog entries always carry `unit`) and no assertion values needed to change.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `pos-recipe.js` confirm handler: unpriceable-line void safety net must run before the (now fail-closed) stock re-check**
- **Found during:** Task 1, running the full middleware suite after the `checkScaledStock` fix
- **Issue:** `checkScaledStock`'s new fail-closed behavior on non-convertible units caused the confirm handler's stock re-check (which ran first) to intercept a non-convertible line and return a bare `409 Insufficient stock` — before reaching the existing unpriceable-line detection loop that voids the already-charged terminal transaction. This would have left a real card charge un-voided on a non-convertible-unit recipe line, exactly the "silent post-charge failure" scenario Phase 73's D-02 tiered fail-closed pattern was built to prevent.
- **Fix:** Reordered the confirm handler: the unpriceable-line detection loop (and its void-transaction + 502 `payment_voided: true` response) now runs before `checkScaledStock`. Every line reaching the stock gate is therefore already confirmed priceable/convertible, so a stock-gate conflict there is a genuine oversell, not a unit mismatch.
- **Files modified:** `zoho-middleware/routes/pos-recipe.js`
- **Commit:** `686757f6`

**2. [Rule 1 - Bug] Pre-existing test fixtures missing catalog `unit` field**
- **Found during:** Task 1 and Task 2, running the full middleware suite after each fix
- **Issue:** 6 pre-existing tests (4 in `recipe-scaling.test.js`, 2 in `recipes.test.js`) used catalog/catalogMap fixtures that omitted `unit` — an unrealistic gap, since production catalog entries (`routes/catalog.js`) always populate `unit`. With the new fail-closed behavior, a missing catalog `unit` now correctly classifies as non-convertible and trips a conflict, breaking these tests even though the ingredient lines and catalog items were genuinely same-unit in intent.
- **Fix:** Added the matching `unit` field to each affected catalog/catalogMap fixture entry (e.g. `{ stock_on_hand: 10 }` → `{ stock_on_hand: 10, unit: 'kg' }`). No test assertions were changed — only the fixture data was made realistic.
- **Files modified:** `zoho-middleware/__tests__/recipe-scaling.test.js`, `zoho-middleware/__tests__/recipes.test.js`
- **Commits:** `686757f6`, `e1ae3e0b`

## Issues Encountered

None beyond the two auto-fixed deviations above (both surfaced immediately by the existing regression suite, both resolved within the same task before committing GREEN).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- CR-01 closed: both `pos-recipe.js` stock gates (quote-time and confirm-time, via `checkScaledStock`) now compare unit-converted quantities; mixed-unit oversell is blocked, valid mixed-unit sales are allowed, non-convertible units fail closed.
- WR-01 closed: the availability endpoint converts before computing `batches_possible`/status.
- Full middleware suite (1445/1445) and frontend suite (1126/1126) green as of this plan's final commit; `npm run lint` clean in `zoho-middleware`.
- No duplication of conversion factors — `checkScaledStock` and the availability handler both reuse the single `ingredientLineCost`/`classifyUnit` helper introduced in 73-01.
- No blockers for downstream phases (73-07 gap closure is independent — editor preview, not touched here).

---
*Phase: 73-recipe-dynamic-pricing-unit-conversion-correctness-unit-awar*
*Completed: 2026-08-25*

## Self-Check: PASSED

All claimed files exist (zoho-middleware/lib/recipe-scaling.js, zoho-middleware/__tests__/recipe-scaling.test.js, zoho-middleware/routes/recipes.js, zoho-middleware/__tests__/recipes.test.js, zoho-middleware/routes/pos-recipe.js, this SUMMARY.md) and all claimed commits (763c2172, 686757f6, 6389e744, e1ae3e0b) are present in git log.
