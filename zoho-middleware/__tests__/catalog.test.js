'use strict';

// ---------------------------------------------------------------------------
// Express mock — captures route handlers
// ---------------------------------------------------------------------------

// We need handlers to be re-populated per test group.
// The mock variable must be at top level (prefixed "mock" to satisfy jest hoisting rules).
var mockRouteHandlers = {};

jest.mock('express', function () {
  var router = {
    get: jest.fn(function (path, handler) { mockRouteHandlers[path] = handler; }),
    post: jest.fn(function (path, handler) { mockRouteHandlers[path] = handler; })
  };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});

jest.mock('../lib/zoho-api', function () {
  return {
    inventoryGet: jest.fn(),
    fetchAllItems: jest.fn(),
    fetchItemDetailsBulk: jest.fn()
  };
});

jest.mock('../lib/cache', function () {
  return {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    acquireLock: jest.fn(),
    releaseLock: jest.fn()
  };
});

jest.mock('../lib/logger', function () {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  };
});

jest.mock('../lib/inventory-ledger', function () {
  return {
    reconcile: jest.fn().mockResolvedValue(),
    overlayStock: jest.fn(function (items) { return Promise.resolve(items); })
  };
});

jest.mock('fs', function () {
  return {
    readFileSync: jest.fn(function () { throw new Error('no file'); }),
    writeFile: jest.fn(function (path, data, cb) { if (cb) cb(null); })
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetAndLoadCatalog() {
  // Clear handler registry and Jest module cache so catalog.js re-executes
  // (resetting its module-level state like _rawItemsCache, _productsRefreshing).
  mockRouteHandlers = {};
  jest.resetModules();
  // Re-require catalog; jest.mock() stubs above are still active
  require('../routes/catalog');
  return {
    zohoApi: require('../lib/zoho-api'),
    cache:   require('../lib/cache'),
    ledger:  require('../lib/inventory-ledger')
  };
}

function callHandler(path, req) {
  return new Promise(function (resolve, reject) {
    var handler = mockRouteHandlers[path];
    if (!handler) return reject(new Error('No handler registered for ' + path));
    var res = {
      _status: 200,
      _body: null,
      status: jest.fn(function (s) { res._status = s; return res; }),
      json: jest.fn(function (b) { res._body = b; resolve(res); return res; })
    };
    try { handler(req || {}, res); } catch (e) { reject(e); }
  });
}

function setupDefaultMocks(mocks) {
  mocks.cache.get.mockResolvedValue(null);
  mocks.cache.set.mockResolvedValue(true);
  mocks.cache.del.mockResolvedValue(true);
  mocks.cache.acquireLock.mockResolvedValue(true);
  mocks.cache.releaseLock.mockResolvedValue(true);
  mocks.ledger.reconcile.mockResolvedValue();
  mocks.ledger.overlayStock.mockImplementation(function (items) { return Promise.resolve(items); });
}

function makeItem(overrides) {
  return Object.assign({
    item_id:       'item-001',
    name:          'Test Item',
    rate:          10,
    stock_on_hand: 5,
    product_type:  'goods',
    group_name:    '',
    cf_type:       ''
  }, overrides);
}

// Tax rule IDs matching defaults in catalog.js
var STANDARD_RULE_ID = process.env.ZOHO_TAX_STANDARD_RULE || '109900000000033423';
var SERVICES_RULE_ID = process.env.ZOHO_TAX_SERVICES_RULE || '109900000000033417';

// ---------------------------------------------------------------------------
// GET /api/products — bulk detail enrichment
// ---------------------------------------------------------------------------

describe('GET /api/products — bulk detail enrichment', function () {
  var mocks;

  beforeEach(function () {
    mocks = resetAndLoadCatalog();
    setupDefaultMocks(mocks);
  });

  test('calls fetchItemDetailsBulk instead of inventoryGet for each item', function () {
    var items = [
      makeItem({ item_id: 'i1', name: 'Wine Kit A' }),
      makeItem({ item_id: 'i2', name: 'Wine Kit B' })
    ];
    var detailMap = {
      'i1': { item_id: 'i1', custom_fields: [{ label: 'Type', value: 'wine' }], brand: 'B', image_name: '', tax_id: '', tax_name: 'GST', tax_percentage: 12, sales_tax_rule_id: '', vendor_id: '', vendor_name: '' },
      'i2': { item_id: 'i2', custom_fields: [{ label: 'Type', value: 'wine' }], brand: 'B', image_name: '', tax_id: '', tax_name: 'GST', tax_percentage: 12, sales_tax_rule_id: '', vendor_id: '', vendor_name: '' }
    };

    mocks.zohoApi.fetchAllItems.mockResolvedValue(items);
    mocks.zohoApi.fetchItemDetailsBulk.mockResolvedValue(detailMap);

    return callHandler('/api/products').then(function () {
      expect(mocks.zohoApi.fetchItemDetailsBulk).toHaveBeenCalledTimes(1);
      expect(mocks.zohoApi.fetchItemDetailsBulk).toHaveBeenCalledWith(['i1', 'i2']);
      expect(mocks.zohoApi.inventoryGet).not.toHaveBeenCalled();
    });
  });

  test('sets tax_percentage from detailMap', function () {
    var items = [makeItem({ item_id: 'i1', name: 'Wine Kit A' })];
    var detailMap = {
      'i1': { item_id: 'i1', custom_fields: [{ label: 'Type', value: 'wine' }], brand: '', image_name: '', tax_id: '', tax_name: 'GST', tax_percentage: 12, sales_tax_rule_id: '', vendor_id: '', vendor_name: '' }
    };

    mocks.zohoApi.fetchAllItems.mockResolvedValue(items);
    mocks.zohoApi.fetchItemDetailsBulk.mockResolvedValue(detailMap);

    return callHandler('/api/products').then(function () {
      var cachedItems = mocks.cache.set.mock.calls
        .filter(function (c) { return c[0] === 'zoho:products'; })
        .map(function (c) { return c[1]; })[0];
      expect(cachedItems).toBeDefined();
      expect(cachedItems[0].tax_percentage).toBe(12);
    });
  });

  test('derives tax_percentage from sales_tax_rule_id when tax_percentage is 0', function () {
    var items = [makeItem({ item_id: 'i1', name: 'Wine Kit A' })];
    var detailMap = {
      'i1': {
        item_id: 'i1',
        custom_fields: [{ label: 'Type', value: 'wine' }],
        brand: '', image_name: '',
        tax_id: '', tax_name: '',
        tax_percentage: 0,
        sales_tax_rule_id: STANDARD_RULE_ID,
        vendor_id: '', vendor_name: ''
      }
    };

    mocks.zohoApi.fetchAllItems.mockResolvedValue(items);
    mocks.zohoApi.fetchItemDetailsBulk.mockResolvedValue(detailMap);

    return callHandler('/api/products').then(function () {
      var cachedItems = mocks.cache.set.mock.calls
        .filter(function (c) { return c[0] === 'zoho:products'; })
        .map(function (c) { return c[1]; })[0];
      expect(cachedItems).toBeDefined();
      expect(cachedItems[0].tax_percentage).toBe(12); // GST + PST = 12%
      expect(cachedItems[0].tax_name).toBe('GST + PST');
    });
  });

  test('items missing from detailMap get empty defaults without throwing', function () {
    var items = [
      makeItem({ item_id: 'i1', name: 'Wine Kit A' }),
      makeItem({ item_id: 'missing', name: 'Missing Item' })
    ];
    var detailMap = {
      'i1': { item_id: 'i1', custom_fields: [{ label: 'Type', value: 'wine' }], brand: 'A', image_name: '', tax_id: '', tax_name: 'GST', tax_percentage: 12, sales_tax_rule_id: '', vendor_id: '', vendor_name: '' }
    };

    mocks.zohoApi.fetchAllItems.mockResolvedValue(items);
    mocks.zohoApi.fetchItemDetailsBulk.mockResolvedValue(detailMap);

    // Should resolve without throwing even when an item is absent from detailMap
    return expect(callHandler('/api/products')).resolves.toBeDefined();
  });

  test('propagates 429 from fetchItemDetailsBulk so route returns 502', function () {
    var items = [makeItem({ item_id: 'i1', name: 'Wine Kit A' })];
    var err429 = new Error('Rate limited');
    err429.response = { status: 429, headers: {} };

    mocks.zohoApi.fetchAllItems.mockResolvedValue(items);
    mocks.zohoApi.fetchItemDetailsBulk.mockRejectedValue(err429);

    return callHandler('/api/products').then(function (res) {
      expect(res._status).toBe(502);
    });
  });

  test('enriches manufacturer from detail.manufacturer field', function () {
    var items = [makeItem({ item_id: 'i1', name: 'Wine Kit A' })];
    var detailMap = {
      'i1': {
        item_id: 'i1',
        custom_fields: [{ label: 'Type', value: 'wine' }],
        brand: 'Chardonnay',
        manufacturer: 'RJS Craft Winemaking',
        image_name: '',
        tax_id: '',
        tax_name: 'GST',
        tax_percentage: 12,
        sales_tax_rule_id: '',
        vendor_id: '',
        vendor_name: ''
      }
    };

    mocks.zohoApi.fetchAllItems.mockResolvedValue(items);
    mocks.zohoApi.fetchItemDetailsBulk.mockResolvedValue(detailMap);

    return callHandler('/api/products').then(function () {
      var cachedItems = mocks.cache.set.mock.calls
        .filter(function (c) { return c[0] === 'zoho:products'; })
        .map(function (c) { return c[1]; })[0];
      expect(cachedItems).toBeDefined();
      expect(cachedItems[0].manufacturer).toBe('RJS Craft Winemaking');
    });
  });

  test('manufacturer defaults to empty string when manufacturer absent from detail', function () {
    var items = [makeItem({ item_id: 'i1', name: 'Wine Kit A' })];
    var detailMap = {
      'i1': {
        item_id: 'i1',
        custom_fields: [{ label: 'Type', value: 'wine' }],
        brand: 'Chardonnay',
        image_name: '',
        tax_id: '',
        tax_name: 'GST',
        tax_percentage: 12,
        sales_tax_rule_id: '',
        vendor_id: '',
        vendor_name: ''
      }
    };

    mocks.zohoApi.fetchAllItems.mockResolvedValue(items);
    mocks.zohoApi.fetchItemDetailsBulk.mockResolvedValue(detailMap);

    return callHandler('/api/products').then(function () {
      var cachedItems = mocks.cache.set.mock.calls
        .filter(function (c) { return c[0] === 'zoho:products'; })
        .map(function (c) { return c[1]; })[0];
      expect(cachedItems).toBeDefined();
      expect(cachedItems[0].manufacturer).toBe('');
    });
  });

  test('preserves sales_tax_rule_id from list item when detailMap returns null for it', function () {
    // Regression: /itemdetails bulk endpoint does not return sales_tax_rule_id.
    // The list /items endpoint does. The fix ensures we fall back to item.sales_tax_rule_id.
    var items = [makeItem({
      item_id: 'i1',
      name: 'Wine Kit A',
      sales_tax_rule_id: STANDARD_RULE_ID,
      tax_percentage: 0
    })];
    var detailMap = {
      'i1': {
        item_id: 'i1',
        custom_fields: [{ label: 'Type', value: 'wine' }],
        brand: '', image_name: '',
        tax_id: null, tax_name: null,
        tax_percentage: null,
        sales_tax_rule_id: null,
        vendor_id: '', vendor_name: ''
      }
    };

    mocks.zohoApi.fetchAllItems.mockResolvedValue(items);
    mocks.zohoApi.fetchItemDetailsBulk.mockResolvedValue(detailMap);

    return callHandler('/api/products').then(function () {
      var cachedItems = mocks.cache.set.mock.calls
        .filter(function (c) { return c[0] === 'zoho:products'; })
        .map(function (c) { return c[1]; })[0];
      expect(cachedItems).toBeDefined();
      expect(cachedItems[0].sales_tax_rule_id).toBe(STANDARD_RULE_ID);
      expect(cachedItems[0].tax_percentage).toBe(12); // GST + PST = 12%
      expect(cachedItems[0].tax_name).toBe('GST + PST');
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/ingredients — bulk detail enrichment
// ---------------------------------------------------------------------------

describe('GET /api/ingredients — bulk detail enrichment', function () {
  var mocks;

  beforeEach(function () {
    mocks = resetAndLoadCatalog();
    setupDefaultMocks(mocks);
  });

  test('calls fetchItemDetailsBulk instead of inventoryGet for each ingredient', function () {
    var items = [
      makeItem({ item_id: 'ing1', name: 'Yeast', rate: 5, cf_type: 'ingredient' }),
      makeItem({ item_id: 'ing2', name: 'Hops',  rate: 3, cf_type: 'ingredient' })
    ];
    var detailMap = {
      'ing1': { item_id: 'ing1', custom_fields: [], brand: '', tax_id: '', tax_name: '', tax_percentage: 0, sales_tax_rule_id: '' },
      'ing2': { item_id: 'ing2', custom_fields: [], brand: '', tax_id: '', tax_name: '', tax_percentage: 0, sales_tax_rule_id: '' }
    };

    mocks.zohoApi.fetchAllItems.mockResolvedValue(items);
    mocks.zohoApi.fetchItemDetailsBulk.mockResolvedValue(detailMap);

    return callHandler('/api/ingredients').then(function () {
      expect(mocks.zohoApi.fetchItemDetailsBulk).toHaveBeenCalledTimes(1);
      expect(mocks.zohoApi.fetchItemDetailsBulk).toHaveBeenCalledWith(['ing1', 'ing2']);
      expect(mocks.zohoApi.inventoryGet).not.toHaveBeenCalled();
    });
  });

  test('sets tax fields on ingredient items from detailMap', function () {
    var items = [makeItem({ item_id: 'ing1', name: 'Yeast', rate: 5, cf_type: 'ingredient' })];
    var detailMap = {
      'ing1': { item_id: 'ing1', custom_fields: [], brand: '', tax_id: 'tax-zero', tax_name: 'Zero Rated', tax_percentage: 0, sales_tax_rule_id: '' }
    };

    mocks.zohoApi.fetchAllItems.mockResolvedValue(items);
    mocks.zohoApi.fetchItemDetailsBulk.mockResolvedValue(detailMap);

    return callHandler('/api/ingredients').then(function () {
      var cachedItems = mocks.cache.set.mock.calls
        .filter(function (c) { return c[0] === 'zoho:ingredients'; })
        .map(function (c) { return c[1]; })[0];
      if (cachedItems) {
        expect(cachedItems[0].tax_name).toBe('Zero Rated');
        expect(cachedItems[0].tax_percentage).toBe(0);
      }
    });
  });

  test('derives tax_percentage from services rule for ingredient with rule fallback', function () {
    var items = [makeItem({ item_id: 'ing1', name: 'Svc Item', rate: 10, cf_type: 'ingredient' })];
    var detailMap = {
      'ing1': {
        item_id: 'ing1',
        custom_fields: [],
        brand: '',
        tax_id: '', tax_name: '',
        tax_percentage: 0,
        sales_tax_rule_id: SERVICES_RULE_ID
      }
    };

    mocks.zohoApi.fetchAllItems.mockResolvedValue(items);
    mocks.zohoApi.fetchItemDetailsBulk.mockResolvedValue(detailMap);

    return callHandler('/api/ingredients').then(function () {
      var cachedItems = mocks.cache.set.mock.calls
        .filter(function (c) { return c[0] === 'zoho:ingredients'; })
        .map(function (c) { return c[1]; })[0];
      if (cachedItems) {
        expect(cachedItems[0].tax_percentage).toBe(5); // GST only = 5%
        expect(cachedItems[0].tax_name).toBe('GST');
      }
    });
  });

  test('preserves sales_tax_rule_id from list item when detailMap returns null for it', function () {
    // Regression: /itemdetails bulk endpoint does not return sales_tax_rule_id.
    var items = [makeItem({
      item_id: 'ing1',
      name: 'Makers Fee',
      rate: 10,
      cf_type: 'ingredient',
      sales_tax_rule_id: SERVICES_RULE_ID,
      tax_percentage: 0
    })];
    var detailMap = {
      'ing1': {
        item_id: 'ing1',
        custom_fields: [],
        brand: '',
        tax_id: null, tax_name: null,
        tax_percentage: null,
        sales_tax_rule_id: null
      }
    };

    mocks.zohoApi.fetchAllItems.mockResolvedValue(items);
    mocks.zohoApi.fetchItemDetailsBulk.mockResolvedValue(detailMap);

    return callHandler('/api/ingredients').then(function () {
      var cachedItems = mocks.cache.set.mock.calls
        .filter(function (c) { return c[0] === 'zoho:ingredients'; })
        .map(function (c) { return c[1]; })[0];
      if (cachedItems) {
        expect(cachedItems[0].sales_tax_rule_id).toBe(SERVICES_RULE_ID);
        expect(cachedItems[0].tax_percentage).toBe(5);
        expect(cachedItems[0].tax_name).toBe('GST');
      }
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/services — bulk detail enrichment
// ---------------------------------------------------------------------------

describe('GET /api/services — bulk detail enrichment', function () {
  var mocks;

  beforeEach(function () {
    mocks = resetAndLoadCatalog();
    setupDefaultMocks(mocks);
  });

  test('calls fetchItemDetailsBulk instead of sequential inventoryGet', function () {
    var items = [
      makeItem({ item_id: 's1', name: 'Filtering', product_type: 'service' }),
      makeItem({ item_id: 's2', name: 'Racking',   product_type: 'service' })
    ];
    mocks.zohoApi.fetchAllItems.mockResolvedValue(items);
    mocks.zohoApi.fetchItemDetailsBulk.mockResolvedValue({
      's1': { item_id: 's1', tax_id: '', tax_name: 'GST', tax_percentage: 5, sales_tax_rule_id: '' },
      's2': { item_id: 's2', tax_id: '', tax_name: 'GST', tax_percentage: 5, sales_tax_rule_id: '' }
    });

    return callHandler('/api/services').then(function (res) {
      expect(mocks.zohoApi.fetchItemDetailsBulk).toHaveBeenCalledTimes(1);
      expect(mocks.zohoApi.inventoryGet).not.toHaveBeenCalled();
      expect(res._body).toMatchObject({ source: 'zoho' });
      expect(res._body.items).toHaveLength(2);
    });
  });

  test('sets tax_percentage on service items from detailMap', function () {
    var items = [makeItem({ item_id: 's1', name: 'Filtering', product_type: 'service' })];
    mocks.zohoApi.fetchAllItems.mockResolvedValue(items);
    mocks.zohoApi.fetchItemDetailsBulk.mockResolvedValue({
      's1': { item_id: 's1', tax_id: 'svc-tax', tax_name: 'GST', tax_percentage: 5, sales_tax_rule_id: '' }
    });

    return callHandler('/api/services').then(function (res) {
      expect(res._body.items[0].tax_percentage).toBe(5);
      expect(res._body.items[0].tax_name).toBe('GST');
    });
  });

  test('derives tax from services tax rule when tax_percentage is 0', function () {
    var items = [makeItem({ item_id: 's1', name: 'Filtering', product_type: 'service' })];
    mocks.zohoApi.fetchAllItems.mockResolvedValue(items);
    mocks.zohoApi.fetchItemDetailsBulk.mockResolvedValue({
      's1': { item_id: 's1', tax_id: '', tax_name: '', tax_percentage: 0, sales_tax_rule_id: SERVICES_RULE_ID }
    });

    return callHandler('/api/services').then(function (res) {
      expect(res._body.items[0].tax_percentage).toBe(5);
      expect(res._body.items[0].tax_name).toBe('GST');
    });
  });

  test('service items missing from detailMap get defaults without throwing', function () {
    var items = [makeItem({ item_id: 's1', name: 'Filtering', product_type: 'service' })];
    mocks.zohoApi.fetchAllItems.mockResolvedValue(items);
    // Return empty detailMap — item 's1' is absent
    mocks.zohoApi.fetchItemDetailsBulk.mockResolvedValue({});

    return callHandler('/api/services').then(function (res) {
      expect(res._body).not.toBeNull();
      expect(res._body.items[0].tax_percentage).toBe(0);
      expect(res._body.items[0].tax_name).toBe('');
    });
  });

  test('preserves sales_tax_rule_id from list item when detailMap returns null for it', function () {
    // Regression: /itemdetails bulk endpoint does not return sales_tax_rule_id.
    // The Makers Fee service item has SERVICES_RULE_ID on the list endpoint only.
    var items = [makeItem({
      item_id: 's1',
      name: 'Makers Fee',
      product_type: 'service',
      sales_tax_rule_id: SERVICES_RULE_ID,
      tax_percentage: 0
    })];
    mocks.zohoApi.fetchAllItems.mockResolvedValue(items);
    mocks.zohoApi.fetchItemDetailsBulk.mockResolvedValue({
      's1': { item_id: 's1', tax_id: null, tax_name: null, tax_percentage: null, sales_tax_rule_id: null }
    });

    return callHandler('/api/services').then(function (res) {
      expect(res._body.items[0].sales_tax_rule_id).toBe(SERVICES_RULE_ID);
      expect(res._body.items[0].tax_percentage).toBe(5);
      expect(res._body.items[0].tax_name).toBe('GST');
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/kiosk/products — tax rule enrichment
// ---------------------------------------------------------------------------

describe('GET /api/kiosk/products — tax rule enrichment', function () {
  var mocks;

  beforeEach(function () {
    mocks = resetAndLoadCatalog();
    setupDefaultMocks(mocks);
  });

  test('enriches tax from detail endpoint when list API returns no tax info', function () {
    var items = [makeItem({
      item_id: 'k1',
      name: 'Wine Kit',
      rate: 200,
      tax_percentage: 0,
      sales_tax_rule_id: '',
      tax_id: '',
      tax_name: ''
    })];
    mocks.zohoApi.fetchAllItems.mockResolvedValue(items);
    mocks.zohoApi.fetchItemDetailsBulk.mockResolvedValue({
      'k1': { tax_id: 'tax-gst-pst', tax_name: 'BC PST + GST', tax_percentage: 12 }
    });

    return callHandler('/api/kiosk/products', { query: {} }).then(function (res) {
      expect(res._body.items[0].tax_percentage).toBe(12);
      expect(res._body.items[0].tax_name).toBe('BC PST + GST');
      expect(res._body.items[0].tax_id).toBe('tax-gst-pst');
    });
  });

  test('sales_tax_rule_id from detail overrides tax_percentage', function () {
    var items = [makeItem({
      item_id: 'k2',
      name: 'Beer Kit',
      rate: 150,
      tax_percentage: 0,
      tax_id: '',
      tax_name: ''
    })];
    mocks.zohoApi.fetchAllItems.mockResolvedValue(items);
    mocks.zohoApi.fetchItemDetailsBulk.mockResolvedValue({
      'k2': { tax_percentage: 5, tax_name: 'GST', sales_tax_rule_id: STANDARD_RULE_ID }
    });

    return callHandler('/api/kiosk/products', { query: {} }).then(function (res) {
      expect(res._body.items[0].tax_percentage).toBe(12);
      expect(res._body.items[0].tax_name).toBe('GST + PST');
      expect(res._body.items[0].sales_tax_rule_id).toBe(STANDARD_RULE_ID);
    });
  });

  test('uses taxes array sum when tax_percentage is 0 and no rule', function () {
    var items = [makeItem({ item_id: 'k5', rate: 100, tax_percentage: 0 })];
    mocks.zohoApi.fetchAllItems.mockResolvedValue(items);
    mocks.zohoApi.fetchItemDetailsBulk.mockResolvedValue({
      'k5': { tax_percentage: 0, taxes: [{ tax_percentage: 5 }, { tax_percentage: 7 }] }
    });

    return callHandler('/api/kiosk/products', { query: {} }).then(function (res) {
      expect(res._body.items[0].tax_percentage).toBe(12);
    });
  });

  test('filters out items with rate 0', function () {
    var items = [
      makeItem({ item_id: 'k3', rate: 0 }),
      makeItem({ item_id: 'k4', rate: 10 })
    ];
    mocks.zohoApi.fetchAllItems.mockResolvedValue(items);
    mocks.zohoApi.fetchItemDetailsBulk.mockResolvedValue({
      'k4': { tax_percentage: 5, tax_name: 'GST', tax_id: 'tax-gst' }
    });

    return callHandler('/api/kiosk/products', { query: {} }).then(function (res) {
      expect(res._body.items.length).toBe(1);
      expect(res._body.items[0].item_id).toBe('k4');
    });
  });

  test('calls fetchItemDetailsBulk with sellable item IDs only', function () {
    var items = [
      makeItem({ item_id: 'k6', rate: 50 }),
      makeItem({ item_id: 'k7', rate: 0 }),
      makeItem({ item_id: 'k8', rate: 25 })
    ];
    mocks.zohoApi.fetchAllItems.mockResolvedValue(items);
    mocks.zohoApi.fetchItemDetailsBulk.mockResolvedValue({});

    return callHandler('/api/kiosk/products', { query: {} }).then(function () {
      expect(mocks.zohoApi.fetchItemDetailsBulk).toHaveBeenCalledWith(['k6', 'k8']);
    });
  });

  test('enriches manufacturer from detail.manufacturer in kiosk product response', function () {
    var items = [makeItem({
      item_id: 'k9',
      name: 'White Wine Kit',
      rate: 220,
      tax_percentage: 0
    })];
    mocks.zohoApi.fetchAllItems.mockResolvedValue(items);
    mocks.zohoApi.fetchItemDetailsBulk.mockResolvedValue({
      'k9': {
        tax_percentage: 12,
        tax_name: 'BC PST + GST',
        manufacturer: 'Winexpert'
      }
    });

    return callHandler('/api/kiosk/products', { query: {} }).then(function (res) {
      expect(res._body.items[0].manufacturer).toBe('Winexpert');
    });
  });
});
