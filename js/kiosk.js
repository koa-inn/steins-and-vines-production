// ===== Steins & Vines In-Store POS (Standalone Kiosk) =====
// Self-contained IIFE — no dependency on admin.js.

(function () {
  'use strict';

  // ===== Test-only KioskCore attach (mirrors the module.exports guard pattern
  // already used at the bottom of this file) — inert in the browser, where
  // <script src="kiosk-core.min.js"> has already run and set window.KioskCore
  // before this file parses. Under Node/Jest, window.KioskCore is undefined,
  // so this loads the shared skeleton (48-01 Task 2 / RESEARCH.md Pitfall 4).
  if (typeof window !== 'undefined' && !window.KioskCore && typeof require === 'function') {
    require('./kiosk-core.js');
  }

  // ===== Kiosk Device Token (D-46-01) =====
  // Typed-in device credential replacing per-staff Google sign-in on the
  // shared in-store iPad. Persisted in localStorage; sent as the
  // x-device-token header on every kiosk middleware call in place of the
  // leaked shared admin API key. The staff PIN (KIOSK_PIN) still gates the
  // PIN pad on top of this device credential (D-46-02).
  var DEVICE_TOKEN_KEY = 'sv_kiosk_device_token';

  function kioskDeviceToken() {
    return localStorage.getItem(DEVICE_TOKEN_KEY) || '';
  }

  function saveKioskDeviceToken(token) {
    localStorage.setItem(DEVICE_TOKEN_KEY, token || '');
  }

  // ===== KioskCore wiring (Phase 48-02/48-03 de-fork, D-01/D-02/D-06) =====
  // Cart building, catalog/recipe rendering, totals (incl. the discount
  // branch), and (as of 48-03 Task 1) the payment/checkout/terminal/confirm/
  // receipt path itself now live in js/kiosk-core.js as context-agnostic
  // logic. kiosk.js injects ONLY environment (auth + the handful of
  // not-yet-migrated SO-subsystem state/behavior hooks, bridged until 48-03
  // Task 2) through KioskCore.init — never behaviour.
  KioskCore.init({
    mwUrl: kioskMwUrl(),
    buildAuthOptions: function () {
      return { headers: { 'x-device-token': kioskDeviceToken() } };
    },
    getCart: function () { return _kioskCart; },
    setCart: function (v) { _kioskCart = v; },
    getDiscount: function () { return _kioskDiscount; },
    setDiscount: function (v) { _kioskDiscount = v; },
    getGiftCard: function () { return _kioskGiftCard; },
    setGiftCard: function (v) { _kioskGiftCard = v; },
    getCustomer: function () { return _kioskCustomer; },
    setCustomer: function (v) { _kioskCustomer = v; },
    getRecipeContext: function () { return _kioskRecipeContext; },
    setRecipeContext: function (v) { _kioskRecipeContext = v; },
    getModifiedIngredients: function () { return _kioskModifiedIngredients; },
    setModifiedIngredients: function (v) { _kioskModifiedIngredients = v; },
    getImportedSoId: function () { return _kioskImportedSoId; },
    getImportedSoNumber: function () { return _kioskImportedSoNumber; },
    // 48-03 Task 1: bridge for the imported-SO checkout fork's dependency on
    // the still-not-yet-migrated SO subsystem (kioskCollectPayment,
    // kioskShowSoError, the imported-SO-updated flag, the local SO list).
    // Task 2 internalizes all of this into KioskCore's own closure and
    // removes this bridge.
    getImportedSoUpdated: function () { return _kioskImportedSoUpdated; },
    setImportedSoUpdated: function (v) { _kioskImportedSoUpdated = v; },
    syncSalesOrderBalance: function (soId, balance, total) {
      for (var j = 0; j < _kioskSalesOrders.length; j++) {
        if (_kioskSalesOrders[j].salesorder_id === soId) {
          _kioskSalesOrders[j].balance = balance;
          _kioskSalesOrders[j].total = total;
          break;
        }
      }
    },
    collectPayment: function (soId) { kioskCollectPayment(soId); },
    showSoError: function (title, msg, canRetry, extra) { kioskShowSoError(title, msg, canRetry, extra); },
    // Behavior hooks bridging to functions not yet migrated (custom-item /
    // gift-card-issue modals stay in kiosk.js per PATTERNS.md; clearImportedSo
    // moves in Task 2).
    showCustomItemModal: function () { kioskShowCustomItemModal(); },
    showGiftCardIssueModal: function () { kioskShowGiftCardIssueModal(); },
    clearImportedSo: function () { kioskClearImportedSo(); }
  });

  // Local aliases so every existing call site (kioskCalcTotals(), kioskRenderCart(),
  // event listeners referencing these by name, etc.) keeps working unchanged while
  // actually consuming the shared implementation via KioskCore.* (D-01/D-02).
  var kioskFmt = KioskCore.fmt;
  var kioskRenderRecipeIngredients = KioskCore.renderRecipeIngredients;
  var kioskFetchRecipeQuote = KioskCore.fetchRecipeQuote;
  var kioskScheduleRecipeQuote = KioskCore.scheduleRecipeQuote;
  var kioskLoadIngredientCatalog = KioskCore.loadIngredientCatalog;
  var renderKioskModifyRows = KioskCore.renderKioskModifyRows;
  var attachKioskModifyRowListeners = KioskCore.attachKioskModifyRowListeners;
  var kioskShowIngredientAutocomplete = KioskCore.showIngredientAutocomplete;
  var kioskHideIngredientAutocomplete = KioskCore.hideIngredientAutocomplete;
  var kioskEffectiveRate = KioskCore.effectiveRate;
  var kioskGetItemType = KioskCore.getItemType;
  var kioskIsConsignment = KioskCore.isConsignment;
  var kioskItemCategory = KioskCore.itemCategory;
  var kioskIsWeightItem = KioskCore.isWeightItem;
  var kioskCheckStockOverflow = KioskCore.checkStockOverflow;
  var kioskItemTax = KioskCore.itemTax;
  var kioskCartIsEmpty = KioskCore.cartIsEmpty;
  var kioskCartHasKits = KioskCore.cartHasKits;
  var kioskFindMakersFee = KioskCore.findMakersFee;
  var kioskFindMaterialsFee = KioskCore.findMaterialsFee;
  var kioskCountKitsInCart = KioskCore.countKitsInCart;
  var kioskSyncKitFees = KioskCore.syncKitFees;
  var kioskIsKitFee = KioskCore.isKitFee;
  var kioskFindProductById = KioskCore.findProductById;
  var kioskR2 = KioskCore.r2;
  var kioskCalcTotals = KioskCore.calcTotals;
  var kioskShowView = KioskCore.showView;
  var kioskSetMode = KioskCore.setMode;
  var kioskLoadProducts = KioskCore.loadProducts;
  var kioskLoadRecipes = KioskCore.loadRecipes;
  var kioskRecipePrice = KioskCore.recipePrice;
  var kioskRecipePriceForContext = KioskCore.recipePriceForContext;
  var kioskRenderRecipes = KioskCore.renderRecipes;
  var kioskShowRecipePrompt = KioskCore.showRecipePrompt;
  var kioskUpdateSummaryPrice = KioskCore.updateSummaryPrice;
  var kioskSelectSaleType = KioskCore.selectSaleType;
  var kioskUpdateAddToCartButton = KioskCore.updateAddToCartButton;
  var kioskCheckRecipeAvailability = KioskCore.checkRecipeAvailability;
  var kioskRenderAvailBanner = KioskCore.renderAvailBanner;
  var kioskAddRecipeToCart = KioskCore.addRecipeToCart;
  var kioskPopulateCategories = KioskCore.populateCategories;
  var kioskGetFilteredProducts = KioskCore.getFilteredProducts;
  var kioskRenderProducts = KioskCore.renderProducts;
  var kioskRenderProductGrid = KioskCore.renderProductGrid;
  var kioskRenderProductList = KioskCore.renderProductList;
  var kioskAddToCart = KioskCore.addToCart;
  var kioskSetQty = KioskCore.setQty;
  var kioskRemoveFromCart = KioskCore.removeFromCart;
  var kioskClearCart = KioskCore.clearCart;
  var kioskRenderCart = KioskCore.renderCart;
  var kioskShowCustomerStep = KioskCore.showCustomerStep;
  var kioskShowError = KioskCore.showError;
  // 48-03 Task 1: payment/checkout/terminal/confirm/receipt path aliases
  // (kioskSetTerminalStatus has no remaining kiosk.js call site — it's only
  // called from kioskCheckTerminal, which is fully core-internal now.)
  var kioskCheckTerminal = KioskCore.checkTerminal;
  var kioskStartCheckout = KioskCore.startCheckout;
  var kioskProceedToPayment = KioskCore.proceedToPayment;
  var kioskShowReceipt = KioskCore.showReceipt;
  var kioskUpdateDiscountDisplay = KioskCore.updateDiscountDisplay;
  var kioskCalcDiscountAmount = KioskCore.calcDiscountAmount;
  var kioskLoadDiscountPresets = KioskCore.loadDiscountPresets;
  var kioskShowDiscountPopover = KioskCore.showDiscountPopover;
  var kioskApplyDiscount = KioskCore.applyDiscount;
  var kioskRemoveDiscount = KioskCore.removeDiscount;
  var kioskRefreshAfterDiscountChange = KioskCore.refreshAfterDiscountChange;
  var kioskCollectAppliesTo = KioskCore.collectAppliesTo;
  var kioskPopulateDiscountForm = KioskCore.populateDiscountForm;
  var kioskDiscountScopeLabel = KioskCore.discountScopeLabel;
  var kioskShowDiscountMgmt = KioskCore.showDiscountMgmt;
  var kioskRenderDiscountMgmtList = KioskCore.renderDiscountMgmtList;

  // ===== Toast Notification System =====

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

  function removeToast(toast) {
    if (toast._removed) return;
    toast._removed = true;
    clearTimeout(toast._timer);
    toast.classList.add('removing');
    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 150);
  }

  // ===== Device Token Gate (replaces Google sign-in, D-46-01/D-46-02) =====

  function initKioskAuth() {
    var signoutBtn = document.getElementById('kiosk-signout');
    if (signoutBtn) {
      // Repurposed: was "Sign Out" for the removed per-staff Google session;
      // now reopens the device-token prompt for recovery/replacement (D-46-03).
      signoutBtn.textContent = 'Device Settings';
      signoutBtn.style.display = '';
      signoutBtn.addEventListener('click', showDeviceTokenPrompt);
    }

    if (kioskDeviceToken()) {
      showLockScreen({});
    } else {
      showDeviceTokenPrompt();
    }
  }

  // Hidden/unobtrusive settings prompt (D-46-01/D-46-03) — reuses the existing
  // #kiosk-signin screen (previously the Google sign-in card) since customers
  // may see this screen; it is not a full staff login UI.
  function showDeviceTokenPrompt() {
    var kioskApp = document.getElementById('kiosk-app');
    if (kioskApp) kioskApp.style.display = 'none';
    var lockScreen = document.getElementById('kiosk-lock-screen');
    if (lockScreen) lockScreen.style.display = 'none';

    var signinScreen = document.getElementById('kiosk-signin');
    if (!signinScreen) return;
    signinScreen.style.display = '';

    var promptText = signinScreen.querySelector('p');
    if (promptText) promptText.textContent = 'Enter this device’s token to continue';

    var deniedMsg = document.getElementById('kiosk-denied-msg');
    if (deniedMsg) deniedMsg.style.display = 'none';

    var mount = document.getElementById('kiosk-google-signin-btn');
    if (mount && !mount.querySelector('#kiosk-device-token-input')) {
      mount.innerHTML = '';

      var input = document.createElement('input');
      input.type = 'password';
      input.className = 'admin-input';
      input.id = 'kiosk-device-token-input';
      input.placeholder = 'Device token';
      input.setAttribute('autocomplete', 'off');

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn';
      btn.textContent = 'Save';

      var save = function () {
        var value = input.value.trim();
        if (!value) return;
        saveKioskDeviceToken(value);
        input.value = '';
        showLockScreen({});
      };
      btn.addEventListener('click', save);
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') save();
      });

      mount.appendChild(input);
      mount.appendChild(btn);
    }
  }

  function showKioskApp() {
    document.getElementById('kiosk-signin').style.display = 'none';
    document.getElementById('kiosk-app').style.display = '';

    var emailEl = document.getElementById('kiosk-user-email');
    if (emailEl) emailEl.textContent = '';

    var deniedMsg = document.getElementById('kiosk-denied-msg');
    if (deniedMsg) deniedMsg.style.display = 'none';

    startInactivityTimer();
    kioskCheckTerminal();
    kioskLoadProducts();
    // D-06: render the empty-cart state on load so "+ Add custom item" is
    // available before any catalog item is added (kioskRenderCart is otherwise
    // only triggered on cart change).
    kioskRenderCart();
  }

  // ===== PIN Lock Screen =====

  function showLockScreen(session) {
    _isLocked = true;
    _pinBuffer = '';
    _pinAttempts = 0;
    var lockScreen = document.getElementById('kiosk-lock-screen');
    var userEl = document.getElementById('kiosk-lock-user');
    var errorEl = document.getElementById('kiosk-lock-error');
    var dots = document.querySelectorAll('.kiosk-lock-dot');

    if (userEl) userEl.textContent = (session && (session.name || session.email)) || '';
    if (errorEl) errorEl.textContent = '';
    dots.forEach(function (d) { d.classList.remove('kiosk-lock-dot--filled'); });

    lockScreen.style.display = '';
    lockScreen.classList.remove('kiosk-lock--exiting');

    // Wire keypad
    var keypad = document.getElementById('kiosk-lock-keypad');
    keypad.classList.remove('kiosk-lock-keypad--locked');
    keypad.querySelectorAll('.kiosk-lock-key[data-digit]').forEach(function (key) {
      key.onclick = function () { pinEntry(key.getAttribute('data-digit')); };
    });

    var backspace = document.getElementById('kiosk-lock-backspace');
    if (backspace) backspace.onclick = pinBackspace;

    // Repurposed (D-46-03): was "Sign out" for the removed Google session;
    // now reopens the device-token prompt for recovery/replacement.
    var signoutBtn = document.getElementById('kiosk-lock-signout');
    if (signoutBtn) {
      signoutBtn.textContent = 'Device Settings';
      signoutBtn.onclick = function () {
        lockScreen.style.display = 'none';
        showDeviceTokenPrompt();
      };
    }
  }

  function hideLockScreen() {
    var lockScreen = document.getElementById('kiosk-lock-screen');
    lockScreen.classList.add('kiosk-lock--exiting');
    setTimeout(function () {
      lockScreen.style.display = 'none';
      lockScreen.classList.remove('kiosk-lock--exiting');
      _isLocked = false;
    }, 250);
  }

  function pinEntry(digit) {
    if (_pinBuffer.length >= 4) return;
    _pinBuffer += digit;
    var dots = document.querySelectorAll('.kiosk-lock-dot');
    if (dots[_pinBuffer.length - 1]) dots[_pinBuffer.length - 1].classList.add('kiosk-lock-dot--filled');
    if (_pinBuffer.length === 4) {
      setTimeout(pinSubmit, 150);
    }
  }

  function pinBackspace() {
    if (_pinBuffer.length === 0) return;
    _pinBuffer = _pinBuffer.slice(0, -1);
    var dots = document.querySelectorAll('.kiosk-lock-dot');
    dots[_pinBuffer.length].classList.remove('kiosk-lock-dot--filled');
  }

  function pinClearDots() {
    _pinBuffer = '';
    document.querySelectorAll('.kiosk-lock-dot').forEach(function (d) {
      d.classList.remove('kiosk-lock-dot--filled');
    });
  }

  function pinSubmit() {
    var mwUrl = kioskMwUrl();
    fetch(mwUrl + '/api/kiosk/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-device-token': kioskDeviceToken() },
      body: JSON.stringify({ pin: _pinBuffer })
    })
    .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
    .then(function (result) {
      if (result.data.ok) {
        hideLockScreen();
        showKioskApp();
      } else {
        _pinAttempts++;
        var dotsContainer = document.getElementById('kiosk-lock-dots');
        var errorEl = document.getElementById('kiosk-lock-error');

        if (dotsContainer) {
          dotsContainer.classList.add('kiosk-lock-dots--error');
          setTimeout(function () {
            dotsContainer.classList.remove('kiosk-lock-dots--error');
            pinClearDots();
          }, 600);
        }

        if (_pinAttempts >= 5) {
          if (errorEl) errorEl.textContent = 'Too many attempts \u2014 try again in 1 minute';
          var keypad = document.getElementById('kiosk-lock-keypad');
          if (keypad) keypad.classList.add('kiosk-lock-keypad--locked');
          setTimeout(function () {
            _pinAttempts = 0;
            if (keypad) keypad.classList.remove('kiosk-lock-keypad--locked');
            if (errorEl) errorEl.textContent = '';
          }, 60000);
        } else {
          if (errorEl) {
            errorEl.textContent = 'Incorrect PIN';
            setTimeout(function () { errorEl.textContent = ''; }, 2000);
          }
        }
      }
    })
    .catch(function () {
      var errorEl = document.getElementById('kiosk-lock-error');
      if (errorEl) errorEl.textContent = 'Cannot verify \u2014 check connection';
      pinClearDots();
    });
  }

  // ===== Inactivity Timer =====

  function startInactivityTimer() {
    stopInactivityTimer();
    var events = ['touchstart', 'click', 'keydown'];
    function resetTimer() {
      if (_isLocked) return;
      clearTimeout(_inactivityTimer);
      _inactivityTimer = setTimeout(lockKiosk, INACTIVITY_TIMEOUT);
    }
    events.forEach(function (evt) {
      document.addEventListener(evt, resetTimer, { passive: true });
    });
    _inactivityTimer = setTimeout(lockKiosk, INACTIVITY_TIMEOUT);
    // Store cleanup function
    window._kioskInactivityCleanup = function () {
      events.forEach(function (evt) {
        document.removeEventListener(evt, resetTimer);
      });
      clearTimeout(_inactivityTimer);
    };
  }

  function stopInactivityTimer() {
    if (window._kioskInactivityCleanup) window._kioskInactivityCleanup();
    clearTimeout(_inactivityTimer);
  }

  function lockKiosk() {
    stopInactivityTimer();
    // Shared iPad, no per-staff Google session to expire — the device token
    // persists indefinitely (D-46-04); re-locking always returns to the PIN pad.
    showLockScreen({});
  }

  // ===== Shared Utilities =====

  // escapeHTML — canonical apostrophe-escaping implementation (mirrors js/lib/utils.js).
  // kiosk.js is a standalone bundle (not part of concat:js) so carries its own copy.
  function escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ===== Batch QR + Label =====
  // Moved to js/kiosk-core.js (48-03 Task 1) — generateBatchQR/buildBatchLabelHTML/
  // LABEL_CSS/AGREEMENT_TEXT are used only by kioskShowReceipt's "Save Label"
  // button, which moved into KioskCore in the same task.

  // ===== PIN Lock State =====
  var _pinBuffer = '';
  var _pinAttempts = 0;
  var _inactivityTimer = null;
  var _isLocked = false;
  var INACTIVITY_TIMEOUT = 10 * 60 * 1000; // 10 minutes

  // ===== Kiosk Sale State =====
  // NOTE (Phase 48-02/48-03 de-fork): most cart/catalog/recipe-browse/discount
  // state now lives in js/kiosk-core.js's private closure (D-02) — kioskProducts,
  // kioskRecipes, the recipe-selection/quote/modify-panel state, the product
  // filters/view-mode, and the discount presets are all core-owned now, reached
  // via KioskCore accessors where this file still needs them (bootstrap wiring
  // below). 48-03 Task 1 additionally moved the payment/checkout/terminal/
  // confirm/receipt path itself into KioskCore, so _kioskTerminalReady and
  // _kioskSaleData are now core-owned too (reached here, where still needed
  // by the not-yet-migrated SO subsystem, via KioskCore._getTerminalReady()).
  // The state that remains here is exactly the subset still read/written by
  // the not-yet-migrated SO-checkout fork (deferred to 48-03 Task 2) and is
  // bridged into KioskCore.init above via get/set callbacks so core's moved
  // functions can reach it too.

  var _kioskCart = {};
  var _kioskSearchTimer = null;
  var _kioskCustomer = null; // { contact_id, name, email } or null (walk-in)
  var _kioskHideOutOfStock = false;
  var _kioskCustomCounter = 0; // auto-incrementing counter for custom-line cart keys
  var _kioskGiftCertCounter = 0; // counter for gift-cert cart line keys (GIFTCARD-01)

  var _kioskDiscount = null;
  // null = no discount
  // { presetId: 'id', name: 'Staff 10%', type: 'percentage'|'fixed', value: 10, scope: 'cart'|'item', targetItemId: '' }

  var _kioskGiftCard = null;
  // null = no gift card applied to this sale; { cert_number, amount_applied, balance } when applied (Phase 44, D-08)

  // Customer browse mode state
  var _kioskCbTab = 'kits';
  var _kioskCbSearch = '';
  var _kioskCbSearchTimer = null;

  // Sales Order / Collect Payment state
  var _kioskSalesOrders = [];
  var _kioskSoItems = [];       // items for new SO creation
  var _kioskSoCustomer = null;  // { contact_id, name, email }
  var _kioskSoSearchTimer = null;
  var _kioskSoPayingId = null;  // tracks SO being paid (for retry)
  var _kioskImportedSoId = null;        // SO ID when cart was imported from an SO
  var _kioskImportedSoNumber = null;    // SO number for display (e.g., "SO-001234")
  var _kioskImportedSoUpdated = false;  // true after SO update succeeds -- skip on retry (D-08)
  var _kioskSoActiveChips = ['open', 'draft'];  // default active chip filter (D-10)

  var _kioskRecipeContext = null; // { recipe_id, recipe_name, sale_type, mill_grain, locked_price, ingredients }

  // Phase 36 state vars
  var _kioskModifiedIngredients = null;  // array of base-quantity ingredients (null = unmodified)

  // ===== Kiosk Helpers =====

  function kioskMwUrl() {
    return (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.MIDDLEWARE_URL)
      ? SHEETS_CONFIG.MIDDLEWARE_URL : '';
  }


  // ===== View Switching =====


  // ===== Terminal Status Bar =====
  // Moved to js/kiosk-core.js (48-03 Task 1, D-02) — kioskSetTerminalStatus/
  // kioskCheckTerminal now live in KioskCore; aliased below.


  // ===== Customer Browse Mode =====

  function kioskCbIsWine(p) {
    var haystack = ((p.name || '') + ' ' + kioskItemCategory(p)).toLowerCase();
    var keywords = ['wine', 'red', 'white', 'ros', 'cider', 'seltzer', 'chardonnay', 'merlot', 'cab', 'pinot', 'sauvignon', 'malbec', 'shiraz', 'gewurz'];
    for (var i = 0; i < keywords.length; i++) {
      if (haystack.indexOf(keywords[i]) !== -1) return true;
    }
    return false;
  }

  function kioskCbIsBeer(p) {
    var haystack = ((p.name || '') + ' ' + kioskItemCategory(p)).toLowerCase();
    var keywords = ['beer', 'ale', 'lager', 'ipa', 'stout', 'porter', 'hefe', 'wheat', 'pilsner', 'pale', 'amber'];
    for (var i = 0; i < keywords.length; i++) {
      if (haystack.indexOf(keywords[i]) !== -1) return true;
    }
    return false;
  }

  function kioskCbRenderWineCard(p) {
    var inCart = _kioskCart[p.item_id] ? _kioskCart[p.item_id].qty : 0;
    var oos = (parseFloat(p.stock_on_hand) || 0) <= 0;
    var cat = kioskItemCategory(p);
    var price = kioskEffectiveRate(p);
    var html = '<div class="kiosk-label-wine' + (oos ? ' oos' : '') + '" data-item-id="' + p.item_id + '">';
    if (inCart > 0) html += '<div class="kiosk-cb-in-cart-badge">' + inCart + '</div>';
    html += '<div class="cb-label-body">';
    html += '<div class="cb-ornament"></div>';
    html += '<div class="cb-product-name">' + escapeHTML(p.name) + '</div>';
    if (cat) html += '<div class="cb-product-category">' + escapeHTML(cat) + '</div>';
    html += '<div class="cb-spacer"></div>';
    html += '</div>';
    html += '<div class="cb-price-footer">';
    html += '<div class="cb-price-col"><div class="cb-price-label">In Store</div><div class="cb-price-value">' + kioskFmt(price) + '</div></div>';
    html += '</div>';
    html += '<button type="button" class="cb-add-btn' + (inCart > 0 ? ' in-cart' : '') + '" ' + (oos ? 'disabled' : '') + '>';
    html += oos ? 'Out of Stock' : (inCart > 0 ? '\u2713 In Cart (' + inCart + ')' : 'Add to Cart');
    html += '</button>';
    html += '</div>';
    return html;
  }

  function kioskCbRenderBeerCard(p) {
    var inCart = _kioskCart[p.item_id] ? _kioskCart[p.item_id].qty : 0;
    var oos = (parseFloat(p.stock_on_hand) || 0) <= 0;
    var cat = kioskItemCategory(p);
    var price = kioskEffectiveRate(p);
    var html = '<div class="kiosk-label-beer' + (oos ? ' oos' : '') + '" data-item-id="' + p.item_id + '">';
    if (inCart > 0) html += '<div class="kiosk-cb-in-cart-badge">' + inCart + '</div>';
    html += '<div class="cb-label-body">';
    html += '<div class="cb-product-category">' + escapeHTML(cat || 'Beer') + '</div>';
    html += '<div class="cb-product-name">' + escapeHTML(p.name) + '</div>';
    html += '<div class="cb-gold-rule"></div>';
    html += '<div class="cb-spacer"></div>';
    html += '</div>';
    html += '<div class="cb-price-footer">';
    html += '<div class="cb-price-col"><div class="cb-price-label">In Store</div><div class="cb-price-value">' + kioskFmt(price) + '</div></div>';
    html += '</div>';
    html += '<button type="button" class="cb-add-btn' + (inCart > 0 ? ' in-cart' : '') + '" ' + (oos ? 'disabled' : '') + '>';
    html += oos ? 'Out of Stock' : (inCart > 0 ? '\u2713 In Cart (' + inCart + ')' : 'Add to Cart');
    html += '</button>';
    html += '</div>';
    return html;
  }

  function kioskCbRenderCard(p) {
    var inCart = _kioskCart[p.item_id] ? _kioskCart[p.item_id].qty : 0;
    var oos = (parseFloat(p.stock_on_hand) || 0) <= 0;
    var cat = kioskItemCategory(p);
    var price = kioskEffectiveRate(p);
    var stock = parseFloat(p.stock_on_hand) || 0;
    var stockClass = oos ? 'out' : (stock <= 5 ? 'low' : '');
    var stockLabel = oos ? 'Out of stock' : (stock <= 5 ? 'Low stock (' + Math.round(stock) + ')' : '');
    var html = '<div class="kiosk-cb-card' + (oos ? ' oos' : '') + '" data-item-id="' + p.item_id + '">';
    if (inCart > 0) html += '<div class="kiosk-cb-in-cart-badge">' + inCart + '</div>';
    if (p.image_name && p.sku) {
      html += '<img class="cb-card-img" src="images/products/' + encodeURIComponent(p.sku) + '.png" alt="" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';">';
      html += '<div class="cb-card-img-placeholder" style="display:none;">\uD83D\uDCE6</div>';
    } else {
      html += '<div class="cb-card-img-placeholder">\uD83D\uDCE6</div>';
    }
    html += '<div class="cb-card-body">';
    html += '<div class="cb-card-name">' + escapeHTML(p.name) + '</div>';
    if (cat) html += '<div class="cb-card-category">' + escapeHTML(cat) + '</div>';
    html += '<div class="cb-card-price">' + kioskFmt(price) + '</div>';
    if (stockLabel) html += '<div class="cb-card-stock ' + stockClass + '">' + stockLabel + '</div>';
    html += '<button type="button" class="cb-add-btn' + (inCart > 0 ? ' in-cart' : '') + '" ' + (oos ? 'disabled' : '') + '>';
    html += oos ? 'Out of Stock' : (inCart > 0 ? '\u2713 In Cart (' + inCart + ')' : 'Add to Cart');
    html += '</button>';
    html += '</div>';
    html += '</div>';
    return html;
  }

  function kioskRenderCbGrid() {
    var grid = document.getElementById('kiosk-cb-grid');
    if (!grid) return;

    var search = _kioskCbSearch.toLowerCase().trim();

    var filtered = KioskCore._getProducts().filter(function (p) {
      var ptype = (p.product_type || '').toLowerCase();
      if (_kioskCbTab === 'kits') {
        if (ptype !== 'kit') return false;
      } else {
        if (ptype !== 'ingredient' && ptype !== 'service') return false;
        if ((parseFloat(p.rate) || 0) === 0) return false;
      }
      if (search) {
        var haystack = ((p.name || '') + ' ' + kioskItemCategory(p)).toLowerCase();
        if (haystack.indexOf(search) === -1) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      grid.innerHTML = '<p class="kiosk-loading">No products found.</p>';
      return;
    }

    var html = '';
    filtered.forEach(function (p) {
      var ptype = (p.product_type || '').toLowerCase();
      if (ptype === 'kit') {
        if (kioskCbIsWine(p)) {
          html += kioskCbRenderWineCard(p);
        } else if (kioskCbIsBeer(p)) {
          html += kioskCbRenderBeerCard(p);
        } else {
          html += kioskCbRenderCard(p);
        }
      } else {
        html += kioskCbRenderCard(p);
      }
    });

    grid.innerHTML = html;

    Array.prototype.forEach.call(grid.querySelectorAll('.cb-add-btn:not([disabled])'), function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var card = btn.closest('[data-item-id]');
        if (!card) return;
        var itemId = card.getAttribute('data-item-id');
        var product = null;
        var cbProducts = KioskCore._getProducts();
        for (var i = 0; i < cbProducts.length; i++) {
          if (cbProducts[i].item_id === itemId) { product = cbProducts[i]; break; }
        }
        if (!product) return;
        kioskAddToCart(product);
        kioskRenderCbGrid();
        kioskUpdateCbCartBar();
      });
    });
  }

  function kioskUpdateCbCartBar() {
    var bar = document.getElementById('kiosk-cb-cart-bar');
    var summary = document.getElementById('kiosk-cb-cart-summary');
    if (!bar || !summary) return;
    var count = 0;
    var ids = Object.keys(_kioskCart);
    for (var i = 0; i < ids.length; i++) {
      count += _kioskCart[ids[i]].qty;
    }
    if (count === 0) {
      bar.style.display = 'none';
    } else {
      bar.style.display = '';
      var totals = kioskCalcTotals();
      summary.textContent = count + ' item' + (count !== 1 ? 's' : '') + ' \u2014 ' + kioskFmt(totals.total);
    }
  }

  function kioskShowCustomerBrowse() {
    kioskShowView('browse-customer');
    var btn = document.getElementById('kiosk-browse-mode-btn');
    if (btn) btn.style.display = 'none';
    kioskRenderCbGrid();
    kioskUpdateCbCartBar();
  }

  function kioskExitCustomerBrowse() {
    kioskShowView('browse');
    var btn = document.getElementById('kiosk-browse-mode-btn');
    if (btn) btn.style.display = '';
  }


  // ===== Custom Item Modal (D-05, D-06) =====

  function kioskShowCustomItemModal() {
    var overlay = document.getElementById('kiosk-custom-item-overlay');
    if (!overlay) {
      // Build the overlay once and append to kiosk container
      overlay = document.createElement('div');
      overlay.id = 'kiosk-custom-item-overlay';
      overlay.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'right:0', 'bottom:0',
        'background:rgba(0,0,0,0.55)', 'z-index:1200',
        'display:flex', 'align-items:center', 'justify-content:center'
      ].join(';');
      overlay.innerHTML = [
        '<div style="background:#fff;border-radius:12px;padding:1.5rem;width:min(90vw,440px);box-shadow:0 8px 32px rgba(0,0,0,0.25);">',
        '<h3 style="margin:0 0 1rem;font-size:1.25rem;">Add custom item</h3>',
        '<div style="margin-bottom:1rem;">',
        '<label style="display:block;font-weight:600;margin-bottom:0.25rem;" for="kci-desc">Description <span style="color:#c00;">*</span></label>',
        '<input id="kci-desc" type="text" maxlength="100" placeholder="e.g. Equipment rental" autocomplete="off"',
        ' style="width:100%;box-sizing:border-box;padding:0.6rem;font-size:1.1rem;border:1px solid #ccc;border-radius:6px;">',
        '</div>',
        '<div style="margin-bottom:1rem;">',
        '<label style="display:block;font-weight:600;margin-bottom:0.25rem;" for="kci-note">Note (optional)</label>',
        '<input id="kci-note" type="text" maxlength="100" placeholder="e.g. weekend" autocomplete="off"',
        ' style="width:100%;box-sizing:border-box;padding:0.6rem;font-size:1.1rem;border:1px solid #ccc;border-radius:6px;">',
        '</div>',
        '<div style="display:flex;gap:1rem;margin-bottom:1rem;">',
        '<div style="flex:1;">',
        '<label style="display:block;font-weight:600;margin-bottom:0.25rem;" for="kci-price">Price ($)</label>',
        '<input id="kci-price" type="number" step="0.01" min="0" placeholder="0.00" inputmode="decimal"',
        ' style="width:100%;box-sizing:border-box;padding:0.6rem;font-size:1.1rem;border:1px solid #ccc;border-radius:6px;">',
        '</div>',
        '<div style="flex:1;">',
        '<label style="display:block;font-weight:600;margin-bottom:0.25rem;" for="kci-qty">Qty</label>',
        '<input id="kci-qty" type="number" step="1" min="1" value="1" inputmode="numeric"',
        ' style="width:100%;box-sizing:border-box;padding:0.6rem;font-size:1.1rem;border:1px solid #ccc;border-radius:6px;">',
        '</div>',
        '</div>',
        '<div style="margin-bottom:1.25rem;display:flex;align-items:center;gap:0.6rem;">',
        '<input id="kci-exempt" type="checkbox" style="width:1.3rem;height:1.3rem;cursor:pointer;">',
        '<label for="kci-exempt" style="font-size:1rem;cursor:pointer;">Tax-exempt (default: taxable at 5% GST)</label>',
        '</div>',
        '<div id="kci-error" style="color:#c00;font-size:0.9rem;margin-bottom:0.75rem;display:none;"></div>',
        '<div style="display:flex;gap:0.75rem;justify-content:flex-end;">',
        '<button id="kci-cancel" type="button" style="padding:0.65rem 1.25rem;font-size:1rem;border:1px solid #ccc;border-radius:6px;background:#f5f5f5;cursor:pointer;">Cancel</button>',
        '<button id="kci-add" type="button" style="padding:0.65rem 1.25rem;font-size:1rem;border:none;border-radius:6px;background:#5a3e1b;color:#fff;cursor:pointer;font-weight:600;">Add to cart</button>',
        '</div>',
        '</div>'
      ].join('');
      var kioskRoot = document.getElementById('kiosk-root') || document.body;
      kioskRoot.appendChild(overlay);
    }
    overlay.style.display = 'flex';

    // Reset fields
    var descEl = document.getElementById('kci-desc');
    var noteEl = document.getElementById('kci-note');
    var priceEl = document.getElementById('kci-price');
    var qtyEl = document.getElementById('kci-qty');
    var exemptEl = document.getElementById('kci-exempt');
    var errEl = document.getElementById('kci-error');
    if (descEl) { descEl.value = ''; descEl.focus(); }
    if (noteEl) noteEl.value = '';
    if (priceEl) priceEl.value = '';
    if (qtyEl) qtyEl.value = '1';
    if (exemptEl) exemptEl.checked = false;
    if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }

    var cancelBtn = document.getElementById('kci-cancel');
    var addBtn = document.getElementById('kci-add');

    if (cancelBtn) {
      cancelBtn.onclick = function () {
        overlay.style.display = 'none';
      };
    }
    if (addBtn) {
      addBtn.onclick = function () {
        kioskSubmitCustomItem(overlay);
      };
    }
    // Close on backdrop click
    overlay.onclick = function (e) {
      if (e.target === overlay) overlay.style.display = 'none';
    };
  }

  function kioskSubmitCustomItem(overlay) {
    var descEl = document.getElementById('kci-desc');
    var noteEl = document.getElementById('kci-note');
    var priceEl = document.getElementById('kci-price');
    var qtyEl = document.getElementById('kci-qty');
    var exemptEl = document.getElementById('kci-exempt');
    var errEl = document.getElementById('kci-error');

    function showErr(msg) {
      if (errEl) { errEl.textContent = msg; errEl.style.display = ''; }
    }

    var desc = descEl ? descEl.value.trim() : '';
    var note = noteEl ? noteEl.value.trim() : '';
    var rate = priceEl ? parseFloat(priceEl.value) : NaN;
    var qty = qtyEl ? parseInt(qtyEl.value, 10) : NaN;
    var taxExempt = exemptEl ? exemptEl.checked : false;

    // D-05 validation
    if (!desc || desc.length < 1 || desc.length > 100) {
      showErr('Description is required (1–100 characters).');
      if (descEl) descEl.focus();
      return;
    }
    if (!isFinite(rate)) {
      showErr('Please enter a valid price.');
      if (priceEl) priceEl.focus();
      return;
    }
    if (!isFinite(qty) || qty < 1 || qty !== Math.floor(qty)) {
      showErr('Quantity must be a whole number of 1 or more.');
      if (qtyEl) qtyEl.focus();
      return;
    }

    // D-03: explicit confirm for rate > 2000 or negative
    if (rate > 2000 || rate < 0) {
      var fmtAmt = '$' + Math.abs(rate).toFixed(2) + (rate < 0 ? ' (negative)' : '');
      var confirmed = window.confirm(
        'You entered ' + fmtAmt + ' — confirm this custom charge?'
      );
      if (!confirmed) return;
    }

    // Add to cart
    var customItem = {
      custom: true,
      description: desc,
      note: note,
      name: desc,
      rate: rate,
      tax_percentage: taxExempt ? 0 : 5,
      taxable: !taxExempt
    };
    _kioskCustomCounter += 1;
    _kioskCart['custom-' + _kioskCustomCounter] = { item: customItem, qty: qty };

    if (overlay) overlay.style.display = 'none';
    kioskRenderCart();
  }

  // ===== Gift Card Issue / Reload Modal (GIFTCARD-01a, 01d — D-08) =====

  function kioskShowGiftCardIssueModal() {
    var overlay = document.getElementById('kiosk-gift-card-issue-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'kiosk-gift-card-issue-overlay';
      overlay.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'right:0', 'bottom:0',
        'background:rgba(0,0,0,0.55)', 'z-index:1200',
        'display:flex', 'align-items:center', 'justify-content:center'
      ].join(';');
      overlay.innerHTML = [
        '<div style="background:#fff;border-radius:12px;padding:1.5rem;width:min(90vw,440px);box-shadow:0 8px 32px rgba(0,0,0,0.25);">',
        '<h3 id="kgci-title" style="margin:0 0 1rem;font-size:1.25rem;">Issue Gift Certificate</h3>',
        '<div style="display:flex;gap:0.5rem;margin-bottom:1rem;">',
        '<button id="kgci-mode-issue" type="button" style="flex:1;padding:0.5rem;font-size:0.95rem;border:2px solid #5a3e1b;border-radius:6px;background:#5a3e1b;color:#fff;cursor:pointer;font-weight:600;">Issue New</button>',
        '<button id="kgci-mode-reload" type="button" style="flex:1;padding:0.5rem;font-size:0.95rem;border:2px solid #ccc;border-radius:6px;background:#f5f5f5;color:#333;cursor:pointer;">Reload Existing</button>',
        '</div>',
        '<div style="margin-bottom:1rem;">',
        '<label style="display:block;font-weight:600;margin-bottom:0.25rem;" for="kgci-cert">Certificate # <span style="color:#c00;">*</span></label>',
        '<input id="kgci-cert" type="text" maxlength="10" placeholder="GC-000001" autocomplete="off"',
        ' style="width:100%;box-sizing:border-box;padding:0.6rem;font-size:1rem;border:1px solid #ccc;border-radius:6px;">',
        '</div>',
        '<div style="margin-bottom:1.25rem;">',
        '<label id="kgci-value-label" style="display:block;font-weight:600;margin-bottom:0.25rem;" for="kgci-value">Face Value ($) <span style="color:#c00;">*</span></label>',
        '<input id="kgci-value" type="number" step="0.01" min="0.01" max="2000" placeholder="0.00" inputmode="decimal"',
        ' style="width:100%;box-sizing:border-box;padding:0.6rem;font-size:1rem;border:1px solid #ccc;border-radius:6px;">',
        '</div>',
        '<div id="kgci-error" style="color:#c00;font-size:0.9rem;margin-bottom:0.75rem;display:none;"></div>',
        '<div style="display:flex;gap:0.75rem;justify-content:flex-end;">',
        '<button id="kgci-cancel" type="button" style="padding:0.65rem 1.25rem;font-size:1rem;border:1px solid #ccc;border-radius:6px;background:#f5f5f5;cursor:pointer;">Cancel</button>',
        '<button id="kgci-issue" type="button" style="padding:0.65rem 1.25rem;font-size:1rem;border:none;border-radius:6px;background:#5a3e1b;color:#fff;cursor:pointer;font-weight:600;">Issue Certificate</button>',
        '</div>',
        '</div>'
      ].join('');
      var kioskRoot = document.getElementById('kiosk-root') || document.body;
      kioskRoot.appendChild(overlay);
    }

    overlay.style.display = 'flex';

    var _gcMode = 'issue';
    var titleEl = document.getElementById('kgci-title');
    var certEl = document.getElementById('kgci-cert');
    var valueEl = document.getElementById('kgci-value');
    var valueLabelEl = document.getElementById('kgci-value-label');
    var errEl = document.getElementById('kgci-error');
    var cancelBtn = document.getElementById('kgci-cancel');
    var issueBtn = document.getElementById('kgci-issue');
    var modeIssueBtn = document.getElementById('kgci-mode-issue');
    var modeReloadBtn = document.getElementById('kgci-mode-reload');

    if (valueEl) valueEl.value = '';
    if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }

    function setGcMode(mode) {
      _gcMode = mode;
      var isIssue = mode === 'issue';
      if (titleEl) titleEl.textContent = isIssue ? 'Issue Gift Certificate' : 'Reload Gift Certificate';
      if (valueLabelEl) valueLabelEl.innerHTML = (isIssue ? 'Face Value ($)' : 'Reload Amount ($)') + ' <span style="color:#c00;">*</span>';
      if (issueBtn) issueBtn.textContent = isIssue ? 'Issue Certificate' : 'Reload Certificate';
      if (modeIssueBtn) {
        modeIssueBtn.style.background = isIssue ? '#5a3e1b' : '#f5f5f5';
        modeIssueBtn.style.color = isIssue ? '#fff' : '#333';
        modeIssueBtn.style.borderColor = isIssue ? '#5a3e1b' : '#ccc';
      }
      if (modeReloadBtn) {
        modeReloadBtn.style.background = isIssue ? '#f5f5f5' : '#5a3e1b';
        modeReloadBtn.style.color = isIssue ? '#333' : '#fff';
        modeReloadBtn.style.borderColor = isIssue ? '#ccc' : '#5a3e1b';
      }
      if (certEl) {
        certEl.value = '';
        certEl.readOnly = false;
        if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
        if (isIssue) {
          certEl.value = 'Loading…';
          certEl.readOnly = true;
          var mwUrl = kioskMwUrl();
          fetch(mwUrl + '/api/kiosk/gift-card/next-number', {
            headers: { 'x-device-token': kioskDeviceToken() }
          }).then(function (r) { return r.json(); }).then(function (d) {
            if (certEl) { certEl.value = d.suggested || ''; certEl.readOnly = false; }
          }).catch(function () {
            if (certEl) { certEl.value = ''; certEl.readOnly = false; }
          });
        }
      }
      if (valueEl) valueEl.value = '';
    }

    if (modeIssueBtn) { modeIssueBtn.onclick = function () { setGcMode('issue'); }; }
    if (modeReloadBtn) { modeReloadBtn.onclick = function () { setGcMode('reload'); }; }

    if (cancelBtn) {
      cancelBtn.onclick = function () { overlay.style.display = 'none'; };
    }
    if (issueBtn) {
      issueBtn.onclick = function () { kioskSubmitGiftCardIssue(overlay, _gcMode); };
    }
    overlay.onclick = function (e) {
      if (e.target === overlay) overlay.style.display = 'none';
    };

    // Initialize in Issue mode (fetches suggested cert number)
    setGcMode('issue');
  }

  function kioskSubmitGiftCardIssue(overlay, mode) {
    var certEl = document.getElementById('kgci-cert');
    var valueEl = document.getElementById('kgci-value');
    var errEl = document.getElementById('kgci-error');
    var issueBtn = document.getElementById('kgci-issue');

    function showGcErr(msg) {
      if (errEl) { errEl.textContent = msg; errEl.style.display = ''; }
    }

    var cert = certEl ? certEl.value.trim().toUpperCase() : '';
    var val = valueEl ? parseFloat(valueEl.value) : NaN;
    var isIssue = mode === 'issue';

    if (!/^GC-\d{6}$/.test(cert)) {
      showGcErr('Certificate number must be in the format GC-000001.');
      if (certEl) certEl.focus();
      return;
    }
    if (!isFinite(val) || val <= 0 || val > 2000) {
      showGcErr('Amount must be between $0.01 and $2,000.00.');
      if (valueEl) valueEl.focus();
      return;
    }

    if (isIssue) {
      // Issue mode: add gift_cert line to cart; cert is activated on payment success (G-44-01 fix)
      _kioskGiftCertCounter += 1;
      _kioskCart['giftcert-' + _kioskGiftCertCounter] = {
        item: {
          gift_cert: true,
          gift_action: 'issue',
          cert_number: cert,
          name: 'Gift Certificate ' + cert,
          rate: val,
          tax_percentage: 0,
          taxable: false
        },
        qty: 1
      };
      if (overlay) overlay.style.display = 'none';
      kioskRenderCart();
    } else {
      // Reload mode: pre-check cert exists and is active (UX guard; server re-validates, D-05)
      if (issueBtn) { issueBtn.disabled = true; issueBtn.textContent = 'Checking…'; }
      if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
      var mwUrl = kioskMwUrl();
      fetch(mwUrl + '/api/kiosk/gift-card/lookup?cert_number=' + encodeURIComponent(cert), {
        headers: { 'x-device-token': kioskDeviceToken() }
      })
      .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
      .then(function (result) {
        if (result.status === 404 || !result.data.ok) {
          showGcErr('Certificate not found. Check the certificate number and try again.');
          if (issueBtn) { issueBtn.disabled = false; issueBtn.textContent = 'Reload Certificate'; }
          return;
        }
        var certData = result.data.data || {};
        if (certData.status && certData.status !== 'active') {
          showGcErr('Certificate is not active and cannot be reloaded.');
          if (issueBtn) { issueBtn.disabled = false; issueBtn.textContent = 'Reload Certificate'; }
          return;
        }
        // Cert is valid and active — add reload line to cart
        _kioskGiftCertCounter += 1;
        _kioskCart['giftcert-' + _kioskGiftCertCounter] = {
          item: {
            gift_cert: true,
            gift_action: 'reload',
            cert_number: cert,
            name: 'Gift Cert Reload ' + cert,
            rate: val,
            tax_percentage: 0,
            taxable: false
          },
          qty: 1
        };
        if (overlay) overlay.style.display = 'none';
        kioskRenderCart();
      })
      .catch(function () {
        showGcErr('Connection error. Please check your connection and try again.');
        if (issueBtn) { issueBtn.disabled = false; issueBtn.textContent = 'Reload Certificate'; }
      });
    }
  }


  // ===== Checkout Flow / Payment / Receipt =====
  // Moved to js/kiosk-core.js (48-03 Task 1, D-02) — kioskStartCheckout/
  // kioskProceedToPayment (incl. the nested _kioskPushToTerminal closure,
  // the imported-SO checkout fork, and the Manager Override stock-conflict
  // handling ported from js/admin.js per D-07) and kioskShowReceipt now
  // live in KioskCore; aliased below.

  // ===== Error View =====


  // ===== Sales Orders / Collect Payment =====

  function kioskShowCollect() {
    kioskShowView('collect');
    kioskLoadSalesOrders();
  }

  function kioskLoadSalesOrders() {
    var mwUrl = kioskMwUrl();
    if (!mwUrl) {
      var list = document.getElementById('kiosk-so-list');
      if (list) list.innerHTML = '<p class="kiosk-loading">Middleware URL not configured.</p>';
      return;
    }

    var list = document.getElementById('kiosk-so-list');
    if (list) {
      list.innerHTML = '<div class="kiosk-so-skeleton"><div class="kiosk-so-skeleton-card"></div>' +
        '<div class="kiosk-so-skeleton-card"></div><div class="kiosk-so-skeleton-card"></div></div>';
    }

    fetch(mwUrl + '/api/kiosk/salesorders', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      _kioskSalesOrders = data.salesorders || [];
      kioskRenderSoChips();
      kioskRenderSoList();
    })
    .catch(function (err) {
      if (list) list.innerHTML = '<p class="kiosk-loading">Could not load sales orders. Check connection and try again.</p>';
    });
  }

  function kioskRenderSoList() {
    var list = document.getElementById('kiosk-so-list');
    if (!list) return;

    // Step 1: Chip filter (client-side, no re-fetch -- per D-09 discretion)
    var chipFiltered = _kioskSalesOrders;
    if (_kioskSoActiveChips.indexOf('all') === -1) {
      chipFiltered = _kioskSalesOrders.filter(function (so) {
        // Map Zoho 'confirmed' status to our 'paid' chip
        var displayStatus = (so.status === 'confirmed' || so.status === 'invoiced') ? 'paid' : so.status;
        return _kioskSoActiveChips.indexOf(displayStatus) !== -1;
      });
    }

    // Step 2: Search filter (existing pattern)
    var searchTerm = (document.getElementById('kiosk-so-search') || {}).value || '';
    searchTerm = searchTerm.toLowerCase().trim();
    var filtered = chipFiltered;
    if (searchTerm) {
      filtered = chipFiltered.filter(function (so) {
        var haystack = ((so.customer_name || '') + ' ' + (so.salesorder_number || '')).toLowerCase();
        return haystack.indexOf(searchTerm) !== -1;
      });
    }

    // Step 3: Empty state
    if (filtered.length === 0) {
      if (_kioskSoActiveChips.indexOf('all') !== -1 && _kioskSalesOrders.length === 0) {
        list.innerHTML = '<div class="kiosk-so-empty"><h3>No sales orders</h3><p>Create a new order to get started.</p></div>';
      } else {
        list.innerHTML = '<div class="kiosk-so-empty"><h3>No orders match this filter</h3><p>Try a different filter or search, or create a new order.</p></div>';
      }
      return;
    }

    // Step 4: Render cards
    var html = '';
    filtered.forEach(function (so) {
      var total = parseFloat(so.total) || 0;
      var balance = parseFloat(so.balance) || 0;
      var displayAmount = balance > 0 ? balance : total;
      var lineItems = so.line_items || [];
      var displayStatus = (so.status === 'confirmed' || so.status === 'invoiced') ? 'paid' : so.status;
      var isActionable = displayStatus === 'open' || displayStatus === 'draft';

      html += '<div class="kiosk-so-card" data-so-id="' + escapeHTML(so.salesorder_id) + '">';
      html += '<div class="kiosk-so-card-header">';
      html += '<span class="kiosk-so-number">' + escapeHTML(so.salesorder_number || '') + '</span>';
      html += '<span class="kiosk-so-balance">' + kioskFmt(displayAmount) + '</span>';
      html += '</div>';
      html += '<div class="kiosk-so-card-body">';
      html += '<span class="kiosk-so-customer">' + escapeHTML(so.customer_name || 'Unknown') + '</span>';
      html += '<span class="kiosk-so-date">' + escapeHTML(so.date || '') + '</span>';
      html += '</div>';

      html += '<div class="kiosk-so-card-detail" data-so-detail="' + escapeHTML(so.salesorder_id) + '" style="display:none;"></div>';
      html += '<button type="button" class="kiosk-so-toggle-btn" data-so-id="' + escapeHTML(so.salesorder_id) + '">View Items &#9662;</button>';

      // Action row (per D-05, D-11)
      html += '<div class="kiosk-so-card-actions">';
      if (isActionable) {
        if (displayAmount > 0) {
          html += '<button type="button" class="btn kiosk-so-pay-btn" data-so-id="' + escapeHTML(so.salesorder_id) + '">';
          html += 'Collect ' + kioskFmt(displayAmount);
          html += '</button>';
        } else {
          html += '<div class="kiosk-so-paid-badge">Paid</div>';
        }
        html += '<button type="button" class="btn-secondary kiosk-so-import-btn" data-so-id="' + escapeHTML(so.salesorder_id) + '">';
        html += 'Import to Cart';
        html += '</button>';
      } else {
        // D-11: closed/paid SO -- Reorder button
        html += '<div class="kiosk-so-paid-badge">' + escapeHTML(displayStatus.charAt(0).toUpperCase() + displayStatus.slice(1)) + '</div>';
        html += '<button type="button" class="btn-secondary kiosk-so-reorder-btn" data-so-id="' + escapeHTML(so.salesorder_id) + '">';
        html += 'Reorder Items';
        html += '</button>';
      }
      html += '</div>';

      html += '</div>';
    });

    list.innerHTML = html;

    // Wire pay buttons (existing pattern)
    Array.prototype.forEach.call(list.querySelectorAll('.kiosk-so-pay-btn'), function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        kioskCollectPayment(btn.getAttribute('data-so-id'));
      });
    });

    // Wire import buttons (D-01)
    Array.prototype.forEach.call(list.querySelectorAll('.kiosk-so-import-btn'), function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        kioskImportSoToCart(btn.getAttribute('data-so-id'));
      });
    });

    // Wire reorder buttons (D-11)
    Array.prototype.forEach.call(list.querySelectorAll('.kiosk-so-reorder-btn'), function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        kioskReorderSo(btn.getAttribute('data-so-id'));
      });
    });

    // Wire view-items toggle buttons
    Array.prototype.forEach.call(list.querySelectorAll('.kiosk-so-toggle-btn'), function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var soId = btn.getAttribute('data-so-id');
        var detailEl = list.querySelector('[data-so-detail="' + soId + '"]');
        if (!detailEl) return;

        if (detailEl.style.display !== 'none') {
          detailEl.style.display = 'none';
          btn.innerHTML = 'View Items &#9662;';
          return;
        }

        if (detailEl.getAttribute('data-loaded')) {
          detailEl.style.display = '';
          btn.innerHTML = 'Hide Items &#9652;';
          return;
        }

        btn.innerHTML = 'Loading...';
        var mwUrl = kioskMwUrl();
        fetch(mwUrl + '/api/kiosk/salesorder/' + encodeURIComponent(soId), {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        })
        .then(function (r) { return r.json(); })
        .then(function (detail) {
          var items = detail.line_items || [];
          if (items.length === 0) {
            detailEl.innerHTML = '<div class="kiosk-so-detail-empty">No line items</div>';
          } else {
            var itemsHtml = '';
            items.forEach(function (li) {
              itemsHtml += '<div class="kiosk-so-detail-row">';
              itemsHtml += '<span class="kiosk-so-detail-name">' + escapeHTML(li.name || '') + '</span>';
              itemsHtml += '<span class="kiosk-so-detail-qty">&times; ' + (li.quantity || 1) + '</span>';
              itemsHtml += '<span class="kiosk-so-detail-rate">' + kioskFmt(li.rate || 0) + '</span>';
              itemsHtml += '</div>';
            });
            detailEl.innerHTML = itemsHtml;
          }
          detailEl.setAttribute('data-loaded', 'true');
          detailEl.style.display = '';
          btn.innerHTML = 'Hide Items &#9652;';
        })
        .catch(function () {
          detailEl.innerHTML = '<div class="kiosk-so-detail-empty">Could not load items</div>';
          detailEl.style.display = '';
          btn.innerHTML = 'View Items &#9662;';
        });
      });
    });
  }

  // ===== Status Chip Filter (D-09, D-10) =====

  function kioskRenderSoChips() {
    Array.prototype.forEach.call(document.querySelectorAll('.kiosk-so-chip'), function (chip) {
      var status = chip.getAttribute('data-status');
      if (_kioskSoActiveChips.indexOf(status) !== -1 ||
          (_kioskSoActiveChips.indexOf('all') !== -1 && status === 'all')) {
        chip.classList.add('active');
      } else {
        chip.classList.remove('active');
      }
    });
  }

  function kioskWireSoChips() {
    Array.prototype.forEach.call(document.querySelectorAll('.kiosk-so-chip'), function (chip) {
      chip.addEventListener('click', function () {
        var status = chip.getAttribute('data-status');
        if (status === 'all') {
          _kioskSoActiveChips = ['all'];
        } else {
          var allIdx = _kioskSoActiveChips.indexOf('all');
          if (allIdx !== -1) _kioskSoActiveChips.splice(allIdx, 1);
          var i = _kioskSoActiveChips.indexOf(status);
          if (i !== -1) {
            if (_kioskSoActiveChips.length > 1) _kioskSoActiveChips.splice(i, 1);
          } else {
            _kioskSoActiveChips.push(status);
          }
        }
        kioskRenderSoChips();
        kioskRenderSoList();
      });
    });
  }

  // ===== Import SO to Cart (D-01, D-02, D-03, D-04) =====

  function kioskImportSoToCart(soId) {
    var so = null;
    for (var i = 0; i < _kioskSalesOrders.length; i++) {
      if (_kioskSalesOrders[i].salesorder_id === soId) { so = _kioskSalesOrders[i]; break; }
    }
    if (!so) { showToast('Order not found', 'error'); return; }

    // D-03: confirm if cart non-empty
    if (Object.keys(_kioskCart).length > 0) {
      if (!confirm('Replace current cart with items from ' + (so.salesorder_number || '') + '? Current cart will be cleared.')) return;
    }

    if (!KioskCore._getProductsLoaded()) {
      showToast('Products are still loading. Please wait and try again.', 'info');
      return;
    }

    showToast('Loading order items...', 'info');

    var mwUrl = kioskMwUrl();
    fetch(mwUrl + '/api/kiosk/salesorder/' + encodeURIComponent(soId), {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    })
    .then(function (r) { return r.json(); })
    .then(function (detail) {
      var lineItems = detail.line_items || [];
      if (lineItems.length === 0) {
        showToast('This order has no line items to import', 'warning');
        return;
      }

      _kioskCart = {};
      _kioskDiscount = null;
      var skipped = 0;

      lineItems.forEach(function (li) {
        if (!li.item_id) { skipped++; return; }
        var product = kioskFindProductById(li.item_id);
        if (product) {
          _kioskCart[product.item_id] = { item: product, qty: li.quantity || 1 };
        } else {
          skipped++;
        }
      });

      _kioskImportedSoId = so.salesorder_id;
      _kioskImportedSoNumber = so.salesorder_number || '';
      _kioskImportedSoUpdated = false;

      if (skipped > 0) {
        showToast(skipped + ' item(s) not found in current catalog — skipped', 'warning');
      }

      kioskSyncKitFees();
      kioskRenderCart();
      kioskRenderProducts();
      kioskShowView('browse');
    })
    .catch(function () {
      showToast('Could not load order details — check connection', 'error');
    });
  }

  // ===== Reorder SO (D-11) =====

  function kioskReorderSo(soId) {
    var so = null;
    for (var i = 0; i < _kioskSalesOrders.length; i++) {
      if (_kioskSalesOrders[i].salesorder_id === soId) { so = _kioskSalesOrders[i]; break; }
    }
    if (!so) { showToast('Order not found', 'error'); return; }

    if (!confirm('Create a new order with the same items as ' + (so.salesorder_number || '') + '?')) return;

    var mwUrl = kioskMwUrl();
    if (!mwUrl) { showToast('Middleware URL not configured', 'error'); return; }

    showToast('Loading order items...', 'info');

    fetch(mwUrl + '/api/kiosk/salesorder/' + encodeURIComponent(soId), {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    })
    .then(function (r) { return r.json(); })
    .then(function (detail) {
      var lineItems = (detail.line_items || []).filter(function (li) { return !!li.item_id; });

      if (lineItems.length === 0) {
        showToast('No items could be copied from this order', 'error');
        return;
      }

      var payload = {
        customer_id: so.customer_id,
        items: lineItems.map(function (li) {
          return { item_id: li.item_id, name: li.name, quantity: li.quantity, rate: li.rate };
        })
      };

      return fetch(mwUrl + '/api/kiosk/salesorder-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-device-token': kioskDeviceToken() },
        body: JSON.stringify(payload)
      })
      .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
      .then(function (result) {
        if (result.data && result.data.ok) {
          showToast('New order created: ' + escapeHTML(result.data.salesorder_number || ''), 'success');
          kioskLoadSalesOrders();
        } else {
          showToast((result.data && result.data.error) || 'Could not create order', 'error');
        }
      });
    })
    .catch(function () {
      showToast('Could not create order — network error', 'error');
    });
  }

  // ===== Clear Imported SO State =====

  function kioskClearImportedSo() {
    _kioskImportedSoId = null;
    _kioskImportedSoNumber = null;
    _kioskImportedSoUpdated = false;
  }

  function kioskCollectPayment(soId) {
    var so = null;
    for (var i = 0; i < _kioskSalesOrders.length; i++) {
      if (_kioskSalesOrders[i].salesorder_id === soId) { so = _kioskSalesOrders[i]; break; }
    }
    if (!so) {
      showToast('Sales order not found', 'error');
      return;
    }

    _kioskSoPayingId = soId;
    var balance = parseFloat(so.balance) || 0;
    var mwUrl = kioskMwUrl();
    if (!mwUrl) {
      showToast('Middleware URL not configured', 'error');
      return;
    }

    if (!KioskCore._getTerminalReady()) {
      showToast('POS terminal is not ready. Check terminal status below.', 'error');
      return;
    }

    // Show payment view
    kioskShowView('payment');

    var amountEl = document.getElementById('kiosk-payment-amount');
    var msgEl = document.getElementById('kiosk-terminal-msg');
    var spinnerEl = document.getElementById('kiosk-spinner');
    var itemsEl = document.getElementById('kiosk-payment-items');
    var cancelBtn = document.getElementById('kiosk-cancel-payment');

    if (amountEl) amountEl.textContent = kioskFmt(balance);
    if (msgEl) msgEl.textContent = 'Collecting payment for ' + escapeHTML(so.salesorder_number || '') + '...';
    if (spinnerEl) spinnerEl.style.display = '';

    if (itemsEl) {
      var itemHtml = '<div class="kiosk-payment-item-row"><span>Order</span><span>' + escapeHTML(so.salesorder_number || '') + '</span></div>';
      itemHtml += '<div class="kiosk-payment-item-row"><span>Customer</span><span>' + escapeHTML(so.customer_name || '') + '</span></div>';
      var lineItems = so.line_items || [];
      lineItems.forEach(function (li) {
        itemHtml += '<div class="kiosk-payment-item-row">';
        itemHtml += '<span>' + escapeHTML(li.name || li.description || '') + ' x' + (li.quantity || 1) + '</span>';
        itemHtml += '<span>' + kioskFmt((parseFloat(li.rate) || 0) * (li.quantity || 1)) + '</span>';
        itemHtml += '</div>';
      });
      itemsEl.innerHTML = itemHtml;
    }

    var cancelled = false;
    if (cancelBtn) {
      cancelBtn.disabled = false;
      cancelBtn.onclick = function () {
        cancelled = true;
        kioskShowCollect();
      };
    }

    fetch(mwUrl + '/api/kiosk/salesorder-pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-device-token': kioskDeviceToken() },
      body: JSON.stringify({ salesorder_id: soId })
    })
    .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
    .then(function (result) {
      if (cancelled) return;
      if (spinnerEl) spinnerEl.style.display = 'none';

      if (result.data && result.data.ok) {
        // Show a simplified receipt for SO payment
        kioskShowView('receipt');
        var body = document.getElementById('kiosk-receipt-body');
        if (body) {
          var html = '';
          html += '<div class="kiosk-receipt-row"><span>Order</span><span>' + escapeHTML(result.data.salesorder_number || so.salesorder_number || '') + '</span></div>';
          html += '<div class="kiosk-receipt-row" style="font-weight:700;font-size:1.05rem;">';
          html += '<strong>Amount</strong><strong>' + kioskFmt(result.data.amount || balance) + '</strong>';
          html += '</div>';
          if (result.data.transaction_id) {
            html += '<div class="kiosk-receipt-row"><span>Transaction</span><span style="font-size:0.8rem;font-family:monospace;">' + escapeHTML(result.data.transaction_id) + '</span></div>';
          }
          if (result.data.card_type) {
            html += '<div class="kiosk-receipt-row"><span>Card</span><span>' + escapeHTML(result.data.card_type) + '</span></div>';
          }
          body.innerHTML = html;
        }
        var newSaleBtn = document.getElementById('kiosk-new-sale-btn');
        if (newSaleBtn) {
          newSaleBtn.onclick = function () {
            kioskLoadProducts(true);
            _kioskSoPayingId = null;
            if (_kioskImportedSoId) {
              // D-07: Return to empty cart/product grid after SO payment
              kioskClearImportedSo();
              _kioskCart = {};
              _kioskDiscount = null;
              kioskRenderCart();
              kioskShowView('browse');
            } else {
              kioskShowCollect();
            }
          };
        }
      } else if (result.status === 402) {
        kioskShowSoError('Payment Declined', result.data.error || 'Card was declined. Please try a different payment method.', true);
      } else if (result.status === 504) {
        kioskShowSoError('Terminal Timeout', result.data.error || 'Terminal did not respond in time. Please try again.', true);
      } else if (result.data && result.data.payment_voided) {
        kioskShowSoError('Payment Voided',
          'Your payment was automatically reversed. No charge was made to the customer.',
          true, { txnId: result.data.voided_transaction_id || '' });
      } else {
        kioskShowSoError('Payment Error', (result.data && result.data.error) || 'An error occurred. Please try again.', true);
      }
    })
    .catch(function () {
      if (cancelled) return;
      if (spinnerEl) spinnerEl.style.display = 'none';
      kioskShowSoError('Connection Error', 'Could not reach the payment server. Please try again.', true);
    });
  }

  function kioskShowSoError(title, msg, canRetry, extra) {
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
        if (_kioskSoPayingId) {
          kioskCollectPayment(_kioskSoPayingId);
        } else {
          kioskShowCollect();
        }
      };
    }

    if (backBtn) {
      backBtn.textContent = 'Back to Orders';
      backBtn.onclick = function () {
        _kioskSoPayingId = null;
        kioskShowCollect();
      };
    }
  }

  // ===== Create Sales Order =====

  function kioskShowCreateSo() {
    kioskShowView('create-so');
    _kioskSoItems = [];
    _kioskSoCustomer = null;

    // Reset UI
    var custSearch = document.getElementById('kiosk-so-customer-search');
    var custDropdown = document.getElementById('kiosk-so-customer-dropdown');
    var custInfo = document.getElementById('kiosk-so-customer-info');
    var itemSearch = document.getElementById('kiosk-so-item-search');
    var itemDropdown = document.getElementById('kiosk-so-item-dropdown');
    var itemsList = document.getElementById('kiosk-so-items-list');
    var totalEl = document.getElementById('kiosk-so-total');
    var notesEl = document.getElementById('kiosk-so-notes');

    if (custSearch) custSearch.value = '';
    if (custDropdown) { custDropdown.style.display = 'none'; custDropdown.innerHTML = ''; }
    if (custInfo) { custInfo.style.display = 'none'; custInfo.innerHTML = ''; }
    if (itemSearch) itemSearch.value = '';
    if (itemDropdown) { itemDropdown.style.display = 'none'; itemDropdown.innerHTML = ''; }
    if (itemsList) itemsList.innerHTML = '';
    if (totalEl) totalEl.textContent = '$0.00';
    if (notesEl) notesEl.value = '';

    // Ensure products are loaded
    if (!KioskCore._getProductsLoaded() && !KioskCore._getProductsLoading()) {
      kioskLoadProducts();
    }

    // Wire customer search
    var custTimer = null;
    if (custSearch) {
      custSearch.oninput = function () {
        clearTimeout(custTimer);
        var q = custSearch.value.trim();
        if (!q) { if (custDropdown) custDropdown.style.display = 'none'; return; }
        custTimer = setTimeout(function () {
          var mwUrl = kioskMwUrl();
          fetch(mwUrl + '/api/contacts/search?q=' + encodeURIComponent(q), { headers: { 'x-device-token': kioskDeviceToken() } })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (!custDropdown) return;
            var contacts = (data.contacts || []).slice(0, 8);
            if (!contacts.length) {
              custDropdown.innerHTML = '<div class="kiosk-dropdown-item" style="color:var(--ink-muted);">No results</div>';
              custDropdown.style.display = '';
              return;
            }
            var html = '';
            contacts.forEach(function (c) {
              html += '<div class="kiosk-dropdown-item" data-cid="' + escapeHTML(c.contact_id || '') + '" data-name="' + escapeHTML(c.contact_name || c.name || '') + '" data-email="' + escapeHTML(c.email || '') + '">';
              html += '<strong>' + escapeHTML(c.contact_name || c.name || '') + '</strong>';
              if (c.email) html += ' <span style="color:var(--ink-tertiary);">' + escapeHTML(c.email) + '</span>';
              html += '</div>';
            });
            custDropdown.innerHTML = html;
            custDropdown.style.display = '';
            Array.prototype.forEach.call(custDropdown.querySelectorAll('.kiosk-dropdown-item'), function (item) {
              item.addEventListener('click', function () {
                _kioskSoCustomer = {
                  contact_id: item.getAttribute('data-cid'),
                  name: item.getAttribute('data-name'),
                  email: item.getAttribute('data-email')
                };
                custDropdown.style.display = 'none';
                custSearch.value = '';
                kioskRenderSoCustomerInfo();
              });
            });
          })
          .catch(function () {
            if (custDropdown) {
              custDropdown.innerHTML = '<div class="kiosk-dropdown-item" style="color:var(--ink-muted);">Search failed</div>';
              custDropdown.style.display = '';
            }
          });
        }, 300);
      };
    }

    // Wire item search
    if (itemSearch) {
      itemSearch.oninput = function () {
        var q = itemSearch.value.trim().toLowerCase();
        if (!q) { if (itemDropdown) itemDropdown.style.display = 'none'; return; }
        var matches = KioskCore._getProducts().filter(function (p) {
          var haystack = ((p.name || '') + ' ' + (p.sku || '')).toLowerCase();
          return haystack.indexOf(q) !== -1;
        }).slice(0, 10);
        if (!itemDropdown) return;
        if (!matches.length) {
          itemDropdown.innerHTML = '<div class="kiosk-dropdown-item" style="color:var(--ink-muted);">No products found</div>';
          itemDropdown.style.display = '';
          return;
        }
        var html = '';
        matches.forEach(function (p) {
          html += '<div class="kiosk-dropdown-item" data-item-id="' + escapeHTML(p.item_id) + '">';
          html += escapeHTML(p.name || '') + ' <span style="color:var(--ink-tertiary);">' + kioskFmt(parseFloat(p.rate) || 0) + '</span>';
          html += '</div>';
        });
        itemDropdown.innerHTML = html;
        itemDropdown.style.display = '';
        Array.prototype.forEach.call(itemDropdown.querySelectorAll('.kiosk-dropdown-item'), function (item) {
          item.addEventListener('click', function () {
            var itemId = item.getAttribute('data-item-id');
            var product = null;
            var soProducts = KioskCore._getProducts();
            for (var i = 0; i < soProducts.length; i++) {
              if (soProducts[i].item_id === itemId) { product = soProducts[i]; break; }
            }
            if (product) kioskAddSoItem(product);
            itemDropdown.style.display = 'none';
            itemSearch.value = '';
          });
        });
      };
    }

    // Wire footer buttons
    var backBtn = document.getElementById('kiosk-create-so-back');
    var saveBtn = document.getElementById('kiosk-create-so-save');
    var payBtn = document.getElementById('kiosk-create-so-pay');

    if (backBtn) backBtn.onclick = function () { kioskShowCollect(); };
    if (saveBtn) saveBtn.onclick = function () { kioskCreateSalesOrder(false); };
    if (payBtn) payBtn.onclick = function () { kioskCreateSalesOrder(true); };
  }

  function kioskRenderSoCustomerInfo() {
    var custInfo = document.getElementById('kiosk-so-customer-info');
    if (!custInfo) return;
    if (!_kioskSoCustomer) {
      custInfo.style.display = 'none';
      custInfo.innerHTML = '';
      return;
    }
    custInfo.style.display = '';
    custInfo.innerHTML = '<div class="kiosk-so-customer-selected">' +
      '<span>' + escapeHTML(_kioskSoCustomer.name || '') +
      (_kioskSoCustomer.email ? ' &mdash; ' + escapeHTML(_kioskSoCustomer.email) : '') +
      '</span>' +
      '<button type="button" class="kiosk-so-customer-clear" id="kiosk-so-clear-customer">&times;</button>' +
      '</div>';
    var clearBtn = document.getElementById('kiosk-so-clear-customer');
    if (clearBtn) {
      clearBtn.onclick = function () {
        _kioskSoCustomer = null;
        kioskRenderSoCustomerInfo();
      };
    }
  }

  function kioskAddSoItem(product) {
    var existing = null;
    for (var i = 0; i < _kioskSoItems.length; i++) {
      if (_kioskSoItems[i].item_id === product.item_id) { existing = _kioskSoItems[i]; break; }
    }
    if (existing) {
      existing.quantity += 1;
    } else {
      _kioskSoItems.push({
        item_id: product.item_id,
        name: product.name || '',
        rate: parseFloat(product.rate) || 0,
        quantity: 1
      });
    }
    kioskRenderSoItems();
  }

  function kioskRemoveSoItem(itemId) {
    _kioskSoItems = _kioskSoItems.filter(function (it) { return it.item_id !== itemId; });
    kioskRenderSoItems();
  }

  function kioskRenderSoItems() {
    var listEl = document.getElementById('kiosk-so-items-list');
    var totalEl = document.getElementById('kiosk-so-total');
    if (!listEl) return;

    if (_kioskSoItems.length === 0) {
      listEl.innerHTML = '<p style="color:var(--ink-muted);font-size:0.9rem;padding:0.5rem 0;">No items added yet.</p>';
      if (totalEl) totalEl.textContent = '$0.00';
      return;
    }

    var total = 0;
    var html = '';
    _kioskSoItems.forEach(function (it) {
      var lineTotal = (parseFloat(it.rate) || 0) * (it.quantity || 1);
      total += lineTotal;
      html += '<div class="kiosk-so-item-row">';
      html += '<div class="kiosk-so-item-name">' + escapeHTML(it.name) + '</div>';
      html += '<div class="kiosk-so-item-controls">';
      html += '<button type="button" class="kiosk-qty-btn kiosk-so-qty-dec" data-item-id="' + escapeHTML(it.item_id) + '">-</button>';
      html += '<span class="kiosk-qty-val">' + it.quantity + '</span>';
      html += '<button type="button" class="kiosk-qty-btn kiosk-so-qty-inc" data-item-id="' + escapeHTML(it.item_id) + '">+</button>';
      html += '<span class="kiosk-so-item-total">' + kioskFmt(lineTotal) + '</span>';
      html += '<button type="button" class="kiosk-so-item-remove" data-item-id="' + escapeHTML(it.item_id) + '">&times;</button>';
      html += '</div>';
      html += '</div>';
    });
    listEl.innerHTML = html;
    if (totalEl) totalEl.textContent = kioskFmt(total);

    // Wire qty buttons
    Array.prototype.forEach.call(listEl.querySelectorAll('.kiosk-so-qty-dec'), function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-item-id');
        for (var i = 0; i < _kioskSoItems.length; i++) {
          if (_kioskSoItems[i].item_id === id) {
            _kioskSoItems[i].quantity -= 1;
            if (_kioskSoItems[i].quantity <= 0) { _kioskSoItems.splice(i, 1); }
            break;
          }
        }
        kioskRenderSoItems();
      });
    });

    Array.prototype.forEach.call(listEl.querySelectorAll('.kiosk-so-qty-inc'), function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-item-id');
        for (var i = 0; i < _kioskSoItems.length; i++) {
          if (_kioskSoItems[i].item_id === id) { _kioskSoItems[i].quantity += 1; break; }
        }
        kioskRenderSoItems();
      });
    });

    Array.prototype.forEach.call(listEl.querySelectorAll('.kiosk-so-item-remove'), function (btn) {
      btn.addEventListener('click', function () {
        kioskRemoveSoItem(btn.getAttribute('data-item-id'));
      });
    });
  }

  function kioskCreateSalesOrder(andPay) {
    if (!_kioskSoCustomer) {
      showToast('Please select a customer', 'error');
      return;
    }
    if (_kioskSoItems.length === 0) {
      showToast('Please add at least one item', 'error');
      return;
    }

    var mwUrl = kioskMwUrl();
    if (!mwUrl) {
      showToast('Middleware URL not configured', 'error');
      return;
    }

    if (andPay && !KioskCore._getTerminalReady()) {
      showToast('POS terminal is not ready. Check terminal status below.', 'error');
      return;
    }

    var saveBtn = document.getElementById('kiosk-create-so-save');
    var payBtn = document.getElementById('kiosk-create-so-pay');
    if (saveBtn) saveBtn.disabled = true;
    if (payBtn) payBtn.disabled = true;

    var notesEl = document.getElementById('kiosk-so-notes');
    var notes = notesEl ? notesEl.value.trim() : '';

    var payload = {
      customer_id: _kioskSoCustomer.contact_id,
      items: _kioskSoItems.map(function (it) {
        return { item_id: it.item_id, name: it.name, quantity: it.quantity, rate: it.rate };
      }),
      notes: notes
    };

    fetch(mwUrl + '/api/kiosk/salesorder-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-device-token': kioskDeviceToken() },
      body: JSON.stringify(payload)
    })
    .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
    .then(function (result) {
      if (saveBtn) saveBtn.disabled = false;
      if (payBtn) payBtn.disabled = false;

      if (result.data && result.data.ok) {
        if (andPay) {
          // Inject the new SO into local list so kioskCollectPayment can find it
          var newSo = {
            salesorder_id: result.data.salesorder_id,
            salesorder_number: result.data.salesorder_number || '',
            customer_name: _kioskSoCustomer ? _kioskSoCustomer.name : '',
            balance: result.data.balance || result.data.total || 0,
            total: result.data.total || 0,
            date: new Date().toISOString().slice(0, 10),
            line_items: _kioskSoItems.map(function (it) {
              return { name: it.name, quantity: it.quantity, rate: it.rate };
            })
          };
          _kioskSalesOrders.unshift(newSo);
          kioskCollectPayment(result.data.salesorder_id);
        } else {
          showToast('Order ' + (result.data.salesorder_number || '') + ' created', 'success');
          kioskShowCollect();
        }
      } else {
        showToast((result.data && result.data.error) || 'Could not create order', 'error');
      }
    })
    .catch(function () {
      if (saveBtn) saveBtn.disabled = false;
      if (payBtn) payBtn.disabled = false;
      showToast('Could not create order — network error', 'error');
    });
  }


  // ===== Init Kiosk Tab =====

  function initKioskSaleTab() {
    // Search input
    var searchInput = document.getElementById('kiosk-search');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        clearTimeout(_kioskSearchTimer);
        KioskCore._getFilters().search = searchInput.value;
        _kioskSearchTimer = setTimeout(kioskRenderProducts, 200);
      });
    }

    // Category filter
    var catFilter = document.getElementById('kiosk-category-filter');
    if (catFilter) {
      catFilter.addEventListener('change', function () {
        KioskCore._getFilters().category = catFilter.value;
        kioskRenderProducts();
      });
    }

    // Type filter
    var typeFilter = document.getElementById('kiosk-type-filter');
    if (typeFilter) {
      typeFilter.addEventListener('change', function () {
        KioskCore._getFilters().type = typeFilter.value;
        kioskPopulateCategories();
        kioskRenderProducts();
      });
    }

    // Stock status filter
    var stockFilter = document.getElementById('kiosk-stock-filter');
    if (stockFilter) {
      stockFilter.addEventListener('change', function () {
        KioskCore._getFilters().stockStatus = stockFilter.value;
        kioskRenderProducts();
      });
    }

    // Sort select
    var sortSelect = document.getElementById('kiosk-sort');
    if (sortSelect) {
      sortSelect.addEventListener('change', function () {
        KioskCore._getFilters().sort = sortSelect.value;
        kioskRenderProducts();
      });
    }

    var refreshBtn = document.getElementById('kiosk-products-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        KioskCore._setProductsLoaded(false);
        kioskLoadProducts(true);
      });
    }

    var clearBtn = document.getElementById('kiosk-cart-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        if (kioskCartIsEmpty()) return;
        kioskClearCart();
      });
    }

    // Cart customer selector
    var custBtn = document.getElementById('kiosk-cart-customer-btn');
    var custSearchPanel = document.getElementById('kiosk-cart-customer-search');
    var custInput = document.getElementById('kiosk-cart-cust-input');
    var custResults = document.getElementById('kiosk-cart-cust-results');
    var custLabel = document.getElementById('kiosk-cart-customer-label');
    var custSearchTimer = null;

    function updateCustomerLabel() {
      if (!custLabel) return;
      if (_kioskCustomer) {
        custLabel.textContent = 'Customer: ' + (_kioskCustomer.name || _kioskCustomer.email || 'Selected');
        if (custBtn) custBtn.textContent = 'Change';
      } else {
        custLabel.textContent = 'Customer: Walk-in';
        if (custBtn) custBtn.textContent = 'Select';
      }
    }

    if (custBtn) {
      custBtn.addEventListener('click', function () {
        if (custSearchPanel.style.display === 'none') {
          custSearchPanel.style.display = '';
          if (custInput) { custInput.value = ''; custInput.focus(); }
          if (custResults) custResults.innerHTML = '';
        } else {
          custSearchPanel.style.display = 'none';
        }
      });
    }

    if (custInput) {
      custInput.addEventListener('input', function () {
        clearTimeout(custSearchTimer);
        var q = custInput.value.trim();
        if (!q) { if (custResults) custResults.innerHTML = ''; return; }
        custSearchTimer = setTimeout(function () {
          var mwUrl = kioskMwUrl();
          fetch(mwUrl + '/api/contacts/search?q=' + encodeURIComponent(q), { headers: { 'x-device-token': kioskDeviceToken() } })
            .then(function (r) { return r.json(); })
            .then(function (data) {
              if (!custResults) return;
              var contacts = (data.contacts || []).slice(0, 6);
              if (!contacts.length) {
                custResults.innerHTML = '<div class="kiosk-cart-cust-row" style="color:var(--ink-tertiary);">No results</div>';
                return;
              }
              var html = '';
              contacts.forEach(function (c) {
                html += '<div class="kiosk-cart-cust-row" data-id="' + escapeHTML(c.contact_id || '') + '">';
                html += '<div class="kiosk-cart-cust-name">' + escapeHTML(c.contact_name || c.name || '') + '</div>';
                if (c.email) html += '<div class="kiosk-cart-cust-email">' + escapeHTML(c.email) + '</div>';
                html += '</div>';
              });
              custResults.innerHTML = html;
              Array.prototype.forEach.call(custResults.querySelectorAll('.kiosk-cart-cust-row[data-id]'), function (row) {
                row.addEventListener('click', function () {
                  var cid = row.getAttribute('data-id');
                  var contact = null;
                  for (var ci = 0; ci < contacts.length; ci++) {
                    if ((contacts[ci].contact_id || '') === cid) { contact = contacts[ci]; break; }
                  }
                  if (contact) {
                    _kioskCustomer = {
                      contact_id: contact.contact_id || '',
                      name: contact.contact_name || contact.name || '',
                      email: contact.email || ''
                    };
                  }
                  custSearchPanel.style.display = 'none';
                  updateCustomerLabel();
                });
              });
            });
        }, 250);
      });
    }

    updateCustomerLabel();

    // Hide out-of-stock toggle
    var oosToggle = document.getElementById('kiosk-hide-oos');
    if (oosToggle) {
      oosToggle.addEventListener('change', function () {
        _kioskHideOutOfStock = oosToggle.checked;
        KioskCore._getFilters().hideOos = oosToggle.checked;
        kioskRenderProducts();
      });
    }

    // View mode toggle
    var viewBtns = document.querySelectorAll('.kiosk-view-btn');
    viewBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var view = btn.getAttribute('data-view');
        if (view === KioskCore._getViewMode()) return;
        KioskCore._setViewMode(view);
        localStorage.setItem('sv-kiosk-view-mode', view);
        viewBtns.forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-view') === view); });
        kioskRenderProducts();
      });
    });
    // Set initial active state for view toggle
    viewBtns.forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-view') === KioskCore._getViewMode()); });

    var checkoutBtn = document.getElementById('kiosk-checkout-btn');
    if (checkoutBtn) {
      checkoutBtn.addEventListener('click', kioskStartCheckout);
    }

    // Customer browse mode wiring
    var browseModeBtn = document.getElementById('kiosk-browse-mode-btn');
    if (browseModeBtn) {
      browseModeBtn.addEventListener('click', kioskShowCustomerBrowse);
    }

    var cbBackBtn = document.getElementById('kiosk-cb-back-btn');
    if (cbBackBtn) {
      cbBackBtn.addEventListener('click', kioskExitCustomerBrowse);
    }

    var cbSearch = document.getElementById('kiosk-cb-search');
    if (cbSearch) {
      cbSearch.addEventListener('input', function () {
        clearTimeout(_kioskCbSearchTimer);
        _kioskCbSearch = cbSearch.value;
        _kioskCbSearchTimer = setTimeout(kioskRenderCbGrid, 200);
      });
    }

    Array.prototype.forEach.call(document.querySelectorAll('.kiosk-cb-tab'), function (tab) {
      tab.addEventListener('click', function () {
        _kioskCbTab = tab.getAttribute('data-cb-tab');
        Array.prototype.forEach.call(document.querySelectorAll('.kiosk-cb-tab'), function (t) {
          t.classList.remove('active');
        });
        tab.classList.add('active');
        var note = document.getElementById('kiosk-cb-kits-note');
        if (note) note.style.display = _kioskCbTab === 'kits' ? '' : 'none';
        kioskRenderCbGrid();
      });
    });

    var startPurchaseBtn = document.getElementById('kiosk-cb-start-purchase-btn');
    if (startPurchaseBtn) {
      startPurchaseBtn.addEventListener('click', kioskExitCustomerBrowse);
    }

    // Sales Orders / Collect Payment wiring
    var soBtn = document.getElementById('kiosk-orders-btn');
    if (soBtn) {
      soBtn.addEventListener('click', kioskShowCollect);
    }

    kioskWireSoChips();

    var soSearch = document.getElementById('kiosk-so-search');
    if (soSearch) {
      soSearch.addEventListener('input', function () {
        clearTimeout(_kioskSoSearchTimer);
        _kioskSoSearchTimer = setTimeout(function () {
          kioskRenderSoList();
        }, 300);
      });
    }

    var soRefresh = document.getElementById('kiosk-so-refresh');
    if (soRefresh) {
      soRefresh.addEventListener('click', function () { kioskLoadSalesOrders(); });
    }

    var soCreateBtn = document.getElementById('kiosk-so-create-btn');
    if (soCreateBtn) {
      soCreateBtn.addEventListener('click', kioskShowCreateSo);
    }

    var collectBack = document.getElementById('kiosk-collect-back');
    if (collectBack) {
      collectBack.addEventListener('click', function () { kioskShowView('browse'); });
    }

    // Discount popover
    var discountBtnInit = document.getElementById('kiosk-discount-btn');
    if (discountBtnInit) {
      discountBtnInit.addEventListener('click', kioskShowDiscountPopover);
    }
    var discountCloseBtn = document.getElementById('kiosk-discount-close-btn');
    if (discountCloseBtn) {
      discountCloseBtn.addEventListener('click', function () {
        document.getElementById('kiosk-discount-popover').style.display = 'none';
      });
    }
    var discountRemoveBtn = document.getElementById('kiosk-discount-remove-btn');
    if (discountRemoveBtn) {
      discountRemoveBtn.addEventListener('click', kioskRemoveDiscount);
    }

    // Discount management
    var discountManageBtn = document.getElementById('kiosk-discount-manage-btn');
    if (discountManageBtn) {
      discountManageBtn.addEventListener('click', function () {
        document.getElementById('kiosk-discount-popover').style.display = 'none';
        kioskShowDiscountMgmt();
      });
    }

    // Load discount presets
    kioskLoadDiscountPresets();

    // Mode toggle
    var modeProdsBtn = document.getElementById('kiosk-mode-products');
    var modeRecipesBtn = document.getElementById('kiosk-mode-recipes');
    if (modeProdsBtn) modeProdsBtn.addEventListener('click', function () { kioskSetMode('products'); });
    if (modeRecipesBtn) modeRecipesBtn.addEventListener('click', function () { kioskSetMode('recipes'); });

    // Recipe prompt buttons
    var recipeBackBtn = document.getElementById('kiosk-recipe-back');
    if (recipeBackBtn) recipeBackBtn.addEventListener('click', function () {
      var prompt = document.getElementById('kiosk-recipe-prompt');
      var recipeGrid = document.getElementById('kiosk-recipe-grid');
      if (prompt) {
        prompt.style.display = 'none';
        prompt.classList.remove('kiosk-recipe-prompt-view'); // GAP-5 36-15
      }
      if (recipeGrid) recipeGrid.style.display = 'grid';
      KioskCore._setSelectedRecipe(null);
      KioskCore._setSaleType(null);
      // Phase 35+36: reset quote and modify state on Back
      KioskCore._setQuote(null);
      _kioskModifiedIngredients = null;
      KioskCore._setModifyPanelOpen(false);
      KioskCore._setTargetVolumeL(null);
    });

    var inStoreSaleBtn = document.getElementById('kiosk-btn-in-store');
    if (inStoreSaleBtn) inStoreSaleBtn.addEventListener('click', function () { kioskSelectSaleType('in-store'); });

    var takeOutSaleBtn = document.getElementById('kiosk-btn-take-out');
    if (takeOutSaleBtn) takeOutSaleBtn.addEventListener('click', function () { kioskSelectSaleType('take-out'); });

    var millCheckboxEl = document.getElementById('kiosk-mill-grain');
    if (millCheckboxEl) millCheckboxEl.addEventListener('change', function () {
      KioskCore._setMillGrain(millCheckboxEl.checked);
      kioskUpdateSummaryPrice();
      kioskUpdateAddToCartButton();
    });

    var addRecipeBtn = document.getElementById('kiosk-add-recipe-to-cart');
    if (addRecipeBtn) addRecipeBtn.addEventListener('click', kioskAddRecipeToCart);
  }

  // ===== Bootstrap =====

  document.addEventListener('DOMContentLoaded', function () {
    initKioskAuth();
    initKioskSaleTab();
  });

  // ===== Test Exports (kiosk.js — mirrors admin.js export pattern) =====
  // Exposed only under Node/Jest — not bundled into production traffic.
  // Phase 48-02 de-fork WARNING fix: the underlying state/logic for these
  // accessors now lives in js/kiosk-core.js (or, for the payment-path-shared
  // subset, is bridged into KioskCore via KioskCore.init's env callbacks
  // above) — every accessor below now delegates through KioskCore so it
  // keeps returning/mutating the SAME live state, with the EXACT property
  // names preserved (CLAUDE.md rule 10 — no test file changes needed).
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Object.assign(module.exports || {}, {
      // Phase 35 state accessors
      _kioskGetQuote: function () { return KioskCore._getQuote(); },
      _kioskSetQuote: function (q) { KioskCore._setQuote(q); },
      _kioskGetSelectedRecipe: function () { return KioskCore._getSelectedRecipe(); },
      _kioskSetSelectedRecipe: function (r) { KioskCore._setSelectedRecipe(r); },
      _kioskGetSaleType: function () { return KioskCore._getSaleType(); },
      _kioskSetSaleType: function (s) { KioskCore._setSaleType(s); },
      _kioskGetTargetVolumeL: function () { return KioskCore._getTargetVolumeL(); },
      _kioskSetTargetVolumeL: function (v) { KioskCore._setTargetVolumeL(v); },
      _kioskGetCart: function () { return KioskCore._getCart(); },
      _kioskClearCart: function () { KioskCore._setCart({}); },
      _kioskSetRecipeAvailability: function (a) { KioskCore._setRecipeAvailability(a); },
      kioskFetchRecipeQuote: kioskFetchRecipeQuote,
      kioskUpdateAddToCartButton: kioskUpdateAddToCartButton,
      kioskShowRecipePrompt: kioskShowRecipePrompt,
      // GAP-3: _kioskShowRecipePrompt alias for test-hook consistency with admin-recipe-volume-factor.test.js
      _kioskShowRecipePrompt: function (r) { return kioskShowRecipePrompt(r); },
      // Phase 36 state accessors
      _kioskGetModifiedIngredients: function () { return KioskCore._getModifiedIngredients(); },
      _kioskSetModifiedIngredients: function (v) { KioskCore._setModifiedIngredients(v); },
      renderKioskModifyRows: renderKioskModifyRows,
      // Note: kioskSaveAsNewRecipe is intentionally NOT exported — not exposed on kiosk (UI-SPEC §2)
      // Phase 46 (D-46-01): device-token gate exports
      kioskDeviceToken: kioskDeviceToken,
      saveKioskDeviceToken: saveKioskDeviceToken,
      initKioskAuth: initKioskAuth,
      showDeviceTokenPrompt: showDeviceTokenPrompt,
      showKioskApp: showKioskApp,
      kioskShowCustomerStep: kioskShowCustomerStep
    });
  }

})();
