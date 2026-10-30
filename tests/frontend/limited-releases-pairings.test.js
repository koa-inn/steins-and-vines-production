/**
 * Limited releases: "Pairs with" is always shown (owner request 2026-10-29) —
 * a plain heading + list on every card, no collapsible <details>/<summary>.
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


describe('limited releases: pairings always visible', function () {
  beforeEach(setup);

  test('no card uses a collapsible details/summary for pairings', function () {
    expect(document.querySelectorAll('.lr-kit details, .lr-kit summary')).toHaveLength(0);
  });

  test('every card shows a "Pairs with" heading and all its pairings', function () {
    var cards = document.querySelectorAll('article.lr-kit');
    expect(cards.length).toBe(10);
    [].forEach.call(cards, function (card) {
      var title = card.querySelector('.lr-pairs__title');
      expect(title).not.toBeNull();
      expect(title.textContent).toBe('Pairs with');
      expect(card.querySelectorAll('.lr-pairs li').length).toBeGreaterThan(0);
    });
  });
});
