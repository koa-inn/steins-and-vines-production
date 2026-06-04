'use strict';

jest.mock('express', function () {
  var router = { get: jest.fn(), post: jest.fn() };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});
jest.mock('../lib/calcom', function () {
  return { verifyWebhook: jest.fn() };
});
jest.mock('../lib/cache', function () {
  return {
    get: jest.fn(),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1)
  };
});
jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
});
jest.mock('../lib/eventLog', function () {
  return { logEvent: jest.fn() };
});
jest.mock('../lib/constants', function () {
  return {
    CACHE_KEYS: {
      AVAILABILITY_PREFIX: 'zoho:availability:',
      SLOTS_PREFIX: 'zoho:slots:'
    }
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockRes() {
  var res = { json: jest.fn(), status: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}

function makeReq(overrides) {
  return Object.assign({
    headers: { 'x-cal-signature-256': 'valid-sig' },
    rawBody: Buffer.from('{"triggerEvent":"BOOKING_CANCELLED"}'),
    body: { triggerEvent: 'BOOKING_CANCELLED' }
  }, overrides || {});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/webhooks/calcom — Cal.com webhook handler', function () {
  var calcom, cache, log, eventLog, router, handler;

  beforeEach(function () {
    jest.resetModules();

    calcom = require('../lib/calcom');
    cache = require('../lib/cache');
    log = require('../lib/logger');
    eventLog = require('../lib/eventLog');

    jest.clearAllMocks();

    // Default: signature passes
    calcom.verifyWebhook.mockReturnValue(true);
    cache.del.mockResolvedValue(1);

    // Load the route module so it registers handlers
    require('../routes/webhooks');
    router = require('express').Router();

    // Extract the POST /api/webhooks/calcom handler (dual-path registration)
    handler = null;
    router.post.mock.calls.forEach(function (call) {
      // call[0] is either a string or array of paths; call[last] is the handler fn
      var paths = call[0];
      var fn = call[call.length - 1];
      if (Array.isArray(paths)) {
        if (paths.indexOf('/api/webhooks/calcom') !== -1 || paths.indexOf('/webhooks/calcom') !== -1) {
          handler = fn;
        }
      } else if (paths === '/api/webhooks/calcom' || paths === '/webhooks/calcom') {
        handler = fn;
      }
    });
  });

  // -------------------------------------------------------------------------
  // Guard: handler must be registered
  // -------------------------------------------------------------------------

  test('route /api/webhooks/calcom is registered', function () {
    expect(handler).not.toBeNull();
    expect(typeof handler).toBe('function');
  });

  // -------------------------------------------------------------------------
  // Signature verification — bad sig -> 401, no processing
  // -------------------------------------------------------------------------

  test('invalid signature -> 401 and does NOT log event', function () {
    calcom.verifyWebhook.mockReturnValue(false);

    var req = makeReq({ headers: { 'x-cal-signature-256': 'bad-sig' } });
    var res = mockRes();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json.mock.calls[0][0]).toEqual({ error: 'Invalid signature' });
    expect(eventLog.logEvent).not.toHaveBeenCalled();
  });

  test('invalid signature -> uses req.rawBody for verify call', function () {
    calcom.verifyWebhook.mockReturnValue(false);

    var rawBodyBuf = Buffer.from('{"triggerEvent":"BOOKING_CANCELLED","payload":{}}');
    var req = makeReq({
      headers: { 'x-cal-signature-256': 'bad-sig' },
      rawBody: rawBodyBuf
    });
    var res = mockRes();

    handler(req, res);

    expect(calcom.verifyWebhook).toHaveBeenCalledWith(
      rawBodyBuf.toString(),
      'bad-sig'
    );
  });

  test('missing x-cal-signature-256 header -> verifyWebhook called with empty string', function () {
    calcom.verifyWebhook.mockReturnValue(false);

    var req = makeReq({ headers: {} });
    var res = mockRes();

    handler(req, res);

    expect(calcom.verifyWebhook).toHaveBeenCalledWith(
      expect.any(String),
      ''
    );
    expect(res.status).toHaveBeenCalledWith(401);
  });

  // -------------------------------------------------------------------------
  // Valid signature -> 200 fast + eventLog
  // -------------------------------------------------------------------------

  test('valid signature -> responds 200 { received: true }', function () {
    calcom.verifyWebhook.mockReturnValue(true);

    var req = makeReq({ body: { triggerEvent: 'BOOKING_CREATED' } });
    var res = mockRes();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]).toEqual({ received: true });
  });

  test('valid signature -> logs via eventLog with triggerEvent', function () {
    calcom.verifyWebhook.mockReturnValue(true);

    var req = makeReq({ body: { triggerEvent: 'BOOKING_CREATED' } });
    var res = mockRes();

    handler(req, res);

    expect(eventLog.logEvent).toHaveBeenCalledWith(
      'calcom.webhook_received',
      expect.objectContaining({ triggerEvent: 'BOOKING_CREATED' })
    );
  });

  // -------------------------------------------------------------------------
  // BOOKING_CANCELLED -> cache invalidation
  // -------------------------------------------------------------------------

  test('BOOKING_CANCELLED with payload.startTime -> calls cache.del for slots + availability', function () {
    calcom.verifyWebhook.mockReturnValue(true);

    var req = makeReq({
      body: {
        triggerEvent: 'BOOKING_CANCELLED',
        payload: { startTime: '2026-06-10T15:00:00.000Z' }
      }
    });
    var res = mockRes();

    handler(req, res);

    expect(cache.del).toHaveBeenCalledWith('zoho:slots:2026-06-10');
    expect(cache.del).toHaveBeenCalledWith('zoho:availability:2026-06');
  });

  test('BOOKING_CANCELLED with payload.booking.start -> calls cache.del', function () {
    calcom.verifyWebhook.mockReturnValue(true);

    var req = makeReq({
      body: {
        triggerEvent: 'BOOKING_CANCELLED',
        payload: { booking: { start: '2026-07-15T09:00:00.000Z' } }
      }
    });
    var res = mockRes();

    handler(req, res);

    expect(cache.del).toHaveBeenCalledWith('zoho:slots:2026-07-15');
    expect(cache.del).toHaveBeenCalledWith('zoho:availability:2026-07');
  });

  test('BOOKING_CANCELLED with payload.start fallback -> calls cache.del', function () {
    calcom.verifyWebhook.mockReturnValue(true);

    var req = makeReq({
      body: {
        triggerEvent: 'BOOKING_CANCELLED',
        payload: { start: '2026-08-20T14:00:00.000Z' }
      }
    });
    var res = mockRes();

    handler(req, res);

    expect(cache.del).toHaveBeenCalledWith('zoho:slots:2026-08-20');
    expect(cache.del).toHaveBeenCalledWith('zoho:availability:2026-08');
  });

  test('BOOKING_CANCELLED with unparseable date -> no cache.del, no throw, logs warn', function () {
    calcom.verifyWebhook.mockReturnValue(true);

    var req = makeReq({
      body: {
        triggerEvent: 'BOOKING_CANCELLED',
        payload: {}
      }
    });
    var res = mockRes();

    expect(function () { handler(req, res); }).not.toThrow();
    expect(cache.del).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalled();
    // Still responds 200
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('BOOKING_CANCELLED with null payload -> no cache.del, no throw', function () {
    calcom.verifyWebhook.mockReturnValue(true);

    var req = makeReq({
      body: {
        triggerEvent: 'BOOKING_CANCELLED'
        // no payload field at all
      }
    });
    var res = mockRes();

    expect(function () { handler(req, res); }).not.toThrow();
    expect(cache.del).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // BOOKING_CREATED / BOOKING_RESCHEDULED -> log only, no cache.del
  // -------------------------------------------------------------------------

  test('BOOKING_CREATED -> no cache.del (idempotent)', function () {
    calcom.verifyWebhook.mockReturnValue(true);

    var req = makeReq({ body: { triggerEvent: 'BOOKING_CREATED', payload: { startTime: '2026-06-10T10:00:00.000Z' } } });
    var res = mockRes();

    handler(req, res);

    expect(cache.del).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('BOOKING_RESCHEDULED -> no cache.del (idempotent)', function () {
    calcom.verifyWebhook.mockReturnValue(true);

    var req = makeReq({ body: { triggerEvent: 'BOOKING_RESCHEDULED', payload: { startTime: '2026-06-10T10:00:00.000Z' } } });
    var res = mockRes();

    handler(req, res);

    expect(cache.del).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
