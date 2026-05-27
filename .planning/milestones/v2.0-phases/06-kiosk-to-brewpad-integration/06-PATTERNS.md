# Phase 6: Kiosk-to-Brewpad Integration - Pattern Map

**Mapped:** 2026-05-03
**Files analyzed:** 6 new/modified files
**Analogs found:** 6 / 6

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `zoho-middleware/routes/pos.js` | controller | request-response | Self (existing handler at line 393) | exact |
| `zoho-middleware/lib/brewpad-integration.js` | service | event-driven (fire-and-forget + retry) | `zoho-middleware/lib/checkout-helpers.js` (`notifyAdminPanel`) | exact |
| `zoho-middleware/lib/constants.js` | config | N/A | Self (existing constants module) | exact |
| `apps-script/adminApi.gs` | service | CRUD (Sheets write) | Self (`createBatch` at line 1642, `doPost` at line 178) | exact |
| `js/brewpad.js` | component | request-response (UI render) | Self (existing `STATUS_LABELS`/`renderBatchList`/`renderBatchDetail`) | exact |
| `css/brewpad.css` | config | N/A | Self (existing `.bp-status-badge--*` rules) | exact |

## Pattern Assignments

### `zoho-middleware/lib/brewpad-integration.js` (NEW service, event-driven fire-and-forget)

**Analog:** `zoho-middleware/lib/checkout-helpers.js`

**Imports pattern** (lines 1-7):
```javascript
var https = require('https');
var fs = require('fs');
var path = require('path');
var querystring = require('querystring');
var log = require('./logger');
var pricing = require('./pricing');
var axios = require('axios');
```

For the new file, use this subset (no `https`/`fs`/`path`/`querystring`/`pricing` needed):
```javascript
var axios = require('axios');
var log = require('./logger');
var eventLog = require('./eventLog');
var cache = require('./cache');
var C = require('./constants');
var checkoutHelpers = require('./checkout-helpers');
```

**Core fire-and-forget pattern** (checkout-helpers.js lines 85-118):
```javascript
function notifyAdminPanel(soNumber, customerName, customerEmail, customerPhone, lineItems, timeslot, notes) {
  var url = process.env.APPS_SCRIPT_URL;
  var token = process.env.APPS_SCRIPT_SERVER_TOKEN;
  if (!url || !token) return; // not configured -- skip silently

  var payload = {
    action: 'add_reservation',
    server_token: token,
    customer_name: customerName || '',
    customer_email: customerEmail || '',
    customer_phone: customerPhone || '',
    order_number: soNumber || '',
    timeslot: timeslot || '',
    notes: notes || '',
    items: (lineItems || []).map(function (li) {
      return { name: li.name || '', quantity: li.quantity || 1 };
    })
  };

  axios.post(url, JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
    timeout: 12000,
    maxRedirects: 5
  }).then(function (resp) {
    var data = resp.data || {};
    if (data.ok) {
      log.info('[checkout] Admin panel updated -- reservation_id=' + (data.reservation_id || '?') + ' order=' + soNumber);
    } else {
      log.warn('[checkout] Admin panel returned error: ' + (data.message || data.error || JSON.stringify(data)));
    }
  }).catch(function (err) {
    log.warn('[checkout] Admin panel notification failed (non-fatal): ' + err.message);
  });
}
```

The new `createBatchFromSale` function mirrors this pattern exactly, but the `.catch` branch must also write to Redis retry queue via `cache.set()`.

**Maker's Fee detection pattern** (checkout-helpers.js lines 160-171):
```javascript
function findMakersFeeItem(services, makersFeeItemId) {
  if (!Array.isArray(services)) return null;
  for (var i = 0; i < services.length; i++) {
    var s = services[i];
    if (!s) continue;
    if (makersFeeItemId && s.item_id === makersFeeItemId) return s;
    var sku = (s.sku || '').toUpperCase();
    var name = (s.name || '').toLowerCase();
    if (sku === 'MAKERS-FEE' || name.indexOf('makers fee') !== -1 || name.indexOf("maker's fee") !== -1) return s;
  }
  return null;
}
```

Do NOT duplicate this function. Import and reuse it from `checkout-helpers.js`. Apply the same detection logic to `lineItems` in the sale payload.

**Redis cache.set pattern** (cache.js lines 80-88):
```javascript
function set(key, value, ttlSeconds) {
  if (!connected) return Promise.resolve();

  return getClient().then(function (c) {
    return c.set(key, JSON.stringify(value), { EX: ttlSeconds });
  }).catch(function (err) {
    log.error('[redis] Failed to set cache: ' + err.message);
  });
}
```

Use `cache.set(C.CACHE_KEYS.BATCH_RETRY_PREFIX + key, payload, 86400)` for retry queue entries.

**Event logging pattern** (eventLog.js lines 26-32):
```javascript
function logEvent(eventType, data) {
  var extra = { event: eventType };
  if (data && typeof data === 'object') {
    Object.keys(data).forEach(function (k) { extra[k] = data[k]; });
  }
  log.info('[event] ' + eventType, extra);
}
```

Use `eventLog.logEvent('kiosk.batch_created', { invoiceNumber: ..., batchId: ... })` on success and `eventLog.logEvent('kiosk.batch_retry_queued', { invoiceNumber: ..., reason: ... })` on failure. Follow zero-PII policy: no `customer_name` or `customer_email` in event data.

**Module exports pattern** (checkout-helpers.js lines 173-180):
```javascript
module.exports = {
  readServicesSnapshot: readServicesSnapshot,
  withTimeout: withTimeout,
  verifyRecaptcha: verifyRecaptcha,
  notifyAdminPanel: notifyAdminPanel,
  buildLineItems: buildLineItems,
  findMakersFeeItem: findMakersFeeItem
};
```

---

### `zoho-middleware/routes/pos.js` (controller modification, request-response)

**Analog:** Self -- insert into existing `sale/confirm` handler

**Imports pattern** (lines 1-9):
```javascript
var express = require('express');
var helcimLib = require('../lib/helcim');
var zohoApi = require('../lib/zoho-api');
var cache = require('../lib/cache');
var log = require('../lib/logger');
var eventLog = require('../lib/eventLog');
var mailer = require('../lib/mailer');
var ledger = require('../lib/inventory-ledger');
var C = require('../lib/constants');
```

Add new import:
```javascript
var brewpadIntegration = require('../lib/brewpad-integration');
```

**Insertion point** (lines 505-518) -- inside `paymentChain.then()`, after `eventLog.logEvent` and before building the response:
```javascript
return paymentChain.then(function () {
  cache.del(KIOSK_PRODUCTS_CACHE_KEY);
  ledger.decrementStock(lineItems, 'kiosk:' + (invoiceNumber || 'unknown')).catch(function () {});

  eventLog.logEvent('kiosk.sale_completed', {
    txnId: txnId, itemCount: lineItems.length, grandTotal: grandTotal, invoiceNumber: invoiceNumber
  });

  // NEW: trigger batch creation for any kit items with Maker's Fee
  // Fire-and-forget -- does NOT delay the sale response
  brewpadIntegration.createBatchesFromSale(lineItems, invoiceNumber, body.customer_name || '', body.contact_id || '', catalogMap);

  var result = {
    ok: true, transaction_id: txnId, invoice_id: invoiceId, invoice_number: invoiceNumber,
    reference_number: refNumber, subtotal: subtotal, tax_total: taxTotal, total: grandTotal, date: today
  };
  if (discountApplied) result.discount_applied = discountApplied;
  res.status(201).json(result);
});
```

Key constraint: the `createBatchesFromSale` call must be fire-and-forget (no `await`, no `.then()` chaining before `res.status(201)`). This mirrors the `ledger.decrementStock(...).catch(function () {})` pattern on the line immediately above it.

---

### `zoho-middleware/lib/constants.js` (config modification)

**Analog:** Self

**Existing pattern** (lines 40-56):
```javascript
  // Collect payment (Zoho SO -> Helcim terminal)
  COLLECT_IDEM_PREFIX:    'collect:idem:',
  COLLECT_PENDING_PREFIX: 'collect:pending:',

  // Kiosk sales order management
  KIOSK_SALESORDERS:      'kiosk:salesorders',
```

Add new key following the exact same comment + key naming convention:
```javascript
  // Brewpad batch creation retry queue
  BATCH_RETRY_PREFIX:     'brewpad:pending-batch:',
```

---

### `apps-script/adminApi.gs` (service modification, CRUD Sheets write)

**Analog:** Self -- `doPost` server-token branch (lines 191-201) and `createBatch` (lines 1642-1768)

**doPost server-token branch pattern** (lines 191-201):
```javascript
// Server-to-server writes from Railway middleware (no Google OAuth required)
if (payload.server_token) {
  var scriptProps = PropertiesService.getScriptProperties();
  var storedToken = scriptProps.getProperty('SERVER_WRITE_TOKEN') || '';
  if (!storedToken || payload.server_token !== storedToken) {
    return _jsonResponse({ ok: false, error: 'unauthorized', message: 'Invalid server token' });
  }
  if (action === 'add_reservation') {
    return _jsonResponse(addReservation(payload));
  }
  return _jsonResponse({ ok: false, error: 'invalid_action', message: 'Unknown server action: ' + action });
}
```

Add `create_batch` handling before the `invalid_action` return, following the exact same `if (action === '...') { ... return _jsonResponse(...); }` structure. Pass `'kiosk-middleware'` as the synthetic `userEmail` argument.

**createBatch required fields guard** (line 1643):
```javascript
if (!payload.product_sku || !payload.customer_name || !payload.start_date || !payload.schedule_id) {
  return { ok: false, error: 'missing_fields', message: 'product_sku, customer_name, start_date, and schedule_id are required' };
}
```

Change to pending-mode aware validation:
```javascript
var isPending = !payload.schedule_id || !payload.start_date;
if (!payload.product_sku || !payload.customer_name) {
  return { ok: false, error: 'missing_fields', message: 'product_sku and customer_name are required' };
}
```

**createBatch appendRow pattern** (lines 1681-1701) -- 19 values positionally mapped to 19 columns:
```javascript
batchesSheet.appendRow([
  batchId,
  'primary',
  sanitizeInput(payload.product_sku),
  sanitizeInput(payload.product_name || ''),
  sanitizeInput(payload.customer_id || ''),
  sanitizeInput(payload.customer_name),
  sanitizeInput(payload.customer_email || ''),
  payload.start_date,
  payload.schedule_id,
  scheduleSnapshot,
  sanitizeInput(payload.vessel_id || ''),
  sanitizeInput(payload.shelf_id || ''),
  sanitizeInput(payload.bin_id || ''),
  sanitizeInput(payload.notes || ''),
  accessToken,
  sanitizeInput(payload.reservation_id || ''),
  now,
  userEmail,
  now
]);
```

Append 3 new values at positions 20-22 (end of array). For pending mode: position 2 changes from `'primary'` to `isPending ? 'pending' : 'primary'`; `start_date` and `schedule_id` can be empty strings.

**Schedule validation bypass** -- when `isPending === true`, skip these operations:
- `findRowById(FERM_SCHEDULES_SHEET_NAME, payload.schedule_id)` (line 1648)
- Task creation loop (lines 1703-1732)
- Vessel placement recording (lines 1735-1751)
- Vessel status update (lines 1754-1758)

**Response pattern** (line 1760):
```javascript
var resp = { ok: true, batch_id: batchId, access_token: accessToken, tasks_created: tasksCreated };
if (taskErrors.length > 0) {
  resp.warnings = taskErrors;
}
return resp;
```

---

### `js/brewpad.js` (component modification, UI render)

**Analog:** Self -- existing `STATUS_LABELS`/`STATUS_COLORS`, filter bar, list rows, detail view

**Status maps pattern** (lines 968-969):
```javascript
var STATUS_LABELS = { primary: 'Primary', secondary: 'Secondary', complete: 'Complete', active: 'Active', packaging: 'Packaging' };
var STATUS_COLORS = { primary: 'info', secondary: 'warning', complete: 'success', active: 'info', packaging: 'warning' };
```

Add `pending: 'Pending'` and `pending: 'neutral'` (or `'warning'` -- see CSS section).

**Filter bar pattern** (lines 1004-1009):
```javascript
var filterOpts = [
  { val: 'active', label: 'Active' },
  { val: 'primary', label: 'Primary' },
  { val: 'secondary', label: 'Secondary' },
  { val: 'complete', label: 'Complete' }
];
```

Add `{ val: 'pending', label: 'Pending' }` to the array.

**Table row status badge pattern** (line 1149):
```javascript
resultsHtml += '<td><span class="bp-status-badge bp-status-badge--' + statusColor + '" style="font-size:0.72rem;padding:1px 6px;">' + escapeHTML(statusLabel) + '</span></td>';
```

After this line, add the kiosk badge conditionally:
```javascript
if (b.source === 'kiosk' && statusKey === 'pending') {
  resultsHtml += ' <span class="bp-kiosk-badge">Kiosk</span>';
}
```

**Card view status badge pattern** (line 1182):
```javascript
resultsHtml += '<span class="bp-status-badge bp-status-badge--' + statusColor + '">' + escapeHTML(statusLabel) + '</span>';
```

Same kiosk badge insertion after the status badge span.

**Detail view info grid pattern** (lines 1539-1542):
```javascript
html += '<div class="bp-detail-info">';
html += '<div class="bp-detail-info-row"><span class="bp-detail-info-label">Product</span><span>' + escapeHTML(b.product_name || b.product_sku || '—') + '</span></div>';
html += '<div class="bp-detail-info-row"><span class="bp-detail-info-label">Customer</span><span>' + escapeHTML(b.customer_name || '—') + '</span></div>';
html += '<div class="bp-detail-info-row"><span class="bp-detail-info-label">Start</span><span>' + fmtDate(b.start_date) + '</span></div>';
html += '</div>';
```

Add a new `bp-detail-info-row` for `zoho_so_number` following the same structure, conditionally:
```javascript
if (b.zoho_so_number) {
  html += '<div class="bp-detail-info-row"><span class="bp-detail-info-label">Zoho Ref</span><span>' + escapeHTML(b.zoho_so_number) + '</span></div>';
}
```

---

### `css/brewpad.css` (config modification, CSS rules)

**Analog:** Self -- existing status badge CSS block

**Status badge CSS pattern** (lines 403-415):
```css
.bp-status-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.bp-status-badge--success { background: var(--batch-success-bg); color: var(--batch-success); }
.bp-status-badge--warning { background: var(--batch-warning-bg); color: var(--batch-warning); }
.bp-status-badge--danger  { background: var(--batch-danger-bg);  color: var(--batch-danger);  }
.bp-status-badge--info    { background: var(--batch-info-bg);    color: var(--batch-info);    }
```

No `--neutral` variant exists. Two options:
1. Use `--warning` for pending (amber = "needs attention") -- no new CSS needed, just set `STATUS_COLORS.pending = 'warning'`
2. Add a neutral grey variant following the existing single-line pattern:
```css
.bp-status-badge--neutral { background: rgba(107, 84, 66, 0.08); color: var(--ink-secondary); }
```

**New kiosk badge** -- follows the same `display: inline-block` + small pill pattern:
```css
.bp-kiosk-badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  background: rgba(74, 111, 138, 0.12);
  color: var(--batch-info);
  margin-left: 4px;
}
```

---

## Shared Patterns

### Apps Script HTTP Call (fire-and-forget)
**Source:** `zoho-middleware/lib/checkout-helpers.js` lines 85-118
**Apply to:** `zoho-middleware/lib/brewpad-integration.js`
```javascript
var url = process.env.APPS_SCRIPT_URL;
var token = process.env.APPS_SCRIPT_SERVER_TOKEN;
if (!url || !token) return; // not configured -- skip silently

axios.post(url, JSON.stringify(payload), {
  headers: { 'Content-Type': 'application/json' },
  timeout: 12000,
  maxRedirects: 5
}).then(function (resp) {
  // log success
}).catch(function (err) {
  // log failure + write to retry queue
});
```

### Error Logging
**Source:** `zoho-middleware/lib/logger.js`
**Apply to:** All middleware files
```javascript
var log = require('./logger');
log.info('[module-tag] Success message: ' + detail);
log.warn('[module-tag] Non-fatal: ' + err.message);
log.error('[module-tag] Fatal: ' + err.message);
```

### Event Logging (zero PII)
**Source:** `zoho-middleware/lib/eventLog.js`
**Apply to:** `brewpad-integration.js`
```javascript
var eventLog = require('./eventLog');
eventLog.logEvent('kiosk.batch_created', { invoiceNumber: invoiceNumber, batchId: batchId });
// NEVER include customer_name, customer_email, or payment_token
```

### Input Sanitization (Apps Script)
**Source:** `apps-script/adminApi.gs` -- `sanitizeInput` function (referenced throughout `createBatch`)
**Apply to:** All new fields written to Sheets in the `appendRow` call
```javascript
sanitizeInput(payload.zoho_so_number || '')
sanitizeInput(payload.source || 'manual')
```

### Constants Key Naming
**Source:** `zoho-middleware/lib/constants.js`
**Apply to:** New `BATCH_RETRY_PREFIX` key
Convention: `namespace:purpose:` with trailing colon for prefix keys. Group with a comment header.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | -- | -- | All files have exact analogs in the existing codebase |

## Metadata

**Analog search scope:** `zoho-middleware/lib/`, `zoho-middleware/routes/`, `apps-script/`, `js/`, `css/`
**Files scanned:** 9 analog files read
**Pattern extraction date:** 2026-05-03
