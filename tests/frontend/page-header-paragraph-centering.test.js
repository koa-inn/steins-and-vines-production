'use strict';

// Regression coverage for the wine.html page-header subtitle being off-centre.
//
// The bug: the global `p { max-width: 75ch; }` rule caps every paragraph's width, and
// `.page-header` centres text with `text-align: center` but never re-centres the paragraph BOX
// itself. A subtitle inside `.page-header .container` therefore hugged the container's left edge
// while the h1 above it sat centred. wine.html is the only page whose page-header carries a <p>,
// so the defect only surfaced when the wine page was added in Phase 74. Found during the
// pre-cutover staging walkthrough on 2026-09-16.
//
// The site's other centred hero (`.hero p`) already solves this with auto horizontal margins;
// this suite asserts `.page-header p` does the same.
//
// WHAT THIS SUITE CANNOT PROVE: it reads declared values in css/styles.css, not the composited
// layout in a browser. It does not catch an inline style or another stylesheet overriding it.

var fs = require('fs');
var path = require('path');

var CSS_PATH = path.join(__dirname, '../../css/styles.css');
var WINE_PATH = path.join(__dirname, '../../wine.html');

function css() {
  return fs.readFileSync(CSS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

function ruleBlock(src, selector) {
  var esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var re = new RegExp('(?:^|\\})\\s*' + esc + '\\s*\\{([^}]*)\\}');
  var m = src.match(re);
  return m ? m[1] : null;
}

function declaration(block, prop) {
  var re = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)');
  var m = block.match(re);
  return m ? m[1].trim() : null;
}

describe('page-header paragraph centering', function () {
  it('precondition: the global p rule still caps paragraph width', function () {
    var block = ruleBlock(css(), 'p');
    expect(block).not.toBeNull();
    expect(declaration(block, 'max-width')).toBe('75ch');
  });

  it('precondition: wine.html places a <p> inside the page header', function () {
    var html = fs.readFileSync(WINE_PATH, 'utf8');
    var header = html.match(/<section class="page-header">([\s\S]*?)<\/section>/);
    expect(header).not.toBeNull();
    expect(header[1]).toMatch(/<p>/);
  });

  it('.page-header p re-centres the capped paragraph box with auto horizontal margins', function () {
    var block = ruleBlock(css(), '.page-header p');
    expect(block).not.toBeNull();
    var shorthand = declaration(block, 'margin');
    var inline = declaration(block, 'margin-inline');
    var left = declaration(block, 'margin-left');
    var right = declaration(block, 'margin-right');
    var centred =
      (shorthand && /^(\S+\s+auto|auto)(\s+\S+\s+auto)?$/.test(shorthand)) ||
      inline === 'auto' ||
      (left === 'auto' && right === 'auto');
    expect(centred).toBe(true);
  });
});
