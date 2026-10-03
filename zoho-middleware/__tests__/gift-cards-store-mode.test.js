'use strict';

// ---------------------------------------------------------------------------
// Phase 84 Plan 07 — store-mode dispatch for routes/gift-cards.js.
// Mirrors gift-cards.test.js's harness for the sheets-mode case (real facade,
// mocked axios); mocks '../lib/gift-card-store' entirely for dual/postgres
// cases, per the plan's <action> instruction.
// ---------------------------------------------------------------------------

jest.mock('express', function () {
  var router = { get: jest.fn(), post: jest.fn() };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});

jest.mock('axios', function () {
  return { post: jest.fn().mockResolvedValue({ data: { ok: true } }) };
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

describe('gift-card routes — store-mode dispatch (84-07)', function () {
  var axiosMock, cache, router, handlers;

  /**
   * Reset all module state and re-require the route module so each test
   * starts with fresh mocks and handler registrations. Any jest.doMock('../lib/
   * gift-card-store', ...) call made BEFORE this runs takes effect for the
   * require() inside routes/gift-cards.js below.
   */
  function getHandlers() {
    jest.resetModules();
    axiosMock = require('axios');
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

  /**
   * Replaces the real lib/gift-card-store facade with a controllable mock
   * for the duration of one test. Must be called BEFORE getHandlers().
   */
  function mockFacade(overrides) {
    var facade = Object.assign({
      getMode: jest.fn().mockReturnValue('postgres'),
      lookup: jest.fn(),
      nextCertNumber: jest.fn(),
      voidCard: jest.fn(),
      actorFromRequest: jest.fn().mockImplementation(function (req, prefix) {
        return prefix + ':' + ((req && req.authTier) || 'unknown');
      })
    }, overrides || {});
    jest.doMock('../lib/gift-card-store', function () { return facade; });
    return facade;
  }

  beforeEach(function () {
    process.env.APPS_SCRIPT_URL = 'https://script.google.com/test';
    process.env.APPS_SCRIPT_SERVER_TOKEN = 'test-server-token';
    process.env.API_SECRET_KEY = 'test-api-key';
  });

  afterEach(function () {
    delete process.env.APPS_SCRIPT_URL;
    delete process.env.APPS_SCRIPT_SERVER_TOKEN;
    delete process.env.API_SECRET_KEY;
    delete process.env.GIFT_CARDS_STORE;
    jest.dontMock('../lib/gift-card-store');
  });

  // -------------------------------------------------------------------------
  // Sheets mode (GIFT_CARDS_STORE unset) — real facade, mocked axios, exactly
  // like gift-cards.test.js. Only new assertion: data.store_mode.
  // -------------------------------------------------------------------------

  describe('sheets mode (GIFT_CARDS_STORE unset)', function () {
    test('lookup response carries data.store_mode === "sheets"', function () {
      getHandlers();
      cache.get.mockResolvedValue(null);
      cache.set.mockResolvedValue('OK');
      axiosMock.post.mockResolvedValueOnce({
        data: { ok: true, data: { current_balance: 50, status: 'active', face_value: 100 } }
      });

      var req = { query: { cert_number: 'GC-000001' }, headers: { 'x-api-key': 'test-api-key' } };
      var res = mockRes();

      return handlers['/api/kiosk/gift-card/lookup'](req, res).then(function () {
        expect(res.status).toHaveBeenCalledWith(200);
        var body = res.json.mock.calls[0][0];
        expect(body.ok).toBe(true);
        expect(body.data.current_balance).toBe(50);
        expect(body.data.store_mode).toBe('sheets');
      });
    });
  });

  // -------------------------------------------------------------------------
  // Dual/postgres modes — facade mocked entirely (no real Postgres/Apps
  // Script connection exercised here; the facade itself is unit-tested in
  // __tests__/gift-card-store.test.js).
  // -------------------------------------------------------------------------

  describe('dual/postgres modes (facade mocked)', function () {
    test('postgres lookup -> 200 with store_mode "postgres" and no axios call', function () {
      mockFacade({
        getMode: jest.fn().mockReturnValue('postgres'),
        lookup: jest.fn().mockResolvedValue({
          ok: true,
          data: { current_balance: 50, status: 'active', face_value: 100 }
        })
      });
      getHandlers();

      var req = { query: { cert_number: 'GC-000001' }, headers: { 'x-api-key': 'test-api-key' } };
      var res = mockRes();

      return handlers['/api/kiosk/gift-card/lookup'](req, res).then(function () {
        expect(res.status).toHaveBeenCalledWith(200);
        var body = res.json.mock.calls[0][0];
        expect(body.ok).toBe(true);
        expect(body.data.store_mode).toBe('postgres');
        expect(axiosMock.post).not.toHaveBeenCalled();
      });
    });

    test('postgres lookup rejection -> 503, no sheet fallback', function () {
      mockFacade({
        getMode: jest.fn().mockReturnValue('postgres'),
        lookup: jest.fn().mockRejectedValue(new Error('db unreachable'))
      });
      getHandlers();

      var req = { query: { cert_number: 'GC-000001' }, headers: { 'x-api-key': 'test-api-key' } };
      var res = mockRes();

      return handlers['/api/kiosk/gift-card/lookup'](req, res).then(function () {
        expect(res.status).toHaveBeenCalledWith(503);
        expect(axiosMock.post).not.toHaveBeenCalled();
      });
    });

    test('dual next-number called twice -> cache.get/cache.set never called, two different suggestions', function () {
      var callCount = 0;
      mockFacade({
        getMode: jest.fn().mockReturnValue('dual'),
        nextCertNumber: jest.fn().mockImplementation(function () {
          callCount += 1;
          return Promise.resolve({ ok: true, suggested: 'GC-00000' + callCount });
        })
      });
      getHandlers();

      var req = { headers: { 'x-api-key': 'test-api-key' } };
      var res1 = mockRes();
      var res2 = mockRes();

      return handlers['/api/kiosk/gift-card/next-number'](req, res1).then(function () {
        return handlers['/api/kiosk/gift-card/next-number'](req, res2);
      }).then(function () {
        expect(cache.get).not.toHaveBeenCalled();
        expect(cache.set).not.toHaveBeenCalled();
        var suggested1 = res1.json.mock.calls[0][0].suggested;
        var suggested2 = res2.json.mock.calls[0][0].suggested;
        expect(suggested1).not.toBe(suggested2);
      });
    });

    test('void in postgres -> giftCardStore.voidCard called with actor starting "kiosk-void:"', function () {
      var facade = mockFacade({
        getMode: jest.fn().mockReturnValue('postgres'),
        voidCard: jest.fn().mockResolvedValue({ ok: true })
      });
      getHandlers();

      var req = { body: { cert_number: 'GC-000042', reason: 'test void' }, authTier: 'device' };
      var res = mockRes();

      return handlers['/api/kiosk/gift-card/void'](req, res).then(function () {
        expect(res.status).toHaveBeenCalledWith(200);
        var callArgs = facade.voidCard.mock.calls[0][0];
        expect(callArgs.certNumber).toBe('GC-000042');
        expect(callArgs.actor.indexOf('kiosk-void:')).toBe(0);
      });
    });
  });
});
