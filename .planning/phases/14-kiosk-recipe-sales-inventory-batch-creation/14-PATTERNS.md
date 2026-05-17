# Phase 14: Kiosk Recipe Sales, Inventory, and Batch Creation - Pattern Map

**Mapped:** 2026-05-17
**Files analyzed:** 10 (new + modified)
**Analogs found:** 10 / 10

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `zoho-middleware/routes/pos-recipe.js` (NEW) | route | request-response | `zoho-middleware/routes/pos.js` | exact |
| `zoho-middleware/lib/brewpad-integration.js` (MOD) | service | event-driven | self (existing `detectKitItems` / `createBatchesFromSale`) | exact |
| `zoho-middleware/lib/constants.js` (MOD) | config | N/A | self | exact |
| `zoho-middleware/lib/validateEnv.js` (MOD) | config | N/A | self | exact |
| `zoho-middleware/server.js` (MOD) | config | N/A | self (route mounting block) | exact |
| `js/admin.js` (MOD) | component | request-response | self (kiosk IIFE section, lines 8693-9579) | exact |
| `admin.html` (MOD) | template | N/A | self (kiosk browse view, lines 589-638) | exact |
| `css/kiosk.css` (MOD) | style | N/A | self (product card styles, lines 479-598) | exact |
| `zoho-middleware/__tests__/pos-recipe.test.js` (NEW) | test | N/A | `zoho-middleware/__tests__/recipes.test.js` + `pos-tax.test.js` | exact |
| `zoho-middleware/__tests__/brewpad-recipe.test.js` (NEW) | test | N/A | `zoho-middleware/__tests__/brewpad-integration.test.js` | exact |

---

## Pattern Assignments

### `zoho-middleware/routes/pos-recipe.js` (route, request-response) -- NEW

**Analog:** `zoho-middleware/routes/pos.js`

**Imports pattern** (pos.js lines 1-21):
```javascript
var express = require('express');
var helcimLib = require('../lib/helcim');
var zohoApi = require('../lib/zoho-api');
var cache = require('../lib/cache');
var log = require('../lib/logger');
var eventLog = require('../lib/eventLog');
var mailer = require('../lib/mailer');
var C = require('../lib/constants');
var brewpadIntegration = require('../lib/brewpad-integration');

var zohoGet = zohoApi.zohoGet;
var zohoPost = zohoApi.zohoPost;

var router = express.Router();
```
Note: Recipe sale route also needs `var axios = require('axios');` for calling recipes.js helpers, or can reuse the `callAppsScriptPost` pattern from `routes/recipes.js` (lines 34-51).

**Feature gate pattern** -- NEW for this file, follows env var guard convention from pos.js:
```javascript
// Check at top of handler, before any async work
if ((process.env.BEER_SALES_ENABLED || 'false').toLowerCase() !== 'true') {
  return res.status(403).json({ error: 'Recipe sales are not enabled' });
}
```

**Terminal check pattern** (pos.js line 177-179):
```javascript
if (!helcimLib.isTerminalEnabled()) {
  return res.status(503).json({ error: 'POS terminal not configured' });
}
```

**Core sale initiate pattern** (pos.js lines 176-325) -- POST /api/kiosk/sale:
```javascript
// 1. Validate body structure
if (!body || /* ... */) {
  return res.status(400).json({ error: 'Cart is empty' });
}

// 2. Generate reference number
var refNumber = 'KIOSK-' + Date.now();

// 3. Push to terminal
helcimLib.terminalPurchase(grandTotal, refNumber)
  .then(function () {
    res.status(202).json({ pending: true, reference: refNumber });
  })
  .catch(function (termErr) {
    log.error('[pos/kiosk/sale] Terminal push failed: ' + termErr.message);
    res.status(502).json({ error: 'Terminal error — please try again' });
  });
```

**Core sale confirm pattern** (pos.js lines 394-530) -- POST /api/kiosk/sale/confirm:
```javascript
// 1. Re-validate items against catalog
// 2. Build line items with server-authoritative rates
// 3. Compute tax and grand total
// 4. Create Zoho invoice
zohoPost('/invoices', invoicePayload).then(function (invoiceData) {
  var invoice = invoiceData.invoice || {};
  var invoiceId = invoice.invoice_id || '';
  var invoiceNumber = invoice.invoice_number || '';

  // 5. Submit invoice (triggers inventory deduction)
  zohoPost('/invoices/' + invoiceId + '/submit', {}).catch(function () {})
    .then(function () {
      // 6. Record customer payment
      return zohoPost('/customerpayments', {
        payment_mode: 'creditcard',
        amount: grandTotal,
        date: today,
        reference_number: txnId,
        invoices: [{ invoice_id: invoiceId, amount_applied: grandTotal }],
        notes: 'Kiosk POS payment. Ref: ' + refNumber
      });
    }).catch(function (payErr) {
      log.error('[pos/kiosk/sale/confirm] Payment recording failed: ' + payErr.message);
    });

  // 7. Bust caches
  cache.del(KIOSK_PRODUCTS_CACHE_KEY);

  // 8. Fire-and-forget batch creation
  brewpadIntegration.createBatchesFromSale(lineItems, invoiceNumber, ...);

  // 9. Return receipt
  res.status(201).json({ ok: true, transaction_id: txnId, ... });
});
```

**Void-on-Zoho-failure pattern** (pos.js lines 1142-1190, from salesorder-pay):
```javascript
.catch(function (payErr) {
  log.error('[...] voiding txn=' + txnId + ': ' + payMsg);
  eventLog.logEvent('kiosk.recipe_sale_failed_after_charge', { txnId: txnId, amount: amount });

  helcimLib.voidTransaction(txnId)
    .then(function () {
      log.info('[...] Voided txn=' + txnId);
    })
    .catch(function (voidErr) {
      log.error('[...] CRITICAL: Void failed for txn=' + txnId + ': ' + voidErr.message);
      cache.set('sv:void-failure:' + Date.now(), failRecord, 60 * 60 * 24 * 30).catch(function () {});
      mailer.sendVoidFailureAlert({ txnId: txnId, amount: amount, error: voidErr.message, ... }).catch(function () {});
    })
    .then(function () {
      if (res.headersSent) return;
      res.status(502).json({ error: 'Payment was taken but invoice failed. Payment voided.', payment_voided: true });
    });
});
```

**Invoice payload shape** (pos.js lines 450-458):
```javascript
var invoicePayload = {
  date: today,
  reference_number: refNumber,
  payment_terms: 0,
  payment_terms_label: 'Due on Receipt',
  line_items: lineItems,  // each has item_id, name, quantity, rate, tax_id
  notes: 'Kiosk recipe sale (in-store). Recipe: ' + recipeId + '. Ref: ' + refNumber,
  custom_fields: [],
  customer_id: contactId || process.env.KIOSK_CONTACT_ID || ''
};
```

**Module export pattern** (pos.js line 1412):
```javascript
module.exports = router;
```

**Redis mutex pattern** -- from `lib/cache.js` lines 106-125:
```javascript
// Acquire lock
cache.acquireLock('recipe-sale', 30).then(function (acquired) {
  if (!acquired) {
    return res.status(503).json({ error: 'Another recipe sale in progress — try again in a moment.' });
  }
  // ... proceed with sale
});

// Release lock -- MUST appear in every exit path (success, error, void)
cache.releaseLock('recipe-sale').catch(function () {});
```

---

### `zoho-middleware/lib/brewpad-integration.js` (service, event-driven) -- MODIFY

**Analog:** self (existing code)

**Imports** (lines 1-10) -- no changes needed, all deps already imported:
```javascript
'use strict';
var axios = require('axios');
var log = require('./logger');
var eventLog = require('./eventLog');
var cache = require('./cache');
var C = require('./constants');
var checkoutHelpers = require('./checkout-helpers');
var zohoApi = require('./zoho-api');
var zohoPut = zohoApi.zohoPut;
```

**detectKitItems pattern** (lines 43-58) -- model for new `detectRecipeSale`:
```javascript
function detectKitItems(lineItems) {
  if (!Array.isArray(lineItems) || lineItems.length === 0) return [];
  var makersFeeItemId = process.env.MAKERS_FEE_ITEM_ID || '';
  var feeItem = checkoutHelpers.findMakersFeeItem(lineItems, makersFeeItemId);
  if (!feeItem) return [];
  var materialsFeeItemId = process.env.MATERIALS_FEE_ITEM_ID || '';
  var matFeeItem = checkoutHelpers.findMaterialsFeeItem(lineItems, materialsFeeItemId);
  return lineItems.filter(function (item) {
    return item !== feeItem && item !== matFeeItem;
  });
}
```

**createBatchesFromSale + callAppsScriptCreateBatch fire-and-forget pattern** (lines 153-179):
```javascript
function createBatchesFromSale(lineItems, invoiceNumber, customerName, contactId, catalogMap, invoiceId) {
  var kitItems = detectKitItems(lineItems);
  if (kitItems.length === 0) return;
  kitItems.forEach(function (item) {
    var nameParts = splitCustomerName(customerName);
    var batchPayload = {
      product_sku: item.sku || item.item_id || '',
      product_name: item.name || '',
      customer_name: customerName || 'Walk-in Customer',
      customer_firstname: nameParts.first || (customerName ? '' : 'Walk-in'),
      customer_lastname: nameParts.last || (customerName ? '' : 'Customer'),
      customer_id: contactId || '',
      source: 'kiosk',
      zoho_so_number: invoiceNumber || ''
    };
    callAppsScriptCreateBatch(batchPayload).then(function (result) {
      if (result && result.ok && invoiceId) {
        syncBatchToZoho(invoiceId, result.batch_id || '', 'pending').catch(function () {});
      }
    });
  });
}
```

**New `detectRecipeSale` follows the same fire-and-forget pattern but:**
- Takes explicit `recipeId`, `recipeSnapshot`, `invoiceNumber`, `customerName`, `contactId` params
- Sets `source: 'kiosk_recipe'` instead of `'kiosk'`
- Adds `recipe_id` and `recipe_snapshot` fields to `batchPayload`
- Creates exactly ONE batch (not one-per-line-item)
- NEVER calls `createBatchesFromSale` / `detectKitItems`

**Module exports pattern** (lines 365-374) -- add new function to existing exports:
```javascript
module.exports = {
  createBatchesFromSale: createBatchesFromSale,
  retryPendingBatches: retryPendingBatches,
  detectKitItems: detectKitItems,
  callAppsScriptCreateBatch: callAppsScriptCreateBatch,
  splitCustomerName: splitCustomerName,
  syncBatchToZoho: syncBatchToZoho,
  queueSyncForRetry: queueSyncForRetry,
  retrySyncQueue: retrySyncQueue,
  // NEW:
  detectRecipeSale: detectRecipeSale
};
```

---

### `zoho-middleware/lib/constants.js` (config) -- MODIFY

**Analog:** self

**CACHE_KEYS extension pattern** (lines 15-69) -- add new keys to the existing object:
```javascript
var CACHE_KEYS = {
  // ... existing keys ...
  RECIPES:             'sv:recipes',
  RECIPES_TS:          'sv:recipes:ts',
  // NEW: add at end of CACHE_KEYS
};
```

**New keys to add:**
- Lock key constant: A new `LOCK_KEYS` object (or add to CACHE_KEYS) for `RECIPE_SALE: 'recipe-sale'`

---

### `zoho-middleware/lib/validateEnv.js` (config) -- MODIFY

**Analog:** self

**OPTIONAL array extension pattern** (lines 12-60) -- add new entry:
```javascript
var OPTIONAL = [
  // ... existing entries ...
  { name: 'BEER_SALES_ENABLED',       desc: 'Enable beer recipe sales in kiosk and public browsing (true/false, default: false)' },
  // NEW:
  { name: 'MILLING_FEE_ITEM_ID',      desc: 'Zoho item ID for the grain milling fee service item (take-out recipe sales)' },
];
```

---

### `zoho-middleware/server.js` (config) -- MODIFY

**Analog:** self

**Route mounting pattern** (lines 375-393):
```javascript
// Route modules
app.use('/', require('./routes/pos'));
app.use('/', require('./routes/collect'));
// ...
app.use('/', require('./routes/recipes'));
// NEW: add after recipes
app.use('/', require('./routes/pos-recipe'));
```

---

### `js/admin.js` (component, request-response) -- MODIFY

**Analog:** self (kiosk IIFE, lines 8693-9579)

**State variable declaration pattern** (lines 8695-8704):
```javascript
var _kioskProducts = [];
var _kioskCart = {};
var _kioskProductsLoaded = false;
var _kioskProductsLoading = false;
var _kioskCurrentView = 'browse';
var _kioskSaleData = null;
var _kioskSearchTimer = null;
var _kioskTerminalReady = false;
var _kioskCustomer = null;
var _kioskTabActive = false;
```
New recipe-mode state adds alongside these:
```javascript
var _kioskMode = 'products';        // 'products' | 'recipes'
var _kioskRecipes = [];
var _kioskSelectedRecipe = null;
var _kioskSaleType = null;          // 'in-store' | 'take-out'
var _kioskMillGrain = false;
```

**Product loading pattern** (lines 8808-8841) -- model for recipe loading:
```javascript
function kioskLoadProducts(forceRefresh) {
  if (_kioskProductsLoading) return;
  if (_kioskProductsLoaded && !forceRefresh) {
    kioskRenderProducts();
    return;
  }
  _kioskProductsLoading = true;
  var grid = document.getElementById('kiosk-product-grid');
  if (grid) grid.innerHTML = '<p class="kiosk-loading">Loading products...</p>';
  fetch(mwUrl + '/api/kiosk/products')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      _kioskProducts = data.items || [];
      _kioskProductsLoaded = true;
      _kioskProductsLoading = false;
      kioskRenderProducts();
    })
    .catch(function (err) {
      _kioskProductsLoading = false;
      if (grid) grid.innerHTML = '<p class="kiosk-loading">Failed to load products: ' + err.message + '</p>';
    });
}
```
Recipe analog: `fetch(mwUrl + '/api/recipes?status=active')` -> `_kioskRecipes = data.recipes || []`

**Product card rendering pattern** (lines 8868-8946) -- model for recipe cards:
```javascript
function kioskRenderProducts() {
  var grid = document.getElementById('kiosk-product-grid');
  if (!grid) return;
  var html = '';
  filtered.forEach(function (p) {
    var cardClass = 'kiosk-product-card' + (outOfStock ? ' kiosk-product-card--out-of-stock' : '');
    html += '<div class="' + cardClass + '" data-item-id="' + p.item_id + '">';
    html += '<div class="kiosk-product-body">';
    html += '<div class="kiosk-product-name">' + (p.name || '') + '</div>';
    html += '<div class="kiosk-product-price">' + kioskFmt(p.rate) + '</div>';
    html += '<div class="kiosk-product-stock ' + stockClass + '">' + stockLabel + '</div>';
    html += '</div></div>';
  });
  grid.innerHTML = html;
  // Attach click handlers
  cards.forEach(function (card) {
    card.addEventListener('click', function () { /* ... */ });
  });
}
```
Recipe analog replaces: `p.name` -> recipe name, `p.rate` -> `locked_price`, adds style + ABV fields, availability status dot.

**Tab hook pattern** (lines 9548-9573):
```javascript
var _kioskOrigInitTabNav = initTabNavigation;
initTabNavigation = function () {
  _kioskOrigInitTabNav();
  var tabBtns = document.querySelectorAll('.admin-tab-btn');
  tabBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var isKiosk = btn.getAttribute('data-tab') === 'kiosk';
      _kioskTabActive = isKiosk;
      if (isKiosk && !_kioskProductsLoaded && !_kioskProductsLoading) {
        kioskLoadProducts();
        kioskCheckTerminal();
      }
    });
  });
};
```

---

### `admin.html` (template) -- MODIFY

**Analog:** self (lines 589-638)

**Kiosk browse view structure** (lines 589-638):
```html
<div id="kiosk-view-browse" class="kiosk-view active">
  <div class="kiosk-browse-layout">
    <!-- Left: Product browser -->
    <div class="kiosk-product-pane">
      <div class="kiosk-search-bar">
        <input type="text" id="kiosk-search" class="kiosk-search-input" placeholder="Search products..." />
        <select id="kiosk-category-filter" class="kiosk-category-select">
          <option value="">All Categories</option>
        </select>
        <button type="button" class="btn-secondary kiosk-refresh-btn" id="kiosk-products-refresh">&#8635;</button>
      </div>
      <div id="kiosk-product-grid" class="kiosk-product-grid">
        <p class="kiosk-loading">Loading products...</p>
      </div>
    </div>
    <!-- Right: Cart -->
    <div class="kiosk-cart-pane">
      <!-- ... cart contents ... -->
    </div>
  </div>
</div>
```

**New HTML to add:** Mode toggle buttons above the product grid (inside `kiosk-product-pane`), a new `kiosk-recipe-grid` div, and a `kiosk-recipe-prompt` div for the in-store/take-out selection. These sit alongside the existing `kiosk-product-grid`.

---

### `css/kiosk.css` (style) -- MODIFY

**Analog:** self

**Product card CSS pattern** (lines 498-598):
```css
.kiosk-product-card {
  display: flex;
  flex-direction: column;
  background: var(--cellar-raised);
  border: 1px solid var(--ledger-soft);
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  transition: box-shadow 0.1s;
  min-height: 180px;
  position: relative;
  -webkit-user-select: none;
  user-select: none;
}
```

**Product grid CSS pattern** (lines 479-488):
```css
.kiosk-product-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(175px, 1fr));
  gap: 0.75rem;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  flex: 1;
  min-height: 0;
}
```

**Stock status CSS pattern** (lines 575-593):
```css
.kiosk-product-stock { font-size: 0.72rem; color: var(--ink-tertiary); }
.kiosk-product-stock--low { color: var(--batch-warning); font-weight: 600; }
.kiosk-product-stock--out { color: var(--batch-danger); font-weight: 600; }
.kiosk-product-card--out-of-stock { opacity: 0.55; cursor: pointer; }
```

Recipe card styles should follow the same pattern with recipe-specific class names (`kiosk-recipe-card`, `kiosk-recipe-grid`, `kiosk-recipe-name`, etc.). Availability dot uses the same color scheme: `--batch-warning` for low, `--batch-danger` for out.

---

### `zoho-middleware/__tests__/pos-recipe.test.js` (test) -- NEW

**Analog:** `zoho-middleware/__tests__/recipes.test.js` (for Express route testing pattern) + `zoho-middleware/__tests__/pos-tax.test.js` (for POS mocking pattern)

**Express mock pattern** (recipes.test.js lines 9-19):
```javascript
var mockRouteHandlers = {};
jest.mock('express', function () {
  var router = {
    get:    jest.fn(function (path, handler) { mockRouteHandlers['GET:' + path] = handler; }),
    post:   jest.fn(function (path, handler) { mockRouteHandlers['POST:' + path] = handler; }),
    put:    jest.fn(function (path, handler) { mockRouteHandlers['PUT:' + path] = handler; }),
    delete: jest.fn(function (path, handler) { mockRouteHandlers['DELETE:' + path] = handler; })
  };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});
```

**POS dependency mocks** (pos-tax.test.js lines 10-54):
```javascript
jest.mock('../lib/helcim', function () {
  return {
    isTerminalEnabled: jest.fn().mockReturnValue(true),
    terminalPurchase: jest.fn().mockResolvedValue({ idempotencyKey: 'idem-1' }),
    pollTerminalResult: jest.fn().mockResolvedValue({
      approved: true, transactionId: 'txn-test-123', cardType: 'Visa'
    }),
    voidTransaction: jest.fn().mockResolvedValue({}),
    generateIdempotencyKey: jest.fn().mockReturnValue('idem-so-1')
  };
});
jest.mock('../lib/zoho-api', function () {
  return {
    zohoGet: jest.fn(),
    zohoPost: jest.fn().mockResolvedValue({ invoice: { invoice_id: 'inv-1', invoice_number: 'INV-001' } }),
    zohoPut: jest.fn()
  };
});
jest.mock('../lib/cache', function () {
  return {
    get: jest.fn(),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    acquireLock: jest.fn().mockResolvedValue(true),
    releaseLock: jest.fn().mockResolvedValue()
  };
});
jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
});
jest.mock('../lib/eventLog', function () {
  return { logEvent: jest.fn() };
});
jest.mock('../lib/mailer', function () {
  return { sendVoidFailureAlert: jest.fn() };
});
jest.mock('../lib/constants', function () {
  return {
    CACHE_KEYS: {
      KIOSK_PRODUCTS: 'test:kiosk-products',
      RECIPES: 'sv:recipes',
      RECIPES_TS: 'sv:recipes:ts',
      INGREDIENTS: 'zoho:ingredients'
    },
    LOCK_KEYS: { RECIPE_SALE: 'recipe-sale' }
  };
});
jest.mock('../lib/brewpad-integration', function () {
  return {
    detectRecipeSale: jest.fn(),
    createBatchesFromSale: jest.fn()
  };
});
```

**Handler invocation pattern** (recipes.test.js lines 57-70):
```javascript
function callHandler(method, path, req) {
  return new Promise(function (resolve, reject) {
    var key = method + ':' + path;
    var handler = mockRouteHandlers[key];
    if (!handler) return reject(new Error('No handler registered for ' + key));
    var res = {
      _status: 200,
      _body: null,
      status: jest.fn(function (s) { res._status = s; return res; }),
      json:   jest.fn(function (b) { res._body = b; resolve(res); return res; })
    };
    try { handler(req || {}, res); } catch (e) { reject(e); }
  });
}
```

**beforeEach env setup pattern** (recipes.test.js lines 83-85):
```javascript
beforeEach(function () {
  process.env.APPS_SCRIPT_URL = 'https://script.google.com/test';
  process.env.APPS_SCRIPT_SERVER_TOKEN = 'test-token';
  process.env.BEER_SALES_ENABLED = 'true';
  process.env.MAKERS_FEE_ITEM_ID = 'fee-makers-1';
  process.env.MATERIALS_FEE_ITEM_ID = 'fee-materials-1';
});
```

---

### `zoho-middleware/__tests__/brewpad-recipe.test.js` (test) -- NEW

**Analog:** `zoho-middleware/__tests__/brewpad-integration.test.js`

**Mock setup pattern** (brewpad-integration.test.js lines 4-31):
```javascript
jest.mock('../lib/cache', function () {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(),
    del: jest.fn().mockResolvedValue(),
    isConnected: jest.fn().mockReturnValue(true),
    getClient: jest.fn().mockResolvedValue({ keys: jest.fn().mockResolvedValue([]) })
  };
});
jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
});
jest.mock('../lib/eventLog', function () {
  return { logEvent: jest.fn() };
});
jest.mock('axios');
```

**beforeEach/afterEach env pattern** (brewpad-integration.test.js lines 40-61):
```javascript
beforeEach(function () {
  jest.clearAllMocks();
  cache.isConnected.mockReturnValue(true);
  cache.get.mockResolvedValue(null);
  cache.set.mockResolvedValue();
  cache.del.mockResolvedValue();
  process.env.APPS_SCRIPT_URL = 'https://script.google.com/test';
  process.env.APPS_SCRIPT_SERVER_TOKEN = 'test-token';
});
afterEach(function () {
  delete process.env.APPS_SCRIPT_URL;
  delete process.env.APPS_SCRIPT_SERVER_TOKEN;
});
```

**Test assertion pattern** (brewpad-integration.test.js lines 184-197):
```javascript
it('calls Apps Script for each kit item when Makers Fee is present', function () {
  axios.post.mockResolvedValue({ data: { ok: true, batch_id: 'SV-B-000001' } });
  var items = [ /* ... */ ];
  brewpadIntegration.createBatchesFromSale(items, 'INV-001', 'Jane Doe', 'C-123', null);
  expect(axios.post).toHaveBeenCalledTimes(2);
  var callPayload = JSON.parse(axios.post.mock.calls[0][1]);
  expect(callPayload.customer_firstname).toBe('Jane');
});
```

---

## Shared Patterns

### Authentication / API Key Guard
**Source:** `zoho-middleware/server.js` (requireApiKey middleware, applied to all `/api/*` POST routes)
**Apply to:** `pos-recipe.js` -- automatically covered by server.js middleware; no additional auth code needed in the route file.

### Feature Gate
**Source:** New pattern, modeled on env var checks throughout codebase
**Apply to:** `pos-recipe.js` (both initiate and confirm endpoints)
```javascript
if ((process.env.BEER_SALES_ENABLED || 'false').toLowerCase() !== 'true') {
  return res.status(403).json({ error: 'Recipe sales are not enabled' });
}
```

### Error Handling -- Void on Zoho Failure
**Source:** `zoho-middleware/routes/pos.js` lines 1142-1190 (salesorder-pay void path)
**Apply to:** `pos-recipe.js` confirm endpoint
```javascript
helcimLib.voidTransaction(txnId)
  .then(function () { log.info('[...] Voided txn=' + txnId); })
  .catch(function (voidErr) {
    log.error('[...] CRITICAL: Void failed for txn=' + txnId + ': ' + voidErr.message);
    cache.set('sv:void-failure:' + Date.now(), failRecord, 60 * 60 * 24 * 30).catch(function () {});
    mailer.sendVoidFailureAlert({ txnId: txnId, amount: amount, error: voidErr.message }).catch(function () {});
  });
```

### Event Logging
**Source:** `zoho-middleware/lib/eventLog.js`
**Apply to:** `pos-recipe.js` (sale completed, sale failed), `brewpad-integration.js` (recipe batch created)
```javascript
eventLog.logEvent('kiosk.recipe_sale_completed', {
  txnId: txnId, recipeId: recipeId, saleType: saleType, total: grandTotal, invoiceNumber: invoiceNumber
});
```

### Redis Lock / Unlock
**Source:** `zoho-middleware/lib/cache.js` lines 106-125
**Apply to:** `pos-recipe.js` initiate and confirm endpoints
```javascript
cache.acquireLock(key, ttlSeconds) // returns Promise<boolean>
cache.releaseLock(key)             // returns Promise<void>
```
Key naming: Use `C.LOCK_KEYS.RECIPE_SALE` (added in constants.js) to centralize.

### Cache Bust After Sale
**Source:** `zoho-middleware/routes/pos.js` line 507
**Apply to:** `pos-recipe.js` confirm endpoint -- must bust BOTH product and ingredient caches
```javascript
cache.del(C.CACHE_KEYS.KIOSK_PRODUCTS);
cache.del(C.CACHE_KEYS.INGREDIENTS);    // recipe sale uses ingredients, not just kiosk products
```

### Kiosk CSS Naming Convention
**Source:** `css/kiosk.css` -- all classes use `kiosk-` prefix with BEM-like modifiers (`--out-of-stock`, `--low`)
**Apply to:** New recipe card styles: `kiosk-recipe-grid`, `kiosk-recipe-card`, `kiosk-recipe-card--unavailable`, `kiosk-recipe-name`, `kiosk-recipe-price`, `kiosk-recipe-avail`, `kiosk-sale-type-btn`, `kiosk-recipe-prompt`

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | | | All 10 files have strong analogs in the existing codebase. Phase 14 is wiring existing patterns. |

---

## Metadata

**Analog search scope:** `zoho-middleware/routes/`, `zoho-middleware/lib/`, `zoho-middleware/__tests__/`, `js/admin.js`, `admin.html`, `css/kiosk.css`
**Files scanned:** 14 source files read, 10 analog matches established
**Pattern extraction date:** 2026-05-17
