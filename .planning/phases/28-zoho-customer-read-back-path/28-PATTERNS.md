# Phase 28: Zoho Customer Read-Back Path — Pattern Map

**Mapped:** 2026-06-11
**Files analyzed:** 3 (1 new route handler, 1 new test file, 1 Apps Script edit)
**Analogs found:** 3 / 3

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `zoho-middleware/routes/pos.js` (add GET handler) | route | request-response | `pos.js` lines 1338–1367 (`search-invoices`) + 1304–1335 (`sync-zoho`) | exact |
| `zoho-middleware/__tests__/batch-customer.test.js` | test | request-response | `zoho-middleware/__tests__/kiosk-salesorders.test.js` | exact |
| `apps-script/adminApi.gs` (extend `allowedFields`) | config/model | CRUD | `adminApi.gs` lines 2157–2165 (existing `allowedFields` array, `start_date` Phase 27 precedent) | exact |

---

## Pattern Assignments

### `zoho-middleware/routes/pos.js` — add `GET /api/batch/customer-by-number`

**Primary analog:** `pos.js` lines 1338–1367 (`GET /api/batch/search-invoices`)
**Secondary analog:** `pos.js` lines 1304–1335 (`POST /api/batch/sync-zoho`)

---

**Imports pattern** — already present at top of file (lines 1–14):

```javascript
var express = require('express');
var zohoApi = require('../lib/zoho-api');
var log = require('../lib/logger');
// ...
var zohoGet = zohoApi.zohoGet;
```

No new requires needed. The new handler composes `zohoGet` already destructured at line 12.

---

**Auth/guard pattern** (lines 1306–1309 and 1339–1342) — copy verbatim:

```javascript
var apiKey = req.headers['x-api-key'] || req.query.api_key;
if (apiKey !== process.env.MW_API_KEY) {
  return res.status(401).json({ error: 'Unauthorized' });
}
```

Both `sync-zoho` and `search-invoices` use this identical block. The new GET handler is the same category (staff batch endpoint) and must replicate it.

---

**Input validation pattern** (lines 1344–1347, `search-invoices`):

```javascript
var search = (req.query.search || '').trim();
if (!search || search.length < 2) {
  return res.status(400).json({ error: 'Search term must be at least 2 characters' });
}
```

Adapt for D-16: swap the length check for the prefix regex. The `.trim()` and `|| ''` defensive coercion are the established pattern.

---

**IMPORTANT: zohoGet params-object form** (lines 73–85, `lib/zoho-api.js`):

```javascript
function zohoGet(path, params) {
  return zohoAuth.getAccessToken().then(function (token) {
    var query = Object.assign({ organization_id: process.env.ZOHO_ORG_ID }, params || {});
    // ...
  });
}
```

`zohoGet` merges `organization_id` via `Object.assign` on the second argument. Pass filter params as an object, NOT as a pre-built query string. The `search-invoices` handler at line 1349 uses string concat (`'/invoices?search_text=' + ...`) — that is the **anti-pattern** for this phase. Use the params-object form:

```javascript
// CORRECT for Phase 28:
zohoGet('/invoices', { invoice_number: number })

// WRONG (search-invoices legacy approach — do not copy):
zohoGet('/invoices?search_text=' + encodeURIComponent(search))
```

---

**Zoho call + response shaping pattern** (lines 1349–1366, `search-invoices`):

```javascript
zohoGet('/invoices?search_text=' + encodeURIComponent(search))
  .then(function (data) {
    var invoices = (data.invoices || []).map(function (inv) {
      return {
        invoice_id: inv.invoice_id,
        invoice_number: inv.invoice_number,
        customer_name: inv.customer_name,
        customer_id: inv.customer_id || '',
        // ...
      };
    });
    res.json({ invoices: invoices });
  })
  .catch(function (err) {
    log.error('[batch/search-invoices] Zoho error: ' + (err.message || err));
    res.status(502).json({ error: 'Invoice search failed' });
  });
```

The new handler follows this same `.then()/.catch()` promise chain structure. Differences: (a) use params-object form, (b) empty-array check triggers 404 instead of returning empty list, (c) chain a second `zohoGet` inside the first `.then()` for the contact fetch, (d) contact fetch failure produces partial 200 (D-15) not 502.

---

**Log prefix convention** (lines 1332, 1364, 1408):

```javascript
log.error('[batch/sync-zoho] Unexpected error: ' + err.message);
log.error('[batch/search-invoices] Zoho error: ' + (err.message || err));
log.error('[kiosk/so-detail] Zoho error: ' + msg);
```

New handler log prefix: `'[batch/customer-by-number]'`.

---

**SO detail response shaping analog** (lines 1374–1411, `GET /api/kiosk/salesorder/:id`):

```javascript
router.get('/api/kiosk/salesorder/:id', function (req, res) {
  zohoGet('/salesorders/' + soId)
    .then(function (data) {
      var so = data.salesorder || {};
      res.json({
        salesorder_id: so.salesorder_id || '',
        customer_name: so.customer_name || '',
        customer_id: so.customer_id || '',
        status: so.status || '',
        // ...
      });
    })
    .catch(function (err) {
      var msg = err.message;
      if (err.response && err.response.data) {
        msg = err.response.data.message || err.response.data.error || msg;
      }
      log.error('[kiosk/so-detail] Zoho error: ' + msg);
      res.status(502).json({ error: 'Failed to fetch sales order' });
    });
});
```

The `|| ''` defensive defaults on each field and the `.catch()` 502 block are both applicable to the new handler's contact fetch path.

---

### `zoho-middleware/__tests__/batch-customer.test.js` (new file)

**Analog:** `zoho-middleware/__tests__/kiosk-salesorders.test.js`

---

**Mock block pattern** (lines 1–64, `kiosk-salesorders.test.js`) — the canonical mock set for pos.js route tests:

```javascript
'use strict';

jest.mock('../lib/helcim', function () { return {
  isTerminalEnabled: jest.fn().mockReturnValue(true),
  // ...
}; });
jest.mock('../lib/zoho-api', function () { return {
  zohoGet: jest.fn(),
  zohoPost: jest.fn(),
  zohoPut: jest.fn()
}; });
jest.mock('../lib/cache', function () { return {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  isConnected: jest.fn().mockReturnValue(true)
}; });
jest.mock('../lib/eventLog', function () { return { logEvent: jest.fn() }; });
jest.mock('../lib/logger', function () { return { info: jest.fn(), warn: jest.fn(), error: jest.fn() }; });
jest.mock('../lib/mailer', function () { return {
  sendVoidFailureAlert: jest.fn().mockResolvedValue()
}; });
jest.mock('../lib/inventory-ledger', function () { return {
  decrementStock: jest.fn().mockResolvedValue()
}; });

require('../routes/pos');
```

All of these mocks are required because `require('../routes/pos')` at the top level loads the entire file, which requires all of these modules at parse time. The new test file must include the same mock block even though it only tests the `customer-by-number` handler. Omitting any mock will cause the `require` to fail.

Note: `helcim`, `mailer`, and `inventory-ledger` are "stub" mocks — they are not exercised by the new tests but must be declared to satisfy pos.js's top-level requires.

---

**Route handler capture pattern** (lines 47–75, `kiosk-salesorders.test.js`):

```javascript
var _routeRegistry = { get: [], post: [], put: [] };

jest.mock('express', function () {
  var router = {
    get: jest.fn(function (path, handler) {
      _routeRegistry.get.push({ path: path, handler: handler });
    }),
    post: jest.fn(function (path, handler) {
      _routeRegistry.post.push({ path: path, handler: handler });
    }),
    put: jest.fn(function (path, handler) {
      _routeRegistry.put.push({ path: path, handler: handler });
    })
  };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});

require('../routes/pos');

function findHandler(method, path) {
  var entries = _routeRegistry[method] || [];
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].path === path) return entries[i].handler;
  }
  throw new Error('No ' + method.toUpperCase() + ' handler registered for ' + path);
}

var customerByNumberHandler = findHandler('get', '/api/batch/customer-by-number');
```

This is the standard capture mechanism for all pos.js handler tests. The `jest.mock('express', ...)` must come before `require('../routes/pos')`.

---

**req/res helper pattern** (lines 85–109, `kiosk-salesorders.test.js`):

```javascript
function makeReq(body, query, headers) {
  return { body: body || {}, query: query || {}, headers: headers || {} };
}

function makeRes() {
  var res = {
    _status: null,
    _json: null,
    headersSent: false
  };
  res.status = jest.fn(function (code) {
    res._status = code;
    return res;
  });
  res.json = jest.fn(function (data) {
    res._json = data;
    res.headersSent = true;
    return res;
  });
  return res;
}

function flushPromises() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}
```

Copy these three helpers verbatim. The new test file only calls `GET` so `body` in `makeReq` is unused — keep the signature for consistency. The `flushPromises` helper is required for all async handler tests (the handler returns a promise chain that resolves after the tick).

---

**beforeEach / MW_API_KEY env pattern** (lines 545–552, `kiosk-salesorders.test.js`):

```javascript
var OLD_MW_KEY;

beforeEach(function () {
  jest.clearAllMocks();
  OLD_MW_KEY = process.env.MW_API_KEY;
  process.env.MW_API_KEY = 'test-api-key';
});

afterEach(function () {
  process.env.MW_API_KEY = OLD_MW_KEY;
});
```

Required because `sync-zoho` and `search-invoices` check `process.env.MW_API_KEY` — the new handler does the same. Save and restore the env var to avoid test pollution.

---

**Sequential mock return pattern** (lines 126–131, `kiosk-salesorders.test.js`):

```javascript
zohoApi.zohoGet
  .mockResolvedValueOnce({ invoices: [{ ... }] })   // call 1: document lookup
  .mockResolvedValueOnce({ contact: { ... } });      // call 2: contact detail
```

Use `mockResolvedValueOnce` chained for the two-call sequence (document list then contact). Use `mockRejectedValueOnce` for the second call to test D-15 (contact fetch failure → partial 200).

---

### `apps-script/adminApi.gs` — extend `updateBatch()` `allowedFields`

**Analog:** `adminApi.gs` lines 2157–2165 (existing `allowedFields` array)

---

**allowedFields extension pattern** (lines 2157–2165):

```javascript
var allowedFields = [
  'status', 'vessel_id', 'shelf_id', 'bin_id', 'notes',
  // Phase 7: SO linking fields (D-04, D-05) and lifecycle date columns (D-09)
  'zoho_so_number', 'customer_id', 'customer_name', 'product_name',
  'customer_firstname', 'customer_lastname',
  'fermentation_started_at', 'completed_at',
  'recipe_id',   // Phase 16: recipe_id safe through sanitizeInput
  'start_date'   // Phase 27: guided activation sets start_date before schedule generation
  // Phase 28: add 'customer_email' and 'customer_phone' here
];
```

Add two strings at the end, following the `start_date` Phase 27 precedent exactly. The mechanism at lines 2166–2173 iterates this array, looks up the column index by header name (`headers.indexOf(field)`), and calls `sanitizeInput(String(updates[field]))` before writing to the sheet cell. No other code changes are needed in `updateBatch()`.

---

**sanitizeInput verification** (lines 3126–3156):

`sanitizeInput` strips script tags, event handlers, `javascript:` URLs, and HTML element tags. It does NOT strip `@` symbols, `+`, `-`, digits, `.`, `(`, `)`, or spaces — email addresses (e.g. `anne@example.com`) and phone numbers (e.g. `604-555-0100` or `+1 (604) 555-0100`) pass through unchanged.

---

**Optimistic locking — caller's responsibility** (lines 2089–2099):

```javascript
if (payload.expectedVersion) {
  var serverVersion = current.last_updated;
  if (serverVersion) {
    var serverTime = new Date(serverVersion).getTime();
    var clientTime = new Date(payload.expectedVersion).getTime();
    if (serverTime > clientTime) {
      return { ok: false, error: 'version_conflict', message: 'Batch was modified by another user. Refresh and try again.' };
    }
  }
}
```

This runs before `allowedFields` writes. The Phase 29 browser caller must pass `expectedVersion` (the batch's `last_updated` timestamp) when calling `update_batch`. Phase 28 does not change this mechanism — it is documented here so the planner notes it in Phase 29's requirements.

---

## Shared Patterns

### x-api-key Authentication
**Source:** `zoho-middleware/routes/pos.js` lines 1306–1309 and 1339–1342
**Apply to:** `GET /api/batch/customer-by-number` handler

```javascript
var apiKey = req.headers['x-api-key'] || req.query.api_key;
if (apiKey !== process.env.MW_API_KEY) {
  return res.status(401).json({ error: 'Unauthorized' });
}
```

### 502 Zoho Error Response
**Source:** `pos.js` lines 1363–1366, 1403–1410
**Apply to:** outer `.catch()` on the document lookup call

```javascript
.catch(function (err) {
  log.error('[batch/customer-by-number] Zoho error: ' + (err.message || err));
  res.status(502).json({ error: 'zoho_error', message: 'Failed to retrieve document from Zoho' });
});
```

### zohoGet params-object form (CRITICAL — do not use string concat)
**Source:** `zoho-middleware/lib/zoho-api.js` lines 73–85
**Apply to:** both Zoho calls in the new handler

```javascript
// Organization ID is merged automatically — always pass params as the second argument:
zohoGet('/invoices', { invoice_number: number })
zohoGet('/contacts/' + customerId)  // path-only form is fine for detail endpoints
```

---

## No Analog Found

None. All three deliverables have exact analogs in the codebase.

---

## Metadata

**Analog search scope:** `zoho-middleware/routes/pos.js`, `zoho-middleware/lib/zoho-api.js`, `zoho-middleware/__tests__/kiosk-salesorders.test.js`, `zoho-middleware/__tests__/batch-sync.test.js`, `zoho-middleware/__tests__/contacts.test.js`, `apps-script/adminApi.gs`
**Files scanned:** 6 analog files read in full or targeted ranges
**Pattern extraction date:** 2026-06-11
