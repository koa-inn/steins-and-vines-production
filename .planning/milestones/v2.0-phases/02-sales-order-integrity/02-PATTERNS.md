# Phase 2: Sales Order Integrity - Pattern Map

**Mapped:** 2026-04-28
**Files analyzed:** 3 (modified)
**Analogs found:** 3 / 3

## File Classification

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------|------|-----------|----------------|---------------|
| `zoho-middleware/routes/pos.js` | controller/route | request-response (CRUD: invoice creation) | Self — `processSale()` and `salesorder-pay` (same file) | exact (self-modify) |
| `js/kiosk.js` | frontend controller | event-driven (UI state machine) | Self — `kioskShowError()`, `kioskShowReceipt()`, stock rendering (same file) | exact (self-modify) |
| `zoho-middleware/routes/catalog.js` | controller/route | request-response (cache read) | Self — kiosk products endpoint (same file, line 695-757) | exact (verification only) |

## Pattern Assignments

### `zoho-middleware/routes/pos.js` (controller, request-response)

**Analog:** Same file — all modifications are surgical changes to existing functions.

**Imports pattern** (lines 1-20):
```javascript
var express = require('express');
var helcimLib = require('../lib/helcim');
var zohoApi = require('../lib/zoho-api');
var cache = require('../lib/cache');
var log = require('../lib/logger');
var eventLog = require('../lib/eventLog');
var mailer = require('../lib/mailer');
var ledger = require('../lib/inventory-ledger');
var C = require('../lib/constants');

var zohoGet = zohoApi.zohoGet;
var zohoPost = zohoApi.zohoPost;
var zohoPut = zohoApi.zohoPut;

var KIOSK_PRODUCTS_CACHE_KEY = C.CACHE_KEYS.KIOSK_PRODUCTS;
```

**Line item building pattern** (lines 146-156 — the code to modify for D-03 tax_id):
```javascript
// Current pattern: builds line items from catalog, ignores client rate
var lineItems = body.items.map(function (item) {
  var qty = Number(item.quantity) || 1;
  var rate = catalogMap[item.item_id].rate; // authoritative price from catalog
  subtotal += qty * rate;
  return {
    item_id: item.item_id,
    name: item.name || '',
    quantity: qty,
    rate: rate
  };
});
subtotal = Math.round(subtotal * 100) / 100;
```

**Tax computation pattern** (lines 160-162 — the code to replace with per-item tax):
```javascript
// Current flat-rate pattern (to be replaced):
var taxRate = parseFloat(process.env.KIOSK_TAX_RATE) || 0.05;
var taxTotal = Math.round(subtotal * taxRate * 100) / 100;
var grandTotal = Math.round((subtotal + taxTotal) * 100) / 100;
```

**Invoice creation pattern** (lines 241-263 — payload structure):
```javascript
var invoicePayload = {
  date: today,
  reference_number: refNumber,
  payment_terms: 0,
  payment_terms_label: 'Due on Receipt',
  line_items: lineItems,
  notes: 'In-store kiosk sale. Terminal txn: ' + txnId,
  custom_fields: []
};

var contactId = process.env.KIOSK_CONTACT_ID || '';
if (contactId) invoicePayload.customer_id = contactId;

if (txnId && process.env.ZOHO_CF_TRANSACTION_ID) {
  invoicePayload.custom_fields.push({
    api_name: process.env.ZOHO_CF_TRANSACTION_ID,
    value: txnId
  });
}
```

**Invoice submit + payment recording pattern** (lines 311-339):
```javascript
paymentChain = zohoPost('/invoices/' + invoiceId + '/submit', {})
  .catch(function (submitErr) {
    // Non-fatal — invoice exists, stock will still adjust
    log.warn('[pos/kiosk/sale] Invoice submit failed (non-fatal): ' + submitErr.message);
  })
  .then(function () {
    var cardType = (termResponse.cardType || '').toLowerCase();
    var paymentMode = (cardType.indexOf('debit') !== -1) ? 'debitcard' : 'creditcard';
    return zohoPost('/customerpayments', {
      payment_mode: paymentMode,
      amount: grandTotal,
      date: today,
      reference_number: txnId || refNumber,
      invoices: [{ invoice_id: invoiceId, amount_applied: grandTotal }],
      notes: 'Kiosk POS payment. Terminal txn: ' + txnId
    });
  })
  .then(function () {
    log.info('[pos/kiosk/sale] Payment recorded for invoice ' + invoiceNumber);
  })
  .catch(function (payErr) {
    // Non-fatal — invoice and stock adjustment still happened
    log.error('[pos/kiosk/sale] Payment recording failed (non-fatal): ' + payErr.message);
  });
```

**Auto-void on Zoho failure pattern** (lines 387-435):
```javascript
.catch(function (invoiceErr) {
  var invoiceMsg = invoiceErr.message;
  if (invoiceErr.response && invoiceErr.response.data) {
    invoiceMsg = invoiceErr.response.data.message || invoiceErr.response.data.error || invoiceMsg;
  }
  log.error('[pos/kiosk/sale] Invoice creation failed after payment — voiding txn=' + txnId + ': ' + invoiceMsg);
  eventLog.logEvent('kiosk.sale_failed_after_charge', {
    txnId: txnId, itemCount: lineItems.length, grandTotal: grandTotal
  });

  helcimLib.voidTransaction(txnId)
    .then(function () {
      log.info('[pos/kiosk/sale] Voided txn=' + txnId + ' after invoice failure');
    })
    .catch(function (voidErr) {
      log.error('[pos/kiosk/sale] CRITICAL: Void failed for txn=' + txnId + ': ' + voidErr.message);
      cache.set('sv:void-failure:' + Date.now(), failRecord, 60 * 60 * 24 * 30).catch(function () {});
      mailer.sendVoidFailureAlert({ txnId: txnId, amount: grandTotal, error: voidErr.message, timestamp: failRecord.timestamp }).catch(function () {});
    })
    .then(function () {
      if (res.headersSent) return;
      res.status(502).json({
        error: 'Payment was taken but order could not be recorded. Please contact support.',
        payment_voided: true,
        voided_transaction_id: txnId
      });
    });
});
```

**SO-pay endpoint pattern — payment recording section** (lines 1227-1256 — where invoice creation will be added):
```javascript
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
    log.info('[kiosk/so-pay] Payment recorded for ' + soNumber);

    // Invalidate SO cache
    cache.del(KIOSK_SO_CACHE_KEY).catch(function () {});

    eventLog.logEvent('kiosk.salesorder_payment', {
      soId: soId, soNumber: soNumber, txnId: txnId, amount: balance
    });

    res.json({
      ok: true,
      transaction_id: txnId,
      salesorder_number: soNumber,
      amount: balance,
      card_type: paymentMode
    });
  })
```

**Confirm sale endpoint — same flat tax pattern** (lines 592-594 — also needs per-item tax):
```javascript
var taxRate = parseFloat(process.env.KIOSK_TAX_RATE) || 0.05;
var taxTotal = Math.round(subtotal * taxRate * 100) / 100;
var grandTotal = Math.round((subtotal + taxTotal) * 100) / 100;
```

---

### `js/kiosk.js` (frontend controller, event-driven)

**Analog:** Same file — self-contained IIFE with all modifications within existing functions.

**IIFE structure** (lines 1-4):
```javascript
// ===== Steins & Vines In-Store POS (Standalone Kiosk) =====
// Self-contained IIFE — no dependency on admin.js.
(function () {
  'use strict';
```

**Error view pattern** (lines 2177-2203 — the function to extend for D-05/D-06):
```javascript
function kioskShowError(title, msg, canRetry) {
  kioskShowView('error');

  var titleEl = document.getElementById('kiosk-error-title');
  var msgEl = document.getElementById('kiosk-error-msg');
  var retryBtn = document.getElementById('kiosk-retry-btn');
  var backBtn = document.getElementById('kiosk-back-btn');

  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = msg;

  if (retryBtn) {
    retryBtn.style.display = canRetry ? '' : 'none';
    retryBtn.onclick = function () {
      kioskShowView('browse');
      kioskStartCheckout();
    };
  }

  if (backBtn) {
    backBtn.onclick = function () {
      kioskShowView('browse');
    };
  }
}
```

**SO error view pattern** (lines 2675-2704 — parallel error handler for SO path):
```javascript
function kioskShowSoError(title, msg, canRetry) {
  kioskShowView('error');

  var titleEl = document.getElementById('kiosk-error-title');
  var msgEl = document.getElementById('kiosk-error-msg');
  var retryBtn = document.getElementById('kiosk-retry-btn');
  var backBtn = document.getElementById('kiosk-back-btn');

  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = msg;

  if (retryBtn) {
    retryBtn.style.display = canRetry ? '' : 'none';
    retryBtn.onclick = function () {
      if (_kioskSoPayingId) {
        kioskCollectPayment(_kioskSoPayingId);
      } else {
        kioskShowCollect();
      }
    };
  }

  if (backBtn) {
    backBtn.textContent = 'Back to Orders';
    backBtn.onclick = function () {
      _kioskSoPayingId = null;
      kioskShowCollect();
    };
  }
}
```

**Receipt "Done" button pattern** (lines 2167-2174 — where product refresh will be added):
```javascript
var newSaleBtn = document.getElementById('kiosk-new-sale-btn');
if (newSaleBtn) {
  newSaleBtn.onclick = function () {
    _kioskCustomer = null;
    kioskClearImportedSo();
    kioskShowView('browse');
  };
}
```

**SO-pay receipt "Done" button pattern** (lines 2644-2659 — also needs product refresh):
```javascript
var newSaleBtn = document.getElementById('kiosk-new-sale-btn');
if (newSaleBtn) {
  newSaleBtn.onclick = function () {
    _kioskSoPayingId = null;
    if (_kioskImportedSoId) {
      kioskClearImportedSo();
      _kioskCart = {};
      _kioskDiscount = null;
      kioskRenderCart();
      kioskShowView('browse');
    } else {
      kioskShowCollect();
    }
  };
}
```

**Stock label rendering pattern** (lines 1123-1131 — where negative display will be added):
```javascript
var stockLabel, stockClass;
if (isService) {
  stockLabel = '';
  stockClass = '';
} else {
  stockLabel = outOfStock ? 'Out of stock' :
    (lowStock ? 'Low stock (' + Math.round(stock) + ')' : 'In stock');
  stockClass = outOfStock ? 'kiosk-product-stock--out' :
    (lowStock ? 'kiosk-product-stock--low' : '');
}
```

**Product load function** (lines 935-968 — already supports force refresh):
```javascript
function kioskLoadProducts(forceRefresh) {
  if (_kioskProductsLoading) return;
  if (_kioskProductsLoaded && !forceRefresh) {
    kioskRenderProducts();
    return;
  }
  // ...
  var url = mwUrl + '/api/kiosk/products' + (forceRefresh ? '?bust=1' : '');
  fetch(url)
    .then(function (r) { return r.json(); })
    .then(function (data) {
      _kioskProducts = data.items || [];
      _kioskProductsLoaded = true;
      _kioskProductsLoading = false;
      kioskPopulateCategories();
      kioskRenderProducts();
    })
    // ...
}
```

**Frontend void error handling in confirm flow** (lines 1993-1998 — currently calls kioskShowError):
```javascript
} else {
  kioskShowError('Sale Error', (result.data && result.data.error) || 'Failed to create invoice.', true);
}
```

**Frontend void error handling in SO-pay flow** (lines 2660-2666 — calls kioskShowSoError):
```javascript
} else if (result.status === 402) {
  kioskShowSoError('Payment Declined', result.data.error || 'Card was declined.', true);
} else if (result.status === 504) {
  kioskShowSoError('Terminal Timeout', result.data.error || 'Terminal did not respond in time.', true);
} else {
  kioskShowSoError('Payment Error', (result.data && result.data.error) || 'An error occurred.', true);
}
```

---

### `zoho-middleware/routes/catalog.js` (controller/route, cache read — verification only)

**Analog:** Same file — kiosk products cache builder.

**Tax enrichment in kiosk cache** (lines 718-730 — confirms tax_id is already stored):
```javascript
return {
  item_id:       item.item_id,
  name:          item.name,
  sku:           item.sku || '',
  rate:          item.rate,
  stock_on_hand: item.stock_on_hand != null ? item.stock_on_hand : 0,
  category_name: item.category_name || '',
  product_type:  item.product_type || '',
  image_name:    item.image_name || '',
  tax_id:        item.tax_id || '',
  tax_name:      item.tax_name || '',
  tax_percentage: item.tax_percentage != null ? item.tax_percentage : 0,
  custom_fields: item.custom_fields || [],
  // ...
};
```

**Tax rule percentage lookup** (lines 103-115 — for fallback rate calculation):
```javascript
var _TAX_RULE_PCT = {};
_TAX_RULE_PCT[process.env.ZOHO_TAX_STANDARD_RULE || '109900000000033423'] = 12;  // GST + PST
_TAX_RULE_PCT[process.env.ZOHO_TAX_ZERO_RULE     || '109900000000033411'] = 0;   // Zero Rated
_TAX_RULE_PCT[process.env.ZOHO_TAX_SERVICES_RULE || '109900000000033417'] = 5;   // GST Only
_TAX_RULE_PCT[process.env.ZOHO_TAX_LIQUOR_RULE   || '109900000000033429'] = 15;  // GST + PST Liquor
```

---

## Shared Patterns

### Error Response Structure (Backend)
**Source:** `zoho-middleware/routes/pos.js` lines 429-433
**Apply to:** All backend error responses that involve voided transactions
```javascript
res.status(502).json({
  error: 'Payment was taken but order could not be recorded. Please contact support.',
  payment_voided: true,
  voided_transaction_id: txnId
});
```

### Non-Fatal Error Handling (Backend)
**Source:** `zoho-middleware/routes/pos.js` lines 313-315
**Apply to:** All Zoho API calls that are non-critical (invoice submit, SO-to-invoice creation)
```javascript
.catch(function (submitErr) {
  // Non-fatal — describe what still works
  log.warn('[pos/kiosk/sale] Invoice submit failed (non-fatal): ' + submitErr.message);
})
```

### Event Logging Pattern
**Source:** `zoho-middleware/routes/pos.js` lines 370-375
**Apply to:** New events (SO invoice creation success/failure)
```javascript
eventLog.logEvent('kiosk.sale_completed', {
  txnId: txnId,
  itemCount: lineItems.length,
  grandTotal: grandTotal,
  invoiceNumber: invoiceNumber
});
```

### Cache Invalidation Pattern
**Source:** `zoho-middleware/routes/pos.js` line 344
**Apply to:** After SO-to-Invoice conversion (bust kiosk products cache for stock)
```javascript
cache.del(KIOSK_PRODUCTS_CACHE_KEY);
```

### View State Machine (Frontend)
**Source:** `js/kiosk.js` — `kioskShowView('error')`, `kioskShowView('receipt')`, `kioskShowView('browse')`
**Apply to:** All frontend view transitions
```javascript
// Pattern: switch to named view, then populate elements within that view
kioskShowView('error');
var titleEl = document.getElementById('kiosk-error-title');
if (titleEl) titleEl.textContent = title;
```

### DOM Element Access Pattern (Frontend)
**Source:** `js/kiosk.js` lines 2179-2185
**Apply to:** All new DOM interactions (error detail element)
```javascript
// Pattern: getElementById + null-check before setting
var detailEl = document.getElementById('kiosk-error-detail');
if (detailEl) {
  detailEl.textContent = 'Ref: ' + extra.txnId;
  detailEl.style.display = '';
}
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | -- | -- | All modifications target existing files with self-referencing patterns |

---

## Metadata

**Analog search scope:** `zoho-middleware/routes/pos.js`, `zoho-middleware/routes/catalog.js`, `js/kiosk.js`
**Files scanned:** 3
**Pattern extraction date:** 2026-04-28
