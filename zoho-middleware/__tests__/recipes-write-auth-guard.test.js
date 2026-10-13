'use strict';

// Recipe writes (POST/PUT/DELETE /api/recipes*) carry no in-route auth check;
// they rely entirely on the global 3-tier /api guard in server.js. This pins
// that dependency: an anonymous or kiosk-device caller is refused with 403 and
// never reaches the recipe store. A handoff (2026-10-13) reported an anonymous
// POST returning 422; live probes on staging and production both return 403,
// so that observation was most likely made with a staff session attached.
//
// Mock roster copied from __tests__/auth-tiers-guard.test.js (full app via
// supertest), plus a recipe-store spy.

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


jest.mock('../lib/recipe-store', function () {
  return {
    getMode: jest.fn().mockReturnValue('sheets'),
    isConfigured: jest.fn().mockReturnValue(true),
    list: jest.fn().mockResolvedValue([]),
    get: jest.fn().mockResolvedValue(null),
    getFromSheet: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ ok: true, recipe_id: 'SV-R-999999' }),
    update: jest.fn().mockResolvedValue({ ok: true }),
    remove: jest.fn().mockResolvedValue({ ok: true }),
    hasBatchReferences: jest.fn().mockResolvedValue(false)
  };
});

process.env.API_SECRET_KEY = 'integration-secret';
process.env.MW_API_KEY = 'integration-secret';
process.env.KIOSK_DEVICE_TOKEN = 'integration-device-token';

var request = require('supertest');
var app = require('../server');
var session = require('../lib/session');
var recipeStore = require('../lib/recipe-store');

var DEVICE_TOKEN = 'integration-device-token';
var PAYLOAD = { name: 'Probe Recipe', status: 'draft', ingredients: [] };

var WRITES = [
  { method: 'post', path: '/api/recipes' },
  { method: 'put', path: '/api/recipes/SV-R-000002' },
  { method: 'delete', path: '/api/recipes/SV-R-000002' },
  { method: 'post', path: '/api/recipes/bust-cache' }
];

describe('recipe write routes require a staff credential', function () {
  beforeEach(function () {
    session.getSession.mockReset();
    session.getSession.mockResolvedValue(null);
    recipeStore.create.mockClear();
    recipeStore.update.mockClear();
    recipeStore.remove.mockClear();
  });

  WRITES.forEach(function (w) {
    test(w.method.toUpperCase() + ' ' + w.path + ' with no credential — 403, store untouched', function () {
      return request(app)[w.method](w.path).send(PAYLOAD).then(function (res) {
        expect(res.status).toBe(403);
        expect(recipeStore.create).not.toHaveBeenCalled();
        expect(recipeStore.update).not.toHaveBeenCalled();
        expect(recipeStore.remove).not.toHaveBeenCalled();
      });
    });

    test(w.method.toUpperCase() + ' ' + w.path + ' with a kiosk device token — 403', function () {
      return request(app)[w.method](w.path).set('x-device-token', DEVICE_TOKEN).send(PAYLOAD).then(function (res) {
        expect(res.status).toBe(403);
      });
    });
  });

  test('POST /api/recipes with a staff session reaches the store (guard is not over-blocking)', function () {
    session.getSession.mockResolvedValue({ email: 'staff@steinsandvines.ca' });
    process.env.STAFF_EMAILS = 'staff@steinsandvines.ca';
    return request(app).post('/api/recipes').set('Cookie', 'sv_session=valid-sid').send(PAYLOAD).then(function (res) {
      expect(res.status).toBe(201);
      expect(recipeStore.create).toHaveBeenCalledTimes(1);
    });
  });
});
