'use strict';

// Constant-time kiosk device-token guard (D-46-01).
//
// Net-new sibling of lib/apiKey.js, replicating its exact shape: a single
// env var (no legacy alias, since this is net-new) and the same
// length-check-then-timingSafeEqual comparison. A plain `===`/`!==` on the
// token is a timing oracle that leaks it byte-by-byte via response-time
// measurement. Length is checked first (lengths are not secret) so
// timingSafeEqual always receives equal-length buffers.
//
// Fails closed: matches() returns false when KIOSK_DEVICE_TOKEN is
// unset/empty (T-46-13) — validateEnv.js marks it REQUIRED_IN_PROD.

var crypto = require('crypto');

function getKey() {
  return process.env.KIOSK_DEVICE_TOKEN || '';
}

function matches(sent) {
  var key = getKey();
  if (!key || typeof sent !== 'string') return false;
  var a = Buffer.from(sent);
  var b = Buffer.from(key);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { getKey: getKey, matches: matches };
