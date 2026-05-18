---
phase: 16-recipe-management-brewpad-kiosk-batch-integration
verified: 2026-05-18T04:53:00Z
status: human_needed
score: 10/10 must-haves verified
overrides_applied: 0
human_verification:
  - test: "BrewPad New Batch — Kits/Recipes tab switching and recipe selection"
    expected: "Tab bar appears, clicking Recipes tab changes placeholder to 'Search recipes...', typing filters active recipes, selecting one populates product name and attaches recipe_snapshot, kit tab still works normally"
    why_human: "Browser interaction with a live middleware /api/recipes endpoint required; snapshot attachment only visible by submitting the form and checking the resulting batch record"
  - test: "BrewPad Batch Detail — Recipe section expand/collapse and edit flow"
    expected: "Collapsed recipe section appears in every batch detail view. Clicking header expands it. Batches with snapshot show style/ABV/IBU/batch size/notes + ingredient table. Edit Snapshot reveals all 6 form fields. Save writes to batch only (reload confirms). Discard reverts without API call."
    why_human: "Requires real batch data with and without recipe_snapshot, and live Apps Script update_batch roundtrip"
  - test: "BrewPad Batch Detail — Attach Recipe and Create Recipe flows"
    expected: "Batches without recipe_snapshot show 'No recipe attached' + two buttons. Attach Recipe inline search fetches active recipes, selecting one saves recipe_id + recipe_snapshot to the batch via update_batch. Create Recipe slide-out opens pre-filled with batch product name, saves new recipe via POST /api/recipes, then links to batch."
    why_human: "Requires live middleware and Apps Script endpoints; state transitions only observable in running app"
  - test: "Kiosk Recipe Quick-Edit — end-to-end edit and save"
    expected: "Edit Recipe button visible in recipe detail pane. Tapping it shows inline form with pre-filled name, notes, price, status. Save Changes sends PUT /api/recipes/:id with all 4 fields and disables button during request. On success: toast shown, pane returns to read-only with updated name. Discard Changes closes form without API call. Works when BEER_SALES_ENABLED=false."
    why_human: "Requires running kiosk against live middleware PUT endpoint; button disable state and toast only verifiable interactively"
  - test: "Apps Script updateBatch() recipe_snapshot write"
    expected: "Creating a batch with a recipe_snapshot via the BrewPad form results in both recipe_id and recipe_snapshot columns populated in the Batches Google Sheet. Editing a snapshot via Edit Snapshot in batch detail updates only that row's recipe_snapshot cell."
    why_human: "Apps Script runs in Google Apps Script cloud environment; actual sheet writes require end-to-end test with deployed script"
---

# Phase 16: Recipe Management — BrewPad, Kiosk & Batch Integration Verification Report

**Phase Goal:** Staff can browse, edit, and select recipes from BrewPad and kiosk when creating batches. Recipe editing is available in admin, kiosk, and BrewPad. Selecting a recipe when starting a batch pre-fills product info and attaches the recipe snapshot.
**Verified:** 2026-05-18T04:53:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Requirement ID Note

The plan frontmatter declares requirements D-01 through D-09. These IDs are **implementation decisions** defined in `16-CONTEXT.md`, not formal requirement IDs from `REQUIREMENTS.md`. The `REQUIREMENTS.md` file uses RDM/API/ADM/KSK/etc IDs mapped to phases 12-15 only; Phase 16 is not in the REQUIREMENTS.md traceability table. All D-series decisions are used as proxies for the verifiable truths below. No formal REQUIREMENTS.md IDs are orphaned by this phase.

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | BrewPad New Batch form has tabbed [Kits]/[Recipes] product picker — selecting a recipe pre-fills product name and attaches recipe_snapshot JSON to the batch | VERIFIED | `_productPickerTab` declared at brewpad.js:212; `.bp-product-tab-bar` HTML at line 3200; `bp-new-recipe-id` + `bp-new-recipe-snapshot` hidden inputs at 3209-3210; `bindRecipePickerSearch()` at 3444 fetches `/api/recipes?status=active`; submit payload includes both fields at lines 3370-3371 |
| SC-2 | Every batch detail view shows a collapsible Recipe section with metadata, ingredient table, and inline editing for batch-local modifications | VERIFIED | `bp-recipe-section-toggle` with `role="button"` and `aria-expanded="false"` at brewpad.js:2214; `buildRecipeIngredientTable()` at 1726; all 6 D-04 edit fields present (bp-recipe-edit-name/style/abv/ibu/batch-size/notes at lines 2023-2039); `renderRecipeSectionBody()` pattern confirmed |
| SC-3 | Kit batches (no recipe_snapshot) can attach an existing recipe or create a new one from batch detail | VERIFIED | `openRecipeAttachPanel()` at brewpad.js:1762 fetches `/api/recipes?status=active` and calls `adminApiPost('update_batch')`; `openRecipeFromBatchSheet()` at 1863 POSTs to `/api/recipes` then links via `update_batch`; both triggered from `bp-recipe-attach-btn` / `bp-recipe-create-btn` |
| SC-4 | Kiosk recipe detail pane has a quick-edit form for name, notes, locked price, and status — works even when BEER_SALES_ENABLED is false | VERIFIED | `kioskSaveRecipeQuickEdit()` at admin.js:10444; `kqe-name/kqe-notes/kqe-price/kqe-status` fields at lines 10395-10401; `method: 'PUT'` at 10462; `BEER_SALES_ENABLED` appears nowhere in admin.js (client-side gating is server-only; `kioskSetMode('recipes')` and `kioskLoadRecipes()` are ungated) |
| SC-5 | Apps Script updateBatch() accepts recipe_id and recipe_snapshot fields | VERIFIED | `recipe_id` in `allowedFields` at adminApi.gs:1989; `updates.recipe_snapshot` handler with `JSON.parse()` validation at lines 2003-2009; raw `setValue()` bypass matches createBatch() pattern |
| SC-6 | Batch-local recipe edits modify only that batch's snapshot — master recipe record never affected | VERIFIED | brewpad.js recipe edit save path calls `adminApiPost('update_batch')` at line 2062 — never calls `PUT /api/recipes/:id`; no `PUT.*api/recipes` found in brewpad.js |

**Score:** 6/6 roadmap success criteria verified at code level

### Decision Requirement Coverage (D-01 through D-09)

| Decision | Description | Status | Evidence |
|----------|-------------|--------|----------|
| D-01 | Tabbed picker [Kits/Recipes] in BrewPad batch form | VERIFIED | `.bp-product-tab-bar` in buildCreateForm; `data-picker-tab` buttons |
| D-02 | Recipe selection pre-fills name + attaches recipe_snapshot | VERIFIED | `bp-new-recipe-snapshot` write in `bindRecipePickerSearch()` on selection; payload at line 3371 |
| D-03 | BrewPad/kiosk get view + quick-edit (name/notes/price/status); full ingredient CRUD stays in admin | VERIFIED | kiosk quick-edit form is name/notes/price/status only; brewpad edit snapshot allows all batch-local fields per D-04 |
| D-04 | Staff can edit ALL recipe fields on a batch's snapshot | VERIFIED | 6 edit fields confirmed: name, style, ABV, IBU, batch_size_l, notes + ingredient quantities |
| D-05 | Batch recipe edits are batch-local only | VERIFIED | Edit path uses `update_batch`, never `PUT /api/recipes/:id` |
| D-06 | Expandable Recipe section in batch detail (collapsed by default) | VERIFIED | `aria-expanded="false"` initial state; `recipeBody.style.display = 'none'` on load |
| D-07 | ALL batches show Recipe section (not just recipe-sourced) | VERIFIED | Recipe section HTML appended for all batches; State B (no snapshot) renders Attach/Create buttons |
| D-08 | Recipe browsing/editing in kiosk is ungated from BEER_SALES_ENABLED | VERIFIED | No BEER_SALES_ENABLED in admin.js; kioskSetMode('recipes') and kioskLoadRecipes() are unconditional |
| D-09 | Kiosk uses same quick-edit pattern as BrewPad (consistent UX) | VERIFIED | Same name/notes/price/status field pattern; same save-disable-then-toast flow |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps-script/adminApi.gs` | recipe_id in allowedFields + raw setValue for recipe_snapshot | VERIFIED | Line 1989: recipe_id in allowedFields; lines 2003-2009: recipe_snapshot handler with JSON validation and raw setValue |
| `js/brewpad.js` | Tabbed picker + bindRecipePickerSearch + collapsible Recipe section + attach + create | VERIFIED | All functions confirmed at lines 1726, 1747, 1762, 1863, 2214, 3200, 3444 |
| `css/brewpad.css` | Tab bar styles + toggle + ingredient table + edit form + empty state | VERIFIED | .bp-product-tab-bar at 1963; .bp-detail-section-toggle at 1988; .bp-recipe-ing-table at 2015; .bp-recipe-edit-form at 2040; .bp-recipe-empty at 2063 |
| `js/admin.js` | kioskSaveRecipeQuickEdit + quick-edit form in kioskShowRecipePrompt | VERIFIED | Function at line 10444; form HTML at lines 10325-10326, 10387-10416 |
| `css/kiosk.css` | .kiosk-recipe-quick-edit + .kiosk-quick-edit-actions with 44px touch targets | VERIFIED | Lines 2729-2754: classes confirmed with font-size:16px and min-height:44px |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| js/brewpad.js bindRecipePickerSearch | GET /api/recipes?status=active | fetch with x-api-key header | WIRED | Line 3459: `fetch(mwUrl() + '/api/recipes?status=active', { headers: { 'x-api-key': mwApiKey() } })` |
| js/brewpad.js bindRecipePickerSearch | GET /api/recipes/:id | fetch on selection for snapshot | WIRED | Line 3495: `fetch(mwUrl() + '/api/recipes/' + encodeURIComponent(rid), ...)` |
| js/brewpad.js create_batch submit | adminApiPost('create_batch') with recipe_id + recipe_snapshot | form submit | WIRED | Lines 3370-3371 in submit payload |
| js/brewpad.js renderBatchDetail | adminApiPost('update_batch') with recipe_snapshot | Edit Snapshot save | WIRED | Line 2062: `adminApiPost('update_batch', { batch_id: b.batch_id, updates: { recipe_snapshot: ... } })` |
| js/brewpad.js openRecipeAttachPanel | GET /api/recipes?status=active | fetch on focus | WIRED | Line 1782: `fetch(mwUrl() + '/api/recipes?status=active', ...)` |
| js/brewpad.js openRecipeFromBatchSheet | POST /api/recipes | fetch to create new recipe | WIRED | Line 1943: `fetch(mwUrl() + '/api/recipes', { method: 'POST', ... })` |
| js/admin.js kioskSaveRecipeQuickEdit | PUT /api/recipes/:id | fetch with all 4 fields | WIRED | Line 10462: `fetch(mw + '/api/recipes/' + ..., { method: 'PUT', ... })` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| js/brewpad.js bindRecipePickerSearch | `_recipeCatalog` | GET /api/recipes?status=active | Yes — live middleware endpoint returning Sheets data | FLOWING |
| js/brewpad.js openRecipeAttachPanel | `_catalog` | GET /api/recipes?status=active | Yes — live middleware endpoint | FLOWING |
| js/brewpad.js openRecipeFromBatchSheet | POST response `recipe_id` | POST /api/recipes response | Yes — creates real record, returns recipe_id | FLOWING |
| apps-script/adminApi.gs updateBatch | `updates.recipe_snapshot` | JSON string from browser, validated via JSON.parse() | Yes — written to sheet cell via setValue() | FLOWING |
| js/admin.js kioskSaveRecipeQuickEdit | `fields` (name/notes/locked_price/status) | Form input values | Yes — sent to PUT /api/recipes/:id | FLOWING |

### Behavioral Spot-Checks

Step 7b: SKIPPED — these features require a running Apps Script deployment and live middleware. No runnable local entry point for recipe create/attach flows. Human verification items cover all key behaviors.

### Requirements Coverage (REQUIREMENTS.md)

Phase 16 plan frontmatter declares D-01 through D-09 as its requirements. These are decision IDs from the CONTEXT.md, not IDs from REQUIREMENTS.md. The REQUIREMENTS.md traceability table covers phases 12-15 only; Phase 16 is not listed. No REQUIREMENTS.md IDs are declared by Phase 16 plans, and none are orphaned to Phase 16 in the traceability table. This is an intentional ID scheme difference — Phase 16 is a cross-cutting integration phase that delivers against the decisions captured in CONTEXT.md rather than the v2.0 model/API requirements already satisfied in earlier phases.

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| None found | — | — | — |

Scanned for: TODO/FIXME/placeholder comments, `return null`/`return []`, hardcoded empty data, props with hardcoded empty values, console.log-only implementations. No blockers or warnings found in the new Phase 16 code.

Specific checks:
- brewpad.js recipe picker: no placeholder data; actual fetch to `/api/recipes?status=active`
- brewpad.js batch detail: `_batchSnap` derived from real `b.recipe_snapshot`; empty state renders real Attach/Create UI (not fake content)
- admin.js quick-edit: reads live `recipe` object passed into `kioskShowRecipePrompt()`; saves via real PUT
- adminApi.gs: JSON.parse validation present; no bypass without valid JSON

### Human Verification Required

#### 1. BrewPad New Batch — Kits/Recipes Tab Switching and Recipe Selection

**Test:** Open BrewPad, click New Batch. Verify [Kits] and [Recipes] tabs appear above the product search field. Click Recipes tab — confirm placeholder changes to "Search recipes..." and input clears. Type a recipe name fragment — confirm a dropdown appears with recipe name + ABV subline. Select a recipe — confirm the product name field populates with the recipe name. Switch back to Kits tab — confirm state clears (no recipe bleed). Submit the form — check resulting batch record for recipe_id and recipe_snapshot populated.

**Expected:** Tab switching works cleanly in both directions. Recipe dropdown shows only active recipes. Selected recipe name appears in product field. Batch is created with recipe_id and recipe_snapshot in Batches sheet.

**Why human:** Requires live middleware `/api/recipes?status=active` endpoint and Apps Script create_batch action. The recipe_snapshot attachment is only verifiable by inspecting the Batches Google Sheet row after creation.

#### 2. BrewPad Batch Detail — Recipe Section Expand/Collapse and Snapshot Editing

**Test:** Open a batch that has a recipe_snapshot (created via a recipe sale in Phase 14, or created using the new picker in Test 1). Confirm Recipe section is collapsed with a chevron. Click the header — confirm it expands showing style, ABV, IBU, batch size, notes, and ingredient table. Click Edit Snapshot — confirm all 6 fields become editable inputs (name, style, ABV, IBU, batch_size_l, notes) plus ingredient qty inputs. Change the recipe name and one ingredient quantity. Click Save Changes — confirm success toast and return to read-only. Reload the batch — confirm edits persisted. Click Edit Snapshot again, change something, click Discard Changes — confirm revert with no API call made.

**Expected:** Toggle works with keyboard (Enter/Space). Edit form shows all D-04 fields. Save writes to batch snapshot only (master recipe unchanged). Reload confirms persistence.

**Why human:** Requires live Apps Script `update_batch` call with recipe_snapshot and a subsequent batch reload to verify the sheet write was permanent. Visual layout of edit form only verifiable in browser.

#### 3. BrewPad Batch Detail — Attach Recipe and Create Recipe Flows

**Test:** Open a kit batch (no recipe_snapshot). Confirm "No recipe attached to this batch." message with Attach Recipe and Create Recipe buttons. Click Attach Recipe — confirm inline search appears. Search for an active recipe, select it — confirm success toast "Recipe attached" and section flips to State A showing the recipe data. Then open a different kit batch, click Create Recipe — confirm slide-out opens pre-filled with batch's product name. Fill in style and ABV, click Save — confirm "Recipe created and linked" toast, section shows new recipe's data.

**Expected:** Attach flow: fetches active recipes, saves recipe_id + recipe_snapshot to batch via update_batch. Create flow: POSTs new recipe to /api/recipes (appears in admin Recipes tab as draft), then links to batch. Both transitions flip Recipe section from State B to State A.

**Why human:** Requires live middleware (GET + POST /api/recipes) and Apps Script (update_batch). Create flow also verifiable by checking new draft recipe appears in admin Recipes tab.

#### 4. Kiosk Recipe Quick-Edit — End-to-End Edit and Save

**Test:** Open kiosk, navigate to Recipes tab (confirm it loads even with BEER_SALES_ENABLED=false if applicable). Tap a recipe card to open detail pane. Confirm "Edit Recipe" button is visible at primary style. Tap Edit Recipe — confirm inline form with pre-filled name, notes, price, status appears. Change the recipe name. Click Save Changes — confirm button shows "Saving...", becomes disabled during request. Confirm success toast "Recipe updated." and pane returns to read-only with new name in the header. Tap Edit Recipe again, change something, click Discard Changes — confirm form closes with no API call. Attempt to activate a recipe without a price — confirm 422 rejection from server and error toast.

**Expected:** Touch-friendly targets (44px buttons). iOS auto-zoom prevention (16px font-size). Status select has Draft/Active options. Save disables button, re-enables on error.

**Why human:** Requires kiosk running on tablet with live middleware PUT /api/recipes/:id. Touch behavior, font sizes, and button disable state are only verifiable interactively.

#### 5. Apps Script updateBatch() Recipe Fields — Sheet Write Verification

**Test:** After completing Test 1 (create batch with recipe selected) and Test 2 (edit snapshot), open the Batches Google Sheet directly. Confirm the batch row from Test 1 has recipe_id and recipe_snapshot populated (recipe_snapshot should be valid JSON). Confirm the batch row from Test 2 edit has the updated recipe_snapshot with the changed name/quantity. Confirm the master Recipes sheet row is unchanged (recipe name in Recipes tab = original, not the batch-edited name).

**Expected:** recipe_id column has recipe ID string (e.g., RCP-000001). recipe_snapshot column has JSON blob with name, style, abv, ibu, batch_size_l, notes, ingredients. Master recipe record unchanged.

**Why human:** Requires direct Google Sheets inspection. Apps Script server-side JSON parsing only verifiable by attempting to write invalid JSON and confirming rejection.

### Gaps Summary

No blocker or warning gaps found. All must-haves are verified at code level (artifact exists, is substantive, is wired, data flows through real endpoints).

The only outstanding items are human verification of the end-to-end interactive flows — which require a running Apps Script deployment and live middleware. These are normal for a phase of this type and do not indicate missing implementation.

---

_Verified: 2026-05-18T04:53:00Z_
_Verifier: Claude (gsd-verifier)_
