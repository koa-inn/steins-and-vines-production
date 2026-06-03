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
