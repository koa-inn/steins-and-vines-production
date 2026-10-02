'use strict';

/**
 * Regression tests for CR-03 (83-REVIEW.md) / D-12: the backfill normaliser must REJECT
 * any text-column cell it cannot confidently convert to a string, never coerce it with
 * String(raw). Before this fix, a cell-error object became "[object Object]", a Date
 * became a locale/timezone-dependent string, and a boolean became "true"/"false" — all
 * silently accepted as ok:true.
 */

var normalize = require('../../scripts/backfill/normalize');
var specs = require('../../scripts/backfill/specs');

var TZ = 'America/Vancouver';

function baseRow(overrides) {
  var row = {
    history_id: 'VH-000002',
    batch_id: 'SV-B-000001',
    vessel_id: 'V1',
    shelf_id: '',
    bin_id: '',
    transferred_at: '2026-09-02T21:03:00.000Z',
    transferred_by: '',
    notes: ''
  };
  Object.keys(overrides || {}).forEach(function (key) {
    row[key] = overrides[key];
  });
  return row;
}

describe('normalizeRow text columns never coerce (CR-03, D-12)', function () {
  var vesselHistorySpec = specs.getSpec('VesselHistory');

  function run(overrides) {
    return normalize.normalizeRow(vesselHistorySpec, baseRow(overrides), { timezone: TZ });
  }

  test('the verifier\'s reproduction: boolean vessel_id + cell-error notes both reject, with exactly 2 reasons', function () {
    var result = run({ vessel_id: true, notes: { cellError: '#REF!' } });
    expect(result.ok).toBe(false);
    expect(result.reasons).toHaveLength(2);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        { column: 'vessel_id', reason: 'expected text, got boolean', rawType: 'boolean' },
        { column: 'note', reason: 'cell error: #REF!', rawType: 'object' }
      ])
    );
  });

  test('a Date value in a text column is rejected with "expected text, got date", never stringified', function () {
    var result = run({ shelf_id: new Date(Date.UTC(2026, 2, 4)) });
    expect(result.ok).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ column: 'shelf_id', reason: 'expected text, got date' })
      ])
    );
  });

  test('a plain object in a text column is rejected with "expected text, got object"', function () {
    var result = run({ transferred_by: { foo: 1 } });
    expect(result.ok).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ column: 'moved_by', reason: 'expected text, got object' })
      ])
    );
  });

  test('NaN in a text column is rejected as a non-finite number', function () {
    var result = run({ bin_id: NaN });
    expect(result.ok).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ column: 'bin_id', reason: expect.stringMatching(/expected text, got non-finite number/) })
      ])
    );
  });

  test('Infinity in a text column is rejected as a non-finite number', function () {
    var result = run({ bin_id: Infinity });
    expect(result.ok).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ column: 'bin_id', reason: expect.stringMatching(/expected text, got non-finite number/) })
      ])
    );
  });

  test('a finite number in a text column is still accepted and stringified (bin_id 24 -> "24")', function () {
    var result = run({ bin_id: 24 });
    expect(result.ok).toBe(true);
    expect(result.values.bin_id).toBe('24');
  });

  test('a string in a text column is trimmed and accepted', function () {
    var result = run({ vessel_id: '  V-7  ' });
    expect(result.ok).toBe(true);
    expect(result.values.vessel_id).toBe('V-7');
  });

  test('false is not empty, so it must reject rather than becoming null', function () {
    var result = run({ notes: false });
    expect(result.ok).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ column: 'note', reason: 'expected text, got boolean' })
      ])
    );
  });
});
