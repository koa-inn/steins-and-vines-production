'use strict';

// ---------------------------------------------------------------------------
// Mocks — declared before any require() so Jest hoists them correctly.
// ---------------------------------------------------------------------------

jest.mock('express', function () {
  var router = { get: jest.fn(), post: jest.fn() };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});

// All Apps Script actions (issue/lookup/next-number/void/update-invoice) are
// called via axios.post — the doPost dispatch block handles them all.
jest.mock('axios', function () {
  return { post: jest.fn().mockResolvedValue({ data: { ok: true } }) };
});

// zohoPost default: return an invoice shape (consumed by issue route).
jest.mock('../lib/zoho-api', function () {
  return {
    zohoGet: jest.fn(),
    zohoPost: jest.fn().mockResolvedValue({
      invoice: { invoice_id: 'inv-test-001', invoice_number: 'INV-TEST-001' }
    }),
    zohoPut: jest.fn()
  };
});

jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
});

jest.mock('../lib/eventLog', function () {
  return { logEvent: jest.fn() };
});

jest.mock('../lib/cache', function () {
  return { get: jest.fn(), set: jest.fn(), del: jest.fn() };
});

// ---------------------------------------------------------------------------
// Test harness — mirrors pos-custom-line.test.js pattern
// ---------------------------------------------------------------------------

describe('gift-card routes', function () {
  var axiosMock, zohoApi, cache, router, handlers;

  /**
   * Reset all module state and re-require the route module so each test
   * starts with fresh mocks and handler registrations.
   */
  function getHandlers() {
    jest.resetModules();
    axiosMock = require('axios');
    zohoApi = require('../lib/zoho-api');
    cache = require('../lib/cache');
    require('../routes/gift-cards');
    router = require('express').Router();
    handlers = {};
    router.post.mock.calls.forEach(function (call) {
      handlers[call[0]] = call[call.length - 1];
    });
    router.get.mock.calls.forEach(function (call) {
      handlers[call[0]] = call[call.length - 1];
    });
  }

  function mockRes() {
    var res = { json: jest.fn(), status: jest.fn(), headersSent: false };
    res.status.mockReturnValue(res);
    return res;
  }

  beforeEach(function () {
    getHandlers();
    process.env.KIOSK_GIFT_CARD_ITEM_ID = 'gc-item-test-123';
    process.env.KIOSK_CONTACT_ID = 'contact-walkin-test';
    process.env.APPS_SCRIPT_URL = 'https://script.google.com/test';
    process.env.APPS_SCRIPT_SERVER_TOKEN = 'test-server-token';
    process.env.API_SECRET_KEY = 'test-api-key';
    // M8 (Phase 52-05): next-number now read-through-caches via lib/cache —
    // default to a cold cache (miss) so existing Apps-Script-call assertions
    // are unaffected; individual tests override via cache.get.mockResolvedValueOnce.
    cache.get.mockResolvedValue(null);
    cache.set.mockResolvedValue('OK');
  });

  afterEach(function () {
    delete process.env.KIOSK_GIFT_CARD_ITEM_ID;
    delete process.env.KIOSK_CONTACT_ID;
    delete process.env.APPS_SCRIPT_URL;
    delete process.env.APPS_SCRIPT_SERVER_TOKEN;
    delete process.env.API_SECRET_KEY;
  });

  // -------------------------------------------------------------------------
  // GET /api/kiosk/gift-card/next-number
  // M8 (Phase 52-05): now requires a credential tier (previously unauth —
  // the DoS vector this plan closes). Mirrors the D-09 precedent (commit
  // 313b91a) — existing success-path requests gain an x-api-key header (no
  // assertion changed); a new 401-without-key test is added.
  // -------------------------------------------------------------------------

  describe('GET /api/kiosk/gift-card/next-number', function () {
    test('returns 401 without x-api-key header, Apps Script never called', function () {
      var req = { headers: {} };
      var res = mockRes();

      handlers['/api/kiosk/gift-card/next-number'](req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(axiosMock.post).not.toHaveBeenCalled();
    });

    test('returns suggested cert number from Apps Script', function () {
      axiosMock.post.mockResolvedValueOnce({ data: { ok: true, suggested: 'GC-000001' } });

      var req = { headers: { 'x-api-key': 'test-api-key' } };
      var res = mockRes();

      return handlers['/api/kiosk/gift-card/next-number'](req, res).then(function () {
        expect(res.status).toHaveBeenCalledWith(200);
        var body = res.json.mock.calls[0][0];
        expect(body.ok).toBe(true);
        expect(body.suggested).toBe('GC-000001');

        // Verify Apps Script call used correct action
        var callPayload = JSON.parse(axiosMock.post.mock.calls[0][1]);
        expect(callPayload.action).toBe('get_next_cert_number');
        expect(callPayload.server_token).toBe('test-server-token');
      });
    });

    test('Apps Script error → 500', function () {
      axiosMock.post.mockResolvedValueOnce({ data: { ok: false, error: 'script_error' } });

      var req = { headers: { 'x-api-key': 'test-api-key' } };
      var res = mockRes();

      return handlers['/api/kiosk/gift-card/next-number'](req, res).then(function () {
        expect(res.status).toHaveBeenCalledWith(500);
      });
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/kiosk/gift-card/lookup
  // M8 (Phase 52-05): now requires a credential tier (same rationale as
  // next-number above); existing success/validation-path requests gain an
  // x-api-key header (no assertion changed).
  // -------------------------------------------------------------------------

  describe('GET /api/kiosk/gift-card/lookup', function () {
    test('returns 401 without x-api-key header, Apps Script never called', function () {
      var req = { query: { cert_number: 'GC-000001' }, headers: {} };
      var res = mockRes();

      handlers['/api/kiosk/gift-card/lookup'](req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(axiosMock.post).not.toHaveBeenCalled();
    });

    test('found cert → 200 with current_balance, status, face_value', function () {
      axiosMock.post.mockResolvedValueOnce({
        data: {
          ok: true,
          data: { current_balance: 50, status: 'active', face_value: 100 }
        }
      });

      var req = { query: { cert_number: 'GC-000001' }, headers: { 'x-api-key': 'test-api-key' } };
      var res = mockRes();

      return handlers['/api/kiosk/gift-card/lookup'](req, res).then(function () {
        expect(res.status).toHaveBeenCalledWith(200);
        var body = res.json.mock.calls[0][0];
        expect(body.ok).toBe(true);
        expect(body.data.current_balance).toBe(50);
        expect(body.data.status).toBe('active');

        // Verify Apps Script call
        var callPayload = JSON.parse(axiosMock.post.mock.calls[0][1]);
        expect(callPayload.action).toBe('lookup_gift_card');
        expect(callPayload.cert_number).toBe('GC-000001');
      });
    });

    test('unknown cert → 404', function () {
      axiosMock.post.mockResolvedValueOnce({ data: { ok: false, error: 'not_found' } });

      var req = { query: { cert_number: 'GC-000099' }, headers: { 'x-api-key': 'test-api-key' } };
      var res = mockRes();

      return handlers['/api/kiosk/gift-card/lookup'](req, res).then(function () {
        expect(res.status).toHaveBeenCalledWith(404);
        var body = res.json.mock.calls[0][0];
        expect(body.ok).toBe(false);
      });
    });

    test('invalid cert_number format (too short) → 400, no Apps Script call', function () {
      var req = { query: { cert_number: 'GC-12' }, headers: { 'x-api-key': 'test-api-key' } };
      var res = mockRes();

      handlers['/api/kiosk/gift-card/lookup'](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(axiosMock.post).not.toHaveBeenCalled();
    });

    test('invalid cert_number format (wrong prefix) → 400', function () {
      var req = { query: { cert_number: 'X-000001' }, headers: { 'x-api-key': 'test-api-key' } };
      var res = mockRes();

      handlers['/api/kiosk/gift-card/lookup'](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(axiosMock.post).not.toHaveBeenCalled();
    });

    test('lowercase cert_number is normalised and accepted', function () {
      axiosMock.post.mockResolvedValueOnce({
        data: { ok: true, data: { current_balance: 100, status: 'active', face_value: 100 } }
      });

      var req = { query: { cert_number: 'gc-000001' }, headers: { 'x-api-key': 'test-api-key' } };
      var res = mockRes();

      return handlers['/api/kiosk/gift-card/lookup'](req, res).then(function () {
        expect(res.status).toHaveBeenCalledWith(200);
        var callPayload = JSON.parse(axiosMock.post.mock.calls[0][1]);
        expect(callPayload.cert_number).toBe('GC-000001');
      });
    });
  });

  // NOTE (Phase 44-09): POST /api/kiosk/gift-card/issue and
  // POST /api/kiosk/gift-card/reload test cases removed — those phantom-payment
  // routes are decommissioned. The defect (G-44-01) is fixed: gift cert issue/reload
  // now flows through /api/kiosk/sale + /confirm (cart+terminal in pos.js).
  // Tests for the new issue/reload activation are in pos-gift-card.test.js.

  // -------------------------------------------------------------------------
  // POST /api/kiosk/gift-card/void (GIFTCARD-01e)
  // -------------------------------------------------------------------------

  describe('POST /api/kiosk/gift-card/void', function () {
    test('known cert with reason → 200 {ok}; void_gift_card called with cert_number and reason', function () {
      axiosMock.post.mockResolvedValueOnce({ data: { ok: true } });

      var req = { body: { cert_number: 'GC-000042', reason: 'customer requested cancellation' } };
      var res = mockRes();

      return handlers['/api/kiosk/gift-card/void'](req, res).then(function () {
        expect(res.status).toHaveBeenCalledWith(200);
        var body = res.json.mock.calls[0][0];
        expect(body.ok).toBe(true);

        var voidCall = axiosMock.post.mock.calls[0];
        var voidPayload = JSON.parse(voidCall[1]);
        expect(voidPayload.action).toBe('void_gift_card');
        expect(voidPayload.cert_number).toBe('GC-000042');
        expect(voidPayload.reason).toBe('customer requested cancellation');
      });
    });

    test('unknown cert (Apps Script not_found) → 404', function () {
      axiosMock.post.mockResolvedValueOnce({ data: { ok: false, error: 'not_found' } });

      var req = { body: { cert_number: 'GC-000099', reason: 'lost' } };
      var res = mockRes();

      return handlers['/api/kiosk/gift-card/void'](req, res).then(function () {
        expect(res.status).toHaveBeenCalledWith(404);
      });
    });

    test('missing reason → 400, no Apps Script call', function () {
      var req = { body: { cert_number: 'GC-000042' } };
      var res = mockRes();

      handlers['/api/kiosk/gift-card/void'](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(axiosMock.post).not.toHaveBeenCalled();
    });

    test('empty reason string → 400, no Apps Script call', function () {
      var req = { body: { cert_number: 'GC-000042', reason: '' } };
      var res = mockRes();

      handlers['/api/kiosk/gift-card/void'](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(axiosMock.post).not.toHaveBeenCalled();
    });
  });
});
