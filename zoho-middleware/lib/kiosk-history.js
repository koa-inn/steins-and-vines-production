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

function ledgerTotals(rows) {
  var count = 0;
  var cents = 0;
  (rows || []).forEach(function (r) {
    if (r.status === 'Void') return;
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
  LINE_ITEM_KEYS: LINE_ITEM_KEYS
};
