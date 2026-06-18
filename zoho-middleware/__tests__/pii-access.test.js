'use strict';

// ---------------------------------------------------------------------------
// Mocks — must be declared before any require()
// External services: Zoho, Helcim, Redis/cache, mailer, axios stay mocked.
// express is NOT mocked — real app must be wired for supertest.
// ---------------------------------------------------------------------------

jest.mock('../lib/zohoAuth', function () {
  return {
    init: jest.fn().mockResolvedValue(),
    isAuthenticated: jest.fn().mockReturnValue(true)
  };
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
jest.mock('../lib/eventLog', function () {
  return { logEvent: jest.fn() };
});
jest.mock('../lib/inventory-ledger', function () {
  return { decrementStock: jest.fn().mockResolvedValue() };
});

jest.mock('../lib/helcim', function () {
  return {
    isEnabled: jest.fn().mockReturnValue(true),
    initializeCheckout: jest.fn().mockResolvedValue({ checkoutToken: 'tok-test-123' }),
    getDepositAmount: jest.fn().mockReturnValue(10000),
    voidTransaction: jest.fn().mockResolvedValue({ ok: true, transactionId: 'txn-mock' }),
    getTerminalDiagnostics: jest.fn().mockReturnValue({}),
    getDeviceCode: jest.fn().mockReturnValue(''),
    init: jest.fn(),
    verifyWebhookSignature: jest.fn().mockReturnValue(true)
  };
});
jest.mock('../lib/zoho-api', function () {
  return {
    zohoPost: jest.fn().mockResolvedValue({ item: { item_id: 'ITEM-1' } }),
    zohoGet: jest.fn().mockResolvedValue({}),
    inventoryGet: jest.fn().mockResolvedValue({}),
    inventoryPut: jest.fn().mockResolvedValue({}),
    ZOHO_INVENTORY_BASE: 'https://inventory.zoho.com/api/v1'
  };
});
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
jest.mock('../lib/mailer', function () {
  return {
    sendReservationNotification: jest.fn().mockResolvedValue(),
    sendOfflineOrderNotification: jest.fn().mockResolvedValue(),
    sendVoidFailureAlert: jest.fn().mockResolvedValue(),
    sendCustomerConfirmation: jest.fn().mockResolvedValue()
  };
});
jest.mock('axios', function () {
  return { post: jest.fn().mockResolvedValue({ data: { ok: true } }) };
});

// ---------------------------------------------------------------------------
// Set env vars before requiring app
// ---------------------------------------------------------------------------
process.env.API_SECRET_KEY = 'test-secret-key';

var request = require('supertest');
var app = require('../server');
var zohoApi = require('../lib/zoho-api');

// ---------------------------------------------------------------------------
// PII-01: Targeted API-key guard on 4 PII GET routes
// ---------------------------------------------------------------------------

describe('PII-01: targeted API-key guard on PII GET routes', function () {
  var VALID_KEY = 'test-secret-key';

  describe('GET /api/contacts', function () {
    test('returns 401 or 403 without x-api-key', function () {
      return request(app)
        .get('/api/contacts')
        .then(function (res) {
          expect([401, 403]).toContain(res.status);
        });
    });

    test('returns 401 or 403 even when a valid Referer is present', function () {
      return request(app)
        .get('/api/contacts')
        .set('Referer', 'https://steinsandvines.ca/admin.html')
        .then(function (res) {
          expect([401, 403]).toContain(res.status);
        });
    });

    test('reaches handler (200) with a valid x-api-key', function () {
      return request(app)
        .get('/api/contacts')
        .set('x-api-key', VALID_KEY)
        .then(function (res) {
          expect(res.status).toBe(200);
        });
    });
  });

  describe('GET /api/invoices', function () {
    test('returns 401 or 403 without x-api-key', function () {
      return request(app)
        .get('/api/invoices')
        .then(function (res) {
          expect([401, 403]).toContain(res.status);
        });
    });

    test('returns 401 or 403 even when a valid Referer is present', function () {
      return request(app)
        .get('/api/invoices')
        .set('Referer', 'https://steinsandvines.ca/admin.html')
        .then(function (res) {
          expect([401, 403]).toContain(res.status);
        });
    });

    test('reaches handler (200) with a valid x-api-key', function () {
      return request(app)
        .get('/api/invoices')
        .set('x-api-key', VALID_KEY)
        .then(function (res) {
          expect(res.status).toBe(200);
        });
    });
  });

  describe('GET /api/items/inspect', function () {
    test('returns 401 or 403 without x-api-key', function () {
      return request(app)
        .get('/api/items/inspect')
        .then(function (res) {
          expect([401, 403]).toContain(res.status);
        });
    });

    test('returns 401 or 403 even when a valid Referer is present', function () {
      return request(app)
        .get('/api/items/inspect')
        .set('Referer', 'https://steinsandvines.ca/admin.html')
        .then(function (res) {
          expect([401, 403]).toContain(res.status);
        });
    });

    test('reaches handler (status not 401/403) with a valid x-api-key', function () {
      return request(app)
        .get('/api/items/inspect')
        .set('x-api-key', VALID_KEY)
        .then(function (res) {
          expect([401, 403]).not.toContain(res.status);
        });
    });
  });

  describe('GET /api/snapshot', function () {
    test('returns 401 or 403 without x-api-key', function () {
      return request(app)
        .get('/api/snapshot')
        .then(function (res) {
          expect([401, 403]).toContain(res.status);
        });
    });

    test('returns 401 or 403 even when a valid Referer is present', function () {
      return request(app)
        .get('/api/snapshot')
        .set('Referer', 'https://steinsandvines.ca/admin.html')
        .then(function (res) {
          expect([401, 403]).toContain(res.status);
        });
    });

    test('reaches handler (status not 401/403) with a valid x-api-key', function () {
      return request(app)
        .get('/api/snapshot')
        .set('x-api-key', VALID_KEY)
        .then(function (res) {
          expect([401, 403]).not.toContain(res.status);
        });
    });
  });

  describe('Public GET routes remain accessible without API key (NOT caught by PII guard)', function () {
    test('GET /api/products returns 200 without x-api-key', function () {
      return request(app)
        .get('/api/products')
        .then(function (res) {
          // Public route — must not be 401/403 due to the new PII guard
          expect([401, 403]).not.toContain(res.status);
        });
    });

    test('GET /api/ingredients returns 200 without x-api-key', function () {
      return request(app)
        .get('/api/ingredients')
        .then(function (res) {
          expect([401, 403]).not.toContain(res.status);
        });
    });
  });

  describe('GET /api/contacts/search is NOT caught by the exact-match PII guard', function () {
    // /api/contacts/search is a different path (pos.js) — the exact-match guard
    // only targets /api/contacts, not /api/contacts/search
    test('GET /api/contacts/search is not blocked by the PII key guard', function () {
      return request(app)
        .get('/api/contacts/search')
        .then(function (res) {
          // Should not get a 403 from the PII guard
          // (may get other errors from the actual handler without proper params, but not PII guard)
          expect(res.status).not.toBe(403);
        });
    });
  });
});

// ---------------------------------------------------------------------------
// PII-02: Body-shape validation on mutating item/tax routes
// ---------------------------------------------------------------------------

describe('PII-02: body-shape validation on mutating routes', function () {
  var VALID_KEY = 'test-secret-key';

  describe('POST /api/items', function () {
    beforeEach(function () {
      zohoApi.zohoPost.mockClear();
    });

    test('returns 400 and does NOT call zohoPost when name is missing', function () {
      return request(app)
        .post('/api/items')
        .set('x-api-key', VALID_KEY)
        .send({ sku: 'TEST-SKU', rate: 10 })
        .then(function (res) {
          expect(res.status).toBe(400);
          expect(zohoApi.zohoPost).not.toHaveBeenCalled();
        });
    });

    test('returns 400 and does NOT call zohoPost when body is not an object', function () {
      return request(app)
        .post('/api/items')
        .set('x-api-key', VALID_KEY)
        .set('Content-Type', 'application/json')
        .send('"just-a-string"')
        .then(function (res) {
          expect(res.status).toBe(400);
          expect(zohoApi.zohoPost).not.toHaveBeenCalled();
        });
    });

    test('calls zohoPost with only whitelisted fields when valid body provided', function () {
      var body = {
        name: 'Test Wine Kit',
        sku: 'WK-001',
        rate: 79.99,
        unknown_field: 'should-be-stripped',
        __proto__: 'evil'
      };
      return request(app)
        .post('/api/items')
        .set('x-api-key', VALID_KEY)
        .send(body)
        .then(function (res) {
          expect(res.status).toBe(201);
          expect(zohoApi.zohoPost).toHaveBeenCalledTimes(1);
          var sentBody = zohoApi.zohoPost.mock.calls[0][1];
          // Must have valid fields
          expect(sentBody.name).toBe('Test Wine Kit');
          expect(sentBody.sku).toBe('WK-001');
          // Must NOT have unknown fields
          expect(sentBody.unknown_field).toBeUndefined();
        });
    });

    test('returns 400 when rate is not a number', function () {
      return request(app)
        .post('/api/items')
        .set('x-api-key', VALID_KEY)
        .send({ name: 'Widget', rate: { nested: 'object' } })
        .then(function (res) {
          expect(res.status).toBe(400);
          expect(zohoApi.zohoPost).not.toHaveBeenCalled();
        });
    });
  });

  describe('PUT /api/inventory/items/:id', function () {
    beforeEach(function () {
      zohoApi.inventoryPut.mockClear();
    });

    test('returns 400 when body is not an object', function () {
      return request(app)
        .put('/api/inventory/items/ITEM-123')
        .set('x-api-key', VALID_KEY)
        .set('Content-Type', 'application/json')
        .send('"bad-string"')
        .then(function (res) {
          expect(res.status).toBe(400);
          expect(zohoApi.inventoryPut).not.toHaveBeenCalled();
        });
    });

    test('calls inventoryPut with whitelisted fields only on valid partial body', function () {
      var body = {
        rate: 25.00,
        status: 'active',
        unknown_key: 'drop-me'
      };
      return request(app)
        .put('/api/inventory/items/ITEM-123')
        .set('x-api-key', VALID_KEY)
        .send(body)
        .then(function (res) {
          expect([200, 201]).toContain(res.status);
          expect(zohoApi.inventoryPut).toHaveBeenCalledTimes(1);
          var sentBody = zohoApi.inventoryPut.mock.calls[0][1];
          expect(sentBody.rate).toBe(25.00);
          expect(sentBody.status).toBe('active');
          expect(sentBody.unknown_key).toBeUndefined();
        });
    });

    test('returns 400 when rate field is not a number', function () {
      return request(app)
        .put('/api/inventory/items/ITEM-123')
        .set('x-api-key', VALID_KEY)
        .send({ rate: 'not-a-number' })
        .then(function (res) {
          expect(res.status).toBe(400);
          expect(zohoApi.inventoryPut).not.toHaveBeenCalled();
        });
    });
  });

  describe('POST /api/taxes/apply', function () {
    test('returns 400 when body is not an object', function () {
      return request(app)
        .post('/api/taxes/apply')
        .set('x-api-key', VALID_KEY)
        .set('Content-Type', 'application/json')
        .send('"not-an-object"')
        .then(function (res) {
          expect(res.status).toBe(400);
        });
    });

    test('proceeds when body is { apply: true }', function () {
      return request(app)
        .post('/api/taxes/apply')
        .set('x-api-key', VALID_KEY)
        .send({ apply: true })
        .then(function (res) {
          // Should proceed past validation (actual result depends on Zoho mock)
          expect([200, 201, 502]).toContain(res.status);
        });
    });

    test('proceeds when body is {} (dry run)', function () {
      return request(app)
        .post('/api/taxes/apply')
        .set('x-api-key', VALID_KEY)
        .send({})
        .then(function (res) {
          // Empty object is a valid object — dry run mode
          expect([200, 201, 502]).toContain(res.status);
        });
    });
  });
});
