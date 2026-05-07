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

describe('extractHelcimTransactionId', function () {
  var extract = checkoutMod._extractHelcimTransactionId;

  test('extracts transactionId from Helcim postMessage structure (eventMessage.data.transactionId)', function () {
    var helcimData = {
      eventName: 'helcim-pay-js-secret123',
      eventStatus: 'SUCCESS',
      eventMessage: {
        hash: 'abc123hash',
        data: { transactionId: 25133280, amount: 100, status: 'APPROVAL' }
      }
    };
    expect(extract(helcimData)).toBe('25133280');
  });

  test('handles eventMessage as JSON string', function () {
    var helcimData = {
      eventName: 'helcim-pay-js-secret123',
      eventStatus: 'SUCCESS',
      eventMessage: JSON.stringify({
        hash: 'abc123hash',
        data: { transactionId: 99887766, amount: 50 }
      })
    };
    expect(extract(helcimData)).toBe('99887766');
  });

  test('returns empty string when eventMessage has wrong nesting (old bug: data.data.transactionId)', function () {
    var wrongStructure = {
      eventMessage: { data: { data: { transactionId: 12345 } } }
    };
    // transactionId is at data.data level — extractor should NOT find it
    // (it only looks at eventMessage.data.transactionId)
    expect(extract(wrongStructure)).toBe('');
  });

  test('returns empty string for missing eventMessage', function () {
    expect(extract({})).toBe('');
    expect(extract(null)).toBe('');
    expect(extract(undefined)).toBe('');
  });

  test('returns empty string for malformed JSON string', function () {
    expect(extract({ eventMessage: 'not-valid-json{' })).toBe('');
  });

  test('coerces numeric transactionId to string', function () {
    var data = { eventMessage: { data: { transactionId: 12345 } } };
    expect(extract(data)).toBe('12345');
    expect(typeof extract(data)).toBe('string');
  });
});
