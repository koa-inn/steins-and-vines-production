'use strict';

// Phase 90 (D-07..D-10): pure helpers for GET /api/batch/link-candidates.
// No I/O. Window math runs on YYYY-MM-DD strings via Date.UTC so it never
// depends on the process timezone.

var WINDOW_DAYS = 60;
var MAX_DETAIL_FETCH = 10;
var MAX_CANDIDATES = 3;

var DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
var MS_PER_DAY = 86400000;

function parseDateUtc(str) {
  var m = DATE_RE.exec(String(str || ''));
  if (!m) return null;
  var y = Number(m[1]);
  var mo = Number(m[2]);
  var d = Number(m[3]);
  var t = Date.UTC(y, mo - 1, d);
  var dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return t;
}

function formatDateUtc(t) {
  var dt = new Date(t);
  var mm = String(dt.getUTCMonth() + 1);
  var dd = String(dt.getUTCDate());
  return dt.getUTCFullYear() + '-' + (mm.length < 2 ? '0' + mm : mm) + '-' + (dd.length < 2 ? '0' + dd : dd);
}

function normaliseCustomerName(name) {
  return String(name === null || name === undefined ? '' : name).trim().replace(/\s+/g, ' ').toLowerCase();
}

function isWalkIn(normName) {
  return normName === '' || normName === 'walk-in' || normName === 'walk in' || normName === 'walkin';
}

function validateCandidateQuery(query) {
  query = query || {};
  var startDate = typeof query.start_date === 'string' ? query.start_date : '';
  if (parseDateUtc(startDate) === null) {
    return { ok: false, message: 'start_date must be a valid YYYY-MM-DD date' };
  }
  var customerId = query.customer_id === null || query.customer_id === undefined ? '' : String(query.customer_id).trim();
  if (customerId) {
    if (!/^\d{1,30}$/.test(customerId)) {
      return { ok: false, message: 'customer_id must be digits only' };
    }
    return { ok: true, noCustomer: false, customer_id: customerId, customer_name: '', start_date: startDate };
  }
  var rawName = query.customer_name === null || query.customer_name === undefined ? '' : String(query.customer_name);
  if (rawName.length > 100) {
    return { ok: false, message: 'customer_name must be 100 characters or fewer' };
  }
  var cleaned = rawName.trim().replace(/\s+/g, ' ');
  if (isWalkIn(cleaned.toLowerCase())) {
    return { ok: true, noCustomer: true, customer_id: '', customer_name: '', start_date: startDate };
  }
  return { ok: true, noCustomer: false, customer_id: '', customer_name: cleaned, start_date: startDate };
}

function candidateWindow(startDate) {
  var t = parseDateUtc(startDate);
  if (t === null) throw new Error('invalid start_date');
  return {
    date_start: formatDateUtc(t - WINDOW_DAYS * MS_PER_DAY),
    date_end: formatDateUtc(t + WINDOW_DAYS * MS_PER_DAY)
  };
}

function dateDistanceDays(dateStr, startDate) {
  var a = parseDateUtc(dateStr);
  var b = parseDateUtc(startDate);
  if (a === null || b === null) return Number.MAX_SAFE_INTEGER;
  return Math.round(Math.abs(a - b) / MS_PER_DAY);
}

function toCandidate(listRow, detail, startDate, hasKitLine) {
  listRow = listRow || {};
  detail = detail || {};
  var lineItems = (detail.line_items || []).map(function (li) {
    return {
      name: li.name || li.description || '',
      quantity: li.quantity || 1,
      rate: li.rate || 0
    };
  });
  return {
    invoice_id: listRow.invoice_id,
    invoice_number: listRow.invoice_number,
    date: listRow.date || '',
    total: Number(listRow.total) || 0,
    status: listRow.status || '',
    balance: Number(listRow.balance) || 0,
    customer_name: listRow.customer_name || '',
    has_kit_line: !!hasKitLine,
    line_items: lineItems,
    linked_batches: null,
    date_distance_days: dateDistanceDays(listRow.date, startDate)
  };
}

function rankCandidates(candidates) {
  return (candidates || []).slice().sort(function (a, b) {
    if (a.has_kit_line !== b.has_kit_line) return a.has_kit_line ? -1 : 1;
    if (a.date_distance_days !== b.date_distance_days) return a.date_distance_days - b.date_distance_days;
    var an = String(a.invoice_number || '');
    var bn = String(b.invoice_number || '');
    return an < bn ? -1 : an > bn ? 1 : 0;
  }).slice(0, MAX_CANDIDATES);
}

module.exports = {
  validateCandidateQuery: validateCandidateQuery,
  candidateWindow: candidateWindow,
  normaliseCustomerName: normaliseCustomerName,
  rankCandidates: rankCandidates,
  toCandidate: toCandidate,
  dateDistanceDays: dateDistanceDays,
  WINDOW_DAYS: WINDOW_DAYS,
  MAX_DETAIL_FETCH: MAX_DETAIL_FETCH,
  MAX_CANDIDATES: MAX_CANDIDATES
};
