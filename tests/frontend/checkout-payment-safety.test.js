'use strict';

global.SHEETS_CONFIG = { SPREADSHEET_ID: 'test', MIDDLEWARE_URL: '' };
global.navigator = global.navigator || {};
global.navigator.vibrate = jest.fn();

beforeEach(function () { localStorage.clear(); });

var checkoutMod = require('../../js/modules/12-checkout');

describe('generateIdempotencyKey', function () {
  test('returns a non-empty string', function () {
    var key = checkoutMod.generateIdempotencyKey();
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(5);
  });

  test('generates unique keys on successive calls', function () {
    var k1 = checkoutMod.generateIdempotencyKey();
    var k2 = checkoutMod.generateIdempotencyKey();
    expect(k1).not.toBe(k2);
  });
});

describe('clearPaymentCooldown', function () {
  test('resets _paymentChargeInFlight to false', function () {
    checkoutMod._setPaymentChargeInFlightForTest(true);
    checkoutMod.clearPaymentCooldown();
    var state = checkoutMod._getPaymentStateForTest();
    expect(state.chargeInFlight).toBe(false);
  });
});

describe('payment state safety', function () {
  test('_getPaymentStateForTest returns all payment state fields', function () {
    var state = checkoutMod._getPaymentStateForTest();
    expect(state).toHaveProperty('chargeInFlight');
    expect(state).toHaveProperty('checkoutToken');
    expect(state).toHaveProperty('transactionId');
    expect(state).toHaveProperty('idempotencyKey');
  });

  test('chargeInFlight defaults to false', function () {
    var state = checkoutMod._getPaymentStateForTest();
    expect(state.chargeInFlight).toBe(false);
  });
});

describe('payment state machine fixes', function () {
  beforeEach(function () {
    checkoutMod._setPaymentChargeInFlightForTest(false);
    checkoutMod._setTransactionIdForTest(null);
  });

  test('clearPaymentCooldown does not null transactionId (C2 fix)', function () {
    checkoutMod._setPaymentChargeInFlightForTest(true);
    checkoutMod._setTransactionIdForTest('txn-12345');
    checkoutMod.clearPaymentCooldown();
    var state = checkoutMod._getPaymentStateForTest();
    expect(state.chargeInFlight).toBe(false);
    expect(state.transactionId).toBe('txn-12345');
  });

  test('transactionId can be set and read via test helpers', function () {
    checkoutMod._setTransactionIdForTest('txn-abc');
    var state = checkoutMod._getPaymentStateForTest();
    expect(state.transactionId).toBe('txn-abc');
  });

  test('generateIdempotencyKey still produces unique keys', function () {
    var k1 = checkoutMod.generateIdempotencyKey();
    var k2 = checkoutMod.generateIdempotencyKey();
    var k3 = checkoutMod.generateIdempotencyKey();
    expect(k1).not.toBe(k2);
    expect(k2).not.toBe(k3);
    expect(k1).not.toBe(k3);
  });
});
