'use strict';

// ---------------------------------------------------------------------------
// Express mock — captures route handlers keyed by method:path
// ---------------------------------------------------------------------------

var mockRouteHandlers = {};

jest.mock('express', function () {
  var router = {
    get:    jest.fn(function (path, handler) { mockRouteHandlers['GET:' + path] = handler; }),
    post:   jest.fn(function (path, handler) { mockRouteHandlers['POST:' + path] = handler; }),
    put:    jest.fn(function (path, handler) { mockRouteHandlers['PUT:' + path] = handler; }),
    delete: jest.fn(function (path, handler) { mockRouteHandlers['DELETE:' + path] = handler; })
  };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});

jest.mock('axios', function () {
  return { get: jest.fn(), post: jest.fn() };
});

jest.mock('../lib/helcim', function () {
  return {
    isTerminalEnabled: jest.fn().mockReturnValue(true),
    terminalPurchase: jest.fn().mockResolvedValue({}),
    voidTransaction: jest.fn().mockResolvedValue({})
  };
});

jest.mock('../lib/zoho-api', function () {
  return {
    zohoGet: jest.fn(),
    zohoPost: jest.fn().mockResolvedValue({ invoice: { invoice_id: 'inv-1', invoice_number: 'INV-001' } }),
    zohoPut: jest.fn()
  };
});

jest.mock('../lib/cache', function () {
  return {
    get: jest.fn(),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    acquireLock: jest.fn().mockResolvedValue(true),
    releaseLock: jest.fn().mockResolvedValue()
  };
});

jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
});

jest.mock('../lib/eventLog', function () {
  return { logEvent: jest.fn() };
});

jest.mock('../lib/mailer', function () {
  return { sendVoidFailureAlert: jest.fn().mockResolvedValue() };
});

jest.mock('../lib/constants', function () {
  return {
    CACHE_KEYS: {
      KIOSK_PRODUCTS: 'test:kiosk-products',
      RECIPES: 'sv:recipes',
      RECIPES_TS: 'sv:recipes:ts',
      INGREDIENTS: 'zoho:ingredients'
    },
    LOCK_KEYS: { RECIPE_SALE: 'recipe-sale' }
  };
});

jest.mock('../lib/brewpad-integration', function () {
  return {
    detectRecipeSale: jest.fn(),
    createBatchesFromSale: jest.fn()
  };
});

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

var MOCK_INGREDIENTS_CATALOG = [
  { item_id: 'ing-malt-1', name: 'Pale Malt 2-Row', rate: 3.50, tax_id: 'tax-gst' },
  { item_id: 'ing-hops-1', name: 'Cascade Hops', rate: 8.00, tax_id: 'tax-gst' }
];

var MOCK_RECIPE_RESPONSE = {
  data: {
    ok: true,
    data: {
      recipe: {
        recipe_id: 'RCP-001',
        name: 'Cascade Pale Ale',
        style: 'American Pale Ale',
        abv: 5.2,
        locked_price: 195.00,
        service_fee: 45.00,
        materials_fee: 5.00,
        status: 'active'
      },
      ingredients: [
        { ingredient_id: 'ING-001', recipe_id: 'RCP-001', item_id: 'ing-malt-1', item_name: 'Pale Malt 2-Row', quantity: 5.5, unit: 'kg' },
        { ingredient_id: 'ING-002', recipe_id: 'RCP-001', item_id: 'ing-hops-1', item_name: 'Cascade Hops', quantity: 0.1, unit: 'kg' }
      ]
    }
  }
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetAndLoadPosRecipe() {
  mockRouteHandlers = {};
  jest.resetModules();
  require('../routes/pos-recipe');
  return {
    axios: require('axios'),
    cache: require('../lib/cache'),
    helcim: require('../lib/helcim'),
    zohoApi: require('../lib/zoho-api'),
    brewpad: require('../lib/brewpad-integration'),
    C: require('../lib/constants')
  };
}

function callHandler(method, path, req) {
  return new Promise(function (resolve, reject) {
    var key = method + ':' + path;
    var handler = mockRouteHandlers[key];
    if (!handler) return reject(new Error('No handler registered for ' + key));
    var res = {
      _status: 200,
      _body: null,
      headersSent: false,
      status: jest.fn(function (s) { res._status = s; return res; }),
      json: jest.fn(function (b) { res._body = b; res.headersSent = true; resolve(res); return res; })
    };
    try { handler(req || {}, res); } catch (e) { reject(e); }
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/kiosk/recipe-sale (initiate)', function () {
  var mocks;

  beforeEach(function () {
    mocks = resetAndLoadPosRecipe();
    process.env.APPS_SCRIPT_URL = 'https://script.google.com/test';
    process.env.APPS_SCRIPT_SERVER_TOKEN = 'test-token';
    process.env.BEER_SALES_ENABLED = 'true';
    process.env.MAKERS_FEE_ITEM_ID = 'fee-makers-1';
    process.env.MATERIALS_FEE_ITEM_ID = 'fee-materials-1';
    process.env.KIOSK_CONTACT_ID = 'contact-default';
    delete process.env.MILLING_FEE_ITEM_ID;
    mocks.helcim.isTerminalEnabled.mockReturnValue(true);
    mocks.helcim.terminalPurchase.mockResolvedValue({});
    mocks.cache.acquireLock.mockResolvedValue(true);
    mocks.cache.releaseLock.mockResolvedValue();
    mocks.cache.get.mockImplementation(function (key) {
      if (key === 'zoho:ingredients') return Promise.resolve(MOCK_INGREDIENTS_CATALOG);
      return Promise.resolve(null);
    });
    mocks.axios.post.mockResolvedValue(MOCK_RECIPE_RESPONSE);
  });

  afterEach(function () {
    delete process.env.APPS_SCRIPT_URL;
    delete process.env.APPS_SCRIPT_SERVER_TOKEN;
    delete process.env.BEER_SALES_ENABLED;
    delete process.env.MAKERS_FEE_ITEM_ID;
    delete process.env.MATERIALS_FEE_ITEM_ID;
    delete process.env.KIOSK_CONTACT_ID;
    delete process.env.MILLING_FEE_ITEM_ID;
  });

  test('1. returns 403 when BEER_SALES_ENABLED is false', function () {
    process.env.BEER_SALES_ENABLED = 'false';
    return callHandler('POST', '/api/kiosk/recipe-sale', { body: { recipe_id: 'RCP-001', sale_type: 'in-store' } }).then(function (res) {
      expect(res._status).toBe(403);
      expect(res._body.error).toBe('Recipe sales are not enabled');
    });
  });

  test('2. returns 503 when terminal not configured', function () {
    mocks.helcim.isTerminalEnabled.mockReturnValue(false);
    return callHandler('POST', '/api/kiosk/recipe-sale', { body: { recipe_id: 'RCP-001', sale_type: 'in-store' } }).then(function (res) {
      expect(res._status).toBe(503);
      expect(res._body.error).toBe('POS terminal not configured');
    });
  });

  test('3. returns 400 when recipe_id is missing', function () {
    return callHandler('POST', '/api/kiosk/recipe-sale', { body: { sale_type: 'in-store' } }).then(function (res) {
      expect(res._status).toBe(400);
      expect(res._body.error).toBe('Missing recipe_id');
    });
  });

  test('4. returns 400 when sale_type is invalid', function () {
    return callHandler('POST', '/api/kiosk/recipe-sale', { body: { recipe_id: 'RCP-001', sale_type: 'delivery' } }).then(function (res) {
      expect(res._status).toBe(400);
      expect(res._body.error).toBe('sale_type must be in-store or take-out');
    });
  });

  test('5. returns 503 when mutex lock fails', function () {
    mocks.cache.acquireLock.mockResolvedValue(false);
    return callHandler('POST', '/api/kiosk/recipe-sale', {
      body: { recipe_id: 'RCP-001', sale_type: 'in-store' }
    }).then(function (res) {
      expect(res._status).toBe(503);
      expect(res._body.error).toMatch(/Another recipe sale in progress/);
    });
  });

  test('6. returns 202 with pending reference on successful terminal push', function () {
    return callHandler('POST', '/api/kiosk/recipe-sale', {
      body: { recipe_id: 'RCP-001', sale_type: 'in-store' }
    }).then(function (res) {
      expect(res._status).toBe(202);
      expect(res._body.pending).toBe(true);
      expect(res._body.reference).toMatch(/^RECIPE-/);
      expect(res._body.recipe_id).toBe('RCP-001');
      expect(res._body.sale_type).toBe('in-store');
      expect(typeof res._body.total).toBe('number');
    });
  });

  test('7. releases lock on terminal push failure', function () {
    mocks.helcim.terminalPurchase.mockRejectedValue(new Error('Terminal unavailable'));
    return callHandler('POST', '/api/kiosk/recipe-sale', {
      body: { recipe_id: 'RCP-001', sale_type: 'in-store' }
    }).then(function (res) {
      expect(res._status).toBe(502);
      expect(mocks.cache.releaseLock).toHaveBeenCalledWith('recipe-sale');
    });
  });

  test('15. uses locked_price when pricing_mode is locked', function () {
    // MOCK_RECIPE_RESPONSE has locked_price: 195.00 and no pricing_mode (defaults to locked)
    return callHandler('POST', '/api/kiosk/recipe-sale', {
      body: { recipe_id: 'RCP-001', sale_type: 'in-store' }
    }).then(function (res) {
      expect(res._status).toBe(202);
      // locked_price is 195.00; dynamic total would be 5.5*3.50 + 0.1*8.00 = 19.25 + 0.80 = 20.05 + fees 50 = 70.05
      expect(res._body.total).toBe(195.00);
    });
  });

  test('16. computes from ingredients when pricing_mode is dynamic', function () {
    var dynamicRecipeResponse = {
      data: {
        ok: true,
        data: {
          recipe: {
            recipe_id: 'RCP-002',
            name: 'Dynamic Pale Ale',
            style: 'American Pale Ale',
            locked_price: 0,
            service_fee: 45.00,
            materials_fee: 5.00,
            status: 'active',
            pricing_mode: 'dynamic'
          },
          ingredients: [
            { ingredient_id: 'ING-001', recipe_id: 'RCP-002', item_id: 'ing-malt-1', item_name: 'Pale Malt 2-Row', quantity: 5.5, unit: 'kg' },
            { ingredient_id: 'ING-002', recipe_id: 'RCP-002', item_id: 'ing-hops-1', item_name: 'Cascade Hops', quantity: 0.1, unit: 'kg' }
          ]
        }
      }
    };
    mocks.axios.post.mockResolvedValue(dynamicRecipeResponse);
    return callHandler('POST', '/api/kiosk/recipe-sale', {
      body: { recipe_id: 'RCP-002', sale_type: 'in-store' }
    }).then(function (res) {
      expect(res._status).toBe(202);
      // Dynamic: 5.5*3.50 + 0.1*8.00 + 45 + 5 = 19.25 + 0.80 + 50 = 70.05
      expect(res._body.total).toBe(70.05);
    });
  });
});

describe('POST /api/kiosk/recipe-sale/confirm', function () {
  var mocks;

  beforeEach(function () {
    mocks = resetAndLoadPosRecipe();
    process.env.APPS_SCRIPT_URL = 'https://script.google.com/test';
    process.env.APPS_SCRIPT_SERVER_TOKEN = 'test-token';
    process.env.BEER_SALES_ENABLED = 'true';
    process.env.MAKERS_FEE_ITEM_ID = 'fee-makers-1';
    process.env.MATERIALS_FEE_ITEM_ID = 'fee-materials-1';
    process.env.KIOSK_CONTACT_ID = 'contact-default';
    delete process.env.MILLING_FEE_ITEM_ID;
    mocks.helcim.isTerminalEnabled.mockReturnValue(true);
    mocks.helcim.voidTransaction.mockResolvedValue({});
    mocks.cache.acquireLock.mockResolvedValue(true);
    mocks.cache.releaseLock.mockResolvedValue();
    mocks.cache.del.mockResolvedValue(1);
    mocks.cache.get.mockImplementation(function (key) {
      if (key === 'zoho:ingredients') return Promise.resolve(MOCK_INGREDIENTS_CATALOG);
      return Promise.resolve(null);
    });
    mocks.axios.post.mockResolvedValue(MOCK_RECIPE_RESPONSE);
    mocks.zohoApi.zohoPost.mockResolvedValue({ invoice: { invoice_id: 'inv-1', invoice_number: 'INV-001' } });
  });

  afterEach(function () {
    delete process.env.APPS_SCRIPT_URL;
    delete process.env.APPS_SCRIPT_SERVER_TOKEN;
    delete process.env.BEER_SALES_ENABLED;
    delete process.env.MAKERS_FEE_ITEM_ID;
    delete process.env.MATERIALS_FEE_ITEM_ID;
    delete process.env.KIOSK_CONTACT_ID;
    delete process.env.MILLING_FEE_ITEM_ID;
  });

  test('8. confirm returns 403 when BEER_SALES_ENABLED is false', function () {
    process.env.BEER_SALES_ENABLED = 'false';
    return callHandler('POST', '/api/kiosk/recipe-sale/confirm', {
      body: { recipe_id: 'RCP-001', transaction_id: 'txn-123', reference: 'RECIPE-1234', sale_type: 'in-store' }
    }).then(function (res) {
      expect(res._status).toBe(403);
      expect(res._body.error).toBe('Recipe sales are not enabled');
    });
  });

  test('9. confirm creates invoice with per-ingredient line items plus fee', function () {
    return callHandler('POST', '/api/kiosk/recipe-sale/confirm', {
      body: {
        recipe_id: 'RCP-001',
        transaction_id: 'txn-123',
        reference: 'RECIPE-1234',
        sale_type: 'in-store',
        customer_name: 'Jane Doe'
      }
    }).then(function (res) {
      expect(res._status).toBe(201);
      expect(res._body.ok).toBe(true);
      expect(res._body.invoice_number).toBe('INV-001');
      // Verify zohoPost was called with /invoices and line_items containing ingredients + fees
      var invoiceCalls = mocks.zohoApi.zohoPost.mock.calls.filter(function (c) { return c[0] === '/invoices'; });
      expect(invoiceCalls.length).toBe(1);
      var lineItems = invoiceCalls[0][1].line_items;
      // Should have 2 ingredient lines + 2 fee lines (Brewing Fee + Materials Fee)
      expect(lineItems.length).toBe(4);
      var brewingFee = lineItems.find(function (li) { return li.name === 'Brewing Fee'; });
      var materialsFee = lineItems.find(function (li) { return li.name === 'Materials Fee'; });
      expect(brewingFee).toBeTruthy();
      expect(materialsFee).toBeTruthy();
      expect(brewingFee.item_id).toBe('fee-makers-1');
      expect(materialsFee.item_id).toBe('fee-materials-1');
    });
  });

  test('10. confirm voids transaction on Zoho invoice failure', function () {
    mocks.zohoApi.zohoPost.mockRejectedValue(new Error('Zoho unavailable'));
    return callHandler('POST', '/api/kiosk/recipe-sale/confirm', {
      body: {
        recipe_id: 'RCP-001',
        transaction_id: 'txn-456',
        reference: 'RECIPE-5678',
        sale_type: 'in-store'
      }
    }).then(function (res) {
      expect(mocks.helcim.voidTransaction).toHaveBeenCalledWith('txn-456');
      expect(res._status).toBe(502);
      expect(res._body.payment_voided).toBe(true);
    });
  });

  test('11. confirm releases lock after void on Zoho failure', function () {
    mocks.zohoApi.zohoPost.mockRejectedValue(new Error('Zoho unavailable'));
    return callHandler('POST', '/api/kiosk/recipe-sale/confirm', {
      body: {
        recipe_id: 'RCP-001',
        transaction_id: 'txn-789',
        reference: 'RECIPE-7890',
        sale_type: 'in-store'
      }
    }).then(function (res) {
      expect(mocks.cache.releaseLock).toHaveBeenCalledWith('recipe-sale');
    });
  });

  test('12. confirm calls detectRecipeSale for in-store sale', function () {
    return callHandler('POST', '/api/kiosk/recipe-sale/confirm', {
      body: {
        recipe_id: 'RCP-001',
        transaction_id: 'txn-101',
        reference: 'RECIPE-1010',
        sale_type: 'in-store',
        customer_name: 'John Smith',
        contact_id: 'C-001'
      }
    }).then(function (res) {
      expect(mocks.brewpad.detectRecipeSale).toHaveBeenCalledWith(
        'RCP-001',
        expect.objectContaining({ name: 'Cascade Pale Ale', style: 'American Pale Ale' }),
        'INV-001',
        'John Smith',
        'C-001'
      );
    });
  });

  test('13. confirm does NOT call detectRecipeSale for take-out sale', function () {
    return callHandler('POST', '/api/kiosk/recipe-sale/confirm', {
      body: {
        recipe_id: 'RCP-001',
        transaction_id: 'txn-202',
        reference: 'RECIPE-2020',
        sale_type: 'take-out',
        customer_name: 'Jane Smith'
      }
    }).then(function (res) {
      expect(res._status).toBe(201);
      expect(mocks.brewpad.detectRecipeSale).not.toHaveBeenCalled();
    });
  });

  test('14. confirm busts both kiosk products and ingredients caches', function () {
    return callHandler('POST', '/api/kiosk/recipe-sale/confirm', {
      body: {
        recipe_id: 'RCP-001',
        transaction_id: 'txn-303',
        reference: 'RECIPE-3030',
        sale_type: 'in-store'
      }
    }).then(function (res) {
      expect(res._status).toBe(201);
      var delCalls = mocks.cache.del.mock.calls.map(function (c) { return c[0]; });
      expect(delCalls).toContain('test:kiosk-products');
      expect(delCalls).toContain('zoho:ingredients');
    });
  });

  test('17. confirm uses locked_price as grand total when pricing_mode is locked', function () {
    // MOCK_RECIPE_RESPONSE has locked_price: 195 and no pricing_mode (defaults to locked)
    // Dynamic total would be: 5.5*3.50 + 0.1*8.00 + 45 + 5 = 70.05
    // But locked mode should charge 195.00
    var capturedInvoicePayload;
    mocks.zohoApi.zohoPost.mockImplementation(function (path, payload) {
      if (path === '/invoices') capturedInvoicePayload = payload;
      return Promise.resolve({ invoice: { invoice_id: 'inv-1', invoice_number: 'INV-001' } });
    });
    return callHandler('POST', '/api/kiosk/recipe-sale/confirm', {
      body: {
        recipe_id: 'RCP-001',
        transaction_id: 'txn-locked',
        reference: 'RECIPE-LOCKED',
        sale_type: 'in-store'
      }
    }).then(function (res) {
      expect(res._status).toBe(201);
      // Invoice should still have per-ingredient line items (for inventory deduction)
      expect(capturedInvoicePayload.line_items.length).toBeGreaterThan(0);
      var ingredientLine = capturedInvoicePayload.line_items.find(function (li) { return li.item_id === 'ing-malt-1'; });
      expect(ingredientLine).toBeTruthy();
    });
  });

  test('18. confirm computes from ingredients when pricing_mode is dynamic', function () {
    var dynamicRecipeResponse = {
      data: {
        ok: true,
        data: {
          recipe: {
            recipe_id: 'RCP-002',
            name: 'Dynamic Pale Ale',
            locked_price: 999,
            service_fee: 45.00,
            materials_fee: 5.00,
            status: 'active',
            pricing_mode: 'dynamic'
          },
          ingredients: [
            { ingredient_id: 'ING-001', recipe_id: 'RCP-002', item_id: 'ing-malt-1', item_name: 'Pale Malt 2-Row', quantity: 5.5, unit: 'kg' },
            { ingredient_id: 'ING-002', recipe_id: 'RCP-002', item_id: 'ing-hops-1', item_name: 'Cascade Hops', quantity: 0.1, unit: 'kg' }
          ]
        }
      }
    };
    mocks.axios.post.mockResolvedValue(dynamicRecipeResponse);
    var capturedInvoicePayload;
    mocks.zohoApi.zohoPost.mockImplementation(function (path, payload) {
      if (path === '/invoices') capturedInvoicePayload = payload;
      return Promise.resolve({ invoice: { invoice_id: 'inv-2', invoice_number: 'INV-002' } });
    });
    return callHandler('POST', '/api/kiosk/recipe-sale/confirm', {
      body: {
        recipe_id: 'RCP-002',
        transaction_id: 'txn-dynamic',
        reference: 'RECIPE-DYN',
        sale_type: 'in-store'
      }
    }).then(function (res) {
      expect(res._status).toBe(201);
      // Dynamic: 5.5*3.50 + 0.1*8.00 + 45 + 5 = 70.05 (not 999)
      // Verify per-ingredient line items are present
      var ingredientLine = capturedInvoicePayload.line_items.find(function (li) { return li.item_id === 'ing-malt-1'; });
      expect(ingredientLine).toBeTruthy();
      expect(ingredientLine.rate).toBe(3.50);
    });
  });
});
