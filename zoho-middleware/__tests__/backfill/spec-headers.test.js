'use strict';

/**
 * Pins every rehearsal spec's ordered `header` list to the REAL row-1 headers of the
 * live "STEINS AND VINES" workbook (verified 2026-10-02, after the owner inserted the
 * missing VesselHistory `bin_id` header the same day).
 *
 * Regression for the 2026-10-02 rehearsal: specs whose `header` values had drifted from
 * the sheet (vh_id/moved_at/moved_by/note, plato, active/updated_at) made normalizeRow
 * see every required cell as missing, so 100% of rows were rejected.
 *
 * If the sheet's headers change, update BOTH this list and the spec — never just one.
 */

var specs = require('../../scripts/backfill/specs');

var REAL_SHEET_HEADERS = {
  VesselHistory: [
    'history_id',
    'batch_id',
    'vessel_id',
    'shelf_id',
    'bin_id',
    'transferred_at',
    'transferred_by',
    'notes'
  ],
  PlatoReadings: [
    'reading_id',
    'batch_id',
    'timestamp',
    'degrees_plato',
    'notes',
    'recorded_by',
    'created_at',
    'temperature',
    'ph'
  ],
  FermSchedules: [
    'schedule_id',
    'name',
    'description',
    'category',
    'steps',
    'is_active',
    'created_at',
    'created_by',
    'last_updated'
  ]
};

function headersOf(spec) {
  return spec.columns.map(function (c) {
    return c.header;
  });
}

describe('backfill spec headers match the real sheet row 1', function () {
  test('every spec is covered by this test', function () {
    expect(specs.listSpecs().slice().sort()).toEqual(Object.keys(REAL_SHEET_HEADERS).sort());
  });

  Object.keys(REAL_SHEET_HEADERS).forEach(function (sheet) {
    test(sheet + ' headers equal the sheet headers, in sheet order', function () {
      expect(headersOf(specs.getSpec(sheet))).toEqual(REAL_SHEET_HEADERS[sheet]);
    });
  });

  test('VesselHistory bin_id header maps to the bin_id column as optional text', function () {
    var binCol = specs.getSpec('VesselHistory').columns.filter(function (c) {
      return c.header === 'bin_id';
    })[0];
    expect(binCol).toEqual(
      expect.objectContaining({ name: 'bin_id', type: 'text', pgType: 'text', required: false })
    );
  });

  test('each spec primaryKey is the column read from the sheet\'s first (id) header', function () {
    Object.keys(REAL_SHEET_HEADERS).forEach(function (sheet) {
      var spec = specs.getSpec(sheet);
      expect(spec.columns[0].header).toBe(REAL_SHEET_HEADERS[sheet][0]);
      expect(spec.columns[0].name).toBe(spec.primaryKey);
    });
  });
});
