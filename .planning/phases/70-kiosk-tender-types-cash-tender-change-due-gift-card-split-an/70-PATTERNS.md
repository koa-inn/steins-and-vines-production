# Phase 70: Kiosk Tender Types (Cash + MOTO) - Pattern Map

**Mapped:** 2026-08-12
**Files analyzed:** 6 (3 to modify heavily, 2 head/config touches, tests are additive)
**Analogs found:** 6 / 6 (all files have a strong same-repo analog; no "no analog" cases)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|---------------|
| `zoho-middleware/routes/pos.js` — `processSaleWithPrices` tender branch (~752-832) | controller (route handler branch) | request-response / CRUD (booking) | Same file: existing gift-card-100%-coverage skip-terminal branch (pos.js:811-830) + existing `terminal_amount > 0` branch (pos.js:758-810) | exact (sibling branch in the same function) |
| `zoho-middleware/routes/pos.js` — `runConfirm` verify branch (~1352-1364) | controller (route handler branch) | request-response, money-path verify | Same file: `isManualConfirm`/`verifyManualCharge` branch (pos.js:1352-1364) for the tagged-error idiom; `checkout.js:613-634` (MONEY-01/H2) for the captured-amount verify itself | exact |
| `zoho-middleware/routes/pos.js` — cash `customerpayment` booking (~1382-1407) | controller (booking side-effect) | CRUD (Zoho POST) | Same file: terminal `customerpayment` block (pos.js:1382-1390) and gift-card `customerpayment` block (pos.js:1393-1407) | exact |
| `js/kiosk-core.js` — tender-selection UI + HelcimPay iframe mount (~2840-3226) | component (kiosk payment panel) | event-driven (DOM) / request-response (fetch) | Same file: gift-card tender panel injection (kiosk-core.js:3046-3225) and `_kioskPushToTerminal` (kiosk-core.js:2844-3035) | exact (same panel-injection idiom, same file) |
| `js/kiosk-core.js` — HelcimPay postMessage listener + `extractHelcimTransactionId` port | event handler | event-driven (`window.postMessage`) | `js/modules/12-checkout.js:59-68` (extract fn) + `js/modules/12-checkout.js:1806-1836` (listener) | role-match (public checkout, not kiosk, but same exact mechanism — this is an explicit port per RESEARCH.md) |
| `kiosk.html` — HelcimPay.js `<script>` + first CSP `<meta>` | config (HTML head) | n/a | `reservation.html` lines 19 (CSP meta) + 306 (HelcimPay script tag) | role-match (kiosk.html currently has NO CSP/no HelcimPay script — reservation.html is the donor pattern, not a like-for-like existing kiosk.html section) |
| `zoho-middleware/__tests__/*.test.js` (new: pos-cash-tender, pos-moto-tender or similar) | test | n/a | `zoho-middleware/__tests__/pos-precharge-assertion.test.js` (mock block) + `checkout-captured-amount.test.js` (captured-amount RED/GREEN harness) | exact (mock block is literally clonable) |
| `tests/frontend/*.test.js` (new: kiosk cash/MOTO panel tests) | test | n/a | `tests/frontend/kiosk-gift-card-mgmt.test.js` (kiosk panel harness via `js/kiosk.js` loadSurface) + `tests/frontend/kiosk-core-parity.test.js:144-150` (`loadSurface`) | exact |

## Pattern Assignments

### `zoho-middleware/routes/pos.js` — `processSaleWithPrices` cash/MOTO branch (controller, request-response)

**Analog:** same file, `pos.js:752-832` (the existing `terminal_amount` branch + the gift-card-100% skip-terminal branch)

**The exact shape to parallel** (pos.js:752-832 — read in full, this is the insertion point):
```javascript
// pos.js:752-757 — terminal_amount is computed BEFORE the tender branch;
// insert the new tender === 'cash' / tender === 'moto' checks here, as
// siblings to the `if (terminal_amount > 0) { ... } else { ... }` below.
var terminal_amount = Math.round((grandTotal - gift_amount) * 100) / 100;

var refNumber = (body.reference_number && typeof body.reference_number === 'string')
  ? body.reference_number.slice(0, 64)
  : ('KIOSK-' + Date.now());

if (terminal_amount > 0) {
  // ... existing helcimLib.terminalPurchase(...) branch (pos.js:758-810) —
  //     UNCHANGED, only reached when tender is the default/'terminal'
```

**The "skip terminal, respond non-pending" shape to mirror for BOTH cash and MOTO-init** (pos.js:811-830):
```javascript
// Source: zoho-middleware/routes/pos.js:811-830
} else {
  // Gift card covers 100% — skip terminal entirely.
  // Return a non-pending response so the client proceeds directly to confirm.
  log.info('[pos/kiosk/sale] Gift card covers 100% ($' + grandTotal.toFixed(2) +
    ') — skipping terminal. ref=' + refNumber + ' cert=' + gift_cert_number);

  var gcOnlyResponseBody = {
    pending: false,
    gift_card_only: true,
    reference: refNumber
  };

  var gcCacheWrite = idempotencyKey
    ? cache.set(idempotencyKey, gcOnlyResponseBody, IDEMPOTENCY_KEY_TTL).catch(function () {})
    : Promise.resolve();

  gcCacheWrite.then(function () {
    emitStageTiming('response_202', stageStart);
    res.status(202).json(gcOnlyResponseBody);
  });
}
```
Cash: respond `{ pending: false, cash: true, reference: refNumber }` — skip the `terminal_amount > 0` block entirely (no `terminalPurchase`, no `KIOSK_PENDING_CHARGE_PREFIX` write — that write lives ONLY inside the `terminal_amount > 0` block at pos.js:781-789, so cash naturally has nothing to reconcile).

MOTO: call `helcimLib.initializeCheckout(terminal_amount, 'CAD')` **in-process** (pos.js already does `require('../lib/helcim')` — check the top-of-file require, mirrors `checkout.js`'s use of the same lib) instead of `terminalPurchase`, then respond `{ pending: false, moto: true, checkout_token, secret_token, reference: refNumber }`. No pending-charge cache write (Pitfall 3 in RESEARCH.md — HelcimPay resolves synchronously, no webhook race to reconcile).

**`initializeCheckout` signature to call** (`zoho-middleware/lib/helcim.js:111-129`):
```javascript
/**
 * @param {number} amount   - Amount to charge (e.g. 50.00)
 * @param {string} currency - ISO currency code (default 'CAD')
 * @returns {Promise<{ checkoutToken: string, secretToken: string }>}
 */
function initializeCheckout(amount, currency) {
  if (!HELCIM_API_TOKEN) {
    return Promise.reject(new Error('Helcim not configured'));
  }
  return axios.post(HELCIM_BASE_URL + '/helcim-pay/initialize', {
    paymentType: 'purchase',
    amount: amount,
    currency: currency || 'CAD'
  }, { headers: helcimHeaders(), timeout: 10000 }
  ).then(function (resp) {
    var data = resp.data || {};
    if (!data.checkoutToken) { throw new Error('Helcim initialize did not return checkoutToken'); }
    return { checkoutToken: data.checkoutToken, secretToken: data.secretToken || '' };
  });
}
```

**Guard to check/relax:** `router.post('/api/kiosk/sale', ...)` currently 503s BEFORE any tender branching if `!helcimLib.isTerminalEnabled()`:
```javascript
// pos.js:312-315
router.post('/api/kiosk/sale', function (req, res) {
  if (!helcimLib.isTerminalEnabled()) {
    return res.status(503).json({ error: 'POS terminal not configured' });
  }
```
RESEARCH.md flags this as a planner note: if cash/MOTO must work when the terminal is deliberately disabled, this top-of-function guard needs to become tender-aware. `isTerminalEnabled()` requires BOTH `HELCIM_API_TOKEN` and `HELCIM_DEVICE_CODE` (helcim.js:43-45); `isEnabled()` (helcim.js:39-41) requires only the API token and is what MOTO actually needs.

---

### `zoho-middleware/routes/pos.js` — `runConfirm` cash skip + MOTO verify branch (controller, money-path verify)

**Analog:** same file, `isManualConfirm`/`verifyManualCharge` (pos.js:1352-1364) for the tagged-error idiom; `zoho-middleware/routes/checkout.js:613-634` (MONEY-01/H2) for the actual captured-amount check to port.

**The exact tagged-error idiom to mirror** (pos.js:1344-1364 — this IS the sibling branch point; a `tender === 'moto'` branch must sit here):
```javascript
// pos.js:1344-1364
// F2 (45-09): a manual confirm ('manual-confirm' / no txn id) carries no proof a
// card charge actually happened. Booking a creditcard payment on trust risks
// phantom revenue... Before creating the invoice, resolve the actual approved
// transaction from Helcim; fail closed (no invoice, no payment) if it can't be
// positively verified...
var isManualConfirm = !body.transaction_id || body.transaction_id === 'manual-confirm';
var verifyManualCharge = (isManualConfirm && terminalApplied > 0)
    ? helcimLib.pollTerminalResult(refNumber).then(function (tr) {
        if (tr && tr.approved && tr.transactionId) {
          txnId = String(tr.transactionId); // real id → proof-of-charge + reconciliation fidelity
          return;
        }
        var mvErr = new Error('manual-confirm not verified');
        mvErr.__manualVerify = (tr && (tr.status === 'DECLINED' || tr.status === 'CANCELLED'))
          ? 'declined' : 'unverified';
        throw mvErr;
      })
    : Promise.resolve();

return verifyManualCharge.then(function () {
return zohoPost('/invoices', invoicePayload).then(function (invoiceData) {
  // ... invoice created, then paymentChain runs (see below)
```
**The MONEY-01/H2 captured-amount verify to port** (`zoho-middleware/routes/checkout.js:604-634`):
```javascript
// MONEY-01 / audit H2: verify the ACTUAL amount captured on the card (read back
// via helcimLib.getCardTransactionById) covers the invoice total BEFORE any
// side-effect... On short/unverifiable capture, throw a tagged error so the
// EXISTING catch block (below) reuses the hardened moneyPath.voidWithTimeout
// primitive — no second void path is introduced here (audit H5/L18).
if (transactionId && depositAmount > 0) {
  var CAPTURED_AMOUNT_TOLERANCE = 0.01;
  var captured;
  try {
    var capturedTxn = await helcimLib.getCardTransactionById(transactionId);
    captured = parseFloat(capturedTxn && capturedTxn.amount);
  } catch (captureReadErr) {
    log.error('[checkout] MONEY-01/H2: captured-amount readback failed for txn=' +
      transactionId + ': ' + captureReadErr.message);
    captureExceptionSafe(captureReadErr, {
      level: 'error',
      tags: { reqId: reqId || null, txnId: transactionId, invoiceId: soId || null }
    });
    captured = NaN;
  }
  if (!isFinite(captured) || captured <= 0 || captured < depositAmount - CAPTURED_AMOUNT_TOLERANCE) {
    log.error('[checkout] MONEY-01/H2: captured amount mismatch — txn=' + transactionId +
      ' captured=' + captured + ' recorded=' + depositAmount);
    var mismatchErr = new Error('Captured amount could not be verified against the recorded total');
    mismatchErr.isCapturedAmountMismatch = true;
    throw mismatchErr; // caught by the existing void-on-failure block
  }
  if (captured > depositAmount + CAPTURED_AMOUNT_TOLERANCE) {
    // Overpayment: not our bug — log for reconciliation and proceed.
    log.warn('[checkout] MONEY-01/H2: captured amount (' + captured +
      ') exceeds recorded total (' + depositAmount + ') for txn=' + transactionId +
      ' — overpayment, allowing through (reconciliation note only)');
  }
}
```
RESEARCH.md's port for pos.js (same tolerance constant, same tagged-error idiom `__motoVerifyFailed` mirroring `__manualVerify`/`__taxUnresolved`), inserted as a sibling to `verifyManualCharge`, gated on `body.tender === 'moto'`. `getCardTransactionById` signature (`zoho-middleware/lib/helcim.js:304-325`):
```javascript
/**
 * @param {string} id - Helcim transaction ID
 * @returns {Promise<{ status, transactionId, invoiceNumber, cardType, amount }>}
 */
function getCardTransactionById(id) {
  if (!HELCIM_API_TOKEN) { return Promise.reject(new Error('Helcim not configured')); }
  return axios.get(HELCIM_BASE_URL + '/card-transactions/' + encodeURIComponent(id), {
    headers: helcimHeaders(), timeout: 8000
  }).then(function (resp) {
    var txn = resp.data || {};
    return {
      status: (txn.status || '').toUpperCase(),
      transactionId: txn.transactionId || id,
      invoiceNumber: txn.invoiceNumber || '',
      cardType: txn.cardType || '',
      amount: txn.amount || 0
    };
  }).catch(function (err) { return Promise.reject(err); });
}
```

**Existing outer `.catch` void-on-failure block that any new tagged error (`__motoVerifyFailed`) will fall through to unmodified** (pos.js:1587-1668, key excerpt at 1619-1667):
```javascript
log.error('[pos/kiosk/sale/confirm] Error: ' + err.message);
var _txnIdForVoid = (body && body.transaction_id) ? String(body.transaction_id) : null;
if (_txnIdForVoid) {
  var _voidFailed = false;
  var _helcimForVoid = {
    voidTransaction: function (txnId) {
      return helcimLib.voidTransaction(txnId).catch(function (voidErr) {
        _voidFailed = true;
        // ... cache.set('sv:void-failure:'...) then re-throw so voidWithTimeout's
        //     CRITICAL log + mailer alert fires
        throw voidErr;
      });
    }
  };
  moneyPath.voidWithTimeout(_helcimForVoid, _txnIdForVoid, 0, {
    mailer: mailer, eventLog: eventLog, reqId: req.id
  }).then(function () {
    if (res.headersSent) return;
    var responseBody = {
      error: 'Payment was taken but could not be recorded. Please contact support.',
      payment_voided: !_voidFailed,
      voided_transaction_id: _txnIdForVoid
    };
    if (_voidFailed) responseBody.needs_manual_review = true;
    res.status(502).json(responseBody);
  });
} else {
  res.status(502).json({ error: 'Failed to create invoice. Please try again.' });
}
```
**IMPORTANT — cash must NOT set `body.transaction_id`** (client-side): if it does, this void block will try to void a non-existent Helcim txn on any downstream failure. Cash confirm should send no `transaction_id` (or an explicit non-Helcim marker distinct from `'manual-confirm'`) so `isManualConfirm`/`verifyManualCharge` and the void-on-failure block both correctly no-op for cash.

**Cash: skip `verifyManualCharge` entirely and book directly** (RESEARCH.md Pattern 1, mirrors pos.js:1382-1390 exactly):
```javascript
// Mirrors pos.js:1382-1390 (terminal payment) but no reference_number = txnId
// (there is no Helcim txn); use the kiosk reference_number instead.
if (cashApplied > 0) {
  return zohoPost('/customerpayments', {
    payment_mode: 'cash',
    amount: cashApplied,
    date: today,
    reference_number: refNumber,
    invoices: [{ invoice_id: invoiceId, amount_applied: cashApplied }],
    notes: 'Kiosk cash payment. Ref: ' + refNumber
  });
}
```
`cashApplied = grandTotal - gcApplied` — computed the SAME way `terminalApplied` already is (pos.js:1319: `var terminalApplied = Math.round((grandTotal - gcApplied) * 100) / 100;`) — do NOT carry over a `/sale`-time value (Pitfall 5 in RESEARCH.md: `/confirm` re-resolves discount/tax/gift-card independently, comment at pos.js:1248).

---

### `zoho-middleware/routes/pos.js` — customerpayment booking sites (booking side-effect, CRUD)

**Analog:** same file — the terminal payment block (pos.js:1382-1390) and the gift-card clearing-account payment block (pos.js:1393-1407), both inside the SAME `paymentChain` (pos.js:1377-1409):

```javascript
// Source: zoho-middleware/routes/pos.js:1377-1409
var paymentChain = Promise.resolve();
if (invoiceId) {
  paymentChain = zohoPost('/invoices/' + invoiceId + '/submit', {}).catch(function () {})
    .then(function () {
      // Payment 1: terminal portion — skip if gift card covers 100% (Pitfall 1 ordering)
      if (terminalApplied > 0) {
        return zohoPost('/customerpayments', {
          payment_mode: 'creditcard',
          amount: terminalApplied,
          date: today,
          reference_number: txnId,
          invoices: [{ invoice_id: invoiceId, amount_applied: terminalApplied }],
          notes: 'Kiosk POS terminal payment. Ref: ' + refNumber
        });
      }
    })
    .then(function () {
      // Payment 2: gift card portion — ONLY after terminal payment is recorded (Pitfall 1)
      if (gcApplied > 0 && gcCertNum) {
        return zohoPost('/customerpayments', {
          payment_mode: 'others',
          account_id: gcClearingAccount,
          amount: gcApplied,
          date: today,
          reference_number: gcCertNum,
          invoices: [{ invoice_id: invoiceId, amount_applied: gcApplied }],
          notes: 'Gift certificate ' + gcCertNum + ' redemption. Ref: ' + refNumber
        });
      }
    })
    .then(function () { /* Step A/B: gift-cert Apps Script redeem/issue/reload — unchanged */ })
    .catch(function (payErr) {
      log.error('[pos/kiosk/sale/confirm] Payment recording failed: ' + payErr.message);
      throw payErr; // D-12: propagate so the outer void path fires
    });
}
```
**Ordering note (Pitfall 1):** the cash `customerpayment` write must slot into the SAME chain at the "terminal portion" position (`if (terminalApplied > 0) { ... }` → becomes `if (tender === 'cash' && cashApplied > 0) { ...cash... } else if (terminalApplied > 0) { ...creditcard... }`), BEFORE the gift-card `others` payment, and BEFORE the Apps Script redeem/issue/reload last-step block — money-recording order must not change for the split-tender cases.

**MOTO's `customerpayment` booking stays `payment_mode: 'creditcard'`** (per RESEARCH.md A3/Q4 — Zoho's `payment_mode` enum has no CNP-specific value), with `reference_number: txnId` (the verified HelcimPay transaction id) and a distinguishing `notes` string, e.g. `'Kiosk phone-order (card-not-present) payment. Ref: ' + refNumber` — same shape as pos.js:1382-1390, only the `notes` text differs.

---

### `js/kiosk-core.js` — tender-selection UI + HelcimPay iframe mount (component, event-driven)

**Analog:** same file — the gift-card tender panel injection (kiosk-core.js:3046-3225) is the direct structural template for a new "choose tender" panel (cash / terminal / phone-card buttons) that sits at the SAME insertion point (between `kiosk-payment-items` and the payment footer), and `_kioskPushToTerminal` (kiosk-core.js:2844-3035) is what a new `_kioskGoCash`/`_kioskGoMoto` sibling function should mirror.

**Panel injection idiom to copy exactly** (kiosk-core.js:3050-3061):
```javascript
// Inject GC panel between kiosk-payment-items and payment footer
if (itemsEl && itemsEl.parentNode) {
  var gcPanelEl2 = document.getElementById('kiosk-gc-panel');
  if (!gcPanelEl2) {
    gcPanelEl2 = document.createElement('div');
    gcPanelEl2.id = 'kiosk-gc-panel';
    gcPanelEl2.style.cssText = 'margin:0.75rem 0;padding:0.75rem;border:1px solid #e0e0e0;border-radius:8px;background:#fafafa;';
    itemsEl.parentNode.insertBefore(gcPanelEl2, itemsEl.nextSibling);
  }
  gcPanelEl2.style.display = '';
  gcPanelEl2.innerHTML = [ /* string-concat button/input HTML, see kiosk-core.js:3061-3090 */ ].join('');
  // then getElementById() each control and wire .onclick handlers (kiosk-core.js:3092-3221)
}
```
**Scope this pattern requires available** (all set up earlier in the enclosing `kioskCollectPayment`-style function, kiosk-core.js:2622-2716): `amountEl`, `msgEl`, `spinnerEl`, `itemsEl`, `cancelBtn`, `totals`, `items`, `_kcEnv`, `standardSaleBody`/`saleBody`, `refNumber`, `mwUrl`, `confirmSale(txnId)` (kiosk-core.js:2752), `handleSaleResult(result)` (kiosk-core.js:2721).

**Auth pattern — every fetch in this file routes through `_kcMergeAuth`** (kiosk-core.js:101-115):
```javascript
// Shallow-merges the injected auth options (headers / credentials) into a
// fetch options object — the ONE real environment difference (x-device-token
// header on standalone kiosk vs. credentials:'include' on admin-embedded kiosk).
function _kcMergeAuth(opts) {
  opts = opts || {};
  var auth = _kcEnv.buildAuthOptions() || {};
  if (auth.headers) {
    opts.headers = opts.headers || {};
    for (var k in auth.headers) {
      if (Object.prototype.hasOwnProperty.call(auth.headers, k)) {
        opts.headers[k] = auth.headers[k];
      }
    }
  }
  if (typeof auth.credentials !== 'undefined') { opts.credentials = auth.credentials; }
  return opts;
}
```
New cash/MOTO fetches to `/api/kiosk/sale` and `/api/kiosk/sale/confirm` MUST use `fetch(url, _kcMergeAuth({...}))` exactly like `_kioskPushToTerminal` (kiosk-core.js:2907, 2814, 2882) — no direct `fetch(url, {...})` calls anywhere in this file.

**Cash change-due UI:** no existing analog in-repo (this is new client-only UX, per CONTEXT.md — "NOT sent to the server"). Build it as a sibling small panel using the SAME `style.cssText`/`innerHTML` string-concat idiom as the GC panel (kiosk-core.js:3057, 3061-3090) for visual/structural consistency — `tendered` input, live `change = tendered - total` display, "Complete Sale" button disabled while `tendered < total` (mirrors the GC panel's `gcConfirmBtn` disabled-until-valid pattern at kiosk-core.js:3181-3207, specifically the `if (applied2 <= 0) { ...error...; return; }` guard shape).

**ES5 constraint:** this file uses `var`, function expressions, string-concatenated HTML (`.join('')`), no arrow functions, no template literals — every new addition must match (CLAUDE.md: `js/kiosk-core.js` is concatenated ES5, never edit `js/main.js`/`.min.js` directly; run `npm run build` after any change to regenerate `js/kiosk-core.min.js`).

---

### `js/kiosk-core.js` — HelcimPay postMessage listener (event handler, event-driven)

**Analog:** `js/modules/12-checkout.js:59-68` (`extractHelcimTransactionId`) and `js/modules/12-checkout.js:1806-1836` (the listener) — this is an explicit PORT per RESEARCH.md, not a same-file pattern (kiosk-core.js has no existing HelcimPay code).

**`extractHelcimTransactionId` — port verbatim** (`js/modules/12-checkout.js:59-68`):
```javascript
function extractHelcimTransactionId(postMessageData) {
  var em = postMessageData && postMessageData.eventMessage;
  if (typeof em === 'string') { try { em = JSON.parse(em); } catch (e) { return ''; } }
  // Helcim wraps the response: { data: { hash, data: { transactionId, ... } }, status: 200 }
  var inner = em && em.data && em.data.data;
  if (inner && inner.transactionId) return String(inner.transactionId);
  // Fallback: flat structure (em.data.transactionId)
  var flat = em && em.data;
  return (flat && flat.transactionId) ? String(flat.transactionId) : '';
}
```
**Listener — port with origin check unchanged, adapt the completion callback for kiosk's `confirmSale`** (`js/modules/12-checkout.js:1806-1836`):
```javascript
window.addEventListener('message', function (event) {
  // H4: Validate postMessage origin — only accept from Helcim payment iframe
  if (event.origin !== 'https://secure.helcim.app' && event.origin !== 'https://myhelcim.com') {
    return;
  }
  var data = event.data || {};
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { return; } }
  var nameMatches = _helcimCheckoutToken && data.eventName === 'helcim-pay-js-' + _helcimCheckoutToken;
  if (!nameMatches) return;
  if (data.eventStatus === 'SUCCESS') {
    var txnId = extractHelcimTransactionId(data);
    if (typeof removeHelcimPayIframe === 'function') removeHelcimPayIframe();
    // kiosk adaptation: → confirmSale(txnId) with tender:'moto' in the body
  } else if (data.eventStatus === 'ABORTED') {
    // kiosk adaptation: → return to tender-selection panel
  }
});
```
**Iframe init call site to port** (`js/modules/12-checkout.js:1989-2000`, the in-process-vs-client-init tradeoff is moot here since RESEARCH.md's Pattern 2 has pos.js call `initializeCheckout` in-process during `/api/kiosk/sale` — the kiosk client does NOT call `/api/payment/initialize` directly; it gets `checkout_token` back in the `/sale` 202 response and calls `appendHelcimPayIframe` directly):
```javascript
// Source: js/modules/12-checkout.js:1989-2000 (public site's own /api/payment/initialize
// call — kiosk does NOT replicate this fetch; it already has checkout_token from /sale)
fetch(mwForPay + '/api/payment/initialize', { method: 'POST', ... })
  .then(function (r) { return r.json(); }).then(function (cfg) {
    if (!cfg || !cfg.checkoutToken) { throw new Error(...); }
    _helcimCheckoutToken = cfg.checkoutToken;
    _helcimSecretToken = cfg.secretToken || '';
    appendHelcimPayIframe(cfg.checkoutToken);
  });
// KIOSK equivalent: after /api/kiosk/sale 202 { moto:true, checkout_token, secret_token, reference },
// set _helcimCheckoutToken = result.data.checkout_token directly, then call
// appendHelcimPayIframe(result.data.checkout_token) — no second fetch needed.
```
`appendHelcimPayIframe`/`removeHelcimPayIframe` are GLOBAL functions injected by the `start.js` `<script>` tag itself (not defined in-repo) — confirmed live and working via `reservation.html`.

---

### `kiosk.html` — HelcimPay.js script tag + first CSP meta (config)

**Analog:** `reservation.html:19` (CSP meta) + `reservation.html:306` (HelcimPay script tag).

**Current kiosk.html `<head>` — confirmed NO CSP meta, NO inline `<script>` tags** (`kiosk.html:1-26`):
```html
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="robots" content="noindex">
  <title>In-Store POS | Steins &amp; Vines</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700&display=swap" rel="stylesheet">
  <link rel="icon" href="favicon.ico">
  <link rel="stylesheet" href="css/kiosk.min.css?v=mrm7o4b7">
  <script src="js/lib/constants.js"></script>
  <script src="js/lib/utils.js"></script>
  <script src="js/lib/auth.js"></script>
  <script src="js/lib/discount-match.js"></script>
  <script src="js/lib/recipe-grouping.js"></script>
  <script src="js/sheets-config.js"></script>
  <script src="js/admin-config.js"></script>
  <script src="js/vendor/qrcode.min.js"></script>
  <script src="https://accounts.google.com/gsi/client" async></script>
  <script src="js/kiosk-core.min.js?v=msf5gxir"></script>
  <script src="js/kiosk.min.js?v=mrm7o4b7"></script>
</head>
```
**Existing donor CSP (`reservation.html:19`, full string) — use as the DOMAIN INVENTORY, not a verbatim copy** (reservation.html's CSP includes many tracking/GTM domains kiosk.html does not need):
```
default-src 'self'; script-src 'self' 'unsafe-inline' https://www.google.com https://www.gstatic.com https://secure.helcim.app https://secure.myhelcim.com https://www.googletagmanager.com https://tracker.metricool.com https://connect.facebook.net https://www.googleadservices.com https://googleads.g.doubleclick.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://www.gstatic.com https://www.googletagmanager.com https://www.google-analytics.com https://www.facebook.com https://www.google.com https://www.google.ca https://googleads.g.doubleclick.net https://*.google-analytics.com; connect-src 'self' https://docs.google.com https://*.googleusercontent.com https://script.google.com https://sheets.googleapis.com https://www.googleapis.com https://svmiddleware-production.up.railway.app https://api.helcim.com https://secure.helcim.app https://secure.myhelcim.com https://www.google.com https://o4511012754358272.ingest.de.sentry.io https://www.google-analytics.com https://www.googletagmanager.com https://*.analytics.google.com https://tracker.metricool.com https://www.facebook.com https://googleads.g.doubleclick.net https://www.googleadservices.com https://*.google-analytics.com; frame-src 'self' https://secure.helcim.app https://secure.myhelcim.com https://www.google.com https://www.googletagmanager.com https://td.doubleclick.net
```
**RESEARCH.md's proposed kiosk-scoped domain inventory** (Pitfall 2/A1 — static-analysis derived, flagged for live staging verification before shipping): `accounts.google.com` (GSI sign-in — already loaded, kiosk.html:23), `svmiddleware-production.up.railway.app` (middleware), `script.google.com` (Apps Script — gift card/admin-config calls), `fonts.googleapis.com`/`fonts.gstatic.com` (fonts — kiosk.html:10-12), PLUS `secure.helcim.app`/`secure.myhelcim.com` for HelcimPay (script-src, connect-src, frame-src). Since kiosk.html has ZERO inline `<script>` tags (unlike `reservation.html`'s inline GTM snippet, line 5-9), `script-src` does NOT need `'unsafe-inline'` — a genuine hardening opportunity vs. the public-page CSPs.

**HelcimPay.js script tag to add** (`reservation.html:306`, add alongside the existing `<script>` block in kiosk.html's `<head>`):
```html
<script src="https://secure.helcim.app/helcim-pay/services/start.js"></script>
```

**docs/TRACKING.md rule this touches** (`docs/TRACKING.md:44-48`, rule 4 explicitly names kiosk.html as a documented no-CSP exception — this phase is the deliberate, first-time exception, not a violation):
```
4. `404.html` intentionally has a minimal CSP (no trackers). `admin.html`, `kiosk.html`,
   `brewpad.html`, `batch.html` are internal surfaces with no CSP — out of scope for measurement.
5. After any CSP change, verify in the browser console (look for "Refused to load /
   violates the following Content Security Policy") and in GTM's container diagnostics.
```
**FLAG for planner:** `docs/TRACKING.md` itself must be updated (per rule 12 of CLAUDE.md and the doc's own maintenance convention) once kiosk.html gets a CSP, since the doc currently lists it as a no-CSP internal surface.

---

## Shared Patterns

### Idempotency lock (applies to ALL 3 tenders, both `/sale` and `/confirm`)
**Source:** `zoho-middleware/lib/money-path.js:53-77` (`acquireIdempotencyLock`), called at `pos.js:336` (`/sale`) and `pos.js:1035` (`/confirm`).
**Apply to:** cash and MOTO tender branches — NO special-casing to skip the lock for cash (CONTEXT.md Pitfall 4: "a double-tap can't double-book an invoice/payment... a partial-booking must be handled with the same care as the card path"). The lock is tender-agnostic (keys on `idempotency_key`, not payment method) — zero new code needed here, just don't bypass it.
```javascript
// pos.js:334-348 (/sale) — identical shape at pos.js:1033-1052 (/confirm, confirmIdemKey)
if (idempotencyKey) {
  return moneyPath.acquireIdempotencyLock(cache, idempotencyKey, IDEMPOTENCY_KEY_TTL)
    .then(function (lockResult) {
      if (lockResult.status === 'replay') { return res.status(201).json(lockResult.cached); }
      if (lockResult.status === 'contention' || lockResult.status === 'failclosed') {
        return res.status(409).json({ error: 'Sale already in progress...' });
      }
      processSale(body, idempotencyKey, req, res, stageStart);
    });
}
```

### Void-on-failure (`voidWithTimeout`) — applies to MOTO only (cash has no charge to void)
**Source:** `zoho-middleware/lib/money-path.js:198-258`, already wired into `runConfirm`'s outer `.catch` (pos.js:1629-1664) for ANY `body.transaction_id` present on failure. Zero new code needed for MOTO IF the client sends `transaction_id` on the confirm call and cash does NOT.

### Captured-amount verification before booking (MOTO only — the core money-path control)
**Source:** `zoho-middleware/routes/checkout.js:604-642` (MONEY-01/H2). See the `runConfirm` section above for the exact excerpt to port.

### Auth tier (device-token, staff-present) — applies to cash + MOTO UI actions identically to terminal
**Source:** `zoho-middleware/lib/authTiers.js:47-63` — `KIOSK_ROUTES` is an EXPLICIT allowlist (not a prefix match); `/api/kiosk/sale` and `/api/kiosk/sale/confirm` are ALREADY in it (authTiers.js:56-57), so NO auth-tier change is needed — cash and MOTO both ride the existing `/sale`/`/confirm` endpoints per RESEARCH.md's "extend, don't fork" recommendation.
```javascript
// zoho-middleware/lib/authTiers.js:47-63 (excerpt)
var KIOSK_ROUTES = [
  // ...
  '/api/kiosk/sale',
  '/api/kiosk/sale/confirm',
  '/api/kiosk/sale/status',
  // ...
];
```

### `_kcMergeAuth` — every kiosk-core.js fetch (applies to all new cash/MOTO client fetches)
**Source:** `js/kiosk-core.js:101-115` (see full excerpt above). No new fetches in kiosk-core.js should ever call raw `fetch(url, {...})` — always `fetch(url, _kcMergeAuth({...}))`.

## Existing Tests That Pin Current Single-Tender Behavior (flag for planner — regression risk)

These tests assert on shapes that a naive cash/MOTO addition could silently break; read them before modifying `pos.js`:

| Test file | What it pins | Risk if cash/MOTO branch inserted carelessly |
|-----------|---------------|-----------------------------------------------|
| `zoho-middleware/__tests__/pos-money.test.js` | Baseline terminal-tender `/sale` → `/confirm` happy path, `payment_mode: 'creditcard'` booking shape | A `tender` field default MUST remain `'terminal'`/undefined-safe — existing tests send no `tender` field at all and must still hit the terminal branch unchanged |
| `zoho-middleware/__tests__/pos-money-defects.test.js` | CR-01 (confirm fallback seed), CR-02 (GC balance discriminated result), WR-03 (idempotency lock release on terminal failure) — see file header comment (lines 1-20) | The cash/MOTO branches must not change the CR-02 gift-card lookup ordering (still runs BEFORE any tender-specific booking) or the WR-03 lock-release-on-failure contract |
| `zoho-middleware/__tests__/pos-precharge-assertion.test.js` | Phase 67 pre-charge `client_grand_total` assertion runs BEFORE any Helcim charge (all tenders) — mock block clonable for new cash/MOTO test files (see file header, lines 1-27) | Cash/MOTO branches sit AFTER this assertion (pos.js:645-673) — do not move the tender branch earlier than the assertion |
| `zoho-middleware/__tests__/pos-gift-card.test.js` / `pos-giftcard.test.js` | Gift-card split-tender clamping + `payment_mode: 'others'` clearing-account booking ordering (Pitfall 1: terminal payment MUST be recorded before gift-card payment) | Cash-as-remainder-after-gift-card must preserve this exact ordering — cash payment write goes in the SAME chain position the terminal write currently occupies, still before the `others` gift-card write |
| `zoho-middleware/__tests__/checkout-captured-amount.test.js` | The MONEY-01/H2 RED/GREEN harness and mock shape (`getCardTransactionById` mock, `../lib/helcim` mock additions on top of `checkout-route.test.js`'s mock — see file header, lines 1-16) | Direct template for a new pos.js MOTO captured-amount test — clone this mock's `getCardTransactionById` addition into the pos.js test's `../lib/helcim` mock (pos.js test mocks currently do NOT include `getCardTransactionById` — see pos-money-defects.test.js:35-46) |
| `tests/frontend/kiosk-core-parity.test.js` | The `loadSurface('../../js/kiosk.js')` harness (lines 144-150) that boots kiosk-core.js through the real `js/kiosk.js` env injection, and `flushPromises()` (lines 126-137) for draining fetch `.then()` chains | New kiosk cash/MOTO frontend tests should use this SAME harness, not a bespoke DOM/fetch mock, to stay consistent with how gift-card panel tests already work (`kiosk-gift-card-mgmt.test.js`) |

## PCI / CSP Landmines Flagged for the Planner

1. **CSP-domain-omission (Pitfall 2, HIGH risk if skipped):** kiosk.html has NEVER had a CSP — the domain inventory in RESEARCH.md (Assumption A1) was derived via static `grep`, NOT a live browser trace. The exact incident CLAUDE.md rule 12 warns about (Meta pixel silently broken sitewide until 2026-07-22 from a missing CSP domain) is directly reproducible here if e.g. `script.google.com` (Apps Script gift-card lookups) or `accounts.google.com` (GSI sign-in) is omitted — kiosk sign-in or gift-card lookup would silently fail in production with no console visible to staff mid-sale. MANDATORY: verify on a live staging kiosk session (Network + Console tabs) before shipping, per RESEARCH.md's own recommendation.
2. **postMessage origin validation is non-negotiable and must be ported unchanged:** `event.origin !== 'https://secure.helcim.app' && event.origin !== 'https://myhelcim.com'` (12-checkout.js:1808) — a missing or loosened origin check on the kiosk port would allow a spoofed `SUCCESS` postMessage to fake a payment confirmation (STRIDE: Spoofing, per RESEARCH.md's Security Domain table).
3. **Trusting `body.transaction_id` for MOTO without the captured-amount verify is the single most dangerous shortcut available** — the existing `isManualConfirm` branch (pos.js:1352) trusts a real `transaction_id` WITHOUT re-verification, but ONLY because the terminal path's txn id was already server-fetched via `pollTerminalResult` (server-authoritative). A HelcimPay `transaction_id` arrives via CLIENT-side `postMessage` — it is the client's word. Any MOTO code path that reaches the invoice-creation step without first running the `getCardTransactionById` verify is a phantom-revenue bug by construction. This is Pitfall 1 in RESEARCH.md and is the top priority regression test to write.
4. **No card-number field anywhere, ever:** Option C (a card form in our own DOM) is explicitly REJECTED by CONTEXT.md and would drag the kiosk into PCI SAQ A-EP scope — this is a hard constraint on the tender-selection UI in `js/kiosk-core.js`, not just a preference. The MOTO button must lead ONLY to `appendHelcimPayIframe(...)`, never to a local `<input>` for card details.
5. **`KIOSK_PENDING_CHARGE_PREFIX` must NOT be written for MOTO** — that mechanism (pos.js:781-789) exists solely for the terminal's async webhook-approval race (`lib/reconcile.js`, D-13, terminal-specific per its own doc comment lines 1-36). Writing it for MOTO adds a reconcile-sweep code path with no failure mode it protects against, and risks the sweep firing a spurious void against a MOTO charge that already completed synchronously (Pitfall 3 in RESEARCH.md).

## Metadata

**Analog search scope:** `zoho-middleware/routes/pos.js`, `zoho-middleware/routes/checkout.js`, `zoho-middleware/lib/helcim.js`, `zoho-middleware/lib/money-path.js`, `zoho-middleware/lib/authTiers.js`, `js/kiosk-core.js`, `js/modules/12-checkout.js`, `kiosk.html`, `reservation.html`, `docs/TRACKING.md`, `zoho-middleware/__tests__/*.test.js`, `tests/frontend/*.test.js`
**Files scanned:** 12 source files read directly (targeted ranges, no full-file reads on the 2 largest: pos.js 3597 lines, kiosk-core.js 5069 lines — both read via grep-then-offset/limit); 6 test files' headers/mock blocks read for harness patterns
**Pattern extraction date:** 2026-08-12
