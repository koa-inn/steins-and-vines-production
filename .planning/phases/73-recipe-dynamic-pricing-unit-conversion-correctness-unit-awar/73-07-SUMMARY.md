---
phase: 73-recipe-dynamic-pricing-unit-conversion-correctness-unit-awar
plan: 07
subsystem: ui
tags: [brewpad, recipe-editor, unit-conversion, pricing, es5, terser]

# Dependency graph
requires:
  - phase: 73 (plan 02)
    provides: server-authoritative unit-aware ingredientLineCost in zoho-middleware/lib/recipe-scaling.js
provides:
  - "bpIngredientLineCost + bpClassifyUnit: ES5 module-scope mirror of the server unit-conversion helper, exported from js/brewpad.js for Jest"
  - "Unit-aware BrewPad recipe editor Cost/Retail columns + Totals footer (renderIngredientRows, attachIngredientRowListeners qty-change, selectIngredientFromAutocompleteBp)"
  - "Distinct ing.catalog_unit field (separate from the recipe-line ing.unit) recorded in enrichIngredientsWithCatalogRates and selectIngredientFromAutocompleteBp"
  - "Visible non-convertible ('N/A') indicator in Cost/Retail cells for cross-family unit pairs, excluded from the Totals sum"
affects: [73-verification, brewpad-recipe-editor]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Client-side mirror of a server pure-function helper, verified by cross-requiring the real server module in the Jest test (not copied literals) for genuine parity"
    - "Distinct catalog-unit field pattern: never overwrite a recipe-line unit with the priced-catalog unit — record separately so a client conversion helper has two real inputs instead of one collapsed field"

key-files:
  created:
    - tests/frontend/brewpad-recipe-editor-cost.test.js
  modified:
    - js/brewpad.js
    - js/brewpad.min.js

key-decisions:
  - "Ran the scoped terser command (terser js/brewpad.js -o js/brewpad.min.js -c -m) instead of the full npm run build — the plan's own files_modified list scopes this plan to js/brewpad.js/.min.js only, and the full build additionally stamps cache-bust versions into brewpad.html/admin.js/index.html/every page, which is out of scope and would bloat the diff with unrelated changes"
  - "Test asserts real parity against zoho-middleware/lib/recipe-scaling.js via a direct cross-require (pure module, no deps) rather than hardcoded literal expectations, so drift in the server helper would break this test too"
  - "Fallback ing.catalog_unit || ing.unit used at each call site so legacy in-memory ingredient objects that predate this fix (rare — enrichIngredientsWithCatalogRates now always backfills catalog_unit on every load) degrade to the pre-existing same-unit passthrough rather than crashing or showing a spurious non-convertible flag"

requirements-completed: [CR-02]

duration: 25min
completed: 2026-08-25
---

# Phase 73 Plan 07: BrewPad Recipe Editor Unit-Aware Cost (CR-02 gap closure) Summary

**Added an ES5 `bpIngredientLineCost` mirror of the server's unit-aware `ingredientLineCost`, wired all three BrewPad recipe-editor totals sites through it, and fixed the root-cause landmine where the catalog unit and recipe-line unit collapsed into one field — a 12 g line against a $54/kg item now shows $0.65 instead of $648.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-08-25T21:00:00Z (approx, from worktree branch setup)
- **Completed:** 2026-08-25T21:26:47Z
- **Tasks:** 2 completed (both TDD: RED test → GREEN implementation, second task's implementation split into a landmine fix + wiring + rebuild)
- **Files modified:** 3 (js/brewpad.js, js/brewpad.min.js, tests/frontend/brewpad-recipe-editor-cost.test.js)

## Accomplishments

- Closed 73-REVIEW.md CR-02: the BrewPad recipe editor's per-row Cost/Retail columns and Totals footer now compute unit-aware cost, matching the server's `ingredientLineCost` for the same line — the client preview staff use to set `locked_price` is no longer silently wrong for mixed-unit lines.
- Fixed the CRITICAL landmine identified in the plan's `<interfaces>` block: `enrichIngredientsWithCatalogRates` and `selectIngredientFromAutocompleteBp` were the two places that could have overwritten the recipe-line `unit` with the catalog unit (or left them collapsed into one field). Both now record `ing.catalog_unit` as a field **distinct** from `ing.unit`, so a g-line against a kg-priced catalog item actually converts instead of the conversion silently no-opping.
- Non-convertible lines (e.g. recipe grams vs a catalog item priced in pieces) now render a visible `N/A` indicator with a title attribute carrying the fail-closed reason, and are excluded from the Totals sum — mirroring the server's D-02 fail-closed pattern instead of a silently-wrong number.
- Regression test cross-requires the real server module (`zoho-middleware/lib/recipe-scaling`) to assert genuine numeric parity, not copied literals — so future drift in the server helper would also break this test.

## Task Commits

Each task was committed atomically:

1. **Task 1a: RED — failing regression test for bpIngredientLineCost** - `08639616` (test)
2. **Task 1b: GREEN — bpClassifyUnit + bpIngredientLineCost module-scope helper** - `23d5ece4` (feat)
3. **Task 2: Capture catalog_unit distinctly, wire the three editor totals sites, rebuild min bundle** - `1aa49065` (feat)

**Plan metadata:** committed separately by the parallel-executor's caller (worktree mode — this agent does not own STATE.md/ROADMAP.md writes).

_Note: TDD Task 1 has two commits (test → feat) per the TDD execution flow; Task 2 folds the catalog_unit fix + wiring + min-bundle rebuild into one commit because they are inseparable (the wiring cannot function correctly without the catalog_unit fix landing in the same change)._

## Files Created/Modified

- `tests/frontend/brewpad-recipe-editor-cost.test.js` - Regression proving `bpIngredientLineCost` matches server `ingredientLineCost` for mass/volume/count conversions, fails closed on cross-family pairs, and that summing it over a mixed-unit ingredient list yields the correct converted total (21.15 for a 12g/$54kg + 20ml/$25l + 2pcs/$10pcs mix).
- `js/brewpad.js` - Added module-scope `bpClassifyUnit`/`bpIngredientLineCost` (mirrors `zoho-middleware/lib/recipe-scaling.js` exactly: MASS_FACTORS, VOLUME_FACTORS, COUNT_UNITS, 4dp rounding, fail-closed shape), exported alongside `bpScaleIngredients`; `enrichIngredientsWithCatalogRates` and `selectIngredientFromAutocompleteBp` now record `ing.catalog_unit` distinctly; `renderIngredientRows`, the qty-change recompute in `attachIngredientRowListeners`, and `selectIngredientFromAutocompleteBp`'s totals recompute all route through `bpIngredientLineCost` with a visible non-convertible indicator on `ok:false`.
- `js/brewpad.min.js` - Regenerated via `terser js/brewpad.js -o js/brewpad.min.js -c -m` (the exact command inside the project's `minify:js` npm script) after every source edit; never hand-edited.

## Decisions Made

- Ran the scoped terser invocation (`terser js/brewpad.js -o js/brewpad.min.js -c -m`) rather than the full `npm run build`. The plan's own frontmatter `files_modified` scopes this plan to `js/brewpad.js`/`js/brewpad.min.js` only; the full build additionally stamps a new cache-bust query version into `brewpad.html`, `admin.js`'s `BUILD_TIMESTAMP`, `index.html`, and every other page — none of which this plan's scope covers, and none of which CR-02 requires touching. This keeps the diff scoped to the actual fix, per CLAUDE.md rule #3 ("Don't touch unrelated code") and the executor's scope-boundary rule.
- The regression test cross-requires the real `zoho-middleware/lib/recipe-scaling` module (a pure module with zero dependencies) instead of hardcoding expected numbers, so the test asserts genuine parity with the live server helper rather than a snapshot that could silently drift.
- `catalogUnit = ing.catalog_unit || ing.unit` fallback at each of the three call sites: since `enrichIngredientsWithCatalogRates` now backfills `catalog_unit` on every recipe load (not just when `unit` was blank, as the old behavior did for `unit`), this fallback only matters for the brief window before a newly-added blank row has been given a catalog match — at which point `purchase_rate`/`rate` are still 0 and the cell already renders `—`, so the fallback path is never user-visible in practice.

## Deviations from Plan

None beyond the terser-scope decision documented above (which is a stricter application of CLAUDE.md rule #3, not a deviation from the plan's actual requirement — the plan's acceptance criteria only checks that `js/brewpad.min.js` is regenerated and matches `js/brewpad.js`'s commit, which this satisfies).

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed zoho-middleware dependencies via `npm ci`**
- **Found during:** Pre-commit verification (running `cd zoho-middleware && npm test` per CLAUDE.md rule #1)
- **Issue:** The worktree checkout had no `zoho-middleware/node_modules` at all — `npm test` failed with `Cannot find module` errors across 80 of 93 test suites.
- **Fix:** Ran `npm ci` from the committed `zoho-middleware/package-lock.json` (per this plan's explicit `<project_specific_rules>` instruction), installing 498 packages.
- **Files modified:** None (node_modules is gitignored; no package.json/lockfile changes).
- **Verification:** `cd zoho-middleware && npm test` → 93/93 suites, 1436/1436 tests passing.
- **Committed in:** N/A — node_modules is not committed (gitignored).

---

**Total deviations:** 1 auto-fixed (1 blocking — pre-existing environment gap, not caused by this plan's code changes)
**Impact on plan:** No scope creep. The `npm ci` was required only to run the pre-commit verification CLAUDE.md mandates; it did not touch any tracked file.

## Known Stubs

None — the "N/A" non-convertible indicator is an intentional fail-closed UI state (mirroring the server's D-02 pattern), not a stub. It renders only when a recipe line's unit is genuinely not convertible to its catalog item's unit (e.g. grams vs pieces), which is correct behavior per the plan's `<behavior>` spec, not a placeholder.

## Threat Flags

None — this plan closes an existing threat-model entry (T-73-07-01 mispricing, T-73-07-02 silently-wrong total) with no new network endpoints, auth paths, file access patterns, or schema changes. All work is client-side pure-function math + DOM rendering within the existing BrewPad editor surface.

## Issues Encountered

None beyond the missing `zoho-middleware/node_modules` documented above as a Rule 3 auto-fix.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- CR-02 is closed: the editor's Cost/Retail columns and Totals footer now match the server's unit-aware pricing for the same recipe line, and non-convertible lines are visibly flagged instead of silently wrong.
- Full frontend suite (82 suites / 1134 tests) and full middleware suite (93 suites / 1436 tests) both green; lint clean.
- No blockers for closing out Phase 73's gap-closure wave (73-06/73-07). 73-REVIEW.md's CR-02 finding can be marked resolved once this plan's SUMMARY is reviewed.

---
*Phase: 73-recipe-dynamic-pricing-unit-conversion-correctness-unit-awar*
*Completed: 2026-08-25*
