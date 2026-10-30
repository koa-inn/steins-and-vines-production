'use strict';

// Quick task 261029-zq1 Task 5 — warn staff BEFORE the shared Zoho Inventory
// quota runs out. When `remaining` first drops below ZOHO_QUOTA_ALERT (default
// 300) in a quota day, ONE email per environment per quota day goes to the
// staff alert address, plus a WARN log and a Sentry warning. Exhaustion
// (429 code 45) alerts once as well. De-dup lives in Redis and expires at the
// quota reset.

jest.mock('../lib/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('@sentry/node', () => ({ captureMessage: jest.fn(), captureException: jest.fn() }));
jest.mock('../lib/mailer', () => ({ sendZohoQuotaAlert: jest.fn().mockResolvedValue({ id: 'm1' }) }));

var mockLocks = {};
jest.mock('../lib/cache', () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(),
  del: jest.fn(),
  acquireLock: jest.fn(function (k) {
    if (mockLocks[k]) return Promise.resolve(false);
    mockLocks[k] = true;
    return Promise.resolve(true);
  }),
  releaseLock: jest.fn().mockResolvedValue(),
  isConnected: jest.fn().mockReturnValue(true)
}));

var NOW = Date.parse('2026-10-29T17:00:00.000Z');
var quota, alert, mailer, Sentry, log, cache;

function reading(remaining, reset) {
  quota.recordHeaders({
    'x-rate-limit-remaining': String(remaining),
    'x-rate-limit-limit': '1000',
    'x-rate-limit-reset': String(reset === undefined ? 50400 : reset)
  });
}

function code45() {
  var err = new Error('429');
  err.response = { status: 429, headers: { 'x-rate-limit-remaining': '0', 'x-rate-limit-reset': '50400' },
    data: { code: 45, message: 'exceeded the maximum call rate limit of 1,000' } };
  return err;
}

function flush() {
  return new Promise(function (r) { setImmediate(r); });
}

beforeEach(() => {
  jest.resetModules();
  mockLocks = {};
  delete process.env.ZOHO_QUOTA_ALERT;
  process.env.RAILWAY_ENVIRONMENT_NAME = 'production';
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  quota = require('../lib/zoho-quota');
  alert = require('../lib/zoho-quota-alert');
  mailer = require('../lib/mailer');
  Sentry = require('@sentry/node');
  log = require('../lib/logger');
  cache = require('../lib/cache');
  alert.install();
});

afterEach(() => {
  Date.now.mockRestore();
  delete process.env.RAILWAY_ENVIRONMENT_NAME;
});

test('no alert while remaining is at or above the threshold', async () => {
  reading(300);
  await flush();
  expect(mailer.sendZohoQuotaAlert).not.toHaveBeenCalled();
});

test('first drop below 300 sends ONE email + WARN + Sentry warning', async () => {
  reading(299);
  await flush();
  reading(250);
  reading(120);
  await flush();
  expect(mailer.sendZohoQuotaAlert).toHaveBeenCalledTimes(1);
  var arg = mailer.sendZohoQuotaAlert.mock.calls[0][0];
  expect(arg).toMatchObject({ remaining: 299, limit: 1000, env: 'production', kind: 'low' });
  expect(arg.resetAt).toBe(new Date(NOW + 50400 * 1000).toISOString());
  expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('299'));
  expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
  expect(Sentry.captureMessage.mock.calls[0][1]).toMatchObject({ level: 'warning' });
});

test('de-dup key is per env + quota day and expires at the reset', async () => {
  reading(200, 3600);
  await flush();
  var call = cache.acquireLock.mock.calls[0];
  expect(call[0]).toMatch(/production/);
  expect(call[0]).toMatch(/low/);
  expect(call[1]).toBe(3600);
});

test('another instance already alerted (lock held) → no email', async () => {
  reading(200, 3600);
  await flush();
  jest.resetModules();
  // simulate a second process sharing Redis
  var quota2 = require('../lib/zoho-quota');
  var alert2 = require('../lib/zoho-quota-alert');
  var mailer2 = require('../lib/mailer');
  alert2.install();
  quota2.recordHeaders({ 'x-rate-limit-remaining': '150', 'x-rate-limit-reset': '3500' });
  await flush();
  expect(mailer2.sendZohoQuotaAlert).not.toHaveBeenCalled();
});

test('a new quota day alerts again', async () => {
  reading(200, 3600);
  await flush();
  Date.now.mockReturnValue(NOW + 3600 * 1000 + 60000); // past the reset
  reading(280, 86400 - 60);
  await flush();
  expect(mailer.sendZohoQuotaAlert).toHaveBeenCalledTimes(2);
});

test('ZOHO_QUOTA_ALERT overrides the threshold', async () => {
  process.env.ZOHO_QUOTA_ALERT = '100';
  reading(150);
  await flush();
  expect(mailer.sendZohoQuotaAlert).not.toHaveBeenCalled();
  reading(99);
  await flush();
  expect(mailer.sendZohoQuotaAlert).toHaveBeenCalledTimes(1);
});

test('exhaustion (code 45) alerts once, separately from the low alert', async () => {
  reading(200);
  await flush();
  quota.recordError(code45());
  await flush();
  quota.recordError(code45());
  await flush();
  var kinds = mailer.sendZohoQuotaAlert.mock.calls.map(function (c) { return c[0].kind; });
  expect(kinds.filter(function (k) { return k === 'low'; })).toHaveLength(1);
  expect(kinds.filter(function (k) { return k === 'exhausted'; })).toHaveLength(1);
});

test('a mailer failure is logged, never thrown', async () => {
  mailer.sendZohoQuotaAlert.mockRejectedValueOnce(new Error('resend down'));
  expect(function () { reading(10); }).not.toThrow();
  await flush();
  await flush();
  expect(log.error).toHaveBeenCalledWith(expect.stringContaining('resend down'));
});
