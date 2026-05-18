---
phase: 16-recipe-management-brewpad-kiosk-batch-integration
plan: 01
subsystem: brewpad-recipe-picker
tags: [brewpad, apps-script, recipe, batch, ui, phase-16]
dependency_graph:
  requires: []
  provides:
    - apps-script/adminApi.gs:updateBatch() accepts recipe_id and recipe_snapshot
    - js/brewpad.js:tabbed product picker with bindRecipePickerSearch()
    - css/brewpad.css:.bp-product-tab-bar styles
  affects:
    - apps-script/adminApi.gs
    - js/brewpad.js
    - css/brewpad.css
tech_stack:
  added: []
  patterns:
    - Tabbed picker UI with _productPickerTab state guard
    - Raw setValue() bypass for JSON in Apps Script (mirrors createBatch pattern)
    - escapeHTML() on all recipe-sourced DOM values (XSS protection)
key_files:
  created: []
  modified:
    - apps-script/adminApi.gs
    - js/brewpad.js
    - css/brewpad.css
    - js/brewpad.min.js
    - css/brewpad.min.css
decisions:
  - updateBatch recipe_snapshot uses raw setValue() bypassing sanitizeInput — mirrors createBatch line 1819; sanitizeInput strips HTML tags that can appear in JSON
  - _productPickerTab reset to 'kits' on each buildCreateForm() call to prevent state bleed across opens
  - bindRecipePickerSearch uses local _recipeCatalog var (session-scope within form) to avoid polluting IIFE state
metrics:
  duration_min: 15
  completed_date: "2026-05-18"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 3
---

# Phase 16 Plan 01: BrewPad Recipe Picker + Apps Script Patch Summary

**One-liner:** Apps Script updateBatch() now accepts recipe_id/recipe_snapshot writes; BrewPad new batch form has a tabbed [Kits]/[Recipes] product picker that fetches active recipes from middleware and attaches a trimmed recipe_snapshot JSON to the create_batch payload.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Patch Apps Script updateBatch() for recipe fields | a7b31fc | apps-script/adminApi.gs |
| 2 | Add tabbed [Kits/Recipes] picker to BrewPad new batch form | a65df88 | js/brewpad.js, css/brewpad.css + minified artifacts |

## What Was Built

### Task 1: Apps Script updateBatch() Patch

In `apps-script/adminApi.gs` `updateBatch()`:

- Added `'recipe_id'` to the `allowedFields` array (safe through `sanitizeInput()` — it's a short string like `RCP-000001`)
- Added a dedicated `recipe_snapshot` handler after the `allowedFields.forEach()` loop, placed before the vessel status handling block
- The handler validates the snapshot is parseable JSON via `JSON.parse()` before writing — rejects with `{ ok: false, error: 'invalid_snapshot' }` if invalid
- Uses raw `setValue()` bypassing `sanitizeInput()`, matching the identical pattern in `createBatch()` at line 1819

### Task 2: BrewPad Tabbed Product Picker

In `js/brewpad.js`:

- Added `var _productPickerTab = 'kits'` state variable near other `_` state vars at IIFE top level
- Replaced the single-input product block in `buildCreateForm()` with a `.bp-product-tab-bar` container holding [Kits] and [Recipes] tabs, plus two new hidden inputs: `bp-new-recipe-id` and `bp-new-recipe-snapshot`
- Added `if (_productPickerTab !== 'kits') return;` guard at top of `showProductOptions()` in `bindProductSearch()`
- Implemented `bindRecipePickerSearch()` function that: fetches `GET /api/recipes?status=active` via `mwUrl()`/`mwApiKey()`, caches result in local `_recipeCatalog`, shows filtered dropdown with name + ABV, on selection fetches `GET /api/recipes/:id` for full detail, trims to essential fields `{name, style, abv, ibu, batch_size_l, ingredients[{item_id, item_name, quantity, unit}]}`, writes JSON.stringify to `bp-new-recipe-snapshot`
- Added tab switcher binding that updates `_productPickerTab`, toggles `bp-product-tab--active`, clears all hidden fields, and changes input placeholder
- Extended `create_batch` submit payload with `recipe_id` and `recipe_snapshot` fields
- Reset `_productPickerTab = 'kits'` on each `buildCreateForm()` call

In `css/brewpad.css`:

- Added `.bp-product-tab-bar`, `.bp-product-tab`, `.bp-product-tab:hover`, `.bp-product-tab--active` styles using `var(--barrel)` as active indicator color

## Verification Results

- `npm run build`: passed — all CSS/JS minified, HTML stamps updated
- `npm test`: 381 frontend tests passed, 0 failures
- `npm run lint`: 0 errors (96 pre-existing warnings, none from new code)
- Middleware tests: 5/24 suites pass — 19 fail with "Cannot find module" (express/axios/redis not installed in worktree) — pre-existing infrastructure issue, unrelated to this plan's changes

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — the recipe picker is fully wired to `/api/recipes?status=active` and `/api/recipes/:id`. No placeholder data.

## Threat Flags

No new threat surface beyond what is documented in the plan's threat model (T-16-01 through T-16-04). All mitigations applied:

| Flag | File | Mitigation Applied |
|------|------|--------------------|
| T-16-01: Tampering via recipe_snapshot | adminApi.gs | JSON.parse() validation before setValue |
| T-16-02: XSS via recipe name/style | brewpad.js | escapeHTML() on all rendered values |
| T-16-03: DoS via large snapshot | brewpad.js | Trimmed to essential fields only |
| T-16-04: /api/recipes exposure | brewpad.js | x-api-key header on all middleware calls |

## Self-Check: PASSED

- apps-script/adminApi.gs: modified and committed in a7b31fc
- js/brewpad.js: modified and committed in a65df88
- css/brewpad.css: modified and committed in a65df88
- Both commits confirmed in `git log --oneline -5`
