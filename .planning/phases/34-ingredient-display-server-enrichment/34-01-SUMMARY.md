---
phase: 34-ingredient-display-server-enrichment
plan: 01
subsystem: ui
tags: [constants, grouping-helper, jest, vanilla-js, es5, recipe-display]

# Dependency graph
requires:
  - phase: 23-cross-category-search
    provides: "CATEGORY_DISPLAY_NAMES map (source of truth before promotion)"
provides:
  - "CATEGORY_DISPLAY_NAMES shared in js/lib/constants.js (D-04)"
  - "groupRecipeIngredients shared helper in js/lib/recipe-grouping.js (D-09)"
  - "Jest suite for groupRecipeIngredients (D-01..D-07, D-11)"
affects:
  - 34-02 (server enrichment — reads cf_type/cf_subcategory to be grouped)
  - 34-03 (surface renders — admin/kiosk/BrewPad consume groupRecipeIngredients)
  - js/modules/17-search-overlay.js (now uses global CATEGORY_DISPLAY_NAMES)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Global constant promotion: var declarations in js/lib/constants.js + module.exports block; tests set global.VAR = require(constants).VAR"
    - "Shared pure helper in js/lib/ with module.exports guard for Jest + browser global fallback"
    - "Fixed-order section grouping via SECTION_ORDER array; hybrid cf_type/cf_subcategory bucketing"

key-files:
  created:
    - js/lib/recipe-grouping.js
    - tests/frontend/recipe-grouping.test.js
  modified:
    - js/lib/constants.js
    - js/modules/17-search-overlay.js
    - tests/frontend/17-search-overlay.test.js

key-decisions:
  - "CATEGORY_DISPLAY_NAMES promoted to js/lib/constants.js; 17-search-overlay.js drops local copy and uses the global (load-order safe in browser; tests set global.CATEGORY_DISPLAY_NAMES explicitly)"
  - "groupRecipeIngredients resolves CATEGORY_DISPLAY_NAMES via require in Jest, global in browser — no dual-var or module pattern needed in the helper itself"
  - "SECTION_ORDER defined once in recipe-grouping.js as the ordering authority for all three surfaces"

patterns-established:
  - "Jest global setup for shared browser globals: global.VAR = require('../../js/lib/constants.js').VAR at top of test file"
  - "Cold-cache guard in groupRecipeIngredients: check anyEnriched before bucketing; return single flat group with label='' when cold"
  - "Hybrid nest rule: realSubcats.length >= 2 triggers subcategory-level sections; otherwise flat under cf_type"

requirements-completed: [RDISP-02]

# Metrics
duration: 18min
completed: 2026-06-19
---

# Phase 34 Plan 01: Grouping Helper Foundation Summary

**`groupRecipeIngredients` shared helper + promoted `CATEGORY_DISPLAY_NAMES` — one grouping implementation for admin/kiosk/BrewPad with hybrid cf_type/cf_subcategory bucketing and fixed brewing-process section order**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-06-19T14:45:00Z
- **Completed:** 2026-06-19T15:03:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Promoted `CATEGORY_DISPLAY_NAMES` from search-overlay IIFE into `js/lib/constants.js` as a top-level shared constant with two new cf_type-value keys (`Ingredient`, `Cleaning/Sanitization`); search-overlay and all future surfaces use the same map
- Created `js/lib/recipe-grouping.js` implementing all grouping rules D-01..D-07/D-11: hybrid cf_type/cf_subcategory bucketing, fixed SECTION_ORDER, recipe-entry order within sections, cold-cache flat fallback, Other-last, per-group counts, and CATEGORY_DISPLAY_NAMES label collapse
- Jest suite (16 tests) verifies every behavior bullet in the plan including cold-cache (D-07), Other-last (D-06), fixed section order (D-03), and no-mutation safety (T-34-01); all 696 frontend tests pass

## Task Commits

1. **Task 1: Promote CATEGORY_DISPLAY_NAMES into js/lib/constants.js** - `d062aae` (feat)
2. **Task 2: Create js/lib/recipe-grouping.js shared helper + Jest suite** - `252ec6f` (feat)

## Files Created/Modified

- `js/lib/constants.js` — Added `CATEGORY_DISPLAY_NAMES` var with all existing keys plus `'Ingredient'` and `'Cleaning/Sanitization'`; added to module.exports block
- `js/modules/17-search-overlay.js` — Removed local `CATEGORY_DISPLAY_NAMES` var; now reads shared global
- `tests/frontend/17-search-overlay.test.js` — Added `global.CATEGORY_DISPLAY_NAMES = require(constants).CATEGORY_DISPLAY_NAMES` so Jest tests pass after promotion
- `js/lib/recipe-grouping.js` — New shared grouping helper with `SECTION_ORDER` and `groupRecipeIngredients`
- `tests/frontend/recipe-grouping.test.js` — 16-test Jest suite covering D-01..D-07, D-11, T-34-01

## Decisions Made

- Used `global.CATEGORY_DISPLAY_NAMES = constants.CATEGORY_DISPLAY_NAMES` in tests rather than bare `require('constants.js')` — Node.js `var` declarations are module-scoped, not global, so bare require does not populate the global; explicit assignment is required for Jest
- `groupRecipeIngredients` cold-cache detection checks `anyEnriched` (whether any ingredient has a non-empty `cf_type` or `cf_subcategory`) before bucketing; if none are enriched, a single flat group with `label: ''` is returned so Plan 03 surfaces can render their existing flat-list behavior unmodified
- Hybrid nesting decision: `realSubcats.length >= 2` triggers subcategory-level sections; `'Other'` (from missing cf_subcategory) is not counted as a "real" subcat to avoid spurious nesting when enrichment is partially missing

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Test required explicit global assignment, not bare require**

- **Found during:** Task 1 (verify search-overlay test after CATEGORY_DISPLAY_NAMES promotion)
- **Issue:** The plan said "add `require('../../js/lib/constants.js')` at the top of that test to populate the global." In Node.js, `var` declarations in a required file are module-scoped, not global — bare `require` does not make `CATEGORY_DISPLAY_NAMES` available to the IIFE. The test failed with ReferenceError.
- **Fix:** Changed to `var constants = require('../../js/lib/constants.js'); global.CATEGORY_DISPLAY_NAMES = constants.CATEGORY_DISPLAY_NAMES;` in the test file header.
- **Files modified:** `tests/frontend/17-search-overlay.test.js`
- **Verification:** All 15 search-overlay tests pass after fix; same pattern applied to recipe-grouping test.
- **Committed in:** d062aae (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking test issue)
**Impact on plan:** Minimal — only the test setup line changed from what the plan specified; the intent (populate the global) was preserved. No scope creep.

## Issues Encountered

None beyond the test global-assignment fix above.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. `groupRecipeIngredients` is a pure client-side transform with no I/O. T-34-01 (no mutation/no ingredient dropping) is covered by test assertion.

## Known Stubs

None — this plan establishes the shared helper only; Plan 03 wires it into admin/kiosk/BrewPad rendering.

## Next Phase Readiness

- Plan 02 (server enrichment): `cf_type`/`cf_subcategory` fields need to be attached by middleware `recipes.js` enrich loops so ingredients arriving at the client have the fields that `groupRecipeIngredients` reads
- Plan 03 (surface renders): can now call `groupRecipeIngredients(recipe.ingredients)` at all three call sites (admin, kiosk, BrewPad) and iterate the returned group array for display
- `CATEGORY_DISPLAY_NAMES` is ready in `js/lib/constants.js` for both Plans 02 and 03 to import/reference

---
*Phase: 34-ingredient-display-server-enrichment*
*Completed: 2026-06-19*
