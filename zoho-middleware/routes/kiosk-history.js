var express = require('express');
var zohoApi = require('../lib/zoho-api');
var cache = require('../lib/cache');
var authTiers = require('../lib/authTiers');

var router = express.Router();
var zohoGet = zohoApi.zohoGet;

// ---------------------------------------------------------------------------
// Kiosk Past Sales (Phase 92). Read-only: no write routes (D-13).
// ---------------------------------------------------------------------------

// Hard caps. Request params can never change these (T-92-11).
var LEDGER_MAX_INVOICE_PAGES = 3;
var LEDGER_MAX_PAYMENT_PAGES = 3;
var PER_PAGE = 200;
var LEDGER_MIN_DATE = '2020-01-01';
var TTL_TODAY = 60;
var TTL_PAST = 3600;

// Join mode copied from zoho-middleware/__tests__/fixtures/zoho-past-sales-shapes.json
// (_meta.join_mode = 'list-join', linkage 'invoice_numbers', notes in 'description').
// Owner decision 92-01: list-join-blank-in-store (blank-reference invoices are in-store).
// Never request-controlled; exported as _config for tests only.
var config = {
  joinMode: 'list-join',
  noneBlankPolicy: null,
  linkageField: 'invoice_numbers',
  notesField: 'description'
};

function validateConfig(cfg) {
  var modes = ['list-join', 'detail-fallback', 'none'];
  if (!cfg || modes.indexOf(cfg.joinMode) === -1) {
    throw new Error('kiosk-history: invalid joinMode ' + (cfg && cfg.joinMode));
  }
  if (cfg.joinMode === 'none' && cfg.noneBlankPolicy !== 'include' && cfg.noneBlankPolicy !== 'exclude') {
    throw new Error('kiosk-history: joinMode none requires noneBlankPolicy include|exclude');
  }
}
validateConfig(config);

function noop() {}

// GET routes skip the global /api guard, so enforce the tier inline (D-10).
function gate(req, res, fn) {
  authTiers.requireTiers(['legacy', 'device', 'session'])(req, res, fn);
}

// Cache read errors are a miss; build() rejections propagate so a Zoho failure is never cached.
function cachedOrBuild(key, ttl, bust, build) {
  var read = bust ? Promise.resolve(null) : Promise.resolve(cache.get(key)).catch(function () { return null; });
  return read.then(function (cached) {
    if (cached) return cached;
    return build().then(function (fresh) {
      Promise.resolve(cache.set(key, fresh, ttl)).catch(noop);
      return fresh;
    });
  });
}

// Strictly sequential page chain (never Promise.all): Zoho allows ~1 req/s.
function fetchPages(path, params, maxPages, listKey) {
  var rows = [];
  function step(page) {
    return zohoGet(path, Object.assign({}, params, { page: page })).then(function (data) {
      rows = rows.concat((data && data[listKey]) || []);
      var more = !!(data && data.page_context && data.page_context.has_more_page);
      if (more && page >= maxPages) return { rows: rows, truncated: true };
      if (more) return step(page + 1);
      return { rows: rows, truncated: false };
    });
  }
  return step(1);
}

function errMessage(err) {
  var m = err && err.response && err.response.data && err.response.data.message;
  return m || (err && err.message) || 'unknown';
}

router.validateConfig = validateConfig;
router._config = config;
router._internals = {
  gate: gate,
  cachedOrBuild: cachedOrBuild,
  fetchPages: fetchPages,
  errMessage: errMessage,
  caps: {
    LEDGER_MAX_INVOICE_PAGES: LEDGER_MAX_INVOICE_PAGES,
    LEDGER_MAX_PAYMENT_PAGES: LEDGER_MAX_PAYMENT_PAGES,
    PER_PAGE: PER_PAGE,
    LEDGER_MIN_DATE: LEDGER_MIN_DATE,
    TTL_TODAY: TTL_TODAY,
    TTL_PAST: TTL_PAST
  }
};

module.exports = router;
