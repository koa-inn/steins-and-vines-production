'use strict';

// Phase 100 Plan 07 -- POST /api/preorder/deposit booking stage.

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
jest.mock('../lib/limited-releases-deposit', function () {
  return {
    getKitRate: jest.fn(),
    resolveFeeItems: jest.fn(),
    createDepositSet: jest.fn(),
    cleanupDepositSet: jest.fn()
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
    sendPreorderCleanupAlert: jest.fn().mockResolvedValue(),
    sendPreorderDepositConfirmation: jest.fn().mockResolvedValue(),
    sendPreorderDepositNotification: jest.fn().mockResolvedValue(),
    sendNewsletterNotification: jest.fn().mockResolvedValue()
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
var helpers = require('../lib/checkout-helpers');
var deposit = require('../lib/limited-releases-deposit');
var mailerlite = require('../lib/mailerlite');
var brewpad = require('../lib/brewpad-integration');
var ledger = require('../lib/inventory-ledger');

var EMBER = '109900000001719001';
var AMICI = '109900000001719100';
var NONCE = 'LR-0123456789abcdef';
var TXN = '57428079';
var REFERER = 'https://staging.steinsandvines.ca/limited-releases';
var EMAIL = 'pii.person@example.org';
var NAME = 'Pii Personname';
var PHONE = '604-555-0199';
var FAIL_MSG = 'We could not complete your reservation.';

function body(over) {
  return Object.assign({
    transaction_id: TXN,
    invoice_number: NONCE,
    items: [{ item_id: EMBER, qty: 2 }, { item_id: AMICI, qty: 1 }],
    customer: { name: NAME, email: EMAIL, phone: PHONE },
    consent: { accepted: true, text: 'I agree to the deposit terms.' },
    newsletter: false,
    recaptcha_token: 'tok'
  }, over || {});
}

function post(b) {
  return request(app).post('/api/preorder/deposit').set('Referer', REFERER).send(b);
}

function flush() { return new Promise(function (r) { setImmediate(r); }); }

var keyStore;
var notifySpy;

function createdSet() {
  return {
    created: [
      { item_id: EMBER, salesorder_id: 'so1', salesorder_number: 'SO-1', payment_id: 'p1', name: 'Ember', release_label: 'November 2026' },
      { item_id: EMBER, salesorder_id: 'so2', salesorder_number: 'SO-2', payment_id: 'p2', name: 'Ember', release_label: 'November 2026' },
      { item_id: AMICI, salesorder_id: 'so3', salesorder_number: 'SO-3', payment_id: 'p3', name: 'Amici', release_label: 'April 2027' }
    ]
  };
}

beforeEach(function () {
  jest.resetAllMocks();
  process.env.RECAPTCHA_SECRET_KEY = '';
  process.env.PREORDER_DEPOSITS_ENABLED = 'true';
  zohoAuth.isAuthenticated.mockReturnValue(true);
  keyStore = {};
  keyStore['preorder:nonce:' + NONCE] = {
    amount: 150,
    lines: [{ item_id: AMICI, qty: 1 }, { item_id: EMBER, qty: 2 }],
    created_at: 'x'
  };
  cache.get.mockImplementation(function (k) { return Promise.resolve(keyStore[k] || null); });
  cache.set.mockResolvedValue('OK');
  cache.del.mockResolvedValue(1);
  cache.acquireLock.mockResolvedValue(true);
  cache.isConnected.mockReturnValue(false);
  helcimLib.isEnabled.mockReturnValue(true);
  helcimLib.voidTransaction.mockResolvedValue({ ok: true });
  helcimLib.getCardTransactionById.mockResolvedValue({
    status: 'APPROVED', type: 'purchase', invoiceNumber: NONCE, amount: 150, transactionId: TXN
  });
  mailer.sendPreorderCleanupAlert.mockResolvedValue();
  mailer.sendPreorderDepositConfirmation.mockResolvedValue();
  mailer.sendPreorderDepositNotification.mockResolvedValue();
  mailer.sendNewsletterNotification.mockResolvedValue();
  mailer.sendVoidFailureAlert.mockResolvedValue();
  mailerlite.isConfigured.mockReturnValue(true);
  mailerlite.addSubscriber.mockResolvedValue({ data: {} });
  jest.spyOn(helpers, 'resolveOrCreateContact').mockResolvedValue({ contactId: 'c1', freshlyCreated: false });
  notifySpy = jest.spyOn(helpers, 'notifyAdminPanel').mockResolvedValue();
  deposit.resolveFeeItems.mockResolvedValue({
    makers: { item_id: '111', rate: 30 }, materials: { item_id: '222', rate: 20 }
  });
  deposit.getKitRate.mockResolvedValue(200);
  deposit.createDepositSet.mockResolvedValue(createdSet());
  deposit.cleanupDepositSet.mockResolvedValue({ ok: true, leftovers: [] });
});

describe('happy path', function () {
  test('3 kits -> 3 SOs, 201 with every SO, no PII in sentinel', async function () {
    var res = await post(body());
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.deposit_total).toBe(150);
    expect(res.body.kit_count).toBe(3);
    expect(res.body.salesorders).toHaveLength(3);
    res.body.salesorders.forEach(function (so) {
      expect(so.salesorder_number).toBeTruthy();
      expect(so.item_id).toBeTruthy();
      expect(so.name).toBeTruthy();
      expect(so.release_label).toBeTruthy();
    });
    expect(deposit.createDepositSet).toHaveBeenCalledTimes(1);
    var arg = deposit.createDepositSet.mock.calls[0][0];
    expect(arg.units).toHaveLength(3);
    expect(arg.units.map(function (u) { return u.item_id; })).toEqual([EMBER, EMBER, AMICI]);
    expect(arg.customerId).toBe('c1');
    expect(arg.txnId).toBe(TXN);
    expect(arg.consentText).toBe('I agree to the deposit terms.');
    expect(new Date(arg.consentAt).toISOString()).toBe(arg.consentAt);
    expect(deposit.getKitRate).toHaveBeenCalledTimes(2);
    var pending = cache.set.mock.calls.filter(function (c) { return c[0] === 'preorder:pending:' + TXN; });
    expect(pending).toHaveLength(1);
    expect(pending[0][2]).toBe(604800);
    expect(JSON.stringify(pending[0][1])).not.toMatch(/pii|604-555/i);
    expect(cache.set.mock.invocationCallOrder[0]).toBeLessThan(helpers.resolveOrCreateContact.mock.invocationCallOrder[0]);
    expect(cache.set).toHaveBeenCalledWith('preorder:idem:' + TXN, res.body, 86400);
    ['', ':sv-cart-ferment', ':sv-cart-ingredients', ':preorder'].forEach(function (sfx) {
      expect(cache.set).toHaveBeenCalledWith('helcim:txn:' + TXN + sfx, 'used', 2592000);
    });
    expect(cache.del).toHaveBeenCalledWith('preorder:nonce:' + NONCE);
    expect(cache.del).toHaveBeenCalledWith('preorder:pending:' + TXN);
    expect(eventLog.logEvent).toHaveBeenCalledWith('preorder.deposit_completed',
      { txnId: TXN, kitCount: 3, soCount: 3, grandTotal: 150 });
  });
});

describe('replay', function () {
  test('second identical request returns cached body, no second set', async function () {
    var first = await post(body());
    expect(first.status).toBe(201);
    keyStore['preorder:idem:' + TXN] = first.body;
    cache.acquireLock.mockResolvedValue(false);
    var second = await post(body());
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(deposit.createDepositSet).toHaveBeenCalledTimes(1);
  });
});

describe('email', function () {
  test('both emails fire with every SO; a rejection does not change the 201', async function () {
    mailer.sendPreorderDepositConfirmation.mockRejectedValue(new Error('smtp down'));
    mailer.sendPreorderDepositNotification.mockRejectedValue(new Error('smtp down'));
    var res = await post(body());
    await flush();
    expect(res.status).toBe(201);
    var c = mailer.sendPreorderDepositConfirmation.mock.calls[0][0];
    expect(c.salesorders).toHaveLength(3);
    expect(c.email).toBe(EMAIL);
    expect(c.depositTotal).toBe(150);
    expect(c.kitCount).toBe(3);
    expect(mailer.sendPreorderDepositNotification.mock.calls[0][0].salesorders).toHaveLength(3);
  });

  test('no PII in logger or eventLog', async function () {
    await post(body());
    await flush();
    var all = JSON.stringify([log.info.mock.calls, log.warn.mock.calls, log.error.mock.calls, eventLog.logEvent.mock.calls]);
    expect(all).not.toContain(EMAIL);
    expect(all).not.toContain(NAME);
    expect(all).not.toContain(PHONE);
  });
});

describe('newsletter', function () {
  test('strict true subscribes once with source preorder', async function () {
    await post(body({ newsletter: true }));
    await flush();
    expect(mailerlite.addSubscriber).toHaveBeenCalledTimes(1);
    expect(eventLog.logEvent).toHaveBeenCalledWith('preorder.newsletter_opt_in',
      expect.objectContaining({ source: 'preorder', orderNumber: 'SO-1' }));
    expect(JSON.stringify(eventLog.logEvent.mock.calls)).not.toContain(EMAIL);
  });

  test('false / absent -> not called', async function () {
    await post(body({ newsletter: false }));
    var b = body();
    delete b.newsletter;
    await post(b);
    await flush();
    expect(mailerlite.addSubscriber).not.toHaveBeenCalled();
  });

  test("string 'true' is rejected by shape validation, not subscribed", async function () {
    var res = await post(body({ newsletter: 'true' }));
    await flush();
    expect(res.status).toBe(400);
    expect(mailerlite.addSubscriber).not.toHaveBeenCalled();
  });
});

describe('no-batch', function () {
  test('no batch, ledger or admin panel side effects', async function () {
    await post(body());
    await flush();
    expect(brewpad.createBatchesFromSale).not.toHaveBeenCalled();
    expect(ledger.decrementStock).not.toHaveBeenCalled();
    expect(notifySpy).not.toHaveBeenCalled();
  });
});

describe('failure after capture', function () {
  function expectNoSuccessState() {
    expect(cache.set.mock.calls.some(function (c) { return c[0] === 'preorder:idem:' + TXN; })).toBe(false);
    expect(cache.set.mock.calls.some(function (c) { return /^helcim:txn:/.test(c[0]); })).toBe(false);
    expect(cache.del).not.toHaveBeenCalledWith('preorder:nonce:' + NONCE);
  }

  test('contact failure: no SO writes, void once, voided:true', async function () {
    helpers.resolveOrCreateContact.mockRejectedValue(new Error('zoho down'));
    var res = await post(body());
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: FAIL_MSG, voided: true });
    expect(deposit.createDepositSet).not.toHaveBeenCalled();
    expect(helcimLib.voidTransaction).toHaveBeenCalledTimes(1);
    expect(cache.del).toHaveBeenCalledWith('preorder:pending:' + TXN);
    expectNoSuccessState();
    expect(eventLog.logEvent).toHaveBeenCalledWith('preorder.failed_after_charge',
      expect.objectContaining({ txnId: TXN, stage: 'contact', voided: true, leftoverCount: 0 }));
  });

  test('fee lookup failure: void, no SO writes', async function () {
    var e = new Error('fees'); e.isFeeConfig = true;
    deposit.resolveFeeItems.mockRejectedValue(e);
    var res = await post(body());
    expect(res.body).toEqual({ error: FAIL_MSG, voided: true });
    expect(deposit.createDepositSet).not.toHaveBeenCalled();
    expect(helcimLib.voidTransaction).toHaveBeenCalledTimes(1);
    expectNoSuccessState();
  });

  test('kit rate failure: void, no SO writes', async function () {
    deposit.getKitRate.mockRejectedValue(new Error('rate'));
    var res = await post(body());
    expect(res.body.voided).toBe(true);
    expect(deposit.createDepositSet).not.toHaveBeenCalled();
    expect(helcimLib.voidTransaction).toHaveBeenCalledTimes(1);
  });

  test('create failure: cleanup with created list BEFORE void', async function () {
    var err = new Error('so2 failed');
    err.created = [createdSet().created[0]];
    deposit.createDepositSet.mockRejectedValue(err);
    var res = await post(body());
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: FAIL_MSG, voided: true });
    expect(deposit.cleanupDepositSet.mock.calls[0][0]).toEqual(err.created);
    expect(deposit.cleanupDepositSet.mock.invocationCallOrder[0])
      .toBeLessThan(helcimLib.voidTransaction.mock.invocationCallOrder[0]);
    expect(mailer.sendPreorderCleanupAlert).not.toHaveBeenCalled();
    expectNoSuccessState();
  });

  test('leftovers -> one staff alert, sentinel kept', async function () {
    var err = new Error('x');
    err.created = [createdSet().created[0]];
    deposit.createDepositSet.mockRejectedValue(err);
    deposit.cleanupDepositSet.mockResolvedValue({ ok: false, leftovers: [{ kind: 'payment', id: 'p1' }] });
    await post(body());
    await flush();
    expect(mailer.sendPreorderCleanupAlert).toHaveBeenCalledTimes(1);
    expect(mailer.sendPreorderCleanupAlert).toHaveBeenCalledWith({
      txnId: TXN, voided: true, leftovers: [{ kind: 'payment', id: 'p1' }], possibleOrphan: false
    });
    expect(cache.del).not.toHaveBeenCalledWith('preorder:pending:' + TXN);
  });

  test('possibleOrphan with no leftovers still alerts', async function () {
    var err = new Error('timeout');
    err.possibleOrphan = true;
    err.created = [];
    deposit.createDepositSet.mockRejectedValue(err);
    await post(body());
    await flush();
    expect(deposit.cleanupDepositSet).not.toHaveBeenCalled();
    expect(mailer.sendPreorderCleanupAlert).toHaveBeenCalledWith(
      expect.objectContaining({ txnId: TXN, possibleOrphan: true, leftovers: [] }));
    expect(cache.del).not.toHaveBeenCalledWith('preorder:pending:' + TXN);
  });

  test('cleanup throwing still voids once and alerts', async function () {
    var err = new Error('x');
    err.created = [createdSet().created[0]];
    deposit.createDepositSet.mockRejectedValue(err);
    deposit.cleanupDepositSet.mockRejectedValue(new Error('boom'));
    var res = await post(body());
    await flush();
    expect(res.status).toBe(500);
    expect(helcimLib.voidTransaction).toHaveBeenCalledTimes(1);
    expect(mailer.sendPreorderCleanupAlert).toHaveBeenCalledTimes(1);
    expect(mailer.sendPreorderCleanupAlert.mock.calls[0][0].leftovers).toHaveLength(1);
  });

  test('void failure -> voided:false, sentinel kept', async function () {
    helpers.resolveOrCreateContact.mockRejectedValue(new Error('zoho down'));
    helcimLib.voidTransaction.mockResolvedValue({ ok: false });
    var res = await post(body());
    expect(res.status).toBe(500);
    expect(res.body.voided).toBe(false);
    expect(cache.del).not.toHaveBeenCalledWith('preorder:pending:' + TXN);
    expectNoSuccessState();
  });

  test('no PII in logs on failure', async function () {
    helpers.resolveOrCreateContact.mockRejectedValue(new Error('zoho down'));
    await post(body());
    await flush();
    var all = JSON.stringify([log.info.mock.calls, log.warn.mock.calls, log.error.mock.calls, eventLog.logEvent.mock.calls]);
    expect(all).not.toContain(EMAIL);
    expect(all).not.toContain(NAME);
    expect(all).not.toContain(PHONE);
  });
});
