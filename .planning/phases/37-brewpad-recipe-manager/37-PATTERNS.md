# Phase 37: BrewPad Recipe Manager - Pattern Map

**Mapped:** 2026-06-19
**Files analyzed:** 3 (2 modified, 0 net-new files — BrewPad is a single bundle)
**Analogs found:** 3 / 3 (all exact or strong)

> This phase ports admin's recipe builder into BrewPad. There are **no new files** —
> all work lands in `js/brewpad.js` (source, minified to `brewpad.min.js` by `npm run build`)
> and `brewpad.html`. The middleware recipe routes are **reused unchanged** and mapped here
> as call-site contracts. Project rule: ES5 `var`, `escapeHTML()` on all dynamic HTML, never
> hand-edit `js/main.js`/`js/main.min.js`/`js/brewpad.min.js` (build artifacts).

## File Classification

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------|------|-----------|----------------|---------------|
| `js/brewpad.js` (recipes panel: list/browse/search) | UI panel render + list logic | CRUD (read) → request-response | `js/admin.js` `loadRecipeList`/`renderRecipeList` (L8526-8607) | exact (port + re-skin) |
| `js/brewpad.js` (recipes editor: create/edit/ingredient rows/autocomplete) | editor logic | CRUD (write) → request-response | `js/admin.js` `openRecipeDetail`/`renderIngredientRows`/`attachIngredientRowListeners`/`saveRecipe` (L8638-9070) | exact (port + re-skin) |
| `js/brewpad.js` (Recipes tab wiring + panel init) | tab wiring | event-driven (UI) | `js/brewpad.js` `switchTab` (L1489) + DOMContentLoaded tab loop (L7221) | exact (extend existing) |
| `js/brewpad.js` (delete → confirm-sheet) | confirm-sheet usage | event-driven → request-response (write) | `js/brewpad.js` `showConfirmSheet` (L2630) | exact (existing helper) |
| `js/brewpad.js` (authenticated middleware writes) | authenticated MW call | request-response (write) | `js/brewpad.js` `mwUrl`/`mwApiKey`/`postBottlingInvite` (L1099-1114) + `js/admin.js` `getRecipesMwHeaders` (L8462) | exact |
| `js/brewpad.js` (recipe detail grouped view) | UI render (grouping) | transform | `js/lib/recipe-grouping.js` `groupRecipeIngredients` (L88) + admin usage at `js/admin.js` L8770 | exact (reuse loaded helper) |
| `brewpad.html` (5th tab button + `#bp-panel-recipes`) | markup | n/a | `brewpad.html` `.bp-tab-bar` (L112-129) + panels (L62-109); markup from `admin.html` recipe panel (L444-586) | exact |
| `zoho-middleware/routes/recipes.js` | middleware route | CRUD → request-response | **REUSED UNCHANGED** — call-site contract only | n/a |

---

## Pattern Assignments

### `js/brewpad.js` — Recipes browse/list panel (UI panel, CRUD read)

**Analog:** `js/admin.js` `loadRecipeList` (L8526-8552) + `renderRecipeList` (L8554-8607)

**List fetch + status filter contract** (admin L8526-8552 — mirror, but in BrewPad style and using `escapeHTML`):
```javascript
// GET /api/recipes?status=<all|draft|active|inactive>  (read, no API key required)
fetch(mwUrl + '/api/recipes?status=' + encodeURIComponent(status), {
  headers: getRecipesMwHeaders(false)   // BrewPad: { 'Content-Type': 'application/json' }
})
  .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
  .then(function (data) {
    _recipesState.list = data.recipes || [];   // response shape: { recipes:[], total }
    _recipesState.total = data.total || 0;
    renderRecipeList();
  })
```

**Row render with status badge + price + escapeHTML** (admin L8577-8606). Note the dynamic-vs-locked price branch and `escapeHTML` on every dynamic value:
```javascript
var badgeClass = 'recipes-badge-' + (recipe.status || 'draft');
var isDynamic = recipe.pricing_mode === 'dynamic';
var priceVal = isDynamic ? Number(recipe.computed_price) : Number(recipe.locked_price);
var price = priceVal > 0 ? (isDynamic ? '~$' : '$') + priceVal.toFixed(2) : '—';
html += '<tr class="recipes-row" data-recipe-id="' + escapeHTML(recipe.recipe_id || '') + '">';
html += '<td>' + escapeHTML(recipe.name || '') + '</td>';
html += '<td><span class="' + badgeClass + '">' + escapeHTML(recipe.status || 'draft') + '</span></td>';
```

**Draft/active status indicators + search-by-name** (ROADMAP success criteria) — admin uses a `<select>` status filter (admin.html L453-458). BrewPad must add: (1) the same draft/active badge per row, (2) a name search/filter input. The ROADMAP requires search; admin has no text search, so the name-filter is BrewPad-new — filter `_recipesState.list` client-side by `recipe.name.toLowerCase().indexOf(query)` (mirror admin's catalog filter idiom at L8866-8873).

**Row click → detail** (admin L8600-8606): attach click listener per `.recipes-row`, call `openRecipeDetail(data-recipe-id)`. In BrewPad prefer the existing event-delegation pattern (`initDelegation`, `js/brewpad.js` L6407) over per-row listeners for touch consistency.

---

### `js/brewpad.js` — Recipe editor (editor logic, CRUD write)

**Analog:** `js/admin.js` `openRecipeDetail` (L8644-8699), `populateRecipeForm` (L8702-8719), `renderIngredientRows` (L8745-8821), `attachIngredientRowListeners` (L8824-8864), autocomplete (L8866-8930), `addIngredientRow` (L8933-8948), `canActivateRecipe` (L8984-8993), `saveRecipe` (L8996-9070).

**State object to port verbatim** (admin L8443-8453):
```javascript
var _recipesState = {
  catalog: [], catalogLoaded: false, list: [], total: 0,
  currentRecipeId: null, currentRecipe: null,
  currentIngredients: [], availability: null, previousStatus: 'draft'
};
```

**Detail open — parallel detail + availability fetch** (admin L8674-8694). Response shape `{ recipe, ingredients }`; availability is best-effort (catch→null):
```javascript
Promise.all([
  fetch(mwUrl + '/api/recipes/' + encodeURIComponent(recipeId), { headers: getRecipesMwHeaders(false) })
    .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); }),
  fetch(mwUrl + '/api/recipes/' + encodeURIComponent(recipeId) + '/availability', { headers: getRecipesMwHeaders(false) })
    .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
]).then(function (results) {
  _recipesState.currentRecipe = results[0].recipe || results[0];
  _recipesState.currentIngredients = (results[0].ingredients || []).slice();
  ...
});
```

**Catalog preload for autocomplete** (admin `loadIngredientCatalogForRecipes` L8496-8523). Note: passes `?include_internal=1` AND requires the API key on the GET because the middleware gates internal items on the key:
```javascript
return fetch(mwUrl + '/api/ingredients?include_internal=1', { headers: headers })  // headers carry X-API-Key
  .then(...).then(function (data) {
    _recipesState.catalog = data.items || data.ingredients || data || [];
    _recipesState.catalogLoaded = true;
  });
```

**Ingredient autocomplete** (admin L8866-8930): `filterIngredientCatalog` (name/sku substring, slice 6) → `showIngredientAutocomplete` builds a `.ing-autocomplete-drop` with `mousedown`+`e.preventDefault()` (so blur doesn't fire first) → `selectIngredientFromAutocomplete` copies `item_id`/`item_name`/`sku`/`unit`/`purchase_rate`/`rate` into `currentIngredients[idx]`. Re-skin the dropdown for touch; keep the `mousedown` (not `click`) selection so it survives blur.

**Inline activation guardrail (D-06)** (admin `canActivateRecipe` L8984-8993 + enforcement in `saveRecipe` L8027-8034). Surface as a disabled Activate control with a hint; the rule:
```javascript
function canActivateRecipe(formData, ingredients) {
  var lockedPrice = parseFloat(formData && formData.locked_price);
  if (!lockedPrice || isNaN(lockedPrice) || lockedPrice <= 0)
    return { ok: false, reason: 'Set a valid locked price before activating this recipe.' };
  if (!ingredients || ingredients.length === 0)
    return { ok: false, reason: 'Add at least one ingredient before activating this recipe.' };
  return { ok: true };
}
```

**Save (POST create / PUT update)** (admin L8996-9070). The full `formData` payload shape and the create-vs-update branch:
```javascript
var formData = {
  name, style, description, batch_size_l, abv, ibu, colour_srm,
  pricing_mode, locked_price, service_fee, materials_fee, status,
  ingredients: _recipesState.currentIngredients.filter(function (ing) { return ing.item_id && ing.quantity > 0; }),
  ingredient_count: <count of valid ingredients>
};
var method = recipeId ? 'PUT' : 'POST';
var url = recipeId ? mwUrl + '/api/recipes/' + encodeURIComponent(recipeId) : mwUrl + '/api/recipes';
fetch(url, { method: method, headers: getRecipesMwHeaders(true), body: JSON.stringify(formData) })
  .then(function (r) { return r.json(); })
  .then(function (data) { if (!data.ok && data.error) throw new Error(data.error); ... });
```
- POST success → `{ ok:true, recipe_id }` (HTTP 201). Re-open with the new id.
- PUT success → `{ ok:true }`.
- Guardrail/validation failure → HTTP 422 `{ error }`.
- `getRecipesMwHeaders(true)` MUST attach `X-API-Key` for writes (see Shared Patterns).

**Discretion notes for the planner:**
- BeerXML import (admin L8200-8216, `validateAndReadBeerXML`) is admin-only enrichment — **out of scope** for this phase (CONTEXT lists field parity, not BeerXML). Do not port unless asked.
- Admin's `duplicateRecipe` (L9099-9120) is optional; CONTEXT D-03 scope is browse/view/create/edit/activate/delete. Treat duplicate as discretionary.
- The cost/retail columns + availability dots (admin L8757-8804) depend on catalog + `/availability`. Keep the grouped render (next section) and the totals footer (L8807-8817).

---

### `js/brewpad.js` — Recipe detail grouped ingredient view (transform)

**Analog:** `js/lib/recipe-grouping.js` `groupRecipeIngredients(ingredients)` (L88) — **already script-loaded on `brewpad.html` L20**. Admin's exact usage at `js/admin.js` L8770-8804:
```javascript
var groups = (typeof groupRecipeIngredients === 'function')
  ? groupRecipeIngredients(ingredients)
  : [{ label: '', count: ingredients.length, items: ingredients }];   // cold-cache fallback
groups.forEach(function (group) {
  if (group.label)
    html += '<tr class="recipes-ing-group"><td colspan="8">' + escapeHTML(group.label) + ' (' + group.count + ')</td></tr>';
  group.items.forEach(function (ing) {
    var idx = ingredients.indexOf(ing);   // CRITICAL: map back to ORIGINAL array index (grouping reorders)
    ... data-ing-idx="' + idx + '" ...
  });
});
```
- Helper returns `[{ label, count, items }]`. Empty input → `[]`. No `cf_type`/`cf_subcategory` on any ingredient → one flat group `{ label:'', ... }` (graceful).
- **Load-bearing gotcha to copy:** because the helper reorders ingredients into sections, `data-ing-idx` must be `ingredients.indexOf(ing)` (original position), NOT the loop index — otherwise edit/remove read-back targets the wrong row.
- The server already enriches `cf_type`/`cf_subcategory`/`display_group` on `GET /api/recipes/:id` (recipes.js `enrichIngredientGroups` L93-119), so BrewPad gets grouping fields for free.

---

### `js/brewpad.js` + `brewpad.html` — Recipes tab wiring (tab wiring, event-driven)

**Analog:** `js/brewpad.js` `switchTab` (L1489-1525) + DOMContentLoaded tab loop (L7221-7230).

**Add `'recipes'` to the panels array** (L1501) and a load branch (mirror the `tasks`/`measurements` branches L1520-1523):
```javascript
var panels = ['dashboard', 'batches', 'tasks', 'measurements', 'recipes'];   // add 'recipes'
...
} else if (tab === 'recipes') {
  initRecipesTab();   // lazy-load catalog + list on first visit (mirror admin triggerRecipesLoad L8482)
}
```
The tab loop at L7221 already wires every `.bp-tab` → `switchTab(data-tab)`, so the new button is auto-wired; just add a lazy-load guard like admin's `_recipesDataLoaded`/`_recipesDataLoading` (admin L8454-8487) so the catalog + list fetch once.

**Tab button markup** (`brewpad.html` L113-128 pattern — add as 5th button):
```html
<button type="button" class="bp-tab" data-tab="recipes" aria-label="Recipes" aria-pressed="false">
  <span class="bp-tab-icon" aria-hidden="true">&#128221;</span>
  <span class="bp-tab-label">Recipes</span>
</button>
```

**Panel host markup** (`brewpad.html` L96-107 pattern — add inside `.bp-panels`, `display:none` like non-default panels):
```html
<div id="bp-panel-recipes" class="bp-panel" style="display:none;">
  <div class="bp-panel-inner" id="bp-recipes-inner" aria-live="polite" aria-atomic="false">
    <div class="bp-skeleton-block"></div>
  </div>
</div>
```
Port the inner list/detail markup from `admin.html` L444-586 (status filter, table, editor form grid, ingredient table, action buttons), re-skinned with `bp-` classes. `recipe-grouping.js` is already loaded (L20) — no new `<script>` needed.

---

### `js/brewpad.js` — Delete via confirm-sheet (D-04, confirm-sheet usage)

**Analog:** `js/brewpad.js` `showConfirmSheet(message, okLabel, okCls, onOk)` (L2630-2665). This is the existing destructive-action sheet — use it instead of admin's `window.confirm` (admin `deleteRecipe` L8077 uses `window.confirm`, which D-04 explicitly forbids on the shared iPad).
```javascript
showConfirmSheet(
  'Delete recipe "' + name + '"? This cannot be undone.',
  'Delete', 'btn--danger',
  function () {
    fetch(mwUrl() + '/api/recipes/' + encodeURIComponent(recipeId), {
      method: 'DELETE',
      headers: getRecipesMwHeaders(true)   // DELETE is a write → needs X-API-Key
    })
      .then(function (r) { return r.json(); })
      .then(function (data) { if (!data.ok && data.error) throw new Error(data.error); ... })
      .catch(function () { showToast('Could not delete recipe. Please try again.', 'error'); });
  }
);
```
- `showConfirmSheet` already wires OK/Cancel/backdrop and self-cleans listeners on hide. Pass the destructive button class as `okCls`.
- DELETE success → `{ ok:true }`; refresh list + return to list view.

---

## Shared Patterns

### Authenticated middleware writes (X-API-Key)
**Source:** `js/brewpad.js` `mwUrl` (L1099), `mwApiKey` (L1103), `postBottlingInvite` (L1110-1114); `js/admin.js` `getRecipesMwHeaders` (L8462-8468).
**Apply to:** create (POST), update (PUT), delete (DELETE), and any cache-bust POST.

BrewPad's existing write idiom uses lowercase `x-api-key`:
```javascript
fetch(mwUrl() + '/api/...', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-api-key': mwApiKey() },
  body: JSON.stringify(data)
});
```
Admin's recipe helper uses `X-API-Key` (case-insensitive — HTTP headers are case-insensitive, both work). For consistency in the ported code, define a BrewPad `getRecipesMwHeaders(mutating)` that adds the key only when `mutating === true` (admin L8462-8468):
```javascript
function getRecipesMwHeaders(mutating) {
  var h = { 'Content-Type': 'application/json' };
  if (mutating && mwApiKey()) h['x-api-key'] = mwApiKey();
  return h;
}
```
- Reads (`GET /api/recipes`, `/api/recipes/:id`, `/availability`) need **no** key — EXCEPT `GET /api/ingredients?include_internal=1`, which needs the key to return Internal-Only items (admin L8499-8505).
- **Offline behaviour (discretion):** writes require connectivity. The `fetch` rejects offline → the `.catch` shows a toast. Surface a clear "you're offline" message; do not queue.

### Cache invalidation after write
**Source:** `zoho-middleware/routes/recipes.js` `bustRecipeCache` (L63-73) — POST/PUT/DELETE already bust server-side. Client-side, `POST /api/recipes/bust-cache` (L451-459) is available if a manual refresh is needed.
**Apply to:** after any write, re-`loadRecipeList()` (admin L9062, L9091). The server already invalidates its own cache on write, so a list re-fetch is usually sufficient; only call `/api/recipes/bust-cache` if the list still shows stale data.

### Toast notifications
**Source:** `js/brewpad.js` `showToast(message, type, opts)` (L707). Use BrewPad's toast (not admin's `showToast`) for all success/error feedback — `showToast('Recipe saved.', 'success')`, `showToast('Could not save recipe. Please try again.', 'error')`.

### escapeHTML on all dynamic HTML
**Source:** `js/lib/utils.js` `escapeHTML` (already loaded on `brewpad.html` L18 and used throughout `brewpad.js`).
**Apply to:** every interpolated recipe name, style, status, ingredient name, group label, SKU, and error message in `innerHTML` strings (see admin L8588-8606, L8775, L8793).

---

## Middleware Call-Site Contracts (REUSED, do not modify)

`zoho-middleware/routes/recipes.js` ships unchanged. BrewPad client must honor:

| Endpoint | Method | Auth | Request | Success | Failure |
|----------|--------|------|---------|---------|---------|
| `/api/recipes?status=` | GET | none | `status=all\|draft\|active\|inactive` | `200 {recipes:[],total}` | `502 {error}` |
| `/api/recipes/:id` | GET | none | — | `200 {recipe,ingredients}` (ingredients carry `cf_type`/`cf_subcategory`/`display_group`) | `404 {error}` / `502` |
| `/api/recipes/:id/availability` | GET | none | — | `200 {recipe_id,summary,ingredients[]}` (summary: `all_ok`/`some_low`/`cannot_brew`/`unknown`) | `404`/`502` |
| `/api/recipes` | POST | **x-api-key** | full recipe `formData` | `201 {ok:true,recipe_id}` | `422 {error}` / `502` |
| `/api/recipes/:id` | PUT | **x-api-key** | `formData` (server re-checks `locked_price>0` & `ingredient_count>=1` when `status==='active'`) | `200 {ok:true}` | `422 {error}` / `502` |
| `/api/recipes/:id` | DELETE | **x-api-key** | — | `200 {ok:true}` | `422`/`502` |
| `/api/recipes/bust-cache` | POST | **x-api-key** | — | `200 {ok:true}` | `500 {error}` |
| `/api/ingredients?include_internal=1` | GET | **x-api-key** (for internal items) | — | `200 {items:[]}` (catalog for autocomplete) | non-2xx |

**Server authority reminder (D-06):** the inline Activate guardrail is UX only. The server re-enforces `locked_price > 0` AND `ingredient_count >= 1` on `PUT` when `status==='active'` (recipes.js L399-412) and returns 422. The client must read `ingredient_count` into the PUT payload (admin L9016-9018) or the server guardrail can't see it.

---

## No Analog Found

None. Every new behaviour maps to an existing admin function, an existing BrewPad helper, or the loaded grouping helper. The only genuinely BrewPad-new logic is **name search/filter on the browse list** (ROADMAP requires it; admin has only a status `<select>`) — but it reuses admin's catalog-filter substring idiom (`js/admin.js` L8866-8873) applied to `_recipesState.list`.

## Metadata

**Analog search scope:** `js/admin.js` (recipe builder L8443-9217), `js/brewpad.js` (tab/panel/auth/confirm-sheet/toast), `js/lib/recipe-grouping.js`, `brewpad.html`, `admin.html` (recipe panel markup), `zoho-middleware/routes/recipes.js`.
**Files scanned:** 6
**Pattern extraction date:** 2026-06-19
