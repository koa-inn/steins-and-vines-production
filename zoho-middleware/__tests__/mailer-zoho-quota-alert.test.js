'use strict';

// Quick task 261029-zq1 Task 5 — staff email for a low / exhausted Zoho
// Inventory quota.

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));

var axios = require('axios');
var mailer = require('../lib/mailer');

describe('sendZohoQuotaAlert', function () {
  var origKey = process.env.RESEND_API_KEY;
  var origTo = process.env.CONTACT_TO;

  beforeEach(function () {
    jest.clearAllMocks();
    process.env.RESEND_API_KEY = 're_test_123';
    process.env.CONTACT_TO = 'staff@example.com';
    axios.post.mockResolvedValue({ data: { id: 'msg_1' } });
  });

  afterEach(function () {
    process.env.RESEND_API_KEY = origKey;
    if (origKey === undefined) delete process.env.RESEND_API_KEY;
    process.env.CONTACT_TO = origTo;
    if (origTo === undefined) delete process.env.CONTACT_TO;
  });

  function sent() { return axios.post.mock.calls[0][1]; }

  test('low-quota email goes to the staff address with env, remaining, limit and reset', async function () {
    await mailer.sendZohoQuotaAlert({ remaining: 287, limit: 1000, resetAt: '2026-10-30T07:00:00.000Z', env: 'production', kind: 'low' });
    var m = sent();
    expect(m.to).toEqual(['staff@example.com']);
    expect(m.subject).toContain('production');
    expect(m.subject).toContain('287');
    expect(m.text).toContain('287 of 1000');
    expect(m.text).toContain('2026-10-30T07:00:00.000Z');
  });

  test('exhausted email says calls are paused', async function () {
    await mailer.sendZohoQuotaAlert({ remaining: 0, limit: 1000, resetAt: '2026-10-30T07:00:00.000Z', env: 'staging', kind: 'exhausted' });
    var m = sent();
    expect(m.subject).toMatch(/exhausted/i);
    expect(m.subject).toContain('staging');
    expect(m.text).toMatch(/paused/i);
  });

  test('missing fields render as unknown, never throw', async function () {
    await mailer.sendZohoQuotaAlert({});
    var m = sent();
    expect(m.text).toContain('unknown');
  });
});
