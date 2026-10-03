# Phase 84: GiftCards → Postgres - Pattern Map

**Mapped:** 2026-10-03
**Files analyzed:** 14 new/modified files
**Analogs found:** 14 / 14

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `zoho-middleware/lib/gift-card-store.js` (NEW) | service (facade) | CRUD + event-driven (dual-write) | `zoho-middleware/lib/sheet-mirror.js` + `lib/store-flag.js` + `lib/reconcile.js` (composite) | role-match (no single prior facade exists; composed from 3 analogs) |
| `zoho-middleware/migrations/0002_gift_cards.sql` (NEW) | migration | batch (DDL) | `zoho-middleware/migrations/0001_init.sql` | exact |
| `zoho-middleware/routes/gift-cards.js` (MODIFIED) | route/controller | request-response | itself (existing file, same file is the analog for its own new routes) | exact |
| `zoho-middleware/routes/pos.js` ~:1709-1818, ~:740, ~:1402 (MODIFIED) | route/controller | request-response (confirm chain) | itself (existing confirm-chain code, same file) | exact |
| `zoho-middleware/routes/gift-cards.js` NEW `POST /adjust` | route/controller | request-response | `zoho-middleware/routes/gift-cards.js` `POST /void` (lines 122-159) | exact |
| `zoho-middleware/lib/reconcile.js` (MODIFIED — add `recordGiftCardReconcileFailure` + sweep) | service (reconcile) | event-driven / batch sweep | `zoho-middleware/lib/reconcile.js` `recordCollectReconcileFailure` (569-612) + `sweepPendingCharges` (423+) | exact (same file, sibling function) |
| `zoho-middleware/scripts/backfill/specs/gift-cards.js` (NEW) | config (spec) | batch | `zoho-middleware/scripts/backfill/specs/plato-readings.js` | role-match (needs bespoke orchestration, see Pitfall 3) |
| `zoho-middleware/scripts/backfill/gift-cards-backfill.js` (NEW) | service (orchestration script) | batch (file I/O → DB) | `zoho-middleware/scripts/backfill/backfill.js` | role-match |
| `zoho-middleware/__tests__/gift-card-store.test.js` (NEW) | test | — | `zoho-middleware/__tests__/dual-write-compare.test.js` / `__tests__/store-flag.test.js` | role-match |
| `zoho-middleware/__tests__/db/gift-card-store-apply.test.js` (NEW) | test | real-DB | `zoho-middleware/__tests__/db/backfill.test.js` (uses `pg-harness.js`) | exact |
| `zoho-middleware/__tests__/db/gift-cards-backfill.test.js` (NEW) | test | real-DB/batch | `zoho-middleware/__tests__/db/backfill.test.js` | exact |
| `apps-script/adminApi.gs` `ensureGiftCardLedgerSheet` (MODIFIED — Pitfall 4 fix) | utility (sheet IO) | file-I/O | `apps-script/adminApi.gs` `ensureWaitlistSheet` (5370-5410) | exact |
| `apps-script/adminApi.gs` NEW `mirror_gift_card_state` action (D-04) | controller (doPost dispatch) | request-response | `apps-script/adminApi.gs` `redeemGiftCard`/`reloadGiftCard` dispatch shape | role-match |
| `kiosk.html` `#kgcm-adjust-view` (NEW) + `js/kiosk-core.js` adjust logic (MODIFIED) | component/view | request-response | `kiosk.html` `#kgcm-void-view` + `js/kiosk-core.js` `kioskShowGiftCardMgmt()` void flow (5360-5422) | exact |

## Pattern Assignments

### `zoho-middleware/lib/gift-card-store.js` (NEW facade — service, CRUD + dual-write)

**Analogs:** `lib/store-flag.js` (mode resolution), `lib/sheet-mirror.js` (mirror gating), `lib/dual-write-compare.js` (comparison), `lib/db.js` (transactions), `lib/reconcile.js` (failure recording).

**Mode resolution pattern** — copy from `lib/store-flag.js:40-52`:
```javascript
var mode = storeFlag.resolveStoreMode('GIFT_CARDS_STORE'); // 'sheets' | 'dual' | 'postgres'
```
Boot-time validation already covered by `validateStoreFlags()` — do not re-validate per request.

**Atomic transaction pattern** — copy from `lib/db.js:107-133` (`withTransaction`):
```javascript
function withTransaction(fn) {
  if (!isConfigured()) {
    return Promise.reject(new Error('DATABASE_URL not configured'));
  }
  return getPool().connect().then(function (client) {
    return client.query('BEGIN')
      .then(function () { return fn(client); })
      .then(function (result) {
        return client.query('COMMIT').then(function () { return result; });
      })
      .catch(function (err) {
        return client.query('ROLLBACK').then(
          function () { throw err; },
          function () { throw err; }
        );
      })
      .then(
        function (result) { client.release(); return result; },
        function (err) { client.release(); throw err; }
      );
  });
}
```
`gift-card-store.js` calls `db.withTransaction(function (client) { ... atomicRedeem/atomicReload/atomicIssue/atomicAdjust ... })` — it must NEVER `new Pool()` or `require('pg')` directly (header-comment rule in `db.js:1-21`).

**Mirror gating + fire-and-forget pattern** — copy from `lib/sheet-mirror.js:70-92`:
```javascript
function mirrorFireAndForget(label, fn) {
  if (!isMirrorEnabled()) return undefined;
  function reportFailure(err) {
    var message = (err && err.message) || String(err);
    log.warn('[sheet-mirror] ' + label + ' failed: ' + message);
    sentryCapture.captureExceptionSafe(err, { level: 'warning', tags: { component: 'sheet-mirror', mirror: label } });
  }
  try {
    var result = fn();
    if (result && typeof result.then === 'function') { result.catch(reportFailure); }
  } catch (err) { reportFailure(err); }
  return undefined;
}
```
Use exactly this via `require('./sheet-mirror').mirrorFireAndForget('giftcards.redeem', function () {...})` — never reimplement the production-only gate.

**Discrepancy comparison pattern** — copy from `lib/dual-write-compare.js:179-229` (`compareAndReport`). Call shape (per RESEARCH.md Pattern 3):
```javascript
dualWriteCompare.compareAndReport({
  store: 'giftcards', operation: 'redeem',
  sheets: sheetsResult, postgres: pgResult,
  reportValuesFor: ['balance', 'new_balance'] // non-PII, D-08 allows
});
```

**Composite tx_ref minting (CRITICAL, Pitfall 1)** — new logic, no direct analog, but it is the one piece of domain logic this facade must own and nothing else should duplicate:
```javascript
function mintTxRef(saleRef, certNumber, kind) {
  return saleRef + ':' + certNumber + ':' + kind;
}
```
This exact string goes into both `gift_card_transactions.tx_ref` (Postgres) and the Apps Script `transaction_ref` field (sheet-leg re-run) — never pass `pos.js`'s raw `refNumber` straight through.

**Atomic redeem SQL** (research-confirmed exact shape, Pattern 2):
```sql
BEGIN;
  INSERT INTO gift_card_transactions (cert_number, tx_ref, kind, amount, balance_after)
    VALUES ($1, $2, 'redeem', $3,
      (SELECT current_balance - $3 FROM gift_cards WHERE cert_number = $1))
    ON CONFLICT (tx_ref) DO NOTHING;
  UPDATE gift_cards
     SET current_balance = current_balance - $3,
         status          = CASE WHEN current_balance - $3 <= 0 THEN 'depleted' ELSE 'active' END,
         last_updated    = now()
   WHERE cert_number = $1
     AND current_balance >= $3 - 0.001;
COMMIT;
```
Caller MUST distinguish a 0-row UPDATE result's two causes (idempotent replay vs insufficient balance) via a follow-up `SELECT` inside the same transaction — see RESEARCH.md Pitfall 2. Adjust variant floors at `current_balance + $3 >= 0` (signed delta) and requires `status = 'active'`.

**Error handling / D-11 failure recording** — sibling function pattern, copy shape from `lib/reconcile.js:569-612` (`recordCollectReconcileFailure`):
```javascript
function recordGiftCardReconcileFailure(certNumber, txRef, amount, err) {
  var record = {
    cert_number: certNumber, tx_ref: txRef, amount: amount,
    error: (err && err.message) || 'unknown',
    needs_manual_review: true,
    created_at: new Date().toISOString()
  };
  var key = 'giftcard:pending:' + txRef; // keyed by txRef, not Date.now(), so the sweep can target it exactly
  log.error('[reconcile] CRITICAL: gift-card write failed — cert=' + certNumber + ' txRef=' + txRef + ' amount=$' + amount);
  eventLog.logEvent('giftcard.reconcile_failed', { certNumber: certNumber, txRef: txRef, amount: amount });
  return cache.set(key, record, VOID_FAILURE_TTL).catch(function () {}).then(function () {
    return mailer.sendVoidFailureAlert({ txnId: txRef, amount: amount, error: 'Gift-card reconcile failed post-charge: ' + record.error, timestamp: record.created_at })
      .catch(function (mailErr) { log.error('[reconcile] Gift-card reconcile-failure alert email failed: ' + mailErr.message); });
  });
}
```
Place this in `lib/reconcile.js` as a sibling (not in `gift-card-store.js`), per Don't-Hand-Roll guidance. `gift-card-store.js` calls it from its `.catch()`.

---

### `zoho-middleware/migrations/0002_gift_cards.sql` (NEW)

**Analog:** `zoho-middleware/migrations/0001_init.sql` (exact structural match — only existing migration).

**Full file for structure reference:**
```sql
-- 0001_init.sql — Phase 83 (DB-02): first additive migration, proving the pipeline
-- on an empty schema. D-04: deploy-time migrations are additive only...

-- Up Migration
create table app_meta (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

insert into app_meta (key, value) values ('schema_initialized_by', '0001_init (Phase 83)');

-- Down Migration
drop table app_meta;
```
Follow the same `-- Up Migration` / `-- Down Migration` comment convention and lower-case SQL style. This migration is additive only (D-04, Phase 83 D-04 carried forward) — never alter/drop `app_meta`. Column types per CONTEXT: `numeric(10,2)` for all money columns, `GC-` text IDs, `tx_ref UNIQUE` (composite value, not raw refNumber — see Pitfall 1 above). The migration-guard/allowlist chain (`scripts/migration-guard.js`, already wired into `npm run migrate`) enforces additive-only automatically — do not hand-roll a check.

---

### `zoho-middleware/routes/gift-cards.js` (MODIFIED — add `POST /api/kiosk/gift-card/adjust`)

**Analog:** same file, `POST /api/kiosk/gift-card/void` (lines 122-159).

**Imports pattern** (lines 1-11):
```javascript
'use strict';
var express = require('express');
var axios = require('axios');
var log = require('../lib/logger');
var eventLog = require('../lib/eventLog');
var cache = require('../lib/cache');
var C = require('../lib/constants');
var authTiers = require('../lib/authTiers');
var router = express.Router();
```
Add `var giftCardStore = require('../lib/gift-card-store');` for the new facade.

**Validation + response pattern to copy** (void handler, lines 122-159):
```javascript
router.post('/api/kiosk/gift-card/void', function (req, res) {
  var body = req.body || {};
  var cert_number = String(body.cert_number || '').trim().toUpperCase();
  if (!cert_number || !/^GC-\d{6}$/.test(cert_number)) {
    return res.status(400).json({ error: 'cert_number must match GC-NNNNNN (e.g. GC-000042)' });
  }
  var reason = String(body.reason || '').trim().slice(0, 512);
  if (!reason) {
    return res.status(400).json({ error: 'reason is required to void a certificate' });
  }
  return callAppsScript('void_gift_card', { cert_number: cert_number, reason: reason })
    .then(function (gsResult) {
      if (!gsResult.ok) {
        if (gsResult.error === 'not_found') return res.status(404).json({ ok: false, error: 'Certificate not found' });
        log.error('[gift-cards/void] void_gift_card failed: ' + (gsResult.error || 'unknown'));
        return res.status(500).json({ error: 'Failed to void certificate' });
      }
      log.info('[gift-cards/void] Certificate voided: ' + cert_number + ' (reason: ' + reason + ')');
      eventLog.logEvent('kiosk.gift_card_voided', { certNumber: cert_number, reason: reason });
      return res.status(200).json({ ok: true });
    })
    .catch(function (err) {
      log.error('[gift-cards/void] Unexpected error: ' + err.message);
      return res.status(502).json({ error: 'Failed to void gift certificate. Please try again.' });
    });
});
```
New `/adjust` route must: (1) validate `cert_number` with the same `/^GC-\d{6}$/` regex, (2) validate signed `delta` is numeric/non-NaN, (3) validate `reason` against the closed pick-list (`correction`/`goodwill`/`refund-to-card`/`other` + required note for `other`), (4) require `actor_name` + `device_id` (D-05), (5) call `giftCardStore.adjust(...)` not `callAppsScript` directly, (6) return 403/409-style error when `GIFT_CARDS_STORE` resolves to `sheets` (D-07 server-side gate — "the endpoint itself must reject ... not rely on the kiosk UI hiding the button", per RESEARCH.md ASVS V4 note).

**Auth/route-allowlist pattern** — copy from `lib/authTiers.js:47-71` (`KIOSK_ROUTES`). The new route must be added as an **explicit new entry**, never via prefix match:
```javascript
'/api/kiosk/gift-card/adjust', // Phase 84 D-05/D-07: ledgered balance-adjust, device/session gated
```
Add this literal line to `KIOSK_ROUTES` in `lib/authTiers.js` — do not rely on `/api/kiosk/gift-card/` prefix matching (explicitly warned against, `authTiers.js:20-26`).

---

### `zoho-middleware/routes/pos.js` (MODIFIED — 6 call sites route through the facade)

**Analog:** same file (existing confirm-chain code is itself the pattern; no change to control flow or Zoho logic, only the gift-card leg's data source).

**Exact call sites to replace** (confirmed locations, RESEARCH.md Code Examples):
```
:740, :1402   pre-payment lookup_gift_card  → giftCardStore.lookup(certNumber)
:1709-1715    redeem_gift_card              → giftCardStore.redeem(certNum, amount, refNumber)
:1749-1757    issue_gift_card               → giftCardStore.issue(certNum, faceValue, issuedBy, notes, refNumber)
:1769-1779    update_gift_card_invoice      → giftCardStore.updateInvoice(certNum, invoiceNumber) (only on issue success)
:1788-1795    reload_gift_card              → giftCardStore.reload(certNum, amount, refNumber)
```

**Existing confirm-chain pattern to preserve verbatim (control flow, only the call target changes)** — lines 1706-1816:
```javascript
var lastStep = Promise.resolve();
if (gcApplied > 0 && gcCertNum && asUrl && asToken) {
  lastStep = lastStep.then(function () {
    return axios.post(asUrl, JSON.stringify({
      action: 'redeem_gift_card', server_token: asToken,
      cert_number: gcCertNum, amount: gcApplied, transaction_ref: refNumber
    }), { headers: { 'Content-Type': 'application/json' }, timeout: 12000, maxRedirects: 5 })
    .then(function (asResp) {
      var r = asResp.data || {};
      if (!r.ok) {
        log.error('[pos/kiosk/sale/confirm] CRITICAL: Gift card balance decrement failed for ' + gcCertNum + ': ' + (r.error || 'unknown'));
        giftCardActivationFailed = true;
      } else {
        eventLog.logEvent('kiosk.gift_card_redeemed', { certNumber: gcCertNum, amountApplied: gcApplied, refNumber: refNumber });
      }
    })
    .catch(function (asErr) {
      log.error('[pos/kiosk/sale/confirm] CRITICAL: Apps Script redeem_gift_card unreachable for ' + gcCertNum + ': ' + asErr.message);
      giftCardActivationFailed = true;
    });
  });
}
```
**Error handling pattern to preserve:** post-payment gift-card steps never throw/fail the paid sale — they set `giftCardActivationFailed = true` and `log.error('CRITICAL: ...')`. This invariant must survive the facade swap: `giftCardStore.redeem()`'s rejection (after D-11's reconcile-failure recording) must still be caught here and converted to `giftCardActivationFailed = true`, exactly as today's `.catch()` does — never let it propagate and fail the already-charged sale.

**Pitfall 1 regression to guard against:** one sale redeeming cert A (payment) AND issuing/reloading cert B (cart line) shares one `refNumber` — the facade's `mintTxRef` composite key (not `pos.js`) is what prevents a `tx_ref` collision. `pos.js` itself needs ZERO changes to its `refNumber` construction.

---

### `zoho-middleware/lib/reconcile.js` (MODIFIED — add `recordGiftCardReconcileFailure` + sweep extension)

**Analog:** same file, `recordCollectReconcileFailure` (lines 569-612) — see full excerpt under the facade's "Error handling" section above. Also reference the `sweepPendingCharges` function (423+) and its `'sv:void-failure:' + Date.now()` vs this phase's `'giftcard:pending:' + txRef` keying distinction (txRef-keyed so the sweep can target the exact failed write and safely retry via `ON CONFLICT DO NOTHING`).

**Constant reuse:** `VOID_FAILURE_TTL = 30 * 24 * 60 * 60` (line 49) — reuse this constant, do not invent a new TTL.

---

### `zoho-middleware/scripts/backfill/specs/gift-cards.js` (NEW) + `scripts/backfill/gift-cards-backfill.js` (NEW orchestration)

**Analog:** `scripts/backfill/specs/plato-readings.js` (column-spec shape) + `scripts/backfill/backfill.js` (CLI orchestration) + `scripts/backfill/load.js` (`loadScratch`/`runChecks`/`promote`).

**Column spec shape to copy** (from `plato-readings.js:13-29`):
```javascript
module.exports = {
  sheet: 'GiftCards',
  table: 'gift_cards',
  primaryKey: 'cert_number',
  columns: [
    { name: 'cert_number', header: 'cert_number', type: 'id', required: true, pgType: 'text' },
    { name: 'face_value', header: 'face_value', type: 'numeric', required: true, pgType: 'numeric(10,2)', precision: 10, scale: 2 },
    { name: 'current_balance', header: 'current_balance', type: 'numeric', required: true, pgType: 'numeric(10,2)', precision: 10, scale: 2 },
    { name: 'status', header: 'status', type: 'text', required: true, pgType: 'text' }
    // ... issued_date, issued_by, zoho_invoice_number, notes, last_updated per the real GiftCards sheet header
  ]
};
```
Register it in `scripts/backfill/specs/index.js`'s `SPECS` array (same pattern as `vesselHistory`/`platoReadings`/`fermSchedules`).

**Why a bespoke orchestration script is required (Pitfall 3, not hand-rollable away):** `load.js`'s `loadScratch`/`promote` are single-table. GiftCards needs the straightforward `gift_cards` load via `load.js` AS-IS, PLUS a second pass (not covered by any existing spec) that: derives one `opening_balance` ledger row per card (D-12), imports historical `GiftCardTransactions` rows as `imported=true` into `gift_card_transactions`, excludes `TEST-*` certs, and rejects `needs_manual_review`/unsettled rows. Reuse `normalize.js`/`rejects.js` primitives directly for this second pass — do not force it through `load.js`'s single-table promote path.

**TLS/pool reuse (Pitfall 5):** the orchestration script must import `lib/db.js`'s `createPool`/`sslConfigFor` exactly as `scripts/backfill/backfill.js` already does — never construct a bare `new Pool()`.

---

### `zoho-middleware/__tests__/gift-card-store.test.js` (NEW — facade unit tests)

**Analog:** `__tests__/dual-write-compare.test.js` (mocked comparator tests) + `__tests__/store-flag.test.js` (mode-resolution tests) — both exist as the closest sibling test shapes for the three concerns this facade composes.

### `zoho-middleware/__tests__/db/gift-card-store-apply.test.js` + `gift-cards-backfill.test.js` (NEW — real-Postgres)

**Analog:** `__tests__/db/backfill.test.js`, using the shared harness `__tests__/db/helpers/pg-harness.js`.

**Harness pattern to copy** (`pg-harness.js:62-78`, `86-94`, `131-163`):
```javascript
var pgHarness = require('./helpers/pg-harness');
pgHarness.describeDb('gift-card-store atomic apply', function () {
  var ctx = {};
  beforeAll(function () {
    return pgHarness.startPostgres().then(function (started) {
      ctx.container = started.container;
      pgHarness.applyMigrations(started.connectionString);
      ctx.pool = db.createPool(started.connectionString);
    });
  });
  afterAll(function () {
    return ctx.pool.end().then(function () { return ctx.container.stop(); });
  });
  pgHarness.rollbackEachTest(function () { return ctx.pool; });
  // tests here reuse the checked-out, BEGIN'd client per test
});
```
This proves same-tx_ref replay, crash-then-retry idempotency, and the Pitfall 1 multi-cert-one-ref regression against a REAL `postgres:18-alpine` container — never a mock/fake for these atomicity assertions (research doc's standing `pg-mem` rejection).

---

### `apps-script/adminApi.gs` — `ensureGiftCardLedgerSheet` fix (Pitfall 4, folded todo)

**Analog:** `ensureWaitlistSheet` (lines 5370-5410), specifically its guard at lines 5383-5393.

**Current buggy code** (`ensureGiftCardLedgerSheet`, lines 4765-4797) — missing the empty-tab guard:
```javascript
function ensureGiftCardLedgerSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(GIFT_CARD_TRANSACTIONS_SHEET_NAME);
  var headerNames = [ /* 12 columns */ ];
  if (!sheet) {
    sheet = ss.insertSheet(GIFT_CARD_TRANSACTIONS_SHEET_NAME);
    sheet.appendRow(headerNames);
    sheet.getRange(1, 1, 1, headerNames.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  // BUG: no check for an EXISTING but EMPTY sheet before this next line:
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]; // throws if getLastColumn()===0
  ...
}
```

**Exact fix pattern to apply verbatim** (from `ensureWaitlistSheet`, lines 5383-5393):
```javascript
// A wholly empty sheet reports getLastColumn() === 0, and getRange(1, 1, 1, 0) throws
// "The number of columns in the range must be at least 1." That covers both a tab we just
// inserted and one that already existed but was blank...
if (sheet.getLastColumn() === 0) {
  sheet.appendRow(headerNames);
  sheet.getRange(1, 1, 1, headerNames.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  Logger.log('Initialised GiftCardTransactions tab with ' + headerNames.length + ' columns');
}
```
Insert this guard into `ensureGiftCardLedgerSheet` immediately before its `var headers = sheet.getRange(...)` line, replacing the `if (!sheet) { ... }` block's inline header-write with the same guarded structure `ensureWaitlistSheet` uses (insert-if-missing, THEN guard-if-empty, so both the "just created" and "existed but blank" cases are covered by one check). Per CLAUDE.md rule 3 and RESEARCH.md Pitfall 4: write a regression test FIRST (`tests/frontend/` or wherever `adminapi-giftcard-ledger.test.js` lives) reproducing the crash against an existing-but-blank tab, then apply the fix.

---

### `apps-script/adminApi.gs` NEW `mirror_gift_card_state` action (D-04 copy-state)

**Analog:** the `redeemGiftCard`/`reloadGiftCard` function signatures (`{cert_number, amount, transaction_ref}`) and their doPost dispatch registration — the new action follows the same "plain payload object in, `{ok: true/false, ...}` object out" contract, registered in the same `server_token` dispatch block referenced by `routes/gift-cards.js`'s `callAppsScript()` helper (lines 23-39). Per RESEARCH.md recommendation (Open Question 3), one action taking:
```javascript
{ cert_number, current_balance, status, last_updated, zoho_invoice_number,
  ledger_entry: { tx_ref, kind, amount, balance_after, created_at } }
```
is the simplest shape (one round-trip). This does NOT reuse `redeemGiftCard`/`reloadGiftCard`'s business logic (lock, idempotency ledger) — it is a pure row-upsert + ledger-append, since D-04 says the real Apps Script business logic leaves the hot path after the flip.

---

### `kiosk.html` `#kgcm-adjust-view` (NEW) + `js/kiosk-core.js` adjust logic (MODIFIED)

**Analog:** `kiosk.html:501-534` (`#kgcm-panel`/`#kgcm-void-view`) + `js/kiosk-core.js:5272-5423` (`kioskShowGiftCardMgmt()`, specifically the void-view transition at 5360-5422).

**HTML structure to copy** (`kiosk.html:523-532`, the void-view, as the template for the new adjust-view):
```html
<div id="kgcm-void-view" style="display:none;">
  <div id="kgcm-void-confirm" style="font-weight:600;margin-bottom:0.75rem;"></div>
  <label style="display:block;font-weight:600;margin-bottom:0.25rem;" for="kgcm-void-reason">Reason (required)</label>
  <input type="text" id="kgcm-void-reason" class="kiosk-search-input" maxlength="100" placeholder="e.g. customer request, duplicate, lost" autocomplete="off" style="width:100%;box-sizing:border-box;margin-bottom:0.5rem;">
  <div id="kgcm-void-error" style="color:#c00;font-size:0.9rem;margin-bottom:0.75rem;display:none;"></div>
  <div style="display:flex;gap:0.5rem;">
    <button type="button" class="btn" id="kgcm-void-confirm-btn" style="flex:1;min-height:44px;background:#c00;border-color:#c00;">Confirm Void</button>
    <button type="button" class="btn-secondary" id="kgcm-void-cancel-btn" style="flex:1;min-height:44px;">Cancel</button>
  </div>
</div>
```
New `#kgcm-adjust-view` needs: a signed-delta input, a reason `<select>` pick-list (correction/goodwill/refund-to-card/other) with a conditional required note field for `other`, an `actor_name`/initials input (D-05 — kiosk has no staff identity), and the same confirm/cancel button pair.

**JS view-switch + fetch pattern to copy** (`js/kiosk-core.js:5360-5422`, the void button handler + confirm handler):
```javascript
if (voidBtn) {
  voidBtn.onclick = function () {
    if (!_mgmtCert) return;
    if (lookupView) lookupView.style.display = 'none';
    if (voidView) voidView.style.display = 'block';
    if (voidConfirmLabel) voidConfirmLabel.textContent = 'Void ' + _mgmtCert + '? This cannot be undone.';
    ...
  };
}
if (voidConfirmBtn) {
  voidConfirmBtn.onclick = function () {
    var reason = voidReasonEl ? voidReasonEl.value.trim() : '';
    if (!reason) { /* inline error */ return; }
    voidConfirmBtn.disabled = true;
    voidConfirmBtn.textContent = 'Voiding…';
    fetch(mwUrl + '/api/kiosk/gift-card/void', _kcMergeAuth({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cert_number: _mgmtCert, reason: reason })
    }))
    .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
    .then(function (result) {
      voidConfirmBtn.disabled = false;
      voidConfirmBtn.textContent = 'Confirm Void';
      if (result.status === 200 && result.data && result.data.ok) {
        panel.style.display = 'none';
        showToast('Gift Certificate ' + _mgmtCert + ' has been voided.', 'success');
      } else if (result.status === 404) { /* ... */ }
      else if (result.status === 409) { /* ... */ }
      else { /* generic error */ }
    })
    .catch(function () { /* connection error */ });
  };
}
```
EVERY fetch MUST use `_kcMergeAuth(...)` — the adjust POST does NOT get a bespoke auth path (explicit note in RESEARCH.md Code Examples). The lookup response at line 5333 (`var d = (result.data && result.data.data) || {};`) is where `store_mode` should be read to gate the Adjust button's visibility per D-07:
```javascript
if (resultEl && d.store_mode && d.store_mode !== 'sheets') {
  // show Adjust Balance button next to voidBtn; omitted/disabled when store_mode === 'sheets'
}
```
**Server-side gate is still mandatory** (D-07, ASVS V4) — the button hide is UX only; `routes/gift-cards.js`'s `/adjust` handler must itself reject in `sheets` mode.

**Build-step verification required before writing UI code:** `js/kiosk-core.js` is loaded as its own `<script>` tag — confirm via `grep` on `package.json`'s `minify:js`/`stamp:pages` arrays whether `kiosk-core.js`/`kiosk.html` need a build step distinct from `npm run build`'s `js/modules/` concat (RESEARCH.md Assumption A1/Open Question 2 — not independently verified by this pattern-mapping pass; planner's first UI task should grep this before any other kiosk UI work).

## Shared Patterns

### Postgres access — single gateway
**Source:** `zoho-middleware/lib/db.js` (`query`/`withTransaction`, lines 100-133)
**Apply to:** `gift-card-store.js`, the backfill orchestration script, and both new real-DB test files.
No file other than `lib/db.js` may `require('pg')` or `new Pool()` — enforced by the module's own header comment (lines 1-21).

### Store-mode resolution
**Source:** `zoho-middleware/lib/store-flag.js:40-52` (`resolveStoreMode`)
**Apply to:** `gift-card-store.js` (every operation), `routes/gift-cards.js` (`/adjust`'s D-07 gate), kiosk lookup response (`store_mode` field).
`GIFT_CARDS_STORE` is already registered in `STORE_ENV_NAMES` (line 31) — no change needed there.

### Sheet-mirror production gate
**Source:** `zoho-middleware/lib/sheet-mirror.js:42-92`
**Apply to:** every write path in `gift-card-store.js` (dual re-run AND post-flip copy-state upsert).

### Dual-write discrepancy comparison
**Source:** `zoho-middleware/lib/dual-write-compare.js:179-229` (`compareAndReport`)
**Apply to:** `gift-card-store.js`'s dual-mode write paths (redeem/issue/reload/void/adjust).

### Durable post-charge failure recording (D-11)
**Source:** `zoho-middleware/lib/reconcile.js:569-612` (`recordCollectReconcileFailure`) — sibling function `recordGiftCardReconcileFailure` to be added to the same file.
**Apply to:** `gift-card-store.js`'s `.catch()` on every Postgres write that runs after a charge has already succeeded.

### Kiosk fetch auth
**Source:** `js/kiosk-core.js` `_kcMergeAuth` (line 104) — every existing kiosk fetch uses it (void at line 5391, lookup at line 5322).
**Apply to:** the new adjust POST fetch.

### Explicit route allowlisting (never prefix-match)
**Source:** `zoho-middleware/lib/authTiers.js:47-71` (`KIOSK_ROUTES`), header-comment rationale at lines 20-26.
**Apply to:** adding `/api/kiosk/gift-card/adjust` as one new explicit list entry.

### Real-Postgres test harness
**Source:** `zoho-middleware/__tests__/db/helpers/pg-harness.js` (`describeDb`, `startPostgres`, `applyMigrations`, `rollbackEachTest`)
**Apply to:** both new `__tests__/db/*.test.js` files for this phase.

### Backfill primitives (read/normalize/reject/load)
**Source:** `zoho-middleware/scripts/backfill/{read-xlsx,normalize,rejects,load}.js`
**Apply to:** the GiftCards backfill orchestration script — reuse directly rather than reimplementing money/timestamp/boolean conversion traps.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `apps-script/adminApi.gs` NEW `mirror_gift_card_state` action body | controller | event-driven (copy-state upsert) | No prior Apps Script action does a pure "upsert + ledger append with no business logic" — closest is the redeem/reload *shape* (payload in, `{ok}` out), not its *behavior*; researcher's recommended payload shape is informational only, not a copied excerpt (see RESEARCH.md Open Question 3) |
| D-02 production scripted $1 test-card runsheet (RUNBOOK addition) | config/docs | — | Operational runbook content, not source code; no codebase analog applies |

## Metadata

**Analog search scope:** `zoho-middleware/lib/`, `zoho-middleware/routes/`, `zoho-middleware/migrations/`, `zoho-middleware/scripts/backfill/`, `zoho-middleware/__tests__/` (incl. `__tests__/db/`), `apps-script/adminApi.gs`, `kiosk.html`, `js/kiosk-core.js`
**Files scanned (read in full or targeted sections):** `lib/db.js`, `lib/store-flag.js`, `lib/sheet-mirror.js`, `lib/dual-write-compare.js`, `lib/reconcile.js` (569-612, grep-located), `lib/authTiers.js` (1-100), `routes/gift-cards.js`, `routes/pos.js` (1700-1835, grepped for all gift_card/refNumber lines), `migrations/0001_init.sql`, `scripts/backfill/specs/index.js`, `scripts/backfill/specs/plato-readings.js`, `scripts/backfill/load.js`, `__tests__/db/helpers/pg-harness.js`, `apps-script/adminApi.gs` (4691-4941, 4999-5134, 5370-5410), `kiosk.html` (490-568), `js/kiosk-core.js` (5264-5425)
**Pattern extraction date:** 2026-10-03
