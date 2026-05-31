// ===== Cross-Category Search Overlay Module =====
// Standalone module (NOT in concat:js). Loads after main.min.js.
// Shared globals available: formatCurrency, escapeHTML, renderReserveControl,
// hasWeightConfig, setReservationQty, getReservedQty, Fuse, handleDeepLinkedItem
// Wrapped in IIFE to avoid global name collisions with 16-catalog-subpage.js
// (mapItem, fetchFromMiddleware, loadFromSnapshot, buildCartObject are shared names).

(function () {
// ---------------------------------------------------------------------------
// Module-private state
// ---------------------------------------------------------------------------

var _searchAllItems = [];       // all ingredients (unfiltered, price > 0)
var _searchFuse = null;         // single Fuse instance across all categories
var _searchOverlayOpen = false;
var _searchOpenBtn = null;      // ref to .subnav-search-btn that opened overlay
var SEARCH_DESKTOP_BREAKPOINT = 768; // matches SUBPAGE_DESKTOP_BREAKPOINT

var SEARCH_MW_CACHE_KEY = 'sv-search-all-mw';
var SEARCH_MW_CACHE_TS  = 'sv-search-all-mw-ts';
var SEARCH_MW_CACHE_TTL = 3600000; // 1 hour

// ---------------------------------------------------------------------------
// Category mapping constants
// ---------------------------------------------------------------------------

// Maps cf_subcategory values to page slugs for deep-link navigation
var CATEGORY_PAGE_MAP = {
  'Hops':      'hops.html',
  'Grain':     'grains.html',
  'Grains':    'grains.html',
  'Yeast':     'yeast.html',
  'Additive':  'additives.html',
  'Additives': 'additives.html',
  'Bottle':    'packaging.html',
  'Bag':       'packaging.html',
  'Packaging': 'packaging.html',
  'Fermenter': 'equipment.html',
  'Equipment': 'equipment.html',
  'Hose':      'equipment.html',
  'Tubing':    'equipment.html',
  'Hose/Tubing': 'equipment.html'
};

// Maps cf_subcategory values to grouped display labels for group headers
// Collapses Bottle+Bag -> "Packaging", Fermenter+Hose+Tubing -> "Equipment", etc.
var CATEGORY_DISPLAY_NAMES = {
  'Hops':      'Hops',
  'Grain':     'Grains',
  'Grains':    'Grains',
  'Yeast':     'Yeast',
  'Additive':  'Additives',
  'Additives': 'Additives',
  'Bottle':    'Packaging',
  'Bag':       'Packaging',
  'Packaging': 'Packaging',
  'Fermenter': 'Equipment',
  'Equipment': 'Equipment',
  'Hose':      'Equipment',
  'Tubing':    'Equipment',
  'Hose/Tubing': 'Equipment'
};

// ---------------------------------------------------------------------------
// Pure functions (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Groups Fuse.js search results by display category name.
 * Results are sorted by group size descending (D-03: most matches first).
 * @param {Array} fuseResults - array of Fuse result objects ({item, ...} for v7)
 * @returns {Array} array of {category: displayName, items: [items], slug: pageSlug}
 */
function groupResultsByCategory(fuseResults) {
  var groups = {};
  var groupSlugs = {};

  fuseResults.forEach(function (r) {
    var item = r.item || r; // Fuse v6 vs v7 guard
    var rawCat = item.cf_subcategory || item.subcategory || 'Other';
    var displayCat = CATEGORY_DISPLAY_NAMES[rawCat] || rawCat;
    var slug = CATEGORY_PAGE_MAP[rawCat] || 'ingredients-supplies.html';

    if (!groups[displayCat]) {
      groups[displayCat] = [];
      groupSlugs[displayCat] = slug;
    }
    groups[displayCat].push(item);
  });

  // Sort categories by match count descending
  var sorted = Object.keys(groups).sort(function (a, b) {
    return groups[b].length - groups[a].length;
  });

  return sorted.map(function (cat) {
    return { category: cat, items: groups[cat], slug: groupSlugs[cat] };
  });
}

/**
 * Computes the maximum number of result rows to show per category group.
 * Scales inversely with number of matching categories (D-06).
 * @param {number} categoryCount - number of distinct matching categories
 * @returns {number} maximum rows per group
 */
function computeResultCap(categoryCount) {
  if (categoryCount <= 2) return 10;
  if (categoryCount <= 4) return 7;
  return 5;
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

function getCachedSearch() {
  try {
    var data = localStorage.getItem(SEARCH_MW_CACHE_KEY);
    var ts = parseInt(localStorage.getItem(SEARCH_MW_CACHE_TS), 10) || 0;
    if (data) return { data: JSON.parse(data), fresh: (Date.now() - ts) < SEARCH_MW_CACHE_TTL };
  } catch (e) {}
  return null;
}

function setCachedSearch(items) {
  try {
    localStorage.setItem(SEARCH_MW_CACHE_KEY, JSON.stringify(items));
    localStorage.setItem(SEARCH_MW_CACHE_TS, String(Date.now()));
  } catch (e) {}
}

/**
 * Normalizes a raw Zoho API item object to a flat structure.
 * Copies verbatim from 16-catalog-subpage.js lines 101-136.
 * Preserves __proto__ guard (T-21-02).
 */
function mapItem(z) {
  var obj = {
    name: z.name || '',
    unit: z.unit || '',
    price_per_unit: z.price_per_unit != null ? String(z.price_per_unit) : (z.rate != null ? String(z.rate) : ''),
    stock: z.stock != null ? String(z.stock) : (z.stock_on_hand != null ? String(z.stock_on_hand) : '0'),
    description: z.description || '',
    sales_description: z.sales_description || '',
    sku: z.sku || '',
    category: z.category || z.category_name || '',
    zoho_item_id: z.item_id || '',
    low_amount: '',
    high_amount: '',
    step: '',
    tax_percentage: z.tax_percentage != null ? z.tax_percentage : 0,
    tax_name: z.tax_name || '',
    max_order_qty: z.max_order_qty || '',
    cf_subcategory: z.cf_subcategory || '',
    cf_type: z.cf_type || '',
    millable: z.millable || ''
  };

  // Custom field flattening — T-21-02: guard against prototype pollution
  if (z.custom_fields && z.custom_fields.length) {
    z.custom_fields.forEach(function (cf) {
      var key = (cf.label || '').toLowerCase().replace(/\s+/g, '_');
      if (!key) return;
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') return;
      if (cf.value !== undefined && cf.value !== null) {
        obj[key] = String(cf.value);
      }
    });
  }

  return obj;
}

/**
 * Fetches all ingredients from the middleware API.
 * Returns ALL items with price > 0 — no category filtering (overlay needs all).
 */
function fetchFromMiddleware() {
  var middlewareUrl = (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.MIDDLEWARE_URL)
    ? SHEETS_CONFIG.MIDDLEWARE_URL : '';
  var apiKey = (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.MW_API_KEY)
    ? SHEETS_CONFIG.MW_API_KEY : '';

  return fetch(middlewareUrl + '/api/ingredients', {
    headers: { 'x-api-key': apiKey }
  })
    .then(function (r) {
      if (!r.ok) throw new Error('Middleware returned ' + r.status);
      return r.json();
    })
    .then(function (data) {
      var items = (data.items || []).map(mapItem);
      // Return all items with price > 0 — no per-category filter needed
      return items.filter(function (item) {
        return (parseFloat(item.price_per_unit || '0') || 0) > 0;
      });
    });
}

/**
 * Loads all ingredients from the static snapshot fallback.
 * Returns ALL items with price > 0 — no category filtering (overlay needs all).
 */
function loadFromSnapshot() {
  return fetch('/content/zoho-snapshot.json')
    .then(function (r) {
      if (!r.ok) throw new Error('Snapshot fetch failed: ' + r.status);
      return r.json();
    })
    .then(function (snap) {
      var items = (snap.ingredients || []).map(mapItem);
      return items.filter(function (item) {
        return (parseFloat(item.price_per_unit || '0') || 0) > 0;
      });
    });
}

/**
 * Loads all ingredient items using stale-while-revalidate pattern.
 * On success: populates _searchAllItems and initializes _searchFuse.
 * @returns {Promise}
 */
function loadSearchItems() {
  var middlewareUrl = (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.MIDDLEWARE_URL)
    ? SHEETS_CONFIG.MIDDLEWARE_URL : '';

  var cached = getCachedSearch();
  var dataPromise;

  if (cached) {
    // Stale-while-revalidate: return cached immediately, refresh in background if stale
    dataPromise = Promise.resolve(cached.data);
    if (!cached.fresh) {
      fetchFromMiddleware()
        .then(function (items) { setCachedSearch(items); })
        .catch(function () {});
    }
  } else if (middlewareUrl) {
    dataPromise = fetchFromMiddleware()
      .then(function (items) {
        setCachedSearch(items);
        return items;
      })
      .catch(function () {
        return loadFromSnapshot();
      });
  } else {
    dataPromise = loadFromSnapshot();
  }

  return dataPromise.then(function (items) {
    _searchAllItems = items;

    // Build Fuse search index over ALL ingredients
    if (typeof Fuse !== 'undefined') {
      _searchFuse = new Fuse(_searchAllItems, {
        keys: ['name', 'description', 'cf_subcategory'],
        threshold: 0.35,
        minMatchCharLength: 2,
        ignoreLocation: true
      });
    }
  });
}

// ---------------------------------------------------------------------------
// DOM construction
// ---------------------------------------------------------------------------

/**
 * Builds the overlay DOM (backdrop + panel) and attaches to page.
 * Returns an object {backdrop, panel, input, clearBtn, closeBtn, results}.
 */
function buildOverlayDOM() {
  var backdrop = document.createElement('div');
  backdrop.className = 'search-overlay-backdrop';
  backdrop.setAttribute('aria-hidden', 'true');

  var panel = document.createElement('div');
  panel.className = 'search-overlay-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Ingredient search');
  panel.setAttribute('tabindex', '-1');

  var header = document.createElement('div');
  header.className = 'search-overlay-header';

  var input = document.createElement('input');
  input.type = 'search';
  input.className = 'search-overlay-input';
  input.placeholder = 'Search all ingredients...';
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');
  input.setAttribute('aria-label', 'Search all ingredients');
  header.appendChild(input);

  var clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'search-overlay-clear';
  clearBtn.setAttribute('aria-label', 'Clear search');
  clearBtn.textContent = '×'; // times symbol
  clearBtn.style.display = 'none';
  header.appendChild(clearBtn);

  var closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'search-overlay-close';
  closeBtn.setAttribute('aria-label', 'Close search');
  closeBtn.textContent = '×'; // times symbol
  header.appendChild(closeBtn);

  panel.appendChild(header);

  var results = document.createElement('div');
  results.className = 'search-overlay-results';
  results.setAttribute('role', 'list');
  panel.appendChild(results);

  // Attach to .ingredient-subnav .container (desktop anchor) or document.body
  var anchor = document.querySelector('.ingredient-subnav .container');
  if (anchor) {
    anchor.appendChild(backdrop);
    anchor.appendChild(panel);
  } else {
    document.body.appendChild(backdrop);
    document.body.appendChild(panel);
  }

  return { backdrop: backdrop, panel: panel, input: input, clearBtn: clearBtn, closeBtn: closeBtn, results: results };
}

/**
 * Builds a cart-compatible object from a mapped ingredient item.
 * Copies verbatim from 16-catalog-subpage.js lines 446-469.
 * _item_type: 'ingredient' routes to sv-cart-ingredients via getCartKey().
 */
function buildCartObject(item) {
  return {
    name: item.name,
    brand: '',
    retail_instore: '',
    retail_kit: '',
    price_per_unit: item.price_per_unit || '',
    price: item.price_per_unit || '',
    discount: '',
    stock: item.stock,
    time: '',
    sku: item.sku || '',
    unit: item.unit || '',
    low_amount: item.low_amount || '',
    high_amount: item.high_amount || '',
    step: item.step || '',
    _item_type: 'ingredient',
    max_order_qty: item.max_order_qty || '',
    zoho_item_id: item.zoho_item_id || '',
    millable: item.millable || '',
    tax_percentage: item.tax_percentage != null ? item.tax_percentage : 0,
    tax_name: item.tax_name || ''
  };
}

/**
 * Builds a result row DOM element for a single search result item.
 * @param {Object} item - mapped ingredient item
 * @param {string} pageSlug - destination page filename (e.g. 'grains.html')
 * @returns {HTMLElement} the result row div
 */
function buildResultRow(item, pageSlug) {
  var row = document.createElement('div');
  row.className = 'search-result-row';
  row.setAttribute('role', 'listitem');

  var stockVal = parseInt(item.stock, 10) || 0;
  var isOutOfStock = stockVal <= 0;
  if (isOutOfStock) {
    row.classList.add('out-of-stock');
  }

  // Name — link to subpage with ?item=SKU deep-link (D-08)
  var nameLink = document.createElement('a');
  nameLink.className = 'search-result-name';
  nameLink.href = '../products/' + pageSlug + (item.sku ? '?item=' + encodeURIComponent(item.sku) : '');
  nameLink.textContent = item.name; // T-23-03: textContent, never innerHTML for product data
  row.appendChild(nameLink);

  // Price with unit (D-05)
  var priceEl = document.createElement('span');
  priceEl.className = 'search-result-price';
  var priceVal = parseFloat(item.price_per_unit) || 0;
  var priceStr = (typeof formatCurrency !== 'undefined') ? formatCurrency(priceVal) : ('$' + priceVal.toFixed(2));
  if (item.unit) {
    priceStr = priceStr + '/' + item.unit;
  }
  priceEl.textContent = priceStr; // T-23-03: textContent only
  row.appendChild(priceEl);

  // Stock badge — reuse existing .stock-badge classes from catalog-subpage.css (D-05)
  var badgeWrap = document.createElement('span');
  badgeWrap.className = 'search-result-badge';
  var badge = document.createElement('span');
  badge.className = 'stock-badge';
  if (!isOutOfStock) {
    badge.classList.add('stock-badge--in');
    badge.textContent = 'In stock';
  } else {
    badge.classList.add('stock-badge--out');
    badge.textContent = 'Out of stock';
  }
  badgeWrap.appendChild(badge);
  row.appendChild(badgeWrap);

  // Inline cart controls — only for in-stock items (D-07: no cart on out-of-stock)
  if (!isOutOfStock) {
    var cartObj = buildCartObject(item);
    var productKey = item.name + '|';
    var currentQty = (typeof getReservedQty === 'function') ? (getReservedQty(productKey) || 0) : 0;
    var isWeight = (typeof hasWeightConfig === 'function') && hasWeightConfig(item);

    if (isWeight) {
      // Weight items: text input + unit label + add button
      var weightWrap = document.createElement('div');
      weightWrap.className = 'search-cart-weight';

      var unitLower = (item.unit || '').toLowerCase().trim();
      var isKg = unitLower === 'kg' || unitLower.indexOf('kg') !== -1;
      var stepVal = isKg ? 0.01 : 1;

      var weightInput = document.createElement('input');
      weightInput.type = 'number';
      weightInput.className = 'search-cart-weight-input';
      weightInput.setAttribute('min', isKg ? '0.01' : '1');
      weightInput.setAttribute('step', String(stepVal));
      weightInput.setAttribute('inputmode', isKg ? 'decimal' : 'numeric');
      weightInput.setAttribute('aria-label', 'Amount of ' + item.name + ' in ' + (item.unit || 'units'));
      weightInput.placeholder = currentQty > 0 ? '' : (isKg ? '0.00' : '0');
      if (currentQty > 0) weightInput.value = isKg ? currentQty.toFixed(2) : String(currentQty);

      // Prevent overlay keyboard handler from closing on input interaction
      weightInput.addEventListener('keydown', function (e) { e.stopPropagation(); });

      var unitLabel = document.createElement('span');
      unitLabel.className = 'search-cart-weight-unit';
      unitLabel.textContent = item.unit || '';

      var addWeightBtn = document.createElement('button');
      addWeightBtn.type = 'button';
      addWeightBtn.className = 'search-cart-btn search-cart-plus';
      addWeightBtn.setAttribute('aria-label', 'Set ' + item.name + ' quantity');
      addWeightBtn.textContent = currentQty > 0 ? '✓' : '+';

      addWeightBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (typeof setReservationQty !== 'function') return;
        var val = parseFloat(weightInput.value) || 0;
        if (val <= 0) return;
        setReservationQty(cartObj, val);
        addWeightBtn.textContent = '✓';
        window.dispatchEvent(new CustomEvent('reservation-changed'));
      });

      weightWrap.appendChild(weightInput);
      weightWrap.appendChild(unitLabel);
      weightWrap.appendChild(addWeightBtn);
      row.appendChild(weightWrap);
    } else {
      // Integer items: −/qty/+ control
      var cartWrap = document.createElement('div');
      cartWrap.className = 'search-cart-control';

      var minusBtn = document.createElement('button');
      minusBtn.type = 'button';
      minusBtn.className = 'search-cart-btn search-cart-minus';
      minusBtn.setAttribute('aria-label', 'Remove ' + item.name + ' from cart');
      minusBtn.textContent = '−';
      if (currentQty <= 0) minusBtn.style.display = 'none';

      var qtySpan = document.createElement('span');
      qtySpan.className = 'search-cart-qty';
      qtySpan.textContent = currentQty > 0 ? String(currentQty) : '';
      if (currentQty <= 0) qtySpan.style.display = 'none';

      var plusBtn = document.createElement('button');
      plusBtn.type = 'button';
      plusBtn.className = 'search-cart-btn search-cart-plus';
      plusBtn.setAttribute('aria-label', 'Add ' + item.name + ' to cart');
      plusBtn.textContent = '+';

      function updateQtyDisplay(wrap, qty) {
        var m = wrap.querySelector('.search-cart-minus');
        var q = wrap.querySelector('.search-cart-qty');
        if (qty > 0) {
          m.style.display = '';
          q.style.display = '';
          q.textContent = String(qty);
        } else {
          m.style.display = 'none';
          q.style.display = 'none';
          q.textContent = '';
        }
      }

      plusBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (typeof setReservationQty !== 'function') return;
        var cur = (typeof getReservedQty === 'function') ? (getReservedQty(productKey) || 0) : 0;
        setReservationQty(cartObj, cur + 1);
        updateQtyDisplay(cartWrap, cur + 1);
        window.dispatchEvent(new CustomEvent('reservation-changed'));
      });

      minusBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (typeof setReservationQty !== 'function') return;
        var cur = (typeof getReservedQty === 'function') ? (getReservedQty(productKey) || 0) : 0;
        var newQty = Math.max(0, cur - 1);
        setReservationQty(cartObj, newQty);
        updateQtyDisplay(cartWrap, newQty);
        window.dispatchEvent(new CustomEvent('reservation-changed'));
      });

      cartWrap.appendChild(minusBtn);
      cartWrap.appendChild(qtySpan);
      cartWrap.appendChild(plusBtn);
      row.appendChild(cartWrap);
    }
  }

  return row;
}

// ---------------------------------------------------------------------------
// Search rendering
// ---------------------------------------------------------------------------

// Module-level references to overlay DOM elements (set by buildOverlayDOM)
var _overlayElements = null;

/**
 * Renders search results into the overlay results container.
 * Clears and rebuilds the results DOM for each query.
 * @param {string} query - user-typed search query
 */
function renderSearchResults(query) {
  if (!_overlayElements) return;
  var resultsEl = _overlayElements.results;

  // D-10: minimum 2 characters before search fires
  if (!query || query.length < 2) {
    resultsEl.innerHTML = '';
    return;
  }

  if (!_searchFuse) {
    // Error state — Fuse init failed or items not loaded yet
    resultsEl.innerHTML = '';
    var errDiv = document.createElement('div');
    errDiv.className = 'search-error-state';
    errDiv.textContent = 'Search unavailable. Browse categories using the links above.';
    resultsEl.appendChild(errDiv);
    return;
  }

  var fuseResults = _searchFuse.search(query);
  var groups = groupResultsByCategory(fuseResults);
  var cap = computeResultCap(groups.length);

  resultsEl.innerHTML = ''; // clear previous results

  if (groups.length === 0) {
    // D-09: no-results state (T-23-01: use textContent for query echo, never innerHTML)
    var noResultsDiv = document.createElement('div');
    noResultsDiv.className = 'search-no-results';
    var noResultsMsg = document.createElement('p');
    noResultsMsg.textContent = 'No ingredients match “' + query + '”'; // T-23-01
    var noResultsHint = document.createElement('p');
    noResultsHint.textContent = 'Try a different spelling or browse a category above.';
    noResultsDiv.appendChild(noResultsMsg);
    noResultsDiv.appendChild(noResultsHint);
    resultsEl.appendChild(noResultsDiv);
    return;
  }

  groups.forEach(function (group) {
    // Group header
    var groupHeader = document.createElement('div');
    groupHeader.className = 'search-group-header';
    groupHeader.setAttribute('role', 'heading');
    groupHeader.setAttribute('aria-level', '3');
    // Use textContent for category name (T-23-03: no innerHTML for data)
    var categoryName = document.createTextNode(group.category.toUpperCase() + ' ');
    var countSpan = document.createElement('span');
    countSpan.className = 'search-group-count';
    countSpan.textContent = '(' + group.items.length + ')';
    groupHeader.appendChild(categoryName);
    groupHeader.appendChild(countSpan);
    resultsEl.appendChild(groupHeader);

    // Result rows (up to cap)
    var rowItems = group.items.slice(0, cap);
    rowItems.forEach(function (item) {
      var row = buildResultRow(item, group.slug);
      resultsEl.appendChild(row);
    });

    // "View all" link if capped (D-06)
    if (group.items.length > cap) {
      var viewAllLink = document.createElement('a');
      viewAllLink.className = 'search-view-all';
      viewAllLink.href = '../products/' + group.slug;
      viewAllLink.textContent = 'View all ' + group.items.length + ' in ' + group.category;
      resultsEl.appendChild(viewAllLink);
    }
  });
}

// ---------------------------------------------------------------------------
// Overlay lifecycle
// ---------------------------------------------------------------------------

/**
 * Opens the search overlay: shows backdrop+panel, focuses input, loads items.
 * @param {HTMLElement} triggerBtn - the .subnav-search-btn that was clicked
 */
function openSearchOverlay(triggerBtn) {
  if (!_overlayElements) return;
  _searchOverlayOpen = true;
  _searchOpenBtn = triggerBtn || null;

  // Set aria-expanded on trigger button
  if (triggerBtn) {
    triggerBtn.setAttribute('aria-expanded', 'true');
  }

  _overlayElements.backdrop.classList.add('open');
  _overlayElements.panel.classList.add('open');
  _overlayElements.input.focus();

  // Prevent body scroll while overlay is open
  document.body.style.overflow = 'hidden';

  // Lazy-load items if not yet loaded
  if (_searchAllItems.length === 0) {
    loadSearchItems().catch(function () {
      // If load fails, _searchFuse remains null — error state shown on next search
    });
  }
}

/**
 * Closes the search overlay: hides backdrop+panel, restores scroll, returns focus.
 */
function closeSearchOverlay() {
  if (!_overlayElements) return;
  _searchOverlayOpen = false;

  _overlayElements.backdrop.classList.remove('open');
  _overlayElements.panel.classList.remove('open');

  // Remove aria-expanded from trigger button
  if (_searchOpenBtn) {
    _searchOpenBtn.removeAttribute('aria-expanded');
  }

  // Restore body scroll
  document.body.style.overflow = '';

  // Clear input and results
  _overlayElements.input.value = '';
  _overlayElements.results.innerHTML = '';
  _overlayElements.clearBtn.style.display = 'none';

  // Return focus to the button that opened the overlay
  if (_searchOpenBtn) {
    _searchOpenBtn.focus();
  }
}

// ---------------------------------------------------------------------------
// Init (DOMContentLoaded)
// ---------------------------------------------------------------------------

if (typeof document !== 'undefined') { document.addEventListener('DOMContentLoaded', function () {
  // Pitfall 3: MUST be first statement — routes cart items to ingredients cart
  // (overlay is only loaded on ingredient pages, so this is always correct)
  _activeCartTab = 'ingredients';

  // Find search button — abort silently if not present on this page
  var btn = document.querySelector('.subnav-search-btn');
  if (!btn) return;

  // Build overlay DOM and wire up elements
  _overlayElements = buildOverlayDOM();

  // Wire search button click to open overlay
  btn.addEventListener('click', function () {
    openSearchOverlay(btn);
  });

  // Wire search input with 180ms debounce
  var searchTimer;
  _overlayElements.input.addEventListener('input', function () {
    var query = _overlayElements.input.value;
    // Show/hide clear button
    _overlayElements.clearBtn.style.display = query.length > 0 ? 'flex' : 'none';
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      renderSearchResults(query);
    }, 180);
  });

  // Wire clear button
  _overlayElements.clearBtn.addEventListener('click', function () {
    clearTimeout(searchTimer);
    _overlayElements.input.value = '';
    _overlayElements.clearBtn.style.display = 'none';
    _overlayElements.results.innerHTML = '';
    _overlayElements.input.focus();
  });

  // Wire close button (mobile)
  _overlayElements.closeBtn.addEventListener('click', function () {
    closeSearchOverlay();
  });

  // Wire backdrop click to close
  _overlayElements.backdrop.addEventListener('click', function () {
    closeSearchOverlay();
  });

  // Keyboard: ESC closes overlay and returns focus
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && _searchOverlayOpen) {
      closeSearchOverlay();
    }
  });


}); } // end DOMContentLoaded + document guard

// ---------------------------------------------------------------------------
// Module exports (for unit testing pure functions)
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    groupResultsByCategory: groupResultsByCategory,
    computeResultCap: computeResultCap
  };
}

})(); // end IIFE
