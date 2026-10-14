'use strict';

// Phase 90-01: createBatch round-trips zoho_so_number and source:'internal' (sheets store),
// and a second create for the same invoice + SKU is rejected as duplicate_so_number.
// Real adminApi.gs, stubbed Apps Script runtime (no real Sheets).

var fs = require('fs');
var path = require('path');

var SOURCE = fs.readFileSync(path.join(__dirname, '../../apps-script/adminApi.gs'), 'utf8');
var workbook = require(path.join(__dirname, '../../zoho-middleware/__tests__/fixtures/batches/synthetic-workbook.js'));

function makeSheet(rows) {
  return {
    getLastRow: function () { return rows.length; },
    getLastColumn: function () { return rows[0].length; },
    getDataRange: function () {
      return { getValues: function () { return rows.map(function (r) { return r.slice(); }); } };
    },
    getRange: function (r, c, h, w) {
      return {
        getValues: function () {
          var out = [];
          for (var i = 0; i < (h || 1); i++) {
            var line = [];
            for (var j = 0; j < (w || 1); j++) line.push((rows[r - 1 + i] || [])[c - 1 + j]);
            out.push(line);
          }
          return out;
        },
        setValue: function (v) { rows[r - 1][c - 1] = v; }
      };
    },
    appendRow: function (arr) {
      var padded = arr.slice();
      while (padded.length < rows[0].length) padded.push('');
      rows.push(padded);
    }
  };
}

var factory = new Function('SpreadsheetApp', 'CacheService', 'LockService', 'Logger', 'Session', 'Utilities',
  SOURCE + '\nreturn { createBatch: createBatch, getBatchDetail: getBatchDetail };');

function setup() {
  var data = {};
  ['Batches', 'BatchTasks', 'PlatoReadings', 'VesselHistory'].forEach(function (n) {
    data[n] = [workbook.headers[n].slice()];
  });
  var sheets = {};
  Object.keys(data).forEach(function (n) { sheets[n] = makeSheet(data[n]); });
  var noopCache = { get: function () { return null; }, put: function () {}, remove: function () {}, removeAll: function () {} };
  var uuid = 0;
  // Fresh script instance per call so the per-request sheet cache never goes stale.
  return function fresh() {
    return factory(
      { getActiveSpreadsheet: function () { return { getSheetByName: function (n) { return sheets[n] || null; } }; } },
      { getScriptCache: function () { return noopCache; } },
      { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } },
      { log: function () {} },
      { getScriptTimeZone: function () { return 'America/Vancouver'; } },
      { getUuid: function () { uuid += 1; return '0000000' + uuid + '-0000-4000-8000-000000000000'; } }
    );
  };
}

describe('createBatch round-trip (sheets store)', function () {
  it('persists source internal and returns it from getBatchDetail', function () {
    var fresh = setup();
    var res = fresh().createBatch({
      product_sku: 'SKU-A', customer_name: 'Test Customer', source: 'internal'
    }, 'staff@example.com');
    expect(res.ok).toBe(true);
    var detail = fresh().getBatchDetail(res.batch_id);
    expect(detail.batch.source).toBe('internal');
  });

  it('persists zoho_so_number and rejects a second create for the same invoice + SKU', function () {
    var fresh = setup();
    var payload = { product_sku: 'SKU-A', customer_name: 'Test Customer', zoho_so_number: 'INV-000999' };
    var res = fresh().createBatch(Object.assign({}, payload), 'staff@example.com');
    expect(res.ok).toBe(true);
    var detail = fresh().getBatchDetail(res.batch_id);
    expect(detail.batch.zoho_so_number).toBe('INV-000999');

    var dup = fresh().createBatch(Object.assign({}, payload), 'staff@example.com');
    expect(dup.ok).toBe(false);
    expect(dup.error).toBe('duplicate_so_number');
  });
});
