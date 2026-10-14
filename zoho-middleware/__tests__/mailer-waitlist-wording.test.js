'use strict';

// Regression (2026-10-14): the staff waitlist heads-up said "They have also
// been added to the MailerLite beer-waitlist group", but it is sent in the
// same tick as the fire-and-forget MailerLite call (server.js /api/waitlist),
// before MailerLite answers — so the line was a claim, not a fact. Staff
// should be pointed at the sheet's mailerlite_synced column instead.

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));

var axios = require('axios');
var mailer = require('../lib/mailer');

describe('sendWaitlistNotification wording', () => {
  var origKey = process.env.RESEND_API_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RESEND_API_KEY = 're_test_123';
    axios.post.mockResolvedValue({ data: { id: 'msg_1' } });
  });

  afterEach(() => {
    process.env.RESEND_API_KEY = origKey;
    if (origKey === undefined) delete process.env.RESEND_API_KEY;
  });

  test('does not claim the MailerLite subscription succeeded', async () => {
    await mailer.sendWaitlistNotification({ email: 'lead@x.com' });
    var body = axios.post.mock.calls[0][1];
    expect(body.text).not.toMatch(/have also been added/i);
  });

  test('points staff at the sheet flag that records the MailerLite result', async () => {
    await mailer.sendWaitlistNotification({ email: 'lead@x.com' });
    var body = axios.post.mock.calls[0][1];
    expect(body.text).toContain('mailerlite_synced');
    expect(body.text).toContain('lead@x.com');
  });
});
