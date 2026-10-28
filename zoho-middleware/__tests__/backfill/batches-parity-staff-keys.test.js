'use strict';

/**
 * Phase 95 (D-08, T-95-05): staff_batch is Postgres-only. Parity ignores it and neither
 * serializeBatch nor the ops-mirror request carries it.
 */

var parity = require('../../scripts/backfill/batches-parity');
var rules = require('../../lib/batch-rules');
var opsMirror = require('../../lib/ops-mirror');

describe('staff_batch stays out of parity and the sheet mirror', function () {
  test('diffParity ignores a staff_batch key present only on the proxy side', function () {
    var sheet = { k: { data: { batches: [{ batch_id: 'SV-B-000001', status: 'primary' }] } } };
    var proxy = { k: { data: { batches: [{ batch_id: 'SV-B-000001', status: 'primary', staff_batch: true }] } } };
    expect(parity.diffParity(sheet, proxy)).toEqual([]);
  });

  test('other columns are still compared', function () {
    var d = parity.diffParity(
      { k: { data: { status: 'primary' } } },
      { k: { data: { status: 'complete', staff_batch: true } } }
    );
    expect(d).toEqual([{ action: 'k', path: 'data.status' }]);
  });

  test('serializeBatch drops staff_batch', function () {
    var out = rules.serializeBatch({ batch_id: 'SV-B-000001', status: 'primary', staff_batch: true });
    expect(Object.keys(out)).toEqual(rules.BATCH_COLUMNS);
    expect(out).not.toHaveProperty('staff_batch');
  });

  test('the mirror request for a staff batch carries no staff_batch key', function () {
    var batch = rules.serializeBatch({ batch_id: 'SV-B-000001', status: 'primary', staff_batch: true });
    var req = opsMirror.buildMirrorRequest('batch', { batch: batch, tasks: [], readings: [], history: [] }, 'SV-B-000001');
    expect(req.action).toBe('mirror_batch_state');
    expect(JSON.stringify(req)).not.toContain('staff_batch');
  });
});
