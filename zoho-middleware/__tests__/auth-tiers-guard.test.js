'use strict';

// Integration tests for the 3-tier /api guard (D-46-02, D-46-06, D-46-10,
// D-46-11) — legacy key / kiosk device token / session cookie, all valid
// simultaneously during the dual-accept window.
//
// Mirrors __tests__/api-key-guard.test.js's mock roster (full app require via
// supertest), extended with mocks for lib/session and lib/deviceToken so each
// tier's outcome is directly controllable per test.

// ---------------------------------------------------------------------------
// Mocks — must be declared before the app require. Mirrors api-key-guard.test.js
// / pii-access.test.js.
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
  return { init: jest.fn(), setupExpressErrorHandler: jest.fn() };
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
    zohoGet: jest.fn().mockResolvedValue({ salesorders: [] }),
    zohoPut: jest.fn().mockResolvedValue({}),
    inventoryGet: jest.fn().mockResolvedValue({}),
    inventoryPut: jest.fn().mockResolvedValue({}),
    ZOHO_INVENTORY_BASE: 'https://inventory.zoho.com/api/v1'
  };
});
jest.mock('axios', function () { return { post: jest.fn().mockResolvedValue({ data: { ok: true } }) }; });

// lib/session — mock-mirrors-real-contract: getSession(sid) -> Promise<{email}|null>.
// Controllable per test via mockResolvedValueOnce / mockRejectedValueOnce so the
// fail-closed (rejection) path can be exercised without a real Redis/cache.
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

// Set env before requiring the app so the guard captures credentials.
process.env.API_SECRET_KEY = 'integration-secret';
process.env.MW_API_KEY = 'integration-secret';
process.env.KIOSK_DEVICE_TOKEN = 'integration-device-token';

var request = require('supertest');
var app = require('../server');
var session = require('../lib/session');

var API_KEY = 'integration-secret';
var DEVICE_TOKEN = 'integration-device-token';

describe('3-tier /api guard — dual-accept (legacy / device / session)', function () {
  beforeEach(function () {
    session.getSession.mockReset();
    session.getSession.mockResolvedValue(null);
  });

  test('(1) legacy x-api-key on a mutating route — dual-accept, not 401/403', function () {
    return request(app)
      .post('/api/kiosk/verify-pin')
      .set('x-api-key', API_KEY)
      .send({ pin: '0000' })
      .then(function (res) {
        expect([401, 403]).not.toContain(res.status);
      });
  });

  test('(2) valid x-device-token on a kiosk-scoped route (verify-pin) — not 403', function () {
    return request(app)
      .post('/api/kiosk/verify-pin')
      .set('x-device-token', DEVICE_TOKEN)
      .send({ pin: '0000' })
      .then(function (res) {
        expect(res.status).not.toBe(403);
      });
  });

  test('(3) valid x-device-token on an admin-grade route (gift-card/void) — 403 (device rejected)', function () {
    return request(app)
      .post('/api/kiosk/gift-card/void')
      .set('x-device-token', DEVICE_TOKEN)
      .send({ cert_number: 'GC-000042', reason: 'test' })
      .then(function (res) {
        expect(res.status).toBe(403);
      });
  });

  test('(4) valid session cookie on an admin-grade route (gift-card/void) — not 403', function () {
    session.getSession.mockResolvedValueOnce({ email: 'staff@steinsandvines.ca' });
    return request(app)
      .post('/api/kiosk/gift-card/void')
      .set('Cookie', 'sv_session=valid-sid')
      .send({ cert_number: 'GC-000042', reason: 'test' })
      .then(function (res) {
        expect(res.status).not.toBe(403);
      });
  });

  test('(5) no credential on a mutating route — 403', function () {
    return request(app)
      .post('/api/kiosk/gift-card/void')
      .send({ cert_number: 'GC-000042', reason: 'test' })
      .then(function (res) {
        expect(res.status).toBe(403);
      });
  });

  test('(6) public POST /api/bookings with NO credential — not 403 (keyless exemption)', function () {
    return request(app)
      .post('/api/bookings')
      .send({})
      .then(function (res) {
        expect(res.status).not.toBe(403);
      });
  });

  test('(7a) PII GET route /api/contacts with device token only — 403', function () {
    return request(app)
      .get('/api/contacts')
      .query({ email: 'a@b.com' })
      .set('x-device-token', DEVICE_TOKEN)
      .then(function (res) {
        expect(res.status).toBe(403);
      });
  });

  test('(7b) PII GET route /api/contacts with a valid session — not 403', function () {
    session.getSession.mockResolvedValueOnce({ email: 'staff@steinsandvines.ca' });
    return request(app)
      .get('/api/contacts')
      .query({ email: 'a@b.com' })
      .set('Cookie', 'sv_session=valid-sid')
      .then(function (res) {
        expect(res.status).not.toBe(403);
      });
  });

  test('(8) fail-closed: a session-lookup rejection yields 403, never a pass-through', function () {
    session.getSession.mockRejectedValueOnce(new Error('redis unreachable'));
    return request(app)
      .post('/api/kiosk/gift-card/void')
      .set('Cookie', 'sv_session=some-sid')
      .send({ cert_number: 'GC-000042', reason: 'test' })
      .then(function (res) {
        expect(res.status).toBe(403);
      });
  });
});
