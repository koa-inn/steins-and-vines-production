'use strict';

// Single source of truth for the shared admin API key that guards mutating
// /api/* endpoints (server.js global guard) and the PII-bearing admin GETs
// that opt back in individually (orders/recent, inventory-ledger,
// consignment-report, internal catalog).
//
// Two rules, enforced here so no call site can drift:
//   1. UNIFIED KEY — always the same env pair: API_SECRET_KEY, with MW_API_KEY
//      as the legacy alias. Routes used to read only MW_API_KEY, which silently
//      failed open against the wrong half of the pair.
//   2. HEADER ONLY — the key is accepted ONLY from the x-api-key header, never
//      from the query string. A ?api_key=... in the URL leaks into access logs,
//      reverse-proxy logs, browser history, and Referer headers.

var crypto = require('crypto');

// Resolved lazily (per call) so callers observe env set after this module is
// required — matches the existing per-request reads in the route handlers and
// keeps tests that set process.env in setup working regardless of require order.
function getKey() {
  return process.env.API_SECRET_KEY || process.env.MW_API_KEY || '';
}

// Constant-time comparison. A plain `===`/`!==` on the secret is a timing
// oracle that leaks the key byte-by-byte via response-time measurement. Length
// is checked first (lengths are not secret) so timingSafeEqual always receives
// equal-length buffers.
function matches(sent) {
  var key = getKey();
  if (!key || typeof sent !== 'string') return false;
  var a = Buffer.from(sent);
  var b = Buffer.from(key);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { getKey: getKey, matches: matches };
