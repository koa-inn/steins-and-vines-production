'use strict';

// Tests for lib/dual-write-compare.js — Phase 83 Plan 04 Task 2 (D-08).
//
// compareAndReport() is the generic Sheets-vs-Postgres discrepancy reporter
// every Phase 84+ store calls after a dual write. It must never throw into
// the caller (mirrors lib/sentry-capture.js's never-throw wrapper pattern)
// and must never leak raw field values to Sentry unless the caller opts a
// specific key into reportValuesFor.

jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
});

var mockCaptureExceptionSafe = jest.fn();
jest.mock('../lib/sentry-capture', function () {
  return { captureExceptionSafe: function (err, opts) { return mockCaptureExceptionSafe(err, opts); } };
});

var dualWriteCompare = require('../lib/dual-write-compare');
var log = require('../lib/logger');

describe('dual-write-compare', function () {
  beforeEach(function () {
    mockCaptureExceptionSafe.mockReset();
    log.warn.mockClear();
  });

  describe('compareAndReport', function () {
    test('identical objects -> match true, empty differences, Sentry not called', function () {
      var result = dualWriteCompare.compareAndReport({
        store: 'giftcards',
        operation: 'redeem',
        sheets: { balance: 10, name: 'a' },
        postgres: { balance: 10, name: 'a' }
      });
      expect(result).toEqual({ match: true, differences: [] });
      expect(mockCaptureExceptionSafe).not.toHaveBeenCalled();
    });

    test('money: sheets 12.5 (number) vs postgres "12.50" (pg numeric string) -> match', function () {
      var result = dualWriteCompare.compareAndReport({
        store: 'giftcards', operation: 'redeem',
        sheets: { balance: 12.5 }, postgres: { balance: '12.50' }
      });
      expect(result.match).toBe(true);
    });

    test('money: sheets 12.5 vs postgres "12.51" -> one difference at that path', function () {
      var result = dualWriteCompare.compareAndReport({
        store: 'giftcards', operation: 'redeem',
        sheets: { balance: 12.5 }, postgres: { balance: '12.51' }
      });
      expect(result.match).toBe(false);
      expect(result.differences.length).toBe(1);
      expect(result.differences[0].path).toBe('balance');
    });

    test('empties: "" vs null vs undefined -> match', function () {
      var r1 = dualWriteCompare.compareAndReport({
        store: 's', operation: 'op', sheets: { notes: '' }, postgres: { notes: null }
      });
      expect(r1.match).toBe(true);

      var r2 = dualWriteCompare.compareAndReport({
        store: 's', operation: 'op', sheets: { notes: undefined }, postgres: { notes: '' }
      });
      expect(r2.match).toBe(true);
    });

    test('timestamps: Date vs ISO string of the same instant -> match; different instants -> difference', function () {
      var d = new Date('2026-09-30T12:00:00.000Z');
      var sameIso = '2026-09-30T12:00:00.000Z';
      var diffIso = '2026-09-30T12:00:01.000Z';

      var r1 = dualWriteCompare.compareAndReport({
        store: 's', operation: 'op', sheets: { ts: d }, postgres: { ts: sameIso }
      });
      expect(r1.match).toBe(true);

      var r2 = dualWriteCompare.compareAndReport({
        store: 's', operation: 'op', sheets: { ts: d }, postgres: { ts: diffIso }
      });
      expect(r2.match).toBe(false);
      expect(r2.differences[0].path).toBe('ts');
    });

    test('booleans: "TRUE" vs true -> match; "FALSE" vs true -> difference', function () {
      var r1 = dualWriteCompare.compareAndReport({
        store: 's', operation: 'op', sheets: { active: 'TRUE' }, postgres: { active: true }
      });
      expect(r1.match).toBe(true);

      var r2 = dualWriteCompare.compareAndReport({
        store: 's', operation: 'op', sheets: { active: 'FALSE' }, postgres: { active: true }
      });
      expect(r2.match).toBe(false);
    });

    test('nested objects and arrays compared positionally; extra key on one side -> difference with that path', function () {
      var r = dualWriteCompare.compareAndReport({
        store: 's', operation: 'op',
        sheets: { items: [{ qty: 1 }, { qty: 2 }], extra: 'x' },
        postgres: { items: [{ qty: 1 }, { qty: 3 }] }
      });
      expect(r.match).toBe(false);
      var paths = r.differences.map(function (d) { return d.path; });
      expect(paths).toEqual(expect.arrayContaining(['items.1.qty', 'extra']));
    });

    test('ignoreKeys excludes differences at that key', function () {
      var r = dualWriteCompare.compareAndReport({
        store: 's', operation: 'op',
        sheets: { balance: 10, last_updated: '2026-01-01' },
        postgres: { balance: 10, last_updated: '2026-01-02' },
        ignoreKeys: ['last_updated']
      });
      expect(r.match).toBe(true);
      expect(r.differences).toEqual([]);
    });

    test('on mismatch: captureExceptionSafe called once with the expected error/options shape, no raw values', function () {
      var r = dualWriteCompare.compareAndReport({
        store: 'giftcards', operation: 'redeem',
        sheets: { balance: 10 }, postgres: { balance: 11 }
      });
      expect(r.match).toBe(false);
      expect(mockCaptureExceptionSafe).toHaveBeenCalledTimes(1);

      var callArgs = mockCaptureExceptionSafe.mock.calls[0];
      var err = callArgs[0];
      var opts = callArgs[1];

      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('[dual-write] giftcards.redeem discrepancy');
      expect(opts.level).toBe('warning');
      expect(opts.tags).toEqual({ component: 'dual-write', store: 'giftcards', operation: 'redeem' });
      expect(opts.fingerprint).toEqual(['dual-write', 'giftcards', 'redeem']);
      expect(opts.extra.differenceCount).toBe(1);
      expect(opts.extra.paths).toEqual(['balance']);
      expect(opts.extra.values).toBeUndefined();
    });

    test('paths capped at 20 in Sentry extra', function () {
      var sheets = {};
      var postgres = {};
      for (var i = 0; i < 25; i++) {
        sheets['k' + i] = 'a';
        postgres['k' + i] = 'b';
      }
      var r = dualWriteCompare.compareAndReport({ store: 's', operation: 'op', sheets: sheets, postgres: postgres });
      expect(r.differences.length).toBe(25);
      var opts = mockCaptureExceptionSafe.mock.calls[0][1];
      expect(opts.extra.paths.length).toBe(20);
      expect(opts.extra.differenceCount).toBe(25);
    });

    test('reportValuesFor opts specific keys into Sentry extra.values, others excluded', function () {
      var r = dualWriteCompare.compareAndReport({
        store: 's', operation: 'op',
        sheets: { balance: 10, secret: 'a' },
        postgres: { balance: 11, secret: 'b' },
        reportValuesFor: ['balance']
      });
      expect(r.match).toBe(false);
      var opts = mockCaptureExceptionSafe.mock.calls[0][1];
      expect(opts.extra.values).toBeDefined();
      expect(opts.extra.values.balance).toEqual({ sheets: 10, postgres: 11 });
      expect(opts.extra.values.secret).toBeUndefined();
    });

    test('a throwing getter in the inputs -> returns match null, does not throw, logs a warning', function () {
      var throwing = {};
      Object.defineProperty(throwing, 'bad', {
        enumerable: true,
        get: function () { throw new Error('getter boom'); }
      });
      var result;
      expect(function () {
        result = dualWriteCompare.compareAndReport({ store: 's', operation: 'op', sheets: throwing, postgres: {} });
      }).not.toThrow();
      expect(result).toEqual({ match: null, differences: [] });
      expect(log.warn).toHaveBeenCalled();
    });

    test('a circular structure in the inputs -> returns match null, does not throw', function () {
      var circularA = {};
      circularA.self = circularA;
      var circularB = {};
      circularB.self = circularB;
      var result;
      expect(function () {
        result = dualWriteCompare.compareAndReport({ store: 's', operation: 'op', sheets: circularA, postgres: circularB });
      }).not.toThrow();
      expect(result).toEqual({ match: null, differences: [] });
    });

    test('captureExceptionSafe itself throwing -> compareAndReport still does not throw', function () {
      mockCaptureExceptionSafe.mockImplementation(function () { throw new Error('sentry down'); });
      var result;
      expect(function () {
        result = dualWriteCompare.compareAndReport({
          store: 's', operation: 'op', sheets: { balance: 1 }, postgres: { balance: 2 }
        });
      }).not.toThrow();
      expect(result).toEqual({ match: null, differences: [] });
    });
  });

  describe('diffValues', function () {
    test('returns an array of { path, sheetsType, postgresType } for each mismatch', function () {
      var diffs = dualWriteCompare.diffValues({ a: 1 }, { a: 2 });
      expect(diffs.length).toBe(1);
      expect(diffs[0]).toEqual(expect.objectContaining({ path: 'a' }));
      expect(diffs[0].sheetsType).toBeDefined();
      expect(diffs[0].postgresType).toBeDefined();
    });

    test('returns empty array for identical values', function () {
      expect(dualWriteCompare.diffValues({ a: 1, b: 'x' }, { a: 1, b: 'x' })).toEqual([]);
    });

    test('respects opts.ignoreKeys', function () {
      var diffs = dualWriteCompare.diffValues({ a: 1, b: 2 }, { a: 1, b: 3 }, { ignoreKeys: ['b'] });
      expect(diffs).toEqual([]);
    });
  });
});
