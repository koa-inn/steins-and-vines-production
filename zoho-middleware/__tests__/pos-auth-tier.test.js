'use strict';

// Integration tests for the 46-04 pos.js in-route tier migration (T-46-18,
// T-46-18b, T-46-18c, T-46-03b, T-46-19). Proves the SECOND enforcement
// layer (the in-route requireTiers wrap inside pos.js/consignment.js) does
// not silently re-require the retired legacy key once API_SECRET_KEY is
// rotated — the kiosk device token must keep working on kiosk-scoped
// routes, and admin/BrewPad routes must keep rejecting a device token even
// though the global 46-03 guard already lets GETs through unauthenticated.
//
// Mirrors __tests__/auth-tiers-guard.test.js's mock roster (full app require
// via supertest) — same approach, extended coverage of pos.js routes.

// ---------------------------------------------------------------------------
// Mocks — must be declared before the app require.
// ---------------------------------------------------------------------------
jest.mock('../lib/zohoAuth', function () {
  return { init: jest.fn().mockResolvedValue(), isAuthenticated: jest.fn().mockReturnValue(true) };
});
jest.mock('../lib/validateEnv', function () { return jest.fn(); });
jest.mock('../lib/checkRedis', function () { return jest.fn().mockResolvedValue(); });
jest.mock('../lib/checkMailer', function () { return jest.fn(); });
jest.mock('../lib/brewpad-integration', function () {
  return { syncBatch: jest.fn(), init: jest.fn(), createBatchesFromSale: jest.fn() };
});
jest.mock('node-cron', function () { return { schedule: jest.fn() }; });
jest.mock('@sentry/node', function () {
  return { init: jest.fn(), setupExpressErrorHandler: jest.fn(), captureException: jest.fn() };
});
jest.mock('../lib/mailerlite', function () {
  return { isConfigured: jest.fn().mockReturnValue(false), addSubscriber: jest.fn().mockResolvedValue() };
});
jest.mock('../lib/eventLog', function () { return { logEvent: jest.fn() }; });
jest.mock('../lib/inventory-ledger', function () { return { decrementStock: jest.fn().mockResolvedValue() }; });
jest.mock('../lib/cache', function () {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    acquireLock: jest.fn().mockResolvedValue(true),
    isConnected: jest.fn().mockReturnValue(false),
    init: jest.fn().mockResolvedValue(),
    getClient: jest.fn().mockResolvedValue(null)
  };
});
jest.mock('../lib/zoho-api', function () {
  return {
    zohoPost: jest.fn().mockResolvedValue({}),
    zohoGet: jest.fn().mockResolvedValue({ salesorders: [], invoices: [], contacts: [] }),
    zohoPut: jest.fn().mockResolvedValue({}),
    inventoryGet: jest.fn().mockResolvedValue({}),
    inventoryPut: jest.fn().mockResolvedValue({}),
    ZOHO_INVENTORY_BASE: 'https://inventory.zoho.com/api/v1'
  };
});
jest.mock('axios', function () { return { post: jest.fn().mockResolvedValue({ data: { ok: true } }), get: jest.fn().mockResolvedValue({ data: { ok: true, data: { batches: [] } } }) }; });

// lib/session — mock-mirrors-real-contract: getSession(sid) -> Promise<{email}|null>.
jest.mock('../lib/session', function () {
  return {
    createSession: jest.fn().mockResolvedValue('mock-sid'),
    getSession: jest.fn().mockResolvedValue(null),
    destroySession: jest.fn().mockResolvedValue(),
    touchSession: jest.fn().mockResolvedValue(null)
  };
});

// lib/deviceToken — mock-mirrors-real-contract: matches(sent) is true only when
// sent === KIOSK_DEVICE_TOKEN and non-empty (fail closed when unset).
jest.mock('../lib/deviceToken', function () {
  return {
    getKey: function () { return process.env.KIOSK_DEVICE_TOKEN || ''; },
    matches: function (sent) {
      var key = process.env.KIOSK_DEVICE_TOKEN || '';
      return !!key && typeof sent === 'string' && sent === key;
    }
  };
});

// Set env before requiring the app so the guard + in-route checks capture credentials.
process.env.API_SECRET_KEY = 'integration-secret';
process.env.MW_API_KEY = 'integration-secret';
process.env.KIOSK_DEVICE_TOKEN = 'integration-device-token';

var request = require('supertest');
var app = require('../server');
var session = require('../lib/session');

var API_KEY = 'integration-secret';
var DEVICE_TOKEN = 'integration-device-token';

describe('46-04 pos.js in-route tier migration', function () {
  beforeEach(function () {
    session.getSession.mockReset();
    session.getSession.mockResolvedValue(null);
  });

  // -------------------------------------------------------------------------
  // (1)/(2) Kiosk-scoped POST — device token reaches the handler
  // -------------------------------------------------------------------------
  test('(1) kiosk POST /api/kiosk/verify-pin with a valid x-device-token — not 403', function () {
    return request(app)
      .post('/api/kiosk/verify-pin')
      .set('x-device-token', DEVICE_TOKEN)
      .send({ pin: '0000' })
      .then(function (res) {
        expect(res.status).not.toBe(403);
      });
  });

  test('(2) kiosk POST /api/kiosk/verify-pin with NO credential — 403 (global guard, keyless)', function () {
    return request(app)
      .post('/api/kiosk/verify-pin')
      .send({ pin: '0000' })
      .then(function (res) {
        expect(res.status).toBe(403);
      });
  });

  // -------------------------------------------------------------------------
  // (3)/(4) gift-card void — device now allowed (D-54-GC), session accepted
  // -------------------------------------------------------------------------
  test('(3) /api/kiosk/gift-card/void with a valid device token — not 403 (D-54-GC: device now allowed)', function () {
    return request(app)
      .post('/api/kiosk/gift-card/void')
      .set('x-device-token', DEVICE_TOKEN)
      .send({ cert_number: 'GC-000042', reason: 'test' })
      .then(function (res) {
        expect(res.status).not.toBe(403);
      });
  });

  test('(4) /api/kiosk/gift-card/void with a valid session cookie — not auth-403', function () {
    session.getSession.mockResolvedValueOnce({ email: 'staff@steinsandvines.ca' });
    return request(app)
      .post('/api/kiosk/gift-card/void')
      .set('Cookie', 'sv_session=valid-sid')
      .send({ cert_number: 'GC-000042', reason: 'test' })
      .then(function (res) {
        expect(res.status).not.toBe(403);
      });
  });

  // -------------------------------------------------------------------------
  // (5) Post-rotation survival: NO API_SECRET_KEY configured at all — the
  // device-token kiosk path must still pass (T-46-18 — the whole point of
  // this migration).
  // -------------------------------------------------------------------------
  describe('post-rotation (API_SECRET_KEY unset)', function () {
    var OLD_API_SECRET_KEY, OLD_MW_API_KEY;

    beforeEach(function () {
      OLD_API_SECRET_KEY = process.env.API_SECRET_KEY;
      OLD_MW_API_KEY = process.env.MW_API_KEY;
      delete process.env.API_SECRET_KEY;
      delete process.env.MW_API_KEY;
    });

    afterEach(function () {
      process.env.API_SECRET_KEY = OLD_API_SECRET_KEY;
      process.env.MW_API_KEY = OLD_MW_API_KEY;
    });

    test('(5) GET /api/kiosk/salesorders with device token still passes with no legacy key configured', function () {
      return request(app)
        .get('/api/kiosk/salesorders')
        .set('x-device-token', DEVICE_TOKEN)
        .then(function (res) {
          expect([401, 403]).not.toContain(res.status);
        });
    });
  });

  // -------------------------------------------------------------------------
  // (6) GET regression — the exact bug class this plan closes: GET routes are
  // exempt from the global guard, so req.authTier is never set for them; the
  // in-route check must resolve its OWN tier.
  // -------------------------------------------------------------------------
  test('(6a) GET /api/kiosk/salesorders with valid x-device-token — not 401/403', function () {
    return request(app)
      .get('/api/kiosk/salesorders')
      .set('x-device-token', DEVICE_TOKEN)
      .then(function (res) {
        expect([401, 403]).not.toContain(res.status);
      });
  });

  test('(6b) GET /api/kiosk/salesorders with NO credential — 401 (requireTiers sync no-cred)', function () {
    return request(app)
      .get('/api/kiosk/salesorders')
      .then(function (res) {
        expect(res.status).toBe(401);
      });
  });

  // -------------------------------------------------------------------------
  // (7) BrewPad GET — session-only, device present-but-insufficient is 403
  // -------------------------------------------------------------------------
  test('(7a) GET /api/batch/search-invoices with a valid session cookie — not 403', function () {
    session.getSession.mockResolvedValueOnce({ email: 'staff@steinsandvines.ca' });
    return request(app)
      .get('/api/batch/search-invoices')
      .query({ search: 'INV-000123' })
      .set('Cookie', 'sv_session=valid-sid')
      .then(function (res) {
        expect(res.status).not.toBe(403);
      });
  });

  test('(7b) GET /api/batch/search-invoices with x-device-token present but not allowed — 403', function () {
    return request(app)
      .get('/api/batch/search-invoices')
      .query({ search: 'INV-000123' })
      .set('x-device-token', DEVICE_TOKEN)
      .then(function (res) {
        expect(res.status).toBe(403);
      });
  });

  // -------------------------------------------------------------------------
  // (8) Admin GET — device rejected, legacy/session accepted
  // -------------------------------------------------------------------------
  test('(8a) GET /api/orders/recent with x-device-token — 403 (admin GET rejects device)', function () {
    return request(app)
      .get('/api/orders/recent')
      .set('x-device-token', DEVICE_TOKEN)
      .then(function (res) {
        expect(res.status).toBe(403);
      });
  });

  test('(8b) GET /api/orders/recent with legacy x-api-key — not 403', function () {
    return request(app)
      .get('/api/orders/recent')
      .set('x-api-key', API_KEY)
      .then(function (res) {
        expect(res.status).not.toBe(403);
      });
  });

  test('(8c) GET /api/orders/recent with a valid session cookie — not 403', function () {
    session.getSession.mockResolvedValueOnce({ email: 'staff@steinsandvines.ca' });
    return request(app)
      .get('/api/orders/recent')
      .set('Cookie', 'sv_session=valid-sid')
      .then(function (res) {
        expect(res.status).not.toBe(403);
      });
  });
});
