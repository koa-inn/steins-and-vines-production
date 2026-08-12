'use strict';

// ---------------------------------------------------------------------------
// pos-cancel-orphan.test.js — Phase 68-02 regression tests
//
// Closes the cancel/orphan-charge window: /api/pos/cancel -> helcimLib.cancelTerminal()
// was a no-op, and the client stops polling the instant cancel is clicked
// (kiosk-core.js:2925/2925-ish) — so /api/kiosk/sale/status is NEVER reached for
// the real "cancel, then terminal approves anyway" scenario. The only channel
// that resolves an approved terminal result independent of the client is the
// Helcim WEBHOOK (processCardTransactionResult, webhooks.js). This suite proves
// the fix is wired to that reachable path, not the unreachable poll endpoint.
//
// (a) POST /api/pos/cancel writes a KIOSK_CANCELLED_PREFIX + refNumber flag.
// (b) An APPROVED webhook event for a CANCELLED ref voids immediately via
//     moneyPath.voidWithTimeout (amount sourced from the KIOSK_PENDING_CHARGE
//     record) and does NOT proceed to reconcile.reconcilePendingCharge (the
//     normal booking/backstop path) for that ref.
// (c) The SAME APPROVED event for a NON-cancelled ref is completely unchanged:
//     reconcile.reconcilePendingCharge runs, voidWithTimeout is never called.
// (d) A cancel that never yields an APPROVED webhook produces no void.
//
// Harness mirrors webhook-wr07.test.js (full server via supertest — proves the
// route wiring end-to-end, not just an isolated handler function).
// ---------------------------------------------------------------------------

jest.mock('../lib/reconcile', function () {
  return {
    reconcilePendingCharge: jest.fn().mockResolvedValue(),
    sweepPendingCharges: jest.fn().mockResolvedValue()
  };
});

jest.mock('../lib/money-path', function () {
  return {
    acquireIdempotencyLock: jest.fn().mockResolvedValue({ status: 'acquired' }),
    voidWithTimeout: jest.fn().mockResolvedValue(),
    CHECKOUT_IDEMPOTENCY_TTL: 600
  };
});

jest.mock('../lib/helcim', function () {
  return {
    verifyWebhookSignature: jest.fn().mockReturnValue(true),
    isEnabled: jest.fn().mockReturnValue(false),
    isTerminalEnabled: jest.fn().mockReturnValue(false),
    getDeviceCode: jest.fn().mockReturnValue('DEV-6802'),
    getDepositAmount: jest.fn().mockReturnValue(0),
    getTerminalDiagnostics: jest.fn().mockReturnValue({}),
    init: jest.fn(),
    initializeCheckout: jest.fn().mockResolvedValue({ checkoutToken: '' }),
    voidTransaction: jest.fn().mockResolvedValue({ ok: true }),
    refundTransaction: jest.fn().mockResolvedValue({ ok: true }),
    cancelTerminal: jest.fn().mockResolvedValue({ ok: false, device_cancel_required: true }),
    generateIdempotencyKey: jest.fn().mockReturnValue('idem-6802-1'),
    terminalPurchase: jest.fn().mockResolvedValue({ idempotencyKey: 'idem-6802-2' }),
    pollTerminalResult: jest.fn().mockResolvedValue({ status: 'pending', transactionId: null, approved: false, cardType: '' }),
    getCardTransactionById: jest.fn().mockResolvedValue({ status: 'APPROVED', invoiceNumber: '', cardType: 'Visa' }),
    getPendingInvoiceForDevice: jest.fn().mockResolvedValue(null)
  };
});

jest.mock('../lib/zohoAuth', function () {
  return { init: jest.fn().mockResolvedValue(), isAuthenticated: jest.fn().mockReturnValue(true) };
});
jest.mock('../lib/validateEnv', function () { return jest.fn(); });
jest.mock('../lib/checkRedis', function () { return jest.fn().mockResolvedValue(); });
jest.mock('../lib/checkMailer', function () { return jest.fn(); });
jest.mock('../lib/brewpad-integration', function () {
  return {
    syncBatch: jest.fn(),
    init: jest.fn(),
    createBatchesFromSale: jest.fn(),
    detectRecipeSale: jest.fn(),
    retryPendingBatches: jest.fn().mockResolvedValue(),
    retrySyncQueue: jest.fn().mockResolvedValue()
  };
});
jest.mock('node-cron', function () { return { schedule: jest.fn() }; });
jest.mock('@sentry/node', function () {
  return { init: jest.fn(), setupExpressErrorHandler: jest.fn(), captureException: jest.fn() };
});
jest.mock('../lib/cache', function () {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    acquireLock: jest.fn().mockResolvedValue(true),
    releaseLock: jest.fn().mockResolvedValue(),
    isConnected: jest.fn().mockReturnValue(false),
    init: jest.fn().mockResolvedValue(),
    quit: jest.fn().mockResolvedValue(),
    getClient: jest.fn().mockResolvedValue({ keys: jest.fn().mockResolvedValue([]) })
  };
});
jest.mock('../lib/eventLog', function () { return { logEvent: jest.fn() }; });
jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
});

process.env.KIOSK_DEVICE_TOKEN = 'test-kiosk-device-token-6802';

var request = require('supertest');
var helcim = require('../lib/helcim');
var cacheLib = require('../lib/cache');
var reconcileLib = require('../lib/reconcile');
var moneyPath = require('../lib/money-path');
var C = require('../lib/constants');
var app = require('../server');

var DEVICE_TOKEN = 'test-kiosk-device-token-6802';

function flushPromises() {
  return new Promise(function (resolve) { setTimeout(resolve, 0); })
    .then(function () { return new Promise(function (resolve) { setTimeout(resolve, 0); }); });
}

describe('68-02: cancel/orphan-charge safety (webhook-anchored)', function () {
  beforeEach(function () {
    jest.clearAllMocks();
    cacheLib.get.mockResolvedValue(null);
    cacheLib.set.mockResolvedValue('OK');
    cacheLib.del.mockResolvedValue(1);
    cacheLib.acquireLock.mockResolvedValue(true);
    cacheLib.releaseLock.mockResolvedValue();
    cacheLib.isConnected.mockReturnValue(false);
    helcim.verifyWebhookSignature.mockReturnValue(true);
    helcim.getDeviceCode.mockReturnValue('DEV-6802');
    helcim.cancelTerminal.mockResolvedValue({ ok: false, device_cancel_required: true });
    helcim.getPendingInvoiceForDevice.mockResolvedValue(null);
    reconcileLib.reconcilePendingCharge.mockResolvedValue();
    moneyPath.voidWithTimeout.mockResolvedValue();
  });

  // -------------------------------------------------------------------------
  // (a) /api/pos/cancel writes the cancelled-flag keyed by reference_number
  // -------------------------------------------------------------------------
  test('(a) POST /api/pos/cancel with a reference_number writes a KIOSK_CANCELLED_PREFIX flag', function () {
    var REF = 'KIOSK-CANCEL-A001';
    return request(app)
      .post('/api/pos/cancel')
      .set('x-device-token', DEVICE_TOKEN)
      .send({ reference_number: REF })
      .expect(200)
      .then(function () { return flushPromises(); })
      .then(function () {
        var flagCall = cacheLib.set.mock.calls.find(function (c) {
          return c[0] === C.CACHE_KEYS.KIOSK_CANCELLED_PREFIX + REF;
        });
        expect(flagCall).toBeDefined();
      });
  });

  // -------------------------------------------------------------------------
  // (b) APPROVED webhook for a CANCELLED ref -> immediate void, no booking
  // -------------------------------------------------------------------------
  test('(b) APPROVED webhook for a cancelled ref voids via moneyPath.voidWithTimeout and skips reconcile booking', function () {
    var REF = 'KIOSK-CANCEL-B002';
    var TXN = 'txn-cancel-b002';

    cacheLib.get.mockImplementation(function (key) {
      if (key === C.CACHE_KEYS.KIOSK_CANCELLED_PREFIX + REF) {
        return Promise.resolve({ cancelled_at: new Date().toISOString() });
      }
      if (key === C.CACHE_KEYS.KIOSK_PENDING_CHARGE_PREFIX + REF) {
        return Promise.resolve({
          reference_number: REF,
          amount: 42.5,
          idempotency_key: null,
          created_at: new Date().toISOString()
        });
      }
      return Promise.resolve(null);
    });

    helcim.getCardTransactionById.mockResolvedValue({ status: 'APPROVED', invoiceNumber: REF, cardType: 'Visa' });

    return request(app)
      .post('/api/webhooks/terminal')
      .set('webhook-id', 'wh-cancel-b002')
      .set('webhook-timestamp', '1750002000')
      .set('webhook-signature', 'v1,valid')
      .send({ type: 'cardTransaction', id: TXN })
      .expect(200)
      .then(function () { return flushPromises(); })
      .then(function () {
        expect(moneyPath.voidWithTimeout).toHaveBeenCalled();
        var call = moneyPath.voidWithTimeout.mock.calls[0];
        expect(call[1]).toBe(TXN);   // transactionId
        expect(call[2]).toBe(42.5);  // amount, sourced from the pending-charge record

        expect(reconcileLib.reconcilePendingCharge).not.toHaveBeenCalled();

        var delKeys = cacheLib.del.mock.calls.map(function (c) { return c[0]; });
        expect(delKeys).toContain(C.CACHE_KEYS.KIOSK_CANCELLED_PREFIX + REF);
      });
  });

  // -------------------------------------------------------------------------
  // (c) APPROVED webhook for a NON-cancelled ref -> unchanged (reconcile runs)
  // -------------------------------------------------------------------------
  test('(c) APPROVED webhook for a non-cancelled ref is unchanged: reconcile runs, no void', function () {
    var REF = 'KIOSK-NORMAL-C003';
    var TXN = 'txn-normal-c003';

    cacheLib.get.mockResolvedValue(null); // no cancelled flag, no pending-charge lookup needed here

    helcim.getCardTransactionById.mockResolvedValue({ status: 'APPROVED', invoiceNumber: REF, cardType: 'Visa' });

    return request(app)
      .post('/api/webhooks/terminal')
      .set('webhook-id', 'wh-normal-c003')
      .set('webhook-timestamp', '1750003000')
      .set('webhook-signature', 'v1,valid')
      .send({ type: 'cardTransaction', id: TXN })
      .expect(200)
      .then(function () { return flushPromises(); })
      .then(function () {
        expect(reconcileLib.reconcilePendingCharge).toHaveBeenCalledWith(TXN);
        expect(moneyPath.voidWithTimeout).not.toHaveBeenCalled();
      });
  });

  // -------------------------------------------------------------------------
  // (d) Cancel with no resulting APPROVED webhook -> no void, ever
  // -------------------------------------------------------------------------
  test('(d) cancel with no resulting charge produces no void', function () {
    var REF = 'KIOSK-NOCHARGE-D004';
    return request(app)
      .post('/api/pos/cancel')
      .set('x-device-token', DEVICE_TOKEN)
      .send({ reference_number: REF })
      .expect(200)
      .then(function () { return flushPromises(); })
      .then(function () {
        expect(moneyPath.voidWithTimeout).not.toHaveBeenCalled();
      });
  });
});
