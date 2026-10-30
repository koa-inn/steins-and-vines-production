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

describe('mobile: bar padding goes on body (HIGH #2)', function () {
  beforeEach(function () {
    delete global.IntersectionObserver;
    renderPage();
    Object.defineProperty($('lr-bar'), 'offsetHeight', { configurable: true, get: function () { return 72; } });
  });

  test('body is padded by the bar height while shown, cleared when hidden', function () {
    plusFirst().click();
    expect($('lr-bar').classList.contains('hidden')).toBe(false);
    expect(document.body.style.paddingBottom).toBe('72px');
    var section = $('lr-attribution').closest('section');
    expect(section.style.paddingBottom).toBe('');
    lr.clearBasket();
    expect($('lr-bar').classList.contains('hidden')).toBe(true);
    expect(document.body.style.paddingBottom).toBe('');
  });

  test('no inline body padding while the cookie notice is open', function (done) {
    plusFirst().click();
    document.documentElement.classList.add('cookie-notice-open');
    setTimeout(function () {
      expect(document.body.style.paddingBottom).toBe('');
      document.documentElement.classList.remove('cookie-notice-open');
      setTimeout(function () {
        expect(document.body.style.paddingBottom).toBe('72px');
        done();
      }, 20);
    }, 20);
  });
});

describe('mobile: payment overlay scroll lock (MEDIUM #8)', function () {
  beforeEach(renderPage);

  test('page scroll is locked while the payment iframe is open and restored on ready', function () {
    lr.setPaymentState('iframe');
    expect(document.documentElement.style.overflow).toBe('hidden');
    lr.setPaymentState('ready');
    expect(document.documentElement.style.overflow).toBe('');
  });

  test('scroll lock is released when moving on to verifying', function () {
    lr.setPaymentState('iframe');
    lr.setPaymentState('verifying');
    expect(document.documentElement.style.overflow).toBe('');
  });

  test('Close secure payment releases the scroll lock', async function () {
    $('lr-name').value = 'Jane Doe';
    $('lr-email').value = 'jane@example.com';
    $('lr-phone').value = '604 555 1234';
    plusFirst().click();
    var c = $('lr-consent');
    c.checked = true;
    c.dispatchEvent(new Event('change'));
    window.SHEETS_CONFIG = { MIDDLEWARE_URL: 'https://mw.test' };
    global.fetch = jest.fn(function () {
      return Promise.resolve({
        status: 200,
        ok: true,
        text: function () {
          return Promise.resolve(JSON.stringify({ checkoutToken: 'CT1', secretToken: 'ST1', invoice_number: 'INV-9', deposit_total: 50, kit_count: 1 }));
        }
      });
    });
    $('lr-pay').click();
    await flush();
    await flush();
    expect(document.documentElement.style.overflow).toBe('hidden');
    $('lr-close-pay').click();
    expect(document.documentElement.style.overflow).toBe('');
  });
});
