# Phase 16: Recipe Management — BrewPad, Kiosk & Batch Integration - Context

**Gathered:** 2026-05-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Staff can browse, view, quick-edit, and select recipes from BrewPad and kiosk — not just the admin Recipes tab. In BrewPad, selecting a recipe when creating a new batch pre-fills product info and attaches the full recipe snapshot. The batch detail view shows recipe data in an expandable section with full editing capabilities (batch-local only — master recipe unchanged). Kit batches can also have recipes attached or created from scratch. Kiosk recipe browsing and quick-editing works independently of BEER_SALES_ENABLED (only sales remain gated).

</domain>

<decisions>
## Implementation Decisions

### Recipe Picker in BrewPad Batch Form
- **D-01:** Tabbed picker in the product field: "Kits" tab (existing Zoho product search) and "Recipes" tab (from Sheets via middleware API). Clean separation — no confusion between kit SKUs and recipe records.
- **D-02:** Selecting a recipe pre-fills the product name AND attaches the full `recipe_snapshot` JSON (ingredients, style, ABV, batch size) to the batch record. Uses the existing `recipe_snapshot` column in the Batches sheet.

### Recipe Editing Surfaces
- **D-03:** BrewPad and kiosk get a view + quick-edit experience: read-only ingredient list with inline editing for key fields (name, notes, price, status). Full ingredient CRUD (add/remove/swap ingredients) stays in the admin Recipes tab only.
- **D-04:** Once a recipe is loaded into a batch, staff can edit ALL recipe fields on that batch's snapshot — ingredients, quantities, name, style, ABV, batch size, notes. This covers the "we ran out of X, substituted Y" use case.
- **D-05:** Batch recipe edits are batch-local only. Modifying a recipe on a batch changes that batch's snapshot — the master recipe record in the Recipes tab is never affected. Each batch is an independent record.

### Recipe Data in Batch Detail
- **D-06:** Expandable "Recipe" section in BrewPad batch detail view. Collapsed by default. Shows style, ABV, IBU, batch size, and ingredient table. An "Edit" button opens inline editing per D-04/D-05.
- **D-07:** ALL batches show a Recipe section — not just recipe-sourced ones. Kit batches (no recipe_snapshot) show an "Attach Recipe" button to link an existing recipe, plus a "Create Recipe" button to generate a new recipe record from the batch's product info.

### Kiosk Recipe Browsing
- **D-08:** Recipe browsing and quick-editing in the kiosk is ungated — works even when BEER_SALES_ENABLED=false. Only the "Sell" action is blocked by the feature gate. Staff can prep recipes and train before the licence arrives.
- **D-09:** Kiosk recipe view uses the same quick-edit pattern as BrewPad (D-03): read-only ingredient list, inline edit for name, notes, price, status. Consistent experience across both surfaces.

### Claude's Discretion
- **Recipe tab styling:** Claude designs the tabbed picker UI in the BrewPad batch form. Should feel consistent with the existing product search dropdown pattern.
- **Recipe section layout:** Claude decides the collapsible section design in batch detail. Should match BrewPad's existing section patterns (Timeline, Tasks, Plato Readings).
- **Create Recipe from Batch flow:** Claude decides the UX for generating a recipe from a kit batch — could be a modal, a slide-out form, or a redirect to the admin recipe editor.
- **Kiosk recipe list layout:** Claude decides card layout for recipe browsing in kiosk. Should be consistent with existing kiosk product cards.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Recipe System (Phases 12-15)
- `.planning/phases/13-middleware-api-admin-recipe-management/13-CONTEXT.md` — Middleware recipe API contract, availability checking, ingredient autocomplete, cache strategy
- `.planning/phases/14-kiosk-recipe-sales-inventory-batch-creation/14-CONTEXT.md` — Kiosk recipe sale flow, batch auto-creation, feature gate decisions
- `.planning/phases/15-beerxml-import/15-CONTEXT.md` — BeerXML parser, ingredient matching UX

### Recipe API
- `zoho-middleware/routes/recipes.js` — GET /api/recipes (list), GET /api/recipes/:id (detail), GET /api/recipes/:id/availability (stock check)

### BrewPad Batch System
- `js/brewpad.js` — Batch list, detail view, create form (`buildCreateForm` at line 2751), lifecycle timeline, vessel/schedule assignment
- `zoho-middleware/lib/brewpad-integration.js` — Batch creation, Zoho sync, retry mechanism

### Kiosk
- `js/kiosk.js` — Kiosk tab system, product grid, recipe tab (gated by BEER_SALES_ENABLED), cart, payment flow

### Admin Recipe Editor
- `js/admin.js` — Full recipe CRUD in recipes IIFE: `openRecipeDetail()`, `saveRecipe()`, `populateRecipeForm()`, `renderIngredientRows()`, `filterIngredientCatalog()`, `parseBeerXML()`, `autoMatchIngredients()`

### Batch Data Model
- `recipe_snapshot` column in Batches Google Sheet — JSON blob storing recipe state at batch creation time
- Apps Script `adminApi.gs` — create_batch, update_batch actions

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `buildCreateForm()` in brewpad.js (line 2751): Current New Batch form with product search, customer search, vessel, schedule, start date. The product search field is where the tabbed picker (D-01) integrates.
- `GET /api/recipes` middleware endpoint: Returns recipe list with name, style, ABV, status, locked_price. Already paginated and filterable by status. BrewPad/kiosk can call this directly.
- `filterIngredientCatalog()` in admin.js: Fuzzy ingredient search against Zoho catalog. Used in admin recipe editor — could be reused if full ingredient editing is needed.
- `_recipesState` in admin.js: Recipe state management pattern (list, current recipe, current ingredients, catalog). BrewPad/kiosk recipe views can follow same pattern.
- Existing tabbed UI patterns in kiosk.js: Products/Recipes/Sales Orders tab system. Already has tab switching infrastructure.

### Established Patterns
- Batch detail sections in brewpad.js: Timeline, Tasks, Plato Readings are all collapsible sections. Recipe section (D-06) follows same pattern.
- `adminApiPost('update_batch', { batch_id, updates })`: Existing batch update mechanism. Recipe snapshot edits use this same call with `updates.recipe_snapshot`.
- `adminApiPost('create_batch', payload)`: Existing batch creation via Apps Script. Already accepts `product_name`, `product_sku`, `customer_name`, etc.
- Quick-edit inline pattern: BrewPad batch detail already has inline edit for status, vessel, notes. Recipe quick-edit (D-03) follows same interaction pattern.

### Integration Points
- BrewPad `buildCreateForm()` — add tab switcher to product field
- BrewPad `renderBatchDetail()` — add collapsible Recipe section
- BrewPad batch create submit — attach recipe_snapshot when recipe selected
- Kiosk recipe tab — ungate from BEER_SALES_ENABLED for browsing/editing
- Apps Script `update_batch` — ensure recipe_snapshot field is writable via updates

</code_context>

<specifics>
## Specific Ideas

- Tabbed picker preview: `[Kits] [Recipes]` tabs in the product search field, recipe results show name + ABV
- Expandable recipe section in batch detail: collapsed by default, expand to see/edit ingredients
- Kit batches get "Attach Recipe" and "Create Recipe" options — turns one-off brews into reusable recipes
- Batch-local recipe edits: like how a printed order doesn't change the menu

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 16-recipe-management-brewpad-kiosk-batch-integration*
*Context gathered: 2026-05-17*
