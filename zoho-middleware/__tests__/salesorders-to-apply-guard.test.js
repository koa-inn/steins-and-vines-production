'use strict';

// ---------------------------------------------------------------------------
// Phase 100 D-01 carve-out guard.
//
// Phase 71 banned salesorders_to_apply (it lands as an unapplied advance). The
// four Phase 71 behavioural ban tests remain the PRIMARY guard. Limited-release
// deposits are deliberately booked as advances, in exactly one file:
// lib/limited-releases-deposit.js. This repo scan fails if the literal appears
// on a code line anywhere else under lib/ or routes/, and restricts who may
// import the deposit module.
// ---------------------------------------------------------------------------

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var ALLOWED = path.join('lib', 'limited-releases-deposit.js');

function walk(dir, out) {
  fs.readdirSync(dir).forEach(function (name) {
    var full = path.join(dir, name);
    var st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.js$/.test(name)) out.push(full);
  });
  return out;
}

function files() {
  return walk(path.join(ROOT, 'lib'), []).concat(walk(path.join(ROOT, 'routes'), []));
}

function isComment(line) {
  var t = line.trim();
  return t.indexOf('//') === 0 || t.indexOf('*') === 0 || t.indexOf('/*') === 0;
}

describe('salesorders_to_apply carve-out (D-01)', function () {
  test('appears on a code line only in lib/limited-releases-deposit.js', function () {
    var offenders = [];
    var foundInAllowed = false;
    files().forEach(function (f) {
      var rel = path.relative(ROOT, f);
      fs.readFileSync(f, 'utf8').split('\n').forEach(function (line, i) {
        if (line.indexOf('salesorders_to_apply') === -1 || isComment(line)) return;
        if (rel === ALLOWED) foundInAllowed = true;
        else offenders.push(rel + ':' + (i + 1));
      });
    });
    expect(offenders).toEqual([]);
    expect(foundInAllowed).toBe(true);
  });

  test('only routes/preorder.js and routes/pos.js import the deposit module', function () {
    var allowedImporters = [path.join('routes', 'preorder.js'), path.join('routes', 'pos.js')];
    files().forEach(function (f) {
      var rel = path.relative(ROOT, f);
      if (rel === ALLOWED) return;
      var src = fs.readFileSync(f, 'utf8');
      if (/require\(['"](\.\/|\.\.\/lib\/)limited-releases-deposit['"]\)/.test(src)) {
        expect(allowedImporters).toContain(rel);
      }
    });
  });

  test('pos.js never references the booking or create functions', function () {
    var src = fs.readFileSync(path.join(ROOT, 'routes', 'pos.js'), 'utf8');
    expect(src).not.toMatch(/bookSalesOrderDepositAdvance/);
    expect(src).not.toMatch(/createDepositSet/);
  });
});
