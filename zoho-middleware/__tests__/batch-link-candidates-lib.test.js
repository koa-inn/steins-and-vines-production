'use strict';

var lib = require('../lib/batch-link-candidates');

describe('batch-link-candidates lib', function () {
  test('constants', function () {
    expect(lib.WINDOW_DAYS).toBe(60);
    expect(lib.MAX_DETAIL_FETCH).toBe(10);
    expect(lib.MAX_CANDIDATES).toBe(3);
  });

  describe('validateCandidateQuery', function () {
    test('valid customer_id + date', function () {
      var r = lib.validateCandidateQuery({ customer_id: '123', start_date: '2026-08-01' });
      expect(r.ok).toBe(true);
      expect(r.noCustomer).toBeFalsy();
      expect(r.customer_id).toBe('123');
    });
    test('non-digit customer_id rejected', function () {
      expect(lib.validateCandidateQuery({ customer_id: 'abc', start_date: '2026-08-01' }).ok).toBe(false);
    });
    test('customer_name over 100 chars rejected', function () {
      var n = new Array(102).join('a');
      expect(n.length).toBe(101);
      expect(lib.validateCandidateQuery({ customer_name: n, start_date: '2026-08-01' }).ok).toBe(false);
    });
    test('bad dates rejected', function () {
      expect(lib.validateCandidateQuery({ customer_id: '1', start_date: '2026-8-1' }).ok).toBe(false);
      expect(lib.validateCandidateQuery({ customer_id: '1', start_date: '2026-02-30' }).ok).toBe(false);
      expect(lib.validateCandidateQuery({ customer_id: '1' }).ok).toBe(false);
    });
    test('blank and walk-in names are noCustomer', function () {
      var a = lib.validateCandidateQuery({ customer_name: '', start_date: '2026-08-01' });
      expect(a.ok).toBe(true);
      expect(a.noCustomer).toBe(true);
      var b = lib.validateCandidateQuery({ customer_name: '  walk-in ', start_date: '2026-08-01' });
      expect(b.ok).toBe(true);
      expect(b.noCustomer).toBe(true);
    });
    test('customer_name path returns normalised name', function () {
      var r = lib.validateCandidateQuery({ customer_name: '  Jane   DOE ', start_date: '2026-08-01' });
      expect(r.ok).toBe(true);
      expect(r.customer_name).toBe('Jane   DOE'.replace(/\s+/g, ' '));
    });
  });

  describe('candidateWindow', function () {
    test('60 days each side', function () {
      expect(lib.candidateWindow('2026-01-15')).toEqual({ date_start: '2025-11-16', date_end: '2026-03-16' });
    });
    test('independent of TZ', function () {
      var orig = process.env.TZ;
      try {
        process.env.TZ = 'America/Vancouver';
        expect(lib.candidateWindow('2026-01-15')).toEqual({ date_start: '2025-11-16', date_end: '2026-03-16' });
        process.env.TZ = 'UTC';
        expect(lib.candidateWindow('2026-01-15')).toEqual({ date_start: '2025-11-16', date_end: '2026-03-16' });
      } finally {
        if (orig === undefined) delete process.env.TZ; else process.env.TZ = orig;
      }
    });
  });

  test('normaliseCustomerName', function () {
    expect(lib.normaliseCustomerName('  Jane   DOE ')).toBe(lib.normaliseCustomerName('jane doe'));
    expect(lib.normaliseCustomerName('Jane Doerr')).not.toBe(lib.normaliseCustomerName('jane doe'));
  });

  describe('rankCandidates', function () {
    function c(num, kit, dist) { return { invoice_number: num, has_kit_line: kit, date_distance_days: dist }; }
    test('kit first, then distance, then number, capped at 3', function () {
      var out = lib.rankCandidates([
        c('INV-5', false, 1), c('INV-4', true, 30), c('INV-3', true, 10),
        c('INV-2', true, 10), c('INV-1', false, 0)
      ]);
      expect(out.map(function (x) { return x.invoice_number; })).toEqual(['INV-2', 'INV-3', 'INV-4']);
    });
    test('non-kit after kit and ordered by distance', function () {
      var out = lib.rankCandidates([c('A', false, 5), c('B', true, 50), c('C', false, 2)]);
      expect(out.map(function (x) { return x.invoice_number; })).toEqual(['B', 'C', 'A']);
    });
  });

  test('toCandidate maps contract fields', function () {
    var row = { invoice_id: 'i1', invoice_number: 'INV-000171', date: '2026-07-20', total: '120.5', status: 'paid', balance: 0, customer_name: 'Jane Doe' };
    var detail = { line_items: [{ name: 'Kit', quantity: 2, rate: 50, item_total: 100, item_id: 'x' }, { description: 'Fee', quantity: 1, rate: 20.5 }] };
    var c = lib.toCandidate(row, detail, '2026-08-01', true);
    expect(c).toEqual({
      invoice_id: 'i1', invoice_number: 'INV-000171', date: '2026-07-20', total: 120.5,
      status: 'paid', balance: 0, customer_name: 'Jane Doe', has_kit_line: true,
      line_items: [{ name: 'Kit', quantity: 2, rate: 50 }, { name: 'Fee', quantity: 1, rate: 20.5 }],
      linked_batches: null, date_distance_days: 12
    });
  });

  test('daysBetween absolute', function () {
    var c = lib.toCandidate({ invoice_id: 'a', date: '2026-08-10' }, {}, '2026-08-01', false);
    expect(c.date_distance_days).toBe(9);
    expect(c.line_items).toEqual([]);
  });
});
