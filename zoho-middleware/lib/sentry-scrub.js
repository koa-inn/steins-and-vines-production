'use strict';

// Sentry `beforeSend` PII scrub + error-class fingerprint (D-03, D-04).
//
// Pure functions — no Sentry SDK import, no network — so they unit-test
// directly. Mirrors lib/redact.js's "mask, don't drop" convention: emails
// are masked (j***@gmail.com), not replaced with an opaque [REDACTED].
//
// scrubEvent(event) deletes anything that could carry a customer email or a
// raw payment amount before the event leaves the process, while preserving
// safe correlation ids (reqId, txnId, invoice/SO id) so money-path issues
// stay debuggable in Sentry.

var redact = require('./redact');

var EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
var MONEY_KEY_RE = /amount|total|price|balance|grandtotal/i;
var SAFE_ID_ALLOWLIST = [
  'reqId',
  'txnId',
  'invoiceId',
  'invoice_id',
  'salesOrderId',
  'salesorder_id'
];

function isAllowlisted(key) {
  return SAFE_ID_ALLOWLIST.indexOf(key) !== -1;
}

// Mask any email-shaped string value found on a plain key/value map
// (event.tags, event.extra, event.contexts.* etc). Non-string values and
// non-email strings pass through unchanged. Money-shaped keys (outside the
// safe-id allowlist) are deleted entirely, mirroring the "raw monetary
// values never leave the process" requirement (T-53-02).
function scrubMap(map) {
  if (!map || typeof map !== 'object') return;
  Object.keys(map).forEach(function (key) {
    if (isAllowlisted(key)) return;
    if (MONEY_KEY_RE.test(key)) {
      delete map[key];
      return;
    }
    var value = map[key];
    if (typeof value === 'string' && EMAIL_RE.test(value)) {
      map[key] = redact.maskEmail(value);
    }
  });
}

/**
 * Scrub a Sentry event in place before it is sent.
 * Never throws on malformed/undefined event fields.
 *
 * @param {object} event - raw Sentry event
 * @returns {object} the same event, mutated
 */
function scrubEvent(event) {
  if (!event || typeof event !== 'object') return event;

  if (event.user && typeof event.user === 'object' && typeof event.user.email === 'string') {
    event.user.email = redact.maskEmail(event.user.email);
  }

  scrubMap(event.tags);
  scrubMap(event.extra);
  if (event.contexts && typeof event.contexts === 'object') {
    Object.keys(event.contexts).forEach(function (ctxKey) {
      scrubMap(event.contexts[ctxKey]);
    });
  }

  // request.data/cookies/headers can carry raw request bodies, session
  // cookies, or auth headers (API_SECRET_KEY) — never partial-mask, remove
  // entirely (T-53-01, T-53-03).
  if (event.request && typeof event.request === 'object') {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
  }

  return event;
}

/**
 * Group events by error class so a burst of the same failure produces one
 * Sentry issue instead of one per occurrence (D-04).
 *
 * @param {object} event - raw Sentry event
 * @returns {string[]} single-element fingerprint array
 */
function fingerprintFor(event) {
  var type;
  if (
    event &&
    event.exception &&
    Array.isArray(event.exception.values) &&
    event.exception.values.length > 0
  ) {
    var first = event.exception.values[0];
    type = (first && first.type) || (first && first.value);
  }
  return [type || 'Error'];
}

module.exports = { scrubEvent: scrubEvent, fingerprintFor: fingerprintFor };
