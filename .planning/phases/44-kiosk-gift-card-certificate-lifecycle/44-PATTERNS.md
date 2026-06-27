# Phase 44: Kiosk Gift Card / Certificate Lifecycle — Pattern Map

**Mapped:** 2026-06-27
**Files analyzed:** 5 (2 new, 3 modified)
**Analogs found:** 5 / 5

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `zoho-middleware/routes/gift-cards.js` | route | request-response | `zoho-middleware/routes/pos.js` | exact |
| `zoho-middleware/routes/pos.js` (modify) | route | request-response | self (in-place extension) | self |
| `apps-script/adminApi.gs` (modify) | Apps Script CRUD | event-driven | self (`createBatch`, `acquireScriptLock`, server_token dispatch) | self |
| `js/kiosk.js` (modify) | browser UI | event-driven | self (`kioskShowCustomItemModal`, payment view) | self |
| `js/admin.js` (modify) | browser UI | event-driven | self (`kioskShowAdminCustomItemModal`, `openModal`/`closeModal`) | self |

---

## Pattern Assignments

---

### `zoho-middleware/routes/gift-cards.js` (NEW — route, request-response)

**Analog:** `zoho-middleware/routes/pos.js`

---

#### Imports pattern (`pos.js` lines 1–18)

```javascript
var express = require('express');
var axios = require('axios');
var zohoApi = require('../lib/zoho-api');
var cache = require('../lib/cache');
var log = require('../lib/logger');
var eventLog = require('../lib/eventLog');
var C = require('../lib/constants');

var zohoGet = zohoApi.zohoGet;
var zohoPost = zohoApi.zohoPost;
var zohoPut = zohoApi.zohoPut;

var router = express.Router();
```

> Note: `gift-cards.js` uses `zohoPost` (not `zohoGet`/`zohoPut`) and `axios` (for the Apps Script POST call). It does NOT need `helcimLib`, `mailer`, `ledger`, `brewpadIntegration`, or `discountMatch`.

---

#### Env-guard pattern (new in `gift-cards.js` — fail-closed guard at route entry)

Modeled after the `KIOSK_CONTACT_ID` / `HELCIM_DEVICE_CODE` guard checks in `pos.js`.

```javascript
// Fail-closed: refuse all gift card issue/redeem until configured
if (!process.env.KIOSK_GIFT_CARD_ITEM_ID) {
  return res.status(503).json({
    error: 'Gift card accounting not configured (KIOSK_GIFT_CARD_ITEM_ID missing)'
  });
}
```

Apply at the top of the `POST /api/kiosk/gift-card/issue` and `POST /api/kiosk/gift-card/redeem` handlers only. `lookup` and `reload` do NOT need this guard.

---

#### Idempotency pattern (`pos.js` lines 234–251)

```javascript
var idempotencyKey = (body && typeof body.idempotency_key === 'string' && body.idempotency_key)
  ? C.CACHE_KEYS.KIOSK_IDEM_PREFIX + body.idempotency_key.slice(0, 128)
  : null;

if (idempotencyKey) {
  return cache.get(idempotencyKey).then(function (cached) {
    if (cached) {
      log.info('[pos/kiosk/sale] Idempotent replay: ' + idempotencyKey);
      return res.status(201).json(cached);
    }
    processSale(body, idempotencyKey, req, res);
  }).catch(function () {
    processSale(body, idempotencyKey, req, res);
  });
}
```

> For `gift-cards.js` the Redis idempotency key is supplemented by the Apps Script `last_tx_ref` column (double-spend guard). Use the same `C.CACHE_KEYS.KIOSK_IDEM_PREFIX` prefix.

---

#### Server-to-server Apps Script GET pattern (`pos.js` lines 1705–1727)

```javascript
var appsScriptUrl = process.env.APPS_SCRIPT_URL;
var serverToken = process.env.APPS_SCRIPT_SERVER_TOKEN;

// CRITICAL: use server_token param (not token) — adminApi.gs reads e.parameter.server_token (~line 95)
axios.get(appsScriptUrl, {
  params: { action: 'lookup_gift_card', server_token: serverToken, cert_number: certNumber },
  timeout: 12000
}).then(function (resp) {
  var respData = resp.data || {};
  if (!respData.ok) {
    // handle error
  }
  // use respData.data
}).catch(function (err) {
  log.warn('[gift-cards/lookup] Apps Script call failed: ' + err.message);
});
```

---

#### Server-to-server Apps Script POST pattern (`pos.js` lines 2095–2117)

```javascript
var appsScriptUrl = process.env.APPS_SCRIPT_URL;
var appsScriptToken = process.env.APPS_SCRIPT_SERVER_TOKEN;

var updatePayload = {
  action: 'issue_gift_card',          // or redeem_gift_card, reload_gift_card, void_gift_card
  server_token: appsScriptToken,
  // ... payload fields
};

return axios.post(appsScriptUrl, JSON.stringify(updatePayload), {
  headers: { 'Content-Type': 'application/json' },
  timeout: 12000,
  maxRedirects: 5
}).then(function (resp) {
  var result = resp.data || {};
  if (!result.ok) {
    // handle non-ok response
  }
  // use result
});
```

> This is the canonical pattern for all POST writes to Apps Script from `gift-cards.js`. Use for `issue_gift_card`, `redeem_gift_card`, `reload_gift_card`, and `void_gift_card`.

---

#### zohoPost pattern for invoice + payment (`pos.js` lines 626–646)

```javascript
return zohoPost('/invoices', invoicePayload).then(function (invoiceData) {
  var invoice = invoiceData.invoice || {};
  var invoiceId = invoice.invoice_id || '';
  var invoiceNumber = invoice.invoice_number || '';
  log.info('[pos/kiosk/sale/confirm] Invoice created: ' + invoiceNumber);

  return zohoPost('/invoices/' + invoiceId + '/submit', {}).catch(function () {})
    .then(function () {
      return zohoPost('/customerpayments', {
        payment_mode: 'creditcard',         // or 'others' for gift card tender portion
        amount: grandTotal,
        date: today,
        reference_number: txnId,
        invoices: [{ invoice_id: invoiceId, amount_applied: grandTotal }],
        notes: 'Kiosk POS payment. Ref: ' + refNumber
      });
    }).catch(function (payErr) {
      log.error('[pos/kiosk/sale/confirm] Payment recording failed: ' + payErr.message);
    });
});
```

> For gift card SALE: `payment_mode: 'creditcard'` (terminal was used), `KIOSK_GIFT_CARD_ITEM_ID` as `item_id`, zero-tax line item.
> For gift card REDEMPTION portion: second `zohoPost('/customerpayments', ...)` with `payment_mode: 'others'`, `reference_number: certNumber`.

---

#### Error handling pattern (`pos.js` lines 669–672)

```javascript
}).catch(function (err) {
  log.error('[pos/kiosk/sale/confirm] Error: ' + err.message);
  res.status(502).json({ error: 'Failed to create invoice. Please try again.' });
});
```

---

#### Route export (all route files)

```javascript
module.exports = router;
```

---

#### Server.js mount location (to be added to `server.js`)

Copy the pattern from `server.js` lines 443–450:

```javascript
app.use('/', require('./routes/gift-cards'));
```

Add rate-limiter entries for the two money-path routes, mirroring lines 401–406:

```javascript
app.use('/api/kiosk/gift-card/issue',  paymentLimiter);
app.use('/api/kiosk/gift-card/redeem', paymentLimiter);
```

---

### `zoho-middleware/routes/pos.js` (MODIFY — split-tender extension)

**Analog:** self — in-place extension of existing functions

---

#### `processSaleWithPrices` injection point (`pos.js` lines 397–433)

The new `gift_card` field from `body` is read after the `grandTotal` guard and before the `refNumber` derivation. Insert at approximately line 408 (after line 406 `if grandTotal > 10000`):

```javascript
// --- Gift card split-tender (Phase 44) ---
var gift_amount = 0;
var gift_cert_number = '';
if (body.gift_card && body.gift_card.cert_number) {
  // D-05: amount_applied is clamped to grandTotal server-side; client cannot over-apply
  gift_amount = Math.min(
    Math.max(Number(body.gift_card.amount_applied) || 0, 0),
    grandTotal
  );
  gift_cert_number = String(body.gift_card.cert_number).trim().toUpperCase().slice(0, 20);
}
var terminal_amount = Math.round((grandTotal - gift_amount) * 100) / 100;
```

Then replace the `helcimLib.terminalPurchase(grandTotal, refNumber)` call (line 414) with:

```javascript
if (terminal_amount > 0) {
  helcimLib.terminalPurchase(terminal_amount, refNumber)
    .then(function () { /* existing response body */ });
} else {
  // Gift card covers 100% — skip terminal entirely
  // (treat like the existing manual-confirm path)
  var responseBody = { pending: false, gift_card_only: true, reference: refNumber };
  // ... cache write + res.status(202) as before
}
```

---

#### Confirm handler injection point (`pos.js` lines 584–666)

The confirm handler must:
1. Re-clamp `gift_amount` to re-computed `grandTotal` (Pitfall 3 guard)
2. Post TWO `customerpayments` when `body.gift_card` is present
3. Call Apps Script `redeem_gift_card` as the **LAST step** (after all Zoho calls)

Existing confirm flow (lines 626–666) becomes:

```javascript
return zohoPost('/invoices', invoicePayload).then(function (invoiceData) {
  var invoice = invoiceData.invoice || {};
  var invoiceId = invoice.invoice_id || '';

  // --- Phase 44 split tender ---
  var gcApplied = 0;
  var gcCertNum = '';
  if (body.gift_card && body.gift_card.cert_number && invoiceId) {
    // Re-clamp to re-computed grandTotal (Pitfall 3)
    gcApplied = Math.min(
      Math.max(Number(body.gift_card.amount_applied) || 0, 0),
      grandTotal
    );
    gcCertNum = String(body.gift_card.cert_number).trim().toUpperCase().slice(0, 20);
  }
  var terminalApplied = Math.round((grandTotal - gcApplied) * 100) / 100;

  var paymentChain = Promise.resolve();
  if (invoiceId) {
    paymentChain = zohoPost('/invoices/' + invoiceId + '/submit', {}).catch(function () {})
      .then(function () {
        // Payment 1: terminal portion (skip if gift card covers everything)
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
        // Payment 2: gift card portion (ONLY after terminal payment recorded)
        if (gcApplied > 0 && gcCertNum) {
          return zohoPost('/customerpayments', {
            customer_id: process.env.KIOSK_CONTACT_ID,
            payment_mode: 'others',
            amount: gcApplied,
            date: today,
            reference_number: gcCertNum,
            invoices: [{ invoice_id: invoiceId, amount_applied: gcApplied }],
            notes: 'Gift certificate ' + gcCertNum + ' redemption. Ref: ' + refNumber
          });
        }
      })
      .then(function () {
        // LAST STEP: decrement Apps Script balance (Pitfall 1 — must be after all Zoho calls)
        if (gcApplied > 0 && gcCertNum) {
          var asUrl = process.env.APPS_SCRIPT_URL;
          var asToken = process.env.APPS_SCRIPT_SERVER_TOKEN;
          if (asUrl && asToken) {
            return axios.post(asUrl, JSON.stringify({
              action: 'redeem_gift_card',
              server_token: asToken,
              cert_number: gcCertNum,
              amount: gcApplied,
              transaction_ref: refNumber
            }), { headers: { 'Content-Type': 'application/json' }, timeout: 12000, maxRedirects: 5 })
            .then(function (resp) {
              var r = resp.data || {};
              if (!r.ok) {
                log.error('[pos/kiosk/sale/confirm] CRITICAL: Gift card balance decrement failed for ' + gcCertNum + ': ' + (r.error || 'unknown'));
                // Invoice is already paid — log CRITICAL but return 201 (Pitfall 1 accepted failure mode)
              }
            })
            .catch(function (asErr) {
              log.error('[pos/kiosk/sale/confirm] CRITICAL: Apps Script redeem_gift_card unreachable: ' + asErr.message);
            });
          }
        }
      })
      .catch(function (payErr) {
        log.error('[pos/kiosk/sale/confirm] Payment recording failed: ' + payErr.message);
      });
  }

  return paymentChain.then(function () {
    // ... existing cache.del, ledger.decrementStock, eventLog, brewpadIntegration, res.status(201)
  });
});
```

---

#### Void-on-failure pattern to reuse (`pos.js` lines 1285–1333)

```javascript
helcimLib.voidTransaction(txnId)
  .then(function () {
    log.info('[kiosk/so-pay] Voided txn=' + txnId + ' after payment recording failure');
  })
  .catch(function (voidErr) {
    log.error('[kiosk/so-pay] CRITICAL: Void failed for txn=' + txnId + ': ' + voidErr.message);
    var failRecord = {
      txnId: txnId, amount: balance,
      timestamp: new Date().toISOString(),
      error: voidErr.message, needs_manual_review: true
    };
    cache.set('sv:void-failure:' + Date.now(), failRecord, 60 * 60 * 24 * 30).catch(function () {});
    mailer.sendVoidFailureAlert({ txnId, amount, error, timestamp }).catch(function () {});
  })
  .then(function () {
    if (res.headersSent) return;
    res.status(502).json({
      error: 'Payment was taken but could not be recorded. Please contact support.',
      payment_voided: true,
      voided_transaction_id: txnId
    });
  });
```

> The gift-cards split-tender in `processSaleWithPrices` must call `helcimLib.voidTransaction` in the same catch chain if Zoho invoice creation fails after the terminal charge. The balance decrement happens AFTER all Zoho calls, so a void at any Zoho step leaves the balance untouched (correct).

---

### `apps-script/adminApi.gs` (MODIFY — add GiftCards sheet + 6 actions)

**Analog:** self — extend existing sheet-name constants, server_token dispatch, and batch CRUD helpers

---

#### Sheet-name constant pattern (`adminApi.gs` lines 46–58)

```javascript
var GIFT_CARDS_SHEET_NAME = 'GiftCards';   // ADD THIS — mirrors BATCHES_SHEET_NAME pattern
```

Add at the end of the sheet-name constants block (after `RECIPE_INGREDIENTS_SHEET_NAME` at line 58).

---

#### Server-token dispatch pattern (`adminApi.gs` lines 219–265)

All six new actions are server-token authenticated (no Google OAuth). Add to the `if (payload.server_token)` block (after the existing `if (action === 'get_recipe')` block at line ~264):

```javascript
if (action === 'issue_gift_card') {
  return _jsonResponse(issueGiftCard(payload));
}
if (action === 'lookup_gift_card') {
  // lookup is a GET in the architecture but Apps Script dispatches all writes via POST
  return _jsonResponse(lookupGiftCard(payload));
}
if (action === 'redeem_gift_card') {
  return _jsonResponse(redeemGiftCard(payload));
}
if (action === 'reload_gift_card') {
  return _jsonResponse(reloadGiftCard(payload));
}
if (action === 'void_gift_card') {
  return _jsonResponse(voidGiftCard(payload));
}
if (action === 'update_gift_card_invoice') {
  return _jsonResponse(updateGiftCardInvoice(payload));
}
```

> The middleware calls Apps Script via `axios.post` for ALL actions (even lookups), so all six go in the `server_token` POST dispatch block. The GET query-param pattern (line 1710) is used for batch listing only.

---

#### `acquireScriptLock` (reuse as-is, `adminApi.gs` lines 1130–1134)

```javascript
function acquireScriptLock(timeoutMs) {
  var lock = LockService.getScriptLock();
  lock.waitLock(timeoutMs || 10000);
  return lock;
}
```

Every balance-modifying handler (`issueGiftCard`, `redeemGiftCard`, `reloadGiftCard`, `voidGiftCard`) MUST open with `var lock = acquireScriptLock(15000)` and close the `try/finally` with `lock.releaseLock()`. Copy the exact `try { ... } finally { lock.releaseLock(); }` structure from `createBatch` (lines 1986–2023).

---

#### `generateNextId` (reuse as-is, `adminApi.gs` lines 1136–1158)

```javascript
function generateNextId(sheetName, prefix, padLength) {
  if (!padLength) padLength = 6;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() <= 1) {
    var first = '';
    for (var p = 0; p < padLength; p++) first += '0';
    first = first.slice(0, padLength - 1) + '1';
    return prefix + first;
  }
  var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  var maxNum = 0;
  for (var i = 0; i < ids.length; i++) {
    var id = String(ids[i][0] || '');
    if (id.indexOf(prefix) === 0) {
      var num = parseInt(id.substring(prefix.length), 10);
      if (num > maxNum) maxNum = num;
    }
  }
  var next = String(maxNum + 1);
  while (next.length < padLength) next = '0' + next;
  return prefix + next;
}
```

Usage: `generateNextId(GIFT_CARDS_SHEET_NAME, 'GC-', 6)` → returns `'GC-000001'`, `'GC-000042'`, etc.

---

#### `findRowById` (reuse as-is, `adminApi.gs` lines 1264–1306)

Returns `{ sheet, row (1-based), data (object), headers }` or `{ row: -1 }` when not found. Used by `redeemGiftCard`, `reloadGiftCard`, `voidGiftCard` to locate the cert row before writing.

```javascript
var result = findRowById(GIFT_CARDS_SHEET_NAME, certNumber);
if (result.row === -1) return { ok: false, error: 'not_found' };
var gc = result.data;
// Write to specific columns:
result.sheet.getRange(result.row, /* colIndex */).setValue(newValue);
```

---

#### `sheetToObjects` / `invalidateSheetCache` (reuse as-is, `adminApi.gs` lines 1214–1257)

```javascript
// After any balance write — invalidate so the next lookup in the same execution gets fresh data
invalidateSheetCache(GIFT_CARDS_SHEET_NAME);
```

---

#### `createBatch` lock+write pattern to mirror (`adminApi.gs` lines 1985–2023)

The full atomic-write structure for `issueGiftCard`:

```javascript
var lock = acquireScriptLock(15000);
try {
  // 1. Check for duplicate cert_number (mirrors batch dedup guard, line 1924)
  var existing = findRowById(GIFT_CARDS_SHEET_NAME, certNumber);
  if (existing.row !== -1) {
    return { ok: false, error: 'duplicate', message: 'Certificate number already in use: ' + certNumber };
  }
  // 2. Generate next suggested ID if caller didn't supply one
  //    (not needed if cert_number is required — but used for next-number endpoint)
  var now = new Date().toISOString();
  // 3. appendRow — mirrors batchesSheet.appendRow([...]) at line 1998
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(GIFT_CARDS_SHEET_NAME);
  if (!sheet) return { ok: false, error: 'sheet_not_found', message: 'GiftCards sheet not found. Create it first.' };
  sheet.appendRow([
    certNumber,           // col 1: cert_number (primary key)
    face_value,           // col 2: face_value
    face_value,           // col 3: current_balance (starts at face_value)
    'active',             // col 4: status
    now.slice(0, 10),     // col 5: issued_date
    issuedBy,             // col 6: issued_by
    '',                   // col 7: zoho_invoice_number (filled after Zoho call)
    sanitizeInput(payload.notes || ''),  // col 8: notes
    now,                  // col 9: last_updated
    ''                    // col 10: last_tx_ref (idempotency)
  ]);
  invalidateSheetCache(GIFT_CARDS_SHEET_NAME);
  return { ok: true, cert_number: certNumber, face_value: face_value };
} finally {
  lock.releaseLock();
}
```

---

#### `sanitizeInput` (already exists in `adminApi.gs` — reuse wherever string user input is appended)

---

#### doGet server-token lookup pattern (for `next_cert_number` via GET if needed)

Mirror the GET server-token block (`adminApi.gs` lines 95–107):

```javascript
var serverTokenParam = e.parameter.server_token || '';
var storedTokenForGet = PropertiesService.getScriptProperties().getProperty('SERVER_TOKEN');
var isServerAuth = (serverTokenParam && storedTokenForGet && serverTokenParam === storedTokenForGet);
```

---

### `js/kiosk.js` (MODIFY — issue modal + redeem tender, inline overlay pattern)

**Analog:** self — `kioskShowCustomItemModal` (line 2629) and the new-sale payment view (lines 3215–3292)

---

#### Inline overlay modal pattern (`kiosk.js` lines 2631–2713)

The "Issue Gift Card" modal follows the **exact same build-once-then-show** overlay pattern:

```javascript
function kioskShowGiftCardIssueModal() {
  var overlay = document.getElementById('kiosk-gift-card-issue-overlay');
  if (!overlay) {
    // Build the overlay once and append to kiosk container
    overlay = document.createElement('div');
    overlay.id = 'kiosk-gift-card-issue-overlay';
    overlay.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'bottom:0',
      'background:rgba(0,0,0,0.55)', 'z-index:1200',
      'display:flex', 'align-items:center', 'justify-content:center'
    ].join(';');
    overlay.innerHTML = [
      '<div style="background:#fff;border-radius:12px;padding:1.5rem;width:min(90vw,440px);box-shadow:0 8px 32px rgba(0,0,0,0.25);">',
      '<h3 style="margin:0 0 1rem;font-size:1.25rem;">Issue Gift Certificate</h3>',
      // ... fields: kgci-cert (pre-filled), kgci-value, kgci-error, kgci-cancel, kgci-issue
      '</div>'
    ].join('');
    var kioskRoot = document.getElementById('kiosk-root') || document.body;
    kioskRoot.appendChild(overlay);
  }
  overlay.style.display = 'flex';
  // Reset fields, set focus, wire cancel/confirm buttons + backdrop click
  overlay.onclick = function (e) {
    if (e.target === overlay) overlay.style.display = 'none';
  };
}
```

Key differences from custom-item modal:
- Fields: `kgci-cert` (text, pre-filled with suggested number from `/api/kiosk/gift-card/next-number`), `kgci-value` (number, $0.01–$2000)
- No qty or tax-exempt fields
- Submit button calls `fetch(mwUrl + '/api/kiosk/gift-card/issue', ...)` — async with loading state
- Success: hide overlay, show confirmation (cert_number + face_value on receipt)
- Use `kgci-` prefix (not `kci-`) to avoid ID collisions with the existing custom-item modal

---

#### Button placement (mirror `kiosk.js` lines 2800–2817 and 2854–2857)

The "Issue Gift Card" button appears in the cart area alongside "Add custom item". Render it in `kioskRenderCart()` in the non-empty cart HTML block, NOT only in the empty-cart block. Copy the pattern of the "Add custom item" button wire-up at lines 2854–2857:

```javascript
// In kioskRenderCart() HTML build:
'<button id="kiosk-add-gc-btn" type="button" class="kiosk-add-custom-btn" ...>' +
'+ Issue Gift Card' +
'</button>'

// In kioskRenderCart() after innerHTML assignment:
var addGcBtn = document.getElementById('kiosk-add-gc-btn');
if (addGcBtn) {
  addGcBtn.addEventListener('click', function () {
    kioskShowGiftCardIssueModal();
  });
}
```

---

#### Redeem tender — payment view injection point (`kiosk.js` lines 3215–3292)

The "Apply Gift Card" affordance is inserted **before** the terminal push, in `kioskStartCheckout`'s new-sale branch (around line 3215). It gates the terminal push: staff may either skip gift card (proceed directly) or apply one first.

Pattern: add an "Apply Gift Card" sub-panel that shows before the terminal spinner. Wire it as a step:

```javascript
// In the new-sale flow, after rendering itemsEl but before starting poll:
var gcPanel = document.getElementById('kiosk-gc-panel');
// ... build or show panel with cert_number input, lookup button, amount-to-apply input
// After staff confirm gift card amount:
//   1. Update _kioskGiftCard = { cert_number, amount_applied, balance }
//   2. Update amountEl to show terminal_amount = grandTotal - amount_applied
//   3. Update saleBody to include gift_card: { cert_number, amount_applied }
//   4. Proceed to existing fetch(saleUrl, ...) terminal push
```

The `_kioskGiftCard` variable is a module-scoped `var` (same pattern as `_kioskDiscount`, `_kioskCustomer`). It is cleared in `kioskClearCart()`.

The modified `standardSaleBody` (line 3286) becomes:
```javascript
var standardSaleBody = {
  items: items,
  reference_number: refNumber,
  idempotency_key: refNumber,
  discount: _kioskDiscount ? { ... } : undefined,
  gift_card: _kioskGiftCard ? {
    cert_number: _kioskGiftCard.cert_number,
    amount_applied: _kioskGiftCard.amount_applied
  } : undefined
};
```

---

#### `handleSaleResult` / confirm call (no change needed)

The existing `handleSaleResult` function (line 3297) and the confirm `fetch` are unchanged — the split-tender is transparent to the client once `saleBody` includes `gift_card`.

---

### `js/admin.js` (MODIFY — issue modal + redeem tender, openModal/closeModal pattern)

**Analog:** self — `kioskShowAdminCustomItemModal` (line 10106) and `openModal`/`closeModal` (lines 1301–1312)

---

#### `openModal` / `closeModal` pattern (reuse as-is, `admin.js` lines 1301–1319)

```javascript
function openModal(title, bodyHTML) {
  _runModalCleanup();
  document.getElementById('admin-modal-title').textContent = title;
  document.getElementById('admin-modal-body').innerHTML = bodyHTML;
  document.getElementById('admin-modal').style.display = '';
}

function closeModal() {
  document.getElementById('admin-modal').style.display = 'none';
  _runModalCleanup();
}
```

The admin.js "Issue Gift Card" modal uses `openModal('Issue Gift Certificate', html)` with the same field IDs as kiosk.js (`kgci-cert`, `kgci-value`, `kgci-error`). Cancel wires to `closeModal()` (not `overlay.style.display = 'none'`).

---

#### `kioskShowAdminCustomItemModal` as the direct template (`admin.js` lines 10106–10155)

```javascript
function kioskShowAdminGiftCardIssueModal() {
  var html = [
    '<div>',
    // ... same fields as kiosk.js version but WITHOUT inline overlay wrapper
    // (openModal provides the container)
    '</div>'
  ].join('');
  openModal('Issue Gift Certificate', html);

  var certEl = document.getElementById('kgci-cert');
  if (certEl) certEl.focus();

  var cancelBtn = document.getElementById('kgci-cancel');
  var issueBtn = document.getElementById('kgci-issue');
  if (cancelBtn) { cancelBtn.onclick = function () { closeModal(); }; }
  if (issueBtn) { issueBtn.onclick = function () { kioskSubmitAdminGiftCardIssue(); }; }
}

function kioskSubmitAdminGiftCardIssue() {
  // Identical validation + fetch logic as kiosk.js version
  // On success: closeModal(); kioskRenderCart(); (not overlay.style.display = 'none')
  closeModal();
  kioskRenderCart();
}
```

Key divergence from `kiosk.js`:
- `kiosk.js`: `overlay.style.display = 'none'` to close
- `admin.js`: `closeModal()` to close
- CSS classes for buttons: `kiosk.js` uses inline styles; `admin.js` uses `class="btn btn-default"` / `class="btn btn-primary"` (see `admin.js` line 10137–10138)

---

#### Payment view injection point (`admin.js` lines 10529–10601)

The admin.js redeem-tender affordance mirrors kiosk.js at line ~10529 (`kioskShowView('payment')` block). Same `_kioskGiftCard` module-scoped variable. Same modified `existingSaleBody` (around line 10575):

```javascript
var existingSaleBody = {
  items: items,
  tax_total: totals.tax,
  reference_number: refNumber,
  contact_id: _kioskCustomer ? _kioskCustomer.contact_id : '',
  idempotency_key: idempotencyKey,
  gift_card: _kioskGiftCard ? {
    cert_number: _kioskGiftCard.cert_number,
    amount_applied: _kioskGiftCard.amount_applied
  } : undefined
};
```

---

## Shared Patterns

### API Key Guard
**Source:** `zoho-middleware/server.js` lines 257–284, and global middleware at line 273–282
**Apply to:** All `/api/kiosk/gift-card/*` routes automatically (existing `/api` Referer guard at line 396 + global key check at line 273 covers them)

The kiosk client sends `x-api-key: SHEETS_CONFIG.MW_API_KEY` on all requests (see `kiosk.js` line 3181: `'x-api-key': SHEETS_CONFIG.MW_API_KEY || ''`). No new key configuration needed.

### validateEnv.js — OPTIONAL entry for new env var
**Source:** `zoho-middleware/lib/validateEnv.js` lines 25–70
**Apply to:** `validateEnv.js` OPTIONAL array

Add after line 64 (`KIOSK_CONTACT_ID`):
```javascript
{ name: 'KIOSK_GIFT_CARD_ITEM_ID', desc: 'Zoho item ID for gift certificate sales (maps to Gift Card Sales income account)' },
```

### eventLog pattern
**Source:** `zoho-middleware/routes/pos.js` lines 653–655
**Apply to:** `gift-cards.js` issue/redeem/reload/void handlers

```javascript
eventLog.logEvent('kiosk.gift_card_issued', {
  certNumber: certNumber, faceValue: faceValue, invoiceNumber: invoiceNumber
});
eventLog.logEvent('kiosk.gift_card_redeemed', {
  certNumber: certNumber, amountApplied: gcApplied, refNumber: refNumber
});
```

### Structured log prefixes
**Source:** throughout `pos.js` (e.g., `[pos/kiosk/sale]`, `[pos/kiosk/sale/confirm]`)
**Apply to:** `gift-cards.js`

Use `[gift-cards/issue]`, `[gift-cards/lookup]`, `[gift-cards/redeem]`, `[gift-cards/reload]`, `[gift-cards/void]` as log prefixes.

### Apps Script `sanitizeInput` (already defined in `adminApi.gs`)
**Apply to:** All string inputs appended to GiftCards sheet rows

---

## No Analog Found

None. All five files have direct analogs in the codebase.

---

## Metadata

**Actual file paths verified:**
- `zoho-middleware/routes/pos.js` — 2339 lines
- `zoho-middleware/routes/checkout.js` — 1000 lines (Apps Script POST pattern at pos.js lines 2113–2116; checkout.js has NO Apps Script calls — the pattern is in pos.js)
- `apps-script/adminApi.gs` — 3697 lines (NOT `adminApi.gs` at repo root — path is `apps-script/adminApi.gs`)
- `js/kiosk.js` — 5317 lines
- `js/admin.js` — 12125 lines

**Key verification result:** The research note that "the server-to-server Apps Script call helper lives in `zoho-middleware/routes/checkout.js`" is INCORRECT. The canonical `axios.post` Apps Script pattern lives in `zoho-middleware/routes/pos.js` at lines 2113–2116 (`/api/batch/reassign-customer` handler), and the `axios.get` pattern at lines 1710–1712 (`/api/batch/scan-invoices` handler). `checkout.js` has zero Apps Script calls (verified by grep).

**Analog search scope:** `zoho-middleware/routes/`, `apps-script/`, `js/kiosk.js`, `js/admin.js`
**Files scanned:** 5 primary + server.js + validateEnv.js
**Pattern extraction date:** 2026-06-27
