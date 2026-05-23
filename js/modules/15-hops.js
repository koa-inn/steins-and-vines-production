// ===== Hop Catalog Module =====
// Standalone module (NOT in concat:js). Loads after main.min.js.
// Shared globals available: formatCurrency, escapeHTML, renderReserveControl,
// renderWeightControl, hasWeightConfig, setReservationQty, getReservedQty,
// trackEvent, Fuse, equalizeCardHeights, injectProductSchema, handleDeepLinkedItem

var _allHops = [];
var _hopGroups = [];
var _hopsFuse = null;
var _activeFlavorFilters = [];
var _openPanel = null;
var _openCard = null;
var _compareMode = false;
var _compareItems = [];
var _compareBusy = false;
var _hopsViewMode = 'cards';
var DESKTOP_BREAKPOINT = 768;

var HOP_AXES = ['citrus', 'tropical', 'floral', 'spicy', 'pine', 'herbal'];
var HOP_AXIS_LABELS = ['Citrus', 'Tropical', 'Floral', 'Spicy', 'Pine', 'Herbal'];
var RADAR_NS = 'http://www.w3.org/2000/svg';
var RADAR_SIZE = 260;
var RADAR_CENTER = RADAR_SIZE / 2;
var RADAR_RADIUS = RADAR_SIZE * 0.28;
var RADAR_LABEL_OFFSET = RADAR_SIZE * 0.12;
var MW_CACHE_KEY = 'sv-hops-mw';
var MW_CACHE_TS = 'sv-hops-mw-ts';
var MW_CACHE_TTL = 3600000;

// ---------------------------------------------------------------------------
// Pure functions (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Groups flat hop items by name stem (strips trailing size suffix).
 * Sorts variants within each group by price ascending.
 * @param {Array} items - flat list of hop item objects
 * @returns {Array} array of { name: stem, variants: [item, ...] }
 */
function groupHopsByVariant(items) {
  var groups = {};
  var order = [];
  items.forEach(function (item) {
    var stem = (item.name || '').replace(/\s*[-–]\s*\d+\s*(?:oz|g)\s*$/i, '').trim();
    if (!stem) stem = item.name || '';
    if (!groups[stem]) {
      groups[stem] = { name: stem, variants: [] };
      order.push(stem);
    }
    groups[stem].variants.push(item);
  });
  order.forEach(function (stem) {
    groups[stem].variants.sort(function (a, b) {
      return (parseFloat(a.price_per_unit) || 0) - (parseFloat(b.price_per_unit) || 0);
    });
  });
  return order.map(function (stem) { return groups[stem]; });
}

/**
 * Returns the top N flavor tag objects sorted by score descending, excluding zeros.
 * @param {Object} item - hop item with citrus/tropical/etc. properties
 * @param {number} count - max number of tags to return (default 3)
 * @returns {Array} [{ label: 'Citrus', value: 4 }, ...]
 */
function getTopFlavorTags(item, count) {
  var n = count || 3;
  var scored = HOP_AXES.map(function (axis, i) {
    return { label: HOP_AXIS_LABELS[i], value: parseFloat(item[axis] || 0) || 0 };
  });
  scored.sort(function (a, b) { return b.value - a.value; });
  return scored.slice(0, n).filter(function (s) { return s.value > 0; });
}

/**
 * Returns the label of the highest-scoring flavor axis, or null if all zeros.
 * Ties broken by order in HOP_AXES (first wins).
 * @param {Object} item - hop item
 * @returns {string|null}
 */
function getDominantFlavor(item) {
  var best = null;
  var bestVal = 0;
  for (var i = 0; i < HOP_AXES.length; i++) {
    var val = parseFloat(item[HOP_AXES[i]] || 0) || 0;
    if (val > bestVal) {
      bestVal = val;
      best = HOP_AXIS_LABELS[i];
    }
  }
  return bestVal > 0 ? best : null;
}

/**
 * Builds an inline SVG radar chart for a hop item's sensory scores.
 * @param {Object} item - hop item with citrus/tropical/etc. properties and optional name
 * @returns {SVGElement}
 */
function buildHopRadarChart(item) {
  var axisScores = HOP_AXES.map(function (axis) {
    return Math.min(parseFloat(item[axis] || 0) || 0, 5);
  });

  // Build aria-label
  var ariaLabel = (item.name ? item.name + ' sensory profile: ' : 'Hop sensory profile: ');
  ariaLabel += HOP_AXIS_LABELS.map(function (label, i) {
    return label + ' ' + axisScores[i] + '/5';
  }).join(', ');

  var svg = document.createElementNS(RADAR_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + RADAR_SIZE + ' ' + RADAR_SIZE);
  svg.setAttribute('class', 'hop-radar');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', ariaLabel);

  // Draw 5 concentric hexagonal web rings (scale 1-5 out of 5)
  for (var ring = 1; ring <= 5; ring++) {
    var frac = ring / 5;
    var webPoints = HOP_AXES.map(function (_, i) {
      var angle = (Math.PI * 2 * i / 6) - Math.PI / 2;
      var x = RADAR_CENTER + RADAR_RADIUS * frac * Math.cos(angle);
      var y = RADAR_CENTER + RADAR_RADIUS * frac * Math.sin(angle);
      return x.toFixed(2) + ',' + y.toFixed(2);
    }).join(' ');
    var webPoly = document.createElementNS(RADAR_NS, 'polygon');
    webPoly.setAttribute('points', webPoints);
    webPoly.setAttribute('class', 'radar-web');
    svg.appendChild(webPoly);
  }

  // Draw 6 axis lines from center to each vertex
  for (var ai = 0; ai < 6; ai++) {
    var axisAngle = (Math.PI * 2 * ai / 6) - Math.PI / 2;
    var ex = RADAR_CENTER + RADAR_RADIUS * Math.cos(axisAngle);
    var ey = RADAR_CENTER + RADAR_RADIUS * Math.sin(axisAngle);
    var axisLine = document.createElementNS(RADAR_NS, 'line');
    axisLine.setAttribute('x1', String(RADAR_CENTER));
    axisLine.setAttribute('y1', String(RADAR_CENTER));
    axisLine.setAttribute('x2', ex.toFixed(2));
    axisLine.setAttribute('y2', ey.toFixed(2));
    axisLine.setAttribute('class', 'radar-axis');
    svg.appendChild(axisLine);
  }

  // Draw 6 axis labels positioned outside the outermost ring
  for (var li = 0; li < 6; li++) {
    var lblAngle = (Math.PI * 2 * li / 6) - Math.PI / 2;
    var lx = RADAR_CENTER + (RADAR_RADIUS + RADAR_LABEL_OFFSET) * Math.cos(lblAngle);
    var ly = RADAR_CENTER + (RADAR_RADIUS + RADAR_LABEL_OFFSET) * Math.sin(lblAngle);

    // text-anchor logic: top/bottom = middle, right side = start, left side = end
    var cosVal = Math.cos(lblAngle);
    var textAnchor;
    if (Math.abs(cosVal) < 0.1) {
      textAnchor = 'middle';
    } else if (cosVal > 0) {
      textAnchor = 'start';
    } else {
      textAnchor = 'end';
    }

    var label = document.createElementNS(RADAR_NS, 'text');
    label.setAttribute('x', lx.toFixed(2));
    label.setAttribute('y', ly.toFixed(2));
    label.setAttribute('class', 'radar-label');
    label.setAttribute('text-anchor', textAnchor);
    label.setAttribute('dominant-baseline', 'middle');
    label.textContent = HOP_AXIS_LABELS[li];
    svg.appendChild(label);
  }

  // Draw score polygon only if any score > 0
  var hasAnyScore = axisScores.some(function (s) { return s > 0; });
  if (hasAnyScore) {
    var points = axisScores.map(function (score, i) {
      var frac = score / 5;
      var angle = (Math.PI * 2 * i / 6) - Math.PI / 2;
      var x = RADAR_CENTER + RADAR_RADIUS * frac * Math.cos(angle);
      var y = RADAR_CENTER + RADAR_RADIUS * frac * Math.sin(angle);
      return x.toFixed(2) + ',' + y.toFixed(2);
    }).join(' ');
    var polygon = document.createElementNS(RADAR_NS, 'polygon');
    polygon.setAttribute('points', points);
    polygon.setAttribute('class', 'radar-fill');
    svg.appendChild(polygon);
  }

  return svg;
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

function loadHops(callback) {
  var middlewareUrl = (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.MIDDLEWARE_URL)
    ? SHEETS_CONFIG.MIDDLEWARE_URL : '';

  function loadFromSnapshot() {
    return fetch('/content/zoho-snapshot.json')
      .then(function (r) {
        if (!r.ok) throw new Error('Snapshot fetch failed: ' + r.status);
        return r.json();
      })
      .then(function (snap) {
        return (snap.ingredients || []);
      });
  }

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
      max_order_qty: z.max_order_qty || ''
    };
    // Custom field flattening — T-19-06: guard against prototype pollution
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
    return fetch(middlewareUrl + '/api/ingredients')
      .then(function (r) {
        if (!r.ok) throw new Error('Middleware returned ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var items = data.items || [];
        return items.map(mapItem);
      });
  }

  function loadFromMiddleware() {
    var cached = getCachedMW();
    if (cached) {
      var promise = Promise.resolve(cached.data);
      if (!cached.fresh) {
        fetchFromMiddleware().then(setCachedMW).catch(function () {});
      }
      return promise;
    }
    return fetchFromMiddleware().then(function (items) {
      setCachedMW(items);
      return items;
    });
  }

  function showError() {
    var catalog = document.getElementById('hops-catalog');
    if (catalog) {
      catalog.innerHTML = '';
      var errorDiv = document.createElement('div');
      errorDiv.className = 'catalog-error';
      var errorMsg = document.createElement('p');
      errorMsg.textContent = "Couldn't load hops right now. Refresh to try again.";
      var retryBtn = document.createElement('button');
      retryBtn.className = 'catalog-retry-btn btn-outline';
      retryBtn.type = 'button';
      retryBtn.textContent = 'Try again';
      retryBtn.addEventListener('click', function () {
        loadHops(callback);
      });
      errorDiv.appendChild(errorMsg);
      errorDiv.appendChild(retryBtn);
      catalog.appendChild(errorDiv);
    }
  }

  var dataPromise = middlewareUrl
    ? loadFromMiddleware().catch(function () { return loadFromSnapshot(); })
    : loadFromSnapshot();

  dataPromise
    .then(function (items) {
      _allHops = items.filter(function (r) {
        var p = parseFloat(r.price_per_unit || '0') || 0;
        if (p <= 0) return false;
        var subcat = (r.subcategory || '').toLowerCase();
        return subcat === 'hops';
      });
      _hopGroups = groupHopsByVariant(_allHops);
      if (typeof Fuse !== 'undefined') {
        _hopsFuse = new Fuse(_allHops, {
          keys: ['name', 'tasting_notes', 'description'],
          threshold: 0.35,
          minMatchCharLength: 2,
          ignoreLocation: true
        });
      }
      if (callback) callback();
    })
    .catch(function () {
      showError();
    });
}

// ---------------------------------------------------------------------------
// Filter builder
// ---------------------------------------------------------------------------

function buildHopFilterRow(containerId, field, label, values) {
  var container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  if (values.length === 0) { container.classList.add('hidden'); return; }
  container.classList.remove('hidden');

  var labelSpan = document.createElement('span');
  labelSpan.className = 'catalog-filter-label';
  labelSpan.textContent = label;
  container.appendChild(labelSpan);

  var allBtn = document.createElement('button');
  allBtn.className = 'catalog-filter-btn active';
  allBtn.type = 'button';
  allBtn.textContent = 'All';
  allBtn.setAttribute('data-value', 'All');
  allBtn.addEventListener('click', function () {
    _activeFlavorFilters = [];
    var btns = container.querySelectorAll('.catalog-filter-btn');
    btns.forEach(function (b) { b.classList.remove('active'); });
    allBtn.classList.add('active');
    renderHops();
  });
  container.appendChild(allBtn);

  values.forEach(function (val) {
    var btn = document.createElement('button');
    btn.className = 'catalog-filter-btn';
    btn.type = 'button';
    btn.textContent = val;
    btn.setAttribute('data-value', val);
    btn.addEventListener('click', function () {
      var idx = _activeFlavorFilters.indexOf(val);
      if (idx !== -1) {
        _activeFlavorFilters.splice(idx, 1);
      } else {
        _activeFlavorFilters.push(val);
      }
      var btns = container.querySelectorAll('.catalog-filter-btn');
      btns.forEach(function (b) { b.classList.remove('active'); });
      if (_activeFlavorFilters.length === 0) {
        var allBtnEl = container.querySelector('[data-value="All"]');
        if (allBtnEl) allBtnEl.classList.add('active');
      } else {
        btns.forEach(function (b) {
          if (_activeFlavorFilters.indexOf(b.getAttribute('data-value')) !== -1) {
            b.classList.add('active');
          }
        });
      }
      renderHops();
    });
    container.appendChild(btn);
  });
}

function buildHopFilters() {
  var flavors = [];
  _hopGroups.forEach(function (group) {
    var rep = group.variants[0];
    var dominant = getDominantFlavor(rep);
    if (dominant && flavors.indexOf(dominant) === -1) flavors.push(dominant);
  });
  flavors.sort();
  buildHopFilterRow('hops-filter-row', 'flavor', 'Flavor Profile:', flavors);
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

function wireHopEvents() {
  var searchInput = document.getElementById('hops-search');
  if (searchInput) {
    var timer;
    searchInput.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(renderHops, 180);
    });
  }
  var sortSelect = document.getElementById('hops-sort');
  if (sortSelect) {
    sortSelect.addEventListener('change', function () { renderHops(); });
  }
  var viewBtns = document.querySelectorAll('.hops-toolbar .view-toggle-btn');
  viewBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var view = btn.getAttribute('data-view');
      if (view === _hopsViewMode) return;
      _hopsViewMode = view;
      try { localStorage.setItem('hopsViewMode', view); } catch (e) {}
      viewBtns.forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-view') === view);
      });
      renderHops();
    });
  });
  try {
    var saved = localStorage.getItem('hopsViewMode');
    if (saved === 'table' || saved === 'cards') {
      _hopsViewMode = saved;
      viewBtns.forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-view') === saved);
      });
    }
  } catch (e) {}
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && _openPanel) {
      var toggleBtn = _openCard ? _openCard.querySelector('.notes-toggle') : null;
      closeHopPanel();
      if (toggleBtn) toggleBtn.focus();
    }
  });
  if (window.matchMedia) {
    window.matchMedia('(max-width: ' + (DESKTOP_BREAKPOINT - 1) + 'px)').addEventListener('change', function () {
      closeHopPanel();
    });
  }
}

// ---------------------------------------------------------------------------
// Card builder
// ---------------------------------------------------------------------------

function closeHopPanel() {
  if (_openPanel && _openPanel.parentNode) {
    _openPanel.parentNode.removeChild(_openPanel);
  }
  if (_openCard) {
    _openCard.classList.remove('hop-card--active');
    var btn = _openCard.querySelector('.notes-toggle');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }
  _openPanel = null;
  _openCard = null;
  _compareMode = false;
  _compareItems = [];
  var comparing = document.querySelectorAll('.hop-card--comparing');
  for (var i = 0; i < comparing.length; i++) {
    comparing[i].classList.remove('hop-card--comparing');
  }
  var activeGrid = document.querySelector('.hops-grid--compare-active');
  if (activeGrid) activeGrid.classList.remove('hops-grid--compare-active');
}

function findCardByGroupName(name) {
  var cards = document.querySelectorAll('.hop-card h2');
  for (var i = 0; i < cards.length; i++) {
    if (cards[i].textContent === name) return cards[i].closest('.hop-card');
  }
  return null;
}

function findRowEnd(card, grid) {
  var cards = grid.querySelectorAll('.product-card');
  var top = card.offsetTop;
  var last = card;
  for (var i = 0; i < cards.length; i++) {
    if (cards[i].offsetTop === top) last = cards[i];
  }
  return last;
}

function getRowHeight(card, grid) {
  var cards = grid.querySelectorAll('.product-card');
  var top = card.offsetTop;
  var maxH = 0;
  for (var i = 0; i < cards.length; i++) {
    if (cards[i].offsetTop === top && cards[i].offsetHeight > maxH) {
      maxH = cards[i].offsetHeight;
    }
  }
  return maxH;
}

function buildCompareColumn(group, variant, removable) {
  var col = document.createElement('div');
  col.className = 'hop-compare-column';

  var header = document.createElement('div');
  header.className = 'hop-compare-col-header';
  var nameEl = document.createElement('strong');
  nameEl.textContent = group.name;
  header.appendChild(nameEl);
  if (removable) {
    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'hop-compare-remove';
    removeBtn.setAttribute('aria-label', 'Remove ' + group.name);
    removeBtn.innerHTML = '&times;';
    removeBtn.addEventListener('click', function () {
      for (var i = 0; i < _compareItems.length; i++) {
        if (_compareItems[i].group.name === group.name) {
          _compareItems.splice(i, 1);
          break;
        }
      }
      var card = findCardByGroupName(group.name);
      if (card) card.classList.remove('hop-card--comparing');
      if (_compareItems.length === 0) {
        closeHopPanel();
      } else {
        openComparePanel();
      }
    });
    header.appendChild(removeBtn);
  }
  col.appendChild(header);

  // Radar
  var radarRow = document.createElement('div');
  radarRow.className = 'hop-compare-row hop-compare-row--radar';
  var radarWrap = document.createElement('div');
  radarWrap.className = 'hop-radar-wrap';
  var hasScore = HOP_AXES.some(function (a) { return parseFloat(variant[a] || 0) > 0; });
  if (hasScore) {
    radarWrap.appendChild(buildHopRadarChart(variant));
  } else {
    var ph = document.createElement('div');
    ph.className = 'hop-radar-placeholder';
    ph.textContent = 'No data';
    radarWrap.appendChild(ph);
  }
  radarRow.appendChild(radarWrap);
  col.appendChild(radarRow);

  // Alpha acid
  var alphaRow = document.createElement('div');
  alphaRow.className = 'hop-compare-row hop-compare-row--specs';
  alphaRow.textContent = variant.alpha_acid || '-';
  col.appendChild(alphaRow);

  // Origin
  var originRow = document.createElement('div');
  originRow.className = 'hop-compare-row hop-compare-row--specs';
  originRow.textContent = variant.origin || '-';
  col.appendChild(originRow);

  // Tasting notes
  var tnRow = document.createElement('div');
  tnRow.className = 'hop-compare-row hop-compare-row--specs';
  tnRow.textContent = variant.tasting_notes || '-';
  col.appendChild(tnRow);

  // Description
  var descRow = document.createElement('div');
  descRow.className = 'hop-compare-row hop-compare-row--desc';
  var descText = variant.sales_description || variant.description || '';
  if (descText.length > 200) descText = descText.substring(0, 200) + '...';
  descRow.textContent = descText || '-';
  col.appendChild(descRow);

  // Price + size toggle + cart
  var cartRow = document.createElement('div');
  cartRow.className = 'hop-compare-row hop-compare-row--cart';

  var priceSpan = document.createElement('span');
  priceSpan.className = 'hop-price';
  priceSpan.textContent = formatCurrency(variant.price_per_unit || 0);
  cartRow.appendChild(priceSpan);

  if (group.variants.length >= 2) {
    var sizeGroup = document.createElement('div');
    sizeGroup.className = 'hop-size-toggle-group';
    sizeGroup.setAttribute('role', 'group');
    sizeGroup.setAttribute('aria-label', 'Select size');
    var currentIdx = group.variants.indexOf(variant);
    group.variants.forEach(function (v, idx) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hop-size-btn' + (idx === currentIdx ? ' active' : '');
      btn.setAttribute('aria-pressed', idx === currentIdx ? 'true' : 'false');
      var m = (v.name || '').match(/\s*[-–]\s*(\d+\s*(?:oz|g))\s*$/i);
      btn.textContent = m ? m[1] : v.name;
      btn.addEventListener('click', (function (ci, cv) {
        return function () {
          var all = sizeGroup.querySelectorAll('.hop-size-btn');
          all.forEach(function (b, bi) {
            b.classList.toggle('active', bi === ci);
            b.setAttribute('aria-pressed', bi === ci ? 'true' : 'false');
          });
          priceSpan.textContent = formatCurrency(cv.price_per_unit || 0);
          var cart = buildHopCartObject(cv);
          var key = cv.name + '|';
          var ren = (typeof hasWeightConfig !== 'undefined' && hasWeightConfig(cv))
            ? renderWeightControl : renderReserveControl;
          reserveWrap._reserveProduct = cart;
          reserveWrap._reserveKey = key;
          reserveWrap._reserveRenderer = ren;
          ren(reserveWrap, cart, key);
          // Update the stored variant for this compare item
          for (var j = 0; j < _compareItems.length; j++) {
            if (_compareItems[j].group.name === group.name) {
              _compareItems[j].variant = cv;
              break;
            }
          }
        };
      })(idx, v));
      sizeGroup.appendChild(btn);
    });
    cartRow.appendChild(sizeGroup);
  }

  var reserveWrap = document.createElement('div');
  reserveWrap.className = 'product-reserve-wrap';
  var hopForCart = buildHopCartObject(variant);
  var productKey = variant.name + '|';
  var renderer = (typeof hasWeightConfig !== 'undefined' && hasWeightConfig(variant))
    ? renderWeightControl : renderReserveControl;
  reserveWrap._reserveProduct = hopForCart;
  reserveWrap._reserveKey = productKey;
  reserveWrap._reserveRenderer = renderer;
  renderer(reserveWrap, hopForCart, productKey);
  cartRow.appendChild(reserveWrap);

  col.appendChild(cartRow);
  return col;
}

function buildComparePanel() {
  var panel = document.createElement('div');
  panel.className = 'hop-detail-panel hop-compare-panel';

  var close = document.createElement('button');
  close.type = 'button';
  close.className = 'hop-panel-close';
  close.setAttribute('aria-label', 'Close comparison');
  close.innerHTML = '&times;';
  close.addEventListener('click', closeHopPanel);
  panel.appendChild(close);

  var header = document.createElement('div');
  header.className = 'hop-compare-header';
  var title = document.createElement('h3');
  title.textContent = _compareItems.length + ' hop' + (_compareItems.length !== 1 ? 's' : '') + ' selected (max 3)';
  title.setAttribute('aria-live', 'polite');
  header.appendChild(title);
  var clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'hop-compare-clear';
  clearBtn.textContent = 'Clear comparison';
  clearBtn.addEventListener('click', closeHopPanel);
  header.appendChild(clearBtn);
  if (_compareItems.length < 3) {
    var hint = document.createElement('span');
    hint.className = 'hop-compare-hint';
    hint.textContent = 'Click "Hop Details" on any card to add it';
    header.appendChild(hint);
  }
  panel.appendChild(header);

  var usedNames = {};
  for (var u = 0; u < _compareItems.length; u++) {
    usedNames[_compareItems[u].group.name] = true;
  }

  var table = document.createElement('table');
  table.className = 'hop-compare-table';
  table.setAttribute('role', 'table');
  table.setAttribute('aria-label', 'Hop comparison');

  var rowDefs = [
    { label: '', key: 'header' },
    { label: 'Sensory Profile', key: 'radar' },
    { label: 'Alpha Acid', key: 'alpha' },
    { label: 'Origin', key: 'origin' },
    { label: 'Flavour Profile', key: 'tasting' },
    { label: 'Description', key: 'desc' },
    { label: 'Price & Cart', key: 'cart' }
  ];

  rowDefs.forEach(function (def) {
    var tr = document.createElement('tr');
    tr.className = 'hop-compare-tr hop-compare-tr--' + def.key;
    var th = document.createElement('th');
    th.className = 'hop-compare-th';
    th.textContent = def.label;
    th.setAttribute('scope', 'row');
    tr.appendChild(th);

    for (var i = 0; i < 3; i++) {
      var td = document.createElement('td');
      td.className = 'hop-compare-td';
      if (i < _compareItems.length) {
        td.appendChild(buildCompareCellContent(def.key, _compareItems[i].group, _compareItems[i].variant));
      } else if (def.key === 'header') {
        td.appendChild(buildCompareSlotDropdown(usedNames));
      } else {
        td.innerHTML = '<span class="hop-compare-empty-cell">&mdash;</span>';
      }
      tr.appendChild(td);
    }
    table.appendChild(tr);
  });

  panel.appendChild(table);
  return panel;
}

function buildCompareCellContent(key, group, variant) {
  var frag = document.createDocumentFragment();

  if (key === 'header') {
    var nameEl = document.createElement('strong');
    nameEl.textContent = group.name;
    frag.appendChild(nameEl);
    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'hop-compare-remove';
    removeBtn.setAttribute('aria-label', 'Remove ' + group.name);
    removeBtn.innerHTML = '&times;';
    removeBtn.addEventListener('click', function () {
      for (var i = 0; i < _compareItems.length; i++) {
        if (_compareItems[i].group.name === group.name) {
          _compareItems.splice(i, 1);
          break;
        }
      }
      var card = findCardByGroupName(group.name);
      if (card) card.classList.remove('hop-card--comparing');
      if (_compareItems.length === 0) { closeHopPanel(); } else { openComparePanel(); }
    });
    frag.appendChild(removeBtn);
  } else if (key === 'radar') {
    var radarWrap = document.createElement('div');
    radarWrap.className = 'hop-radar-wrap';
    var hasScore = HOP_AXES.some(function (a) { return parseFloat(variant[a] || 0) > 0; });
    if (hasScore) {
      radarWrap.appendChild(buildHopRadarChart(variant));
    } else {
      var ph = document.createElement('span');
      ph.className = 'hop-radar-placeholder';
      ph.textContent = 'No data';
      radarWrap.appendChild(ph);
    }
    frag.appendChild(radarWrap);
  } else if (key === 'alpha') {
    frag.appendChild(document.createTextNode(variant.alpha_acid || '-'));
  } else if (key === 'origin') {
    frag.appendChild(document.createTextNode(variant.origin || '-'));
  } else if (key === 'tasting') {
    frag.appendChild(document.createTextNode(variant.tasting_notes || '-'));
  } else if (key === 'desc') {
    var descText = variant.sales_description || variant.description || '-';
    var descWrap = document.createElement('div');
    descWrap.className = 'hop-compare-desc-wrap';
    var descP = document.createElement('p');
    descP.className = 'hop-compare-desc-text';
    descP.textContent = descText;
    descWrap.appendChild(descP);
    if (descText.length > 120) {
      var readMore = document.createElement('button');
      readMore.type = 'button';
      readMore.className = 'hop-compare-read-more';
      readMore.textContent = 'Read more';
      readMore.addEventListener('click', function () {
        var popup = descWrap.querySelector('.hop-compare-desc-popup');
        if (popup) {
          popup.parentNode.removeChild(popup);
          readMore.textContent = 'Read more';
          return;
        }
        popup = document.createElement('div');
        popup.className = 'hop-compare-desc-popup';
        popup.textContent = descText;
        var closePopup = document.createElement('button');
        closePopup.type = 'button';
        closePopup.className = 'hop-compare-popup-close';
        closePopup.setAttribute('aria-label', 'Close');
        closePopup.innerHTML = '&times;';
        closePopup.addEventListener('click', function () {
          popup.parentNode.removeChild(popup);
          readMore.textContent = 'Read more';
        });
        popup.appendChild(closePopup);
        descWrap.appendChild(popup);
        readMore.textContent = 'Read less';
      });
      descWrap.appendChild(readMore);
    }
    frag.appendChild(descWrap);
  } else if (key === 'cart') {
    var priceSpan = document.createElement('span');
    priceSpan.className = 'hop-price';
    priceSpan.textContent = formatCurrency(variant.price_per_unit || 0);
    frag.appendChild(priceSpan);

    if (group.variants.length >= 2) {
      var sizeGroup = document.createElement('div');
      sizeGroup.className = 'hop-size-toggle-group';
      sizeGroup.setAttribute('role', 'group');
      sizeGroup.setAttribute('aria-label', 'Select size');
      var currentIdx = group.variants.indexOf(variant);
      group.variants.forEach(function (v, idx) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'hop-size-btn' + (idx === currentIdx ? ' active' : '');
        btn.setAttribute('aria-pressed', idx === currentIdx ? 'true' : 'false');
        var m = (v.name || '').match(/\s*[-–]\s*(\d+\s*(?:oz|g))\s*$/i);
        btn.textContent = m ? m[1] : v.name;
        btn.addEventListener('click', (function (ci, cv) {
          return function () {
            var all = sizeGroup.querySelectorAll('.hop-size-btn');
            all.forEach(function (b, bi) {
              b.classList.toggle('active', bi === ci);
              b.setAttribute('aria-pressed', bi === ci ? 'true' : 'false');
            });
            priceSpan.textContent = formatCurrency(cv.price_per_unit || 0);
            var cart = buildHopCartObject(cv);
            var pkey = cv.name + '|';
            var ren = (typeof hasWeightConfig !== 'undefined' && hasWeightConfig(cv))
              ? renderWeightControl : renderReserveControl;
            reserveWrap._reserveProduct = cart;
            reserveWrap._reserveKey = pkey;
            reserveWrap._reserveRenderer = ren;
            ren(reserveWrap, cart, pkey);
            for (var j = 0; j < _compareItems.length; j++) {
              if (_compareItems[j].group.name === group.name) {
                _compareItems[j].variant = cv;
                break;
              }
            }
          };
        })(idx, v));
        sizeGroup.appendChild(btn);
      });
      frag.appendChild(sizeGroup);
    }

    var reserveWrap = document.createElement('div');
    reserveWrap.className = 'product-reserve-wrap';
    var hopForCart = buildHopCartObject(variant);
    var productKey = variant.name + '|';
    var renderer = (typeof hasWeightConfig !== 'undefined' && hasWeightConfig(variant))
      ? renderWeightControl : renderReserveControl;
    reserveWrap._reserveProduct = hopForCart;
    reserveWrap._reserveKey = productKey;
    reserveWrap._reserveRenderer = renderer;
    renderer(reserveWrap, hopForCart, productKey);
    frag.appendChild(reserveWrap);
  }

  return frag;
}

function buildCompareSlotDropdown(usedNames) {
  var slot = document.createElement('div');
  slot.className = 'hop-compare-slot-empty';

  var selectId = 'compare-slot-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4);
  var label = document.createElement('label');
  label.className = 'hop-compare-select-label';
  label.textContent = 'Add a hop:';
  label.setAttribute('for', selectId);
  slot.appendChild(label);

  var select = document.createElement('select');
  select.className = 'hop-compare-select';
  select.id = selectId;

  var defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = 'Select a hop...';
  select.appendChild(defaultOpt);

  _hopGroups.forEach(function (group) {
    if (usedNames[group.name]) return;
    var opt = document.createElement('option');
    opt.value = group.name;
    opt.textContent = group.name;
    select.appendChild(opt);
  });

  select.addEventListener('change', function () {
    var name = select.value;
    if (!name) return;
    for (var g = 0; g < _hopGroups.length; g++) {
      if (_hopGroups[g].name === name) {
        _compareItems.push({ group: _hopGroups[g], variant: _hopGroups[g].variants[0] });
        openComparePanel();
        break;
      }
    }
  });

  slot.appendChild(select);
  return slot;
}

function openComparePanel() {
  if (_openPanel && _openPanel.parentNode) {
    _openPanel.parentNode.removeChild(_openPanel);
  }
  if (_compareItems.length === 0) return;

  var firstCard = findCardByGroupName(_compareItems[0].group.name);
  if (!firstCard) return;

  var grid = firstCard.parentNode;
  var rowEnd = findRowEnd(firstCard, grid);
  var rowHeight = getRowHeight(firstCard, grid);
  var gap = parseFloat(getComputedStyle(grid).rowGap) || 0;

  var panel = buildComparePanel();
  panel.style.marginTop = '-' + (rowHeight + gap) + 'px';
  panel.style.minHeight = rowHeight + 'px';
  rowEnd.parentNode.insertBefore(panel, rowEnd.nextSibling);
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  var closeBtn = panel.querySelector('.hop-panel-close');
  if (closeBtn) closeBtn.focus();

  grid.classList.add('hops-grid--compare-active');
  _openPanel = panel;
  _openCard = firstCard;
}

function buildDetailPanel(group, variant) {
  var panel = document.createElement('div');
  panel.className = 'hop-detail-panel';

  var close = document.createElement('button');
  close.type = 'button';
  close.className = 'hop-panel-close';
  close.setAttribute('aria-label', 'Close details');
  close.innerHTML = '&times;';
  close.addEventListener('click', closeHopPanel);
  panel.appendChild(close);

  var inner = document.createElement('div');
  inner.className = 'hop-panel-inner';

  // Left: radar chart
  var left = document.createElement('div');
  left.className = 'hop-panel-left';
  var radarWrap = document.createElement('div');
  radarWrap.className = 'hop-radar-wrap';
  var hasAnyScore = HOP_AXES.some(function (axis) {
    return parseFloat(variant[axis] || 0) > 0;
  });
  if (hasAnyScore) {
    radarWrap.appendChild(buildHopRadarChart(variant));
  } else {
    var placeholder = document.createElement('div');
    placeholder.className = 'hop-radar-placeholder';
    placeholder.textContent = 'Sensory data coming soon';
    radarWrap.appendChild(placeholder);
  }
  left.appendChild(radarWrap);

  // Tasting notes (flavor keywords) below radar
  var tastingNotes = variant.tasting_notes || '';
  if (tastingNotes) {
    var tnP = document.createElement('p');
    tnP.className = 'hop-tasting-notes';
    tnP.textContent = tastingNotes;
    left.appendChild(tnP);
  }

  inner.appendChild(left);

  // Center: specs + description
  var center = document.createElement('div');
  center.className = 'hop-panel-center';

  var panelHeading = document.createElement('h3');
  panelHeading.className = 'hop-panel-name';
  panelHeading.textContent = group.name;
  center.appendChild(panelHeading);

  var alphaVal = variant.alpha_acid || '';
  if (alphaVal) {
    var specsDiv = document.createElement('div');
    specsDiv.className = 'hop-specs';
    specsDiv.textContent = 'Alpha Acid: ' + (alphaVal.indexOf('%') !== -1 ? alphaVal : alphaVal + '%');
    center.appendChild(specsDiv);
  }

  if (variant.origin) {
    var originP = document.createElement('p');
    originP.className = 'hop-origin';
    originP.textContent = 'Origin: ' + variant.origin;
    center.appendChild(originP);
  }

  var hopNotes = variant.sales_description || variant.description || '';
  if (hopNotes) {
    var notesP = document.createElement('p');
    notesP.className = 'hop-notes';
    notesP.textContent = hopNotes;
    center.appendChild(notesP);
  }

  inner.appendChild(center);

  // Right: size toggle + cart
  var right = document.createElement('div');
  right.className = 'hop-panel-right';

  var priceSpan = document.createElement('span');
  priceSpan.className = 'hop-price';
  priceSpan.textContent = formatCurrency(variant.price_per_unit || 0);
  right.appendChild(priceSpan);

  var reserveWrap = document.createElement('div');
  reserveWrap.className = 'product-reserve-wrap';
  var hopForCart = buildHopCartObject(variant);
  var productKey = variant.name + '|';
  var renderer = (typeof hasWeightConfig !== 'undefined' && hasWeightConfig(variant))
    ? renderWeightControl : renderReserveControl;
  reserveWrap._reserveProduct = hopForCart;
  reserveWrap._reserveKey = productKey;
  reserveWrap._reserveRenderer = renderer;
  renderer(reserveWrap, hopForCart, productKey);

  if (group.variants.length >= 2) {
    var hopSizeToggleGroup = document.createElement('div');
    hopSizeToggleGroup.className = 'hop-size-toggle-group';
    group.variants.forEach(function (v, idx) {
      var sizeBtn = document.createElement('button');
      sizeBtn.type = 'button';
      sizeBtn.className = 'hop-size-btn' + (idx === 0 ? ' active' : '');
      sizeBtn.setAttribute('aria-pressed', idx === 0 ? 'true' : 'false');
      var sizeMatch = (v.name || '').match(/\s*[-–]\s*(\d+\s*(?:oz|g))\s*$/i);
      sizeBtn.textContent = sizeMatch ? sizeMatch[1] : v.name;
      sizeBtn.addEventListener('click', (function (clickedIdx, clickedVariant) {
        return function () {
          var allSizeBtns = hopSizeToggleGroup.querySelectorAll('.hop-size-btn');
          allSizeBtns.forEach(function (b, bi) {
            b.classList.toggle('active', bi === clickedIdx);
            b.setAttribute('aria-pressed', bi === clickedIdx ? 'true' : 'false');
          });
          priceSpan.textContent = formatCurrency(clickedVariant.price_per_unit || 0);
          var newHopForCart = buildHopCartObject(clickedVariant);
          var newProductKey = clickedVariant.name + '|';
          var newRenderer = (typeof hasWeightConfig !== 'undefined' && hasWeightConfig(clickedVariant))
            ? renderWeightControl : renderReserveControl;
          reserveWrap._reserveProduct = newHopForCart;
          reserveWrap._reserveKey = newProductKey;
          reserveWrap._reserveRenderer = newRenderer;
          newRenderer(reserveWrap, newHopForCart, newProductKey);
        };
      })(idx, v));
      hopSizeToggleGroup.appendChild(sizeBtn);
    });
    right.appendChild(hopSizeToggleGroup);
  }

  right.appendChild(reserveWrap);

  if (_hopGroups.length >= 2) {
    var compareBtn = document.createElement('button');
    compareBtn.type = 'button';
    compareBtn.className = 'hop-compare-btn';
    compareBtn.textContent = 'Compare Hops';
    compareBtn.addEventListener('click', function () {
      _compareMode = true;
      _compareItems = [{ group: group, variant: variant }];
      var card = findCardByGroupName(group.name);
      if (card) {
        card.classList.remove('hop-card--active');
        card.classList.add('hop-card--comparing');
      }
      if (_openCard) {
        _openCard.classList.remove('hop-card--active');
        var oldBtn = _openCard.querySelector('.notes-toggle');
        if (oldBtn) oldBtn.setAttribute('aria-expanded', 'false');
      }
      openComparePanel();
    });
    right.appendChild(compareBtn);
  }

  inner.appendChild(right);

  panel.appendChild(inner);
  return panel;
}

function buildHopCard(group) {
  var card = document.createElement('div');
  card.className = 'product-card hop-card';

  var selectedVariantIdx = 0;
  var variant = group.variants[selectedVariantIdx];

  var heading = document.createElement('h2');
  heading.textContent = group.name;
  card.appendChild(heading);

  var alphaEl = document.createElement('span');
  alphaEl.className = 'hop-alpha';
  var alphaVal = variant.alpha_acid || '';
  if (alphaVal) {
    var alphaDisplay = alphaVal.indexOf('%') !== -1 ? alphaVal : alphaVal + '%';
    alphaEl.textContent = 'Alpha Acid: ' + alphaDisplay;
    card.appendChild(alphaEl);
  }

  var tagsDiv = document.createElement('div');
  tagsDiv.className = 'hop-flavor-tags';
  var topTags = getTopFlavorTags(variant, 3);
  topTags.forEach(function (tag) {
    var tagSpan = document.createElement('span');
    tagSpan.className = 'hop-flavor-tag';
    tagSpan.textContent = tag.label;
    tagsDiv.appendChild(tagSpan);
  });
  card.appendChild(tagsDiv);

  var priceRow = document.createElement('div');
  priceRow.className = 'product-detail-row';
  var priceSpan = document.createElement('span');
  priceSpan.className = 'hop-price';
  priceSpan.textContent = formatCurrency(variant.price_per_unit || 0);
  priceRow.appendChild(priceSpan);
  card.appendChild(priceRow);

  // Size toggle (only if 2+ variants) — above details toggle for purchase flow
  var hopSizeToggleGroup = null;
  var reserveWrap = document.createElement('div');
  reserveWrap.className = 'product-reserve-wrap';
  var hopForCart = buildHopCartObject(variant);
  var productKey = variant.name + '|';
  var renderer = (typeof hasWeightConfig !== 'undefined' && hasWeightConfig(variant))
    ? renderWeightControl : renderReserveControl;
  reserveWrap._reserveProduct = hopForCart;
  reserveWrap._reserveKey = productKey;
  reserveWrap._reserveRenderer = renderer;
  renderer(reserveWrap, hopForCart, productKey);

  if (group.variants.length >= 2) {
    hopSizeToggleGroup = document.createElement('div');
    hopSizeToggleGroup.className = 'hop-size-toggle-group';
    hopSizeToggleGroup.setAttribute('role', 'group');
    hopSizeToggleGroup.setAttribute('aria-label', 'Select size');
    group.variants.forEach(function (v, idx) {
      var sizeBtn = document.createElement('button');
      sizeBtn.type = 'button';
      sizeBtn.className = 'hop-size-btn' + (idx === 0 ? ' active' : '');
      sizeBtn.setAttribute('aria-pressed', idx === 0 ? 'true' : 'false');
      var sizeMatch = (v.name || '').match(/\s*[-–]\s*(\d+\s*(?:oz|g))\s*$/i);
      sizeBtn.textContent = sizeMatch ? sizeMatch[1] : v.name;
      sizeBtn.addEventListener('click', (function (clickedIdx, clickedVariant) {
        return function () {
          selectedVariantIdx = clickedIdx;
          var allSizeBtns = hopSizeToggleGroup.querySelectorAll('.hop-size-btn');
          allSizeBtns.forEach(function (b, bi) {
            b.classList.toggle('active', bi === clickedIdx);
            b.setAttribute('aria-pressed', bi === clickedIdx ? 'true' : 'false');
          });
          priceSpan.textContent = formatCurrency(clickedVariant.price_per_unit || 0);
          var newHopForCart = buildHopCartObject(clickedVariant);
          var newProductKey = clickedVariant.name + '|';
          var newRenderer = (typeof hasWeightConfig !== 'undefined' && hasWeightConfig(clickedVariant))
            ? renderWeightControl : renderReserveControl;
          reserveWrap._reserveProduct = newHopForCart;
          reserveWrap._reserveKey = newProductKey;
          reserveWrap._reserveRenderer = newRenderer;
          newRenderer(reserveWrap, newHopForCart, newProductKey);
        };
      })(idx, v));
      hopSizeToggleGroup.appendChild(sizeBtn);
    });
    card.appendChild(hopSizeToggleGroup);
  }

  card.appendChild(reserveWrap);

  // Toggle button — after cart controls
  var toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'notes-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.innerHTML = 'Hop Details <span class="chevron">&#9660;</span>';

  toggle.addEventListener('click', (function (c, g, getVariant, t) {
    return function () {
      var v = getVariant();
      var isDesktop = window.innerWidth >= DESKTOP_BREAKPOINT;

      if (_compareMode && isDesktop) {
        if (_compareBusy) return;
        _compareBusy = true;
        var groupName = g.name;
        var existingIdx = -1;
        for (var ci = 0; ci < _compareItems.length; ci++) {
          if (_compareItems[ci].group.name === groupName) { existingIdx = ci; break; }
        }
        if (existingIdx !== -1) {
          _compareItems.splice(existingIdx, 1);
          c.classList.remove('hop-card--comparing');
          if (_compareItems.length === 0) { closeHopPanel(); } else { openComparePanel(); }
        } else if (_compareItems.length < 3) {
          _compareItems.push({ group: g, variant: v });
          c.classList.add('hop-card--comparing');
          openComparePanel();
        }
        _compareBusy = false;
        return;
      }

      if (isDesktop) {
        if (_openCard === c) {
          closeHopPanel();
          return;
        }
        closeHopPanel();
        c.classList.add('hop-card--active');
        t.setAttribute('aria-expanded', 'true');
        var grid = c.parentNode;
        var rowEnd = findRowEnd(c, grid);
        var rowHeight = getRowHeight(c, grid);
        var gap = parseFloat(getComputedStyle(grid).rowGap) || 0;
        var panel = buildDetailPanel(g, v);
        panel.style.marginTop = '-' + (rowHeight + gap) + 'px';
        panel.style.minHeight = rowHeight + 'px';
        rowEnd.parentNode.insertBefore(panel, rowEnd.nextSibling);
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        var closeBtn = panel.querySelector('.hop-panel-close');
        if (closeBtn) closeBtn.focus();
        _openPanel = panel;
        _openCard = c;
        if (typeof trackEvent !== 'undefined') {
          trackEvent('detail', v.sku || '', v.name || '');
        }
      } else {
        // Mobile: rebuild accordion with current variant
        var notesBody = c.querySelector('.hop-notes-body');
        if (notesBody) notesBody.parentNode.removeChild(notesBody);
        notesBody = buildMobileDetail(g, v);
        c.insertBefore(notesBody, t.nextSibling);
        notesBody.style.maxHeight = notesBody.scrollHeight + 'px';
        t.setAttribute('aria-expanded', 'true');
        notesBody.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    };
  })(card, group, function () { return group.variants[selectedVariantIdx]; }, toggle));

  card.appendChild(toggle);

  // Inject product schema for default variant
  if (typeof injectProductSchema !== 'undefined') {
    injectProductSchema(variant, 'ingredient');
  }

  return card;
}

function buildMobileDetail(group, variant) {
  var body = document.createElement('div');
  body.className = 'notes-body hop-notes-body';
  body.style.maxHeight = '0px';
  body.style.overflow = 'hidden';
  body.style.transition = 'max-height 0.3s ease';

  var detail = document.createElement('div');
  detail.className = 'hop-detail';

  var radarWrap = document.createElement('div');
  radarWrap.className = 'hop-radar-wrap';
  var hasAnyScore = HOP_AXES.some(function (axis) {
    return parseFloat(variant[axis] || 0) > 0;
  });
  if (hasAnyScore) {
    radarWrap.appendChild(buildHopRadarChart(variant));
  } else {
    var placeholder = document.createElement('div');
    placeholder.className = 'hop-radar-placeholder';
    placeholder.textContent = 'Sensory data coming soon';
    radarWrap.appendChild(placeholder);
  }
  detail.appendChild(radarWrap);

  var alphaVal = variant.alpha_acid || '';
  if (alphaVal) {
    var specsDiv = document.createElement('div');
    specsDiv.className = 'hop-specs';
    specsDiv.textContent = 'Alpha Acid: ' + (alphaVal.indexOf('%') !== -1 ? alphaVal : alphaVal + '%');
    detail.appendChild(specsDiv);
  }

  if (variant.origin) {
    var originP = document.createElement('p');
    originP.className = 'hop-origin';
    originP.textContent = 'Origin: ' + variant.origin;
    detail.appendChild(originP);
  }

  var hopNotes = variant.sales_description || variant.description || '';
  if (hopNotes) {
    var notesP = document.createElement('p');
    notesP.className = 'hop-notes';
    notesP.textContent = hopNotes;
    detail.appendChild(notesP);
  }

  body.appendChild(detail);
  return body;
}

function buildHopCartObject(item) {
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
    millable: '',
    tax_percentage: item.tax_percentage != null ? item.tax_percentage : 0,
    tax_name: item.tax_name || ''
  };
}

function groupInStock(group) {
  return group.variants.some(function (v) { return (parseInt(v.stock, 10) || 0) > 0; });
}

function buildHopTable(groups) {
  var sortSelect = document.getElementById('hops-sort');
  var currentSort = sortSelect ? sortSelect.value : 'name-asc';

  var table = document.createElement('table');
  table.className = 'catalog-table hops-table';
  var thead = document.createElement('thead');
  var cols = [
    { label: 'Name', sort: 'name' },
    { label: 'Alpha Acid', sort: 'alpha' },
    { label: 'Flavour', sort: null },
    { label: 'Origin', sort: null },
    { label: 'Price', sort: 'price' },
    { label: '', sort: null }
  ];
  var headerRow = document.createElement('tr');
  cols.forEach(function (col) {
    var th = document.createElement('th');
    th.textContent = col.label;
    if (col.label === 'Price') th.style.textAlign = 'right';
    if (col.sort) {
      th.setAttribute('data-sort', col.sort);
      var arrow = document.createElement('span');
      arrow.className = 'sort-arrow';
      var sortBase = currentSort.replace(/-asc$|-desc$/, '');
      var sortKey = col.sort === 'alpha' ? 'alpha' : col.sort;
      if (sortBase === sortKey) {
        th.classList.add('sort-active');
        arrow.textContent = currentSort.indexOf('-desc') !== -1 ? '▼' : '▲';
      } else {
        arrow.textContent = '▲';
      }
      th.appendChild(arrow);
      th.addEventListener('click', (function (sk) {
        return function () {
          var sel = document.getElementById('hops-sort');
          if (!sel) return;
          var cur = sel.value;
          var base = cur.replace(/-asc$|-desc$/, '');
          var mapped = sk === 'alpha' ? 'alpha-desc' : sk + '-asc';
          if (base === sk) {
            sel.value = sk + (cur.indexOf('-asc') !== -1 ? '-desc' : '-asc');
          } else {
            sel.value = mapped;
          }
          renderHops();
        };
      })(col.sort));
    }
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  var tbody = document.createElement('tbody');
  groups.forEach(function (group) {
    var variant = group.variants[0];
    var inStock = groupInStock(group);
    var tr = document.createElement('tr');
    if (!inStock) tr.className = 'hop-row--oos';

    var tdName = document.createElement('td');
    tdName.setAttribute('data-label', 'Name');
    tdName.className = 'table-name';
    tdName.textContent = group.name;
    if (!inStock) {
      var oosBadge = document.createElement('span');
      oosBadge.className = 'hop-oos-badge';
      oosBadge.textContent = 'Out of Stock';
      tdName.appendChild(oosBadge);
    }
    tr.appendChild(tdName);

    var tdAlpha = document.createElement('td');
    tdAlpha.setAttribute('data-label', 'Alpha Acid');
    var aVal = variant.alpha_acid || '';
    tdAlpha.textContent = aVal ? (aVal.indexOf('%') !== -1 ? aVal : aVal + '%') : '-';
    tr.appendChild(tdAlpha);

    var tdFlavor = document.createElement('td');
    tdFlavor.setAttribute('data-label', 'Flavour');
    var tags = getTopFlavorTags(variant, 3);
    tdFlavor.textContent = tags.map(function (t) { return t.label; }).join(', ') || '-';
    tr.appendChild(tdFlavor);

    var tdOrigin = document.createElement('td');
    tdOrigin.setAttribute('data-label', 'Origin');
    tdOrigin.textContent = variant.origin || '-';
    tr.appendChild(tdOrigin);

    var tdPrice = document.createElement('td');
    tdPrice.setAttribute('data-label', 'Price');
    tdPrice.textContent = formatCurrency(variant.price_per_unit || 0);
    if (group.variants.length > 1) {
      var fromSpan = document.createElement('span');
      fromSpan.className = 'hop-price-from';
      fromSpan.textContent = '+';
      tdPrice.appendChild(fromSpan);
    }
    tr.appendChild(tdPrice);

    var tdCart = document.createElement('td');
    tdCart.setAttribute('data-label', '');
    var cartObj = buildHopCartObject(variant);
    var cartKey = variant.name + '|';
    var cartWrap = document.createElement('div');
    cartWrap.className = 'product-reserve-wrap';
    var ren = (typeof hasWeightConfig !== 'undefined' && hasWeightConfig(variant))
      ? (typeof renderWeightControlCompact !== 'undefined' ? renderWeightControlCompact : renderWeightControl)
      : renderReserveControl;
    cartWrap._reserveProduct = cartObj;
    cartWrap._reserveKey = cartKey;
    cartWrap._reserveRenderer = ren;
    ren(cartWrap, cartObj, cartKey);
    tdCart.appendChild(cartWrap);
    tr.appendChild(tdCart);

    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

// ---------------------------------------------------------------------------
// Main render function
// ---------------------------------------------------------------------------

function renderHops() {
  closeHopPanel();
  var catalog = document.getElementById('hops-catalog');
  if (!catalog) return;

  var searchInput = document.getElementById('hops-search');
  var query = searchInput ? searchInput.value.trim() : '';

  var sortSelect = document.getElementById('hops-sort');
  var sortVal = sortSelect ? sortSelect.value : 'name-asc';

  // Start with all hop groups
  var filtered = _hopGroups.slice();

  // Filter by flavor
  if (_activeFlavorFilters.length > 0) {
    filtered = filtered.filter(function (group) {
      var dominant = getDominantFlavor(group.variants[0]);
      return dominant && _activeFlavorFilters.indexOf(dominant) !== -1;
    });
  }

  // Filter by search
  if (query && _hopsFuse) {
    var fuseResults = _hopsFuse.search(query);
    var matchingNames = {};
    fuseResults.forEach(function (r) {
      matchingNames[(r.item || r).name] = true;
    });
    filtered = filtered.filter(function (group) {
      return group.variants.some(function (v) { return matchingNames[v.name]; });
    });
  } else if (query) {
    var q = query.toLowerCase();
    filtered = filtered.filter(function (group) {
      return group.variants.some(function (v) {
        return (v.name || '').toLowerCase().indexOf(q) !== -1 ||
               (v.description || '').toLowerCase().indexOf(q) !== -1;
      });
    });
  }

  // Sort — in-stock first, then by selected criterion
  filtered.sort(function (a, b) {
    var aStock = groupInStock(a) ? 0 : 1;
    var bStock = groupInStock(b) ? 0 : 1;
    if (aStock !== bStock) return aStock - bStock;

    var av = a.variants[0];
    var bv = b.variants[0];
    switch (sortVal) {
      case 'name-asc':
        return (a.name || '').localeCompare(b.name || '');
      case 'name-desc':
        return (b.name || '').localeCompare(a.name || '');
      case 'alpha-desc':
        var aAlpha = parseFloat(((av.alpha_acid || '0').match(/[\d.]+/) || ['0'])[0]) || 0;
        var bAlpha = parseFloat(((bv.alpha_acid || '0').match(/[\d.]+/) || ['0'])[0]) || 0;
        return bAlpha - aAlpha;
      case 'alpha-asc':
        var aAlphaA = parseFloat(((av.alpha_acid || '0').match(/[\d.]+/) || ['0'])[0]) || 0;
        var bAlphaA = parseFloat(((bv.alpha_acid || '0').match(/[\d.]+/) || ['0'])[0]) || 0;
        return aAlphaA - bAlphaA;
      case 'price-asc':
        return (parseFloat(av.price_per_unit) || 0) - (parseFloat(bv.price_per_unit) || 0);
      case 'price-desc':
        return (parseFloat(bv.price_per_unit) || 0) - (parseFloat(av.price_per_unit) || 0);
      default:
        return (a.name || '').localeCompare(b.name || '');
    }
  });

  // Render
  catalog.innerHTML = '';

  if (filtered.length === 0) {
    var msg = document.createElement('p');
    msg.className = 'catalog-no-results';
    msg.textContent = 'No hops match your filters';
    var subMsg = document.createElement('p');
    subMsg.className = 'catalog-no-results-sub';
    subMsg.textContent = 'Try adjusting the flavor profile or search term.';
    catalog.appendChild(msg);
    catalog.appendChild(subMsg);
    return;
  }

  if (_hopsViewMode === 'table') {
    catalog.classList.remove('product-grid');
    catalog.appendChild(buildHopTable(filtered));
  } else {
    catalog.classList.add('product-grid');
    filtered.forEach(function (group) {
      catalog.appendChild(buildHopCard(group));
    });
  }

  if (typeof equalizeCardHeights !== 'undefined') {
    equalizeCardHeights();
  }
  if (typeof handleDeepLinkedItem !== 'undefined') {
    handleDeepLinkedItem();
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', function () {
  var catalog = document.getElementById('hops-catalog');
  if (catalog) {
    catalog.innerHTML = '<div class="hops-loading"><p>Loading hops...</p></div>';
  }
  loadHops(function () {
    buildHopFilters();
    wireHopEvents();
    renderHops();
  });
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    groupHopsByVariant: groupHopsByVariant,
    buildHopRadarChart: buildHopRadarChart,
    getTopFlavorTags: getTopFlavorTags,
    getDominantFlavor: getDominantFlavor
  };
}
