---
phase: 36-cross-surface-selection-recipe-modification
plan: "04"
subsystem: admin-kiosk-recipe-modify
tags: [recipe-modification, ingredient-modify, save-as-new, price-preview, admin]
dependency_graph:
  requires: ["36-03"]
  provides: ["MOD-01", "MOD-02", "MOD-03"]
  affects: ["admin.html", "js/admin.js", "js/admin.min.js"]
tech_stack:
  added: []
  patterns:
    - "_kioskModifiedIngredients deep-copy state (D-04)"
    - "modified_ingredients query param on GET /api/kiosk/recipe-quote (MOD-02)"
    - "renderKioskModifyRows grouped by groupRecipeIngredients with indexOf(ing) index (caveat #7)"
    - "kioskSaveAsNewRecipe POST /api/recipes dynamic/draft (D-12/D-13/D-14)"
key_files:
  created:
    - tests/frontend/admin-recipe-modify.test.js
  modified:
    - admin.html
    - js/admin.js
    - js/admin.min.js
decisions:
  - "XSS test uses DOM node count (no img elements created) rather than innerHTML string check — jsdom properly encodes attribute values so the literal string appears in serialized innerHTML but no actual DOM injection occurs"
  - "kioskFetchRecipeQuote now returns the fetch Promise to enable testable async chaining"
  - "Save-as-new wiring deferred to initKioskSaleTab (DOMContentLoaded) — consistent with all other kiosk button wiring"
metrics:
  duration: "~45 min"
  completed: "2026-06-21"
  tasks_completed: 3
  files_changed: 4
---

# Phase 36 Plan 04: Admin Recipe Modification Panel Summary

Admin recipe-sale surface now supports add/remove/change ingredients at base quantities with server-authoritative price preview and save-as-new draft recipe — original recipe never mutated.

## What Was Built

**Task 1 — admin.html markup:**
- Inserted `#kiosk-recipe-modify-wrap` between `#kiosk-recipe-volume-wrap` and `#kiosk-stock-conflict` (correct UI-SPEC order)
- Contains collapsible `#kiosk-modify-toggle`, `kiosk-recipe-modify-table` with `#kiosk-modify-tbody`, `+ Add Ingredient` button
- `#kiosk-recipe-price-preview` for server-authoritative modified total display
- `#kiosk-locked-price-notice` with asymmetry copy (D-07/D-08): "Adding ingredients increases the price. Removing ingredients does not reduce it."
- `#kiosk-save-as-new-wrap` with inline name prompt, Save Draft, Cancel, feedback div
- All net-new elements `display:none` by default; Phase 35 markup untouched

**Task 2 — admin.js modify state + rows + quote extension:**
- `_kioskModifiedIngredients = null` and `_kioskModifyPanelOpen = false` state vars
- `renderKioskModifyRows()`: grouped via `groupRecipeIngredients`, `data-ing-idx = ingredients.indexOf(ing)` (caveat #7), escapeHTML all names, empty-state placeholder row
- `attachKioskModifyRowListeners()`: remove splices + re-quotes, qty change re-quotes, autocomplete via existing `showIngredientAutocomplete`
- `kioskShowRecipePrompt` extended: shows `#kiosk-recipe-modify-wrap` on recipe select, wires toggle (lazy deep-copy on first expand — D-04), wires `+ Add Ingredient`
- `kioskFetchRecipeQuote` extended: appends `&modified_ingredients=encodeURIComponent(JSON.stringify(...))` when non-null; renders Calculating.../total/error into `#kiosk-recipe-price-preview`; now returns Promise
- `kioskUpdateAddToCartButton` extended: `(Modified)` suffix when `Array.isArray(_kioskModifiedIngredients)`, show/hide `#kiosk-save-as-new-wrap`
- State reset (`_kioskModifiedIngredients = null`, `_kioskModifyPanelOpen = false`) on Back button and `kioskClearCart`
- Test helper exports: `_kioskGetModifiedIngredients`, `_kioskSetModifiedIngredients`, `renderKioskModifyRows`, `kioskSaveAsNewRecipe`

**Task 3 — save-as-new + build:**
- `kioskSaveAsNewRecipe(name, modifiedBaseIngredients)`: POST `/api/recipes` with `pricing_mode:'dynamic'`, `status:'draft'`, pre-scale ingredients (D-12/D-13/D-14) — no PUT/PATCH to original
- Button wiring in `initKioskSaleTab`: Save as new btn reveals prompt, Save Draft validates name + calls function, Cancel hides prompt
- `npm run build` run; `admin.min.js` regenerated (kioskSaveAsNewRecipe in bundle)

## Tests

New file: `tests/frontend/admin-recipe-modify.test.js` — 9 tests:
- T1a/T1b: modified_ingredients param in quote URL when set/null
- T2a/T2b: (Modified) suffix on Add-to-Cart button
- T3: splice correct index (middle element removal)
- T4: deep-copy proof — original recipe.ingredients unchanged after editing
- T5a: POST /api/recipes with dynamic/draft/base-list payload
- T5b: no PUT/PATCH to original recipe (D-14)
- T6: no actual img DOM elements created from XSS payload (T-36-12)

Full suite: 777 tests, 39 suites, all passing.

## Deviations from Plan

**Auto-fix [Rule 1 - Bug] kioskFetchRecipeQuote return value**
- Found during: Task 2 GREEN phase
- Issue: function didn't return the Promise, making T1 tests unable to chain `.then()`
- Fix: Added `return` to the `fetch(...)` call
- Files modified: js/admin.js
- Commit: 5f04ef6

**Adjustment: XSS test assertion approach (T6)**
- Found during: Task 2 GREEN phase
- Issue: jsdom correctly stores attribute values as text and serializes them back without HTML injection, so `tbody.innerHTML` will contain `value="<img..."` as a serialized string (jsdom's correct behavior). The original assertion `not.toContain('<img src=x...')` was failing because jsdom serializes the encoded attribute back to literal form.
- Fix: Changed T6 to assert no actual `<img>` DOM nodes were created (`tbody.querySelectorAll('img').length === 0`) and the `.value` property holds the raw text — which is the actual XSS safety guarantee
- Files modified: tests/frontend/admin-recipe-modify.test.js

## Known Stubs

None. All functionality is fully wired.

## Threat Flags

No new threat surface beyond what was planned in the plan's `<threat_model>`.

| Flag | File | Description |
|------|------|-------------|
| T-36-11 mitigated | js/admin.js | Price preview sourced from server quote, never client-computed |
| T-36-12 mitigated | js/admin.js | escapeHTML on all ingredient names in renderKioskModifyRows; XSS test confirms no DOM injection |
| T-36-13 mitigated | js/admin.js | kioskSaveAsNewRecipe uses POST only; deep-copy ensures original recipe.ingredients unchanged |

## Self-Check: PASSED

- admin.html contains all 5 required IDs (kiosk-recipe-modify-wrap, kiosk-modify-tbody, kiosk-recipe-price-preview, kiosk-save-as-new-btn, kiosk-locked-price-notice)
- admin.html contains asymmetry copy: "Adding ingredients increases the price. Removing ingredients does not reduce it."
- Phase 35 IDs #kiosk-recipe-volume-wrap and #kiosk-stock-conflict still present and unmodified
- js/admin.js contains _kioskModifiedIngredients state var, modified_ingredients query param, (Modified) label suffix
- js/admin.js contains indexOf(ing) for data-ing-idx (caveat #7)
- js/admin.min.js contains kioskSaveAsNewRecipe (grep count >= 1)
- All 9 targeted tests pass; full 777-test suite passes
- npm run build exits 0
