'use strict';

// Phase 100 Plan 06 -- POST /api/preorder/deposit verification stage (D-17).

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
jest.mock('../lib/inventory-ledger', function () {
  return { decrementStock: jest.fn().mockResolvedValue() };
});
jest.mock('../lib/helcim', function () {
  return {
    isEnabled: jest.fn().mockReturnValue(true),
    initializeCheckout: jest.fn(),
    getDepositAmount: jest.fn().mockReturnValue(10000),
    voidTransaction: jest.fn(),
    getTerminalDiagnostics: jest.fn().mockReturnValue({}),
    getDeviceCode: jest.fn().mockReturnValue(''),
    init: jest.fn(),
    verifyWebhookSignature: jest.fn().mockReturnValue(true),
    getCardTransactionById: jest.fn()
  };
});
jest.mock('../lib/zoho-api', function () { return { zohoPost: jest.fn(), zohoGet: jest.fn() }; });
jest.mock('../lib/cache', function () {
  return {
    get: jest.fn(),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    acquireLock: jest.fn(),
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
    sendPreorderCleanupAlert: jest.fn().mockResolvedValue()
  };
});
jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
});
jest.mock('axios', function () { return { post: jest.fn().mockResolvedValue({ data: { ok: true } }) }; });

process.env.API_SECRET_KEY = 'test-key';

var request = require('supertest');
var app = require('../server');
process.env.RECAPTCHA_SECRET_KEY = '';

var helcimLib = require('../lib/helcim');
var cache = require('../lib/cache');
var mailer = require('../lib/mailer');
var eventLog = require('../lib/eventLog');
var log = require('../lib/logger');
var zohoAuth = require('../lib/zohoAuth');
var preorder = require('../routes/preorder');

var EMBER = '109900000001719001';
var CONNEXION = '109900000001719056';
var NONCE = 'LR-0123456789abcdef';
var TXN = '57428079';
var REFERER = 'https://staging.steinsandvines.ca/limited-releases';
var EMAIL = 'pii.person@example.org';
var NAME = 'Pii Personname';
var PHONE = '604-555-0199';

function body(over) {
  return Object.assign({
    transaction_id: TXN,
    invoice_number: NONCE,
    items: [{ item_id: EMBER, qty: 1 }, { item_id: CONNEXION, qty: 1 }],
    customer: { name: NAME, email: EMAIL, phone: PHONE },
    consent: { accepted: true, text: 'I agree to the deposit terms.' },
    newsletter: false,
    recaptcha_token: 'tok'
  }, over || {});
}

function post(b) {
  return request(app).post('/api/preorder/deposit').set('Referer', REFERER).send(b);
}

var bookDeposit;
var keyStore;

beforeEach(function () {
  jest.clearAllMocks();
  process.env.RECAPTCHA_SECRET_KEY = '';
  zohoAuth.isAuthenticated.mockReturnValue(true);
  keyStore = {};
  keyStore['preorder:nonce:' + NONCE] = {
    amount: 100,
    lines: [{ item_id: CONNEXION, qty: 1 }, { item_id: EMBER, qty: 1 }],
    created_at: 'x'
  };
  cache.get.mockImplementation(function (k) { return Promise.resolve(keyStore[k] || null); });
  cache.acquireLock.mockResolvedValue(true);
  helcimLib.voidTransaction.mockResolvedValue({ ok: true });
  helcimLib.getCardTransactionById.mockResolvedValue({
    status: 'APPROVED', type: 'purchase', invoiceNumber: NONCE, amount: 100, transactionId: TXN
  });
  bookDeposit = jest.fn(function (ctx) {
    ctx.res.status(201).json({ ok: true });
    return Promise.resolve();
  });
  preorder.__setBookDeposit(bookDeposit);
});

function expectVoided(res, status, voided) {
  expect(res.status).toBe(status);
  expect(res.body.voided).toBe(voided);
  expect(helcimLib.voidTransaction).toHaveBeenCalledTimes(1);
  expect(helcimLib.voidTransaction).toHaveBeenCalledWith(TXN);
  expect(bookDeposit).not.toHaveBeenCalled();
}

describe('shape validation', function () {
  var cases = {
    'missing txn': { transaction_id: undefined },
    'oversized txn': { transaction_id: 'x'.repeat(65) },
    'bad nonce': { invoice_number: 'LR-short' },
    'bad email': { customer: { name: NAME, email: 'nope', phone: PHONE } },
    'long email': { customer: { name: NAME, email: 'a'.repeat(250) + '@b.co', phone: PHONE } },
    'empty name': { customer: { name: '', email: EMAIL, phone: PHONE } },
    'long name': { customer: { name: 'n'.repeat(101), email: EMAIL, phone: PHONE } },
    'long phone': { customer: { name: NAME, email: EMAIL, phone: '1'.repeat(31) } },
    'no consent': { consent: { accepted: false, text: 'x' } },
    'empty consent text': { consent: { accepted: true, text: '' } },
    'long consent text': { consent: { accepted: true, text: 'c'.repeat(501) } },
    'bad newsletter': { newsletter: 'yes' }
  };
  Object.keys(cases).forEach(function (name) {
    test(name + ' -> 400 voided:false, no Helcim calls', async function () {
      var res = await post(body(cases[name]));
      expect(res.status).toBe(400);
      expect(res.body.voided).toBe(false);
      expect(helcimLib.getCardTransactionById).not.toHaveBeenCalled();
      expect(helcimLib.voidTransaction).not.toHaveBeenCalled();
    });
  });
});

describe('ownership', function () {
  test('victim txn with attacker nonce: no void, no lock', async function () {
    helcimLib.getCardTransactionById.mockResolvedValue({
      status: 'APPROVED', type: 'purchase', invoiceNumber: 'LR-ffffffffffffffff', amount: 100
    });
    var res = await post(body());
    expect(res.status).toBe(400);
    expect(res.body.voided).toBe(false);
    expect(helcimLib.voidTransaction).not.toHaveBeenCalled();
    expect(cache.acquireLock).not.toHaveBeenCalled();
    expect(eventLog.logEvent).toHaveBeenCalledWith('preorder.unverified_txn', { txnId: TXN });
  });

  test('refund readback (APPROVED) is rejected without void', async function () {
    helcimLib.getCardTransactionById.mockResolvedValue({
      status: 'APPROVED', type: 'refund', invoiceNumber: NONCE, amount: 100
    });
    var res = await post(body());
    expect(res.status).toBe(400);
    expect(res.body.voided).toBe(false);
    expect(helcimLib.voidTransaction).not.toHaveBeenCalled();
  });

  test('declined readback is rejected without void', async function () {
    helcimLib.getCardTransactionById.mockResolvedValue({
      status: 'DECLINED', type: 'purchase', invoiceNumber: NONCE, amount: 100
    });
    var res = await post(body());
    expect(res.status).toBe(400);
    expect(helcimLib.voidTransaction).not.toHaveBeenCalled();
  });

  test('readback failure with a live nonce alerts staff once, no void', async function () {
    helcimLib.getCardTransactionById.mockRejectedValue(new Error('timeout'));
    var res = await post(body());
    expect(res.status).toBe(502);
    expect(res.body.voided).toBe(false);
    expect(helcimLib.voidTransaction).not.toHaveBeenCalled();
    expect(mailer.sendPreorderCleanupAlert).toHaveBeenCalledTimes(1);
  });

  test('readback failure without a nonce record sends no alert', async function () {
    keyStore = {};
    helcimLib.getCardTransactionById.mockRejectedValue(new Error('timeout'));
    var res = await post(body());
    expect(res.status).toBe(502);
    expect(mailer.sendPreorderCleanupAlert).not.toHaveBeenCalled();
  });

  test('readback 404 sends no alert', async function () {
    var err = new Error('not found');
    err.response = { status: 404 };
    helcimLib.getCardTransactionById.mockRejectedValue(err);
    var res = await post(body());
    expect(res.status).toBe(502);
    expect(mailer.sendPreorderCleanupAlert).not.toHaveBeenCalled();
    expect(helcimLib.voidTransaction).not.toHaveBeenCalled();
  });
});

describe('lock and replay', function () {
  test('cached replay returns 200 with the cached body, no void', async function () {
    keyStore['preorder:idem:' + TXN] = { ok: true, deposit_total: 100 };
    var res = await post(body());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, deposit_total: 100 });
    expect(helcimLib.voidTransaction).not.toHaveBeenCalled();
  });

  test('lock contention -> 409, no void', async function () {
    cache.acquireLock.mockResolvedValue(false);
    var res = await post(body());
    expect(res.status).toBe(409);
    expect(res.body.voided).toBe(false);
    expect(helcimLib.voidTransaction).not.toHaveBeenCalled();
  });

  test('lock failclosed (production Redis error) -> void + 503', async function () {
    var prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      cache.acquireLock.mockRejectedValue(new Error('redis'));
      var res = await post(body());
      expectVoided(res, 503, true);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  test('replay hit on the ferment cart namespace -> 409, no void', async function () {
    keyStore['helcim:txn:' + TXN + ':sv-cart-ferment'] = 'used';
    var res = await post(body());
    expect(res.status).toBe(409);
    expect(res.body.voided).toBe(false);
    expect(helcimLib.voidTransaction).not.toHaveBeenCalled();
  });

  test('replay failclosed on a suffix -> void + 503', async function () {
    cache.get.mockImplementation(function (k) {
      if (k === 'helcim:txn:' + TXN + ':preorder') return Promise.reject(new Error('redis'));
      return Promise.resolve(keyStore[k] || null);
    });
    var res = await post(body());
    expectVoided(res, 503, true);
  });

  test('failed void on failclosed reports voided:false and the generic message', async function () {
    cache.get.mockImplementation(function (k) {
      if (k.indexOf('helcim:txn:') === 0) return Promise.reject(new Error('redis'));
      return Promise.resolve(keyStore[k] || null);
    });
    helcimLib.voidTransaction.mockResolvedValue({ ok: false });
    var res = await post(body());
    expect(res.status).toBe(503);
    expect(res.body.voided).toBe(false);
    expect(res.body.error).toBe('Reservations are temporarily unavailable.');
  });
});

describe('post-ownership voids', function () {
  test('reCAPTCHA reject (production, no secret) -> void + 400', async function () {
    var prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      var res = await post(body());
      expectVoided(res, 400, true);
      expect(res.body.error).toBe('Request could not be verified. Please try again.');
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  test('invalid basket -> void + 400', async function () {
    var res = await post(body({ items: [{ item_id: 'nope', qty: 1 }] }));
    expectVoided(res, 400, true);
  });

  test('missing nonce record -> void + 400', async function () {
    delete keyStore['preorder:nonce:' + NONCE];
    var res = await post(body());
    expectVoided(res, 400, true);
  });

  test('basket differs from the nonce record -> void + 400', async function () {
    var res = await post(body({ items: [{ item_id: EMBER, qty: 2 }] }));
    expectVoided(res, 400, true);
  });

  test('one cent over -> void + 400', async function () {
    helcimLib.getCardTransactionById.mockResolvedValue({
      status: 'APPROVED', type: 'purchase', invoiceNumber: NONCE, amount: 100.01
    });
    var res = await post(body());
    expectVoided(res, 400, true);
    expect(res.body.error).toBe('Payment amount did not match your reservation');
  });

  test('one cent under -> void + 400', async function () {
    helcimLib.getCardTransactionById.mockResolvedValue({
      status: 'APPROVED', type: 'purchase', invoiceNumber: NONCE, amount: 99.99
    });
    var res = await post(body());
    expectVoided(res, 400, true);
  });

  test('Zoho offline -> void + 503', async function () {
    zohoAuth.isAuthenticated.mockReturnValue(false);
    var res = await post(body());
    expectVoided(res, 503, true);
  });

  test('bookDeposit rejection with no response sent -> void + 500', async function () {
    bookDeposit.mockRejectedValue(new Error('zoho exploded'));
    var res = await post(body());
    expect(res.status).toBe(500);
    expect(res.body.voided).toBe(true);
    expect(helcimLib.voidTransaction).toHaveBeenCalledTimes(1);
  });
});

describe('success path', function () {
  test('all checks pass -> bookDeposit receives the context, no void', async function () {
    var res = await post(body());
    expect(res.status).toBe(201);
    expect(helcimLib.voidTransaction).not.toHaveBeenCalled();
    var ctx = bookDeposit.mock.calls[0][0];
    expect(ctx).toEqual(expect.objectContaining({
      txnId: TXN, invoiceNumber: NONCE, totalKits: 2, amount: 100, idemKey: 'preorder:idem:' + TXN
    }));
    expect(ctx.customer).toEqual({ name: NAME, email: EMAIL, phone: PHONE });
  });
});

describe('error bodies and PII', function () {
  test('every error response carries a boolean voided', async function () {
    var scenarios = [
      function () { return post(body({ invoice_number: 'bad' })); },
      function () {
        helcimLib.getCardTransactionById.mockRejectedValueOnce(new Error('x'));
        return post(body());
      },
      function () {
        helcimLib.getCardTransactionById.mockResolvedValueOnce({ status: 'DECLINED', type: 'purchase', invoiceNumber: NONCE });
        return post(body());
      },
      function () { cache.acquireLock.mockResolvedValueOnce(false); return post(body()); },
      function () { return post(body({ items: [] })); }
    ];
    for (var i = 0; i < scenarios.length; i++) {
      var res = await scenarios[i]();
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(typeof res.body.voided).toBe('boolean');
    }
  });

  test('no log or event payload contains the customer PII', async function () {
    await post(body());
    await post(body({ items: [{ item_id: EMBER, qty: 2 }] }));
    helcimLib.getCardTransactionById.mockRejectedValueOnce(new Error('x'));
    await post(body());
    bookDeposit.mockRejectedValueOnce(new Error('boom'));
    await post(body());
    var dump = JSON.stringify([
      log.info.mock.calls, log.warn.mock.calls, log.error.mock.calls,
      eventLog.logEvent.mock.calls, mailer.sendPreorderCleanupAlert.mock.calls,
      mailer.sendVoidFailureAlert.mock.calls
    ]);
    expect(dump).not.toContain(EMAIL);
    expect(dump).not.toContain(NAME);
    expect(dump).not.toContain(PHONE);
  });
});
