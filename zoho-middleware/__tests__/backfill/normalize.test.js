'use strict';

var normalize = require('../../scripts/backfill/normalize');
var specs = require('../../scripts/backfill/specs');

var TZ = 'America/Vancouver';

describe('normalizeTimestamp', function () {
  test('exceljs Date (wall-clock in UTC fields) in September converts using PDT (UTC-7)', function () {
    var d = new Date(Date.UTC(2026, 8, 2, 14, 3)); // 2026-09-02 14:03 wall clock
    var result = normalize.normalizeTimestamp(d, { timezone: TZ });
    expect(result.ok).toBe(true);
    expect(result.value).toBe('2026-09-02T21:03:00.000Z');
  });

  test('exceljs Date in January converts using PST (UTC-8)', function () {
    var d = new Date(Date.UTC(2026, 0, 15, 14, 3)); // 2026-01-15 14:03 wall clock
    var result = normalize.normalizeTimestamp(d, { timezone: TZ });
    expect(result.ok).toBe(true);
    expect(result.value).toBe('2026-01-15T22:03:00.000Z');
  });

  test('ISO string with Z is parsed as the same instant', function () {
    var result = normalize.normalizeTimestamp('2026-09-02T21:03:00.000Z', { timezone: TZ });
    expect(result.ok).toBe(true);
    expect(result.value).toBe('2026-09-02T21:03:00.000Z');
  });

  test('ISO string with explicit numeric offset resolves to the same instant', function () {
    var result = normalize.normalizeTimestamp('2026-09-02T14:03:00-07:00', { timezone: TZ });
    expect(result.ok).toBe(true);
    expect(result.value).toBe('2026-09-02T21:03:00.000Z');
  });

  test('date-only string interprets as local midnight in the timezone, with a note', function () {
    var result = normalize.normalizeTimestamp('2026-09-02', { timezone: TZ });
    expect(result.ok).toBe(true);
    // Sept 2 00:00 Vancouver (PDT, UTC-7) -> 07:00 UTC
    expect(result.value).toBe('2026-09-02T07:00:00.000Z');
    expect(result.note).toBe('date-only interpreted as local midnight');
  });

  test('US-format date string is rejected, not coerced', function () {
    var result = normalize.normalizeTimestamp('9/2/2026 2:03 PM', { timezone: TZ });
    expect(result.ok).toBe(false);
    expect(typeof result.reason).toBe('string');
  });

  test('ISO-shaped string with no offset/zone is rejected (ambiguous, Trap 2)', function () {
    var result = normalize.normalizeTimestamp('2026-09-02T14:03:00', { timezone: TZ });
    expect(result.ok).toBe(false);
  });

  test('bare Excel serial number is rejected, not coerced', function () {
    var result = normalize.normalizeTimestamp(45000, { timezone: TZ });
    expect(result.ok).toBe(false);
  });

  test('an arbitrary word is rejected', function () {
    var result = normalize.normalizeTimestamp('yesterday', { timezone: TZ });
    expect(result.ok).toBe(false);
  });

  test('a cell-error object is rejected', function () {
    var result = normalize.normalizeTimestamp({ cellError: '#REF!' }, { timezone: TZ });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/#REF!/);
  });
});

describe('normalizeEmpty', function () {
  test('empty string -> null', function () {
    expect(normalize.normalizeEmpty('')).toEqual({ ok: true, value: null });
  });
  test('whitespace-only string -> null', function () {
    expect(normalize.normalizeEmpty('   ')).toEqual({ ok: true, value: null });
  });
  test('null -> null', function () {
    expect(normalize.normalizeEmpty(null)).toEqual({ ok: true, value: null });
  });
  test('undefined -> null', function () {
    expect(normalize.normalizeEmpty(undefined)).toEqual({ ok: true, value: null });
  });
  test('non-empty value is not recognized as empty', function () {
    expect(normalize.normalizeEmpty('hi').ok).toBe(false);
  });
});

describe('normalizeBoolean', function () {
  test('"TRUE" -> true', function () {
    expect(normalize.normalizeBoolean('TRUE')).toEqual({ ok: true, value: true });
  });
  test('"FALSE" -> false', function () {
    expect(normalize.normalizeBoolean('FALSE')).toEqual({ ok: true, value: false });
  });
  test('boolean true passes through', function () {
    expect(normalize.normalizeBoolean(true)).toEqual({ ok: true, value: true });
  });
  test('boolean false passes through', function () {
    expect(normalize.normalizeBoolean(false)).toEqual({ ok: true, value: false });
  });
  test('"yes" is rejected, not coerced', function () {
    expect(normalize.normalizeBoolean('yes').ok).toBe(false);
  });
  test('"True " (trailing space) is rejected', function () {
    expect(normalize.normalizeBoolean('True ').ok).toBe(false);
  });
  test('1 (number) is rejected', function () {
    expect(normalize.normalizeBoolean(1).ok).toBe(false);
  });
});

describe('normalizeJson', function () {
  test('valid JSON array string parses', function () {
    var result = normalize.normalizeJson('[{"day":1}]');
    expect(result.ok).toBe(true);
    expect(result.value).toEqual([{ day: 1 }]);
  });
  test('invalid JSON string is rejected', function () {
    expect(normalize.normalizeJson('{bad').ok).toBe(false);
  });
  test('an already-parsed object is rejected (steps must be a JSON string)', function () {
    expect(normalize.normalizeJson([{ day: 1 }]).ok).toBe(false);
  });
});

describe('normalizeNumeric', function () {
  test('12.5 with precision 10 scale 2 -> "12.50"', function () {
    expect(normalize.normalizeNumeric(12.5, { precision: 10, scale: 2 })).toEqual({ ok: true, value: '12.50' });
  });
  test('"12.5" (string) -> "12.50"', function () {
    expect(normalize.normalizeNumeric('12.5', { precision: 10, scale: 2 })).toEqual({ ok: true, value: '12.50' });
  });
  test('0.1 + 0.2 float drift rounds to "0.30"', function () {
    expect(normalize.normalizeNumeric(0.1 + 0.2, { precision: 10, scale: 2 })).toEqual({ ok: true, value: '0.30' });
  });
  test('12.345 with scale 2 is rejected (more decimals than scale)', function () {
    expect(normalize.normalizeNumeric(12.345, { precision: 10, scale: 2 }).ok).toBe(false);
  });
  test('1000 with precision 5 scale 2 is rejected (overflow)', function () {
    expect(normalize.normalizeNumeric(1000, { precision: 5, scale: 2 }).ok).toBe(false);
  });
  test('"abc" is rejected', function () {
    expect(normalize.normalizeNumeric('abc', { precision: 10, scale: 2 }).ok).toBe(false);
  });
  test('NaN is rejected', function () {
    expect(normalize.normalizeNumeric(NaN, { precision: 10, scale: 2 }).ok).toBe(false);
  });
  test('Infinity is rejected', function () {
    expect(normalize.normalizeNumeric(Infinity, { precision: 10, scale: 2 }).ok).toBe(false);
  });
});

describe('normalizeId', function () {
  test('"PR-000042" with prefix PR pad 6 -> ok', function () {
    expect(normalize.normalizeId('PR-000042', { prefix: 'PR', pad: 6 })).toEqual({ ok: true, value: 'PR-000042' });
  });
  test('"PR-42" with prefix PR pad 6 -> rejected (not padded)', function () {
    expect(normalize.normalizeId('PR-42', { prefix: 'PR', pad: 6 }).ok).toBe(false);
  });
  test('42 (number, lost padding) -> rejected', function () {
    expect(normalize.normalizeId(42, { prefix: 'PR', pad: 6 }).ok).toBe(false);
  });
  test('"FS-0007" with prefix FS pad 4 -> ok', function () {
    expect(normalize.normalizeId('FS-0007', { prefix: 'FS', pad: 4 })).toEqual({ ok: true, value: 'FS-0007' });
  });
  test('no prefix known -> any non-empty string is ok', function () {
    expect(normalize.normalizeId('anything-goes')).toEqual({ ok: true, value: 'anything-goes' });
  });
  test('no prefix known -> a number is still rejected', function () {
    expect(normalize.normalizeId(42).ok).toBe(false);
  });
});

describe('normalizeRow', function () {
  var vesselHistorySpec = specs.getSpec('VesselHistory');

  test('required column empty -> reject with reason "required"', function () {
    var result = normalize.normalizeRow(vesselHistorySpec, {
      vh_id: '',
      batch_id: 'SV-B-000001',
      vessel_id: '', shelf_id: '', bin_id: '',
      moved_at: '2026-09-02T21:03:00.000Z',
      moved_by: '', note: ''
    }, { timezone: TZ });
    expect(result.ok).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ column: 'vh_id', reason: 'required' })])
    );
  });

  test('optional empty column becomes null', function () {
    var result = normalize.normalizeRow(vesselHistorySpec, {
      vh_id: 'V1',
      batch_id: 'SV-B-000001',
      vessel_id: '', shelf_id: '', bin_id: '',
      moved_at: '2026-09-02T21:03:00.000Z',
      moved_by: '', note: ''
    }, { timezone: TZ });
    expect(result.ok).toBe(true);
    expect(result.values.vessel_id).toBeNull();
    expect(result.values.note).toBeNull();
  });

  test('multiple failing columns -> all reasons listed', function () {
    var result = normalize.normalizeRow(vesselHistorySpec, {
      vh_id: '',
      batch_id: 'SV-B-42', // bad padding
      vessel_id: '', shelf_id: '', bin_id: '',
      moved_at: 'yesterday', // unparseable
      moved_by: '', note: ''
    }, { timezone: TZ });
    expect(result.ok).toBe(false);
    var columns = result.reasons.map(function (r) { return r.column; });
    expect(columns).toEqual(expect.arrayContaining(['vh_id', 'batch_id', 'moved_at']));
    expect(result.reasons.length).toBe(3);
  });

  test('a \'\' timestamp in an optional column becomes null, not a timestamp reject', function () {
    var platoSpec = specs.getSpec('PlatoReadings');
    var result = normalize.normalizeRow(platoSpec, {
      reading_id: 'PR-000001',
      batch_id: 'SV-B-000001',
      timestamp: '2026-09-02T21:03:00.000Z',
      plato: '12.50',
      notes: '', recorded_by: '',
      created_at: '2026-09-02T21:03:00.000Z',
      temperature: '', ph: ''
    }, { timezone: TZ });
    expect(result.ok).toBe(true);
    expect(result.values.temperature).toBeNull();
    expect(result.values.ph).toBeNull();
  });

  test('a fully valid row for FermSchedules normalises every column', function () {
    var fermSpec = specs.getSpec('FermSchedules');
    var result = normalize.normalizeRow(fermSpec, {
      schedule_id: 'FS-0007',
      name: 'Standard Ale',
      description: '', category: '',
      steps: '[{"day":1}]',
      active: 'TRUE',
      created_at: '2026-09-02T21:03:00.000Z',
      created_by: '',
      updated_at: '2026-09-02T21:03:00.000Z'
    }, { timezone: TZ });
    expect(result.ok).toBe(true);
    expect(result.values).toEqual({
      schedule_id: 'FS-0007',
      name: 'Standard Ale',
      description: null,
      category: null,
      steps: [{ day: 1 }],
      active: true,
      created_at: '2026-09-02T21:03:00.000Z',
      created_by: null,
      updated_at: '2026-09-02T21:03:00.000Z'
    });
  });
});

describe('specs.getSpec / listSpecs', function () {
  test('getSpec by sheet name and by table name return the same spec', function () {
    var bySheet = specs.getSpec('PlatoReadings');
    var byTable = specs.getSpec('plato_readings');
    expect(bySheet).toBe(byTable);
  });

  test('getSpec throws for an unknown sheet', function () {
    expect(function () { specs.getSpec('GiftCards'); }).toThrow(/no spec/);
  });

  test('listSpecs lists the three rehearsal sheets', function () {
    expect(specs.listSpecs()).toEqual(
      expect.arrayContaining(['VesselHistory', 'PlatoReadings', 'FermSchedules'])
    );
  });
});
