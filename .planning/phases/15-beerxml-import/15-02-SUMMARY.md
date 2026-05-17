---
phase: 15-beerxml-import
plan: "02"
subsystem: admin-js
tags: [beerxml, import-ui, review-modal, autocomplete, xss-mitigation]
dependency_graph:
  requires: [parseBeerXML, autoMatchIngredients, openModal, filterIngredientCatalog, openRecipeDetail, populateRecipeForm, renderIngredientRows]
  provides: [validateAndReadBeerXML, showBeerXMLReviewModal, confirmBeerXMLImport, recipes-import-beerxml-btn]
  affects: [admin.html, css/admin.css, js/admin.js, js/admin.min.js, css/admin.min.css]
tech_stack:
  added: []
  patterns: [file-reader-validation, dom-parser-xss-check, event-delegation, debounced-autocomplete, modal-wide-override]
key_files:
  created: []
  modified:
    - admin.html
    - css/admin.css
    - js/admin.js
    - js/admin.min.js
    - css/admin.min.css
decisions:
  - "Event delegation on tbody for skip/restore and change buttons avoids rebinding on row re-render"
  - "rerenderRow() replaces only the match cell and action cell — avoids rebuilding entire tbody, preserves focus in other rows"
  - "beerxml-change-btn piggybacks on beerxml-skip-btn class for delegation simplicity — distinguished by beerxml-change-btn secondary class"
  - "closeModal/overlay/close-btn each remove admin-modal-content--wide independently — belt-and-suspenders coverage for all close paths"
  - "_modalCleanupHandlers.push also removes wide class on any modal cleanup (openModal reuse path)"
  - "Debounce 200ms on autocomplete input matches existing ing-search pattern from recipes ingredient editor"
metrics:
  duration: "12 minutes"
  completed: "2026-05-17"
  tasks_completed: 1
  files_created: 0
  files_modified: 5
---

# Phase 15 Plan 02: BeerXML Import UI Summary

Complete BeerXML import flow in admin Recipes tab: file validation gate, 5-column review modal with confidence badges, per-row autocomplete Zoho match override, skip/restore toggles, and confirm-to-recipe-form pipeline with status locked to draft.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | HTML markup, CSS styles, and JS import flow implementation | 61c9e86 | admin.html, css/admin.css, js/admin.js, js/admin.min.js, css/admin.min.css |

## What Was Built

### `validateAndReadBeerXML(file)`

Entry point from file input `change` event. Enforces:
- **T-15-02:** 500 KB size gate before `FileReader.readAsText()` — oversized files never read
- `DOMParser.parseFromString()` with `parsererror` element check — malformed XML rejected before calling `parseBeerXML`
- Recipe count guard: 0 → error toast; 1+ → info toast if multiple (imports first)
- Delegates to `parseBeerXML` (Plan 01) then `autoMatchIngredients` (Plan 01) then `showBeerXMLReviewModal`

### `showBeerXMLReviewModal(parsed, matchedRows)`

Builds a 5-column review table in the existing `admin-modal` using `openModal()`:

| Column | Content |
|--------|---------|
| BeerXML Ingredient | Escaped name + type sub-label |
| Amount | Converted display (e.g. "28.0 g") |
| Unit | kg / g / pcs / L |
| Zoho Match | Matched item name+SKU with "Change" button, or autocomplete search input |
| Status / Action | Confidence badge (Matched/Review/No match) + Skip/Restore toggle |

- **T-15-01 mitigated:** All `getTagText()` results wrapped in `escapeHTML()` before `innerHTML` assignment
- Modal widened to 800px via `admin-modal-content--wide` class (removed on all close paths: confirm, discard, X button, overlay, `_modalCleanupHandlers`)
- "Confirm Import" disabled until `canConfirm()` — at least one non-skipped row with a valid `zoho_match`
- Autocomplete debounced 200ms, uses `filterIngredientCatalog()` from Plan 01, renders `.beerxml-autocomplete-list` dropdown
- Event delegation on `<tbody>` handles skip/restore and change buttons without rebinding on re-render

### `confirmBeerXMLImport(parsedRecipe, confirmedRows)`

- Closes modal, removes wide class
- Calls `openRecipeDetail(null)` to open blank recipe form
- Calls `populateRecipeForm({...})` with parsed name/style/ABV/batch_size/IBU/colour and `status: 'draft'`
- Filters confirmed rows (non-skipped, valid `zoho_match`) into `_recipesState.currentIngredients`
- Calls `renderIngredientRows()` with confirmed ingredients
- Shows success toast: "Recipe imported from BeerXML. Set a price and activate when ready."

### Import Button Wiring (in `initRecipesControls`)

- Checks `_recipesState.catalogLoaded` before triggering file picker — guards against matching before catalog is ready
- `beerxmlFileInput.value = ''` after reading (T-15-05: prevents same-file re-select bypass)

### CSS Classes Added (`css/admin.css`)

- `.admin-modal-content--wide` — max-width: 800px override
- `.beerxml-review-table`, `.beerxml-review-table thead th`, `.beerxml-review-table tbody td` — table layout
- `.beerxml-match-high` (green #3d7a40), `.beerxml-match-low` (amber), `.beerxml-match-none` (red #a83232) — confidence badges
- `.beerxml-row-skipped` — opacity 0.45 + transparent background override
- `.beerxml-skip-btn`, `.beerxml-orig-value`, `.beerxml-type-label`, `.beerxml-meta-line` — supporting elements
- `.beerxml-match-search`, `.beerxml-autocomplete-list`, `.beerxml-autocomplete-item`, `.beerxml-match-cell`, `.beerxml-matched-info` — autocomplete UI

## Deviations from Plan

None — plan executed exactly as written. All threat mitigations (T-15-01 through T-15-06) implemented as specified.

## Known Stubs

None. All functions are fully wired end-to-end.

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes. All surface is within the existing admin.html OAuth gate. Threat register items fully implemented:
- T-15-01: `escapeHTML()` on all BeerXML-derived text in `showBeerXMLReviewModal` — confirmed
- T-15-02: `file.size > 500 * 1024` check before `FileReader.readAsText()` — confirmed
- T-15-04: `parsererror` element check after `DOMParser.parseFromString()` — confirmed
- T-15-05: `beerxmlFileInput.value = ''` after reading — confirmed

## Self-Check: PASSED

- [x] `grep "recipes-import-beerxml-btn" admin.html` — match found
- [x] `grep "recipes-beerxml-file" admin.html` — match found
- [x] `grep 'accept=".xml"' admin.html` — match found
- [x] `grep "beerxml-match-high" css/admin.css` — match found
- [x] `grep "beerxml-match-low" css/admin.css` — match found
- [x] `grep "beerxml-match-none" css/admin.css` — match found
- [x] `grep "beerxml-row-skipped" css/admin.css` — match found
- [x] `grep "beerxml-skip-btn" css/admin.css` — match found
- [x] `grep "admin-modal-content--wide" css/admin.css` — match found
- [x] `grep "function validateAndReadBeerXML" js/admin.js` — match found
- [x] `grep "function showBeerXMLReviewModal" js/admin.js` — match found
- [x] `grep "function confirmBeerXMLImport" js/admin.js` — match found
- [x] `grep "recipes-import-beerxml-btn" js/admin.js` — match found
- [x] `grep "500 KB" js/admin.js` — match found
- [x] `grep "parsererror" js/admin.js` — match found
- [x] `status: 'draft'` in confirmBeerXMLImport at line 9115 — confirmed
- [x] `npm run build` exits 0
- [x] `npm test` — 378 tests pass, 0 failures
- [x] `npm run lint` — 0 errors (pre-existing warnings only)
- [x] `js/admin.min.js` exists and is newer than js/admin.js
- [x] Commit `61c9e86` exists in git log
