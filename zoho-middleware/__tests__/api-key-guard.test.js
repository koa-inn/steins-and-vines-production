'use strict';

// Regression tests for the #2 API-key hardening:
//   - the key must come from the x-api-key HEADER only (never ?api_key= in URL)
//   - the key resolves the UNIFIED env pair (API_SECRET_KEY || MW_API_KEY)
//   - comparison is constant-time and length-safe
//
// Before the fix, the admin GET routes did
//   `req.headers['x-api-key'] || req.query.api_key !== process.env.MW_API_KEY`
// which (a) accepted the secret in the URL and (b) only checked MW_API_KEY.

var apiKey = require('../lib/apiKey');

// ---------------------------------------------------------------------------
// Route-level mocks for the supertest integration block below. Must be
// declared before the app require. Mirrors pii-access.test.js.
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

// Set BOTH halves of the unified pair to the same value at require time so the
// global guard captures a key, and pin them again per-test so cross-file
// process.env bleed (other suites set API_SECRET_KEY) can't make this flaky.
process.env.API_SECRET_KEY = 'integration-secret';
process.env.MW_API_KEY = 'integration-secret';

var request = require('supertest');
var app = require('../server');

describe('GET /api/orders/recent — header-only key (URL key exploit closed)', function () {
  var KEY = 'integration-secret';
  var savedSecret, savedAlias;

  beforeEach(function () {
    savedSecret = process.env.API_SECRET_KEY;
    savedAlias = process.env.MW_API_KEY;
    process.env.API_SECRET_KEY = KEY;
    process.env.MW_API_KEY = KEY;
  });

  afterEach(function () {
    if (savedSecret === undefined) delete process.env.API_SECRET_KEY;
    else process.env.API_SECRET_KEY = savedSecret;
    if (savedAlias === undefined) delete process.env.MW_API_KEY;
    else process.env.MW_API_KEY = savedAlias;
  });

  test('rejects the key supplied as a ?api_key= query param', function () {
    return request(app)
      .get('/api/orders/recent?api_key=' + KEY)
      .then(function (res) {
        expect([401, 403]).toContain(res.status);
      });
  });

  test('accepts the key supplied via the x-api-key header', function () {
    return request(app)
      .get('/api/orders/recent')
      .set('x-api-key', KEY)
      .then(function (res) {
        expect([401, 403]).not.toContain(res.status);
      });
  });

  test('rejects a missing key', function () {
    return request(app)
      .get('/api/orders/recent')
      .then(function (res) {
        expect([401, 403]).toContain(res.status);
      });
  });
});

describe('lib/apiKey — unified, header-only key guard', function () {
  var savedSecret, savedAlias;

  beforeEach(function () {
    savedSecret = process.env.API_SECRET_KEY;
    savedAlias = process.env.MW_API_KEY;
    delete process.env.API_SECRET_KEY;
    delete process.env.MW_API_KEY;
  });

  afterEach(function () {
    if (savedSecret === undefined) delete process.env.API_SECRET_KEY;
    else process.env.API_SECRET_KEY = savedSecret;
    if (savedAlias === undefined) delete process.env.MW_API_KEY;
    else process.env.MW_API_KEY = savedAlias;
  });

  test('matches the primary API_SECRET_KEY', function () {
    process.env.API_SECRET_KEY = 'super-secret';
    expect(apiKey.matches('super-secret')).toBe(true);
  });

  test('matches the legacy MW_API_KEY alias when API_SECRET_KEY is unset', function () {
    process.env.MW_API_KEY = 'legacy-secret';
    expect(apiKey.matches('legacy-secret')).toBe(true);
  });

  test('API_SECRET_KEY takes precedence over MW_API_KEY', function () {
    process.env.API_SECRET_KEY = 'primary';
    process.env.MW_API_KEY = 'legacy';
    expect(apiKey.matches('primary')).toBe(true);
    expect(apiKey.matches('legacy')).toBe(false);
  });

  test('rejects a wrong key', function () {
    process.env.API_SECRET_KEY = 'right';
    expect(apiKey.matches('wrong')).toBe(false);
  });

  test('rejects a key of a different length (no buffer crash)', function () {
    process.env.API_SECRET_KEY = 'longer-secret';
    expect(apiKey.matches('x')).toBe(false);
  });

  test('rejects non-string input (e.g. undefined header, query object)', function () {
    process.env.API_SECRET_KEY = 'right';
    expect(apiKey.matches(undefined)).toBe(false);
    expect(apiKey.matches(null)).toBe(false);
    expect(apiKey.matches(['right'])).toBe(false);
    expect(apiKey.matches({ api_key: 'right' })).toBe(false);
  });

  test('rejects everything when no key is configured (fail closed)', function () {
    expect(apiKey.matches('')).toBe(false);
    expect(apiKey.matches('anything')).toBe(false);
  });

  test('getKey resolves the unified pair', function () {
    process.env.MW_API_KEY = 'alias-only';
    expect(apiKey.getKey()).toBe('alias-only');
    process.env.API_SECRET_KEY = 'primary';
    expect(apiKey.getKey()).toBe('primary');
  });
});
