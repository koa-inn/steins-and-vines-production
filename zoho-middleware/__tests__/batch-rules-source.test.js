'use strict';

// Phase 90-01: sourceTransitionDecision (port) + parity with the Apps Script original.

var fs = require('fs');
var path = require('path');
var batchRules = require('../lib/batch-rules');

var ADMIN_API_PATH = path.join(__dirname, '../../apps-script/adminApi.gs');

function loadGsFn() {
  var src = fs.readFileSync(ADMIN_API_PATH, 'utf8');
  var factory = new Function(
    src + '\nreturn (typeof batchSourceTransitionDecision !== "undefined" ? batchSourceTransitionDecision : undefined);'
  );
  return factory();
}

// Shared vector table: identical content in tests/frontend/adminapi-batch-source-edit.test.js.
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

describe('batch-rules sourceTransitionDecision', function () {
  VECTORS.forEach(function (v) {
    it('(' + JSON.stringify(v.cur) + ' -> ' + JSON.stringify(v.next) + ') = ' + v.expect, function () {
      var r = batchRules.sourceTransitionDecision(v.cur, v.next);
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

  it('parity: Apps Script and middleware return deep-equal decisions for every vector', function () {
    var gs = loadGsFn();
    expect(typeof gs).toBe('function');
    VECTORS.forEach(function (v) {
      expect(batchRules.sourceTransitionDecision(v.cur, v.next)).toEqual(gs(v.cur, v.next));
    });
  });
});
