'use strict';

// Money-path safety wrapper around Sentry.captureException (WR-01).
//
// Money-movement catch blocks report to Sentry *before* running the
// orphan-charge void-on-failure logic. Sentry's SDK contract says
// captureException never throws — but the money path must not depend on an
// external library's implicit guarantee: if it ever did throw (SDK bug, a
// serializer choking on a circular tag/extra, OOM), it would strand a charge
// (money taken, no order, no void). Wrapping the call makes "telemetry can
// never interrupt a void" explicit and testable, and centralises the one
// @sentry/node import the money path needs.

var Sentry = require('@sentry/node');

/**
 * Capture an exception to Sentry without ever throwing into the caller.
 *
 * @param {Error} err - the error to report
 * @param {object} [options] - Sentry capture options (level, tags, …)
 * @returns {string|undefined} the Sentry event id, or undefined if capture failed
 */
function captureExceptionSafe(err, options) {
  try {
    return Sentry.captureException(err, options);
  } catch {
    // Never let telemetry block a money-safety path (void, refund, etc).
    return undefined;
  }
}

module.exports = { captureExceptionSafe: captureExceptionSafe };
