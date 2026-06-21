# Phase 36: Cross-Surface Selection & Recipe Modification — Pattern Map

**Mapped:** 2026-06-20
**Files analyzed:** 9 new/modified files
**Analogs found:** 9 / 9

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `admin.html` | markup | request-response | `admin.html` lines 626–659 (Phase 35 `#kiosk-recipe-prompt`) | exact (extend) |
| `kiosk.html` | markup | request-response | `admin.html` lines 626–659 (Phase 35 `#kiosk-recipe-prompt`) | exact (port) |
| `js/admin.js` | component/controller | request-response | `js/admin.js` lines 9800–11560 (kiosk IIFE Phase 35 additions) | exact (extend) |
| `js/kiosk.js` | component/controller | request-response | `js/admin.js` lines 10960–11315 (Phase 35 quote pattern) | role-match (port) |
| `js/brewpad.js` | component/controller | event-driven | `js/brewpad.js` lines 3739–3838 (`openRecipeAttachPanel`) | exact (extend) |
| `zoho-middleware/routes/pos-recipe.js` | route/controller | request-response | `zoho-middleware/routes/pos-recipe.js` lines 39–138 (`computeRecipeQuote`) | exact (extend) |
| `zoho-middleware/lib/recipe-scaling.js` | utility | transform | `zoho-middleware/lib/recipe-scaling.js` (whole file, pure helpers) | exact (extend) |
| `zoho-middleware/lib/brewpad-integration.js` | service | event-driven | `zoho-middleware/lib/brewpad-integration.js` lines 368–408 (`detectRecipeSale`) | exact (extend) |
| `zoho-middleware/routes/recipes.js` | route | CRUD | `zoho-middleware/routes/recipes.js` lines 376–450 (POST + PUT guardrail) | exact (extend) |

---

## Pattern Assignments

### `admin.html` (markup, extend `#kiosk-recipe-prompt`)

**Analog:** `admin.html` lines 626–659

**Existing Phase 35 markup (LOCKED — copy verbatim, insert after):**
```html
<!-- admin.html lines 626–659: the LOCKED Phase 35 prompt structure -->
<div id="kiosk-recipe-prompt" style="display:none;">
  <button type="button" class="btn-secondary" id="kiosk-recipe-back">&#8592; Back</button>
  <div class="kiosk-recipe-selected-name" id="kiosk-recipe-selected-name"></div>
  <div id="kiosk-recipe-summary"></div>
  <!-- SCALE-01: Target volume input — Phase 35 -->
  <div id="kiosk-recipe-volume-wrap" style="display:none;">
    <label class="kiosk-volume-label">
      Target volume (L):
      <input type="number" id="kiosk-target-volume" class="kiosk-volume-input"
             min="0.5" step="0.5" inputmode="decimal" />
    </label>
    <div id="kiosk-scale-factor-readout" class="kiosk-scale-readout"></div>
  </div>
  <!-- INSERT #kiosk-recipe-modify-wrap HERE (Phase 36 — see below) -->
  <!-- SCALE-05: Stock conflict block — Phase 35 -->
  <div id="kiosk-stock-conflict" style="display:none;">
    <div class="kiosk-stock-conflict-msg"></div>
    <button type="button" class="btn-secondary" id="kiosk-stock-override-btn">
      Manager Override — Proceed Anyway
    </button>
  </div>
  <div id="kiosk-avail-banner"></div>
  <!-- sale-type buttons, milling toggle, Add-to-Cart button follow -->
</div>
```

**New markup to insert between `#kiosk-recipe-volume-wrap` and `#kiosk-stock-conflict` (Phase 36):**
```html
<!-- Phase 36: Ingredient modification panel (MOD-01) -->
<div id="kiosk-recipe-modify-wrap" style="display:none;">
  <button type="button" class="btn-secondary" id="kiosk-modify-toggle">Modify Ingredients</button>
  <div id="kiosk-modify-panel" style="display:none;">
    <table class="kiosk-recipe-modify-table">
      <tbody id="kiosk-modify-tbody"></tbody>
    </table>
    <button type="button" class="btn-secondary" id="kiosk-modify-add-row">+ Add Ingredient</button>
  </div>
  <div id="kiosk-recipe-price-preview" style="display:none;"></div>
  <div id="kiosk-locked-price-notice" style="display:none;font-size:11px;color:var(--ink-tertiary);margin-top:4px;">
    Adding ingredients increases the price. Removing ingredients does not reduce it.
  </div>
</div>
<!-- After #kiosk-stock-conflict and #kiosk-avail-banner: -->
<div id="kiosk-save-as-new-wrap" style="display:none;">
  <button type="button" class="admin-btn-sm" id="kiosk-save-as-new-btn">Save as new recipe</button>
  <div id="kiosk-save-as-new-prompt" style="display:none;">
    <input type="text" id="kiosk-new-recipe-name" class="admin-input" placeholder="e.g. My Custom Pale Ale" />
    <button type="button" class="btn" id="kiosk-save-draft-btn">Save Draft</button>
    <button type="button" class="btn-secondary" id="kiosk-save-cancel-btn">Cancel</button>
  </div>
  <div id="kiosk-save-as-new-feedback"></div>
</div>
```

---

### `kiosk.html` (markup, port Phase 35 control + add Phase 36 panels)

**Analog:** `admin.html` lines 626–659 (port identical structure)

**Current kiosk.html `#kiosk-recipe-prompt` (lines 108–125) is MISSING the Phase 35 control.** Port the full Phase 35 markup from admin.html, then add Phase 36 panels using identical IDs and classes:

```html
<!-- kiosk.html CURRENT (lines 108–125) — lacks Phase 35 volume control -->
<div id="kiosk-recipe-prompt" style="display:none;">
  <button type="button" class="btn-secondary" id="kiosk-recipe-back">&#8592; Back</button>
  <div class="kiosk-recipe-selected-name" id="kiosk-recipe-selected-name"></div>
  <div id="kiosk-recipe-summary"></div>
  <div id="kiosk-avail-banner"></div>
  <!-- sale-type buttons follow -->
</div>
```

**Replace with (identical IDs/classes to admin.html, plus iOS zoom guard on inputs):**
```html
<div id="kiosk-recipe-prompt" style="display:none;">
  <button type="button" class="btn-secondary" id="kiosk-recipe-back">&#8592; Back</button>
  <div class="kiosk-recipe-selected-name" id="kiosk-recipe-selected-name"></div>
  <div id="kiosk-recipe-summary"></div>
  <!-- PORT from admin.html: Phase 35 volume control -->
  <div id="kiosk-recipe-volume-wrap" style="display:none;">
    <label class="kiosk-volume-label">
      Target volume (L):
      <input type="number" id="kiosk-target-volume" class="kiosk-volume-input"
             min="0.5" step="0.5" inputmode="decimal" style="font-size:1rem;" />
    </label>
    <div id="kiosk-scale-factor-readout" class="kiosk-scale-readout"></div>
  </div>
  <!-- Phase 36: Modify panel — same IDs as admin.html -->
  <div id="kiosk-recipe-modify-wrap" style="display:none;">
    <!-- ... same as admin.html; inputs get style="font-size:1rem;" for iOS -->
  </div>
  <!-- PORT from admin.html: Phase 35 stock conflict -->
  <div id="kiosk-stock-conflict" style="display:none;">
    <div class="kiosk-stock-conflict-msg"></div>
    <button type="button" class="btn-secondary" id="kiosk-stock-override-btn">
      Manager Override — Proceed Anyway
    </button>
  </div>
  <div id="kiosk-avail-banner"></div>
  <!-- sale-type buttons, milling toggle, Add-to-Cart button unchanged -->
</div>
```

**Key difference from admin.html:** All `<input>` elements inside `#kiosk-recipe-prompt` on kiosk.html need `style="font-size:1rem;"` (or a CSS class rule) to prevent iOS Safari auto-zoom. The `.admin-input` base is 13px; kiosk inputs must be ≥16px.

---

### `js/admin.js` (component, extend kiosk IIFE for Phase 36)

**Analog:** `js/admin.js` lines 9800–11560 (entire kiosk IIFE)

**State vars pattern** (lines 9806–9810 — add alongside these):
```javascript
// Phase 35 existing:
var _kioskTargetVolumeL = null;   // number: target volume in litres, or null = use base
var _kioskScaleFactor   = 1.0;    // display preview only; server recomputes authoritative value
var _kioskStockOverride = false;  // true when manager override button was clicked
var _kioskQuote = null;           // last successful /api/kiosk/recipe-quote response (35-06)
var _kioskQuoteTimer = null;      // debounce timer for quote fetch (35-06)

// Phase 36 additions — add here:
var _kioskModifiedIngredients = null;  // array of base-quantity ingredients (null = unmodified)
var _kioskModifyPanelOpen = false;     // whether the modify panel has been expanded
```

**Quote-fetch pattern to extend** (lines 10965–10998). `kioskFetchRecipeQuote` must pass `_kioskModifiedIngredients` as an additional query/body param when non-null. Copy the existing pattern:
```javascript
// js/admin.js lines 10965–10998 — EXISTING; extend to include modified_ingredients
function kioskFetchRecipeQuote() {
  if (!_kioskSelectedRecipe || !_kioskSaleType) return;
  var mw = kioskMwUrl();
  var headers = {};
  if (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.MW_API_KEY) {
    headers['x-api-key'] = SHEETS_CONFIG.MW_API_KEY;
  }
  var recipeId = _kioskSelectedRecipe.recipe_id;
  var targetVol = _kioskTargetVolumeL || (Number(_kioskSelectedRecipe.batch_size_l) || null);
  var url = mw + '/api/kiosk/recipe-quote?recipe_id=' + encodeURIComponent(recipeId) +
            '&sale_type=' + encodeURIComponent(_kioskSaleType);
  if (targetVol) url += '&target_volume_l=' + encodeURIComponent(targetVol);
  // Phase 36: pass modified_ingredients if modified
  // (switch to POST or use JSON body if GET query string is too long)
  fetch(url, { headers: headers })
    .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
    .then(function (result) {
      if (result.status === 200 && result.data && result.data.ok &&
          result.data.recipe_id === recipeId) {
        _kioskQuote = result.data;
        kioskUpdateAddToCartButton();
      } else {
        _kioskQuote = null;
        kioskUpdateAddToCartButton();
      }
    })
    .catch(function () {
      _kioskQuote = null;
      kioskUpdateAddToCartButton();
    });
}

function kioskScheduleRecipeQuote() {
  if (_kioskQuoteTimer) clearTimeout(_kioskQuoteTimer);
  _kioskQuoteTimer = setTimeout(kioskFetchRecipeQuote, 350);
}
```

**Volume-control wiring pattern** (lines 11150–11190 — copy verbatim for kiosk.js, prefix same names):
```javascript
// js/admin.js lines 11150–11190 — the Phase 35 volume-control wiring inside kioskShowRecipePrompt
var volWrap     = document.getElementById('kiosk-recipe-volume-wrap');
var volInput    = document.getElementById('kiosk-target-volume');
var factorRdout = document.getElementById('kiosk-scale-factor-readout');
var conflictEl  = document.getElementById('kiosk-stock-conflict');
var baseVol     = Number(recipe.batch_size_l) || 0;

_kioskTargetVolumeL = baseVol > 0 ? baseVol : null;
_kioskScaleFactor   = 1.0;
_kioskStockOverride = false;
if (conflictEl) conflictEl.style.display = 'none';

if (volWrap) volWrap.style.display = '';
if (baseVol > 0) {
  if (volInput) { volInput.value = baseVol; volInput.max = baseVol * 10; volInput.disabled = false; }
  if (factorRdout) factorRdout.textContent = '1.0\xd7 base ' + baseVol.toFixed(1) + ' L';
} else {
  // D-11: no batch_size_l — disable scaling (do NOT silently assume factor 1)
  if (volInput) volInput.disabled = true;
  if (factorRdout) factorRdout.textContent = 'Set batch size (L) on this recipe to enable scaling';
}

if (volInput) {
  volInput.oninput = function () {
    var val = parseFloat(volInput.value) || 0;
    _kioskTargetVolumeL = val > 0 ? val : null;
    var factor = (val > 0 && baseVol > 0) ? val / baseVol : 1;
    _kioskScaleFactor = factor;
    if (factorRdout) {
      factorRdout.textContent = factor.toFixed(2) + '\xd7 base ' + baseVol.toFixed(1) + ' L';
    }
    _kioskStockOverride = false;
    if (conflictEl) conflictEl.style.display = 'none';
    kioskScheduleRecipeQuote();  // re-quote on volume change (35-06)
  };
}
kioskScheduleRecipeQuote();  // initial quote on prompt open (35-06)
```

**Add-to-Cart button update pattern** (lines 11285–11314 — extend `kioskUpdateAddToCartButton` for "(Modified)" suffix):
```javascript
// js/admin.js lines 11285–11314 — EXISTING update logic; Phase 36 extends label
function kioskUpdateAddToCartButton() {
  var addBtn = document.getElementById('kiosk-add-recipe-to-cart');
  if (!addBtn || !_kioskSelectedRecipe || !_kioskSaleType) {
    if (addBtn) addBtn.style.display = 'none';
    return;
  }
  var avail = _kioskRecipeAvailability;
  if (avail && (avail.summary === 'cannot_brew' || avail.summary === 'unknown')) {
    addBtn.style.display = 'none';
    return;
  }
  var price;
  if (_kioskQuote && _kioskQuote.recipe_id === _kioskSelectedRecipe.recipe_id &&
      typeof _kioskQuote.total === 'number' && _kioskQuote.total > 0) {
    price = _kioskQuote.total;
  } else {
    price = kioskRecipePriceForContext(_kioskSelectedRecipe, _kioskSaleType);
  }
  // Phase 36: append "(Modified)" when ingredient list has been changed
  var isModified = Array.isArray(_kioskModifiedIngredients);
  var btnLabel = (price > 0 ? 'Add to Cart — ' + kioskFmt(price) : 'Add to Cart') +
                 (isModified ? ' (Modified)' : '');
  addBtn.textContent = btnLabel;
  addBtn.style.display = '';
}
```

**Ingredient-row modification pattern** (lines 8847–8953 in admin IIFE — these are the recipe-builder functions; Phase 36 creates parallel versions scoped to the modify panel, using the same autocomplete pattern but backed by `_kioskModifiedIngredients`):
```javascript
// admin.js lines 8847–8953 — existing attachIngredientRowListeners / showIngredientAutocomplete
// The modify panel uses the SAME pattern:
//   - tbody.querySelectorAll('.kiosk-modify-row') instead of '.recipes-ing-row'
//   - input class '.ing-search' (same, reusing existing autocomplete CSS)
//   - remove class '.ing-remove' (same)
//   - qty class '.ing-qty' (same)
//   - data-ing-idx attribute (same — critical: must map to _kioskModifiedIngredients index)
//   - _kioskModifiedIngredients.splice(idx, 1) on remove (vs _recipesState.currentIngredients.splice)
//   - Call kioskScheduleRecipeQuote() after any change (debounced re-quote)

function attachKioskModifyRowListeners() {
  var tbody = document.getElementById('kiosk-modify-tbody');
  if (!tbody) return;
  tbody.querySelectorAll('.ing-remove').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var row = btn.closest('.kiosk-modify-row');
      var idx = parseInt(row && row.getAttribute('data-ing-idx'), 10);
      if (isNaN(idx) || idx < 0) return;
      _kioskModifiedIngredients.splice(idx, 1);
      renderKioskModifyRows();
      kioskScheduleRecipeQuote();  // re-quote after removal
    });
  });
  tbody.querySelectorAll('.ing-qty').forEach(function (input) {
    input.addEventListener('change', function () {
      var row = input.closest('.kiosk-modify-row');
      var idx = parseInt(row && row.getAttribute('data-ing-idx'), 10);
      if (!isNaN(idx) && _kioskModifiedIngredients[idx]) {
        _kioskModifiedIngredients[idx].quantity = parseFloat(input.value) || 0;
      }
      kioskScheduleRecipeQuote();
    });
  });
  tbody.querySelectorAll('.ing-search').forEach(function (input) {
    input.addEventListener('input', function () { showIngredientAutocomplete(input); });
    input.addEventListener('focus', function () { if (!input.value) showIngredientAutocomplete(input); });
    input.addEventListener('blur', function () {
      setTimeout(function () { hideIngredientAutocomplete(input); }, 200);
    });
  });
}
```

**Save-as-new pattern** — uses existing `POST /api/recipes` endpoint (recipes.js line 379). Copy the PUT pattern from kiosk IIFE lines 11207–11234 (`kioskSaveRecipeQuickEdit`) for the fetch skeleton:
```javascript
// admin.js lines 11207–11234 — save/PUT pattern to adapt for POST save-as-new
function kioskSaveAsNewRecipe(name, modifiedBaseIngredients) {
  var mw = kioskMwUrl();
  var headers = { 'Content-Type': 'application/json' };
  if (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.MW_API_KEY) {
    headers['x-api-key'] = SHEETS_CONFIG.MW_API_KEY;
  }
  // D-12: save pre-scale base ingredients; D-13: dynamic; D-14: draft
  var payload = {
    name: name,
    style: _kioskSelectedRecipe.style || '',
    batch_size_l: _kioskSelectedRecipe.batch_size_l || null,
    pricing_mode: 'dynamic',
    status: 'draft',
    ingredients: modifiedBaseIngredients
  };
  fetch(mw + '/api/recipes', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(payload)
  })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data.ok) throw new Error(data.error || 'Create failed');
      // show success: "Recipe saved as draft. Activate in admin to use."
    })
    .catch(function (err) {
      // show error: "Could not save recipe — try again."
    });
}
```

**State-reset pattern** (lines 10089–10090, 10772–10773 — clear modified state on back/clear too):
```javascript
// Add alongside _kioskQuote = null on back button and kioskClearCart:
_kioskModifiedIngredients = null;
_kioskModifyPanelOpen = false;
```

**Export pattern** (lines 11538–11550 — add Phase 36 test helpers):
```javascript
// Existing exports (lines 11538–11550):
_kioskGetQuote: function () { return _kioskQuote; },
_kioskSetQuote: function (q) { _kioskQuote = q; },
// Phase 36 additions:
_kioskGetModifiedIngredients: function () { return _kioskModifiedIngredients; },
_kioskSetModifiedIngredients: function (v) { _kioskModifiedIngredients = v; }
```

---

### `js/kiosk.js` (component, port Phase 35 + add Phase 36)

**Analog:** `js/admin.js` lines 9800–11560 (kiosk IIFE in admin.js — the source to port FROM)

**Current kiosk.js state** (lines 725–731) — Phase 35 state vars are MISSING from kiosk.js; port them:
```javascript
// kiosk.js line 731 currently has _kioskRecipeContext but NOT these Phase 35 vars:
// Add after line 731:
var _kioskTargetVolumeL = null;   // Phase 35: target volume in litres
var _kioskScaleFactor   = 1.0;    // Phase 35: display preview
var _kioskStockOverride = false;  // Phase 35: manager override flag
var _kioskQuote = null;           // Phase 35+36: last quote response
var _kioskQuoteTimer = null;      // Phase 35+36: debounce timer
// Phase 36:
var _kioskModifiedIngredients = null;
var _kioskModifyPanelOpen = false;
```

**Middleware URL pattern** (kiosk.js lines 753–756) — already exists; same as admin.js:
```javascript
// kiosk.js lines 753–756 — EXISTING; same pattern admin.js uses
function kioskMwUrl() {
  return (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.MIDDLEWARE_URL)
    ? SHEETS_CONFIG.MIDDLEWARE_URL : '';
}
```

**API key header pattern** (kiosk.js line 1056 — EXISTING):
```javascript
headers: { 'x-api-key': SHEETS_CONFIG.MW_API_KEY || '' }
```

**`kioskShowRecipePrompt` pattern** (kiosk.js lines 1180–1315) — port Phase 35 volume-control wiring block from admin.js lines 11150–11190 verbatim (same IDs, same logic).

**`kioskSelectSaleType` pattern** (kiosk.js lines 1316–1335) — add `kioskScheduleRecipeQuote()` call at end (mirrors admin.js line 11281–11282):
```javascript
// kiosk.js existing kioskSelectSaleType — add at end:
kioskScheduleRecipeQuote();   // Phase 35+36: re-quote on sale-type change
kioskUpdateAddToCartButton();
```

**`kioskAddRecipeToCart` / `processRecipeData` pattern** (kiosk.js lines 1403–1513) — extend to use `_kioskQuote.ingredients` (scaled+modified) when available, same as admin.js lines 11399–11402:
```javascript
// kiosk.js lines 1399–1402 analogy — when adding to cart:
var quoteForCart = (_kioskQuote &&
                    _kioskQuote.recipe_id === recipe.recipe_id &&
                    Array.isArray(_kioskQuote.ingredients))
                   ? _kioskQuote : null;
// Use quoteForCart.ingredients for scaled quantities in cart line items
```

**`kioskFetchRecipeQuote` / `kioskScheduleRecipeQuote`** — copy verbatim from admin.js lines 10965–10998; same URL, same debounce, same stale-recipe guard.

**`kioskUpdateAddToCartButton`** (kiosk.js lines 1337–1358) — extend with `(Modified)` suffix same as admin.js extension above.

**Catalog loading for modify panel** (kiosk.js has NO ingredient catalog today) — port the admin.js `loadIngredientCatalogForRecipes` pattern (admin.js lines 8519–8546) as `kioskLoadIngredientCatalog()`:
```javascript
// admin.js lines 8519–8546 — port this as kioskLoadIngredientCatalog()
var _kioskIngredientCatalog = [];
var _kioskCatalogLoaded = false;

function kioskLoadIngredientCatalog() {
  var mw = kioskMwUrl();
  if (!mw) return;
  var headers = {};
  if (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.MW_API_KEY) {
    headers['x-api-key'] = SHEETS_CONFIG.MW_API_KEY;
  }
  fetch(mw + '/api/ingredients?include_internal=1', { headers: headers })
    .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
    .then(function (data) {
      _kioskIngredientCatalog = data.items || data.ingredients || data || [];
      _kioskCatalogLoaded = true;
    })
    .catch(function () { /* non-fatal */ });
}
```

**Note:** Save-as-new is NOT exposed on the kiosk surface (UI-SPEC §2 — "Not exposed"). Omit `kioskSaveAsNewRecipe` from kiosk.js.

---

### `js/brewpad.js` (component, extend recipe-attach flow)

**Analog:** `js/brewpad.js` lines 3739–3838 (`openRecipeAttachPanel`)

**BrewPad middleware helpers** (lines 1184–1190 — EXISTING; use these throughout):
```javascript
// js/brewpad.js lines 1184–1190 — EXISTING MW URL + key pattern
function mwUrl() {
  return (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.MIDDLEWARE_URL) || '';
}
function mwApiKey() {
  return (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.MW_API_KEY) || '';
}
```

**Toast pattern** (lines 792–821 — EXISTING; use for save-as-new and stock advisory):
```javascript
// js/brewpad.js lines 792–811 — use showToast for BrewPad feedback
showToast('Recipe saved as draft — activate in Recipes tab to use', 'success');
showToast('Could not save recipe — try again', 'error');
// For soft stock advisory: NOT a toast — render into #bp-recipe-stock-advisory element
```

**Recipe-attach `updateBatch` write pattern** (lines 3799–3808 — EXISTING minimal snapshot; extend to scaled+modified):
```javascript
// js/brewpad.js lines 3791–3808 — EXISTING attach write (extend this for Phase 36)
var minimal = {
  name: snap.name, style: snap.style, abv: snap.abv,
  ibu: snap.ibu, batch_size_l: snap.batch_size_l, notes: snap.notes || '',
  ingredients: (data.ingredients || []).map(function (i) {
    return { item_id: i.item_id, item_name: i.item_name, quantity: i.quantity, unit: i.unit,
             cf_type: i.cf_type || '', cf_subcategory: i.cf_subcategory || '',
             display_group: i.display_group || '' };
  })
};
// Phase 36: extend minimal to include:
//   target_volume_l: _bpTargetVolumeL || snap.batch_size_l,
//   scale_factor: computed factor,
//   scaledIngredients: scaling.scaleIngredients(_bpModifiedIngredients || minimal.ingredients, factor)
return adminApiPost('update_batch', {
  batch_id: b.batch_id,
  updates: { recipe_id: rid, recipe_snapshot: JSON.stringify(minimal) }
}).then(function () { ... });
```

**Volume-control wiring pattern** — port from admin.js lines 11150–11190, substituting:
- `kiosk-recipe-volume-wrap` → `bp-recipe-volume-wrap`
- `kiosk-target-volume` → `bp-target-volume`
- `kiosk-scale-factor-readout` → `bp-scale-factor-readout`
- `.kiosk-volume-input` → `.bp-input` (BrewPad uses `.bp-input` class, NOT `.admin-input`)
- State var prefix `_kiosk` → `_bp` (scoped to the attach panel closure)

**BrewPad ingredient-row pattern** (lines 1933–2074) — EXISTING `attachIngredientRowListeners` + `showIngredientAutocompleteBp` + `selectIngredientFromAutocompleteBp` + `addIngredientRow`. The modify panel reuses these EXACT functions since they are already scoped to the Recipes tab `bp-recipe-ing-tbody`. For the modify panel on the attach surface, create parallel versions scoped to a new `bp-modify-tbody` element:
```javascript
// js/brewpad.js lines 1933–2074 — EXISTING BrewPad ingredient-row listeners
// Pattern to replicate for the attach-modify panel:
//   - tbody id: 'bp-modify-tbody' (instead of 'bp-recipe-ing-tbody')
//   - row class: 'bp-recipe-ing-row' (reuse same class for same autocomplete CSS)
//   - search input class: 'bp-input bp-ing-search' (EXISTING classes)
//   - qty input class: 'bp-input bp-ing-qty' (EXISTING classes)
//   - unit td class: 'bp-ing-unit' (EXISTING class)
//   - remove btn class: 'btn-secondary bp-btn-sm bp-ing-remove' (EXISTING + bp-btn-sm for touch target)
//   - autocomplete drop class: 'bp-ing-autocomplete-drop' (EXISTING class)
//   - data-ing-idx MUST be ingredients.indexOf(ing) per original array (critical note: lines 1881, 2024)
```

**BrewPad `buildRecipeIngredientTable` grouped render** (lines 3692–3722) — read-only display; the modify panel uses the editable variant of the same `groupRecipeIngredients` grouping loop. Mirror the group-header pattern:
```javascript
// js/brewpad.js lines 3700–3705 — group-header row (reuse this class):
if (group.label) {
  html += '<tr class="bp-recipe-ing-group"><td colspan="3"><strong>' +
    escapeHTML(group.label) + ' (' + group.count + ')</strong></td></tr>';
}
```

**Ingredient catalog loading** (brewpad.js line 1644 — EXISTING `loadIngredientCatalogForRecipes`). The attach panel can reuse `_recipesState.catalog` + `_recipesState.catalogLoaded` which are already populated when the Recipes tab is loaded. If BrewPad is opened directly on the Batches tab (not the Recipes tab), the catalog may not be loaded yet — guard with `if (!_recipesState.catalogLoaded) loadIngredientCatalogForRecipes()`.

**Soft stock advisory pattern** — no direct analog (first use of advisory-only, non-blocking stock check). Use `showToast('...', 'warn')` for the advisory text, OR render into a dedicated `#bp-recipe-stock-advisory` div using `.bp-toast--warning` CSS class (see UI-SPEC §3). Follow the existing availability-banner pattern from lines 1825–1844 (availability-check result → innerHTML) rather than using the global toast queue so it persists.

**Save-as-new on BrewPad** — same `POST /api/recipes` call as the admin pattern; use `showToast` for success/error feedback (lines 792–811).

---

### `zoho-middleware/routes/pos-recipe.js` (route, extend `computeRecipeQuote` + quote endpoint)

**Analog:** `zoho-middleware/routes/pos-recipe.js` lines 39–138 (`computeRecipeQuote` helper) and lines 235–302 (`GET /api/kiosk/recipe-quote`)

**`computeRecipeQuote` extension pattern** (lines 53–138). Phase 36 passes an optional `modifiedIngredients` array. When present, use `modifiedIngredients` instead of `ingredients` (from Apps Script) for scaling and pricing:
```javascript
// pos-recipe.js lines 53–103 — existing computeRecipeQuote signature:
function computeRecipeQuote(recipeId, rawTarget, saleType, millGrain) {
  return callAppsScriptPost('get_recipe', { recipe_id: recipeId })
    .then(function (data) {
      var recipe = data.data.recipe;
      var ingredients = data.data.ingredients || [];  // BASE list from Apps Script
      // ...validate batch_size_l, targetVolumeL, scaleFactor...

      // Phase 36: if caller passed a modified base list, use it instead
      var baseIngredients = modifiedIngredients || ingredients;
      var scaledIngredients = scaling.scaleIngredients(baseIngredients, scaleFactor);
      // ...
    });
}
// Callers add modifiedIngredients as 4th positional param (or refactor to options object)
```

**Locked-add pricing (D-07)** — new logic block inside `computeRecipeQuote` for locked-price + added ingredients:
```javascript
// After computing grandTotal via scaling.computeScaledRecipeTotal (line 109):
// D-07: for locked-price recipes with added ingredients, add the extra lines separately
if (pricingMode === 'locked' && modifiedIngredients) {
  var originalIds = {};
  ingredients.forEach(function (i) { originalIds[i.item_id] = true; });
  modifiedIngredients.forEach(function (ing) {
    if (!originalIds[ing.item_id]) {  // this ingredient was ADDED
      var catalogEntry = catalogMap[ing.item_id];
      if (catalogEntry) {
        var addedScaled = scaling.scaleIngredient(ing, scaleFactor);
        grandTotal += (Number(addedScaled.quantity) || 0) * (Number(catalogEntry.rate) || 0);
        grandTotal = Math.round(grandTotal * 100) / 100;
      }
    }
  });
  // D-08: REMOVED ingredients do NOT reduce the locked price (intentional asymmetry)
}
```

**GET `/api/kiosk/recipe-quote` extension** (lines 235–302) — add `modified_ingredients` query param (JSON-encoded array) or switch the endpoint to accept POST with a JSON body for longer lists:
```javascript
// pos-recipe.js lines 240–248 — existing query param parsing:
var query = req.query || {};
var recipeId = query.recipe_id;
var saleType = query.sale_type || 'in-store';
// Phase 36 addition:
var modifiedIngredients = null;
if (query.modified_ingredients) {
  try { modifiedIngredients = JSON.parse(query.modified_ingredients); } catch (e) { modifiedIngredients = null; }
}
computeRecipeQuote(recipeId, query.target_volume_l, saleType, false, modifiedIngredients)
```

**Error-forwarding pattern** (lines 295–301 — EXISTING; copy for any new route variations):
```javascript
.catch(function (err) {
  if (err && err.status) {
    return res.status(err.status).json(err.body);
  }
  log.error('[pos-recipe/...] Error: ' + (err && err.message));
  res.status(502).json({ error: 'Failed to fetch recipe. Please try again.' });
});
```

**Snapshot freeze pattern** (lines 507–525 — EXISTING `recipe_snapshot` build; extend for Phase 36):
```javascript
// pos-recipe.js lines 507–517 — EXISTING snapshot build; add modifiedBaseIngredients:
var snapshot = {
  name: recipe.name,
  style: recipe.style,
  abv: recipe.abv,
  locked_price: recipe.locked_price,
  service_fee: recipe.service_fee,
  materials_fee: recipe.materials_fee,
  target_volume_l: targetVolumeLConfirm,
  scale_factor: scaleFactorConfirm,
  ingredients: scaledIngredients,         // already here from Phase 35
  // Phase 36 additions:
  modified_base_ingredients: body.modified_ingredients || null,  // pre-scale edited list
  is_modified: !!(body.modified_ingredients && body.modified_ingredients.length)
};
```

---

### `zoho-middleware/lib/recipe-scaling.js` (utility, extend with locked-add helper)

**Analog:** `zoho-middleware/lib/recipe-scaling.js` (whole file — 199 lines)

**Pure-function pattern** (lines 1–21 — module design contract):
```javascript
// recipe-scaling.js lines 1–21 — pure, no I/O, independently testable
// All Phase 36 additions must follow the same contract:
//   - No require() of external libs (axios, etc.)
//   - Return values, never mutate inputs
//   - Each export has a JSDoc block

/**
 * @param {Array}  baseIngredients  - pre-scale ingredient list
 * @param {Array}  originalIngredients - original recipe ingredients from Apps Script
 * @param {Object} catalogMap       - { [item_id]: { rate, ... } }
 * @param {string} pricingMode      - 'locked' | 'dynamic'
 * @param {number} lockedPrice      - recipe.locked_price
 * @param {number} scaleFactor      - computed target/base factor
 * @param {string} saleType         - 'in-store' | 'take-out'
 * @returns {number}                - grand total for modified list
 */
```

**`scaleIngredient` pattern** (lines 55–76 — copy for any new per-ingredient helper):
```javascript
// recipe-scaling.js lines 55–76 — immutable shallow-clone pattern:
return Object.assign({}, ing, { quantity: scaledQty });
// Never: ing.quantity = scaledQty  (would mutate the input array)
```

**Export pattern** (lines 192–199):
```javascript
// recipe-scaling.js lines 192–199 — add new exports here
module.exports = {
  scaleIngredient:          scaleIngredient,
  scaleIngredients:         scaleIngredients,
  computeScaledRecipeTotal: computeScaledRecipeTotal,
  checkScaledStock:         checkScaledStock,
  // Phase 36 additions:
  computeModifiedRecipeTotal: computeModifiedRecipeTotal,  // handles D-07/D-08 locked-add/remove
  CONTINUOUS_UNITS:         CONTINUOUS_UNITS,
  DISCRETE_UNITS:           DISCRETE_UNITS
};
```

---

### `zoho-middleware/lib/brewpad-integration.js` (service, extend `detectRecipeSale`)

**Analog:** `zoho-middleware/lib/brewpad-integration.js` lines 368–408 (`detectRecipeSale`)

**`detectRecipeSale` extension pattern** (lines 380–396 — add `target_volume_l` and modified ingredients to batch payload):
```javascript
// brewpad-integration.js lines 380–395 — EXISTING; extend batchPayload:
function detectRecipeSale(recipeId, recipeSnapshot, invoiceNumber, customerName, contactId) {
  if (!recipeId) return;
  var nameParts = splitCustomerName(customerName);
  var batchPayload = {
    product_sku:        recipeId,
    product_name:       (recipeSnapshot && recipeSnapshot.name) || recipeId,
    customer_name:      customerName || 'Walk-in Customer',
    customer_firstname: nameParts.first || (customerName ? '' : 'Walk-in'),
    customer_lastname:  nameParts.last  || (customerName ? '' : 'Customer'),
    customer_id:        contactId || '',
    source:             'kiosk_recipe',
    zoho_so_number:     invoiceNumber || '',
    recipe_id:          recipeId,
    recipe_snapshot:    JSON.stringify(recipeSnapshot || {}),
    // Phase 36 additions (SEL-02 carry-through):
    target_volume_l:    (recipeSnapshot && recipeSnapshot.target_volume_l) || null,
    scale_factor:       (recipeSnapshot && recipeSnapshot.scale_factor) || null
  };
  callAppsScriptCreateBatch(batchPayload).catch(function () {});
}
```

**`callAppsScriptCreateBatch` Apps Script POST pattern** (lines 68–112 — follow for any new Apps Script action call):
```javascript
// brewpad-integration.js lines 76–111 — Apps Script POST with retry queue:
var payload = Object.assign({}, batchPayload, {
  action: 'create_batch',
  server_token: token
});
return axios.post(url, JSON.stringify(payload), {
  headers: { 'Content-Type': 'application/json' },
  timeout: 12000,
  maxRedirects: 5
}).then(function (resp) { ... })
  .catch(function (err) {
    log.warn('[brewpad] Apps Script call failed (non-fatal): ' + err.message);
    if (!skipRetryQueue) {
      return queueForRetry(batchPayload, 'http_error: ' + err.message).then(function () {
        return { ok: false };
      });
    }
    return { ok: false };
  });
```

---

### `zoho-middleware/routes/recipes.js` (route, confirm activation guardrail for dynamic saves)

**Analog:** `zoho-middleware/routes/recipes.js` lines 376–430

**`POST /api/recipes` pattern** (lines 379–393 — used verbatim for MOD-03 save-as-new):
```javascript
// recipes.js lines 379–393 — EXISTING create endpoint (no changes needed for basic save)
router.post('/api/recipes', function (req, res) {
  var payload = req.body || {};
  callAppsScriptPost('create_recipe', payload).then(function (data) {
    if (!data.ok) {
      return res.status(422).json({ error: data.message || data.error || 'Create failed' });
    }
    return bustRecipeCache(null).then(function () {
      res.status(201).json({ ok: true, recipe_id: data.recipe_id || (data.data && data.data.recipe_id) });
    });
  }).catch(function (err) {
    log.error('[api/recipes] POST failed: ' + err.message);
    res.status(502).json({ error: 'Unable to create recipe' });
  });
});
```

**Activation guardrail for `PUT` (lines 403–417)** — the current guardrail checks `locked_price > 0` AND `ingredient_count >= 1`. For dynamic recipes (D-13/D-14), `locked_price` will be 0. The guardrail currently blocks activation of dynamic recipes. Claude's Discretion (CONTEXT §"Specific Ideas"): the planner must decide whether to modify the PUT guardrail to allow `pricing_mode === 'dynamic'` as a bypass condition, OR document that save-as-new draft recipes require a separate activation step through the admin UI (which has the UX to set a locked_price or confirm dynamic mode):
```javascript
// recipes.js lines 403–417 — EXISTING guardrail:
if (payload.status === 'active') {
  var ingCount = parseInt(payload.ingredient_count, 10) || 0;
  var lockedPrice = parseFloat(payload.locked_price) || 0;
  if (lockedPrice <= 0) {
    return res.status(422).json({
      error: 'Cannot activate recipe: a valid locked price must be set'
    });
  }
  // ...
}
// Phase 36 note: dynamic recipes have locked_price=0. Save-as-new creates status='draft',
// so the guardrail is NOT triggered at save time. Activation is a separate admin action.
// The guardrail needs a bypass for pricing_mode='dynamic' when activating — confirm with planner.
```

---

## Shared Patterns

### ES5/`var` Convention
**Applies to:** All `.js` files (`admin.js`, `kiosk.js`, `brewpad.js`)
- No arrow functions, `const`/`let`, template literals, or spread operator
- Use `escapeHTML()` for all dynamic HTML insertion
- Functions declared with `function` keyword (hoisted), not `var fn = function`
- `Array.prototype.forEach.call(nodeList, fn)` for NodeList iteration (or `.querySelectorAll(...).forEach` if polyfilled)

### API Key + MW URL Pattern
**Source:** `js/admin.js` lines 9814–9817; `js/brewpad.js` lines 1184–1190; `js/kiosk.js` lines 753–756
**Apply to:** All three surfaces for any fetch call to middleware:
```javascript
// Admin/kiosk pattern:
var headers = {};
if (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.MW_API_KEY) {
  headers['x-api-key'] = SHEETS_CONFIG.MW_API_KEY;
}
// BrewPad pattern (uses mwApiKey() helper):
headers: { 'x-api-key': mwApiKey() }
```

### Server-Authoritative Quote (No Client-Side Pricing)
**Source:** `zoho-middleware/routes/pos-recipe.js` lines 39–138 (`computeRecipeQuote`)
**Apply to:** All three sale surfaces; BrewPad attach does NOT call the quote endpoint (D-10)
- Client fetches `GET /api/kiosk/recipe-quote` for price preview with 350ms debounce
- Client NEVER computes price; server's `computeRecipeQuote` is the only source of truth
- `_kioskQuote` / `_kioskQuoteTimer` state pattern copied to all three surfaces

### `groupRecipeIngredients` Grouped Display
**Source:** `js/lib/recipe-grouping.js` (entire file, 205 lines)
**Apply to:** All three modify panels (ingredient row rendering)
```javascript
// Pattern (from admin.js lines 8793–8827, brewpad.js lines 3700–3705):
var groups = (typeof groupRecipeIngredients === 'function')
  ? groupRecipeIngredients(ingredients)
  : [{ label: '', count: ingredients.length, items: ingredients }];
groups.forEach(function (group) {
  if (group.label) {
    html += '<tr class="group-header-class"><td colspan="4">' + escapeHTML(group.label) + ' (' + group.count + ')</td></tr>';
  }
  group.items.forEach(function (ing) {
    var idx = ingredients.indexOf(ing);  // CRITICAL: original array index
    // ...render row with data-ing-idx="' + idx + '"
  });
});
```
**Critical:** `data-ing-idx` must map to the ORIGINAL flat array index (via `ingredients.indexOf(ing)`), not the group-iteration index. This ensures `.splice(idx, 1)` targets the correct element.

### `detectRecipeSale` Snapshot Freeze
**Source:** `zoho-middleware/lib/brewpad-integration.js` lines 368–396; `zoho-middleware/routes/pos-recipe.js` lines 505–525
**Apply to:** Phase 36 must extend the snapshot with `target_volume_l`, `scale_factor`, and optionally `modified_base_ingredients` so the batch record carries the scaling context.

### Middleware Unit Test Pattern
**Source:** `zoho-middleware/__tests__/pos-recipe.test.js` (referenced in 35-06 summary)
**Apply to:** `computeRecipeQuote` extension + `computeModifiedRecipeTotal` new helper
- TDD: write failing test first (RED), then implement (GREEN)
- Worked examples from CONTEXT (D-07/D-08) must become named test fixtures

### `callAppsScriptPost` Pattern
**Source:** `zoho-middleware/routes/pos-recipe.js` lines 23–37; `zoho-middleware/lib/brewpad-integration.js` lines 68–112
**Apply to:** Any new Apps Script action call (e.g. `create_recipe` for save-as-new)
```javascript
function callAppsScriptPost(action, payload) {
  var url = process.env.APPS_SCRIPT_URL;
  var token = process.env.APPS_SCRIPT_SERVER_TOKEN;
  if (!url || !token) {
    return Promise.reject(new Error('Apps Script not configured'));
  }
  return axios.post(url, JSON.stringify(Object.assign({}, payload, {
    action: action,
    server_token: token
  })), {
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000,
    maxRedirects: 5
  }).then(function (resp) { return resp.data; });
}
```

---

## No Analog Found

All files have close analogs. No new-from-scratch patterns required.

---

## Metadata

**Analog search scope:** `js/admin.js`, `js/kiosk.js`, `js/brewpad.js`, `admin.html`, `kiosk.html`, `zoho-middleware/routes/pos-recipe.js`, `zoho-middleware/lib/recipe-scaling.js`, `zoho-middleware/lib/brewpad-integration.js`, `zoho-middleware/routes/recipes.js`, `js/lib/recipe-grouping.js`
**Files scanned:** 10
**Pattern extraction date:** 2026-06-20
