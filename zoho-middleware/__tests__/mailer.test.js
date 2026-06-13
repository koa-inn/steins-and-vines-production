'use strict';

// ---------------------------------------------------------------------------
// nodemailer mock — must be declared before require()
// A shared transport object lets each test control verify()/sendMail() behavior.
// ---------------------------------------------------------------------------
var mockTransport = {
  verify: jest.fn(),
  sendMail: jest.fn()
};
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(function () { return mockTransport; })
}));

var mailer = require('../lib/mailer');

describe('mailer.isConfigured', () => {
  var origUser = process.env.SMTP_USER;
  var origPass = process.env.SMTP_PASS;

  afterEach(() => {
    process.env.SMTP_USER = origUser;
    process.env.SMTP_PASS = origPass;
    if (origUser === undefined) delete process.env.SMTP_USER;
    if (origPass === undefined) delete process.env.SMTP_PASS;
  });

  test('true when both SMTP_USER and SMTP_PASS are set', () => {
    process.env.SMTP_USER = 'user@example.com';
    process.env.SMTP_PASS = 'app-password';
    expect(mailer.isConfigured()).toBe(true);
  });

  test('false when SMTP_USER missing', () => {
    delete process.env.SMTP_USER;
    process.env.SMTP_PASS = 'app-password';
    expect(mailer.isConfigured()).toBe(false);
  });

  test('false when SMTP_PASS missing', () => {
    process.env.SMTP_USER = 'user@example.com';
    delete process.env.SMTP_PASS;
    expect(mailer.isConfigured()).toBe(false);
  });

  test('false when both missing', () => {
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    expect(mailer.isConfigured()).toBe(false);
  });
});

describe('mailer.verifyTransport', () => {
  var origUser = process.env.SMTP_USER;
  var origPass = process.env.SMTP_PASS;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SMTP_USER = 'user@example.com';
    process.env.SMTP_PASS = 'app-password';
  });

  afterEach(() => {
    process.env.SMTP_USER = origUser;
    process.env.SMTP_PASS = origPass;
    if (origUser === undefined) delete process.env.SMTP_USER;
    if (origPass === undefined) delete process.env.SMTP_PASS;
  });

  test('not configured → resolves {ok:false, configured:false} without hitting SMTP', async () => {
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    var result = await mailer.verifyTransport();
    expect(result).toEqual({ ok: false, configured: false, error: 'SMTP_USER/SMTP_PASS not set' });
    expect(mockTransport.verify).not.toHaveBeenCalled();
  });

  test('verify succeeds → {ok:true, configured:true}', async () => {
    mockTransport.verify.mockResolvedValue(true);
    var result = await mailer.verifyTransport();
    expect(result).toEqual({ ok: true, configured: true });
    expect(mockTransport.verify).toHaveBeenCalled();
  });

  test('verify rejects (bad credentials) → {ok:false, configured:true, error}', async () => {
    mockTransport.verify.mockRejectedValue(new Error('535-5.7.8 Username and Password not accepted'));
    var result = await mailer.verifyTransport();
    expect(result.ok).toBe(false);
    expect(result.configured).toBe(true);
    expect(result.error).toMatch(/Username and Password not accepted/);
  });

  test('never rejects — even on a non-Error throw', async () => {
    mockTransport.verify.mockRejectedValue('connection refused');
    var result = await mailer.verifyTransport();
    expect(result.ok).toBe(false);
    expect(result.error).toBe('connection refused');
  });
});

// Regression: a Railway deploy stalled ~2 min at startup because the SMTP
// socket had no timeout — the IPv6 connect to smtp.gmail.com:587 hung on the
// OS default TCP timeout, blocking the server from listening (502s the whole
// time). The transport MUST carry bounded connection/greeting/socket timeouts
// so verify() and sendMail() can never hang for minutes.
describe('mailer createTransport — bounded SMTP timeouts', () => {
  var nodemailer = require('nodemailer');
  var origUser = process.env.SMTP_USER;
  var origPass = process.env.SMTP_PASS;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SMTP_USER = 'user@example.com';
    process.env.SMTP_PASS = 'app-password';
    mockTransport.verify.mockResolvedValue(true);
  });

  afterEach(() => {
    process.env.SMTP_USER = origUser;
    process.env.SMTP_PASS = origPass;
    if (origUser === undefined) delete process.env.SMTP_USER;
    if (origPass === undefined) delete process.env.SMTP_PASS;
  });

  test('transport is created with bounded connection/greeting/socket timeouts', async () => {
    await mailer.verifyTransport();
    expect(nodemailer.createTransport).toHaveBeenCalled();
    var opts = nodemailer.createTransport.mock.calls[0][0];
    // Each timeout must be present and bounded well under the ~120s OS default
    // that caused the startup stall.
    expect(opts.connectionTimeout).toBeGreaterThan(0);
    expect(opts.connectionTimeout).toBeLessThanOrEqual(15000);
    expect(opts.greetingTimeout).toBeGreaterThan(0);
    expect(opts.greetingTimeout).toBeLessThanOrEqual(15000);
    expect(opts.socketTimeout).toBeGreaterThan(0);
    expect(opts.socketTimeout).toBeLessThanOrEqual(30000);
  });
});
