'use strict';

// ---------------------------------------------------------------------------
// reconcile-giftcard-pending.test.js — Phase 84 Plan 06, D-11
//
// Pins the durable pending-record + replay-sweep safety net for a gift-card
// write that fails AFTER the customer has already been charged:
//   recordGiftCardReconcileFailure(record) — never rejects, writes a durable
//     Redis record keyed by tx_ref (NOT Date.now()), logs CRITICAL, emits a
//     Sentry error and a staff alert email. The regression test asserts the
//     cache.set record itself, not a log line (MONEY-03 H6 rule).
//   sweepGiftCardPending(deps) — every 5 minutes, replays each pending
//     record through the gift-card store via the stored tx_ref. Success
//     deletes the key; a business rejection marks manual_review_required and
//     alerts; an infrastructure failure leaves it for the next sweep.
//
// lib/gift-card-store.js (84-05) does not exist in this worktree yet — every
// sweep test injects deps.giftCardStore so the lazy require() inside
// sweepGiftCardPending is never reached.
//
// Run alone: cd zoho-middleware && npx jest reconcile-giftcard-pending
// ---------------------------------------------------------------------------

jest.mock('../lib/helcim');
jest.mock('../lib/mailer', function () {
  return { sendVoidFailureAlert: jest.fn().mockResolvedValue({}) };
});
jest.mock('../lib/zoho-api', function () {
  return {
    zohoGet: jest.fn().mockResolvedValue({ invoices: [] }),
    zohoPost: jest.fn(),
    zohoPut: jest.fn()
  };
});
jest.mock('../lib/cache', function () {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(),
    del: jest.fn().mockResolvedValue(),
    acquireLock: jest.fn().mockResolvedValue(true),
    releaseLock: jest.fn().mockResolvedValue(),
    isConnected: jest.fn().mockReturnValue(true),
    getClient: jest.fn().mockResolvedValue({
      keys: jest.fn().mockResolvedValue([])
    })
  };
});
jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
});
jest.mock('../lib/eventLog', function () { return { logEvent: jest.fn() }; });
jest.mock('../lib/sentry-capture', function () { return { captureExceptionSafe: jest.fn() }; });

var cache = require('../lib/cache');
var mailer = require('../lib/mailer');
var log = require('../lib/logger');
var eventLog = require('../lib/eventLog');
var sentryCapture = require('../lib/sentry-capture');
var reconcile = require('../lib/reconcile');

var VOID_FAILURE_TTL = 30 * 24 * 60 * 60; // 2592000 — reused constant, not reinvented

function baseRecord(overrides) {
  return Object.assign({
    op: 'redeem',
    tx_ref: 'K-1:GC-000001:redeem',
    cert_number: 'GC-000001',
    amount: 10,
    params: { actor: 'staff@example.com', foo: 'bar' },
    error: 'connection terminated'
  }, overrides || {});
}

describe('recordGiftCardReconcileFailure', function () {
  beforeEach(function () {
    jest.clearAllMocks();
    cache.set.mockResolvedValue();
    mailer.sendVoidFailureAlert.mockResolvedValue({});
  });

  test('writes a durable Redis record at giftcard:pending:<tx_ref> with a 30-day TTL', function () {
    return reconcile.recordGiftCardReconcileFailure(baseRecord()).then(function () {
      expect(cache.set).toHaveBeenCalledTimes(1);
      var call = cache.set.mock.calls[0];
      expect(call[0]).toBe('giftcard:pending:K-1:GC-000001:redeem');
      var value = call[1];
      expect(value.op).toBe('redeem');
      expect(value.params).toEqual({ actor: 'staff@example.com', foo: 'bar' });
      expect(value.tx_ref).toBe('K-1:GC-000001:redeem');
      expect(value.cert_number).toBe('GC-000001');
      expect(value.amount).toBe(10);
      expect(value.error).toBe('connection terminated');
      expect(value.needs_manual_review).toBe(true);
      expect(value.attempts).toBe(0);
      expect(typeof value.created_at).toBe('string');
      expect(new Date(value.created_at).toISOString()).toBe(value.created_at);
      expect(call[2]).toBe(VOID_FAILURE_TTL);
      expect(call[2]).toBe(2592000);
    });
  });

  test('logs CRITICAL, emits a structured event, a Sentry error, and a staff alert email', function () {
    return reconcile.recordGiftCardReconcileFailure(baseRecord()).then(function () {
      var criticalCalls = log.error.mock.calls.filter(function (c) {
        return c[0] && c[0].indexOf('CRITICAL') !== -1;
      });
      expect(criticalCalls.length).toBeGreaterThan(0);

      expect(eventLog.logEvent).toHaveBeenCalledWith('giftcard.reconcile_failed', expect.objectContaining({
        txRef: 'K-1:GC-000001:redeem',
        certNumber: 'GC-000001',
        amount: 10,
        op: 'redeem'
      }));

      expect(sentryCapture.captureExceptionSafe).toHaveBeenCalled();
      var sentryArgs = sentryCapture.captureExceptionSafe.mock.calls[0];
      expect(sentryArgs[1].level).toBe('error');
      expect(sentryArgs[1].tags.component).toBe('giftcards');

      expect(mailer.sendVoidFailureAlert).toHaveBeenCalledTimes(1);
      var alertArg = mailer.sendVoidFailureAlert.mock.calls[0][0];
      expect(alertArg.txnId).toBe('K-1:GC-000001:redeem');
      expect(alertArg.amount).toBe(10);
    });
  });

  test('never logs the full params object (staff email must not leak to logs)', function () {
    return reconcile.recordGiftCardReconcileFailure(baseRecord()).then(function () {
      var allLogCalls = [].concat(log.error.mock.calls, log.warn.mock.calls, log.info.mock.calls);
      allLogCalls.forEach(function (c) {
        var line = (c[0] || '') + '';
        expect(line.indexOf('staff@example.com')).toBe(-1);
      });
    });
  });

  test('cache.set rejecting still resolves (no throw into the sale), logs the write failure, and sends a Sentry error', function () {
    cache.set.mockRejectedValueOnce(new Error('redis down'));
    return reconcile.recordGiftCardReconcileFailure(baseRecord()).then(function () {
      var notWrittenCalls = log.error.mock.calls.filter(function (c) {
        return c[0] && c[0].indexOf('NOT written') !== -1;
      });
      expect(notWrittenCalls.length).toBeGreaterThan(0);
      expect(sentryCapture.captureExceptionSafe).toHaveBeenCalled();
    });
  });
});

describe('sweepGiftCardPending', function () {
  beforeEach(function () {
    jest.clearAllMocks();
    cache.isConnected.mockReturnValue(true);
    cache.get.mockResolvedValue(null);
    cache.set.mockResolvedValue();
    cache.del.mockResolvedValue();
    mailer.sendVoidFailureAlert.mockResolvedValue({});
  });

  test('Redis disconnected -> resolves without calling the store', function () {
    cache.isConnected.mockReturnValue(false);
    var fakeStore = { replayPending: jest.fn() };
    return reconcile.sweepGiftCardPending({ giftCardStore: fakeStore }).then(function () {
      expect(fakeStore.replayPending).not.toHaveBeenCalled();
      expect(cache.getClient).not.toHaveBeenCalled();
    });
  });

  test('replayPending resolves {ok:true} -> cache.del(key) and eventLog giftcard.pending_replayed', function () {
    var key = 'giftcard:pending:K-1:GC-000001:redeem';
    var record = baseRecord();
    cache.getClient.mockResolvedValue({ keys: jest.fn().mockResolvedValue([key]) });
    cache.get.mockResolvedValue(record);
    var fakeStore = { replayPending: jest.fn().mockResolvedValue({ ok: true }) };

    return reconcile.sweepGiftCardPending({ giftCardStore: fakeStore }).then(function () {
      expect(fakeStore.replayPending).toHaveBeenCalledWith(record);
      expect(cache.del).toHaveBeenCalledWith(key);
      expect(eventLog.logEvent).toHaveBeenCalledWith('giftcard.pending_replayed', expect.objectContaining({
        txRef: record.tx_ref
      }));
    });
  });

  test('replayPending resolves {ok:false, error} -> record re-set manual_review_required, Sentry error + alert email', function () {
    var key = 'giftcard:pending:K-1:GC-000001:redeem';
    var record = baseRecord();
    cache.getClient.mockResolvedValue({ keys: jest.fn().mockResolvedValue([key]) });
    cache.get.mockResolvedValue(record);
    var fakeStore = { replayPending: jest.fn().mockResolvedValue({ ok: false, error: 'insufficient_balance' }) };

    return reconcile.sweepGiftCardPending({ giftCardStore: fakeStore }).then(function () {
      expect(cache.del).not.toHaveBeenCalled();
      expect(cache.set).toHaveBeenCalled();
      var setCall = cache.set.mock.calls[0];
      expect(setCall[0]).toBe(key);
      expect(setCall[1].manual_review_required).toBe(true);
      expect(setCall[1].last_error).toBe('insufficient_balance');
      expect(sentryCapture.captureExceptionSafe).toHaveBeenCalled();
      expect(mailer.sendVoidFailureAlert).toHaveBeenCalledTimes(1);
    });
  });

  test('a later sweep SKIPS records already flagged manual_review_required', function () {
    var key = 'giftcard:pending:K-1:GC-000001:redeem';
    var record = baseRecord({ manual_review_required: true, last_error: 'insufficient_balance' });
    cache.getClient.mockResolvedValue({ keys: jest.fn().mockResolvedValue([key]) });
    cache.get.mockResolvedValue(record);
    var fakeStore = { replayPending: jest.fn() };

    return reconcile.sweepGiftCardPending({ giftCardStore: fakeStore }).then(function () {
      expect(fakeStore.replayPending).not.toHaveBeenCalled();
      expect(cache.del).not.toHaveBeenCalled();
      expect(cache.set).not.toHaveBeenCalled();
    });
  });

  test('replayPending rejects (infra failure) -> attempts incremented and re-set, key kept, no Sentry spam', function () {
    var key = 'giftcard:pending:K-1:GC-000001:redeem';
    var record = baseRecord({ attempts: 1 });
    cache.getClient.mockResolvedValue({ keys: jest.fn().mockResolvedValue([key]) });
    cache.get.mockResolvedValue(record);
    var fakeStore = { replayPending: jest.fn().mockRejectedValue(new Error('connection terminated')) };

    return reconcile.sweepGiftCardPending({ giftCardStore: fakeStore }).then(function () {
      expect(cache.del).not.toHaveBeenCalled();
      expect(cache.set).toHaveBeenCalled();
      var setCall = cache.set.mock.calls[0];
      expect(setCall[0]).toBe(key);
      expect(setCall[1].attempts).toBe(2);
      expect(sentryCapture.captureExceptionSafe).not.toHaveBeenCalled();
    });
  });

  test('malformed record (no tx_ref/op) -> logged and left in place, never deleted', function () {
    var key = 'giftcard:pending:malformed';
    cache.getClient.mockResolvedValue({ keys: jest.fn().mockResolvedValue([key]) });
    cache.get.mockResolvedValue({ foo: 'bar' });
    var fakeStore = { replayPending: jest.fn() };

    return reconcile.sweepGiftCardPending({ giftCardStore: fakeStore }).then(function () {
      expect(fakeStore.replayPending).not.toHaveBeenCalled();
      expect(cache.del).not.toHaveBeenCalled();
      expect(cache.set).not.toHaveBeenCalled();
      expect(log.warn).toHaveBeenCalled();
    });
  });
});
