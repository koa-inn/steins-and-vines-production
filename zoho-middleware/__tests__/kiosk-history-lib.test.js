'use strict';

var fs = require('fs');
var path = require('path');
var hist = require('../lib/kiosk-history');
var C = require('../lib/constants');

describe('cache keys', function () {
  test('versioned prefixes', function () {
    expect(C.CACHE_KEYS.KIOSK_HISTORY_LEDGER_PREFIX).toBe('kiosk:history:ledger:v1:');
    expect(C.CACHE_KEYS.KIOSK_HISTORY_CUSTOMER_PREFIX).toBe('kiosk:history:customer:v1:');
    expect(C.CACHE_KEYS.KIOSK_HISTORY_INVOICE_PREFIX).toBe('kiosk:history:invoice:v1:');
    expect(C.CACHE_KEYS.KIOSK_HISTORY_TENDER_PREFIX).toBe('kiosk:history:tender:v1:');
  });
});

describe('date helpers', function () {
  test('isRealDate', function () {
    expect(hist.isRealDate('2026-10-16')).toBe(true);
    expect(hist.isRealDate('2026-02-30')).toBe(false);
    expect(hist.isRealDate('2026-1-5')).toBe(false);
    expect(hist.isRealDate(undefined)).toBe(false);
  });
  test('addDays', function () {
    expect(hist.addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(hist.addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
  test('addMonths clamps', function () {
    expect(hist.addMonths('2026-10-16', -12)).toBe('2025-10-16');
    expect(hist.addMonths('2026-03-31', -1)).toBe('2026-02-28');
  });
});

describe('Vancouver day', function () {
  test('vancouverDay', function () {
    expect(hist.vancouverDay(new Date('2026-10-17T02:30:00Z'))).toBe('2026-10-16');
  });
  var maybe = Number(process.versions.node.split('.')[0]) >= 24 ? test : test.skip;
  maybe('permanent UTC-7 on Node 24 tzdata', function () {
    expect(hist.vancouverDay(new Date('2026-12-16T06:30:00Z'))).toBe('2026-12-15');
  });
  test('parseZohoTime', function () {
    expect(hist.parseZohoTime('2026-10-16T19:30:00-0700').getTime()).toBe(Date.parse('2026-10-17T02:30:00Z'));
    expect(hist.parseZohoTime('2026-10-16T19:30:00-07:00').getTime()).toBe(Date.parse('2026-10-17T02:30:00Z'));
    expect(hist.parseZohoTime('')).toBeNull();
    expect(hist.parseZohoTime('garbage')).toBeNull();
  });
  test('createdDay', function () {
    expect(hist.createdDay({ created_time: '2026-10-16T19:30:00-0700', date: '2026-10-17' })).toBe('2026-10-16');
    expect(hist.createdDay({ date: '2026-10-16' })).toBe('2026-10-16');
  });
  test('hhmmVancouver', function () {
    expect(hist.hhmmVancouver('2026-10-16T19:30:00-0700')).toBe('19:30');
    expect(hist.hhmmVancouver('')).toBe('');
  });
});

describe('statusLabel', function () {
  test('maps', function () {
    expect(hist.statusLabel('paid')).toBe('Paid');
    ['sent', 'overdue', 'unpaid', 'viewed'].forEach(function (s) {
      expect(hist.statusLabel(s)).toBe('Unpaid');
    });
    expect(hist.statusLabel('partially_paid')).toBe('Partial');
    expect(hist.statusLabel('void')).toBe('Void');
    expect(hist.statusLabel('draft')).toBe('Draft');
    expect(hist.statusLabel('weird')).toBe('Unpaid');
    expect(hist.statusLabel()).toBe('Unpaid');
  });
});

describe('tenderLabel', function () {
  test('maps and joins', function () {
    expect(hist.tenderLabel([{ payment_mode: 'others' }, { payment_mode: 'creditcard' }])).toBe('Card + Gift card');
    expect(hist.tenderLabel([{ payment_mode: 'debitcard' }])).toBe('Card');
    expect(hist.tenderLabel([{ payment_mode: 'cash' }, { payment_mode: 'cash' }])).toBe('Cash');
    expect(hist.tenderLabel([{ payment_mode: 'bitcoin' }])).toBe('Other');
    expect(hist.tenderLabel([])).toBe('');
  });
});

describe('classify', function () {
  test('in-store by reference', function () {
    expect(hist.classify({ reference_number: 'KIOSK-1760650000000' }, [])).toBe('in-store');
    expect(hist.classify({ reference_number: 'POS-123' }, [])).toBe('in-store');
  });
  test('in-store by note', function () {
    ['Kiosk SO payment. Terminal txn: 1', 'In-store terminal payment. Helcim txn: 1', 'Legacy POS payment. Terminal txn: 1']
      .forEach(function (n) {
        expect(hist.classify({ reference_number: '' }, [n])).toBe('in-store');
      });
  });
  test('in-store wins over online', function () {
    expect(hist.classify({ reference_number: '' }, ['Online payment for Sales Order SO-1', 'Kiosk SO payment. Terminal txn: 2'])).toBe('in-store');
  });
  test('online', function () {
    expect(hist.classify({ reference_number: '48213377' }, [])).toBe('online');
  });
  test('blank reference is in-store regardless of note (owner decision 92-01)', function () {
    expect(hist.classify({ reference_number: '' }, [])).toBe('in-store');
    expect(hist.classify({ reference_number: '' }, ['Online payment for Invoice INV-1'])).toBe('in-store');
    expect(hist.classify({}, null)).toBe('in-store');
  });
  test('all-digit reference with in-store note is in-store', function () {
    expect(hist.classify({ reference_number: '123' }, ['Kiosk recipe sale. Ref: 1'])).toBe('in-store');
  });
  test('other', function () {
    expect(hist.classify({ reference_number: 'misc' }, ['Customer note'])).toBe('other');
  });
  test('tolerates nulls', function () {
    expect(hist.classify({ reference_number: 'misc' }, [null, undefined])).toBe('other');
    expect(hist.classify({ reference_number: 'misc' }, null)).toBe('other');
  });
});

describe('slim builders', function () {
  var raw = {
    invoice_id: 123456789, invoice_number: 'INV-1', date: '2026-10-17',
    created_time: '2026-10-16T19:30:00-0700', customer_name: 'Pat', status: 'paid',
    total: 12.5, balance: 0,
    email: 'SENT_EMAIL', phone: 'SENT_PHONE', billing_address: { address: 'SENT_ADDR' },
    notes: 'SENT_NOTES', custom_fields: [{ value: 'SENT_CF' }],
    reference_number: 'SENT_REF', salesperson_name: 'SENT_SALES'
  };
  test('slimInvoiceRow', function () {
    var row = hist.slimInvoiceRow(raw, 'in-store', 'Card');
    expect(Object.keys(row).sort()).toEqual(hist.ROW_KEYS.slice().sort());
    expect(row.invoice_id).toBe('123456789');
    expect(row.date).toBe('2026-10-16');
    expect(row.time).toBe('19:30');
    expect(row.status).toBe('Paid');
    expect(row.total).toBe(12.5);
    expect(hist.slimInvoiceRow({}, 'other', '').total).toBe(0);
    expect(hist.slimInvoiceRow({}, 'other', '').balance).toBe(0);
    var json = JSON.stringify(row);
    ['SENT_EMAIL', 'SENT_PHONE', 'SENT_ADDR', 'SENT_NOTES', 'SENT_CF', 'SENT_REF', 'SENT_SALES'].forEach(function (s) {
      expect(json).not.toContain(s);
    });
  });
  test('slimInvoiceDetail', function () {
    var d = hist.slimInvoiceDetail({
      invoice_id: '1', invoice_number: 'INV-1', date: '2026-10-16', created_time: '2026-10-16T19:30:00-0700',
      customer_name: 'Pat', status: 'paid', sub_total: 10, tax_total: 1, total: 11, balance_due: 2,
      line_items: [{ name: '', description: 'Desc', quantity: 2, rate: 5, item_total: 10, item_id: 'SENT_ITEM' },
        { name: 'B', quantity: 1, rate: 1, amount: 1 }],
      payments: [{ reference_number: 'SENT_PAY' }], notes: 'SENT_NOTES', email: 'SENT_EMAIL'
    });
    expect(Object.keys(d).sort()).toEqual(hist.DETAIL_KEYS.slice().sort());
    d.line_items.forEach(function (li) {
      expect(Object.keys(li).sort()).toEqual(hist.LINE_ITEM_KEYS.slice().sort());
    });
    expect(d.line_items[0].name).toBe('Desc');
    expect(d.line_items[0].amount).toBe(10);
    expect(d.line_items[1].amount).toBe(1);
    expect(d.balance).toBe(2);
    var json = JSON.stringify(d);
    ['SENT_PAY', 'SENT_NOTES', 'SENT_EMAIL', 'SENT_ITEM'].forEach(function (s) {
      expect(json).not.toContain(s);
    });
    var empty = hist.slimInvoiceDetail({});
    expect(empty.sub_total).toBe(0);
    expect(empty.tax_total).toBe(0);
    expect(empty.balance).toBe(0);
    expect(empty.line_items).toEqual([]);
  });
});

describe('ledgerTotals', function () {
  test('cents-exact, void excluded', function () {
    expect(hist.ledgerTotals([
      { status: 'Paid', total: 10.1 }, { status: 'Void', total: 99 },
      { status: 'Unpaid', total: 0.2 }, { status: 'Draft', total: 5 }
    ])).toEqual({ count: 3, gross_total: 15.3 });
  });
});

describe('sortByCreatedDesc', function () {
  test('orders desc, missing last, no mutation', function () {
    var input = [
      { id: 'a', created_time: '2026-10-16T10:00:00-0700' },
      { id: 'none' },
      { id: 'b', created_time: '2026-10-16T12:00:00-0700' },
      { id: 'c', created_time: '2026-10-16T10:00:00-0700' }
    ];
    var copy = input.slice();
    var out = hist.sortByCreatedDesc(input);
    expect(out.map(function (x) { return x.id; })).toEqual(['b', 'a', 'c', 'none']);
    expect(input).toEqual(copy);
  });
});

describe('notes-prefix contract', function () {
  var text = ['pos.js', 'pos-recipe.js', 'webhooks.js', 'checkout.js'].map(function (f) {
    return fs.readFileSync(path.join(__dirname, '..', 'routes', f), 'utf8');
  }).join('\n');
  hist.IN_STORE_NOTE_PREFIXES.concat(hist.ONLINE_NOTE_PREFIXES).forEach(function (p) {
    test('route files still emit "' + p + '"', function () {
      expect(text.indexOf("'" + p)).not.toBe(-1);
    });
  });
});
