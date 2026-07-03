var express = require('express');
var helcimLib = require('../lib/helcim');
var calcom = require('../lib/calcom');
var cache = require('../lib/cache');
var log = require('../lib/logger');
var eventLog = require('../lib/eventLog');
var zohoApi = require('../lib/zoho-api');
var zohoPost = zohoApi.zohoPost;
var C = require('../lib/constants');
var reconcile = require('../lib/reconcile');
var Sentry = require('@sentry/node');

var router = express.Router();

// TTL for terminal result cache entries (used by kiosk polling fallback)
var TERMINAL_RESULT_TTL = 300; // 5 minutes

/**
 * POST /api/webhooks/terminal
 * Receive and process Helcim webhook events.
 *
 * Helcim sends events for: cardTransaction (purchase/refund/void), terminalCancel.
 * Payload is minimal JSON: { id, type }. Full details fetched via API if needed.
 *
 * Signature verification uses HMAC-SHA256 with HELCIM_WEBHOOK_SECRET.
 * Configured in Helcim Hub > Integrations > Webhooks.
 *
 * Security: raw body is required for signature verification.
 * Captured via express.json({ verify }) callback in server.js (req.rawBody).
 */
router.post(['/api/webhooks/terminal', '/webhooks/terminal'], function (req, res) {
  var webhookId = req.headers['webhook-id'] || '';
  var timestamp = req.headers['webhook-timestamp'] || '';
  var signature = req.headers['webhook-signature'] || '';
  // rawBody captured by express.json verify callback in server.js
  var rawBody = req.rawBody ? req.rawBody.toString() : '';

  // Verify HMAC-SHA256 signature
  if (!helcimLib.verifyWebhookSignature(webhookId, timestamp, rawBody, signature)) {
    log.warn('[webhook/helcim] Invalid signature — rejected (body_len=' + rawBody.length + ')');
    return res.status(403).json({ error: 'Invalid signature' });
  }

  // Body already parsed by express.json()
  var event = req.body;

  // Respond 200 immediately — process asynchronously to avoid webhook timeout
  res.status(200).json({ received: true });

  var eventType = event.type || '';
  var eventId = event.id || '';

  log.info('[webhook/helcim] Event received: type=' + eventType + ' id=' + eventId);
  eventLog.logEvent('helcim.webhook_received', { type: eventType, id: eventId });

  if (eventType === 'cardTransaction') {
    handleCardTransaction(event);
  } else if (eventType === 'terminalCancel') {
    handleTerminalCancel(event);
  } else {
    log.info('[webhook/helcim] Unhandled event type: ' + eventType);
  }
});

/**
 * Handle cardTransaction webhook events.
 * These fire for purchases, refunds, and voids on both online and terminal transactions.
 *
 * Helcim sends a MINIMAL payload: { id, type:'cardTransaction' }. The event.data
 * fields (status, invoiceNumber, etc.) are NOT included. We resolve the full
 * transaction via the API as the primary path, falling back to the device-pending
 * Redis key if the API is unavailable (e.g. token missing read scope).
 *
 * For terminal purchases: cache helcim:terminal:result:{invoiceNumber} so kiosk
 * polling resolves and the frontend confirmSale fires with the real transactionId.
 *
 * The collect-payment flow (POST /api/pos/collect) is a separate flow that also
 * uses this handler to record a Zoho customerpayment. That recording logic is
 * preserved unchanged — it runs after invoice+status are resolved.
 *
 * IMPORTANT: this handler must NOT record a Zoho payment for the kiosk/sale flow.
 * Kiosk Zoho invoice creation happens in POST /api/kiosk/sale/confirm — triggered
 * by the frontend after the poll resolves. Double-recording must be avoided.
 */
function handleCardTransaction(event) {
  var transactionId = event.id || '';

  log.info('[webhook/helcim] cardTransaction: resolving txn=' + transactionId);

  // PRIMARY: fetch full transaction details from the Helcim API
  helcimLib.getCardTransactionById(transactionId).then(function (txnData) {
    var status = (txnData.status || '').toUpperCase();
    var invoiceNumber = txnData.invoiceNumber || '';
    var cardType = txnData.cardType || '';

    log.info('[webhook/helcim] cardTransaction: status=' + status +
      ' txn=' + transactionId + ' invoice=' + invoiceNumber);

    processCardTransactionResult(transactionId, status, invoiceNumber, cardType);
  }).catch(function (apiErr) {
    // FALLBACK: API unavailable — attempt to correlate via device-pending invoice
    var statusCode = apiErr.response ? apiErr.response.status : null;
    log.warn('[webhook/helcim] cardTransaction: API lookup failed (' +
      (statusCode || apiErr.message) + ') for txn=' + transactionId + ' — trying device-pending fallback');

    helcimLib.getPendingInvoiceForDevice().then(function (pendingInvoice) {
      if (!pendingInvoice) {
        log.warn('[webhook/helcim] cardTransaction: API unavailable and no device-pending invoice — cannot correlate txn=' + transactionId + ', dropping event');
        return;
      }
      // WR-07: Do NOT synthesise APPROVED from an API failure.
      //
      // The original assumption — "Helcim creates a card-transaction record only
      // on an approved auth" — is plausible but unverifiable when the API is down.
      // If it is wrong (declined/voided event hitting this fallback), caching APPROVED
      // would set approved:true in the terminal-result store, resolve the kiosk poll
      // as 'approved', and cause /confirm to create a paid Zoho invoice for an
      // uncaptured payment (phantom revenue).
      //
      // Fix: cache status 'UNCONFIRMED' (approved:false).  The kiosk poll handler
      // returns { status: 'pending' } for any non-APPROVED, non-DECLINED status,
      // so the client keeps polling until POLL_TIMEOUT_MS (45 s) and then shows
      // the manual-confirm fallback button.  Staff can confirm manually if the
      // card was genuinely approved, or cancel if not.
      //
      // The reconcile/API-retry path (webhook retry, 5-min sweep) will establish
      // the real status once the Helcim API is back online.
      //
      // Open question (WR-07 / money decision): if Helcim retries the webhook after
      // the API recovers and calls reconcilePendingCharge for a genuinely-approved
      // txn while staff has not yet manually confirmed (pending record still
      // present, MIN_ORPHAN_AGE elapsed), reconcile may void a valid charge.
      // This is documented in 45-FIX2-SUMMARY.md under "Open Money Question".
      log.warn('[webhook/helcim] cardTransaction: API unavailable — caching UNCONFIRMED' +
        ' for invoice=' + pendingInvoice + '; kiosk poll will keep waiting;' +
        ' reconcile/retry will establish real status once API is available');
      processCardTransactionResult(transactionId, 'UNCONFIRMED', pendingInvoice, '');
    }).catch(function (fbErr) {
      log.warn('[webhook/helcim] cardTransaction: device-pending fallback failed: ' + fbErr.message);
    });
  });
}

/**
 * Process a resolved card transaction result: cache the terminal result and
 * handle the collect-pending flow if applicable.
 *
 * @param {string} transactionId  - Helcim transaction ID
 * @param {string} status         - Uppercase status ('APPROVED', 'DECLINED', etc.)
 * @param {string} invoiceNumber  - Invoice/reference number
 * @param {string} cardType       - Card type string (e.g. 'Visa', 'Debit')
 */
function processCardTransactionResult(transactionId, status, invoiceNumber, cardType) {
  // Cache the terminal result so pos.js polling fallback resolves immediately.
  // NOTE: store a JSON STRING (not a raw object) — cache.set JSON.stringifies and
  // cache.get JSON.parses, and pollTerminalResult JSON.parses the get result a
  // SECOND time. The working terminalCancel path uses this same double-stringify
  // convention; passing a raw object here makes pollTerminalResult's parse throw
  // and silently miss the cache.
  if (invoiceNumber) {
    var cacheKey = 'helcim:terminal:result:' + invoiceNumber;
    cache.set(cacheKey, JSON.stringify({
      status: status,
      transactionId: transactionId,
      approved: status === 'APPROVED',
      cardType: cardType
    }), TERMINAL_RESULT_TTL).catch(function (err) {
      log.warn('[webhook/helcim] Failed to cache terminal result: ' + err.message);
    });

    // Clear the device-pending key now that we've consumed it
    helcimLib.getPendingInvoiceForDevice().then(function (pendingInvoice) {
      if (pendingInvoice && pendingInvoice === invoiceNumber) {
        var deviceCode = helcimLib.getDeviceCode();
        if (deviceCode) {
          cache.del('helcim:terminal:pending:' + deviceCode).catch(function () {});
        }
      }
    }).catch(function () {});
  }

  eventLog.logEvent('helcim.card_transaction', {
    status: status,
    txnId: transactionId,
    invoiceNumber: invoiceNumber
  });

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
          salesorders_to_apply: [{
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
      } else if (status === 'DECLINED') {
        eventLog.logEvent('collect.payment_declined', {
          soId: ctx.salesorder_id,
          soNumber: ctx.salesorder_number,
          txnId: transactionId,
          amount: ctx.amount
        });
        // Clean up both pending and idempotency keys so staff can retry
        var idemKey = C.CACHE_KEYS.COLLECT_IDEM_PREFIX + ctx.idempotencyKey;
        return Promise.all([cache.del(pendingKey), cache.del(idemKey)]);
      }
    }).catch(function (err) {
      log.warn('[webhook/helcim] Collect-pending handling failed: ' + err.message);
    });
  }

  // D-13: Reconcile kiosk pending charges (45-08 backstop).
  // For APPROVED transactions: if there is a KIOSK_PENDING_CHARGE_PREFIX record
  // for this invoiceNumber and no matching Zoho order was created (late approval),
  // auto-void or flag for manual review.
  // Runs after the 200 response (fire-and-forget, preserving respond-200-before-async).
  if (status === 'APPROVED' && invoiceNumber) {
    reconcile.reconcilePendingCharge(transactionId).catch(function (err) {
      log.warn('[webhook/helcim] Kiosk pending charge reconcile error: ' + err.message);
      Sentry.captureException(err, {
        level: 'error',
        tags: { txnId: transactionId, invoiceNumber: invoiceNumber || null }
      });
    });
  }
}

/**
 * Handle terminalCancel webhook events.
 * Fires when a customer or cashier cancels a pending terminal transaction.
 * Cache the cancellation so kiosk polling resolves with CANCELLED status.
 *
 * Helcim sends invoiceNumber as empty string in cancel events, so we look up
 * the pending invoice by device code (cached during terminalPurchase).
 */
function handleTerminalCancel(event) {
  var data = event.data || {};
  var invoiceNumber = data.invoiceNumber || '';
  var deviceCode = data.deviceCode || helcimLib.getDeviceCode() || '';

  log.info('[webhook/helcim] terminalCancel: invoice=' + invoiceNumber + ' device=' + deviceCode);

  var cancelResult = JSON.stringify({
    status: 'CANCELLED',
    transactionId: null,
    approved: false,
    cardType: ''
  });

  function cacheCancel(ref) {
    if (!ref) return;
    var cacheKey = 'helcim:terminal:result:' + ref;
    cache.set(cacheKey, cancelResult, TERMINAL_RESULT_TTL).then(function () {
      log.info('[webhook/helcim] Cached cancel for ref=' + ref);
    }).catch(function (err) {
      log.warn('[webhook/helcim] Failed to cache terminal cancel: ' + err.message);
    });
  }

  if (invoiceNumber) {
    cacheCancel(invoiceNumber);
  } else if (deviceCode) {
    // Look up pending invoice by device code
    cache.get('helcim:terminal:pending:' + deviceCode).then(function (pendingRef) {
      if (pendingRef) {
        cacheCancel(pendingRef);
        cache.del('helcim:terminal:pending:' + deviceCode).catch(function () {});
      } else {
        log.warn('[webhook/helcim] terminalCancel: no pending invoice found for device=' + deviceCode);
      }
    }).catch(function () {});
  }

  eventLog.logEvent('helcim.terminal_cancel', { invoiceNumber: invoiceNumber, deviceCode: deviceCode });
}

/**
 * POST /api/webhooks/calcom
 * Receive and process Cal.com webhook events.
 *
 * Cal.com fires events for: BOOKING_CREATED, BOOKING_CANCELLED, BOOKING_RESCHEDULED.
 * Payload includes triggerEvent + payload (with booking start datetime).
 *
 * Signature verification uses HMAC-SHA256 with CALCOM_WEBHOOK_SECRET.
 * Header: x-cal-signature-256 (single header, hex digest over raw body).
 *
 * Security: raw body is required for signature verification.
 * Captured via express.json({ verify }) callback in server.js (req.rawBody).
 *
 * Guard exemptions (server.js):
 *   - API key: req.path.indexOf('/webhooks/') === 0 -> exempt (line 239)
 *   - Referer: !req.headers.referer -> skip (line 73); Cal.com sends no Referer
 *
 * T-25-07: forged webhook — mitigated by HMAC-SHA256 + 401 on mismatch
 * T-25-08: guard bypass — mitigated by dual-path /webhooks/ exemption
 * T-25-10: slow processing — mitigated by 200-before-async pattern
 */
router.post(['/api/webhooks/calcom', '/webhooks/calcom'], function (req, res) {
  var signature = req.headers['x-cal-signature-256'] || '';
  // rawBody captured by express.json verify callback in server.js
  var rawBody = req.rawBody ? req.rawBody.toString() : '';

  // Verify HMAC-SHA256 signature
  if (!calcom.verifyWebhook(rawBody, signature)) {
    log.warn('[webhook/calcom] Invalid signature — rejected (body_len=' + rawBody.length + ')');
    return res.status(403).json({ error: 'Invalid signature' });
  }

  // Respond 200 immediately — process asynchronously to avoid webhook timeout
  res.status(200).json({ received: true });

  var body = req.body || {};
  var triggerEvent = body.triggerEvent || '';

  log.info('[webhook/calcom] Event received: triggerEvent=' + triggerEvent);
  eventLog.logEvent('calcom.webhook_received', { triggerEvent: triggerEvent });

  if (triggerEvent === 'BOOKING_CANCELLED') {
    handleCalcomCancellation(body);
  } else {
    // BOOKING_CREATED, BOOKING_RESCHEDULED: log only — idempotent, no destructive effects
    log.info('[webhook/calcom] Received ' + (triggerEvent || 'unknown') + ' — no side effects');
  }
});

/**
 * Handle BOOKING_CANCELLED webhook events.
 * Invalidates the cached slots and availability for the affected date so freed
 * slots reappear on the next client request.
 *
 * Field path fallbacks (RESEARCH Assumption A2 — confirmed empirically in Plan 04):
 *   1. payload.startTime
 *   2. payload.booking.start
 *   3. payload.start
 * If none yield a parseable ISO date, logs a warning and skips cache deletion.
 *
 * @param {Object} body - Parsed webhook body (req.body)
 */
function handleCalcomCancellation(body) {
  var payload = body.payload || {};

  // Derive the YYYY-MM-DD date string from the booking start — try three field paths
  var rawDate = payload.startTime ||
    (payload.booking && payload.booking.start) ||
    payload.start ||
    '';

  var date = '';
  if (rawDate) {
    // Accepts ISO-8601 strings; slice to 10 chars gives YYYY-MM-DD
    var parsed = new Date(rawDate);
    if (!isNaN(parsed.getTime())) {
      date = rawDate.toString().slice(0, 10);
    }
  }

  if (!date) {
    log.warn('[webhook/calcom] BOOKING_CANCELLED: could not derive date from payload — skipping cache invalidation');
    return;
  }

  var yearMonth = date.substring(0, 7); // YYYY-MM

  cache.del(C.CACHE_KEYS.SLOTS_PREFIX + date).catch(function (err) {
    log.warn('[webhook/calcom] Failed to delete slots cache for ' + date + ': ' + err.message);
  });
  cache.del(C.CACHE_KEYS.AVAILABILITY_PREFIX + yearMonth).catch(function (err) {
    log.warn('[webhook/calcom] Failed to delete availability cache for ' + yearMonth + ': ' + err.message);
  });

  log.info('[webhook/calcom] BOOKING_CANCELLED: invalidated cache for date=' + date + ' month=' + yearMonth);
  eventLog.logEvent('calcom.booking_cancelled', { date: date, month: yearMonth });
}

module.exports = router;
