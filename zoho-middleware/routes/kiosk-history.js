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
var CUSTOMER_MAX_INVOICE_PAGES = 3;
var CUSTOMER_MAX_PAYMENT_PAGES = 2;
var HISTORY_MAX_MONTHS = 120;
var WINDOW_MONTHS = 12;
var ID_RE = /^\d{6,25}$/;

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
// ttl may be a number or a function(result) -> number.
function cachedOrBuild(key, ttl, bust, build) {
  var read = bust ? Promise.resolve(null) : Promise.resolve(cache.get(key)).catch(function () { return null; });
  return read.then(function (cached) {
    if (cached) return cached;
    return build().then(function (fresh) {
      var t = typeof ttl === 'function' ? ttl(fresh) : ttl;
      Promise.resolve(cache.set(key, fresh, t)).catch(noop);
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

function isBust(q) {
  return q.bust === '1' || q.bust === 1 || q.bust === true;
}

function buildCustomer(customerId, winStart, winEnd, floor) {
  if (config.joinMode !== 'list-join') {
    return Promise.reject(new Error('unsupported join mode ' + config.joinMode));
  }
  var truncated = false;
  var invoices;
  return fetchPages('/invoices', {
    customer_id: customerId, date_start: winStart, date_end: winEnd,
    sort_column: 'created_time', sort_order: 'D', per_page: PER_PAGE
  }, CUSTOMER_MAX_INVOICE_PAGES, 'invoices').then(function (inv) {
    truncated = inv.truncated;
    // Defense in depth: never return another contact's invoices.
    invoices = inv.rows.filter(function (i) { return String(i.customer_id) === customerId; });
    // Blank references are in-store by owner decision (92-01); only all-digit
    // references need payment notes (recipe safety net, A-09).
    var needNotes = invoices.some(function (i) { return /^\d+$/.test(String(i.reference_number || '')); });
    if (!needNotes) return { rows: [], truncated: false };
    return fetchPages('/customerpayments', {
      customer_id: customerId, date_start: winStart, date_end: winEnd, per_page: PER_PAGE
    }, CUSTOMER_MAX_PAYMENT_PAGES, 'customerpayments');
  }).then(function (pay) {
    var idx = hist.indexPaymentsByInvoice(pay.rows, config.linkageField, config.notesField);
    var rows = hist.sortByCreatedDesc(invoices).map(function (inv) {
      var notes = (idx[inv.invoice_number] || []).map(function (p) { return p.note; });
      var row = hist.slimInvoiceRow(inv, hist.classify(inv, notes), '');
      if (row.status === 'Draft') row.status = 'Unpaid';
      return row;
    });
    return {
      walk_in: false,
      customer_id: customerId,
      window_start: winStart,
      window_end: winEnd,
      has_older: winStart > floor,
      truncated: truncated,
      invoices: rows
    };
  });
}

// GET /api/kiosk/past-sales/customer?customer_id=<id>[&before=YYYY-MM-DD][&bust=1]
// Only customer_id, before and bust are read (T-92-18).
router.get('/api/kiosk/past-sales/customer', function (req, res) {
  gate(req, res, function () {
    var q = req.query || {};
    var customerId = q.customer_id;
    if (typeof customerId !== 'string' || !ID_RE.test(customerId)) {
      return badRequest(res, 'customer_id must be a numeric Zoho id');
    }
    var walkIn = process.env.KIOSK_CONTACT_ID;
    if (walkIn && customerId === String(walkIn)) {
      return res.json({ walk_in: true, invoices: [] });
    }
    if (!walkIn) log.warn('[kiosk/past-sales/customer] KIOSK_CONTACT_ID unset; walk-in exclusion not enforced');
    var today = hist.vancouverDay(new Date());
    var floor = hist.addMonths(today, -HISTORY_MAX_MONTHS);
    var before = q.before;
    var winEnd = hist.addDays(today, 1);
    var winStart = hist.addMonths(today, -WINDOW_MONTHS);
    if (before !== undefined && before !== '') {
      if (typeof before !== 'string' || !DATE_RE.test(before) || !hist.isRealDate(before)) {
        return badRequest(res, 'before must be a real YYYY-MM-DD date');
      }
      if (before < floor) return badRequest(res, 'before is outside the history limit');
      if (before > winEnd) return badRequest(res, 'before cannot be in the future');
      winEnd = hist.addDays(before, -1);
      winStart = hist.addMonths(before, -WINDOW_MONTHS);
    } else {
      before = '';
    }
    if (winStart < floor) winStart = floor;
    var key = C.CACHE_KEYS.KIOSK_HISTORY_CUSTOMER_PREFIX + customerId + ':' + (before || 'latest');
    cachedOrBuild(key, TTL_TODAY, isBust(q), function () {
      return buildCustomer(customerId, winStart, winEnd, floor);
    }).then(function (payload) {
      res.json(payload);
    }).catch(function (err) {
      log.error('[kiosk/past-sales/customer] ' + errMessage(err));
      if (!res.headersSent) res.status(502).json({ error: 'Unable to fetch customer sales' });
    });
  });
});

// GET /api/kiosk/past-sales/invoice/:id[?bust=1]
router.get('/api/kiosk/past-sales/invoice/:id', function (req, res) {
  gate(req, res, function () {
    var id = req.params && req.params.id;
    if (typeof id !== 'string' || !ID_RE.test(id)) {
      return badRequest(res, 'invoice id must be a numeric Zoho id');
    }
    var ttl = function (d) {
      return (d.status === 'Paid' || d.status === 'Void') ? TTL_PAST : TTL_TODAY;
    };
    cachedOrBuild(C.CACHE_KEYS.KIOSK_HISTORY_INVOICE_PREFIX + id, ttl, isBust(req.query || {}), function () {
      return zohoGet('/invoices/' + id).then(function (data) {
        return hist.slimInvoiceDetail((data && data.invoice) || {});
      });
    }).then(function (detail) {
      res.json({ invoice: detail });
    }).catch(function (err) {
      log.error('[kiosk/past-sales/invoice] Zoho error: ' + errMessage(err));
      if (res.headersSent) return;
      if (err && err.response && err.response.status === 404) return res.status(404).json({ error: 'not_found' });
      res.status(502).json({ error: 'Unable to fetch invoice' });
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
    TTL_PAST: TTL_PAST,
    CUSTOMER_MAX_INVOICE_PAGES: CUSTOMER_MAX_INVOICE_PAGES,
    CUSTOMER_MAX_PAYMENT_PAGES: CUSTOMER_MAX_PAYMENT_PAGES
  }
};

module.exports = router;
