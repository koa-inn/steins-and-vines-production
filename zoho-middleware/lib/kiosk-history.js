'use strict';
/**
 * Kiosk past-sales pure helpers (Phase 92). No I/O, ES5.
 *
 * Date math runs on YYYY-MM-DD strings via Date.UTC so it never depends on the
 * process timezone. Day bucketing uses Intl with America/Vancouver (never a
 * hardcoded offset).
 *
 * Output builders construct objects field by field (D-12 allowlist): nothing
 * from the Zoho object is spread or copied wholesale.
 */

var TIMEZONE = 'America/Vancouver';
var DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
var MS_PER_DAY = 86400000;

var IN_STORE_REF_PREFIXES = ['KIOSK-', 'POS-'];
var IN_STORE_NOTE_PREFIXES = ['Kiosk ', 'In-store terminal payment', 'Legacy POS payment'];
var ONLINE_NOTE_PREFIXES = ['Online payment'];

var ROW_KEYS = ['invoice_id', 'invoice_number', 'date', 'time', 'customer_name', 'source', 'status', 'tender', 'total', 'balance'];
var DETAIL_KEYS = ['invoice_id', 'invoice_number', 'date', 'time', 'customer_name', 'status', 'sub_total', 'tax_total', 'total', 'balance', 'line_items'];
var LINE_ITEM_KEYS = ['name', 'quantity', 'rate', 'amount'];

var TENDER_LABELS = { creditcard: 'Card', debitcard: 'Card', cash: 'Cash', others: 'Gift card' };
var TENDER_ORDER = ['Card', 'Cash', 'Gift card', 'Other'];

function parseDateUtc(str) {
  var m = DATE_RE.exec(String(str || ''));
  if (!m) return null;
  var y = Number(m[1]); var mo = Number(m[2]); var d = Number(m[3]);
  var t = Date.UTC(y, mo - 1, d);
  var dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return t;
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }

function formatDateUtc(t) {
  var dt = new Date(t);
  return dt.getUTCFullYear() + '-' + pad2(dt.getUTCMonth() + 1) + '-' + pad2(dt.getUTCDate());
}

function isRealDate(str) {
  return parseDateUtc(str) !== null;
}

function addDays(str, n) {
  var t = parseDateUtc(str);
  if (t === null) return null;
  return formatDateUtc(t + n * MS_PER_DAY);
}

function addMonths(str, n) {
  var t = parseDateUtc(str);
  if (t === null) return null;
  var dt = new Date(t);
  var day = dt.getUTCDate();
  var total = dt.getUTCFullYear() * 12 + dt.getUTCMonth() + n;
  var y = Math.floor(total / 12);
  var mo = total - y * 12;
  var lastDay = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  return y + '-' + pad2(mo + 1) + '-' + pad2(Math.min(day, lastDay));
}

function zoneParts(date, timezone) {
  var parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  var out = {};
  parts.forEach(function (p) { out[p.type] = p.value; });
  return out;
}

function vancouverDay(date) {
  var p = zoneParts(date, TIMEZONE);
  return p.year + '-' + p.month + '-' + p.day;
}

// Zoho created_time is ISO with a colon-less numeric offset; normalise before parsing.
function parseZohoTime(str) {
  if (!str || typeof str !== 'string') return null;
  var norm = str.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  var d = new Date(norm);
  if (isNaN(d.getTime())) return null;
  return d;
}

function createdDay(inv) {
  var d = parseZohoTime(inv && inv.created_time);
  if (d) return vancouverDay(d);
  return (inv && inv.date) ? String(inv.date) : '';
}

function hhmmVancouver(str) {
  var d = parseZohoTime(str);
  if (!d) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(d);
}

function statusLabel(status) {
  switch (String(status || '').toLowerCase()) {
    case 'paid': return 'Paid';
    case 'partially_paid': return 'Partial';
    case 'void': return 'Void';
    case 'draft': return 'Draft';
    default: return 'Unpaid';
  }
}

function tenderLabel(payments) {
  var seen = {};
  (payments || []).forEach(function (p) {
    var mode = String((p && p.payment_mode) || '').toLowerCase();
    seen[TENDER_LABELS[mode] || 'Other'] = true;
  });
  return TENDER_ORDER.filter(function (l) { return seen[l]; }).join(' + ');
}

function startsWithAny(str, prefixes) {
  for (var i = 0; i < prefixes.length; i++) {
    if (str.indexOf(prefixes[i]) === 0) return true;
  }
  return false;
}

// Owner decision 92-01 (list-join-blank-in-store): a blank-reference invoice is
// in-store regardless of payment note (SO-pay invoices carry no reference and
// payment notes are mostly blank in Zoho). All-digit references are online
// unless an in-store payment note marks them in-store (recipe safety net).
function classify(inv, notes) {
  var ref = String((inv && inv.reference_number) || '');
  var list = Array.isArray(notes) ? notes : [];
  var inStoreNote = false;
  list.forEach(function (n) {
    if (typeof n === 'string' && startsWithAny(n, IN_STORE_NOTE_PREFIXES)) inStoreNote = true;
  });
  if (startsWithAny(ref, IN_STORE_REF_PREFIXES)) return 'in-store';
  if (ref === '') return 'in-store';
  if (inStoreNote) return 'in-store';
  if (/^\d+$/.test(ref)) return 'online';
  return 'other';
}

// Index customer-payment list rows by the invoice they pay. linkageField
// 'invoice_numbers' is a comma string (live shape, 92-01 fixture); any other
// value is treated as an invoices[] array of { invoice_id, invoice_number }.
// Returns { <invoice_number|invoice_id>: [{ payment_mode, note }] }.
function indexPaymentsByInvoice(payments, linkageField, notesField) {
  var out = {};
  function add(key, entry) {
    if (!key) return;
    if (!out[key]) out[key] = [];
    out[key].push(entry);
  }
  (payments || []).forEach(function (p) {
    if (!p) return;
    var entry = {
      payment_mode: p.payment_mode || '',
      note: typeof p[notesField || 'description'] === 'string' ? p[notesField || 'description'] : ''
    };
    var link = p[linkageField];
    if (typeof link === 'string') {
      link.split(',').forEach(function (n) { add(n.replace(/^\s+|\s+$/g, ''), entry); });
    } else if (Array.isArray(link)) {
      link.forEach(function (i) {
        if (!i) return;
        add(i.invoice_number, entry);
        if (i.invoice_id) add(String(i.invoice_id), entry);
      });
    }
  });
  return out;
}

function num(v) {
  var n = Number(v);
  return isFinite(n) ? n : 0;
}

function slimInvoiceRow(inv, source, tender) {
  inv = inv || {};
  return {
    invoice_id: String(inv.invoice_id || ''),
    invoice_number: inv.invoice_number || '',
    date: createdDay(inv),
    time: hhmmVancouver(inv.created_time),
    customer_name: inv.customer_name || '',
    source: source,
    status: statusLabel(inv.status),
    tender: tender || '',
    total: num(inv.total),
    balance: num(inv.balance)
  };
}

function slimInvoiceDetail(detail) {
  detail = detail || {};
  var items = Array.isArray(detail.line_items) ? detail.line_items : [];
  return {
    invoice_id: String(detail.invoice_id || ''),
    invoice_number: detail.invoice_number || '',
    date: createdDay(detail),
    time: hhmmVancouver(detail.created_time),
    customer_name: detail.customer_name || '',
    status: statusLabel(detail.status),
    sub_total: num(detail.sub_total),
    tax_total: num(detail.tax_total),
    total: num(detail.total),
    balance: num(detail.balance !== undefined && detail.balance !== null ? detail.balance : detail.balance_due),
    line_items: items.map(function (li) {
      return {
        name: li.name || li.description || '',
        quantity: li.quantity || 0,
        rate: li.rate || 0,
        amount: li.item_total || li.amount || 0
      };
    })
  };
}

// Voids (D-04) and drafts (Phase 92 WR-03 owner decision 2026-10-16) are listed
// with a badge but are not sales: they never enter the count or gross total.
function ledgerTotals(rows) {
  var count = 0;
  var cents = 0;
  (rows || []).forEach(function (r) {
    if (r.status === 'Void' || r.status === 'Draft') return;
    count += 1;
    cents += Math.round(num(r.total) * 100);
  });
  return { count: count, gross_total: cents / 100 };
}

function sortByCreatedDesc(invoices) {
  var decorated = (invoices || []).map(function (inv, i) {
    var d = parseZohoTime(inv && inv.created_time);
    return { inv: inv, i: i, t: d ? d.getTime() : null };
  });
  decorated.sort(function (a, b) {
    if (a.t === null && b.t === null) return a.i - b.i;
    if (a.t === null) return 1;
    if (b.t === null) return -1;
    if (a.t !== b.t) return b.t - a.t;
    return a.i - b.i;
  });
  return decorated.map(function (x) { return x.inv; });
}

// ---- Phase 93: week/month range helpers (pure, string arithmetic only) ----

// Monday on or before `day` (ROADMAP weeks run Mon-Sun).
function weekStart(day) {
  var t = parseDateUtc(day);
  if (t === null) return null;
  var dow = new Date(t).getUTCDay();
  return addDays(day, -((dow + 6) % 7));
}

function monthStart(day) {
  return String(day).slice(0, 8) + '01';
}

function monthEnd(day) {
  return addDays(addMonths(monthStart(day), 1), -1);
}

function periodBounds(type, anchor) {
  if (type === 'week') {
    var s = weekStart(anchor);
    return { start: s, end: addDays(s, 6) };
  }
  if (type === 'month') {
    return { start: monthStart(anchor), end: monthEnd(anchor) };
  }
  return null;
}

// Mirrors the day query window (date_start=day, date_end=day+1): a record whose
// own `date` is outside [day, day+1] would not have been returned by Zoho.
// Missing or unparseable dates are accepted.
function inDayWindow(rec, day) {
  var d = rec && rec.date;
  if (typeof d === 'string' && DATE_RE.test(d) && isRealDate(d)) {
    return d === day || d === addDays(day, 1);
  }
  return true;
}

function inDayQueryWindow(inv, day) {
  return inDayWindow(inv, day);
}

function paymentInDayWindow(p, day) {
  return inDayWindow(p, day);
}

function invoiceBelongsToDay(inv, day) {
  return createdDay(inv) === day && inDayQueryWindow(inv, day);
}

// True exactly when an in-store payment note could change classify's result,
// so callers may skip the payments fetch for invoices where it is false.
function needsPaymentNotes(inv) {
  return classify(inv, []) !== classify(inv, [IN_STORE_NOTE_PREFIXES[0] + 'x']);
}

// The single per-day chain shared by the day ledger and the range build (D-12).
function ledgerRowsForDay(day, invoices, payRows, linkageField, notesField) {
  var dayInvoices = (invoices || []).filter(function (i) { return invoiceBelongsToDay(i, day); });
  var dayPays = (payRows || []).filter(function (p) { return paymentInDayWindow(p, day); });
  var idx = indexPaymentsByInvoice(dayPays, linkageField, notesField);
  var kept = [];
  var tenders = {};
  dayInvoices.forEach(function (inv) {
    var paid = idx[inv.invoice_number] || [];
    var notes = paid.map(function (p) { return p.note; });
    if (classify(inv, notes) !== 'in-store') return;
    kept.push(inv);
    tenders[inv.invoice_id] = tenderLabel(paid);
  });
  return sortByCreatedDesc(kept).map(function (inv) {
    return slimInvoiceRow(inv, 'in-store', tenders[inv.invoice_id]);
  });
}

module.exports = {
  TIMEZONE: TIMEZONE,
  isRealDate: isRealDate,
  addDays: addDays,
  addMonths: addMonths,
  vancouverDay: vancouverDay,
  parseZohoTime: parseZohoTime,
  createdDay: createdDay,
  hhmmVancouver: hhmmVancouver,
  statusLabel: statusLabel,
  tenderLabel: tenderLabel,
  classify: classify,
  indexPaymentsByInvoice: indexPaymentsByInvoice,
  slimInvoiceRow: slimInvoiceRow,
  slimInvoiceDetail: slimInvoiceDetail,
  ledgerTotals: ledgerTotals,
  sortByCreatedDesc: sortByCreatedDesc,
  IN_STORE_REF_PREFIXES: IN_STORE_REF_PREFIXES,
  IN_STORE_NOTE_PREFIXES: IN_STORE_NOTE_PREFIXES,
  ONLINE_NOTE_PREFIXES: ONLINE_NOTE_PREFIXES,
  ROW_KEYS: ROW_KEYS,
  DETAIL_KEYS: DETAIL_KEYS,
  LINE_ITEM_KEYS: LINE_ITEM_KEYS,
  weekStart: weekStart,
  monthStart: monthStart,
  monthEnd: monthEnd,
  periodBounds: periodBounds,
  inDayQueryWindow: inDayQueryWindow,
  invoiceBelongsToDay: invoiceBelongsToDay,
  paymentInDayWindow: paymentInDayWindow,
  needsPaymentNotes: needsPaymentNotes,
  ledgerRowsForDay: ledgerRowsForDay
};
