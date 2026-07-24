'use strict';

// Regression tests for the batch-delete -> cf_batch_status reconcile hook (Phase
// 64-02 / OPS-03 SC#2). Deletes flow browser -> Apps Script delete_batch and never
// touch the middleware, so a deleted batch's linked Zoho invoice previously kept
// naming it forever (INV-000151 class). Both delete sites must, after a successful
// delete_batch, POST the deleted batch's zoho_so_number to the middleware's
// POST /api/batch/reconcile-invoice-status, fire-and-forget (never blocking the
// delete UX).
//
// RED until js/brewpad.js is wired (Task 3 of this plan).

global.window = global.window || {};
global.navigator = global.navigator || {};
global.google = { accounts: { oauth2: { initTokenClient: jest.fn() } } };
global.fetch = jest.fn();
global.localStorage = {
  _data: {},
  getItem: function (k) { return this._data[k] || null; },
  setItem: function (k, v) { this._data[k] = v; },
  removeItem: function (k) { delete this._data[k]; },
  clear: function () { this._data = {}; }
};
global.sessionStorage = global.localStorage;

global.SHEETS_CONFIG = {
  MIDDLEWARE_URL: 'http://mw.test',
  MW_API_KEY: 'test-api-key',
  SPREADSHEET_ID: 'test-id',
  GOOGLE_CLIENT_ID: 'test-client-id',
  STAFF_EMAILS: 'test@example.com',
  API_BASE: 'https://script.google.com/test',
  SERVER_TOKEN: 'test-token',
  ADMIN_API_URL: 'https://script.google.com/test/admin'
};

// auth.js primitives are loaded via <script> in the browser; wire as globals for tests.
var _auth = require('../../js/lib/auth');
global.waitForGoogleIdentity = _auth.waitForGoogleIdentity;
global.gsiInitTokenClient = _auth.gsiInitTokenClient;
global.fetchGoogleUserInfo = _auth.fetchGoogleUserInfo;

var bp = require('../../js/brewpad');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flushPromises() {
  return new Promise(function (resolve) { setTimeout(resolve, 0); });
}

// Routes global.fetch by URL/action so the surrounding delete flow (Apps Script
// delete_batch, batch preload) never rejects and never hits fetchWithRetry's
// 1s retry backoff — only the reconcile-hook call is ever made to fail, and only
// when a test explicitly asks for it (fire-and-forget test).
function mockFetch(opts) {
  opts = opts || {};
  global.fetch.mockImplementation(function (url, options) {
    var u = String(url);

    // The reconcile-hook call this plan wires in — matched first so it never
    // falls through to the generic Apps Script admin-API branch below.
    if (u.indexOf('/api/batch/reconcile-invoice-status') !== -1) {
      if (opts.reconcileReject) {
        return Promise.reject(new Error('reconcile network down'));
      }
      return Promise.resolve({
        ok: true,
        json: function () { return Promise.resolve({ ok: true, action: 'cleared', old: '', new: '' }); }
      });
    }

    // Apps Script admin API (delete_batch POST, get_batches preload GET, etc.)
    if (u.indexOf(global.SHEETS_CONFIG.ADMIN_API_URL) === 0) {
      if (options && options.method === 'POST') {
        var body = JSON.parse((options && options.body) || '{}');
        if (body.action === 'delete_batch') {
          return Promise.resolve({
            ok: true,
            json: function () { return Promise.resolve({ ok: true }); }
          });
        }
      }
      // GET (get_batches, get_batch, etc.) — benign empty response.
      return Promise.resolve({
        ok: true,
        json: function () { return Promise.resolve({ ok: true, data: { batches: [] } }); }
      });
    }

    return Promise.resolve({ ok: true, json: function () { return Promise.resolve({}); } });
  });
}

function reconcileCalls() {
  return global.fetch.mock.calls.filter(function (c) {
    return String(c[0]).indexOf('/api/batch/reconcile-invoice-status') !== -1;
  });
}

function renderAdminDetailPane(batch) {
  document.body.innerHTML = '<div id="bp-batch-detail-pane"></div><div id="bp-toast-container"></div>';
  bp._renderBatchDetailForTest({ batch: batch, tasks: [], plato_readings: [] });
  return document.getElementById('bp-batch-detail-pane');
}

function clickConfirmOk() {
  var okBtn = document.getElementById('bp-confirm-sheet-ok');
  expect(okBtn).not.toBeNull();
  okBtn.click();
}

function renderNeedsSchedulingButton(row) {
  document.body.innerHTML =
    '<div id="bp-dashboard-inner">' +
    '<button type="button" class="btn-secondary bp-btn-sm bp-danger-btn bp-needsched-delete-btn"' +
    ' data-batch-id="' + row.batch_id + '"' +
    ' data-product="' + (row.product_name || '') + '"' +
    ' data-customer="' + (row.customer_name || '') + '">Delete</button>' +
    '</div>' +
    '<div id="bp-toast-container"></div>';
  // (Re-)wire the delegated dashboard click handler onto the freshly-created
  // #bp-dashboard-inner node — the module's own DOMContentLoaded listener was
  // registered once at require() time (before this fixture existed), so it is
  // manually re-fired here rather than relying on jsdom's initial (already-past)
  // DOMContentLoaded. This calls the real initDelegation(), not a test-only stub.
  document.dispatchEvent(new Event('DOMContentLoaded'));
  return document.querySelector('.bp-needsched-delete-btn');
}

beforeEach(function () {
  global.fetch.mockReset();
  mockFetch();
});

// ---------------------------------------------------------------------------
// Test 1: admin batch-detail delete site (brewpad.js ~:5657)
// ---------------------------------------------------------------------------
describe('admin batch-detail delete site wires the reconcile hook', function () {
  test('deleting a batch with a zoho_so_number POSTs it to reconcile-invoice-status', function () {
    renderAdminDetailPane({
      batch_id: 'SV-B-000185',
      status: 'pending',
      product_name: 'Cider Kit',
      customer_name: 'Walk-in Customer',
      zoho_so_number: 'INV-000151'
    });

    var deleteBtn = document.getElementById('bp-delete-batch-btn');
    expect(deleteBtn).not.toBeNull();
    deleteBtn.click();
    clickConfirmOk();

    return flushPromises().then(function () {
      var calls = reconcileCalls();
      expect(calls.length).toBe(1);
      var call = calls[0];
      expect(call[0]).toBe('http://mw.test/api/batch/reconcile-invoice-status');
      var opts = call[1];
      expect(opts.method).toBe('POST');
      var body = JSON.parse(opts.body);
      expect(body.zoho_so_number).toBe('INV-000151');
    });
  });
});

// ---------------------------------------------------------------------------
// Test 2: Needs-Scheduling delete site (brewpad.js ~:7998) — lookup must happen
// BEFORE delete_batch fires, since the success handler clears _allBatchesData.
// ---------------------------------------------------------------------------
describe('Needs-Scheduling delete site wires the reconcile hook', function () {
  test('resolves zoho_so_number from _allBatchesData by batch_id BEFORE the delete clears it', function () {
    bp._setStateForTest({
      _allBatchesData: [
        { batch_id: 'SV-B-000185', zoho_so_number: 'INV-000151', product_name: 'Cider Kit', customer_name: 'Walk-in Customer' },
        { batch_id: 'SV-B-999999', zoho_so_number: 'INV-999999', product_name: 'Other Kit', customer_name: 'Someone Else' }
      ]
    });

    var delBtn = renderNeedsSchedulingButton({
      batch_id: 'SV-B-000185',
      product_name: 'Cider Kit',
      customer_name: 'Walk-in Customer'
    });
    expect(delBtn).not.toBeNull();
    delBtn.click();
    clickConfirmOk();

    return flushPromises().then(function () {
      var calls = reconcileCalls();
      expect(calls.length).toBe(1);
      var body = JSON.parse(calls[0][1].body);
      expect(body.zoho_so_number).toBe('INV-000151');
    });
  });
});

// ---------------------------------------------------------------------------
// Test 3: fire-and-forget — a reconcile failure never blocks/breaks the delete UX
// ---------------------------------------------------------------------------
describe('reconcile hook is fire-and-forget', function () {
  test('reconcile fetch rejecting still lets the delete success toast complete, no throw', function () {
    mockFetch({ reconcileReject: true });

    renderAdminDetailPane({
      batch_id: 'SV-B-000185',
      status: 'pending',
      product_name: 'Cider Kit',
      customer_name: 'Walk-in Customer',
      zoho_so_number: 'INV-000151'
    });

    var deleteBtn = document.getElementById('bp-delete-batch-btn');
    expect(function () {
      deleteBtn.click();
      clickConfirmOk();
    }).not.toThrow();

    return flushPromises().then(function () {
      // Reconcile was attempted (and rejected) but did not block the success path.
      expect(reconcileCalls().length).toBe(1);
      var toastContainer = document.getElementById('bp-toast-container');
      var successToast = toastContainer.querySelector('.bp-toast--success');
      expect(successToast).not.toBeNull();
      expect(successToast.textContent).toContain('Batch deleted');
      // No error toast attributable to the reconcile failure — it is silent.
      var errorToasts = toastContainer.querySelectorAll('.bp-toast--error');
      expect(errorToasts.length).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Test 4: no zoho_so_number on the batch -> no reconcile call at all
// ---------------------------------------------------------------------------
describe('batch with no linked invoice: no reconcile call', function () {
  test('deleting an unlinked batch never POSTs to reconcile-invoice-status', function () {
    renderAdminDetailPane({
      batch_id: 'SV-B-000200',
      status: 'pending',
      product_name: 'Merlot Kit',
      customer_name: 'Walk-in Customer'
      // no zoho_so_number
    });

    var deleteBtn = document.getElementById('bp-delete-batch-btn');
    deleteBtn.click();
    clickConfirmOk();

    return flushPromises().then(function () {
      expect(reconcileCalls().length).toBe(0);
    });
  });
});
