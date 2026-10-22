'use strict';

// POST /api/newsletter staff alert (2026-10-22): every successful website
// signup emails the shop (fire-and-forget), saying whether the address is new
// to MailerLite or was already subscribed. MailerLite returns the subscriber;
// a new record has created_at === updated_at.
// Server-boot mock harness copied from __tests__/waitlist-route.test.js.

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
  return { isConfigured: jest.fn().mockReturnValue(true), addSubscriber: jest.fn().mockResolvedValue({}) };
});
jest.mock('../lib/mailer', function () {
  var actual = jest.requireActual('../lib/mailer');
  return Object.assign({}, actual, { sendNewsletterNotification: jest.fn().mockResolvedValue({}) });
});
jest.mock('../lib/eventLog', function () { return { logEvent: jest.fn() }; });
jest.mock('../lib/inventory-ledger', function () { return { decrementStock: jest.fn().mockResolvedValue() }; });
jest.mock('../lib/cache', function () {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    acquireLock: jest.fn().mockResolvedValue(true),
    isConnected: jest.fn().mockReturnValue(false),
    init: jest.fn().mockResolvedValue(),
    getClient: jest.fn().mockResolvedValue(null)
  };
});
jest.mock('../lib/zoho-api', function () {
  return {
    zohoPost: jest.fn().mockResolvedValue({}),
    zohoGet: jest.fn().mockResolvedValue({ salesorders: [] }),
    zohoPut: jest.fn().mockResolvedValue({}),
    inventoryGet: jest.fn().mockResolvedValue({}),
    inventoryPut: jest.fn().mockResolvedValue({}),
    ZOHO_INVENTORY_BASE: 'https://inventory.zoho.com/api/v1'
  };
});
jest.mock('axios', function () {
  return { post: jest.fn(), get: jest.fn() };
});

process.env.APPS_SCRIPT_URL = 'https://script.google.com/macros/s/test/exec';
process.env.APPS_SCRIPT_SERVER_TOKEN = 'test-server-token';

var request = require('supertest');
var app = require('../server');

// server.js calls dotenv.config() on require, which may repopulate
// RESEND_API_KEY from a local (gitignored) .env. Neutralize it AFTER the
// require so lib/mailer's real sendWaitlistNotification (unmocked — it is
// fire-and-forget and its own outcome is asserted nowhere in this file)
// deterministically rejects without attempting a real network call.
process.env.RESEND_API_KEY = '';

var axios = require('axios');
var mailerlite = require('../lib/mailerlite');

var mailer = require('../lib/mailer');

function flush() { return new Promise(function (r) { setTimeout(r, 0); }); }

beforeEach(function () {
  mailerlite.isConfigured.mockReset().mockReturnValue(true);
  mailer.sendNewsletterNotification.mockReset().mockResolvedValue({});
  process.env.MAILERLITE_NEWSLETTER_GROUP_ID = '190455249312416776';
});

afterAll(function () { delete process.env.MAILERLITE_NEWSLETTER_GROUP_ID; });

function post(body) {
  return request(app).post('/api/newsletter').set('Content-Type', 'application/json').send(body);
}

describe('newsletter signup staff alert', function () {
  test('a new subscriber triggers an alert marked new', async function () {
    mailerlite.addSubscriber.mockReset().mockResolvedValue({ data: { created_at: '2026-10-22 23:01:52', updated_at: '2026-10-22 23:01:52' } });
    var res = await post({ email: 'new@example.com', source: 'home' });
    await flush();
    expect(res.status).toBe(200);
    expect(mailer.sendNewsletterNotification).toHaveBeenCalledWith({ email: 'new@example.com', source: 'home', alreadySubscribed: false });
  });

  test('an existing subscriber triggers an alert marked already subscribed', async function () {
    mailerlite.addSubscriber.mockReset().mockResolvedValue({ data: { created_at: '2026-06-16 17:51:18', updated_at: '2026-10-22 22:59:15' } });
    await post({ email: 'old@example.com', source: 'links' });
    await flush();
    expect(mailer.sendNewsletterNotification).toHaveBeenCalledWith({ email: 'old@example.com', source: 'links', alreadySubscribed: true });
  });

  test('a failed alert email never changes the signup response', async function () {
    mailerlite.addSubscriber.mockReset().mockResolvedValue({ data: {} });
    mailer.sendNewsletterNotification.mockRejectedValue(new Error('Resend down'));
    var res = await post({ email: 'new@example.com', source: 'contact' });
    await flush();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  test('no alert for a honeypot hit or a failed signup', async function () {
    await post({ email: 'bot@example.com', company: 'x' });
    mailerlite.addSubscriber.mockReset().mockRejectedValue(new Error('MailerLite 500'));
    await post({ email: 'pat@example.com' });
    await flush();
    expect(mailer.sendNewsletterNotification).not.toHaveBeenCalled();
  });
});
