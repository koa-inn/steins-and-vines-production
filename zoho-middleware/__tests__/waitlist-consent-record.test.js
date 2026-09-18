'use strict';

// -----------------------------------------------------------------------------
// Phase 78-02: POST /api/waitlist — D-03/D-06/D-07 endpoint contract.
//
// D-03: the Waitlist sheet row is authoritative and blocking; a MailerLite
// outage/misconfiguration must NOT turn a customer away (still 200), and the
// endpoint must fail closed (503) only when the sheet write itself fails.
// D-06: a first-time signup and a dedupe-hit signup get an IDENTICAL response
// — the endpoint must never disclose whether an address was already listed.
// D-07: on MailerLite success a best-effort update_waitlist_status write sets
// mailerlite_synced true, so drift is a persisted cell, not a log line.
//
// Server-boot mock harness mirrors __tests__/api-key-guard.test.js /
// __tests__/checkout-captured-amount.test.js (server.js pulls in every route
// file at require time, so their dependencies must be mocked for a clean boot).
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

function flushPromises() {
  return new Promise(function (resolve) { setTimeout(resolve, 0); });
}

// Default Apps Script mock: add_waitlist_entry succeeds with a fresh id;
// update_waitlist_status (the D-07 sync-flag write) succeeds too.
function mockAppsScript(overrides) {
  overrides = overrides || {};
  axios.post.mockImplementation(function (url, body) {
    var parsed = JSON.parse(body);
    if (parsed.action === 'add_waitlist_entry') {
      return overrides.addWaitlistEntry
        ? overrides.addWaitlistEntry(parsed)
        : Promise.resolve({ data: { ok: true, id: 'u-1' } });
    }
    if (parsed.action === 'update_waitlist_status') {
      return overrides.updateWaitlistStatus
        ? overrides.updateWaitlistStatus(parsed)
        : Promise.resolve({ data: { ok: true, id: parsed.id, status: 'waiting' } });
    }
    return Promise.resolve({ data: { ok: true } });
  });
}

function postCallsFor(action) {
  return axios.post.mock.calls.filter(function (c) {
    try { return JSON.parse(c[1]).action === action; } catch (e) { return false; }
  });
}

beforeEach(function () {
  jest.clearAllMocks();
  mailerlite.isConfigured.mockReturnValue(true);
  mailerlite.addSubscriber.mockResolvedValue({});
  mockAppsScript();
});

var eventLog = require('../lib/eventLog');

// -----------------------------------------------------------------------------
// CASL consent record for the beer waitlist. The form now sends
// { consent: true, consent_text } (the statement it displayed); the route logs
// a waitlist.consent event carrying a masked email, the sheet entry id, and
// that text, so express consent is provable without a sheet schema change.
// Harness prelude copied from waitlist-route.test.js.
// -----------------------------------------------------------------------------

function consentEvents() {
  return eventLog.logEvent.mock.calls.filter(function (c) { return c[0] === 'waitlist.consent'; }).map(function (c) { return c[1]; });
}

describe('POST /api/waitlist — consent record', function () {
  test('logs the consent event with a masked email, the entry id and the statement', function () {
    var text = 'By joining, you agree to receive emails from Steins & Vines about the beer programme. Every email has an unsubscribe link.';
    return request(app).post('/api/waitlist').send({ email: 'Signup@Example.com', consent: true, consent_text: text })
      .then(function (res) {
        expect(res.status).toBe(200);
        var ev = consentEvents();
        expect(ev).toHaveLength(1);
        expect(ev[0].consent).toBe(true);
        expect(ev[0].consentText).toBe(text);
        expect(ev[0].entryId).toBe('u-1');
        expect(ev[0].source).toBe('beer-waitlist');
        expect(ev[0].email).not.toContain('Signup@Example.com');
        expect(ev[0].email).toMatch(/@/);
      });
  });

  test('a signup without the fields is recorded as consent false with no text, not assumed', function () {
    return request(app).post('/api/waitlist').send({ email: 'plain@example.com' })
      .then(function () {
        var ev = consentEvents();
        expect(ev).toHaveLength(1);
        expect(ev[0].consent).toBe(false);
        expect(ev[0].consentText).toBe('');
      });
  });

  test('the recorded text is capped and non-strings are ignored', function () {
    var huge = new Array(60).join('consent statement ');
    return request(app).post('/api/waitlist').send({ email: 'cap@example.com', consent: 'yes', consent_text: huge })
      .then(function () {
        var ev = consentEvents()[0];
        expect(ev.consent).toBe(false);
        expect(ev.consentText.length).toBe(400);
      })
      .then(function () {
        jest.clearAllMocks(); mockAppsScript();
        return request(app).post('/api/waitlist').send({ email: 'obj@example.com', consent: true, consent_text: { evil: 1 } });
      })
      .then(function () {
        expect(consentEvents()[0].consentText).toBe('');
      });
  });

  test('no consent event when the sheet write fails (nothing was recorded)', function () {
    mockAppsScript({ addWaitlistEntry: function () { return Promise.resolve({ data: { ok: false, error: 'boom' } }); } });
    return request(app).post('/api/waitlist').send({ email: 'fail@example.com', consent: true, consent_text: 'x' })
      .then(function (res) {
        expect(res.status).toBe(503);
        expect(consentEvents()).toHaveLength(0);
      });
  });
});
