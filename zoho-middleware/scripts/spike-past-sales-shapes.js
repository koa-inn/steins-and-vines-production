#!/usr/bin/env node
/**
 * spike-past-sales-shapes.js - STAGING-ONLY, READ-ONLY dev tool (Phase 92 Spike S1)
 *
 * Looks once at the live Zoho shapes the past-sales ledger depends on:
 *   - GET /customerpayments (invoice linkage, note text, payment_mode, date range)
 *   - GET /invoices         (created_time, list fields)
 *   - GET /invoices/:id     (totals keys, payments[] with note text)
 * and prints a SANITIZED fixture between ===FIXTURE-BEGIN=== / ===FIXTURE-END===.
 *
 * SAFETY
 *   - GET only. No write helpers are imported or called.
 *   - Refuses to run unless SENTRY_ENVIRONMENT === 'staging' (or --allow-nonstaging).
 *   - Staging shares ONE Zoho org with production, so only sanitized output is printed.
 *   - At most 5 sequential calls, per_page 5.
 *   - On error prints err.message and HTTP status only, never response bodies.
 *
 * USAGE (inside the staging container, cwd = app dir containing lib/zoho-api.js):
 *   node - --date=2026-10-15 [--customer-id=<digits>] < scripts/spike-past-sales-shapes.js
 */

'use strict';

var path = require('path');

// Prefixes written by the money paths (payment notes), truncated at the first '.'.
var KNOWN_NOTE_PREFIXES = [
  'Kiosk cash payment.',
  'Kiosk phone-order (card-not-present) payment.',
  'Kiosk POS terminal payment.',
  'Kiosk SO payment.',
  'Kiosk recipe sale.',
  'Gift certificate',
  'Legacy POS payment.',
  'In-store terminal payment.',
  'Online payment for'
];

var MAX_ROWS = 5;

function startsWithKnownPrefix(s) {
  var i;
  if (typeof s !== 'string') return null;
  for (i = 0; i < KNOWN_NOTE_PREFIXES.length; i++) {
    if (s.indexOf(KNOWN_NOTE_PREFIXES[i]) === 0) return KNOWN_NOTE_PREFIXES[i];
  }
  return null;
}

function redactNote(s) {
  if (s === '' || s === null || s === undefined) return s === undefined ? '' : s;
  var p = startsWithKnownPrefix(String(s));
  return p || 'REDACTED_NOTE';
}

function redactReference(s) {
  if (s === '' || s === null || s === undefined) return '';
  var str = String(s);
  if (/^KIOSK-\d+$/.test(str)) return 'KIOSK-' + str.slice(6).replace(/\d/g, '0');
  if (/^POS-\d+$/.test(str)) return 'POS-' + str.slice(4).replace(/\d/g, '0');
  if (/^\d+$/.test(str)) return str.replace(/\d/g, '0');
  return 'REDACTED_REF';
}

function notesSourceOf(rows) {
  var keys = ['description', 'notes'];
  var k;
  var r;
  if (!Array.isArray(rows)) return null;
  for (k = 0; k < keys.length; k++) {
    for (r = 0; r < rows.length; r++) {
      if (rows[r] && startsWithKnownPrefix(rows[r][keys[k]])) return keys[k];
    }
  }
  return null;
}

function deriveJoinMode(m) {
  if (m.linkage_field && m.notes_in_list) return 'list-join';
  if (m.notes_in_detail) return 'detail-fallback';
  return 'none';
}

var NAME_LIKE = /url$|^contact_number$|(customer|contact|salesperson|created_by|submitted_by|approver|modified_by)_?name$|^email$|email$|phone|mobile|address|^terms$|^contact_persons$|^created_by$/i;
var ID_LIKE = /(^|_)id$/;
// WR-06: whole subtrees that can hold an address or free-form custom values,
// and scalar keys NAME_LIKE misses (address parts, attention = a person's
// name, fax, card last four, top-level cf_* custom-field values).
var SUBTREE_REDACT = { billing_address: true, shipping_address: true, custom_field_hash: true };
var SCALAR_REDACT = /^cf_|^(last_four_digits|attention|fax|street|street2|city|state|state_code|zip|country|country_code)$/;

function isEmptyValue(v) {
  if (v === '' || v === null || v === undefined) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}

function makeCtx() {
  return { ids: {}, nextId: 1, nums: {}, nextNum: 1 };
}

function synthId(ctx, v) {
  var key = String(v);
  if (!ctx.ids[key]) {
    var n = String(ctx.nextId++);
    while (n.length < 12) n = '0' + n;
    ctx.ids[key] = '1000' + n;
  }
  return ctx.ids[key];
}

function synthInvNum(ctx, v) {
  var key = String(v);
  if (!ctx.nums[key]) {
    var n = String(ctx.nextNum++);
    while (n.length < 2) n = '0' + n;
    ctx.nums['k' + key] = 'INV-9000' + n;
    ctx.nums[key] = ctx.nums['k' + key];
  }
  return ctx.nums[key];
}

function sanitizeValue(ctx, key, v) {
  var i;
  var out;
  var k;
  if (v === null || v === undefined) return v;
  if (SUBTREE_REDACT[key] || (SCALAR_REDACT.test(key) && typeof v === 'object')) {
    if (isEmptyValue(v)) return v;
    return typeof v === 'object' ? { REDACTED: true } : 'REDACTED_' + key.toUpperCase();
  }
  if (Array.isArray(v)) {
    if (key === 'custom_fields') {
      return v.length ? [{ label: 'REDACTED', value: 'REDACTED' }] : [];
    }
    if (key === 'contact_persons') return v.length ? ['REDACTED_CONTACT'] : [];
    out = [];
    for (i = 0; i < v.length && i < MAX_ROWS; i++) out.push(sanitizeValue(ctx, key, v[i]));
    return out;
  }
  if (typeof v === 'object') {
    out = {};
    for (k in v) {
      if (Object.prototype.hasOwnProperty.call(v, k)) out[k] = sanitizeValue(ctx, k, v[k]);
    }
    return out;
  }
  if (typeof v === 'string' || typeof v === 'number') {
    if (key === 'notes' || key === 'description') return redactNote(v);
    if (key === 'reference_number') return redactReference(v);
    if (key === 'payment_number') return v === '' ? '' : 'REDACTED_PAYMENT_NUMBER';
    if (key === 'invoice_number') return v === '' ? '' : synthInvNum(ctx, v);
    if (key === 'invoice_numbers') {
      return String(v).split(',').map(function (s) {
        var t = s.trim();
        return t ? synthInvNum(ctx, t) : t;
      }).join(', ');
    }
    if (SCALAR_REDACT.test(key)) return v === '' ? '' : 'REDACTED_' + key.toUpperCase();
    if (NAME_LIKE.test(key)) return v === '' ? '' : 'REDACTED_' + key.toUpperCase();
    if (ID_LIKE.test(key)) return v === '' || v === 0 ? v : synthId(ctx, v);
    if (typeof v === 'string') {
      // Safety net: stray e-mail addresses or long digit runs never survive.
      if (v.indexOf('@') !== -1) return 'REDACTED_STR';
      return v.replace(/\d{10,}/g, function (m) { return m.replace(/\d/g, '0'); });
    }
  }
  return v;
}

function sanitizeFixture(raw, ctx) {
  return sanitizeValue(ctx || makeCtx(), '', raw);
}

// ---- live part -------------------------------------------------------------

function arg(name) {
  var pre = '--' + name + '=';
  var i;
  for (i = 2; i < process.argv.length; i++) {
    if (process.argv[i].indexOf(pre) === 0) return process.argv[i].slice(pre.length);
  }
  return undefined;
}

function nextDay(d) {
  var t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

function uniq(arr) {
  var seen = {};
  var out = [];
  arr.forEach(function (x) {
    if (x !== undefined && x !== null && !seen[x]) { seen[x] = true; out.push(x); }
  });
  return out;
}

function detectLinkage(rows) {
  var i;
  var r;
  for (i = 0; i < rows.length; i++) {
    r = rows[i];
    if (Array.isArray(r.invoices) && r.invoices.length && (r.invoices[0].invoice_id || r.invoices[0].invoice_number)) return 'invoices';
  }
  for (i = 0; i < rows.length; i++) {
    r = rows[i];
    if (typeof r.invoice_numbers === 'string' && r.invoice_numbers) return 'invoice_numbers';
  }
  return null;
}

function die(msg) {
  console.error('\nSpike: ' + msg + '\n');
  process.exit(2);
}

function errText(err) {
  var st = err && err.response && err.response.status;
  return (err && err.message ? err.message : 'error') + (st ? ' (HTTP ' + st + ')' : '');
}

function main() {
  var env = process.env.SENTRY_ENVIRONMENT;
  if (env !== 'staging' && process.argv.indexOf('--allow-nonstaging') === -1) {
    die('Refusing to run: SENTRY_ENVIRONMENT is "' + (env || '') + '" (expected "staging").');
  }
  var D = arg('date');
  if (!D || !/^\d{4}-\d{2}-\d{2}$/.test(D)) die('Missing or invalid --date=YYYY-MM-DD');
  var customerId = arg('customer-id');
  if (customerId && !/^\d+$/.test(customerId)) die('--customer-id must be digits');

  var zohoGet = require(path.join(process.cwd(), 'lib', 'zoho-api')).zohoGet;
  // Separate process from the server: connect Redis and hydrate the Zoho token (same as server boot).
  var cache = require(path.join(process.cwd(), 'lib', 'cache'));
  var zohoAuth = require(path.join(process.cwd(), 'lib', 'zohoAuth'));
  var D1 = nextDay(D);
  var raw = {};

  function rowsOf(data, key) { return (data && Array.isArray(data[key])) ? data[key] : []; }

  cache.init()
    .then(function () { return zohoAuth.init(); })
    .then(function () {
      if (!zohoAuth.isAuthenticated()) throw new Error('Zoho not authenticated after init');
      return zohoGet('/customerpayments', { date: D, per_page: 5 });
    })
    .then(function (d) {
      raw.pay = d;
      return zohoGet('/customerpayments', { date_start: D, date_end: D1, per_page: 5 });
    })
    .then(function (d) {
      raw.payRange = d;
      return zohoGet('/invoices', { date_start: D, date_end: D1, sort_column: 'created_time', sort_order: 'D', per_page: 5 });
    })
    .then(function (d) {
      raw.inv = d;
      var rows = rowsOf(d, 'invoices');
      var pick = null;
      var paid = rows.filter(function (r) { return r.status === 'paid'; });
      pick = paid.filter(function (r) { return /^KIOSK-/.test(r.reference_number || ''); })[0] ||
        paid.filter(function (r) { return !r.reference_number; })[0] || paid[0] || rows[0];
      if (!pick) return null;
      return zohoGet('/invoices/' + encodeURIComponent(pick.invoice_id));
    })
    .then(function (d) {
      raw.detail = d;
      if (!customerId) return null;
      return zohoGet('/customerpayments', { customer_id: customerId, per_page: 5 });
    })
    .then(function (d) {
      raw.custPay = d;

      var payRows = rowsOf(raw.pay, 'customerpayments');
      var rangeRows = rowsOf(raw.payRange, 'customerpayments');
      var invRows = rowsOf(raw.inv, 'invoices');
      var detailInv = (raw.detail && raw.detail.invoice) || null;
      var detailPays = (detailInv && Array.isArray(detailInv.payments)) ? detailInv.payments : [];
      var allPayRows = payRows.concat(rangeRows);

      var linkage = detectLinkage(allPayRows);
      var notesInList = notesSourceOf(allPayRows) !== null;
      var notesInDetail = notesSourceOf(detailPays) !== null;
      var rangeHonored = 'unknown';
      if (rangeRows.length) {
        rangeHonored = rangeRows.every(function (r) { return r.date >= D && r.date <= D1; });
      }
      var meta = {
        captured_at: new Date().toISOString(),
        env: env || '',
        zoho_org_shared_with_prod: true,
        sample_date: D,
        linkage_field: linkage,
        notes_field: notesSourceOf(allPayRows) || notesSourceOf(detailPays),
        payment_modes_seen: uniq(allPayRows.concat(detailPays).map(function (r) { return r.payment_mode; })),
        customerpayments_date_range_honored: rangeHonored,
        created_time_format: invRows[0] ? (sanitizeFixture({ created_time: invRows[0].created_time }).created_time || null) : null,
        invoice_list_has_created_time: invRows.length > 0 && invRows.every(function (r) { return !!r.created_time; }),
        invoice_detail_total_keys: detailInv ? ['sub_total', 'tax_total', 'total', 'balance', 'balance_due', 'payments'].filter(function (k) {
          return Object.prototype.hasOwnProperty.call(detailInv, k);
        }) : [],
        detail_payments_keys: detailPays[0] ? Object.keys(detailPays[0]) : [],
        notes_in_list: notesInList,
        notes_in_detail: notesInDetail,
        detail_payments_notes_field: notesSourceOf(detailPays),
        notes_available_in: notesInList ? 'list' : (notesInDetail ? 'detail' : 'none'),
        detail_had_payments: detailPays.length > 0,
        customer_payments_sampled: !!customerId,
        customerpayments_row_count: payRows.length,
        invoices_row_count: invRows.length
      };
      meta.join_mode = deriveJoinMode({ linkage_field: linkage, notes_in_list: notesInList, notes_in_detail: notesInDetail });

      var ctx = makeCtx();
      var fixture = {
        _meta: meta,
        customerpayments_list: sanitizeFixture(raw.pay, ctx),
        customerpayments_range_list: sanitizeFixture(raw.payRange, ctx),
        invoices_list: sanitizeFixture(raw.inv, ctx),
        invoice_detail: sanitizeFixture(raw.detail, ctx)
      };
      if (customerId) fixture.customer_payments_list = sanitizeFixture(raw.custPay, ctx);
      process.stdout.write('===FIXTURE-BEGIN===\n' + JSON.stringify(fixture, null, 2) +
        '\n===FIXTURE-END===\n', function () { process.exit(0); });
    })
    .catch(function (err) {
      console.error('Spike failed: ' + errText(err));
      process.exit(1);
    });
}

module.exports = {
  sanitizeFixture: sanitizeFixture,
  redactNote: redactNote,
  redactReference: redactReference,
  deriveJoinMode: deriveJoinMode,
  notesSourceOf: notesSourceOf,
  KNOWN_NOTE_PREFIXES: KNOWN_NOTE_PREFIXES
};

// require.main is undefined when piped via `node -` over stdin, so accept that too.
if (require.main === module || typeof require.main === 'undefined') main();
