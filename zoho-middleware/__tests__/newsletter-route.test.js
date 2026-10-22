'use strict';

// -----------------------------------------------------------------------------
// POST /api/newsletter — main mailing list signup (2026-10-22).
//
// Public form on the links, home and contact pages. MailerLite is the only
// store, so (unlike the beer waitlist) a MailerLite failure or a missing
// MAILERLITE_NEWSLETTER_GROUP_ID is a 503: a signup must never be accepted and
// then silently dropped. The response never discloses whether the address was
// already subscribed. A filled honeypot field is accepted silently and never
// subscribed. The CASL consent statement is logged with the signup.
//
// Server-boot mock harness copied from __tests__/waitlist-route.test.js.
// -----------------------------------------------------------------------------

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


var eventLog = require('../lib/eventLog');
var GROUP = '190455249312416776';

beforeEach(function () {
  mailerlite.isConfigured.mockReset().mockReturnValue(true);
  mailerlite.addSubscriber.mockReset().mockResolvedValue({ data: { id: 'sub' } });
  eventLog.logEvent.mockClear();
  process.env.MAILERLITE_NEWSLETTER_GROUP_ID = GROUP;
});

afterAll(function () { delete process.env.MAILERLITE_NEWSLETTER_GROUP_ID; });

function post(body) {
  return request(app).post('/api/newsletter').set('Content-Type', 'application/json').send(body);
}

describe('POST /api/newsletter', function () {
  test('subscribes a valid email into the newsletter group', async function () {
    var res = await post({ email: '  Pat@Example.com ', source: 'links', consent: true, consent_text: 'By signing up...' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(mailerlite.addSubscriber).toHaveBeenCalledWith('Pat@Example.com', [GROUP]);
  });

  test('logs the CASL consent record with source and masked email', async function () {
    await post({ email: 'pat@example.com', source: 'contact', consent: true, consent_text: 'By signing up, you agree' });
    var call = eventLog.logEvent.mock.calls.filter(function (c) { return c[0] === 'newsletter.consent'; })[0];
    expect(call).toBeTruthy();
    expect(call[1].source).toBe('contact');
    expect(call[1].consent).toBe(true);
    expect(call[1].consentText).toBe('By signing up, you agree');
    expect(call[1].email).not.toBe('pat@example.com');
  });

  test('an unknown source is recorded as "site"', async function () {
    await post({ email: 'pat@example.com', source: '<script>' });
    var call = eventLog.logEvent.mock.calls.filter(function (c) { return c[0] === 'newsletter.consent'; })[0];
    expect(call[1].source).toBe('site');
  });

  test('rejects an invalid email with 400 and does not subscribe', async function () {
    var res = await post({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(mailerlite.addSubscriber).not.toHaveBeenCalled();
  });

  test('a filled honeypot is answered like success but never subscribed', async function () {
    var res = await post({ email: 'bot@example.com', company: 'Acme' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(mailerlite.addSubscriber).not.toHaveBeenCalled();
  });

  test('MailerLite failure is a 503, never a silent success', async function () {
    mailerlite.addSubscriber.mockRejectedValue(new Error('MailerLite 500'));
    var res = await post({ email: 'pat@example.com' });
    expect(res.status).toBe(503);
    expect(res.body.success).toBeUndefined();
  });

  test('missing MAILERLITE_NEWSLETTER_GROUP_ID is a 503 (would land in no list)', async function () {
    delete process.env.MAILERLITE_NEWSLETTER_GROUP_ID;
    var res = await post({ email: 'pat@example.com' });
    expect(res.status).toBe(503);
    expect(mailerlite.addSubscriber).not.toHaveBeenCalled();
  });

  test('MailerLite not configured is a 503', async function () {
    mailerlite.isConfigured.mockReturnValue(false);
    var res = await post({ email: 'pat@example.com' });
    expect(res.status).toBe(503);
  });

  test('an existing subscriber gets the identical response', async function () {
    var first = await post({ email: 'pat@example.com' });
    var again = await post({ email: 'pat@example.com' });
    expect(again.status).toBe(first.status);
    expect(again.body).toEqual(first.body);
  });
});
