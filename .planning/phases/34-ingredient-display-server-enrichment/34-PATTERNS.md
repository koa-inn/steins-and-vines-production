# Phase 34: Ingredient Display & Server Enrichment - Pattern Map

**Mapped:** 2026-06-19
**Files analyzed:** 8 (3 modify-server, 1 create-helper, 1 promote-constant, 3 modify-client) + 2 test files
**Analogs found:** 8 / 8 (all have strong in-repo analogs)

> All paths are repo-relative to `/Users/koa/dev/steins-and-vines-website`.
> ES5 / `var` everywhere. Frontend `js/modules/*` concat into `js/main.js` via `npm run build` — never edit `main.js`/`main.min.js`. `js/lib/*` and the standalone pages (`admin.js`/`kiosk.js`/`brewpad.js`) are loaded directly via `<script>` tags, NOT concatenated.

---

## CRITICAL DATA-SHAPE FINDING (read before planning the server change)

Verified against the live `zoho-middleware/ingredients-cache.json`:

- **`cf_type` IS a top-level field** on each cached ingredient entry (e.g. `item.cf_type === 'Equipment'`). Written by `catalog.js` (kiosk path L851: `cf_type: item.cf_type || ''`).
- **`cf_subcategory` is NOT a top-level field** on cache entries. It lives **only inside the `custom_fields[]` array** as the object whose `api_name === 'cf_subcategory'` (use `.value` or `.value_formatted`). The search-overlay reads `item.cf_subcategory` because the **public products feed** flattens it — the **ingredients cache the recipe route uses does not.**

Therefore the recipes.js enrichment must read `cf_type` directly off the catalog entry but **dig `cf_subcategory` out of `custom_fields`**. Suggested extraction helper (matches the existing Millable flatten idiom in `catalog.js` L551–556):

```javascript
function readCF(entry, apiName) {
  var cfs = (entry && entry.custom_fields) || [];
  for (var i = 0; i < cfs.length; i++) {
    if (cfs[i] && cfs[i].api_name === apiName) {
      return cfs[i].value_formatted || cfs[i].value || '';
    }
  }
  return '';
}
// cf_type: entry.cf_type || readCF(entry, 'cf_type') || ''
// cf_subcategory: readCF(entry, 'cf_subcategory') || ''
```

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `zoho-middleware/routes/recipes.js` (modify enrich loops) | route + service | request-response / transform | self (`enrichWithComputedPrice` L75, `enrichListPrices` L112) | exact (in-place) |
| `js/lib/recipe-grouping.js` (new shared helper) | utility | transform | `js/modules/17-search-overlay.js` §`groupResultsByCategory` (L85–110) | exact |
| `js/lib/constants.js` (add `CATEGORY_DISPLAY_NAMES`) | config | n/a | `js/modules/17-search-overlay.js` (L54–73) → promote | exact (move) |
| `js/admin.js` §`renderIngredientRows` (L8745) | component | transform / DOM render | self (current flat-table render) | exact (in-place) |
| `js/brewpad.js` §`buildRecipeIngredientTable` (L3024) | component | transform / DOM render | self (current flat-table render) | exact (in-place) |
| `js/kiosk.js` recipe ingredient render (L1205–1261) | component | transform / DOM render | self (current `<ul>` render) | exact (in-place) |
| `zoho-middleware/__tests__/recipes.test.js` (add enrich tests) | test | n/a | self + `recipes.test.js` mock harness (L1–70) | exact |
| `tests/frontend/recipe-grouping.test.js` (new) | test | n/a | `tests/frontend/17-search-overlay.test.js` (L1–70) | exact |

**Read-for-pattern / constraint-check (NOT modified):**
- `zoho-middleware/routes/catalog.js` L527–559, L840–853, L990–1010 — metadata source
- `zoho-middleware/routes/pos-recipe.js` L60–95, L195–225 — money-path shape constraint (D-08)

---

## Pattern Assignments

### `zoho-middleware/routes/recipes.js` (route, transform) — server enrichment (RDISP-02, D-08)

**Analog:** itself — the two existing catalog-match loops. Add the additive fields **inside** these loops with zero extra catalog round-trips.

**Imports/setup already present** (L1–17) — `cache`, `C` (constants), `fs`, file-cache fallback path. No new imports needed.

**Hook point A — detail endpoint** `enrichWithComputedPrice` (L77–90). The loop already builds the `map` and iterates ingredients:
```javascript
return cache.get(C.CACHE_KEYS.INGREDIENTS).then(function (catalog) {
  if (!catalog || !Array.isArray(catalog)) return;
  var map = {};
  catalog.forEach(function (item) { if (item && item.item_id) map[item.item_id] = item; });
  var total = 0;
  (ingredients || []).forEach(function (ing) {
    var entry = map[ing.item_id];
    if (entry) {
      ing.rate = Number(entry.rate) || 0;
      ing.tax_percentage = Number(entry.tax_percentage) || 0;
      ing.tax_id = entry.sales_tax_rule_id || entry.tax_id || '';
      total += (Number(ing.quantity) || 0) * ing.rate;
      // ADD additive enrichment here (D-08): ing.cf_type / ing.cf_subcategory / ing.display_group
    }
  });
```
**Constraint:** `enrichWithComputedPrice` only runs for `pricing_mode === 'dynamic'` (L76 early-return). Recipe detail enrichment for grouping must NOT be gated behind that — either move the catalog-match enrichment ahead of the `dynamic` guard, or add a separate always-run pass over `result.ingredients` in the `GET /api/recipes/:id` handler (L237–238) so locked-price recipes also get grouped. Flag this for the planner.

**Hook point B — list-detail loop** `enrichListPrices` (L162–166) iterates `detail.ingredients` and already has the cold-cache file fallback (L122–131) — mirror that fallback for grouping (D-07). NOTE: the list endpoint enriches per-recipe `detail.ingredients` but the list response only returns the recipe summary, not ingredients. Grouping enrichment primarily matters on the **detail** endpoint (`GET /api/recipes/:id`); confirm whether the list view ever renders ingredients before enriching there.

**Cold-cache fallback pattern to copy** (L122–131) — already returns gracefully when catalog is cold; the client falls back to a flat list (D-07), so the server can simply leave the additive fields unset.

**Shape constraint (D-08):** additive fields only. Do NOT restructure `ingredients` into a nested object — `pos-recipe.js` (below) and `lib/pricing.js` consume the flat array.

---

### `zoho-middleware/routes/pos-recipe.js` — CONSTRAINT CHECK ONLY (do not modify)

Confirms D-08. Both the sale path (L66–88) and the collect path (L203–225) do:
```javascript
var ingredients = data.data.ingredients || [];
...
var catalogMap = {};
ingredientCatalog.forEach(function (item) {
  if (item && item.item_id) catalogMap[item.item_id] = item;
});
```
They iterate the flat `ingredients` array by `item_id` for server-authoritative money + Zoho line items + `recipe_snapshot`. Adding extra keys to each ingredient object is safe (these loops read specific fields, never re-serialize a fixed schema). **Any restructuring of the array would break this — keep enrichment additive.**

---

### `zoho-middleware/routes/catalog.js` — READ-FOR-PATTERN (metadata source, do not modify)

How metadata reaches the cache:
- **Ingredients refresh** L546–557: each item gets `item.custom_fields = detail.custom_fields || []` from the bulk-detail fetch, then the Millable CF is flattened (L551–556) — **this is the exact idiom to copy** for pulling `cf_subcategory` out of `custom_fields`.
- **Kiosk products** L851: `cf_type: item.cf_type || ''` (top-level, from list endpoint — no enrichment needed).
- **Snapshot ingredients** L998–1010 + `shapeIngredient`: same filter using `item.cf_type`.

Confirms: `cf_type` is reliably top-level on cache entries; `cf_subcategory` must be read from `custom_fields[]` (see CRITICAL FINDING above).

---

### `js/lib/recipe-grouping.js` (utility, transform) — NEW shared grouping helper (D-01, D-02, D-03, D-09)

**Analog:** `js/modules/17-search-overlay.js` §`groupResultsByCategory` (L85–110). Copy its grouping skeleton; replace count-descending sort with a fixed brewing-process order (D-03) and add the hybrid nest (D-01/D-02) + per-group counts (D-11) + "Other" last (D-06).

**File header / module-export idiom to copy** (from `js/lib/utils.js` L1–19 and `js/lib/constants.js` L43–50):
```javascript
// ===== Steins & Vines — Recipe Ingredient Grouping =====
// Shared helper consumed by admin, kiosk, and BrewPad recipe views (D-09).
// Load AFTER js/lib/constants.js (needs CATEGORY_DISPLAY_NAMES) and js/lib/utils.js.

// ... function groupRecipeIngredients(ingredients) { ... }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { groupRecipeIngredients: groupRecipeIngredients /*, SECTION_ORDER */ };
}
```

**Grouping skeleton to copy** (search-overlay L85–110) — note the `CATEGORY_DISPLAY_NAMES[raw] || raw` label collapse and the build-then-emit array shape:
```javascript
var groups = {};
fuseResults.forEach(function (r) {
  var item = r.item || r;
  var rawCat = ...;
  var displayCat = CATEGORY_DISPLAY_NAMES[rawCat] || rawCat;
  if (!groups[displayCat]) groups[displayCat] = [];
  groups[displayCat].push(item);
});
return sortedKeys.map(function (cat) {
  return { category: cat, items: groups[cat], ... };
});
```

**Required deltas from the analog (the actual phase logic):**
1. **Hybrid nest (D-01/D-02):** top-level bucket by `cf_type`; within a `cf_type`, sub-bucket by `cf_subcategory` ONLY when 2+ distinct subcategories are present, else render flat.
2. **Fixed section order (D-03):** define a `SECTION_ORDER` array once in this file — Grain → Hops → Yeast → Additive (inside Ingredient), then Packaging → Equipment → Cleaning/Sanitization. "Other" bucket (D-06) always last. Do NOT sort by count like the analog does (replace L103–106).
3. **Within-section order (D-05):** preserve recipe-entry order — iterate `ingredients` in order and push into buckets; do not re-sort items.
4. **Counts (D-11):** each emitted group carries `count: items.length`.
5. **Unknown bucket (D-06):** missing/unresolvable `cf_type`/`cf_subcategory` → "Other" group, emitted last; never drop.
6. **Cold-cache fallback (D-07):** if ingredients lack `cf_type`/`cf_subcategory` (server couldn't enrich), return a single flat group rather than erroring — let each surface render the existing flat list.

**Label map dependency:** consume the promoted `CATEGORY_DISPLAY_NAMES` (next section). Extend it for any new `cf_type` values not yet mapped (`Ingredient`, `Cleaning/Sanitization`).

---

### `js/lib/constants.js` (config) — PROMOTE `CATEGORY_DISPLAY_NAMES` (D-04)

**Analog/source:** `js/modules/17-search-overlay.js` L54–73 — move this map verbatim into `js/lib/constants.js`, then `require`/reference it in both the search-overlay module and the new grouping helper.

**Existing constants.js export pattern to extend** (L43–50):
```javascript
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CART_KEYS:     CART_KEYS,
    ITEM_TYPES:    ITEM_TYPES,
    PRODUCT_TABS:  PRODUCT_TABS,
    KIT_CATEGORIES: KIT_CATEGORIES,
    CATEGORY_DISPLAY_NAMES: CATEGORY_DISPLAY_NAMES   // ADD
  };
}
```
**Load-order note:** `constants.js` is loaded first on every standalone page (`admin.html` L938, `kiosk.html` L15, `brewpad.html` L17). The grouping helper + search-overlay both reference the global `CATEGORY_DISPLAY_NAMES` (no `require` in-browser; the `module.exports` block is for Jest only). Promote it but KEEP search-overlay working — since search-overlay is a concatenated module loaded after `constants.js`, it can drop its local copy and use the global. Verify the search-overlay Jest test (`17-search-overlay.test.js`) still passes after the move (it currently relies on the module-local copy — may need the test to also require constants, or keep a fallback).

---

### `js/admin.js` §`renderIngredientRows` (component, DOM render) — grouped table sections (RDISP-01, D-10, D-11)

**Analog:** itself (L8745–8809). Current render is a single flat `<tbody>` of `recipes-ing-row` rows with an editable autocomplete input per row. **This is the recipe EDIT view** (has qty inputs, remove buttons, autocomplete). Phase 34 is display-only — confirm with planner whether grouping applies to this editable view or a separate read-only recipe detail. The grouping helper output drives section header `<tr>`s; iterate `groupRecipeIngredients(ingredients)`, emit a header row per group (`"Label (count)"`, D-11) then the existing per-ingredient `<tr>` build (L780–791) unchanged.

**Native styling (D-10):** keep the existing `recipes-ing-row` / `ing-*` table cells and the totals `<tfoot>` (L795–805); only insert group-header rows. Preserve `attachIngredientRowListeners()` (L808) — group headers must not break the `data-ing-idx` indexing the edit logic relies on (L8780 uses `idx` = position in the original array; keep a flat counter across groups).

**escapeHTML** is already in scope (used L8782 etc.) from `js/lib/utils.js`.

---

### `js/brewpad.js` §`buildRecipeIngredientTable` (component, DOM render) — grouped table (RDISP-01, D-10, D-11)

**Analog:** itself (L3024–3043). Returns an HTML string for a `bp-recipe-ing-table`. Wrap the existing per-row loop (L3030–3040) in grouping: iterate `groupRecipeIngredients(ingredients)`, emit a group-header row (spanning the 3 columns) with `"Label (count)"`, then the existing `<tr>` build per ingredient unchanged.

**Empty + flat-fallback guard already present** (L3025): `if (!ingredients || !ingredients.length) return '<p ...>No ingredients listed.</p>';` — extend so that when the grouping helper returns a single "flat" group (cold cache, D-07) it renders exactly today's flat table.

**`editable` branch** (L3033–3037) uses `data-idx` tied to `readIngredientTableEdits` (L3045–3057, reads `data-idx` to map back to `snapIngredients[idx]`). As with admin, keep a flat running index across groups so the edit-readback stays correct. `escapeHTML` is in scope (IIFE, loaded via `js/lib/utils.js` script tag).

---

### `js/kiosk.js` recipe ingredient render (component, DOM render) — grouped list (RDISP-01, D-10, D-11)

**Analog:** itself (L1205–1261). Two near-identical render blocks — the cached `_fetchedDetail` path (L1211–1218) and the fetch path (L1232–1240) — both build `<strong>Ingredients:</strong><ul>...<li>name — qty unit</li></ul>`. Replace BOTH with a call to a small local render that iterates `groupRecipeIngredients(...)`, emitting a sub-heading + `<ul>` per group with `"Label (count)"`.

**Native styling (D-10):** keep the kiosk `<ul>`/`<li>` idiom and inline styles; just add per-group headings. `escapeHTML` is in scope (`js/lib/utils.js` script tag, `kiosk.html` L16).

**DRY note:** these two blocks are duplicated today — extract one `kioskRenderRecipeIngredients(ingredients, el)` helper and call it from both paths.

---

## Shared Patterns

### Module export for Jest (frontend pure helpers)
**Source:** `js/lib/utils.js` L17–19, `js/lib/constants.js` L43–50, `js/modules/17-search-overlay.js` L~280 (exports `groupResultsByCategory`).
**Apply to:** new `js/lib/recipe-grouping.js`, promoted `CATEGORY_DISPLAY_NAMES`.
```javascript
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { groupRecipeIngredients: groupRecipeIngredients };
}
```

### Catalog-match loop + cold-cache fallback (server)
**Source:** `zoho-middleware/routes/recipes.js` L77–90 (map build), L122–131 (file-cache fallback when Redis cold).
**Apply to:** the enrichment additions in both `enrichWithComputedPrice` and the detail handler. Reuse the exact `map[item.item_id]` lookup and the `fs.readFileSync(INGREDIENTS_FILE_CACHE)` fallback — do not introduce a new catalog fetch.

### Custom-field flatten (server)
**Source:** `zoho-middleware/routes/catalog.js` L551–556 (Millable flatten from `custom_fields`).
**Apply to:** extracting `cf_subcategory` from `custom_fields` in recipes.js (see CRITICAL FINDING / `readCF` helper above).

### Label collapse via `CATEGORY_DISPLAY_NAMES`
**Source:** `js/modules/17-search-overlay.js` L92 — `var displayCat = CATEGORY_DISPLAY_NAMES[rawCat] || rawCat;`
**Apply to:** every section header in the grouping helper, so admin/kiosk/BrewPad show the same customer-facing labels.

---

## Test Patterns

### Frontend grouping helper — `tests/frontend/recipe-grouping.test.js` (NEW)
**Analog:** `tests/frontend/17-search-overlay.test.js` L1–70. Copy structure exactly:
```javascript
var mod = require('../../js/lib/recipe-grouping.js');
describe('groupRecipeIngredients', function () {
  test('returns empty array for empty input', ...);
  test('groups by cf_type top-level', ...);
  test('nests by cf_subcategory only when 2+ distinct subcats (D-02)', ...);
  test('emits sections in brewing-process order (D-03)', ...);
  test('preserves recipe-entry order within section (D-05)', ...);
  test('unknown type -> Other section last (D-06)', ...);
  test('cold-cache (no cf fields) -> single flat group (D-07)', ...);
  test('group carries per-item count (D-11)', ...);
});
```
Note: if `recipe-grouping.js` reads the global `CATEGORY_DISPLAY_NAMES`, the test must either `require('../../js/lib/constants.js')` first to populate it, or the helper should accept/import the map. Decide and keep the helper unit-testable in node (no DOM).

### Middleware enrichment — `zoho-middleware/__tests__/recipes.test.js` (ADD cases)
**Analog:** `recipes.test.js` L1–70 — the express/axios/cache/constants Jest-mock harness + `resetAndLoadRecipes()` + `callHandler('GET', '/api/recipes/:id', req)`. Add cases:
- Catalog cache warm → each ingredient gains `cf_type`/`cf_subcategory`/display-group, array length + existing fields unchanged (D-08 additive-only assertion).
- `cf_subcategory` correctly pulled from `entry.custom_fields[]` (mock an entry with a `cf_subcategory` custom field).
- Cold cache → enrichment fields absent, ingredients still returned unchanged (D-07).
- Locked-price recipe still gets grouping fields (verify enrichment isn't gated behind `pricing_mode === 'dynamic'`).
Set `cache.get` mock to return a catalog array (mirror existing tests' `cache.get.mockResolvedValueOnce`).

---

## No Analog Found

None. Every file has a strong in-repo analog (mostly itself or the search-overlay grouping helper).

## Metadata

**Analog search scope:** `zoho-middleware/routes/` (recipes, catalog, pos-recipe), `js/lib/`, `js/modules/17-search-overlay.js`, `js/admin.js`, `js/brewpad.js`, `js/kiosk.js`, `tests/frontend/`, `zoho-middleware/__tests__/`, live `ingredients-cache.json`.
**Files scanned:** ~14
**Pattern extraction date:** 2026-06-19
