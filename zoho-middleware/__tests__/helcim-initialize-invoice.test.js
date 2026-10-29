'use strict';

jest.mock('axios');

var axios = require('axios');
var helcim = require('../lib/helcim');

describe('helcim.initializeCheckout invoiceNumber binding (Phase 100 D-17)', function () {
  beforeEach(function () {
    jest.clearAllMocks();
    process.env.HELCIM_API_TOKEN = 'test-token-init';
    helcim.init();
    axios.post.mockResolvedValue({ data: { checkoutToken: 'ct', secretToken: 'st' } });
  });

  test('two-argument call posts exactly paymentType, amount, currency', async function () {
    var out = await helcim.initializeCheckout(50, 'CAD');
    expect(out).toEqual({ checkoutToken: 'ct', secretToken: 'st' });
    var body = axios.post.mock.calls[0][1];
    expect(Object.keys(body).sort()).toEqual(['amount', 'currency', 'paymentType']);
    expect(body).toEqual({ paymentType: 'purchase', amount: 50, currency: 'CAD' });
  });

  test('invoiceNumber opt adds invoiceRequest with invoiceNumber and lineItems (LV11)', async function () {
    await helcim.initializeCheckout(100, 'CAD', { invoiceNumber: 'LR-0123456789abcdef' });
    expect(axios.post.mock.calls[0][1]).toEqual({
      paymentType: 'purchase',
      amount: 100,
      currency: 'CAD',
      invoiceRequest: {
        invoiceNumber: 'LR-0123456789abcdef',
        lineItems: [{ description: 'Limited release deposit', quantity: 1, price: 100, total: 100 }]
      }
    });
    expect(axios.post.mock.calls[0][1].invoiceNumber).toBeUndefined();
  });

  test('caller-supplied lineItems are passed through', async function () {
    var items = [{ description: 'Kit A', quantity: 2, price: 50, total: 100 }];
    await helcim.initializeCheckout(100, 'CAD', { invoiceNumber: 'LR-0123456789abcdef', lineItems: items });
    expect(axios.post.mock.calls[0][1].invoiceRequest.lineItems).toEqual(items);
  });

  test('opts without a usable invoiceNumber adds nothing', async function () {
    await helcim.initializeCheckout(10, 'CAD', {});
    await helcim.initializeCheckout(10, 'CAD', { invoiceNumber: 123 });
    await helcim.initializeCheckout(10, 'CAD', { invoiceNumber: '' });
    axios.post.mock.calls.forEach(function (c) {
      expect(c[1].invoiceRequest).toBeUndefined();
    });
  });
});
