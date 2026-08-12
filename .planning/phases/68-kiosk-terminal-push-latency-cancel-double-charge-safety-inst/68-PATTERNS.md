# Phase 68: Kiosk Terminal-Push Latency + Cancel Double-Charge Safety - Pattern Map

**Mapped:** 2026-08-11
**Files analyzed:** 6 (3 source, 3+ test)
**Analogs found:** 6 / 6 (all in-repo, no external patterns needed)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|-----------------|----------------|
| `zoho-middleware/routes/pos.js` (`processSale`/`processSaleWithPrices`, stage instrumentation) | controller/route | request-response (async pipeline) | itself — extend existing `eventLog.logEvent('kiosk.total_mismatch', …)` idiom at pos.js:621 | exact (same file, existing idiom) |
| `zoho-middleware/routes/pos.js` (`/api/pos/cancel`, cancel-safety fix) | controller/route | request-response + async void | `moneyPath.voidWithTimeout` call sites at pos.js:1212/1248 (confirm-path void-before-reject) | exact (same money-path primitive, same file) |
| `zoho-middleware/lib/helcim.js` (`cancelTerminal`) | service (external API client) | request-response | `voidTransaction`/`refundTransaction` in the same file (helcim.js:144-182) | exact (sibling function, same module, same call shape) |
| `js/kiosk-core.js` (stage-timing / push-latency beacon) | client controller (IIFE module) | event-driven (fire-and-forget beacon) | `_kcReportClientError` (kiosk-core.js:126-161) + its 57-03 call site (kiosk-core.js:2912-2917) | exact |
| `js/kiosk-core.js` (cancel handler safety, `_kioskPushToTerminal` cancelBtn.onclick) | client controller | request-response | itself — existing cancel handler at kiosk-core.js:2843-2854 | exact (in-place fix) |
| `zoho-middleware/__tests__/*.test.js` (new cancel/orphan regression tests) | test | request-response (route-handler harness) | `pos-money-defects.test.js` (WR-03 / F2 describe blocks) + `pos-precharge-assertion.test.js` ("Confirm-path unresolved tax — void, never orphan") | exact |
| `tests/frontend/*.test.js` (new push-latency + cancel regression tests) | test | event-driven (jsdom + mocked fetch) | `kiosk-sale-beacon-servererror.test.js` (full file — beacon harness) | exact |

## Pattern Assignments

### `zoho-middleware/routes/pos.js` — stage-timing instrumentation (controller, request-response)

**Analog:** the file's own existing structured-event idiom, `eventLog.logEvent('kiosk.total_mismatch', …)`.

**Imports already present** (pos.js:1-16) — no new imports needed, `eventLog` and `log` are already required:
```javascript
var log = require('../lib/logger');
var eventLog = require('../lib/eventLog');
```

**The exact emit idiom to copy** (pos.js:608-634 — log line THEN eventLog.logEvent, never eventLog alone):
```javascript
log.error('[pos/kiosk/sale] pre-charge total mismatch: client_grand_total=' + body.client_grand_total +
  ' client_tax_total=' + body.client_tax_total +
  ' server_grand_total=' + grandTotal + ' server_tax_total=' + taxTotal +
  ' delta=' + mismatchDelta + ' items=' + lineItems.length +
  ' ref=' + (typeof body.reference_number === 'string' ? body.reference_number.slice(0, 64) : ''));
eventLog.logEvent('kiosk.total_mismatch', {
  client_grand_total: body.client_grand_total,
  client_tax_total: (typeof body.client_tax_total === 'number' && isFinite(body.client_tax_total))
    ? body.client_tax_total : null,
  server_grand_total: grandTotal,
  server_tax_total: taxTotal,
  delta: mismatchDelta,
  item_count: lineItems.length,
  reference_number: (typeof body.reference_number === 'string') ? body.reference_number.slice(0, 64) : ''
});
```

**`eventLog.logEvent` itself** (`zoho-middleware/lib/eventLog.js:26-32`) — this IS the shared structured-event channel; stage timings must be emitted through it, not a new logger:
```javascript
function logEvent(eventType, data) {
  var extra = { event: eventType };
  if (data && typeof data === 'object') {
    Object.keys(data).forEach(function (k) { extra[k] = data[k]; });
  }
  log.info('[event] ' + eventType, extra);
}
```
`eventLog.js` header pins a **ZERO PII POLICY** (no email/name/phone/payment_token — timings/durations/refNumber are safe). Reuse `eventLog.logEvent('kiosk.sale_stage', {...})` (or per-stage event names) — do NOT `console.log`/`require('../lib/logger')` a raw JSON blob, and do NOT invent a second structured-event module.

**Existing plain `log.info` stage markers already in the pipeline** (for reference on wording style, pos.js:330/440/715/768):
```javascript
log.info('[pos/kiosk/sale] Idempotent replay: ' + idempotencyKey);
log.info('[pos/kiosk/sale] Auto-reconcile: catalog rebuild resolved stale-cache miss for ' + missingItemId);
log.info('[pos/kiosk/sale] Pushing to terminal: total=$' + terminal_amount.toFixed(2) + ' ref=' + refNumber + ...);
```
These are the natural insertion points to wrap with `Date.now()` deltas: lock-acquired (~pos.js:327-337), catalog cache read hit/miss (~pos.js:414-452, rebuild branch at 429), gc-lookup start/end (~pos.js:662-687), assertion done (~pos.js:608), terminalPurchase sent (~pos.js:726), 202 returned (~pos.js:750-752).

**Pending-charge record write pattern (45-08), also useful as a "record a timestamped context object" analog** (pos.js:733-744):
```javascript
var pendingCacheKey = C.CACHE_KEYS.KIOSK_PENDING_CHARGE_PREFIX + refNumber;
var pendingContext = {
  reference_number: refNumber,
  amount:           terminal_amount,
  idempotency_key:  (body.idempotency_key && typeof body.idempotency_key === 'string')
                      ? body.idempotency_key : null,
  created_at:       new Date().toISOString()
};
cache.set(pendingCacheKey, pendingContext, KIOSK_PENDING_CHARGE_TTL).catch(function () {});
```

---

### `js/kiosk-core.js` — client push-latency beacon (client controller, event-driven)

**Analog:** `_kcReportClientError` (kiosk-core.js:126-161) is the ONLY existing client→middleware beacon. It is purpose-built for **error** reporting to `/api/kiosk/client-error`, which server-side (`pos.js:877-921`) is an `Error`-shaped Sentry sink with a validated 6-field whitelist (message, http_status, endpoint, auth_state, timestamp, user_agent, +optional item_id) — it is NOT a general metrics/event endpoint.

```javascript
// kiosk-core.js:126-161
function _kcReportClientError(info) {
  info = info || {};
  var mwUrl = _kcEnv.mwUrl;
  if (!mwUrl) return;
  var authOpts = _kcEnv.buildAuthOptions() || {};
  var authState = 'none';
  if (authOpts.headers && authOpts.headers['x-device-token']) {
    authState = 'device-token';
  } else if (authOpts.credentials === 'include') {
    authState = 'session-cookie';
  }
  var payload = {
    message: String(info.message == null ? '' : info.message).slice(0, 500),
    http_status: (typeof info.http_status === 'number' ? info.http_status : null),
    endpoint: info.endpoint || '',
    auth_state: authState,
    timestamp: new Date().toISOString(),
    user_agent: (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : ''
  };
  if (info.item_id) {
    payload.item_id = String(info.item_id).slice(0, 40);
  }
  try {
    fetch(mwUrl + '/api/kiosk/client-error', _kcMergeAuth({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })).catch(function () {});
  } catch (e) { /* never let telemetry break the kiosk */ }
}
```

**Call-site idiom** (kiosk-core.js:2912-2917 — fire-and-forget, never blocks UI):
```javascript
_kcReportClientError({
  message: saleErrMsg,
  http_status: result.status,
  endpoint: '/api/kiosk/sale',
  item_id: saleErrItemIdMatch ? saleErrItemIdMatch[1] : undefined
});
```

**Flag for planner:** `_kcReportClientError`'s payload shape (6 whitelisted keys + optional `item_id`) is PINNED by `tests/frontend/kiosk-client-error-beacon.test.js` ("Test 5 pins the six-key shape for the network-reject paths" per the code comment at kiosk-core.js:148-149) and server-side by `pos.js:877-921`'s `scrubClientErrorText`/field whitelist. A numeric latency duration does not fit this shape (it's error-report shaped, and `pos.js` server-side scrubs/redacts free text, discarding anything not in the six-key allowlist). CONTEXT.md's "repurpose or add a sibling event" language should resolve to: **do not overload `_kcReportClientError`/`/api/kiosk/client-error`** — either (a) add a new sibling client function (e.g. `_kcReportTerminalPushLatency`) posting to a NEW route that emits via `eventLog.logEvent('kiosk.terminal_push_latency', {...})` server-side (mirrors the `kiosk.total_mismatch` pattern exactly), or (b) extend `/api/kiosk/client-error`'s whitelist with an additional optional numeric field the same way `item_id` was added as an optional 7th field (57-04) — smallest-diff option, but requires updating the pinned-shape test's expectations for the new-field case only (existing six-key assertions stay unchanged). Planner's discretion per CONTEXT.md; both routes are grounded in real patterns.

---

### `zoho-middleware/routes/pos.js` — `/api/pos/cancel` orphan-charge safety (controller, request-response + async void)

**Current no-op** (pos.js:1586-1590):
```javascript
router.post('/api/pos/cancel', function (req, res) {
  helcimLib.cancelTerminal().then(function (result) {
    res.json(result);
  });
});
```

**Analog for the fix — the single void path, `moneyPath.voidWithTimeout`, called from a confirm-path void-before-reject** (pos.js:1212-1219, gift-card-invalid-after-charge case):
```javascript
if (gcConfirmLookup.state === 'invalid') {
  // Terminal already charged — void before rejecting
  return moneyPath.voidWithTimeout(helcimLib, body.transaction_id, grandTotal, { reqId: req.id })
    .then(function () {
      return res.status(400).json({ error: 'Gift card not found or has insufficient balance' });
    })
    .catch(function () {
      return res.status(400).json({ error: 'Gift card not found or has insufficient balance' });
    });
}
```
And the CRITICAL-guard variant (pos.js:1243-1257) — same idiom, terminalApplied-gated:
```javascript
var gcAcctVoid = terminalApplied > 0
  ? moneyPath.voidWithTimeout(helcimLib, body.transaction_id, grandTotal, { reqId: req.id })
  : Promise.resolve();
return gcAcctVoid
  .then(function () { return res.status(503).json({ error: '...' }); })
  .catch(function () { return res.status(503).json({ error: '...' }); });
```

**`moneyPath.voidWithTimeout` itself** (`zoho-middleware/lib/money-path.js:191-245`) — this is THE single void path; audit doctrine (H5/L18, referenced in CONTEXT.md) forbids calling `helcimLib.voidTransaction` directly anywhere outside it:
```javascript
function voidWithTimeout(helcimLib, token, amount, opts) {
  var deps = opts || {};
  var timeoutMs = deps.timeoutMs || 8000;
  var mailerDep = deps.mailer || getMailer();
  var eventLogDep = deps.eventLog || eventLog;
  var withTimeoutFn = deps.withTimeout || getWithTimeout();

  return withTimeoutFn(helcimLib.voidTransaction(token), timeoutMs)
    .then(function (voidResult) {
      if (!voidResult || !voidResult.ok) {
        log.error('[money-path] Helcim void returned non-ok: ' + JSON.stringify(voidResult));
        eventLogDep.logEvent('checkout.void_fired', { txnId: token, voidResult: 'declined' });
      } else {
        log.info('[money-path] Voided txn=' + token);
        eventLogDep.logEvent('checkout.void_fired', { txnId: token, voidResult: 'success' });
      }
    })
    .catch(function (voidErr) {
      // timeout → log + Sentry, no mailer alert
      // non-timeout → CRITICAL log + Sentry + eventLog 'checkout.void_failed' + mailer.sendVoidFailureAlert
    });
}
```
`voidWithTimeout` requires a **real Helcim `transactionId`** — a cancelled-before-any-approval sale never has one, so a naive `/api/pos/cancel` handler cannot call it directly at cancel time. This confirms CONTEXT.md's "mark-and-void" framing: cancel must record a "cancelled" flag keyed by `refNumber` (same keying convention as `KIOSK_PENDING_CHARGE_PREFIX + refNumber`, `C.CACHE_KEYS`, `zoho-middleware/lib/constants.js:51`) so that whenever a transactionId later resolves for that ref (via `/api/kiosk/sale/status` poll at pos.js:793-817, or the webhook path in `routes/webhooks.js`), it gets routed through `moneyPath.voidWithTimeout` instead of silently dropped.

**The reconciliation backstop that ALREADY exists and already covers "approved after cancel" generically** — `zoho-middleware/lib/reconcile.js`, `reconcilePendingCharge()` (lines 188-319): on a webhook-delivered APPROVED result, if the `KIOSK_PENDING_CHARGE_PREFIX + invoiceNumber` record exists, no matching confirm ran (`hasMatchingZohoOrder`, lines 92-106, checks `KIOSK_IDEM_PREFIX + 'confirm:' + idempotency_key`), and the record is ≥ `MIN_ORPHAN_AGE_SECONDS` (600s, line 70) old, it calls `helcimLib.voidTransaction` directly (NOT through `moneyPath.voidWithTimeout` — reconcile.js has its own equivalent inline void-then-log-or-alert block, lines 259-302) and clears the pending record. **This IS a working backstop for the cancelled-never-confirmed case** — it doesn't need to know "was this cancelled," only "was this ever confirmed" — but its `MIN_ORPHAN_AGE_SECONDS = 600` (10-minute) age guard means a cancel-then-approve orphan sits charged-but-undetected for up to 10 minutes before this backstop fires. If the phase's fix is "mark-and-void on the FIRST poll/webhook result after a cancel" (immediate), that is a strictly faster closure of the same window this backstop already covers eventually — both can coexist (backstop stays as defense-in-depth for the case where the mark-and-void path itself fails).

**`lib/constants.js` keying convention** (`zoho-middleware/lib/constants.js:43,51`):
```javascript
KIOSK_IDEM_PREFIX:           'kiosk:idem:',
KIOSK_PENDING_CHARGE_PREFIX: 'kiosk:pending-charge:',
```
A new "cancelled" flag key should follow this same `C.CACHE_KEYS.*` convention (add a new prefix constant, e.g. `KIOSK_CANCELLED_PREFIX`) rather than a raw string literal.

---

### `zoho-middleware/lib/helcim.js` — `cancelTerminal` (service, request-response)

**Current no-op** (helcim.js:405-408):
```javascript
function cancelTerminal() {
  log.info('[helcim] Cancel requested — cancellation must happen on the physical terminal');
  return Promise.resolve({ ok: false, device_cancel_required: true });
}
```

**Analog — sibling Helcim REST calls in the same file, same request shape** (`voidTransaction`, helcim.js:144-157):
```javascript
function voidTransaction(transactionId) {
  if (!HELCIM_API_TOKEN) {
    return Promise.reject(new Error('Helcim not configured'));
  }
  return axios.post(HELCIM_BASE_URL + '/payment/reverse', {
    transactionId: transactionId
  }, {
    headers: helcimHeaders(generateIdempotencyKey()),
    timeout: 10000
  }).then(function (resp) {
    var data = resp.data || {};
    return { ok: true, transactionId: transactionId, status: data.status || 'voided' };
  });
}
```
Helcim's public API has no documented "cancel an in-flight terminal push" endpoint distinct from `payment/reverse` (void) — this matches CONTEXT.md's deferred research question ("whether Helcim supports a genuine remote device-cancel API"). If research confirms no such endpoint exists, `cancelTerminal()`'s real job becomes bookkeeping only (setting the mark-and-void flag) — it should NOT be renamed/repurposed to silently call `voidTransaction` with no transactionId (there isn't one yet at cancel time).

**`terminalPurchase`'s pending-invoice cache write** (helcim.js:200-228) is the client-side-of-Helcim correlation record (`helcim:terminal:pending:<deviceCode>` → invoiceNumber), separate from and complementary to the `KIOSK_PENDING_CHARGE_PREFIX` record in pos.js — useful context if the cancel fix needs to correlate a cancel to "was a push already sent for this device."

---

## Shared Patterns

### Structured event emission (money-path telemetry)
**Source:** `zoho-middleware/lib/eventLog.js` (module) + call idiom at `zoho-middleware/routes/pos.js:608-634` and `zoho-middleware/lib/money-path.js:202-212/231-234`.
**Apply to:** all new stage-timing / latency events; all new cancel/void outcome events.
```javascript
log.error('[pos/kiosk/sale] <human-readable summary with key=value pairs>');
eventLog.logEvent('kiosk.<event_name>', { /* structured, NO PII, safe fields only */ });
```
Existing `kiosk.*` event names already in use: `kiosk.total_mismatch`, `kiosk.gift_card_redeemed`, `kiosk.gift_card_issued`, `kiosk.gift_card_reloaded`, `kiosk.sale_completed`, `kiosk.salesorder_created`, `kiosk.salesorder_payment`, `kiosk.so_pay_failed_after_charge`, `kiosk.salesorder_updated`. New names should follow the same `kiosk.<snake_case>` convention (e.g. `kiosk.sale_stage_timing`, `kiosk.terminal_push_latency`, `kiosk.cancel_after_push`).

### Void-on-failure (single path)
**Source:** `zoho-middleware/lib/money-path.js:191-245` (`voidWithTimeout`).
**Apply to:** any new code path that must void a Helcim charge after the fact (the cancel-safety fix). Never call `helcimLib.voidTransaction` directly outside this wrapper (audit H5/L18) — `reconcile.js`'s inline void block (lines 259-302) is a pre-existing, reviewed exception (predates `money-path.js` extraction) with its own equivalent already-voided/critical-alert handling; do not treat it as a second precedent to copy from for NEW code.

### Idempotency / pending-record keying convention
**Source:** `zoho-middleware/lib/constants.js` `CACHE_KEYS.*` + `zoho-middleware/routes/pos.js:736` (`KIOSK_PENDING_CHARGE_PREFIX + refNumber`) + `zoho-middleware/lib/reconcile.js:100` (`KIOSK_IDEM_PREFIX + 'confirm:' + key`).
**Apply to:** any new "cancelled" or "cancel-then-approved" marker key — add to `C.CACHE_KEYS`, prefix + refNumber, fire-and-forget `cache.set(...).catch(function () {})`, non-blocking.

### Client fire-and-forget beacon (never breaks UI)
**Source:** `js/kiosk-core.js:126-161` (`_kcReportClientError`) — `try { fetch(...).catch(function(){}); } catch (e) {}` wrapping.
**Apply to:** any new client-side telemetry emitter (stage-timing or otherwise) — same defensive wrapping so a beacon failure never throws into the payment flow.

## No Analog Found

None — every file in scope has a strong, same-file or same-module analog. The only open question is a NEW route/field decision for the client latency beacon (see "Flag for planner" above), which is a design choice, not a missing-analog gap.

## Existing Tests That Pin Behavior This Phase Must Change

| Test file | What it pins | Impact |
|-----------|---------------|--------|
| `tests/frontend/kiosk-client-error-beacon.test.js` | The exact 6-key (+optional `item_id`) whitelist shape of `_kcReportClientError`'s POST body to `/api/kiosk/client-error` ("Test 5 pins the six-key shape") | If the planner chooses to extend this endpoint/function for latency data (option b above), this test's existing assertions must NOT change — only a new test case for the new optional field should be added. If a new sibling endpoint/function is used instead (option a), this file is untouched. |
| `zoho-middleware/__tests__/pos-money-defects.test.js` (WR-03 describe block, `cache.releaseLock` assertions) | That a terminal-push failure releases the idempotency lock via `cache.releaseLock` | Stage-timing instrumentation must not change this control flow (only wrap it with timers/eventLog calls) — verify after instrumenting that WR-03-A/B still pass unmodified. |
| `zoho-middleware/__tests__/pos-precharge-assertion.test.js` ("Confirm-path unresolved tax — void, never orphan" describe block) | That `moneyPath.voidWithTimeout` is called with `(helcimLib, transaction_id, grandTotal, {reqId})` and that a 502 + `payment_voided:true` + `voided_transaction_id` shape follows | Any new cancel-safety code sharing this response shape (e.g. a cancelled-and-then-approved sale surfacing on the STATUS poll) should reuse this exact response shape for consistency — no existing assertion needs to change, but the new code is expected to match it. |
| `zoho-middleware/__tests__/pos-sale-quarantine.test.js`, `pos-money.test.js`, `helcim-terminal-success.test.js` | Boilerplate `jest.mock('../lib/helcim', ...)` includes `cancelTerminal: jest.fn().mockResolvedValue({})` / `{ok:false}` as inert mock scaffolding (not asserted on) | No behavioral assertion on `cancelTerminal`'s return shape exists in these files today — safe to change `cancelTerminal`'s real return shape/signature without touching these mocks, AS LONG AS no code path outside `/api/pos/cancel` calls it (grep confirms `cancelTerminal` is only called from `pos.js:1587`). If the fix changes `cancelTerminal(refNumber)`'s arity, update these three mock stubs' `jest.fn()` signature-shape comments (not required by Jest, but keep consistent). |
| No test exists for `/api/pos/cancel` route handler itself | — | This is a genuine gap, not a pinned-behavior conflict — the new cancel-safety regression tests (per CONTEXT.md: "cancel fired, then terminal APPROVES" / "cancel before any push") are net-new, modeled on the `pos-money-defects.test.js` harness. |

## Test Harness Patterns to Reuse

### Middleware route-handler harness (money-path critical tests)
**Source:** `zoho-middleware/__tests__/pos-money-defects.test.js:22-250` (full mock block + `getPosHandlers()`).
```javascript
jest.mock('express', function () {
  var router = { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});
jest.mock('../lib/helcim', function () { return { /* isTerminalEnabled, terminalPurchase, pollTerminalResult, voidTransaction, cancelTerminal, ... all jest.fn() */ }; });
jest.mock('../lib/cache', function () { return { get: jest.fn(), set: jest.fn(), del: jest.fn(), acquireLock: jest.fn(), releaseLock: jest.fn() }; });
jest.mock('../lib/eventLog', function () { return { logEvent: jest.fn() }; });
jest.mock('../lib/money-path', function () {
  return {
    acquireIdempotencyLock: jest.fn().mockResolvedValue({ status: 'acquired' }),
    voidWithTimeout: jest.fn().mockImplementation(function (helcimLike, txnId) {
      return helcimLike.voidTransaction(txnId).then(function () {}).catch(function () {});
    })
  };
});
jest.mock('../lib/constants', function () { return { CACHE_KEYS: { /* test:-prefixed keys incl. KIOSK_PENDING_CHARGE_PREFIX */ } }; });

function getPosHandlers() {
  jest.resetModules();
  cache = require('../lib/cache'); helcimLib = require('../lib/helcim'); moneyPath = require('../lib/money-path');
  require('../routes/pos');
  router = require('express').Router();
  handlers = {};
  router.post.mock.calls.forEach(function (call) { handlers[call[0]] = call[call.length - 1]; });
  router.get.mock.calls.forEach(function (call) { handlers[call[0]] = call[call.length - 1]; });
}

function mockRes() {
  var r = { json: jest.fn(), status: jest.fn(), headersSent: false };
  r.status.mockReturnValue(r);
  return r;
}
function captureStatus(res) {
  var captured = { code: null };
  res.status.mockImplementation(function (code) { captured.code = code; return res; });
  return captured;
}
// Invoke directly: handlers['/api/pos/cancel'](req, res);
```
This harness is the direct model for new tests covering: `/api/pos/cancel` mark-and-void write, `/api/kiosk/sale/status` routing an approved-but-cancelled poll result through `moneyPath.voidWithTimeout`, and "cancel before any push" clean no-charge return.

### Frontend jsdom beacon/payment-flow harness
**Source:** `tests/frontend/kiosk-sale-beacon-servererror.test.js` (full file, 126 lines).
```javascript
global.window = global.window || {};
global.navigator = global.navigator || { userAgent: 'test-iPad' };
global.fetch = jest.fn(function () {
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); } });
});
global.SHEETS_CONFIG = { MIDDLEWARE_URL: 'http://localhost:3001', /* ... */ };

function loadSurface(p) {
  jest.resetModules();
  if (global.window) delete global.window.KioskCore;
  document.body.innerHTML = '';
  var mod = require(p);
  return { mod: mod, core: global.window.KioskCore };
}
function mockFetchOnce(status, body, ok) {
  global.fetch.mockImplementationOnce(function () {
    return Promise.resolve({ ok: typeof ok === 'boolean' ? ok : (status >= 200 && status < 300), status: status, json: function () { return Promise.resolve(body); } });
  });
}
function flushPromises() { return new Promise(function (resolve) { setTimeout(resolve, 0); }); }
function beaconCall() {
  var call = global.fetch.mock.calls.find(function (c) { return typeof c[0] === 'string' && c[0].indexOf('/api/kiosk/client-error') !== -1; });
  if (!call) return null;
  var opts = call[1] || {};
  return { url: call[0], opts: opts, body: opts.body ? JSON.parse(opts.body) : null };
}

// Usage: core._setCart({...}); mockFetchOnce(202, { pending: true, reference: 'KIOSK-1' }); core.proceedToPayment(); await flushPromises();
// proceedToPayment() falls straight through to _kioskPushToTerminal when no
// kiosk-payment-items DOM element / GC panel is injected (comment at line 20-21).
```
This is the direct model for: (1) a new push-latency beacon assertion test (swap `beaconCall()`'s URL filter for the new latency endpoint), and (2) a new cancel-then-approve regression test — after `mockFetchOnce(202, {pending:true, reference: ref})` + `proceedToPayment()` + `flushPromises()`, the cancel button (`document.getElementById('kiosk-cancel-payment')`) will have its `.onclick` reassigned by `_kioskPushToTerminal` (kiosk-core.js:2841-2854); invoke it, then `mockFetchOnce` a subsequent `/api/kiosk/sale/status` `approved` response and assert on what the fix does (must NOT silently proceed to `confirmSale`/booking after `cancelled = true`).

## Metadata

**Analog search scope:** `zoho-middleware/routes/pos.js`, `zoho-middleware/lib/helcim.js`, `zoho-middleware/lib/money-path.js`, `zoho-middleware/lib/eventLog.js`, `zoho-middleware/lib/reconcile.js`, `zoho-middleware/lib/constants.js`, `zoho-middleware/routes/webhooks.js`, `js/kiosk-core.js`, `zoho-middleware/__tests__/*.test.js`, `tests/frontend/*.test.js`
**Files scanned:** ~15 read in full or targeted ranges; ~20 grepped for cross-references
**Pattern extraction date:** 2026-08-11
