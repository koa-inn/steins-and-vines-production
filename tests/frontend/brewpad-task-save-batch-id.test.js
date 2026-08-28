'use strict';

// Regression test for the "task checkbox flashes then reverts, only correct after
// re-login" bug.
//
// Root cause: the client sent `bulk_update_batch_tasks` with NO `batch_id`, so the
// Apps Script write handler called `_invalidateBatchCache(payload.batch_id)` with
// `undefined`. `_invalidateBatchCache` only busts the per-batch detail cache key
// (`gb:<batchId>`) when a batchId is present, so the 5-minute `get_batch` cache was
// never invalidated. The post-write `afterBatchWrite(refreshOpenDetail)` refetch
// then returned the STALE (incomplete) batch and repainted the checkbox back to
// unchecked. A fresh login outlived the TTL, which is why it "only worked after
// logging back in".
//
// The fix: every `bulk_update_batch_tasks` write payload must include `batch_id`
// (task.batch_id on the dashboard/tasks handlers, _selectedBatchId on the detail
// pane) so the server can bust `gb:<batchId>`.
//
// The three task-checkbox handlers bind via addEventListener inside the IIFE and
// build their payload in an un-exported setTimeout callback, with adminApiPost as a
// module-local (non-injectable) function — so this is asserted as a source-contract
// test, matching the existing "task toggle batch_id contract" block in
// brewpad-after-batch-write.test.js.

var fs = require('fs');
var path = require('path');

var SRC = fs.readFileSync(path.join(__dirname, '../../js/brewpad.js'), 'utf8');

describe('bulk_update_batch_tasks write payload includes batch_id (cache-bust regression)', function () {
  // Every line that POSTs bulk_update_batch_tasks. Each call site is a single line.
  var callLines = SRC.split('\n').filter(function (line) {
    return line.indexOf("adminApiPost('bulk_update_batch_tasks'") !== -1;
  });

  test('all three task-save call sites still exist', function () {
    // Guards against the matcher silently going stale if the call sites are
    // refactored/renamed — a zero-match filter must not read as "all pass".
    expect(callLines.length).toBe(3);
  });

  test('every bulk_update_batch_tasks payload passes batch_id', function () {
    callLines.forEach(function (line) {
      expect(line).toMatch(/batch_id\s*:/);
    });
  });
});
