---
phase: 36
plan: "06"
subsystem: brewpad
tags: [recipe-attach, scaling, modification, advisory, save-as-new, tdd]
dependency_graph:
  requires: [36-03]
  provides: [SEL-01, SEL-02, MOD-01, MOD-03]
  affects: [js/brewpad.js, js/brewpad.min.js, brewpad.html]
tech_stack:
  added: []
  patterns:
    - bpScaleIngredients pure top-level fn (mirrors lib/recipe-scaling.js unit classification)
    - Object.assign inside IIFE for state-dependent test exports
    - Restructured attach flow: resolve (no write) → scale/modify/advisory → Attach writes
key_files:
  created:
    - tests/frontend/brewpad-recipe-attach-modify.test.js
    - .planning/phases/36-cross-surface-selection-recipe-modification/36-06-SUMMARY.md
  modified:
    - brewpad.html
    - js/brewpad.js
    - js/brewpad.min.js
decisions:
  - D-10 enforced: bpAttachRecipe calls only adminApiPost('update_batch') — no recipe-quote/recipe-sale/Helcim path on attach
  - D-11 enforced: refreshBpStockAdvisory renders shortfalls but never sets Attach button disabled
  - D-12/D-13/D-14 enforced: bpSaveAsNewRecipe POSTs /api/recipes with pre-scale base list, pricing_mode=dynamic, status=draft — no PUT
  - bpScaleIngredients lifted to top-level for unit testability; inner IIFE fns use Object.assign export pattern
metrics:
  duration: "~35 min"
  completed: "2026-06-21"
  tasks_completed: 3
  files_changed: 4
---

# Phase 36 Plan 06: BrewPad Attach Scale+Modify+Advisory Summary

**One-liner:** BrewPad recipe-attach extended with ported volume control, inline ingredient modification, soft stock advisory, and save-as-new — all without any quote/charge path (D-10).

## What Was Built

### Task 1 — brewpad.html: static markup for expanded attach panel

Added a hidden `#bp-recipe-attach-expanded` section to `brewpad.html` inside the batches panel. Contains:
- `#bp-recipe-volume-wrap` + `#bp-target-volume.bp-input` + `#bp-scale-factor-readout` (port of Phase 35 volume control, D-01)
- `#bp-recipe-modify-wrap` with `#bp-modify-toggle` + `#bp-modify-panel` + `#bp-modify-tbody` + `#bp-modify-add-row` (MOD-01)
- `#bp-recipe-stock-advisory.bp-toast--warning` (soft advisory, D-11)
- `#bp-recipe-attach-confirm-btn` (the actual Attach button, moved here)
- `#bp-save-as-new-wrap` with `#bp-save-as-new-btn` + `#bp-save-as-new-prompt` + `#bp-new-recipe-name.bp-input` (MOD-03)

All elements use `.bp-input` class, not `.admin-input`. No `#kiosk-recipe-price-preview` or pricing markup (D-10).

### Task 2 — js/brewpad.js: restructured attach flow (TDD)

**RED phase:** wrote 31 failing tests covering T1–T9 (scaling parity, snapshot structure, advisory, XSS, no-charge, save-as-new, state accessors).

**GREEN phase:** implemented:

1. `bpScaleIngredients(list, factor)` — pure top-level function mirroring `lib/recipe-scaling.js` unit classification exactly:
   - `kg/g/l/ml` → linear (`Math.round(rawQty * 10000) / 10000`)
   - `pcs/each/unit/pkg/ft` → `Math.max(1, Math.ceil(rawQty))`
   - Non-blank unknown → discrete (conservative default)
   - Blank/null → continuous (D-03)
   - Parity literals: 5 kg grain at 1.5x → 7.5 kg; 1 pcs hop at 1.5x → 2 pcs

2. `buildBpAttachSnapshot()` — builds recipe_snapshot with `target_volume_l`, `scale_factor`, `scaledIngredients` (scaled from modified or base list), `modified_base_ingredients` (null when unmodified), `is_modified`.

3. `refreshBpStockAdvisory()` — compares scaled quantities vs `_bpAttachCatalog` stock; renders shortfalls in `#bp-recipe-stock-advisory` as text; hides when no conflicts. **Never disables Attach button** (D-11).

4. `renderBpModifyRows()` / `attachBpModifyRowListeners()` — editable ingredient rows in `#bp-modify-tbody` using existing bp autocomplete (`showIngredientAutocompleteBp`). Grouped via `groupRecipeIngredients`; `data-ing-idx = ingredients.indexOf(ing)` (PATTERNS #7). Empty state row when no ingredients.

5. `bpAttachRecipe(batchId)` — calls `adminApiPost('update_batch', ...)` with `recipe_id` + `recipe_snapshot`. No `/api/kiosk/recipe-quote`, no `/api/kiosk/recipe-sale`, no Helcim call (D-10, T-36-20).

6. `wireAttachExpandedPanel(b, sectionBodyEl)` — wires volume input, modify toggle, add-ingredient button, advisory refresh, Attach confirm button, save-as-new. Called after recipe resolves.

7. `openRecipeAttachPanel(b, sectionBodyEl)` **restructured**: on recipe dropdown select, fetches `/api/recipes/:id`, stores `_bpResolvedRecipe`, reveals `#bp-recipe-attach-expanded` + calls `wireAttachExpandedPanel`. **No `adminApiPost('update_batch')` on selection** — write only on Attach click.

### Task 3 — bpSaveAsNewRecipe + build

`bpSaveAsNewRecipe(name, modifiedBaseIngredients)`: POSTs `/api/recipes` with `{ name, style, batch_size_l, pricing_mode:'dynamic', status:'draft', ingredients: modifiedBaseIngredients }`. Uses `mwUrl()` + `mwApiKey()` headers. Success shows `showToast('Recipe saved as draft — activate in Recipes tab to use', 'success')`. Error shows `showToast('Could not save recipe — try again', 'error')`.

`npm run build` exits 0; `brewpad.min.js` contains `bpSaveAsNewRecipe`.

## Test Results

- Target test suite: 31 tests, 31 passed (T1–T9)
- Full frontend suite: 823 tests, 41 suites, all pass
- `npm run lint`: 0 errors (133 pre-existing warnings)
- `npm run build`: exits 0, `brewpad.min.js` regenerated

## Deviations from Plan

### Auto-fixed Issues

None — plan executed as written.

### Structural Decision: Object.assign export pattern

The plan asked for state-dependent functions (`buildBpAttachSnapshot`, `bpSaveAsNewRecipe`, etc.) to be exported from `module.exports`. These functions close over IIFE-scoped state (`_bpResolvedRecipe`, `_bpTargetVolumeL`, etc.) and cannot be referenced from the outer `module.exports` block (outside the IIFE). Used the existing `admin.js` pattern: `module.exports = Object.assign(module.exports || {}, {...})` inside the IIFE for state-dependent exports; outer block changed from `=` to `Object.assign` to preserve IIFE-added exports. This is the established project pattern.

### Static HTML for Attach Panel Controls

The plan's Task 1 acceptance criteria (`grep -c "..." brewpad.html`) required the 5 IDs to appear in `brewpad.html`. Since `openRecipeAttachPanel` builds its UI dynamically via `innerHTML`, a static `#bp-recipe-attach-expanded` panel was added to `brewpad.html` (hidden by default) following the `admin.html` `#kiosk-recipe-prompt` static-panel pattern. The JS reveals and populates this panel on recipe selection.

## Known Stubs

None. All data paths are wired: `_bpResolvedRecipe` populated from `/api/recipes/:id` fetch; `_bpAttachCatalog` populated from `_recipesState.catalog` (lazy-loaded); snapshot written to Apps Script via `adminApiPost('update_batch')`.

## Threat Flags

None. T-36-17 (client-built snapshot quantities) and T-36-18 (XSS in modify rows/advisory) are mitigated per plan threat model. T-36-19 (save-as-new without auth) mitigated: `bpSaveAsNewRecipe` requires BrewPad Google OAuth session + `x-api-key` header. T-36-20 (no Helcim on attach) enforced and test-asserted.

## Self-Check: PASSED

| Item | Status |
|------|--------|
| tests/frontend/brewpad-recipe-attach-modify.test.js | FOUND |
| js/brewpad.min.js | FOUND |
| brewpad.html | FOUND |
| commit 197b0db (Task 1 markup) | FOUND |
| commit 9a84433 (Task 2 RED tests) | FOUND |
| commit 898aba2 (Task 2 GREEN impl) | FOUND |
| commit 5101390 (Task 3 build) | FOUND |
