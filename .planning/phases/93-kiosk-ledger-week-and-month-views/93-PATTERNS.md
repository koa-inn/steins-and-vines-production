# Phase 93: Kiosk ledger week and month views - Pattern Map

**Mapped:** 2026-10-17
**Files analyzed:** 11 new/modified (plus build artifacts)
**Analogs found:** 11 / 11 (every file extends Phase 92 code that already exists; no external analogs needed)

All line numbers were re-read against current code on 2026-10-17. They supersede `92-PATTERNS.md` (which cited pre-implementation locations).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `zoho-middleware/routes/kiosk-history.js` (mod: caps, `buildRange`, `GET /range`, refactor `buildLedger` to shared helper) | route | request-response (cached, sequential Zoho fan-out) | same file: `buildLedger` :135-185 + ledger route :187-212 | exact |
| `zoho-middleware/lib/kiosk-history.js` (mod: `weekStart`, `monthStart`, `monthEnd`, `periodBounds`, `inDayQueryWindow`, `paymentInDayWindow`, `needsPaymentNotes`, `ledgerRowsForDay`) | utility (pure) | transform | same file: `addDays`/`addMonths` :49-65, `classify` :134, `ledgerTotals` :227 | exact |
| `zoho-middleware/lib/constants.js` (mod: `KIOSK_HISTORY_RANGE_PREFIX`) | config | n/a | `CACHE_KEYS` lines 46-49 | exact |
| `zoho-middleware/lib/authTiers.js` (mod: allowlist entry) | config | n/a | `KIOSK_ROUTES` lines 70-72 | exact |
| `zoho-middleware/__tests__/kiosk-history-range.test.js` (new) | test | request-response | `zoho-middleware/__tests__/kiosk-history-ledger.test.js` | exact |
| `zoho-middleware/__tests__/kiosk-history-lib.test.js` (extend, or new `kiosk-history-range-lib.test.js`) | test | transform | `kiosk-history-lib.test.js` | exact |
| `kiosk.html` (mod: mode chips, range label, back link) | component (markup) | n/a | Past Sales ledger panel :429-438 | exact |
| `css/kiosk.css` (mod: `.kiosk-ps-mode`, `.kiosk-ps-dayrow*`, back link) | config (style) | n/a | `.kiosk-ps-*` rules :2998-3038 | exact |
| `js/kiosk-core.js` (mod: mode state, `kioskPsLoadRange`, `kioskPsRenderRange`, drill-in/back, clear, refresh, exports) | component (view logic) | request-response + client state | same file :4480-4794 (`kioskPsLoadLedger`, `kioskPsRenderLedger`, `kioskPastSalesClear`) | exact |
| `js/kiosk.js` (mod: chip and back-link wiring) | component (wiring) | event-driven | same file :1590-1618 | exact |
| `tests/frontend/kiosk-past-sales-range.test.js` (new) | test | event-driven | `tests/frontend/kiosk-past-sales.test.js` | exact |
| `js/kiosk-core.min.js`, `js/kiosk.min.js`, `css/kiosk.min.css`, `kiosk.html` `?v=` stamps | build artifacts | n/a | `npm run build` only; never hand-edit | n/a |

## Pattern Assignments

### `zoho-middleware/routes/kiosk-history.js` (route, request-response)

**Analog:** itself. No new imports needed (lines 1-10 already have `express, zohoApi, cache, log, authTiers, C, hist`).

**Caps block to extend** (lines 16-29). Add beside these, hard-coded, never read from `req`:
```javascript
var LEDGER_MAX_INVOICE_PAGES = 3;
var LEDGER_MAX_PAYMENT_PAGES = 3;
var PER_PAGE = 200;
var LEDGER_MIN_DATE = '2020-01-01';
var TTL_TODAY = 60;
var TTL_PAST = 3600;
```
New: `RANGE_MAX_INVOICE_PAGES = 5`, `RANGE_MAX_PAYMENT_PAGES = 5`, `TTL_RANGE_CURRENT = 300`. Export them in `_internals.caps` (lines 350-360). Live volume confirmed: Sept = 28 invoices, so 5 pages is about 35x headroom.

**Self-gate** (lines 55-58): reuse `gate(req, res, fn)` unchanged. It wraps `authTiers.requireTiers(['legacy', 'device', 'session'])`.

**Cache/dedupe/bust throttle** (lines 60-107): reuse `cachedOrBuild(key, ttl, bust, build)` unchanged. `ttl` may be a function of the built payload (line 82), which is what `current ? 300 : 3600` needs. Existing precedent for a function TTL is the invoice route (lines 324-326):
```javascript
var ttl = function (d) {
  return (d.status === 'Paid' || d.status === 'Void') ? TTL_PAST : TTL_TODAY;
};
cachedOrBuild(C.CACHE_KEYS.KIOSK_HISTORY_INVOICE_PREFIX + id, ttl, isBust(req.query || {}), function () { ... })
```

**Sequential paging** (lines 110-122): `fetchPages(path, params, maxPages, listKey)` returns `{ rows, truncated }`. Never use `Promise.all`.

**Core pattern to copy for `buildRange`** (`buildLedger`, lines 135-185). The chain is invoices, filter by `createdDay`, payments, `indexPaymentsByInvoice`, `classify`, `slimInvoiceRow`, `ledgerTotals`:
```javascript
var nextDay = hist.addDays(day, 1);
return fetchPages('/invoices', {
  date_start: day, date_end: nextDay, sort_column: 'created_time', sort_order: 'D', per_page: PER_PAGE
}, LEDGER_MAX_INVOICE_PAGES, 'invoices').then(function (inv) {
  truncated = truncated || inv.truncated;
  invoices = inv.rows.filter(function (i) { return hist.createdDay(i) === day; });
  return fetchPages('/customerpayments', {
    date_start: day, date_end: nextDay, per_page: PER_PAGE
  }, LEDGER_MAX_PAYMENT_PAGES, 'customerpayments');
}).then(function (pay) {
  truncated = truncated || pay.truncated;
  var idx = hist.indexPaymentsByInvoice(pay.rows, config.linkageField, config.notesField);
  ...
  invoices.forEach(function (inv) {
    var paid = idx[inv.invoice_number] || [];
    var notes = paid.map(function (p) { return p.note; });
    if (hist.classify(inv, notes) !== 'in-store') return;
    kept.push(inv);
    ...
  });
  var rows = hist.sortByCreatedDesc(kept).map(function (inv) {
    return hist.slimInvoiceRow(inv, 'in-store', tenders[inv.invoice_id]);
  });
  var totals = hist.ledgerTotals(rows);
```
For range: same params but `date_start = effStart`, `date_end = addDays(periodEnd, 1)` (`effEnd` for current period, today + 1), per-day bucket via `createdDay` and the new `inDayQueryWindow`. Skip the payments call when no in-window invoice `needsPaymentNotes` (precedent for conditionally skipping: `buildCustomer` lines 231-234, which returns `{ rows: [], truncated: false }`; but do NOT copy its `/^\d+$/` test, see Shared Patterns).

Refactor note: `buildLedger` must call the new shared `hist.ledgerRowsForDay`. Existing `kiosk-history-ledger.test.js` and `kiosk-history-cache.test.js` must pass unmodified (CLAUDE.md rule 10).

**Route validation and handler** (lines 187-212, copy for `/api/kiosk/past-sales/range`):
```javascript
router.get('/api/kiosk/past-sales/ledger', function (req, res) {
  gate(req, res, function () {
    var today = hist.vancouverDay(new Date());
    var q = req.query || {};
    var day = today;
    if (q.date !== undefined && q.date !== '') {
      day = q.date;
      if (typeof day !== 'string' || !DATE_RE.test(day) || !hist.isRealDate(day)) {
        return badRequest(res, 'date must be a real YYYY-MM-DD date');
      }
      if (day > today) return badRequest(res, 'date cannot be in the future');
      if (day < LEDGER_MIN_DATE) return badRequest(res, 'date is before ' + LEDGER_MIN_DATE);
    }
    var bust = q.bust === '1' || q.bust === 1 || q.bust === true;
    cachedOrBuild(C.CACHE_KEYS.KIOSK_HISTORY_LEDGER_PREFIX + day, day === today ? TTL_TODAY : TTL_PAST, bust, function () {
      return buildLedger(day, today);
    }).then(function (payload) {
      res.json(payload);
    }).catch(function (err) {
      log.error('[kiosk/past-sales/range] ' + errMessage(err));
      if (!res.headersSent) res.status(502).json({ error: 'Unable to fetch sales' });
    });
  });
});
```
Differences: also whitelist `q.type` in `{week, month}` (400 otherwise); only `type`, `date`, `bust` are read (comment as T-92-11 does at line 188); use `isBust(q)` (line 214); key is `C.CACHE_KEYS.KIOSK_HISTORY_RANGE_PREFIX + type + ':' + periodStart` (nominal Monday or 1st, not the raw anchor); TTL function keys off `payload.current`.

**Error handling:** Zoho failure is never cached (`sharedBuild` rejects before `cache.set`) and returns 502; log `errMessage(err)` only, no PII (line 208).

**Response shape:** build field by field (slim): `type, period_start, period_end, range_start, range_end, today, current, prev_anchor, next_anchor, days[{date,count,gross_total,partial}], count, gross_total, truncated, classification_incomplete`. Footer gross = sum of per-day cents / 100, never a float sum.

---

### `zoho-middleware/lib/kiosk-history.js` (utility, transform)

**Analog:** itself. ES5, `'use strict'`, flat `module.exports` (lines 253-278).

**Date-string arithmetic to build on** (lines 28-65; `parseDateUtc` is NOT exported, so the new helpers must live in this file):
```javascript
function addDays(str, n) {
  var t = parseDateUtc(str);
  if (t === null) return null;
  return formatDateUtc(t + n * MS_PER_DAY);
}
function addMonths(str, n) { ... clamps day to month length ... }
```
New helpers (from RESEARCH.md, verified compatible): `weekStart(day)` via `new Date(parseDateUtc(day)).getUTCDay()` and `addDays(day, -((dow + 6) % 7))`; `monthStart(day)` = `day.slice(0, 8) + '01'`; `monthEnd(day)` = `addDays(addMonths(monthStart(day), 1), -1)`; `periodBounds(type, anchor)`.

**Classification source of truth** (lines 134-146). `needsPaymentNotes` MUST be derived from this, not a regex:
```javascript
function classify(inv, notes) {
  var ref = String((inv && inv.reference_number) || '');
  ...
  if (startsWithAny(ref, IN_STORE_REF_PREFIXES)) return 'in-store';
  if (ref === '') return 'in-store';
  if (inStoreNote) return 'in-store';
  if (/^\d+$/.test(ref)) return 'online';
  return 'other';
}
```
Confirmed against current code: a non-digit reference with an in-store note returns `in-store` (line 143 precedes 144), so the RESEARCH correction to D-12 stands. `needsPaymentNotes(inv)` = `classify(inv, []) !== classify(inv, [IN_STORE_NOTE_PREFIXES[0] + 'x'])`.

**Totals** (lines 227-236): `ledgerTotals(rows)` skips Void and Draft, sums in cents. Reuse per day; sum day cents for the range footer.

**Bucketing:** `createdDay(inv)` (line 90) uses Intl `America/Vancouver` and falls back to `inv.date`. `inDayQueryWindow(inv, day)` per RESEARCH: if `inv.date` is a valid `YYYY-MM-DD`, require `date === day || date === addDays(day, 1)`; if absent, accept.

**Exports:** append the new names to the existing flat export object (lines 253-278). Shared-lib change, so both full suites must run (CLAUDE.md rule 7).

---

### `zoho-middleware/lib/constants.js` (config)

**Analog:** lines 46-49:
```javascript
KIOSK_HISTORY_LEDGER_PREFIX:   'kiosk:history:ledger:v1:',   // append YYYY-MM-DD
KIOSK_HISTORY_CUSTOMER_PREFIX: 'kiosk:history:customer:v1:', // append customer_id + ':' + window
KIOSK_HISTORY_INVOICE_PREFIX:  'kiosk:history:invoice:v1:',  // append invoice_id
```
Add `KIOSK_HISTORY_RANGE_PREFIX: 'kiosk:history:range:v1:', // append type + ':' + period start YYYY-MM-DD`.

---

### `zoho-middleware/lib/authTiers.js` (config)

**Analog:** lines 70-72. Exact-path entries; `isKioskRoute` (lines 93-102) matches exact entries via `indexOf`, so no prefix change is needed:
```javascript
'/api/kiosk/past-sales/ledger', // Phase 92 D-10: read-only, allowlisted, capped
'/api/kiosk/past-sales/customer', // Phase 92 D-10: read-only, allowlisted, capped
'/api/kiosk/past-sales/invoice/:id', // ...documentation only — matched via prefix below
```
Add `'/api/kiosk/past-sales/range', // Phase 93: read-only, allowlisted, capped, slim`. Existing test asserts `/api/kiosk/past-sales/other` stays denied (kiosk-history-ledger.test.js :56); keep that true.

---

### `zoho-middleware/__tests__/kiosk-history-range.test.js` (test, request-response)

**Analog:** `zoho-middleware/__tests__/kiosk-history-ledger.test.js`. Copy the header wholesale (lines 1-52): `jest.mock` for `../lib/zoho-api`, `../lib/cache`, `../lib/logger`, the fake `express` router registry, `findHandler`, `makeReq`, `makeRes`, `flushPromises`, `settle`:
```javascript
jest.mock('../lib/zoho-api', function () { return { zohoGet: jest.fn(), zohoPost: jest.fn(), zohoPut: jest.fn() }; });
jest.mock('../lib/cache', function () { return {
  get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1), isConnected: jest.fn().mockReturnValue(true) }; });
var _routeRegistry = { get: [] };
jest.mock('express', function () { ... router.get pushes { path, handler } ... });
var router = require('../routes/kiosk-history');
var fixture = require('./fixtures/zoho-past-sales-shapes.json');
```
Registration test pattern (lines 53-65): assert `authTiers.KIOSK_ROUTES` contains the range path and `isKioskRoute('/api/kiosk/past-sales/range')` is true while `'/api/kiosk/past-sales/other'` is false.
Cache/bust tests: copy structure from `kiosk-history-cache.test.js` (use `router._internals.resetCacheState()` in `beforeEach`). Do not edit `zoho-past-sales-shapes.json`; inline the D-12 equality fixture. Must cover: caps not overridable via `per_page/page/max_pages`, slim keys only, TTL 300/3600, key by nominal period start, payments skipped only when no invoice `needsPaymentNotes`, D-12 equality against `buildLedger`-driven day handler output. The 2026-11-01 `createdDay` cases hit the known Node 20 failures; mark them like the existing vancouver-timezone tests.

---

### `zoho-middleware/__tests__/kiosk-history-lib.test.js` (extend) or new range-lib test

**Analog:** same file. Add pure unit tests for `weekStart`, `monthEnd`, `periodBounds` (Mon-Sun for every weekday, 2028 leap Feb, 2026-12-28 to 2027-01-03 rollover, 2026-11-01 week), `inDayQueryWindow`, `needsPaymentNotes`. Existing assertions must not be changed.

---

### `kiosk.html` (markup)

**Analog:** ledger panel, lines 429-438:
```html
<div id="kiosk-ps-ledger-panel" class="kiosk-ps-panel" style="display:none;">
  <div class="kiosk-ps-daybar">
    <button type="button" class="btn-secondary kiosk-ps-daybtn" id="kiosk-ps-prev" aria-label="Previous day">&lsaquo;</button>
    <input type="date" id="kiosk-ps-date" class="kiosk-search-input">
    <button type="button" class="btn-secondary kiosk-ps-daybtn" id="kiosk-ps-next" aria-label="Next day">&rsaquo;</button>
  </div>
  <div id="kiosk-ps-ledger-message" class="kiosk-ps-message"></div>
  <div id="kiosk-ps-ledger-list" class="kiosk-ps-list"></div>
  <div id="kiosk-ps-ledger-footer" class="kiosk-ps-total"></div>
</div>
```
Add above `.kiosk-ps-daybar`: a chip row copying the top tab row (lines 413-416: `<div class="kiosk-so-status-filter kiosk-ps-tabs">` with `<button class="kiosk-so-chip kiosk-ps-tab" data-tab="...">`), as `<div class="kiosk-so-status-filter kiosk-ps-modes">` with `<button class="kiosk-so-chip kiosk-ps-mode active" data-mode="day">Day</button>` plus week and month. Add a label element (for example `<span id="kiosk-ps-range-label" class="kiosk-ps-range-label">`) in the daybar, and `<button type="button" id="kiosk-ps-backlink" class="btn-secondary kiosk-ps-backlink" style="display:none;">` above `#kiosk-ps-ledger-message`. Use a distinct class from `kiosk-ps-tab` so the existing `.kiosk-ps-tab` query selector at kiosk.js :1594 and `kioskPsSetTab` are not affected. No CSP change. The existing frontend test injects real `kiosk.html` markup by id, so keep all existing ids.

---

### `css/kiosk.css` (style)

**Analog:** lines 3009-3035. Reuse these tokens: row card (`.kiosk-ps-row` :3012), `.kiosk-ps-row--void { opacity: 0.55; }` (:3014, model the greyed zero-day row on it), `.kiosk-ps-amount` (:3020), `.kiosk-ps-time` (:3017), `.kiosk-ps-badge--partial` (:3029, for a "partial" flag), `.kiosk-ps-message` (:3005, partial notice reuse), `.kiosk-ps-total` (:3034) with `.kiosk-ps-total:empty { display: none; }` (:3035: range footer must not be empty even for zero sales, see Pitfall 4). Add `.kiosk-ps-dayrow`, `--zero`, `--partial`, `.kiosk-ps-range-label`, `.kiosk-ps-backlink`. Mobile overrides at :3036-3038 show the padding convention. Scroller note (RESEARCH A4): `.kiosk-ps-panel` (:2998) is `overflow-y: auto; flex: 1; min-height: 0`, so the panel element `#kiosk-ps-ledger-panel` is the scroller whose `scrollTop` should be saved and restored for D-04.

---

### `js/kiosk-core.js` (view logic)

**Analog:** same file, ES5 only (`var`, `function`, no arrows, no template literals).

**State block to extend** (lines 4480-4495):
```javascript
var _kioskPsGen = 0;
var _kioskPsTab = 'customer';
var _kioskPsLedger = null;
var _kioskPsDetails = {};
var _kioskPsLedgerSeq = 0;
```
Add `_kioskPsMode = 'day'`, `_kioskPsRange = null`, `_kioskPsOrigin = null`. Reuse `_kioskPsLedgerSeq` for range loads so a day drill-in or mode switch invalidates a late month response.

**Loader pattern to clone for `kioskPsLoadRange`** (lines 4594-4626):
```javascript
var gen = _kioskPsGen;
var seq = ++_kioskPsLedgerSeq;
kioskPsSetHtml('kiosk-ps-ledger-message', 'Loading...');
kioskPsSetHtml('kiosk-ps-ledger-list', '<div class="kiosk-so-skeleton"><div class="kiosk-so-skeleton-card"></div>' + ...);
kioskPsSetHtml('kiosk-ps-ledger-footer', '');
_kioskPsFetch(path, gen).then(function (data) {
  if (data === null || seq !== _kioskPsLedgerSeq) return;
  _kioskPsLedger = data;
  kioskPsRenderLedger();
}).catch(function (err) {
  if (gen !== _kioskPsGen || seq !== _kioskPsLedgerSeq) return;
  kioskPsSetHtml('kiosk-ps-ledger-list', '');
  var is400 = !!(err && err.status === 400);
  var msg = is400 ? 'Pick a date up to today.' :
    'Could not load sales. Check connection and try again. ' +
    '<button type="button" class="btn-secondary kiosk-ps-retry">Retry</button>';
  ...
});
```
Range version: message "Loading October… this can take a few seconds" (D-09; build month name from a month-name array, not `new Date(str)`), path `/api/kiosk/past-sales/range?type=...&date=...[&bust=1]`, store `_kioskPsRange`, call `kioskPsRenderRange()`, and keep the same Retry-button wiring (the retry handler must recall `kioskPsLoadRange`).

**Fetch wrapper** (lines 4560-4578): `_kioskPsFetch(path, gen)` resolves `null` for stale gens and throws an Error with `.status` on non-2xx. Reuse as is; it goes through `_kcMergeAuth` (device token).

**Render pattern** (lines 4671-4705). Mirror: set date input `value` and `max` (:4674-4678), `nextBtn.disabled = !d.next_date` (:4680; range: `!d.next_anchor`, and also disable prev when `prev_anchor` is null), notes joined with `escapeHTML` into `kiosk-ps-ledger-message` (:4683-4687; add "Not all sales are shown for this period."), footer text pattern (:4696-4697):
```javascript
footer = escapeHTML(c + (c === 1 ? ' sale' : ' sales') + ' · ' + kioskPsFmtMoney(d.gross_total));
```
Differences: footer always renders (zero case "0 sales · $0.00"), prefix `'at least '` when `truncated`. Escape every server string with `escapeHTML`; money via `kioskPsFmtMoney` (:4497).

**Rows:** do NOT reuse `kioskPsWireRows` (:4707-4722), which attaches the invoice-detail toggle to `.kiosk-ps-row`. Write a separate `kioskPsWireDayRows` attaching click to `.kiosk-ps-dayrow:not(.kiosk-ps-dayrow--zero)` with `data-date`, calling `kioskPsOpenDay(date)`. Weekday label via `Date.UTC(y, m-1, d)` + `getUTCDay()`.

**Stepping** (lines 4724-4729): `kioskPsShiftDay(delta)` reads `prev_date`/`next_date`; make it mode-aware by branching to `_kioskPsRange.prev_anchor` / `next_anchor` and `kioskPsLoadRange`.

**Clearing, the D-11 choke point** (lines 4520-4556). `kioskShowView` already calls `kioskPastSalesClear()` for any view other than past-sales, and kiosk.js :330 calls `KioskCore.clearPastSales()` on lock. Extend this function (do not add new hooks) to reset `_kioskPsMode='day'`, `_kioskPsRange=null`, `_kioskPsOrigin=null`, activate the Day chip, hide the back link, clear the range label. The existing `ids` array (:4529-4531) already clears ledger list/footer/message; the date input clearing at :4533-4540 already removes `max`.

**Tab entry** (line 4591): `if (_kioskPsTab === 'ledger' && !_kioskPsLedger) kioskPsLoadLedger(null, false);` keep for day mode; add `!_kioskPsRange` branch for week/month.

**Refresh** (lines 4787-4794): branch in the `ledger` case: week/month busts the range (`bust=true`), day (including drilled-in) busts the day.

**State export for tests** (line ~6664): extend `_getPastSalesState` additively (`mode`, `range`, `origin`); do not change existing keys (`tab, ledger, detailCount, gen, contact, historyCount`).

**Exports** (lines 6649-6658): add `pastSalesSetMode`, `pastSalesBackToRange`, `pastSalesOpenDay` next to `pastSalesShiftDay: kioskPsShiftDay,`.

**Late-response rule:** every then/catch checks both `gen !== _kioskPsGen` and `seq !== _kioskPsLedgerSeq` (:4610, :4614).

---

### `js/kiosk.js` (wiring)

**Analog:** lines 1590-1618:
```javascript
var psTabs = document.querySelectorAll('.kiosk-ps-tab');
Array.prototype.forEach.call(psTabs, function (tabBtn) {
  tabBtn.addEventListener('click', function () {
    KioskCore.pastSalesSetTab(tabBtn.getAttribute('data-tab'));
  });
});
var psPrev = document.getElementById('kiosk-ps-prev');
if (psPrev) psPrev.addEventListener('click', function () { KioskCore.pastSalesShiftDay(-1); });
var psDate = document.getElementById('kiosk-ps-date');
if (psDate) {
  psDate.addEventListener('change', function () {
    if (psDate.value) KioskCore.pastSalesLoadLedger(psDate.value, false);
  });
}
```
Copy the chip loop for `.kiosk-ps-mode` -> `KioskCore.pastSalesSetMode(btn.getAttribute('data-mode'))`; add `#kiosk-ps-backlink` -> `KioskCore.pastSalesBackToRange()`. The date `change` handler (:1607-1609) calls `pastSalesLoadLedger` directly; in week/month mode it must jump to the range containing the date, so route it through a mode-aware core function (for example `KioskCore.pastSalesPickDate(value)`) rather than adding mode logic in kiosk.js. Guard every `getElementById` with a null check (admin.html loads the core without this markup).

---

### `tests/frontend/kiosk-past-sales-range.test.js` (test, event-driven)

**Analog:** `tests/frontend/kiosk-past-sales.test.js`. Copy the header globals (lines 11-31), `DEVICE_TOKEN_KEY`, `KIOSK_HTML`, `XSS`, `flushPromises`, `el`, and `injectRealMarkup()` (lines 33-80) which lifts the real `kiosk.html` nodes by id and runs the real `kiosk.js`/`kiosk-core.js` env. The fake fetch must include `ok: true` because `_kioskPsFetch` checks `r.ok`. Cover: mode chip switching, label text, stepping/disabled states, date jump, drill-in plus back-link scroll restore without refetch, zero rows inert, clear on Customer View exit / lock / new sale (see `kiosk-past-sales-cv-exit.test.js` for the clearing harness), late month response dropped after mode switch or day drill-in, XSS escaping. Keep `tests/frontend/kiosk-core-parity.test.js` green.

---

## Shared Patterns

### Self-gated kiosk GET
**Source:** `zoho-middleware/routes/kiosk-history.js` :55-58
**Apply to:** the new range route
```javascript
function gate(req, res, fn) {
  authTiers.requireTiers(['legacy', 'device', 'session'])(req, res, fn);
}
```

### Server-owned caps, whitelisted query params
**Source:** routes/kiosk-history.js :16-29, :187-188
**Apply to:** range route. Read only `type`, `date`, `bust`; ignore everything else; no cap or `per_page` from `req` (T-92-11).

### Cache-with-dedupe and bust throttle
**Source:** routes/kiosk-history.js :60-107 (`sharedBuild`, `cachedOrBuild`, WR-05). Reuse unchanged; do not warm per-day caches (RESEARCH decision).

### One classification source of truth
**Source:** lib/kiosk-history.js :134-146 (`classify`), :227-236 (`ledgerTotals`), :90 (`createdDay`)
**Apply to:** both `buildLedger` and `buildRange` through a shared `ledgerRowsForDay` so D-12 equality is provable.

### 502 on Zoho failure, no PII in logs, never cached
**Source:** routes/kiosk-history.js :207-210
```javascript
log.error('[kiosk/past-sales/ledger] ' + errMessage(err));
if (!res.headersSent) res.status(502).json({ error: 'Unable to fetch sales' });
```

### Frontend stale-response guard
**Source:** js/kiosk-core.js :4560-4578 (`gen` in `_kioskPsFetch`) and :4603-4614 (`seq` per request)

### Escape everything dynamic
**Source:** js/kiosk-core.js :4648-4667 (`escapeHTML` on every server string, `kioskPsFmtMoney` for money)

### Build and test gates (CLAUDE.md)
Never edit `js/main.js` or `*.min.js`. Run `npm run build` after changing `js/kiosk-core.js`, `js/kiosk.js`, `css/kiosk.css` or `kiosk.html`. `lib/kiosk-history.js`, `constants.js` and `authTiers.js` are shared: run `npm test`, `cd zoho-middleware && npm test` and `npm run lint` before committing. Do not modify existing tests. Known local failures: 2 `vancouver-timezone` tests on Node 20.

## Smell to surface to the owner (do not change in this phase)

`buildCustomer` (routes/kiosk-history.js :233) skips payments only for all-digit references (`/^\d+$/`), but `classify` also consults notes for any non-blank, non-`KIOSK-`/`POS-` reference. For a non-digit "other" reference with an in-store payment note, the customer history would label it `other` where the ledger says `in-store`. Display-label only; separate issue.

## No Analog Found

| File / concern | Role | Data Flow | Reason |
|---|---|---|---|
| Scroll-position save/restore for the drill-in back link | client state | event-driven | No existing code saves and restores `scrollTop` in the kiosk; implement new on `#kiosk-ps-ledger-panel` (the `.kiosk-ps-panel` scroller, css :2998) and verify on the iPad. Render from the stored `_kioskPsRange` (no refetch) and then set `scrollTop`. |
| Weekday/month-name label formatting from `YYYY-MM-DD` | client utility | transform | No client helper exists. Use a month-name array and `Date.UTC(...).getUTCDay()`; never `new Date('YYYY-MM-DD')` local parsing. |

## Metadata

**Analog search scope:** `zoho-middleware/routes/kiosk-history.js`, `zoho-middleware/lib/{kiosk-history,constants,authTiers}.js`, `zoho-middleware/__tests__/kiosk-history-*`, `kiosk.html`, `css/kiosk.css`, `js/kiosk-core.js`, `js/kiosk.js`, `tests/frontend/kiosk-past-sales*.test.js`
**Files read:** about 9 (targeted ranges on large files)
**Pattern extraction date:** 2026-10-17
