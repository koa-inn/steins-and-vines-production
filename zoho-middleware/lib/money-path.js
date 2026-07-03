'use strict';

/**
 * Shared money-path safety primitives — D-11
 *
 * Extracted from routes/checkout.js so that routes/checkout.js and
 * routes/pos.js share a single source of truth for:
 *   - Idempotency lock acquisition (acquireIdempotencyLock)
 *   - Transaction-ID replay guard (assertTxnNotReplayed / markTxnUsed)
 *   - Void-before-reject (rejectWithVoid)
 *   - Void-on-failure with timeout (voidWithTimeout)
 *
 * Lazy-require pattern mirrors lib/checkout-helpers.js:
 *   - External dependencies are required at call time, not at module load.
 *   - This avoids circular dependencies and makes Jest mocking transparent.
 *
 * pos.js is wired to this lib in plans 45-06 / 45-07 / 45-08.
 * DO NOT modify the exported function signatures without updating those plans.
 */

var log = require('./logger');
var eventLog = require('./eventLog');
var Sentry = require('@sentry/node');

// Lazy-require helpers — called once per function invocation if deps not provided
function getHelcim() { return require('./helcim'); }
function getMailer() { return require('./mailer'); }
function getWithTimeout() { return require('./checkout-helpers').withTimeout; }

/** Default idempotency key TTL (seconds) — matches checkout.js constant */
var CHECKOUT_IDEMPOTENCY_TTL = 600; // 10 minutes

/**
 * Acquire an idempotency lock for a checkout request.
 *
 * Replicates the lock gate from routes/checkout.js (lines 158-185).
 *
 * @param {object} cacheLib  - lib/cache instance (pass explicitly for testability)
 * @param {string} key       - Idempotency key from the request
 * @param {number} ttl       - Lock TTL in seconds (default: CHECKOUT_IDEMPOTENCY_TTL)
 * @param {object} [opts]    - { isProd?: boolean } — overrides NODE_ENV detection
 * @returns {Promise<{status: 'replay'|'acquired'|'contention'|'failclosed', cached?}>}
 *
 * Discriminated results:
 *   replay      — key already cached; caller should return 201 with result.cached
 *   acquired    — lock acquired; caller should proceed to checkout
 *   contention  — lock already held (concurrent duplicate) → caller returns 409
 *   failclosed  — Redis error in production → caller returns 409 (fail-CLOSED)
 *
 * In development (NODE_ENV unset / non-production), Redis errors return 'acquired'
 * (fail-OPEN) for local development convenience.
 */
async function acquireIdempotencyLock(cacheLib, key, ttl, opts) {
  var options = opts || {};
  var isProd = ('isProd' in options) ? !!options.isProd : (process.env.NODE_ENV === 'production');
  var lockTtl = ttl || CHECKOUT_IDEMPOTENCY_TTL;

  try {
    var cached = await cacheLib.get(key);
    if (cached) {
      log.info('[money-path] Idempotent replay: ' + key);
      return { status: 'replay', cached: cached };
    }
    var lockAcquired = await cacheLib.acquireLock(key, lockTtl);
    if (!lockAcquired) {
      return { status: 'contention' };
    }
    return { status: 'acquired' };
  } catch (e) {
    if (isProd) {
      log.warn('[money-path] Redis unavailable for idempotency-key lock — rejecting in prod (fail closed): ' + e.message);
      return { status: 'failclosed' };
    }
    log.warn('[money-path] Redis unavailable for idempotency-key lock — allowing through (dev): ' + e.message);
    return { status: 'acquired' };
  }
}

/**
 * Assert that a Helcim transaction ID has not already been processed.
 *
 * Replicates routes/checkout.js lines 248-270.
 * ALWAYS fails CLOSED on Redis error — a charged transactionId must never
 * create a duplicate Zoho order, regardless of environment.
 *
 * @param {object} cacheLib     - lib/cache instance
 * @param {string} transactionId - Helcim transaction ID to check
 * @param {string} [suffix]     - Cart-key suffix (e.g. ':sv-cart-ferment')
 * @returns {Promise<{status: 'ok'|'replay'|'failclosed'}>}
 */
async function assertTxnNotReplayed(cacheLib, transactionId, suffix) {
  var txnKey = 'helcim:txn:' + transactionId + (suffix || '');
  try {
    var existing = await cacheLib.get(txnKey);
    if (existing) {
      log.warn('[money-path] Replay attack detected — transaction_id already used: ' + transactionId);
      return { status: 'replay' };
    }
    return { status: 'ok' };
  } catch (e) {
    // Redis unavailable — fail closed always: a charged transactionId must never
    // create a duplicate Zoho order (no dev/prod distinction for the replay guard)
    log.warn('[money-path] Redis unavailable for transactionId replay check — rejecting (fail closed): ' + e.message);
    return { status: 'failclosed' };
  }
}

/**
 * Mark a Helcim transaction ID as used in Redis.
 *
 * Replicates routes/checkout.js lines 718-724.
 * Call immediately after a successful Zoho order creation.
 * Failures are swallowed (best-effort — the order is already created).
 *
 * @param {object} cacheLib     - lib/cache instance
 * @param {string} transactionId - Helcim transaction ID
 * @param {string} [suffix]     - Cart-key suffix (e.g. ':sv-cart-ferment')
 * @param {number} [ttl]        - TTL in seconds (default: 86400 = 24 hours)
 * @returns {Promise<void>}
 */
function markTxnUsed(cacheLib, transactionId, suffix, ttl) {
  var txnKey = 'helcim:txn:' + transactionId + (suffix || '');
  return cacheLib.set(txnKey, 'used', ttl || 86400).catch(function () {});
}

/**
 * Reject a checkout request, voiding any already-charged Helcim payment first.
 *
 * Replicates routes/checkout.js lines 45-61.
 *
 * The card is charged inside the HelcimPay iframe BEFORE the route handler runs.
 * A bare res.status(4xx) reject would orphan the charge (money taken, no order,
 * no void) — exactly the Jun 2026 incident (Helcim 50641064 / INV-000118).
 *
 * Fire-and-forget: the void runs asynchronously; the rejection response is sent
 * immediately. sendVoidFailureAlert is called if the void itself fails.
 *
 * Only attempts a void when a plausibly-valid payment_token is present.
 *
 * @param {object} res      - Express response object
 * @param {object} body     - Request body (used to read body.payment_token)
 * @param {number} status   - HTTP status code to send (e.g. 400)
 * @param {string} errorMsg - Error message for the response body
 * @param {object} [deps]   - { helcim?, mailer? } — lazily defaulted from lib/
 */
function rejectWithVoid(res, body, status, errorMsg, deps) {
  var helcim = (deps && deps.helcim) || getHelcim();
  var mailer = (deps && deps.mailer) || getMailer();
  var token = body && body.payment_token;
  if (typeof token === 'string' && token.length > 0 && token.length <= 500 && helcim.isEnabled()) {
    log.error('[money-path] Early reject after charge — voiding txn=' + token +
      ' (' + status + ': ' + errorMsg + ')');
    eventLog.logEvent('checkout.void_early_reject', {
      status: status,
      reason: String(errorMsg).substring(0, 80)
    });
    helcim.voidTransaction(token).catch(function (vErr) {
      log.error('[money-path] Void after early reject failed for txn=' + token + ': ' + vErr.message);
      Sentry.captureException(vErr, {
        level: 'error',
        tags: { reqId: (deps && deps.reqId) || null, txnId: token, phase: 'void_early_reject' }
      });
      mailer.sendVoidFailureAlert({
        txnId: token,
        amount: 0,
        error: 'Early validation reject (' + status + ': ' + errorMsg + ') — void failed: ' + vErr.message,
        timestamp: new Date().toISOString()
      }).catch(function () {});
    });
  }
  return res.status(status).json({ error: errorMsg });
}

/**
 * Void a Helcim transaction wrapped in a timeout.
 *
 * Replicates routes/checkout.js lines 825-873 (the void-on-failure block).
 * Returns a promise that resolves when the void has settled (success, timeout,
 * or failure) so callers can send the HTTP response in a .then() continuation.
 *
 * Timeout handling (mirrors checkout.js:846):
 *   - Timeout: logs for manual reconciliation; does NOT send a mailer alert.
 *   - Non-timeout error: logs CRITICAL + fires sendVoidFailureAlert.
 *
 * @param {object} helcimLib  - lib/helcim instance (pass explicitly)
 * @param {string} token      - Helcim transactionId to void
 * @param {number} amount     - Order amount (for alert payload)
 * @param {object} [opts]     - { withTimeout?, mailer?, eventLog?, timeoutMs? }
 * @returns {Promise<void>}
 */
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
        eventLogDep.logEvent('checkout.void_fired', {
          txnId: token,
          voidResult: 'declined'
        });
      } else {
        log.info('[money-path] Voided txn=' + token);
        eventLogDep.logEvent('checkout.void_fired', {
          txnId: token,
          voidResult: 'success'
        });
      }
    })
    .catch(function (voidErr) {
      if (voidErr && voidErr.message && voidErr.message.indexOf('Timeout') === 0) {
        // Timeout — log for manual reconciliation; no mailer alert (checkout.js:846)
        log.error('[money-path] Helcim void timed out — manual void required for txn=' + token +
          ': ' + voidErr.message);
        Sentry.captureException(voidErr, {
          level: 'error',
          tags: { reqId: deps.reqId || null, txnId: token, phase: 'void_failed' }
        });
      } else {
        // Non-timeout failure — CRITICAL: alert staff immediately
        var voidFailTs = new Date().toISOString();
        log.error('[money-path] CRITICAL: Void failed for txn=' + token + ': ' + voidErr.message);
        Sentry.captureException(voidErr, {
          level: 'error',
          tags: { reqId: deps.reqId || null, txnId: token, phase: 'void_failed' }
        });
        eventLogDep.logEvent('checkout.void_failed', {
          txnId: token,
          voidError: voidErr.message
        });
        return mailerDep.sendVoidFailureAlert({
          txnId: token,
          amount: amount,
          error: voidErr.message,
          timestamp: voidFailTs
        }).catch(function (mailErr) {
          log.error('[money-path] Void failure alert email failed: ' + mailErr.message);
        });
      }
    });
}

module.exports = {
  CHECKOUT_IDEMPOTENCY_TTL: CHECKOUT_IDEMPOTENCY_TTL,
  acquireIdempotencyLock: acquireIdempotencyLock,
  assertTxnNotReplayed: assertTxnNotReplayed,
  markTxnUsed: markTxnUsed,
  rejectWithVoid: rejectWithVoid,
  voidWithTimeout: voidWithTimeout
};
