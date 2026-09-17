'use strict';

// ---------------------------------------------------------------------------
// Checkout consent fields:
//   newsletter_opt_in — the customer ticked the (unticked-by-default) box at
//     checkout. Only a strict boolean true subscribes the email to MailerLite
//     (optional MAILERLITE_NEWSLETTER_GROUP_ID group). Fire-and-forget: a
//     MailerLite failure never affects the order. A consent event is logged
//     as the CASL record.
//   terms_accepted — recorded on the checkout.completed event as the record
//     that the customer acknowledged the Terms before paying (BPCPA s.18.3).
// ---------------------------------------------------------------------------

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
    sendCustomerConfirmation: jest.fn().mockResolvedValue()
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

describe('POST /api/checkout — newsletter opt-in and terms acknowledgement', function () {
  beforeEach(function () {
    jest.clearAllMocks();
    process.env.RECAPTCHA_SECRET_KEY = '';
    process.env.MAILERLITE_NEWSLETTER_GROUP_ID = '777';
    mailerlite.isConfigured.mockReturnValue(true);
    mailerlite.addSubscriber.mockResolvedValue({ data: { id: 'sub-1' } });
    cacheLib.get.mockImplementation(defaultCacheGet);
    cacheLib.acquireLock.mockResolvedValue(true);
    zohoApi.zohoGet.mockResolvedValue({ contacts: [{ contact_id: 'cid-001' }] });
    zohoApi.zohoPost.mockImplementation(zohoPostImpl);
  });

  test('opt-in true subscribes the (normalised) email to the newsletter group and logs the consent', function () {
    return request(app).post('/api/checkout').send(makeCheckoutBody({ newsletter_opt_in: true, terms_accepted: true }))
      .expect(201).then(flush).then(function () {
        expect(mailerlite.addSubscriber).toHaveBeenCalledTimes(1);
        expect(mailerlite.addSubscriber).toHaveBeenCalledWith('optin.customer@example.com', ['777']);
        expect(eventLog.logEvent).toHaveBeenCalledWith('checkout.newsletter_opt_in', expect.objectContaining({ orderNumber: expect.any(String) }));
      });
  });

  test('opt-in absent does not subscribe', function () {
    return request(app).post('/api/checkout').send(makeCheckoutBody({ terms_accepted: true }))
      .expect(201).then(flush).then(function () {
        expect(mailerlite.addSubscriber).not.toHaveBeenCalled();
      });
  });

  test('opt-in false does not subscribe', function () {
    return request(app).post('/api/checkout').send(makeCheckoutBody({ newsletter_opt_in: false, terms_accepted: true }))
      .expect(201).then(flush).then(function () {
        expect(mailerlite.addSubscriber).not.toHaveBeenCalled();
      });
  });

  test('only a strict boolean counts as consent (the string "true" does not)', function () {
    return request(app).post('/api/checkout').send(makeCheckoutBody({ newsletter_opt_in: 'true', terms_accepted: true }))
      .expect(201).then(flush).then(function () {
        expect(mailerlite.addSubscriber).not.toHaveBeenCalled();
      });
  });

  test('a MailerLite failure never affects the order', function () {
    mailerlite.addSubscriber.mockRejectedValue(new Error('MailerLite subscribe failed: 500'));
    return request(app).post('/api/checkout').send(makeCheckoutBody({ newsletter_opt_in: true, terms_accepted: true }))
      .expect(201).then(flush).then(function () {
        expect(mailerlite.addSubscriber).toHaveBeenCalledTimes(1);
      });
  });

  test('no group id configured still subscribes, without a group', function () {
    delete process.env.MAILERLITE_NEWSLETTER_GROUP_ID;
    return request(app).post('/api/checkout').send(makeCheckoutBody({ newsletter_opt_in: true, terms_accepted: true }))
      .expect(201).then(flush).then(function () {
        expect(mailerlite.addSubscriber).toHaveBeenCalledWith('optin.customer@example.com', []);
      });
  });

  test('terms acknowledgement is recorded on the completed-checkout event', function () {
    return request(app).post('/api/checkout').send(makeCheckoutBody({ terms_accepted: true }))
      .expect(201).then(function () {
        expect(eventLog.logEvent).toHaveBeenCalledWith('checkout.completed', expect.objectContaining({ termsAccepted: true }));
      });
  });

  test('a missing acknowledgement is recorded as false, not assumed', function () {
    return request(app).post('/api/checkout').send(makeCheckoutBody({}))
      .expect(201).then(function () {
        expect(eventLog.logEvent).toHaveBeenCalledWith('checkout.completed', expect.objectContaining({ termsAccepted: false }));
      });
  });
});
