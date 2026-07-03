'use strict';

/**
 * Shared closed-on-Redis-error helper — 52-01 (RESIL-01)
 *
 * The single place that decides open-vs-closed when a guarded Redis
 * operation throws. Mirrors the discriminated-result contract of
 * lib/money-path.js (acquireIdempotencyLock / assertTxnNotReplayed) so
 * every caller reads the same `{ status: ... }` shape — never a thrown
 * error on the guarded path.
 *
 * This is the substrate for 52-02 (M1 promo / M4 rate-limit mid-op /
 * M5 rate-limit loopback skip) — those call-sites wrap their Redis op
 * in closedOnRedisError instead of hand-rolling their own try/catch,
 * so the fail-closed decision cannot drift per call-site again.
 */

var log = require('./logger');

/**
 * Run `fn` (a function returning a Promise) and normalize the outcome to a
 * discriminated result. Never throws.
 *
 * @param {function(): Promise<*>} fn - Guarded Redis operation
 * @param {object} [opts]
 * @param {boolean} [opts.isProd]       - Overrides NODE_ENV detection for prod/dev split
 * @param {boolean} [opts.alwaysClosed] - Always fail closed on error, regardless of isProd
 *                                        (matches assertTxnNotReplayed's no-dev-distinction rule)
 * @param {*}       [opts.devFallback]  - Value returned as { status: 'value', value } when
 *                                        failing open in dev (isProd:false, not alwaysClosed)
 * @param {string}  [opts.label]        - Prefix for the warn log (defaults to 'redis-guard')
 * @returns {Promise<{status: 'value', value: *} | {status: 'failclosed'}>}
 */
async function closedOnRedisError(fn, opts) {
  var options = opts || {};
  var isProd = ('isProd' in options) ? !!options.isProd : (process.env.NODE_ENV === 'production');
  var label = options.label || 'redis-guard';

  try {
    var value = await fn();
    return { status: 'value', value: value };
  } catch (e) {
    if (options.alwaysClosed || isProd) {
      log.warn('[' + label + '] Redis unavailable — fail closed: ' + e.message);
      return { status: 'failclosed' };
    }
    log.warn('[' + label + '] Redis unavailable — allowing through (dev): ' + e.message);
    return { status: 'value', value: options.devFallback };
  }
}

module.exports = {
  closedOnRedisError: closedOnRedisError
};
