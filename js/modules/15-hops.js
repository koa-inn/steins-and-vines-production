// ===== Hop Catalog Module =====
// Standalone module (NOT in concat:js). Loads after main.min.js.
// Shared globals available: formatCurrency, escapeHTML, renderReserveControl,
// renderWeightControl, hasWeightConfig, setReservationQty, getReservedQty,
// trackEvent, Fuse, equalizeCardHeights, injectProductSchema, handleDeepLinkedItem

var _allHops = [];
var _hopGroups = [];
var _hopsFuse = null;
var _activeFlavorFilters = [];

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
          keys: ['name', 'description'],
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
}

// ---------------------------------------------------------------------------
// Card builder
// ---------------------------------------------------------------------------

function buildHopCard(group) {
  var card = document.createElement('div');
  card.className = 'product-card hop-card';

  // Track currently selected variant (index into group.variants)
  var selectedVariantIdx = 0;
  var variant = group.variants[selectedVariantIdx];

  // --- Collapsed section ---
  var heading = document.createElement('h4');
  heading.textContent = group.name;
  card.appendChild(heading);

  var alphaEl = document.createElement('span');
  alphaEl.className = 'hop-alpha';
  var alphaVal = variant.alpha_acid || '';
  if (alphaVal) {
    // alpha_acid may already include "%" or be a bare number
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

  // --- Accordion toggle (notes-wrap pattern) ---
  var notesWrap = document.createElement('div');
  notesWrap.className = 'notes-wrap';

  var toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'notes-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.innerHTML = 'Hop Details <span class="chevron">&#9660;</span>';

  var notesBody = document.createElement('div');
  notesBody.className = 'notes-body hop-notes-body';

  // --- Expanded panel ---
  var detail = document.createElement('div');
  detail.className = 'hop-detail';

  // Radar chart or placeholder
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

  // Specs (alpha acid in expanded view)
  var specsDiv = document.createElement('div');
  specsDiv.className = 'hop-specs';
  if (alphaVal) {
    var alphaDisplay2 = alphaVal.indexOf('%') !== -1 ? alphaVal : alphaVal + '%';
    specsDiv.textContent = 'Alpha Acid: ' + alphaDisplay2;
  }
  detail.appendChild(specsDiv);

  // Origin
  if (variant.origin) {
    var originP = document.createElement('p');
    originP.className = 'hop-origin';
    originP.textContent = 'Origin: ' + variant.origin;
    detail.appendChild(originP);
  }

  // Notes/history
  if (variant.description) {
    var notesP = document.createElement('p');
    notesP.className = 'hop-notes';
    notesP.textContent = variant.description;
    detail.appendChild(notesP);
  }

  // Size toggle (only if 2+ variants)
  var hopSizeToggleGroup = null;
  if (group.variants.length >= 2) {
    hopSizeToggleGroup = document.createElement('div');
    hopSizeToggleGroup.className = 'hop-size-toggle-group';

    group.variants.forEach(function (v, idx) {
      var sizeBtn = document.createElement('button');
      sizeBtn.type = 'button';
      sizeBtn.className = 'hop-size-btn' + (idx === 0 ? ' active' : '');
      sizeBtn.setAttribute('aria-pressed', idx === 0 ? 'true' : 'false');

      // Extract size label from name suffix
      var sizeMatch = (v.name || '').match(/\s*[-–]\s*(\d+\s*(?:oz|g))\s*$/i);
      sizeBtn.textContent = sizeMatch ? sizeMatch[1] : v.name;

      sizeBtn.addEventListener('click', (function (clickedIdx, clickedVariant) {
        return function () {
          selectedVariantIdx = clickedIdx;
          // Update active state on all size buttons
          var allSizeBtns = hopSizeToggleGroup.querySelectorAll('.hop-size-btn');
          allSizeBtns.forEach(function (b, bi) {
            b.classList.toggle('active', bi === clickedIdx);
            b.setAttribute('aria-pressed', bi === clickedIdx ? 'true' : 'false');
          });
          // Update price display
          priceSpan.textContent = formatCurrency(clickedVariant.price_per_unit || 0);
          // Update cart reserve wrap to new variant
          var newHopForCart = buildHopCartObject(clickedVariant);
          var newProductKey = clickedVariant.name + '|';
          var renderer = (typeof hasWeightConfig !== 'undefined' && hasWeightConfig(clickedVariant))
            ? renderWeightControl : renderReserveControl;
          reserveWrap._reserveProduct = newHopForCart;
          reserveWrap._reserveKey = newProductKey;
          reserveWrap._reserveRenderer = renderer;
          renderer(reserveWrap, newHopForCart, newProductKey);
        };
      })(idx, v));

      hopSizeToggleGroup.appendChild(sizeBtn);
    });

    detail.appendChild(hopSizeToggleGroup);
  }

  // Cart reserve wrap
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
  detail.appendChild(reserveWrap);

  notesBody.appendChild(detail);

  // Toggle click handler (notes-wrap pattern from 04-label-cards.js)
  toggle.addEventListener('click', (function (w, t, prod) {
    return function () {
      var isOpen = w.classList.toggle('open');
      t.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      if (isOpen) {
        if (typeof trackEvent !== 'undefined') {
          trackEvent('detail', prod.sku || '', prod.name || '');
        }
      }
    };
  })(notesWrap, toggle, variant));

  notesWrap.appendChild(toggle);
  notesWrap.appendChild(notesBody);
  card.appendChild(notesWrap);

  // Inject product schema for default variant
  if (typeof injectProductSchema !== 'undefined') {
    injectProductSchema(variant, 'ingredient');
  }

  return card;
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

// ---------------------------------------------------------------------------
// Main render function
// ---------------------------------------------------------------------------

function renderHops() {
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

  // Sort
  filtered.sort(function (a, b) {
    var av = a.variants[0];
    var bv = b.variants[0];
    switch (sortVal) {
      case 'name-asc':
        return (a.name || '').localeCompare(b.name || '');
      case 'name-desc':
        return (b.name || '').localeCompare(a.name || '');
      case 'alpha-desc':
        var aAlpha = parseFloat((av.alpha_acid || '0').replace(/[^0-9.]/g, '')) || 0;
        var bAlpha = parseFloat((bv.alpha_acid || '0').replace(/[^0-9.]/g, '')) || 0;
        return bAlpha - aAlpha;
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

  var grid = document.createElement('div');
  grid.className = 'product-grid';
  filtered.forEach(function (group) {
    grid.appendChild(buildHopCard(group));
  });
  catalog.appendChild(grid);

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
