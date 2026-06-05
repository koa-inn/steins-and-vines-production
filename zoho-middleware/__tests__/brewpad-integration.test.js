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
var log = require('../lib/logger');
var eventLog = require('../lib/eventLog');
var brewpadIntegration = require('../lib/brewpad-integration');

describe('brewpad-integration', function () {

  beforeEach(function () {
    jest.clearAllMocks();
    // Re-set mock implementations that clearAllMocks does not reset
    cache.isConnected.mockReturnValue(true);
    cache.get.mockResolvedValue(null);
    cache.set.mockResolvedValue();
    cache.del.mockResolvedValue();
    cache.getClient.mockResolvedValue({
      keys: jest.fn().mockResolvedValue([])
    });
    process.env.APPS_SCRIPT_URL = 'https://script.google.com/test';
    process.env.APPS_SCRIPT_SERVER_TOKEN = 'test-token';
    process.env.MAKERS_FEE_ITEM_ID = '';
    process.env.MATERIALS_FEE_ITEM_ID = '';
  });

  afterEach(function () {
    delete process.env.APPS_SCRIPT_URL;
    delete process.env.APPS_SCRIPT_SERVER_TOKEN;
    delete process.env.MAKERS_FEE_ITEM_ID;
    delete process.env.MATERIALS_FEE_ITEM_ID;
  });

  describe('detectKitItems', function () {

    it('returns empty array when no Makers Fee item found', function () {
      var items = [
        { name: 'Red Wine Kit', sku: 'RW-001', item_id: '1' },
        { name: 'Bottles 24-pack', sku: 'BTL-24', item_id: '2' }
      ];
      var result = brewpadIntegration.detectKitItems(items);
      expect(result).toEqual([]);
    });

    it('returns kit items when Makers Fee is present (by name)', function () {
      var items = [
        { name: 'Red Wine Kit', sku: 'RW-001', item_id: '1' },
        { name: "Maker's Fee", sku: 'MAKERS-FEE', item_id: '99' }
      ];
      var result = brewpadIntegration.detectKitItems(items);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Red Wine Kit');
    });

    it('returns multiple kit items when multiple kits purchased', function () {
      var items = [
        { name: 'Red Wine Kit', sku: 'RW-001', item_id: '1' },
        { name: 'Beer Kit', sku: 'BK-001', item_id: '2' },
        { name: "Maker's Fee", sku: 'MAKERS-FEE', item_id: '99' }
      ];
      var result = brewpadIntegration.detectKitItems(items);
      expect(result).toHaveLength(2);
    });

    it('returns empty array for null/empty input', function () {
      expect(brewpadIntegration.detectKitItems(null)).toEqual([]);
      expect(brewpadIntegration.detectKitItems([])).toEqual([]);
    });

    it('detects Makers Fee by MAKERS_FEE_ITEM_ID env var', function () {
      process.env.MAKERS_FEE_ITEM_ID = 'fee-item-42';
      var items = [
        { name: 'Wine Kit', sku: 'WK-1', item_id: 'kit-1' },
        { name: 'Some Service', sku: 'SVC-1', item_id: 'fee-item-42' }
      ];
      var result = brewpadIntegration.detectKitItems(items);
      expect(result).toHaveLength(1);
      expect(result[0].item_id).toBe('kit-1');
    });

    it('excludes Materials Fee from kit items (by name)', function () {
      var items = [
        { name: 'Red Wine Kit', sku: 'RW-001', item_id: '1' },
        { name: 'Makers Fee', sku: 'MAKERS-FEE', item_id: '99' },
        { name: 'Materials Fee', sku: 'MAT-FEE', item_id: '100' }
      ];
      var result = brewpadIntegration.detectKitItems(items);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Red Wine Kit');
    });

    it('excludes Materials Fee even without sku field (kiosk line items)', function () {
      // Real kiosk line items don't have sku — detection by name only
      var items = [
        { item_id: 'kit1', name: 'Grand Cru International Merlot', quantity: 1, rate: 135 },
        { item_id: '109900000000046478', name: 'Makers Fee', quantity: 1, rate: 45 },
        { item_id: '109900000000515004', name: 'Materials Fee', quantity: 1, rate: 5 }
      ];
      var result = brewpadIntegration.detectKitItems(items);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Grand Cru International Merlot');
    });

    it('excludes Materials Fee by MATERIALS_FEE_ITEM_ID env var', function () {
      process.env.MATERIALS_FEE_ITEM_ID = 'mat-fee-99';
      var items = [
        { name: 'Wine Kit', item_id: 'kit-1' },
        { name: 'Makers Fee', item_id: 'fee-1' },
        { name: 'Other Service', item_id: 'mat-fee-99' }
      ];
      var result = brewpadIntegration.detectKitItems(items);
      expect(result).toHaveLength(1);
      expect(result[0].item_id).toBe('kit-1');
    });

  });

  describe('splitCustomerName', function () {

    it('splits "Jane Doe" into first=Jane, last=Doe', function () {
      var result = brewpadIntegration.splitCustomerName('Jane Doe');
      expect(result).toEqual({ first: 'Jane', last: 'Doe' });
    });

    it('handles single name "Jane" as first=Jane, last=""', function () {
      var result = brewpadIntegration.splitCustomerName('Jane');
      expect(result).toEqual({ first: 'Jane', last: '' });
    });

    it('handles multi-part last "Mary Jane Watson" as first=Mary, last=Jane Watson', function () {
      var result = brewpadIntegration.splitCustomerName('Mary Jane Watson');
      expect(result).toEqual({ first: 'Mary', last: 'Jane Watson' });
    });

    it('handles empty string as first="", last=""', function () {
      var result = brewpadIntegration.splitCustomerName('');
      expect(result).toEqual({ first: '', last: '' });
    });

    it('trims whitespace', function () {
      var result = brewpadIntegration.splitCustomerName('  Jane   Doe  ');
      expect(result).toEqual({ first: 'Jane', last: 'Doe' });
    });

  });

  describe('createBatchesFromSale', function () {

    it('does nothing when no Makers Fee is present', function () {
      var items = [{ name: 'Wine Kit', sku: 'WK-1' }];
      brewpadIntegration.createBatchesFromSale(items, 'INV-001', 'John', 'C-1', null);
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('calls Apps Script for each kit item when Makers Fee is present', function () {
      axios.post.mockResolvedValue({ data: { ok: true, batch_id: 'SV-B-000001' } });
      var items = [
        { name: 'Red Wine Kit', sku: 'RW-001', item_id: '1' },
        { name: 'Beer Kit', sku: 'BK-001', item_id: '2' },
        { name: "Maker's Fee", sku: 'MAKERS-FEE', item_id: '99' }
      ];
      brewpadIntegration.createBatchesFromSale(items, 'INV-001', 'Jane Doe', 'C-123', null);
      expect(axios.post).toHaveBeenCalledTimes(2);
      // Verify first/last name split in payload
      var callPayload = JSON.parse(axios.post.mock.calls[0][1]);
      expect(callPayload.customer_firstname).toBe('Jane');
      expect(callPayload.customer_lastname).toBe('Doe');
    });

    it('does not create batch for Materials Fee item', function () {
      axios.post.mockResolvedValue({ data: { ok: true, batch_id: 'SV-B-000001' } });
      var items = [
        { name: 'Red Wine Kit', sku: 'RW-001', item_id: '1' },
        { name: "Maker's Fee", sku: 'MAKERS-FEE', item_id: '99' },
        { name: 'Materials Fee', sku: 'MAT-FEE', item_id: '100' }
      ];
      brewpadIntegration.createBatchesFromSale(items, 'INV-001', 'Jane', 'C-1', null);
      // Only 1 batch created (Red Wine Kit), not 2 (which would include Materials Fee)
      expect(axios.post).toHaveBeenCalledTimes(1);
      var callPayload = JSON.parse(axios.post.mock.calls[0][1]);
      expect(callPayload.product_name).toBe('Red Wine Kit');
    });

    it('uses Walk-in Customer when customerName is empty', function () {
      axios.post.mockResolvedValue({ data: { ok: true, batch_id: 'SV-B-000001' } });
      var items = [
        { name: 'Wine Kit', sku: 'WK-1', item_id: '1' },
        { name: "Maker's Fee", sku: 'MAKERS-FEE', item_id: '99' }
      ];
      brewpadIntegration.createBatchesFromSale(items, 'INV-001', '', '', null);
      var callPayload = JSON.parse(axios.post.mock.calls[0][1]);
      expect(callPayload.customer_name).toBe('Walk-in Customer');
      expect(callPayload.customer_firstname).toBe('Walk-in');
      expect(callPayload.customer_lastname).toBe('Customer');
    });

    it('does not include customer_email in payload', function () {
      axios.post.mockResolvedValue({ data: { ok: true, batch_id: 'SV-B-000001' } });
      var items = [
        { name: 'Wine Kit', sku: 'WK-1', item_id: '1' },
        { name: "Maker's Fee", sku: 'MAKERS-FEE', item_id: '99' }
      ];
      brewpadIntegration.createBatchesFromSale(items, 'INV-001', 'Jane', 'C-1', null);
      var callPayload = JSON.parse(axios.post.mock.calls[0][1]);
      expect(callPayload.customer_email).toBeUndefined();
    });

    it('sets source to online and stores customer_email for online sales', function () {
      axios.post.mockResolvedValue({ data: { ok: true, batch_id: 'SV-B-000001' } });
      var items = [
        { name: 'Wine Kit', sku: 'WK-1', item_id: '1' },
        { name: "Maker's Fee", sku: 'MAKERS-FEE', item_id: '99' }
      ];
      brewpadIntegration.createBatchesFromSale(items, 'INV-001', 'Jane', 'C-1', null, 'SO-ID-1', 'online', 'jane@example.com');
      var callPayload = JSON.parse(axios.post.mock.calls[0][1]);
      expect(callPayload.source).toBe('online');
      expect(callPayload.customer_email).toBe('jane@example.com');
    });

    it('sets source to kiosk and includes zoho_so_number in payload', function () {
      axios.post.mockResolvedValue({ data: { ok: true, batch_id: 'SV-B-000001' } });
      var items = [
        { name: 'Wine Kit', sku: 'WK-1', item_id: '1' },
        { name: "Maker's Fee", sku: 'MAKERS-FEE', item_id: '99' }
      ];
      brewpadIntegration.createBatchesFromSale(items, 'INV-001', 'Jane', 'C-1', null);
      var callPayload = JSON.parse(axios.post.mock.calls[0][1]);
      expect(callPayload.source).toBe('kiosk');
      expect(callPayload.zoho_so_number).toBe('INV-001');
    });

  });

  describe('callAppsScriptCreateBatch', function () {

    it('skips when APPS_SCRIPT_URL is not set', function () {
      delete process.env.APPS_SCRIPT_URL;
      return brewpadIntegration.callAppsScriptCreateBatch({ product_sku: 'WK-1' }).then(function (result) {
        expect(axios.post).not.toHaveBeenCalled();
        expect(result.ok).toBe(false);
        expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('not configured'));
      });
    });

    it('skips when APPS_SCRIPT_SERVER_TOKEN is not set', function () {
      delete process.env.APPS_SCRIPT_SERVER_TOKEN;
      return brewpadIntegration.callAppsScriptCreateBatch({ product_sku: 'WK-1' }).then(function (result) {
        expect(axios.post).not.toHaveBeenCalled();
        expect(result.ok).toBe(false);
      });
    });

    it('queues for retry on HTTP error (default skipRetryQueue=false)', function () {
      axios.post.mockRejectedValue(new Error('Network timeout'));
      return brewpadIntegration.callAppsScriptCreateBatch({
        product_sku: 'WK-1',
        zoho_so_number: 'INV-001'
      }).then(function (result) {
        expect(result.ok).toBe(false);
        expect(cache.set).toHaveBeenCalled();
        var setCall = cache.set.mock.calls[0];
        expect(setCall[0]).toMatch(/^brewpad:pending-batch:/);
        expect(setCall[2]).toBe(86400);
      });
    });

    it('does NOT queue for retry when skipRetryQueue=true', function () {
      axios.post.mockRejectedValue(new Error('Network timeout'));
      return brewpadIntegration.callAppsScriptCreateBatch({
        product_sku: 'WK-1',
        zoho_so_number: 'INV-001'
      }, true).then(function (result) {
        expect(result.ok).toBe(false);
        expect(cache.set).not.toHaveBeenCalled();
      });
    });

    it('queues for retry when Apps Script returns ok:false', function () {
      axios.post.mockResolvedValue({ data: { ok: false, error: 'sheet_locked' } });
      return brewpadIntegration.callAppsScriptCreateBatch({
        product_sku: 'WK-1',
        zoho_so_number: 'INV-001'
      }).then(function (result) {
        expect(result.ok).toBe(false);
        expect(cache.set).toHaveBeenCalled();
      });
    });

    it('logs success event on ok response', function () {
      axios.post.mockResolvedValue({ data: { ok: true, batch_id: 'SV-B-000001' } });
      return brewpadIntegration.callAppsScriptCreateBatch({
        product_sku: 'WK-1',
        zoho_so_number: 'INV-001'
      }).then(function (result) {
        expect(result.ok).toBe(true);
        expect(result.batch_id).toBe('SV-B-000001');
        expect(eventLog.logEvent).toHaveBeenCalledWith('kiosk.batch_created', expect.objectContaining({
          invoiceNumber: 'INV-001',
          batchId: 'SV-B-000001'
        }));
      });
    });

    it('sends create_batch action with server_token in payload', function () {
      axios.post.mockResolvedValue({ data: { ok: true, batch_id: 'SV-B-000001' } });
      return brewpadIntegration.callAppsScriptCreateBatch({
        product_sku: 'WK-1',
        zoho_so_number: 'INV-001'
      }).then(function () {
        var callPayload = JSON.parse(axios.post.mock.calls[0][1]);
        expect(callPayload.action).toBe('create_batch');
        expect(callPayload.server_token).toBe('test-token');
      });
    });

  });

  describe('retryPendingBatches', function () {

    it('does nothing when Redis is not connected', function () {
      cache.isConnected.mockReturnValue(false);
      return brewpadIntegration.retryPendingBatches().then(function () {
        expect(cache.getClient).not.toHaveBeenCalled();
      });
    });

    it('does nothing when no pending keys exist', function () {
      return brewpadIntegration.retryPendingBatches().then(function () {
        expect(cache.get).not.toHaveBeenCalled();
      });
    });

    it('retries and deletes key on success', function () {
      cache.getClient.mockResolvedValue({
        keys: jest.fn().mockResolvedValue(['brewpad:pending-batch:123-INV-001'])
      });
      cache.get.mockResolvedValue({
        payload: { product_sku: 'WK-1', zoho_so_number: 'INV-001' },
        attempts: 1,
        reason: 'test'
      });
      axios.post.mockResolvedValue({ data: { ok: true, batch_id: 'SV-B-000001' } });

      return brewpadIntegration.retryPendingBatches().then(function () {
        expect(cache.del).toHaveBeenCalledWith('brewpad:pending-batch:123-INV-001');
      });
    });

    it('deletes keys after max retries exceeded', function () {
      cache.getClient.mockResolvedValue({
        keys: jest.fn().mockResolvedValue(['brewpad:pending-batch:123-INV-001'])
      });
      cache.get.mockResolvedValue({
        payload: { product_sku: 'WK-1', zoho_so_number: 'INV-001' },
        attempts: 3,
        reason: 'test'
      });

      return brewpadIntegration.retryPendingBatches().then(function () {
        expect(cache.del).toHaveBeenCalledWith('brewpad:pending-batch:123-INV-001');
        expect(eventLog.logEvent).toHaveBeenCalledWith('kiosk.batch_retry_exhausted', expect.anything());
      });
    });

    it('re-queues key when retry fails with Apps Script error', function () {
      cache.getClient.mockResolvedValue({
        keys: jest.fn().mockResolvedValue(['brewpad:pending-batch:456-INV-002'])
      });
      cache.get.mockResolvedValue({
        payload: { product_sku: 'WK-1', zoho_so_number: 'INV-002' },
        attempts: 0,
        reason: 'initial failure'
      });
      axios.post.mockResolvedValue({ data: { ok: false, error: 'still_broken' } });

      return brewpadIntegration.retryPendingBatches().then(function () {
        // Should update retry data with incremented attempts
        expect(cache.set).toHaveBeenCalledWith(
          'brewpad:pending-batch:456-INV-002',
          expect.objectContaining({ attempts: 1 }),
          86400
        );
      });
    });

    it('cleans up corrupted retry entries (missing payload)', function () {
      cache.getClient.mockResolvedValue({
        keys: jest.fn().mockResolvedValue(['brewpad:pending-batch:789-INV-003'])
      });
      cache.get.mockResolvedValue({ payload: null, attempts: 0 });

      return brewpadIntegration.retryPendingBatches().then(function () {
        expect(cache.del).toHaveBeenCalledWith('brewpad:pending-batch:789-INV-003');
      });
    });

  });

});
