# Phase 16: Recipe Management — BrewPad, Kiosk & Batch Integration - Pattern Map

**Mapped:** 2026-05-17
**Files analyzed:** 4 (all modifications — no new files)
**Analogs found:** 4 / 4

---

## File Classification

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------|------|-----------|----------------|---------------|
| `js/brewpad.js` (tabbed picker in `buildCreateForm`) | component (form field) | request-response | `js/brewpad.js` `bindProductSearch()` + `bindCustomerSearch()` | exact — same file, same dropdown pattern |
| `js/brewpad.js` (collapsible Recipe section in `renderBatchDetail`) | component (detail section) | request-response | `js/brewpad.js` Notes / Tasks / Measurements sections in `renderBatchDetail` | exact — same file, same section pattern |
| `js/admin.js` (kiosk recipe quick-edit in `kioskShowRecipePrompt`) | component (action panel) | request-response | `js/admin.js` `saveRecipe()` — PUT /api/recipes/:id | role-match — same file, same endpoint |
| `apps-script/adminApi.gs` (`updateBatch` allowedFields patch) | utility (data write) | CRUD | `apps-script/adminApi.gs` `createBatch()` recipe_snapshot write (lines 1809-1820) | exact — same file, bypass pattern already established |

---

## Pattern Assignments

### `js/brewpad.js` — Tabbed Picker in `buildCreateForm()` (component, request-response)

**Analog:** `js/brewpad.js` `bindProductSearch()` (lines 2923–2971) and `buildCreateForm()` product block (lines 2767–2773)

**Current product field HTML pattern** (lines 2767–2773):
```javascript
// REPLACE this single-input block with a tabbed container:
html += '<div class="bp-form-group"><label>Product</label>';
html += '<div class="bp-vessel-wrap">';
html += '<input type="text" id="bp-new-product-text" class="bp-inline-input" placeholder="Search kits…" autocomplete="off">';
html += '<div class="bp-vessel-dropdown" id="bp-new-product-dropdown" style="display:none;"></div>';
html += '<input type="hidden" id="bp-new-product-sku">';
html += '<input type="hidden" id="bp-new-product-name">';
html += '</div></div>';
```

**New tabbed container pattern** (derived from same `bp-vessel-wrap` / `kiosk-mode-toggle` CSS idiom):
```javascript
// Tab bar follows .kiosk-mode-toggle__btn pattern from kiosk.css:
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

**Tab state variable** — declare alongside other `_` state vars at IIFE top level:
```javascript
var _productPickerTab = 'kits'; // 'kits' | 'recipes'
```

**Dropdown / search bind pattern** (lines 2923–2971 — copy for recipe tab):
```javascript
function bindProductSearch() {
  var input    = document.getElementById('bp-new-product-text');
  var dropdown = document.getElementById('bp-new-product-dropdown');
  var skuHidden  = document.getElementById('bp-new-product-sku');
  var nameHidden = document.getElementById('bp-new-product-name');
  if (!input || !dropdown || !skuHidden || !nameHidden) return;

  function showProductOptions(term) {
    // Guard: only run when Kits tab is active
    if (_productPickerTab !== 'kits') return;
    // ... existing filter + render logic (lines 2930–2959) ...
  }

  input.addEventListener('focus', function () { showProductOptions(input.value); });
  // ...debounce + blur handlers (lines 2962–2970)...
}
```

**New `bindRecipePickerSearch()` — same shape, fetches /api/recipes:**
```javascript
function bindRecipePickerSearch() {
  var input    = document.getElementById('bp-new-product-text');
  var dropdown = document.getElementById('bp-new-product-dropdown');
  var nameHidden = document.getElementById('bp-new-product-name');
  var recipeIdHidden = document.getElementById('bp-new-recipe-id');
  var snapshotHidden = document.getElementById('bp-new-recipe-snapshot');
  if (!input || !dropdown) return;

  var _recipeCatalog = null;

  function showRecipeOptions(term) {
    if (_productPickerTab !== 'recipes') return;
    if (!_recipeCatalog) {
      dropdown.innerHTML = '<div class="bp-vessel-option bp-vessel-option--empty">Loading recipes…</div>';
      dropdown.style.display = '';
      fetch(mwUrl() + '/api/recipes?status=active', {
        headers: { 'x-api-key': mwApiKey() }
      }).then(function (r) { return r.json(); })
        .then(function (data) {
          _recipeCatalog = data.recipes || [];
          showRecipeOptions(term);
        })
        .catch(function () { _recipeCatalog = []; showRecipeOptions(term); });
      return;
    }
    var matches = _recipeCatalog.filter(function (r) {
      if (!term) return true;
      return ((r.name || '') + ' ' + (r.style || '')).toLowerCase().indexOf(term.toLowerCase()) !== -1;
    }).slice(0, 15);
    dropdown.innerHTML = matches.length === 0
      ? '<div class="bp-vessel-option bp-vessel-option--empty">No recipes found</div>'
      : matches.map(function (r) {
          return '<div class="bp-vessel-option" data-rid="' + escapeHTML(r.recipe_id || '') +
            '" data-rname="' + escapeHTML(r.name || '') + '">' +
            escapeHTML(r.name || '') +
            (r.abv ? ' <span style="color:var(--ink-muted);font-size:0.82em;">' + r.abv + '% ABV</span>' : '') +
            '</div>';
        }).join('');
    dropdown.style.display = '';

    // Selecting a recipe: fetch full detail for snapshot, then populate hiddens
    Array.prototype.forEach.call(dropdown.querySelectorAll('.bp-vessel-option[data-rid]'), function (opt) {
      opt.addEventListener('mousedown', function (e) {
        e.preventDefault();
        var rid = opt.getAttribute('data-rid');
        var rname = opt.getAttribute('data-rname');
        input.value = rname;
        nameHidden.value = rname;
        recipeIdHidden.value = rid;
        dropdown.style.display = 'none';
        // Fetch full recipe for snapshot
        fetch(mwUrl() + '/api/recipes/' + encodeURIComponent(rid), {
          headers: { 'x-api-key': mwApiKey() }
        }).then(function (r) { return r.json(); })
          .then(function (data) {
            var snap = data.recipe || {};
            // Trim to essential fields only (avoid 50k cell limit)
            var minimal = {
              name: snap.name, style: snap.style, abv: snap.abv,
              ibu: snap.ibu, batch_size_l: snap.batch_size_l,
              ingredients: (data.ingredients || []).map(function (i) {
                return { item_id: i.item_id, item_name: i.item_name, quantity: i.quantity, unit: i.unit };
              })
            };
            snapshotHidden.value = JSON.stringify(minimal);
          })
          .catch(function () { snapshotHidden.value = ''; });
      });
    });
  }

  input.addEventListener('focus', function () {
    if (_productPickerTab === 'recipes') showRecipeOptions(input.value);
  });
  var timer;
  input.addEventListener('input', function () {
    clearTimeout(timer);
    nameHidden.value = ''; recipeIdHidden.value = ''; snapshotHidden.value = '';
    timer = setTimeout(function () {
      if (_productPickerTab === 'recipes') showRecipeOptions(input.value);
    }, 200);
  });
  // blur already handled by existing bindProductSearch — shared input element
}
```

**Tab switcher bind** (call from `buildCreateForm()` after `bindProductSearch()`):
```javascript
// Bind tab buttons after form render
Array.prototype.forEach.call(document.querySelectorAll('.bp-product-tab'), function (btn) {
  btn.addEventListener('click', function () {
    _productPickerTab = btn.getAttribute('data-picker-tab') || 'kits';
    Array.prototype.forEach.call(document.querySelectorAll('.bp-product-tab'), function (b) {
      b.classList.toggle('bp-product-tab--active', b === btn);
    });
    // Clear selection state + reset input placeholder
    var input = document.getElementById('bp-new-product-text');
    var dropdown = document.getElementById('bp-new-product-dropdown');
    var skuHidden = document.getElementById('bp-new-product-sku');
    var nameHidden = document.getElementById('bp-new-product-name');
    var recipeIdHidden = document.getElementById('bp-new-recipe-id');
    var snapshotHidden = document.getElementById('bp-new-recipe-snapshot');
    if (input) {
      input.value = '';
      input.placeholder = _productPickerTab === 'kits' ? 'Search kits…' : 'Search recipes…';
      input.focus();
    }
    if (dropdown) dropdown.style.display = 'none';
    if (skuHidden) skuHidden.value = '';
    if (nameHidden) nameHidden.value = '';
    if (recipeIdHidden) recipeIdHidden.value = '';
    if (snapshotHidden) snapshotHidden.value = '';
  });
});
bindRecipePickerSearch();
```

**Submit payload extension** (lines 2890–2903 — add two fields):
```javascript
adminApiPost('create_batch', {
  product_name: productName,
  product_sku: productSku,
  // ... all existing fields unchanged ...
  recipe_id: (document.getElementById('bp-new-recipe-id') || {}).value || '',
  recipe_snapshot: (document.getElementById('bp-new-recipe-snapshot') || {}).value || ''
})
```

**Error handling pattern** (lines 2915–2918 — unchanged):
```javascript
.catch(function (err) {
  showToast('Failed: ' + err.message, 'error');
  submitBtn.disabled = false;
});
```

---

### `js/brewpad.js` — Collapsible Recipe Section in `renderBatchDetail()` (component, request-response)

**Analog:** `js/brewpad.js` Notes section (lines 1823–1827) and Tasks section (lines 1812–1815) in `renderBatchDetail()`

**Existing section pattern** (lines 1812–1815):
```javascript
// ALL existing sections share this non-collapsible pattern:
html += '<div class="bp-detail-section">';
html += '<div class="bp-detail-section-title">Tasks</div>';
html += '<div id="bp-detail-tasks">' + renderDetailTasks(tasks) + '</div>';
html += '</div>';
```

**New collapsible Recipe section** (insert after Notes section, before footer actions at line 1829):
```javascript
// Collapsed by default — toggle on title click
html += '<div class="bp-detail-section bp-detail-section--recipe">';
html += '<div class="bp-detail-section-title bp-detail-section-toggle" ' +
        'id="bp-recipe-section-toggle" role="button" tabindex="0" ' +
        'aria-expanded="false" style="cursor:pointer;user-select:none;' +
        'display:flex;align-items:center;justify-content:space-between;">';
html += 'Recipe <span class="bp-section-toggle-icon" style="transition:transform 0.2s ease;display:inline-block;">&#9656;</span>';
html += '</div>';
html += '<div id="bp-recipe-section-body" style="display:none;">';

// State A: snapshot present
var snap = null;
if (b.recipe_snapshot) {
  try { snap = JSON.parse(b.recipe_snapshot); } catch (e) { snap = null; }
}

if (snap) {
  // Read-only summary
  html += '<div class="bp-recipe-summary">';
  if (snap.style) html += '<div><span class="bp-detail-info-label">Style</span> ' + escapeHTML(snap.style) + '</div>';
  if (snap.abv)   html += '<div><span class="bp-detail-info-label">ABV</span> ' + escapeHTML(String(snap.abv)) + '%</div>';
  if (snap.ibu)   html += '<div><span class="bp-detail-info-label">IBU</span> ' + escapeHTML(String(snap.ibu)) + '</div>';
  if (snap.batch_size_l) html += '<div><span class="bp-detail-info-label">Batch Size</span> ' + escapeHTML(String(snap.batch_size_l)) + ' L</div>';
  html += '</div>';
  // Ingredient table (read-only by default)
  html += '<div id="bp-recipe-ingredient-wrap">' + buildRecipeIngredientTable(snap.ingredients || [], false) + '</div>';
  html += '<div class="bp-detail-actions" style="border-top:none;padding-top:8px;">';
  html += '<button type="button" class="btn bp-btn-sm" id="bp-recipe-edit-btn">Edit Snapshot</button>';
  html += '<button type="button" class="btn bp-btn-sm" id="bp-recipe-save-btn" style="display:none;">Save Changes</button>';
  html += '<button type="button" class="btn-secondary bp-btn-sm" id="bp-recipe-cancel-btn" style="display:none;">Cancel</button>';
  html += '</div>';
} else {
  // State B: no snapshot
  html += '<div class="bp-recipe-empty">';
  html += '<button type="button" class="btn-secondary bp-btn-sm" id="bp-recipe-attach-btn">Attach Recipe</button> ';
  html += '<button type="button" class="btn-secondary bp-btn-sm" id="bp-recipe-create-btn">Create Recipe</button>';
  html += '</div>';
}
html += '</div></div>'; // close body + section
```

**Toggle behavior** (wire after `detailPane.innerHTML = html`):
```javascript
var toggleBtn = document.getElementById('bp-recipe-section-toggle');
var body = document.getElementById('bp-recipe-section-body');
if (toggleBtn && body) {
  function handleRecipeToggle() {
    var expanded = toggleBtn.getAttribute('aria-expanded') === 'true';
    toggleBtn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    body.style.display = expanded ? 'none' : '';
    var icon = toggleBtn.querySelector('.bp-section-toggle-icon');
    if (icon) icon.style.transform = expanded ? '' : 'rotate(90deg)';
  }
  toggleBtn.addEventListener('click', handleRecipeToggle);
  toggleBtn.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleRecipeToggle(); }
  });
}
```

**Edit Snapshot button behavior** (follow same pattern as Location save at lines 1868–1882):
```javascript
var editBtn = document.getElementById('bp-recipe-edit-btn');
var saveBtn = document.getElementById('bp-recipe-save-btn');
var cancelBtn = document.getElementById('bp-recipe-cancel-btn');
var ingredientWrap = document.getElementById('bp-recipe-ingredient-wrap');
if (editBtn && snap) {
  editBtn.addEventListener('click', function () {
    // Switch ingredient table to editable mode
    ingredientWrap.innerHTML = buildRecipeIngredientTable(snap.ingredients || [], true);
    editBtn.style.display = 'none';
    saveBtn.style.display = '';
    cancelBtn.style.display = '';
  });
}
if (saveBtn && snap) {
  saveBtn.addEventListener('click', function () {
    saveBtn.disabled = true;
    var editedIngredients = readIngredientTableEdits(ingredientWrap, snap.ingredients);
    var editedSnap = {
      name: snap.name, style: snap.style, abv: snap.abv,
      ibu: snap.ibu, batch_size_l: snap.batch_size_l,
      ingredients: editedIngredients
    };
    adminApiPost('update_batch', {
      batch_id: b.batch_id,
      updates: { recipe_snapshot: JSON.stringify(editedSnap) }
    })
      .then(function () {
        snap = editedSnap;
        b.recipe_snapshot = JSON.stringify(editedSnap);
        try { sessionStorage.removeItem('sv-bp-batch-' + b.batch_id); } catch (e) {}
        showToast('Recipe snapshot saved', 'success');
        ingredientWrap.innerHTML = buildRecipeIngredientTable(editedIngredients, false);
        editBtn.style.display = '';
        saveBtn.style.display = 'none';
        cancelBtn.style.display = 'none';
      })
      .catch(function (err) {
        showToast('Save failed: ' + err.message, 'error');
        saveBtn.disabled = false;
      });
  });
}
```

**Attach Recipe button** (calls GET /api/recipes, same dropdown as recipe picker):
```javascript
var attachBtn = document.getElementById('bp-recipe-attach-btn');
if (attachBtn) {
  attachBtn.addEventListener('click', function () {
    // Open inline recipe search — same fetch pattern as bindRecipePickerSearch
    // On selection: adminApiPost('update_batch', { batch_id, updates: { recipe_id, recipe_snapshot } })
    // Then re-render the Recipe section body with the new snapshot
    openRecipeAttachPanel(b);
  });
}
```

**Create Recipe button** (opens create sheet — same `openCreateSheet` pattern):
```javascript
var createFromBatchBtn = document.getElementById('bp-recipe-create-btn');
if (createFromBatchBtn) {
  createFromBatchBtn.addEventListener('click', function () {
    openRecipeFromBatchSheet(b); // slide-out using bp-create-sheet pattern
  });
}
```

**`buildRecipeIngredientTable(ingredients, editable)`** — new helper function:
```javascript
function buildRecipeIngredientTable(ingredients, editable) {
  if (!ingredients || !ingredients.length) return '<p style="color:var(--ink-muted);font-size:0.85rem;">No ingredients listed.</p>';
  var html = '<table class="bp-recipe-ing-table" style="width:100%;border-collapse:collapse;font-size:0.85rem;">';
  html += '<thead><tr><th style="text-align:left;padding:4px 6px;color:var(--ink-tertiary);">Ingredient</th>';
  html += '<th style="text-align:right;padding:4px 6px;color:var(--ink-tertiary);">Qty</th>';
  html += '<th style="text-align:left;padding:4px 6px;color:var(--ink-tertiary);">Unit</th></tr></thead><tbody>';
  ingredients.forEach(function (ing, i) {
    html += '<tr>';
    html += '<td style="padding:4px 6px;">' + escapeHTML(ing.item_name || '') + '</td>';
    if (editable) {
      html += '<td style="padding:4px 6px;text-align:right;"><input type="number" class="bp-inline-input bp-recipe-qty" ' +
              'data-idx="' + i + '" value="' + escapeHTML(String(ing.quantity || '')) + '" ' +
              'style="width:70px;text-align:right;" step="0.01" min="0"></td>';
    } else {
      html += '<td style="padding:4px 6px;text-align:right;">' + escapeHTML(String(ing.quantity || '')) + '</td>';
    }
    html += '<td style="padding:4px 6px;">' + escapeHTML(ing.unit || '') + '</td>';
    html += '</tr>';
  });
  html += '</tbody></table>';
  return html;
}
```

**`readIngredientTableEdits(wrap, snapIngredients)`** — reads edited qty inputs:
```javascript
function readIngredientTableEdits(wrap, snapIngredients) {
  var inputs = wrap.querySelectorAll('.bp-recipe-qty');
  var result = [];
  Array.prototype.forEach.call(inputs, function (input) {
    var idx = parseInt(input.getAttribute('data-idx'), 10);
    if (!isNaN(idx) && snapIngredients && snapIngredients[idx]) {
      var copy = {};
      Object.keys(snapIngredients[idx]).forEach(function (k) { copy[k] = snapIngredients[idx][k]; });
      copy.quantity = parseFloat(input.value) || 0;
      result.push(copy);
    }
  });
  return result;
}
```

**Error handling** — same `showToast` pattern used throughout `renderBatchDetail`:
```javascript
showToast('Recipe snapshot saved', 'success'); // success
showToast('Save failed: ' + err.message, 'error'); // failure
```

---

### `js/admin.js` — Kiosk Recipe Quick-Edit in `kioskShowRecipePrompt()` (component, request-response)

**Analog:** `js/admin.js` `saveRecipe()` (lines 8514–8588) — PUT /api/recipes/:id

**Existing prompt renders summary then fetches detail** (lines 10292–10405).

**Quick-edit button** — add to `summaryHtml` inside `kioskShowRecipePrompt()` (after ingredient list):
```javascript
// Add after the ingredients section, before summaryEl.innerHTML assignment:
summaryHtml += '<div id="kiosk-recipe-quick-edit-wrap" style="margin-top:1rem;"></div>';
summaryHtml += '<button type="button" class="btn-secondary" id="kiosk-recipe-quick-edit-btn" ' +
               'style="margin-top:0.75rem;width:100%;">Edit Recipe Info</button>';
```

**Quick-edit form render** (wired after `summaryEl.innerHTML = summaryHtml`):
```javascript
var qeBtn = document.getElementById('kiosk-recipe-quick-edit-btn');
if (qeBtn) {
  qeBtn.addEventListener('click', function () {
    var wrap = document.getElementById('kiosk-recipe-quick-edit-wrap');
    if (!wrap) return;
    qeBtn.style.display = 'none';
    // Build inline form for D-03 / D-09 fields: name, notes, locked_price, status
    wrap.innerHTML =
      '<label style="display:block;margin-bottom:0.5rem;font-size:0.85rem;font-weight:600;">Recipe Name</label>' +
      '<input type="text" id="kqe-name" class="bp-inline-input" style="width:100%;margin-bottom:0.75rem;" ' +
        'value="' + escapeHTML(recipe.name || '') + '">' +
      '<label style="display:block;margin-bottom:0.5rem;font-size:0.85rem;font-weight:600;">Notes</label>' +
      '<textarea id="kqe-notes" class="bp-inline-input" rows="2" style="width:100%;margin-bottom:0.75rem;">' +
        escapeHTML(recipe.notes || '') + '</textarea>' +
      '<label style="display:block;margin-bottom:0.5rem;font-size:0.85rem;font-weight:600;">Locked Price ($)</label>' +
      '<input type="number" id="kqe-price" class="bp-inline-input" style="width:100%;margin-bottom:0.75rem;" ' +
        'step="0.01" min="0" value="' + escapeHTML(String(recipe.locked_price || '')) + '">' +
      '<label style="display:block;margin-bottom:0.5rem;font-size:0.85rem;font-weight:600;">Status</label>' +
      '<select id="kqe-status" class="bp-inline-input" style="width:100%;margin-bottom:1rem;">' +
        '<option value="draft"' + (recipe.status === 'draft' ? ' selected' : '') + '>Draft</option>' +
        '<option value="active"' + (recipe.status === 'active' ? ' selected' : '') + '>Active</option>' +
      '</select>' +
      '<div style="display:flex;gap:0.5rem;">' +
        '<button type="button" class="btn" id="kqe-save" style="flex:1;">Save</button>' +
        '<button type="button" class="btn-secondary" id="kqe-cancel" style="flex:1;">Cancel</button>' +
      '</div>';

    document.getElementById('kqe-cancel').addEventListener('click', function () {
      wrap.innerHTML = '';
      qeBtn.style.display = '';
    });

    document.getElementById('kqe-save').addEventListener('click', function () {
      kioskSaveRecipeQuickEdit(recipe, wrap, qeBtn);
    });
  });
}
```

**`kioskSaveRecipeQuickEdit(recipe, wrap, qeBtn)`** — mirrors `saveRecipe()` PUT pattern (lines 8563–8587):
```javascript
function kioskSaveRecipeQuickEdit(recipe, wrap, qeBtn) {
  var saveBtn = document.getElementById('kqe-save');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  var fields = {
    name: (document.getElementById('kqe-name') || {}).value || recipe.name,
    notes: (document.getElementById('kqe-notes') || {}).value || '',
    locked_price: parseFloat((document.getElementById('kqe-price') || {}).value) || 0,
    status: (document.getElementById('kqe-status') || {}).value || recipe.status
    // status is always included to avoid activation-guardrail ambiguity (Pitfall 3)
  };

  var mw = kioskMwUrl();
  var headers = { 'Content-Type': 'application/json' };
  if (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.MW_API_KEY) {
    headers['x-api-key'] = SHEETS_CONFIG.MW_API_KEY;
  }

  fetch(mw + '/api/recipes/' + encodeURIComponent(recipe.recipe_id), {
    method: 'PUT',
    headers: headers,
    body: JSON.stringify(fields)
  })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data.ok && data.error) throw new Error(data.error);
      // Patch local recipe object so card re-renders correctly
      recipe.name = fields.name;
      recipe.notes = fields.notes;
      recipe.locked_price = fields.locked_price;
      recipe.status = fields.status;
      showToast('Recipe updated.', 'success');
      wrap.innerHTML = '';
      qeBtn.style.display = '';
      // Refresh recipe name in prompt header
      var nameEl = document.getElementById('kiosk-recipe-selected-name');
      if (nameEl) nameEl.textContent = fields.name;
    })
    .catch(function (err) {
      showToast('Could not save recipe: ' + (err.message || 'unknown error'), 'error');
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
    });
}
```

**Auth/API key pattern** (matches `kioskLoadRecipes` lines 10170–10173 and `getRecipesMwHeaders` lines 8027–8033):
```javascript
// Always: read-only requests use x-api-key header (lowercase)
// Mutating requests (PUT) also use x-api-key (same key)
var headers = { 'Content-Type': 'application/json' };
if (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.MW_API_KEY) {
  headers['x-api-key'] = SHEETS_CONFIG.MW_API_KEY;
}
```

**XSS protection** — all recipe field values rendered via `escapeHTML()`:
```javascript
// escapeHTML is defined at brewpad.js line 6 and also available in admin.js
escapeHTML(recipe.name || '')   // always wrap user-facing string data
```

---

### `apps-script/adminApi.gs` — `updateBatch()` `allowedFields` Patch (utility, CRUD)

**Analog:** `apps-script/adminApi.gs` `createBatch()` recipe_snapshot write (lines 1809–1820) — establishes raw `setValue()` bypass pattern for recipe_snapshot

**Current `allowedFields` array** (lines 1982–1989 — MISSING recipe_id and recipe_snapshot):
```javascript
var allowedFields = [
  'status', 'vessel_id', 'shelf_id', 'bin_id', 'notes',
  'zoho_so_number', 'customer_id', 'customer_name', 'product_name',
  'customer_firstname', 'customer_lastname',
  'fermentation_started_at', 'completed_at'
];
```

**Required patch** — add recipe_id to allowedFields (safe for sanitizeInput); handle recipe_snapshot separately:
```javascript
// STEP 1: Add recipe_id to allowedFields (sanitizeInput is safe for short IDs)
var allowedFields = [
  'status', 'vessel_id', 'shelf_id', 'bin_id', 'notes',
  'zoho_so_number', 'customer_id', 'customer_name', 'product_name',
  'customer_firstname', 'customer_lastname',
  'fermentation_started_at', 'completed_at',
  'recipe_id'   // Phase 16: recipe_id safe through sanitizeInput
];
allowedFields.forEach(function (field) {
  if (updates[field] !== undefined) {
    var colIndex = headers.indexOf(field);
    if (colIndex !== -1) {
      sheet.getRange(row, colIndex + 1).setValue(sanitizeInput(String(updates[field])));
    }
  }
});

// STEP 2: Handle recipe_snapshot separately — raw setValue, bypass sanitizeInput
// (sanitizeInput strips <style>, <script> etc. which are harmless in JSON but break parse)
// This mirrors createBatch() line 1819 which also uses raw setValue for recipe_snapshot.
if (updates.recipe_snapshot !== undefined) {
  // Basic validation before writing
  try { JSON.parse(updates.recipe_snapshot); } catch (e) {
    return { ok: false, error: 'invalid_snapshot', message: 'recipe_snapshot is not valid JSON' };
  }
  var snapCol = headers.indexOf('recipe_snapshot');
  if (snapCol !== -1) {
    sheet.getRange(row, snapCol + 1).setValue(updates.recipe_snapshot); // raw — no sanitizeInput
  }
}
```

**Why raw `setValue()` for snapshot** — `sanitizeInput` definition (lines 2925–2955) strips `<script>`, `<style>`, `<iframe>` tags and `javascript:` strings. These patterns can legitimately appear in serialized JSON (e.g., ingredient names, style notes) and would silently corrupt the snapshot. `createBatch()` already uses raw `setValue()` at line 1819 for the same reason.

**Headers array reuse** — `updateBatch()` fetches headers at line ~1908. Use that array directly; do not re-fetch:
```javascript
// At top of updateBatch() (existing):
var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
// ... later use headers.indexOf('recipe_snapshot') — no second fetch needed
```

---

## Shared Patterns

### adminApiPost — Apps Script RPC wrapper
**Source:** `js/brewpad.js` lines 623–640
**Apply to:** All `update_batch` calls in `renderBatchDetail` recipe section
```javascript
function adminApiPost(action, payload) {
  if (!SHEETS_CONFIG.ADMIN_API_URL) return Promise.reject(new Error('Admin API not configured'));
  payload.action = action;
  payload.token = accessToken;
  return fetchWithRetry(SHEETS_CONFIG.ADMIN_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(payload)
  })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (!data.ok) {
        if (isUnauthorizedError(data)) handleUnauthorized();
        throw new Error(data.message || data.error || 'API error');
      }
      return data;
    });
}
```

### XSS Protection (escapeHTML)
**Source:** `js/brewpad.js` lines 6–12
**Apply to:** All rendered recipe fields (name, style, abv, ibu, batch_size_l, ingredient names, notes)
```javascript
function escapeHTML(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
```

### Error / Toast Pattern
**Source:** `js/brewpad.js` lines 2915–2918, 2034–2040
**Apply to:** All async operations (fetch, adminApiPost) in brewpad.js and admin.js kiosk section
```javascript
// On success:
showToast('Description of what saved', 'success');
// On failure:
showToast('Failed: ' + err.message, 'error');
// Disable button during request; re-enable on error:
submitBtn.disabled = true;
// ...in .catch: submitBtn.disabled = false;
```

### Middleware fetch with API key
**Source:** `js/admin.js` lines 10170–10174 (`kioskLoadRecipes`) and lines 8027–8033 (`getRecipesMwHeaders`)
**Apply to:** All `fetch(/api/recipes/...)` calls in both brewpad.js and admin.js kiosk
```javascript
var headers = { 'Content-Type': 'application/json' };
if (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.MW_API_KEY) {
  headers['x-api-key'] = SHEETS_CONFIG.MW_API_KEY;
}
fetch(mwUrl() + '/api/recipes/' + encodeURIComponent(recipeId), { headers: headers })
  .then(function (r) { return r.json(); })
  .then(function (data) { /* ... */ })
  .catch(function (err) { showToast('Failed: ' + err.message, 'error'); });
```

### Dropdown search / vessel-wrap pattern
**Source:** `js/brewpad.js` lines 2923–2971 (`bindProductSearch`) and `css/brewpad.css` lines 763–820 (`.bp-vessel-wrap`, `.bp-vessel-dropdown`, `.bp-vessel-option`)
**Apply to:** Recipe tab in picker, Attach Recipe inline search
```javascript
// bp-vessel-option mousedown uses e.preventDefault() to prevent input blur before selection
opt.addEventListener('mousedown', function (e) {
  e.preventDefault();
  // set hidden fields, close dropdown
  dropdown.style.display = 'none';
});
// blur handler hides dropdown with 200ms delay (gives mousedown time to fire)
input.addEventListener('blur', function () {
  setTimeout(function () { dropdown.style.display = 'none'; }, 200);
});
```

### Slide-out sheet pattern (for "Create Recipe from Batch")
**Source:** `js/brewpad.js` lines 2723–2749 (`openCreateSheet`/`closeCreateSheet`) and `css/brewpad.css` lines 1169–1190
**Apply to:** "Create Recipe" flow from kit batch detail
```javascript
function openCreateSheet() {
  var sheet = document.getElementById('bp-create-sheet');
  var inner = document.getElementById('bp-create-sheet-inner');
  if (!sheet || !inner) return;
  sheet.style.display = '';
  setTimeout(function () { sheet.classList.add('bp-create-sheet--open'); }, 10);
  // build form into inner, wire backdrop tap to dismiss
}
function closeCreateSheet() {
  var sheet = document.getElementById('bp-create-sheet');
  if (!sheet) return;
  sheet.classList.remove('bp-create-sheet--open');
  setTimeout(function () { sheet.style.display = 'none'; }, 180);
}
// CSS: .bp-create-sheet { position:absolute;inset:0;z-index:500;background:rgba(44,34,24,0.4); }
// .bp-create-sheet-inner { transform:translateY(100%); transition:transform 0.18s; }
// .bp-create-sheet--open .bp-create-sheet-inner { transform:translateY(0); }
```

### .bp-detail-section CSS
**Source:** `css/brewpad.css` lines 734–747
**Apply to:** Recipe section outer wrapper
```css
.bp-detail-section { margin-bottom: 18px; }
.bp-detail-section-title {
  font-size: 0.75rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.06em; color: var(--ink-tertiary);
  margin-bottom: 8px; padding-bottom: 4px;
  border-bottom: 1px solid var(--ledger-soft);
}
```

### Kiosk product card CSS
**Source:** `css/kiosk.css` lines 498–517
**Apply to:** Recipe cards in kiosk grid (already use `.kiosk-product-card.kiosk-recipe-card`)
```css
.kiosk-product-card {
  display: flex; flex-direction: column;
  background: var(--cellar-raised); border: 1px solid var(--ledger-soft);
  border-radius: 8px; cursor: pointer; min-height: 180px;
}
.kiosk-product-card:hover { border-color: var(--barrel); }
```

---

## No Analog Found

None — all Phase 16 changes build directly on existing patterns in the same files.

---

## Critical Findings

### sanitizeInput is SAFE for recipe_snapshot — with one caveat
`sanitizeInput()` (lines 2925–2954) only strips HTML tags (`<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`) and event handler attributes (`onclick=...`). Plain JSON curly braces `{}`, square brackets `[]`, and quote characters are NOT affected. However, if any ingredient name contains a literal `<style>` or `<script>` substring (pathological but possible), sanitizeInput would corrupt the JSON. The safe pattern — matching `createBatch()` line 1819 — is to bypass sanitizeInput with raw `setValue()` after confirming the value is valid JSON via `JSON.parse()`. Use this same approach in `updateBatch()`.

### recipe_snapshot must be trimmed before writing
Apps Script Sheets cells have a 50,000 character limit. The snapshot must contain only essential fields: `{ name, style, abv, ibu, batch_size_l, ingredients: [{ item_id, item_name, quantity, unit }] }`. Strip availability, computed_price, stock hints — these are computed at runtime.

### Tab state guard in `showProductOptions`
`bindProductSearch()` must add a `if (_productPickerTab !== 'kits') return;` guard at the top of `showProductOptions()`, or the kit dropdown will fire when the Recipes tab is active and the user clicks the search input.

---

## Metadata

**Analog search scope:** `js/brewpad.js` (4,506 lines), `js/admin.js` (10,678 lines), `apps-script/adminApi.gs`, `css/brewpad.css`, `css/kiosk.css`
**Files scanned:** 5 source files
**Pattern extraction date:** 2026-05-17
