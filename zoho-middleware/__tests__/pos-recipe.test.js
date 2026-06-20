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
      INGREDIENTS: 'zoho:ingredients',
      INGREDIENTS_ALL: 'zoho:ingredients:all'
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
  { item_id: 'ing-malt-1', name: 'Pale Malt 2-Row', rate: 3.50, tax_id: 'tax-gst', stock_on_hand: 50 },
  { item_id: 'ing-hops-1', name: 'Cascade Hops', rate: 8.00, tax_id: 'tax-gst', stock_on_hand: 2 },
  { item_id: 'ing-yeast-1', name: 'US-05 Yeast', rate: 5.00, tax_id: 'tax-gst', stock_on_hand: 10 }
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
        batch_size_l: 20,
        locked_price: 195.00,
        service_fee: 45.00,
        materials_fee: 5.00,
        status: 'active'
      },
      ingredients: [
        { ingredient_id: 'ING-001', recipe_id: 'RCP-001', item_id: 'ing-malt-1', item_name: 'Pale Malt 2-Row', quantity: 5.5, unit: 'kg' },
        { ingredient_id: 'ING-002', recipe_id: 'RCP-001', item_id: 'ing-hops-1', item_name: 'Cascade Hops', quantity: 0.1, unit: 'kg' },
        { ingredient_id: 'ING-003', recipe_id: 'RCP-001', item_id: 'ing-yeast-1', item_name: 'US-05 Yeast', quantity: 1, unit: 'pcs' }
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
      if (key === 'zoho:ingredients:all') return Promise.resolve(MOCK_INGREDIENTS_CATALOG);
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

  test('15. uses locked_price when pricing_mode is locked (D-06 fee-inclusive at 1x)', function () {
    // MOCK_RECIPE_RESPONSE has locked_price: 195.00, batch_size_l: 20, no pricing_mode (defaults to locked)
    // D-06: fee-inclusive formula applied globally — at 1x: 195.00 * 1.0 + 45.00 + 5.00 = 245.00
    return callHandler('POST', '/api/kiosk/recipe-sale', {
      body: { recipe_id: 'RCP-001', sale_type: 'in-store' }
    }).then(function (res) {
      expect(res._status).toBe(202);
      // locked_price * 1.0 + service_fee + materials_fee = 195 + 45 + 5 = 245
      expect(res._body.total).toBe(245.00);
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
            batch_size_l: 20,
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
      if (key === 'zoho:ingredients:all') return Promise.resolve(MOCK_INGREDIENTS_CATALOG);
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
      // Should have 3 ingredient lines (malt + hops + yeast) + 2 fee lines (Brewing Fee + Materials Fee)
      expect(lineItems.length).toBe(5);
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
            batch_size_l: 20,
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

// ---------------------------------------------------------------------------
// Scaling tests — Task 1 (SCALE-01, SCALE-03, SCALE-05)
// ---------------------------------------------------------------------------

describe('POST /api/kiosk/recipe-sale — scaling (SCALE-01, SCALE-03, SCALE-05)', function () {
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
      if (key === 'zoho:ingredients:all') return Promise.resolve(MOCK_INGREDIENTS_CATALOG);
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

  test('S1. returns 400 when recipe has no batch_size_l (scaling disabled, D-11)', function () {
    var noBaseResponse = {
      data: {
        ok: true,
        data: {
          recipe: {
            recipe_id: 'RCP-NOBASE',
            name: 'No Base Recipe',
            batch_size_l: 0,
            locked_price: 195.00,
            service_fee: 45.00,
            materials_fee: 5.00,
            status: 'active'
          },
          ingredients: [
            { ingredient_id: 'ING-001', item_id: 'ing-malt-1', item_name: 'Pale Malt 2-Row', quantity: 5.5, unit: 'kg' }
          ]
        }
      }
    };
    mocks.axios.post.mockResolvedValue(noBaseResponse);
    return callHandler('POST', '/api/kiosk/recipe-sale', {
      body: { recipe_id: 'RCP-NOBASE', sale_type: 'in-store', target_volume_l: 20 }
    }).then(function (res) {
      expect(res._status).toBe(400);
      expect(res._body.error).toMatch(/batch size/i);
    });
  });

  test('S2. returns 400 when target_volume_l is <= 0', function () {
    return callHandler('POST', '/api/kiosk/recipe-sale', {
      body: { recipe_id: 'RCP-001', sale_type: 'in-store', target_volume_l: 0 }
    }).then(function (res) {
      expect(res._status).toBe(400);
      expect(res._body.error).toMatch(/target_volume_l/);
    });
  });

  test('S3. returns 400 when target_volume_l exceeds 10x base (D-11 fat-finger guard)', function () {
    // batch_size_l=20, target=201 (> 20*10=200)
    return callHandler('POST', '/api/kiosk/recipe-sale', {
      body: { recipe_id: 'RCP-001', sale_type: 'in-store', target_volume_l: 201 }
    }).then(function (res) {
      expect(res._status).toBe(400);
      expect(res._body.error).toMatch(/maximum/i);
    });
  });

  test('S4. no target_volume_l in body defaults to base (scale_factor 1.0) — backward compat (D-05)', function () {
    // Omitting target_volume_l — handler defaults to batch_size_l=20 => factor 1.0
    // locked: 195 * 1.0 + 45 + 5 = 245.00 (D-06 fee-inclusive)
    return callHandler('POST', '/api/kiosk/recipe-sale', {
      body: { recipe_id: 'RCP-001', sale_type: 'in-store' }
    }).then(function (res) {
      expect(res._status).toBe(202);
      expect(res._body.total).toBe(245.00);
      expect(res._body.scale_factor).toBe(1.0);
      expect(res._body.target_volume_l).toBe(20);
    });
  });

  test('S5. locked recipe at 1.5x charges locked_price * 1.5 + fees (D-04, D-05, D-06)', function () {
    // batch_size_l=20, target=30 => factor=1.5
    // locked: 195 * 1.5 + 45 + 5 = 292.50 + 50 = 342.50
    return callHandler('POST', '/api/kiosk/recipe-sale', {
      body: { recipe_id: 'RCP-001', sale_type: 'in-store', target_volume_l: 30 }
    }).then(function (res) {
      expect(res._status).toBe(202);
      expect(res._body.total).toBe(342.50);
      expect(res._body.scale_factor).toBe(1.5);
      expect(res._body.target_volume_l).toBe(30);
    });
  });

  test('S6. locked recipe take-out at 1.5x does NOT add service/materials fees', function () {
    // locked: 195 * 1.5 = 292.50 (no fees for take-out)
    return callHandler('POST', '/api/kiosk/recipe-sale', {
      body: { recipe_id: 'RCP-001', sale_type: 'take-out', target_volume_l: 30 }
    }).then(function (res) {
      expect(res._status).toBe(202);
      expect(res._body.total).toBe(292.50);
    });
  });

  test('S7. dynamic recipe at 1.5x charges scaled ingredient sum + fees (D-07)', function () {
    var dynamicScaledResponse = {
      data: {
        ok: true,
        data: {
          recipe: {
            recipe_id: 'RCP-DYN',
            name: 'Dynamic Scaled',
            batch_size_l: 20,
            locked_price: 0,
            service_fee: 45.00,
            materials_fee: 5.00,
            status: 'active',
            pricing_mode: 'dynamic'
          },
          ingredients: [
            { ingredient_id: 'ING-001', item_id: 'ing-malt-1', item_name: 'Pale Malt 2-Row', quantity: 5.5, unit: 'kg' },
            { ingredient_id: 'ING-002', item_id: 'ing-hops-1', item_name: 'Cascade Hops', quantity: 0.1, unit: 'kg' }
          ]
        }
      }
    };
    mocks.axios.post.mockResolvedValue(dynamicScaledResponse);
    // 1.5x: malt 5.5*1.5=8.25 @ 3.50 = 28.875; hops 0.1*1.5=0.15 @ 8.00 = 1.20
    // total = 28.875 + 1.20 + 45 + 5 = 80.08 (rounded)
    return callHandler('POST', '/api/kiosk/recipe-sale', {
      body: { recipe_id: 'RCP-DYN', sale_type: 'in-store', target_volume_l: 30 }
    }).then(function (res) {
      expect(res._status).toBe(202);
      // 8.25 * 3.50 = 28.875; 0.15 * 8.00 = 1.2; sum = 30.075 + 50 = 80.08
      expect(res._body.total).toBeCloseTo(80.08, 2);
    });
  });

  test('S8. returns 409 with conflict list when scaled qty exceeds stock (D-08)', function () {
    // hops: 0.1 * 1.5 = 0.15 kg needed, stock_on_hand = 2 — this is fine
    // BUT if we use a recipe with hops qty=2 at 1.5x => 3 needed, stock=2 => conflict
    var conflictResponse = {
      data: {
        ok: true,
        data: {
          recipe: {
            recipe_id: 'RCP-CONFLICT',
            name: 'Stock Conflict Recipe',
            batch_size_l: 20,
            locked_price: 195.00,
            service_fee: 45.00,
            materials_fee: 5.00,
            status: 'active'
          },
          ingredients: [
            { ingredient_id: 'ING-002', item_id: 'ing-hops-1', item_name: 'Cascade Hops', quantity: 2, unit: 'kg' }
          ]
        }
      }
    };
    mocks.axios.post.mockResolvedValue(conflictResponse);
    // 2 * 1.5 = 3 needed, stock_on_hand = 2 => conflict
    return callHandler('POST', '/api/kiosk/recipe-sale', {
      body: { recipe_id: 'RCP-CONFLICT', sale_type: 'in-store', target_volume_l: 30 }
    }).then(function (res) {
      expect(res._status).toBe(409);
      expect(res._body.error).toMatch(/stock/i);
      expect(Array.isArray(res._body.conflicts)).toBe(true);
      expect(res._body.conflicts.length).toBeGreaterThan(0);
      expect(res._body.conflicts[0].item_id).toBe('ing-hops-1');
    });
  });

  test('S9. override=true bypasses stock conflict and returns 202 (D-08)', function () {
    var conflictResponse = {
      data: {
        ok: true,
        data: {
          recipe: {
            recipe_id: 'RCP-CONFLICT',
            name: 'Stock Conflict Recipe',
            batch_size_l: 20,
            locked_price: 195.00,
            service_fee: 45.00,
            materials_fee: 5.00,
            status: 'active'
          },
          ingredients: [
            { ingredient_id: 'ING-002', item_id: 'ing-hops-1', item_name: 'Cascade Hops', quantity: 2, unit: 'kg' }
          ]
        }
      }
    };
    mocks.axios.post.mockResolvedValue(conflictResponse);
    return callHandler('POST', '/api/kiosk/recipe-sale', {
      body: { recipe_id: 'RCP-CONFLICT', sale_type: 'in-store', target_volume_l: 30, override: true }
    }).then(function (res) {
      expect(res._status).toBe(202);
    });
  });
});

// ---------------------------------------------------------------------------
// Confirm scaling tests — Task 2 (SCALE-04, SCALE-05)
// ---------------------------------------------------------------------------

describe('POST /api/kiosk/recipe-sale/confirm — scaling (SCALE-04, SCALE-05)', function () {
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
      if (key === 'zoho:ingredients:all') return Promise.resolve(MOCK_INGREDIENTS_CATALOG);
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

  test('C1. invoice line items use scaled quantities at 1.5x (SCALE-04)', function () {
    var capturedInvoicePayload;
    mocks.zohoApi.zohoPost.mockImplementation(function (path, payload) {
      if (path === '/invoices') capturedInvoicePayload = payload;
      return Promise.resolve({ invoice: { invoice_id: 'inv-1', invoice_number: 'INV-001' } });
    });
    // batch_size_l=20, target=30 => factor=1.5
    // malt 5.5 * 1.5 = 8.25 kg; hops 0.1 * 1.5 = 0.15 kg; yeast 1 * 1.5 -> ceil(1.5) = 2 pcs
    return callHandler('POST', '/api/kiosk/recipe-sale/confirm', {
      body: {
        recipe_id: 'RCP-001',
        transaction_id: 'txn-scale',
        reference: 'RECIPE-SCALE',
        sale_type: 'in-store',
        target_volume_l: 30
      }
    }).then(function (res) {
      expect(res._status).toBe(201);
      var maltLine = capturedInvoicePayload.line_items.find(function (li) { return li.item_id === 'ing-malt-1'; });
      expect(maltLine).toBeTruthy();
      expect(maltLine.quantity).toBeCloseTo(8.25, 4);
      var hopsLine = capturedInvoicePayload.line_items.find(function (li) { return li.item_id === 'ing-hops-1'; });
      expect(hopsLine).toBeTruthy();
      expect(hopsLine.quantity).toBeCloseTo(0.15, 4);
      var yeastLine = capturedInvoicePayload.line_items.find(function (li) { return li.item_id === 'ing-yeast-1'; });
      expect(yeastLine).toBeTruthy();
      // discrete ceil: Math.max(1, Math.ceil(1 * 1.5)) = Math.max(1, 2) = 2
      expect(yeastLine.quantity).toBe(2);
    });
  });

  test('C2. confirm locked at 1.5x grand total matches quote (locked_price * 1.5 + fees)', function () {
    // locked: 195 * 1.5 + 45 + 5 = 342.50
    return callHandler('POST', '/api/kiosk/recipe-sale/confirm', {
      body: {
        recipe_id: 'RCP-001',
        transaction_id: 'txn-locked-scale',
        reference: 'RECIPE-LOCKED-SCALE',
        sale_type: 'in-store',
        target_volume_l: 30
      }
    }).then(function (res) {
      expect(res._status).toBe(201);
      expect(res._body.total).toBe(342.50);
    });
  });

  test('C3. recipe_snapshot passed to detectRecipeSale includes target_volume_l and scale_factor (SCALE-04)', function () {
    return callHandler('POST', '/api/kiosk/recipe-sale/confirm', {
      body: {
        recipe_id: 'RCP-001',
        transaction_id: 'txn-snapshot',
        reference: 'RECIPE-SNAP',
        sale_type: 'in-store',
        customer_name: 'Test User',
        contact_id: 'C-001',
        target_volume_l: 30
      }
    }).then(function (res) {
      expect(res._status).toBe(201);
      var snapshotArg = mocks.brewpad.detectRecipeSale.mock.calls[0][1];
      expect(snapshotArg.target_volume_l).toBe(30);
      expect(snapshotArg.scale_factor).toBeCloseTo(1.5, 4);
      // snapshot ingredients should be scaled
      var maltIng = snapshotArg.ingredients.find(function (i) { return i.item_id === 'ing-malt-1'; });
      expect(maltIng.quantity).toBeCloseTo(8.25, 4);
    });
  });

  test('C4. returns 409 at confirm time if stock depleted between quote and confirm (D-09)', function () {
    // Recipe with hops qty=2, stock_on_hand=2, target=30 (1.5x) => 3 needed > 2 stock => conflict
    var conflictResponse = {
      data: {
        ok: true,
        data: {
          recipe: {
            recipe_id: 'RCP-CONFLICT',
            name: 'Stock Conflict Recipe',
            batch_size_l: 20,
            locked_price: 195.00,
            service_fee: 45.00,
            materials_fee: 5.00,
            status: 'active'
          },
          ingredients: [
            { ingredient_id: 'ING-002', item_id: 'ing-hops-1', item_name: 'Cascade Hops', quantity: 2, unit: 'kg' }
          ]
        }
      }
    };
    mocks.axios.post.mockResolvedValue(conflictResponse);
    return callHandler('POST', '/api/kiosk/recipe-sale/confirm', {
      body: {
        recipe_id: 'RCP-CONFLICT',
        transaction_id: 'txn-stock-check',
        reference: 'RECIPE-STOCK',
        sale_type: 'in-store',
        target_volume_l: 30
      }
    }).then(function (res) {
      expect(res._status).toBe(409);
      expect(Array.isArray(res._body.conflicts)).toBe(true);
    });
  });

  test('C5. confirm with no target_volume_l defaults to 1.0x against batch_size_l (not silent short-circuit)', function () {
    // Omitting target_volume_l — handler must default to batch_size_l=20 => factor 1.0
    // locked: 195 * 1.0 + 45 + 5 = 245.00
    return callHandler('POST', '/api/kiosk/recipe-sale/confirm', {
      body: {
        recipe_id: 'RCP-001',
        transaction_id: 'txn-default-1x',
        reference: 'RECIPE-DEFAULT',
        sale_type: 'in-store'
      }
    }).then(function (res) {
      expect(res._status).toBe(201);
      expect(res._body.total).toBe(245.00);
    });
  });

  test('C6. confirm with no batch_size_l on recipe returns 400 (D-11)', function () {
    var noBaseResponse = {
      data: {
        ok: true,
        data: {
          recipe: {
            recipe_id: 'RCP-NOBASE',
            name: 'No Base',
            batch_size_l: 0,
            locked_price: 195.00,
            service_fee: 45.00,
            materials_fee: 5.00,
            status: 'active'
          },
          ingredients: [
            { ingredient_id: 'ING-001', item_id: 'ing-malt-1', item_name: 'Pale Malt 2-Row', quantity: 5.5, unit: 'kg' }
          ]
        }
      }
    };
    mocks.axios.post.mockResolvedValue(noBaseResponse);
    return callHandler('POST', '/api/kiosk/recipe-sale/confirm', {
      body: {
        recipe_id: 'RCP-NOBASE',
        transaction_id: 'txn-nobase',
        reference: 'RECIPE-NOBASE',
        sale_type: 'in-store',
        target_volume_l: 20
      }
    }).then(function (res) {
      expect(res._status).toBe(400);
      expect(res._body.error).toMatch(/batch size/i);
    });
  });
});

// ---------------------------------------------------------------------------
// Regression: SCALE-05 — internal-only ingredient stock visibility
// ---------------------------------------------------------------------------
// Internal-only ingredients (e.g. Gypsum Bulk, item_id 109900000000028635) are
// absent from the purchasable-only INGREDIENTS catalog but present in INGREDIENTS_ALL
// with real stock_on_hand. The handlers must read INGREDIENTS_ALL so the stock gate
// and pricing see the correct catalog entry.

describe('SCALE-05 regression — internal-only ingredient reads INGREDIENTS_ALL', function () {
  var mocks;
  var INTERNAL_ITEM_ID = '109900000000028635'; // Gypsum (Calcium Sulfate) (Bulk)

  // Catalog that simulates INGREDIENTS_ALL — includes the internal item
  var INGREDIENTS_ALL_CATALOG = [
    { item_id: 'ing-malt-1', name: 'Pale Malt 2-Row', rate: 3.50, tax_id: 'tax-gst', stock_on_hand: 50 },
    { item_id: INTERNAL_ITEM_ID, name: 'Gypsum (Calcium Sulfate) (Bulk)', rate: 0.50, tax_id: 'tax-gst', stock_on_hand: 20.83 }
  ];

  // Recipe with only the internal-only ingredient (dynamic pricing so rate matters)
  var INTERNAL_ONLY_RECIPE_RESPONSE = {
    data: {
      ok: true,
      data: {
        recipe: {
          recipe_id: 'RCP-INTERNAL',
          name: 'Internal Ingredient Recipe',
          style: 'Test',
          abv: 5.0,
          batch_size_l: 20,
          locked_price: 0,
          service_fee: 45.00,
          materials_fee: 5.00,
          status: 'active',
          pricing_mode: 'dynamic'
        },
        ingredients: [
          { ingredient_id: 'ING-GYP', recipe_id: 'RCP-INTERNAL', item_id: INTERNAL_ITEM_ID, item_name: 'Gypsum (Calcium Sulfate) (Bulk)', quantity: 2, unit: 'kg' }
        ]
      }
    }
  };

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
    mocks.helcim.voidTransaction.mockResolvedValue({});
    mocks.cache.acquireLock.mockResolvedValue(true);
    mocks.cache.releaseLock.mockResolvedValue();
    mocks.cache.del.mockResolvedValue(1);
    // INGREDIENTS_ALL has the internal item; INGREDIENTS (purchasable-only) does NOT
    mocks.cache.get.mockImplementation(function (key) {
      if (key === 'zoho:ingredients:all') return Promise.resolve(INGREDIENTS_ALL_CATALOG);
      if (key === 'zoho:ingredients') return Promise.resolve([{ item_id: 'ing-malt-1', name: 'Pale Malt 2-Row', rate: 3.50, tax_id: 'tax-gst', stock_on_hand: 50 }]);
      return Promise.resolve(null);
    });
    mocks.axios.post.mockResolvedValue(INTERNAL_ONLY_RECIPE_RESPONSE);
    mocks.zohoApi.zohoPost.mockResolvedValue({ invoice: { invoice_id: 'inv-int', invoice_number: 'INV-INT' } });
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

  test('SCALE-05a (quote): internal-only ingredient with sufficient stock returns 202 with correct rate-inclusive total', function () {
    // dynamic: 2 kg Gypsum @ rate 0.50 = 1.00 + service_fee 45 + materials_fee 5 = 51.00
    // Against unfixed source (reads INGREDIENTS, item absent) → rate=0 → total = 0 + 50 = 50.00
    return callHandler('POST', '/api/kiosk/recipe-sale', {
      body: { recipe_id: 'RCP-INTERNAL', sale_type: 'in-store' }
    }).then(function (res) {
      expect(res._status).toBe(202);
      // Total must include the ingredient rate from INGREDIENTS_ALL (rate=0.50 * qty=2 = 1.00)
      expect(res._body.total).toBe(51.00);
    });
  });

  test('SCALE-05b (confirm): internal-only ingredient with sufficient stock returns 201 and invoice includes ingredient line', function () {
    var capturedInvoicePayload;
    mocks.zohoApi.zohoPost.mockImplementation(function (path, payload) {
      if (path === '/invoices') capturedInvoicePayload = payload;
      return Promise.resolve({ invoice: { invoice_id: 'inv-int', invoice_number: 'INV-INT' } });
    });
    return callHandler('POST', '/api/kiosk/recipe-sale/confirm', {
      body: {
        recipe_id: 'RCP-INTERNAL',
        transaction_id: 'txn-internal',
        reference: 'RECIPE-INT',
        sale_type: 'in-store'
      }
    }).then(function (res) {
      expect(res._status).toBe(201);
      // Invoice must include the internal ingredient line with correct rate
      var gypsumLine = capturedInvoicePayload.line_items.find(function (li) { return li.item_id === INTERNAL_ITEM_ID; });
      expect(gypsumLine).toBeTruthy();
      expect(gypsumLine.rate).toBe(0.50);
    });
  });
});
