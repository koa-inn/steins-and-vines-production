/**
 * Limited releases: deposit terms sit in a collapsed section (owner request
 * 2026-10-29), with the key term still visible above it and the fee note
 * outside the fold.
 */
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..', '..');
var DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'limited-releases-2026-27.json'), 'utf8'));
var PAGE = fs.readFileSync(path.join(ROOT, 'limited-releases.html'), 'utf8');

var lr;
var fetchMock;

function flush() {
  return new Promise(function (r) { setTimeout(r, 0); }).then(function () {
    return new Promise(function (r) { setTimeout(r, 0); });
  }).then(function () {
    return new Promise(function (r) { setTimeout(r, 0); });
  });
}

function resp(status, body) {
  return Promise.resolve({
    status: status,
    ok: status >= 200 && status < 300,
    text: function () { return Promise.resolve(JSON.stringify(body)); }
  });
}

function $(id) { return document.getElementById(id); }

function setup() {
  var body = /<body[^>]*>([\s\S]*)<\/body>/.exec(PAGE)[1].replace(/<script[\s\S]*?<\/script>/g, '');
  document.head.innerHTML = '';
  document.documentElement.className = '';
  document.body.innerHTML = body;
  jest.resetModules();
  window.SHEETS_CONFIG = { MIDDLEWARE_URL: 'https://mw.test' };
  global.SHEETS_CONFIG = window.SHEETS_CONFIG;
  fetchMock = jest.fn();
  global.fetch = fetchMock;
  global.appendHelcimPayIframe = jest.fn();
  global.removeHelcimPayIframe = jest.fn();
  lr = require('../../js/modules/18-limited-releases.js');
  lr.render(DATA);
}


describe('limited releases: collapsed deposit terms', function () {
  beforeEach(setup);

  test('full terms list is inside a closed details element', function () {
    var details = document.querySelector('#lr-terms-section details.lr-terms-details');
    expect(details).not.toBeNull();
    expect(details.hasAttribute('open')).toBe(false);
    expect(details.querySelector('summary').textContent).toMatch(/full deposit terms/i);
    expect(details.querySelectorAll('#lr-terms li')).toHaveLength(DATA.copy.deposit_terms.length);
  });

  test('the key term stays visible outside the collapsed section', function () {
    var summary = document.querySelector('#lr-terms-section .lr-terms-summary');
    expect(summary).not.toBeNull();
    expect(summary.closest('details')).toBeNull();
    expect(summary.textContent).toMatch(/\$50 per kit/);
    expect(summary.textContent).toMatch(/non-refundable/);
  });

  test('the fee note is outside the collapsed section', function () {
    var note = document.getElementById('lr-price-note');
    expect(note.closest('details')).toBeNull();
    expect(note.textContent).toMatch(/Maker's Fee/);
  });
});
