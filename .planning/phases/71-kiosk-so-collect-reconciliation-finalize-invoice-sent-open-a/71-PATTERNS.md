# Phase 71: Kiosk SO-Collect Reconciliation - Pattern Map

**Mapped:** 2026-08-14
**Files analyzed:** 3 modify targets (webhooks.js, checkout.js, +tests), 3 reference-only analogs read for pattern extraction
**Analogs found:** 3 / 3 (all in-repo, no external pattern needed)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `zoho-middleware/routes/webhooks.js` (`processCardTransactionResult`, collect-pending block, lines 191-233) | webhook handler / event-driven money-path | event-driven + CRUD (Zoho invoice/payment) | `zoho-middleware/routes/pos.js` lines 1550-1616 (`kiosk/sale/confirm`) and lines 2454-2500 (`kiosk/so-pay`) | role-match (same file, different route, same repo conventions) — **exact match for the fix shape** |
| `zoho-middleware/routes/checkout.js` line 693 (sibling bug, deposit-on-SO) | route handler / request-response | CRUD | `zoho-middleware/routes/checkout.js` line 690-691 (the `useInvoice` branch two lines above, in the SAME if/else) | exact — the fix pattern already exists 2 lines away in the same function |
| new/extended `zoho-middleware/lib/reconcile.js` helper (optional, for fail-closed reconcile record) | utility / event-driven backstop | event-driven | `zoho-middleware/lib/reconcile.js` (`reconcilePendingCharge`, `KIOSK_PENDING_CHARGE_PREFIX` convention) | role-match — same file, extend existing backstop convention rather than invent a new one |
| new test file `zoho-middleware/__tests__/collect-webhook-reconcile.test.js` (or extend `helcim-webhook.test.js`) | test | request-response (route) + unit (handler logic) | `zoho-middleware/__tests__/collect.test.js` (router-mock handler-extraction harness) + `zoho-middleware/__tests__/helcim-webhook.test.js` (supertest route harness + zoho-api mock shape) | exact — combine both harnesses |

## Pattern Assignments

### `zoho-middleware/routes/webhooks.js` — the BROKEN collect APPROVED path (lines 191-233)

**Analog:** `zoho-middleware/routes/pos.js` (two competing correct patterns, see below) and `zoho-middleware/routes/pos-recipe.js`

**The exact broken code today** (`webhooks.js:191-233`):
```javascript
// Collect-pending lookup: if this transaction was initiated by the collect
// flow, record payment in Zoho or clean up on decline.
if (invoiceNumber) {
  var pendingKey = C.CACHE_KEYS.COLLECT_PENDING_PREFIX + invoiceNumber;
  cache.get(pendingKey).then(function (raw) {
    if (!raw) return; // Not a collect-flow transaction
    var ctx;
    try { ctx = JSON.parse(raw); } catch { return; }

    if (status === 'APPROVED') {
      return zohoPost('/customerpayments', {
        customer_id: ctx.customer_id,
        payment_mode: (cardType && cardType.toLowerCase().indexOf('debit') !== -1) ? 'debitcard' : 'creditcard',
        amount: ctx.amount,
        date: new Date().toISOString().slice(0, 10),
        reference_number: transactionId,
        notes: 'In-store terminal payment. Helcim txn: ' + transactionId,
        salesorders_to_apply: [{             // <-- BUG: does not reconcile any invoice
          salesorder_id: ctx.salesorder_id,
          amount_applied: ctx.amount
        }]
      }).then(function () {
        eventLog.logEvent('collect.payment_recorded', {
          soId: ctx.salesorder_id,
          soNumber: ctx.salesorder_number,
          txnId: transactionId,
          amount: ctx.amount
        });
        return cache.del(pendingKey);
      });
      // ^ note: NO invoice creation/conversion/mark-sent call anywhere in this block.
    } else if (status === 'DECLINED') {
      /* ...cleanup... */
    }
  }).catch(function (err) {
    log.warn('[webhook/helcim] Collect-pending handling failed: ' + err.message);
    // ^ BUG: only log.warn — no fail-closed, no reconcile record, no captureExceptionSafe.
  });
}
```
Note: `ctx` (the pending context cached by `collect.js`) already has `salesorder_id`, `salesorder_number`, `customer_id`, `amount`, `idempotency_key`, `created_at` — everything needed for the fix is already in scope; no new lookups required.

**Candidate A — invoice-first pattern (from `pos-recipe.js:766-786`, also `pos.js:1551-1611`):**
```javascript
// pos-recipe.js:766-786
zohoPost('/invoices', invoicePayload)
  .then(function (invoiceData) {
    var invoice = invoiceData.invoice || {};
    var invoiceId = invoice.invoice_id || '';
    zohoPost('/invoices/' + invoiceId + '/submit', {}).catch(function () {}); // fire-and-forget: draft -> open/sent
    zohoPost('/customerpayments', {
      payment_mode: 'creditcard',
      amount: grandTotal,
      date: today,
      reference_number: txnId,
      invoices: [{ invoice_id: invoiceId, amount_applied: grandTotal }],   // <-- CORRECT shape
      notes: 'Kiosk recipe sale. Ref: ' + body.reference
    }).catch(function (payErr) {
      log.error('[pos-recipe/confirm] Payment recording failed: ' + payErr.message);
    });
  });
```
This pattern creates a NEW invoice from scratch — not applicable as-is to collect, because the collect flow's SO already exists and (per the debug doc) a draft `SO-` invoice may already exist. Using this pattern verbatim risks the **duplicate invoice** the phase explicitly must avoid. Use it only for the "submit = mark open/sent" idiom (`/invoices/{id}/submit`) and the `invoices:[{invoice_id, amount_applied}]` payment shape — not for invoice creation.

**Candidate B — SO-to-invoice convert pattern (from `pos.js:2459-2493`, route `kiosk/so-pay`):**
```javascript
// pos.js:2459-2467 — payment booked against the SO (SAME salesorders_to_apply bug shape)
zohoPost('/customerpayments', {
  customer_id: customerId,
  payment_mode: paymentMode,
  amount: balance,
  date: today,
  reference_number: txnId || soNumber,
  salesorders_to_apply: [{ salesorder_id: soId, amount_applied: balance }],
  notes: 'Kiosk SO payment. Terminal txn: ' + txnId
})
  .then(function () {
    // ...
    // pos.js:2481-2493 — THEN convert SO -> invoice and submit it
    var invoiceFromSoChain = zohoPost('/invoices/fromsalesorder?salesorder_id=' + soId, {})
      .then(function (invoiceData) {
        var invoice = (invoiceData && invoiceData.invoice) || {};
        var invoiceId = invoice.invoice_id || '';
        if (invoiceId) {
          zohoPost('/invoices/' + invoiceId + '/submit', {}).catch(function (submitErr) {
            log.warn('[kiosk/so-pay] Invoice submit failed (non-fatal): ' + submitErr.message);
          });
        }
        return invoiceId;
      })
      .catch(function (invErr) {
        log.error('[kiosk/so-pay] Invoice from SO failed (non-fatal): ' + invErr.message);
        return '';
      });
```
**IMPORTANT — unresolved per CONTEXT.md:** this is the pattern CONTEXT.md/the debug doc explicitly says NOT to touch without verifying correctness. It uses the SAME `salesorders_to_apply` shape as the bug, but sequences payment-first-then-convert. Whether Zoho Books actually carries an SO-level advance payment forward onto an invoice created via `/invoices/fromsalesorder` afterward is UNVERIFIED in this codebase (no test asserts it; the `.catch` on invoice-from-so treats invoice failure as "non-fatal — SO is paid" which implies the author believed the SO payment stands alone). **Do not copy this ordering as "proven correct."** The planner/executor should either (a) treat `invoices:[{invoice_id, amount_applied}]` (Candidate A shape) as the only verified-correct payment shape and always convert-invoice-THEN-apply-to-invoice-id, or (b) if choosing to mirror pos.js:2465's ordering, add an explicit test asserting the resulting invoice is `paid`/balance 0 (not just "call succeeded") before relying on it. RESEARCH/CONTEXT already flags this file as out-of-scope-to-modify (verification only), but the *pattern itself* is not certified safe to copy into the new collect fix.

**Recommended composite fix shape for `webhooks.js`'s collect block** (convert-then-apply, using the invoice-id we control, avoiding both the SO-only bug AND the unverified pos.js:2465 ordering):
```javascript
// 1. Convert (or reuse existing draft) SO -> invoice, mark it sent/open
zohoPost('/invoices/fromsalesorder?salesorder_id=' + ctx.salesorder_id, {})
  .then(function (invoiceData) {
    var invoice = (invoiceData && invoiceData.invoice) || {};
    var invoiceId = invoice.invoice_id || '';
    return zohoPost('/invoices/' + invoiceId + '/submit', {}).then(function () {
      return invoiceId;
    });
  })
  // 2. Apply the payment to the resulting invoice_id (verified-correct shape)
  .then(function (invoiceId) {
    return zohoPost('/customerpayments', {
      customer_id: ctx.customer_id,
      payment_mode: (cardType && cardType.toLowerCase().indexOf('debit') !== -1) ? 'debitcard' : 'creditcard',
      amount: ctx.amount,
      date: new Date().toISOString().slice(0, 10),
      reference_number: transactionId,
      invoices: [{ invoice_id: invoiceId, amount_applied: ctx.amount }],
      notes: 'In-store terminal payment. Helcim txn: ' + transactionId
    });
  });
```
**Open question the planner must resolve (flagged, not decided here):** does `/invoices/fromsalesorder` error if an invoice already exists for that SO (the "draft invoice already exists" case from the debug doc), or does it return the existing draft invoice_id idempotently? This determines whether a pre-check (`GET /salesorders/{id}` for a linked `invoice_id`, or `GET /invoices?reference_number=SO-xxx`) is needed before calling convert, to avoid creating a DUPLICATE invoice. No existing code path in this repo currently guards against that — it must be researched/tested fresh, not copied from an analog.

**Error handling pattern to replace `.catch(log.warn)` — fail-closed with reconcile record:**
No exact analog exists for "write a reconcile record on a post-charge Zoho failure." Closest is `lib/reconcile.js`'s `KIOSK_PENDING_CHARGE_PREFIX` convention (cache-key based backstop, read by `sweepPendingCharges` every 5 min in `server.js`). Extend that module/convention rather than invent a new one:
```javascript
// lib/reconcile.js — existing convention to extend (lines 1-30 header, key naming)
// Pending cache key: KIOSK_PENDING_CHARGE_PREFIX + invoiceNumber
// constants.js:51  KIOSK_PENDING_CHARGE_PREFIX: 'kiosk:pending-charge:'
// constants.js:46-47  COLLECT_IDEM_PREFIX: 'collect:idem:', COLLECT_PENDING_PREFIX: 'collect:pending:'
```
`lib/reconcile.js` module.exports today is only `{ reconcilePendingCharge, sweepPendingCharges }` (line 464-467) — there is no existing "record orphan/write failure" export to call from webhooks.js. The phase will likely need a new small export (e.g. `recordCollectReconcileFailure(ctx, transactionId, err)`) following the same cache-key-prefix + `eventLog.logEvent` + `captureExceptionSafe` idiom already used elsewhere in webhooks.js (see `captureExceptionSafe` import at `webhooks.js:12`, used at line ~249 for the existing kiosk reconcile path).

---

### `zoho-middleware/routes/checkout.js` line 680-704 — sibling deposit bug

**Analog:** the fix pattern is 2 lines away in the SAME if/else, already correct for the `useInvoice` branch:
```javascript
// checkout.js:679-704 (exact context)
if (transactionId && depositAmount > 0 && soId) {
  try {
    var paymentBody = {
      customer_id: customerId,
      payment_mode: 'creditcard',
      amount: depositAmount,
      date: new Date().toISOString().slice(0, 10),
      reference_number: transactionId,
      notes: 'Online payment for ' + (useInvoice ? 'Invoice' : 'Sales Order') + ' ' + (soNumber || soId)
    };
    if (useInvoice) {
      paymentBody.invoices = [{ invoice_id: soId, amount_applied: depositAmount }];   // CORRECT
    } else {
      paymentBody.salesorders_to_apply = [{ salesorder_id: soId, amount_applied: depositAmount }]; // BUG (line 693)
    }
    await zohoPost('/customerpayments', paymentBody);
    log.info('[checkout] Payment recorded for ' + (useInvoice ? 'INV' : 'SO') + '=' + soNumber);
  } catch (payErr) {
    log.error('[checkout] Payment recording failed (non-fatal): ' + payErr.message);
    captureExceptionSafe(payErr, { level: 'error', tags: { reqId: reqId || null, txnId: transactionId, invoiceId: soId || null } });
  }
}
```
Note this block already has good error handling (`captureExceptionSafe` + `log.error`) — the ONLY defect is the `else` branch's `salesorders_to_apply`. Same fix shape as webhooks.js: convert the SO to an invoice (or determine `useInvoice` should simply always be true / the SO branch should call the same `/invoices/fromsalesorder` convert-then-apply as recommended above) before booking the payment. This is a smaller, more contained fix than webhooks.js since the try/catch/observability already exists — only the money-application shape and the missing invoice-finalize step need fixing. Async/await context here (this function is `async`, unlike webhooks.js's promise-chain style) — keep that style consistent with the surrounding function when fixing.

---

### New test file — harness to clone

**Analog 1 (handler extraction from mocked Router):** `zoho-middleware/__tests__/collect.test.js` lines 1-90:
```javascript
jest.mock('../lib/zoho-api', function () { return { zohoGet: jest.fn(), zohoPost: jest.fn(), zohoPut: jest.fn() }; });
jest.mock('../lib/cache', function () { return { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK'), del: jest.fn().mockResolvedValue(1), isConnected: jest.fn().mockReturnValue(true) }; });
jest.mock('../lib/eventLog', function () { return { logEvent: jest.fn() }; });
jest.mock('../lib/logger', function () { return { info: jest.fn(), warn: jest.fn(), error: jest.fn() }; });
jest.mock('express', function () {
  var router = { get: jest.fn(), post: jest.fn() };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});
var express = require('express');
require('../routes/collect');           // <-- swap for '../routes/webhooks'
handler = express.Router().post.mock.calls[0][1];   // may need calls[N] if webhooks.js registers multiple routes — verify index
function flushPromises() { return new Promise(function (resolve) { setImmediate(resolve); }); }
```

**Analog 2 (supertest route-level harness, real signature verification path):** `zoho-middleware/__tests__/helcim-webhook.test.js` lines 190-315 — mocks `../lib/helcim`, `../lib/zohoAuth`, `../lib/validateEnv`, `../lib/checkRedis`, `../lib/checkMailer`, `../lib/brewpad-integration`, `node-cron`, `@sentry/node`, `../lib/cache`, `../lib/eventLog`, `../lib/logger`, then `require('../server')` and drives via `supertest`. Since `processCardTransactionResult` runs fire-and-forget AFTER `res.status(200).json(...)` (webhooks.js:49), tests asserting the Zoho calls it makes must use `flushPromises()`/`setImmediate` after the supertest request resolves, not just assert on the HTTP response — the 200 response happens before any Zoho work starts. No current test in this file exercises the collect-pending block's Zoho calls at all (confirmed via grep — zero matches for `salesorders_to_apply`, `customerpayments`, `COLLECT_PENDING` in `helcim-webhook.test.js`), so **no test currently pins the broken behavior** — safe to add new assertions without needing to first delete/rewrite a pinned-wrong test.

**Analog 3 (fail-closed / declined-transaction cleanup assertions style):** `pos-money-defects.test.js` `WR-03` describe block (lines 517-556) — pattern for asserting cache cleanup (`releaseLock`/`del`) happens on failure, and F2 block (590-683) for asserting terminal-verification-before-booking. Use this style for the new "simulated finalize failure after charge -> reconcile record written, no silent draft" test.

## Shared Patterns

### Payment-to-invoice application (the core fix)
**Source:** `pos-recipe.js:777-783`, `pos.js:1576/1592/1611`
**Apply to:** `webhooks.js` collect block, `checkout.js:693`
```javascript
invoices: [{ invoice_id: invoiceId, amount_applied: amount }]
```
Never `salesorders_to_apply` for a payment intended to close out a bookable sale.

### Invoice submit / mark-sent idiom
**Source:** `pos.js:1563` (`zohoPost('/invoices/' + invoiceId + '/submit', {}).catch(function () {})`), `pos-recipe.js:774`, `pos.js:2488-2490`
**Apply to:** any newly-converted or newly-created invoice before applying a payment
```javascript
zohoPost('/invoices/' + invoiceId + '/submit', {})
```
This is the repo's only "mark sent/open" idiom found — there is no separate `/invoices/{id}/status/sent` call pattern in this codebase; `submit` is the verb used everywhere. Fire-and-forget (`.catch(function(){})`) is used when non-critical (pos.js:1563); logged-but-non-fatal (`.catch(function(submitErr){ log.warn(...) })`) is used when it matters more (pos.js:2488-2490) — the fail-closed decision in this phase means the collect path should NOT silently swallow a submit failure; use the logged variant at minimum, and treat submit failure as blocking the payment-apply step (don't apply a payment to a still-draft invoice).

### SO-to-invoice conversion
**Source:** `pos.js:2482` — `zohoPost('/invoices/fromsalesorder?salesorder_id=' + soId, {})`
**Apply to:** `webhooks.js` collect block (primary fix target)
No existing pre-check for "does an invoice already exist for this SO" was found anywhere in the repo — this is new territory, not copyable from an analog. Flag for planner: needs its own design/test, referencing the debug doc's note that a draft `SO-`-prefixed invoice may already exist for the SO in question.

### Reconcile / fail-closed backstop record
**Source:** `zoho-middleware/lib/reconcile.js` (header comment lines 1-30, `KIOSK_PENDING_CHARGE_PREFIX` convention), `zoho-middleware/lib/constants.js:46-51` (`COLLECT_IDEM_PREFIX`, `COLLECT_PENDING_PREFIX`, `KIOSK_PENDING_CHARGE_PREFIX`)
**Apply to:** `webhooks.js` collect block's `.catch()` (replacing bare `log.warn`)
`reconcile.js` currently exports only `reconcilePendingCharge` and `sweepPendingCharges` (lines 464-467) — both keyed to `KIOSK_PENDING_CHARGE_PREFIX`, not `COLLECT_*`. There is no existing "write a reconcile record for a collect-flow failure" function to call; one must be added, following the same prefix + `eventLog.logEvent` + `captureExceptionSafe` idiom already present in `webhooks.js` (import at line 12, used near line 248-249 for the existing kiosk-charge reconcile path).

### captureExceptionSafe on money-path errors
**Source:** `checkout.js:699-702`, `webhooks.js:12` (import) + line ~249 (usage)
**Apply to:** the new fail-closed `.catch()` blocks in both `webhooks.js` collect and `checkout.js:693` fix
```javascript
captureExceptionSafe(err, { level: 'error', tags: { /* soId, txnId, invoiceId as available */ } });
```

## No Analog Found

| File/Concern | Role | Data Flow | Reason |
|---|---|---|---|
| "Does an invoice already exist for this SO" pre-check | utility | CRUD (read-then-branch) | No existing code in this repo checks for an existing invoice before calling `/invoices/fromsalesorder`; must be designed fresh per the debug doc's "don't duplicate the invoice" constraint |
| Collect-flow-specific reconcile-record writer | utility | event-driven | `reconcile.js` only has kiosk-pending-charge (`KIOSK_PENDING_CHARGE_PREFIX`) backstop; no `COLLECT_*`-keyed equivalent exists yet — extend, don't copy verbatim |
| pos.js:2465-2493 "payment-then-convert" ordering as a *proven-correct* pattern | — | — | Explicitly unverified per CONTEXT.md; do not copy as certified-safe (see Candidate B discussion above) |

## Metadata

**Analog search scope:** `zoho-middleware/routes/` (webhooks.js, collect.js, checkout.js, pos.js, pos-recipe.js), `zoho-middleware/lib/reconcile.js`, `zoho-middleware/lib/constants.js`, `zoho-middleware/__tests__/` (collect.test.js, helcim-webhook.test.js, pos-money-defects.test.js — filenames of siblings not opened: batch-reconcile-status, checkout-captured-amount, checkout-fallback-email, checkout-route, checkout, pos-money, pos-sale-autoreconcile, reconcile-wr02-wr07, reconcile, webhook-wr07)
**Files scanned/read (this session):** webhooks.js (1-60, 150-249), collect.js (full, 152 lines), pos.js (1530-1659, 2440-2509), checkout.js (640-739), pos-recipe.js (730-819), collect.test.js (1-90), helcim-webhook.test.js (grep + 248-315), reconcile.js (1-40, 464-467), constants.js (grep for CACHE_KEYS)
**Pattern extraction date:** 2026-08-14
