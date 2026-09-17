'use strict';

// ---------------------------------------------------------------------------
// Regression tests: the customer's order confirmation is their copy of the
// contract under BPCPA ss. 18.2 / 23(3) / 48. It must carry the start
// appointment, the estimated packaging date, and the pickup arrangement, and
// it must not carry the store's OLD address (38021 Cleveland Ave) — the Resend
// fallback in lib/mailer.js still did as of 2026-09-16.
//
// Two layers:
//   1. lib/mailer.js sendCustomerConfirmation (the Resend fallback body)
//   2. routes/checkout.js — the Zoho /invoices/{id}/email body sent for a paid
//      order, plus sanitisation of the new `ready_estimate` field.
// ---------------------------------------------------------------------------

// --- Server-boot mocks (same shape as checkout-captured-amount.test.js) ---
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
  return { isConfigured: jest.fn().mockReturnValue(false), addSubscriber: jest.fn().mockResolvedValue() };
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
jest.mock('axios', function () {
  return { post: jest.fn().mockResolvedValue({ data: { ok: true } }), get: jest.fn() };
});

process.env.API_SECRET_KEY = 'test-key';

var request = require('supertest');
var axios = require('axios');
var app = require('../server');

process.env.RECAPTCHA_SECRET_KEY = '';

var helcimLib = require('../lib/helcim');
var zohoApi = require('../lib/zoho-api');
var cacheLib = require('../lib/cache');
var mailer = require('../lib/mailer');

var STORE_ADDRESS = '11-38918 Progress Way';
var OLD_ADDRESS = 'Cleveland';

// ---------------------------------------------------------------------------
// Layer 1: the Resend fallback body
// ---------------------------------------------------------------------------
describe('sendCustomerConfirmation — contract-copy contents', function () {
  beforeEach(function () {
    process.env.RESEND_API_KEY = 're_test_123';
    process.env.CONTACT_TO = 'store@example.com';
    axios.post.mockReset();
    axios.post.mockResolvedValue({ data: { id: 'test-id' } });
  });

  function sentText() {
    return axios.post.mock.calls[0][1].text;
  }

  test('signs off with the current store address, never the old one', function () {
    return mailer.sendCustomerConfirmation({
      email: 'customer@example.com', orderNumber: 'SO-010', items: [], timeslot: ''
    }).then(function () {
      expect(sentText()).toContain(STORE_ADDRESS);
      expect(sentText()).not.toContain(OLD_ADDRESS);
    });
  });

  test('states that everything is collected in store', function () {
    return mailer.sendCustomerConfirmation({
      email: 'customer@example.com', orderNumber: 'SO-011', items: [], timeslot: ''
    }).then(function () {
      expect(sentText()).toMatch(/collected in store/i);
    });
  });

  test('includes the ready estimate when provided', function () {
    return mailer.sendCustomerConfirmation({
      email: 'customer@example.com', orderNumber: 'SO-012', items: [],
      timeslot: '2026-10-03 10:00 AM',
      readyEstimate: 'Estimated ready the week of October 31–November 6, 2026 (approximately 4 weeks from your appointment).'
    }).then(function () {
      expect(sentText()).toContain('Estimated ready the week of October 31');
      expect(sentText()).toContain('2026-10-03 10:00 AM');
    });
  });

  test('omits the estimate line when none is provided', function () {
    return mailer.sendCustomerConfirmation({
      email: 'customer@example.com', orderNumber: 'SO-013', items: [], timeslot: ''
    }).then(function () {
      expect(sentText()).not.toMatch(/Estimated ready/);
    });
  });
});

// ---------------------------------------------------------------------------
// Layer 2: the Zoho invoice email body on a paid order
// ---------------------------------------------------------------------------
function makeCheckoutBody(overrides) {
  return Object.assign({
    customer: { name: 'Test User', email: 'test@example.com', phone: '' },
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
  if (endpoint === '/invoices') {
    return Promise.resolve({ invoice: { invoice_id: 'inv-1', invoice_number: 'INV-001', total: 49.99 } });
  }
  return Promise.resolve({});
}

function emailCall() {
  var calls = zohoApi.zohoPost.mock.calls.filter(function (c) { return /\/email$/.test(c[0]); });
  return calls.length ? calls[0][1] : null;
}

describe('POST /api/checkout — confirmation email body for a paid order', function () {
  beforeEach(function () {
    jest.clearAllMocks();
    process.env.RECAPTCHA_SECRET_KEY = '';
    cacheLib.get.mockImplementation(defaultCacheGet);
    cacheLib.acquireLock.mockResolvedValue(true);
    zohoApi.zohoGet.mockResolvedValue({ contacts: [{ contact_id: 'cid-001' }] });
    zohoApi.zohoPost.mockImplementation(zohoPostImpl);
    helcimLib.getCardTransactionById.mockResolvedValue({ status: 'APPROVED', amount: 49.99 });
  });

  test('carries the start appointment, the ready estimate and the pickup line', function () {
    var body = makeCheckoutBody({
      transaction_id: 'txn-ok',
      timeslot: '2026-10-03 10:00 AM',
      ready_estimate: 'Estimated ready the week of October 31–November 6, 2026.'
    });
    return request(app).post('/api/checkout').send(body).expect(201).then(function () {
      var mail = emailCall();
      expect(mail).not.toBeNull();
      expect(mail.body).toContain('2026-10-03 10:00 AM');
      expect(mail.body).toContain('Estimated ready the week of October 31');
      expect(mail.body).toContain(STORE_ADDRESS);
      expect(mail.body).not.toContain(OLD_ADDRESS);
    });
  });

  test('an oversized ready_estimate is truncated, not rejected', function () {
    var huge = new Array(60).join('estimate text ');
    var body = makeCheckoutBody({ transaction_id: 'txn-ok', ready_estimate: huge });
    return request(app).post('/api/checkout').send(body).expect(201).then(function () {
      var mail = emailCall();
      expect(mail).not.toBeNull();
      expect(mail.body).toContain('estimate text');
      expect(mail.body).not.toContain(huge);
    });
  });

  test('line breaks in ready_estimate cannot inject extra lines into the email', function () {
    var body = makeCheckoutBody({ transaction_id: 'txn-ok', ready_estimate: 'ready\r\nCall this number instead' });
    return request(app).post('/api/checkout').send(body).expect(201).then(function () {
      var mail = emailCall();
      expect(mail).not.toBeNull();
      expect(mail.body).not.toContain('ready\r\nCall');
      expect(mail.body).toContain('ready Call this number instead');
    });
  });

  test('a non-string ready_estimate is ignored', function () {
    var body = makeCheckoutBody({ transaction_id: 'txn-ok', ready_estimate: { evil: true } });
    return request(app).post('/api/checkout').send(body).expect(201).then(function () {
      var mail = emailCall();
      expect(mail).not.toBeNull();
      expect(mail.body).not.toContain('[object Object]');
      expect(mail.body).not.toContain('evil');
    });
  });
});
