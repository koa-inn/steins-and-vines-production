'use strict';

/**
 * OBS-01 / Phase 53-02 regression — money-path Sentry capture (D-01/D-02/D-04).
 *
 * Focused unit test — drives lib/money-path.js#voidWithTimeout directly with an
 * injected helcim stub whose voidTransaction rejects, forcing the CRITICAL
 * void-failure branch. Does NOT boot express; @sentry/node is mocked so the
 * assertion is on the mock call, not a real network send.
 *
 * Proves: a forced void failure calls Sentry.captureException with reqId +
 * txnId tags at level 'error', and the tags object carries no raw PII
 * (amount/total/email) — locking SC#1 (M17) against regression.
 */

jest.mock('@sentry/node', function () {
  return { captureException: jest.fn(), init: jest.fn(), setupExpressErrorHandler: jest.fn() };
});

var Sentry = require('@sentry/node');
var moneyPath = require('../lib/money-path');

describe('lib/money-path.js — Sentry captureException on void failure', function () {
  beforeEach(function () {
    Sentry.captureException.mockClear();
  });

  test('voidWithTimeout CRITICAL branch captures the void error with reqId/txnId tags at level error', async function () {
    var voidError = new Error('Helcim void endpoint returned 500');

    var helcimStub = {
      voidTransaction: jest.fn().mockRejectedValue(voidError)
    };
    var mailerStub = {
      sendVoidFailureAlert: jest.fn().mockResolvedValue()
    };
    var eventLogStub = {
      logEvent: jest.fn()
    };

    await moneyPath.voidWithTimeout(helcimStub, 'txn-forced-001', 42.5, {
      mailer: mailerStub,
      eventLog: eventLogStub,
      reqId: 'test-req-1',
      timeoutMs: 5000
    });

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    var callArgs = Sentry.captureException.mock.calls[0];
    expect(callArgs[0]).toBe(voidError);

    var options = callArgs[1];
    expect(options.level).toBe('error');
    expect(options.tags.reqId).toBe('test-req-1');
    expect(options.tags.txnId).toBeTruthy();
    expect(options.tags.txnId).toBe('txn-forced-001');

    // No raw PII/monetary values ever placed in the tags object (T-53-04).
    expect(options.tags).not.toHaveProperty('amount');
    expect(options.tags).not.toHaveProperty('total');
    expect(options.tags).not.toHaveProperty('email');

    // Existing behavior unaffected — mailer alert still fires on CRITICAL void failure.
    expect(mailerStub.sendVoidFailureAlert).toHaveBeenCalledTimes(1);
  });

  test('voidWithTimeout timeout branch also captures with reqId/txnId tags at level error, no mailer alert', async function () {
    var helcimStub = {
      // Never settles — forces the withTimeout race to reject with a Timeout error.
      voidTransaction: jest.fn(function () { return new Promise(function () {}); })
    };
    var mailerStub = {
      sendVoidFailureAlert: jest.fn().mockResolvedValue()
    };
    var eventLogStub = {
      logEvent: jest.fn()
    };

    await moneyPath.voidWithTimeout(helcimStub, 'txn-forced-002', 10, {
      mailer: mailerStub,
      eventLog: eventLogStub,
      reqId: 'test-req-2',
      timeoutMs: 20
    });

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    var options = Sentry.captureException.mock.calls[0][1];
    expect(options.level).toBe('error');
    expect(options.tags.reqId).toBe('test-req-2');
    expect(options.tags.txnId).toBe('txn-forced-002');
    expect(options.tags).not.toHaveProperty('amount');
    expect(options.tags).not.toHaveProperty('total');
    expect(options.tags).not.toHaveProperty('email');

    // Timeout branch does not send a mailer alert (mirrors checkout.js:846 behavior).
    expect(mailerStub.sendVoidFailureAlert).not.toHaveBeenCalled();
  });
});
