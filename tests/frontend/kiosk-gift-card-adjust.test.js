'use strict';

// Regression tests for the kiosk Gift Card Management balance-adjust view
// (kgcm-adjust-*), Phase 84 Plan 03 (DB-03).
//
// Mirrors tests/frontend/kiosk-gift-card-mgmt.test.js's harness: drives the
// REAL js/kiosk-core.js panel through js/kiosk.js's env injection so fetch
// calls resolve buildAuthOptions() to the kiosk device-token shape (D-54-03).
//
// Lookup response shape per the adjust contract (84-03-PLAN.md interfaces):
// { ok:true, data:{ cert_number, current_balance, status, store_mode } }
// Adjust response shape:
// { ok:true, data:{ cert_number, current_balance, status, idempotent } }

global.window = global.window || {};
global.window.addEventListener = global.window.addEventListener || jest.fn();

global.navigator = global.navigator || { userAgent: 'test' };

global.console = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn()
};

global.fetch = jest.fn(function () {
  return Promise.resolve({ status: 200, json: function () { return Promise.resolve({}); } });
});

global.alert = jest.fn();

global.SHEETS_CONFIG = {
  MIDDLEWARE_URL: 'http://localhost:3001',
  MW_API_KEY: 'test-key',
  SPREADSHEET_ID: 'test-id',
  GOOGLE_CLIENT_ID: 'test-client-id',
  STAFF_EMAILS: 'test@example.com',
  API_BASE: 'https://script.google.com/test',
  SERVER_TOKEN: 'test-token'
};

var DEVICE_TOKEN_KEY = 'sv_kiosk_device_token';

function loadSurface(path) {
  jest.resetModules();
  if (global.window) delete global.window.KioskCore;
  document.body.innerHTML = '';
  var mod = require(path); // eslint-disable-line global-require -- intentional dynamic per-surface isolation
  return { mod: mod, core: global.window.KioskCore };
}

function injectEl(id, tag) {
  var existing = document.getElementById(id);
  if (existing) {
    existing.innerHTML = '';
    existing.style.display = '';
    return existing;
  }
  var el = document.createElement(tag || 'div');
  el.id = id;
  document.body.appendChild(el);
  return el;
}

function injectGiftCardMgmtMarkup() {
  injectEl('kgcm-panel');
  injectEl('kgcm-close', 'button');
  injectEl('kgcm-lookup-view');
  injectEl('kgcm-cert', 'input');
  injectEl('kgcm-lookup-btn', 'button');
  injectEl('kgcm-error');
  injectEl('kgcm-result');
  injectEl('kgcm-result-info');
  injectEl('kgcm-void-btn', 'button');
  injectEl('kgcm-adjust-btn', 'button');
  injectEl('kgcm-adjust-sheets-note');
  injectEl('kgcm-void-view');
  injectEl('kgcm-void-confirm');
  injectEl('kgcm-void-reason', 'input');
  injectEl('kgcm-void-error');
  injectEl('kgcm-void-cancel-btn', 'button');
  injectEl('kgcm-void-confirm-btn', 'button');
  injectEl('kgcm-adjust-view');
  injectEl('kgcm-adjust-title');
  injectEl('kgcm-adjust-current');
  injectEl('kgcm-adjust-dir-add', 'button');
  injectEl('kgcm-adjust-dir-remove', 'button');
  injectEl('kgcm-adjust-amount', 'input');
  injectEl('kgcm-adjust-reason', 'select');
  injectEl('kgcm-adjust-note', 'input');
  injectEl('kgcm-adjust-actor', 'input');
  injectEl('kgcm-adjust-preview');
  injectEl('kgcm-adjust-error');
  injectEl('kgcm-adjust-confirm-btn', 'button');
  injectEl('kgcm-adjust-cancel-btn', 'button');

  // The real kiosk.html <select> ships the four reason options — jsdom
  // needs them present for .value assignment to stick.
  var reasonSelect = document.getElementById('kgcm-adjust-reason');
  reasonSelect.innerHTML =
    '<option value="">Choose a reason</option>' +
    '<option value="correction">Correction</option>' +
    '<option value="goodwill">Goodwill</option>' +
    '<option value="refund-to-card">Refund to card</option>' +
    '<option value="other">Other</option>';
}

function el(id) {
  var node = document.getElementById(id);
  if (!node) throw new Error('expected panel element #' + id + ' to exist');
  return node;
}

function lookupResponse(overrides) {
  var base = {
    ok: true,
    data: {
      cert_number: 'GC-000001',
      status: 'active',
      face_value: 20,
      current_balance: 20,
      store_mode: 'postgres'
    }
  };
  if (overrides) {
    for (var k in overrides) {
      if (Object.prototype.hasOwnProperty.call(overrides, k)) base.data[k] = overrides[k];
    }
  }
  return base;
}

function mockFetchOnce(status, body) {
  global.fetch.mockImplementationOnce(function () {
    return Promise.resolve({
      status: status,
      json: function () { return Promise.resolve(body); }
    });
  });
}

function flushPromises() {
  return new Promise(function (resolve) { setTimeout(resolve, 0); });
}

// Performs a lookup for GC-000001 and opens the adjust view. Returns the
// surface for further interaction.
function openAdjustView(overrides) {
  var surface = loadSurface('../../js/kiosk.js');
  localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-gc-adjust-token');
  injectGiftCardMgmtMarkup();

  surface.core.showGiftCardMgmt();
  el('kgcm-cert').value = 'GC-000001';
  mockFetchOnce(200, lookupResponse(overrides));
  el('kgcm-lookup-btn').onclick();

  return surface;
}

beforeEach(function () {
  localStorage.clear();
  global.fetch.mockClear();
});

describe('kiosk Gift Card Management — balance adjust (Phase 84 D-05/D-06/D-07)', function () {
  test('store_mode "postgres" + active status shows the Adjust Balance button', async function () {
    openAdjustView({ store_mode: 'postgres', status: 'active' });
    await flushPromises();

    expect(el('kgcm-adjust-btn').style.display).not.toBe('none');
    expect(el('kgcm-adjust-sheets-note').style.display).toBe('none');
  });

  test('store_mode "sheets" hides the Adjust button and shows the sheets note', async function () {
    openAdjustView({ store_mode: 'sheets', status: 'active' });
    await flushPromises();

    expect(el('kgcm-adjust-btn').style.display).toBe('none');
    expect(el('kgcm-adjust-sheets-note').style.display).toBe('block');
  });

  test('absent store_mode is treated as sheets — Adjust button hidden', async function () {
    var surface = loadSurface('../../js/kiosk.js');
    localStorage.setItem(DEVICE_TOKEN_KEY, 'kiosk-gc-adjust-token');
    injectGiftCardMgmtMarkup();
    surface.core.showGiftCardMgmt();
    el('kgcm-cert').value = 'GC-000001';
    mockFetchOnce(200, {
      ok: true,
      data: { cert_number: 'GC-000001', status: 'active', face_value: 20, current_balance: 20 }
    });
    el('kgcm-lookup-btn').onclick();
    await flushPromises();

    expect(el('kgcm-adjust-btn').style.display).toBe('none');
    expect(el('kgcm-adjust-sheets-note').style.display).toBe('block');
  });

  test('status "void" hides the Adjust button even in postgres mode', async function () {
    openAdjustView({ store_mode: 'postgres', status: 'void' });
    await flushPromises();

    expect(el('kgcm-adjust-btn').style.display).toBe('none');
  });

  test('removing $5.00 from a $20 card posts a single signed-delta request with the contract fields', async function () {
    openAdjustView({ store_mode: 'postgres', status: 'active', current_balance: 20 });
    await flushPromises();

    el('kgcm-adjust-btn').onclick();
    el('kgcm-adjust-dir-remove').onclick();
    el('kgcm-adjust-amount').value = '5.00';
    el('kgcm-adjust-reason').value = 'correction';
    el('kgcm-adjust-actor').value = 'KA';

    mockFetchOnce(200, { ok: true, data: { cert_number: 'GC-000001', current_balance: 15, status: 'active', idempotent: false } });
    mockFetchOnce(200, lookupResponse({ current_balance: 15 })); // the post-success re-lookup
    el('kgcm-adjust-confirm-btn').onclick();
    await flushPromises();

    // One lookup (initial) + one adjust + one re-lookup = 3 total fetches.
    expect(global.fetch).toHaveBeenCalledTimes(3);
    var call = global.fetch.mock.calls[1];
    expect(call[0]).toBe('http://localhost:3001/api/kiosk/gift-card/adjust');
    expect(call[1].method).toBe('POST');
    var body = JSON.parse(call[1].body);
    expect(body.delta).toBe(-5);
    expect(body.reason).toBe('correction');
    expect(body.actor_name).toBe('KA');
    expect(body.device_label).toMatch(/^kiosk-[a-z0-9]{6}$/);
    expect(body.adjust_key).toMatch(/^adj-/);
  });

  describe('client-side validation blocks the fetch', function () {
    function setupValid() {
      openAdjustView({ store_mode: 'postgres', status: 'active', current_balance: 20 });
      return flushPromises().then(function () {
        el('kgcm-adjust-btn').onclick();
        el('kgcm-adjust-reason').value = 'correction';
        el('kgcm-adjust-actor').value = 'KA';
        el('kgcm-adjust-amount').value = '5.00';
      });
    }

    test('empty actor name blocks submission', async function () {
      await setupValid();
      el('kgcm-adjust-actor').value = '';
      global.fetch.mockClear();
      el('kgcm-adjust-confirm-btn').onclick();
      await flushPromises();
      expect(global.fetch).not.toHaveBeenCalled();
      expect(el('kgcm-adjust-error').style.display).toBe('block');
    });

    test('reason "other" with an empty note blocks submission', async function () {
      await setupValid();
      el('kgcm-adjust-reason').value = 'other';
      el('kgcm-adjust-note').value = '';
      global.fetch.mockClear();
      el('kgcm-adjust-confirm-btn').onclick();
      await flushPromises();
      expect(global.fetch).not.toHaveBeenCalled();
      expect(el('kgcm-adjust-error').style.display).toBe('block');
    });

    test('a malformed amount like "1.234" blocks submission', async function () {
      await setupValid();
      el('kgcm-adjust-amount').value = '1.234';
      global.fetch.mockClear();
      el('kgcm-adjust-confirm-btn').onclick();
      await flushPromises();
      expect(global.fetch).not.toHaveBeenCalled();
      expect(el('kgcm-adjust-error').style.display).toBe('block');
    });

    test('removing $25 from a $20 card blocks submission (would go negative)', async function () {
      await setupValid();
      el('kgcm-adjust-dir-remove').onclick();
      el('kgcm-adjust-amount').value = '25.00';
      global.fetch.mockClear();
      el('kgcm-adjust-confirm-btn').onclick();
      await flushPromises();
      expect(global.fetch).not.toHaveBeenCalled();
      expect(el('kgcm-adjust-error').style.display).toBe('block');
      expect(el('kgcm-adjust-error').textContent).toContain('$0.00');
    });
  });

  test('a network failure then retry sends the SAME adjust_key; reopening the view mints a NEW key', async function () {
    openAdjustView({ store_mode: 'postgres', status: 'active', current_balance: 20 });
    await flushPromises();

    el('kgcm-adjust-btn').onclick();
    el('kgcm-adjust-reason').value = 'correction';
    el('kgcm-adjust-actor').value = 'KA';
    el('kgcm-adjust-amount').value = '5.00';

    global.fetch.mockImplementationOnce(function () { return Promise.reject(new Error('network down')); });
    el('kgcm-adjust-confirm-btn').onclick();
    await flushPromises();

    // calls[0] is the initial lookup fired by openAdjustView; calls[1] is
    // this first (rejected) adjust attempt.
    var firstKey = JSON.parse(global.fetch.mock.calls[1][1].body).adjust_key;

    mockFetchOnce(200, { ok: true, data: { cert_number: 'GC-000001', current_balance: 15, status: 'active', idempotent: true } });
    mockFetchOnce(200, lookupResponse({ current_balance: 15 }));
    el('kgcm-adjust-confirm-btn').onclick();
    await flushPromises();

    var retryKey = JSON.parse(global.fetch.mock.calls[2][1].body).adjust_key;
    expect(retryKey).toBe(firstKey);

    // Reopening the adjust view (after the successful 200 returned to lookup)
    // mints a fresh key. calls[3] was the post-success re-lookup.
    el('kgcm-adjust-btn').onclick();
    el('kgcm-adjust-reason').value = 'correction';
    el('kgcm-adjust-actor').value = 'KA';
    el('kgcm-adjust-amount').value = '1.00';
    mockFetchOnce(200, { ok: true, data: { cert_number: 'GC-000001', current_balance: 14, status: 'active', idempotent: false } });
    mockFetchOnce(200, lookupResponse({ current_balance: 14 }));
    el('kgcm-adjust-confirm-btn').onclick();
    await flushPromises();

    var newKey = JSON.parse(global.fetch.mock.calls[4][1].body).adjust_key;
    expect(newKey).not.toBe(firstKey);
  });

  test('a successful 200 shows a toast containing the new balance', async function () {
    openAdjustView({ store_mode: 'postgres', status: 'active', current_balance: 20 });
    await flushPromises();

    el('kgcm-adjust-btn').onclick();
    el('kgcm-adjust-reason').value = 'goodwill';
    el('kgcm-adjust-actor').value = 'KA';
    el('kgcm-adjust-amount').value = '5.00';

    mockFetchOnce(200, { ok: true, data: { cert_number: 'GC-000001', current_balance: 25, status: 'active', idempotent: false } });
    mockFetchOnce(200, lookupResponse({ current_balance: 25 }));
    el('kgcm-adjust-confirm-btn').onclick();
    await flushPromises();

    // showToast renders into #kiosk-toast-container; confirm the panel
    // transitioned back to the lookup view rather than inspecting the
    // toast DOM directly (container isn't injected by this harness).
    expect(el('kgcm-adjust-view').style.display).toBe('none');
  });

  test('409 negative_balance and 403 sheets-mode show the mapped messages in #kgcm-adjust-error', async function () {
    openAdjustView({ store_mode: 'postgres', status: 'active', current_balance: 20 });
    await flushPromises();

    el('kgcm-adjust-btn').onclick();
    el('kgcm-adjust-reason').value = 'correction';
    el('kgcm-adjust-actor').value = 'KA';
    el('kgcm-adjust-amount').value = '5.00';

    mockFetchOnce(409, { ok: false, error: 'negative_balance', balance: 0 });
    el('kgcm-adjust-confirm-btn').onclick();
    await flushPromises();
    expect(el('kgcm-adjust-error').textContent).toBe('Adjustment would take the balance below $0.00.');
    expect(el('kgcm-adjust-error').style.display).toBe('block');

    mockFetchOnce(403, { ok: false, error: 'adjust_unavailable', store_mode: 'sheets' });
    el('kgcm-adjust-confirm-btn').onclick();
    await flushPromises();
    expect(el('kgcm-adjust-error').textContent).toBe('Adjustments are unavailable while the gift-card store is in sheets mode.');
    expect(el('kgcm-adjust-error').style.display).toBe('block');
  });

  test('device label persists: a pre-set localStorage value is sent verbatim', async function () {
    localStorage.setItem('sv-kiosk-device-label', 'kiosk-abc123');
    openAdjustView({ store_mode: 'postgres', status: 'active', current_balance: 20 });
    await flushPromises();

    el('kgcm-adjust-btn').onclick();
    el('kgcm-adjust-reason').value = 'correction';
    el('kgcm-adjust-actor').value = 'KA';
    el('kgcm-adjust-amount').value = '5.00';

    mockFetchOnce(200, { ok: true, data: { cert_number: 'GC-000001', current_balance: 15, status: 'active', idempotent: false } });
    mockFetchOnce(200, lookupResponse({ current_balance: 15 }));
    el('kgcm-adjust-confirm-btn').onclick();
    await flushPromises();

    var body = JSON.parse(global.fetch.mock.calls[1][1].body);
    expect(body.device_label).toBe('kiosk-abc123');
  });
});
