# Phase 92: Kiosk past-sales lookup and ledger - Pattern Map

**Mapped:** 2026-10-16
**Files analyzed:** 14 new/modified
**Analogs found:** 13 / 14 (payments-list join has no codebase analog, see end)

All paths are relative to the repo root. Line numbers were read on 2026-10-16.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `zoho-middleware/routes/kiosk-history.js` (new) | route | request-response (read, cached, Zoho fan-out) | `zoho-middleware/routes/pos.js` :2376 salesorders, :3006 search-invoices, :3070 link-candidates, :4708 salesorder/:id | exact |
| `zoho-middleware/lib/kiosk-history.js` (new) | utility (pure helpers) | transform | `zoho-middleware/lib/batch-link-candidates.js` (pure, no I/O, date-string math) | exact |
| `zoho-middleware/lib/constants.js` (mod) | config | n/a | existing `CACHE_KEYS` block :14-40 | exact |
| `zoho-middleware/lib/authTiers.js` (mod) | config | n/a | `KIOSK_ROUTES` :47-72 and `isKioskRoute` :90 | exact |
| `zoho-middleware/server.js` (mod) | config | n/a | `app.use('/', require('./routes/pos'))` :790 | exact |
| `zoho-middleware/__tests__/kiosk-history.test.js` (new) | test | request-response | `zoho-middleware/__tests__/kiosk-salesorders.test.js` | exact |
| `zoho-middleware/__tests__/kiosk-history-lib.test.js` (new) | test | transform | existing lib tests, e.g. batch-link-candidates tests | role-match |
| `zoho-middleware/__tests__/fixtures/` S1 payments fixture (new) | test fixture | n/a | none (spike output) | none |
| `kiosk.html` (mod) | component (markup) | n/a | header buttons :66-77, `#kiosk-view-collect` :378-403 | exact |
| `css/kiosk.css` (mod) | config (style) | n/a | `.kiosk-collect-header` :1917, `.kiosk-so-list` :1959, `.kiosk-so-chip` :2433 | exact |
| `js/kiosk-core.js` (mod) | component (view logic) | request-response + client state | `kioskShowCollect` / `kioskLoadSalesOrders` / `kioskRenderSoList` :4267-4450, contact search :2735 | exact |
| `js/kiosk.js` (mod) | component (wiring) | event-driven | Sales Orders wiring :1530-1560, `showLockScreen` :326 | exact |
| `tests/frontend/kiosk-past-sales.test.js` (new) | test | event-driven | `tests/frontend/kiosk-gift-card-mgmt.test.js` (`loadSurface`) | exact |
| `js/kiosk-core.min.js`, `js/kiosk.min.js`, `css/kiosk.min.css` | build artifacts | n/a | produced by `npm run build`; never hand-edit | n/a |

## Pattern Assignments

### `zoho-middleware/routes/kiosk-history.js` (route, request-response)

**Analog:** `zoho-middleware/routes/pos.js`. This is a new file, so the imports are a trimmed subset of pos.js :1-33.

**Imports pattern** (pos.js :1-12, :31):
```javascript
var express = require('express');
var zohoApi = require('../lib/zoho-api');
var cache = require('../lib/cache');
var log = require('../lib/logger');
var authTiers = require('../lib/authTiers');
var C = require('../lib/constants');
var zohoGet = zohoApi.zohoGet;
var router = express.Router();
// ... end of file: module.exports = router;
```
Add `var hist = require('../lib/kiosk-history');`. Mount it in `server.js` after :790 with `app.use('/', require('./routes/kiosk-history'));`.

**Auth pattern** (pos.js :2376-2377). GET routes skip the global guard, so each handler self-gates. D-10 uses the same tiers as salesorders:
```javascript
router.get('/api/kiosk/salesorders', function (req, res) {
  authTiers.requireTiers(['legacy', 'device', 'session'])(req, res, function () {
  ...
  });
});
```

**Cache + slim map + 502 pattern** (pos.js :2382-2452):
```javascript
cache.get(KIOSK_SO_CACHE_KEY)
  .then(function (cached) {
    if (cached) { log.info('[kiosk/salesorders] Cache hit'); return cached; }
    return zohoGet('/salesorders', ...).then(function (results) {
      var orders = combined.map(function (so) {
        return { salesorder_id: so.salesorder_id || '', ... line_items: (so.line_items || []).map(function (li) {
          return { item_id: li.item_id || '', name: li.name || li.description || '',
                   quantity: li.quantity || 1, rate: li.rate || 0, amount: li.amount || 0 };
        }) };
      });
      cache.set(KIOSK_SO_CACHE_KEY, orders, KIOSK_SO_CACHE_TTL).catch(function () {});
      return orders;
    });
  })
  .then(function (orders) { res.json({ salesorders: orders }); })
  .catch(function (err) {
    log.error('[kiosk/salesorders] ' + err.message);
    res.status(502).json({ error: 'Unable to fetch sales orders' });
  });
```
Differences for Phase 92:
- Build the allowlist field by field.
- Line-item amount is `li.item_total || li.amount || 0` (pos.js :3039, :4736).
- Never cache a 502.
- Support `?bust=1` by skipping the `cache.get`.
- The RESEARCH.md "Code Examples" ledger route is the target shape.

**Sequential Zoho chain with a hard server-side cap** (pos.js :3020-3056, and :3103-3113). Never use `Promise.all` for new multi-call work. (salesorders uses `Promise.all` for 5 calls, which is the legacy exception, so do not copy it.)
```javascript
var MAX_DETAIL_FETCH = 10; // never request-controlled (Phase-57 WR-02)
var chain = Promise.resolve();
matched.forEach(function (inv) {
  chain = chain.then(function () {
    return zohoGet('/invoices/' + inv.invoice_id).then(function (detailData) {
      var detail = detailData.invoice || {};
      ...
    });
  });
});
return chain.then(function () { res.json({ invoices: invoices }); });
```

**Cache-with-fallback + versioned key pattern** (pos.js :3080-3083, :3120-3127):
```javascript
var cacheKey = 'batch-link-cand:v1:' + ... + ':' + q.start_date;
Promise.resolve()
  .then(function () { return cache.get(cacheKey); })
  .catch(function (err) {
    log.warn('[batch/link-candidates] cache get failed (treated as miss): ' + (err && err.message));
    return null;
  })
  .then(function (hit) {
    if (hit && Array.isArray(hit.candidates)) return hit;
    return lookup().then(function (fresh) { ... });
  })
```

**Query params to Zoho** (pos.js :3087). `customer_id` combined with `date_start`/`date_end` is proven:
```javascript
var params = { date_start: win.date_start, date_end: win.date_end, sort_column: 'date', per_page: 200 };
if (q.customer_id) { params.customer_id = q.customer_id; }
```
Use constants only. Never pass `per_page`, `page` or `status` through from `req.query`.

**Validation pattern (reject, do not sanitize)** (pos.js :3072-3075):
```javascript
var q = linkCandidates.validateCandidateQuery(req.query);
if (!q.ok) {
  return res.status(400).json({ error: 'bad_request', message: q.message });
}
```
For the invoice detail route, the analog is pos.js :4708-4750, which does NOT validate `:id`. Improve it with `/^\d{6,25}$/` and respond 400 before any `zohoGet('/invoices/' + id)` call.

**Detail route error logging** (pos.js :4741-4747). Log the message only, with no names or PII:
```javascript
.catch(function (err) {
  var msg = err.message;
  if (err.response && err.response.data) { msg = err.response.data.message || err.response.data.error || msg; }
  log.error('[kiosk/so-detail] Zoho error: ' + msg);
  res.status(502).json({ error: 'Failed to fetch sales order' });
});
```

**Walk-in exclusion (D-09).** There is no direct analog. Read `process.env.KIOSK_CONTACT_ID` at request time. If `customer_id` equals it, return `res.json({ walk_in: true, invoices: [] })` before any `zohoGet` call. Log a warning if the env var is unset.

**Contact picker:** reuse `GET /api/contacts/search` at pos.js :3771 unchanged. It requires at least 2 chars and returns `{ contacts: [{contact_id, contact_name, email, phone}] }`.

---

### `zoho-middleware/lib/kiosk-history.js` (utility, transform)

**Analog:** `zoho-middleware/lib/batch-link-candidates.js` (pure, no I/O, ES5, `'use strict'`, exports an object including its constants).

**File header and date-string math** (batch-link-candidates.js :1-30):
```javascript
'use strict';
// ... No I/O. Window math runs on YYYY-MM-DD strings via Date.UTC so it never
// depends on the process timezone.
var DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
var MS_PER_DAY = 86400000;
function parseDateUtc(str) {
  var m = DATE_RE.exec(String(str || ''));
  if (!m) return null;
  var y = Number(m[1]); var mo = Number(m[2]); var d = Number(m[3]);
  var t = Date.UTC(y, mo - 1, d);
  var dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return t;
}
```
Reuse this idea for `isRealDate`, and for day +/- 1 and the 12-month window arithmetic. Consider requiring `parseDateUtc` and `formatDateUtc` from `batch-link-candidates` instead of duplicating them, but they are not currently exported, so copy them or export them with care. Exporting from a shared lib triggers the full-suite rule.

**Vancouver day idiom** (`zoho-middleware/lib/batch-rules.js` :718-731, not exported, so copy it into the new lib):
```javascript
function zoneParts(date, timezone) {
  var parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  var out = {};
  parts.forEach(function (p) { out[p.type] = p.value; });
  return out;
}
function formatDay(date, timezone) {
  var p = zoneParts(date, timezone);
  return p.year + '-' + p.month + '-' + p.day;
}
```
Use `'America/Vancouver'`. Never hardcode an offset. For `created_time` (ISO with offset such as `2026-10-16T19:30:00-0700`), parse it to an instant first, then call `formatDay(instant, 'America/Vancouver')`. Note that `-0700` has no colon, so `new Date()` may not parse it everywhere. Normalise it to `-07:00` before parsing, and test it.

**Pure helper shapes to put here** (from RESEARCH.md Code Examples; keep them as written):
- `TENDER` map: `{creditcard:'Card', debitcard:'Card', cash:'Cash', others:'Gift card'}`, unknown mode becomes `'Other'`, order Card, Cash, Gift card, Other.
- `slimInvoiceRow(inv, source, tender)`: field by field, with no `reference_number`.
- `classify(inv, payments)`:
  - in-store when the reference starts with `KIOSK-` or `POS-`, or a payment note starts with `Kiosk `, `In-store terminal payment` or `Legacy POS payment`;
  - online when the reference is all digits or a note starts with `Online payment`;
  - otherwise other.
- `statusLabel`, `hhmmVancouver`, `vancouverDay`, `isRealDate`.
- Integer-cents totals, with voids excluded.

**Export style** (batch-link-candidates.js :116-126): a flat `module.exports = { fn: fn, ..., CONST: CONST }`.

---

### `zoho-middleware/lib/constants.js` (config, mod)

**Analog:** its own `CACHE_KEYS` block (:14-40). Prefix entries use a trailing colon and a comment such as `// append date string`:
```javascript
AVAILABILITY_PREFIX: 'zoho:availability:',     // append date string
CONTACT_PREFIX:      'zoho:contact:email:',    // append lowercased email
```
Add `KIOSK_HISTORY_LEDGER_PREFIX`, `KIOSK_HISTORY_CUSTOMER_PREFIX` and `KIOSK_HISTORY_INVOICE_PREFIX`. Include a version segment such as `kiosk:history:ledger:v1:`. Keys come only from validated ids and dates.

---

### `zoho-middleware/lib/authTiers.js` (config, mod)

**Analog:** the `KIOSK_ROUTES` list (:47-72). Entries are exact paths with trailing explanatory comments, and the param route is documentation-only, matched by prefix in `isKioskRoute` (:90-98):
```javascript
'/api/kiosk/salesorders',
'/api/kiosk/salesorder/:id', // documentation only — matched via prefix below
...
if (path.indexOf('/api/kiosk/salesorder/') === 0 &&
    KIOSK_SALESORDER_LITERAL_ROUTES.indexOf(path) === -1) { return true; }
if (path.indexOf('/api/kiosk/discounts/') === 0) return true;
```
Add `/api/kiosk/past-sales/ledger`, `/api/kiosk/past-sales/customer`, and a documented `/api/kiosk/past-sales/invoice/:id` plus a prefix check `path.indexOf('/api/kiosk/past-sales/invoice/') === 0`. Use distinct path names so the `/api/kiosk/salesorder/` prefix is not triggered. Do not touch `PII_GET_ROUTES` in `server.js` (D-46-02).

---

### `zoho-middleware/__tests__/kiosk-history.test.js` (test, request-response)

**Analog:** `zoho-middleware/__tests__/kiosk-salesorders.test.js`. Copy the mock block, the fake-router registry, `findHandler`, `makeReq`, `makeRes` and `flushPromises` wholesale.

**Mocks and fake router** (lines 16-75):
```javascript
jest.mock('../lib/zoho-api', function () { return { zohoGet: jest.fn(), zohoPost: jest.fn(), zohoPut: jest.fn() }; });
jest.mock('../lib/cache', function () { return {
  get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1), isConnected: jest.fn().mockReturnValue(true) }; });
jest.mock('../lib/eventLog', function () { return { logEvent: jest.fn() }; });
jest.mock('../lib/logger', function () { return { info: jest.fn(), warn: jest.fn(), error: jest.fn() }; });

var _routeRegistry = { get: [], post: [], put: [] };
jest.mock('express', function () {
  var router = { get: jest.fn(function (path, handler) { _routeRegistry.get.push({ path: path, handler: handler }); }), ... };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});
require('../routes/kiosk-history');
function findHandler(method, path) { ... }
```

**Auth and 401 test** (lines 119-142):
```javascript
beforeEach(function () {
  jest.clearAllMocks();
  cache.get.mockResolvedValue(null);
  OLD_MW_KEY = process.env.MW_API_KEY;
  process.env.MW_API_KEY = 'test-api-key';
});
test('returns 401 without x-api-key header', function () {
  var res = makeRes();
  getSalesordersHandler(makeReq(null, {}, {}), res);
  expect(res._status).toBe(401);
  expect(zohoApi.zohoGet).not.toHaveBeenCalled();
});
```
For the device-token case, set `KIOSK_DEVICE_TOKEN` and send `x-device-token`. See `kiosk-bundles.test.js` for the existing usage, which I have not read. The planner should confirm the exact header handling there.

**KIOSK_ROUTES membership test** (`zoho-middleware/__tests__/gift-cards-adjust.test.js` :355-375):
```javascript
jest.resetModules();
var authTiers = require('../lib/authTiers');
expect(authTiers.KIOSK_ROUTES.indexOf('/api/kiosk/gift-card/adjust')).not.toBe(-1);
expect(authTiers.isKioskRoute('/api/kiosk/gift-card/adjust')).toBe(true);
```

Further test cases are listed in RESEARCH.md "Validation Architecture": allowlist key equality plus a sentinel-string leak check, a walk-in test asserting `zohoGet` was not called, a caps test asserting `zohoGet` params, bust and TTL checks, and invoice id 400s.

---

### `kiosk.html` (component markup, mod)

**Header button analog** (:66-77). Add `<button type="button" class="btn-secondary admin-btn-sm" id="kiosk-past-sales-btn">Past Sales</button>` next to `kiosk-orders-btn`:
```html
<button type="button" class="btn-secondary admin-btn-sm" id="kiosk-orders-btn">Sales Orders</button>
<button type="button" class="btn-secondary admin-btn-sm" id="kiosk-browse-mode-btn">Customer View</button>
<button type="button" class="btn-secondary admin-btn-sm" id="kiosk-gc-mgmt-btn">Gift Cards</button>
```

**View container analog** (:378-403). Copy this structure into `<div id="kiosk-view-past-sales" class="kiosk-view" style="display:none;">`. The view id must be `kiosk-view-<name>` because `kioskShowView` builds ids that way:
```html
<div id="kiosk-view-collect" class="kiosk-view" style="display:none;">
  <div class="kiosk-collect-header">
    <h2>Sales Orders</h2>
    <div class="kiosk-collect-actions">
      <input type="search" id="kiosk-so-search" class="kiosk-search-input" placeholder="Search by customer..." autocomplete="off">
      <button type="button" class="btn-secondary kiosk-refresh-btn" id="kiosk-so-refresh" title="Refresh">&#8635;</button>
    </div>
  </div>
  <div class="kiosk-so-status-filter">
    <button type="button" class="kiosk-so-chip kiosk-so-chip--open active" data-status="open">Open</button>
  </div>
  <div id="kiosk-so-list" class="kiosk-so-list"></div>
  <div class="kiosk-collect-footer">
    <button type="button" class="btn-secondary" id="kiosk-collect-back">&larr; Back to POS</button>
  </div>
</div>
```
Use the chip row for the two tabs ("By customer" / "Ledger"). Add the day picker (‹ ›, `<input type="date">`) and the footer total line. No CSP change is needed (kiosk.html :17 already allows the middleware origins). Run `npm run build` afterwards: `stamp:kiosk` rewrites the `?v=` cache-busters.

---

### `css/kiosk.css` (mod)

**Analogs:** `.kiosk-collect-header` :1917, `.kiosk-collect-footer` :1949, `.kiosk-so-list` :1959, the mobile overrides at :2229-2239, and `.kiosk-so-chip` :2433 (with `--open.active`-style modifiers at :2447). Mirror these as `.kiosk-ps-*` classes for the tabs, row, badge (In-store / Online / Other, Void greyed), expanded detail and totals footer.

---

### `js/kiosk-core.js` (view logic, mod)

**Analog:** the Sales Orders block at :4261-4450. All code is ES5 (`var`, `function`, string concatenation).

**View switch, the D-11 choke point** (:951-962). Add `'past-sales'` to the `views` array, or the view will never be hidden. Call `kioskPastSalesClear()` whenever `name !== 'past-sales'`:
```javascript
function kioskShowView(name) {
  var views = ['browse', 'browse-customer', 'customer', 'payment', 'review-batches', 'receipt', 'error', 'collect', 'create-so'];
  views.forEach(function (v) {
    var el = document.getElementById('kiosk-view-' + v);
    if (el) el.style.display = (v === name) ? '' : 'none';
  });
  _kioskCurrentView = name;
  ...
}
```

**Show + load entry** (:4267-4299). Copy for `kioskShowPastSales` and the two loaders. Note the existing code's weaknesses, which should be fixed in the new code: it does not check `r.ok`, so a 502 `{error}` is parsed as data, and it has no stale-response guard. The new view needs `r.ok` handling plus a generation counter for D-11.
```javascript
function kioskShowCollect() { kioskShowView('collect'); kioskLoadSalesOrders(); }
function kioskLoadSalesOrders() {
  var mwUrl = _kcEnv.mwUrl;
  if (!mwUrl) { ... '<p class="kiosk-loading">Middleware URL not configured.</p>'; return; }
  list.innerHTML = '<div class="kiosk-so-skeleton">...</div>';
  fetch(mwUrl + '/api/kiosk/salesorders', _kcMergeAuth({
    method: 'GET', headers: { 'Content-Type': 'application/json' }
  }))
  .then(function (r) { return r.json(); })
  .then(function (data) { _kioskSalesOrders = data.salesorders || []; ... })
  .catch(function (err) {
    if (list) list.innerHTML = '<p class="kiosk-loading">Could not load sales orders. Check connection and try again.</p>';
  });
}
```

**Auth seam** (:116-131): every fetch goes through `_kcMergeAuth(opts)`, which adds `x-device-token` on the standalone surface.

**Row render with escaping** (:4346-4357). Use `escapeHTML` on every dynamic string and `kioskFmt` for money:
```javascript
html += '<div class="kiosk-so-card" data-so-id="' + escapeHTML(so.salesorder_id) + '">';
html += '<span class="kiosk-so-customer">' + escapeHTML(so.customer_name || 'Unknown') + '</span>';
html += '<button type="button" class="kiosk-so-toggle-btn" data-so-id="' + escapeHTML(so.salesorder_id) + '">View Items &#9662;</button>';
```

**Tap-to-expand detail (D-15)** (:4416-4465). The toggle, loaded-flag and fetch-on-first-tap pattern is exactly what D-15 wants. Adapt it to also read from a module-level details Map (cleared per D-11), and to render subtotal, tax and total plus the `amount` per line:
```javascript
if (detailEl.style.display !== 'none') { detailEl.style.display = 'none'; btn.innerHTML = 'View Items &#9662;'; return; }
if (detailEl.getAttribute('data-loaded')) { detailEl.style.display = ''; btn.innerHTML = 'Hide Items &#9652;'; return; }
btn.innerHTML = 'Loading...';
fetch(mwUrl + '/api/kiosk/salesorder/' + encodeURIComponent(soId), _kcMergeAuth({ method: 'GET', headers: {...} }))
  .then(function (r) { return r.json(); })
  .then(function (detail) { ... detailEl.setAttribute('data-loaded', 'true'); ... })
  .catch(function () { detailEl.innerHTML = '<div class="kiosk-so-detail-empty">Could not load items</div>'; ... });
```

**Contact search UI (By customer tab)** (:2735-2780). Copy the debounce (300 ms), the 2-char guard (`if (!q) {...}`), the `/api/contacts/search?q=` fetch and the result-row rendering. Replace `kioskSelectCustomer(...)` with a call that loads that contact's history. Note that this analog renders `c.email` in the dropdown. For Past Sales, show the name only if that is preferable for D-11 privacy, which is a planner call:
```javascript
searchTimer = setTimeout(function () {
  fetch(mwUrl + '/api/contacts/search?q=' + encodeURIComponent(q), _kcMergeAuth({}))
  .then(function (r) { return r.json(); })
  .then(function (data) {
    var contacts = (data.contacts || []).slice(0, 8);
    ...
    html += '<div class="kiosk-customer-result-row" data-id="' + escapeHTML(c.contact_id || '') + '">' + ...
```

**Export** (:6131). Add to the `KioskCore` return object next to `showGiftCardMgmt: kioskShowGiftCardMgmt,` as `showPastSales`, `clearPastSales` and similar. Guard every `getElementById` with a null check, because `admin.html` loads `kiosk-core.min.js` without this markup.

**Other D-11 hooks** (per RESEARCH.md): `_kcEnv.setCustomer(null)` at the New Sale handlers (kiosk-core.js ~:4250, ~:4747). The grep above did not show line :4250 in this block, so re-grep before editing. Also hook the lock screen (see kiosk.js below). Refuse to render while `_kioskCurrentView === 'browse-customer'`.

---

### `js/kiosk.js` (wiring, mod)

**Analog:** the Sales Orders wiring at :1530-1560:
```javascript
var soBtn = document.getElementById('kiosk-orders-btn');
if (soBtn) { soBtn.addEventListener('click', kioskShowCollect); }
var soRefresh = document.getElementById('kiosk-so-refresh');
if (soRefresh) { soRefresh.addEventListener('click', function () { kioskLoadSalesOrders(); }); }
var collectBack = document.getElementById('kiosk-collect-back');
```
Add the Past Sales button, tab clicks, day arrows and date input, refresh (which sends `bust=1`) and a back button, all via `KioskCore.*`. See also :220 (`KioskCore.showGiftCardMgmt();`) for how kiosk.js calls into the core.

**Lock-screen clearing hook:** `showLockScreen(session)` at :326 sets `_isLocked = true;` first. Add a call to `KioskCore.clearPastSales()` there.

**Customer View toggle:** `kioskShowCustomerBrowse` (kiosk.js ~:749 / ~:1494) already calls `kioskShowView('browse-customer')`, so the choke-point hook covers it. Do not add a Past Sales button to the customer-facing view.

---

### `tests/frontend/kiosk-past-sales.test.js` (test, event-driven)

**Analog:** `tests/frontend/kiosk-gift-card-mgmt.test.js`. Copy the header globals (lines 16-50) and the `loadSurface` / `injectEl` harness (lines 52-80). It drives the real `js/kiosk.js` env injection, so `_kcMergeAuth` resolves to the device-token shape.
```javascript
global.fetch = jest.fn(function () {
  return Promise.resolve({ status: 200, json: function () { return Promise.resolve({}); } });
});
global.SHEETS_CONFIG = { MIDDLEWARE_URL: 'http://localhost:3001', ... };
function loadSurface(path) {
  jest.resetModules();
  if (global.window) delete global.window.KioskCore;
  document.body.innerHTML = '';
  var mod = require(path);
  return { mod: mod, core: global.window.KioskCore };
}
```
The fake `fetch` in this analog returns `{status, json}` with no `ok` field. If the new code checks `r.ok`, the test mocks must include `ok`. Also keep `tests/frontend/kiosk-core-parity.test.js` green, and see `kiosk-attract-reset.test.js` and `kiosk-html-escaping.test.js` for the idle-reset and escaping conventions.

---

## Shared Patterns

### Self-gated kiosk GET auth
**Source:** `zoho-middleware/routes/pos.js` :2376-2377
**Apply to:** all three new routes
```javascript
authTiers.requireTiers(['legacy', 'device', 'session'])(req, res, function () { ... });
```

### 502 on Zoho failure, no PII in logs
**Source:** pos.js :2449-2452, :4741-4747
**Apply to:** all three new routes. Log ids and counts only, never names (T-29.1-03).
```javascript
log.error('[kiosk/salesorders] ' + err.message);
res.status(502).json({ error: 'Unable to fetch sales orders' });
```

### Slim allowlist mapping (D-12)
**Source:** pos.js :2410-2430 and :4721-4739 (field-by-field with `|| ''` / `|| 0` defaults)
**Apply to:** every response. Never spread the Zoho object. Do not return `reference_number`, notes, email, phone or custom fields.

### Sequential, bounded Zoho calls
**Source:** pos.js :3020-3056 and :3103-3113 (`MAX_DETAIL_FETCH`, `chain = chain.then(...)`)
**Apply to:** the ledger (invoice pages, then payments for D and D+1) and the customer route (invoices, then payments for the source tag). Page caps are hard-coded constants.

### ES5 only in frontend and middleware
**Apply to:** all new `.js` files (`var`, `function`, no arrows, no template literals). Both `js/kiosk-core.js` and the middleware files follow this.

### Build and test gates (CLAUDE.md)
Never edit `js/main.js`, `*.min.js`. Run `npm run build` after the kiosk JS and CSS changes. Run `npm test`, `cd zoho-middleware && npm test` (the full suite, since `lib/` gains a file and `authTiers.js` and `constants.js` are shared) and `npm run lint` before any commit. Do not modify existing tests.

## No Analog Found

| File / concern | Role | Data Flow | Reason |
|---|---|---|---|
| `GET /customerpayments` call and payment-to-invoice join | route logic | read, join | No code in the repo has ever called `/customerpayments` (RESEARCH.md; unchanged by this mapping). Response shape is unverified (assumptions A1-A3), so do the Wave 0 Spike S1 first and save a sanitized fixture. Use the `zohoGet('/customerpayments', {date: D, per_page: 200, page: n})` form, following the `params` object style at pos.js :3087 and the `has_more_page` paging at pos.js :3251. |
| Vancouver `created_time` bucketing and `vancouverDay` as an exported helper | utility | transform | Only the non-exported `zoneParts` / `formatDay` idiom at `lib/batch-rules.js` :718-731 exists. Copy the idiom, do not import (not exported). |
| Stale-response generation counter and "clear on view change" | client state | event-driven | Nothing equivalent in the Sales Orders code. `kioskLoadSalesOrders` has no stale guard. Design it new per RESEARCH.md "Frontend". |
| Day picker (`<input type="date">` with ‹ ›) | component | event-driven | No existing date picker in the kiosk view. Use plain markup with server-supplied `today`. |
| `zoho-middleware/__tests__/fixtures/` S1 fixture | test fixture | n/a | Depends on the spike output. |

## Metadata

**Analog search scope:** `zoho-middleware/routes/`, `zoho-middleware/lib/`, `zoho-middleware/__tests__/`, `kiosk.html`, `css/kiosk.css`, `js/kiosk-core.js`, `js/kiosk.js`, `tests/frontend/`
**Files read or excerpted:** about 14
**Pattern extraction date:** 2026-10-16
**Caveats:**
- I did not read `kiosk-bundles.test.js`, so the device-token test setup is unconfirmed.
- Some kiosk-core.js line numbers quoted from RESEARCH.md (:4250, :4747, :2948) were not re-verified here.
