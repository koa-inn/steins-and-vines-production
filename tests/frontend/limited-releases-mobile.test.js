/**
 * Limited releases mobile audit fixes (Phase 100, plan 15 / 100-UI-REVIEW-MOBILE.md).
 */
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..', '..');
var DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'limited-releases-2026-27.json'), 'utf8'));
var PAGE = fs.readFileSync(path.join(ROOT, 'limited-releases.html'), 'utf8');

var lr;

var RealMutationObserver = global.MutationObserver;
var liveObservers = [];
global.MutationObserver = function (cb) {
  var inner = new RealMutationObserver(cb);
  liveObservers.push(inner);
  this.observe = function (n, o) { return inner.observe(n, o); };
  this.disconnect = function () { return inner.disconnect(); };
};

function loadPage() {
  liveObservers.forEach(function (o) { o.disconnect(); });
  liveObservers = [];
  var bodyMatch = /<body[^>]*>([\s\S]*)<\/body>/.exec(PAGE);
  var body = bodyMatch[1].replace(/<script[\s\S]*?<\/script>/g, '');
  document.head.innerHTML = '';
  document.documentElement.className = '';
  document.documentElement.removeAttribute('style');
  document.body.removeAttribute('style');
  document.body.innerHTML = body;
  document.body.removeAttribute('data-page');
}

function renderPage() {
  loadPage();
  jest.resetModules();
  global.appendHelcimPayIframe = jest.fn();
  global.removeHelcimPayIframe = jest.fn();
  lr = require('../../js/modules/18-limited-releases.js');
  lr.render(DATA);
}

function $(id) { return document.getElementById(id); }

function plusFirst() {
  return document.querySelector('#lr-kit-' + DATA.kits[0].sku + ' .lr-stepper__btn[data-action="add"]');
}

function flush() {
  return new Promise(function (r) { setTimeout(r, 0); }).then(function () {
    return new Promise(function (r) { setTimeout(r, 0); });
  });
}

describe('mobile: sticky bar placement (BLOCKER #1)', function () {
  test('#lr-bar is a direct child of body, outside <main>', function () {
    loadPage();
    var bar = $('lr-bar');
    expect(bar).not.toBeNull();
    expect(bar.parentNode).toBe(document.body);
    expect(bar.closest('main')).toBeNull();
    expect(bar.closest('footer')).toBeNull();
  });
});
