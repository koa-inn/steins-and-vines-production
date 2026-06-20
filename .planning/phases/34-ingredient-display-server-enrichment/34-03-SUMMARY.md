---
phase: 34-ingredient-display-server-enrichment
plan: 03
subsystem: ui
tags: [admin, brewpad, kiosk, recipe-display, grouping, vanilla-js, es5, build]

# Dependency graph
requires:
  - phase: 34-ingredient-display-server-enrichment
    provides: "groupRecipeIngredients helper (34-01) + server cf_type/cf_subcategory enrichment (34-02)"
provides:
  - "Grouped recipe-ingredient sections on admin recipe builder table (RDISP-01)"
  - "Grouped recipe-ingredient table in BrewPad batch recipe section (RDISP-03)"
  - "Grouped recipe-ingredient list on kiosk recipe selection (RDISP-03)"
  - "recipe-grouping.js loaded via <script> on admin/kiosk/brewpad pages"
affects:
  - js/main.js / js/main.min.js (rebuilt)
  - js/admin.min.js / js/brewpad.min.js / js/kiosk.min.js (rebuilt)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Group-header rows via colspan cells; flat running index mapped to original array position via ingredients.indexOf(ing) to preserve edit read-back"
    - "Single shared local render (kioskRenderRecipeIngredients) replacing duplicated render blocks"
    - "Additive snapshot enrichment: carry display-only cf fields into frozen recipe_snapshot without touching money-path fields"

key-files:
  created:
    - .planning/phases/34-ingredient-display-server-enrichment/34-03-SUMMARY.md
  modified:
    - js/admin.js
    - js/brewpad.js
    - js/kiosk.js
    - admin.html
    - kiosk.html
    - brewpad.html
    - js/main.js
    - js/main.min.js

key-decisions:
  - "data-ing-idx / data-idx map to ORIGINAL array position via ingredients.indexOf(ing), not a display-order running counter — the helper reorders ingredients across sections, so a naive counter would break edit read-back"
  - "recipe-grouping.js loaded only via standalone <script> on the three pages (after constants.js, before page script); NOT added to concat:js to avoid double-load in main.js"
  - "Checkpoint fix: BrewPad recipe_snapshot attach projections extended to carry cf_type/cf_subcategory/display_group so the frozen snapshot has the fields the grouping helper reads (RDISP-03)"

patterns-established:
  - "Group-by-then-render with original-index lookup keeps editable tables' index integrity under reordering"
  - "Additive recipe_snapshot extension is D-08-safe: pos-recipe money path reads by item_id and ignores extra keys"

requirements-completed: [RDISP-01, RDISP-03]

# Metrics
duration: 35min
completed: 2026-06-19
---

# Phase 34 Plan 03: Surface Renders Summary

**Wire the shared `groupRecipeIngredients` helper into all three recipe-ingredient render surfaces (admin recipe builder, BrewPad batch recipe section, kiosk recipe selection) so ingredients display in identical labelled, counted, brewing-process-ordered sections — with edit read-back integrity and cold-cache flat fallback preserved**

## Performance

- **Duration:** ~35 min (incl. human-verify checkpoint + one checkpoint-driven fix)
- **Tasks:** 2 auto + 1 human-verify checkpoint
- **Files modified:** 8 (3 source + 3 HTML + 2 build artifacts; plus full HTML re-stamp from build)

## Accomplishments

- **Admin** (`renderIngredientRows`): emits a `recipes-ing-group` header row per non-empty group with `Label (count)` (D-11), then the existing editable rows; `data-ing-idx` maps to the original array position via `indexOf` so `attachIngredientRowListeners` edit read-back stays correct under section reordering. Totals `<tfoot>` and listeners untouched.
- **BrewPad** (`buildRecipeIngredientTable`): emits a `bp-recipe-ing-group` header row per group then the existing rows; `data-idx` maps to the original array position so `readIngredientTableEdits` maps back to `snapIngredients[idx]` correctly.
- **Kiosk**: extracted one `kioskRenderRecipeIngredients(ingredients, el)` helper consuming the grouping output (per-group `<strong>Label (count)</strong>` + `<ul>`), replacing both duplicated render blocks (cached `_fetchedDetail` path and fetch path).
- Added `recipe-grouping.js` `<script>` after `constants.js` on `admin.html`, `kiosk.html`, `brewpad.html`; ran `npm run build` to regenerate `main.js`/`main.min.js` + page min bundles.
- Empty-label (cold-cache) group renders today's flat list on every surface (D-07).

## Task Commits

1. **Task 1: Group admin + BrewPad editable ingredient tables** — `b5c44b7` (feat)
2. **Task 2: Group kiosk list + recipe-grouping.js script tags + build** — `a7352aa` (feat)
3. **Checkpoint fix: carry cf fields into BrewPad recipe snapshot** — `fcc26e5` (fix)

## Decisions Made

- **Original-index mapping over running counter:** the plan suggested a "flat running counter," but the helper reorders ingredients across sections (SECTION_ORDER), so a display-order counter would desynchronize `data-ing-idx`/`data-idx` from the source array and corrupt edit read-back. Used `ingredients.indexOf(ing)` (same object references; O(n) over a small recipe array) to guarantee the index equals the original array position.
- **recipe-grouping.js standalone-only:** loaded via `<script>` on the three pages, deliberately NOT added to `concat:js`, to avoid double-loading inside `main.js` on public pages that don't need it.

## Deviations from Plan

### Checkpoint-driven fix (in scope for RDISP-03)

**BrewPad recipe_snapshot stripped the grouping fields**

- **Found during:** human-verify checkpoint (user reported BrewPad showed no grouping).
- **Issue:** BrewPad renders from the frozen `recipe_snapshot`, but both attach-time projections mapped each ingredient to `{item_id, item_name, quantity, unit}`, discarding `cf_type`/`cf_subcategory`/`display_group`. `buildRecipeIngredientTable` therefore always received un-enriched data and fell back to a flat list — RDISP-03 unmet on BrewPad despite the helper being wired in.
- **Fix:** extended both snapshot ingredient projections (recipe attach panel + create-recipe panel) to carry the three grouping fields. Additive to the snapshot; `pos-recipe.js` money path reads by `item_id` and ignores extra keys (D-08).
- **Files modified:** `js/brewpad.js` (+ rebuilt bundles)
- **Verification:** lint 0, build 0, 696 frontend tests pass; live middleware confirmed returning enriched fields; admin grouping visually verified by user; BrewPad grouping appears on freshly re-attached recipes (existing frozen snapshots remain flat by design).
- **Committed in:** `fcc26e5`

---

**Total deviations:** 1 checkpoint-driven fix (in scope — required to satisfy RDISP-03 on BrewPad).

## Issues Encountered

- Worktree isolation could not be created in this environment (`not in a git repository` from the orchestrator cwd); plan executed inline on the main working tree instead. No impact on output.
- **Out-of-scope observation (not a regression):** the recipe ingredient-availability endpoint returns `status: unknown`/`stock_on_hand: null` for this recipe's ingredients, surfacing a "Stock data unavailable" banner on admin/kiosk. Zoho auth is healthy and product stock is cached (511/511); grouping does not depend on stock. Pre-existing gap in the availability feature, unrelated to Phase 34 — flagged for a separate follow-up.

## Threat Surface Scan

- T-34-06 (XSS in group labels/names): all labels, names, units rendered through `escapeHTML` — same idiom as existing rows.
- T-34-07 (editable-row index integrity): preserved via original-array-index mapping; no money/quantity field re-derived from the grouped view.
- T-34-08 / T-34-SC: no new fields beyond the 34-02 enrichment surfaced; no new packages.

## Known Stubs

None. The full BrewPad recipe *editor* (create/add/remove ingredients) was raised by the user during verification — it is new feature scope beyond Phase 34 (display grouping) and will be handled as a separate phase.

## Next Phase Readiness

- All three surfaces now consume the single shared helper; phase goal (RDISP-01/02/03) met.
- New phase to scope: full BrewPad recipe editor (create/edit recipes from BrewPad).

---
*Phase: 34-ingredient-display-server-enrichment*
*Completed: 2026-06-19*
