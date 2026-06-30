'use strict';

// ---------------------------------------------------------------------------
// lib/reconcile.js — D-13 Helcim↔Zoho orphan-charge reconciliation backstop
//
// Closes the late-approval window that synchronous void-on-failure (45-06/07)
// cannot catch: a terminal may approve a charge AFTER the 90-second polling
// timeout, leaving the customer charged with no matching Zoho order.
//
// Two entry points:
//   reconcilePendingCharge(transactionId, deps)
//     Called by the webhook handler (routes/webhooks.js) when a late Helcim
//     approval arrives for a kiosk/sale or salesorder-pay charge.
//     Has the transactionId → can auto-void or persist sv:void-failure record.
//
//   sweepPendingCharges(deps)
//     Called by setInterval in server.js every 5 minutes as a backstop for
//     failed webhook deliveries.  Reads the helcim:terminal:result cache
//     (set by the webhook handler) to extract the transactionId; if unavailable
//     but the record is old enough, flags for manual review.
//     No-ops cleanly when Redis is disconnected.
//
// Keying convention (from 45-07):
//   Pending cache key: KIOSK_PENDING_CHARGE_PREFIX + invoiceNumber
//   invoiceNumber = the refNumber / soNumber passed to Helcim terminalPurchase
//   (Helcim returns this as txn.invoiceNumber via getCardTransactionById)
//
// "Matching Zoho order" detection:
//   The kiosk/sale/confirm handler writes its idempotency result under
//   KIOSK_IDEM_PREFIX + 'confirm:' + idempotency_key (TTL 10 min).
//   If that key is present → confirm ran → Zoho invoice/payment was recorded.
//   The confirm handler also deletes the pending record on success (45-08 Rule 2).
//   Both signals are checked; presence of either means the charge is settled.
//
// Threat: T-45-08-ORPHAN (Repudiation / Integrity)
// ---------------------------------------------------------------------------

var log   = require('./logger');
var cache = require('./cache');
var C     = require('./constants');

var PENDING_PREFIX         = C.CACHE_KEYS.KIOSK_PENDING_CHARGE_PREFIX;
var TERMINAL_RESULT_PREFIX = 'helcim:terminal:result:';
// 30-day TTL for void-failure sentinel records (matches pos.js:1007/1664 convention)
var VOID_FAILURE_TTL = 30 * 24 * 60 * 60;
// Minimum pending-record age (seconds) before sweep flags as a potential orphan
// Chosen to be larger than the 90-second terminal polling window + a safety margin.
var MIN_ORPHAN_AGE_SECONDS = 120;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Return true if the given pending-charge context has a matching Zoho order.
 *
 * Strategy: check the confirm-level idempotency key written by
 * /api/kiosk/sale/confirm on success (KIOSK_IDEM_PREFIX + 'confirm:' + key).
 * If that cache entry is present, confirm ran and the Zoho invoice is recorded.
 *
 * The confirm handler also deletes the pending record on success (Rule 2, 45-08).
 * If the record still exists AND the confirm key is absent → treat as potential orphan.
 *
 * Returns false on any Redis error (fail-safe: treat as potential orphan, staff
 * will investigate the sv:void-failure record if we void incorrectly).
 *
 * @param {Object} ctx  Pending charge context from Redis
 * @returns {Promise<boolean>}
 */
function hasMatchingZohoOrder(ctx) {
  if (!ctx || !ctx.idempotency_key) {
    // No idempotency_key (e.g. salesorder-pay with server-generated key that was
    // never stored in an idem cache) → cannot confirm Zoho order without a Zoho call.
    // Treat as potential orphan; void will fail cleanly if already voided/settled.
    return Promise.resolve(false);
  }

  var confirmIdemKey = C.CACHE_KEYS.KIOSK_IDEM_PREFIX + 'confirm:' + ctx.idempotency_key;
  return cache.get(confirmIdemKey).then(function (val) {
    return !!val;
  }).catch(function () {
    return false; // Redis error → fail-safe (treat as potential orphan)
  });
}

/**
 * Return true if the pending record is old enough to be treated as a potential
 * orphan (i.e., outside the normal 90-second terminal approval window).
 *
 * Guards against false-positive voids on normal approvals that arrive to the
 * webhook before the kiosk frontend has finished calling /confirm.
 *
 * @param {Object} ctx  Pending charge context (must have created_at field)
 * @returns {boolean}
 */
function isOldEnough(ctx) {
  if (!ctx || !ctx.created_at) {
    // created_at missing → age unknown → treat as old (safe for orphan detection)
    return true;
  }
  var createdAt = new Date(ctx.created_at).getTime();
  if (isNaN(createdAt)) return true;  // unparseable → treat as old
  var ageSeconds = (Date.now() - createdAt) / 1000;
  return ageSeconds >= MIN_ORPHAN_AGE_SECONDS;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reconcile a single pending kiosk charge keyed by Helcim transaction ID.
 *
 * Flow:
 *   1. Fetch full txn details from Helcim (status + invoiceNumber).
 *   2. Look up KIOSK_PENDING_CHARGE_PREFIX + invoiceNumber in Redis.
 *   3a. No pending record → no-op (not our transaction / already settled).
 *   3b. Pending record exists but too recent → defer (normal flow window).
 *   4a. APPROVED + pending + no Zoho order → void; on void failure persist
 *       sv:void-failure + send staff alert.
 *   4b. APPROVED + pending + Zoho order found → clear pending (settled).
 *   5. Helcim lookup failure → leave record intact for later retry.
 *
 * @param {string} transactionId  Helcim transaction ID from the webhook event
 * @param {Object} [deps]         { helcim, mailer } — injected for testing
 * @returns {Promise<void>}
 */
function reconcilePendingCharge(transactionId, deps) {
  var helcimLib = (deps && deps.helcim)   || require('./helcim');
  var mailer    = (deps && deps.mailer)   || require('./mailer');

  if (!transactionId) return Promise.resolve();

  return helcimLib.getCardTransactionById(transactionId)
    .then(function (txnData) {
      var status        = (txnData.status || '').toUpperCase();
      var invoiceNumber = txnData.invoiceNumber || '';

      log.info('[reconcile] Resolved txn=' + transactionId +
        ' status=' + status + ' invoice=' + invoiceNumber);

      if (status !== 'APPROVED') {
        // Not approved — nothing to reconcile
        return;
      }

      if (!invoiceNumber) {
        log.warn('[reconcile] APPROVED txn=' + transactionId +
          ' has no invoiceNumber — cannot locate pending record');
        return;
      }

      var pendingKey = PENDING_PREFIX + invoiceNumber;

      return cache.get(pendingKey).then(function (ctx) {
        if (!ctx) {
          // No pending record → not a kiosk charge or already settled
          return;
        }

        // Age guard: skip if the record is too recent (normal approval window)
        if (!isOldEnough(ctx)) {
          log.info('[reconcile] Pending record for invoice=' + invoiceNumber +
            ' is too recent — deferring (normal approval window)');
          return;
        }

        return hasMatchingZohoOrder(ctx).then(function (matched) {
          if (matched) {
            // Charge was settled via /confirm — clear the pending sentinel
            log.info('[reconcile] Pending charge settled for invoice=' +
              invoiceNumber + ' txn=' + transactionId + ' — clearing record');
            return cache.del(pendingKey);
          }

          // Orphan detected: APPROVED but no Zoho order — void it
          log.warn('[reconcile] ORPHAN CHARGE DETECTED: txn=' + transactionId +
            ' invoice=' + invoiceNumber +
            ' amount=$' + (ctx.amount || 0) + ' — voiding');

          return helcimLib.voidTransaction(transactionId)
            .then(function () {
              log.info('[reconcile] Void succeeded for orphan txn=' + transactionId);
              return cache.del(pendingKey);
            })
            .catch(function (voidErr) {
              var voidFailureKey = 'sv:void-failure:' + Date.now();
              var voidFailureRecord = {
                txn_id:           transactionId,
                invoice_number:   invoiceNumber,
                amount:           ctx.amount || 0,
                reference_number: ctx.reference_number || invoiceNumber,
                error:            voidErr.message || 'unknown',
                needs_manual_review: true,
                created_at:       new Date().toISOString()
              };

              log.error('[reconcile] CRITICAL: void failed for orphan txn=' +
                transactionId + ': ' + voidErr.message + ' — flagging for manual review');

              // Persist void-failure sentinel (30-day TTL; matches pos.js:1007/1664)
              cache.set(voidFailureKey, voidFailureRecord, VOID_FAILURE_TTL)
                .catch(function () {});

              // Alert staff
              return mailer.sendVoidFailureAlert({
                txnId:     transactionId,
                amount:    ctx.amount || 0,
                error:     voidErr.message || 'unknown',
                timestamp: new Date().toISOString()
              }).catch(function (mailErr) {
                log.error('[reconcile] sendVoidFailureAlert also failed: ' +
                  mailErr.message);
              });
            });
        });
      });
    })
    .catch(function (lookupErr) {
      // Helcim lookup failed — leave the pending record intact for a later attempt
      log.warn('[reconcile] Helcim lookup failed for txn=' + transactionId +
        ' (' + (lookupErr.message || lookupErr) + ') — leaving pending record intact');
    });
}

/**
 * Sweep all kiosk pending charge records and reconcile each one.
 *
 * Primary use: catch orphan charges when webhook delivery was missed.
 * For each KIOSK_PENDING_CHARGE_PREFIX key:
 *   - If the terminal result cache (helcim:terminal:result:{invoiceNumber})
 *     is still live (300-second TTL set by processCardTransactionResult) AND
 *     the result is APPROVED → extract transactionId → call reconcilePendingCharge.
 *   - If the result cache has expired but the pending record is old enough
 *     (> MIN_ORPHAN_AGE_SECONDS) → flag for manual review (we have no transactionId
 *     to attempt an auto-void; staff will investigate).
 *
 * No-ops cleanly when Redis is disconnected.
 * Bounded: processes records sequentially to avoid Redis burst.
 *
 * @param {Object} [deps]  { helcim, mailer } — injected for testing
 * @returns {Promise<void>}
 */
function sweepPendingCharges(deps) {
  var mailer = (deps && deps.mailer) || require('./mailer');

  if (!cache.isConnected()) {
    log.info('[reconcile/sweep] Redis not connected — skipping sweep');
    return Promise.resolve();
  }

  return cache.getClient().then(function (c) {
    if (!c) return;
    return c.keys(PENDING_PREFIX + '*');
  }).then(function (keys) {
    if (!keys || keys.length === 0) return;

    log.info('[reconcile/sweep] Found ' + keys.length +
      ' pending kiosk charge(s) — checking each');

    var chain = Promise.resolve();
    keys.forEach(function (key) {
      chain = chain.then(function () {
        return cache.get(key).then(function (ctx) {
          if (!ctx || !ctx.reference_number) {
            // Malformed entry — remove it
            return cache.del(key);
          }

          var invoiceNumber  = ctx.reference_number;
          var resultCacheKey = TERMINAL_RESULT_PREFIX + invoiceNumber;

          return cache.get(resultCacheKey).then(function (rawResult) {
            // The terminal result was stored via JSON.stringify({...}) and cache.set
            // JSON.stringifies again → double-stringify.  cache.get parses once,
            // giving back a string.  Parse again to get the object.
            var parsed = null;
            if (rawResult !== null && rawResult !== undefined) {
              try {
                parsed = typeof rawResult === 'string'
                  ? JSON.parse(rawResult)
                  : rawResult;  // defensive: already an object (shouldn't happen)
              } catch (e) {
                parsed = null;
              }
            }

            if (parsed && parsed.transactionId && parsed.approved) {
              // Terminal result cached and APPROVED — reconcile
              log.info('[reconcile/sweep] Terminal result found for invoice=' +
                invoiceNumber + ' txn=' + parsed.transactionId + ' — reconciling');
              return reconcilePendingCharge(parsed.transactionId, deps);
            }

            // No terminal result cached.
            // If the record is old enough, flag for manual review.
            if (!isOldEnough(ctx)) {
              // Too recent — still within normal window, skip
              return;
            }

            // Old pending record with no known terminal result → flag for review
            var voidFailureKey = 'sv:void-failure:' + Date.now();
            var flagRecord = {
              reference_number:      ctx.reference_number,
              amount:                ctx.amount || 0,
              salesorder_id:         ctx.salesorder_id || null,
              needs_manual_review:   true,
              reason:                'pending_charge_no_terminal_result',
              original_created_at:   ctx.created_at || null,
              created_at:            new Date().toISOString()
            };

            log.warn('[reconcile/sweep] POTENTIAL ORPHAN (no terminal result): ' +
              'pending charge invoice=' + invoiceNumber +
              ' amount=$' + (ctx.amount || 0) + ' — flagging for manual review');

            cache.set(voidFailureKey, flagRecord, VOID_FAILURE_TTL)
              .catch(function () {});

            return mailer.sendVoidFailureAlert({
              txnId:     invoiceNumber,
              amount:    ctx.amount || 0,
              error:     'pending_charge_no_terminal_result',
              timestamp: new Date().toISOString()
            }).catch(function (mailErr) {
              log.error('[reconcile/sweep] Alert failed: ' + mailErr.message);
            });
          });
        }).catch(function (err) {
          log.warn('[reconcile/sweep] Error processing key=' + key +
            ': ' + (err.message || err));
        });
      });
    });

    return chain;
  }).catch(function (err) {
    log.warn('[reconcile/sweep] Sweep failed: ' + (err.message || err));
  });
}

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

module.exports = {
  reconcilePendingCharge: reconcilePendingCharge,
  sweepPendingCharges:    sweepPendingCharges
};
