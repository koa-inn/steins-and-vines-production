---
phase: 73-recipe-dynamic-pricing-unit-conversion-correctness-unit-awar
plan: 04
subsystem: api
tags: [express, unit-conversion, validation, recipes, money-path]

# Dependency graph
requires:
  - phase: 73-01
    provides: "shared scaling.classifyUnit / scaling.ingredientLineCost unit-conversion helper (fail-closed)"
  - phase: 73-02
    provides: "read-path unit-aware pricing wired into routes/recipes.js (enrichWithComputedPrice / enrichListPrices)"
provides:
  - "D-03 save-time unit validation pre-flight on POST /api/recipes and PUT /api/recipes/:id"
  - "D-05c pinned error-body contract: code:'unit_mismatch'/'save_failed'/'activation_locked_price'/'activation_no_ingredients' + cause, alongside the existing human error string"
affects: [73-05, brewpad-editor]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Write-boundary pre-flight validation reuses the exact read-path conversion helper (classifyUnit/ingredientLineCost) instead of duplicating unit-compatibility rules"
    - "Async cache.get pre-flight wraps callAppsScriptPost in a single .then() chain so a reject short-circuits the Apps Script write (no partial write)"

key-files:
  created: []
  modified:
    - zoho-middleware/routes/recipes.js
    - zoho-middleware/__tests__/recipes.test.js

key-decisions:
  - "Missing/unknown catalog items in a save payload are skipped (not rejected) — matches the existing enrichWithComputedPrice/enrichListPrices idiom; unit validation only fires when a catalog entry IS found and its unit family disagrees with the line's unit family"
  - "Cold-cache/no-fallback-file cases degrade gracefully (save proceeds unvalidated) rather than fail-closed on infra unavailability — consistent with every other cache.get(INGREDIENTS_ALL) consumer in this file; the fail-closed guarantee is specifically for a DETECTED mismatch, not for validator unavailability"
  - "cause is the ingredient's item_name (falling back to item_id, then the catalog entry's name) — the human-readable value the 73-05 editor highlights in the offending recipe line"

requirements-completed: [AC-04, AC-05, D-01, D-03, D-05c]

duration: ~10min
completed: 2026-08-25
---

# Phase 73 Plan 04: Recipe Save-Time Unit Validation (D-03) Summary

**Server-side pre-flight on POST/PUT /api/recipes rejects an un-convertible ingredient unit (422 + machine-readable `code`/`cause`) before any Apps Script write, closing the write-time half of the unit-conversion pricing fix.**

## Performance

- **Duration:** ~10 min
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added `validateIngredientUnits()` to `routes/recipes.js`: reads `INGREDIENTS_ALL`, resolves each incoming `payload.ingredients` line against the catalog, and runs it through the shared `scaling.ingredientLineCost` (same conversion rules the read-path already uses — no duplicated logic).
- Wired the pre-flight into both `POST /api/recipes` and `PUT /api/recipes/:id`, ahead of `callAppsScriptPost`, so an un-priceable recipe (e.g. Whirlfloc tablets saved with unit `'L'`) can never reach Apps Script and be saved as sellable (AC-05, D-01 code side).
- Shipped the pinned D-05c error contract the BrewPad editor (73-05) depends on: `{ error, code:'unit_mismatch', cause }` on reject, plus `code:'activation_locked_price'` / `code:'activation_no_ingredients'` on the existing PUT activation guardrails, and `code:'save_failed'` on the existing create/update failure bodies (422 from Apps Script `ok:false`, and the 502 catch). The human `error` string is retained on every body.
- Wrote 5 new RED tests first (unit-mismatch reject ×3 for POST/PUT/Whirlfloc-D-01, happy-path ×2), watched them fail against the un-modified route, then implemented to GREEN. Extended the two existing PUT activation-guardrail tests with `code` assertions.

## Task Commits

1. **Task 1: D-03 reject tests first (422 + code/cause + no Apps Script call)** - `991087f2` (test) — RED confirmed: 5 failing (2 extended activation-guardrail assertions + 3 new unit-mismatch reject tests)
2. **Task 2: Implement D-03 pre-flight validation + code/cause on POST/PUT** - `88d34a61` (feat) — GREEN: all 33 tests in `recipes.test.js` pass; full middleware suite 1436/1436 green; lint clean

## Files Created/Modified
- `zoho-middleware/routes/recipes.js` - Added `validateIngredientUnits()` pre-flight helper; wired into `POST /api/recipes` and `PUT /api/recipes/:id` ahead of `callAppsScriptPost`; added `code` fields to the existing activation-guardrail and save-failure bodies.
- `zoho-middleware/__tests__/recipes.test.js` - New `describe('D-03 save-time unit validation pre-flight', ...)` block (5 tests); extended the two existing PUT activation-guardrail 422 tests with `code` assertions.

## Decisions Made
- No architectural deviations. Followed the plan's pinned interface contract exactly (`res.status(422).json({ error, code:'unit_mismatch', cause })`).
- Chose to skip (not reject) ingredient lines whose `item_id` has no matching catalog entry, matching the existing enrichment idiom elsewhere in the same file — an unknown item is not, by itself, a unit-conversion problem the D-03 validator is scoped to catch.
- Chose to degrade gracefully (proceed with the save) when the ingredients catalog itself cannot be loaded (cold Redis + no fallback file present), rather than blocking every save. This mirrors every other `cache.get(INGREDIENTS_ALL)` consumer in `routes/recipes.js`. The fail-closed guarantee applies to a *detected* mismatch, not to validator infrastructure being temporarily unavailable.

## Deviations from Plan

None - plan executed exactly as written. Two environment setup steps were required but are execution-environment bootstrapping, not code deviations: the worktree checkout had no `node_modules` in either `zoho-middleware/` or the repo root, so `npm ci` was run in both locations (per the plan's `<project_specific_rules>` and CLAUDE.md rule 1) before tests could run.

## Issues Encountered
- Worktree checkout had no installed dependencies (`zoho-middleware/node_modules` and root `node_modules` both absent) — resolved with `npm ci` in both locations from the committed lockfiles, no lockfile changes.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The D-05c `code`/`cause` contract is now live on both write routes and on the pre-existing activation/save-failure bodies — 73-05 (BrewPad editor save resilience) can consume it directly without any further backend changes.
- `zoho-middleware/lib/recipe-scaling.js`'s `classifyUnit`/`ingredientLineCost` is now the single source of truth for unit-compatibility on both the read path (73-02/73-03) and the write path (this plan) — no known drift between them.
- No blockers for 73-05.

---
*Phase: 73-recipe-dynamic-pricing-unit-conversion-correctness-unit-awar*
*Completed: 2026-08-25*

## Self-Check: PASSED

- FOUND: zoho-middleware/routes/recipes.js
- FOUND: zoho-middleware/__tests__/recipes.test.js
- FOUND: .planning/phases/73-recipe-dynamic-pricing-unit-conversion-correctness-unit-awar/73-04-SUMMARY.md
- FOUND commit: 991087f2 (test)
- FOUND commit: 88d34a61 (feat)
- FOUND commit: f0ede411 (docs)
