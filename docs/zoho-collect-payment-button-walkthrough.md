# "Collect Payment" Button — Zoho Inventory → Helcim Terminal

> A step-by-step walkthrough for adding a custom button to Zoho Inventory Sales Orders that sends the balance due to your Helcim Smart Terminal for in-store payment collection.

---

## How It Works (Big Picture)

```
Staff opens Sales Order in Zoho Inventory
        │
        ▼
Clicks "Collect Payment" button
        │
        ▼
Deluge script reads the SO balance
and POSTs to your middleware
        │
        ▼
Middleware calls Helcim Smart Terminal API
(terminalPurchase) → terminal displays payment screen
        │
        ▼
Customer taps/inserts card on terminal
        │
        ▼
Helcim webhook fires → middleware receives result
        │
        ▼
Middleware auto-updates the Sales Order status
in Zoho to "Paid" and records the payment
        │
        ▼
Staff sees the SO status change in Zoho ✓
```

There are two sides to set up: a new route in your middleware, and the custom button in Zoho Inventory. The middleware route needs to exist first so the button has something to call.

---

## Part 1: Middleware — New Route

### 1A. Add a new route file: `routes/collect.js`

This route receives the Sales Order ID from Zoho, fetches the balance, and pushes a payment to the Helcim terminal.

```javascript
'use strict';

var express = require('express');
var helcimLib = require('../lib/helcim');
var zohoApi = require('../lib/zoho-api');
var cache = require('../lib/cache');
var log = require('../lib/logger');
var eventLog = require('../lib/eventLog');
var C = require('../lib/constants');

var zohoGet = zohoApi.zohoGet;
var zohoPut = zohoApi.zohoPut;
var zohoPost = zohoApi.zohoPost;

var router = express.Router();

// Idempotency TTL — prevents double-sends if button is clicked twice
var COLLECT_IDEM_TTL = 300; // 5 minutes

/**
 * POST /api/pos/collect
 *
 * Called by the Zoho Inventory custom button (Deluge invokeUrl).
 * Sends the Sales Order balance to the Helcim Smart Terminal.
 *
 * Body:
 *   { salesorder_id: string }
 *
 * Auth:
 *   x-api-key header (same API_SECRET_KEY used by all mutating routes)
 */
router.post('/api/pos/collect', function (req, res) {
  var soId = req.body && req.body.salesorder_id;

  // ── Validate input ──────────────────────────────────────────────
  if (!soId || typeof soId !== 'string' || soId.trim().length === 0) {
    return res.status(400).json({ error: 'salesorder_id is required' });
  }
  soId = soId.trim();

  // ── Check terminal is configured ────────────────────────────────
  if (!helcimLib.isTerminalEnabled()) {
    log.error('[collect] Terminal not configured');
    return res.status(503).json({ error: 'Helcim terminal is not configured' });
  }

  // ── Idempotency: prevent double-click ───────────────────────────
  var idemKey = C.CACHE_KEYS.COLLECT_IDEM_PREFIX + soId;

  cache.get(idemKey)
    .then(function (existing) {
      if (existing) {
        log.info('[collect] Duplicate request for SO ' + soId + ', already pending');
        return res.status(409).json({
          error: 'Payment already sent to terminal for this order',
          status: 'pending'
        });
      }

      // ── Fetch Sales Order from Zoho ───────────────────────────
      return zohoGet('/salesorders/' + soId).then(function (data) {
        var so = data.salesorder || {};
        var balance = parseFloat(so.balance) || 0;
        var soNumber = so.salesorder_number || soId;
        var status = (so.status || '').toLowerCase();

        // Guard: don't collect on already-paid or void orders
        if (balance <= 0) {
          return res.status(400).json({
            error: 'Nothing to collect — balance is $' + balance.toFixed(2),
            salesorder_number: soNumber
          });
        }
        if (status === 'void' || status === 'closed') {
          return res.status(400).json({
            error: 'Cannot collect payment on a ' + status + ' order',
            salesorder_number: soNumber
          });
        }

        log.info('[collect] Sending $' + balance.toFixed(2) +
          ' to terminal for SO ' + soNumber);

        // ── Mark as pending (idempotency) ─────────────────────
        return cache.set(idemKey, JSON.stringify({
          salesorder_id: soId,
          salesorder_number: soNumber,
          amount: balance,
          sent_at: new Date().toISOString()
        }), COLLECT_IDEM_TTL).then(function () {

          // ── Push to Helcim terminal ───────────────────────────
          var idempotencyKey = helcimLib.generateIdempotencyKey();

          return helcimLib.terminalPurchase(balance, soNumber, idempotencyKey)
            .then(function (result) {

              eventLog.logEvent('collect.sent_to_terminal', {
                salesorder_id: soId,
                salesorder_number: soNumber,
                amount: balance,
                idempotencyKey: idempotencyKey
              });

              // ── Cache the SO context for the webhook handler ──
              // When the webhook fires, it needs to know which SO
              // to update. Key by the invoiceNumber (= soNumber)
              // which Helcim includes in the webhook payload.
              cache.set(
                C.CACHE_KEYS.COLLECT_PENDING_PREFIX + soNumber,
                JSON.stringify({
                  salesorder_id: soId,
                  salesorder_number: soNumber,
                  amount: balance,
                  idempotencyKey: idempotencyKey
                }),
                600 // 10 min TTL — generous for terminal timeout
              ).catch(function (err) {
                log.error('[collect] Failed to cache pending context', err);
              });

              return res.status(202).json({
                message: 'Payment sent to terminal',
                salesorder_number: soNumber,
                amount: balance,
                status: 'pending'
              });
            });
        });
      });
    })
    .catch(function (err) {
      log.error('[collect] Error processing SO ' + soId, err);

      // Clean up idempotency key on failure so staff can retry
      cache.del(idemKey).catch(function () {});

      var status = 502;
      var message = 'Failed to send payment to terminal';
      if (err.response && err.response.status === 404) {
        status = 404;
        message = 'Sales Order not found: ' + soId;
      }

      return res.status(status).json({ error: message });
    });
});

module.exports = router;
```

### 1B. Add new constants to `lib/constants.js`

```javascript
// Collect payment (Zoho SO → Helcim terminal)
COLLECT_IDEM_PREFIX:    'collect:idem:',          // + salesorder_id (5 min TTL)
COLLECT_PENDING_PREFIX: 'collect:pending:',        // + soNumber (10 min TTL)
```

### 1C. Wire the route into `server.js`

Add this line alongside the other route registrations (around line 350):

```javascript
app.use('/', require('./routes/collect'));
```

And add the payment rate limiter for it (around line 335):

```javascript
app.use('/api/pos/collect', paymentLimiter);
```

### 1D. Extend the webhook handler (`routes/webhooks.js`)

When a `cardTransaction` webhook arrives for a terminal payment that was initiated by the collect button, the handler needs to update the Sales Order in Zoho. Add this inside `handleCardTransaction`, after the existing terminal result caching:

```javascript
// ── Check if this was a "Collect Payment" terminal charge ──
if (invoiceNumber) {
  cache.get(C.CACHE_KEYS.COLLECT_PENDING_PREFIX + invoiceNumber)
    .then(function (pending) {
      if (!pending) return; // Not a collect-payment txn

      var ctx;
      try { ctx = JSON.parse(pending); } catch (e) { return; }

      if (status === 'APPROVED') {
        // Record payment against the Sales Order in Zoho
        zohoPost('/customerpayments', {
          customer_id: so.customer_id, // fetch from SO if needed
          payment_mode: (cardType.indexOf('debit') !== -1) ? 'debitcard' : 'creditcard',
          amount: ctx.amount,
          date: new Date().toISOString().slice(0, 10),
          reference_number: transactionId,
          notes: 'In-store pickup payment. Terminal txn: ' + transactionId,
          salesorders_to_apply: [{
            salesorder_id: ctx.salesorder_id,
            amount_applied: ctx.amount
          }]
        }).then(function () {
          eventLog.logEvent('collect.payment_recorded', {
            salesorder_id: ctx.salesorder_id,
            salesorder_number: ctx.salesorder_number,
            transactionId: transactionId,
            amount: ctx.amount
          });
        }).catch(function (err) {
          log.error('[webhooks] Failed to record collect payment for SO ' +
            ctx.salesorder_number, err);
        });

        // Clean up
        cache.del(C.CACHE_KEYS.COLLECT_PENDING_PREFIX + invoiceNumber)
          .catch(function () {});
      }

      if (status === 'DECLINED') {
        eventLog.logEvent('collect.payment_declined', {
          salesorder_id: ctx.salesorder_id,
          salesorder_number: ctx.salesorder_number
        });
        // Clean up idem key so staff can retry
        cache.del(C.CACHE_KEYS.COLLECT_IDEM_PREFIX + ctx.salesorder_id)
          .catch(function () {});
        cache.del(C.CACHE_KEYS.COLLECT_PENDING_PREFIX + invoiceNumber)
          .catch(function () {});
      }
    })
    .catch(function (err) {
      log.error('[webhooks] Error checking collect context', err);
    });
}
```

The key insight here: when `terminalPurchase` is called with `soNumber` as the `invoiceNumber`, Helcim includes that same value in the webhook payload. That's how the webhook handler knows which Sales Order to update — it looks up `collect:pending:{soNumber}` in Redis.

---

## Part 2: Zoho Inventory — Custom Button Setup

### Step 1: Navigate to custom buttons

1. Log into Zoho Inventory
2. Click the **gear icon** (Settings) in the top-right corner
3. In the left sidebar, look under **Automation** or **Preferences**
4. Click **Custom Buttons**
5. Select the **Sales Orders** module

> **Note:** Custom buttons require certain Zoho Inventory plan tiers (typically Professional and above). If you don't see the option, check your plan under Settings → Subscription.

### Step 2: Create the button

1. Click **+ New Custom Button**
2. Set the following:
   - **Button Name:** `Collect Payment at Terminal`
   - **Module:** Sales Orders
   - **Location:** Details Page (this puts the button on individual SO detail views)

### Step 3: Write the Deluge script

In the script editor, paste the following. Replace `YOUR_MIDDLEWARE_URL` and `YOUR_API_KEY` with your actual values:

```java
// ─── Collect Payment at Terminal ───────────────────────────────
// Sends this Sales Order's balance to the Helcim Smart Terminal.
// Staff clicks this when a customer arrives for pickup.

// 1. Get the Sales Order ID from the current record
salesorderId = salesorder.get("salesorder_id");
salesorderNumber = salesorder.get("salesorder_number");
balance = salesorder.get("balance").toDecimal();

// 2. Guard: check there's something to collect
if(balance <= 0)
{
    info "Nothing to collect — balance is $0.00 for " + salesorderNumber;
    return;
}

// 3. Confirm with the staff member
// (Optional but recommended — prevents accidental clicks)
// Note: alert/confirm may not be available in all Zoho contexts.
// If not supported, remove this block.

// 4. Call the middleware
headers = Map();
headers.put("Content-Type", "application/json");
headers.put("x-api-key", "YOUR_API_KEY");

body = Map();
body.put("salesorder_id", salesorderId);

response = invokeUrl
[
    url : "YOUR_MIDDLEWARE_URL/api/pos/collect"
    type : POST
    parameters : body.toString()
    headers : headers
];

// 5. Parse the response
responseMap = response.toMap();

if(response.contains("pending"))
{
    info "Payment of $" + balance + " sent to terminal for " + salesorderNumber + ". Ask the customer to tap or insert their card.";
}
else if(response.contains("already sent"))
{
    info "A payment is already pending on the terminal for " + salesorderNumber + ". Please wait for the customer to complete payment.";
}
else
{
    errorMsg = ifnull(responseMap.get("error"), "Unknown error");
    info "Could not send payment to terminal: " + errorMsg;
}
```

### Step 4: Save and test

1. Click **Save** (not "Save and Execute" — you want to test it from an actual Sales Order)
2. Go to **Sales** → **Sales Orders** and open an order that has a balance due
3. Click **More** (the three-dot menu or "More Actions" dropdown) at the top of the Sales Order
4. You should see **Collect Payment at Terminal** in the dropdown
5. Click it — your Helcim terminal should light up with the payment screen

### Step 5: What happens after the customer pays

Once the customer taps or inserts their card:

1. Helcim processes the payment
2. Helcim sends a webhook to your middleware
3. Your webhook handler sees the `collect:pending:{soNumber}` context in Redis
4. It automatically records a customer payment against the Sales Order in Zoho
5. The Sales Order status updates to reflect the payment
6. Staff can refresh the SO page to see it marked as paid

If the payment is **declined**, the idempotency key is cleared so staff can click the button again.

---

## Part 3: Security Notes

Your middleware is already well-protected for this use case:

| Layer | How it works for this route |
|---|---|
| **CORS** | Deluge `invokeUrl` is server-to-server (no browser) → no `Origin` header → passes the `!origin` check |
| **Referer guard** | Server-to-server has no `Referer` header → skipped on line 68 of `server.js` |
| **API key** | The Deluge script sends `x-api-key` in the header → checked against `API_SECRET_KEY` on line 232 |
| **Rate limiter** | The `paymentLimiter` applied in 1C prevents abuse |
| **Idempotency** | The 5-minute cache on `collect:idem:{soId}` prevents double-clicks |

**Important:** The `YOUR_API_KEY` value in the Deluge script is your `API_SECRET_KEY` env var. Deluge scripts are stored server-side in Zoho and are not visible to end users or in browser network traffic, so this is safe. However, you should still use a dedicated key if you want to rotate it independently — just add a second accepted key in the API key guard middleware.

---

## Part 4: Files to Create / Modify (Summary for Claude Code)

| Action | File | What to do |
|---|---|---|
| **CREATE** | `zoho-middleware/routes/collect.js` | New route as shown in Part 1A |
| **CREATE** | `zoho-middleware/__tests__/collect.test.js` | Unit tests (see below) |
| **MODIFY** | `zoho-middleware/lib/constants.js` | Add `COLLECT_IDEM_PREFIX` and `COLLECT_PENDING_PREFIX` |
| **MODIFY** | `zoho-middleware/server.js` | Wire route + rate limiter (lines ~335 and ~350) |
| **MODIFY** | `zoho-middleware/routes/webhooks.js` | Add collect-pending lookup in `handleCardTransaction` |

### Test cases for `__tests__/collect.test.js`

1. Happy path: valid SO with balance → calls `terminalPurchase` → returns 202
2. Missing `salesorder_id` → returns 400
3. SO balance is zero → returns 400 "Nothing to collect"
4. SO status is void → returns 400 "Cannot collect"
5. SO not found (404 from Zoho) → returns 404
6. Terminal not configured → returns 503
7. Double-click (idem key exists) → returns 409
8. Helcim `terminalPurchase` fails → returns 502, cleans up idem key
9. Zoho API failure → returns 502, cleans up idem key

---

## Part 5: Optional Enhancements (Later)

These aren't needed for v1 but are worth considering:

- **Staff polling endpoint** — `GET /api/pos/collect/status/:soNumber` that checks the `collect:pending:` cache so a frontend could show a live "waiting for payment…" → "approved!" status without needing to refresh the Zoho page.

- **Terminal cancel handling** — if the `terminalCancel` webhook fires for a collect-payment transaction, clean up the idempotency key and optionally update the SO with a note ("Payment cancelled at terminal").

- **Partial payment support** — allow the button to accept a custom amount instead of always charging the full balance (useful for split payments or deposits on pickup).

- **Zoho workflow rule backup** — add a workflow rule that sends a notification email to staff if a Sales Order has been in "Collect Payment" status for more than 15 minutes (indicating the terminal flow may have stalled).
