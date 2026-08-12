// ---------------------------------------------------------------------------
// Owner ticket #2: mark-bottled staleness regression tests
// ---------------------------------------------------------------------------
// Completing the Bottling/Packaging task checkbox must remove the batch from
// the dashboard's Ready-to-Bottle list immediately, with no full page reload.
//
// Root cause (see 69-PATTERNS.md): the server already busts the `gbds` cache
// on every bulk_update_batch_tasks write, but the client's three task-checkbox
// handlers re-render the stale in-memory _dashSummary (via renderDashboard()/
// renderTasks()) instead of refetching it via loadDashboard() — the only
// function that re-fetches get_batch_dashboard_summary and rebuilds
// _dashSummary / _dashLoadTime.
//
// These are structural source-text regression tests (the established pattern
// for pinning behavior inside BrewPad's un-exported IIFE-scoped event
// handlers — see brewpad-activation.test.js, brewpad-pull-from-zoho.test.js).
// No synthetic DOM change-event dispatch: there is no dispatch precedent for
// these handlers in the existing suite.
//
// Each handler is anchored by its adminApiPost('bulk_update_batch_tasks' call
// site, located via successive indexOf() from an increasing offset so each
// window is scoped to exactly one handler's success/catch block (measured
// handler lengths: ~2079, ~2082, ~1064 chars; gaps between anchors: ~7648,
// ~4673 chars — a 1500-char window cannot bleed into the next handler).
// ---------------------------------------------------------------------------

describe('mark-bottled freshness: task-checkbox handlers refetch dashboard after save', function () {
  var fs = require('fs');
  var path = require('path');
  var src = fs.readFileSync(path.join(__dirname, '../../js/brewpad.js'), 'utf8');

  var ANCHOR = "adminApiPost('bulk_update_batch_tasks'";
  var WINDOW = 1500;

  var idx1 = src.indexOf(ANCHOR); // (a) dashboard handler (~8160)
  var idx2 = src.indexOf(ANCHOR, idx1 + ANCHOR.length); // (b) tasks-tab handler (~8329)
  var idx3 = src.indexOf(ANCHOR, idx2 + ANCHOR.length); // (c) batch-detail-pane handler (~8429)

  var window1 = idx1 === -1 ? '' : src.slice(idx1, idx1 + WINDOW);
  var window2 = idx2 === -1 ? '' : src.slice(idx2, idx2 + WINDOW);
  var window3 = idx3 === -1 ? '' : src.slice(idx3, idx3 + WINDOW);

  test('dashboard handler success path calls loadDashboard() after save (~8160)', function () {
    expect(idx1).not.toBe(-1);
    expect(window1.indexOf('loadDashboard()')).not.toBe(-1);
  });

  test('tasks-tab handler success path calls loadDashboard() after save (~8329)', function () {
    expect(idx2).not.toBe(-1);
    expect(window2.indexOf('loadDashboard()')).not.toBe(-1);
  });

  test('batch-detail-pane handler success path adds afterBatchWrite( and loadDashboard() after save (~8429, absent today)', function () {
    expect(idx3).not.toBe(-1);
    expect(window3.indexOf('afterBatchWrite(')).not.toBe(-1);
    expect(window3.indexOf('loadDashboard()')).not.toBe(-1);
  });

  test('all three handler success paths use listAffecting: true (none retain listAffecting: false)', function () {
    expect(window1.indexOf('listAffecting: true')).not.toBe(-1);
    expect(window2.indexOf('listAffecting: true')).not.toBe(-1);
    expect(window3.indexOf('listAffecting: true')).not.toBe(-1);
  });
});
