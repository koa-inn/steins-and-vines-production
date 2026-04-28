'use strict';

// Mock all dependencies before requiring the module
jest.mock('express', function () {
  var router = { get: jest.fn(), post: jest.fn(), put: jest.fn() };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});
jest.mock('../lib/helcim', function () {
  return {
    isTerminalEnabled: jest.fn().mockReturnValue(true),
    isEnabled: jest.fn().mockReturnValue(true),
    terminalPurchase: jest.fn().mockResolvedValue({ idempotencyKey: 'idem-1' }),
    pollTerminalResult: jest.fn().mockResolvedValue({
      approved: true,
      transactionId: 'txn-test-123',
      authorizationCode: 'AUTH1',
      cardType: 'Visa'
    }),
    voidTransaction: jest.fn().mockResolvedValue({}),
    getTerminalDiagnostics: jest.fn().mockReturnValue({}),
    generateIdempotencyKey: jest.fn().mockReturnValue('idem-so-1')
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
    del: jest.fn().mockResolvedValue(1)
  };
});
jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
});
jest.mock('../lib/eventLog', function () {
  return { logEvent: jest.fn() };
});
jest.mock('../lib/mailer', function () {
  return { sendVoidFailureAlert: jest.fn() };
});
jest.mock('../lib/inventory-ledger', function () {
  return {
    decrementStock: jest.fn().mockResolvedValue({}),
    reconcileFromZoho: jest.fn()
  };
});
jest.mock('../lib/constants', function () {
  return {
    CACHE_KEYS: {
      KIOSK_PRODUCTS: 'test:kiosk-products',
      RECENT_ORDERS: 'test:recent-orders',
      KIOSK_IDEM_PREFIX: 'test:idem:',
      KIOSK_SALESORDERS: 'test:kiosk-salesorders',
      KIOSK_DISCOUNT_PRESETS: 'test:kiosk-discount-presets',
      CONSIGNMENT_REPORT_PREFIX: 'test:consignment:report:'
    },
    LEDGER_KEYS: {},
    RATE_LIMIT_PREFIX: 'test:rl:'
  };
});

// Catalog items used in tests
var CATALOG_WITH_TAX = [
  {
    item_id: 'item-gst',
    name: 'Wine Kit',
    rate: 100.00,
    stock_on_hand: 10,
    tax_id: 'tax-gst-5',
    tax_name: 'GST 5%',
    tax_percentage: 5,
    custom_fields: []
  },
  {
    item_id: 'item-zero',
    name: 'Gift Card',
    rate: 50.00,
    stock_on_hand: 20,
    tax_id: '',
    tax_name: '',
    tax_percentage: 0,
    custom_fields: []
  },
  {
    item_id: 'item-pst',
    name: 'Cider Kit',
    rate: 80.00,
    stock_on_hand: 5,
    tax_id: 'tax-gst-pst-12',
    tax_name: 'GST+PST 12%',
    tax_percentage: 12,
    custom_fields: []
  }
];

describe('pos routes — per-item tax on line items', function () {
  var cache, zohoApi, helcimLib, router, handlers;

  function getHandlers() {
    jest.resetModules();
    cache = require('../lib/cache');
    zohoApi = require('../lib/zoho-api');
    helcimLib = require('../lib/helcim');
    require('../routes/pos');
    router = require('express').Router();
    handlers = {};
    router.post.mock.calls.forEach(function (call) {
      handlers[call[0]] = call[call.length - 1];
    });
    router.get.mock.calls.forEach(function (call) {
      handlers[call[0]] = call[call.length - 1];
    });
    router.put.mock.calls.forEach(function (call) {
      handlers[call[0]] = call[call.length - 1];
    });
  }

  function mockRes() {
    var res = { json: jest.fn(), status: jest.fn(), headersSent: false };
    res.status.mockReturnValue(res);
    return res;
  }

  beforeEach(function () {
    getHandlers();
    process.env.KIOSK_TAX_RATE = '0.05';
    process.env.KIOSK_CONTACT_ID = 'contact-walkin';
  });

  afterEach(function () {
    delete process.env.KIOSK_TAX_RATE;
    delete process.env.KIOSK_CONTACT_ID;
  });

  // --- processSale tests ---

  describe('/api/kiosk/sale — processSale per-item tax', function () {

    test('lineItems include tax_id when catalogItem has a truthy tax_id', function (done) {
      cache.get.mockResolvedValue(CATALOG_WITH_TAX);
      zohoApi.zohoPost.mockResolvedValue({
        invoice: { invoice_id: 'inv-1', invoice_number: 'INV-001' }
      });

      var req = {
        body: {
          items: [{ item_id: 'item-gst', name: 'Wine Kit', quantity: 1 }]
        }
      };
      var res = mockRes();

      res.json.mockImplementation(function () {
        try {
          // Check that zohoPost was called with invoice payload containing tax_id
          var invoiceCall = zohoApi.zohoPost.mock.calls.find(function (c) {
            return c[0] === '/invoices';
          });
          expect(invoiceCall).toBeTruthy();
          var payload = invoiceCall[1];
          expect(payload.line_items[0].tax_id).toBe('tax-gst-5');
          done();
        } catch (e) { done(e); }
      });
      res.status.mockImplementation(function (code) {
        if (code >= 400) {
          return { json: function (body) { done(new Error('Got status ' + code + ': ' + JSON.stringify(body))); } };
        }
        return res;
      });

      handlers['/api/kiosk/sale'](req, res);
    });

    test('lineItems do NOT include tax_id when catalogItem.tax_id is empty string', function (done) {
      cache.get.mockResolvedValue(CATALOG_WITH_TAX);
      zohoApi.zohoPost.mockResolvedValue({
        invoice: { invoice_id: 'inv-2', invoice_number: 'INV-002' }
      });

      var req = {
        body: {
          items: [{ item_id: 'item-zero', name: 'Gift Card', quantity: 1 }]
        }
      };
      var res = mockRes();

      res.json.mockImplementation(function () {
        try {
          var invoiceCall = zohoApi.zohoPost.mock.calls.find(function (c) {
            return c[0] === '/invoices';
          });
          expect(invoiceCall).toBeTruthy();
          var payload = invoiceCall[1];
          expect(payload.line_items[0]).not.toHaveProperty('tax_id');
          done();
        } catch (e) { done(e); }
      });
      res.status.mockImplementation(function (code) {
        if (code >= 400) {
          return { json: function (body) { done(new Error('Got status ' + code + ': ' + JSON.stringify(body))); } };
        }
        return res;
      });

      handlers['/api/kiosk/sale'](req, res);
    });

    test('grandTotal computed using per-item tax_percentage from catalog (not flat 0.05)', function (done) {
      cache.get.mockResolvedValue(CATALOG_WITH_TAX);
      zohoApi.zohoPost.mockResolvedValue({
        invoice: { invoice_id: 'inv-3', invoice_number: 'INV-003' }
      });

      // item-pst has rate=80, tax_percentage=12 => tax=9.60, total=89.60
      var req = {
        body: {
          items: [{ item_id: 'item-pst', name: 'Cider Kit', quantity: 1 }]
        }
      };
      var res = mockRes();

      res.json.mockImplementation(function () {
        try {
          // terminalPurchase should have been called with grandTotal = 89.60
          var termCall = helcimLib.terminalPurchase.mock.calls[0];
          expect(termCall[0]).toBe(89.60); // 80 + (80 * 0.12) = 89.60
          done();
        } catch (e) { done(e); }
      });
      res.status.mockImplementation(function (code) {
        if (code >= 400) {
          return { json: function (body) { done(new Error('Got status ' + code + ': ' + JSON.stringify(body))); } };
        }
        return res;
      });

      handlers['/api/kiosk/sale'](req, res);
    });

    test('grandTotal uses KIOSK_TAX_RATE fallback when catalogItem has no tax_id AND no tax_percentage', function (done) {
      var catalogNoTax = [{
        item_id: 'item-notax',
        name: 'Mystery Item',
        rate: 100.00,
        stock_on_hand: 10,
        tax_id: '',
        tax_name: '',
        tax_percentage: 0,
        custom_fields: []
      }];
      cache.get.mockResolvedValue(catalogNoTax);
      zohoApi.zohoPost.mockResolvedValue({
        invoice: { invoice_id: 'inv-4', invoice_number: 'INV-004' }
      });

      // KIOSK_TAX_RATE = 0.05, rate=100, so tax=5.00, total=105.00
      var req = {
        body: {
          items: [{ item_id: 'item-notax', name: 'Mystery Item', quantity: 1 }]
        }
      };
      var res = mockRes();

      res.json.mockImplementation(function () {
        try {
          var termCall = helcimLib.terminalPurchase.mock.calls[0];
          expect(termCall[0]).toBe(105.00); // 100 + (100 * 0.05) = 105.00
          done();
        } catch (e) { done(e); }
      });
      res.status.mockImplementation(function (code) {
        if (code >= 400) {
          return { json: function (body) { done(new Error('Got status ' + code + ': ' + JSON.stringify(body))); } };
        }
        return res;
      });

      handlers['/api/kiosk/sale'](req, res);
    });
  });

  // --- confirm endpoint tests ---

  describe('/api/kiosk/sale/confirm — per-item tax', function () {

    test('confirm endpoint lineItems include tax_id same as processSale', function (done) {
      cache.get.mockResolvedValue(CATALOG_WITH_TAX);
      zohoApi.zohoPost.mockResolvedValue({
        invoice: { invoice_id: 'inv-5', invoice_number: 'INV-005' }
      });

      var req = {
        body: {
          items: [
            { item_id: 'item-gst', name: 'Wine Kit', quantity: 2 },
            { item_id: 'item-pst', name: 'Cider Kit', quantity: 1 }
          ],
          transaction_id: 'manual-confirm-test'
        }
      };
      var res = mockRes();

      res.json.mockImplementation(function () {
        try {
          var invoiceCall = zohoApi.zohoPost.mock.calls.find(function (c) {
            return c[0] === '/invoices';
          });
          expect(invoiceCall).toBeTruthy();
          var payload = invoiceCall[1];
          // item-gst should have tax_id
          var gstItem = payload.line_items.find(function (li) { return li.item_id === 'item-gst'; });
          expect(gstItem.tax_id).toBe('tax-gst-5');
          // item-pst should have tax_id
          var pstItem = payload.line_items.find(function (li) { return li.item_id === 'item-pst'; });
          expect(pstItem.tax_id).toBe('tax-gst-pst-12');
          done();
        } catch (e) { done(e); }
      });
      res.status.mockImplementation(function (code) {
        if (code >= 400) {
          return { json: function (body) { done(new Error('Got status ' + code + ': ' + JSON.stringify(body))); } };
        }
        return res;
      });

      handlers['/api/kiosk/sale/confirm'](req, res);
    });

    test('confirm endpoint computes grandTotal with per-item tax', function (done) {
      cache.get.mockResolvedValue(CATALOG_WITH_TAX);
      zohoApi.zohoPost.mockResolvedValue({
        invoice: { invoice_id: 'inv-6', invoice_number: 'INV-006' }
      });

      // item-gst: rate=100, qty=1, tax=5% => subtotal=100, tax=5
      // item-pst: rate=80, qty=1, tax=12% => subtotal=80, tax=9.60
      // Total subtotal=180, total tax=14.60, grandTotal=194.60
      var req = {
        body: {
          items: [
            { item_id: 'item-gst', name: 'Wine Kit', quantity: 1 },
            { item_id: 'item-pst', name: 'Cider Kit', quantity: 1 }
          ],
          transaction_id: 'manual-confirm-tax'
        }
      };
      var res = mockRes();

      res.json.mockImplementation(function (body) {
        try {
          // grandTotal = 180 + 14.60 = 194.60
          expect(body.total).toBe(194.60);
          expect(body.tax_total).toBe(14.60);
          done();
        } catch (e) { done(e); }
      });
      res.status.mockImplementation(function (code) {
        if (code >= 400) {
          return { json: function (body) { done(new Error('Got status ' + code + ': ' + JSON.stringify(body))); } };
        }
        return res;
      });

      handlers['/api/kiosk/sale/confirm'](req, res);
    });
  });
});
