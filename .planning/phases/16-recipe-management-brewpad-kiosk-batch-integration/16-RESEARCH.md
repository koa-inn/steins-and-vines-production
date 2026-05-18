# Phase 16: Recipe Management — BrewPad, Kiosk & Batch Integration - Research

**Researched:** 2026-05-17
**Domain:** Vanilla JS UI integration — BrewPad batch form, batch detail view, kiosk recipe browser, Apps Script batch update
**Confidence:** HIGH — all findings verified against actual source files in this repo

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Tabbed picker in the product field: "Kits" tab (existing Zoho product search) and "Recipes" tab (from Sheets via middleware API). Clean separation — no confusion between kit SKUs and recipe records.
- **D-02:** Selecting a recipe pre-fills the product name AND attaches the full `recipe_snapshot` JSON (ingredients, style, ABV, batch size) to the batch record. Uses the existing `recipe_snapshot` column in the Batches sheet.
- **D-03:** BrewPad and kiosk get a view + quick-edit experience: read-only ingredient list with inline editing for key fields (name, notes, price, status). Full ingredient CRUD (add/remove/swap ingredients) stays in the admin Recipes tab only.
- **D-04:** Once a recipe is loaded into a batch, staff can edit ALL recipe fields on that batch's snapshot — ingredients, quantities, name, style, ABV, batch size, notes. This covers the "we ran out of X, substituted Y" use case.
- **D-05:** Batch recipe edits are batch-local only. Modifying a recipe on a batch changes that batch's snapshot — the master recipe record in the Recipes tab is never affected.
- **D-06:** Expandable "Recipe" section in BrewPad batch detail view. Collapsed by default. Shows style, ABV, IBU, batch size, and ingredient table. An "Edit" button opens inline editing per D-04/D-05.
- **D-07:** ALL batches show a Recipe section — not just recipe-sourced ones. Kit batches (no recipe_snapshot) show an "Attach Recipe" button to link an existing recipe, plus a "Create Recipe" button to generate a new recipe record from the batch's product info.
- **D-08:** Recipe browsing and quick-editing in the kiosk is ungated — works even when BEER_SALES_ENABLED=false. Only the "Sell" action is blocked by the feature gate.
- **D-09:** Kiosk recipe view uses the same quick-edit pattern as BrewPad (D-03): read-only ingredient list, inline edit for name, notes, price, status.

### Claude's Discretion
- Recipe tab styling in the BrewPad batch form picker
- Collapsible recipe section design in batch detail (must match existing section patterns)
- Create Recipe from Batch flow UX (modal, slide-out form, or redirect to admin editor)
- Kiosk recipe list layout (should match existing kiosk product cards)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

---

## Summary

Phase 16 adds recipe awareness to two existing UIs (BrewPad batch form + batch detail) and unblocks recipe browsing/editing in the kiosk independent of the sales feature gate. It is a pure frontend phase with one Apps Script fix — no new middleware routes are needed.

The phase has three discrete areas: (1) **BrewPad new-batch form** — replace the single-field product search with a tabbed picker (`[Kits] [Recipes]`), where selecting a recipe pre-fills name and attaches a snapshot to the create payload. (2) **BrewPad batch detail** — add a collapsible Recipe section after the Notes section, showing snapshot data with inline editing that saves via the existing `update_batch` Apps Script action. (3) **Kiosk recipe browser** — ungate recipe browsing and add a quick-edit flow for recipe metadata (name, notes, price, status).

One critical Apps Script gap exists: `updateBatch()` in `adminApi.gs` does not include `recipe_snapshot` or `recipe_id` in its `allowedFields` array. This must be patched as part of Phase 16 before batch-local recipe edits can work.

**Primary recommendation:** Work in three task groups in dependency order — (1) Apps Script patch (unlocks all recipe_snapshot writes), (2) BrewPad batch form tabbed picker, (3) BrewPad batch detail Recipe section, (4) Kiosk quick-edit ungate.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Tabbed recipe picker in New Batch form | Browser (brewpad.js) | Middleware GET /api/recipes | UI renders in browser; recipe list fetched from middleware |
| Recipe snapshot attached at batch creation | Browser (brewpad.js) → Apps Script | — | Snapshot JSON serialized in create payload; Apps Script already handles it in createBatch |
| Collapsible Recipe section in batch detail | Browser (brewpad.js) | — | Pure DOM rendering from batch data already in memory |
| Batch-local recipe snapshot editing | Browser (brewpad.js) → Apps Script update_batch | — | Calls existing adminApiPost('update_batch', {updates: {recipe_snapshot, recipe_id}}) |
| Kiosk recipe browsing (ungated) | Browser (admin.js kiosk IIFE) | Middleware GET /api/recipes | Remove/bypass BEER_SALES feature gating from browse path only |
| Kiosk recipe quick-edit | Browser (admin.js kiosk IIFE) | Middleware PUT /api/recipes/:id | Reuse existing PUT endpoint; metadata-only fields |
| Apps Script recipe_snapshot write via updateBatch | Apps Script (adminApi.gs) | — | allowedFields patch — adds recipe_snapshot, recipe_id to update path |

---

## Standard Stack

### Core (existing — no new dependencies)
| Component | Location | Purpose | Notes |
|-----------|----------|---------|-------|
| `js/brewpad.js` | Frontend standalone | BrewPad batch management SPA | Standalone file, not part of module build |
| `js/admin.js` | Frontend standalone | Admin panel + kiosk IIFE | 10,678 lines; kiosk section starts around line 9000 |
| `apps-script/adminApi.gs` | Apps Script | Batch CRUD + recipe CRUD server-side | updateBatch needs allowedFields patch |
| `zoho-middleware/routes/recipes.js` | Middleware | Recipe list, detail, availability, CRUD | All existing endpoints are sufficient for Phase 16 |
| `adminApiPost(action, payload)` | brewpad.js / admin.js | Apps Script RPC wrapper | Used for all batch writes |

### Existing Middleware Endpoints Consumed
| Endpoint | Used By | Notes |
|----------|---------|-------|
| `GET /api/recipes?status=active` | BrewPad tabbed picker (Recipes tab) | Already used by kiosk |
| `GET /api/recipes/:id` | BrewPad recipe picker detail + kiosk detail | Already implemented |
| `PUT /api/recipes/:id` | Kiosk quick-edit | Already implemented; activation guardrail exists (price required for `status=active`) |

**No new middleware routes required for Phase 16.** All reads use existing recipe endpoints; all batch writes use the existing `update_batch` Apps Script action.

---

## Architecture Patterns

### System Architecture Diagram

```
BrewPad New Batch Form
  [Kits tab]  [Recipes tab]
       |              |
  Zoho /api/products  GET /api/recipes?status=active
       |              |
  Select kit    Select recipe
       |              |
  productName   productName + recipe_snapshot JSON
       |              |
  adminApiPost('create_batch', { ...existing, recipe_id, recipe_snapshot })
                       |
               Apps Script createBatch()
               [already handles recipe_id, recipe_snapshot via header lookup]

BrewPad Batch Detail
  renderBatchDetail(data)
       |
  Add collapsible Recipe section (after Notes section)
       |
  If b.recipe_snapshot → parse and render fields + ingredient table
  If no snapshot → show "Attach Recipe" + "Create Recipe" buttons
       |
  Edit button → inline editing → adminApiPost('update_batch',
                 { batch_id, updates: { recipe_snapshot, recipe_id } })
                       |
               Apps Script updateBatch()
               [NEEDS PATCH: add recipe_snapshot, recipe_id to allowedFields]

Kiosk Recipe Browser (admin.js kiosk IIFE)
  kiosk-mode-recipes tab clicked
       |
  [currently: always loads, BEER_SALES_ENABLED gates only /confirm endpoint]
  [Phase 16: quick-edit button added to recipe detail prompt]
       |
  Quick-edit (name, notes, price, status) → PUT /api/recipes/:id
  Sell button → still gated by BEER_SALES_ENABLED server-side (unchanged)
```

### Recommended Project Structure (no new files required)

All changes land in existing files:
```
js/
  brewpad.js         — tabbed picker, collapsible recipe section, inline editing
  admin.js           — kiosk recipe quick-edit additions
apps-script/
  adminApi.gs        — allowedFields patch in updateBatch()
css/
  brewpad.css        — collapsible section styles, tab picker styles
  kiosk.css          — quick-edit panel styles (if needed)
```

### Pattern 1: Tabbed Picker in buildCreateForm()

The existing product search uses a `bp-vessel-wrap` + `bp-vessel-dropdown` pattern. The tabbed picker replaces the single product input with a tabbed container.

**What it replaces** (brewpad.js ~line 2767-2773):
```javascript
// Current: single product field
html += '<div class="bp-form-group"><label>Product</label>';
html += '<div class="bp-vessel-wrap">';
html += '<input type="text" id="bp-new-product-text" ... placeholder="Search kits…">';
html += '<div class="bp-vessel-dropdown" id="bp-new-product-dropdown" ...></div>';
html += '<input type="hidden" id="bp-new-product-sku">';
html += '<input type="hidden" id="bp-new-product-name">';
html += '</div></div>';
```

**New pattern** — add a recipe_snapshot hidden field and tab toggle buttons. The existing `bindProductSearch()` function is preserved for the Kits tab; a new `bindRecipePickerSearch()` handles the Recipes tab.

Hidden fields needed:
- `bp-new-product-sku` (existing — used for kit SKU, left blank for recipe)
- `bp-new-product-name` (existing — set to recipe name when recipe selected)
- `bp-new-recipe-id` (new hidden — recipe_id when recipe selected, blank for kit)
- `bp-new-recipe-snapshot` (new hidden — JSON string when recipe selected)

**Tab state:** A JS variable `_productPickerTab` ('kits' | 'recipes') tracks which tab is active. Tab buttons set this and swap the dropdown content/behavior.

**Submit payload extension** (brewpad.js ~line 2890):
```javascript
// Existing create_batch call — add these two fields:
adminApiPost('create_batch', {
  product_name: productName,
  product_sku: productSku,
  // ... existing fields ...
  recipe_id: (document.getElementById('bp-new-recipe-id') || {}).value || '',
  recipe_snapshot: (document.getElementById('bp-new-recipe-snapshot') || {}).value || ''
})
```

Apps Script `createBatch()` already handles `recipe_id` and `recipe_snapshot` via header-lookup writes (lines 1809-1820 in adminApi.gs). No Apps Script change needed for batch creation.

### Pattern 2: Collapsible Recipe Section in renderBatchDetail()

The existing batch detail uses non-collapsible `bp-detail-section` divs. The Recipe section uses the same CSS class but adds a toggle. The `.bp-detail-section-title` element becomes a clickable toggle button.

**Insertion point:** After the Notes section (~line 1823), before the footer actions.

```javascript
// Collapsed by default; add aria-expanded + data attribute
html += '<div class="bp-detail-section bp-detail-section--recipe">';
html += '<div class="bp-detail-section-title bp-detail-section-toggle" ' +
        'id="bp-recipe-section-toggle" aria-expanded="false" role="button" tabindex="0">';
html += 'Recipe <span class="bp-section-toggle-icon">&#9656;</span>';
html += '</div>';
html += '<div class="bp-recipe-section-body" id="bp-recipe-section-body" style="display:none;">';
// ... recipe content ...
html += '</div></div>';
```

**Toggle behavior:** Click/keydown on `.bp-detail-section-toggle` flips `style.display` and `aria-expanded`.

**Recipe content — two states:**

State A: `b.recipe_snapshot` is a non-empty JSON string:
- Parse snapshot: `var snap = JSON.parse(b.recipe_snapshot || '{}');`
- Show: style, ABV, IBU, batch size, ingredient table (read-only)
- "Edit Recipe" button → switches ingredient table to inline edit mode (quantity inputs + notes)
- Save: `adminApiPost('update_batch', { batch_id, updates: { recipe_snapshot: JSON.stringify(editedSnap) } })`

State B: `b.recipe_snapshot` is empty/null:
- "Attach Recipe" button → opens recipe search dropdown (calls `GET /api/recipes?status=active`, picks one, saves recipe_id + recipe_snapshot via update_batch)
- "Create Recipe from Batch" button → opens a modal/slide-out with a minimal recipe form pre-filled from `b.product_name` and `b.product_sku`. On save, calls `POST /api/recipes` (existing create endpoint), then saves resulting recipe_id + snapshot to the batch via update_batch.

### Pattern 3: Apps Script updateBatch() allowedFields Patch

**CRITICAL GAP** (verified at adminApi.gs line 1982-1989):

```javascript
// Current allowedFields — recipe_snapshot and recipe_id are ABSENT:
var allowedFields = [
  'status', 'vessel_id', 'shelf_id', 'bin_id', 'notes',
  'zoho_so_number', 'customer_id', 'customer_name', 'product_name',
  'customer_firstname', 'customer_lastname',
  'fermentation_started_at', 'completed_at'
];
```

**Fix required:**
```javascript
var allowedFields = [
  'status', 'vessel_id', 'shelf_id', 'bin_id', 'notes',
  'zoho_so_number', 'customer_id', 'customer_name', 'product_name',
  'customer_firstname', 'customer_lastname',
  'fermentation_started_at', 'completed_at',
  'recipe_id', 'recipe_snapshot'   // Phase 16 addition
];
```

Note: `recipe_snapshot` values may be large JSON strings. `sanitizeInput()` is called on all field values — verify it handles JSON without stripping curly braces or quotes. If it does, use a raw `setValue()` for the snapshot field only.

### Pattern 4: Kiosk Quick-Edit

The kiosk recipe browser currently shows cards → tapping a card opens `kioskShowRecipePrompt()` (admin.js ~line 10300). Phase 16 adds a "Edit Recipe" button to the recipe prompt panel (or a dedicated detail view).

Quick-edit fields per D-03/D-09: name, notes, price (locked_price), status.

The existing `PUT /api/recipes/:id` endpoint handles these fields. The activation guardrail on that endpoint (price + ingredient count required for status='active') applies server-side — no client-side duplication needed.

**Ungating analysis:** BEER_SALES_ENABLED currently gates only the `/api/kiosk/recipe-sale` and `/api/kiosk/recipe-sale/confirm` endpoints server-side (verified in pos-recipe.js). The kiosk recipe browser (`kioskSetMode('recipes')`, `kioskLoadRecipes()`) is NOT currently gated — it loads recipes unconditionally when the Recipes tab is clicked. D-08 is already implemented for browsing. Phase 16 only adds quick-edit capability, which uses `PUT /api/recipes/:id` (no BEER_SALES_ENABLED gate on that endpoint — correct).

**What Phase 16 must not touch:** The `kioskAddRecipeToCart()` → checkout flow — that path remains gated server-side by BEER_SALES_ENABLED.

### Anti-Patterns to Avoid

- **Modifying master recipe from batch detail**: All recipe edits in batch detail must serialize to `recipe_snapshot` on the batch, never call `PUT /api/recipes/:id`. Master recipe is read-only from the batch context.
- **Assuming recipe_snapshot is always valid JSON**: `JSON.parse()` must be wrapped in try/catch. Treat parse failures as "no snapshot" and show Attach/Create buttons instead of crashing.
- **Losing tab state on form re-render**: If `buildCreateForm()` is called again (e.g., error recovery), `_productPickerTab` must persist across re-renders so the user stays on their selected tab.
- **Double-reading headers in Apps Script for each field**: The existing `createBatch()` function reads headers twice (once for customer fields, once for recipe fields). The `updateBatch()` fix should use the headers array already fetched at line 1908.
- **Using `sanitizeInput()` on large JSON blobs**: `sanitizeInput()` in Apps Script may truncate or mangle JSON with special characters. For `recipe_snapshot`, prefer a targeted `setValue()` after basic validation (non-empty, valid JSON).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Recipe list for picker | Custom fetch + parse | `GET /api/recipes?status=active` (existing) | Already returns name, style, ABV, status, locked_price |
| Recipe detail for snapshot | Custom fetch | `GET /api/recipes/:id` (existing) | Returns full ingredient list for snapshot construction |
| Recipe metadata update (quick-edit) | Custom Apps Script action | `PUT /api/recipes/:id` (existing middleware) | Already handles name, notes, price, status with activation guardrail |
| Batch recipe snapshot save | New Apps Script action | Add `recipe_snapshot` to `updateBatch()` allowedFields | Less surface area; existing locking + versioning still applies |
| Fuzzy recipe search | Client-side fuzzy library | Simple `includes()` on name/style | Recipe list is small (< 50 active); exact substring is sufficient |
| Collapsible sections | CSS animation library | `style.display` toggle + CSS transition on height | Matches existing pattern in rest of BrewPad; no library needed |

---

## Common Pitfalls

### Pitfall 1: recipe_snapshot blocked by updateBatch allowedFields
**What goes wrong:** Calls to `adminApiPost('update_batch', { updates: { recipe_snapshot: '...' } })` silently do nothing — the field is not in the allowedFields list, so the Apps Script discards it.
**Why it happens:** allowedFields was built incrementally; recipe fields were only added to `createBatch`, not `updateBatch`.
**How to avoid:** Patch Apps Script first (Task 1) before any browser-side batch recipe save code is written or tested.
**Warning signs:** `update_batch` returns `{ ok: true }` but the Batches sheet shows no change to recipe_snapshot column.

### Pitfall 2: sanitizeInput() mangling JSON
**What goes wrong:** `sanitizeInput()` in Apps Script strips or escapes characters in the recipe_snapshot JSON string, making it invalid when re-parsed on the frontend.
**Why it happens:** sanitizeInput is designed for user-visible text strings, not serialized JSON.
**How to avoid:** Check what `sanitizeInput()` does (grep it in adminApi.gs). If it strips special characters, bypass it for `recipe_snapshot` with a direct `setValue()` after verifying the value is valid JSON.
**Warning signs:** JSON.parse on a retrieved recipe_snapshot throws SyntaxError.

### Pitfall 3: Kiosk quick-edit accidentally triggering activation guardrail
**What goes wrong:** Staff edits recipe name or notes (not intending to activate), but the PUT payload accidentally sets status=active. The middleware rejects with 422 because locked_price is missing from the quick-edit payload.
**Why it happens:** If the quick-edit form sends a partial payload and the existing recipe is in 'draft' status, including status='draft' is fine — but if status field is omitted and backend defaults to something unexpected.
**How to avoid:** Quick-edit payload must include the current status value (fetched from recipe detail). Never omit status from the PUT payload.
**Warning signs:** 422 errors from `PUT /api/recipes/:id` when staff only edits name.

### Pitfall 4: Tab state lost on create form interaction
**What goes wrong:** After selecting a recipe and the dropdown closes, the user sees the Kits tab is now active because bindProductSearch() fires on focus and resets to kit mode.
**Why it happens:** `buildCreateForm()` calls `bindProductSearch()` which always binds to the product text input — if the input receives focus after a recipe is selected, the dropdown re-opens in kit mode.
**How to avoid:** The recipe-tab state must disable the product text input's focus handler when the Recipes tab is active. Use `_productPickerTab` guard inside `showProductOptions()`.
**Warning signs:** Recipe tab content disappears when user clicks elsewhere and back.

### Pitfall 5: Large recipe_snapshot breaking Apps Script cell limit
**What goes wrong:** Apps Script Google Sheets cells have a 50,000 character limit per cell. A recipe with many ingredients could generate a snapshot JSON exceeding this.
**Why it happens:** JSON includes full ingredient data per line item — with 30+ ingredients and all fields, can get large.
**How to avoid:** Trim snapshot to essential fields only: `{ name, style, abv, ibu, batch_size_l, ingredients: [{ item_id, item_name, quantity, unit }] }`. Omit stock hints, purchase rates, availability data. This aligns with what `recipe_snapshot` needs per BAT-03.
**Warning signs:** Apps Script setValue() call fails or truncates silently.

### Pitfall 6: Create Recipe from Batch creates duplicate recipe records
**What goes wrong:** Staff clicks "Create Recipe" multiple times (slow Apps Script response), creating multiple recipe records from the same batch.
**Why it happens:** No idempotency guard on the "Create Recipe" button; Apps Script creates a new recipe on each call.
**How to avoid:** Disable the "Create Recipe" button immediately on click; re-enable on error. The recipe_id returned from the create call is then saved to the batch via update_batch.

---

## Code Examples

### Recipe Picker Tab HTML (in buildCreateForm)

```javascript
// Source: derived from existing bp-vessel-wrap pattern (brewpad.js ~line 2767)
html += '<div class="bp-form-group"><label>Product</label>';
html += '<div class="bp-product-tabs">';
html += '<div class="bp-product-tab-bar">';
html += '<button type="button" class="bp-product-tab bp-product-tab--active" data-picker-tab="kits">Kits</button>';
html += '<button type="button" class="bp-product-tab" data-picker-tab="recipes">Recipes</button>';
html += '</div>';
html += '<div class="bp-vessel-wrap">';
html += '<input type="text" id="bp-new-product-text" class="bp-inline-input" placeholder="Search kits…" autocomplete="off">';
html += '<div class="bp-vessel-dropdown" id="bp-new-product-dropdown" style="display:none;"></div>';
html += '<input type="hidden" id="bp-new-product-sku">';
html += '<input type="hidden" id="bp-new-product-name">';
html += '<input type="hidden" id="bp-new-recipe-id">';
html += '<input type="hidden" id="bp-new-recipe-snapshot">';
html += '</div></div></div>';
```

### Collapsible Section Toggle (CSS only — no extra JS library)

```css
/* Source: extend existing .bp-detail-section pattern (brewpad.css line 734) */
.bp-detail-section-toggle {
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.bp-detail-section-toggle:hover { color: var(--barrel); }
.bp-detail-section-toggle .bp-section-toggle-icon {
  transition: transform 0.2s ease;
  display: inline-block;
}
.bp-detail-section-toggle[aria-expanded="true"] .bp-section-toggle-icon {
  transform: rotate(90deg);
}
.bp-recipe-section-body {
  /* display:none toggled by JS; use padding transition for smooth open */
}
```

### Apps Script allowedFields Patch

```javascript
// Source: adminApi.gs line 1982 — updateBatch() function
// ADD recipe_id and recipe_snapshot to the allowedFields array:
var allowedFields = [
  'status', 'vessel_id', 'shelf_id', 'bin_id', 'notes',
  'zoho_so_number', 'customer_id', 'customer_name', 'product_name',
  'customer_firstname', 'customer_lastname',
  'fermentation_started_at', 'completed_at',
  'recipe_id', 'recipe_snapshot'
];
// NOTE: If sanitizeInput() mangles JSON, handle recipe_snapshot separately:
// After the allowedFields loop, add:
if (updates.recipe_snapshot !== undefined) {
  var snapCol = headers.indexOf('recipe_snapshot');
  if (snapCol !== -1) {
    sheet.getRange(row, snapCol + 1).setValue(updates.recipe_snapshot); // raw, no sanitize
  }
}
```

### Kiosk Quick-Edit Save Call

```javascript
// Source: uses existing PUT /api/recipes/:id endpoint (zoho-middleware/routes/recipes.js line 328)
function kioskSaveRecipeQuickEdit(recipeId, fields) {
  // fields: { name, notes, locked_price, status }
  // status must be current value from recipe detail — never change unintentionally
  var mw = kioskMwUrl();
  return fetch(mw + '/api/recipes/' + encodeURIComponent(recipeId), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': SHEETS_CONFIG.MW_API_KEY || ''
    },
    body: JSON.stringify(fields)
  }).then(function (r) {
    return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status));
  });
}
```

---

## State of the Art

| Old Pattern | Phase 16 Pattern | Notes |
|-------------|-----------------|-------|
| Product search: single text input | Product search: tabbed picker (Kits/Recipes) | Only in New Batch form |
| Batch detail sections: all static (no collapse) | Recipe section: collapsible, collapsed by default | Other sections unchanged |
| Kiosk recipe prompt: view-only, no editing | Kiosk recipe prompt: adds quick-edit button for metadata | Sales path unchanged |
| update_batch: no recipe fields | update_batch: recipe_id + recipe_snapshot writable | Apps Script patch |
| Kit batch: no recipe context | Kit batch: Attach or Create recipe option in detail | Both paths via update_batch |

---

## Open Questions (RESOLVED)

1. **sanitizeInput() behavior with JSON**
   - What we know: `sanitizeInput()` is called on all field values in `updateBatch()`. `createBatch()` uses a direct `setValue()` for recipe_snapshot (line 1819 — bypasses sanitizeInput).
   - What's unclear: Whether `updateBatch()` should bypass sanitizeInput for recipe_snapshot the same way createBatch does, or if the allowedFields loop's `sanitizeInput(String(updates[field]))` is safe for JSON.
   - Recommendation: Read `sanitizeInput()` definition before implementing the Apps Script patch. If it strips `{`, `}`, `"`, or `\`, use the same raw `setValue()` pattern as createBatch.

2. **Create Recipe from Batch — redirect vs. modal**
   - What we know: CONTEXT.md leaves this to Claude's discretion.
   - What's unclear: Redirecting to admin.html would lose the batch context; a modal is self-contained but needs the full recipe form embedded in brewpad.js.
   - Recommendation: A slide-out panel (same `bp-create-sheet` pattern as New Batch) is the most consistent choice. Pre-populate with batch product_name. On save, call `POST /api/recipes`, then immediately save recipe_id + snapshot to the batch.

3. **Snapshot structure for "Attach Recipe" path**
   - What we know: When staff attaches an existing recipe to a kit batch, the snapshot should come from the recipe detail (`GET /api/recipes/:id`).
   - What's unclear: Whether to include availability/stock data in the snapshot (it changes over time).
   - Recommendation: Snapshot should contain only static recipe data: `{ name, style, abv, ibu, batch_size_l, ingredients: [{ item_id, item_name, quantity, unit }] }`. Strip availability — it's computed at runtime.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The kiosk recipe browser (`kioskSetMode('recipes')`) is already ungated — BEER_SALES_ENABLED only blocks the confirm/sale endpoints | Architecture Patterns | If the kiosk Recipes tab button is hidden by BEER_SALES_ENABLED UI logic, Phase 16 scope expands to include unhiding it |
| A2 | `adminApiPost()` in brewpad.js calls the same Apps Script endpoint as admin.js — i.e., `SHEETS_CONFIG.APPS_SCRIPT_URL` | Don't Hand-Roll | If brewpad uses a different auth path, the update_batch call pattern needs adjustment |

**A1 verification:** Checked admin.js lines 10091-10094 — `modeRecipesBtn.addEventListener('click', ...)` has no BEER_SALES_ENABLED guard. The Recipes tab button is always visible. Confirmed: ungated for browsing. [VERIFIED: source code]

**A2 verification:** `adminApiPost()` in brewpad.js (line 623) uses `SHEETS_CONFIG.APPS_SCRIPT_URL` with JWT auth — same as admin.js. [VERIFIED: source code]

---

## Environment Availability

Step 2.6: SKIPPED — Phase 16 is pure frontend + Apps Script changes. No external tools, new services, or CLI utilities required beyond the existing project stack.

---

## Validation Architecture

`nyquist_validation: false` in `.planning/config.json` — this section is omitted per config.

---

## Security Domain

`security_enforcement: true`, `security_asvs_level: 1` in `.planning/config.json`.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No — no new auth paths | — |
| V3 Session Management | No | — |
| V4 Access Control | Partial — BEER_SALES_ENABLED gate must not be weakened | Server-side enforcement unchanged; quick-edit uses PUT endpoint (no sale gate needed) |
| V5 Input Validation | Yes — recipe_snapshot and recipe quick-edit fields | escapeHTML() on all rendered values; Apps Script sanitizeInput() on text fields |
| V6 Cryptography | No | — |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via recipe name/notes rendered in batch detail | Tampering | `escapeHTML()` on all rendered recipe data — already used throughout brewpad.js and admin.js |
| JSON injection via recipe_snapshot | Tampering | Validate snapshot is parseable JSON before saving; render via escapeHTML on each field |
| BEER_SALES_ENABLED bypass via quick-edit status change | Elevation of Privilege | PUT /api/recipes/:id does not sell anything — no bypass risk. Sales remain gated at pos-recipe.js endpoints |
| Oversized recipe_snapshot exceeding cell limits | Denial of Service | Trim snapshot to essential fields only (see Pitfall 5) |

---

## Project Constraints (from CLAUDE.md)

- Never edit `js/main.js` or `js/main.min.js` — brewpad.js and admin.js are standalone files, not part of the module build
- Run `npm test` AND `cd zoho-middleware && npm test` before every commit
- Run `npm run lint` before every commit
- Write regression tests FIRST when fixing bugs
- Read existing code before touching anything
- Use `grep` to find all usages before modifying shared functions
- After changing any shared utility, run FULL test suite for both frontend and middleware
- One logical change per commit
- All changes to staging first (`git push origin main`), never directly to production

---

## Sources

### Primary (HIGH confidence)
- `js/brewpad.js` (4,506 lines) — verified buildCreateForm(), renderBatchDetail(), bindProductSearch(), adminApiPost(), create_batch payload, update_batch call patterns
- `js/admin.js` (10,678 lines) — verified kiosk recipe browser implementation, kioskSetMode(), kioskLoadRecipes(), kioskRenderRecipes(), kioskShowRecipePrompt(), kioskAddRecipeToCart(), openRecipeDetail(), renderIngredientRows(), saveRecipe()
- `apps-script/adminApi.gs` — verified createBatch() recipe_snapshot write (lines 1809-1820), updateBatch() allowedFields (lines 1982-1989) — confirmed recipe_snapshot is ABSENT from allowedFields
- `zoho-middleware/routes/recipes.js` — verified GET /api/recipes, GET /api/recipes/:id, PUT /api/recipes/:id (activation guardrail), DELETE endpoints
- `css/brewpad.css` — verified .bp-detail-section, .bp-detail-section-title, .bp-inline-input patterns
- `css/kiosk.css` — verified .kiosk-product-card, .kiosk-mode-toggle, .kiosk-recipe-grid patterns
- `.planning/phases/16-recipe-management-brewpad-kiosk-batch-integration/16-CONTEXT.md` — locked decisions D-01 through D-09

### Secondary (MEDIUM confidence)
- `.planning/phases/13-middleware-api-admin-recipe-management/13-CONTEXT.md` — middleware API contract
- `.planning/phases/14-kiosk-recipe-sales-inventory-batch-creation/14-CONTEXT.md` — BEER_SALES_ENABLED gating decisions

---

## Metadata

**Confidence breakdown:**
- Apps Script gap (allowedFields): HIGH — verified by direct code read
- BrewPad integration points: HIGH — verified buildCreateForm(), renderBatchDetail(), adminApiPost() patterns
- Kiosk ungating: HIGH — verified BEER_SALES_ENABLED only gates pos-recipe.js sale endpoints
- Middleware sufficiency (no new routes): HIGH — existing GET/PUT endpoints cover all Phase 16 needs
- sanitizeInput() JSON safety: LOW — need to read the function definition before implementing Apps Script patch

**Research date:** 2026-05-17
**Valid until:** 2026-06-17 (stable codebase; no external dependencies)
