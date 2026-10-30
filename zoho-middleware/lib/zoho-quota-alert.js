'use strict';

// Low / exhausted Zoho Inventory quota alerts (quick task 261029-zq1, Task 5).
//
// Listens to lib/zoho-quota readings. When `remaining` first drops below
// ZOHO_QUOTA_ALERT (default 300) in a quota day — and again when the quota is
// first seen exhausted (429 code 45) — sends ONE staff email per environment
// per quota day, logs a WARN and records a Sentry warning. De-dup uses a Redis
// lock that expires at the quota reset (in-process fallback when Redis is down).

var Sentry = require('@sentry/node');
var cache = require('./cache');
var log = require('./logger');
var mailer = require('./mailer');
var quota = require('./zoho-quota');

var DEFAULT_ALERT = 300;
var _attempted = {}; // kind:bucket → true (avoid a Redis round-trip on every reading)

function threshold() {
  var n = parseInt(process.env.ZOHO_QUOTA_ALERT, 10);
  return isFinite(n) && n >= 0 ? n : DEFAULT_ALERT;
}

function envName() {
  return process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV || 'local';
}

// A "quota day" is identified by its reset moment rounded to the hour (every
// reading in one day counts down to the same midnight reset).
function dayBucket(resetIso) {
  var ms = Date.parse(resetIso);
  if (!ms) return new Date(Date.now()).toISOString().slice(0, 10);
  return String(Math.round(ms / 3600000));
}

function secondsUntil(iso) {
  var ms = Date.parse(iso);
  if (!ms) return 3600;
  return Math.max(60, Math.ceil((ms - Date.now()) / 1000));
}

function fire(kind, snap) {
  var env = envName();
  var resetIso = snap.resetAt || snap.exhaustedUntil;
  var bucket = dayBucket(resetIso);
  var memo = kind + ':' + bucket;
  if (_attempted[memo]) return Promise.resolve(false);
  _attempted[memo] = true;

  var key = 'zoho-quota-alert:' + env + ':' + kind + ':' + bucket;
  return Promise.resolve(cache.acquireLock(key, secondsUntil(resetIso))).then(function (acquired) {
    if (!acquired) return false;
    var msg = kind === 'exhausted'
      ? '[zoho-quota] Zoho Inventory daily quota EXHAUSTED (' + env + ') — Inventory calls paused until ' + (snap.exhaustedUntil || resetIso || 'reset')
      : '[zoho-quota] Zoho Inventory quota low (' + env + '): ' + snap.remaining + ' of ' + snap.limit + ' calls left, resets ' + (resetIso || 'unknown');
    log.warn(msg);
    try {
      if (typeof Sentry.captureMessage === 'function') {
        Sentry.captureMessage(msg, { level: 'warning', tags: { component: 'zoho-quota', env: env, kind: kind } });
      }
    } catch { /* telemetry never throws */ }
    return Promise.resolve(mailer.sendZohoQuotaAlert({
      remaining: snap.remaining, limit: snap.limit, resetAt: resetIso || null, env: env, kind: kind
    })).then(function () { return true; }, function (err) {
      log.error('[zoho-quota] Quota alert email failed: ' + (err && err.message));
      return true;
    });
  }).catch(function (err) {
    log.error('[zoho-quota] Quota alert failed: ' + (err && err.message));
    return false;
  });
}

/** Listener for lib/zoho-quota events. Never throws. */
function handle(event, snap) {
  if (!snap) return;
  if (event === 'exhausted') {
    fire('exhausted', snap);
    return;
  }
  if (typeof snap.remaining === 'number' && snap.remaining < threshold()) {
    fire('low', snap);
  }
}

function install() {
  quota._setListener(handle);
}

module.exports = { install: install, handle: handle };
