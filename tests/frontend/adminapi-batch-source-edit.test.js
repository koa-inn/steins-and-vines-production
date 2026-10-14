'use strict';

// Phase 90-01: batchSourceTransitionDecision (pure) and the updateBatch source guard.
// Loads the REAL apps-script/adminApi.gs via `new Function` (same technique as
// adminapi-phase82-locks.test.js).

var fs = require('fs');
var path = require('path');

var ADMIN_API_PATH = path.join(__dirname, '../../apps-script/adminApi.gs');

function rawSource() {
  return fs.readFileSync(ADMIN_API_PATH, 'utf8');
}

function loadApi() {
  var factory = new Function(
    rawSource() + '\nreturn {' +
      'batchSourceTransitionDecision: (typeof batchSourceTransitionDecision !== "undefined" ? batchSourceTransitionDecision : undefined)' +
      '};'
  );
  return factory();
}

// Shared vector table: identical content in zoho-middleware/__tests__/batch-rules-source.test.js.
// expect: 'skip' | 'write:<value>' | 'reject'
var VECTORS = [
  { cur: '', next: 'internal', expect: 'write:internal' },
  { cur: '', next: 'manual', expect: 'write:manual' },
  { cur: 'manual', next: 'internal', expect: 'write:internal' },
  { cur: 'internal', next: 'manual', expect: 'write:manual' },
  { cur: 'internal', next: 'internal', expect: 'write:internal' },
  { cur: 'manual', next: 'kiosk', expect: 'skip' },
  { cur: 'manual', next: 'x', expect: 'skip' },
  { cur: 'MANUAL ', next: 'Internal', expect: 'write:internal' },
  { cur: 'kiosk', next: 'internal', expect: 'reject' },
  { cur: 'kiosk_recipe', next: 'manual', expect: 'reject' },
  { cur: 'online', next: 'internal', expect: 'reject' },
  { cur: 'zoho_scan', next: 'internal', expect: 'reject' },
  { cur: 'research', next: 'manual', expect: 'reject' },
  { cur: 'kiosk', next: 'kiosk', expect: 'skip' },
  { cur: 'manual', next: undefined, expect: 'skip' },
  { cur: 'manual', next: null, expect: 'skip' },
  { cur: 'manual', next: '', expect: 'skip' }
];

describe('batchSourceTransitionDecision (pure)', function () {
  var api = loadApi();

  VECTORS.forEach(function (v) {
    it('(' + JSON.stringify(v.cur) + ' -> ' + JSON.stringify(v.next) + ') = ' + v.expect, function () {
      var r = api.batchSourceTransitionDecision(v.cur, v.next);
      if (v.expect === 'skip') {
        expect(r).toEqual({ action: 'skip' });
      } else if (v.expect === 'reject') {
        expect(r.ok).toBe(false);
        expect(r.error).toBe('invalid_source');
        expect(typeof r.message).toBe('string');
      } else {
        expect(r).toEqual({ action: 'write', value: v.expect.split(':')[1] });
      }
    });
  });

  it('reject message names the current source as automatic', function () {
    var r = api.batchSourceTransitionDecision('kiosk_recipe', 'manual');
    expect(r.message).toMatch(/kiosk_recipe/);
    expect(r.message).toMatch(/automatic/i);
  });
});

// ─── updateBatch source guard (stubbed Apps Script runtime) ────────────────

var workbook = require(path.join(__dirname, '../../zoho-middleware/__tests__/fixtures/batches/synthetic-workbook.js'));

var BATCH_HEADERS = workbook.headers.Batches;

function batchRow(over) {
  return BATCH_HEADERS.map(function (h) { return over[h] === undefined ? '' : over[h]; });
}

// Mutable sheet stub: records every setValue / appendRow so the test can assert zero writes.
function makeSheet(rows, log, name) {
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
        setValue: function (v) {
          log.push({ sheet: name, op: 'setValue', row: r, col: c, value: v });
          rows[r - 1][c - 1] = v;
        }
      };
    },
    appendRow: function (arr) {
      log.push({ sheet: name, op: 'appendRow' });
      rows.push(arr.slice());
    }
  };
}

var UPDATE_FACTORY = new Function('SpreadsheetApp', 'CacheService', 'LockService', 'Logger', 'Session', 'Utilities',
  rawSource() + '\nreturn { updateBatch: updateBatch, getBatchDetail: getBatchDetail };');

function setup(batchRows) {
  var log = [];
  var data = {
    Batches: [BATCH_HEADERS.slice()].concat(batchRows),
    BatchTasks: [workbook.headers.BatchTasks.slice()],
    PlatoReadings: [workbook.headers.PlatoReadings.slice()],
    VesselHistory: [workbook.headers.VesselHistory.slice()]
  };
  var sheets = {};
  Object.keys(data).forEach(function (n) { sheets[n] = makeSheet(data[n], log, n); });
  var noopCache = { get: function () { return null; }, put: function () {}, remove: function () {}, removeAll: function () {} };
  function fresh() {
    return UPDATE_FACTORY(
      { getActiveSpreadsheet: function () { return { getSheetByName: function (n) { return sheets[n] || null; } }; } },
      { getScriptCache: function () { return noopCache; } },
      { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } },
      { log: function () {} },
      { getScriptTimeZone: function () { return 'America/Vancouver'; } },
      { getUuid: function () { return '00000000-0000-4000-8000-000000000000'; } }
    );
  }
  return { fresh: fresh, data: data, log: log };
}

function sourceOf(env, rowIdx) {
  return env.data.Batches[rowIdx][BATCH_HEADERS.indexOf('source')];
}

describe('updateBatch source guard', function () {
  function baseRows() {
    return [
      batchRow({ batch_id: 'SV-B-000001', source: '', notes: 'a', vessel_id: 'PCB-001' }),
      batchRow({ batch_id: 'SV-B-000002', source: 'kiosk_recipe', notes: 'b', vessel_id: 'PCB-002' }),
      batchRow({ batch_id: 'SV-B-000003', source: 'manual', notes: 'c' })
    ];
  }

  it('writes internal on a blank-source row', function () {
    var env = setup(baseRows());
    var res = env.fresh().updateBatch({ batch_id: 'SV-B-000001', updates: { source: 'internal' } }, 'staff@example.com');
    expect(res.ok).toBe(true);
    expect(sourceOf(env, 1)).toBe('internal');
  });

  it('rejects a kiosk_recipe row with invalid_source and writes nothing', function () {
    var env = setup(baseRows());
    var res = env.fresh().updateBatch(
      { batch_id: 'SV-B-000002', updates: { source: 'manual', vessel_id: 'PCB-OTHER' } }, 'staff@example.com');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('invalid_source');
    expect(env.log).toEqual([]);
    expect(sourceOf(env, 2)).toBe('kiosk_recipe');
    expect(env.data.VesselHistory.length).toBe(1);
  });

  it('drops an off-list source but still writes the rest of the update', function () {
    var env = setup(baseRows());
    var res = env.fresh().updateBatch({ batch_id: 'SV-B-000003', updates: { source: 'kiosk', notes: 'n' } }, 'staff@example.com');
    expect(res.ok).toBe(true);
    expect(sourceOf(env, 3)).toBe('manual');
    expect(env.data.Batches[3][BATCH_HEADERS.indexOf('notes')]).toBe('n');
  });

  it('calls the guard before any VesselHistory / locationChanged work (raw-text ordering)', function () {
    var src = rawSource();
    var start = src.indexOf('function updateBatch(');
    var end = src.indexOf('\n}\n', start);
    var body = src.slice(start, end);
    var guardIdx = body.indexOf('batchSourceTransitionDecision(');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(body.indexOf('locationChanged'));
    expect(guardIdx).toBeLessThan(body.indexOf('VESSEL_HISTORY_SHEET_NAME'));
  });
});
