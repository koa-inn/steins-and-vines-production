var express = require('express');
var zohoApi = require('../lib/zoho-api');
var cache = require('../lib/cache');
var log = require('../lib/logger');
var authTiers = require('../lib/authTiers');
var C = require('../lib/constants');
var hist = require('../lib/kiosk-history');

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

// Strictly sequential page chain (no parallel fan-out): Zoho allows ~1 req/s.
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

var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function badRequest(res, message) {
  return res.status(400).json({ error: 'bad_request', message: message });
}

function buildLedger(day, today) {
  // Only the list-join mode was built (owner decision 92-01, list-join-blank-in-store).
  if (config.joinMode !== 'list-join') {
    return Promise.reject(new Error('unsupported join mode ' + config.joinMode));
  }
  var nextDay = hist.addDays(day, 1);
  var truncated = false;
  var invoices;
  return fetchPages('/invoices', {
    date_start: day, date_end: nextDay, sort_column: 'created_time', sort_order: 'D', per_page: PER_PAGE
  }, LEDGER_MAX_INVOICE_PAGES, 'invoices').then(function (inv) {
    truncated = truncated || inv.truncated;
    invoices = inv.rows.filter(function (i) { return hist.createdDay(i) === day; });
    // One ranged payments call covers D..D+1 (payment `date` is UTC, A-05; date_start/date_end honored per 92-01).
    return fetchPages('/customerpayments', {
      date_start: day, date_end: nextDay, per_page: PER_PAGE
    }, LEDGER_MAX_PAYMENT_PAGES, 'customerpayments');
  }).then(function (pay) {
    truncated = truncated || pay.truncated;
    var idx = hist.indexPaymentsByInvoice(pay.rows, config.linkageField, config.notesField);
    var kept = [];
    var tenders = {};
    invoices.forEach(function (inv) {
      var paid = idx[inv.invoice_number] || [];
      var notes = paid.map(function (p) { return p.note; });
      if (hist.classify(inv, notes) !== 'in-store') return;
      kept.push(inv);
      tenders[inv.invoice_id] = hist.tenderLabel(paid);
    });
    var rows = hist.sortByCreatedDesc(kept).map(function (inv) {
      return hist.slimInvoiceRow(inv, 'in-store', tenders[inv.invoice_id]);
    });
    var totals = hist.ledgerTotals(rows);
    var tenderIncomplete = pay.truncated || rows.some(function (r) {
      return (r.status === 'Paid' || r.status === 'Partial') && r.tender === '';
    });
    return {
      date: day,
      today: today,
      prev_date: hist.addDays(day, -1),
      next_date: day === today ? null : nextDay,
      invoices: rows,
      count: totals.count,
      gross_total: totals.gross_total,
      truncated: truncated,
      tender_incomplete: tenderIncomplete,
      classification_incomplete: false,
      unclassified_count: 0
    };
  });
}

// GET /api/kiosk/past-sales/ledger?date=YYYY-MM-DD[&bust=1]
// Only `date` and `bust` are read; every other query param is ignored (T-92-11).
router.get('/api/kiosk/past-sales/ledger', function (req, res) {
  gate(req, res, function () {
    var today = hist.vancouverDay(new Date());
    var q = req.query || {};
    var day = today;
    if (q.date !== undefined && q.date !== '') {
      day = q.date;
      if (typeof day !== 'string' || !DATE_RE.test(day) || !hist.isRealDate(day)) {
        return badRequest(res, 'date must be a real YYYY-MM-DD date');
      }
      if (day > today) return badRequest(res, 'date cannot be in the future');
      if (day < LEDGER_MIN_DATE) return badRequest(res, 'date is before ' + LEDGER_MIN_DATE);
    }
    var bust = q.bust === '1' || q.bust === 1 || q.bust === true;
    cachedOrBuild(C.CACHE_KEYS.KIOSK_HISTORY_LEDGER_PREFIX + day, day === today ? TTL_TODAY : TTL_PAST, bust, function () {
      return buildLedger(day, today);
    }).then(function (payload) {
      res.json(payload);
    }).catch(function (err) {
      log.error('[kiosk/past-sales/ledger] ' + errMessage(err));
      if (!res.headersSent) res.status(502).json({ error: 'Unable to fetch sales' });
    });
  });
});

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
