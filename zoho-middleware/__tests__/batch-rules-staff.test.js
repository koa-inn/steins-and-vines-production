'use strict';

var rules = require('../lib/batch-rules');

describe('batch-rules staff_batch helpers (Phase 95, D-08)', function () {
  it('STAFF_AUTO_SOURCES lists internal and research', function () {
    expect(rules.STAFF_AUTO_SOURCES).toEqual(['internal', 'research']);
  });

  it('isStaffAutoSource is true for internal/research (trim, case-insensitive)', function () {
    expect(rules.isStaffAutoSource('internal')).toBe(true);
    expect(rules.isStaffAutoSource('research')).toBe(true);
    expect(rules.isStaffAutoSource(' Research ')).toBe(true);
  });

  it('isStaffAutoSource is false for every other source', function () {
    ['kiosk', 'kiosk_recipe', 'online', 'manual', 'zoho_scan', '', null, undefined].forEach(function (s) {
      expect(rules.isStaffAutoSource(s)).toBe(false);
    });
  });

  it('normalizeStaffBatch maps booleans and their string forms', function () {
    expect(rules.normalizeStaffBatch(true)).toBe(true);
    expect(rules.normalizeStaffBatch('true')).toBe(true);
    expect(rules.normalizeStaffBatch(false)).toBe(false);
    expect(rules.normalizeStaffBatch('false')).toBe(false);
  });

  it('normalizeStaffBatch returns null for anything else', function () {
    ['yes', 1, 0, '', null, undefined, {}].forEach(function (v) {
      expect(rules.normalizeStaffBatch(v)).toBeNull();
    });
  });

  it('staff_batch is not a mirrored column', function () {
    expect(rules.BATCH_COLUMNS).not.toContain('staff_batch');
  });
});
