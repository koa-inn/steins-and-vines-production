# Phase 4: Sales Order Management - Pattern Map

**Mapped:** 2026-04-27
**Files analyzed:** 4 (2 modified, 2 extended)
**Analogs found:** 4 / 4

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `zoho-middleware/routes/pos.js` (extend GET + new PUT) | route | CRUD / request-response | `zoho-middleware/routes/pos.js` lines 960-1023 (GET salesorders) + 1038-1119 (POST salesorder-create) | exact |
| `zoho-middleware/__tests__/kiosk-salesorders.test.js` (extend) | test | CRUD | `zoho-middleware/__tests__/kiosk-salesorders.test.js` (existing GET/POST/PAY suites) | exact |
| `js/kiosk.js` (state, chip filter, import flow, reorder flow, checkout fork) | utility / controller | event-driven / request-response | `js/kiosk.js` lines 2122-2325 (kioskLoadSalesOrders, kioskRenderSoList, kioskCollectPayment) + lines 2597-2675 (kioskCreateSalesOrder) | exact |
| `css/kiosk.css` (new chip + import-banner CSS, appended) | config | — | `css/kiosk.css` lines 1481-1505 (.kiosk-cb-tabs / .kiosk-cb-tab / .kiosk-cb-tab.active) | exact |

---

## Pattern Assignments

### `zoho-middleware/routes/pos.js` — Extend GET + Add PUT (route, CRUD)

**Analog A: GET handler** — `zoho-middleware/routes/pos.js` lines 960-1023

**Analog B: POST salesorder-create** — `zoho-middleware/routes/pos.js` lines 1038-1119

---

#### Imports pattern (lines 1-21 — no new requires needed)

```javascript
// pos.js already has everything needed. The new PUT handler requires zohoPut,
// which is exported from zoho-api but NOT yet destructured at the top. Add:
var zohoPut = zohoApi.zohoPut;
// Alongside the existing (line 11-12):
var zohoGet = zohoApi.zohoGet;
var zohoPost = zohoApi.zohoPost;
```

---

#### Auth pattern — inline API key check (lines 847-850, 919-922)

All protected kiosk endpoints in pos.js use an inline key check (no middleware wrapper). Copy this exactly for the new PUT endpoint:

```javascript
// Source: pos.js lines 847-850
var apiKey = req.headers['x-api-key'] || req.query.api_key;
if (apiKey !== process.env.MW_API_KEY) {
  return res.status(401).json({ error: 'Unauthorized' });
}
```

Note: The existing GET `/api/kiosk/salesorders` (lines 960-1023) does NOT currently have an API key check. Do not add one retroactively. The new PUT endpoint MUST have the inline check (sensitive write operation).

---

#### Core pattern A: Extend GET `/api/kiosk/salesorders` to fetch all statuses (lines 971-1006)

**Change:** Replace the current 2-status `Promise.all` with a 4-status fetch. Also add `item_id` to the line_items map.

```javascript
// BEFORE (lines 972-975):
var fetchParams = { sort_column: 'date', sort_order: 'D' };
return Promise.all([
  zohoGet('/salesorders', Object.assign({}, fetchParams, { status: 'open' })),
  zohoGet('/salesorders', Object.assign({}, fetchParams, { status: 'draft' }))
]).then(function (results) {
  var combined = (results[0].salesorders || []).concat(results[1].salesorders || []);

// AFTER:
var fetchParams = { sort_column: 'date', sort_order: 'D' };
return Promise.all([
  zohoGet('/salesorders', Object.assign({}, fetchParams, { status: 'open' })),
  zohoGet('/salesorders', Object.assign({}, fetchParams, { status: 'draft' })),
  zohoGet('/salesorders', Object.assign({}, fetchParams, { status: 'closed' })),
  zohoGet('/salesorders', Object.assign({}, fetchParams, { status: 'confirmed' }))
]).then(function (results) {
  var combined = results.reduce(function (acc, r) {
    return acc.concat(r.salesorders || []);
  }, []);
```

Also in the `orders` map (lines 991-997), add `item_id`:

```javascript
// BEFORE (lines 991-997):
line_items: (so.line_items || []).map(function (li) {
  return {
    name: li.name || li.description || '',
    quantity: li.quantity || 1,
    rate: li.rate || 0,
    amount: li.amount || 0
  };
})

// AFTER — add item_id as first field:
line_items: (so.line_items || []).map(function (li) {
  return {
    item_id: li.item_id || '',
    name: li.name || li.description || '',
    quantity: li.quantity || 1,
    rate: li.rate || 0,
    amount: li.amount || 0
  };
})
```

---

#### Core pattern B: New `PUT /api/kiosk/salesorder-update` endpoint

**Analog:** `POST /api/kiosk/salesorder-create` lines 1038-1119. Copy structure: validate body, map payload to Zoho shape, call Zoho API, invalidate cache, logEvent, respond.

Insert before `module.exports = router;` (currently line 1328).

```javascript
/**
 * PUT /api/kiosk/salesorder-update
 * Update line items on an existing Sales Order in Zoho.
 * Called before terminal payment when cart was imported from an SO.
 *
 * Expected body:
 * {
 *   salesorder_id: "zoho_so_id",
 *   items: [{ item_id, name, quantity, rate }]
 * }
 *
 * Response: { ok, salesorder_id, salesorder_number, total, balance }
 */
router.put('/api/kiosk/salesorder-update', function (req, res) {
  // Auth (source: pos.js lines 847-850)
  var apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (apiKey !== process.env.MW_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  var body = req.body || {};

  // Validation (source: salesorder-create lines 1042-1064 pattern)
  var soId = body.salesorder_id;
  if (!soId || typeof soId !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid salesorder_id' });
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return res.status(400).json({ error: 'Items array is required and must not be empty' });
  }
  for (var i = 0; i < body.items.length; i++) {
    var item = body.items[i];
    if (!item.item_id || typeof item.item_id !== 'string') {
      return res.status(400).json({ error: 'Invalid item_id for item ' + i });
    }
    var qty = Number(item.quantity);
    if (!qty || qty <= 0) {
      return res.status(400).json({ error: 'Invalid quantity for item ' + i });
    }
    var rate = Number(item.rate);
    if (isNaN(rate) || rate < 0) {
      return res.status(400).json({ error: 'Invalid rate for item ' + i });
    }
  }

  // Build Zoho payload (source: salesorder-create lines 1066-1078 pattern)
  var payload = {
    line_items: body.items.map(function (item) {
      return {
        item_id: item.item_id,
        quantity: item.quantity,
        rate: item.rate,
        name: item.name || ''
      };
    })
  };

  log.info('[kiosk/so-update] Updating SO=' + soId + ' items=' + body.items.length);

  // zohoPut (source: zoho-api.js line 111)
  zohoPut('/salesorders/' + soId, payload)
    .then(function (data) {
      var so = data.salesorder || {};
      // Invalidate cache (source: salesorder-create line 1094)
      cache.del(KIOSK_SO_CACHE_KEY).catch(function () {});
      // logEvent (source: salesorder-create lines 1096-1101)
      eventLog.logEvent('kiosk.salesorder_updated', {
        soId: soId,
        soNumber: so.salesorder_number || '',
        itemCount: body.items.length
      });
      res.json({
        ok: true,
        salesorder_id: soId,
        salesorder_number: so.salesorder_number || '',
        total: so.total || 0,
        balance: so.balance || 0
      });
    })
    .catch(function (err) {
      // Error handling (source: salesorder-create lines 1111-1118 pattern)
      var msg = err.message;
      if (err.response && err.response.data) {
        msg = err.response.data.message || err.response.data.error || msg;
      }
      log.error('[kiosk/so-update] Zoho error: ' + msg);
      res.status(502).json({ error: 'Failed to update sales order' });
    });
});
```

---

### `zoho-middleware/__tests__/kiosk-salesorders.test.js` — Extend (test, CRUD)

**Analog:** The existing file itself (lines 1-488). Append new `describe` blocks after line 488, before the file ends. Do NOT modify existing tests.

**Mock setup pattern** (lines 1-64): The existing mock declarations cover all dependencies needed for new tests (`zohoApi.zohoPut` is already mocked at line 19). Add a `put` entry to the `_routeRegistry` mock:

```javascript
// Source: lines 47-61 — add 'put' alongside 'get' and 'post'
var _routeRegistry = { get: [], post: [], put: [] };

// In the router mock (lines 50-60), add:
put: jest.fn(function (path, handler) {
  _routeRegistry.put.push({ path: path, handler: handler });
}),
```

**Handler lookup pattern** (lines 66-76):

```javascript
// Source: lines 66-76
var updateSalesorderHandler = findHandler('put', '/api/kiosk/salesorder-update');
```

**Test structure pattern** — copy from `POST /api/kiosk/salesorder-create` suite (lines 196-295):

```javascript
// Source: lines 196-295 — same describe/beforeEach/test structure
describe('PUT /api/kiosk/salesorder-update', function () {
  beforeEach(function () {
    jest.clearAllMocks();
    cache.del.mockResolvedValue(1);
  });

  test('happy path: valid soId + items updates SO and returns ok', function () {
    zohoApi.zohoPut.mockResolvedValue({
      salesorder: { salesorder_id: 'SO-1', salesorder_number: 'SO-001', total: 75, balance: 75 }
    });
    var req = makeReq({ salesorder_id: 'SO-1', items: [{ item_id: 'ITEM-A', name: 'Kit', quantity: 1, rate: 75 }] });
    var res = makeRes();
    // include x-api-key header simulation if handler checks it
    updateSalesorderHandler(req, res);
    return flushPromises().then(function () {
      expect(res.json).toHaveBeenCalled();
      expect(res._json.ok).toBe(true);
      expect(zohoApi.zohoPut).toHaveBeenCalled();
      expect(cache.del).toHaveBeenCalled();
    });
  });

  // ... follow same pattern for: missing soId (400), empty items (400),
  // invalid quantity (400), invalid rate (400), missing auth (401), Zoho error (502)
});
```

**makeReq helper for auth header** — extend `makeReq` (lines 81-83) to optionally include headers:

```javascript
// Source: lines 81-83 — extend to support headers
function makeReq(body, query, headers) {
  return { body: body || {}, query: query || {}, headers: headers || {} };
}
```

---

### `js/kiosk.js` — State, chip filter, import flow, reorder flow, checkout fork (utility/controller, event-driven)

**Analog A: State variables** — lines 706-712 (`_kioskSalesOrders`, `_kioskSoItems`, `_kioskSoPayingId`)

**Analog B: Card rendering + button wiring** — lines 2153-2216 (`kioskRenderSoList`)

**Analog C: `kioskCreateSalesOrder`** — lines 2597-2675 (fetch to middleware, `x-api-key` header, `.then/.catch` pattern, button disable/re-enable, `_kioskSalesOrders.unshift()`)

**Analog D: Tab toggle** — lines 3108-3118 (`.kiosk-cb-tab` click: single-active, `classList.remove/add`)

---

#### State variables pattern (lines 706-712)

New state goes alongside existing SO state variables:

```javascript
// Source: kiosk.js lines 706-712
var _kioskSalesOrders = [];
var _kioskSoItems = [];
var _kioskSoCustomer = null;
var _kioskSoSearchTimer = null;
var _kioskSoPayingId = null;

// ADD after line 711:
var _kioskImportedSoId = null;        // non-null when an SO has been imported to cart
var _kioskImportedSoNumber = null;    // SO-NNNN for display in banner
var _kioskImportedSoUpdated = false;  // D-08: true after SO update succeeds (skip on retry)
var _kioskSoActiveChips = ['open', 'draft'];  // D-10: default chip state
```

---

#### Chip filter toggle pattern (lines 3108-3118)

**Analog:** `.kiosk-cb-tab` single-active toggle. The SO chip filter is multi-select, so adapt the pattern:

```javascript
// Source: kiosk.js lines 3108-3118 (single-active tab pattern)
Array.prototype.forEach.call(document.querySelectorAll('.kiosk-cb-tab'), function (tab) {
  tab.addEventListener('click', function () {
    _kioskCbTab = tab.getAttribute('data-cb-tab');
    Array.prototype.forEach.call(document.querySelectorAll('.kiosk-cb-tab'), function (t) {
      t.classList.remove('active');
    });
    tab.classList.add('active');
    kioskRenderCbGrid();
  });
});

// ADAPTED for multi-select SO chips:
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
          if (_kioskSoActiveChips.length > 1) _kioskSoActiveChips.splice(i, 1); // never empty
        } else {
          _kioskSoActiveChips.push(status);
        }
      }
      kioskRenderSoChips();   // update .active classes
      kioskRenderSoList();    // re-filter from _kioskSalesOrders (no re-fetch)
    });
  });
}

function kioskRenderSoChips() {
  // Source: same active-class pattern
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
```

---

#### `kioskRenderSoList` extension pattern (lines 2153-2216)

**Analog:** Existing `kioskRenderSoList` at lines 2153-2216. Extend with: (1) chip filter applied before search filter, (2) conditional action buttons by status.

```javascript
// Source: kiosk.js lines 2160-2166 (search filter applied to _kioskSalesOrders)
// EXTEND: apply chip filter first, then search
function kioskRenderSoList() {
  var list = document.getElementById('kiosk-so-list');
  if (!list) return;

  // Step 1: chip filter (client-side on _kioskSalesOrders — no re-fetch)
  var chipFiltered = _kioskSalesOrders;
  if (_kioskSoActiveChips.indexOf('all') === -1) {
    chipFiltered = _kioskSalesOrders.filter(function (so) {
      return _kioskSoActiveChips.indexOf(so.status) !== -1;
    });
  }

  // Step 2: search filter (existing pattern, lines 2157-2166)
  var searchTerm = (document.getElementById('kiosk-so-search') || {}).value || '';
  searchTerm = searchTerm.toLowerCase().trim();
  var filtered = chipFiltered;
  if (searchTerm) {
    filtered = chipFiltered.filter(function (so) {
      var haystack = ((so.customer_name || '') + ' ' + (so.salesorder_number || '')).toLowerCase();
      return haystack.indexOf(searchTerm) !== -1;
    });
  }

  // Step 3: card rendering (source: lines 2173-2216)
  // Conditional buttons by status — extend the existing balance>0 / paid-badge fork:
  var isActionable = so.status === 'open' || so.status === 'draft';
  if (isActionable && balance > 0) {
    // existing "Collect $X" pay button (line 2197-2200)
    html += '<button type="button" class="btn kiosk-so-pay-btn" data-so-id="' + escapeHTML(so.salesorder_id) + '">';
    html += 'Collect ' + kioskFmt(balance);
    html += '</button>';
    // NEW: Import to Cart button
    html += '<button type="button" class="btn btn-secondary kiosk-so-import-btn" data-so-id="' + escapeHTML(so.salesorder_id) + '">';
    html += 'Import to Cart';
    html += '</button>';
  } else if (!isActionable) {
    // D-11: Reorder button for closed/paid SOs
    html += '<button type="button" class="btn btn-secondary kiosk-so-reorder-btn" data-so-id="' + escapeHTML(so.salesorder_id) + '">';
    html += 'Reorder Items';
    html += '</button>';
  } else {
    html += '<div class="kiosk-so-paid-badge">Paid</div>'; // existing line 2201
  }
}
```

---

#### Import to cart pattern

**Analog:** `kioskCreateSalesOrder` lines 2597-2675 for the fetch-with-header + button-disable pattern. `_kioskCart` usage from lines 684-695 area.

```javascript
// Source: kioskCreateSalesOrder lines 2634-2638 (fetch pattern with x-api-key)
// Source: confirm() usage — standard browser confirm pattern used throughout kiosk

function kioskImportSoToCart(soId) {
  var so = null;
  for (var i = 0; i < _kioskSalesOrders.length; i++) {
    if (_kioskSalesOrders[i].salesorder_id === soId) { so = _kioskSalesOrders[i]; break; }
  }
  if (!so) { showToast('Order not found', 'error'); return; }

  // D-03: confirm if cart non-empty
  if (Object.keys(_kioskCart).length > 0) {
    if (!confirm('Replace current cart with items from ' + escapeHTML(so.salesorder_number) + '? Current cart will be cleared.')) return;
  }

  _kioskCart = {};
  _kioskDiscount = null;
  var skipped = 0;

  (so.line_items || []).forEach(function (li) {
    if (!li.item_id) { skipped++; return; }
    var product = kioskFindProductById(li.item_id);  // look up full product object
    if (product) {
      _kioskCart[product.item_id] = { item: product, qty: li.quantity || 1 };
    } else {
      skipped++;
    }
  });

  _kioskImportedSoId = so.salesorder_id;
  _kioskImportedSoNumber = so.salesorder_number;
  _kioskImportedSoUpdated = false;

  if (skipped > 0) {
    showToast(skipped + ' item(s) not found in current catalog — skipped', 'warning');
  }

  kioskSyncMakersFee();
  kioskRenderCart();
  kioskRenderProducts();
  kioskShowView('browse');
}
```

---

#### Checkout fork — imported SO vs new sale

**Analog:** `kioskCreateSalesOrder` lines 2634-2675 for the `fetch + .then(function(r) { return r.json().then(...) })` response unwrap pattern.

```javascript
// Source: kioskCreateSalesOrder lines 2634-2639 (fetch structure)
// Source: kioskCollectPayment lines 2277-2324 (error handling, kioskShowSoError)

// Called from the main checkout/payment initiation function.
// When _kioskImportedSoId is set, fork here instead of normal sale flow.
if (_kioskImportedSoId && !_kioskImportedSoUpdated) {
  // D-02: Update SO first, then charge terminal
  var updateBtn = document.getElementById('kiosk-checkout-btn');
  if (updateBtn) updateBtn.disabled = true;

  fetch(mwUrl + '/api/kiosk/salesorder-update', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-api-key': SHEETS_CONFIG.MW_API_KEY || '' },
    body: JSON.stringify({ salesorder_id: _kioskImportedSoId, items: items })
  })
  .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
  .then(function (result) {
    if (updateBtn) updateBtn.disabled = false;
    if (result.data && result.data.ok) {
      _kioskImportedSoUpdated = true;
      // Inject updated SO into _kioskSalesOrders so kioskCollectPayment can find it
      // (same pattern as kioskCreateSalesOrder lines 2647-2658)
      for (var i = 0; i < _kioskSalesOrders.length; i++) {
        if (_kioskSalesOrders[i].salesorder_id === _kioskImportedSoId) {
          _kioskSalesOrders[i].balance = result.data.balance || 0;
          _kioskSalesOrders[i].total = result.data.total || 0;
          break;
        }
      }
      kioskCollectPayment(_kioskImportedSoId);
    } else {
      // D-02: SO update failed — do NOT proceed to terminal
      kioskShowSoError('Order Update Failed',
        'Order update failed — payment not taken. Check connection and retry.', true);
    }
  })
  .catch(function () {
    if (updateBtn) updateBtn.disabled = false;
    kioskShowSoError('Connection Error',
      'Order update failed — payment not taken. Check connection and retry.', true);
  });

} else if (_kioskImportedSoId && _kioskImportedSoUpdated) {
  // D-08: Retry after terminal failure — SO already updated, skip SO update
  kioskCollectPayment(_kioskImportedSoId);

} else {
  // Existing new-sale flow (unchanged)
  kioskProceedToNewSale(/* existing args */);
}
```

---

#### Reorder flow pattern

**Analog:** `kioskCreateSalesOrder` lines 2634-2675. Calls `salesorder-create` endpoint with copied line items.

```javascript
// Source: kioskCreateSalesOrder lines 2626-2665 (payload + fetch + success handling)
function kioskReorderSo(soId) {
  var so = null;
  for (var i = 0; i < _kioskSalesOrders.length; i++) {
    if (_kioskSalesOrders[i].salesorder_id === soId) { so = _kioskSalesOrders[i]; break; }
  }
  if (!so) { showToast('Order not found', 'error'); return; }

  // confirm() pattern (source: kiosk.js — used throughout for destructive actions)
  if (!confirm('Create a new order with the same items as ' + escapeHTML(so.salesorder_number) + '?')) return;

  var mwUrl = kioskMwUrl();
  if (!mwUrl) { showToast('Middleware URL not configured', 'error'); return; }

  var payload = {
    customer_id: so.customer_id,
    items: (so.line_items || []).map(function (li) {
      return { item_id: li.item_id, name: li.name, quantity: li.quantity, rate: li.rate };
    })
  };

  fetch(mwUrl + '/api/kiosk/salesorder-create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': SHEETS_CONFIG.MW_API_KEY || '' },
    body: JSON.stringify(payload)
  })
  .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
  .then(function (result) {
    if (result.data && result.data.ok) {
      showToast('New order ' + escapeHTML(result.data.salesorder_number || '') + ' created', 'success');
      kioskLoadSalesOrders();  // re-fetch to show new open SO
    } else {
      showToast((result.data && result.data.error) || 'Could not create reorder', 'error');
    }
  })
  .catch(function () {
    showToast('Could not create reorder — network error', 'error');
  });
}
```

---

#### Receipt flow after imported SO payment (post-payment state reset)

**Analog:** `kioskCollectPayment` lines 2287-2311 (receipt display). After SO payment, also clear the imported SO state.

```javascript
// Source: kioskCollectPayment lines 2306-2311 (new sale btn wiring)
// ADD: clear imported SO state when staff taps "New Sale" from SO payment receipt
var newSaleBtn = document.getElementById('kiosk-new-sale-btn');
if (newSaleBtn) {
  newSaleBtn.onclick = function () {
    _kioskSoPayingId = null;
    _kioskImportedSoId = null;       // ADD
    _kioskImportedSoNumber = null;   // ADD
    _kioskImportedSoUpdated = false; // ADD
    _kioskCart = {};                 // ADD — D-07: return to empty cart/product grid
    kioskRenderCart();               // ADD
    kioskShowView('browse');         // ADD — D-07: product grid, not SO list
  };
}
```

---

### `css/kiosk.css` — SO chip filter + import banner (config)

**Analog:** `.kiosk-cb-tabs` / `.kiosk-cb-tab` / `.kiosk-cb-tab.active` at lines 1481-1505.

Also: `.kiosk-discount-type-btn.active` at line 2269 (active state for multi-select toggle using `var(--stain)`).

**SO chip container** — copy `.kiosk-cb-tabs` pattern (class renamed to `.kiosk-so-status-filter` per UI-SPEC.md):

```css
/* Source: kiosk.css lines 1481-1505 (.kiosk-cb-tabs / .kiosk-cb-tab) */
.kiosk-so-status-filter {
  display: flex;
  gap: 0;
  border: 1px solid var(--ledger-emphasis);
  border-radius: var(--r-sm);
  overflow: hidden;
  margin-bottom: 0.75rem;
}

.kiosk-so-chip {
  padding: 0.5rem 1.25rem;
  font-family: var(--font-body);
  font-size: 0.875rem;
  font-weight: 700;
  border: none;
  background: var(--cellar-surface);
  color: var(--ink-secondary);
  cursor: pointer;
  min-height: 40px;
  transition: background-color 0.15s, color 0.15s;
}

.kiosk-so-chip.active {
  background: var(--stain);
  color: var(--cellar-surface);
}

/* Separator between chips (source: .kiosk-view-btn + .kiosk-view-btn, line 665) */
.kiosk-so-chip + .kiosk-so-chip {
  border-left: 1px solid var(--ledger-emphasis);
}
```

**Import banner** — appears in the cart pane when an SO has been imported:

```css
/* No direct analog — new pattern. Follow existing kiosk banner conventions:
   compact, uses --cellar-surface background, --ink-secondary text */
.kiosk-imported-so-banner {
  background: var(--cellar-surface);
  border: 1px solid var(--ledger-emphasis);
  border-radius: var(--r-sm);
  padding: 0.5rem 0.75rem;
  font-size: 0.8rem;
  color: var(--ink-secondary);
  margin-bottom: 0.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.kiosk-imported-so-banner-label {
  font-weight: 600;
  color: var(--ink-primary);
}
```

---

## Shared Patterns

### API Key Auth (inline check)
**Source:** `zoho-middleware/routes/pos.js` lines 847-850
**Apply to:** New `PUT /api/kiosk/salesorder-update` endpoint ONLY (new write endpoint requires auth; existing GET does not have it).

```javascript
var apiKey = req.headers['x-api-key'] || req.query.api_key;
if (apiKey !== process.env.MW_API_KEY) {
  return res.status(401).json({ error: 'Unauthorized' });
}
```

### Error Handling (Zoho API errors in middleware)
**Source:** `zoho-middleware/routes/pos.js` lines 1111-1118 (salesorder-create catch)
**Apply to:** New PUT endpoint catch block.

```javascript
.catch(function (err) {
  var msg = err.message;
  if (err.response && err.response.data) {
    msg = err.response.data.message || err.response.data.error || msg;
  }
  log.error('[kiosk/so-update] Zoho error: ' + msg);
  res.status(502).json({ error: 'Failed to update sales order' });
});
```

### Cache Invalidation After Write
**Source:** `zoho-middleware/routes/pos.js` line 1094 (salesorder-create), line 1233 (salesorder-pay)
**Apply to:** PUT update endpoint (after zohoPut succeeds).

```javascript
cache.del(KIOSK_SO_CACHE_KEY).catch(function () {});
```

### eventLog After Write
**Source:** `zoho-middleware/routes/pos.js` lines 1096-1101 (salesorder-create)
**Apply to:** PUT update endpoint.

```javascript
eventLog.logEvent('kiosk.salesorder_updated', {
  soId: soId,
  soNumber: so.salesorder_number || '',
  itemCount: body.items.length
});
```

### Frontend fetch + response unwrap
**Source:** `js/kiosk.js` lines 2277-2284 (kioskCollectPayment), lines 2634-2639 (kioskCreateSalesOrder)
**Apply to:** All new frontend fetch calls.

```javascript
fetch(mwUrl + '/api/kiosk/...', {
  method: 'POST',  // or PUT
  headers: { 'Content-Type': 'application/json', 'x-api-key': SHEETS_CONFIG.MW_API_KEY || '' },
  body: JSON.stringify(payload)
})
.then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
.then(function (result) { ... })
.catch(function () { ... });
```

### escapeHTML for all rendered SO data
**Source:** `js/kiosk.js` lines 2178-2199 (kioskRenderSoList)
**Apply to:** All new card HTML strings using SO data (customer_name, salesorder_number, etc.).

```javascript
// Source: kiosk.js line 2178
escapeHTML(so.salesorder_id)
escapeHTML(so.customer_name || 'Unknown')
escapeHTML(so.salesorder_number || '')
```

### showToast for success/error notifications
**Source:** `js/kiosk.js` line 61 (definition), used throughout
**Apply to:** All new frontend functions (import, reorder, checkout fork).

```javascript
showToast('Message text', 'success');  // or 'error', 'warning', 'info'
```

---

## No Analog Found

All files in this phase have close analogs within the codebase. No external pattern reference needed.

---

## Metadata

**Analog search scope:** `zoho-middleware/routes/pos.js`, `zoho-middleware/__tests__/kiosk-salesorders.test.js`, `zoho-middleware/lib/zoho-api.js`, `js/kiosk.js`, `css/kiosk.css`
**Files scanned:** 5 source files (all read directly, targeted ranges)
**Pattern extraction date:** 2026-04-27
