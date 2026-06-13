'use strict';

// ---------------------------------------------------------------------------
// axios mock — the mailer now sends via the Resend HTTPS API (Railway blocks
// all outbound SMTP). Each test controls axios.post/get behavior.
// ---------------------------------------------------------------------------
jest.mock('axios', () => ({
  post: jest.fn(),
  get: jest.fn()
}));

var axios = require('axios');
var mailer = require('../lib/mailer');

var RESEND_EMAILS = 'https://api.resend.com/emails';
var RESEND_DOMAINS = 'https://api.resend.com/domains';

describe('mailer.isConfigured', () => {
  var orig = process.env.RESEND_API_KEY;
  afterEach(() => {
    process.env.RESEND_API_KEY = orig;
    if (orig === undefined) delete process.env.RESEND_API_KEY;
  });

  test('true when RESEND_API_KEY is set', () => {
    process.env.RESEND_API_KEY = 're_test_123';
    expect(mailer.isConfigured()).toBe(true);
  });

  test('false when RESEND_API_KEY missing', () => {
    delete process.env.RESEND_API_KEY;
    expect(mailer.isConfigured()).toBe(false);
  });
});

describe('mailer.verifyTransport', () => {
  var orig = process.env.RESEND_API_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RESEND_API_KEY = 're_test_123';
  });
  afterEach(() => {
    process.env.RESEND_API_KEY = orig;
    if (orig === undefined) delete process.env.RESEND_API_KEY;
  });

  test('not configured → {ok:false, configured:false} without hitting the API', async () => {
    delete process.env.RESEND_API_KEY;
    var result = await mailer.verifyTransport();
    expect(result).toEqual({ ok: false, configured: false, error: 'RESEND_API_KEY not set' });
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('authenticated GET succeeds → {ok:true, configured:true}', async () => {
    axios.get.mockResolvedValue({ data: { data: [] } });
    var result = await mailer.verifyTransport();
    expect(result).toEqual({ ok: true, configured: true });
    expect(axios.get).toHaveBeenCalledWith(
      RESEND_DOMAINS,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer re_test_123' })
      })
    );
  });

  test('invalid key (401) → {ok:false, configured:true, error}', async () => {
    axios.get.mockRejectedValue({ response: { data: { message: 'API key is invalid' } } });
    var result = await mailer.verifyTransport();
    expect(result.ok).toBe(false);
    expect(result.configured).toBe(true);
    expect(result.error).toMatch(/API key is invalid/);
  });

  test('never rejects — even on a non-Error throw', async () => {
    axios.get.mockRejectedValue('network down');
    var result = await mailer.verifyTransport();
    expect(result.ok).toBe(false);
    expect(result.error).toBe('network down');
  });
});

describe('mailer send functions → Resend', () => {
  var orig = process.env.RESEND_API_KEY;
  var origContact = process.env.CONTACT_TO;
  var origFrom = process.env.MAIL_FROM;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RESEND_API_KEY = 're_test_123';
    delete process.env.CONTACT_TO;
    delete process.env.MAIL_FROM;
    axios.post.mockResolvedValue({ data: { id: 'email_abc' } });
  });
  afterEach(() => {
    process.env.RESEND_API_KEY = orig;
    process.env.CONTACT_TO = origContact;
    process.env.MAIL_FROM = origFrom;
    if (orig === undefined) delete process.env.RESEND_API_KEY;
    if (origContact === undefined) delete process.env.CONTACT_TO;
    if (origFrom === undefined) delete process.env.MAIL_FROM;
  });

  test('sendCustomerConfirmation posts to Resend with bearer auth, array to, and reply_to', async () => {
    await mailer.sendCustomerConfirmation({
      email: 'customer@example.com',
      orderNumber: 'SO-001234',
      items: [{ name: 'Pinot Kit', quantity: 2 }],
      timeslot: 'Sat 2pm'
    });

    expect(axios.post).toHaveBeenCalledTimes(1);
    var call = axios.post.mock.calls[0];
    expect(call[0]).toBe(RESEND_EMAILS);
    expect(call[1].to).toEqual(['customer@example.com']);
    expect(call[1].from).toBe('Steins & Vines <hello@steinsandvines.ca>');
    expect(call[1].subject).toContain('SO-001234');
    expect(call[1].text).toContain('Pinot Kit');
    expect(call[1].reply_to).toBe('hello@steinsandvines.ca');
    expect(call[2].headers.Authorization).toBe('Bearer re_test_123');
  });

  test('sendCustomerConfirmation rejects when no email', async () => {
    await expect(mailer.sendCustomerConfirmation({ orderNumber: 'SO-1' }))
      .rejects.toThrow(/No customer email/);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('staff notifications go to CONTACT_TO and carry customer reply_to', async () => {
    process.env.CONTACT_TO = 'staff@steinsandvines.ca';
    await mailer.sendReservationNotification({
      orderNumber: 'SO-9',
      customer: { name: 'Jo', email: 'jo@x.com', phone: '555' },
      items: []
    });
    var body = axios.post.mock.calls[0][1];
    expect(body.to).toEqual(['staff@steinsandvines.ca']);
    expect(body.reply_to).toBe('jo@x.com');
    expect(body.subject).toContain('SO-9');
  });

  test('sendVoidFailureAlert posts an action-required staff email', async () => {
    await mailer.sendVoidFailureAlert({ txnId: 'TXN1', amount: 42.5, error: 'boom' });
    var body = axios.post.mock.calls[0][1];
    expect(body.subject).toMatch(/ACTION REQUIRED/);
    expect(body.text).toContain('TXN1');
    expect(body.text).toContain('42.50');
  });

  test('sendContactMessage uses sender email as reply_to', async () => {
    await mailer.sendContactMessage({ name: 'Pat', email: 'pat@x.com', message: 'hi' });
    var body = axios.post.mock.calls[0][1];
    expect(body.reply_to).toBe('pat@x.com');
    expect(body.subject).toContain('Pat');
    expect(body.text).toContain('hi');
  });

  test('MAIL_FROM overrides the default sender (e.g. resend.dev sandbox before domain verify)', async () => {
    process.env.MAIL_FROM = 'onboarding@resend.dev';
    await mailer.sendVoidFailureAlert({ txnId: 'T', amount: 1, error: 'e' });
    expect(axios.post.mock.calls[0][1].from).toBe('onboarding@resend.dev');
  });

  test('send rejects with a descriptive error when Resend returns an API error', async () => {
    axios.post.mockRejectedValue({ response: { data: { message: 'domain not verified' } } });
    await expect(mailer.sendCustomerConfirmation({ email: 'c@x.com', orderNumber: 'SO-1' }))
      .rejects.toThrow(/Resend send failed: domain not verified/);
  });

  test('send rejects when RESEND_API_KEY is missing — never silently no-ops', async () => {
    delete process.env.RESEND_API_KEY;
    await expect(mailer.sendCustomerConfirmation({ email: 'c@x.com', orderNumber: 'SO-1' }))
      .rejects.toThrow(/RESEND_API_KEY not set/);
    expect(axios.post).not.toHaveBeenCalled();
  });
});
