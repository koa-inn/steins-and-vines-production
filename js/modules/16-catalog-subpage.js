// ===== Catalog Subpage Module =====
// Standalone module (NOT in concat:js). Loads after main.min.js.
// Shared globals available: formatCurrency, escapeHTML, renderReserveControl,
// renderWeightControl, hasWeightConfig, setReservationQty, getReservedQty,
// equalizeCardHeights, trackEvent, Fuse, handleDeepLinkedItem, injectProductSchema

// ---------------------------------------------------------------------------
// Module-private state
// ---------------------------------------------------------------------------

var _allSubpageItems = [];
var _subpageFuse = null;
var _activeFilterGroups = [];
var _subpageViewMode = 'grid';
var _subpageSortMode = 'stock-first';
var _subpageOpenPanel = null;
var _subpageOpenCard = null;
var SUBPAGE_DESKTOP_BREAKPOINT = 768;

// Cache keys — initialized inside DOMContentLoaded once SUBPAGE_CONFIG is available
var MW_CACHE_KEY = '';
var MW_CACHE_TS  = '';
var MW_CACHE_TTL = 3600000; // 1 hour

// ---------------------------------------------------------------------------
// Pure functions (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Filters a flat list of ingredient items by SUBPAGE_CONFIG matching rules.
 * Items must have price > 0 AND match at least one subcategory or type.
 * @param {Array} items - flat list of item objects from /api/ingredients
 * @param {Object} config - SUBPAGE_CONFIG-shaped object with subcategories[] and types[]
 * @returns {Array} filtered items
 */
function filterItemsByConfig(items, config) {
  return items.filter(function (item) {
    var price = parseFloat(item.price_per_unit || '0') || 0;
    if (price <= 0) return false;

    var subcat = (item.subcategory || item.cf_subcategory || '').trim();
    var type = (item.type || item.cf_type || '').trim();

    if (config.subcategories && config.subcategories.length > 0) {
      if (config.subcategories.indexOf(subcat) !== -1) return true;
    }
    if (config.types && config.types.length > 0) {
      if (config.types.indexOf(type) !== -1) return true;
    }

    return false;
  });
}

/**
 * Returns a comparator function for Array.sort() given a sort mode string.
 * @param {string} sortMode - 'name-asc' | 'name-desc' | 'price-asc' | 'price-desc' | 'stock-first'
 * @returns {Function} comparator (a, b) => number
 */
function buildSortComparator(sortMode) {
  return function (a, b) {
    switch (sortMode) {
      case 'name-asc':
        return (a.name || '').localeCompare(b.name || '');
      case 'name-desc':
        return (b.name || '').localeCompare(a.name || '');
      case 'price-asc':
        return (parseFloat(a.price_per_unit) || 0) - (parseFloat(b.price_per_unit) || 0);
      case 'price-desc':
        return (parseFloat(b.price_per_unit) || 0) - (parseFloat(a.price_per_unit) || 0);
      case 'stock-first':
      default:
        var aStock = (parseInt(a.stock, 10) || 0) > 0 ? 0 : 1;
        var bStock = (parseInt(b.stock, 10) || 0) > 0 ? 0 : 1;
        if (aStock !== bStock) return aStock - bStock;
        return (a.name || '').localeCompare(b.name || '');
    }
  };
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

function getCachedMW() {
  try {
    var data = localStorage.getItem(MW_CACHE_KEY);
    var ts = parseInt(localStorage.getItem(MW_CACHE_TS), 10) || 0;
    if (data) return { data: JSON.parse(data), fresh: (Date.now() - ts) < MW_CACHE_TTL };
  } catch (e) {}
  return null;
}

function setCachedMW(items) {
  try {
    localStorage.setItem(MW_CACHE_KEY, JSON.stringify(items));
    localStorage.setItem(MW_CACHE_TS, String(Date.now()));
  } catch (e) {}
}

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
    cf_subcategory: '',
    cf_type: '',
    millable: ''
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
      return filterItemsByConfig(items, SUBPAGE_CONFIG);
    });
}

function loadFromSnapshot() {
  return fetch('/content/zoho-snapshot.json')
    .then(function (r) {
      if (!r.ok) throw new Error('Snapshot fetch failed: ' + r.status);
      return r.json();
    })
    .then(function (snap) {
      var items = (snap.ingredients || []).map(mapItem);
      return filterItemsByConfig(items, SUBPAGE_CONFIG);
    });
}

function loadSubpageItems(callback) {
  var middlewareUrl = (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.MIDDLEWARE_URL)
    ? SHEETS_CONFIG.MIDDLEWARE_URL : '';

  var catalogId = SUBPAGE_CONFIG.catalogContainerId || 'subpage-catalog';
  var catalog = document.getElementById(catalogId);
  if (catalog) {
    var loadingDiv = document.createElement('div');
    loadingDiv.className = 'subpage-loading';
    var loadingP = document.createElement('p');
    loadingP.textContent = 'Loading products...';
    loadingDiv.appendChild(loadingP);
    catalog.textContent = '';
    catalog.appendChild(loadingDiv);
  }

  var cached = getCachedMW();

  var dataPromise;
  if (cached) {
    // Stale-while-revalidate: return cached immediately, refresh in background if stale
    dataPromise = Promise.resolve(cached.data);
    if (!cached.fresh) {
      fetchFromMiddleware()
        .then(function (items) {
          setCachedMW(items);
          // Background refresh silently updates cache
        })
        .catch(function () {});
    }
  } else if (middlewareUrl) {
    dataPromise = fetchFromMiddleware()
      .then(function (items) {
        setCachedMW(items);
        return items;
      })
      .catch(function () {
        return loadFromSnapshot();
      });
  } else {
    dataPromise = loadFromSnapshot();
  }

  dataPromise
    .then(function (items) {
      _allSubpageItems = items;

      // Build Fuse search index
      if (typeof Fuse !== 'undefined') {
        _subpageFuse = new Fuse(items, {
          keys: ['name', 'description', 'cf_subcategory'],
          threshold: 0.35,
          minMatchCharLength: 2,
          ignoreLocation: true
        });
      }

      // Build filter pills if configured
      if (SUBPAGE_CONFIG.filterGroups && SUBPAGE_CONFIG.filterGroups.length > 0) {
        buildFilterPills('subpage-filter-row', SUBPAGE_CONFIG);
      } else {
        var filterRow = document.getElementById('subpage-filter-row');
        if (filterRow) filterRow.classList.add('hidden');
      }

      if (callback) callback();
    })
    .catch(function () {
      showError(catalog);
    });
}

// ---------------------------------------------------------------------------
// Hero section
// ---------------------------------------------------------------------------

function applyHeroAccent(config) {
  if (config.accentColor) {
    document.body.style.setProperty('--subpage-accent', config.accentColor);
  }
  var heroEl = document.querySelector('.subpage-hero');
  if (heroEl) {
    heroEl.setAttribute('data-category', config.categorySlug || '');
  }
}

// ---------------------------------------------------------------------------
// Filter pills
// ---------------------------------------------------------------------------

function buildFilterPills(containerId, config) {
  var container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  if (!config.filterGroups || config.filterGroups.length === 0) {
    container.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');

  // "All" button — always first, active by default
  var allBtn = document.createElement('button');
  allBtn.className = 'catalog-filter-btn active';
  allBtn.type = 'button';
  allBtn.textContent = 'All';
  allBtn.setAttribute('data-value', 'All');
  allBtn.addEventListener('click', function () {
    _activeFilterGroups = [];
    var btns = container.querySelectorAll('.catalog-filter-btn');
    btns.forEach(function (b) { b.classList.remove('active'); });
    allBtn.classList.add('active');
    renderCatalog();
  });
  container.appendChild(allBtn);

  // Per-group buttons
  config.filterGroups.forEach(function (group) {
    var btn = document.createElement('button');
    btn.className = 'catalog-filter-btn';
    btn.type = 'button';
    btn.textContent = group.label;
    btn.setAttribute('data-value', group.label);
    btn.addEventListener('click', function () {
      var idx = _activeFilterGroups.indexOf(group.label);
      if (idx !== -1) {
        _activeFilterGroups.splice(idx, 1);
      } else {
        _activeFilterGroups.push(group.label);
      }
      // Update active states
      var btns = container.querySelectorAll('.catalog-filter-btn');
      btns.forEach(function (b) { b.classList.remove('active'); });
      if (_activeFilterGroups.length === 0) {
        var allBtnEl = container.querySelector('[data-value="All"]');
        if (allBtnEl) allBtnEl.classList.add('active');
      } else {
        btns.forEach(function (b) {
          if (_activeFilterGroups.indexOf(b.getAttribute('data-value')) !== -1) {
            b.classList.add('active');
          }
        });
      }
      renderCatalog();
    });
    container.appendChild(btn);
  });
}

// ---------------------------------------------------------------------------
// Error / empty / loading states
// ---------------------------------------------------------------------------

function showError(container) {
  var el = container;
  if (!el) {
    var catalogId = SUBPAGE_CONFIG ? (SUBPAGE_CONFIG.catalogContainerId || 'subpage-catalog') : 'subpage-catalog';
    el = document.getElementById(catalogId);
  }
  if (!el) return;
  el.innerHTML = '';

  var errorDiv = document.createElement('div');
  errorDiv.className = 'catalog-error';

  var errorMsg = document.createElement('p');
  errorMsg.textContent = 'Could not load products. Please try again.';

  var retryBtn = document.createElement('button');
  retryBtn.className = 'catalog-retry-btn btn-outline';
  retryBtn.type = 'button';
  retryBtn.textContent = 'Retry';
  retryBtn.addEventListener('click', function () {
    loadSubpageItems(function () {
      renderCatalog();
      if (typeof handleDeepLinkedItem !== 'undefined') {
        handleDeepLinkedItem();
      }
    });
  });

  errorDiv.appendChild(errorMsg);
  errorDiv.appendChild(retryBtn);
  el.appendChild(errorDiv);
}

function renderEmptyState(container, config) {
  var catName = (config && config.categoryName) ? config.categoryName : 'items';
  var msg = document.createElement('p');
  msg.className = 'catalog-no-results';
  msg.textContent = 'No ' + catName + ' are currently available.';

  var sub = document.createElement('p');
  sub.className = 'catalog-no-results-sub';
  sub.textContent = 'Check back soon or contact us if you need something specific.';

  container.appendChild(msg);
  container.appendChild(sub);
}

// ---------------------------------------------------------------------------
// Detail panel (desktop full-width row)
// ---------------------------------------------------------------------------

function findRowEnd(card, grid) {
  var cards = grid.querySelectorAll('.subpage-card');
  var top = card.offsetTop;
  var last = card;
  for (var i = 0; i < cards.length; i++) {
    if (cards[i].offsetTop === top) last = cards[i];
  }
  return last;
}

function buildDetailPanel(item) {
  var panel = document.createElement('div');
  panel.className = 'subpage-detail-panel';
  panel.style.gridColumn = '1 / -1';

  // Close button
  var closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'subpage-detail-close';
  closeBtn.setAttribute('aria-label', 'Close details');
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', function () {
    closeDetailPanel();
  });
  panel.appendChild(closeBtn);

  // Product name
  var nameEl = document.createElement('h2');
  nameEl.textContent = item.name;
  panel.appendChild(nameEl);

  // Description
  var desc = item.sales_description || item.description || '';
  if (desc) {
    var descEl = document.createElement('p');
    descEl.textContent = desc;
    panel.appendChild(descEl);
  }

  // Stock count — hide for weight items
  var stockVal = parseInt(item.stock, 10) || 0;
  var panelIsWeight = typeof isWeightUnit === 'function' && isWeightUnit(item.unit);
  if (!panelIsWeight) {
    var stockInfo = document.createElement('p');
    stockInfo.className = 'subpage-detail-stock';
    stockInfo.textContent = stockVal > 0 ? 'In Stock: ' + stockVal + ' ' + (item.unit || 'units') : 'Out of Stock';
    panel.appendChild(stockInfo);
  }

  // Cart controls (only for in-stock items)
  if (stockVal > 0) {
    var cartArea = document.createElement('div');
    cartArea.className = 'subpage-detail-cart';

    var cartObj = buildCartObject(item);
    var productKey = getProductKey(item);
    var reserveWrap = document.createElement('div');
    reserveWrap.className = 'product-reserve-wrap';

    var renderer = (typeof hasWeightConfig !== 'undefined' && hasWeightConfig(item))
      ? renderWeightControl : renderReserveControl;
    reserveWrap._reserveProduct = cartObj;
    reserveWrap._reserveKey = productKey;
    reserveWrap._reserveRenderer = renderer;
    renderer(reserveWrap, cartObj, productKey);
    cartArea.appendChild(reserveWrap);
    panel.appendChild(cartArea);
  }

  return panel;
}

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

function openDetailPanel(card, item) {
  closeDetailPanel();

  var grid = card.parentNode;
  var rowEnd = findRowEnd(card, grid);
  var panel = buildDetailPanel(item);
  rowEnd.parentNode.insertBefore(panel, rowEnd.nextSibling);

  _subpageOpenPanel = panel;
  _subpageOpenCard = card;
  card.classList.add('subpage-card--active');

  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  var closeBtn = panel.querySelector('.subpage-detail-close');
  if (closeBtn) closeBtn.focus();
}

function closeDetailPanel() {
  if (_subpageOpenPanel && _subpageOpenPanel.parentNode) {
    _subpageOpenPanel.parentNode.removeChild(_subpageOpenPanel);
  }
  if (_subpageOpenCard) {
    _subpageOpenCard.classList.remove('subpage-card--active');
  }
  _subpageOpenPanel = null;
  _subpageOpenCard = null;
}

// ---------------------------------------------------------------------------
// Mobile accordion
// ---------------------------------------------------------------------------

function toggleMobileAccordion(card, item) {
  var existing = card.querySelector('.subpage-card-detail-accordion');
  if (existing) {
    existing.classList.remove('open');
    // Wait for transition before removing
    existing.addEventListener('transitionend', function () {
      if (existing.parentNode) existing.parentNode.removeChild(existing);
    }, { once: true });
    return;
  }

  var accordion = document.createElement('div');
  accordion.className = 'subpage-card-detail-accordion';

  var desc = item.sales_description || item.description || '';
  if (desc) {
    var descEl = document.createElement('p');
    descEl.textContent = desc;
    accordion.appendChild(descEl);
  }

  var accIsWeight = typeof isWeightUnit === 'function' && isWeightUnit(item.unit);
  if (!accIsWeight) {
    var stockVal = parseInt(item.stock, 10) || 0;
    var stockInfo = document.createElement('p');
    stockInfo.className = 'subpage-detail-stock';
    stockInfo.textContent = stockVal > 0 ? 'In Stock: ' + stockVal + ' ' + (item.unit || 'units') : 'Out of Stock';
    accordion.appendChild(stockInfo);
  }

  card.appendChild(accordion);
  // Trigger transition on next frame
  requestAnimationFrame(function () {
    accordion.classList.add('open');
  });
}

// ---------------------------------------------------------------------------
// Card builder
// ---------------------------------------------------------------------------

function buildItemCard(item) {
  var card = document.createElement('div');
  card.className = 'product-card subpage-card';
  if (item.sku) { card.setAttribute('data-sku', item.sku); }
  var _cardStockVal = parseInt(item.stock, 10) || 0;
  var _cardIsWeight = typeof isWeightUnit === 'function' && isWeightUnit(item.unit);
  if (_cardStockVal <= 0 && !_cardIsWeight) { card.classList.add('out-of-stock'); }

  // Product name — T-21-01: use textContent, never innerHTML for product data
  var nameEl = document.createElement('h2');
  nameEl.textContent = item.name;
  card.appendChild(nameEl);

  // Price
  var priceEl = document.createElement('p');
  priceEl.className = 'product-price';
  var priceVal = parseFloat(item.price_per_unit) || 0;
  priceEl.textContent = (typeof formatCurrency !== 'undefined')
    ? formatCurrency(priceVal) : ('$' + priceVal.toFixed(2));
  if (item.unit) {
    var unitSpan = document.createElement('span');
    unitSpan.className = 'product-unit';
    unitSpan.textContent = ' / ' + item.unit;
    priceEl.appendChild(unitSpan);
  }
  card.appendChild(priceEl);

  // Stock badge — hide for weight items (stock less reliably accurate)
  var stockVal = parseInt(item.stock, 10) || 0;
  var itemIsWeight = typeof isWeightUnit === 'function' && isWeightUnit(item.unit);
  if (!itemIsWeight) {
    var badge = document.createElement('span');
    badge.className = 'stock-badge';
    if (stockVal > 0) {
      badge.classList.add('stock-badge--in');
      badge.textContent = 'In Stock';
    } else {
      badge.classList.add('stock-badge--out');
      badge.textContent = 'Out of Stock';
    }
    card.appendChild(badge);
  }

  // Cart controls. Weight items get the compact weight control (inline slider +
  // amount + live price) so the customer chooses an amount instead of silently
  // committing a default unit; non-weight items use the standard reserve button.
  if (stockVal > 0 || itemIsWeight) {
    var cartObj = buildCartObject(item);
    var productKey = getProductKey(item);
    var reserveWrap = document.createElement('div');
    reserveWrap.className = 'product-reserve-wrap';

    var cardRenderer = (itemIsWeight && typeof renderWeightControlCompact !== 'undefined')
      ? renderWeightControlCompact : renderReserveControl;
    reserveWrap._reserveProduct = cartObj;
    reserveWrap._reserveKey = productKey;
    reserveWrap._reserveRenderer = cardRenderer;
    cardRenderer(reserveWrap, cartObj, productKey);
    card.appendChild(reserveWrap);
  }

  // Click handler: open detail panel on desktop, accordion on mobile
  card.addEventListener('click', function (e) {
    // Don't trigger detail panel when clicking cart controls
    if (e.target.closest('.product-reserve-wrap')) return;

    if (window.innerWidth < SUBPAGE_DESKTOP_BREAKPOINT) {
      toggleMobileAccordion(card, item);
    } else {
      if (_subpageOpenCard === card) {
        closeDetailPanel();
      } else {
        openDetailPanel(card, item);
      }
    }
  });

  // Inject product schema
  if (typeof injectProductSchema !== 'undefined') {
    injectProductSchema(item, 'ingredient');
  }

  return card;
}

// ---------------------------------------------------------------------------
// List view table
// ---------------------------------------------------------------------------

function buildListTable(items) {
  var table = document.createElement('table');
  table.className = 'subpage-list-table';

  var thead = document.createElement('thead');
  var headerRow = document.createElement('tr');
  var headers = ['Name', 'Price', 'Stock', 'Add to Cart'];
  headers.forEach(function (h) {
    var th = document.createElement('th');
    th.textContent = h;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  var tbody = document.createElement('tbody');

  items.forEach(function (item) {
    var stockVal = parseInt(item.stock, 10) || 0;

    var tr = document.createElement('tr');
    tr.setAttribute('data-item-name', item.name);
    if (item.sku) { tr.setAttribute('data-sku', item.sku); }

    // Name
    var tdName = document.createElement('td');
    tdName.textContent = item.name;
    tr.appendChild(tdName);

    // Price
    var tdPrice = document.createElement('td');
    var priceVal = parseFloat(item.price_per_unit) || 0;
    tdPrice.textContent = (typeof formatCurrency !== 'undefined')
      ? formatCurrency(priceVal) : ('$' + priceVal.toFixed(2));
    if (item.unit) tdPrice.textContent += ' / ' + item.unit;
    tr.appendChild(tdPrice);

    // Stock
    var tdStock = document.createElement('td');
    var stockBadge = document.createElement('span');
    stockBadge.className = 'stock-badge';
    if (stockVal > 0) {
      stockBadge.classList.add('stock-badge--in');
      stockBadge.textContent = 'In Stock';
    } else {
      stockBadge.classList.add('stock-badge--out');
      stockBadge.textContent = 'Out of Stock';
    }
    tdStock.appendChild(stockBadge);
    tr.appendChild(tdStock);

    // Add to Cart
    var tdCart = document.createElement('td');
    if (stockVal > 0) {
      var cartObj = buildCartObject(item);
      var productKey = getProductKey(item);
      var cartWrap = document.createElement('div');
      cartWrap.className = 'product-reserve-wrap';

      var ren = (typeof hasWeightConfig !== 'undefined' && hasWeightConfig(item))
        ? renderWeightControl : renderReserveControl;
      cartWrap._reserveProduct = cartObj;
      cartWrap._reserveKey = productKey;
      cartWrap._reserveRenderer = ren;
      ren(cartWrap, cartObj, productKey);
      tdCart.appendChild(cartWrap);
    }
    tr.appendChild(tdCart);

    // Row click to show detail (not on cart control cell)
    tr.addEventListener('click', function (e) {
      if (e.target.closest('.product-reserve-wrap')) return;
      var detailId = 'detail-' + (item.sku || item.name).replace(/[^a-zA-Z0-9-]/g, '_');
      var existing = document.getElementById(detailId);
      if (existing) {
        existing.classList.remove('open');
        tbody.removeChild(existing);
        return;
      }
      var detailRow = document.createElement('tr');
      detailRow.className = 'table-detail-row open';
      detailRow.id = detailId;
      var detailTd = document.createElement('td');
      detailTd.colSpan = 4;

      var desc = item.sales_description || item.description || '';
      if (desc) {
        var descEl = document.createElement('p');
        descEl.textContent = desc;
        detailTd.appendChild(descEl);
      }

      // Weight options info if applicable
      if (typeof hasWeightConfig !== 'undefined' && hasWeightConfig(item)) {
        var weightInfo = document.createElement('p');
        weightInfo.className = 'subpage-weight-info';
        weightInfo.textContent = 'Available in ' + (item.unit || 'custom') + ' increments.';
        detailTd.appendChild(weightInfo);
      }

      detailRow.appendChild(detailTd);
      tr.parentNode.insertBefore(detailRow, tr.nextSibling);
    });

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  return table;
}

// ---------------------------------------------------------------------------
// Main render function
// ---------------------------------------------------------------------------

function renderCatalog() {
  closeDetailPanel();

  var catalogId = SUBPAGE_CONFIG.catalogContainerId || 'subpage-catalog';
  var catalog = document.getElementById(catalogId);
  if (!catalog) return;

  // Collect query and sort from DOM
  var searchInput = document.getElementById('subpage-search');
  var query = searchInput ? searchInput.value.trim() : '';

  var sortSelect = document.getElementById('subpage-sort');
  var sortMode = sortSelect ? sortSelect.value : 'stock-first';
  _subpageSortMode = sortMode;

  // Start with all items
  var filtered = _allSubpageItems.slice();

  // Apply active filter groups
  if (_activeFilterGroups.length > 0 && SUBPAGE_CONFIG.filterGroups) {
    filtered = filtered.filter(function (item) {
      var subcat = (item.subcategory || item.cf_subcategory || '').trim();
      for (var gi = 0; gi < _activeFilterGroups.length; gi++) {
        var groupLabel = _activeFilterGroups[gi];
        // Find the matching filter group
        for (var fi = 0; fi < SUBPAGE_CONFIG.filterGroups.length; fi++) {
          if (SUBPAGE_CONFIG.filterGroups[fi].label === groupLabel) {
            var vals = SUBPAGE_CONFIG.filterGroups[fi].values || [];
            if (vals.indexOf(subcat) !== -1) return true;
          }
        }
      }
      return false;
    });
  }

  // Apply search — T-21-03: query used only in Fuse.search() and textContent comparison
  if (query) {
    if (_subpageFuse) {
      var fuseResults = _subpageFuse.search(query);
      var matchingNames = {};
      fuseResults.forEach(function (r) {
        var item = r.item || r;
        matchingNames[item.name] = true;
      });
      filtered = filtered.filter(function (item) {
        return matchingNames[item.name];
      });
    } else {
      var q = query.toLowerCase();
      filtered = filtered.filter(function (item) {
        return (item.name || '').toLowerCase().indexOf(q) !== -1 ||
               (item.description || '').toLowerCase().indexOf(q) !== -1 ||
               (item.cf_subcategory || '').toLowerCase().indexOf(q) !== -1;
      });
    }
  }

  // Sort
  filtered.sort(buildSortComparator(sortMode));

  // Render
  catalog.innerHTML = '';

  if (filtered.length === 0) {
    renderEmptyState(catalog, SUBPAGE_CONFIG);
    return;
  }

  if (_subpageViewMode === 'list') {
    catalog.classList.remove('product-grid');
    catalog.appendChild(buildListTable(filtered));
  } else {
    catalog.classList.add('product-grid');
    filtered.forEach(function (item) {
      catalog.appendChild(buildItemCard(item));
    });
  }

  // Equalize card heights — must be called once at end, after all cards are in DOM
  if (typeof equalizeCardHeights !== 'undefined') {
    equalizeCardHeights();
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

if (typeof document !== 'undefined') { document.addEventListener('DOMContentLoaded', function () {
  // Guard: abort if SUBPAGE_CONFIG is not defined
  if (typeof SUBPAGE_CONFIG === 'undefined') {
    console.error('[16-catalog-subpage] SUBPAGE_CONFIG not defined — module aborted.');
    return;
  }

  // MUST be first statement after guard — routes cart items to ingredients cart
  _activeCartTab = 'ingredients';

  // Set per-category cache keys
  MW_CACHE_KEY = 'sv-subpage-' + SUBPAGE_CONFIG.categorySlug + '-mw';
  MW_CACHE_TS  = 'sv-subpage-' + SUBPAGE_CONFIG.categorySlug + '-mw-ts';

  // Apply hero accent color and data-category attribute
  applyHeroAccent(SUBPAGE_CONFIG);

  // Populate hero content
  var heroH1 = document.querySelector('.subpage-hero h1');
  if (heroH1) heroH1.textContent = SUBPAGE_CONFIG.categoryName || '';

  var heroDesc = document.querySelector('.subpage-hero-desc');
  if (heroDesc) heroDesc.textContent = SUBPAGE_CONFIG.heroDescription || '';

  // Wire "Read more" toggle
  var heroToggle = document.querySelector('.subpage-hero-toggle');
  var heroFull = document.querySelector('.subpage-hero-full');
  if (heroToggle && heroFull) {
    heroToggle.addEventListener('click', function () {
      var isOpen = heroFull.classList.contains('active');
      if (isOpen) {
        heroFull.classList.remove('active');
        heroToggle.textContent = 'Read more';
      } else {
        heroFull.classList.add('active');
        heroToggle.textContent = 'Read less';
        // Populate full description on first open
        if (!heroFull.textContent.trim() && SUBPAGE_CONFIG.heroDescriptionFull) {
          heroFull.textContent = SUBPAGE_CONFIG.heroDescriptionFull;
        }
      }
    });
  }

  // Wire sort select
  var sortSelect = document.getElementById('subpage-sort');
  if (sortSelect) {
    sortSelect.addEventListener('change', function () { renderCatalog(); });
  }

  // Wire search input with 180ms debounce
  var searchInput = document.getElementById('subpage-search');
  if (searchInput) {
    var searchTimer;
    searchInput.addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(renderCatalog, 180);
    });
  }

  // Wire view toggle buttons
  var viewBtns = document.querySelectorAll('.subpage-toolbar .view-toggle-btn');
  var viewStorageKey = 'subpageViewMode-' + SUBPAGE_CONFIG.categorySlug;

  viewBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var view = btn.getAttribute('data-view');
      if (view === _subpageViewMode) return;
      _subpageViewMode = view;
      try { localStorage.setItem(viewStorageKey, view); } catch (e) {}
      viewBtns.forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-view') === view);
      });
      renderCatalog();
    });
  });

  // Restore saved view mode from localStorage
  try {
    var savedView = localStorage.getItem(viewStorageKey);
    if (savedView === 'grid' || savedView === 'list') {
      _subpageViewMode = savedView;
      viewBtns.forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-view') === savedView);
      });
    }
  } catch (e) {}

  // Keyboard: Escape closes detail panel
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && _subpageOpenPanel) {
      var prevCard = _subpageOpenCard;
      closeDetailPanel();
      if (prevCard) {
        var toggleBtn = prevCard.querySelector('button');
        if (toggleBtn) toggleBtn.focus();
      }
    }
  });

  // Close detail panel on resize to mobile
  if (window.matchMedia) {
    window.matchMedia('(max-width: ' + (SUBPAGE_DESKTOP_BREAKPOINT - 1) + 'px)').addEventListener('change', function () {
      closeDetailPanel();
    });
  }

  // Cart FAB — show count badge, open drawer on click
  var fab = document.getElementById('subpage-cart-fab');
  if (fab) {
    fab.addEventListener('click', function () {
      if (typeof openCartDrawer === 'function') openCartDrawer();
    });
  }
  updateSubpageCartFab();

  // Load items and render
  loadSubpageItems(function () {
    renderCatalog();
    if (typeof handleDeepLinkedItem !== 'undefined') {
      handleDeepLinkedItem();
    }
  });
}); } // end DOMContentLoaded + document guard

var _prevSubpageCartCount = 0;
function updateSubpageCartFab() {
  var fab = document.getElementById('subpage-cart-fab');
  var countEl = document.getElementById('subpage-cart-fab-count');
  if (!fab) return;
  var items = (typeof getAllCartItems === 'function') ? getAllCartItems() : [];
  var count = 0;
  items.forEach(function (item) {
    count += (typeof isWeightUnit === 'function' && isWeightUnit(item.unit)) ? 1 : (parseFloat(item.qty) || 1);
  });
  if (count === 0) {
    fab.classList.add('hidden');
  } else {
    fab.classList.remove('hidden');
    if (countEl) countEl.textContent = count;
    if (count !== _prevSubpageCartCount) {
      fab.classList.remove('pulse');
      void fab.offsetWidth;
      fab.classList.add('pulse');
    }
  }
  _prevSubpageCartCount = count;
}

if (typeof window !== 'undefined') {
  window.addEventListener('reservation-changed', function () {
    if (typeof updateSubpageCartFab === 'function') updateSubpageCartFab();
  });
}

// ---------------------------------------------------------------------------
// Module exports (for unit testing pure functions)
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    filterItemsByConfig: filterItemsByConfig,
    buildSortComparator: buildSortComparator
  };
}
