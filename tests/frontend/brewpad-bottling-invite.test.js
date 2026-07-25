'use strict';

// Regression tests for the Ready-to-Bottle "Send Invite" button.
//
// BUG: the dashboard summary payload carries only `has_email` (a boolean) for each
// ready-to-bottle batch — never the address itself (privacy, D-09). The button was
// built with `data-email="{it.customer_email}"`, a field that is never present, so
// it always posted email:"" and the middleware rejected it with a 400
// "Invalid or missing email". The button therefore failed 100% of the time, and
// failed precisely when a customer email DID exist (has_email gates the render).
//
// Fix: resolve the address from the batch record (get_batch) at click time, so the
// dashboard payload keeps carrying only the boolean.

global.document = global.document || {};
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

// Route the mock by request: the Apps Script get_batch read (POSTed to
// ADMIN_API_URL with the action in the JSON body since 64-03 moved the OAuth
// token out of the URL) vs the middleware bottling-invite POST.
function mockFetch(batchRecord) {
  global.fetch.mockImplementation(function (url, opts) {
    var bodyAction = '';
    try { bodyAction = (JSON.parse((opts && opts.body) || '{}').action || ''); } catch (e) { /* not JSON */ }
    if (String(url).indexOf('action=get_batch') !== -1 || bodyAction === 'get_batch') {
      return Promise.resolve({
        ok: true,
        json: function () {
          return Promise.resolve({ ok: true, data: { batch: batchRecord, tasks: [] } });
        }
      });
    }
    if (String(url).indexOf('/api/batch/bottling-invite') !== -1) {
      var body = JSON.parse((opts && opts.body) || '{}');
      // Mirror the middleware's own validation (routes/pos.js) so a bad payload
      // fails here exactly as it does in production.
      var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!body.email || !emailRegex.test(body.email)) {
        return Promise.resolve({
          ok: false,
          status: 400,
          json: function () { return Promise.resolve({ error: 'Invalid or missing email' }); }
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: function () { return Promise.resolve({ success: true }); }
      });
    }
    return Promise.reject(new Error('unexpected fetch: ' + url));
  });
}

function invitePostBody() {
  var call = global.fetch.mock.calls.find(function (c) {
    return String(c[0]).indexOf('/api/batch/bottling-invite') !== -1;
  });
  return call ? JSON.parse(call[1].body) : null;
}

// ---------------------------------------------------------------------------

describe('sendBottlingInviteForBatch', function () {
  beforeEach(function () {
    global.fetch.mockReset();
  });

  test('is exported from brewpad', function () {
    expect(typeof bp.sendBottlingInviteForBatch).toBe('function');
  });

  test('resolves the customer email from the batch record and posts it', function () {
    mockFetch({
      batch_id: 'SV-B-000183',
      customer_name: 'Remo Gamba',
      customer_email: 'remo@example.ca',
      product_name: 'Italy Nebbiolo'
    });

    return bp.sendBottlingInviteForBatch({ batchId: 'SV-B-000183' }).then(function () {
      var body = invitePostBody();
      expect(body).not.toBeNull();
      // The regression: this was "" on every click.
      expect(body.email).toBe('remo@example.ca');
      expect(body.batchId).toBe('SV-B-000183');
    });
  });

  test('never posts an empty email (the exact 400 the button used to trigger)', function () {
    mockFetch({
      batch_id: 'SV-B-000183',
      customer_name: 'Remo Gamba',
      customer_email: 'remo@example.ca',
      product_name: 'Italy Nebbiolo'
    });

    return bp.sendBottlingInviteForBatch({ batchId: 'SV-B-000183' }).then(function () {
      expect(invitePostBody().email).not.toBe('');
    });
  });

  test('prefers the caller-supplied name/product, falling back to the batch record', function () {
    mockFetch({
      batch_id: 'SV-B-000184',
      customer_name: 'Batch Record Name',
      customer_email: 'someone@example.ca',
      product_name: 'Batch Record Product'
    });

    return bp.sendBottlingInviteForBatch({
      batchId: 'SV-B-000184',
      name: 'Caller Name',
      productName: 'Caller Product'
    }).then(function () {
      var body = invitePostBody();
      expect(body.name).toBe('Caller Name');
      expect(body.productName).toBe('Caller Product');
    });
  });

  test('falls back to the batch record when the caller supplies no name/product', function () {
    mockFetch({
      batch_id: 'SV-B-000184',
      customer_name: 'Batch Record Name',
      customer_email: 'someone@example.ca',
      product_name: 'Batch Record Product'
    });

    return bp.sendBottlingInviteForBatch({ batchId: 'SV-B-000184' }).then(function () {
      var body = invitePostBody();
      expect(body.name).toBe('Batch Record Name');
      expect(body.productName).toBe('Batch Record Product');
    });
  });

  test('rejects with a clear message when the batch has no email on file (kiosk sale)', function () {
    // Kiosk-origin batches store an empty customer_email by design (D-09).
    mockFetch({
      batch_id: 'SV-B-000185',
      customer_name: 'Walk-in Customer',
      customer_email: '',
      product_name: 'Cider Kit'
    });

    return bp.sendBottlingInviteForBatch({ batchId: 'SV-B-000185' }).then(
      function () { throw new Error('expected rejection'); },
      function (err) {
        expect(err.message).toMatch(/no customer email/i);
        // Must not have fired a doomed request at the middleware.
        expect(invitePostBody()).toBeNull();
      }
    );
  });

  test('rejects when no batchId is given, without calling the network', function () {
    mockFetch({});
    return bp.sendBottlingInviteForBatch({}).then(
      function () { throw new Error('expected rejection'); },
      function (err) {
        expect(err.message).toMatch(/batch/i);
        expect(global.fetch).not.toHaveBeenCalled();
      }
    );
  });
});
