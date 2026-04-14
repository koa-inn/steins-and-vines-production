# Helcim POS → Zoho Inventory Sync — Implementation Spec

> **Purpose:** Close the loop between Helcim POS transactions and Zoho Inventory so that every completed sale (terminal or online) automatically creates the corresponding Zoho record and adjusts stock.
>
> **Audience:** Claude Code / implementing developer.
>
> **Scope:** Middleware changes only (`zoho-middleware/`). No frontend changes required.

---

## 1. Current State

### What already exists

| Capability | Location | Status |
|---|---|---|
| Helcim webhook receiver (signature verification, `cardTransaction` + `terminalCancel` events) | `routes/webhooks.js` | ✅ Working |
| Helcim REST client (checkout, terminal purchase, void, refund, polling) | `lib/helcim.js` | ✅ Working |
| Zoho Inventory API wrapper (`inventoryGet`, `inventoryPost`, `inventoryPut`) | `lib/zoho-api.js` | ✅ Working |
| Zoho Books API wrapper (`zohoGet`, `zohoPost`, `zohoPut`) | `lib/zoho-api.js` | ✅ Working |
| Redis inventory ledger (shadow stock with decrement + reconciliation) | `lib/inventory-ledger.js` | ✅ Working |
| POS kiosk sale flow (terminal → invoice → payment → ledger decrement) | `routes/pos.js` | ✅ Working |
| Online checkout flow (HelcimPay.js → sales order → payment) | `routes/checkout.js` | ✅ Working |
| Idempotency, caching, event logging, validation utilities | `lib/*` | ✅ Working |

### The gap

The webhook handler in `routes/webhooks.js` currently **only caches terminal results** for the polling fallback. It does NOT:

1. Fetch full transaction details from Helcim when a webhook arrives
2. Create a Zoho Inventory Sales Order for transactions that didn't originate from the existing kiosk/checkout flows
3. Adjust Zoho Inventory stock levels in response to webhook events
4. Handle refund/void webhooks by reversing inventory adjustments

**Note on existing flows:** The kiosk (`routes/pos.js`) and checkout (`routes/checkout.js`) routes already create Zoho invoices/sales orders and decrement the inventory ledger inline during their request lifecycle. The webhook enhancement described here is primarily for:
- Transactions processed directly on the Helcim terminal (not initiated by the middleware)
- A safety net / reconciliation layer for existing flows
- Future POS scenarios (e.g., staff using the Helcim app directly)

---

## 2. Architecture Overview

```
                ┌─────────────────┐
                │  Helcim Terminal │
                │  or HelcimPay.js │
                └────────┬────────┘
                         │ sale completes
                         ▼
              ┌─────────────────────┐
              │   Helcim Webhook    │
              │ POST /api/webhooks/ │
              │     helcim          │
              └────────┬────────────┘
                       │
         ┌─────────────┼─────────────┐
         │             │             │
         ▼             ▼             ▼
   cardTransaction  terminalCancel  (refund/void)
   type=purchase
         │                           │
         ▼                           ▼
   ┌───────────┐             ┌──────────────┐
   │ Duplicate  │             │ Reverse stock│
   │ check      │             │ adjustment   │
   │ (Redis)    │             │ in ledger    │
   └─────┬─────┘             └──────────────┘
         │ new txn
         ▼
   ┌──────────────┐
   │ Fetch full   │
   │ txn details  │
   │ from Helcim  │
   │ GET /v2/     │
   │ card-batches/│
   │ transactions/│
   │ {txnId}      │
   └──────┬───────┘
          │
          ▼
   ┌──────────────┐     ┌───────────────┐
   │ Check if     │────▶│ Already has a  │──▶ Skip (log only)
   │ SO/Invoice   │ yes │ Zoho record    │
   │ already      │     └───────────────┘
   │ exists       │
   └──────┬───────┘
          │ no
          ▼
   ┌──────────────┐
   │ Map Helcim   │
   │ line items → │
   │ Zoho item_ids│
   │ (SKU lookup) │
   └──────┬───────┘
          │
    ┌─────┴──────┐
    ▼            ▼
 ┌────────┐  ┌───────────┐
 │ Create │  │ Decrement │
 │ Zoho   │  │ inventory │
 │ Invoice│  │ ledger    │
 └────────┘  └───────────┘
```

---

## 3. Implementation Plan

### 3.1 New constants (`lib/constants.js`)

Add these cache key patterns to the existing `CACHE_KEYS` object:

```javascript
// Helcim → Zoho sync
WEBHOOK_PROCESSED_PREFIX: 'helcim:webhook:processed:',  // + transactionId (24h TTL)
SKU_TO_ITEM_PREFIX:       'zoho:sku-to-item:',          // + sku string (2h TTL)
SKU_MAP:                  'zoho:sku-map',                // full SKU→itemId map (2h TTL)
```

### 3.2 New module: `lib/helcim-sync.js`

This is the core new module. It should be a pure library (no Express dependency) that the webhook handler calls.

#### Exported functions

```javascript
/**
 * Process an approved Helcim card transaction and sync to Zoho Inventory.
 *
 * @param {string} transactionId  — Helcim transaction ID from webhook
 * @param {object} [webhookData]  — The webhook event.data payload (partial)
 * @returns {Promise<{action: string, details: object}>}
 *   action: 'created' | 'skipped_duplicate' | 'skipped_no_items' | 'error'
 */
module.exports.syncTransaction = function syncTransaction(transactionId, webhookData) { ... };

/**
 * Reverse inventory adjustments for a voided/refunded transaction.
 *
 * @param {string} transactionId
 * @param {string} type  — 'void' or 'refund'
 * @param {number} [refundAmount]  — for partial refunds
 * @returns {Promise<{action: string}>}
 */
module.exports.reverseTransaction = function reverseTransaction(transactionId, type, refundAmount) { ... };

/**
 * Build/refresh the SKU → Zoho item_id lookup map in Redis.
 * Called on startup and periodically (e.g., when product cache refreshes).
 *
 * @returns {Promise<number>}  — number of SKUs mapped
 */
module.exports.refreshSkuMap = function refreshSkuMap() { ... };
```

#### `syncTransaction` implementation detail

1. **Duplicate check:** `cache.get(C.CACHE_KEYS.WEBHOOK_PROCESSED_PREFIX + transactionId)` — if exists, return `{action: 'skipped_duplicate'}`.

2. **Check if this txn was already handled inline** by the kiosk or checkout flow: `cache.get('helcim:txn:' + transactionId)` — this key is set by `routes/checkout.js` (24h TTL). If exists, return `{action: 'skipped_duplicate'}`.

3. **Fetch full transaction** from Helcim API. Currently `lib/helcim.js` has `pollTerminalResult()` which does a GET to `/card-batches/transactions` filtered by invoiceNumber. You'll need a new helper:

   ```javascript
   // Add to lib/helcim.js
   function getTransaction(transactionId) {
     return axios.get(HELCIM_BASE_URL + '/card-batches/transactions/' + transactionId, {
       headers: helcimHeaders(),
       timeout: 10000
     }).then(function (res) { return res.data; });
   }
   ```

   The response includes: `transactionId`, `amount`, `currency`, `type` (purchase/refund/void), `status` (APPROVED/DECLINED), `invoiceNumber`, `cardType`, `dateCreated`, and line items if the transaction was created with an invoice.

4. **Resolve line items to Zoho item IDs.** Two strategies:

   **Strategy A (preferred):** If you include Zoho SKUs in Helcim invoice line items when creating terminal purchases (i.e., in `routes/pos.js`), the webhook payload will contain them. Map via the SKU lookup cache.

   **Strategy B (fallback):** If the Helcim transaction has no structured line items (e.g., a manual terminal charge), create a generic "POS Sale" invoice in Zoho with a single line item using a designated catch-all item ID (configurable via `process.env.HELCIM_GENERIC_SALE_ITEM_ID`).

5. **Create Zoho Invoice** using the existing `zohoPost('/invoices', payload)` pattern from `routes/pos.js`:

   ```javascript
   var invoicePayload = {
     customer_id: process.env.KIOSK_CONTACT_ID,   // walk-in customer
     date: txnDate,                                 // from Helcim dateCreated
     reference_number: 'HELCIM-' + transactionId,
     payment_terms: 0,
     payment_terms_label: 'Due on Receipt',
     line_items: resolvedLineItems,
     notes: 'Auto-synced from Helcim POS. Transaction: ' + transactionId,
     custom_fields: [
       { api_name: process.env.ZOHO_CF_TRANSACTION_ID, value: transactionId }
     ]
   };
   ```

6. **Record payment** using the existing pattern from `routes/pos.js`:

   ```javascript
   zohoPost('/customerpayments', {
     payment_mode: cardType.indexOf('debit') !== -1 ? 'debitcard' : 'creditcard',
     amount: txnAmount,
     date: txnDate,
     reference_number: transactionId,
     invoices: [{ invoice_id: newInvoiceId, amount_applied: txnAmount }],
     notes: 'Helcim POS payment. Txn: ' + transactionId
   });
   ```

7. **Decrement inventory ledger** using the existing `inventoryLedger.decrementStock()`:

   ```javascript
   inventoryLedger.decrementStock(resolvedLineItems, 'webhook:' + transactionId);
   ```

8. **Mark as processed:** `cache.set(C.CACHE_KEYS.WEBHOOK_PROCESSED_PREFIX + transactionId, 'synced', 86400)` (24h TTL).

9. **Log event:** `eventLog.logEvent('helcim.sync_completed', { transactionId, action: 'created', invoiceId, itemCount })`.

#### `reverseTransaction` implementation detail

1. Look up the original sync record from cache or Zoho (search invoices by reference_number `'HELCIM-' + transactionId`).
2. For voids: credit note the full invoice in Zoho.
3. For refunds: if partial, create a credit note for the refund amount.
4. Increment stock back in the inventory ledger (add a new `incrementStock` function to `lib/inventory-ledger.js` mirroring `decrementStock`).
5. Log: `eventLog.logEvent('helcim.sync_reversed', { transactionId, type })`.

#### `refreshSkuMap` implementation detail

1. Call `fetchAllItems()` from `lib/zoho-api.js` (already exists).
2. Build a map: `{ [item.sku]: item.item_id }` for all items that have a SKU.
3. Store as a single JSON blob in Redis: `cache.set(C.CACHE_KEYS.SKU_MAP, skuMap, 7200)`.

### 3.3 Modify `routes/webhooks.js`

The existing handler currently only caches terminal results. Extend it:

```javascript
var helcimSync = require('../lib/helcim-sync');

// Inside handleCardTransaction, AFTER the existing cache.set for terminal result:

if (status === 'APPROVED' && (transactionType === 'purchase' || !transactionType)) {
  // Fire-and-forget async sync — don't block the 200 response
  helcimSync.syncTransaction(transactionId, data)
    .then(function (result) {
      eventLog.logEvent('helcim.sync_result', {
        transactionId: transactionId,
        action: result.action
      });
    })
    .catch(function (err) {
      log.error('[webhooks] Zoho sync failed for txn=' + transactionId, err);
      eventLog.logEvent('helcim.sync_failed', {
        transactionId: transactionId,
        error: err.message
      });
    });
}

if (transactionType === 'refund' || transactionType === 'void') {
  helcimSync.reverseTransaction(transactionId, transactionType)
    .catch(function (err) {
      log.error('[webhooks] Zoho reverse failed for txn=' + transactionId, err);
    });
}
```

**Critical:** The webhook route MUST continue to respond 200 immediately. All sync work happens asynchronously after the response is sent. This is already the pattern — just adding to the fire-and-forget block.

### 3.4 Modify `lib/helcim.js`

Add one new exported function:

```javascript
/**
 * Fetch full transaction details by ID.
 * @param {string} transactionId
 * @returns {Promise<object>} Full Helcim transaction object
 */
function getTransaction(transactionId) {
  if (!transactionId) return Promise.reject(new Error('transactionId required'));
  return withRetry(function () {
    return axios.get(HELCIM_BASE_URL + '/card-batches/transactions/' + transactionId, {
      headers: helcimHeaders(),
      timeout: 10000
    }).then(function (res) { return res.data; });
  }, { retries: 2 });
}
```

Add `getTransaction` to `module.exports`.

**Note:** Use the existing `withRetry` pattern if one exists in helcim.js, otherwise implement a simple retry (the Zoho `withRetry` is in `zoho-api.js` and is Zoho-specific). The Helcim API rate limit is generous (thousands/min) so a simple 2-retry with 500ms backoff is sufficient.

### 3.5 Modify `lib/inventory-ledger.js`

Add an `incrementStock` function (mirror of `decrementStock`):

```javascript
/**
 * Increment stock in the Redis ledger (for refund/void reversals).
 * @param {Array<{item_id: string, quantity: number}>} lineItems
 * @param {string} reason  e.g., 'refund:TXN123'
 * @returns {Promise}
 */
function incrementStock(lineItems, reason) {
  // Same pattern as decrementStock but uses INCRBY instead of DECRBY
  // Same adjustment logging pattern
}
```

Add `incrementStock` to `module.exports`.

### 3.6 New env vars

Add to `.env.example` (never commit actual values):

```bash
# Helcim → Zoho Inventory Sync
HELCIM_GENERIC_SALE_ITEM_ID=       # Zoho item_id for unstructured POS sales
HELCIM_SYNC_ENABLED=true           # Feature flag to enable/disable webhook sync
```

### 3.7 Startup integration

In the main `server.js` or `app.js`, call `helcimSync.refreshSkuMap()` during startup (after Zoho auth is initialized) to warm the SKU cache. Also hook it into whatever periodic cache refresh you already run for products.

---

## 4. Test Plan

### 4.1 Unit tests: `__tests__/helcim-sync.test.js`

Follow the existing test patterns in the codebase (Jest, mock all external deps):

```javascript
jest.mock('../lib/helcim');
jest.mock('../lib/zoho-api');
jest.mock('../lib/cache');
jest.mock('../lib/inventory-ledger');
jest.mock('../lib/eventLog');
```

**Test cases:**

1. `syncTransaction` — happy path: new purchase → creates invoice, records payment, decrements stock
2. `syncTransaction` — duplicate: txn already in processed cache → returns `skipped_duplicate`
3. `syncTransaction` — already handled by checkout flow: `helcim:txn:ID` exists → returns `skipped_duplicate`
4. `syncTransaction` — Helcim API returns DECLINED status → no Zoho records created
5. `syncTransaction` — no line items in Helcim txn → uses generic sale item
6. `syncTransaction` — Zoho invoice creation fails → does NOT mark as processed (allows retry on next webhook delivery)
7. `syncTransaction` — Zoho payment recording fails after invoice created → logs error, still marks as processed (invoice exists)
8. `reverseTransaction` — void → creates credit note, increments stock
9. `reverseTransaction` — refund with amount → partial credit note
10. `refreshSkuMap` — builds map from fetched items, caches in Redis

### 4.2 Unit tests: webhook handler changes

Add to existing `__tests__/webhooks.test.js`:

11. Approved purchase webhook triggers `helcimSync.syncTransaction` asynchronously
12. Refund webhook triggers `helcimSync.reverseTransaction`
13. Void webhook triggers `helcimSync.reverseTransaction`
14. Declined webhook does NOT trigger sync
15. `HELCIM_SYNC_ENABLED=false` → no sync calls made
16. Sync failure does not affect the 200 response

### 4.3 Unit tests: `lib/helcim.js` addition

17. `getTransaction` — returns full transaction object
18. `getTransaction` — retries on 5xx
19. `getTransaction` — rejects on missing transactionId

### 4.4 Unit tests: `lib/inventory-ledger.js` addition

20. `incrementStock` — increments Redis values, logs adjustment
21. `incrementStock` — handles Redis unavailability gracefully

---

## 5. Error Handling & Edge Cases

### 5.1 Idempotency (critical)

Helcim retries webhooks for up to 10 hours. The duplicate-check cascade is:

1. `WEBHOOK_PROCESSED_PREFIX + txnId` — set after successful sync (24h TTL)
2. `helcim:txn:` + txnId` — set by checkout/kiosk flows (24h TTL)
3. Zoho reference_number search — last resort if Redis was flushed

All three must be checked before creating any Zoho records.

### 5.2 Ghost charges (already handled)

If a webhook arrives for a transaction that the kiosk flow already voided (due to Zoho failure), the void will have changed the Helcim transaction status. The sync should check for `status === 'APPROVED'` before proceeding.

### 5.3 Race condition: webhook vs. inline flow

The kiosk/checkout flows create Zoho records synchronously during the request. The webhook for the same transaction may arrive before or after. The `helcim:txn:` cache key (set by checkout/kiosk, checked by sync) prevents double-creation. If the webhook arrives first (unlikely but possible for online checkout), the checkout flow's own `helcim:txn:` check will catch it.

### 5.4 SKU mapping failures

If a Helcim line item's SKU doesn't match any Zoho item, log a warning and either skip that line item or use the generic sale item. Don't fail the entire sync for one unmapped SKU.

### 5.5 Feature flag

Wrap all sync logic in a `process.env.HELCIM_SYNC_ENABLED !== 'false'` check so you can disable it without a deploy if something goes wrong.

---

## 6. Conventions to Follow

These are extracted from the existing codebase — match them exactly:

| Convention | Pattern | Example |
|---|---|---|
| Module style | ES5 `var`, no arrow functions, CommonJS `require`/`module.exports` | `var cache = require('./cache');` |
| Promises | `.then()` / `.catch()` chains, no `async/await` in route files | Checkout and POS use `.then()` chains |
| Log format | `log.info('[module] message', extra)` with bracketed module prefix | `log.info('[helcim-sync] Created invoice', { txnId })` |
| Event logging | `eventLog.logEvent('namespace.event', { safe_fields_only })` — no PII | See `lib/eventLog.js` header |
| Error classification | `validate.classifyZohoError(err, fallbackMsg)` for Zoho errors | Returns `{ status, message }` |
| Cache keys | Use constants from `lib/constants.js`, never inline strings | `C.CACHE_KEYS.WEBHOOK_PROCESSED_PREFIX` |
| Validation | `validate.validateLineItems(items, opts)` returns `null` or error string | Check before Zoho API calls |
| Idempotency | 25-char hex key via `helcimLib.generateIdempotencyKey()` | Used in Helcim API requests |
| Fire-and-forget | `.catch(function (err) { log.error(...); })` — never swallow silently | Always log errors |
| Tests | Jest, mock all external deps, test via exported function refs | See `__tests__/checkout.test.js` |

---

## 7. Files to Create or Modify

| Action | File | Description |
|---|---|---|
| **CREATE** | `lib/helcim-sync.js` | Core sync logic (syncTransaction, reverseTransaction, refreshSkuMap) |
| **CREATE** | `__tests__/helcim-sync.test.js` | Unit tests for the new module |
| **MODIFY** | `lib/constants.js` | Add `WEBHOOK_PROCESSED_PREFIX`, `SKU_TO_ITEM_PREFIX`, `SKU_MAP` to `CACHE_KEYS` |
| **MODIFY** | `lib/helcim.js` | Add `getTransaction()` function and export |
| **MODIFY** | `lib/inventory-ledger.js` | Add `incrementStock()` function and export |
| **MODIFY** | `routes/webhooks.js` | Wire up `helcimSync.syncTransaction` and `reverseTransaction` calls |
| **MODIFY** | `.env.example` | Add `HELCIM_GENERIC_SALE_ITEM_ID` and `HELCIM_SYNC_ENABLED` |
| **MODIFY** | Server startup file | Call `helcimSync.refreshSkuMap()` on init |

---

## 8. Deployment Checklist

1. Set `HELCIM_SYNC_ENABLED=false` initially in staging
2. Deploy to staging
3. Run full test suite: `cd zoho-middleware && npm test`
4. Set `HELCIM_SYNC_ENABLED=true` in staging
5. Process a test terminal sale on the Helcim staging terminal
6. Verify: webhook received → Zoho invoice created → stock decremented → event logged
7. Process a void — verify stock incremented back
8. Process a refund — verify credit note created
9. Check for duplicate handling: replay the same webhook manually → should skip
10. Monitor Redis memory and Zoho API rate limit headers during testing
11. Once validated on staging, deploy to production with `HELCIM_SYNC_ENABLED=true`
