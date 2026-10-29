/**
 * Limited releases payment flow (Phase 100, plan 12).
 */
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..', '..');
var DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'limited-releases-2026-27.json'), 'utf8'));
var PAGE = fs.readFileSync(path.join(ROOT, 'limited-releases.html'), 'utf8');

var lr;
var fetchMock;
var appendMock;
var removeMock;

function flush() {
  return new Promise(function (r) { setTimeout(r, 0); }).then(function () {
    return new Promise(function (r) { setTimeout(r, 0); });
  }).then(function () {
    return new Promise(function (r) { setTimeout(r, 0); });
  });
}

function loadPage() {
  var bodyMatch = /<body[^>]*>([\s\S]*)<\/body>/.exec(PAGE);
  var body = bodyMatch[1].replace(/<script[\s\S]*?<\/script>/g, '');
  document.head.innerHTML = '';
  document.documentElement.className = '';
  document.body.innerHTML = body;
  document.body.removeAttribute('data-page');
}

function resp(status, body, raw) {
  return Promise.resolve({
    status: status,
    ok: status >= 200 && status < 300,
    text: function () { return Promise.resolve(raw !== undefined ? raw : JSON.stringify(body)); }
  });
}

function $(id) { return document.getElementById(id); }

function fillValid() {
  $('lr-name').value = '  Jane Doe ';
  $('lr-email').value = ' jane@example.com ';
  $('lr-phone').value = '604 555 1234';
}

function addKit(sku, n) {
  var plus = document.querySelector('#lr-kit-' + sku + ' .lr-stepper__btn[data-action="add"]');
  for (var i = 0; i < n; i++) plus.click();
}

function tickConsent() {
  var c = $('lr-consent');
  c.checked = true;
  c.dispatchEvent(new Event('change'));
}

var INIT_OK = { checkoutToken: 'CT1', secretToken: 'ST1', invoice_number: 'INV-9', deposit_total: 100, kit_count: 2 };

function helcimSuccess(token, txn) {
  return {
    origin: 'https://secure.helcim.app',
    data: {
      eventName: 'helcim-pay-js-' + token,
      eventStatus: 'SUCCESS',
      eventMessage: JSON.stringify({ data: { hash: 'h', data: { transactionId: txn, invoiceNumber: 'INV-9', status: 'APPROVED', type: 'purchase', amount: '100.00' } }, status: 200 })
    }
  };
}

var firstSku;
var secondSku;

function setup() {
  loadPage();
  jest.resetModules();
  window.SHEETS_CONFIG = { MIDDLEWARE_URL: 'https://mw.test' };
  global.SHEETS_CONFIG = window.SHEETS_CONFIG;
  fetchMock = jest.fn();
  global.fetch = fetchMock;
  appendMock = jest.fn();
  removeMock = jest.fn();
  global.appendHelcimPayIframe = appendMock;
  global.removeHelcimPayIframe = removeMock;
  lr = require('../../js/modules/18-limited-releases.js');
  lr.render(DATA);
  var kits = DATA.kits;
  firstSku = kits[0].sku;
  secondSku = kits[1].sku;
}

// Drives the page to the iframe-open state.
function openIframe(qty) {
  fillValid();
  addKit(firstSku, qty || 2);
  tickConsent();
  fetchMock.mockImplementationOnce(function () { return resp(200, INIT_OK); });
  $('lr-pay').click();
  return flush();
}

function pageText() { return $('lr-reserve').textContent; }

describe('limited releases payment: validation', function () {
  beforeEach(setup);

  test('invalid email shows the field error, focuses it and makes no fetch', function () {
    fillValid();
    $('lr-email').value = 'nope';
    addKit(firstSku, 1);
    tickConsent();
    $('lr-pay').click();
    expect(fetchMock).not.toHaveBeenCalled();
    var group = $('lr-email').parentNode;
    expect($('lr-email').classList.contains('field-error')).toBe(true);
    var msg = group.querySelector('.form-error-msg');
    expect(msg.textContent).toBe('Please enter a valid email address.');
    expect(msg.classList.contains('visible')).toBe(true);
    expect(document.activeElement).toBe($('lr-email'));
  });

  test('focus goes to the first invalid field', function () {
    $('lr-email').value = 'nope';
    $('lr-phone').value = '1';
    addKit(firstSku, 1);
    tickConsent();
    $('lr-pay').click();
    expect(document.activeElement).toBe($('lr-name'));
    expect($('lr-name').parentNode.querySelector('.form-error-msg').textContent).toBe('Please enter your name.');
  });
});

describe('limited releases payment: initialize and iframe', function () {
  beforeEach(setup);

  test('valid click goes to starting, posts items, opens the iframe', async function () {
    fillValid();
    addKit(firstSku, 2);
    addKit(secondSku, 1);
    tickConsent();
    var items = lr.getBasketLines();
    var resolveInit;
    fetchMock.mockImplementationOnce(function () {
      return new Promise(function (r) { resolveInit = r; });
    });
    $('lr-pay').click();
    expect($('lr-pay').textContent).toBe('Opening secure payment...');
    expect($('lr-pay').disabled).toBe(true);
    expect($('lr-pay-status').textContent).toBe('Preparing your payment.');
    expect($('lr-bar').classList.contains('hidden')).toBe(true);
    expect($('lr-name').disabled).toBe(true);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    var call = fetchMock.mock.calls[0];
    expect(call[0]).toBe('https://mw.test/api/preorder/initialize');
    var body = JSON.parse(call[1].body);
    expect(body.items).toEqual(items);
    expect(body.recaptcha_token).toBe('');
    resolveInit({ status: 200, ok: true, text: function () { return Promise.resolve(JSON.stringify(INIT_OK)); } });
    await flush();
    expect(appendMock).toHaveBeenCalledWith('CT1');
    expect($('lr-pay').textContent).toBe('Secure payment open');
    expect($('lr-close-pay')).not.toBeNull();
  });

  test('double click makes one initialize call', async function () {
    await openIframe(1);
    $('lr-pay').click();
    $('lr-pay').click();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('beforeunload registered while iframe open and removed on cancel', async function () {
    var add = jest.spyOn(window, 'addEventListener');
    var rem = jest.spyOn(window, 'removeEventListener');
    await openIframe(1);
    expect(add.mock.calls.filter(function (c) { return c[0] === 'beforeunload'; }).length).toBe(1);
    lr.handleHelcimMessage({ origin: 'https://secure.helcim.app', data: { eventName: 'helcim-pay-js-CT1', eventStatus: 'ABORTED', eventMessage: 'closed' } });
    expect(rem.mock.calls.filter(function (c) { return c[0] === 'beforeunload'; }).length).toBe(1);
    add.mockRestore();
    rem.mockRestore();
  });

  test('initialize 503 shows the not-open alert and returns to ready', async function () {
    fillValid();
    addKit(firstSku, 1);
    tickConsent();
    fetchMock.mockImplementationOnce(function () { return resp(503, { error: 'x' }); });
    $('lr-pay').click();
    await flush();
    expect($('lr-pay-alert').textContent).toBe('Reservations are not open yet. Please check back soon.');
    expect($('lr-pay').disabled).toBe(false);
    expect(appendMock).not.toHaveBeenCalled();
  });

  test('initialize network failure says not charged and returns to ready', async function () {
    fillValid();
    addKit(firstSku, 1);
    tickConsent();
    fetchMock.mockImplementationOnce(function () { return Promise.reject(new Error('down')); });
    $('lr-pay').click();
    await flush();
    expect($('lr-pay-alert').textContent).toBe('We could not reach the payment service. You have not been charged. Please try again.');
    expect($('lr-pay').disabled).toBe(false);
    expect($('lr-name').disabled).toBe(false);
  });

  test('initialize 400 shows the verify message', async function () {
    fillValid();
    addKit(firstSku, 1);
    tickConsent();
    fetchMock.mockImplementationOnce(function () { return resp(400, { error: 'bad' }); });
    $('lr-pay').click();
    await flush();
    expect($('lr-pay-alert').textContent).toBe('We could not verify your request. Please try again.');
  });
});

describe('limited releases payment: postMessage handling', function () {
  beforeEach(setup);

  test('foreign origin is ignored', async function () {
    await openIframe(1);
    var m = helcimSuccess('CT1', '777');
    m.origin = 'https://evil.example';
    lr.handleHelcimMessage(m);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect($('lr-pay').textContent).toBe('Secure payment open');
  });

  test('non-matching eventName is ignored', async function () {
    await openIframe(1);
    lr.handleHelcimMessage(helcimSuccess('OTHER', '777'));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(removeMock).not.toHaveBeenCalled();
  });

  test('SUCCESS posts the deposit with the full payload', async function () {
    await openIframe(2);
    var items = lr.getBasketLines();
    var nl = $('lr-newsletter');
    nl.checked = true;
    fetchMock.mockImplementationOnce(function () {
      return resp(201, { ok: true, deposit_total: 100, kit_count: 2, salesorders: [] });
    });
    lr.handleHelcimMessage(helcimSuccess('CT1', '777'));
    expect(removeMock).toHaveBeenCalled();
    expect($('lr-pay').textContent).toBe('Confirming your reservation...');
    await flush();
    var call = fetchMock.mock.calls[1];
    expect(call[0]).toBe('https://mw.test/api/preorder/deposit');
    var b = JSON.parse(call[1].body);
    expect(b.transaction_id).toBe('777');
    expect(b.invoice_number).toBe('INV-9');
    expect(b.items).toEqual(items);
    expect(b.customer).toEqual({ name: 'Jane Doe', email: 'jane@example.com', phone: '604 555 1234' });
    expect(b.consent).toEqual({ accepted: true, text: DATA.copy.deposit_checkbox_label });
    expect(b.newsletter).toBe(true);
    expect(b).toHaveProperty('recaptcha_token');
  });

  test('newsletter is false by default, as a strict boolean', async function () {
    await openIframe(1);
    fetchMock.mockImplementationOnce(function () { return resp(201, { ok: true, salesorders: [] }); });
    lr.handleHelcimMessage(helcimSuccess('CT1', '778'));
    await flush();
    var b = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(b.newsletter).toBe(false);
  });

  test('secretToken eventName is also accepted', async function () {
    await openIframe(1);
    fetchMock.mockImplementationOnce(function () { return resp(201, { ok: true, salesorders: [] }); });
    lr.handleHelcimMessage(helcimSuccess('ST1', '779'));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('user close returns to ready with the not-charged cancelled copy and basket intact', async function () {
    await openIframe(2);
    lr.handleHelcimMessage({ origin: 'https://secure.helcim.app', data: { eventName: 'helcim-pay-js-CT1', eventStatus: 'ABORTED', eventMessage: 'Transaction cancelled' } });
    expect($('lr-pay-status').textContent).toBe('Payment cancelled. You have not been charged.');
    expect($('lr-pay').disabled).toBe(false);
    expect(lr.getBasketLines()[0].qty).toBe(2);
  });

  test('decline shows the decline copy', async function () {
    await openIframe(1);
    lr.handleHelcimMessage({ origin: 'https://secure.helcim.app', data: { eventName: 'helcim-pay-js-CT1', eventStatus: 'ABORTED', eventMessage: JSON.stringify({ data: { data: { status: 'DECLINED' } } }) } });
    expect($('lr-pay-alert').textContent).toBe('Your card was declined. You have not been charged. Please try a different card or contact your bank.');
    expect($('lr-pay').disabled).toBe(false);
  });
});

describe('limited releases payment: honest copy after approval', function () {
  beforeEach(setup);

  test('voided:true says not charged, clears the txn id and returns to ready', async function () {
    await openIframe(2);
    fetchMock.mockImplementationOnce(function () { return resp(409, { error: 'x', voided: true }); });
    lr.handleHelcimMessage(helcimSuccess('CT1', '777'));
    await flush();
    expect($('lr-pay-alert').textContent).toBe('We could not complete your reservation, and your card has not been charged. Please try again, or call us at (604) 567-4565.');
    expect($('lr-pay').disabled).toBe(false);
    expect($('lr-call-us').classList.contains('hidden')).toBe(true);
    expect(lr.getBasketLines()[0].qty).toBe(2);
    // A retry starts a fresh initialize and does not reuse the old txn id.
    fetchMock.mockImplementationOnce(function () { return resp(200, INIT_OK); });
    $('lr-pay').click();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  function expectUnknown() {
    var text = pageText();
    expect(text).toContain('Your payment went through but we could not confirm your reservation here. Please do not pay again.');
    expect(text).toContain('Reference: 777');
    expect(text).not.toMatch(/not charged/i);
    expect(text).not.toMatch(/not been charged/i);
    expect($('lr-pay').disabled).toBe(true);
    expect($('lr-call-us').classList.contains('hidden')).toBe(false);
  }

  test('voided:false keeps the button disabled and shows call-us', async function () {
    await openIframe(1);
    fetchMock.mockImplementationOnce(function () { return resp(502, { error: 'x', voided: false }); });
    lr.handleHelcimMessage(helcimSuccess('CT1', '777'));
    await flush();
    expectUnknown();
  });

  test('network error after approval is the unknown branch', async function () {
    await openIframe(1);
    fetchMock.mockImplementationOnce(function () { return Promise.reject(new Error('lost')); });
    lr.handleHelcimMessage(helcimSuccess('CT1', '777'));
    await flush();
    expectUnknown();
  });

  test('timeout (abort) after approval is the unknown branch', async function () {
    await openIframe(1);
    var err = new Error('aborted');
    err.name = 'AbortError';
    fetchMock.mockImplementationOnce(function () { return Promise.reject(err); });
    lr.handleHelcimMessage(helcimSuccess('CT1', '777'));
    await flush();
    expectUnknown();
  });

  test('non-JSON error body is the unknown branch', async function () {
    await openIframe(1);
    fetchMock.mockImplementationOnce(function () { return resp(500, null, '<html>oops</html>'); });
    lr.handleHelcimMessage(helcimSuccess('CT1', '777'));
    await flush();
    expectUnknown();
  });

  test('unknown branch removes the beforeunload prompt and stays locked', async function () {
    await openIframe(1);
    fetchMock.mockImplementationOnce(function () { return resp(500, { error: 'x' }); });
    lr.handleHelcimMessage(helcimSuccess('CT1', '777'));
    await flush();
    expect($('lr-name').disabled).toBe(true);
    $('lr-pay').click();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
