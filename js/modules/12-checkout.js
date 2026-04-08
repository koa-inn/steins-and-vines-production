// Milling state — persists across re-renders and page reloads via sessionStorage
var _milledItemKeys = {};      // set of cart item keys the customer wants milled
var _millingServiceItem = null; // Zoho service item for milling fee (fetched lazily)

// Restore milled keys from sessionStorage
try {
  var _savedMilledKeys = sessionStorage.getItem('sv-milled-keys');
  if (_savedMilledKeys) _milledItemKeys = JSON.parse(_savedMilledKeys);
} catch (e) {}

function saveMilledKeys() {
  try {
    var keys = Object.keys(_milledItemKeys);
    if (keys.length > 0) {
      sessionStorage.setItem('sv-milled-keys', JSON.stringify(_milledItemKeys));
    } else {
      sessionStorage.removeItem('sv-milled-keys');
    }
  } catch (e) {}
}

// Maker's fee state
var _makersFeeItem = null;     // Zoho item for MAKERS-FEE (fetched lazily when kits present)
var _makersFeeLoaded = false;  // true once fetch has been attempted
var _prevHasKits = null;       // tracks previous hasKits state to avoid redundant timeslot reloads

// Payment state
var _paymentConfig = null;
var _helcimTransactionId = null;
var _helcimCheckoutToken = null;
var _awaitingPaymentSubmit = false;
var _checkoutSubmitting = false;

// Dual-cart state — set true when both ferment and ingredient carts have items
// and the page is loaded without a ?cart= param (or with no specific single-cart intent)
var _isDualCart = false;

// Form validation functions defined in 12a-checkout-validation.js:
//   getRecaptchaToken, validateCheckoutForm, renumberVisibleSteps,
//   formatPhoneInput, isValidEmail, isValidPhone,
//   applyKitSpecificVisibility, setupContactValidation

// Scheduling functions defined in 12c-checkout-scheduling.js:
//   calcCompletionRange, formatTimeslot, loadTimeslots, updateCompletionEstimate

// In Node/test environment, load the sub-modules so their exports are available.
(function () {
  if (typeof module !== 'undefined' && module.exports) {
    var _valMod = require('./12a-checkout-validation');
    var _schMod = require('./12c-checkout-scheduling');
    // Bring extracted functions into scope for the module.exports block below
    if (typeof getRecaptchaToken === 'undefined') { getRecaptchaToken = _valMod.getRecaptchaToken; }
    if (typeof validateCheckoutForm === 'undefined') { validateCheckoutForm = _valMod.validateCheckoutForm; }
    if (typeof renumberVisibleSteps === 'undefined') { renumberVisibleSteps = _valMod.renumberVisibleSteps; }
    if (typeof formatPhoneInput === 'undefined') { formatPhoneInput = _valMod.formatPhoneInput; }
    if (typeof isValidEmail === 'undefined') { isValidEmail = _valMod.isValidEmail; }
    if (typeof isValidPhone === 'undefined') { isValidPhone = _valMod.isValidPhone; }
    if (typeof applyKitSpecificVisibility === 'undefined') { applyKitSpecificVisibility = _valMod.applyKitSpecificVisibility; }
    if (typeof setupContactValidation === 'undefined') { setupContactValidation = _valMod.setupContactValidation; }
    if (typeof calcCompletionRange === 'undefined') { calcCompletionRange = _schMod.calcCompletionRange; }
    if (typeof formatTimeslot === 'undefined') { formatTimeslot = _schMod.formatTimeslot; }
    if (typeof loadTimeslots === 'undefined') { loadTimeslots = _schMod.loadTimeslots; }
    if (typeof updateCompletionEstimate === 'undefined') { updateCompletionEstimate = _schMod.updateCompletionEstimate; }
  }
}());

// --- H4: Determine which cart to use based on ?cart= URL param ---
function getActiveCheckoutCart() {
  var params = new URLSearchParams(window.location.search);
  var cartParam = params.get('cart');
  if (cartParam === 'ferment') return FERMENT_CART_KEY;
  if (cartParam === 'ingredient') return INGREDIENT_CART_KEY;
  return null; // show all / merged
}

function initReservationPage() {
  // H4: Filter items by ?cart= URL param if present; fall back to all items if that cart is empty
  var _checkoutCartKey = getActiveCheckoutCart();
  var initialItems = _checkoutCartKey ? getReservation(_checkoutCartKey) : getAllCartItems();
  if (initialItems.length === 0 && _checkoutCartKey) {
    // Specific cart is empty — fall back to all items so kit items are never silently lost
    initialItems = getAllCartItems();
  }
  if (initialItems.length === 0) {
    setTimeout(function () { window.location.href = '/products.html'; }, 1500);
  }

  // Dual-cart detection: both carts have items AND no specific ?cart= param forces a single cart
  var _dualFermentItems = getReservation(FERMENT_CART_KEY);
  var _dualIngredientItems = getReservation(INGREDIENT_CART_KEY);
  if (!_checkoutCartKey && _dualFermentItems.length > 0 && _dualIngredientItems.length > 0) {
    _isDualCart = true;
  }

  initCheckoutStepper();

  // M1: Show which cart is being checked out
  var params = new URLSearchParams(window.location.search);
  var cartParam = params.get('cart');

  var initialHasKits = initialItems.some(function (item) { return (item.item_type || 'kit') === 'kit'; });

  // Fetch maker's fee item lazily when kit items are present
  var mwUrlForFees = (typeof SHEETS_CONFIG !== 'undefined') ? (SHEETS_CONFIG.MIDDLEWARE_URL || '') : '';
  if (initialHasKits && mwUrlForFees && !_makersFeeLoaded) {
    _makersFeeLoaded = true;
    fetch(mwUrlForFees + '/api/services')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var services = data.items || [];
        for (var i = 0; i < services.length; i++) {
          var sku = (services[i].sku || services[i].item_code || '').toUpperCase();
          var name = (services[i].name || '').toLowerCase();
          if (sku === 'MAKERS-FEE' || name.indexOf('makers fee') !== -1 || name.indexOf("maker's fee") !== -1) {
            _makersFeeItem = services[i];
            break;
          }
        }
        renderReservationItems();
      })
      .catch(function () {});
  }

  // Fetch milling service item if cart contains any grain ingredients
  var hasMillableGrains = initialItems.some(function (item) {
    return (item.item_type || '') === 'ingredient' && isWeightUnit(item.unit) &&
      (item.millable || '').toLowerCase() === 'true';
  });
  if (hasMillableGrains && mwUrlForFees && !_millingServiceItem) {
    fetch(mwUrlForFees + '/api/services')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var services = data.items || [];
        for (var i = 0; i < services.length; i++) {
          if ((services[i].name || '').toLowerCase().indexOf('mill') !== -1) {
            _millingServiceItem = services[i];
            break;
          }
        }
        renderReservationItems();
      })
      .catch(function () {});
  }

  renderReservationItems();

  var items = getAllCartItems();
  var hasKits = items.some(function (item) { return (item.item_type || 'kit') === 'kit'; });

  if (hasKits) {
    loadTimeslots();
    var estimateEl = document.getElementById('completion-estimate');
    var estimateText = document.getElementById('completion-estimate-text');
    if (estimateEl && estimateText && estimateEl.classList.contains('hidden')) {
      estimateEl.classList.remove('hidden');
      estimateText.textContent = 'Your batch will be ready to bottle approximately 4\u20136 weeks after your start date. We\u2019ll notify you when it\u2019s time.';
      estimateEl.setAttribute('data-default-hint', '1');
    }
  } else {
    var picker = document.getElementById('timeslot-picker');
    if (picker) picker.classList.add('hidden');
    var step2 = document.querySelector('.stepper-step[data-step="2"]');
    if (step2) { step2.classList.add('hidden'); step2.setAttribute('aria-hidden', 'true'); }
    renumberVisibleSteps();
  }

  var pageH1 = document.querySelector('.page-header h1');
  if (pageH1) pageH1.style.visibility = '';

  (function () {
    function addContinueBtn(sectionId, targetId, label) {
      var section = document.getElementById(sectionId);
      var target = document.getElementById(targetId);
      if (!section || !target) return;
      var wrap = document.createElement('div');
      wrap.className = 'checkout-continue-wrap';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn checkout-continue-btn';
      btn.textContent = label;
      btn.addEventListener('click', function () {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      wrap.appendChild(btn);
      section.appendChild(wrap);
    }
    addContinueBtn('reservation-list', hasKits ? 'timeslot-picker' : 'reservation-form-section',
      hasKits ? 'Continue \u2014 Select a time \u203A' : 'Continue \u2014 Your details \u203A');
    if (hasKits) {
      addContinueBtn('timeslot-picker', 'reservation-form-section', 'Continue \u2014 Your details \u203A');
    }
  }());

  applyKitSpecificVisibility(hasKits);

  if (!hasKits && items.length > 0) {
    var pageTitle = document.querySelector('[data-content="page-title"]');
    if (pageTitle) pageTitle.textContent = 'Complete Your Order';
    document.title = 'Order | Steins & Vines';
    var reservedTitle = document.querySelector('[data-content="reserved-items-title"]');
    if (reservedTitle) reservedTitle.textContent = 'Your items';
    var submitBtn = document.querySelector('[data-content="submit-btn"]');
    if (submitBtn) submitBtn.textContent = 'Submit Payment';
    var formNote = document.querySelector('[data-content="form-note"]');
    if (formNote) formNote.textContent = 'A confirmation email will be sent to the address provided above. All orders are in-store pickup only.';
  }

  // Dual-cart: customise labels and submit button before setup
  if (_isDualCart) {
    var dualPageTitle = document.querySelector('[data-content="page-title"]');
    if (dualPageTitle) dualPageTitle.textContent = 'Complete Your Orders';
    document.title = 'Checkout | Steins & Vines';
    var dualSubmitBtn = document.querySelector('[data-content="submit-btn"]');
    if (dualSubmitBtn) dualSubmitBtn.textContent = 'Submit Payment';

    // Update timeslot heading to clarify it's for ferment only
    var timeslotTitle = document.querySelector('#timeslot-picker [data-content="timeslot-title"]');
    if (timeslotTitle) timeslotTitle.textContent = 'Select a Timeslot for Your Ferment Booking';
    var timeslotPicker = document.getElementById('timeslot-picker');
    if (timeslotPicker) {
      var timeslotNote = document.createElement('p');
      timeslotNote.className = 'dual-cart-timeslot-note';
      timeslotNote.textContent = 'Your ingredient order will be held for in-store pickup \u2014 no timeslot needed.';
      timeslotPicker.insertBefore(timeslotNote, timeslotPicker.querySelector('#timeslot-groups'));
    }
  }

  setupReservationForm();

  // Dual-cart: render the banner and ingredient section after main form is set up
  if (_isDualCart) {
    renderDualCartBanner();
    renderCheckoutIngredientSection();
  }
}

function initCheckoutStepper() {
  var stepper = document.getElementById('checkout-stepper');
  if (!stepper) return;
  var stepSections = { 1: 'reservation-list', 2: 'timeslot-picker', 3: 'reservation-form-section', 4: 'reservation-confirm' };
  stepper.querySelectorAll('.stepper-step').forEach(function (step) {
    step.addEventListener('click', function () {
      if (!step.classList.contains('stepper-step--done')) return;
      var section = document.getElementById(stepSections[parseInt(step.getAttribute('data-step'), 10)]);
      if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var stepNum = parseInt(entry.target.getAttribute('data-checkout-step'), 10);
          if (stepNum) updateStepper(stepNum);
        }
      });
    }, { threshold: 0.3, rootMargin: '-80px 0px 0px 0px' });
    document.querySelectorAll('[data-checkout-step]').forEach(function (s) { observer.observe(s); });
  }
}

function updateStepper(activeStep) {
  document.querySelectorAll('.stepper-step').forEach(function (step) {
    var num = parseInt(step.getAttribute('data-step'), 10);
    step.classList.remove('stepper-step--active', 'stepper-step--done');
    if (num < activeStep) step.classList.add('stepper-step--done');
    else if (num === activeStep) step.classList.add('stepper-step--active');
  });
}

function refreshReservationDependents() {
  var items = getAllCartItems();
  var hasKits = items.some(function (item) { return (item.item_type || 'kit') === 'kit'; });
  var kitsJustAppeared = (hasKits && _prevHasKits !== true);
  _prevHasKits = hasKits;

  if (hasKits) {
    if (kitsJustAppeared) { loadTimeslots(); }
    var selected = document.querySelector('input[name="timeslot"]:checked');
    if (selected) updateCompletionEstimate(selected.value);
    else if (document.getElementById('completion-estimate')) document.getElementById('completion-estimate').classList.add('hidden');
  } else {
    var picker = document.getElementById('timeslot-picker');
    if (picker) picker.classList.add('hidden');
  }

  var mwUrl = (typeof SHEETS_CONFIG !== 'undefined') ? (SHEETS_CONFIG.MIDDLEWARE_URL || '') : '';
  if (hasKits && mwUrl && !_makersFeeLoaded) {
    _makersFeeLoaded = true;
    fetch(mwUrl + '/api/services').then(function (r) { return r.json(); }).then(function (data) {
      var svcs = data.items || [];
      for (var i = 0; i < svcs.length; i++) {
        var sku = (svcs[i].sku || svcs[i].item_code || '').toUpperCase();
        if (sku === 'MAKERS-FEE' || (svcs[i].name || '').toLowerCase().indexOf('makers fee') !== -1) {
          _makersFeeItem = svcs[i]; break;
        }
      }
      renderReservationItems();
    }).catch(function () {});
  }
}

function renderReservationItems() {
  var container = document.getElementById('reservation-items');
  var emptyMsg = document.getElementById('reservation-empty');
  if (!container) return;

  // H4: Only show items from the active checkout cart (based on ?cart= URL param)
  // In dual-cart mode, Section A shows only ferment items; ingredient items are in Section B.
  // Fall back to all items if the specific cart is empty (prevents silent loss of kit items)
  var _renderCartKey = getActiveCheckoutCart();
  var items;
  if (_isDualCart) {
    items = getReservation(FERMENT_CART_KEY);
  } else {
    items = _renderCartKey ? getReservation(_renderCartKey) : getAllCartItems();
    if (items.length === 0 && _renderCartKey) items = getAllCartItems();
  }
  var hasKits = items.some(function (i) { return (i.item_type || 'kit') === 'kit'; });
  applyKitSpecificVisibility(hasKits);
  container.innerHTML = '';

  if (items.length === 0) {
    if (emptyMsg) {
      // Adjust empty state copy based on cart type
      var emptyTextEl = emptyMsg.querySelector('[data-content="reserved-empty-text"]');
      var emptyLinkEl = emptyMsg.querySelector('[data-content="reserved-empty-link"]');
      var isIngCart = _renderCartKey === INGREDIENT_CART_KEY;
      if (emptyTextEl) emptyTextEl.textContent = isIngCart ? 'Your cart is empty.' : 'No items reserved.';
      if (emptyLinkEl) {
        emptyLinkEl.textContent = isIngCart ? 'Browse ingredients' : 'Browse our catalog';
        emptyLinkEl.setAttribute('href', isIngCart ? '/ingredients.html' : '/products.html');
      }
      emptyMsg.classList.remove('hidden');
    }
    // In dual-cart mode only hide the form if the ingredient cart is also empty
    var ingStillHasItems = _isDualCart && getReservation(INGREDIENT_CART_KEY).length > 0;
    if (!ingStillHasItems) {
      ['timeslot-picker', 'reservation-form-section'].forEach(function(id) {
        var el = document.getElementById(id); if (el) el.classList.add('hidden');
      });
    }
    return;
  }

  if (emptyMsg) emptyMsg.classList.add('hidden');
  var picker = document.getElementById('timeslot-picker');
  var formSection = document.getElementById('reservation-form-section');
  if (picker) { if (hasKits) picker.classList.remove('hidden'); else picker.classList.add('hidden'); }
  if (formSection) formSection.classList.remove('hidden');

  // --- M15: Cross-cart note ---
  var fermentItems = getReservation(FERMENT_CART_KEY);
  var ingredientItems = getReservation(INGREDIENT_CART_KEY);
  var cartParam = (new URLSearchParams(window.location.search)).get('cart');
  if (cartParam === 'ferment' && ingredientItems.length > 0) {
    var crossNote = document.createElement('p');
    crossNote.className = 'cart-cross-note';
    crossNote.textContent = 'You also have items in your Ingredients & Supplies cart. These are separate \u2014 you\u2019ll need to check out separately.';
    container.appendChild(crossNote);
  } else if (cartParam === 'ingredient' && fermentItems.length > 0) {
    var crossNote = document.createElement('p');
    crossNote.className = 'cart-cross-note';
    crossNote.textContent = 'You also have items in your Ferment-in-Store cart. These are separate \u2014 you\u2019ll need to check out separately.';
    container.appendChild(crossNote);
  }

  var table = document.createElement('table');
  table.className = 'catalog-table reservation-table';
  var thead = document.createElement('thead');
  var hasTime = items.some(function (it) { return (it.time || '').trim() !== ''; });
  var hasBrand = items.some(function (it) { return (it.brand || '').trim() !== ''; });
  var theadTr = document.createElement('tr');
  ['Name', 'Type', 'Brand', 'Time', 'Price', 'Status', 'Qty', ''].forEach(function (label) {
    if (label === 'Time' && !hasTime) return;
    if (label === 'Brand' && !hasBrand) return;
    var th = document.createElement('th'); th.textContent = label;
    if (label === 'Price') th.style.textAlign = 'right';
    if (label === 'Status') th.style.textAlign = 'center';
    if (label === '') th.style.textAlign = 'right';
    if (label === 'Type') th.className = 'res-col-type';
    if (label === 'Qty') th.className = 'res-col-qty';
    theadTr.appendChild(th);
  });
  thead.appendChild(theadTr); table.appendChild(thead);
  var colCount = theadTr.children.length;

  var tbody = document.createElement('tbody');
  var totalKitQty = 0;
  items.forEach(function (item) {
    if ((item.item_type || 'kit') === 'kit') {
      totalKitQty += (parseFloat(item.qty) || 1);
    }
    var tr = document.createElement('tr');

    // Name + discount badge + bottle yield for kits
    var tdName = document.createElement('td');
    tdName.setAttribute('data-label', 'Name');
    var nameSpan = document.createElement('span');
    nameSpan.className = 'table-name';
    nameSpan.textContent = item.name;
    tdName.appendChild(nameSpan);
    if (item.discount && parseFloat(item.discount) > 0) {
      var badge = document.createElement('span');
      badge.className = 'discount-badge-sm';
      badge.textContent = Math.round(parseFloat(item.discount)) + '% OFF';
      tdName.appendChild(badge);
    }
    if ((item.item_type || 'kit') === 'kit') {
      var batchL = parseFloat(item['batch_size_(l)'] || item.batch_size_liters || 23);
      var bottlesApprox = Math.floor(batchL * 1000 / 750) - 1;
      var yieldSpan = document.createElement('span');
      yieldSpan.className = 'table-name-sub';
      yieldSpan.textContent = '~' + bottlesApprox + ' bottles';
      tdName.appendChild(yieldSpan);
    }
    tr.appendChild(tdName);

    // Type
    var tdType = document.createElement('td');
    tdType.setAttribute('data-label', 'Type');
    tdType.className = 'res-col-type';
    var typeLabel = (item.item_type || 'kit').charAt(0).toUpperCase() + (item.item_type || 'kit').slice(1);
    tdType.textContent = typeLabel;
    tr.appendChild(tdType);

    // Brand
    if (hasBrand) {
      var tdBrand = document.createElement('td');
      tdBrand.setAttribute('data-label', 'Brand');
      tdBrand.textContent = item.brand || '';
      tr.appendChild(tdBrand);
    }

    // Time
    if (hasTime) {
      var tdTime = document.createElement('td');
      tdTime.setAttribute('data-label', 'Time');
      tdTime.textContent = item.time || '';
      tr.appendChild(tdTime);
    }

    // Price
    var tdPrice = document.createElement('td');
    tdPrice.setAttribute('data-label', 'Price');
    if (item.price) {
      if (item.discount && parseFloat(item.discount) > 0) {
        var origNum = parseFloat((item.price || '0').replace('$', '')) || 0;
        var disc = parseFloat(item.discount);
        tdPrice.className = 'table-prices';
        tdPrice.innerHTML = '<span class="table-price-original">' + formatCurrency(item.price) + '</span><span class="table-price-sale">' + formatCurrency(origNum * (1 - disc / 100)) + '</span>';
      } else {
        tdPrice.textContent = formatCurrency(item.price);
      }
    }
    tr.appendChild(tdPrice);

    // Stock status
    var tdStock = document.createElement('td');
    tdStock.setAttribute('data-label', 'Status');
    var stockNum = parseInt(item.stock, 10) || 0;
    var stockBadge = document.createElement('span');
    stockBadge.className = 'reservation-item-stock';
    if (stockNum > 0) {
      stockBadge.classList.add('reservation-item-stock--available');
      stockBadge.textContent = 'In Stock';
    } else {
      stockBadge.classList.add('reservation-item-stock--order');
      stockBadge.textContent = 'Ships in 2+ weeks';
      stockBadge.title = 'This item requires extra lead time \u2014 timeslots within 2 weeks may be unavailable';
    }
    tdStock.appendChild(stockBadge);
    tr.appendChild(tdStock);

    // Qty controls
    var tdQty = document.createElement('td');
    tdQty.setAttribute('data-label', 'Qty');
    var itemIsWeighted = isWeightUnit(item.unit);
    var itemMax = getEffectiveMax(item);
    var unitLower = (item.unit || '').toLowerCase();
    var isKgUnit = unitLower === 'kg' || unitLower.indexOf('kg') !== -1;
    var qtyStep = itemIsWeighted ? (isKgUnit ? 0.01 : 1) : 1;
    var qtyControls = document.createElement('div');
    qtyControls.className = 'product-qty-controls' + (itemIsWeighted ? ' product-qty-controls--weight' : '');

    var itemCartKey = getCartKey(item);
    var applyQtyChange = (function (cartKey) {
      return function (newQty) {
        newQty = Math.round(newQty * 1000) / 1000;
        if (itemMax !== Infinity && newQty > itemMax) newQty = itemMax;
        var current = getReservation(cartKey);
        for (var ci = 0; ci < current.length; ci++) {
          var isMatch = item.zoho_item_id
            ? current[ci].zoho_item_id === item.zoho_item_id
            : (current[ci].name + '|' + (current[ci].brand || '')) === (item.name + '|' + (item.brand || ''));
          if (isMatch) {
            if (newQty <= 0) { current.splice(ci, 1); } else { current[ci].qty = newQty; }
            break;
          }
        }
        saveReservation(current, cartKey);
        renderReservationItems();
        refreshReservationDependents();
        updateReservationBar();
        refreshAllReserveControls();
      };
    })(itemCartKey);

    if (!itemIsWeighted) {
      var minusBtn = document.createElement('button');
      minusBtn.type = 'button';
      minusBtn.className = 'qty-btn';
      minusBtn.setAttribute('aria-label', 'Decrease quantity of ' + item.name);
      minusBtn.textContent = '\u2212';
    }

    var qtyInput = document.createElement('input');
    qtyInput.type = 'number';
    qtyInput.className = 'qty-input' + (itemIsWeighted ? ' qty-input--weight' : '');
    qtyInput.value = String(item.qty != null ? item.qty : 1);
    qtyInput.setAttribute('aria-label', 'Quantity for ' + item.name);
    if (itemIsWeighted) {
      qtyInput.step = String(qtyStep);
      qtyInput.setAttribute('inputmode', 'decimal');
      qtyInput.min = String(qtyStep);
    } else {
      qtyInput.step = '1';
      qtyInput.setAttribute('inputmode', 'numeric');
      qtyInput.min = '1';
    }
    if (itemMax !== Infinity) qtyInput.max = String(itemMax);

    if (!itemIsWeighted) {
      var plusBtn = document.createElement('button');
      plusBtn.type = 'button';
      plusBtn.textContent = '+';
      plusBtn.setAttribute('aria-label', 'Increase quantity of ' + item.name);
      var currentQty = parseFloat(item.qty) || 1;
      if (itemMax !== Infinity && currentQty >= itemMax) {
        plusBtn.className = 'qty-btn qty-btn--disabled';
        plusBtn.disabled = true;
      } else {
        plusBtn.className = 'qty-btn';
      }

      minusBtn.addEventListener('click', function () {
        var cur = parseFloat(qtyInput.value) || 0;
        applyQtyChange(cur - qtyStep);
      });

      plusBtn.addEventListener('click', function () {
        var cur = parseFloat(qtyInput.value) || 0;
        applyQtyChange(cur + qtyStep);
      });
    }

    qtyInput.addEventListener('change', function () {
      var val = parseFloat(qtyInput.value);
      if (isNaN(val) || val <= 0) {
        qtyInput.value = String(item.qty != null ? item.qty : 1);
        return;
      }
      if (!itemIsWeighted) val = Math.round(val);
      applyQtyChange(val);
    });

    if (!itemIsWeighted) {
      qtyControls.appendChild(minusBtn);
    }
    qtyControls.appendChild(qtyInput);
    if (itemIsWeighted && item.unit) {
      var unitLabel = document.createElement('span');
      unitLabel.className = 'qty-unit-label';
      unitLabel.textContent = item.unit;
      qtyControls.appendChild(unitLabel);
    }
    if (!itemIsWeighted) {
      qtyControls.appendChild(plusBtn);
    }
    tdQty.appendChild(qtyControls);
    tr.appendChild(tdQty);

    // Remove button
    var tdRemove = document.createElement('td');
    tdRemove.setAttribute('data-label', '');
    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'reservation-item-remove';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', (function (itm, cartKey) {
      return function () {
        var current = getReservation(cartKey);
        var filtered = current.filter(function (r) {
          if (itm.zoho_item_id) return r.zoho_item_id !== itm.zoho_item_id;
          return (r.name + '|' + (r.brand || '')) !== (itm.name + '|' + (itm.brand || ''));
        });
        saveReservation(filtered, cartKey);
        renderReservationItems();
        refreshReservationDependents();
        updateReservationBar();
        refreshAllReserveControls();
      };
    })(item, itemCartKey));
    tdRemove.appendChild(removeBtn);
    tr.appendChild(tdRemove);

    tbody.appendChild(tr);

    // Per-kit inline breakdown: Kit supplies → Maker's Fee → Kit Total
    if ((item.item_type || 'kit') === 'kit') {
      var bFeeRate = (_makersFeeItem && parseFloat(_makersFeeItem.rate)) ? parseFloat(_makersFeeItem.rate) : 50;
      var bPrice = parseFloat(String(item.price || '0').replace(/[^0-9.]/g, '')) || 0;
      var bDisc = parseFloat(item.discount) || 0;
      if (bDisc > 0) bPrice *= (1 - bDisc / 100);
      var bQty = parseFloat(item.qty) || 1;
      var bSupplies = (bPrice - bFeeRate) * bQty;
      if (bSupplies < 0) bSupplies = 0;
      var bFee = bFeeRate * bQty;
      var bTotal = bPrice * bQty;
      var bFeeName = (_makersFeeItem && _makersFeeItem.name) ? _makersFeeItem.name : "Maker's Fee";
      var breakTr = document.createElement('tr');
      breakTr.className = 'kit-breakdown-row';
      var breakTd = document.createElement('td');
      breakTd.colSpan = colCount;
      breakTd.className = 'kit-breakdown-cell';
      var breakWrap = document.createElement('div');
      breakWrap.className = 'order-summary-totals kit-breakdown-totals';
      breakWrap.innerHTML =
        '<div class="reservation-subtotal reservation-subtotal--breakdown"><span>Kit supplies</span><span>' + formatCurrency(bSupplies) + '</span></div>' +
        '<div class="reservation-subtotal reservation-subtotal--breakdown"><span>' + bFeeName + '</span><span>' + formatCurrency(bFee) + '</span></div>' +
        '<div class="reservation-subtotal reservation-subtotal--breakdown reservation-subtotal--breakdown-total"><span>Kit Total</span><span>' + formatCurrency(bTotal) + '</span></div>';
      breakTd.appendChild(breakWrap);
      breakTr.appendChild(breakTd);
      tbody.appendChild(breakTr);
    }

  });

  table.appendChild(tbody);
  var tWrap = document.createElement('div'); tWrap.className = 'reservation-table-wrap'; tWrap.appendChild(table); container.appendChild(tWrap);

  // Milling UI: in dual-cart mode, this renders in renderCheckoutIngredientSection().
  // In non-dual-cart ingredient-only checkout, render it here.
  if (!_isDualCart) {
    renderMillingSection(items, container);
  }

  // --- Totals Summary ---
  // DISPLAY ESTIMATE ONLY — server recomputes authoritative totals at checkout
  var sub = 0; items.forEach(function (i) {
    var p = parseFloat(String(i.price || '0').replace(/[^0-9.]/g, '')) || 0;
    var d = parseFloat(i.discount) || 0; if (d > 0) p *= (1 - d / 100); sub += p * (i.qty || 1);
  });

  // Group taxes by name for breakdown display
  var taxGroups = {};
  items.forEach(function (i) {
    var p = parseFloat(String(i.price || '0').replace(/[^0-9.]/g, '')) || 0;
    var d = parseFloat(i.discount) || 0;
    if (d > 0) p *= (1 - d / 100);
    var pct = parseFloat(i.tax_percentage) || 0;
    if (pct > 0) {
      var name = (i.tax_name && i.tax_name.trim()) ? i.tax_name.trim() : (pct + '%');
      if (!taxGroups[name]) taxGroups[name] = 0;
      taxGroups[name] += p * (i.qty || 1) * (pct / 100);
    }
  });
  // Add Maker's Fee GST (fee is not a cart item — read from _makersFeeItem)
  if (_makersFeeItem && (parseFloat(_makersFeeItem.tax_percentage) || 0) > 0) {
    var mfTaxPct = parseFloat(_makersFeeItem.tax_percentage);
    var mfRate = parseFloat(_makersFeeItem.rate) || 50;
    var mfKitQty = 0;
    items.forEach(function (i) {
      if ((i.item_type || 'kit') === 'kit') mfKitQty += (parseFloat(i.qty) || 1);
    });
    var mfTaxAmt = Math.round(mfRate * mfKitQty * (mfTaxPct / 100) * 100) / 100;
    if (mfTaxAmt > 0) {
      var mfTaxLabel = (_makersFeeItem.tax_name && _makersFeeItem.tax_name.trim())
        ? _makersFeeItem.tax_name.trim() : 'GST';
      if (!taxGroups[mfTaxLabel]) taxGroups[mfTaxLabel] = 0;
      taxGroups[mfTaxLabel] += mfTaxAmt;
    }
  }
  var taxTotal = 0;
  var taxNames = Object.keys(taxGroups);
  taxNames.forEach(function (n) { taxTotal += taxGroups[n]; });

  var sWrap = document.createElement('div');
  sWrap.className = 'order-summary-totals';

  // Subtotal row — per-kit breakdowns are shown inline above each kit row
  var itemsSubRow = document.createElement('div');
  itemsSubRow.className = 'reservation-subtotal';
  itemsSubRow.innerHTML = '<span>Subtotal</span><span>' + formatCurrency(sub) + '</span>';
  sWrap.appendChild(itemsSubRow);

  // Tax breakdown rows
  taxNames.forEach(function (name) {
    var taxRow = document.createElement('div');
    taxRow.className = 'reservation-subtotal reservation-subtotal--detail';
    taxRow.innerHTML = '<span>' + name + '</span><span>' + formatCurrency(taxGroups[name]) + '</span>';
    sWrap.appendChild(taxRow);
  });

  // Total row — sub already includes Maker's Fee so no feeRate added here
  var grandTotal = sub + taxTotal;
  var totalRow = document.createElement('div');
  totalRow.className = 'reservation-subtotal reservation-subtotal--total';
  totalRow.innerHTML = '<span>Total</span><span>' + formatCurrency(grandTotal) + '</span>';
  sWrap.appendChild(totalRow);

  container.appendChild(sWrap);

  var cWrap = document.createElement('div'); cWrap.className = 'reservation-clear-wrap';
  var cBtn = document.createElement('button'); cBtn.className = 'btn-secondary reservation-clear-btn';
  cBtn.textContent = _isDualCart ? 'Clear Ferment Cart' : 'Clear Cart';
  cBtn.addEventListener('click', function () {
    if (_isDualCart) {
      if (confirm('Remove all ferment items? Your ingredient order will not be affected.')) {
        saveReservation([], FERMENT_CART_KEY);
        renderReservationItems();
        refreshReservationDependents();
        updateReservationBar();
        refreshAllReserveControls();
      }
    } else {
      if (confirm('Remove all items?')) {
        saveReservation([], FERMENT_CART_KEY);
        saveReservation([], INGREDIENT_CART_KEY);
        renderReservationItems();
        refreshReservationDependents();
        updateReservationBar();
        refreshAllReserveControls();
      }
    }
  });
  cWrap.appendChild(cBtn); container.appendChild(cWrap);

  window.dispatchEvent(new Event('reservation-changed'));
}

// =============================================================================
// Dual-cart functions — only active when _isDualCart is true
// =============================================================================

// Renders the milling checkbox UI into the given container for the given items.
// Called from both renderReservationItems (non-dual) and renderCheckoutIngredientSection (dual).
function renderMillingSection(items, container) {
  var millableGrains = items.filter(function (item) {
    return isWeightUnit(item.unit) && (item.millable || '').toLowerCase() === 'true';
  });
  if (millableGrains.length === 0) return;

  var millingWrap = document.createElement('div');
  millingWrap.className = 'milling-section';

  var millingTitle = document.createElement('div');
  millingTitle.className = 'milling-title';
  millingTitle.innerHTML = '&#9881; Grain Milling';
  millingWrap.appendChild(millingTitle);

  var millAllRow = document.createElement('div');
  millAllRow.className = 'milling-item-row milling-item-row--all';
  var millAllId = 'mill-all-grains';
  var millAllCb = document.createElement('input');
  millAllCb.type = 'checkbox';
  millAllCb.id = millAllId;
  millAllCb.className = 'milling-checkbox';
  var millAllLbl = document.createElement('label');
  millAllLbl.htmlFor = millAllId;
  millAllLbl.appendChild(millAllCb);
  millAllLbl.appendChild(document.createTextNode(' Mill all grains'));
  millAllRow.appendChild(millAllLbl);
  millingWrap.appendChild(millAllRow);

  millableGrains.forEach(function (grain, idx) {
    var itemKey = grain.zoho_item_id || (grain.name + '|' + (grain.brand || ''));
    var cbId = 'mill-grain-' + idx;
    var row = document.createElement('div');
    row.className = 'milling-item-row';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = cbId;
    cb.className = 'milling-checkbox';
    cb.setAttribute('data-mill-key', itemKey);
    if (_milledItemKeys[itemKey]) cb.checked = true;
    var lbl = document.createElement('label');
    lbl.htmlFor = cbId;
    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode(' Mill ' + grain.name));
    row.appendChild(lbl);
    millingWrap.appendChild(row);

    cb.addEventListener('change', (function (key) {
      return function () {
        if (this.checked) { _milledItemKeys[key] = true; } else { delete _milledItemKeys[key]; }
        var numMilled = Object.keys(_milledItemKeys).length;
        millAllCb.checked = numMilled === millableGrains.length;
        millAllCb.indeterminate = numMilled > 0 && numMilled < millableGrains.length;
        saveMilledKeys();
        updateMillingTotals();
      };
    })(itemKey));
  });

  var initMilled = Object.keys(_milledItemKeys).length;
  millAllCb.checked = initMilled === millableGrains.length && millableGrains.length > 0;
  millAllCb.indeterminate = initMilled > 0 && initMilled < millableGrains.length;

  millAllCb.addEventListener('change', function () {
    if (this.checked) {
      millableGrains.forEach(function (g) {
        var k = g.zoho_item_id || (g.name + '|' + (g.brand || ''));
        _milledItemKeys[k] = true;
      });
    } else {
      _milledItemKeys = {};
    }
    var cbs = millingWrap.querySelectorAll('.milling-checkbox[data-mill-key]');
    Array.prototype.forEach.call(cbs, function (c) {
      c.checked = !!_milledItemKeys[c.getAttribute('data-mill-key')];
    });
    saveMilledKeys();
    updateMillingTotals();
  });

  var feeRow = document.createElement('div');
  feeRow.className = 'milling-fee-row';
  if (Object.keys(_milledItemKeys).length > 0 && _millingServiceItem) {
    feeRow.innerHTML = 'Milling fee: <strong>' + formatCurrency(parseFloat(_millingServiceItem.rate) || 0) + '</strong>';
  } else if (Object.keys(_milledItemKeys).length > 0) {
    feeRow.innerHTML = 'Milling fee: loading\u2026';
  } else {
    feeRow.classList.add('hidden');
  }
  millingWrap.appendChild(feeRow);
  container.appendChild(millingWrap);
}

// Called by milling checkboxes to refresh totals — re-renders the ingredient section
// which recalculates subtotal/tax including the milling fee.
// In non-dual mode, re-renders the main reservation items instead.
function updateMillingTotals() {
  if (_isDualCart) {
    renderCheckoutIngredientSection();
  } else {
    renderReservationItems();
    refreshReservationDependents();
    updateReservationBar();
  }
}

function renderDualCartBanner() {
  var banner = document.getElementById('dual-cart-banner');
  if (!banner) return;
  banner.innerHTML = '<div class="dual-cart-banner-intro">You have 2 separate orders \u2014 complete both below.</div>'
    + '<div class="dual-cart-banner-row">'
    + '<span class="dual-cart-banner-item"><strong>Ferment Booking</strong> \u2014 timeslot required</span>'
    + '<span class="dual-cart-banner-item"><strong>Ingredients &amp; Supplies</strong> \u2014 in-store pickup, no timeslot</span>'
    + '</div>';
  banner.classList.remove('hidden');
}

function renderCheckoutIngredientSection() {
  var section = document.getElementById('ingredient-order-section');
  if (!section) return;

  var items = getReservation(INGREDIENT_CART_KEY);
  if (items.length === 0) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');

  var itemsContainer = document.getElementById('ingredient-order-items');
  if (!itemsContainer) return;
  itemsContainer.innerHTML = '';

  var table = document.createElement('table');
  table.className = 'catalog-table reservation-table';
  var thead = document.createElement('thead');
  var tr = document.createElement('tr');
  ['Name', 'Price', 'Qty', 'Subtotal', ''].forEach(function (label) {
    var th = document.createElement('th');
    th.textContent = label;
    if (label !== 'Name' && label !== 'Qty') th.style.textAlign = 'right';
    if (label === 'Qty') th.className = 'res-col-qty';
    tr.appendChild(th);
  });
  thead.appendChild(tr);
  table.appendChild(thead);

  var tbody = document.createElement('tbody');
  var subtotal = 0;
  var taxTotal = 0;

  items.forEach(function (item) {
    var row = document.createElement('tr');
    var price = parseFloat(String(item.price || '0').replace(/[^0-9.]/g, '')) || 0;
    var disc = parseFloat(item.discount) || 0;
    if (disc > 0) price = price * (1 - disc / 100);
    var qty = parseFloat(item.qty) || 1;
    var lineTotal = price * qty;
    subtotal += lineTotal;
    var taxPct = parseFloat(item.tax_percentage) || 0;
    taxTotal += lineTotal * (taxPct / 100);

    var tdName = document.createElement('td');
    tdName.setAttribute('data-label', 'Name');
    tdName.textContent = item.name;
    if (item.discount && parseFloat(item.discount) > 0) {
      var badge = document.createElement('span');
      badge.className = 'discount-badge-sm';
      badge.textContent = Math.round(parseFloat(item.discount)) + '% OFF';
      tdName.appendChild(badge);
    }

    var tdPrice = document.createElement('td');
    tdPrice.setAttribute('data-label', 'Price');
    tdPrice.style.textAlign = 'right';
    var isWeightedPrice = item.unit && (item.unit.toLowerCase() === 'kg' || item.unit.toLowerCase() === 'g');
    tdPrice.textContent = formatCurrency(price) + (isWeightedPrice ? '/' + item.unit.toLowerCase() : '');

    var isWeightedQty = isWeightUnit(item.unit);
    var unitLowerIng = (item.unit || '').toLowerCase();
    var isKgIng = unitLowerIng === 'kg' || unitLowerIng.indexOf('kg') !== -1;
    var qtyStepIng = isWeightedQty ? (isKgIng ? (parseFloat(item.step) || 0.01) : 1) : 1;
    var itemMaxIng = getEffectiveMax(item);

    var applyIngQtyChange = (function (itm, step, isWt, isKg) {
      return function (newQty) {
        var snapped = isWt
          ? parseFloat((Math.round(newQty / step) * step).toFixed(isKg ? 2 : 0))
          : Math.round(newQty);
        var cur = getReservation(INGREDIENT_CART_KEY);
        if (snapped <= 0) {
          cur = cur.filter(function (r) {
            if (itm.zoho_item_id) return r.zoho_item_id !== itm.zoho_item_id;
            return (r.name + '|' + (r.brand || '')) !== (itm.name + '|' + (itm.brand || ''));
          });
        } else {
          for (var j = 0; j < cur.length; j++) {
            var isMatch = itm.zoho_item_id
              ? cur[j].zoho_item_id === itm.zoho_item_id
              : (cur[j].name + '|' + (cur[j].brand || '')) === (itm.name + '|' + (itm.brand || ''));
            if (isMatch) { cur[j].qty = snapped; break; }
          }
        }
        saveReservation(cur, INGREDIENT_CART_KEY);
        renderCheckoutIngredientSection();
        refreshReservationDependents();
        updateReservationBar();
      };
    })(item, qtyStepIng, isWeightedQty, isKgIng);

    // Qty cell — unified product-qty-controls matching Section A
    var tdQty = document.createElement('td');
    tdQty.setAttribute('data-label', 'Qty');
    var qtyControlsIng = document.createElement('div');
    qtyControlsIng.className = 'product-qty-controls' + (isWeightedQty ? ' product-qty-controls--weight' : '');

    if (!isWeightedQty) {
      var minusBtnIng = document.createElement('button');
      minusBtnIng.type = 'button';
      minusBtnIng.className = 'qty-btn';
      minusBtnIng.setAttribute('aria-label', 'Decrease quantity of ' + item.name);
      minusBtnIng.textContent = '\u2212';
    }

    var qtyInputIng = document.createElement('input');
    qtyInputIng.type = 'number';
    qtyInputIng.className = 'qty-input' + (isWeightedQty ? ' qty-input--weight' : '');
    qtyInputIng.value = String(qty);
    qtyInputIng.setAttribute('aria-label', 'Quantity for ' + item.name);
    if (isWeightedQty) {
      qtyInputIng.step = String(qtyStepIng);
      qtyInputIng.setAttribute('inputmode', isKgIng ? 'decimal' : 'numeric');
      qtyInputIng.min = String(qtyStepIng);
    } else {
      qtyInputIng.step = '1';
      qtyInputIng.setAttribute('inputmode', 'numeric');
      qtyInputIng.min = '1';
    }
    if (itemMaxIng !== Infinity) qtyInputIng.max = String(itemMaxIng);

    if (!isWeightedQty) {
      var plusBtnIng = document.createElement('button');
      plusBtnIng.type = 'button';
      plusBtnIng.textContent = '+';
      plusBtnIng.setAttribute('aria-label', 'Increase quantity of ' + item.name);
      if (itemMaxIng !== Infinity && qty >= itemMaxIng) {
        plusBtnIng.className = 'qty-btn qty-btn--disabled';
        plusBtnIng.disabled = true;
      } else {
        plusBtnIng.className = 'qty-btn';
      }

      minusBtnIng.addEventListener('click', (function (inp, step) {
        return function () { applyIngQtyChange((parseFloat(inp.value) || 0) - step); };
      })(qtyInputIng, qtyStepIng));

      plusBtnIng.addEventListener('click', (function (inp, step) {
        return function () { applyIngQtyChange((parseFloat(inp.value) || 0) + step); };
      })(qtyInputIng, qtyStepIng));
    }

    qtyInputIng.addEventListener('change', (function (inp) {
      return function () {
        var val = parseFloat(inp.value);
        if (isNaN(val) || val <= 0) { applyIngQtyChange(0); return; }
        applyIngQtyChange(val);
      };
    })(qtyInputIng));

    if (!isWeightedQty) {
      qtyControlsIng.appendChild(minusBtnIng);
    }
    qtyControlsIng.appendChild(qtyInputIng);
    if (isWeightedQty && item.unit) {
      var unitLabelIng = document.createElement('span');
      unitLabelIng.className = 'qty-unit-label';
      unitLabelIng.textContent = item.unit;
      qtyControlsIng.appendChild(unitLabelIng);
    }
    if (!isWeightedQty) {
      qtyControlsIng.appendChild(plusBtnIng);
    }
    tdQty.appendChild(qtyControlsIng);

    var tdSub = document.createElement('td');
    tdSub.setAttribute('data-label', 'Subtotal');
    tdSub.style.textAlign = 'right';
    tdSub.textContent = formatCurrency(lineTotal);

    // Remove button in its own column — matches Section A pattern
    var tdRemove = document.createElement('td');
    tdRemove.setAttribute('data-label', '');
    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'reservation-item-remove';
    removeBtn.textContent = 'Remove';
    removeBtn.setAttribute('aria-label', 'Remove ' + item.name);
    removeBtn.addEventListener('click', (function (itm) {
      return function () {
        var current = getReservation(INGREDIENT_CART_KEY);
        var filtered = current.filter(function (r) {
          if (itm.zoho_item_id) return r.zoho_item_id !== itm.zoho_item_id;
          return (r.name + '|' + (r.brand || '')) !== (itm.name + '|' + (itm.brand || ''));
        });
        saveReservation(filtered, INGREDIENT_CART_KEY);
        renderCheckoutIngredientSection();
        refreshReservationDependents();
        updateReservationBar();
        refreshAllReserveControls();
      };
    })(item));
    tdRemove.appendChild(removeBtn);

    row.appendChild(tdName);
    row.appendChild(tdPrice);
    row.appendChild(tdQty);
    row.appendChild(tdSub);
    row.appendChild(tdRemove);
    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  var tWrapIng = document.createElement('div');
  tWrapIng.className = 'reservation-table-wrap';
  tWrapIng.appendChild(table);
  itemsContainer.appendChild(tWrapIng);

  // Milling checkboxes — rendered via shared function
  renderMillingSection(items, itemsContainer);

  // Compute milling fee for totals
  var millingFeeAmount = 0;
  if (Object.keys(_milledItemKeys).length > 0 && _millingServiceItem) {
    millingFeeAmount = parseFloat(_millingServiceItem.rate) || 0;
    subtotal += millingFeeAmount;
    var millingTaxPct = parseFloat(_millingServiceItem.tax_percentage) || 0;
    if (millingTaxPct > 0) {
      taxTotal += millingFeeAmount * (millingTaxPct / 100);
    }
  }

  // Show/hide milling fee row
  var feeRowEl = itemsContainer.querySelector('.milling-fee-row');
  if (feeRowEl) {
    if (millingFeeAmount > 0) {
      feeRowEl.innerHTML = 'Milling fee: <strong>' + formatCurrency(millingFeeAmount) + '</strong>';
      feeRowEl.classList.remove('hidden');
    } else {
      feeRowEl.innerHTML = '';
      feeRowEl.classList.add('hidden');
    }
  }

  // Totals summary
  var sWrap = document.createElement('div');
  sWrap.className = 'order-summary-totals';

  var subRow = document.createElement('div');
  subRow.className = 'reservation-subtotal';
  subRow.innerHTML = '<span>Subtotal</span><span>' + formatCurrency(subtotal) + '</span>';
  sWrap.appendChild(subRow);

  if (taxTotal > 0) {
    var taxRow = document.createElement('div');
    taxRow.className = 'reservation-subtotal reservation-subtotal--detail';
    taxRow.innerHTML = '<span>Est. Tax</span><span>' + formatCurrency(taxTotal) + '</span>';
    sWrap.appendChild(taxRow);
  }

  var totalRow = document.createElement('div');
  totalRow.className = 'reservation-subtotal reservation-subtotal--total';
  totalRow.innerHTML = '<span>Total</span><span>' + formatCurrency(subtotal + taxTotal) + '</span>';
  sWrap.appendChild(totalRow);

  itemsContainer.appendChild(sWrap);

  // Combined grand total across both carts
  var fermentItems = getReservation(FERMENT_CART_KEY);
  var fermentTotal = 0;
  fermentItems.forEach(function (i) {
    var p = parseFloat(String(i.price || '0').replace(/[^0-9.]/g, '')) || 0;
    var d = parseFloat(i.discount) || 0;
    if (d > 0) p *= (1 - d / 100);
    var pct = parseFloat(i.tax_percentage) || 0;
    fermentTotal += p * (i.qty || 1) * (1 + pct / 100);
  });
  // Include Maker's Fee + its tax (fee is not a cart item)
  if (_makersFeeItem) {
    var mfRateCombined = parseFloat(_makersFeeItem.rate) || 50;
    var mfTaxPctCombined = parseFloat(_makersFeeItem.tax_percentage) || 0;
    var mfKitQtyCombined = 0;
    fermentItems.forEach(function (i) {
      if ((i.item_type || 'kit') === 'kit') mfKitQtyCombined += (parseFloat(i.qty) || 1);
    });
    fermentTotal += mfRateCombined * mfKitQtyCombined * (1 + mfTaxPctCombined / 100);
  }
  if (Object.keys(_milledItemKeys).length > 0 && _millingServiceItem && _millingServiceItem.rate) {
    var millingRate = parseFloat(_millingServiceItem.rate) || 0;
    var millingTaxPct2 = parseFloat(_millingServiceItem.tax_percentage) || 0;
    fermentTotal += millingRate * (1 + millingTaxPct2 / 100);
  }
  var combinedTotal = fermentTotal + subtotal + taxTotal;
  var grandWrap = document.createElement('div');
  grandWrap.className = 'dual-cart-grand-total';
  grandWrap.innerHTML = '<span>Combined Total (both orders)</span><span>' + formatCurrency(combinedTotal) + '</span>';
  itemsContainer.appendChild(grandWrap);

  // Update the submit button text in the ingredient section
  var ingSubmitBtn = document.getElementById('ingredient-submit-btn');
  if (ingSubmitBtn) {
    ingSubmitBtn.textContent = 'Complete Both Orders';
  }

  // Clear Ingredients button — lives here (below the ingredient table, not in Section A)
  var cWrapIng = document.createElement('div'); cWrapIng.className = 'reservation-clear-wrap';
  var cBtnIng = document.createElement('button'); cBtnIng.className = 'btn-secondary reservation-clear-btn';
  cBtnIng.textContent = 'Clear Ingredients';
  cBtnIng.addEventListener('click', function () {
    if (confirm('Remove all ingredient items? Your ferment reservation will not be affected.')) {
      saveReservation([], INGREDIENT_CART_KEY);
      renderCheckoutIngredientSection();
      refreshReservationDependents();
      updateReservationBar();
      refreshAllReserveControls();
    }
  });
  cWrapIng.appendChild(cBtnIng);
  itemsContainer.appendChild(cWrapIng);

  window.dispatchEvent(new Event('reservation-changed'));
}

function submitDualCart(contactData, recaptchaToken, onDone, onError) {
  var mw = (typeof SHEETS_CONFIG !== 'undefined') ? (SHEETS_CONFIG.MIDDLEWARE_URL || '') : '';
  var fermentItems = getReservation(FERMENT_CART_KEY);
  var ingredientItems = getReservation(INGREDIENT_CART_KEY);
  var fermentResult = null;
  var ingredientResult = null;
  var fermentError = null;
  var ingredientError = null;

  // Helper: build line items array from cart items
  function buildLines(items) {
    return items.map(function (i) {
      return {
        name: i.name,
        quantity: i.qty || 1,
        rate: parseFloat(String(i.price || '0').replace(/[^0-9.]/g, '')) || 0,
        item_id: i.zoho_item_id,
        discount: i.discount
      };
    });
  }

  // Step 1: POST ferment cart
  var fermentLines = buildLines(fermentItems);

  // Add milling if applicable
  if (Object.keys(_milledItemKeys).length > 0 && _millingServiceItem && _millingServiceItem.item_id) {
    fermentLines.push({ name: 'Milling Service', quantity: 1, rate: _millingServiceItem.rate, item_id: _millingServiceItem.item_id });
  }

  // Get the selected timeslot (required for ferment order)
  var sel = document.querySelector('input[name="timeslot"]:checked');
  var slot = sel ? sel.value : '';
  var parts = slot ? slot.split(' ') : [];
  var honeypotVal = document.getElementById('res-website') ? document.getElementById('res-website').value : '';

  // Book timeslot for ferment order first, then POST both checkouts sequentially
  var bookingProm = (slot && slot !== 'Walk-in \u2014 Immediate')
    ? fetch(mw + '/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': MW_API_KEY },
        body: JSON.stringify({
          date: parts[0],
          time: parts.slice(1).join(' '),
          customer: { name: contactData.name, email: contactData.email },
          notes: fermentItems.map(function (i) { return i.name; }).join(', ')
        })
      }).then(function (r) { return r.json(); })
    : Promise.resolve({ booking_id: null, timeslot: slot || 'In-store pickup' });

  bookingProm.then(function (bD) {
    var resolvedTimeslot = bD.timeslot || slot;

    // POST ferment order
    return fetch(mw + '/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: contactData,
        items: fermentLines,
        payment_token: '',
        timeslot: resolvedTimeslot,
        honeypot: honeypotVal,
        recaptcha_token: recaptchaToken,
        cart_key: FERMENT_CART_KEY
      })
    }).then(function (r) { return r.json(); })
    .then(function (fR) {
      if (!fR || (!fR.ok && !fR.success)) {
        // Ferment order failed — surface as error, do not continue to ingredient order
        throw new Error(fR && fR.error ? fR.error : 'Ferment booking could not be processed. Please try again or call us.');
      }
      fermentResult = fR;

      // Step 2: POST ingredient order (reuse same contact, no timeslot needed)
      var ingLines = buildLines(ingredientItems);
      return fetch(mw + '/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer: contactData,
          items: ingLines,
          payment_token: '',
          timeslot: '',
          honeypot: honeypotVal,
          recaptcha_token: recaptchaToken,
          cart_key: INGREDIENT_CART_KEY
        })
      }).then(function (r) { return r.json(); });
    })
    .then(function (iR) {
      ingredientResult = iR;
      var ingSuccess = iR && (iR.ok || iR.success);
      onDone({ ferment: fermentResult, ingredient: ingredientResult, ingredientFailed: !ingSuccess });
    });
  }).catch(function (err) {
    onError(err, fermentResult);
  });
}

function showDualCartConfirmation(results) {
  ['reservation-list', 'timeslot-picker', 'reservation-form-section',
    'ingredient-order-section', 'dual-cart-banner'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });

  var stepper = document.getElementById('checkout-stepper');
  if (stepper) stepper.classList.add('hidden');

  updateStepper(4);
  var conf = document.getElementById('reservation-confirm');
  if (conf) conf.classList.remove('hidden');

  var fermentNum = results.ferment && (results.ferment.salesorder_number || results.ferment.order_number) || null;
  var ingNum = results.ingredient && (results.ingredient.salesorder_number || results.ingredient.order_number) || null;

  if (document.getElementById('confirm-order-number')) {
    var numHtml = '';
    if (fermentNum) numHtml += 'Ferment Booking: ' + fermentNum;
    if (!results.ingredientFailed && ingNum) {
      numHtml += (numHtml ? '<br>' : '') + 'Ingredient Order: ' + ingNum;
    }
    document.getElementById('confirm-order-number').innerHTML = numHtml;
  }

  var summaryEl = document.getElementById('confirm-summary');
  if (summaryEl) {
    var fermentItems = getReservation(FERMENT_CART_KEY);
    var ingItems = getReservation(INGREDIENT_CART_KEY);
    var html = '';
    if (fermentItems.length > 0) {
      html += '<div class="confirm-summary-row confirm-summary-section-header"><span><strong>Ferment Booking</strong></span></div>';
      fermentItems.forEach(function (i) {
        html += '<div class="confirm-summary-row"><span>' + escapeHTML(i.name || 'Item') + '</span><span>\u00D7' + (i.qty || 1) + '</span></div>';
      });
    }
    if (!results.ingredientFailed && ingItems.length > 0) {
      html += '<div class="confirm-summary-row confirm-summary-section-header"><span><strong>Ingredient Order</strong></span></div>';
      ingItems.forEach(function (i) {
        html += '<div class="confirm-summary-row"><span>' + escapeHTML(i.name || 'Item') + '</span><span>\u00D7' + (i.qty || 1) + '</span></div>';
      });
    }
    summaryEl.innerHTML = html;
  }

  // Clear carts that succeeded
  localStorage.removeItem(FERMENT_CART_KEY);
  if (!results.ingredientFailed) {
    localStorage.removeItem(INGREDIENT_CART_KEY);
  }

  if (results.ingredientFailed) {
    // Partial success — show a notice inside the confirmation
    var noPayNotice = document.querySelector('.confirm-no-payment-notice');
    if (noPayNotice) {
      noPayNotice.classList.remove('hidden');
      noPayNotice.textContent = 'Your ferment booking is confirmed'
        + (fermentNum ? ' (' + fermentNum + ')' : '')
        + '. Your ingredient order could not be processed \u2014 please try again or call us at (604)\u00A0567-4565.';
    }
    // Update the confirmation heading to reflect partial success
    var confTitle = document.querySelector('[data-content="confirm-title"]');
    if (confTitle) confTitle.textContent = 'Ferment Booking Confirmed';
    var confText = document.querySelector('[data-content="confirm-text"]');
    if (confText) confText.textContent = 'Your ferment booking is confirmed. Unfortunately your ingredient order could not be submitted automatically. Please call us or visit the store to complete that order.';
  } else {
    var noPayNotice = document.querySelector('.confirm-no-payment-notice');
    if (noPayNotice) {
      if (typeof PAYMENT_DISABLED !== 'undefined' && PAYMENT_DISABLED) {
        noPayNotice.classList.remove('hidden');
        noPayNotice.textContent = 'No payment has been taken \u2014 we\u2019ll contact you to arrange payment.';
      } else {
        noPayNotice.classList.add('hidden');
      }
    }
    var confTitle = document.querySelector('[data-content="confirm-title"]');
    if (confTitle) confTitle.textContent = 'Both Orders Submitted';
    var confText = document.querySelector('[data-content="confirm-text"]');
    if (confText) confText.textContent = "Thank you! Both orders have been received. We\u2019ll be in touch to confirm your ferment appointment and your ingredient order details.";
    var nextList = document.querySelector('.confirm-next ol');
    if (nextList) {
      nextList.innerHTML = '<li>We\'ll confirm your ferment appointment and ingredient order via email</li>'
        + '<li>Visit us at your scheduled time to start fermentation (~15 min)</li>'
        + '<li>Pick up your ingredient order at the same visit or separately</li>'
        + '<li>We\'ll notify you when your batch is ready to bottle</li>';
    }
  }
}

function setupBeerWaitlistForm() {
  var f = document.getElementById('beer-waitlist-form'); if (!f) return;
  f.addEventListener('submit', function (e) {
    e.preventDefault(); var em = document.getElementById('beer-waitlist-email').value.trim(); if (!em) return;
    var hf = document.createElement('form'); hf.method = 'POST'; hf.action = 'https://docs.google.com/forms/d/e/YOUR_BEER_WAITLIST_FORM_ID/formResponse'; hf.target = 'beer-waitlist-iframe'; hf.style.display = 'none';
    hf.innerHTML = '<input name="entry.YOUR_EMAIL_ENTRY_ID" value="' + em + '">'; document.body.appendChild(hf); hf.submit(); document.body.removeChild(hf);
    f.classList.add('hidden'); document.getElementById('beer-waitlist-confirm').classList.remove('hidden');
  });
}

function updateDualCartTotalSummary() {
  if (!_isDualCart) return;
  var existingRow = document.getElementById('dual-cart-total-summary');
  var form = document.getElementById('reservation-form');
  if (!form) return;
  var submitBtn = form.querySelector('button[type="submit"]');
  if (!submitBtn) return;

  var fermentItems = getReservation(FERMENT_CART_KEY);
  var ingredientItems = getReservation(INGREDIENT_CART_KEY);
  var fermentTotal = 0;
  fermentItems.forEach(function (i) {
    var p = parseFloat(String(i.price || '0').replace(/[^0-9.]/g, '')) || 0;
    var d = parseFloat(i.discount) || 0;
    if (d > 0) p *= (1 - d / 100);
    var pct = parseFloat(i.tax_percentage) || 0;
    fermentTotal += p * (i.qty || 1) * (1 + pct / 100);
  });
  var ingTotal = 0;
  ingredientItems.forEach(function (i) {
    var p = parseFloat(String(i.price || '0').replace(/[^0-9.]/g, '')) || 0;
    var d = parseFloat(i.discount) || 0;
    if (d > 0) p *= (1 - d / 100);
    var pct = parseFloat(i.tax_percentage) || 0;
    ingTotal += p * (i.qty || 1) * (1 + pct / 100);
  });

  var row = existingRow || document.createElement('div');
  row.id = 'dual-cart-total-summary';
  row.className = 'dual-cart-total-summary';
  row.innerHTML = '<span>Ferment: <strong>' + formatCurrency(fermentTotal) + '</strong></span>'
    + '<span class="dual-cart-total-summary-sep">&nbsp;&bull;&nbsp;</span>'
    + '<span>Ingredients: <strong>' + formatCurrency(ingTotal) + '</strong></span>'
    + '<span class="dual-cart-total-summary-sep">&nbsp;&bull;&nbsp;</span>'
    + '<span class="dual-cart-total-summary-grand">Combined Total: <strong>' + formatCurrency(fermentTotal + ingTotal) + '</strong></span>';
  if (!existingRow) {
    submitBtn.parentNode.insertBefore(row, submitBtn);
  }
}

function setupReservationForm() {
  var f = document.getElementById('reservation-form'); if (!f) return;
  var sec = document.getElementById('payment-section'); var err = document.getElementById('payment-error');
  var mw = (typeof SHEETS_CONFIG !== 'undefined') ? (SHEETS_CONFIG.MIDDLEWARE_URL || '') : '';
  if (!document.body.classList.contains('kiosk-mode') && sec && (typeof PAYMENT_DISABLED === 'undefined' || !PAYMENT_DISABLED)) {
    fetch(mw + '/api/payment/initialize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': MW_API_KEY },
      body: JSON.stringify({})
    }).then(function (r) { return r.json(); }).then(function (cfg) {
      if (!cfg || !cfg.checkoutToken) return;
      _helcimCheckoutToken = cfg.checkoutToken;
      _paymentConfig = { enabled: true, env: 'helcim' };

      // Show payment section, hide offline notice
      sec.classList.remove('hidden');
      var offlineNotice = document.getElementById('payment-offline-notice');
      if (offlineNotice) offlineNotice.classList.add('hidden');

      // Listen for payment result via postMessage from Helcim iframe
      // eventName is "helcim-pay-js-{checkoutToken}", eventStatus is "SUCCESS" | "ABORTED" | "HIDE"
      var helcimEventKey = 'helcim-pay-js-' + cfg.checkoutToken;
      window.addEventListener('message', function (event) {
        var data = event.data || {};
        if (data.eventName !== helcimEventKey) return;
        if (data.eventStatus === 'SUCCESS') {
          var txn = data.eventMessage && data.eventMessage.data && data.eventMessage.data.data;
          _helcimTransactionId = (txn && txn.transactionId) ? String(txn.transactionId) : '';
          if (typeof removeHelcimPayIframe === 'function') removeHelcimPayIframe();
          if (_awaitingPaymentSubmit) {
            _awaitingPaymentSubmit = false;
            f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          }
        } else if (data.eventStatus === 'ABORTED') {
          _helcimTransactionId = null;
          _awaitingPaymentSubmit = false;
          var sub2 = f.querySelector('button[type="submit"]');
          if (sub2) { sub2.disabled = false; sub2.textContent = 'Submit Payment'; }
          _checkoutSubmitting = false;
          showToast('Payment cancelled — please try again.', 'error');
        }
      });
    }).catch(function (err) {
      // non-fatal — payment form just won't appear
    });
  }
  window.addEventListener('reservation-changed', updateDualCartTotalSummary);
  setTimeout(updateDualCartTotalSummary, 600);

  f.addEventListener('submit', function (e) {
    e.preventDefault();
    if (_checkoutSubmitting) return;
    if (!navigator.onLine) { showToast('Offline', 'error'); return; }

    // H8: Client-side validation before proceeding
    if (!validateCheckoutForm()) {
      var errorContainer = document.getElementById('form-error-announce') || document.querySelector('[role="alert"]');
      if (errorContainer) errorContainer.focus && errorContainer.focus();
      return;
    }

    _checkoutSubmitting = true;

    // Dual-cart path: both carts have items and no specific ?cart= was supplied
    if (_isDualCart) {
      var _dualSub = f.querySelector('button[type="submit"]');
      var _dualOriginalText = _dualSub ? _dualSub.textContent : '';
      if (_dualSub) { _dualSub.disabled = true; _dualSub.textContent = 'Processing...'; }

      // Require timeslot for the ferment booking
      var _dualSel = document.querySelector('input[name="timeslot"]:checked');
      if (!_dualSel) { showToast('Please select a timeslot for your ferment booking.', 'error'); _checkoutSubmitting = false; if (_dualSub) { _dualSub.disabled = false; _dualSub.textContent = _dualOriginalText; } return; }

      getRecaptchaToken('checkout', function (dualToken) {
        var contactData = {
          name: document.getElementById('res-name').value,
          email: document.getElementById('res-email').value,
          phone: document.getElementById('res-phone').value
        };
        // First upsert the contact record, then run sequential cart submissions
        var mwForDual = (typeof SHEETS_CONFIG !== 'undefined') ? (SHEETS_CONFIG.MIDDLEWARE_URL || '') : '';
        fetch(mwForDual + '/api/contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': MW_API_KEY },
          body: JSON.stringify(contactData)
        }).catch(function () {}).then(function () {
          submitDualCart(contactData, dualToken,
            function (results) {
              _checkoutSubmitting = false;
              showDualCartConfirmation(results);
            },
            function (err, partialFermentResult) {
              _checkoutSubmitting = false;
              if (_dualSub) { _dualSub.disabled = false; _dualSub.textContent = _dualOriginalText; }
              showToast(err.message || 'An error occurred. Please try again or call us.', 'error');
            }
          );
        });
      });
      return; // dual-cart path handled; prevent fall-through to single-cart logic
    }

    // H4: Only submit items from the active checkout cart
    var _submitCartKey = getActiveCheckoutCart();
    var items = _submitCartKey ? getReservation(_submitCartKey) : getAllCartItems();
    var hasK = items.some(function (i) { return (i.item_type || 'kit') === 'kit'; });
    var sel = document.querySelector('input[name="timeslot"]:checked');
    if (hasK && !sel) { showToast('Please select a timeslot to continue.', 'error'); _checkoutSubmitting = false; return; }

    var sub = f.querySelector('button[type="submit"]');
    var originalBtnText = sub.textContent;
    sub.disabled = true; sub.textContent = 'Processing...';

    var orderTot = 0; items.forEach(function (i) { var p = parseFloat(String(i.price || '0').replace(/[^0-9.]/g, '')) || 0; var d = parseFloat(i.discount) || 0; if (d > 0) p *= (1 - d / 100); orderTot += p * (i.qty || 1); });
    var tax = 0; items.forEach(function (i) { var p = parseFloat(String(i.price || '0').replace(/[^0-9.]/g, '')) || 0; var d = parseFloat(i.discount) || 0; if (d > 0) p *= (1 - d / 100); tax += p * (i.qty || 1) * ((parseFloat(i.tax_percentage) || 0) / 100); });
    var charge = orderTot + tax;

    // If payment is required and not yet completed, open Helcim iframe and wait
    if (_paymentConfig && _paymentConfig.enabled && charge > 0) {
      if (!_helcimTransactionId || typeof _helcimTransactionId !== 'string' || _helcimTransactionId.length === 0) {
        // Staging mock: ?mock_payment=1 bypasses Helcim iframe for flow testing
        if (new URLSearchParams(window.location.search).get('mock_payment') === '1') {
          _helcimTransactionId = 'mock-test-' + Date.now();
        } else {
          if (!_helcimCheckoutToken || typeof appendHelcimPayIframe !== 'function') {
            showToast('Payment not ready — please refresh and try again.', 'error');
            sub.disabled = false; sub.textContent = originalBtnText; _checkoutSubmitting = false; return;
          }
          _awaitingPaymentSubmit = true;
          sub.textContent = 'Waiting for payment...';
          appendHelcimPayIframe(_helcimCheckoutToken);
          return; // resume automatically after HELCIM_PAY_JS_PAYMENT_SUCCESS
        }
      }
    }

    // C1: Collect honeypot value
    var honeypotVal = document.getElementById('res-website') ? document.getElementById('res-website').value : '';

    // C1: Wrap submission in reCAPTCHA token collection
    getRecaptchaToken('checkout', function (recaptchaToken) {
      // #4: Card is now charged server-side inside /api/checkout using payment_token.
      // The separate /api/payment/charge call has been removed to eliminate the
      // ghost-charge window where the card could be charged but the order never created.
      var pProm = Promise.resolve({});

      pProm.then(function (pR) {
        return fetch(mw + '/api/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': MW_API_KEY }, body: JSON.stringify({ name: document.getElementById('res-name').value, email: document.getElementById('res-email').value, phone: document.getElementById('res-phone').value }) }).then(function (r) { return r.json(); }).then(function (cD) {
          var slot = sel ? sel.value : 'In-store pickup'; var parts = slot.split(' ');
          var bProm = (slot === 'Walk-in \u2014 Immediate') ? Promise.resolve({ booking_id: null, timeslot: slot }) : fetch(mw + '/api/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': MW_API_KEY }, body: JSON.stringify({ date: parts[0], time: parts.slice(1).join(' '), customer: { name: document.getElementById('res-name').value, email: document.getElementById('res-email').value }, notes: items.map(function (i) { return i.name; }).join(', ') }) }).then(function (r) { return r.json(); });
          return bProm.then(function (bD) {
            var lines = items.map(function (i) { return { name: i.name, quantity: i.qty || 1, rate: parseFloat(String(i.price || '0').replace(/[^0-9.]/g, '')) || 0, item_id: i.zoho_item_id, discount: i.discount }; });
            // M8: Milling service null guard
            if (Object.keys(_milledItemKeys).length > 0 && _millingServiceItem && _millingServiceItem.item_id) {
              lines.push({ name: 'Milling Service', quantity: 1, rate: _millingServiceItem.rate, item_id: _millingServiceItem.item_id });
            }
            return fetch(mw + '/api/checkout', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                customer: { name: document.getElementById('res-name').value, email: document.getElementById('res-email').value, phone: document.getElementById('res-phone').value },
                items: lines,
                payment_token: (charge > 0 && _paymentConfig && _paymentConfig.enabled) ? _helcimTransactionId : '',
                timeslot: bD.timeslot,
                honeypot: honeypotVal,
                recaptcha_token: recaptchaToken
              })
            }).then(function (r) { return r.json(); });
          });
        });
      }).then(function (oR) {
        // M6: Validate response before showing success
        if (!oR || (!oR.ok && !oR.success)) {
          throw new Error(oR && oR.error ? oR.error : 'Checkout failed. Please try again or call us.');
        }

        // H4: Only clear the cart that was checked out
        var checkoutCartKey = getActiveCheckoutCart();
        if (checkoutCartKey) {
          localStorage.removeItem(checkoutCartKey);
        } else {
          localStorage.removeItem(FERMENT_CART_KEY);
          localStorage.removeItem(INGREDIENT_CART_KEY);
        }

        ['reservation-list', 'timeslot-picker', 'reservation-form-section'].forEach(function (id) {
          var el = document.getElementById(id); if (el) el.classList.add('hidden');
        });
        updateStepper(4);
        var conf = document.getElementById('reservation-confirm');
        if (conf) conf.classList.remove('hidden');
        if (document.getElementById('confirm-order-number')) {
          document.getElementById('confirm-order-number').textContent = 'Order #' + (oR.salesorder_number || 'REF-' + Date.now().toString(36).toUpperCase());
        }

        // H6: Populate confirm summary
        var summaryEl = document.getElementById('confirm-summary');
        if (summaryEl) {
          var summaryHtml = '';
          for (var si = 0; si < items.length; si++) {
            summaryHtml += '<p>' + items[si].name + ' \u00D7' + (items[si].qty || 1) + '</p>';
          }
          summaryEl.innerHTML = summaryHtml;
        }

        // H6: Show "no payment taken" notice if payment disabled or offline
        var noPayNotice = document.querySelector('.confirm-no-payment-notice');
        if (noPayNotice) {
          if ((typeof PAYMENT_DISABLED !== 'undefined' && PAYMENT_DISABLED) || !(_paymentConfig && _paymentConfig.enabled) || charge === 0) {
            noPayNotice.classList.remove('hidden');
            noPayNotice.textContent = 'No payment has been taken \u2014 we\u2019ll contact you to arrange payment.';
          } else {
            noPayNotice.classList.add('hidden');
          }
        }

        // Dynamic What's Next / title / CTA for ingredient-only orders
        var checkoutCartKeyForNext = getActiveCheckoutCart();
        var isIngredientOnly = checkoutCartKeyForNext === INGREDIENT_CART_KEY ||
          (!checkoutCartKeyForNext && !items.some(function(i) { return (i.item_type || 'kit') === 'kit'; }));
        if (isIngredientOnly) {
          var nextList = document.querySelector('.confirm-next ol');
          if (nextList) {
            nextList.innerHTML = '<li>We\'ll confirm your order via email</li>'
              + '<li>Your items will be held for in-store pickup</li>'
              + '<li>Visit us at your convenience to collect</li>';
          }
          // Update confirmation heading and CTA for non-reservation (ingredient) flow
          var ingConfTitle = document.querySelector('[data-content="confirm-title"]');
          if (ingConfTitle) ingConfTitle.textContent = 'Order Placed';
          var ingCtaLink = document.querySelector('[data-content="confirm-cta"]');
          if (ingCtaLink) {
            ingCtaLink.textContent = 'Back to ingredients';
            ingCtaLink.setAttribute('href', '/ingredients.html');
          }
        }
      }).catch(function (err) {
        showToast(err.message, 'error');
        // M14: Restore submit button after error
        // Clear Helcim transaction ID so retry requires fresh payment (prevents stale/voided token reuse)
        _helcimTransactionId = null;
        sub.disabled = false; sub.textContent = originalBtnText; _checkoutSubmitting = false;
      });
    }); // end getRecaptchaToken
  }); // end f.addEventListener('submit')
}

function setupContactSubmit() {
  var f = document.getElementById('contact-form'); if (!f) return;
  f.addEventListener('submit', function (e) {
    e.preventDefault(); var btn = f.querySelector('[type="submit"]'); btn.disabled = true; btn.textContent = 'Sending...';
    var mw = (typeof SHEETS_CONFIG !== 'undefined') ? (SHEETS_CONFIG.MIDDLEWARE_URL || '') : '';
    fetch(mw + '/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: document.getElementById('name').value, email: document.getElementById('email').value, message: document.getElementById('message').value }) }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.success) { f.style.display = 'none'; var s = document.createElement('div'); s.className = 'contact-success'; s.innerHTML = '<p>Thanks! We\'ll be in touch.</p>'; f.parentNode.insertBefore(s, f.nextSibling); }
      else throw new Error(d.error);
    }).catch(function (err) { btn.disabled = false; btn.textContent = 'Send'; showToast(err.message, 'error'); });
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { formatTimeslot: formatTimeslot, formatPhoneInput: formatPhoneInput, isValidEmail: isValidEmail, isValidPhone: isValidPhone, calcCompletionRange: calcCompletionRange };
}
