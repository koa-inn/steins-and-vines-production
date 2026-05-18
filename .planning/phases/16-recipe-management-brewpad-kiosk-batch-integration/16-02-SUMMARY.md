---
phase: 16-recipe-management-brewpad-kiosk-batch-integration
plan: 02
subsystem: brewpad-recipe-detail
tags: [brewpad, recipe, batch, ui, phase-16, collapsible, d-04, d-05, d-06, d-07]
dependency_graph:
  requires:
    - 16-01: apps-script/adminApi.gs updateBatch() accepts recipe_snapshot
  provides:
    - js/brewpad.js:buildRecipeIngredientTable() — renders ingredient table in read/edit mode
    - js/brewpad.js:readIngredientTableEdits() — collects qty edits from table inputs
    - js/brewpad.js:openRecipeAttachPanel() — inline search + link existing recipe to batch
    - js/brewpad.js:openRecipeFromBatchSheet() — slide-out create-recipe form, POST /api/recipes
    - js/brewpad.js:renderBatchDetail() — collapsible Recipe section after Notes
    - css/brewpad.css:.bp-detail-section-toggle, .bp-recipe-ing-table, .bp-recipe-edit-form
  affects:
    - js/brewpad.js
    - js/brewpad.min.js
    - css/brewpad.css
    - css/brewpad.min.css
tech_stack:
  added: []
  patterns:
    - Collapsible section toggle with aria-expanded, keyboard accessible (Enter/Space)
    - renderRecipeSectionBody() / bindRecipeEditHandlers() for idempotent re-render on save/cancel
    - Inline replace pattern: read-only summary swapped for edit form on "Edit Snapshot"
    - Dynamically created slide-out sheet via createElement (avoids reusing bp-create-sheet)
    - escapeHTML() on all recipe field values (T-16-06 XSS mitigation)
key_files:
  created: []
  modified:
    - js/brewpad.js
    - js/brewpad.min.js
    - css/brewpad.css
    - css/brewpad.min.css
decisions:
  - renderRecipeSectionBody() + bindRecipeEditHandlers() extracted as helpers so save/cancel can re-render without calling the full renderBatchDetail()
  - openRecipeFromBatchSheet() creates a dedicated bp-recipe-create-sheet div dynamically (via createElement/appendChild) rather than reusing bp-create-sheet, avoiding innerHTML clobber of the batch create form
  - bindRecipeEmptyBtns() extracted separately so it can be re-called after cancel in attach flow
  - bp-recipe-meta-wrap wraps the summary div to allow in-place swap to edit form; id is preserved on the new class
metrics:
  duration_min: 25
  completed_date: "2026-05-18"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 4
---

# Phase 16 Plan 02: BrewPad Batch Detail Recipe Section Summary

**One-liner:** Collapsible Recipe section in BrewPad batch detail — State A shows metadata + ingredient table with D-04 all-fields edit mode (name, style, ABV, IBU, batch_size_l, notes, quantities); State B shows Attach Recipe (inline search) and Create Recipe (slide-out POST) buttons.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add collapsible Recipe section to renderBatchDetail with view, edit, attach, and create flows | 46fc917 | js/brewpad.js |
| 2 | Add CSS styles for collapsible recipe section, ingredient table, and edit-mode form | 570b63c | css/brewpad.css, css/brewpad.min.css, js/brewpad.min.js |

## What Was Built

### Task 1: Recipe Section JS

In `js/brewpad.js`, the following functions were added immediately before `renderBatchDetail()`:

**`buildRecipeIngredientTable(ingredients, editable)`** — renders a `<table class="bp-recipe-ing-table">` with `<thead>` + `<th scope="col">` headers and `<tbody>` rows. When `editable=true`, quantity cells contain `<input type="number" class="bp-recipe-qty" data-idx="...">` for inline editing.

**`readIngredientTableEdits(wrap, snapIngredients)`** — queries `.bp-recipe-qty` inputs from `wrap`, rebuilds the ingredients array by copying the original snapshot entry and overwriting `quantity` with `parseFloat(input.value)`.

**`openRecipeAttachPanel(b, sectionBodyEl)`** — replaces the empty-state div with a `bp-vessel-wrap` inline search. On focus, fetches `GET /api/recipes?status=active` (caches in `_catalog`). On option `mousedown`, fetches `GET /api/recipes/:id` for full detail, builds a trimmed snapshot `{name, style, abv, ibu, batch_size_l, notes, ingredients[{item_id, item_name, quantity, unit}]}`, calls `adminApiPost('update_batch', {updates: {recipe_id, recipe_snapshot}})`, then calls `renderRecipeSectionBody()` to flip to State A.

**`openRecipeFromBatchSheet(b, sectionBodyEl)`** — builds a `bp-recipe-create-sheet` div dynamically (createElement), appends it to `#bp-app`, animates open via `bp-create-sheet--open` class. Fields: Name (pre-filled from `b.product_name`), Style, ABV, IBU, Batch Size. On Save: `POST /api/recipes` with `{locked_price: 0, status: 'draft', ingredients: []}`, then `adminApiPost('update_batch')`, then `renderRecipeSectionBody()`. "Create Recipe" button disabled immediately on click, re-enabled only on error (T-16-08 double-submit guard).

**`buildRecipeSummaryHtml(snap)`** — helper that builds the read-only `<div class="bp-recipe-summary" id="bp-recipe-meta-wrap">` with Name, Style, ABV, IBU, Batch Size, Notes metadata.

**`renderRecipeSectionBody(sectionBodyEl, b, snap)`** — idempotently renders the recipe section body (summary + ingredient table + Edit/Save/Discard buttons), then calls `bindRecipeEditHandlers()`.

**`bindRecipeEditHandlers(b, sectionBodyEl, snapRef)`** — wires Edit Snapshot, Save Changes, Discard Changes. Edit click replaces `#bp-recipe-meta-wrap` innerHTML with `.bp-recipe-edit-form` containing all 6 D-04 fields (`bp-recipe-edit-name`, `bp-recipe-edit-style`, `bp-recipe-edit-abv`, `bp-recipe-edit-ibu`, `bp-recipe-edit-batch-size`, `bp-recipe-edit-notes`) and switches ingredient table to editable mode. Save reads all 6 metadata inputs plus `readIngredientTableEdits()`, calls `adminApiPost('update_batch', {updates: {recipe_snapshot: JSON.stringify(editedSnap)}})`, on success calls `renderRecipeSectionBody()` to restore read-only view. Discard calls `renderRecipeSectionBody()` without an API call.

**`bindRecipeEmptyBtns(b, sectionBodyEl, emptyDiv)`** — wires "Attach Recipe" to `openRecipeAttachPanel()` and "Create Recipe" to `openRecipeFromBatchSheet()`.

**In `renderBatchDetail()`**, the Recipe section is inserted after the Notes section (before Footer actions):
- `_batchSnap` parsed from `b.recipe_snapshot` via try/catch (parse failure = null = State B)
- State A HTML: `buildRecipeSummaryHtml()` + `<div id="bp-recipe-ingredient-wrap">` + Edit/Save/Discard buttons
- State B HTML: `<div class="bp-recipe-empty">` with prompt text + Attach Recipe + Create Recipe buttons
- Toggle (collapsed by default): `#bp-recipe-section-toggle` with `role="button" tabindex="0" aria-expanded="false"`

After `detailPane.innerHTML = html;`:
- Toggle wired: click and keydown (Enter/Space) flip `aria-expanded` + `body.style.display` + chevron rotation
- State A: `bindRecipeEditHandlers(b, recipeBody, _batchSnap)` called
- State B: `bindRecipeEmptyBtns(b, recipeBody, emptyDiv)` called

### Task 2: Recipe Section CSS

Added to the end of `css/brewpad.css` (after Plan 01's `.bp-product-tab--active`):

- **`.bp-detail-section-toggle`** — `cursor: pointer; user-select: none; display: flex; align-items: center; justify-content: space-between`
- **`.bp-detail-section-toggle:hover`** — `color: var(--barrel)`
- **`.bp-section-toggle-icon`** — `transition: transform 0.2s ease; display: inline-block` (rotated 90deg on expand)
- **`.bp-recipe-summary`** — `display: flex; gap: 24px; flex-wrap: wrap; margin-bottom: 12px`
- **`.bp-recipe-ing-table`** — `width: 100%; border-collapse: collapse; font-size: 0.85rem` with `th` uppercase 0.75rem letter-spaced labels and alternating `tbody tr` row backgrounds (`--cellar-canvas` / `--cellar-surface`)
- **`.bp-recipe-edit-form/.bp-recipe-edit-row/.bp-recipe-edit-row-inline/.bp-recipe-edit-label`** — edit mode form layout per D-04
- **`.bp-recipe-empty`** — `display: flex; flex-direction: column; gap: 8px` for empty state

`npm run build` regenerated `css/brewpad.min.css` and `js/brewpad.min.js`.

## Verification Results

- `npm run lint`: 0 errors (96 pre-existing warnings, none from new code)
- `npm test`: 381 tests passed, 21 suites, 0 failures
- `npm run build`: completed successfully, all artifacts regenerated

## Deviations from Plan

### Auto-resolved during implementation

**1. [Rule 2 - Missing Critical Functionality] renderRecipeSectionBody() helper extracted**
- **Found during:** Task 1
- **Issue:** The plan described "re-render the entire Recipe section body" in multiple places (save, cancel, attach success, create success). Duplicating that HTML assembly inline would make each handler ~50 lines and create drift risk.
- **Fix:** Extracted `renderRecipeSectionBody()` + `bindRecipeEditHandlers()` + `buildRecipeSummaryHtml()` as shared helpers. Called from all four code paths (initial render, save, cancel, attach/create success). The idempotent re-render pattern matches existing `renderDetailTasks()` and `renderDetailReadings()` analogs in the same function.
- **Files modified:** js/brewpad.js
- **Commit:** 46fc917

**2. [Rule 2 - Missing Critical Functionality] bindRecipeEmptyBtns() extracted for re-attach after cancel**
- **Found during:** Task 1 (attach flow)
- **Issue:** The attach panel "Cancel" button needed to restore the empty state with working buttons. Inline code would duplicate the bind logic.
- **Fix:** Extracted `bindRecipeEmptyBtns()` so cancel handler could call it cleanly.
- **Files modified:** js/brewpad.js
- **Commit:** 46fc917

**3. [Rule 3 - Blocking Issue] Dynamic createElement for recipe create sheet**
- **Found during:** Task 1 (create-from-batch flow)
- **Issue:** The plan said "reuse bp-create-sheet OR create a dedicated div — executor chooses whichever is cleaner." Reusing `bp-create-sheet` would clobber the batch create form's innerHTML if the user opened it while a batch create was in progress.
- **Fix:** Used `createElement('div')` + `appendChild()` to create a dedicated `#bp-recipe-create-sheet` node. A guard removes any pre-existing element of that id before creating a new one.
- **Files modified:** js/brewpad.js
- **Commit:** 46fc917

## Known Stubs

None — all flows are fully wired:
- State A edit saves to Apps Script via `adminApiPost('update_batch')` (already patched in Plan 01)
- Attach Recipe fetches from `GET /api/recipes?status=active` and `GET /api/recipes/:id`
- Create Recipe posts to `POST /api/recipes` and links via `adminApiPost('update_batch')`

## Threat Flags

No new threat surface beyond what is documented in the plan's threat model. All mitigations applied:

| Flag | File | Mitigation Applied |
|------|------|--------------------|
| T-16-05: Tampering via inline recipe snapshot edit | brewpad.js | numeric fields via parseFloat(), text fields via direct .value; item_id/item_name/unit copied from existing snapshot (not user-editable) |
| T-16-06: XSS via recipe names/values | brewpad.js | escapeHTML() on all rendered recipe values including edit-mode value="" attributes |
| T-16-08: DoS via double-submit on Create Recipe | brewpad.js | bp-recipe-create-btn disabled immediately on click, re-enabled only on error |

## Self-Check: PASSED

- js/brewpad.js: modified and committed in 46fc917 — `git log --oneline` confirms
- css/brewpad.css: modified and committed in 570b63c — `git log --oneline` confirms
- css/brewpad.min.css: rebuilt and committed in 570b63c
- js/brewpad.min.js: rebuilt and committed in 570b63c
- All acceptance criteria grep patterns verified present
- 381 frontend tests pass, 0 failures
- npm run build: succeeded
