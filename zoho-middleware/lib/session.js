'use strict';

// Redis-backed opaque session store with an in-process fallback (D-46-04,
// Finding #5). Mirrors lib/cache.js's "check cache.isConnected(), else
// consult an in-process object" style already used by acquireLock/
// acquireInProcessLock — a Redis blip must not sign everyone out mid-day
// (T-46-10). Does NOT reimplement Redis access: all Redis I/O goes through
// cache.get/set/del.
//
// The session id is a high-entropy crypto.randomBytes(32) opaque token —
// it is the credential itself, looked up server-side, with no
// client-controlled structure to forge (T-46-12). It is NOT HMAC-signed;
// per 46-RESEARCH.md anti-patterns, signing an already-unguessable random id
// adds no security value here.

var crypto = require('crypto');
var cache = require('./cache');

var SESSION_PREFIX = 'session:';
var SESSION_TTL_SECONDS = 7 * 24 * 3600; // 7 days
var TOUCH_MIN_INTERVAL_MS = 60 * 60 * 1000; // 1 hour — coarse refresh cadence

// In-process session Map: sid -> { email, createdAt, lastRefresh }. Written
// through on create/touch, consulted only when cache.isConnected() is false
// — mirrors lib/cache.js's inProcessLocks (single-Railway-instance ⇒
// per-process coverage is adequate, D-06 norm).
var inProcessSessions = Object.create(null);

function createSession(email) {
  var sid = crypto.randomBytes(32).toString('hex');
  var now = Date.now();
  var payload = { email: email, createdAt: now, lastRefresh: now };
  inProcessSessions[sid] = payload; // write-through, mirrors inProcessLocks
  return cache.set(SESSION_PREFIX + sid, payload, SESSION_TTL_SECONDS).then(function () {
    return sid;
  });
}

function getSession(sid) {
  if (!cache.isConnected()) {
    return Promise.resolve(inProcessSessions[sid] || null);
  }
  return cache.get(SESSION_PREFIX + sid);
}

function destroySession(sid) {
  delete inProcessSessions[sid];
  return cache.del(SESSION_PREFIX + sid);
}

// Sliding expiry: only re-write (Redis + in-process) when the stored
// lastRefresh is older than TOUCH_MIN_INTERVAL_MS. This is a coarse refresh
// cadence chosen to limit Redis writes on every request (46-RESEARCH.md
// open-question #3 recommendation), not a per-request TTL bump.
function touchSession(sid) {
  return getSession(sid).then(function (payload) {
    if (!payload) return null;
    var now = Date.now();
    if (payload.lastRefresh && (now - payload.lastRefresh) < TOUCH_MIN_INTERVAL_MS) {
      return payload; // refreshed recently — skip the write
    }
    var refreshed = { email: payload.email, createdAt: payload.createdAt, lastRefresh: now };
    inProcessSessions[sid] = refreshed;
    return cache.set(SESSION_PREFIX + sid, refreshed, SESSION_TTL_SECONDS).then(function () {
      return refreshed;
    });
  });
}

module.exports = {
  createSession: createSession,
  getSession: getSession,
  destroySession: destroySession,
  touchSession: touchSession,
};
