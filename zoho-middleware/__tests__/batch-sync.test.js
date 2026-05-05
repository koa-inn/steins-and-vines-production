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

jest.mock('../lib/zoho-api', function () {
  return {
    zohoPut: jest.fn().mockResolvedValue({})
  };
});

// Mock axios (used by callAppsScriptCreateBatch internally)
jest.mock('axios');

var cache = require('../lib/cache');
var log = require('../lib/logger');
var eventLog = require('../lib/eventLog');
var zohoApi = require('../lib/zoho-api');
var brewpadIntegration = require('../lib/brewpad-integration');

describe('syncBatchToZoho', function () {

  beforeEach(function () {
    jest.clearAllMocks();
    cache.isConnected.mockReturnValue(true);
    cache.get.mockResolvedValue(null);
    cache.set.mockResolvedValue();
    cache.del.mockResolvedValue();
    cache.getClient.mockResolvedValue({
      keys: jest.fn().mockResolvedValue([])
    });
    zohoApi.zohoPut.mockResolvedValue({});
    delete process.env.ZOHO_CF_BATCH_STATUS;
  });

  afterEach(function () {
    delete process.env.ZOHO_CF_BATCH_STATUS;
  });

  it('rejects invalid status (not in allowed list)', function () {
    process.env.ZOHO_CF_BATCH_STATUS = 'cf_batch_status';
    return brewpadIntegration.syncBatchToZoho('inv-001', 'SV-B-000123', 'invalid')
      .then(function () {
        throw new Error('Expected rejection');
      })
      .catch(function (err) {
        expect(err.message).toMatch(/Invalid status/);
        expect(err.message).toMatch(/pending.*active.*complete/);
      });
  });

  it('returns { ok: true, skipped: true } when ZOHO_CF_BATCH_STATUS is unset', function () {
    // ZOHO_CF_BATCH_STATUS not set
    return brewpadIntegration.syncBatchToZoho('inv-001', 'SV-B-000123', 'active').then(function (result) {
      expect(result).toEqual({ ok: true, skipped: true });
      expect(zohoApi.zohoPut).not.toHaveBeenCalled();
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('ZOHO_CF_BATCH_STATUS not configured'));
    });
  });

  it('constructs correct statusLabel: "Active — SV-B-000123"', function () {
    process.env.ZOHO_CF_BATCH_STATUS = 'cf_batch_status';
    return brewpadIntegration.syncBatchToZoho('inv-001', 'SV-B-000123', 'active').then(function () {
      var putCall = zohoApi.zohoPut.mock.calls[0];
      var body = putCall[1];
      expect(body.custom_fields[0].value).toBe('Active — SV-B-000123');
    });
  });

  it('calls zohoPut with correct path and custom_fields payload', function () {
    process.env.ZOHO_CF_BATCH_STATUS = 'cf_batch_status';
    return brewpadIntegration.syncBatchToZoho('INV-00123', 'SV-B-000001', 'pending').then(function (result) {
      expect(result).toEqual({ ok: true });
      expect(zohoApi.zohoPut).toHaveBeenCalledWith(
        '/invoices/INV-00123',
        { custom_fields: [{ api_name: 'cf_batch_status', value: 'Pending — SV-B-000001' }] }
      );
    });
  });

  it('queues for retry on zohoPut failure and resolves { ok: false, queued: true }', function () {
    process.env.ZOHO_CF_BATCH_STATUS = 'cf_batch_status';
    zohoApi.zohoPut.mockRejectedValue(new Error('Zoho API error'));
    return brewpadIntegration.syncBatchToZoho('inv-001', 'SV-B-000123', 'complete').then(function (result) {
      expect(result).toEqual({ ok: false, queued: true });
      expect(cache.set).toHaveBeenCalled();
      var setCall = cache.set.mock.calls[0];
      expect(setCall[0]).toMatch(/^brewpad:zoho-sync:/);
      expect(setCall[2]).toBe(86400);
    });
  });

  it('logs zoho_sync_ok event on success', function () {
    process.env.ZOHO_CF_BATCH_STATUS = 'cf_batch_status';
    return brewpadIntegration.syncBatchToZoho('inv-001', 'SV-B-000123', 'active').then(function () {
      expect(eventLog.logEvent).toHaveBeenCalledWith('batch.zoho_sync_ok', expect.objectContaining({
        batchId: 'SV-B-000123',
        soId: 'inv-001',
        status: 'active'
      }));
    });
  });

});

describe('queueSyncForRetry', function () {

  beforeEach(function () {
    jest.clearAllMocks();
    cache.set.mockResolvedValue();
    delete process.env.ZOHO_CF_BATCH_STATUS;
  });

  it('writes Redis key with BATCH_SYNC_RETRY_PREFIX', function () {
    return brewpadIntegration.queueSyncForRetry({ so_id: 'inv-001', batch_id: 'SV-B-000123', status: 'active' }, 'test reason').then(function () {
      expect(cache.set).toHaveBeenCalled();
      var key = cache.set.mock.calls[0][0];
      expect(key).toMatch(/^brewpad:zoho-sync:/);
      expect(key).toContain('SV-B-000123');
    });
  });

  it('stores payload with attempts: 0 and reason', function () {
    return brewpadIntegration.queueSyncForRetry({ so_id: 'inv-001', batch_id: 'SV-B-000123', status: 'pending' }, 'http timeout').then(function () {
      var data = cache.set.mock.calls[0][1];
      expect(data.attempts).toBe(0);
      expect(data.reason).toBe('http timeout');
      expect(data.payload.batch_id).toBe('SV-B-000123');
    });
  });

  it('sets 86400 TTL', function () {
    return brewpadIntegration.queueSyncForRetry({ so_id: 'inv-001', batch_id: 'SV-B-000001', status: 'pending' }, 'err').then(function () {
      expect(cache.set.mock.calls[0][2]).toBe(86400);
    });
  });

  it('logs zoho_sync_retry_queued event', function () {
    return brewpadIntegration.queueSyncForRetry({ so_id: 'inv-001', batch_id: 'SV-B-000123', status: 'active' }, 'zoho_down').then(function () {
      expect(eventLog.logEvent).toHaveBeenCalledWith('batch.zoho_sync_retry_queued', expect.objectContaining({
        batchId: 'SV-B-000123',
        reason: 'zoho_down'
      }));
    });
  });

});

describe('retrySyncQueue', function () {

  beforeEach(function () {
    jest.clearAllMocks();
    cache.isConnected.mockReturnValue(true);
    cache.get.mockResolvedValue(null);
    cache.set.mockResolvedValue();
    cache.del.mockResolvedValue();
    cache.getClient.mockResolvedValue({
      keys: jest.fn().mockResolvedValue([])
    });
    zohoApi.zohoPut.mockResolvedValue({});
    delete process.env.ZOHO_CF_BATCH_STATUS;
    process.env.ZOHO_CF_BATCH_STATUS = 'cf_batch_status';
  });

  afterEach(function () {
    delete process.env.ZOHO_CF_BATCH_STATUS;
  });

  it('skips when Redis is not connected', function () {
    cache.isConnected.mockReturnValue(false);
    return brewpadIntegration.retrySyncQueue().then(function () {
      expect(cache.getClient).not.toHaveBeenCalled();
    });
  });

  it('does nothing when no pending keys exist', function () {
    return brewpadIntegration.retrySyncQueue().then(function () {
      expect(cache.get).not.toHaveBeenCalled();
    });
  });

  it('deletes keys after MAX_RETRIES (3) exceeded', function () {
    cache.getClient.mockResolvedValue({
      keys: jest.fn().mockResolvedValue(['brewpad:zoho-sync:123-SV-B-000001'])
    });
    cache.get.mockResolvedValue({
      payload: { so_id: 'inv-001', batch_id: 'SV-B-000001', status: 'active' },
      attempts: 3,
      reason: 'test'
    });

    return brewpadIntegration.retrySyncQueue().then(function () {
      expect(cache.del).toHaveBeenCalledWith('brewpad:zoho-sync:123-SV-B-000001');
      expect(eventLog.logEvent).toHaveBeenCalledWith('batch.zoho_sync_retry_exhausted', expect.objectContaining({
        batchId: 'SV-B-000001'
      }));
    });
  });

  it('retries and deletes key on success', function () {
    cache.getClient.mockResolvedValue({
      keys: jest.fn().mockResolvedValue(['brewpad:zoho-sync:456-SV-B-000002'])
    });
    cache.get.mockResolvedValue({
      payload: { so_id: 'inv-002', batch_id: 'SV-B-000002', status: 'pending' },
      attempts: 1,
      reason: 'test'
    });

    return brewpadIntegration.retrySyncQueue().then(function () {
      expect(zohoApi.zohoPut).toHaveBeenCalled();
      expect(cache.del).toHaveBeenCalledWith('brewpad:zoho-sync:456-SV-B-000002');
    });
  });

  it('re-queues key when retry fails', function () {
    cache.getClient.mockResolvedValue({
      keys: jest.fn().mockResolvedValue(['brewpad:zoho-sync:789-SV-B-000003'])
    });
    cache.get.mockResolvedValue({
      payload: { so_id: 'inv-003', batch_id: 'SV-B-000003', status: 'complete' },
      attempts: 0,
      reason: 'initial'
    });
    zohoApi.zohoPut.mockRejectedValue(new Error('Zoho down'));

    return brewpadIntegration.retrySyncQueue().then(function () {
      // syncBatchToZoho catches the error and calls queueSyncForRetry internally,
      // which calls cache.set. The retry sweep then also saves updated attempt count.
      expect(cache.set).toHaveBeenCalled();
    });
  });

  it('cleans up corrupted retry entries (missing payload)', function () {
    cache.getClient.mockResolvedValue({
      keys: jest.fn().mockResolvedValue(['brewpad:zoho-sync:000-bad'])
    });
    cache.get.mockResolvedValue({ payload: null, attempts: 0 });

    return brewpadIntegration.retrySyncQueue().then(function () {
      expect(cache.del).toHaveBeenCalledWith('brewpad:zoho-sync:000-bad');
    });
  });

});
