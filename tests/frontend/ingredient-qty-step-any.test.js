'use strict';

// Regression (2026-10-13 handoff §8): recipe ingredient quantity inputs used
// step="0.01". Quantities below 0.01 (e.g. 0.00625 kg Go-Ferm) are off-step:
// the browser flags them invalid and arrow keys / wheel / spinner snap them to
// a 0.01 multiple (a 60% error on that example). 18 lines across 9 recipes
// were in this state before a data fix. Every ingredient quantity input must
// accept any precision.

var fs = require('fs');
var path = require('path');

var QTY_CLASS = /class="[^"]*\b(bp-ing-qty|bp-recipe-qty|ing-qty)\b/;

function qtyInputs(file) {
  var src = fs.readFileSync(path.join(__dirname, '../../js', file), 'utf8');
  return src.split('\n').filter(function (line) {
    return QTY_CLASS.test(line) && /step="/.test(line);
  });
}

describe('ingredient quantity inputs accept sub-0.01 values', function () {
  ['brewpad.js', 'admin.js'].forEach(function (file) {
    test(file + ': every ingredient quantity input uses step="any"', function () {
      var lines = qtyInputs(file);
      expect(lines.length).toBeGreaterThan(0);
      lines.forEach(function (line) {
        expect({ line: line.trim().slice(0, 120), step: (line.match(/step="([^"]*)"/) || [])[1] })
          .toEqual({ line: line.trim().slice(0, 120), step: 'any' });
      });
    });
  });
});
