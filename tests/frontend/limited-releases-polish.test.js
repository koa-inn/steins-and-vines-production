/**
 * Limited releases UI polish regressions (Phase 100, plan 15).
 * - Calendar month label and each kit render as separate elements (no run-together text).
 * - "How it works" reuses the site's numbered step component.
 * - The confirmation never prints a doubled "SO SO-" prefix.
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

describe('limited releases polish: calendar layout', function () {
  beforeEach(setup);

  test('each month has a separate label element and a list of kit items', function () {
    var cells = document.querySelectorAll('#lr-calendar > li.lr-calendar__month');
    expect(cells.length).toBe(6);
    [].forEach.call(cells, function (li) {
      var label = li.querySelector('.lr-calendar__label');
      expect(label).not.toBeNull();
      expect(label.textContent).toMatch(/^[A-Z][a-z]+ \d{4}$/);
      var kits = li.querySelectorAll('.lr-calendar__kits > li.lr-calendar__kit');
      expect(kits.length).toBeGreaterThan(0);
      [].forEach.call(kits, function (k) {
        expect(k.querySelector('a').getAttribute('href')).toMatch(/^#lr-kit-/);
        var tag = k.querySelector('.lr-calendar__tag');
        expect(tag).not.toBeNull();
        expect(tag.textContent.trim()).toMatch(/^(Winexpert|RJS)$/);
      });
    });
  });

  test('two-kit months list both kits as distinct items', function () {
    var jan = [].filter.call(document.querySelectorAll('#lr-calendar > li'), function (li) {
      return /Jan(uary)? 2027/.test(li.textContent);
    })[0];
    expect(jan.querySelectorAll('.lr-calendar__kit')).toHaveLength(2);
  });
});

describe('limited releases polish: how it works', function () {
  beforeEach(setup);

  test('steps use the numbered how-it-works step component', function () {
    var steps = document.querySelectorAll('#lr-how-steps > li.how-it-works-step');
    expect(steps.length).toBe(DATA.copy.how_it_works.length);
    expect(steps[0].querySelector('.how-it-works-step-number').textContent).toBe('1');
    expect(steps[0].querySelector('.how-it-works-step-title').textContent).toBe(DATA.copy.how_it_works[0].step);
    expect(steps[0].querySelector('.how-it-works-step-desc').textContent).toBe(DATA.copy.how_it_works[0].text);
  });
});

describe('limited releases polish: confirmation SO label', function () {
  beforeEach(setup);

  test('the confirmation never prints "SO SO-"', async function () {
    var k1 = DATA.kits[0];
    var plus = document.querySelector('#lr-kit-' + k1.sku + ' .lr-stepper__btn[data-action="add"]');
    plus.click();
    $('lr-name').value = 'Jane Doe';
    $('lr-email').value = 'jane@example.com';
    $('lr-phone').value = '604 555 1234';
    var c = $('lr-consent');
    c.checked = true;
    c.dispatchEvent(new Event('change'));
    fetchMock.mockImplementationOnce(function () {
      return resp(200, { checkoutToken: 'CT1', secretToken: 'ST1', invoice_number: 'INV-9', deposit_total: 50, kit_count: 1 });
    });
    $('lr-pay').click();
    await flush();
    fetchMock.mockImplementationOnce(function () {
      return resp(201, {
        ok: true, deposit_total: 50, kit_count: 1,
        salesorders: [{ salesorder_id: 'x', salesorder_number: 'SO-000085', item_id: k1.zoho_item_id, name: k1.short_name, release_label: k1.release_label }]
      });
    });
    lr.handleHelcimMessage({
      origin: 'https://secure.helcim.app',
      data: {
        eventName: 'helcim-pay-js-CT1',
        eventStatus: 'SUCCESS',
        eventMessage: JSON.stringify({ data: { hash: 'h', data: { transactionId: '777', invoiceNumber: 'INV-9', status: 'APPROVED', type: 'purchase', amount: '50.00' } }, status: 200 })
      }
    });
    await flush();
    var box = $('lr-confirm');
    expect(box.classList.contains('hidden')).toBe(false);
    expect(box.textContent).toContain('SO-000085');
    expect(box.textContent).not.toMatch(/SO SO-/);
  });
});
