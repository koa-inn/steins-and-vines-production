'use strict';

// Zoho Inventory daily-quota guard (quick task 261029-zq1).
//
// Staging and production share ONE Zoho org and one 1,000-calls/day Inventory
// quota. Zoho reports the budget on every Inventory response
// (x-rate-limit-limit / -remaining / -reset, reset in seconds) and, once it is
// spent, answers HTTP 429 { code: 45 } until the reset (midnight org time).
//
// This module keeps the latest reading in memory (mirrored to Redis so a
// redeploy does not forget an exhaustion), blocks Inventory calls until the
// reset once the quota is exhausted, and tells background/scheduled refreshes
// to stand down while remaining < ZOHO_QUOTA_RESERVE (default 250).
// Interactive requests and sale-time paths are only blocked by real exhaustion.

var cache = require('./cache');
var log = require('./logger');

var REDIS_KEY = 'zoho:inventory:quota';
var EXHAUSTED_FALLBACK_MS = 15 * 60 * 1000; // code 45 with no reset header
var DEFAULT_RESERVE = 250;

var state = {
  remaining: null,
  limit: null,
  resetAt: null,        // ms epoch
  updatedAt: null,      // ms epoch
  exhaustedUntil: 0     // ms epoch
};
var _hydrated = null;

function readHeader(headers, name) {
  if (!headers) return undefined;
  var v;
  try {
    v = typeof headers.get === 'function' ? headers.get(name) : headers[name];
  } catch {
    return undefined;
  }
  if (v === undefined || v === null || v === '') return undefined;
  var n = parseInt(String(v), 10);
  return isFinite(n) && n >= 0 ? n : undefined;
}

function reserve() {
  var n = parseInt(process.env.ZOHO_QUOTA_RESERVE, 10);
  return isFinite(n) && n >= 0 ? n : DEFAULT_RESERVE;
}

function ttlSeconds(now) {
  if (state.resetAt && state.resetAt > now) return Math.max(1, Math.ceil((state.resetAt - now) / 1000));
  if (state.exhaustedUntil > now) return Math.max(1, Math.ceil((state.exhaustedUntil - now) / 1000));
  return 3600;
}

function toIso(ms) {
  return ms ? new Date(ms).toISOString() : null;
}

function mirror(now) {
  var payload = {
    remaining: state.remaining,
    limit: state.limit,
    resetAt: toIso(state.resetAt),
    updatedAt: toIso(state.updatedAt),
    exhaustedUntil: toIso(state.exhaustedUntil)
  };
  try {
    Promise.resolve(cache.set(REDIS_KEY, payload, ttlSeconds(now))).catch(function () {});
  } catch {
    // never let telemetry break an Inventory call
  }
}

// Hook for low-quota alerts (Task 5); replaced via _setListener in tests/alerts.
var _listener = null;
function notify(event) {
  if (!_listener) return;
  try { _listener(event, snapshot()); } catch { /* never throw into a Zoho call */ }
}

/**
 * Record x-rate-limit-* headers from any Inventory response (success or error).
 * Missing/invalid headers are ignored.
 */
function recordHeaders(headers) {
  var remaining = readHeader(headers, 'x-rate-limit-remaining');
  var limit = readHeader(headers, 'x-rate-limit-limit');
  var reset = readHeader(headers, 'x-rate-limit-reset');
  if (remaining === undefined && limit === undefined && reset === undefined) return;

  var now = Date.now();
  if (remaining !== undefined) state.remaining = remaining;
  if (limit !== undefined) state.limit = limit;
  if (reset !== undefined) state.resetAt = now + reset * 1000;
  state.updatedAt = now;

  if (remaining === 0 && state.resetAt && state.resetAt > now) {
    state.exhaustedUntil = Math.max(state.exhaustedUntil, state.resetAt);
  }
  mirror(now);
  notify('reading');
}

/**
 * Record a failed Inventory request. A 429 with Zoho code 45 (daily limit)
 * marks the quota exhausted until the reset header (fallback 15 min).
 */
function recordError(err) {
  var resp = err && err.response;
  if (!resp) return;
  recordHeaders(resp.headers);
  var code = resp.data && resp.data.code;
  if (resp.status === 429 && code === 45) {
    var now = Date.now();
    var reset = readHeader(resp.headers, 'x-rate-limit-reset');
    var until = reset !== undefined ? now + reset * 1000 : now + EXHAUSTED_FALLBACK_MS;
    var wasExhausted = state.exhaustedUntil > now;
    state.exhaustedUntil = Math.max(state.exhaustedUntil, until);
    if (state.remaining === null) state.remaining = 0;
    state.updatedAt = now;
    mirror(now);
    if (!wasExhausted) {
      log.error('[zoho-quota] Zoho Inventory daily quota EXHAUSTED (code 45) — Inventory calls blocked until ' +
        toIso(state.exhaustedUntil));
    }
    notify('exhausted');
  }
}

function isExhausted() {
  return Date.now() < state.exhaustedUntil;
}

function belowReserve() {
  var now = Date.now();
  if (state.remaining === null) return false;
  if (state.resetAt && state.resetAt <= now) return false; // reading predates the reset
  return state.remaining < reserve();
}

/** Background/scheduled refreshes skip while exhausted or under the reserve. */
function shouldSkipBackground() {
  return isExhausted() || belowReserve();
}

/** An Error shaped like Zoho's code-45 429 so existing 429 handling applies. */
function exhaustedError() {
  var msg = 'Zoho Inventory daily API quota exhausted — calls paused until ' + toIso(state.exhaustedUntil);
  var err = new Error(msg);
  err.quotaExhausted = true;
  err.status = 429;
  err.response = { status: 429, headers: {}, data: { code: 45, message: msg } };
  return err;
}

/** Public snapshot (no secrets) for /health and alerts. */
function snapshot() {
  return {
    remaining: state.remaining,
    limit: state.limit,
    resetAt: toIso(state.resetAt),
    updatedAt: toIso(state.updatedAt),
    exhausted: isExhausted(),
    exhaustedUntil: isExhausted() ? toIso(state.exhaustedUntil) : null,
    reserve: reserve()
  };
}

/**
 * Adopt the Redis-mirrored state once per process (e.g. after a redeploy while
 * the quota is exhausted). Never rejects.
 */
function hydrate() {
  if (_hydrated) return _hydrated;
  _hydrated = Promise.resolve().then(function () {
    return cache.get(REDIS_KEY);
  }).then(function (saved) {
    if (!saved || typeof saved !== 'object') return;
    var savedUpdated = Date.parse(saved.updatedAt) || 0;
    if (state.updatedAt && state.updatedAt >= savedUpdated) return; // in-memory is newer
    if (typeof saved.remaining === 'number') state.remaining = saved.remaining;
    if (typeof saved.limit === 'number') state.limit = saved.limit;
    state.resetAt = Date.parse(saved.resetAt) || state.resetAt;
    state.updatedAt = savedUpdated || state.updatedAt;
    state.exhaustedUntil = Math.max(state.exhaustedUntil, Date.parse(saved.exhaustedUntil) || 0);
  }).catch(function () {});
  return _hydrated;
}

function _setListener(fn) {
  _listener = fn;
}

module.exports = {
  REDIS_KEY: REDIS_KEY,
  recordHeaders: recordHeaders,
  recordError: recordError,
  isExhausted: isExhausted,
  belowReserve: belowReserve,
  shouldSkipBackground: shouldSkipBackground,
  exhaustedError: exhaustedError,
  snapshot: snapshot,
  hydrate: hydrate,
  _setListener: _setListener
};
