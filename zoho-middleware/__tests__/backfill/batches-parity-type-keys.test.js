'use strict';

/**
 * Phase 94 review WR-02: the proxy get_batches/get_batch responses now carry the Postgres-only
 * batch_type / batch_type_source. The sheet never has them, so parity ignores them.
 */

var parity = require('../../scripts/backfill/batches-parity');

describe('diffParity ignores Postgres-only batch type keys', function () {
  test('batch_type and batch_type_source present only on the proxy side are not differences', function () {
    var sheet = { k: { data: { batches: [{ batch_id: 'SV-B-000001', status: 'primary' }] } } };
    var proxy = { k: { data: { batches: [{
      batch_id: 'SV-B-000001', status: 'primary', batch_type: 'beer', batch_type_source: 'recipe'
    }] } } };
    expect(parity.diffParity(sheet, proxy)).toEqual([]);
  });

  test('other sheet columns are still compared', function () {
    var d = parity.diffParity(
      { k: { data: { status: 'primary' } } },
      { k: { data: { status: 'complete', batch_type: 'beer' } } }
    );
    expect(d).toEqual([{ action: 'k', path: 'data.status' }]);
  });
});
