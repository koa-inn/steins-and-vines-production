'use strict';

jest.mock('express', () => {
  var router = { get: jest.fn(), post: jest.fn() };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});
jest.mock('../lib/helcim', () => ({
  isEnabled: jest.fn().mockReturnValue(false),
  initializeCheckout: jest.fn(),
  getDepositAmount: jest.fn(),
  voidTransaction: jest.fn(),
  getTerminalDiagnostics: jest.fn().mockReturnValue({})
}));
jest.mock('../lib/zoho-api', () => ({
  zohoGet: jest.fn(),
  zohoPost: jest.fn()
}));
jest.mock('../lib/cache', () => ({
  get: jest.fn(),
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn()
}));
jest.mock('../lib/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));
jest.mock('../lib/eventLog', () => ({
  logEvent: jest.fn()
}));
jest.mock('../lib/mailer', () => ({
  sendVoidFailureAlert: jest.fn()
}));
jest.mock('../lib/inventory-ledger', () => ({
  decrementStock: jest.fn(),
  reconcileFromZoho: jest.fn()
}));
jest.mock('../lib/constants', () => ({
  CACHE_KEYS: {
    KIOSK_PRODUCTS: 'test:kiosk-products',
    RECENT_ORDERS: 'test:recent-orders',
    CONSIGNMENT_REPORT_PREFIX: 'test:consignment:report:'
  },
  LEDGER_KEYS: {},
  RATE_LIMIT_PREFIX: 'test:rl:'
}));

describe('pos routes — cache handling', () => {
  var cache, router, handlers;

  beforeEach(() => {
    jest.resetModules();
    cache = require('../lib/cache');
    require('../routes/pos');
    router = require('express').Router();
    handlers = {};
    router.get.mock.calls.forEach(function (call) {
      handlers[call[0]] = call[call.length - 1];
    });
  });

  function mockRes() {
    var res = { json: jest.fn(), status: jest.fn() };
    res.status.mockReturnValue(res);
    return res;
  }

  test('/api/kiosk/recent-orders returns cached data without double-parsing', async () => {
    var orders = [{ id: 'SO-001' }, { id: 'SO-002' }];
    cache.get.mockResolvedValue(orders);

    var res = mockRes();
    process.env.MW_API_KEY = 'test-key';
    var req = { query: {}, headers: { 'x-api-key': 'test-key' } };

    await new Promise(function (resolve) {
      res.json.mockImplementation(function () { resolve(); });
      handlers['/api/orders/recent'](req, res);
    });

    expect(res.json).toHaveBeenCalledWith({ orders: orders, cached: true });
    expect(Array.isArray(res.json.mock.calls[0][0].orders)).toBe(true);
  });
});
