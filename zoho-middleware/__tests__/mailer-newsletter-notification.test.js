'use strict';

// Staff alert for a mailing list signup from the website form (2026-10-22).

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));

var axios = require('axios');
var mailer = require('../lib/mailer');

describe('sendNewsletterNotification', () => {
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

  test('a new subscriber: subject, email, page and reply-to', async () => {
    await mailer.sendNewsletterNotification({ email: 'new@x.com', source: 'home', alreadySubscribed: false });
    var body = axios.post.mock.calls[0][1];
    expect(body.subject).toBe('New mailing list signup');
    expect(body.text).toContain('new@x.com');
    expect(body.text).toContain('home page');
    expect(body.text).toContain('Customer');
    expect(body.reply_to || body.replyTo).toBe('new@x.com');
  });

  test('an existing subscriber is marked as such in the subject', async () => {
    await mailer.sendNewsletterNotification({ email: 'old@x.com', source: 'links', alreadySubscribed: true });
    var body = axios.post.mock.calls[0][1];
    expect(body.subject).toBe('Mailing list signup (already subscribed)');
    expect(body.text).toContain('links page');
    expect(body.text).toMatch(/already on the list/i);
  });

  test('a checkout opt-in names the order', async () => {
    await mailer.sendNewsletterNotification({ email: 'buyer@x.com', source: 'checkout', alreadySubscribed: false, orderNumber: 'INV-000300' });
    var body = axios.post.mock.calls[0][1];
    expect(body.subject).toBe('New mailing list signup');
    expect(body.text).toContain('ticked the newsletter box at checkout');
    expect(body.text).toContain('INV-000300');
  });
});
