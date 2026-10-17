'use strict';

var hist = require('../lib/kiosk-history');

// Local Node 20 tzdata is wrong after 2026-11-01 (BC permanent time).
var maybe = Number(process.versions.node.split('.')[0]) >= 24 ? test : test.skip;

describe('weekStart', function () {
  test('all seven weekdays map to the same Monday', function () {
    ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'].forEach(function (d) {
      expect(hist.weekStart(d)).toBe('2026-10-12');
    });
  });
  test('year rollover and Sunday anchor', function () {
    expect(hist.weekStart('2027-01-01')).toBe('2026-12-28');
    expect(hist.weekStart('2026-11-01')).toBe('2026-10-26');
    expect(hist.weekStart('2026-11-02')).toBe('2026-11-02');
  });
});

describe('periodBounds', function () {
  test('week', function () {
    expect(hist.periodBounds('week', '2026-12-31')).toEqual({ start: '2026-12-28', end: '2027-01-03' });
    expect(hist.periodBounds('week', '2026-11-01')).toEqual({ start: '2026-10-26', end: '2026-11-01' });
    expect(hist.periodBounds('week', '2026-10-12')).toEqual({ start: '2026-10-12', end: '2026-10-18' });
  });
  test('month', function () {
    expect(hist.periodBounds('month', '2026-10-17')).toEqual({ start: '2026-10-01', end: '2026-10-31' });
    expect(hist.periodBounds('month', '2026-09-05').end).toBe('2026-09-30');
    expect(hist.periodBounds('month', '2026-02-10').end).toBe('2026-02-28');
    expect(hist.periodBounds('month', '2028-02-10').end).toBe('2028-02-29');
    expect(hist.periodBounds('month', '2026-12-31').end).toBe('2026-12-31');
  });
  test('monthStart / monthEnd', function () {
    expect(hist.monthStart('2026-10-17')).toBe('2026-10-01');
    expect(hist.monthEnd('2026-04-03')).toBe('2026-04-30');
  });
});

describe('window predicates', function () {
  test('inDayQueryWindow', function () {
    expect(hist.inDayQueryWindow({ date: '2026-10-15' }, '2026-10-15')).toBe(true);
    expect(hist.inDayQueryWindow({ date: '2026-10-16' }, '2026-10-15')).toBe(true);
    expect(hist.inDayQueryWindow({ date: '2026-10-14' }, '2026-10-15')).toBe(false);
    expect(hist.inDayQueryWindow({ date: '2026-10-17' }, '2026-10-15')).toBe(false);
    expect(hist.inDayQueryWindow({}, '2026-10-15')).toBe(true);
    expect(hist.inDayQueryWindow({ date: 'garbage' }, '2026-10-15')).toBe(true);
  });
  test('paymentInDayWindow', function () {
    expect(hist.paymentInDayWindow({ date: '2026-10-16' }, '2026-10-15')).toBe(true);
    expect(hist.paymentInDayWindow({ date: '2026-10-18' }, '2026-10-15')).toBe(false);
    expect(hist.paymentInDayWindow({}, '2026-10-15')).toBe(true);
    expect(hist.paymentInDayWindow({ date: 'x' }, '2026-10-15')).toBe(true);
  });
  test('invoiceBelongsToDay rejects backdated invoice', function () {
    var inv = { created_time: '2026-10-15T10:00:00-0700', date: '2026-10-12' };
    expect(hist.invoiceBelongsToDay(inv, '2026-10-15')).toBe(false);
    var ok = { created_time: '2026-10-15T10:00:00-0700', date: '2026-10-15' };
    expect(hist.invoiceBelongsToDay(ok, '2026-10-15')).toBe(true);
  });
});

describe('needsPaymentNotes', function () {
  test('matches classify sensitivity', function () {
    expect(hist.needsPaymentNotes({ reference_number: 'KIOSK-1' })).toBe(false);
    expect(hist.needsPaymentNotes({ reference_number: 'POS-2' })).toBe(false);
    expect(hist.needsPaymentNotes({ reference_number: '' })).toBe(false);
    expect(hist.needsPaymentNotes({})).toBe(false);
    expect(hist.needsPaymentNotes({ reference_number: null })).toBe(false);
    expect(hist.needsPaymentNotes({ reference_number: '48213377' })).toBe(true);
    expect(hist.needsPaymentNotes({ reference_number: 'ABC1' })).toBe(true);
  });
});

describe('ledgerRowsForDay', function () {
  var day = '2026-10-15';
  function inv(id, num, ref, time, date) {
    return {
      invoice_id: id, invoice_number: num, reference_number: ref,
      created_time: time, date: date || day, customer_name: 'C' + id,
      status: 'paid', total: 10, balance: 0
    };
  }
  function pay(num, mode, note, date) {
    return { invoice_numbers: num, payment_mode: mode, description: note, date: date };
  }

  test('keeps in-store rows newest first with tender', function () {
    var invoices = [
      inv('1', 'INV-1', 'KIOSK-1', '2026-10-15T09:00:00-0700'),
      inv('2', 'INV-2', 'KIOSK-2', '2026-10-15T11:00:00-0700'),
      inv('3', 'INV-3', '555', '2026-10-15T10:00:00-0700')
    ];
    var pays = [pay('INV-2', 'cash', '', day)];
    var rows = hist.ledgerRowsForDay(day, invoices, pays, 'invoice_numbers', 'description');
    expect(rows.map(function (r) { return r.invoice_id; })).toEqual(['2', '1']);
    expect(rows[0].tender).toBe('Cash');
    expect(rows[0].source).toBe('in-store');
  });

  test('drops backdated invoices', function () {
    var invoices = [inv('1', 'INV-1', 'KIOSK-1', '2026-10-15T09:00:00-0700', '2026-10-12')];
    expect(hist.ledgerRowsForDay(day, invoices, [], 'invoice_numbers', 'description')).toEqual([]);
  });

  test('drops out-of-window payments before indexing', function () {
    var invoices = [inv('1', 'INV-1', '48213377', '2026-10-15T09:00:00-0700')];
    var late = [pay('INV-1', 'cash', 'In-store terminal payment', '2026-10-18')];
    var inWin = [pay('INV-1', 'cash', 'In-store terminal payment', day)];
    expect(hist.ledgerRowsForDay(day, invoices, late, 'invoice_numbers', 'description')).toEqual([]);
    expect(hist.ledgerRowsForDay(day, invoices, inWin, 'invoice_numbers', 'description').length).toBe(1);
  });

  test('keeps void and draft rows', function () {
    var v = inv('1', 'INV-1', 'KIOSK-1', '2026-10-15T09:00:00-0700');
    v.status = 'void';
    var rows = hist.ledgerRowsForDay(day, [v], [], 'invoice_numbers', 'description');
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('Void');
  });

  maybe('late-day invoice after 2026-11-01 buckets by Vancouver day', function () {
    var d = '2026-11-02';
    var i = inv('1', 'INV-1', 'KIOSK-1', '2026-11-02T08:00:00-0800', d);
    expect(hist.ledgerRowsForDay(d, [i], [], 'invoice_numbers', 'description').length).toBe(1);
  });
});
