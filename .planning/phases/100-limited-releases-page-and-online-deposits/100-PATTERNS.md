# Phase 100: Limited Releases page and online deposits - Pattern Map

**Mapped:** 2026-10-29
**Files analyzed:** 27 (new or modified)
**Analogs found:** 25 / 27 (two have no usable in-repo analog; see the last section)

All paths are relative to `/Users/koa/dev/steins-and-vines-website` unless stated. Middleware paths are under `zoho-middleware/`.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `zoho-middleware/routes/preorder.js` (`/api/preorder/initialize`, `/api/preorder/deposit`) | route/controller | request-response + multi-step money path | `zoho-middleware/routes/checkout.js` (+ `routes/payments.js` for initialize) | role-match (copy flow, NOT the `rejectWithVoid` pattern) |
| `zoho-middleware/lib/limited-releases.js` (allowlist, `DEPOSIT_PER_KIT`, caps) | config/utility | transform | `zoho-middleware/lib/constants.js` / `lib/checkout-helpers.js` | role-match |
| `zoho-middleware/lib/limited-releases-deposit.js` (only home of `salesorders_to_apply`; advance lookup; cleanup) | service | CRUD (Zoho writes) | `zoho-middleware/lib/money-path.js` `finalizeSalesOrderInvoiceAndApplyPayment` (inverse of it) | role-match |
| `zoho-middleware/lib/money-path.js` (add optional `advance` arg) | service (shared lib) | CRUD | itself, lines 376-407 | exact (modify) |
| `zoho-middleware/lib/zoho-api.js` (add `zohoDelete`, `zohoPostOnce`) | utility | request-response | `zohoPut` / `zohoPost`, lines 92-123 | exact |
| `zoho-middleware/lib/checkout-helpers.js` (extract `resolveOrCreateContact`) | utility | CRUD | `routes/checkout.js` `resolveCustomerId`, lines 260-305 | exact (verbatim move) |
| `zoho-middleware/routes/checkout.js` (delegate to extracted helper) | route | request-response | itself | exact (refactor) |
| `zoho-middleware/routes/pos.js` `processSalesOrderPay` (advance-aware amount due) | route | request-response + terminal poll | itself, lines 2612-2840 | exact (modify) |
| `zoho-middleware/lib/mailer.js` (+ `sendPreorderDepositConfirmation`, `sendPreorderDepositNotification`) | service | event-driven (fire-and-forget email) | `sendCustomerConfirmation` (254-300), `sendVoidFailureAlert` (220-237) | exact |
| `zoho-middleware/server.js` (mount route, limiter, public bypass, offline list) | config | middleware wiring | `/checkout` entries in the same file | exact |
| `zoho-middleware/lib/authTiers.js` (only if a kiosk preview route is added) | config | request-response | `/api/kiosk/salesorders` entries, lines 62/84 | exact |
| `zoho-middleware/scripts/spike-limited-release-advance.js` (Wave 0 live spike) | script | batch/one-off | `scripts/replay-collect-webhook.js` | exact |
| `zoho-middleware/__tests__/preorder-deposit.test.js` | test | request-response | `__tests__/checkout-so-deposit-reconcile.test.js` | exact |
| `zoho-middleware/__tests__/salesorders-to-apply-guard.test.js` | test | repo scan | none (see No Analog) | none |
| `zoho-middleware/__tests__/kiosk-salesorder-advance.test.js` | test | request-response | `__tests__/kiosk-salesorders.test.js` | exact |
| `limited-releases.html` | page | static + JS render | `reservation.html` (shell, CSP, Helcim and reCAPTCHA scripts, newsletter label); `beer.html` (catalog-style page) | role-match |
| `css/limited-releases.css` (+ `.min.css`) | style | n/a | `css/catalog-subpage.css` | role-match |
| `js/modules/18-limited-releases.js` (standalone module) | component/controller | request-response + postMessage | `js/modules/16-catalog-subpage.js` (standalone and export guard) + `12-checkout.js` 1815-1860 (Helcim) | role-match |
| `package.json` (`stamp:pages`, `minify:css`, `minify:js` additions) | config | build | existing lines 9-11, 17 | exact |
| `tests/frontend/limited-releases.test.js` | test | jsdom | `tests/frontend/16-catalog-subpage.test.js` | role-match |
| `tests/frontend/limited-releases-holdback.test.js` | test | repo scan | `tests/frontend/beer-page-holdback.test.js` (via `git show 6e05a60d:tests/frontend/beer-page-holdback.test.js`) | exact |
| `tests/frontend/cookie-consent.test.js`, `legal-pages.test.js`, `page-search-consistency.test.js` (list additions) | test | list edit | themselves | exact |
| `tests/e2e/static-pages.spec.js` (new describe) | test | e2e | existing `test.describe('About page')` | exact |
| `refunds.html`, `terms.html` (new deposit sections) | page | static | existing sections in the same files | exact |
| `docs/RUNBOOK.md` (supplier failure, switching, forfeits, brew day) | docs | n/a | existing RUNBOOK entries | exact |
| `content/limited-releases-2026-27.json` (second commit: terms) + `images/limited-releases/` | content | static | n/a | commit 1 is the files unchanged |

## Pattern Assignments

### `zoho-middleware/routes/preorder.js` (route, request-response money path)

**Analog:** `zoho-middleware/routes/checkout.js` (flow skeleton) and `zoho-middleware/routes/payments.js` (initialize shape).

**Imports and module header** (checkout.js lines 1-28, trim to what preorder needs):
```javascript
var express = require('express');
var zohoApi = require('../lib/zoho-api');
var cache = require('../lib/cache');
var log = require('../lib/logger');
var eventLog = require('../lib/eventLog');
var helcimLib = require('../lib/helcim');
var C = require('../lib/constants');
var helpers = require('../lib/checkout-helpers');
var moneyPath = require('../lib/money-path');
var redact = require('../lib/redact');
var captureExceptionSafe = require('../lib/sentry-capture').captureExceptionSafe;
var verifyRecaptcha = helpers.verifyRecaptcha;
var findMakersFeeItem = helpers.findMakersFeeItem;
var findMaterialsFeeItem = helpers.findMaterialsFeeItem;
var zohoPost = zohoApi.zohoPost;
var zohoGet = zohoApi.zohoGet;
var mailer = require('../lib/mailer');
var mailerlite = require('../lib/mailerlite');
var router = express.Router();
```
Do NOT require `brewpad-integration`, `inventory-ledger`, or call `notifyAdminPanel` (anti-patterns per RESEARCH). Keep module-scope instances so Jest mocks bite (see the comment at checkout.js 43-47).

**Email sanitising** (checkout.js 54-57), copy verbatim for any customer-supplied text going to email or notes:
```javascript
function emailLine(value, maxLen) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n]+/g, ' ').trim().substring(0, maxLen);
}
```

**Input validation style** (checkout.js 97-149): shape-check email (`@`, length 254), name/phone length caps, `transaction_id` string length <= 64, per-line integer qty. Difference for preorder: validate against the allowlist from `lib/limited-releases.js`, qty 1-10 per line, total <= 10 (D-18), and do NOT call `rejectWithVoid` (it voids whatever `payment_token` the client names with no ownership proof; D-17/D-19). Instead only void after the Helcim readback shows `APPROVED`, `type === 'purchase'`, cents match, and `invoiceNumber` equals the minted nonce.

**reCAPTCHA fail-closed** (checkout.js 156-214). Copy the structure, but replace the raw `helcimLib.voidTransaction(body.payment_token)` with an ownership-checked void:
```javascript
var captcha = await verifyRecaptcha(rcToken);
if (!captcha.success || captcha.score < 0.5) { /* log.warn without PII; void (if ownership proven); return 400 'Request could not be verified. Please try again.' */ }
...
} catch (err) {
  var isProdRcRoute = process.env.NODE_ENV === 'production';
  if (isProdRcRoute) { /* void + 400 */ }
  return proceed();   // dev only
}
```

**Idempotency lock** (checkout.js 161-176; status values `replay | contention | failclosed | acquired`):
```javascript
var lockResult = await moneyPath.acquireIdempotencyLock(cache, idempotencyKey, CHECKOUT_IDEMPOTENCY_TTL);
if (lockResult.status === 'replay') { return res.status(201).json(lockResult.cached); }
if (lockResult.status === 'contention' || lockResult.status === 'failclosed') {
  return res.status(409).json({ error: 'Checkout already in progress' });
}
```
For preorder: key `preorder:idem:<txn>`, TTL 900, cache the final response for 24 h under the same key so a browser refresh returns the original confirmation.

**Replay guard across all cart suffixes** (checkout.js 247-258, and money-path `assertTxnNotReplayed(cache, id, suffix)` / `markTxnUsed(cache, id, suffix, ttl)`): the checkout suffix is `'' | ':sv-cart-ferment' | ':sv-cart-ingredients'`. Call the assert for all three, and mark all three after success (Pitfall 2).
```javascript
var txnResult = await moneyPath.assertTxnNotReplayed(cache, transactionId, txnKeySuffix);
if (txnResult.status !== 'ok') { return res.status(409).json({ error: 'Payment already processed' }); }
```

**Helcim readback** (checkout.js 625-654 is the base; tighten per Pitfall 2). `helcimLib.getCardTransactionById` returns `{ status, transactionId, invoiceNumber, cardType, amount, type }` (helcim.js 373-398). The preorder check:
```javascript
var txn = await helcimLib.getCardTransactionById(transactionId);   // wrap in try/catch -> treat failure as unverified
var okTxn = txn && txn.status === 'APPROVED' && txn.type === 'purchase' &&
            txn.invoiceNumber === expectedNonceInvoiceNumber &&
            Math.round(parseFloat(txn.amount) * 100) === Math.round(DEPOSIT_PER_KIT * totalKits * 100);
```
Checkout allows overpayment (lines 647-653); preorder must NOT. Exact cents only.

**SO create payload** (checkout.js 524-530 shape; RESEARCH "Create one SO" excerpt for fields):
```javascript
var salesOrder = {
  customer_id: customerId,
  date: new Date().toISOString().slice(0, 10),
  reference_number: 'LIMITED-2026-27',
  line_items: [ /* kit {item_id, quantity:1, rate}, MAKERS-FEE, MAT-FEE */ ],
  notes: '...'   // deposit, Helcim txn, release month, consent text + ISO timestamp, "fees invoiced on brew day"
};
var data = await zohoPost('/salesorders', salesOrder);   // switch to zohoPostOnce (no retry) to avoid duplicate SOs
```
Leave `tax_id` off, as checkout does.

**Fee-item guard** (checkout.js 561-571): numeric item_id check, copy verbatim (error message and `isSnapshotFallback` flag). Fee lookup uses `findMakersFeeItem(services, process.env.MAKERS_FEE_ITEM_ID)` and `findMaterialsFeeItem(services, process.env.MATERIALS_FEE_ITEM_ID)` (checkout-helpers.js 170-201). Services come from `cache.get(C.CACHE_KEYS.SERVICES)` with `helpers.readServicesSnapshot()` as the fallback (checkout.js 331-335).

**Void-on-failure** (checkout.js 893-971). Use `moneyPath.voidWithTimeout` (money-path.js 201-261); pass module-scope deps:
```javascript
moneyPath.voidWithTimeout(helcimLib, transactionId, depositAmount, {
  mailer: mailer, eventLog: eventLog, reqId: reqId
}).then(function (voidResult) {
  res.status(status).json({ error: clientMsg, voided: voidResult.ok });
});
```
`voidWithTimeout` resolves `{ok, reason}` and never rejects. The UI-SPEC needs `voided: true | false` in every error JSON. Order for D-04: best-effort cleanup of created SOs and payments, THEN void; the void must not be skipped if cleanup throws. Do not copy checkout's dual-cart skip-void block (lines 895-946).

**Generic client errors** (checkout.js 883-891): log the Zoho message server-side, send only `'Order creation failed. Please try again.'`.

**Newsletter opt-in** (checkout.js 816-851): copy verbatim, replacing `source: 'checkout'` with `'preorder'` and `orderNumber` with the first SO number. Strict `=== true`, `redact.maskEmail`, `mailerlite.isConfigured()` branch, staff notify in its own chain.

**Zero-PII event log** (checkout.js 949-954 pattern):
```javascript
eventLog.logEvent('preorder.failed_after_charge', { kitCount: n, grandTotal: total, txnId: transactionId });
```
Never log name, email, phone. Mask via `redact.maskEmail`.

**Initialize route analog:** `zoho-middleware/routes/payments.js` lines 15-32 (`handlePaymentInitialize`). It trusts the client amount, so preorder's `initialize` must instead take `{items}`, compute the amount server-side, call `helcimLib.initializeCheckout` (helcim.js 111-129) extended to accept `invoiceRequest.invoiceNumber`, and store `nonce -> {amount, kits}` in Redis (1 h). Response shape matches: `{ checkoutToken, secretToken, depositAmount }`:
```javascript
helcimLib.initializeCheckout(amount, 'CAD')
  .then(function (result) { res.json({ checkoutToken: result.checkoutToken, secretToken: result.secretToken, depositAmount: amount }); })
  .catch(function (err) { log.error('[payment/initialize] Failed: ' + err.message); res.status(502).json({ error: 'Payment initialization failed' }); });
```
Note: `initializeCheckout` currently posts only `{paymentType, amount, currency}`. Adding an optional third parameter for `invoiceRequest` is a shared-lib change (full-suite rule 7). [LIVE-VERIFY LV11]

**Zoho-offline handling:** `req.zohoOffline` is set by server.js when `/preorder/deposit` is on the offline list. In the route: if set, void immediately and return 503 `{voided}`. Checkout's offline branch is lines 218-233, but that one does the opposite (accepts the order by email), so do not copy it.

---

### `zoho-middleware/lib/limited-releases.js` (config/utility)

**Analog:** `zoho-middleware/lib/constants.js` for constant style, `lib/checkout-helpers.js` for pure helpers (ES5, `module.exports = {...}` at file end, lines 257-259 style).

Pattern to follow (ES5, no JSON read):
```javascript
var DEPOSIT_PER_KIT = 50;
var MAX_QTY_PER_LINE = 10;
var MAX_KITS_PER_ORDER = 10;          // D-18, request-size bound, not an inventory cap
var CAMPAIGN_REFERENCE = 'LIMITED-2026-27';
var ALLOWLIST = { /* ten Zoho item_id strings -> { sku, release } */ };
// Per-item cap hook: ALLOWLIST[id].cap (undefined = no cap)
module.exports = { DEPOSIT_PER_KIT: ..., ALLOWLIST: ..., validateBasket: ..., ... };
```
Pure functions (`validateBasket`, `computeDeposit`) are what the unit tests exercise without booting the server.

---

### `zoho-middleware/lib/limited-releases-deposit.js` (service, Zoho writes)

**Analog:** `lib/money-path.js` lines 376-407 (the payment POST), inverted. Request shape from the RESEARCH Pattern 1 excerpt (proven in history `438400bb`, `0f879a54^`):
```javascript
// WHY ADVANCE: a limited-release deposit is a customer liability until the kit is invoiced on brew day.
// This is the ONE sanctioned use of salesorders_to_apply (see money-path.js header). Never import elsewhere.
function bookSalesOrderDepositAdvance(args) {
  return zohoPost('/customerpayments', {
    customer_id: args.customerId,
    payment_mode: 'creditcard',
    amount: args.amount,
    date: args.date,
    reference_number: args.helcimTxnId,
    description: 'LIMITED-2026-27 deposit ' + args.soNumber + ' (Helcim ' + args.helcimTxnId + ')',
    salesorders_to_apply: [{ salesorder_id: args.soId, amount_applied: args.amount }]
  });
}
```
Also holds advance lookup (`GET /customerpayments/{id}` for `unused_amount`) and `cleanupCreated(created[])` (delete payments first, then void SO; each step best-effort; accumulate failures into one staff alert in the `sendVoidFailureAlert` style). Use `description`, not `notes`.

**Do NOT edit** the "NEVER salesorders_to_apply" comment at money-path.js 365-366 beyond adding a cross-reference line pointing here (D-01: do not loosen existing guards).

---

### `zoho-middleware/lib/money-path.js` (modify: optional `advance`)

**Analog:** itself. Current function body, lines 376-407. Insert the credit step between `ensureOpenInvoiceForSalesOrder` and the `GET /invoices/{id}` so the clamp sees the reduced `balance_due`:
```javascript
function finalizeSalesOrderInvoiceAndApplyPayment(soId, payment) {
  return ensureOpenInvoiceForSalesOrder(soId).then(function (invoiceId) {
    // NEW (only when payment.advance): re-read advance unused_amount; if >= amount,
    // zohoPost('/invoices/' + invoiceId + '/credits', { invoice_payments: [{ payment_id, amount_applied }] })
    return zohoGet('/invoices/' + invoiceId).then(function (invData) {
      ...clamp against balance_due (lines 380-393)...
      return zohoPost('/customerpayments', { ... invoices: [{ invoice_id: invoiceId, amount_applied: applyAmount }] })
```
When `advance` is absent the call sequence must be byte-identical; pin with a new test (existing `money-path.test.js` stays unmodified). Module style: lazy `getHelcim()/getMailer()` getters keep Jest mocks working; keep `module.exports` (lines 409-418) additive only.

---

### `zoho-middleware/lib/zoho-api.js` (modify: `zohoDelete`, `zohoPostOnce`)

**Analog:** `zohoPut`, lines 110-123 (identical structure; swap `axios.put` for `axios.delete`, drop the body). `zohoPostOnce` copies `zohoPost` (92-106) but calls `withRetry(fn, { retries: 0 })` (the `opts.retries` override exists at line 11):
```javascript
function zohoPost(path, body) {
  return zohoAuth.getAccessToken().then(function (token) {
    return withRetry(function () {
      return axios.post(ZOHO_API_BASE + path, body, {
        headers: { Authorization: 'Zoho-oauthtoken ' + token },
        params: { organization_id: process.env.ZOHO_ORG_ID },
        timeout: 15000
      }).then(function (response) { return response.data; });
    });
  });
}
```
Add both to `module.exports` (lines 260-275). Shared lib: run the FULL suite on both sides. Note existing tests mock `../lib/zoho-api` as `{ zohoPost, zohoGet }` only, so the preorder tests must mock the new functions explicitly.

---

### `zoho-middleware/lib/checkout-helpers.js` (add `resolveOrCreateContact`) and `routes/checkout.js` (delegate)

**Analog:** `routes/checkout.js` lines 260-305, move verbatim (Pitfall 7, D-13 amended). The closure's free variables are `customerEmail`, `customerName`, `customerPhone`, `CONTACT_CACHE_KEY`, `CONTACT_CACHE_TTL`, `cache`, `zohoGet`, `zohoPost`, `buildContactPayload`. Make them parameters. Lazy-require `./cache` and `./zoho-api` inside the function (the way `money-path.js` does via getters) so existing Jest mocks of those modules still apply.
```javascript
var data = await zohoGet('/contacts', { email: customerEmail });
...
var contactPayload = buildContactPayload(customerName, customerEmail, customerPhone);
try { var createData = await zohoPost('/contacts', contactPayload); ... }
catch (createErr) {
  if (createErr.response && createErr.response.status === 400) {
    var nameData = await zohoGet('/contacts', { contact_name: customerName });
    ...
```
Returns `{ contactId, freshlyCreated }`. Do not apply the "Last, First" fix. Do this refactor as its own commit with the existing checkout tests unmodified and green.

---

### `zoho-middleware/routes/pos.js` `processSalesOrderPay` (modify, D-02)

**Analog:** itself, lines 2612-2840. Change points (line numbers are pre-edit):

- Line 2617 `var balance = parseFloat(so.balance);` becomes: if `String(so.reference_number||'').indexOf('LIMITED-') === 0`, compute `due` per RESEARCH Pattern 2 (`base - min(unused, base)`), else keep `balance` unchanged. Keep read-only GETs before `terminalPurchase`.
- Line 2623 guard `balance <= 0` uses `due` for LIMITED SOs; return a clear 400 if `due < 0.01`.
- Line 2657 `helcimLib.terminalPurchase(balance, refNumber, helcimIdemKey)` charges `due`.
- Lines 2672-2678 `pendingContext.amount` must be `due`.
- Lines 2734-2741: pass `advance: { payment_id, amount }` into `moneyPath.finalizeSalesOrderInvoiceAndApplyPayment(soId, {...})` for LIMITED SOs only.
- Lines 2754-2774: add `depositApplied` to the `kiosk.salesorder_payment` event and the response body (`amount: due`, `deposit_applied`).
- Lines 2782-2838 void-on-failure catch stays as is (uses `_voidFailed` shim and `voidWithTimeout`).
- Lines 2762-2766: `createBatchesFromSale` stays on this path (brew-day batch is wanted here; the fee lines on the SO are what trigger it).

Existing pattern to preserve for non-LIMITED SOs (lines 2734-2741):
```javascript
moneyPath.finalizeSalesOrderInvoiceAndApplyPayment(soId, {
  customer_id: customerId, amount: balance, payment_mode: paymentMode,
  reference_number: txnId || soNumber, notes: 'Kiosk SO payment. Terminal txn: ' + txnId, date: today
})
```
Coverage floor: `routes/pos.js` >= 80% lines, so every new branch needs a test. Stay inside the existing function; do not fork a parallel pay path.

---

### `zoho-middleware/lib/mailer.js` (add two senders)

**Analog:** `sendCustomerConfirmation` (lines 254-300) for the customer side and `sendVoidFailureAlert` (220-237) for the staff alert.

Customer-email pattern (lines 254-300):
```javascript
function sendCustomerConfirmation(data) {
  if (!data.email) return Promise.reject(new Error('No customer email provided'));
  ...
  var body = [ 'Thank you ...', '', 'Order Number: ' + orderNumber, ..., 'If you have any questions, reply to this email or call us at (604) 567-4565.', 'Steins & Vines', STORE_ADDRESS ]
    .filter(function (line) { return line !== ''; }).join('\n');
  return sendViaResend({ to: data.email, replyTo: staffTo(), subject: subject, text: body });
}
```
Staff-alert pattern: `sendViaResend({ to: staffTo(), subject, text })` (lines 233-237). Use `htmlEscape` if sending HTML, and flatten customer-supplied strings with `emailLine`. List every SO number (D-04). Add to `module.exports` (line 509 onwards) and to the mocks in the new test (existing tests' mailer mocks list only specific functions).

---

### `zoho-middleware/server.js` (modify, four places)

**Analog:** the `/checkout` entries.

1. Route mount, next to line 847: `app.use('/', require('./routes/preorder'));`
2. Rate limiter, next to line 792: `app.use('/api/preorder', paymentLimiter);` (after `app.use('/api/checkout', paymentLimiter);`).
3. Public bypass, in the auth-tier guard near line 505:
```javascript
// /api/checkout is public — protected by reCAPTCHA + rate limit instead of API key
if (req.path === '/checkout') return next();
```
Add `if (req.path === '/preorder/initialize' || req.path === '/preorder/deposit') return next();`. Do NOT copy the referer exemption at line 106 (`requireAllowedReferer` must remain active for preorder).
4. Offline list, line 456: `var OFFLINE_CAPABLE_POSTS = ['/contacts', '/bookings', '/checkout'];` add `'/preorder/deposit'`.

Test: `/api/preorder/deposit` reachable without a key while an unrelated POST is still 403.

---

### `zoho-middleware/scripts/spike-limited-release-advance.js` (Wave 0 spike)

**Analog:** `zoho-middleware/scripts/replay-collect-webhook.js` (header and safety block lines 1-50) and `scripts/spike-past-sales-shapes.js` for read-only style.
```javascript
'use strict';
var cache = require('../lib/cache'); var helcim = require('../lib/helcim');
var zohoApi = require('../lib/zoho-api'); var zohoGet = zohoApi.zohoGet; var zohoPost = zohoApi.zohoPost;
var zohoAuth = require('../lib/zohoAuth');
function arg(name, def) { var i = process.argv.indexOf('--' + name); if (i !== -1 && i + 1 < process.argv.length) return process.argv[i + 1]; return def; }
function flag(name) { return process.argv.indexOf('--' + name) !== -1; }
// Refuses to run unless SENTRY_ENVIRONMENT === 'staging' (or --allow-nonstaging); run via `railway ssh`.
```
It must clean up everything it creates (D-16) and print answers to LV1-LV12.

---

### `zoho-middleware/__tests__/preorder-deposit.test.js` (test)

**Analog:** `__tests__/checkout-so-deposit-reconcile.test.js`. Copy the mock block before any `require` (lines 29-90): server-boot mocks (`zohoAuth`, `validateEnv`, `checkRedis`, `checkMailer`, `node-cron`, `@sentry/node`), `mailerlite`, `eventLog`, `inventory-ledger`, `helcim` (with `getCardTransactionById: jest.fn()`, `voidTransaction`, `isEnabled`), `zoho-api` (`{ zohoPost: jest.fn(), zohoGet: jest.fn() }`; add `zohoDelete`, `zohoPostOnce`), `cache` (with `acquireLock`, `get`, `set`, `del`), `mailer` (add the two new functions plus `sendVoidFailureAlert`), `axios`. New file only (rule 10).

Required cases are in RESEARCH "Phase Requirements -> Test Map" (validate, amount, replay, idempotent, failure per step, no-batch, advance body, recaptcha, newsletter, pii, server-plumbing). Run single files with `--coverage=false`.

### `zoho-middleware/__tests__/kiosk-salesorder-advance.test.js`

**Analog:** `__tests__/kiosk-salesorders.test.js` lines 1-60: mocks for `../lib/helcim` (`isTerminalEnabled`, `terminalPurchase`, `pollTerminalResult`, `generateIdempotencyKey`, `voidTransaction`), `../lib/zoho-api`, `../lib/cache`, `../lib/eventLog`, `../lib/logger`, `../lib/mailer`, `../lib/inventory-ledger`, then `jest.mock('express', ...)` to capture handlers. Reuse that handler-capture harness. Existing SO mocks have no `reference_number`, which proves non-LIMITED SOs are untouched.

---

### `limited-releases.html` (page)

**Analog:** `reservation.html` (shell, CSP, scripts, consent label), with page structure from `beer.html`/`wine.html` and UI-SPEC lines 94-245.

**CSP:** copy the `<meta http-equiv="Content-Security-Policy">` tag from `reservation.html` line 14 verbatim (includes `secure.helcim.app`, `secure.myhelcim.com`, google/gstatic for reCAPTCHA, and Railway in `connect-src`). CLAUDE.md rule 12 and `legal-pages.test.js` CSP checks apply. Verify `connect-src` allows loading `/content/limited-releases-2026-27.json` (same origin, `'self'`).

**Script block at end of body** (reservation.html lines 315-322):
```html
<script src="js/vendor/sentry.min.js"></script>
<script src="js/sentry-init.js"></script>
<script src="https://secure.helcim.app/helcim-pay/services/start.js"></script>
<script src="https://www.google.com/recaptcha/api.js?render=6LerSH0sAAAAAGKtltFqN5fu2w8opPV5BStdzNDu" async></script>
<script src="js/sheets-config.js" defer></script>
<script src="js/main.min.js?v=mvk4w9cg" defer></script>
```
Add `<script src="js/modules/18-limited-releases.min.js?v=..." defer>`. Also `<script src="js/consent.js"></script>` in `<head>` before `</head>` and the "Cookie settings" footer button (`cookie-consent.test.js` 199-212 requires both).

**Newsletter label** (reservation.html 237-240), reuse for D-15, and keep unticked by default:
```html
<label class="checkout-consent-row" for="res-newsletter">
  <input type="checkbox" id="res-newsletter" name="newsletter">
  <span>Email me news and offers from Steins &amp; Vines. Unsubscribe any time.</span>
</label>
```
Terms label (reservation.html 235) is the model for the consent row linking `terms.html`, `refunds.html`, `privacy.html`. reCAPTCHA note (reservation.html 244) copy verbatim.

**Hold-back:** `<meta name="robots" content="noindex">` (beer precedent used `noindex, nofollow`; test regex is `/<meta name="robots" content="noindex, nofollow">/`, so use that exact string for consistency). No nav link on any other page, no sitemap entry.

---

### `js/modules/18-limited-releases.js` (standalone module)

**Analog:** `js/modules/16-catalog-subpage.js`. Header (lines 1-5) states "Standalone module (NOT in concat:js)". Export guard at line 998:
```javascript
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { /* pure functions for tests */ };
}
```
ES5 only (`var`, `function`, no arrow, no template strings). Keep pure functions (basket total, button state, weeks display, JSON-LD builder) exported for Jest.

**Helcim iframe flow:** `js/modules/12-checkout.js` lines 1815-1860 (message listener). Copy exactly the origin check and event matching, since it works in production:
```javascript
window.addEventListener('message', function (event) {
  if (event.origin !== 'https://secure.helcim.app' && event.origin !== 'https://myhelcim.com') { return; }
  var data = event.data || {};
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { return; } }
  var _nameMatchesCheckout = _helcimCheckoutToken && data.eventName === 'helcim-pay-js-' + _helcimCheckoutToken;
  var _nameMatchesSecret = _helcimSecretToken && data.eventName === 'helcim-pay-js-' + _helcimSecretToken;
  if (!_nameMatchesCheckout && !_nameMatchesSecret) return;
  if (data.eventStatus === 'SUCCESS') {
    _helcimTransactionId = extractHelcimTransactionId(data);
    if (typeof removeHelcimPayIframe === 'function') removeHelcimPayIframe();
    ...
  } else if (data.eventStatus === 'ABORTED') { ... }
});
```
`extractHelcimTransactionId` lives in `12-checkout.js` line 59 (a main.min.js global); to keep the module Jest-loadable standalone, either replicate its small logic or guard with `typeof extractHelcimTransactionId === 'function'`. Opening the iframe uses the global `appendHelcimPayIframe(checkoutToken)` (checkout.js usage at 12-checkout.js 2002/2021/2101; guard with `typeof appendHelcimPayIframe !== 'function'`). reCAPTCHA token: `grecaptcha.execute(window.RECAPTCHA_SITE_KEY, {action: 'preorder_deposit'})` (self-contained, not importing from 12a).

Wiring: this module is standalone, so it does not need `13-init.js` `data-page` wiring; load it via its own `<script>` tag as pages do for module 16/17.

---

### `package.json` (build wiring)

**Analog:** the existing entries.
- `minify:css` (line 9): append `&& cleancss -o css/limited-releases.min.css css/limited-releases.css`.
- `minify:js` (line 11): append `&& terser js/modules/18-limited-releases.js -o js/modules/18-limited-releases.min.js -c -m` (module 14-17 `.min.js` files sit beside the sources in `js/modules/`).
- `stamp:pages` (line 17): add `limited-releases.html` to the page list; extend the inline regex to include `limited-releases\.min\.css` and `18-limited-releases\.min\.js` cache-bust tokens (UI-SPEC open item 4).
- `concat:js` (line 10): do NOT add module 18.
Run `npm run build` after any module change. Never edit `js/main.js` / `main.min.js`.

---

### Frontend tests

**`tests/frontend/limited-releases.test.js`** — Analog: `tests/frontend/16-catalog-subpage.test.js` (line 1: `var subpage = require('../../js/modules/16-catalog-subpage.js');` then `describe` blocks on exported pure functions). Set required globals before `require`, as `beer-page-holdback.test.js` does (`global.fetch`, `global.SHEETS_CONFIG`, `global.formatCurrency`). Required cases are listed in RESEARCH Validation Architecture and the assets handoff section 5. Read the content JSON directly (no copy kept); assert every `assets` path exists on disk.

**`tests/frontend/limited-releases-holdback.test.js`** — Analog: `git show 6e05a60d:tests/frontend/beer-page-holdback.test.js`. Copy the file-scan helpers and structure:
```javascript
var fs = require('fs'); var path = require('path');
var glob = function (dir) { return fs.readdirSync(dir).filter(function (f) { return /\.html$/.test(f); }); };
var ROOT = path.join(__dirname, '..', '..');
var read = function (p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); };
var PAGES = glob(ROOT).filter(function (f) { return f !== 'links.html'; })
  .concat(glob(path.join(ROOT, 'products')).map(function (f) { return 'products/' + f; }));
// no page links to limited-releases.html (not even itself); page is noindex; sitemap lacks it
```
Header comment must say it is deleted by the launch commit (as the beer one did).

**List additions** (call these out in the commit message): `tests/frontend/cookie-consent.test.js` `PAGES` (line ~199-203), `tests/frontend/legal-pages.test.js` `ROOT_PAGES` (line 25-26), `tests/frontend/page-search-consistency.test.js` `PUBLIC_PAGES` (line 20-27, only if the page carries the search button), `tests/e2e/static-pages.spec.js` (new `test.describe('Limited releases page', ...)` modelled on `About page`, lines 7-30, `page.goto('/limited-releases.html')`). `package.json` `stamp:pages`.

---

### `refunds.html`, `terms.html`, `docs/RUNBOOK.md`

**Analog:** the existing sections in each file. `refunds.html` line ~106 ("we do not take a separate deposit") sits in the sessions section and stays true for sessions; add a new "Limited Release deposits" section rather than editing it. `terms.html`: new numbered section (Reservations is section 4). `legal-pages.test.js` forbids `[CONFIRM` / `DRAFT` markers, and CSP must equal `about.html`'s, so draft the wording in the plan summary for owner approval before committing. RUNBOOK entries: supplier failure (Helcim refund, remove the advance in Zoho, void SO), switching (staff edit SO), forfeits (accountant), and the daily Helcim-vs-Zoho check.

## Shared Patterns

### Money-path primitives (apply to `preorder.js`, `pos.js` D-02 changes)
**Source:** `zoho-middleware/lib/money-path.js`
- `acquireIdempotencyLock(cache, key, ttl)` returns `{status}` of `replay|contention|failclosed|acquired`
- `assertTxnNotReplayed(cache, id, suffix)` returns `{status: 'ok'|'replay'|'failclosed'}`; `markTxnUsed(cache, id, suffix, ttl)` is best-effort
- `voidWithTimeout(helcimLib, token, amount, {mailer, eventLog, reqId})` always resolves `{ok, reason?}`
- Always pass the route's own `helcimLib`/`mailer`/`eventLog` module-scope references so Jest mocks apply (checkout.js 43-47, 957-961; pos.js 2825-2829).

### The `salesorders_to_apply` carve-out
**Source:** money-path.js 353-366 (the ban comment), `__tests__/checkout-so-deposit-reconcile.test.js`, `kiosk-salesorders.test.js`, `collect-webhook-reconcile.test.js`, `helcim-terminal-success.test.js`.
The literal may appear in code only in `lib/limited-releases-deposit.js`. The four existing ban tests are behavioural (they do not scan source files, verified by grep) and must stay green and unedited. A new repo-scan test enforces the single location.

### Void-after-capture with ownership proof (D-17)
Apply to every failure path in `preorder.js` after the Helcim readback passes. Do not use `moneyPath.rejectWithVoid` (money-path.js 149-175) or checkout.js 97-127, 156-214.

### Zero-PII logging
**Source:** `lib/eventLog.js` (`logEvent(name, flatObject)`), `lib/redact.js` (`maskEmail`), checkout.js 520 (masked email inside a thrown error message because the catch logs it verbatim) and 605, 822-824, 844-845. Log txn id, counts, totals only.

### Error responses
**Source:** checkout.js 859-891. Generic client message, Zoho detail only server-side, `captureExceptionSafe(err, {level:'error', tags:{reqId, txnId}})`. Add `voided` boolean to every failure JSON in preorder (UI-SPEC requirement).

### Fire-and-forget side effects
**Source:** checkout.js 661-674, 816-851. Pattern: `mailer.sendX(...).catch(function (mailErr) { log.warn('... (non-fatal): ' + mailErr.message); })`. Run after the 201 response is sent.

### Frontend: ES5 and build artifacts
`var`/`function` only; standalone module with `if (typeof module !== 'undefined' && module.exports)`; run `npm run build`; never edit `js/main.js` or `js/main.min.js`; per-file stamp tokens come from `stamp:pages`.

### Test hygiene
New test files only (rule 10); `--coverage=false` for single-file runs; per-file coverage floors in `zoho-middleware/jest.config.js` (`routes/pos.js` >= 80% lines, `routes/checkout.js` >= 52%); shared-lib edits (`lib/money-path.js`, `lib/zoho-api.js`, `lib/checkout-helpers.js`, `lib/helcim.js`, `lib/mailer.js`) require the FULL suite on both frontend and middleware (rule 7); run lint before commit.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `zoho-middleware/__tests__/salesorders-to-apply-guard.test.js` | test | repo scan | No existing middleware test scans source files for a forbidden literal (grep of `readFileSync` over the ban tests found none). The closest style reference is the frontend `beer-page-holdback.test.js` (fs-scan helpers, shown above). Planner should build it from `fs.readdirSync` over `lib/` and `routes/`, allow comment lines, and allow code only in `lib/limited-releases-deposit.js`. |
| Multi-SO all-or-nothing cleanup (`cleanupCreated`) and the nonce store (`preorder:initialize`) | service | pub-sub-ish state + compensation | No compensation/rollback of created Zoho records exists anywhere (the codebase only voids the Helcim charge). `zohoDelete` and SO-void endpoints do not exist yet. Use RESEARCH Pattern 3 and the spike results (LV8). The sequence and best-effort alerting shape can borrow from `voidWithTimeout`'s catch branches (money-path.js 227-260). |

Also note for the planner: no shared Zoho SO-void helper exists, and the SO-void and SO-delete endpoints are assumptions (RESEARCH A2). Confirm them in the Wave 0 spike before writing cleanup.

## Metadata

**Analog search scope:** `zoho-middleware/{routes,lib,scripts,__tests__}`, `js/modules/`, `tests/frontend/`, `tests/e2e/`, `css/`, root HTML pages, `package.json`, git history (`6e05a60d`, `5948fb0b`).
**Files read:** `routes/checkout.js` (lines 1-340, 500-740, 810-980), `lib/money-path.js` (100-418), `routes/pos.js` (2570-2860), `server.js` (selected ranges), `lib/zoho-api.js`, `lib/helcim.js` (111-129, 373-398), `lib/checkout-helpers.js` (selected), `lib/mailer.js` (220-300), `routes/payments.js` (1-80), test harness headers, `reservation.html` (CSP, scripts, consent rows), `js/modules/12-checkout.js` (1815-1860), `js/modules/16-catalog-subpage.js` (header and exports), the content JSON, CONTEXT, RESEARCH.
**Not read in full:** `100-UI-SPEC.md` (only its section index; the planner should take layout, copy and state tables from it directly), `beer.html`, `css/catalog-subpage.css`.
**Pattern extraction date:** 2026-10-29
