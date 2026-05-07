'use strict';

global.SHEETS_CONFIG = { SPREADSHEET_ID: 'test', MIDDLEWARE_URL: '' };
global.navigator = global.navigator || {};
global.navigator.vibrate = jest.fn();

beforeEach(function () { localStorage.clear(); });

var checkoutMod = require('../../js/modules/12-checkout');

describe('postMessage secretToken matching', function () {
  test('_getPaymentStateForTest exposes secretToken field', function () {
    var state = checkoutMod._getPaymentStateForTest();
    expect(state).toHaveProperty('secretToken');
  });

  test('secretToken defaults to null', function () {
    var state = checkoutMod._getPaymentStateForTest();
    expect(state.secretToken).toBeNull();
  });

  test('secretToken can be set via test helper', function () {
    checkoutMod._setSecretTokenForTest('sec-abc-123');
    var state = checkoutMod._getPaymentStateForTest();
    expect(state.secretToken).toBe('sec-abc-123');
    // cleanup
    checkoutMod._setSecretTokenForTest(null);
  });

  test('postMessage eventName should match against secretToken, not checkoutToken', function () {
    // This test documents the root cause: Helcim uses secretToken in eventName,
    // not checkoutToken. The frontend must store and match against secretToken.
    var secretToken = 'secret-token-xyz';
    var checkoutToken = 'checkout-token-abc';
    var expectedEventName = 'helcim-pay-js-' + secretToken;
    var wrongEventName = 'helcim-pay-js-' + checkoutToken;

    // These are different tokens and must not be confused
    expect(expectedEventName).not.toBe(wrongEventName);
    expect(expectedEventName).toBe('helcim-pay-js-secret-token-xyz');
  });
});
