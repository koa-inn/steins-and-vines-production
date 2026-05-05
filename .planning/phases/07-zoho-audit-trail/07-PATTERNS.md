# Phase 7: Zoho Audit Trail - Pattern Map

**Mapped:** 2026-05-04
**Files analyzed:** 6 (5 modified, 1 new constant key)
**Analogs found:** 6 / 6

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `zoho-middleware/routes/pos.js` (add `POST /api/batch/sync-zoho`) | route/controller | request-response | `zoho-middleware/routes/pos.js` lines 1225–1292 (`PUT /api/kiosk/salesorder-update`) | exact |
| `zoho-middleware/lib/brewpad-integration.js` (add `syncBatchToZoho`, `queueSyncRetry`, `retrySyncQueue`) | service | event-driven + retry | `zoho-middleware/lib/brewpad-integration.js` lines 96–202 (same file — `queueForRetry` + `retryPendingBatches`) | exact |
| `zoho-middleware/lib/constants.js` (add `BATCH_SYNC_RETRY_PREFIX`) | config | — | `zoho-middleware/lib/constants.js` line 58 (`BATCH_RETRY_PREFIX`) | exact |
| `zoho-middleware/lib/validateEnv.js` (add `ZOHO_CF_BATCH_STATUS` to OPTIONAL) | config | — | `zoho-middleware/lib/validateEnv.js` lines 35–41 (existing `ZOHO_CF_*` entries) | exact |
| `apps-script/adminApi.gs` (extend `updateBatch` allowedFields; write `fermentation_started_at`/`completed_at` in `updateBatchSchedule` and `handlePackagingCompletion`; extend `createBatch` appendRow) | service/backend | CRUD | `apps-script/adminApi.gs` lines 1794–1909 (`updateBatch`) + lines 1963–2069 (`updateBatchSchedule`) + lines 2241–2270 (`handlePackagingCompletion`) | exact |
| `js/brewpad.js` (add timeline section, Link SO button, sync indicator inside `renderBatchDetail`; add `callSyncZoho`, `callLinkSo`, `buildLifecycleTimeline`, SO search debounce) | component | request-response + DOM | `js/brewpad.js` lines 1527–1613 (`renderBatchDetail`) + lines 78–86 (`shouldShowKioskBadge`) | exact |

---

## Pattern Assignments

### `zoho-middleware/routes/pos.js` — new `POST /api/batch/sync-zoho` endpoint

**Analog:** `zoho-middleware/routes/pos.js` lines 1225–1292 (`PUT /api/kiosk/salesorder-update`)

**Auth pattern** (lines 1226–1229):
```javascript
var apiKey = req.headers['x-api-key'] || req.query.api_key;
if (apiKey !== process.env.MW_API_KEY) {
  return res.status(401).json({ error: 'Unauthorized' });
}
```

**Input validation pattern** (lines 1231–1253 — adapt for sync body):
```javascript
var body = req.body || {};
var soId = body.salesorder_id;
if (!soId || typeof soId !== 'string') {
  return res.status(400).json({ error: 'Missing or invalid salesorder_id' });
}
```

**Custom field push pattern** (lines 476–480 — from `sale/confirm` handler):
```javascript
if (consignmentDetails.length > 0 && process.env.ZOHO_CF_CONSIGNMENT_SALE) {
  invoicePayload.custom_fields.push({ api_name: process.env.ZOHO_CF_CONSIGNMENT_SALE, value: true });
}
```
For batch status, adapt to:
```javascript
var cfName = process.env.ZOHO_CF_BATCH_STATUS;
var payload = { custom_fields: [{ api_name: cfName, value: statusLabel }] };
```

**`zohoPut` + `.then`/`.catch` pattern** (lines 1268–1292):
```javascript
zohoPut('/salesorders/' + soId, payload)
  .then(function (data) {
    var so = data.salesorder || {};
    cache.del(KIOSK_SO_CACHE_KEY).catch(function () {});
    eventLog.logEvent('kiosk.salesorder_updated', { soId: soId, ... });
    res.json({ ok: true, ... });
  })
  .catch(function (err) {
    var msg = err.message;
    if (err.response && err.response.data) {
      msg = err.response.data.message || err.response.data.error || msg;
    }
    log.error('[kiosk/so-update] Zoho error: ' + msg);
    res.status(502).json({ error: 'Failed to update sales order' });
  });
```
For sync-zoho, the `.catch` must also call `queueSyncForRetry(...)` (fire-and-forget) before sending the 502, mirroring the retry pattern in `brewpad-integration.js`.

**Security note (from RESEARCH.md):** Construct `statusLabel` server-side from a validated `status` enum + `batch_id`. Do not pass `status_label` from the request body directly to Zoho. Accepted enum: `['pending', 'active', 'complete']`.

---

### `zoho-middleware/lib/brewpad-integration.js` — add `syncBatchToZoho`, `queueSyncForRetry`, `retrySyncQueue`

**Analog:** `zoho-middleware/lib/brewpad-integration.js` — same file, lines 96–202

**Redis queue key pattern** (lines 97–110):
```javascript
function queueForRetry(payload, reason) {
  var key = RETRY_PREFIX + Date.now() + '-' + (payload.zoho_so_number || 'unknown');
  var retryData = {
    payload: payload,
    attempts: 0,
    reason: reason,
    queued_at: new Date().toISOString()
  };
  eventLog.logEvent('kiosk.batch_retry_queued', {
    invoiceNumber: payload.zoho_so_number || '',
    reason: reason
  });
  return cache.set(key, retryData, RETRY_TTL);
}
```
Mirror exactly for sync retries, using `SYNC_RETRY_PREFIX = C.CACHE_KEYS.BATCH_SYNC_RETRY_PREFIX` and keying by `batchId` instead of `zoho_so_number`.

**Retry sweep pattern** (lines 153–201):
```javascript
function retryPendingBatches() {
  if (!cache.isConnected()) return Promise.resolve();
  return cache.getClient().then(function (c) {
    if (!c) return;
    return c.keys(RETRY_PREFIX + '*');
  }).then(function (keys) {
    if (!keys || keys.length === 0) return;
    var chain = Promise.resolve();
    keys.forEach(function (key) {
      chain = chain.then(function () {
        return cache.get(key).then(function (retryData) {
          if (!retryData || !retryData.payload) {
            return cache.del(key);
          }
          retryData.attempts = (retryData.attempts || 0) + 1;
          if (retryData.attempts > MAX_RETRIES) {
            log.error('[brewpad] Max retries exceeded for key=' + key + ' ...');
            eventLog.logEvent('kiosk.batch_retry_exhausted', { ... });
            return cache.del(key);
          }
          return callAppsScriptCreateBatch(retryData.payload, true).then(function (result) {
            if (result && result.ok) {
              return cache.del(key);
            }
            return cache.set(key, retryData, RETRY_TTL);
          }).catch(function () {
            return cache.set(key, retryData, RETRY_TTL);
          });
        });
      });
    });
    return chain;
  }).catch(function (err) {
    log.error('[brewpad] Retry sweep error: ' + err.message);
  });
}
```
Copy this pattern verbatim for `retrySyncQueue`, replacing `callAppsScriptCreateBatch` with `callZohoPutBatchStatus(retryData.payload)` — a thin wrapper around `zohoPut('/salesorders/' + payload.so_id, { custom_fields: [...] })`.

**Module exports pattern** (lines 204–209):
```javascript
module.exports = {
  createBatchesFromSale: createBatchesFromSale,
  retryPendingBatches: retryPendingBatches,
  detectKitItems: detectKitItems,
  callAppsScriptCreateBatch: callAppsScriptCreateBatch
};
```
Add `syncBatchToZoho` and `retrySyncQueue` to this exports object.

---

### `zoho-middleware/lib/constants.js` — add `BATCH_SYNC_RETRY_PREFIX`

**Analog:** `zoho-middleware/lib/constants.js` line 58

**Existing pattern to copy** (lines 57–58):
```javascript
// Brewpad batch creation retry queue
BATCH_RETRY_PREFIX:     'brewpad:pending-batch:',
```
Add immediately after:
```javascript
// Brewpad Zoho sync retry queue (Phase 7)
BATCH_SYNC_RETRY_PREFIX: 'brewpad:zoho-sync:',
```

---

### `zoho-middleware/lib/validateEnv.js` — add `ZOHO_CF_BATCH_STATUS` to OPTIONAL

**Analog:** `zoho-middleware/lib/validateEnv.js` lines 35–41 (existing `ZOHO_CF_*` block)

**Existing ZOHO_CF_* pattern** (lines 35–41):
```javascript
{ name: 'ZOHO_CF_STATUS',           desc: 'Zoho custom field: reservation status' },
{ name: 'ZOHO_CF_TIMESLOT',         desc: 'Zoho custom field: timeslot' },
{ name: 'ZOHO_CF_DEPOSIT',          desc: 'Zoho custom field: deposit amount' },
{ name: 'ZOHO_CF_BALANCE',          desc: 'Zoho custom field: balance due' },
{ name: 'ZOHO_CF_APPOINTMENT_ID',   desc: 'Zoho custom field: appointment ID' },
{ name: 'ZOHO_CF_TRANSACTION_ID',   desc: 'Zoho custom field: transaction ID' },
```
Add after `ZOHO_CF_TRANSACTION_ID`:
```javascript
{ name: 'ZOHO_CF_BATCH_STATUS',     desc: 'Zoho custom field API name for batch status on SOs (e.g. cf_batch_status)' },
```

---

### `apps-script/adminApi.gs` — three targeted changes

#### Change 1: Extend `updateBatch` allowedFields (line 1879)

**Analog:** `apps-script/adminApi.gs` lines 1879–1887

**Existing pattern:**
```javascript
var allowedFields = ['status', 'vessel_id', 'shelf_id', 'bin_id', 'notes'];
allowedFields.forEach(function (field) {
  if (updates[field] !== undefined) {
    var colIndex = headers.indexOf(field);
    if (colIndex !== -1) {
      sheet.getRange(row, colIndex + 1).setValue(sanitizeInput(String(updates[field])));
    }
  }
});
```
Replace `allowedFields` array with:
```javascript
var allowedFields = [
  'status', 'vessel_id', 'shelf_id', 'bin_id', 'notes',
  // Phase 7: SO linking and date columns
  'zoho_so_number', 'customer_id', 'customer_name', 'product_name',
  'fermentation_started_at', 'completed_at'
];
```
The `forEach` loop body is unchanged — it uses `headers.indexOf(field)` which will naturally find the new columns once they exist in the sheet header row.

#### Change 2: Write `fermentation_started_at` in `updateBatchSchedule` (line 1963 area)

**Analog:** `apps-script/adminApi.gs` lines 1995–1999 (existing column write pattern in `updateBatchSchedule`):
```javascript
var snapCol = headers.indexOf('schedule_snapshot');
if (snapCol !== -1) sheet.getRange(row, snapCol + 1).setValue(JSON.stringify(newSteps));
var luCol = headers.indexOf('last_updated');
if (luCol !== -1) sheet.getRange(row, luCol + 1).setValue(now);
```
Add after these lines (still inside `updateBatchSchedule`, before the task reconciliation block):
```javascript
// Phase 7: write fermentation_started_at when pending batch gets a schedule
if (String(current.status || '').toLowerCase() === 'pending') {
  var fermCol = headers.indexOf('fermentation_started_at');
  if (fermCol !== -1) sheet.getRange(row, fermCol + 1).setValue(now);
}
```

#### Change 3: Write `completed_at` in `handlePackagingCompletion` (line 2260 area)

**Analog:** `apps-script/adminApi.gs` lines 2260–2263 (existing status + last_updated write):
```javascript
var statusCol = result.headers.indexOf('status');
var luCol = result.headers.indexOf('last_updated');
if (statusCol !== -1) result.sheet.getRange(result.row, statusCol + 1).setValue('complete');
if (luCol !== -1) result.sheet.getRange(result.row, luCol + 1).setValue(timestamp);
```
Add a `completed_at` write immediately after:
```javascript
// Phase 7: record batch completion timestamp
var completedAtCol = result.headers.indexOf('completed_at');
if (completedAtCol !== -1) result.sheet.getRange(result.row, completedAtCol + 1).setValue(timestamp);
```

#### Change 4: Extend `createBatch` appendRow (lines 1694–1717)

**Analog:** `apps-script/adminApi.gs` lines 1694–1717 (`batchesSheet.appendRow` call)

The existing appendRow ends at column 22 (`zoho_so_number`). After adding `fermentation_started_at` (col 23) and `completed_at` (col 24) to the sheet header, extend the array with two empty strings:
```javascript
batchesSheet.appendRow([
  batchId,                                          // col 1: batch_id
  isPending ? 'pending' : 'primary',                // col 2: status
  sanitizeInput(payload.product_sku),               // col 3: product_sku
  sanitizeInput(payload.product_name || ''),        // col 4: product_name
  sanitizeInput(payload.customer_id || ''),         // col 5: customer_id
  sanitizeInput(payload.customer_name),             // col 6: customer_name
  sanitizeInput(...),                               // col 7: customer_email
  payload.start_date || '',                         // col 8: start_date
  payload.schedule_id || '',                        // col 9: schedule_id
  scheduleSnapshot,                                 // col 10: schedule_snapshot
  sanitizeInput(payload.vessel_id || ''),           // col 11: vessel_id
  sanitizeInput(payload.shelf_id || ''),            // col 12: shelf_id
  sanitizeInput(payload.bin_id || ''),              // col 13: bin_id
  sanitizeInput(payload.notes || ''),               // col 14: notes
  accessToken,                                      // col 15: access_token
  sanitizeInput(payload.reservation_id || ''),      // col 16: reservation_id
  now,                                              // col 17: created_at (already exists)
  userEmail,                                        // col 18: created_by
  now,                                              // col 19: last_updated
  '',                                               // col 20: (existing field)
  sanitizeInput(payload.source || 'manual'),        // col 21: source
  sanitizeInput(payload.zoho_so_number || ''),      // col 22: zoho_so_number
  isPending ? '' : now,                             // col 23: fermentation_started_at (Phase 7)
  ''                                                // col 24: completed_at (Phase 7)
]);
```
Note: For non-pending batches with a `start_date`, write `payload.start_date` (not `now`) for `fermentation_started_at` to handle the Pitfall 4 case (manually-created active batches).

Also update the manual batch `appendRow` at approximately line 2218 with the same two trailing empty strings.

---

### `js/brewpad.js` — extend `renderBatchDetail`, add helper functions

**Analog:** `js/brewpad.js` lines 1527–1613 (`renderBatchDetail`) + lines 78–86 (`shouldShowKioskBadge`)

#### Timeline section insertion point (lines 1565–1568)

**Existing Zoho Ref row pattern:**
```javascript
if (b.zoho_so_number) {
  html += '<div class="bp-detail-info-row"><span class="bp-detail-info-label">Zoho Ref</span><span>' + escapeHTML(b.zoho_so_number) + '</span></div>';
}
html += '</div>';  // closes bp-detail-info
```
After the closing `</div>` of `bp-detail-info`, insert the new sections:

```javascript
// Phase 7: sync indicator (near Zoho Ref row, inside or just after info grid)
html += '<div class="bp-detail-info-row bp-sync-indicator-row" id="bp-sync-indicator" style="display:none;">';
html += '<span class="bp-detail-info-label">Sync</span><span id="bp-sync-status-text"></span>';
html += '</div>';

// Phase 7: Link to Sales Order button
html += '<div class="bp-detail-section">';
html += '<div class="bp-detail-section-title">Sales Order</div>';
html += '<button type="button" class="btn-secondary bp-btn-sm" id="bp-link-so-btn">Link to Sales Order</button>';
html += '<div id="bp-link-so-search" style="display:none;">';
html += '<input type="text" id="bp-so-search-input" class="bp-inline-input" placeholder="Search customer name…" autocomplete="off">';
html += '<div id="bp-so-search-results"></div>';
html += '</div>';
html += '</div>';

// Phase 7: Lifecycle timeline section
html += '<div class="bp-detail-section">';
html += '<div class="bp-detail-section-title">Lifecycle</div>';
html += '<div id="bp-lifecycle-timeline">' + buildLifecycleTimeline(b, null) + '</div>';
html += '</div>';
```

#### `shouldShowKioskBadge` pattern — extend for sync indicator (lines 78–86)

**Existing badge pattern:**
```javascript
function shouldShowKioskBadge(source, status) {
  return source === 'kiosk' && (status || '').toLowerCase() === 'pending';
}
```
Mirror for sync state (inside the IIFE, as a module-private function):
```javascript
function showSyncIndicator(state) {
  // state: 'syncing' | 'failed' | 'ok'
  var row = document.getElementById('bp-sync-indicator');
  var text = document.getElementById('bp-sync-status-text');
  if (!row || !text) return;
  if (state === 'ok') { row.style.display = 'none'; return; }
  row.style.display = '';
  text.textContent = state === 'syncing' ? 'Syncing…' : 'Sync failed';
  text.className = state === 'syncing' ? 'bp-sync-syncing' : 'bp-sync-failed';
}
```

#### `buildLifecycleTimeline` helper — DOM builder pattern

**Analog:** `js/brewpad.js` lines 1586–1601 (existing `bp-detail-section` pattern with `escapeHTML` throughout)

```javascript
function buildLifecycleTimeline(batch, soDate) {
  var events = [
    { label: 'Sale — ' + (batch.zoho_so_number ? escapeHTML(batch.zoho_so_number) : ''), date: soDate },
    { label: 'Batch created',        date: batch.created_at },
    { label: 'Fermentation started', date: batch.fermentation_started_at },
    { label: 'Batch completed',      date: batch.completed_at }
  ];

  var html = '<div class="bp-timeline">';
  events.forEach(function (ev) {
    var done = !!ev.date;
    html += '<div class="bp-timeline-item' + (done ? ' bp-timeline-item--done' : '') + '">';
    html += '<span class="bp-timeline-dot">' + (done ? '●' : '○') + '</span>';
    html += '<div class="bp-timeline-body">';
    html += '<span class="bp-timeline-label">' + ev.label + '</span>';
    html += '<span class="bp-timeline-date">' + (done ? fmtDate(ev.date) : '(pending)') + '</span>';
    html += '</div></div>';
  });
  html += '</div>';
  return html;
}
```
Note: `fmtDate` is already used in `renderBatchDetail` at line 1564 for `b.start_date` — reuse it directly.

#### `callSyncZoho` — fire-and-forget pattern

**Analog:** Any existing `fetch` call in brewpad.js that calls the middleware API. The `callAppsScriptCreateBatch` fire-and-forget mental model applies:

```javascript
function callSyncZoho(batchId, soId, status) {
  if (!soId) return;  // D-Pitfall-2: skip if no SO linked
  showSyncIndicator('syncing');
  fetch(MW_BASE + '/api/batch/sync-zoho', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': MW_API_KEY },
    body: JSON.stringify({ batch_id: batchId, so_id: soId, status: status })
  }).then(function (r) { return r.json(); })
    .then(function (data) {
      showSyncIndicator(data.ok ? 'ok' : 'failed');
    })
    .catch(function () {
      showSyncIndicator('failed');
    });
}
```
Call this after any status transition that succeeds (i.e., inside the `.then()` that updates the BrewPad UI state), not before.

#### SO search debounce — native `setTimeout`/`clearTimeout` (ES5 style)

**Analog:** Not yet in codebase — but matches project ES5 pattern (per RESEARCH.md "Don't Hand-Roll" table). Use:
```javascript
var _soSearchTimer = null;

function onSoSearchInput(term) {
  clearTimeout(_soSearchTimer);
  if (!term || term.length < 2) {
    document.getElementById('bp-so-search-results').innerHTML = '';
    return;
  }
  _soSearchTimer = setTimeout(function () {
    fetchSoSearch(term);
  }, 400);
}
```
`_soSearchTimer` follows the `_detailBatchId` / `_detailStartDate` module-level var pattern (lines 1535–1534).

---

## Shared Patterns

### API Key Authentication
**Source:** `zoho-middleware/routes/pos.js` lines 1226–1229
**Apply to:** `POST /api/batch/sync-zoho`
```javascript
var apiKey = req.headers['x-api-key'] || req.query.api_key;
if (apiKey !== process.env.MW_API_KEY) {
  return res.status(401).json({ error: 'Unauthorized' });
}
```

### `zohoPut` Error Extraction
**Source:** `zoho-middleware/routes/pos.js` lines 1285–1291
**Apply to:** `POST /api/batch/sync-zoho` catch handler
```javascript
.catch(function (err) {
  var msg = err.message;
  if (err.response && err.response.data) {
    msg = err.response.data.message || err.response.data.error || msg;
  }
  log.error('[batch/sync-zoho] Zoho error: ' + msg);
  // Also call queueSyncForRetry here before responding 502
  res.status(502).json({ ok: false, error: 'Zoho sync failed — queued for retry' });
});
```

### Redis Retry TTL / MAX_RETRIES Constants
**Source:** `zoho-middleware/lib/brewpad-integration.js` lines 10–12
**Apply to:** New `queueSyncForRetry` in `brewpad-integration.js`
```javascript
var RETRY_TTL = 86400;   // 24 hours
var MAX_RETRIES = 3;
var RETRY_PREFIX = C.CACHE_KEYS.BATCH_RETRY_PREFIX;
```
Use the same TTL and MAX_RETRIES values. Use `C.CACHE_KEYS.BATCH_SYNC_RETRY_PREFIX` for the new queue.

### `setInterval` Retry Sweep Registration
**Source:** `zoho-middleware/server.js` lines 457–464
**Apply to:** Add `retrySyncQueue` call inside the existing 5-minute interval (do NOT create a second `setInterval`)
```javascript
setInterval(function () {
  brewpadIntegration.retryPendingBatches().catch(function (err) {
    log.error('[brewpad] Retry sweep failed: ' + err.message);
  });
  // Phase 7: also sweep Zoho sync retries
  brewpadIntegration.retrySyncQueue().catch(function (err) {
    log.error('[brewpad] Zoho sync retry sweep failed: ' + err.message);
  });
}, 5 * 60 * 1000);
```

### `escapeHTML` Usage (BrewPad frontend)
**Source:** `js/brewpad.js` lines 1553, 1562–1566 — `escapeHTML()` wraps every user-data string in DOM output
**Apply to:** All user-data strings in `buildLifecycleTimeline`, SO search results, Link SO button label

### `var` declarations — ES5 IIFE style
**Source:** `js/brewpad.js` line 88 onwards (`(function () { 'use strict'; ... })()`)
**Apply to:** All new functions in `brewpad.js` — no `const`, no `let`, no arrow functions. Module-private state uses `var _name = null` at IIFE top.

### Apps Script `headers.indexOf` column write
**Source:** `apps-script/adminApi.gs` lines 1880–1886
**Apply to:** All new column writes in `updateBatch`, `updateBatchSchedule`, `handlePackagingCompletion`
```javascript
var colIndex = headers.indexOf(field);
if (colIndex !== -1) {
  sheet.getRange(row, colIndex + 1).setValue(sanitizeInput(String(updates[field])));
}
```
Pattern is safe because `sheetToObjects` reads headers dynamically — columns need to exist in the sheet header row but the code does not use hardcoded column numbers.

---

## No Analog Found

All files have close analogs. No entries needed here.

---

## Pre-Conditions (Wave 0 — human actions required before implementation)

These are not code patterns but must be noted for the planner:

1. **Zoho Custom Field creation** — staff must create a "Batch Status" text field in Zoho Books → Settings → Custom Fields → Sales Orders, then set `ZOHO_CF_BATCH_STATUS=<api_name>` in Railway env and local `.env`.
2. **Batches sheet column extension** — add `fermentation_started_at` (col 23) and `completed_at` (col 24) headers in the Google Sheet manually before deploying Apps Script changes.
3. **Apps Script redeployment** — after any change to `adminApi.gs`, publish a new version ("New version" in the Apps Script editor) before testing BrewPad calls that use new actions.

---

## Metadata

**Analog search scope:** `zoho-middleware/routes/`, `zoho-middleware/lib/`, `apps-script/`, `js/`
**Files read:** `brewpad-integration.js`, `constants.js`, `validateEnv.js`, `pos.js` (lines 450–884, 1213–1292), `adminApi.gs` (lines 1649–1717, 1794–1909, 1963–2070, 2241–2270), `brewpad.js` (lines 78–86, 1527–1613), `server.js` (lines 450–464)
**Pattern extraction date:** 2026-05-04
