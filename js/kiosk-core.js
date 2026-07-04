// ===== Steins & Vines Kiosk Core (shared cart/payment/void logic) =====
// Extracted, environment-agnostic core shared by the standalone kiosk
// (js/kiosk.js) and the admin-embedded kiosk tab (js/admin.js). Phase 48
// de-fork: this file is the single source of truth for kiosk cart/payment/
// void logic (D-01).  Attaches window.KioskCore in the browser and
// module.exports under Node/Jest.
//
// 48-02 populates the non-payment surface: cart building, catalog/recipe
// rendering, totals (incl. the discount branch), and the full product-type
// discount subsystem (D-04, D-06 naming — public names drop the "kiosk"
// prefix). Payment/checkout/dual-cart migration is 48-03; admin consumption
// is 48-04.
//
// Environment-injection seam (D-02): the two real environment differences
// between the standalone kiosk and the admin-embedded kiosk tab are (1) the
// auth mechanism used on outgoing fetch calls and (2) a handful of pieces of
// cart/sale state (and the payment-path functions that own them) that are
// NOT part of this plan's migration scope — js/kiosk.js's kioskProceedToPayment
// / kioskShowReceipt / kioskCheckTerminal / kioskSetTerminalStatus / the
// custom-item + gift-card-issue modals / the imported-SO tracking vars are
// explicitly deferred to 48-03 (payment path) and are intentionally left
// UNTOUCHED in js/kiosk.js this plan. Because those not-yet-migrated
// functions read/write cart, discount, gift-card, customer, recipe-context,
// modified-ingredients and imported-SO state directly, that specific state
// cannot be physically relocated into this closure without editing the
// deferred payment path — so KioskCore.init(env) accepts get/set callbacks
// for exactly that subset (bridging, not owning, until 48-03 completes the
// migration and these become plain internal vars here too). All OTHER
// module-scope kiosk state (recipe browse, product filters/view mode,
// quote, availability, ingredient-modify-panel, discount presets, ...) is
// NOT touched by the deferred functions and is physically relocated into
// this closure's private state below, exposed via KioskCore accessors only
// where js/kiosk.js's remaining (non-deferred) code still needs them.

(function () {
  'use strict';

  // ===== Environment injection seam (D-02/D-06) =====
  var _kcEnv = {
    mwUrl: '',
    buildAuthOptions: function () {
      return {};
    },
    // ---- State bridged from the consumer (owned there until 48-03) ----
    getCart: function () { return {}; },
    setCart: function () {},
    getDiscount: function () { return null; },
    setDiscount: function () {},
    getGiftCard: function () { return null; },
    setGiftCard: function () {},
    getCustomer: function () { return null; },
    setCustomer: function () {},
    getRecipeContext: function () { return null; },
    setRecipeContext: function () {},
    getModifiedIngredients: function () { return null; },
    setModifiedIngredients: function () {},
    getImportedSoId: function () { return null; },
    getImportedSoNumber: function () { return null; },
    // ---- Behavior hooks bridging to not-yet-migrated payment-path code ----
    proceedToPayment: function () {},
    startCheckout: function () {},
    showCustomItemModal: function () {},
    showGiftCardIssueModal: function () {},
    clearImportedSo: function () {}
  };

  function kcInit(env) {
    if (!env) {
      return;
    }
    if (typeof env.mwUrl !== 'undefined') {
      _kcEnv.mwUrl = env.mwUrl;
    }
    if (typeof env.buildAuthOptions === 'function') {
      _kcEnv.buildAuthOptions = env.buildAuthOptions;
    }
    var bridgedFns = [
      'getCart', 'setCart', 'getDiscount', 'setDiscount', 'getGiftCard', 'setGiftCard',
      'getCustomer', 'setCustomer', 'getRecipeContext', 'setRecipeContext',
      'getModifiedIngredients', 'setModifiedIngredients', 'getImportedSoId', 'getImportedSoNumber',
      'proceedToPayment', 'startCheckout', 'showCustomItemModal', 'showGiftCardIssueModal',
      'clearImportedSo'
    ];
    bridgedFns.forEach(function (name) {
      if (typeof env[name] === 'function') {
        _kcEnv[name] = env[name];
      }
    });
  }

  // Shallow-merges the injected auth options (headers / credentials) into a
  // fetch options object. This is the ONE real environment difference
  // (x-device-token header on the standalone kiosk vs. credentials:'include'
  // on the admin-embedded kiosk) — every outgoing fetch in this file routes
  // through it (PATTERNS.md auth-seam pattern).
  function _kcMergeAuth(opts) {
    opts = opts || {};
    var auth = _kcEnv.buildAuthOptions() || {};
    if (auth.headers) {
      opts.headers = opts.headers || {};
      for (var k in auth.headers) {
        if (Object.prototype.hasOwnProperty.call(auth.headers, k)) {
          opts.headers[k] = auth.headers[k];
        }
      }
    }
    if (typeof auth.credentials !== 'undefined') {
      opts.credentials = auth.credentials;
    }
    return opts;
  }

  // ===== Shared Utilities (standalone-bundle copies — kiosk.js/admin.js each
  // carry their own copy of these too; this file is a third independent
  // bundle so it carries its own, matching the existing project convention) =====

  // escapeHTML — canonical apostrophe-escaping implementation (mirrors js/lib/utils.js).
  function escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function removeToast(toast) {
    if (toast._removed) return;
    toast._removed = true;
    clearTimeout(toast._timer);
    toast.classList.add('removing');
    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 150);
  }

  function showToast(message, type, opts) {
    if (!type) type = 'info';
    if (!opts) opts = {};
    var container = document.getElementById('kiosk-toast-container');
    if (!container) return;

    var toast = document.createElement('div');
    toast.className = 'admin-toast admin-toast--' + type;

    var msgSpan = document.createElement('span');
    msgSpan.className = 'admin-toast-msg';
    msgSpan.textContent = message;
    toast.appendChild(msgSpan);

    if (opts.undo) {
      var undoBtn = document.createElement('button');
      undoBtn.className = 'admin-toast-undo';
      undoBtn.textContent = 'Undo';
      undoBtn.addEventListener('click', function () {
        opts.undo();
        removeToast(toast);
      });
      toast.appendChild(undoBtn);
    }

    var closeBtn = document.createElement('button');
    closeBtn.className = 'admin-toast-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', function () { removeToast(toast); });
    toast.appendChild(closeBtn);

    container.appendChild(toast);

    var duration = opts.duration || (type === 'error' ? 6000 : 3500);
    var timer = setTimeout(function () { removeToast(toast); }, duration);
    toast._timer = timer;
  }

  // ===== Fee constants (mirrors js/kiosk.js — standalone bundle, own copy) =====
  var MAKERS_FEE = 45; // Added to kit rates for in-store pricing
  var MAKERS_FEE_SKU = 'MAKERS-FEE';
  var MATERIALS_FEE = 5; // Materials fee (corks etc.) — carries PST
  var MATERIALS_FEE_SKU = 'MAT-FEE';
  var KIOSK_TAX_RATE_DEFAULT = 0.05; // 5% GST fallback when item has no tax_percentage

  // ===== Module-scope state relocated into this closure (D-02) =====
  // None of this state is read/written by js/kiosk.js's deferred payment-path
  // functions (kioskProceedToPayment/kioskShowReceipt/terminal/SO-checkout-fork),
  // so it is safe to own here outright.
  var _kioskProducts = [];
  var _kioskRecipes = [];
  var _kioskMakersFeeWaived = false;
  var _kioskProductsLoaded = false;
  var _kioskProductsLoading = false;
  var _kioskCurrentView = 'browse';
  var _kioskMode = 'products';
  var _kioskRecipesLoaded = false;
  var _kioskRecipesLoading = false;
  var _kioskSelectedRecipe = null;
  var _kioskSaleType = null;
  var _kioskMillGrain = false;
  var _kioskRecipeAvailability = null;
  var _kioskTargetVolumeL = null;
  var _kioskScaleFactor = 1.0;
  var _kioskStockOverride = false;
  var _kioskQuote = null;
  var _kioskQuoteTimer = null;
  var _kioskModifyPanelOpen = false;
  var _kioskIngredientCatalog = [];
  var _kioskCatalogLoaded = false;
  var _kioskFilters = {
    search: '',
    category: '',
    type: '',
    stockStatus: '',
    hideOos: false,
    sort: 'name-asc'
  };
  var _kioskViewMode = (typeof localStorage !== 'undefined' && localStorage.getItem('sv-kiosk-view-mode')) || 'grid';
  var _kioskDiscountPresets = [];
  var _kioskEditingDiscountId = null; // null = creating a new preset; id = editing existing

  // ===== Cart building / catalog / render / totals (48-02 Task 1) =====

  function kioskFmt(amount) {
    return '$' + (parseFloat(amount) || 0).toFixed(2);
  }

  function kioskRenderRecipeIngredients(ingredients, el) {
    if (!el || !ingredients) return;
    var groups = (typeof groupRecipeIngredients === 'function')
      ? groupRecipeIngredients(ingredients)
      : [{ label: '', count: ingredients.length, items: ingredients }];
    var html = '';
    groups.forEach(function (group) {
      html += group.label
        ? '<strong>' + escapeHTML(group.label) + ' (' + group.count + ')</strong>'
        : '<strong>Ingredients:</strong>';
      html += '<ul style="margin:0.25rem 0;padding-left:1.25rem;">';
      group.items.forEach(function (ing) {
        html += '<li>' + escapeHTML(ing.item_name) + ' — ' + escapeHTML(String(ing.quantity || '')) + ' ' + escapeHTML(ing.unit || '') + '</li>';
      });
      html += '</ul>';
    });
    el.innerHTML = html;
  }

  // Fetch a dry-run quote from GET /api/kiosk/recipe-quote.
  // On success: store _kioskQuote and update Add-to-Cart button price.
  // On error: clear _kioskQuote (display falls back to base price).
  // Call debounced via kioskScheduleRecipeQuote (350 ms).
  function kioskFetchRecipeQuote() {
    if (!_kioskSelectedRecipe) return;
    var mw = _kcEnv.mwUrl;
    var recipeId = _kioskSelectedRecipe.recipe_id;
    var targetVol = _kioskTargetVolumeL || (Number(_kioskSelectedRecipe.batch_size_l) || null);
    var saleType = _kioskSaleType || 'in-store';
    var url = mw + '/api/kiosk/recipe-quote?recipe_id=' + encodeURIComponent(recipeId) +
              '&sale_type=' + encodeURIComponent(saleType);
    if (targetVol) url += '&target_volume_l=' + encodeURIComponent(targetVol);
    var modifiedIngredients = _kcEnv.getModifiedIngredients();
    if (Array.isArray(modifiedIngredients)) {
      url += '&modified_ingredients=' + encodeURIComponent(JSON.stringify(modifiedIngredients));
    }
    var discount = _kcEnv.getDiscount();
    if (discount && discount.presetId) {
      url += '&discount_preset_id=' + encodeURIComponent(discount.presetId);
    }
    var previewEl = document.getElementById('kiosk-recipe-price-preview');
    if (previewEl) {
      previewEl.style.display = '';
      previewEl.innerHTML = '<span style="color:var(--ink-tertiary);">Calculating…</span>';
    }
    return fetch(url, _kcMergeAuth({}))
      .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
      .then(function (result) {
        if (result.status === 200 && result.data && result.data.ok &&
            result.data.recipe_id === recipeId) {
          _kioskQuote = result.data;
          var el = document.getElementById('kiosk-recipe-price-preview');
          if (el) {
            el.style.display = '';
            var total = typeof result.data.total === 'number' ? result.data.total : null;
            if (total !== null) {
              var disc = result.data.discount;
              var before = result.data.total_before_discount;
              if (disc && typeof before === 'number' && before > total) {
                el.innerHTML = 'Estimated total: <s style="color:var(--ink-tertiary);">' +
                  escapeHTML('$' + before.toFixed(2)) + '</s> <strong>' + escapeHTML('$' + total.toFixed(2)) + '</strong>' +
                  ' <span style="color:var(--cellar-green,#2e6e4e);">(' + escapeHTML(disc.name) + ')</span>';
              } else {
                el.innerHTML = 'Estimated total: <strong>' + escapeHTML('$' + total.toFixed(2)) + '</strong>';
              }
            } else {
              el.innerHTML = '<span style="color:var(--batch-danger);">Price unavailable — check connection</span>';
            }
          }
          var summaryPriceEl = document.getElementById('kiosk-recipe-summary-price');
          if (summaryPriceEl) {
            if (total !== null) {
              summaryPriceEl.textContent = kioskFmt(total) + ' per batch';
            } else {
              summaryPriceEl.textContent = 'Price calculated at checkout';
            }
          }
          if (Array.isArray(result.data.ingredients) && result.data.ingredients.length > 0) {
            var ingListEl = document.getElementById('kiosk-recipe-ingredients');
            if (ingListEl) {
              kioskRenderRecipeIngredients(result.data.ingredients, ingListEl);
            }
          }
          kioskUpdateAddToCartButton();
        } else {
          _kioskQuote = null;
          var errEl = document.getElementById('kiosk-recipe-price-preview');
          if (errEl) {
            errEl.style.display = '';
            errEl.innerHTML = '<span style="color:var(--batch-danger);">Price unavailable — check connection</span>';
          }
          kioskUpdateAddToCartButton();
        }
      })
      .catch(function () {
        _kioskQuote = null;
        var errEl2 = document.getElementById('kiosk-recipe-price-preview');
        if (errEl2) {
          errEl2.style.display = '';
          errEl2.innerHTML = '<span style="color:var(--batch-danger);">Price unavailable — check connection</span>';
        }
        kioskUpdateAddToCartButton();
      });
  }

  function kioskScheduleRecipeQuote() {
    if (_kioskQuoteTimer) clearTimeout(_kioskQuoteTimer);
    _kioskQuoteTimer = setTimeout(kioskFetchRecipeQuote, 350);
  }

  // ---- Ingredient catalog for modify panel autocomplete ----

  function kioskLoadIngredientCatalog() {
    if (_kioskCatalogLoaded) return;
    var mw = _kcEnv.mwUrl;
    if (!mw) return;
    fetch(mw + '/api/ingredients?include_internal=1', _kcMergeAuth({}))
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
      .then(function (data) {
        _kioskIngredientCatalog = data.items || data.ingredients || data || [];
        _kioskCatalogLoaded = true;
      })
      .catch(function () { /* non-fatal */ });
  }

  // ---- Modify panel row rendering ----

  // Render editable ingredient rows grouped by cf_type into #kiosk-modify-tbody.
  // data-ing-idx maps to the ORIGINAL flat array index via ingredients.indexOf(ing) (caveat #7).
  function renderKioskModifyRows() {
    var tbody = document.getElementById('kiosk-modify-tbody');
    if (!tbody) return;
    var ingredients = _kcEnv.getModifiedIngredients();
    if (!ingredients || ingredients.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="kiosk-modify-empty">' +
        'No ingredients — use ‘+ Add Ingredient’ to build a custom list</td></tr>';
      return;
    }
    var groups = (typeof groupRecipeIngredients === 'function')
      ? groupRecipeIngredients(ingredients)
      : [{ label: '', count: ingredients.length, items: ingredients }];
    var html = '';
    groups.forEach(function (group) {
      if (group.label) {
        html += '<tr class="kiosk-modify-group-header"><td colspan="4" style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--ink-tertiary);">' +
          escapeHTML(group.label) + ' (' + group.count + ')</td></tr>';
      }
      group.items.forEach(function (ing) {
        var idx = ingredients.indexOf(ing); // CRITICAL: original flat-array index (caveat #7)
        var qtyVal = typeof ing.quantity !== 'undefined' ? ing.quantity : (ing.base_quantity || '');
        html += '<tr class="kiosk-modify-row" data-ing-idx="' + idx + '">';
        html += '<td class="ing-autocomplete-wrap"><input type="text" class="admin-input ing-search" ' +
          'style="font-size:1rem;" value="' +
          escapeHTML(ing.item_name || '') + '" autocomplete="off" /></td>';
        html += '<td><input type="number" class="admin-input ing-qty" step="0.01" min="0" ' +
          'inputmode="decimal" style="font-size:1rem;" value="' +
          escapeHTML(String(qtyVal)) + '" /></td>';
        html += '<td class="ing-unit">' + escapeHTML(ing.unit || '') + '</td>';
        html += '<td><button type="button" class="btn-secondary ing-remove" aria-label="Remove ' +
          escapeHTML(ing.item_name || '') + '">&#10005;</button></td>';
        html += '</tr>';
      });
    });
    tbody.innerHTML = html;
    attachKioskModifyRowListeners();
  }

  // Attach event listeners for remove, qty change, and search autocomplete on modify rows.
  function attachKioskModifyRowListeners() {
    var tbody = document.getElementById('kiosk-modify-tbody');
    if (!tbody) return;

    tbody.querySelectorAll('.ing-remove').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var row = btn.closest('.kiosk-modify-row');
        var idx = parseInt(row && row.getAttribute('data-ing-idx'), 10);
        var modifiedIngredients = _kcEnv.getModifiedIngredients();
        if (isNaN(idx) || idx < 0 || !modifiedIngredients) return;
        modifiedIngredients.splice(idx, 1);
        renderKioskModifyRows();
        kioskScheduleRecipeQuote();
      });
    });

    tbody.querySelectorAll('.ing-qty').forEach(function (input) {
      input.addEventListener('change', function () {
        var row = input.closest('.kiosk-modify-row');
        var idx = parseInt(row && row.getAttribute('data-ing-idx'), 10);
        var modifiedIngredients = _kcEnv.getModifiedIngredients();
        if (!isNaN(idx) && modifiedIngredients && modifiedIngredients[idx]) {
          modifiedIngredients[idx].quantity = parseFloat(input.value) || 0;
        }
        kioskScheduleRecipeQuote();
      });
    });

    tbody.querySelectorAll('.ing-search').forEach(function (input) {
      input.addEventListener('input', function () {
        kioskShowIngredientAutocomplete(input);
      });
      input.addEventListener('focus', function () {
        if (!input.value) kioskShowIngredientAutocomplete(input);
      });
      input.addEventListener('blur', function () {
        setTimeout(function () { kioskHideIngredientAutocomplete(input); }, 200);
      });
    });
  }

  // Simple autocomplete for the modify panel using _kioskIngredientCatalog
  function kioskShowIngredientAutocomplete(input) {
    kioskHideIngredientAutocomplete(input);
    var q = (input.value || '').toLowerCase().trim();
    var matches = _kioskIngredientCatalog.filter(function (item) {
      return (item.item_name || item.name || '').toLowerCase().indexOf(q) !== -1;
    }).slice(0, 8);
    if (!matches.length) return;
    var drop = document.createElement('div');
    drop.className = 'ing-autocomplete-drop';
    matches.forEach(function (item) {
      var opt = document.createElement('div');
      opt.setAttribute('role', 'option');
      opt.style.cssText = 'cursor:pointer;';
      opt.textContent = item.item_name || item.name || '';
      opt.addEventListener('mousedown', function (e) {
        e.preventDefault();
        input.value = item.item_name || item.name || '';
        var row = input.closest('.kiosk-modify-row');
        var idx = parseInt(row && row.getAttribute('data-ing-idx'), 10);
        var modifiedIngredients = _kcEnv.getModifiedIngredients();
        if (!isNaN(idx) && modifiedIngredients && modifiedIngredients[idx]) {
          modifiedIngredients[idx].item_id = item.item_id || '';
          modifiedIngredients[idx].item_name = item.item_name || item.name || '';
          modifiedIngredients[idx].unit = item.unit || item.purchase_unit || '';
          var unitCell = row ? row.querySelector('.ing-unit') : null;
          if (unitCell) unitCell.textContent = modifiedIngredients[idx].unit;
        }
        kioskHideIngredientAutocomplete(input);
        kioskScheduleRecipeQuote();
      });
      drop.appendChild(opt);
    });
    var wrap = input.closest('.ing-autocomplete-wrap') || input.parentNode;
    if (wrap) {
      wrap.style.position = 'relative';
      wrap.appendChild(drop);
    }
  }

  function kioskHideIngredientAutocomplete(input) {
    var wrap = input.closest('.ing-autocomplete-wrap') || input.parentNode;
    if (!wrap) return;
    var drops = wrap.querySelectorAll('.ing-autocomplete-drop');
    drops.forEach(function (d) { d.parentNode.removeChild(d); });
  }

  // Returns item rate including maker's fee + materials fee for kits
  function kioskEffectiveRate(product) {
    var base = parseFloat(product.rate) || 0;
    return (kioskGetItemType(product) === 'kit') ? base + MAKERS_FEE + MATERIALS_FEE : base;
  }

  function kioskGetItemType(p) {
    var ptype = (p.product_type || '').toLowerCase();
    if (ptype === 'service') return 'service';
    var cfType = (p.cf_type || '').toLowerCase();
    if (cfType === 'consignment') return 'consignment';
    if (cfType && typeof KIT_CATEGORIES !== 'undefined' && KIT_CATEGORIES.indexOf(cfType) !== -1) return 'kit';
    if (cfType === 'ingredient') return 'ingredient';
    if (ptype === 'inventory' || ptype === 'goods') return 'ingredient';
    return ptype || 'other';
  }

  function kioskIsConsignment(p) {
    return kioskGetItemType(p) === 'consignment';
  }

  function kioskItemCategory(p) {
    return p.category_name || '';
  }

  function kioskIsWeightItem(p) {
    return (p.unit || '').toLowerCase() === 'kg';
  }

  // Stock overflow warning — fires when cart qty would exceed stock_on_hand (D-01, D-02, D-03)
  function kioskCheckStockOverflow(product, newQty) {
    var stock = parseFloat(product.stock_on_hand) || 0;
    var isService = (product.product_type || '').toLowerCase() === 'service';
    if (isService || kioskIsWeightItem(product) || stock <= 0) return true;
    if (newQty > stock) {
      var name = product.name || 'This item';
      return confirm('"' + name + '" — only ' + stock + ' in stock, cart would have ' + newQty + '. Add anyway?');
    }
    return true;
  }

  function kioskItemTax(item, qty) {
    var rate = parseFloat(item.rate) || 0;
    var pct = parseFloat(item.tax_percentage) || 0;
    return parseFloat((rate * qty * pct / 100).toFixed(2));
  }

  function kioskCartIsEmpty() {
    return Object.keys(_kcEnv.getCart()).length === 0;
  }

  function kioskCartHasKits() {
    var cart = _kcEnv.getCart();
    return Object.keys(cart).some(function (id) {
      return kioskGetItemType(cart[id].item) === 'kit';
    });
  }

  function kioskFindMakersFee() {
    for (var i = 0; i < _kioskProducts.length; i++) {
      if ((_kioskProducts[i].sku || '').toUpperCase() === MAKERS_FEE_SKU) return _kioskProducts[i];
    }
    return null;
  }

  function kioskFindMaterialsFee() {
    for (var i = 0; i < _kioskProducts.length; i++) {
      if ((_kioskProducts[i].sku || '').toUpperCase() === MATERIALS_FEE_SKU) return _kioskProducts[i];
    }
    return null;
  }

  function kioskCountKitsInCart() {
    var count = 0;
    var cart = _kcEnv.getCart();
    var keys = Object.keys(cart);
    for (var i = 0; i < keys.length; i++) {
      var entry = cart[keys[i]];
      if (entry.item && kioskGetItemType(entry.item) === 'kit') {
        count += entry.qty;
      }
    }
    return count;
  }

  function kioskSyncKitFees() {
    if (_kioskMakersFeeWaived) return;
    var cart = _kcEnv.getCart();
    var makersFee = kioskFindMakersFee();
    var materialsFee = kioskFindMaterialsFee();
    var totalKits = kioskCountKitsInCart();
    if (totalKits > 0) {
      if (makersFee) cart[makersFee.item_id] = { item: makersFee, qty: totalKits };
      if (materialsFee) cart[materialsFee.item_id] = { item: materialsFee, qty: totalKits };
    } else {
      if (makersFee) delete cart[makersFee.item_id];
      if (materialsFee) delete cart[materialsFee.item_id];
      _kioskMakersFeeWaived = false;
    }
  }

  function kioskIsKitFee(item) {
    var sku = (item.sku || '').toUpperCase();
    return sku === MAKERS_FEE_SKU || sku === MATERIALS_FEE_SKU;
  }

  function kioskFindProductById(itemId) {
    if (!itemId) return null;
    for (var i = 0; i < _kioskProducts.length; i++) {
      if (_kioskProducts[i].item_id === itemId) return _kioskProducts[i];
    }
    return null;
  }

  function kioskR2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  function kioskCalcTotals() {
    var cart = _kcEnv.getCart();
    var ids = Object.keys(cart);
    var subtotal = 0;
    ids.forEach(function (id) {
      var entry = cart[id];
      if (!entry || !entry.item) return; // skip non-item entries (defensive guard)
      subtotal += (parseFloat(entry.item.rate) || 0) * entry.qty;
    });
    subtotal = kioskR2(subtotal);

    var lineDiscount = {};
    var discountAmount = 0;
    var discount = _kcEnv.getDiscount();
    var recipeContext = _kcEnv.getRecipeContext();

    if (discount) {
      if (recipeContext) {
        // Recipe cart: the discount is server-authoritative — the discount-aware
        // quote already computed it against the recipe's product/fee portions.
        discountAmount = (_kioskQuote && _kioskQuote.discount && typeof _kioskQuote.discount.amount === 'number')
          ? _kioskQuote.discount.amount : 0;
        discountAmount = Math.min(discountAmount, subtotal);
      } else {
        // Standard cart: discount only the lines whose product type matches.
        var scope = discount.scope;
        var matchedIds = [];
        var matchedSubtotal = 0;
        ids.forEach(function (id) {
          var entry = cart[id];
          if (!entry || !entry.item) return;
          if (entry.item.custom || entry.item.gift_cert) return; // D-08: custom/gift_cert lines are never discounted
          var m;
          if (scope === 'cart') {
            m = true;
          } else if (scope === 'type' && typeof discountMatches === 'function') {
            m = discountMatches(classifyDiscountItem(entry.item), discount.applies_to || []);
          } else {
            m = false;
          }
          if (m) {
            matchedIds.push(id);
            matchedSubtotal += (parseFloat(entry.item.rate) || 0) * entry.qty;
          }
        });
        matchedSubtotal = kioskR2(matchedSubtotal);

        if (discount.type === 'percentage') {
          matchedIds.forEach(function (id) {
            var entry = cart[id];
            var lt = (parseFloat(entry.item.rate) || 0) * entry.qty;
            var d = kioskR2(lt * discount.value / 100);
            lineDiscount[id] = d;
            discountAmount += d;
          });
          discountAmount = kioskR2(discountAmount);
        } else {
          var fixed = Math.min(parseFloat(discount.value) || 0, matchedSubtotal);
          var remaining = fixed;
          matchedIds.forEach(function (id, k) {
            var entry = cart[id];
            var lt = (parseFloat(entry.item.rate) || 0) * entry.qty;
            var d;
            if (k === matchedIds.length - 1) {
              d = remaining;
            } else {
              d = matchedSubtotal > 0 ? kioskR2(fixed * (lt / matchedSubtotal)) : 0;
              remaining = kioskR2(remaining - d);
            }
            if (d > lt) d = lt;
            lineDiscount[id] = d;
          });
          discountAmount = kioskR2(fixed);
        }
      }
    }

    // Per-item tax using catalog tax_percentage (matches server-side calculation)
    var taxTotal = 0;
    ids.forEach(function (id) {
      var entry = cart[id];
      if (!entry || !entry.item) return;
      var lt = (parseFloat(entry.item.rate) || 0) * entry.qty;
      var d = lineDiscount[id] || 0;
      // Recipe cart uses a uniform ratio (recipe lines are mostly tax-exempt anyway).
      if (recipeContext && discountAmount > 0 && subtotal > 0) {
        d = kioskR2(lt * (discountAmount / subtotal));
      }
      var taxable = Math.max(lt - d, 0);
      var pct = parseFloat(entry.item.tax_percentage);
      if (isNaN(pct)) pct = KIOSK_TAX_RATE_DEFAULT * 100;
      taxTotal += taxable * (pct / 100);
    });
    taxTotal = kioskR2(taxTotal);

    return {
      subtotal: subtotal,
      discount: kioskR2(discountAmount),
      tax: taxTotal,
      total: kioskR2(subtotal - discountAmount + taxTotal)
    };
  }

  // ===== View Switching =====

  function kioskShowView(name) {
    var views = ['browse', 'browse-customer', 'customer', 'payment', 'review-batches', 'receipt', 'error', 'collect', 'create-so'];
    views.forEach(function (v) {
      var el = document.getElementById('kiosk-view-' + v);
      if (el) el.style.display = (v === name) ? '' : 'none';
    });
    _kioskCurrentView = name;
    if (name === 'browse') {
      var bmBtn = document.getElementById('kiosk-browse-mode-btn');
      if (bmBtn) bmBtn.style.display = '';
    }
  }

  // ===== Recipe Browser Mode Toggle =====

  function kioskSetMode(mode) {
    _kioskMode = mode;
    var prodGrid = document.getElementById('kiosk-product-grid');
    var recipeGrid = document.getElementById('kiosk-recipe-grid');
    var recipePrompt = document.getElementById('kiosk-recipe-prompt');
    var searchBar = document.querySelector('.kiosk-search-bar');
    var filterBar = document.querySelector('.kiosk-filter-bar');
    var resultCount = document.getElementById('kiosk-result-count');

    if (prodGrid) prodGrid.style.display = mode === 'products' ? '' : 'none';
    if (recipeGrid) recipeGrid.style.display = mode === 'recipes' ? 'grid' : 'none';
    if (recipePrompt) {
      recipePrompt.style.display = 'none';
      recipePrompt.classList.remove('kiosk-recipe-prompt-view');
    }
    if (searchBar) searchBar.style.display = mode === 'products' ? '' : 'none';
    if (filterBar) filterBar.style.display = mode === 'products' ? '' : 'none';
    if (resultCount) resultCount.style.display = mode === 'products' ? '' : 'none';

    var btns = document.querySelectorAll('.kiosk-mode-toggle__btn');
    btns.forEach(function (btn) {
      if (btn.getAttribute('data-mode') === mode) {
        btn.classList.add('kiosk-mode-toggle__btn--active');
      } else {
        btn.classList.remove('kiosk-mode-toggle__btn--active');
      }
    });

    if (mode === 'recipes' && !_kioskRecipesLoaded && !_kioskRecipesLoading) {
      kioskLoadRecipes();
    }
  }

  // ===== Load Products =====

  function kioskLoadProducts(forceRefresh) {
    if (_kioskProductsLoading) return;
    if (_kioskProductsLoaded && !forceRefresh) {
      kioskRenderProducts();
      return;
    }

    var mwUrl = _kcEnv.mwUrl;
    if (!mwUrl) {
      var grid = document.getElementById('kiosk-product-grid');
      if (grid) grid.innerHTML = '<p class="kiosk-loading">Middleware URL not configured.</p>';
      return;
    }

    _kioskProductsLoading = true;
    var grid = document.getElementById('kiosk-product-grid');
    if (grid) grid.innerHTML = '<p class="kiosk-loading">Loading products...</p>';

    var url = mwUrl + '/api/kiosk/products' + (forceRefresh ? '?bust=1' : '');
    fetch(url, _kcMergeAuth({}))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        _kioskProducts = data.items || [];
        _kioskProductsLoaded = true;
        _kioskProductsLoading = false;
        kioskPopulateCategories();
        kioskRenderProducts();
      })
      .catch(function (err) {
        _kioskProductsLoading = false;
        var grid2 = document.getElementById('kiosk-product-grid');
        if (grid2) grid2.innerHTML = '<p class="kiosk-loading">Failed to load products: ' + err.message + '</p>';
      });
  }

  // ===== Recipe Browser =====

  function kioskLoadRecipes(forceRefresh) {
    if (_kioskRecipesLoading) return;
    if (_kioskRecipesLoaded && !forceRefresh) {
      kioskRenderRecipes();
      return;
    }
    _kioskRecipesLoading = true;
    var grid = document.getElementById('kiosk-recipe-grid');
    if (grid) grid.innerHTML = '<p class="kiosk-loading">Loading recipes...</p>';
    var mw = _kcEnv.mwUrl;
    fetch(mw + '/api/recipes?status=active', _kcMergeAuth({}))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        _kioskRecipes = data.recipes || [];
        _kioskRecipesLoaded = true;
        _kioskRecipesLoading = false;
        kioskRenderRecipes();
      })
      .catch(function (err) {
        _kioskRecipesLoading = false;
        var grid2 = document.getElementById('kiosk-recipe-grid');
        if (grid2) grid2.innerHTML = '<p class="kiosk-loading">Failed to load recipes: ' + err.message + '</p>';
      });
  }

  function kioskRecipePrice(recipe) {
    if (recipe.pricing_mode === 'dynamic' && Number(recipe.computed_price) > 0) return recipe.computed_price;
    if (recipe.pricing_mode !== 'dynamic' && Number(recipe.locked_price) > 0) return recipe.locked_price;
    if (Number(recipe.computed_price) > 0) return recipe.computed_price;
    if (Number(recipe.locked_price) > 0) return recipe.locked_price;
    return 0;
  }

  // Returns the display price adjusted for sale type context.
  // Dynamic recipes: take-out excludes service_fee + materials_fee from computed_price.
  // Locked recipes: always use locked_price regardless of sale type.
  function kioskRecipePriceForContext(recipe, saleType) {
    if (!recipe) return 0;
    if (recipe.pricing_mode === 'dynamic') {
      var base = Number(recipe.computed_price);
      if (!(base > 0)) return Number(recipe.locked_price) > 0 ? Number(recipe.locked_price) : 0;
      if (saleType === 'take-out') {
        var serviceFee = Number(recipe.service_fee) || 0;
        var materialsFee = Number(recipe.materials_fee) || 0;
        var takeOut = Math.round((base - serviceFee - materialsFee) * 100) / 100;
        return takeOut > 0 ? takeOut : base;
      }
      return base;
    }
    return Number(recipe.locked_price) > 0 ? Number(recipe.locked_price) : 0;
  }

  function kioskRenderRecipes() {
    if (_kioskMode !== 'recipes') return;
    var grid = document.getElementById('kiosk-recipe-grid');
    if (!grid) return;
    if (_kioskRecipes.length === 0) {
      grid.innerHTML = '<div class="kiosk-cart-empty"><p><strong>No active recipes</strong></p><p>No recipes are currently active.</p></div>';
      return;
    }
    var html = '';
    _kioskRecipes.forEach(function (r) {
      html += '<div class="kiosk-product-card kiosk-recipe-card" data-recipe-id="' + escapeHTML(r.recipe_id || '') + '">';
      html += '<div class="kiosk-product-body">';
      html += '<div class="kiosk-type-badge kiosk-type-badge--kit">Recipe</div>';
      html += '<div class="kiosk-product-name">' + escapeHTML(r.name || '') + '</div>';
      html += '<div class="kiosk-product-sku">' + escapeHTML(r.style || '') + (r.abv ? ' &middot; ' + r.abv + '%' : '') + '</div>';
      var rPrice = kioskRecipePrice(r);
      html += '<div class="kiosk-product-price" data-recipe-price-id="' + escapeHTML(r.recipe_id || '') + '">' + (rPrice > 0 ? kioskFmt(rPrice) : 'Market price') + '</div>';
      html += '<div class="kiosk-product-stock">' + (r.pricing_mode === 'dynamic' ? 'based on ingredients' : 'incl. brewing fee') + '</div>';
      html += '</div></div>';
    });
    grid.innerHTML = html;

    grid.querySelectorAll('.kiosk-recipe-card').forEach(function (card) {
      card.addEventListener('click', function () {
        var recipeId = card.getAttribute('data-recipe-id');
        var recipe = null;
        for (var i = 0; i < _kioskRecipes.length; i++) {
          if (_kioskRecipes[i].recipe_id === recipeId) { recipe = _kioskRecipes[i]; break; }
        }
        if (recipe) kioskShowRecipePrompt(recipe);
      });
    });

    // Background-warm computed_price for dynamic recipes whose detail cache was cold.
    _kioskRecipes.forEach(function (r) {
      if (r.pricing_mode !== 'dynamic') return;
      if (Number(r.computed_price) > 0) return;
      if (r._fetchedDetail) {
        if (r._fetchedDetail.recipe && r._fetchedDetail.recipe.computed_price != null) { // eslint-disable-line eqeqeq -- intentional loose equality to match both null and undefined
          r.computed_price = r._fetchedDetail.recipe.computed_price;
          var priceCell = grid.querySelector('[data-recipe-price-id="' + r.recipe_id + '"]');
          if (priceCell) {
            var warm = Number(r.computed_price);
            priceCell.textContent = warm > 0 ? kioskFmt(warm) : 'Market price';
          }
        }
        return;
      }
      (function (recipe) {
        var mwWarm = _kcEnv.mwUrl;
        fetch(mwWarm + '/api/recipes/' + encodeURIComponent(recipe.recipe_id), _kcMergeAuth({}))
          .then(function (resp) { return resp.json(); })
          .then(function (data) {
            recipe._fetchedDetail = data;
            if (data.recipe) {
              if (data.recipe.computed_price != null) recipe.computed_price = data.recipe.computed_price; // eslint-disable-line eqeqeq -- intentional loose equality to match both null and undefined
              if (data.recipe.milling_fee_rate != null) recipe.milling_fee_rate = data.recipe.milling_fee_rate; // eslint-disable-line eqeqeq -- intentional loose equality to match both null and undefined
              var priceEl = grid.querySelector('[data-recipe-price-id="' + recipe.recipe_id + '"]');
              if (priceEl) {
                var warm = kioskRecipePrice(recipe);
                priceEl.textContent = warm > 0 ? kioskFmt(warm) : 'Market price';
              }
            }
          })
          .catch(function () {}); // silently ignore — card retains locked_price as fallback
      }(r));
    });
  }

  function kioskShowRecipePrompt(recipe) {
    _kioskSelectedRecipe = recipe;
    _kioskSaleType = null;
    _kioskMillGrain = false;
    _kioskRecipeAvailability = null;

    var grid = document.getElementById('kiosk-recipe-grid');
    var prompt = document.getElementById('kiosk-recipe-prompt');
    if (grid) grid.style.display = 'none';
    if (prompt) {
      prompt.style.display = '';
      prompt.classList.add('kiosk-recipe-prompt-view');
    }

    var nameEl = document.getElementById('kiosk-recipe-selected-name');
    if (nameEl) nameEl.textContent = recipe.name || '';

    var summaryEl = document.getElementById('kiosk-recipe-summary');
    if (summaryEl) {
      var summaryHtml = '<div style="margin:0.5rem 0;color:var(--ink-secondary);font-size:0.9rem;">';
      summaryHtml += escapeHTML(recipe.style || '') + (recipe.abv ? ' &middot; ' + recipe.abv + '% ABV' : '');
      summaryHtml += '</div>';
      summaryHtml += '<div id="kiosk-recipe-summary-price" style="font-size:1.1rem;font-weight:700;color:var(--barrel);margin:0.5rem 0;">';
      var promptPrice = kioskRecipePrice(recipe);
      if (promptPrice > 0) {
        summaryHtml += kioskFmt(promptPrice) + ' per batch';
        if (recipe.pricing_mode === 'dynamic') summaryHtml += ' (based on ingredients)';
      } else {
        summaryHtml += 'Price calculated at checkout';
      }
      summaryHtml += '</div>';
      summaryHtml += '<div id="kiosk-recipe-ingredients" style="margin:0.75rem 0;font-size:0.85rem;color:var(--ink-secondary);">Loading ingredients...</div>';
      summaryEl.innerHTML = summaryHtml;

      if (recipe._fetchedDetail) {
        var ingEl = document.getElementById('kiosk-recipe-ingredients');
        if (ingEl && recipe._fetchedDetail.ingredients) {
          kioskRenderRecipeIngredients(recipe._fetchedDetail.ingredients, ingEl);
        }
        if (recipe._fetchedDetail.recipe && recipe._fetchedDetail.recipe.computed_price != null) { // eslint-disable-line eqeqeq -- intentional loose equality to match both null and undefined
          recipe.computed_price = recipe._fetchedDetail.recipe.computed_price;
          kioskUpdateSummaryPrice();
          kioskUpdateAddToCartButton();
        }
      } else {
        var mwForSummary = _kcEnv.mwUrl;
        fetch(mwForSummary + '/api/recipes/' + encodeURIComponent(recipe.recipe_id), _kcMergeAuth({}))
          .then(function (r) { return r.json(); })
          .then(function (data) {
            var ingEl2 = document.getElementById('kiosk-recipe-ingredients');
            if (ingEl2 && data.ingredients) {
              kioskRenderRecipeIngredients(data.ingredients, ingEl2);
            }
            recipe._fetchedDetail = data;
            if (data.recipe) {
              if (data.recipe.computed_price != null) recipe.computed_price = data.recipe.computed_price; // eslint-disable-line eqeqeq -- intentional loose equality to match both null and undefined
              if (data.recipe.milling_fee_rate != null) recipe.milling_fee_rate = data.recipe.milling_fee_rate; // eslint-disable-line eqeqeq -- intentional loose equality to match both null and undefined
              var cardGrid = document.getElementById('kiosk-recipe-grid');
              if (cardGrid) {
                var cardPriceEl = cardGrid.querySelector('[data-recipe-price-id="' + recipe.recipe_id + '"]');
                if (cardPriceEl) {
                  var warm = kioskRecipePrice(recipe);
                  cardPriceEl.textContent = warm > 0 ? kioskFmt(warm) : 'Market price';
                }
              }
              kioskUpdateSummaryPrice();
              kioskUpdateAddToCartButton();
            }
          })
          .catch(function () {
            var ingEl3 = document.getElementById('kiosk-recipe-ingredients');
            if (ingEl3) ingEl3.innerHTML = '';
          });
      }
    }

    var inStoreBtn = document.getElementById('kiosk-btn-in-store');
    var takeOutBtn = document.getElementById('kiosk-btn-take-out');
    if (inStoreBtn) { inStoreBtn.classList.remove('kiosk-sale-type-btn--selected'); inStoreBtn.classList.add('btn-secondary'); }
    if (takeOutBtn) { takeOutBtn.classList.remove('kiosk-sale-type-btn--selected'); takeOutBtn.classList.add('btn-secondary'); }

    var millingToggle = document.getElementById('kiosk-milling-toggle');
    var addBtn = document.getElementById('kiosk-add-recipe-to-cart');
    var millCheckbox = document.getElementById('kiosk-mill-grain');
    if (millingToggle) millingToggle.style.display = 'none';
    if (addBtn) addBtn.style.display = 'none';
    if (millCheckbox) millCheckbox.checked = false;

    var bannerEl = document.getElementById('kiosk-avail-banner');
    if (bannerEl) bannerEl.innerHTML = '';

    var volWrap     = document.getElementById('kiosk-recipe-volume-wrap');
    var volInput    = document.getElementById('kiosk-target-volume');
    var factorInput = document.getElementById('kiosk-target-factor');
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
      if (factorInput) { factorInput.value = '1.00'; factorInput.max = '10'; factorInput.disabled = false; }
      if (factorRdout) factorRdout.textContent = '1.00\xd7 base ' + baseVol.toFixed(1) + ' L';
    } else {
      if (volInput) volInput.disabled = true;
      if (factorInput) factorInput.disabled = true;
      if (factorRdout) factorRdout.textContent = 'Set batch size (L) on this recipe to enable scaling';
    }

    if (volInput) {
      volInput.oninput = function () {
        var val = parseFloat(volInput.value) || 0;
        _kioskTargetVolumeL = val > 0 ? val : null;
        var factor = (val > 0 && baseVol > 0) ? val / baseVol : 1;
        _kioskScaleFactor = factor;
        if (factorInput) factorInput.value = factor.toFixed(2);
        if (factorRdout) {
          factorRdout.textContent = factor.toFixed(2) + '\xd7 base ' + baseVol.toFixed(1) + ' L';
        }
        _kioskStockOverride = false;
        if (conflictEl) conflictEl.style.display = 'none';
        kioskScheduleRecipeQuote();
      };
    }

    if (factorInput) {
      factorInput.oninput = function () {
        var rawFactor = parseFloat(factorInput.value) || 0;
        var clampedFactor = rawFactor <= 0 ? 0.1 : (rawFactor > 10 ? 10 : rawFactor);
        if (clampedFactor !== rawFactor && rawFactor > 0) {
          factorInput.value = clampedFactor.toFixed(2);
        }
        if (clampedFactor <= 0) return;

        var rawLitres = clampedFactor * baseVol;
        var roundedLitres = Math.round(rawLitres * 2) / 2;
        roundedLitres = Math.max(0.5, Math.min(roundedLitres, baseVol * 10));

        _kioskTargetVolumeL = roundedLitres;
        _kioskScaleFactor   = clampedFactor;

        if (volInput) volInput.value = roundedLitres;
        if (factorRdout) {
          factorRdout.textContent = clampedFactor.toFixed(2) + '\xd7 base ' + baseVol.toFixed(1) + ' L';
        }
        _kioskStockOverride = false;
        if (conflictEl) conflictEl.style.display = 'none';
        kioskScheduleRecipeQuote();
      };
    }

    kioskScheduleRecipeQuote();

    _kcEnv.setModifiedIngredients(null); // reset on recipe change
    _kioskModifyPanelOpen = false;

    var modifyWrap   = document.getElementById('kiosk-recipe-modify-wrap');
    var modifyToggle = document.getElementById('kiosk-modify-toggle');
    var modifyPanel  = document.getElementById('kiosk-modify-panel');
    var pricePreview = document.getElementById('kiosk-recipe-price-preview');
    var lockedNotice = document.getElementById('kiosk-locked-price-notice');
    var addRowBtn    = document.getElementById('kiosk-modify-add-row');

    if (modifyWrap) modifyWrap.style.display = '';
    if (modifyPanel) modifyPanel.style.display = 'none';
    if (pricePreview) { pricePreview.style.display = 'none'; pricePreview.innerHTML = ''; }
    if (lockedNotice) lockedNotice.style.display = 'none';

    if (modifyToggle) {
      modifyToggle.textContent = 'Modify Ingredients';
      modifyToggle.onclick = function () {
        _kioskModifyPanelOpen = !_kioskModifyPanelOpen;
        if (_kioskModifyPanelOpen) {
          var modifiedIngredients = _kcEnv.getModifiedIngredients();
          if (!Array.isArray(modifiedIngredients)) {
            var baseIngs = (recipe.ingredients && recipe.ingredients.length)
              ? recipe.ingredients
              : (_kioskSelectedRecipe && _kioskSelectedRecipe._fetchedDetail &&
                 _kioskSelectedRecipe._fetchedDetail.ingredients)
                ? _kioskSelectedRecipe._fetchedDetail.ingredients
                : [];
            _kcEnv.setModifiedIngredients(baseIngs.map(function (ing) {
              return Object.assign({}, ing);
            }));
          }
          if (modifyPanel) modifyPanel.style.display = '';
          modifyToggle.textContent = 'Modify Ingredients ▲';
          renderKioskModifyRows();
          if (lockedNotice && recipe.pricing_mode === 'locked') {
            lockedNotice.style.display = '';
          }
          if (pricePreview) pricePreview.style.display = '';
          kioskScheduleRecipeQuote();
          kioskLoadIngredientCatalog();
        } else {
          if (modifyPanel) modifyPanel.style.display = 'none';
          modifyToggle.textContent = 'Modify Ingredients';
        }
      };
    }

    if (addRowBtn) {
      addRowBtn.onclick = function () {
        var modifiedIngredients = _kcEnv.getModifiedIngredients();
        if (!Array.isArray(modifiedIngredients)) {
          modifiedIngredients = [];
        }
        modifiedIngredients.push({
          item_id: '',
          item_name: '',
          unit: '',
          quantity: 0
        });
        _kcEnv.setModifiedIngredients(modifiedIngredients);
        renderKioskModifyRows();
        kioskScheduleRecipeQuote();
      };
    }

    kioskCheckRecipeAvailability(recipe.recipe_id);
  }

  // Updates #kiosk-recipe-summary-price to reflect current sale type and computed_price.
  function kioskUpdateSummaryPrice() {
    var priceEl = document.getElementById('kiosk-recipe-summary-price');
    if (!priceEl || !_kioskSelectedRecipe) return;
    var recipe = _kioskSelectedRecipe;
    var contextPrice = kioskRecipePriceForContext(recipe, _kioskSaleType);
    var millingRate = Number(recipe.milling_fee_rate) || 0;
    if (_kioskMillGrain && _kioskSaleType === 'take-out' && millingRate > 0) {
      contextPrice += millingRate;
    }
    if (contextPrice > 0) {
      var label = kioskFmt(contextPrice) + ' per batch';
      if (recipe.pricing_mode === 'dynamic') {
        label += _kioskSaleType === 'take-out' ? ' (ingredients only)' : ' (based on ingredients)';
      }
      if (_kioskMillGrain && _kioskSaleType === 'take-out') label += ' (incl. milling)';
      priceEl.textContent = label;
    } else {
      priceEl.textContent = 'Price calculated at checkout';
    }
  }

  function kioskSelectSaleType(saleType) {
    _kioskSaleType = saleType;
    var inStoreBtn = document.getElementById('kiosk-btn-in-store');
    var takeOutBtn = document.getElementById('kiosk-btn-take-out');
    var millingToggle = document.getElementById('kiosk-milling-toggle');

    if (inStoreBtn) {
      if (saleType === 'in-store') { inStoreBtn.classList.add('kiosk-sale-type-btn--selected'); inStoreBtn.classList.remove('btn-secondary'); }
      else { inStoreBtn.classList.remove('kiosk-sale-type-btn--selected'); inStoreBtn.classList.add('btn-secondary'); }
    }
    if (takeOutBtn) {
      if (saleType === 'take-out') { takeOutBtn.classList.add('kiosk-sale-type-btn--selected'); takeOutBtn.classList.remove('btn-secondary'); }
      else { takeOutBtn.classList.remove('kiosk-sale-type-btn--selected'); takeOutBtn.classList.add('btn-secondary'); }
    }

    if (millingToggle) millingToggle.style.display = saleType === 'take-out' ? '' : 'none';

    // GAP-4 36-15: show price-preview as soon as a sale-type is selected (not just when modify panel opens)
    // The quote fetch triggered below will immediately set "Calculating…" then the real price.
    var pricePreviewEl = document.getElementById('kiosk-recipe-price-preview');
    if (pricePreviewEl) pricePreviewEl.style.display = '';

    kioskUpdateSummaryPrice();
    kioskScheduleRecipeQuote();  // Phase 35+36: re-quote on sale-type change (36-05)
    kioskUpdateAddToCartButton();
  }

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

    // Phase 35+36: use server quote total when available (scaled + authoritative)
    var price;
    if (_kioskQuote && _kioskQuote.recipe_id === _kioskSelectedRecipe.recipe_id &&
        typeof _kioskQuote.total === 'number' && _kioskQuote.total > 0) {
      price = _kioskQuote.total;
    } else {
      price = kioskRecipePriceForContext(_kioskSelectedRecipe, _kioskSaleType);
      var millingRate = Number(_kioskSelectedRecipe.milling_fee_rate) || 0;
      if (_kioskMillGrain && _kioskSaleType === 'take-out' && millingRate > 0) {
        price += millingRate;
      }
    }
    // Phase 36: append "(Modified)" when ingredient list has been changed
    var isModified = Array.isArray(_kcEnv.getModifiedIngredients());
    var btnLabel = (price > 0 ? 'Add to Cart — ' + kioskFmt(price) : 'Add to Cart') +
                   (isModified ? ' (Modified)' : '');
    addBtn.textContent = btnLabel;
    addBtn.style.display = '';
  }

  function kioskCheckRecipeAvailability(recipeId) {
    var bannerEl = document.getElementById('kiosk-avail-banner');
    if (bannerEl) bannerEl.innerHTML = '<p class="kiosk-loading">Checking stock...</p>';
    var mw = _kcEnv.mwUrl;
    fetch(mw + '/api/recipes/' + encodeURIComponent(recipeId) + '/availability', _kcMergeAuth({}))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        _kioskRecipeAvailability = data;
        kioskRenderAvailBanner(data);
        kioskUpdateAddToCartButton();
      })
      .catch(function () {
        _kioskRecipeAvailability = { summary: 'unknown' };
        kioskRenderAvailBanner({ summary: 'unknown' });
        kioskUpdateAddToCartButton();
      });
  }

  function kioskRenderAvailBanner(avail) {
    var bannerEl = document.getElementById('kiosk-avail-banner');
    if (!bannerEl) return;
    var summary = avail.summary || 'unknown';
    if (summary === 'all_ok') {
      bannerEl.innerHTML = '';
      return;
    }
    if (summary === 'some_low') {
      bannerEl.innerHTML = '<div class="kiosk-avail-warning">Some ingredients are low — this may be the last batch. <button type="button" class="btn-secondary" id="kiosk-avail-dismiss" style="margin-left:8px;padding:4px 12px;font-size:0.82rem;">Proceed anyway</button></div>';
      var dismissBtn = document.getElementById('kiosk-avail-dismiss');
      if (dismissBtn) {
        dismissBtn.addEventListener('click', function () { bannerEl.innerHTML = ''; });
      }
      return;
    }
    if (summary === 'cannot_brew') {
      bannerEl.innerHTML = '<div class="kiosk-avail-block">Cannot proceed: one or more ingredients are out of stock.</div>';
      return;
    }
    bannerEl.innerHTML = '<div class="kiosk-avail-block">Stock data unavailable — refresh and try again.</div>';
  }

  function kioskAddRecipeToCart() {
    if (!_kioskSelectedRecipe || !_kioskSaleType) return;
    var recipe = _kioskSelectedRecipe;
    var avail = _kioskRecipeAvailability;

    if (avail && (avail.summary === 'cannot_brew' || avail.summary === 'unknown')) return;

    _kcEnv.setCart({});

    function processRecipeData(data) {
      if (!data.recipe) {
        alert('Failed to load recipe details');
        return;
      }
      var cart = _kcEnv.getCart();
      var fullRecipe = data.recipe;
      var ingredients = data.ingredients || [];
      var pricingMode = fullRecipe.pricing_mode || recipe.pricing_mode || (Number(recipe.locked_price) > 0 ? 'locked' : 'dynamic');

      _kcEnv.setRecipeContext({
        recipe_id: recipe.recipe_id,
        recipe_name: recipe.name,
        sale_type: _kioskSaleType,
        mill_grain: _kioskMillGrain,
        locked_price: recipe.locked_price,
        pricing_mode: pricingMode,
        ingredients: ingredients,
        target_volume_l: _kioskTargetVolumeL
      });

      // Phase 35+36: Use server quote (scaled+modified) when available; fall back to base data
      var quoteForCart = (_kioskQuote &&
                          _kioskQuote.recipe_id === recipe.recipe_id &&
                          Array.isArray(_kioskQuote.ingredients))
                         ? _kioskQuote : null;

      if (pricingMode === 'dynamic') {
        // Add each ingredient as a priced line item
        // Prefer scaled+modified quantities from server quote when present
        var ingSource = quoteForCart ? quoteForCart.ingredients : ingredients;
        ingSource.forEach(function (ing, ingIdx) {
          // Unique per occurrence: a recipe can list the same item_id multiple
          // times (e.g. hop/salt additions at different times). Keying by
          // item_id alone collided and dropped all but the last → undercharge.
          var key = 'recipe-ing-' + ingIdx + '-' + (ing.item_id || ing.ingredient_id);
          var ingQty = Number(ing.quantity) || 0;
          var ingRate;
          if (quoteForCart) {
            // quote ingredient: line_total is authoritative; fall back to rate * qty
            ingRate = Number(ing.line_total) || (Number(ing.rate) * ingQty);
          } else {
            ingRate = (Number(ing.rate) || 0) * ingQty;
          }
          cart[key] = {
            item: {
              item_id: ing.item_id,
              name: escapeHTML(ing.item_name) + ' (' + ingQty + ' ' + escapeHTML(ing.unit || '') + ')',
              rate: ingRate,
              tax_percentage: Number(ing.tax_percentage) || 0,
              product_type: 'recipe_ingredient'
            },
            qty: 1
          };
        });
        // Add fee lines for in-store sales
        if (_kioskSaleType === 'in-store') {
          if (Number(fullRecipe.service_fee) > 0) {
            cart['recipe-fee-brewing'] = {
              item: { item_id: 'fee-brewing', name: 'Brewing Fee', rate: parseFloat(fullRecipe.service_fee) || 0, tax_percentage: Number(fullRecipe.brewing_fee_tax) || 0, product_type: 'fee' },
              qty: 1
            };
          }
          if (Number(fullRecipe.materials_fee) > 0) {
            cart['recipe-fee-materials'] = {
              item: { item_id: 'fee-materials', name: 'Materials Fee', rate: parseFloat(fullRecipe.materials_fee) || 0, tax_percentage: Number(fullRecipe.materials_fee_tax) || 0, product_type: 'fee' },
              qty: 1
            };
          }
        }
        // Add milling fee for take-out when checked
        if (_kioskSaleType === 'take-out' && _kioskMillGrain) {
          var millingFee = Number(recipe.milling_fee_rate || fullRecipe.milling_fee_rate) || 0;
          cart['recipe-fee-milling'] = {
            item: { item_id: 'fee-milling', name: 'Milling Fee', rate: millingFee, tax_percentage: Number(recipe.milling_fee_tax || fullRecipe.milling_fee_tax) || 0, product_type: 'fee' },
            qty: 1
          };
        }
      } else {
        // Locked mode: ingredient lines as info-only (rate=0), plus single total line
        // Show SCALED+MODIFIED quantities from quote when available, otherwise base quantities
        var lockedIngSource = quoteForCart ? quoteForCart.ingredients : ingredients;
        lockedIngSource.forEach(function (ing, ingIdx) {
          // Unique per occurrence (see dynamic-mode note): same item_id may
          // appear multiple times in a recipe; index-qualify the cart key.
          var key = 'recipe-ing-' + ingIdx + '-' + (ing.item_id || ing.ingredient_id);
          cart[key] = {
            item: {
              item_id: ing.item_id,
              name: escapeHTML(ing.item_name) + ' (' + (Number(ing.quantity) || 0) + ' ' + escapeHTML(ing.unit || '') + ')',
              rate: 0,
              tax_percentage: 0,
              product_type: 'recipe_ingredient'
            },
            qty: 1
          };
        });
        // Single total line — use the PRE-DISCOUNT quote total when available, else
        // locked_price. The discount is applied separately in kioskCalcTotals from
        // the server quote, so the cart line must stay at the undiscounted amount.
        var packagePrice = quoteForCart
          ? Number(quoteForCart.total_before_discount != null ? quoteForCart.total_before_discount : quoteForCart.total) // eslint-disable-line eqeqeq -- intentional loose equality to match both null and undefined
          : (parseFloat(recipe.locked_price) || 0);
        cart['recipe-total'] = {
          item: {
            item_id: recipe.recipe_id,
            name: escapeHTML(recipe.name || recipe.recipe_id) + ' — Package Price',
            rate: packagePrice,
            tax_percentage: 0,
            product_type: 'recipe'
          },
          qty: 1
        };
      }

      kioskSetMode('products');
      kioskRenderCart();
    }

    // Always fetch fresh to ensure tax rates and prices are current
    {
      var mw = _kcEnv.mwUrl;
      fetch(mw + '/api/recipes/' + encodeURIComponent(recipe.recipe_id), _kcMergeAuth({}))
        .then(function (r) { return r.json(); })
        .then(processRecipeData)
        .catch(function (err) {
          alert('Failed to load recipe: ' + err.message);
        });
    }
  }

  function kioskPopulateCategories() {
    var sel = document.getElementById('kiosk-category-filter');
    if (!sel) return;

    var typeFilter = _kioskFilters.type;
    var cats = {};
    _kioskProducts.forEach(function (p) {
      if (typeFilter === 'consignment') {
        if (!kioskIsConsignment(p)) return;
      } else if (typeFilter) {
        if ((p.product_type || '').toLowerCase() !== typeFilter) return;
      }
      var cat = kioskItemCategory(p);
      if (cat) cats[cat] = true;
    });

    var prev = sel.value;
    while (sel.options.length > 1) sel.remove(1);

    Object.keys(cats).sort().forEach(function (cat) {
      var opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      sel.appendChild(opt);
    });

    var hasUncategorized = _kioskProducts.some(function (p) {
      if (typeFilter === 'consignment') {
        if (!kioskIsConsignment(p)) return false;
      } else if (typeFilter) {
        if ((p.product_type || '').toLowerCase() !== typeFilter) return false;
      }
      return !kioskItemCategory(p);
    });
    if (hasUncategorized) {
      var otherOpt = document.createElement('option');
      otherOpt.value = '__other__';
      otherOpt.textContent = 'Other';
      sel.appendChild(otherOpt);
    }

    if (cats[prev] || prev === '__other__') {
      sel.value = prev;
    } else {
      sel.value = '';
      _kioskFilters.category = '';
    }
  }

  // ===== Filter + Sort Products =====

  function kioskGetFilteredProducts() {
    var search = (_kioskFilters.search || '').toLowerCase().trim();
    var cat = _kioskFilters.category;
    var type = _kioskFilters.type;
    var stockStatus = _kioskFilters.stockStatus;
    var hideOos = _kioskFilters.hideOos;

    var filtered = _kioskProducts.filter(function (p) {
      var itemType = kioskGetItemType(p);
      var isService = itemType === 'service';
      var stock = parseFloat(p.stock_on_hand) || 0;

      if (type && itemType !== type) return false;

      var itemCat = kioskItemCategory(p);
      if (cat === '__other__') {
        if (itemCat !== '') return false;
      } else if (cat && itemCat.toLowerCase() !== cat.toLowerCase()) return false;

      if (stockStatus === 'in-stock' && stock <= 0 && !isService) return false;
      if (stockStatus === 'low-stock' && (stock <= 0 || stock > 5)) return false;
      if (stockStatus === 'out-of-stock' && stock > 0) return false;

      if (hideOos && stock <= 0 && !isService) return false;

      if (search) {
        var haystack = ((p.name || '') + ' ' + (p.sku || '') + ' ' + itemCat + ' ' + itemType).toLowerCase();
        if (haystack.indexOf(search) === -1) return false;
      }
      return true;
    });

    var sort = _kioskFilters.sort || 'name-asc';
    filtered.sort(function (a, b) {
      switch (sort) {
        case 'name-asc': return (a.name || '').localeCompare(b.name || '');
        case 'name-desc': return (b.name || '').localeCompare(a.name || '');
        case 'price-asc': return (parseFloat(a.rate) || 0) - (parseFloat(b.rate) || 0);
        case 'price-desc': return (parseFloat(b.rate) || 0) - (parseFloat(a.rate) || 0);
        case 'stock-asc': return (parseFloat(a.stock_on_hand) || 0) - (parseFloat(b.stock_on_hand) || 0);
        default: return 0;
      }
    });
    return filtered;
  }

  // ===== Render Product Grid =====

  function kioskRenderProducts() {
    var grid = document.getElementById('kiosk-product-grid');
    if (!grid) return;
    var filtered = kioskGetFilteredProducts();

    var countEl = document.getElementById('kiosk-result-count');
    if (countEl) countEl.textContent = 'Showing ' + filtered.length + ' of ' + _kioskProducts.length + ' products';

    if (filtered.length === 0) {
      grid.innerHTML = '<p class="kiosk-loading">No products match your filters.</p>';
      return;
    }
    if (_kioskViewMode === 'list') {
      grid.classList.add('kiosk-product-grid--list');
      kioskRenderProductList(grid, filtered);
    } else {
      grid.classList.remove('kiosk-product-grid--list');
      kioskRenderProductGrid(grid, filtered);
    }
  }

  function kioskRenderProductGrid(grid, filtered) {
    var cart = _kcEnv.getCart();
    var html = '';
    filtered.forEach(function (p) {
      var cartEntry = cart[p.item_id];
      var inCart = cartEntry ? cartEntry.qty : 0;
      var stock = parseFloat(p.stock_on_hand) || 0;
      var itemType = kioskGetItemType(p);
      var isService = itemType === 'service';
      var outOfStock = !isService && stock <= 0;
      var lowStock = !outOfStock && !isService && stock <= 5;

      var cardClass = 'kiosk-product-card' + (outOfStock ? ' kiosk-product-card--out-of-stock' : '');

      var placeholderEmoji = isService ? '&#9881;' : '&#127866;';
      var imgHtml;
      if (p.image_name && p.sku) {
        imgHtml = '<img class="kiosk-product-img" src="images/products/' +
          encodeURIComponent(p.sku) + '.png" alt="" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';">' +
          '<div class="kiosk-product-img-placeholder" style="display:none;">' + placeholderEmoji + '</div>';
      } else {
        imgHtml = '<div class="kiosk-product-img-placeholder">' + placeholderEmoji + '</div>';
      }

      var stockLabel, stockClass;
      if (isService) {
        stockLabel = '';
        stockClass = '';
      } else if (outOfStock) {
        stockLabel = stock < 0 ? (Math.round(stock) + ' in stock') : 'Out of stock';
        stockClass = 'kiosk-product-stock--out';
      } else if (lowStock) {
        stockLabel = 'Low stock (' + Math.round(stock) + ')';
        stockClass = 'kiosk-product-stock--low';
      } else {
        stockLabel = 'In stock';
        stockClass = '';
      }

      html += '<div class="' + cardClass + '" data-item-id="' + p.item_id + '">';
      if (inCart > 0) {
        html += '<div class="kiosk-card-in-cart">' + inCart + '</div>';
      }
      if (itemType === 'consignment') {
        html += '<div class="kiosk-consignment-badge">Consignment</div>';
      } else if (isService) {
        html += '<div class="kiosk-service-badge">Service</div>';
      }
      html += imgHtml;
      var displayRate = parseFloat(p.rate) || 0;
      html += '<div class="kiosk-product-body">';
      if (p.manufacturer && kioskGetItemType(p) === 'kit') {
        html += '<div class="kiosk-product-producer">' + escapeHTML(p.manufacturer) + '</div>';
      }
      html += '<div class="kiosk-product-name">' + escapeHTML(p.name || '') + '</div>';
      if (p.sku) html += '<div class="kiosk-product-sku">' + escapeHTML(p.sku) + '</div>';
      html += '<div class="kiosk-product-price">' + kioskFmt(displayRate) + '</div>';
      if (stockLabel) html += '<div class="kiosk-product-stock ' + stockClass + '">' + stockLabel + '</div>';
      html += '</div>';
      html += '</div>';
    });

    grid.innerHTML = html;

    var cards = grid.querySelectorAll('.kiosk-product-card');
    cards.forEach(function (card) {
      card.addEventListener('click', function () {
        var itemId = card.getAttribute('data-item-id');
        var product = _kioskProducts.filter(function (p) { return p.item_id === itemId; })[0];
        if (!product) return;
        var isService = (product.product_type || '').toLowerCase() === 'service';
        var stock = parseFloat(product.stock_on_hand) || 0;
        if (!isService && stock <= 0) {
          if (!confirm('"' + (product.name || 'This item') + '" is out of stock. Add to cart anyway (special order)?')) return;
        }
        kioskAddToCart(product);
      });
    });
  }

  function kioskRenderProductList(grid, filtered) {
    var html = '<table class="kiosk-list-table">';
    html += '<thead><tr>';
    html += '<th>Name</th>';
    html += '<th>Type</th>';
    html += '<th>Category</th>';
    html += '<th>Price</th>';
    html += '<th>Stock</th>';
    html += '<th></th>';
    html += '</tr></thead>';
    html += '<tbody>';

    filtered.forEach(function (p) {
      var stock = parseFloat(p.stock_on_hand) || 0;
      var itemType = kioskGetItemType(p);
      var isService = itemType === 'service';
      var outOfStock = !isService && stock <= 0;
      var rowClass = outOfStock ? ' kiosk-list-row--oos' : '';
      var displayRate = parseFloat(p.rate) || 0;
      var cat = kioskItemCategory(p);
      var typeLabel = itemType.charAt(0).toUpperCase() + itemType.slice(1);

      html += '<tr class="kiosk-list-row' + rowClass + '" data-item-id="' + escapeHTML(p.item_id) + '">';
      var kioskListName = p.manufacturer && kioskGetItemType(p) === 'kit'
        ? escapeHTML(p.manufacturer) + ' — ' + escapeHTML(p.name || '')
        : escapeHTML(p.name || '');
      html += '<td><div class="kiosk-list-name">' + kioskListName + '</div>';
      if (p.sku) html += '<div class="kiosk-list-sku">' + escapeHTML(p.sku) + '</div>';
      html += '</td>';

      html += '<td>';
      html += '<span class="kiosk-type-badge kiosk-type-badge--' + escapeHTML(itemType) + '">' + escapeHTML(typeLabel) + '</span>';
      html += '</td>';

      html += '<td>' + escapeHTML(cat) + '</td>';
      html += '<td>' + kioskFmt(displayRate) + '</td>';

      html += '<td>';
      if (isService) {
        html += '<span class="kiosk-stock--service">Service</span>';
      } else if (outOfStock) {
        html += '<span class="kiosk-product-stock--out">Out of stock</span>';
      } else if (stock <= 5) {
        html += '<span class="kiosk-product-stock--low">Low (' + Math.round(stock) + ')</span>';
      } else {
        html += Math.round(stock);
      }
      html += '</td>';

      html += '<td>';
      html += '<button type="button" class="kiosk-list-add-btn' + (outOfStock ? ' kiosk-list-add-btn--oos' : '') + '" data-item-id="' + escapeHTML(p.item_id) + '">+</button>';
      html += '</td>';

      html += '</tr>';
    });

    html += '</tbody></table>';
    grid.innerHTML = html;

    Array.prototype.forEach.call(grid.querySelectorAll('.kiosk-list-add-btn'), function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var itemId = btn.getAttribute('data-item-id');
        var product = null;
        for (var i = 0; i < _kioskProducts.length; i++) {
          if (_kioskProducts[i].item_id === itemId) { product = _kioskProducts[i]; break; }
        }
        if (!product) return;
        var isService = (product.product_type || '').toLowerCase() === 'service';
        var stock = parseFloat(product.stock_on_hand) || 0;
        if (!isService && stock <= 0) {
          if (!confirm('"' + (product.name || 'This item') + '" is out of stock. Add to cart anyway (special order)?')) return;
        }
        kioskAddToCart(product);
      });
    });
  }

  // ===== Cart Management =====

  function kioskAddToCart(product) {
    var cart = _kcEnv.getCart();
    var id = product.item_id;
    if (kioskIsWeightItem(product)) {
      var input = prompt('Enter quantity in kg for "' + (product.name || '') + '":', cart[id] ? cart[id].qty : '1');
      if (input === null) return;
      var qty = parseFloat(input);
      if (!isFinite(qty) || qty <= 0) return;
      qty = Math.round(qty * 1000) / 1000;
      cart[id] = { item: product, qty: qty };
    } else {
      var currentQty = cart[id] ? cart[id].qty : 0;
      var newQty = currentQty + 1;
      if (!kioskCheckStockOverflow(product, newQty)) return;
      if (cart[id]) {
        cart[id].qty = newQty;
      } else {
        cart[id] = { item: product, qty: 1 };
      }
    }

    if (kioskGetItemType(product) === 'kit') {
      _kioskMakersFeeWaived = false;
      kioskSyncKitFees();
    }

    kioskRenderCart();
    kioskRenderProducts();
  }

  function kioskSetQty(itemId, qty) {
    var cart = _kcEnv.getCart();
    var wasKit = cart[itemId] && kioskGetItemType(cart[itemId].item) === 'kit';
    if (qty <= 0) {
      delete cart[itemId];
    } else {
      if (cart[itemId]) {
        if (qty > cart[itemId].qty) {
          if (!kioskCheckStockOverflow(cart[itemId].item, qty)) return;
        }
        cart[itemId].qty = qty;
      }
    }
    if (wasKit) kioskSyncKitFees();
    kioskRenderCart();
    kioskRenderProducts();
  }

  function kioskRemoveFromCart(itemId) {
    var cart = _kcEnv.getCart();
    var wasFee = cart[itemId] && kioskIsKitFee(cart[itemId].item);
    var wasKit = cart[itemId] && kioskGetItemType(cart[itemId].item) === 'kit';
    delete cart[itemId];
    if (wasFee) {
      _kioskMakersFeeWaived = true;
    } else if (wasKit) {
      kioskSyncKitFees();
    }
    kioskRenderCart();
    kioskRenderProducts();
  }

  function kioskClearCart() {
    _kioskMakersFeeWaived = false;
    _kcEnv.setCart({});
    _kcEnv.setDiscount(null);
    _kcEnv.setGiftCard(null);
    _kioskSelectedRecipe = null;
    _kioskSaleType = null;
    _kioskMillGrain = false;
    _kioskRecipeAvailability = null;
    _kcEnv.setRecipeContext(null);
    _kioskQuote = null;
    _kcEnv.setModifiedIngredients(null);
    _kioskModifyPanelOpen = false;
    _kioskTargetVolumeL = null;
    kioskUpdateDiscountDisplay();
    kioskRenderCart();
    kioskRenderProducts();
  }

  function kioskRenderCart() {
    var container = document.getElementById('kiosk-cart-items');
    var totalsEl = document.getElementById('kiosk-cart-totals');
    var checkoutBtn = document.getElementById('kiosk-checkout-btn');
    var checkoutTotal = document.getElementById('kiosk-checkout-total');
    if (!container) return;

    var cart = _kcEnv.getCart();
    var keys = Object.keys(cart);

    var discountBtn = document.getElementById('kiosk-discount-btn');

    // SO import banner (D-01)
    var bannerHtml = '';
    var importedSoId = _kcEnv.getImportedSoId();
    var importedSoNumber = _kcEnv.getImportedSoNumber();
    if (importedSoId) {
      bannerHtml = '<div class="kiosk-cart-so-banner">' +
        '<span>Order: <strong>' + escapeHTML(importedSoNumber || '') + '</strong></span>' +
        '<button type="button" class="kiosk-cart-so-clear" title="Detach SO" aria-label="Detach SO">&#215;</button>' +
        '</div>';
    }

    if (keys.length === 0) {
      container.innerHTML = bannerHtml +
        '<p class="kiosk-cart-empty">No items in cart</p>' +
        '<div style="margin-top:0.5rem;">' +
        '<button id="kiosk-add-custom-btn" type="button" class="kiosk-add-custom-btn" style="width:100%;padding:0.6rem;font-size:0.95rem;border:1px dashed #888;border-radius:6px;background:none;cursor:pointer;color:#555;">' +
        '+ Add custom item' +
        '</button>' +
        '</div>' +
        '<div style="margin-top:0.5rem;">' +
        '<button id="kiosk-add-gc-btn" type="button" class="kiosk-add-custom-btn" style="width:100%;padding:0.6rem;font-size:0.95rem;border:1px dashed #5a3e1b;border-radius:6px;background:none;cursor:pointer;color:#5a3e1b;">' +
        '+ Issue / Reload Gift Card' +
        '</button>' +
        '</div>';
      var soClearEmpty = container.querySelector('.kiosk-cart-so-clear');
      if (soClearEmpty) {
        soClearEmpty.addEventListener('click', function () {
          _kcEnv.clearImportedSo();
          kioskRenderCart();
        });
      }
      var addCustomBtnEmpty = document.getElementById('kiosk-add-custom-btn');
      if (addCustomBtnEmpty) {
        addCustomBtnEmpty.addEventListener('click', function () {
          _kcEnv.showCustomItemModal();
        });
      }
      var addGcBtnEmpty = document.getElementById('kiosk-add-gc-btn');
      if (addGcBtnEmpty) {
        addGcBtnEmpty.addEventListener('click', function () {
          _kcEnv.showGiftCardIssueModal();
        });
      }
      if (totalsEl) totalsEl.style.display = 'none';
      if (checkoutBtn) checkoutBtn.disabled = true;
      if (checkoutTotal) checkoutTotal.textContent = '$0.00';
      if (discountBtn) discountBtn.disabled = true;
      kioskUpdateDiscountDisplay();
      return;
    }

    var html = '';
    keys.forEach(function (id) {
      var entry = cart[id];
      if (!entry || !entry.item) return; // skip non-item entries (defensive guard)
      var item = entry.item;
      var qty = entry.qty;
      var rate = parseFloat(item.rate) || 0;
      var lineTotal = rate * qty;
      // GIFTCARD-01: gift_cert lines render with fixed qty=1 and a remove button (no qty stepper)
      if (item.gift_cert) {
        html += '<div class="kiosk-cart-line">';
        html += '<div class="kiosk-cart-line-name" title="' + escapeHTML(item.name || '') + '">' + escapeHTML(item.name || '') + '</div>';
        html += '<div class="kiosk-cart-qty"><span class="kiosk-qty-val">1</span></div>';
        html += '<div class="kiosk-cart-line-total">' + kioskFmt(lineTotal) + '</div>';
        html += '<button class="kiosk-cart-remove-btn" data-id="' + id + '">&times;</button>';
        html += '</div>';
        return;
      }
      html += '<div class="kiosk-cart-line">';
      var isWeight = kioskIsWeightItem(item);
      html += '<div class="kiosk-cart-line-name" title="' + escapeHTML(item.name || '') + '">' + escapeHTML(item.name || '') + '</div>';
      if (isWeight) {
        html += '<div class="kiosk-cart-qty">';
        html += '<input type="number" class="kiosk-qty-input" data-id="' + id + '" value="' + qty + '" step="0.01" min="0.001" inputmode="decimal">';
        html += '<span class="kiosk-qty-unit">kg</span>';
        html += '</div>';
      } else {
        html += '<div class="kiosk-cart-qty">';
        html += '<button class="kiosk-qty-btn" data-action="dec" data-id="' + id + '">-</button>';
        html += '<input type="number" class="kiosk-qty-input" data-id="' + id + '" value="' + qty + '" step="1" min="1" inputmode="numeric">';
        html += '<button class="kiosk-qty-btn" data-action="inc" data-id="' + id + '">+</button>';
        html += '</div>';
      }
      html += '<div class="kiosk-cart-line-total">' + kioskFmt(lineTotal) + '</div>';
      html += '<button class="kiosk-cart-remove-btn" data-id="' + id + '">&times;</button>';
      html += '</div>';
    });

    html += '<div style="margin-top:0.5rem;">' +
      '<button id="kiosk-add-custom-btn" type="button" class="kiosk-add-custom-btn" style="width:100%;padding:0.6rem;font-size:0.95rem;border:1px dashed #888;border-radius:6px;background:none;cursor:pointer;color:#555;">' +
      '+ Add custom item' +
      '</button>' +
      '</div>';
    html += '<div style="margin-top:0.5rem;">' +
      '<button id="kiosk-add-gc-btn" type="button" class="kiosk-add-custom-btn" style="width:100%;padding:0.6rem;font-size:0.95rem;border:1px dashed #5a3e1b;border-radius:6px;background:none;cursor:pointer;color:#5a3e1b;">' +
      '+ Issue / Reload Gift Card' +
      '</button>' +
      '</div>';

    container.innerHTML = bannerHtml + html;

    var soClearBtn = container.querySelector('.kiosk-cart-so-clear');
    if (soClearBtn) {
      soClearBtn.addEventListener('click', function () {
        _kcEnv.clearImportedSo();
        kioskRenderCart();
      });
    }

    container.querySelectorAll('.kiosk-qty-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-id');
        var action = btn.getAttribute('data-action');
        var liveCart = _kcEnv.getCart();
        if (!liveCart[id]) return;
        var newQty = liveCart[id].qty + (action === 'inc' ? 1 : -1);
        kioskSetQty(id, newQty);
      });
    });

    container.querySelectorAll('.kiosk-qty-input').forEach(function (input) {
      input.addEventListener('input', function () {
        var id = input.getAttribute('data-id');
        var val = parseFloat(input.value);
        var liveCart = _kcEnv.getCart();
        if (!liveCart[id] || !isFinite(val) || val <= 0) return;
        liveCart[id].qty = Math.round(val * 1000) / 1000;
        var rate = parseFloat(liveCart[id].item.rate) || 0;
        var lineEl = input.closest('.kiosk-cart-line');
        if (lineEl) {
          var totalEl = lineEl.querySelector('.kiosk-cart-line-total');
          if (totalEl) totalEl.textContent = kioskFmt(rate * liveCart[id].qty);
        }
        var totals = kioskCalcTotals();
        var subEl = document.getElementById('kiosk-subtotal');
        var taxEl = document.getElementById('kiosk-tax');
        var totalEl2 = document.getElementById('kiosk-total');
        var checkoutTotal = document.getElementById('kiosk-checkout-total');
        if (subEl) subEl.textContent = kioskFmt(totals.subtotal);
        if (taxEl) taxEl.textContent = kioskFmt(totals.tax);
        if (totalEl2) totalEl2.textContent = kioskFmt(totals.total);
        if (checkoutTotal) checkoutTotal.textContent = kioskFmt(totals.total);
        kioskUpdateDiscountDisplay();
      });
      input.addEventListener('change', function () {
        var id = input.getAttribute('data-id');
        var val = parseFloat(input.value);
        if (!isFinite(val) || val <= 0) {
          kioskRemoveFromCart(id);
        } else {
          kioskSetQty(id, Math.round(val * 1000) / 1000);
        }
      });
    });

    container.querySelectorAll('.kiosk-cart-remove-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-id');
        kioskRemoveFromCart(id);
      });
    });

    var addCustomBtn = document.getElementById('kiosk-add-custom-btn');
    if (addCustomBtn) {
      addCustomBtn.addEventListener('click', function () {
        _kcEnv.showCustomItemModal();
      });
    }
    var addGcBtn = document.getElementById('kiosk-add-gc-btn');
    if (addGcBtn) {
      addGcBtn.addEventListener('click', function () {
        _kcEnv.showGiftCardIssueModal();
      });
    }

    var totals = kioskCalcTotals();
    var subEl = document.getElementById('kiosk-subtotal');
    var taxEl = document.getElementById('kiosk-tax');
    var totalEl = document.getElementById('kiosk-total');
    if (subEl) subEl.textContent = kioskFmt(totals.subtotal);
    if (taxEl) taxEl.textContent = kioskFmt(totals.tax);
    if (totalEl) totalEl.textContent = kioskFmt(totals.total);
    if (totalsEl) totalsEl.style.display = '';
    if (checkoutBtn) checkoutBtn.disabled = false;
    if (checkoutTotal) checkoutTotal.textContent = kioskFmt(totals.total);
    if (discountBtn) discountBtn.disabled = kioskCartIsEmpty();
    kioskUpdateDiscountDisplay();
  }

  function kioskShowCustomerStep() {
    kioskShowView('customer');

    var hasKits = kioskCartHasKits();
    var proceedBtn = document.getElementById('kiosk-customer-proceed');
    var skipBtn = document.getElementById('kiosk-customer-skip');
    var backBtn = document.getElementById('kiosk-customer-back');
    var searchInput = document.getElementById('kiosk-customer-search');
    var resultsEl = document.getElementById('kiosk-customer-results');
    var selectedEl = document.getElementById('kiosk-customer-selected');
    var newToggle = document.getElementById('kiosk-new-customer-toggle');
    var newForm = document.getElementById('kiosk-new-customer-form');
    var saveBtn = document.getElementById('kiosk-new-customer-save');

    if (searchInput) searchInput.value = '';
    if (resultsEl) resultsEl.innerHTML = '';
    if (newForm) newForm.style.display = 'none';
    if (skipBtn) skipBtn.style.display = hasKits ? 'none' : '';

    function updateProceedState() {
      if (proceedBtn) proceedBtn.disabled = !_kcEnv.getCustomer();
    }

    function kioskSelectCustomer(c) {
      _kcEnv.setCustomer(c);
      if (searchInput) { searchInput.value = ''; }
      if (resultsEl) resultsEl.innerHTML = '';
      if (selectedEl) {
        selectedEl.style.display = '';
        selectedEl.innerHTML = '<span>' + escapeHTML(c.name || '') + (c.email ? ' &mdash; ' + escapeHTML(c.email) : '') + '</span>' +
          '<button type="button" style="background:none;border:none;cursor:pointer;font-size:1rem;padding:0 0.25rem;" id="kiosk-clear-customer">&times;</button>';
        var clearBtn = document.getElementById('kiosk-clear-customer');
        if (clearBtn) {
          clearBtn.onclick = function () {
            _kcEnv.setCustomer(null);
            selectedEl.style.display = 'none';
            selectedEl.innerHTML = '';
            updateProceedState();
          };
        }
      }
      if (newForm) newForm.style.display = 'none';
      updateProceedState();
    }

    var existingCustomer = _kcEnv.getCustomer();
    if (existingCustomer) {
      kioskSelectCustomer(existingCustomer);
    } else {
      if (selectedEl) { selectedEl.style.display = 'none'; selectedEl.innerHTML = ''; }
      if (proceedBtn) proceedBtn.disabled = true;
    }

    if (backBtn) {
      backBtn.onclick = function () { kioskShowView('browse'); };
    }

    if (skipBtn) {
      skipBtn.onclick = function () { _kcEnv.proceedToPayment(); };
    }

    if (proceedBtn) {
      proceedBtn.onclick = function () {
        if (_kcEnv.getCustomer()) _kcEnv.proceedToPayment();
      };
    }

    if (newToggle) {
      newToggle.onclick = function () {
        if (newForm) newForm.style.display = newForm.style.display === 'none' ? '' : 'none';
      };
    }

    if (saveBtn) {
      saveBtn.onclick = function () {
        var nameEl = document.getElementById('kiosk-new-name');
        var emailEl = document.getElementById('kiosk-new-email');
        var phoneEl = document.getElementById('kiosk-new-phone');
        var name = nameEl ? nameEl.value.trim() : '';
        var email = emailEl ? emailEl.value.trim() : '';
        var phone = phoneEl ? phoneEl.value.trim() : '';
        if (!name || !email) {
          showToast('Name and email are required', 'error');
          return;
        }
        saveBtn.disabled = true;
        var mwUrl = _kcEnv.mwUrl;
        fetch(mwUrl + '/api/contacts', _kcMergeAuth({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name, email: email, phone: phone })
        }))
        .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
        .then(function (result) {
          saveBtn.disabled = false;
          if (result.data && result.data.contact_id) {
            if (nameEl) nameEl.value = '';
            if (emailEl) emailEl.value = '';
            if (phoneEl) phoneEl.value = '';
            kioskSelectCustomer({ contact_id: result.data.contact_id, name: name, email: email });
          } else {
            showToast(result.data.error || 'Could not create customer', 'error');
          }
        })
        .catch(function () {
          saveBtn.disabled = false;
          showToast('Could not create customer', 'error');
        });
      };
    }

    var searchTimer = null;
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        clearTimeout(searchTimer);
        var q = searchInput.value.trim();
        if (!q) { if (resultsEl) resultsEl.innerHTML = ''; return; }
        searchTimer = setTimeout(function () {
          var mwUrl = _kcEnv.mwUrl;
          fetch(mwUrl + '/api/contacts/search?q=' + encodeURIComponent(q), _kcMergeAuth({}))
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (!resultsEl) return;
            var contacts = (data.contacts || []).slice(0, 8);
            if (!contacts.length) {
              resultsEl.innerHTML = '<div style="padding:0.4rem 0.6rem;color:#888;font-size:0.88rem;">No results</div>';
              return;
            }
            var html = '';
            contacts.forEach(function (c) {
              html += '<div class="kiosk-customer-result-row" data-id="' + escapeHTML(c.contact_id || '') + '">' +
                '<strong>' + escapeHTML(c.contact_name || c.name || '') + '</strong>' +
                (c.email ? ' <span style="color:#666;">' + escapeHTML(c.email) + '</span>' : '') +
                '</div>';
            });
            resultsEl.innerHTML = html;
            Array.prototype.forEach.call(resultsEl.querySelectorAll('.kiosk-customer-result-row'), function (row) {
              row.onclick = function () {
                var idx = Array.prototype.indexOf.call(resultsEl.querySelectorAll('.kiosk-customer-result-row'), row);
                var c = contacts[idx];
                kioskSelectCustomer({
                  contact_id: c.contact_id || '',
                  name: c.contact_name || c.name || '',
                  email: c.email || ''
                });
              };
            });
          })
          .catch(function () {
            if (resultsEl) resultsEl.innerHTML = '<div style="padding:0.4rem 0.6rem;color:#888;font-size:0.88rem;">Search failed</div>';
          });
        }, 300);
      });

      searchInput.addEventListener('focus', function () {
        var el = searchInput;
        setTimeout(function () {
          if (el.scrollIntoView) {
            el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }, 350);
      });
    }

    var newFormInputIds = ['kiosk-new-name', 'kiosk-new-email', 'kiosk-new-phone'];
    newFormInputIds.forEach(function (inputId) {
      var el = document.getElementById(inputId);
      if (!el) return;
      el.addEventListener('focus', function () {
        var target = el;
        setTimeout(function () {
          if (target.scrollIntoView) {
            target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }, 350);
      });
    });
  }

  function kioskShowError(title, msg, canRetry, extra) {
    kioskShowView('error');

    var titleEl = document.getElementById('kiosk-error-title');
    var msgEl = document.getElementById('kiosk-error-msg');
    var retryBtn = document.getElementById('kiosk-retry-btn');
    var backBtn = document.getElementById('kiosk-back-btn');
    var detailEl = document.getElementById('kiosk-error-detail');

    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = msg;

    if (detailEl) {
      if (extra && extra.txnId) {
        detailEl.textContent = 'Ref: ' + extra.txnId;
        detailEl.style.display = '';
      } else {
        detailEl.style.display = 'none';
      }
    }

    if (retryBtn) {
      retryBtn.style.display = canRetry ? '' : 'none';
      retryBtn.onclick = function () {
        kioskShowView('browse');
        _kcEnv.startCheckout();
      };
    }

    if (backBtn) {
      backBtn.onclick = function () {
        kioskShowView('browse');
      };
    }
  }

  // ===== Discount display (Task 1 — kioskCalcTotals/kioskRenderCart/kioskClearCart
  // above all call kioskUpdateDiscountDisplay directly, so it and its own
  // calcDiscountAmount dependency move here; the rest of the discount
  // subsystem — preset CRUD, popover, management modal — is 48-02 Task 2) =====

  function kioskUpdateDiscountDisplay() {
    var btn = document.getElementById('kiosk-discount-btn');
    var applied = document.getElementById('kiosk-discount-applied');
    var nameEl = document.getElementById('kiosk-discount-applied-name');
    var amountEl = document.getElementById('kiosk-discount-applied-amount');
    var discountRow = document.getElementById('kiosk-discount-total-row');
    var discountLabel = document.getElementById('kiosk-discount-total-label');
    var discountAmount = document.getElementById('kiosk-discount-total-amount');
    var discount = _kcEnv.getDiscount();

    if (discount) {
      if (btn) btn.style.display = 'none';
      if (applied) applied.style.display = '';
      if (nameEl) nameEl.textContent = discount.name;

      var savings = kioskCalcDiscountAmount();
      if (amountEl) amountEl.textContent = '-' + kioskFmt(savings);
      if (discountRow) discountRow.style.display = '';
      if (discountLabel) discountLabel.textContent = 'Discount: ' + discount.name;
      if (discountAmount) discountAmount.textContent = '-' + kioskFmt(savings);
    } else {
      if (btn) { btn.style.display = ''; btn.disabled = kioskCartIsEmpty(); }
      if (applied) applied.style.display = 'none';
      if (discountRow) discountRow.style.display = 'none';
    }
  }

  function kioskCalcDiscountAmount() {
    if (!_kcEnv.getDiscount()) return 0;
    return kioskCalcTotals().discount;
  }

  // ===== Discount System (48-02 Task 2 — D-04: product-type discount subsystem,
  // moves into core so the admin-embedded kiosk gets it for free) =====

  function kioskLoadDiscountPresets() {
    var mwUrl = _kcEnv.mwUrl;
    if (!mwUrl) return;
    fetch(mwUrl + '/api/kiosk/discounts', _kcMergeAuth({}))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        _kioskDiscountPresets = (data.discounts || []).filter(function (d) { return d.active; });
      })
      .catch(function () {});
  }

  function kioskShowDiscountPopover() {
    var popover = document.getElementById('kiosk-discount-popover');
    var list = document.getElementById('kiosk-discount-preset-list');
    if (!popover || !list) return;

    var html = '';
    _kioskDiscountPresets.forEach(function (p) {
      var detail = p.type === 'percentage' ? (p.value + '% off') : ('$' + parseFloat(p.value).toFixed(2) + ' off');
      detail += ' (' + kioskDiscountScopeLabel(p) + ')';
      html += '<div class="kiosk-discount-preset-row" data-preset-id="' + escapeHTML(p.id) + '">';
      html += '<span class="kiosk-discount-preset-name">' + escapeHTML(p.name) + '</span>';
      html += '<span class="kiosk-discount-preset-detail">' + detail + '</span>';
      html += '</div>';
    });
    if (!_kioskDiscountPresets.length) {
      html = '<div style="padding:1rem;color:var(--ink-tertiary);text-align:center;">No presets configured</div>';
    }
    list.innerHTML = html;

    list.querySelectorAll('.kiosk-discount-preset-row').forEach(function (row) {
      row.addEventListener('click', function () {
        var id = row.getAttribute('data-preset-id');
        var preset = null;
        for (var i = 0; i < _kioskDiscountPresets.length; i++) {
          if (_kioskDiscountPresets[i].id === id) { preset = _kioskDiscountPresets[i]; break; }
        }
        if (preset) kioskApplyDiscount(preset);
      });
    });

    popover.style.display = '';
  }

  function kioskApplyDiscount(preset) {
    _kcEnv.setDiscount({
      presetId: preset.id,
      name: preset.name,
      type: preset.type,
      value: preset.value,
      scope: preset.scope,
      applies_to: preset.applies_to || null
    });

    document.getElementById('kiosk-discount-popover').style.display = 'none';
    kioskRefreshAfterDiscountChange();
  }

  function kioskRemoveDiscount() {
    _kcEnv.setDiscount(null);
    kioskRefreshAfterDiscountChange();
  }

  // Recompute the displayed total after a discount changes. For recipe carts the
  // discount is server-authoritative, so re-fetch the (discount-aware) quote first.
  function kioskRefreshAfterDiscountChange() {
    if (_kioskSelectedRecipe && typeof kioskFetchRecipeQuote === 'function') {
      var p = kioskFetchRecipeQuote();
      if (p && typeof p.then === 'function') {
        p.then(function () { kioskUpdateDiscountDisplay(); kioskRenderCart(); });
        return;
      }
    }
    kioskUpdateDiscountDisplay();
    kioskRenderCart();
  }

  // Collect the selected applies_to tokens from the two-tier checkbox panel.
  // A fully-selected group collapses to its group token ('kit'/'ingredient').
  function kioskCollectAppliesTo() {
    var panel = document.getElementById('kiosk-discount-types');
    if (!panel) return [];
    var tokens = [];
    panel.querySelectorAll('input[data-group]').forEach(function (parent) {
      var group = parent.getAttribute('data-group');
      if (parent.checked) {
        tokens.push(group);
      } else {
        panel.querySelectorAll('input[data-token]').forEach(function (c) {
          if (c.getAttribute('data-token').indexOf(group + ':') === 0 && c.checked) {
            tokens.push(c.getAttribute('data-token'));
          }
        });
      }
    });
    panel.querySelectorAll('input[data-token]').forEach(function (c) {
      var t = c.getAttribute('data-token');
      if (t.indexOf(':') === -1 && c.checked) tokens.push(t); // service / recipe
    });
    return tokens;
  }

  // Load an existing preset into the Add/Edit form for editing.
  function kioskPopulateDiscountForm(preset) {
    var modal = document.getElementById('kiosk-discount-mgmt-modal');
    var form = document.getElementById('kiosk-discount-form');
    if (!modal || !form || !preset) return;

    _kioskEditingDiscountId = preset.id;
    document.getElementById('kiosk-discount-form-name').value = preset.name || '';
    document.getElementById('kiosk-discount-form-value').value = preset.value != null ? preset.value : ''; // eslint-disable-line eqeqeq -- intentional loose equality to match both null and undefined

    modal.querySelectorAll('.kiosk-discount-type-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-type') === (preset.type || 'percentage'));
    });
    var scope = (preset.scope === 'type') ? 'type' : 'cart';
    modal.querySelectorAll('.kiosk-discount-scope-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-scope') === scope);
    });

    var tp = document.getElementById('kiosk-discount-types');
    if (tp) {
      tp.querySelectorAll('input[type="checkbox"]').forEach(function (c) { c.checked = false; });
      tp.style.display = (scope === 'type') ? '' : 'none';
      if (scope === 'type') {
        var at = preset.applies_to || [];
        // Group tokens (kit/ingredient) tick the parent + all its children.
        at.forEach(function (tok) {
          var parent = tp.querySelector('input[data-group="' + tok + '"]');
          if (parent) {
            parent.checked = true;
            tp.querySelectorAll('input[data-token]').forEach(function (c) {
              if (c.getAttribute('data-token').indexOf(tok + ':') === 0) c.checked = true;
            });
          }
          var leaf = tp.querySelector('input[data-token="' + tok + '"]');
          if (leaf) leaf.checked = true;
        });
        // Reflect "all children selected" back onto each parent checkbox.
        tp.querySelectorAll('input[data-group]').forEach(function (parent) {
          var group = parent.getAttribute('data-group');
          var all = true, any = false;
          tp.querySelectorAll('input[data-token]').forEach(function (c) {
            if (c.getAttribute('data-token').indexOf(group + ':') === 0) { any = true; if (!c.checked) all = false; }
          });
          if (any) parent.checked = all;
        });
      }
    }

    form.style.display = '';
    var addBtn = document.getElementById('kiosk-discount-add-btn');
    if (addBtn) addBtn.style.display = 'none';
    var saveBtn = document.getElementById('kiosk-discount-save-btn');
    if (saveBtn) saveBtn.textContent = 'Update';
  }

  // Human-readable summary of a preset's targeting (for popover + mgmt list).
  function kioskDiscountScopeLabel(p) {
    if (!p || p.scope !== 'type') return 'Cart';
    var at = p.applies_to || [];
    if (!at.length) return 'Types';
    var labelMap = {
      kit: 'All Kits', ingredient: 'All Ingredients', service: 'Services', recipe: 'Recipes',
      'kit:wine': 'Wine', 'kit:beer': 'Beer', 'kit:cider': 'Cider', 'kit:seltzer': 'Seltzer',
      'ingredient:hops': 'Hops', 'ingredient:grain': 'Grain', 'ingredient:yeast': 'Yeast',
      'ingredient:additive': 'Additive', 'ingredient:packaging': 'Packaging',
      'ingredient:equipment': 'Equipment', 'ingredient:cleaning': 'Cleaning'
    };
    return at.map(function (t) { return labelMap[t] || t; }).join(', ');
  }

  function kioskShowDiscountMgmt() {
    var modal = document.getElementById('kiosk-discount-mgmt-modal');
    if (!modal) return;
    modal.style.display = '';
    kioskRenderDiscountMgmtList();

    var closeBtn = document.getElementById('kiosk-discount-mgmt-close');
    if (closeBtn) closeBtn.onclick = function () { modal.style.display = 'none'; };

    var addBtn = document.getElementById('kiosk-discount-add-btn');
    var form = document.getElementById('kiosk-discount-form');
    if (addBtn && form) {
      addBtn.onclick = function () {
        _kioskEditingDiscountId = null; // creating a new preset
        var sb = document.getElementById('kiosk-discount-save-btn');
        if (sb) sb.textContent = 'Save';
        form.style.display = '';
        addBtn.style.display = 'none';
        document.getElementById('kiosk-discount-form-name').value = '';
        document.getElementById('kiosk-discount-form-value').value = '';
        // Reset scope to "Whole Cart" and clear the type checkboxes
        modal.querySelectorAll('.kiosk-discount-scope-btn').forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-scope') === 'cart');
        });
        var tp = document.getElementById('kiosk-discount-types');
        if (tp) {
          tp.style.display = 'none';
          tp.querySelectorAll('input[type="checkbox"]').forEach(function (c) { c.checked = false; });
        }
        // Reset type to percentage
        modal.querySelectorAll('.kiosk-discount-type-btn').forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-type') === 'percentage');
        });
      };
    }

    var typeBtns = modal.querySelectorAll('.kiosk-discount-type-btn');
    typeBtns.forEach(function (btn) {
      btn.onclick = function () {
        typeBtns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
      };
    });

    var typesPanel = document.getElementById('kiosk-discount-types');
    var scopeBtns = modal.querySelectorAll('.kiosk-discount-scope-btn');
    scopeBtns.forEach(function (btn) {
      btn.onclick = function () {
        scopeBtns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        if (typesPanel) typesPanel.style.display = (btn.getAttribute('data-scope') === 'type') ? '' : 'none';
      };
    });

    // Two-tier checkbox sync: a parent ("All Kits"/"All Ingredients") toggles its
    // children; unchecking a child unchecks the parent.
    if (typesPanel) {
      typesPanel.querySelectorAll('input[data-group]').forEach(function (parent) {
        var group = parent.getAttribute('data-group');
        parent.onchange = function () {
          typesPanel.querySelectorAll('input[data-token]').forEach(function (c) {
            if (c.getAttribute('data-token').indexOf(group + ':') === 0) c.checked = parent.checked;
          });
        };
      });
      typesPanel.querySelectorAll('input[data-token]').forEach(function (c) {
        var t = c.getAttribute('data-token');
        if (t.indexOf(':') === -1) return; // single tokens (service/recipe) have no parent
        var group = t.split(':')[0];
        c.onchange = function () {
          var parent = typesPanel.querySelector('input[data-group="' + group + '"]');
          if (!parent) return;
          var all = true;
          typesPanel.querySelectorAll('input[data-token]').forEach(function (cc) {
            if (cc.getAttribute('data-token').indexOf(group + ':') === 0 && !cc.checked) all = false;
          });
          parent.checked = all;
        };
      });
    }

    var saveBtn = document.getElementById('kiosk-discount-save-btn');
    if (saveBtn) {
      saveBtn.onclick = function () {
        var name = (document.getElementById('kiosk-discount-form-name').value || '').trim();
        var value = parseFloat(document.getElementById('kiosk-discount-form-value').value);
        var typeBtn = modal.querySelector('.kiosk-discount-type-btn.active');
        var scopeBtn = modal.querySelector('.kiosk-discount-scope-btn.active');
        var type = typeBtn ? typeBtn.getAttribute('data-type') : 'percentage';
        var scope = scopeBtn ? scopeBtn.getAttribute('data-scope') : 'cart';

        if (!name) { showToast('Enter a discount name', 'error'); return; }
        if (!isFinite(value) || value <= 0) { showToast('Enter a valid value', 'error'); return; }
        if (type === 'percentage' && value > 100) { showToast('Percentage cannot exceed 100%', 'error'); return; }

        var payload = { name: name, type: type, value: value, scope: scope };
        if (scope === 'type') {
          payload.applies_to = kioskCollectAppliesTo();
          if (!payload.applies_to.length) { showToast('Pick at least one product type', 'error'); return; }
        }

        var mwUrl = _kcEnv.mwUrl;
        var editingId = _kioskEditingDiscountId;
        var url = editingId
          ? mwUrl + '/api/kiosk/discounts/' + encodeURIComponent(editingId)
          : mwUrl + '/api/kiosk/discounts';
        fetch(url, _kcMergeAuth({
          method: editingId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }))
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.ok) {
            showToast(editingId ? 'Preset updated' : 'Preset saved', 'success');
            _kioskEditingDiscountId = null;
            saveBtn.textContent = 'Save';
            kioskLoadDiscountPresets();
            form.style.display = 'none';
            document.getElementById('kiosk-discount-add-btn').style.display = '';
            kioskRenderDiscountMgmtList();
            setTimeout(function () { kioskRenderDiscountMgmtList(); }, 500);
          } else {
            showToast(data.error || 'Failed to save', 'error');
          }
        })
        .catch(function () { showToast('Network error', 'error'); });
      };
    }

    var cancelFormBtn = document.getElementById('kiosk-discount-cancel-btn');
    if (cancelFormBtn) {
      cancelFormBtn.onclick = function () {
        _kioskEditingDiscountId = null;
        var sb = document.getElementById('kiosk-discount-save-btn');
        if (sb) sb.textContent = 'Save';
        form.style.display = 'none';
        document.getElementById('kiosk-discount-add-btn').style.display = '';
      };
    }
  }

  function kioskRenderDiscountMgmtList() {
    var list = document.getElementById('kiosk-discount-mgmt-list');
    if (!list) return;

    var mwUrl = _kcEnv.mwUrl;
    fetch(mwUrl + '/api/kiosk/discounts', _kcMergeAuth({}))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var presets = data.discounts || [];
        _kioskDiscountPresets = presets.filter(function (d) { return d.active; });

        if (!presets.length) {
          list.innerHTML = '<p style="padding:0.75rem 0;color:var(--ink-tertiary);text-align:center;">No presets yet</p>';
          return;
        }

        var html = '';
        presets.forEach(function (p) {
          var detail = p.type === 'percentage' ? (p.value + '%') : ('$' + parseFloat(p.value).toFixed(2));
          detail += ' · ' + kioskDiscountScopeLabel(p);
          var isActive = p.active !== false;
          html += '<div class="kiosk-discount-mgmt-row' + (isActive ? '' : ' kiosk-discount-mgmt-row--inactive') + '" data-id="' + escapeHTML(p.id) + '">';
          html += '<span class="kiosk-discount-mgmt-name">' + escapeHTML(p.name) + '</span>';
          html += '<span class="kiosk-discount-mgmt-info">' + detail + '</span>';
          html += '<button type="button" class="kiosk-discount-mgmt-toggle' + (isActive ? ' is-active' : '') + '" data-id="' + escapeHTML(p.id) + '" data-active="' + isActive + '">' + (isActive ? 'Active' : 'Paused') + '</button>';
          html += '<button type="button" class="kiosk-discount-mgmt-edit" data-id="' + escapeHTML(p.id) + '">Edit</button>';
          html += '<button type="button" class="kiosk-discount-mgmt-delete" data-id="' + escapeHTML(p.id) + '">&times;</button>';
          html += '</div>';
        });
        list.innerHTML = html;

        list.querySelectorAll('.kiosk-discount-mgmt-toggle').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var id = btn.getAttribute('data-id');
            var nowActive = btn.getAttribute('data-active') === 'true';
            fetch(mwUrl + '/api/kiosk/discounts/' + encodeURIComponent(id), _kcMergeAuth({
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ active: !nowActive })
            }))
            .then(function (r) { return r.json(); })
            .then(function (data) {
              if (data.ok) {
                showToast(!nowActive ? 'Preset activated' : 'Preset paused', 'success');
                kioskLoadDiscountPresets();
                kioskRenderDiscountMgmtList();
              } else {
                showToast(data.error || 'Failed to update', 'error');
              }
            })
            .catch(function () { showToast('Network error', 'error'); });
          });
        });

        list.querySelectorAll('.kiosk-discount-mgmt-edit').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var id = btn.getAttribute('data-id');
            var preset = null;
            for (var i = 0; i < presets.length; i++) {
              if (presets[i].id === id) { preset = presets[i]; break; }
            }
            if (preset) kioskPopulateDiscountForm(preset);
          });
        });

        list.querySelectorAll('.kiosk-discount-mgmt-delete').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var id = btn.getAttribute('data-id');
            if (!confirm('Delete this preset?')) return;
            fetch(mwUrl + '/api/kiosk/discounts/' + encodeURIComponent(id), _kcMergeAuth({
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' }
            }))
            .then(function () {
              showToast('Preset deleted', 'success');
              kioskLoadDiscountPresets();
              kioskRenderDiscountMgmtList();
            })
            .catch(function () { showToast('Failed to delete', 'error'); });
          });
        });
      })
      .catch(function () {
        list.innerHTML = '<p style="padding:0.75rem 0;color:#c00;">Failed to load presets</p>';
      });
  }

  // ===== Public namespace (D-06: prefix dropped) =====
  var KioskCore = {
    init: kcInit,

    // cart building / catalog / render / totals
    fmt: kioskFmt,
    renderRecipeIngredients: kioskRenderRecipeIngredients,
    fetchRecipeQuote: kioskFetchRecipeQuote,
    scheduleRecipeQuote: kioskScheduleRecipeQuote,
    loadIngredientCatalog: kioskLoadIngredientCatalog,
    renderKioskModifyRows: renderKioskModifyRows,
    attachKioskModifyRowListeners: attachKioskModifyRowListeners,
    showIngredientAutocomplete: kioskShowIngredientAutocomplete,
    hideIngredientAutocomplete: kioskHideIngredientAutocomplete,
    effectiveRate: kioskEffectiveRate,
    getItemType: kioskGetItemType,
    isConsignment: kioskIsConsignment,
    itemCategory: kioskItemCategory,
    isWeightItem: kioskIsWeightItem,
    checkStockOverflow: kioskCheckStockOverflow,
    itemTax: kioskItemTax,
    cartIsEmpty: kioskCartIsEmpty,
    cartHasKits: kioskCartHasKits,
    findMakersFee: kioskFindMakersFee,
    findMaterialsFee: kioskFindMaterialsFee,
    countKitsInCart: kioskCountKitsInCart,
    syncKitFees: kioskSyncKitFees,
    isKitFee: kioskIsKitFee,
    findProductById: kioskFindProductById,
    r2: kioskR2,
    calcTotals: kioskCalcTotals,
    showView: kioskShowView,
    setMode: kioskSetMode,
    loadProducts: kioskLoadProducts,
    loadRecipes: kioskLoadRecipes,
    recipePrice: kioskRecipePrice,
    recipePriceForContext: kioskRecipePriceForContext,
    renderRecipes: kioskRenderRecipes,
    showRecipePrompt: kioskShowRecipePrompt,
    updateSummaryPrice: kioskUpdateSummaryPrice,
    selectSaleType: kioskSelectSaleType,
    updateAddToCartButton: kioskUpdateAddToCartButton,
    checkRecipeAvailability: kioskCheckRecipeAvailability,
    renderAvailBanner: kioskRenderAvailBanner,
    addRecipeToCart: kioskAddRecipeToCart,
    populateCategories: kioskPopulateCategories,
    getFilteredProducts: kioskGetFilteredProducts,
    renderProducts: kioskRenderProducts,
    renderProductGrid: kioskRenderProductGrid,
    renderProductList: kioskRenderProductList,
    addToCart: kioskAddToCart,
    setQty: kioskSetQty,
    removeFromCart: kioskRemoveFromCart,
    clearCart: kioskClearCart,
    renderCart: kioskRenderCart,
    showCustomerStep: kioskShowCustomerStep,
    showError: kioskShowError,

    // discount display (Task 1 slice — calcTotals dependency)
    updateDiscountDisplay: kioskUpdateDiscountDisplay,
    calcDiscountAmount: kioskCalcDiscountAmount,
    loadDiscountPresets: kioskLoadDiscountPresets,
    showDiscountPopover: kioskShowDiscountPopover,
    applyDiscount: kioskApplyDiscount,
    removeDiscount: kioskRemoveDiscount,
    refreshAfterDiscountChange: kioskRefreshAfterDiscountChange,
    collectAppliesTo: kioskCollectAppliesTo,
    populateDiscountForm: kioskPopulateDiscountForm,
    discountScopeLabel: kioskDiscountScopeLabel,
    showDiscountMgmt: kioskShowDiscountMgmt,
    renderDiscountMgmtList: kioskRenderDiscountMgmtList,

    // ---- Test-export-style accessors (mirror js/kiosk.js's existing idiom) ----
    _getQuote: function () { return _kioskQuote; },
    _setQuote: function (q) { _kioskQuote = q; },
    _getSelectedRecipe: function () { return _kioskSelectedRecipe; },
    _setSelectedRecipe: function (r) { _kioskSelectedRecipe = r; },
    _getSaleType: function () { return _kioskSaleType; },
    _setSaleType: function (s) { _kioskSaleType = s; },
    _getTargetVolumeL: function () { return _kioskTargetVolumeL; },
    _setTargetVolumeL: function (v) { _kioskTargetVolumeL = v; },
    _getCart: function () { return _kcEnv.getCart(); },
    _setCart: function (v) { _kcEnv.setCart(v); },
    _setRecipeAvailability: function (a) { _kioskRecipeAvailability = a; },
    _getModifiedIngredients: function () { return _kcEnv.getModifiedIngredients(); },
    _setModifiedIngredients: function (v) { _kcEnv.setModifiedIngredients(v); },
    _getMillGrain: function () { return _kioskMillGrain; },
    _setMillGrain: function (v) { _kioskMillGrain = v; },
    _getFilters: function () { return _kioskFilters; },
    _getViewMode: function () { return _kioskViewMode; },
    _setViewMode: function (v) { _kioskViewMode = v; },
    _setProductsLoaded: function (v) { _kioskProductsLoaded = v; },
    _getProductsLoaded: function () { return _kioskProductsLoaded; },
    _getProductsLoading: function () { return _kioskProductsLoading; },
    _getProducts: function () { return _kioskProducts; },
    _setModifyPanelOpen: function (v) { _kioskModifyPanelOpen = v; }
  };

  // ===== Dual-mode export (D-01) =====
  if (typeof window !== 'undefined') {
    window.KioskCore = KioskCore;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = KioskCore;
  }

})();
