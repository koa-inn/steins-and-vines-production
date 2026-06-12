# Phase 29: Refresh-from-Zoho Admin UI - Pattern Map

**Mapped:** 2026-06-11
**Files analyzed:** 3 (js/admin.js, js/brewpad.js, tests/frontend/brewpad-zoho-refresh.test.js [new])
**Analogs found:** 3 / 3

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `js/admin.js` (renderBatchDetailModal + refresh handler) | controller | request-response | `js/admin.js` activate/notes handlers (~5951–6064) | exact |
| `js/brewpad.js` (Invoice section + refresh handler) | controller | request-response | `js/brewpad.js` link-invoice handler (~740–778) | exact |
| `tests/frontend/brewpad-zoho-refresh.test.js` (new) | test | — | `tests/frontend/brewpad-pure.test.js`, `tests/frontend/brewpad-pending.test.js` | exact |

---

## Pattern Assignments

### `js/admin.js` — `renderBatchDetailModal` additions + refresh handler

**Analog:** `js/admin.js` (batch activate handler, notes save handler, status-change handler)

#### Imports / config pattern (lines 3213–3222)

```javascript
// Admin uses named helpers for middleware URL + headers
function getMwUrl() {
  return (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.MIDDLEWARE_URL) ? SHEETS_CONFIG.MIDDLEWARE_URL : '';
}

function getMwHeaders(mutating) {
  var h = { 'Content-Type': 'application/json' };
  if (mutating && typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.MW_API_KEY) {
    h['X-API-Key'] = SHEETS_CONFIG.MW_API_KEY;
  }
  return h;
}
```

**Key difference for Phase 29:** The GET to `/api/batch/customer-by-number` requires `x-api-key` even though it is not a mutating call. Use an explicit header object rather than `getMwHeaders(false)` — match the pattern at line 5442 and 7109:

```javascript
// admin.js line 5442 — GET with explicit x-api-key
fetch(url, { headers: { 'x-api-key': MW_API_KEY } })

// admin.js line 7107–7109 — POST with explicit x-api-key
fetch(mwUrl + '/api/contacts', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-api-key': SHEETS_CONFIG.MW_API_KEY || '' },
  ...
})
```

So the refresh GET call in admin.js must do:

```javascript
var mwUrl = getMwUrl();
fetch(mwUrl + '/api/batch/customer-by-number?number=' + encodeURIComponent(soNumber), {
  headers: { 'x-api-key': SHEETS_CONFIG.MW_API_KEY || '' }
})
```

#### Info grid row pattern (lines 5870–5875)

```javascript
// Admin detail modal: info grid uses batch-detail-col divs with <strong> labels
html += '<div class="batch-detail-grid">';
html += '<div class="batch-detail-col"><strong>Product:</strong> ' + escapeHTML(b.product_name || b.product_sku) + '</div>';
html += '<div class="batch-detail-col"><strong>Customer:</strong> ' + escapeHTML(getCustomerDisplayName(b) || '—') + '</div>';
html += '<div class="batch-detail-col"><strong>Start Date:</strong> ' + (b.start_date ? String(b.start_date).substring(0, 10) : '—') + '</div>';
html += '<div class="batch-detail-col"><strong>Shelf:</strong> ' + escapeHTML(b.shelf_id || '—') + ' &nbsp;<strong>Bin:</strong> ' + escapeHTML(b.bin_id || '—') + ' &nbsp;<strong>Vessel:</strong> ' + escapeHTML(b.vessel_id || '—') + '</div>';
html += '</div>';
```

New rows to add (Zoho Ref, Email, Phone) follow the same `batch-detail-col` + `<strong>` pattern. The Zoho Ref row includes the button; give button elements an id so the event-binding section below can find them by id.

#### Button style (lines 5927–5939)

```javascript
// Admin modal uses class="btn admin-btn-sm" (primary) or "btn-secondary admin-btn-sm" (secondary)
html += '<button type="button" class="btn admin-btn-sm" id="batch-activate-detail">Activate</button>';
html += '<button type="button" class="btn-secondary admin-btn-sm" id="batch-regen-token">Regenerate URL</button>';
```

Refresh button = `btn-secondary admin-btn-sm`, placed inline in the Zoho Ref row. Hidden (`style="display:none;"`) when `zoho_so_number` does not match `/^(INV|SO)-\d+$/i`.

#### Event-binding + `adminApiPost('update_batch')` pattern (lines 5947–6064)

```javascript
// Bind events after openModal() renders HTML — capture batchId + batchVersion as closure vars
var batchId = b.batch_id;
var batchVersion = b.last_updated;

var activateDetailBtn = document.getElementById('batch-activate-detail');
if (activateDetailBtn) {
  activateDetailBtn.addEventListener('click', function () {
    activateDetailBtn.disabled = true;
    adminApiPost('update_batch', {
      batch_id: batchId,
      expectedVersion: batchVersion,
      updates: { status: 'primary', start_date: todayPacific() }
    }).then(function (result) {
      if (result && result.newVersion) batchVersion = result.newVersion;
      showToast('Batch activated', 'success');
      openBatchDetail(batchId);
      loadBatchesData();
    }).catch(function (err) {
      showToast('Failed: ' + err.message, 'error');
      activateDetailBtn.disabled = false;
    });
  });
}

// Notes save: same shape, captures batchVersion, bumps it on success
var notesBtn = document.getElementById('batch-save-notes');
if (notesBtn) notesBtn.addEventListener('click', function () {
  adminApiPost('update_batch', {
    batch_id: batchId,
    expectedVersion: batchVersion,
    updates: { notes: document.getElementById('batch-notes-edit').value }
  }).then(function (result) {
    if (result && result.newVersion) batchVersion = result.newVersion;
    showToast('Notes saved', 'success');
  }).catch(function (err) { showToast('Failed: ' + err.message, 'error'); });
});
```

**Copy this shape for the refresh handler:** `batchVersion` must be updated from `result.newVersion` after `update_batch` so subsequent saves in the same modal session don't fail optimistic-lock check.

#### Cache invalidation after update in admin (lines 6059–6065, 5793–5797)

```javascript
// After update_batch: reload the batch list to refresh stale name in list rows
loadBatchesData();

// After delete: clear vessel cache too
vesselsData = null;
loadBatchesData();
loadBatchDashboardSummary();
```

For the refresh handler (D-06): after a successful `update_batch`, call `loadBatchesData()` to refresh `batchesData` array (the admin list). The modal is already showing the updated name in-place via DOM patch — no need to `openBatchDetail` again.

#### `getCustomerDisplayName` (lines 36–41)

```javascript
// admin.js line 36 — prefers firstname+lastname, falls back to customer_name
function getCustomerDisplayName(b) {
  if (b.customer_firstname || b.customer_lastname) {
    return ((b.customer_firstname || '') + ' ' + (b.customer_lastname || '')).trim();
  }
  return b.customer_name || '';
}
```

The refresh writes `customer_name` (from Zoho). The Customer row in the modal renders via `getCustomerDisplayName(b)`. If the batch has `customer_firstname`/`customer_lastname`, those already take precedence, so updating only the `customer_name` DOM node correctly reflects what the display helper would show for a firstname+lastname-less batch. Planner should note: update the Customer `<strong>Customer:</strong>` cell's text content AND `b.customer_name` on the live batch object so the display stays coherent for batches that rely on `customer_name` only.

---

### `js/brewpad.js` — Invoice section additions + refresh handler

**Analog:** `js/brewpad.js` link-invoice handler (~740–778) and lazy-invoice-search fetch (~2517–2540)

#### `mwUrl()` / `mwApiKey()` helpers (lines 645–651)

```javascript
function mwUrl() {
  return (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.MIDDLEWARE_URL) || '';
}

function mwApiKey() {
  return (typeof SHEETS_CONFIG !== 'undefined' && SHEETS_CONFIG.MW_API_KEY) || '';
}
```

All middleware GETs and POSTs in brewpad.js go through these two helpers. The refresh GET must use both:

```javascript
fetch(mwUrl() + '/api/batch/customer-by-number?number=' + encodeURIComponent(soNumber), {
  headers: { 'x-api-key': mwApiKey() }
})
```

#### Middleware GET with `x-api-key` header (lines 693–695, 2521–2522)

```javascript
// Canonical search-invoices GET — direct copy-template for customer-by-number
fetch(mwUrl() + '/api/batch/search-invoices?search=' + encodeURIComponent(term), {
  headers: { 'x-api-key': mwApiKey() }
}).then(function (r) { return r.json(); })
  .then(function (data) { ... })
  .catch(function () {});
```

#### `_currentBatchDetail` in-place patch pattern (lines 748–753)

```javascript
// After link-invoice update_batch succeeds: patch the in-memory object
if (_currentBatchDetail) {
  _currentBatchDetail.zoho_so_number = soNumber;
  _currentBatchDetail.customer_name = customerName;
  _currentBatchDetail.customer_id = customerId;
  _currentBatchDetail.product_name = productName;
}
```

**For Phase 29 refresh handler:** after `update_batch` succeeds, apply the same in-place patch to `_currentBatchDetail` for `customer_name`, `customer_email`, `customer_phone`, then also patch `_batchesData` and `_allBatchesData` (D-06):

```javascript
// Patch all in-memory list caches (D-06)
function patchBatchInMemory(batchId, updates) {
  var lists = [_batchesData, _allBatchesData];
  for (var li = 0; li < lists.length; li++) {
    for (var i = 0; i < lists[li].length; i++) {
      if (String(lists[li][i].batch_id) === String(batchId)) {
        Object.keys(updates).forEach(function (k) {
          lists[li][i][k] = updates[k];
        });
        break;
      }
    }
  }
}
```

#### sessionStorage cache invalidation (lines 772–774)

```javascript
// After link-invoice success: bust sessionStorage snapshot for this batch
_batchesLoaded = false;
_allBatchesData = [];
_eagerLoadTime = 0;
try { sessionStorage.removeItem('sv-bp-batch-' + _detailBatchId); } catch (e) {}
```

For the refresh handler, a lighter-weight invalidation is sufficient — only bust the detail snapshot and patch lists in memory. Full `_allBatchesData = []` reset is not required (link-invoice does it because it also triggers `callSyncZoho`). Follow the notes auto-save pattern (line 2558) as the model for a targeted invalidation:

```javascript
try { sessionStorage.removeItem('sv-bp-batch-' + b.batch_id); } catch (e) {}
```

#### `adminApiPost('update_batch')` without `expectedVersion` (lines 746, 2553–2558)

```javascript
// Link-invoice call — no expectedVersion (intentional: link is idempotent-ish)
adminApiPost('update_batch', { batch_id: _detailBatchId, updates: updates })

// Notes auto-save — also no expectedVersion
adminApiPost('update_batch', { batch_id: b.batch_id, updates: { notes: notes } })
```

**Phase 29 must send `expectedVersion` per D-13.** Use the version captured at detail render time (stored in `_currentBatchDetail.last_updated`). After a successful call, update the local copy so the next save in the same session doesn't fail:

```javascript
adminApiPost('update_batch', {
  batch_id: b.batch_id,
  expectedVersion: _currentBatchDetail.last_updated,
  updates: { customer_name: ..., customer_email: ..., customer_phone: ... }
}).then(function (result) {
  if (result && result.newVersion) _currentBatchDetail.last_updated = result.newVersion;
  ...
})
```

#### Info row HTML pattern (lines 2224–2229)

```javascript
// BrewPad detail pane uses bp-detail-info-row with bp-detail-info-label span
html += '<div class="bp-detail-info">';
html += '<div class="bp-detail-info-row"><span class="bp-detail-info-label">Product</span><span>' + escapeHTML(b.product_name || b.product_sku || '—') + '</span></div>';
html += '<div class="bp-detail-info-row"><span class="bp-detail-info-label">Customer</span><span>' + escapeHTML(getCustomerDisplayName(b) || '—') + '</span></div>';
html += '<div class="bp-detail-info-row"><span class="bp-detail-info-label">Start</span><span>' + fmtDate(b.start_date) + '</span></div>';
if (b.zoho_so_number) {
  html += '<div class="bp-detail-info-row"><span class="bp-detail-info-label">Zoho Ref</span><span>' + escapeHTML(b.zoho_so_number) + '<span class="bp-sync-indicator" id="bp-sync-indicator" style="display:none;"></span></span></div>';
}
html += '</div>';
```

Email and Phone rows use the same `bp-detail-info-row` / `bp-detail-info-label` pattern. Assign id attributes to the value `<span>` elements so the in-place DOM update can target them by id without re-rendering the section.

#### Button style (lines 2213, 2244, 2267)

```javascript
// BrewPad uses btn-secondary bp-btn-sm for secondary/utility actions
html += '<button type="button" class="btn-secondary bp-btn-sm bp-detail-back" ...>';
html += '<button type="button" class="btn-secondary bp-btn-sm" id="bp-link-so-btn"...>Link to Invoice</button>';
html += '<button type="button" class="btn bp-btn-sm" id="bp-save-location">Save</button>';
```

Refresh button = `btn-secondary bp-btn-sm`, placed inside the Invoice section (`bp-detail-section`) beside the linked-number display.

#### Loading-state pattern (lines 2244, 462–474)

```javascript
// Show/hide pattern for button state — set disabled + text swap
linkSoBtn.style.display = 'none';          // hide while searching
// ... or:
activateBtn.disabled = true;
activateBtn.textContent = 'Activating…';
// On completion:
activateBtn.disabled = false;
activateBtn.textContent = 'Original label';
```

For the refresh button: disable it and swap its text to `'Refreshing…'` while the fetch + update is in flight, restore on completion (success or error).

#### Toast calls (lines 770–778)

```javascript
showToast('Invoice linked', 'success');
// error case:
showToast('Failed to link invoice. Try again.', 'error');
```

---

## Shared Patterns

### Middleware GET with `x-api-key` (applies to both surfaces)

**Source — BrewPad:** `js/brewpad.js` lines 693–695
**Source — Admin:** `js/admin.js` lines 5441–5442

```javascript
// BrewPad form:
fetch(mwUrl() + '/api/batch/customer-by-number?number=' + encodeURIComponent(number), {
  headers: { 'x-api-key': mwApiKey() }
}).then(function (r) { return r.json(); })

// Admin form:
fetch(getMwUrl() + '/api/batch/customer-by-number?number=' + encodeURIComponent(number), {
  headers: { 'x-api-key': SHEETS_CONFIG.MW_API_KEY || '' }
}).then(function (r) { return r.json(); })
```

The endpoint always requires the key (see `pos.js:1371–1373`). Do NOT use `getMwHeaders(false)` in admin — it omits the key for non-mutating calls.

### `adminApiPost('update_batch', { batch_id, expectedVersion, updates })` (applies to both surfaces)

**Source:** `js/admin.js` lines 5959–5963, `js/brewpad.js` line 746

```javascript
adminApiPost('update_batch', {
  batch_id: batchId,
  expectedVersion: batchVersion,   // REQUIRED for Phase 29 per D-13
  updates: {
    // only non-empty fetched fields (D-13 / Phase 28 D-02)
    customer_name: fetchedName || undefined,
    customer_email: fetchedEmail || undefined,
    customer_phone: fetchedPhone || undefined
  }
})
.then(function (result) {
  if (result && result.newVersion) batchVersion = result.newVersion;
  showToast('Customer info updated from ' + number, 'success');
})
.catch(function (err) { showToast('Failed: ' + err.message, 'error'); });
```

Omit keys whose fetched value is falsy/null from the `updates` object — do not send `customer_email: null` or `customer_phone: null` to `update_batch`.

### ZSYNC-02 format gate — button visibility (applies to both surfaces)

**Source:** D-08 decision, validated against `pos.js:1379–1383`

```javascript
// Matches the exact regex the endpoint accepts; anything else = 400 invalid_number
var VALID_SO_PATTERN = /^(INV|SO)-\d+$/i;

// In HTML generation:
var hasValidLink = b.zoho_so_number && VALID_SO_PATTERN.test(b.zoho_so_number);
// Render button only when hasValidLink is truthy:
if (hasValidLink) {
  html += '<button type="button" ... id="batch-zoho-refresh-btn">Refresh from Zoho</button>';
}
```

### API response → toast mapping (applies to both surfaces)

**Source:** D-10/D-11 decisions, `pos.js:1400/1477` error bodies

```javascript
// Fetch response handling pattern — check HTTP status first, then error field
.then(function (r) {
  if (r.status === 404) return r.json().then(function (d) { throw { status: 404, error: d.error }; });
  if (r.status === 502) return r.json().then(function (d) { throw { status: 502, error: d.error }; });
  if (!r.ok) return r.json().then(function (d) { throw { status: r.status, error: d.error }; });
  return r.json();
})
.then(function (data) {
  // D-12 no-change short-circuit: compare fields, skip update_batch if nothing differs
  // D-10 full success, D-11 voided doc, D-10 partial (contact_unavailable)
  // ... build updates object, call adminApiPost only if updates is non-empty
})
.catch(function (err) {
  // D-10: 404 not_found → "{number} no longer exists in Zoho"
  // D-10: 502 zoho_error → "Zoho unreachable — try again later"
  // optimistic-lock conflict (err.message contains 'version') → "Batch was updated elsewhere — please reload"
  refreshBtn.disabled = false;
  refreshBtn.textContent = 'Refresh from Zoho';
  showToast(toastMessage, 'error');
});
```

### `escapeHTML` (applies to both surfaces)

**Source:** `js/admin.js` line ~118 (inside IIFE) / `js/brewpad.js` line 6

Both files have their own `escapeHTML`. In brewpad.js it is a top-level function (exported). In admin.js it is a function inside the IIFE. All user-visible strings from the API response (`customer_name`, `customer_email`, `customer_phone`) must be run through `escapeHTML` before insertion into innerHTML.

### `getCustomerDisplayName` (applies to both surfaces)

**Source:** `js/admin.js` lines 36–41, `js/brewpad.js` lines 34–39

```javascript
function getCustomerDisplayName(b) {
  if (b.customer_firstname || b.customer_lastname) {
    return ((b.customer_firstname || '') + ' ' + (b.customer_lastname || '')).trim();
  }
  return b.customer_name || '';
}
```

The refresh only updates `customer_name`. When `customer_firstname`/`customer_lastname` are present they take precedence. The DOM node to patch for the customer name display should reflect what `getCustomerDisplayName` would return for the patched batch object. If no firstname/lastname fields are set, updating `b.customer_name` and the DOM node directly is correct.

---

## Test File Pattern

### `tests/frontend/brewpad-zoho-refresh.test.js` (new)

**Analog:** `tests/frontend/brewpad-pure.test.js` (pure helper tests), `tests/frontend/brewpad-pending.test.js` (behavior tests with global stubs)

#### File header / global stubs pattern (brewpad-pending.test.js lines 1–30)

```javascript
'use strict';

// brewpad.js runs its IIFE on load — stub the globals it touches at the top level.
global.document = global.document || {};
global.window = global.window || {};
global.navigator = global.navigator || {};
global.google = { accounts: { oauth2: { initTokenClient: jest.fn() } } };
global.fetch = jest.fn();
global.localStorage = { _data: {}, getItem: function(k){return this._data[k]||null;}, setItem: function(k,v){this._data[k]=v;}, removeItem: function(k){delete this._data[k];}, clear: function(){this._data={};} };
global.sessionStorage = { _data: {}, getItem: function(k){return this._data[k]||null;}, setItem: function(k,v){this._data[k]=v;}, removeItem: function(k){delete this._data[k];}, clear: function(){this._data={};} };

var _auth = require('../../js/lib/auth');
global.waitForGoogleIdentity = _auth.waitForGoogleIdentity;
global.gsiInitTokenClient = _auth.gsiInitTokenClient;
global.fetchGoogleUserInfo = _auth.fetchGoogleUserInfo;

var bp = require('../../js/brewpad');
```

#### Module exports guard — what Phase 29 must export from brewpad.js

The new pure helpers/validators (e.g. the `VALID_SO_PATTERN` gate, the no-change comparison, the `updates` object builder) should be pure functions placed outside the IIFE (like `escapeHTML`, `getCustomerDisplayName`) and exported via the existing guard at line 5219:

```javascript
// js/brewpad.js bottom (existing guard at line 5219)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    escapeHTML: escapeHTML, fmtDate: fmtDate, todayStr: todayStr,
    // ... existing exports ...
    // ADD:
    isValidZohoNumber: isValidZohoNumber,         // regex gate
    buildRefreshUpdates: buildRefreshUpdates,     // omit-empty fields builder
    compareRefreshFields: compareRefreshFields    // no-change check
  };
}
```

#### Test structure for admin.js pure helpers

**Analog:** `tests/frontend/admin-recipes.test.js` lines 1–100

```javascript
// admin.js test file header
global.SHEETS_CONFIG = {
  MIDDLEWARE_URL: 'http://localhost:3001',
  MW_API_KEY: 'test-key',
  SPREADSHEET_ID: 'test-id',
  GOOGLE_CLIENT_ID: 'test-client-id',
  STAFF_EMAILS: 'test@example.com',
  API_BASE: 'https://script.google.com/test',
  SERVER_TOKEN: 'test-token'
};
var admin = require('../../js/admin.js');
// then use admin.exportedHelper(...)
```

---

## No Analog Found

None. All files have strong analogs in the existing codebase.

---

## Metadata

**Analog search scope:** `js/admin.js`, `js/brewpad.js`, `tests/frontend/`, `zoho-middleware/routes/pos.js`
**Files scanned:** 6 source files + 3 test files
**Pattern extraction date:** 2026-06-11
