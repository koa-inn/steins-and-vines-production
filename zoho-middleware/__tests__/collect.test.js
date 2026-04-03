'use strict';

// ---------------------------------------------------------------------------
// Mocks — must be declared before require()
// ---------------------------------------------------------------------------
jest.mock('../lib/helcim', function () { return {
  isTerminalEnabled: jest.fn().mockReturnValue(true),
  terminalPurchase: jest.fn().mockResolvedValue({ ok: true }),
  generateIdempotencyKey: jest.fn().mockReturnValue('test-idem-key-12345')
}; });

jest.mock('../lib/zoho-api', function () { return {
  zohoGet: jest.fn(),
  zohoPost: jest.fn(),
  zohoPut: jest.fn()
}; });

jest.mock('../lib/cache', function () { return {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  isConnected: jest.fn().mockReturnValue(true)
}; });

jest.mock('../lib/eventLog', function () { return {
  logEvent: jest.fn()
}; });

jest.mock('../lib/logger', function () { return {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}; });

var helcimLib = require('../lib/helcim');
var zohoApi = require('../lib/zoho-api');
var cache = require('../lib/cache');

// ---------------------------------------------------------------------------
// Helpers — fake req/res for handler testing
// ---------------------------------------------------------------------------
// Extract the route handler from express.Router().post('/api/pos/collect', handler)
var handler;

jest.mock('express', function () {
  var router = {
    get: jest.fn(),
    post: jest.fn()
  };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});

var express = require('express');
// Requiring the route registers the handler on the mocked router
require('../routes/collect');
// The first call to router.post is our route
handler = express.Router().post.mock.calls[0][1];

function makeReq(body) {
  return { body: body || {} };
}

function makeRes() {
  var res = {
    _status: null,
    _json: null,
    headersSent: false
  };
  res.status = jest.fn(function (code) {
    res._status = code;
    return res;
  });
  res.json = jest.fn(function (data) {
    res._json = data;
    res.headersSent = true;
    return res;
  });
  return res;
}

// Flush all pending promise callbacks
function flushPromises() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('POST /api/pos/collect', function () {
  beforeEach(function () {
    jest.clearAllMocks();
    // Reset default happy-path mocks
    helcimLib.isTerminalEnabled.mockReturnValue(true);
    helcimLib.terminalPurchase.mockResolvedValue({ ok: true });
    helcimLib.generateIdempotencyKey.mockReturnValue('test-idem-key-12345');
    cache.get.mockResolvedValue(null);
    cache.set.mockResolvedValue('OK');
    cache.del.mockResolvedValue(1);
  });

  // 1. Happy path
  test('valid SO with balance → calls terminalPurchase and returns 202', function () {
    zohoApi.zohoGet.mockResolvedValue({
      salesorder: {
        salesorder_id: 'SO123',
        salesorder_number: 'SO-001',
        balance: 45.50,
        status: 'confirmed',
        customer_id: 'CUST1'
      }
    });

    var req = makeReq({ salesorder_id: 'SO123' });
    var res = makeRes();

    handler(req, res);

    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(202);
      expect(res._json).toEqual(expect.objectContaining({
        message: 'Payment sent to terminal',
        salesorder_number: 'SO-001',
        amount: 45.50,
        status: 'pending'
      }));
      expect(helcimLib.terminalPurchase).toHaveBeenCalledWith(
        45.50, 'SO-001', 'test-idem-key-12345'
      );
      // Idempotency key cached
      expect(cache.set).toHaveBeenCalledWith(
        expect.stringContaining('SO123'),
        'test-idem-key-12345',
        300
      );
      // Pending context cached
      expect(cache.set).toHaveBeenCalledWith(
        expect.stringContaining('SO-001'),
        expect.objectContaining({
          salesorder_id: 'SO123',
          salesorder_number: 'SO-001',
          customer_id: 'CUST1',
          amount: 45.50
        }),
        600
      );
    });
  });

  // 2. Missing salesorder_id
  test('missing salesorder_id → 400', function () {
    var req = makeReq({});
    var res = makeRes();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._json.error).toMatch(/salesorder_id/i);
  });

  // 3. Balance is zero
  test('SO with zero balance → 400', function () {
    zohoApi.zohoGet.mockResolvedValue({
      salesorder: {
        salesorder_id: 'SO123',
        salesorder_number: 'SO-001',
        balance: 0,
        status: 'confirmed',
        customer_id: 'CUST1'
      }
    });

    var req = makeReq({ salesorder_id: 'SO123' });
    var res = makeRes();

    handler(req, res);

    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.error).toMatch(/balance/i);
    });
  });

  // 4. SO status is void
  test('void SO → 400', function () {
    zohoApi.zohoGet.mockResolvedValue({
      salesorder: {
        salesorder_id: 'SO123',
        salesorder_number: 'SO-001',
        balance: 50,
        status: 'void',
        customer_id: 'CUST1'
      }
    });

    var req = makeReq({ salesorder_id: 'SO123' });
    var res = makeRes();

    handler(req, res);

    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.error).toMatch(/void/i);
    });
  });

  // 5. SO not found (404 from Zoho)
  test('Zoho returns 404 → 404', function () {
    var err = new Error('Not found');
    err.response = { status: 404 };
    zohoApi.zohoGet.mockRejectedValue(err);

    var req = makeReq({ salesorder_id: 'SO-MISSING' });
    var res = makeRes();

    handler(req, res);

    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res._json.error).toMatch(/not found/i);
    });
  });

  // 6. Terminal not configured
  test('terminal not enabled → 503', function () {
    helcimLib.isTerminalEnabled.mockReturnValue(false);

    var req = makeReq({ salesorder_id: 'SO123' });
    var res = makeRes();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res._json.error).toMatch(/terminal/i);
  });

  // 7. Double-click / idempotency guard
  test('idempotency key already exists → 409', function () {
    cache.get.mockResolvedValue('existing-idem-key');

    var req = makeReq({ salesorder_id: 'SO123' });
    var res = makeRes();

    handler(req, res);

    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res._json.error).toMatch(/already/i);
    });
  });

  // 8. terminalPurchase fails
  test('terminalPurchase rejects → 502 and cleans up idem key', function () {
    zohoApi.zohoGet.mockResolvedValue({
      salesorder: {
        salesorder_id: 'SO123',
        salesorder_number: 'SO-001',
        balance: 100,
        status: 'confirmed',
        customer_id: 'CUST1'
      }
    });
    helcimLib.terminalPurchase.mockRejectedValue(new Error('Terminal offline'));

    var req = makeReq({ salesorder_id: 'SO123' });
    var res = makeRes();

    handler(req, res);

    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(502);
      expect(cache.del).toHaveBeenCalledWith(expect.stringContaining('SO123'));
    });
  });

  // 9. Zoho API failure (non-404)
  test('zohoGet rejects with non-404 → 502 and cleans up idem key', function () {
    var err = new Error('Service unavailable');
    err.response = { status: 500 };
    zohoApi.zohoGet.mockRejectedValue(err);

    var req = makeReq({ salesorder_id: 'SO-ERR' });
    var res = makeRes();

    handler(req, res);

    return flushPromises().then(function () {
      expect(res.status).toHaveBeenCalledWith(502);
      expect(cache.del).toHaveBeenCalledWith(expect.stringContaining('SO-ERR'));
    });
  });
});
