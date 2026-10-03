'use strict';

// ---------------------------------------------------------------------------
// Phase 84 Plan 07, Task 2 — POST /api/kiosk/gift-card/adjust.
// Mirrors gift-cards-store-mode.test.js's harness: '../lib/gift-card-store'
// is mocked entirely so every <behavior> line is tested against a
// controllable facade, with zero real Postgres/Apps Script involvement.
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

describe('POST /api/kiosk/gift-card/adjust', function () {
  var eventLog, giftCardStoreMock, handlers;

  /**
   * Replaces the real lib/gift-card-store facade with a controllable mock.
   * Must be called BEFORE getHandlers().
   */
  function mockFacade(overrides) {
    var facade = Object.assign({
      getMode: jest.fn().mockReturnValue('postgres'),
      adjust: jest.fn(),
      actorFromRequest: jest.fn().mockImplementation(function (req, prefix) {
        return prefix + ':' + ((req && req.authTier) || 'unknown');
      })
    }, overrides || {});
    jest.doMock('../lib/gift-card-store', function () { return facade; });
    return facade;
  }

  function getHandlers() {
    jest.resetModules();
    eventLog = require('../lib/eventLog');
    require('../routes/gift-cards');
    var router = require('express').Router();
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

  function validBody(overrides) {
    return Object.assign({
      cert_number: 'GC-000001',
      delta: -5,
      reason: 'correction',
      note: '',
      actor_name: 'KA',
      device_label: 'kiosk-ab12cd',
      adjust_key: 'abcd1234efgh5678'
    }, overrides || {});
  }

  afterEach(function () {
    delete process.env.GIFT_CARDS_STORE;
    jest.dontMock('../lib/gift-card-store');
  });

  // -------------------------------------------------------------------------
  // D-07 server gate: sheets mode refuses before any facade call.
  // -------------------------------------------------------------------------

  test('GIFT_CARDS_STORE unset (sheets mode) -> 403 adjust_unavailable, facade.adjust not called', function () {
    var facade = mockFacade({ getMode: jest.fn().mockReturnValue('sheets') });
    getHandlers();

    var req = { body: validBody() };
    var res = mockRes();

    handlers['/api/kiosk/gift-card/adjust'](req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    var body = res.json.mock.calls[0][0];
    expect(body.ok).toBe(false);
    expect(body.error).toBe('adjust_unavailable');
    expect(body.store_mode).toBe('sheets');
    expect(facade.adjust).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Field validation (postgres mode so the mode gate doesn't short-circuit).
  // -------------------------------------------------------------------------

  describe('field validation (postgres mode)', function () {
    var facade;

    beforeEach(function () {
      facade = mockFacade({ adjust: jest.fn() });
      getHandlers();
    });

    test('cert_number "GC-1" -> 400', function () {
      var res = mockRes();
      handlers['/api/kiosk/gift-card/adjust']({ body: validBody({ cert_number: 'GC-1' }) }, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(facade.adjust).not.toHaveBeenCalled();
    });

    test.each([0, 'abc', NaN, 1.234, 100000000])('delta %p -> 400', function (delta) {
      var res = mockRes();
      handlers['/api/kiosk/gift-card/adjust']({ body: validBody({ delta: delta }) }, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(facade.adjust).not.toHaveBeenCalled();
    });

    test('reason "refund" -> 400', function () {
      var res = mockRes();
      handlers['/api/kiosk/gift-card/adjust']({ body: validBody({ reason: 'refund' }) }, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(facade.adjust).not.toHaveBeenCalled();
    });

    test('reason "other" with empty note -> 400', function () {
      var res = mockRes();
      handlers['/api/kiosk/gift-card/adjust']({ body: validBody({ reason: 'other', note: '' }) }, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(facade.adjust).not.toHaveBeenCalled();
    });

    test('actor_name "" -> 400', function () {
      var res = mockRes();
      handlers['/api/kiosk/gift-card/adjust']({ body: validBody({ actor_name: '' }) }, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(facade.adjust).not.toHaveBeenCalled();
    });

    test('actor_name "1234" (no letter) -> 400', function () {
      var res = mockRes();
      handlers['/api/kiosk/gift-card/adjust']({ body: validBody({ actor_name: '1234' }) }, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(facade.adjust).not.toHaveBeenCalled();
    });

    test('actor_name 61 chars -> 400', function () {
      var res = mockRes();
      var longName = new Array(62).join('A'); // 61 chars
      handlers['/api/kiosk/gift-card/adjust']({ body: validBody({ actor_name: longName }) }, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(facade.adjust).not.toHaveBeenCalled();
    });

    test('device_label "bad/label" -> 400', function () {
      var res = mockRes();
      handlers['/api/kiosk/gift-card/adjust']({ body: validBody({ device_label: 'bad/label' }) }, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(facade.adjust).not.toHaveBeenCalled();
    });

    test('adjust_key "short" -> 400', function () {
      var res = mockRes();
      handlers['/api/kiosk/gift-card/adjust']({ body: validBody({ adjust_key: 'short' }) }, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(facade.adjust).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Valid body -> facade call shape + success mapping.
  // -------------------------------------------------------------------------

  test('valid body in postgres mode -> facade.adjust called with the full params shape, 200 on success', function () {
    var facade = mockFacade({
      adjust: jest.fn().mockResolvedValue({ ok: true, new_balance: 15, status: 'active' })
    });
    getHandlers();

    var req = {
      body: validBody({ reason: 'correction', note: 'test note' }),
      authTier: 'device'
    };
    var res = mockRes();

    return handlers['/api/kiosk/gift-card/adjust'](req, res).then(function () {
      expect(facade.adjust).toHaveBeenCalledTimes(1);
      var callArgs = facade.adjust.mock.calls[0][0];
      expect(callArgs.certNumber).toBe('GC-000001');
      expect(callArgs.delta).toBe(-5);
      expect(callArgs.reason).toBe('correction');
      expect(callArgs.actorName).toBe('KA');
      expect(callArgs.deviceLabel).toBe('kiosk-ab12cd');
      expect(callArgs.adjustKey).toBe('abcd1234efgh5678');
      expect(callArgs.actor).toBe('kiosk-adjust:device');

      expect(res.status).toHaveBeenCalledWith(200);
      var body = res.json.mock.calls[0][0];
      expect(body.ok).toBe(true);
      expect(body.data.cert_number).toBe('GC-000001');
      expect(body.data.current_balance).toBe(15);
      expect(body.data.status).toBe('active');
      expect(body.data.idempotent).toBe(false);
    });
  });

  test('delta given as numeric string "-5.00" is accepted and passed as Number -5', function () {
    var facade = mockFacade({
      adjust: jest.fn().mockResolvedValue({ ok: true, new_balance: 15, status: 'active' })
    });
    getHandlers();

    var req = { body: validBody({ delta: '-5.00' }) };
    var res = mockRes();

    return handlers['/api/kiosk/gift-card/adjust'](req, res).then(function () {
      var callArgs = facade.adjust.mock.calls[0][0];
      expect(callArgs.delta).toBe(-5);
      expect(typeof callArgs.delta).toBe('number');
    });
  });

  test('eventLog.logEvent fires on success only, with the documented fields', function () {
    mockFacade({
      adjust: jest.fn().mockResolvedValue({ ok: true, new_balance: 15, status: 'active' })
    });
    getHandlers();

    var req = { body: validBody() };
    var res = mockRes();

    return handlers['/api/kiosk/gift-card/adjust'](req, res).then(function () {
      expect(eventLog.logEvent).toHaveBeenCalledWith('kiosk.gift_card_adjusted', {
        certNumber: 'GC-000001',
        delta: -5,
        reason: 'correction',
        actorName: 'KA',
        deviceLabel: 'kiosk-ab12cd'
      });
    });
  });

  test('eventLog.logEvent does NOT fire on a facade business rejection', function () {
    mockFacade({
      adjust: jest.fn().mockResolvedValue({ ok: false, error: 'not_found' })
    });
    getHandlers();

    var req = { body: validBody() };
    var res = mockRes();

    return handlers['/api/kiosk/gift-card/adjust'](req, res).then(function () {
      expect(eventLog.logEvent).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Facade business-rejection -> HTTP status mapping.
  // -------------------------------------------------------------------------

  test('facade {ok:false, error:"not_found"} -> 404', function () {
    mockFacade({ adjust: jest.fn().mockResolvedValue({ ok: false, error: 'not_found' }) });
    getHandlers();

    var res = mockRes();
    return handlers['/api/kiosk/gift-card/adjust']({ body: validBody() }, res).then(function () {
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  test('facade {ok:false, error:"invalid_status", status:"void"} -> 409 with status', function () {
    mockFacade({ adjust: jest.fn().mockResolvedValue({ ok: false, error: 'invalid_status', status: 'void' }) });
    getHandlers();

    var res = mockRes();
    return handlers['/api/kiosk/gift-card/adjust']({ body: validBody() }, res).then(function () {
      expect(res.status).toHaveBeenCalledWith(409);
      var body = res.json.mock.calls[0][0];
      expect(body.error).toBe('invalid_status');
      expect(body.status).toBe('void');
    });
  });

  test('facade {ok:false, error:"negative_balance", balance:3} -> 409 with balance', function () {
    mockFacade({ adjust: jest.fn().mockResolvedValue({ ok: false, error: 'negative_balance', balance: 3 }) });
    getHandlers();

    var res = mockRes();
    return handlers['/api/kiosk/gift-card/adjust']({ body: validBody() }, res).then(function () {
      expect(res.status).toHaveBeenCalledWith(409);
      var body = res.json.mock.calls[0][0];
      expect(body.error).toBe('negative_balance');
      expect(body.balance).toBe(3);
    });
  });

  test('facade {ok:false, error:"invalid_amount"} -> 400', function () {
    mockFacade({ adjust: jest.fn().mockResolvedValue({ ok: false, error: 'invalid_amount' }) });
    getHandlers();

    var res = mockRes();
    return handlers['/api/kiosk/gift-card/adjust']({ body: validBody() }, res).then(function () {
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  test('facade {ok:false, error:"adjust_unavailable"} -> 403', function () {
    mockFacade({ adjust: jest.fn().mockResolvedValue({ ok: false, error: 'adjust_unavailable' }) });
    getHandlers();

    var res = mockRes();
    return handlers['/api/kiosk/gift-card/adjust']({ body: validBody() }, res).then(function () {
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  test('facade {ok:false, error:"tx_ref_conflict"} -> 409 {ok:false, error:"tx_ref_conflict"} (never a generic 500)', function () {
    mockFacade({ adjust: jest.fn().mockResolvedValue({ ok: false, error: 'tx_ref_conflict' }) });
    getHandlers();

    var res = mockRes();
    return handlers['/api/kiosk/gift-card/adjust']({ body: validBody() }, res).then(function () {
      expect(res.status).toHaveBeenCalledWith(409);
      var body = res.json.mock.calls[0][0];
      expect(body.ok).toBe(false);
      expect(body.error).toBe('tx_ref_conflict');
    });
  });

  test('facade rejects (infrastructure failure) -> 503', function () {
    mockFacade({ adjust: jest.fn().mockRejectedValue(new Error('db unreachable')) });
    getHandlers();

    var res = mockRes();
    return handlers['/api/kiosk/gift-card/adjust']({ body: validBody() }, res).then(function () {
      expect(res.status).toHaveBeenCalledWith(503);
    });
  });
});

// ---------------------------------------------------------------------------
// KIOSK_ROUTES membership — no mocking needed, exercises the real module.
// ---------------------------------------------------------------------------

describe('authTiers KIOSK_ROUTES membership', function () {
  test('/api/kiosk/gift-card/adjust is in KIOSK_ROUTES and isKioskRoute() is true', function () {
    jest.resetModules();
    var authTiers = require('../lib/authTiers');
    expect(authTiers.KIOSK_ROUTES.indexOf('/api/kiosk/gift-card/adjust')).not.toBe(-1);
    expect(authTiers.isKioskRoute('/api/kiosk/gift-card/adjust')).toBe(true);
  });
});
