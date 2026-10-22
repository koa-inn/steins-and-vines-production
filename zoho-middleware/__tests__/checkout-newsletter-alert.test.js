'use strict';

// Checkout newsletter opt-in staff alert (2026-10-22): when a customer ticks
// the newsletter box and MailerLite accepts them, the shop gets the same alert
// as a website signup (source 'checkout', with the order number), saying
// whether they are new or already subscribed. Never affects the order.
// Harness copied from __tests__/checkout-newsletter-optin.test.js.

jest.mock('../lib/zohoAuth', function () {
  return { init: jest.fn().mockResolvedValue(), isAuthenticated: jest.fn().mockReturnValue(true) };
});
jest.mock('../lib/validateEnv', function () { return jest.fn(); });
jest.mock('../lib/checkRedis', function () { return jest.fn().mockResolvedValue(); });
jest.mock('../lib/checkMailer', function () { return jest.fn(); });
jest.mock('../lib/brewpad-integration', function () {
  return { syncBatch: jest.fn(), init: jest.fn(), createBatchesFromSale: jest.fn() };
});
jest.mock('node-cron', function () { return { schedule: jest.fn() }; });
jest.mock('@sentry/node', function () {
  return { init: jest.fn(), setupExpressErrorHandler: jest.fn(), captureException: jest.fn() };
});
jest.mock('../lib/mailerlite', function () {
  return { isConfigured: jest.fn().mockReturnValue(true), addSubscriber: jest.fn().mockResolvedValue({ data: { id: 'sub-1' } }) };
});
jest.mock('../lib/eventLog', function () { return { logEvent: jest.fn() }; });
jest.mock('../lib/inventory-ledger', function () { return { decrementStock: jest.fn().mockResolvedValue() }; });
jest.mock('../lib/helcim', function () {
  return {
    isEnabled: jest.fn().mockReturnValue(true),
    initializeCheckout: jest.fn().mockResolvedValue({ checkoutToken: 'tok-test-123' }),
    getDepositAmount: jest.fn().mockReturnValue(10000),
    voidTransaction: jest.fn().mockResolvedValue({ ok: true, transactionId: 'txn-mock' }),
    getTerminalDiagnostics: jest.fn().mockReturnValue({}),
    getDeviceCode: jest.fn().mockReturnValue(''),
    init: jest.fn(),
    verifyWebhookSignature: jest.fn().mockReturnValue(true),
    getCardTransactionById: jest.fn()
  };
});
jest.mock('../lib/zoho-api', function () {
  return { zohoPost: jest.fn(), zohoGet: jest.fn() };
});
jest.mock('../lib/cache', function () {
  return {
    get: jest.fn(),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    acquireLock: jest.fn().mockResolvedValue(true),
    isConnected: jest.fn().mockReturnValue(false),
    init: jest.fn().mockResolvedValue(),
    getClient: jest.fn().mockResolvedValue(null)
  };
});
jest.mock('../lib/mailer', function () {
  return {
    sendReservationNotification: jest.fn().mockResolvedValue(),
    sendOfflineOrderNotification: jest.fn().mockResolvedValue(),
    sendVoidFailureAlert: jest.fn().mockResolvedValue(),
    sendCustomerConfirmation: jest.fn().mockResolvedValue(),
    sendNewsletterNotification: jest.fn().mockResolvedValue()
  };
});
jest.mock('axios', function () {
  return { post: jest.fn().mockResolvedValue({ data: { ok: true } }) };
});

process.env.API_SECRET_KEY = 'test-key';

var request = require('supertest');
var app = require('../server');

process.env.RECAPTCHA_SECRET_KEY = '';

var zohoApi = require('../lib/zoho-api');
var cacheLib = require('../lib/cache');
var mailerlite = require('../lib/mailerlite');
var eventLog = require('../lib/eventLog');

function makeCheckoutBody(overrides) {
  return Object.assign({
    customer: { name: 'Test User', email: 'Optin.Customer@Example.com', phone: '' },
    items: [{ item_id: '12345', name: 'Wine Kit', quantity: 1, rate: 49.99 }],
    notes: '',
    cart_key: 'sv-cart-ingredients'
  }, overrides || {});
}

var MOCK_CATALOG = [{ item_id: '12345', name: 'Wine Kit', rate: 49.99, quantity_available: 10 }];

function defaultCacheGet(key) {
  if (key === 'zoho:products') return Promise.resolve(MOCK_CATALOG);
  if (key === 'zoho:services:v2') return Promise.resolve([]);
  if (key === 'zoho:ingredients') return Promise.resolve([{ item_id: '12345', name: 'Wine Kit', rate: 49.99 }]);
  return Promise.resolve(null);
}

function zohoPostImpl(endpoint) {
  if (endpoint === '/salesorders') {
    return Promise.resolve({ salesorder: { salesorder_id: 'so-1', salesorder_number: 'SO-001', total: 49.99 } });
  }
  if (endpoint === '/invoices') {
    return Promise.resolve({ invoice: { invoice_id: 'inv-1', invoice_number: 'INV-001', total: 49.99 } });
  }
  return Promise.resolve({});
}

// Fire-and-forget promises settle after the response; give them a tick.
function flush() { return new Promise(function (r) { setImmediate(r); }); }

var mailer = require('../lib/mailer');

describe('POST /api/checkout — newsletter opt-in staff alert', function () {
  beforeEach(function () {
    jest.clearAllMocks();
    process.env.RECAPTCHA_SECRET_KEY = '';
    process.env.MAILERLITE_NEWSLETTER_GROUP_ID = '777';
    mailerlite.isConfigured.mockReturnValue(true);
    mailerlite.addSubscriber.mockResolvedValue({ data: { id: 'sub-1', created_at: '2026-10-22 23:01:52', updated_at: '2026-10-22 23:01:52' } });
    mailer.sendNewsletterNotification.mockResolvedValue();
    cacheLib.get.mockImplementation(defaultCacheGet);
    cacheLib.acquireLock.mockResolvedValue(true);
    zohoApi.zohoGet.mockResolvedValue({ contacts: [{ contact_id: 'cid-001' }] });
    zohoApi.zohoPost.mockImplementation(zohoPostImpl);
  });

  function checkout(overrides) {
    return request(app).post('/api/checkout').send(makeCheckoutBody(overrides)).expect(201).then(flush).then(flush);
  }

  test('opt-in of a new subscriber alerts the shop with source checkout and the order number', function () {
    return checkout({ newsletter_opt_in: true, terms_accepted: true }).then(function () {
      expect(mailer.sendNewsletterNotification).toHaveBeenCalledTimes(1);
      var arg = mailer.sendNewsletterNotification.mock.calls[0][0];
      expect(arg.email).toBe('optin.customer@example.com');
      expect(arg.source).toBe('checkout');
      expect(arg.alreadySubscribed).toBe(false);
      expect(typeof arg.orderNumber).toBe('string');
      expect(arg.orderNumber.length).toBeGreaterThan(0);
    });
  });

  test('an already-subscribed customer is flagged as such', function () {
    mailerlite.addSubscriber.mockResolvedValue({ data: { created_at: '2026-06-16 17:51:18', updated_at: '2026-10-22 22:59:15' } });
    return checkout({ newsletter_opt_in: true, terms_accepted: true }).then(function () {
      expect(mailer.sendNewsletterNotification.mock.calls[0][0].alreadySubscribed).toBe(true);
    });
  });

  test('no opt-in, no alert', function () {
    return checkout({ newsletter_opt_in: false, terms_accepted: true }).then(function () {
      expect(mailer.sendNewsletterNotification).not.toHaveBeenCalled();
    });
  });

  test('a failed MailerLite subscribe sends no alert', function () {
    mailerlite.addSubscriber.mockRejectedValue(new Error('MailerLite subscribe failed: 500'));
    return checkout({ newsletter_opt_in: true, terms_accepted: true }).then(function () {
      expect(mailer.sendNewsletterNotification).not.toHaveBeenCalled();
    });
  });

  test('a failed alert email never affects the order', function () {
    mailer.sendNewsletterNotification.mockRejectedValue(new Error('Resend down'));
    return checkout({ newsletter_opt_in: true, terms_accepted: true }).then(function () {
      expect(mailer.sendNewsletterNotification).toHaveBeenCalledTimes(1);
    });
  });
});
