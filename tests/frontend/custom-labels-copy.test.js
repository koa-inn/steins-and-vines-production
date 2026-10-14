'use strict';

// Phase 90 (D-18): custom-labels.html can-count copy matches the canning bundle table.

var fs = require('fs');
var path = require('path');

var html = fs.readFileSync(path.join(__dirname, '../../custom-labels.html'), 'utf8');
var noteMatch = html.match(/<p class="labels-pricing-note">([\s\S]*?)<\/p>/);

describe('custom-labels.html pricing note', function () {
  test('the paragraph exists', function () {
    expect(noteMatch).not.toBeNull();
  });

  test('no longer claims ~84 cans', function () {
    expect(html).not.toContain('84 cans');
  });

  test('states about 70 x 355 mL or 52 x 473 mL cans for a 25 L beer batch', function () {
    var note = noteMatch[1];
    expect(note).toMatch(/25 L beer batch/);
    expect(note).toMatch(/70 x 355 mL/);
    expect(note).toMatch(/52 x 473 mL/);
  });

  test('wine sentence is unchanged', function () {
    expect(noteMatch[1]).toContain('A typical wine batch is ~29 bottles (750 mL)');
  });
});
