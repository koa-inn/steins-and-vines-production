'use strict';

// ---------------------------------------------------------------------------
// webhook-wr07.test.js — Phase 45 Fix2: WR-07 regression test
//
// WR-07: Webhook API-unavailable fallback assumes APPROVED → phantom-revenue risk.
//   When getCardTransactionById fails but a device-pending invoice is found,
//   the current code calls processCardTransactionResult(txnId, 'APPROVED', ...)
//   unconditionally. If the actual transaction was NOT approved, this sets
//   approved:true in the terminal-result cache, the kiosk poll resolves, and
//   /confirm creates a paid Zoho invoice for an uncaptured payment.
//
// FIX: cache status 'UNCONFIRMED' (approved:false) so the kiosk poll returns
//   { status: 'pending' } and keeps polling/times out to manual-confirm fallback.
//   reconcilePendingCharge must NOT be triggered from the UNCONFIRMED path.
//
// Test:
//   WR-07-A: terminal-result cache must NOT contain "approved":true when
//            getCardTransactionById fails (API down) but device-pending found.
//   WR-07-B: reconcilePendingCharge must NOT be called for UNCONFIRMED status.
//
// Run alone: cd zoho-middleware && npm test -- webhook-wr07
// ---------------------------------------------------------------------------

// Mock reconcile BEFORE server loads so the route test doesn't trigger real reconcile
jest.mock('../lib/reconcile', function () {
  return {
    reconcilePendingCharge: jest.fn().mockResolvedValue(),
    sweepPendingCharges:    jest.fn().mockResolvedValue()
  };
});

// Mock helcim — all methods needed by server startup + webhook route
jest.mock('../lib/helcim', function () {
  return {
    verifyWebhookSignature: jest.fn().mockReturnValue(true),
    isEnabled:             jest.fn().mockReturnValue(false),
    isTerminalEnabled:     jest.fn().mockReturnValue(false),
    getDeviceCode:         jest.fn().mockReturnValue('DEV-WR07'),
    getDepositAmount:      jest.fn().mockReturnValue(0),
    getTerminalDiagnostics:jest.fn().mockReturnValue({}),
    init:                  jest.fn(),
    initializeCheckout:    jest.fn().mockResolvedValue({ checkoutToken: '' }),
    voidTransaction:       jest.fn().mockResolvedValue({ ok: true }),
    refundTransaction:     jest.fn().mockResolvedValue({ ok: true }),
    cancelTerminal:        jest.fn().mockResolvedValue({ ok: false }),
    // Methods needed for the webhook fallback path being tested:
    getCardTransactionById:    jest.fn().mockRejectedValue(new Error('Helcim API unavailable')),
    getPendingInvoiceForDevice:jest.fn().mockResolvedValue('KIOSK-WR07-001'),
    pollTerminalResult:        jest.fn().mockResolvedValue({ status: 'pending', transactionId: null, approved: false, cardType: '' })
  };
});

jest.mock('../lib/zohoAuth', function () {
  return { init: jest.fn().mockResolvedValue(), isAuthenticated: jest.fn().mockReturnValue(true) };
});
jest.mock('../lib/validateEnv', function () { return jest.fn(); });
jest.mock('../lib/checkRedis',  function () { return jest.fn().mockResolvedValue(); });
jest.mock('../lib/checkMailer', function () { return jest.fn(); });
jest.mock('../lib/brewpad-integration', function () {
  return {
    syncBatch: jest.fn(),
    init: jest.fn(),
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
    get:          jest.fn().mockResolvedValue(null),
    set:          jest.fn().mockResolvedValue('OK'),
    del:          jest.fn().mockResolvedValue(1),
    acquireLock:  jest.fn().mockResolvedValue(true),
    releaseLock:  jest.fn().mockResolvedValue(),
    isConnected:  jest.fn().mockReturnValue(false),
    init:         jest.fn().mockResolvedValue(),
    quit:         jest.fn().mockResolvedValue(),
    getClient:    jest.fn().mockResolvedValue({ keys: jest.fn().mockResolvedValue([]) })
  };
});
jest.mock('../lib/eventLog', function () { return { logEvent: jest.fn() }; });
jest.mock('../lib/logger',   function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
});

describe('WR-07: webhook API-failure fallback must NOT synthesize APPROVED', function () {
  var request    = require('supertest');
  var helcim     = require('../lib/helcim');
  var cacheLib   = require('../lib/cache');
  var reconcileLib = require('../lib/reconcile');
  var app        = require('../server');

  var TERMINAL_RESULT_KEY = 'helcim:terminal:result:KIOSK-WR07-001';

  beforeEach(function () {
    jest.clearAllMocks();
    // Restore cache defaults
    cacheLib.get.mockResolvedValue(null);
    cacheLib.set.mockResolvedValue('OK');
    cacheLib.del.mockResolvedValue(1);
    cacheLib.acquireLock.mockResolvedValue(true);
    cacheLib.releaseLock.mockResolvedValue();
    cacheLib.isConnected.mockReturnValue(false);
    // Webhook signature always passes
    helcim.verifyWebhookSignature.mockReturnValue(true);
    helcim.getDeviceCode.mockReturnValue('DEV-WR07');
    // PRIMARY API path: FAILS (simulates Helcim API being down)
    helcim.getCardTransactionById.mockRejectedValue(new Error('Helcim API unavailable'));
    // FALLBACK: device-pending invoice found for correlation
    helcim.getPendingInvoiceForDevice.mockResolvedValue('KIOSK-WR07-001');
    // Reconcile should not fire
    reconcileLib.reconcilePendingCharge.mockResolvedValue();
  });

  // -------------------------------------------------------------------------
  // WR-07-A: API-failure fallback caches UNCONFIRMED, not synthesized APPROVED.
  //
  // Before fix: fallback calls processCardTransactionResult(txnId, 'APPROVED', ...)
  //   → cache.set stores {"approved":true} → FAIL (this test catches the bug).
  // After fix: processCardTransactionResult(txnId, 'UNCONFIRMED', ...)
  //   → cache.set stores {"approved":false} → PASS.
  // -------------------------------------------------------------------------
  test('WR-07-A: API-failure fallback does not cache approved:true (no phantom APPROVED)', function () {
    return request(app)
      .post('/api/webhooks/terminal')
      .set('webhook-id', 'wh-wr07-a')
      .set('webhook-timestamp', '1750001000')
      .set('webhook-signature', 'v1,valid')
      .send({ type: 'cardTransaction', id: 'txn-wr07-001' })
      .expect(200)
      .then(function () {
        // Drain the event loop so the fire-and-forget async handler completes
        return new Promise(function (resolve) { setTimeout(resolve, 0); });
      })
      .then(function () {
        // Find the cache.set call for the terminal result key
        var setCalls = cacheLib.set.mock.calls;
        var terminalCall = null;
        for (var i = 0; i < setCalls.length; i++) {
          if (setCalls[i][0] === TERMINAL_RESULT_KEY) {
            terminalCall = setCalls[i];
            break;
          }
        }

        // The cache entry MUST exist (correlated via device-pending fallback)
        expect(terminalCall).not.toBeNull();

        // The stored value must NOT encode approved:true — that would be a
        // synthesised APPROVED from an API failure (phantom-revenue risk).
        var storedValue = terminalCall[1]; // JSON.stringify({status, transactionId, approved, cardType})
        expect(storedValue).not.toContain('"approved":true');
      });
  });

  // -------------------------------------------------------------------------
  // WR-07-B: reconcilePendingCharge must NOT fire from the UNCONFIRMED path.
  //
  // reconcilePendingCharge is only valid for confirmed APPROVED transactions.
  // Firing it for UNCONFIRMED would attempt to void a charge whose status is
  // still unknown, risking a false-positive void of a genuine approval.
  //
  // Before fix: processCardTransactionResult('APPROVED',...) → reconcile fires.
  // After fix:  processCardTransactionResult('UNCONFIRMED',...) → no reconcile.
  // -------------------------------------------------------------------------
  test('WR-07-B: reconcilePendingCharge not triggered from API-failure fallback path', function () {
    return request(app)
      .post('/api/webhooks/terminal')
      .set('webhook-id', 'wh-wr07-b')
      .set('webhook-timestamp', '1750001001')
      .set('webhook-signature', 'v1,valid')
      .send({ type: 'cardTransaction', id: 'txn-wr07-002' })
      .expect(200)
      .then(function () {
        return new Promise(function (resolve) { setTimeout(resolve, 0); });
      })
      .then(function () {
        // reconcilePendingCharge must NOT have been called
        // (UNCONFIRMED status is not a settled APPROVED — reconcile would void the wrong charge)
        expect(reconcileLib.reconcilePendingCharge).not.toHaveBeenCalled();
      });
  });
});
