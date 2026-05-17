'use strict';

// Mock dependencies before requiring the module
jest.mock('../lib/cache', function () {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(),
    del: jest.fn().mockResolvedValue(),
    isConnected: jest.fn().mockReturnValue(true),
    getClient: jest.fn().mockResolvedValue({
      keys: jest.fn().mockResolvedValue([])
    })
  };
});

jest.mock('../lib/logger', function () {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };
});

jest.mock('../lib/eventLog', function () {
  return {
    logEvent: jest.fn()
  };
});

jest.mock('axios');

var axios = require('axios');
var cache = require('../lib/cache');
var brewpadIntegration = require('../lib/brewpad-integration');

describe('brewpad-integration detectRecipeSale', function () {

  beforeEach(function () {
    jest.clearAllMocks();
    cache.isConnected.mockReturnValue(true);
    cache.get.mockResolvedValue(null);
    cache.set.mockResolvedValue();
    cache.del.mockResolvedValue();
    process.env.APPS_SCRIPT_URL = 'https://script.google.com/test';
    process.env.APPS_SCRIPT_SERVER_TOKEN = 'test-token';
  });

  afterEach(function () {
    delete process.env.APPS_SCRIPT_URL;
    delete process.env.APPS_SCRIPT_SERVER_TOKEN;
  });

  it('calls callAppsScriptCreateBatch with correct payload fields', function () {
    axios.post.mockResolvedValue({ data: { ok: true, batch_id: 'SV-B-000001' } });
    var snapshot = { name: 'Okanagan Merlot', style: 'Red Wine', abv: 12.5 };

    brewpadIntegration.detectRecipeSale('RCP-0001', snapshot, 'INV-001', 'Jane Doe', 'C-123');

    // Give the promise microtask a tick
    return new Promise(function (resolve) { setImmediate(resolve); }).then(function () {
      expect(axios.post).toHaveBeenCalledTimes(1);
      var callPayload = JSON.parse(axios.post.mock.calls[0][1]);
      expect(callPayload.source).toBe('kiosk_recipe');
      expect(callPayload.recipe_id).toBe('RCP-0001');
      expect(callPayload.recipe_snapshot).toBe(JSON.stringify(snapshot));
      expect(callPayload.zoho_so_number).toBe('INV-001');
      expect(callPayload.action).toBe('create_batch');
    });
  });

  it('creates exactly one batch even when recipeSnapshot has multiple ingredients', function () {
    axios.post.mockResolvedValue({ data: { ok: true, batch_id: 'SV-B-000002' } });
    var snapshot = {
      name: 'IPA',
      ingredients: [
        { name: 'Pale Malt', quantity: 5, unit: 'kg' },
        { name: 'Cascade Hops', quantity: 100, unit: 'g' },
        { name: 'Centennial Hops', quantity: 50, unit: 'g' },
        { name: 'Yeast US-05', quantity: 1, unit: 'pkg' },
        { name: 'Irish Moss', quantity: 5, unit: 'g' }
      ]
    };

    brewpadIntegration.detectRecipeSale('RCP-0002', snapshot, 'INV-002', 'Bob Smith', 'C-456');

    return new Promise(function (resolve) { setImmediate(resolve); }).then(function () {
      // Exactly ONE axios.post call regardless of 5 ingredients
      expect(axios.post).toHaveBeenCalledTimes(1);
    });
  });

  it('skips batch creation when recipeId is null', function () {
    axios.post.mockResolvedValue({ data: { ok: true, batch_id: 'SV-B-000003' } });

    brewpadIntegration.detectRecipeSale(null, {}, 'INV-003', 'Jane', 'C-1');

    return new Promise(function (resolve) { setImmediate(resolve); }).then(function () {
      expect(axios.post).not.toHaveBeenCalled();
    });
  });

  it('skips batch creation when recipeId is undefined', function () {
    axios.post.mockResolvedValue({ data: { ok: true, batch_id: 'SV-B-000004' } });

    brewpadIntegration.detectRecipeSale(undefined, {}, 'INV-004', 'Jane', 'C-1');

    return new Promise(function (resolve) { setImmediate(resolve); }).then(function () {
      expect(axios.post).not.toHaveBeenCalled();
    });
  });

  it('splits customer name correctly (Jane Doe -> firstname: Jane, lastname: Doe)', function () {
    axios.post.mockResolvedValue({ data: { ok: true, batch_id: 'SV-B-000005' } });
    var snapshot = { name: 'Merlot' };

    brewpadIntegration.detectRecipeSale('RCP-0001', snapshot, 'INV-005', 'Jane Doe', 'C-789');

    return new Promise(function (resolve) { setImmediate(resolve); }).then(function () {
      var callPayload = JSON.parse(axios.post.mock.calls[0][1]);
      expect(callPayload.customer_firstname).toBe('Jane');
      expect(callPayload.customer_lastname).toBe('Doe');
      expect(callPayload.customer_name).toBe('Jane Doe');
    });
  });

  it('uses Walk-in defaults when customerName is an empty string', function () {
    axios.post.mockResolvedValue({ data: { ok: true, batch_id: 'SV-B-000006' } });
    var snapshot = { name: 'Merlot' };

    brewpadIntegration.detectRecipeSale('RCP-0001', snapshot, 'INV-006', '', '');

    return new Promise(function (resolve) { setImmediate(resolve); }).then(function () {
      var callPayload = JSON.parse(axios.post.mock.calls[0][1]);
      expect(callPayload.customer_name).toBe('Walk-in Customer');
      expect(callPayload.customer_firstname).toBe('Walk-in');
      expect(callPayload.customer_lastname).toBe('Customer');
    });
  });

  it('does not throw when callAppsScriptCreateBatch rejects (fire-and-forget per D-12)', function () {
    axios.post.mockRejectedValue(new Error('Apps Script timeout'));

    // Should NOT throw — failure is silently swallowed
    expect(function () {
      brewpadIntegration.detectRecipeSale('RCP-0001', { name: 'Merlot' }, 'INV-007', 'Jane', 'C-1');
    }).not.toThrow();

    // Wait for async rejection to settle without propagating
    return new Promise(function (resolve) { setTimeout(resolve, 50); }).then(function () {
      // No unhandled promise rejection should have occurred
      expect(axios.post).toHaveBeenCalledTimes(1);
    });
  });

  it('uses recipeId as product_name fallback when recipeSnapshot has no name', function () {
    axios.post.mockResolvedValue({ data: { ok: true, batch_id: 'SV-B-000007' } });

    brewpadIntegration.detectRecipeSale('RCP-0001', { ingredients: [] }, 'INV-008', 'Jane', 'C-1');

    return new Promise(function (resolve) { setImmediate(resolve); }).then(function () {
      var callPayload = JSON.parse(axios.post.mock.calls[0][1]);
      expect(callPayload.product_name).toBe('RCP-0001');
    });
  });

  it('uses recipeSnapshot.name as product_name when available', function () {
    axios.post.mockResolvedValue({ data: { ok: true, batch_id: 'SV-B-000008' } });
    var snapshot = { name: 'Grand Cru Shiraz', style: 'Red Wine' };

    brewpadIntegration.detectRecipeSale('RCP-0001', snapshot, 'INV-009', 'Bob', 'C-2');

    return new Promise(function (resolve) { setImmediate(resolve); }).then(function () {
      var callPayload = JSON.parse(axios.post.mock.calls[0][1]);
      expect(callPayload.product_name).toBe('Grand Cru Shiraz');
    });
  });

});
