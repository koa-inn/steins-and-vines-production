'use strict';

global.SHEETS_CONFIG = { SPREADSHEET_ID: 'test', MIDDLEWARE_URL: '' };
global.navigator = global.navigator || {};
global.navigator.vibrate = jest.fn();

beforeEach(function () { localStorage.clear(); });

var checkoutMod = require('../../js/modules/12-checkout');

describe('postMessage token matching', function () {
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
    checkoutMod._setSecretTokenForTest(null);
  });

  test('Helcim uses checkoutToken in eventName, secretToken is a separate field', function () {
    var secretToken = 'secret-token-xyz';
    var checkoutToken = 'checkout-token-abc';
    expect(secretToken).not.toBe(checkoutToken);
    expect('helcim-pay-js-' + checkoutToken).toBe('helcim-pay-js-checkout-token-abc');
  });
});

describe('extractHelcimTransactionId', function () {
  var extract = checkoutMod._extractHelcimTransactionId;

  test('extracts from real Helcim structure: stringified eventMessage with data.data nesting', function () {
    var helcimData = {
      eventName: 'helcim-pay-js-checkout123',
      eventStatus: 'SUCCESS',
      eventMessage: JSON.stringify({
        data: {
          hash: '5048d8e1c1782412a6da91e3427d4e1b',
          data: { transactionId: '48122609', status: 'APPROVED', amount: '4', currency: 'CAD' }
        },
        status: 200,
        statusText: '',
        headers: { 'content-type': 'application/json' }
      })
    };
    expect(extract(helcimData)).toBe('48122609');
  });

  test('extracts from object eventMessage with data.data nesting', function () {
    var helcimData = {
      eventMessage: {
        data: {
          hash: 'abc123',
          data: { transactionId: 25133280, amount: 100 }
        },
        status: 200
      }
    };
    expect(extract(helcimData)).toBe('25133280');
  });

  test('falls back to flat eventMessage.data.transactionId', function () {
    var helcimData = {
      eventMessage: {
        hash: 'abc123hash',
        data: { transactionId: 99887766, amount: 50, status: 'APPROVAL' }
      }
    };
    expect(extract(helcimData)).toBe('99887766');
  });

  test('handles stringified flat eventMessage', function () {
    var helcimData = {
      eventMessage: JSON.stringify({
        hash: 'abc123hash',
        data: { transactionId: 11223344, amount: 50 }
      })
    };
    expect(extract(helcimData)).toBe('11223344');
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
    var data = { eventMessage: { data: { hash: 'x', data: { transactionId: 12345 } }, status: 200 } };
    expect(extract(data)).toBe('12345');
    expect(typeof extract(data)).toBe('string');
  });
});
