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
