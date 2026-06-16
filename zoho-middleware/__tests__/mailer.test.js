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

  test('sendWaitlistNotification goes to staff with the customer email as reply_to', async () => {
    await mailer.sendWaitlistNotification({ email: 'lead@x.com' });
    var body = axios.post.mock.calls[0][1];
    expect(body.reply_to).toBe('lead@x.com');
    expect(body.subject).toContain('beer waitlist');
    expect(body.text).toContain('lead@x.com');
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

// ---------------------------------------------------------------------------
// sendBottlingInvite
// ---------------------------------------------------------------------------

describe('mailer.sendBottlingInvite', () => {
  var orig = process.env.RESEND_API_KEY;
  var origCalcom = process.env.CALCOM_BOTTLING_BOOKING_URL;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RESEND_API_KEY = 're_test_123';
    delete process.env.CALCOM_BOTTLING_BOOKING_URL;
    axios.post.mockResolvedValue({ data: { id: 'email_xyz' } });
  });
  afterEach(() => {
    process.env.RESEND_API_KEY = orig;
    process.env.CALCOM_BOTTLING_BOOKING_URL = origCalcom;
    if (orig === undefined) delete process.env.RESEND_API_KEY;
    if (origCalcom === undefined) delete process.env.CALCOM_BOTTLING_BOOKING_URL;
  });

  test('sends to customer email with correct subject', async () => {
    await mailer.sendBottlingInvite({
      name: 'Jane Doe',
      email: 'jane@example.com',
      batchId: 'SV-B-000001',
      productName: 'Pinot Noir'
    });
    var call = axios.post.mock.calls[0];
    expect(call[0]).toBe(RESEND_EMAILS);
    expect(call[1].to).toEqual(['jane@example.com']);
    expect(call[1].subject).toBe('Book your bottling appointment — Steins & Vines');
    expect(call[1].reply_to).toBe('hello@steinsandvines.ca');
    expect(call[2].headers.Authorization).toBe('Bearer re_test_123');
  });

  test('builds Cal.com URL with encoded name and email params', async () => {
    await mailer.sendBottlingInvite({
      name: 'Anne MacDougall',
      email: 'anne@example.com',
      batchId: 'SV-B-000042',
      productName: 'Cabernet'
    });
    var call = axios.post.mock.calls[0];
    var expectedUrl = 'https://cal.com/steins-and-vines-tw8csc/bottling-appointment' +
      '?name=' + encodeURIComponent('Anne MacDougall') +
      '&email=' + encodeURIComponent('anne@example.com');
    expect(call[1].text).toContain(expectedUrl);
    expect(call[1].html).toContain(expectedUrl);
  });

  test('uses CALCOM_BOTTLING_BOOKING_URL env override when set', async () => {
    process.env.CALCOM_BOTTLING_BOOKING_URL = 'https://cal.com/custom/bottling';
    await mailer.sendBottlingInvite({
      name: 'Bob',
      email: 'bob@example.com',
      batchId: 'SV-B-000099',
      productName: 'Cider'
    });
    var call = axios.post.mock.calls[0];
    expect(call[1].text).toContain('https://cal.com/custom/bottling');
  });

  test('includes batchId and productName in email body', async () => {
    await mailer.sendBottlingInvite({
      name: 'Carol',
      email: 'carol@example.com',
      batchId: 'SV-B-000007',
      productName: 'Sauvignon Blanc'
    });
    var call = axios.post.mock.calls[0];
    expect(call[1].text).toContain('SV-B-000007');
    expect(call[1].text).toContain('Sauvignon Blanc');
    expect(call[1].html).toContain('SV-B-000007');
    expect(call[1].html).toContain('Sauvignon Blanc');
  });

  test('greets by first name (first word of full name)', async () => {
    await mailer.sendBottlingInvite({
      name: 'Margaret Smith',
      email: 'm@example.com',
      batchId: 'SV-B-000003',
      productName: 'Beer Kit'
    });
    var call = axios.post.mock.calls[0];
    expect(call[1].text).toContain('Hi Margaret');
    expect(call[1].html).toContain('Hi Margaret');
  });

  test('falls back to "there" when name is empty', async () => {
    await mailer.sendBottlingInvite({
      name: '',
      email: 'anon@example.com',
      batchId: 'SV-B-000010',
      productName: 'Mead'
    });
    var call = axios.post.mock.calls[0];
    expect(call[1].text).toContain('Hi there');
  });

  test('rejects when email is missing', async () => {
    await expect(mailer.sendBottlingInvite({ name: 'Jo', email: '', batchId: 'SV-B-000001', productName: 'Cider' }))
      .rejects.toThrow(/email/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('rejects when email is invalid (no @)', async () => {
    await expect(mailer.sendBottlingInvite({ name: 'Jo', email: 'notanemail', batchId: 'SV-B-000001', productName: 'Cider' }))
      .rejects.toThrow(/email/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('HTML-escapes productName in HTML body', async () => {
    await mailer.sendBottlingInvite({
      name: 'Tom',
      email: 'tom@example.com',
      batchId: 'SV-B-000001',
      productName: 'Merlot & Cabernet <special>'
    });
    var call = axios.post.mock.calls[0];
    expect(call[1].html).toContain('Merlot &amp; Cabernet &lt;special&gt;');
    // Raw unescaped HTML tag must NOT appear verbatim in HTML body
    expect(call[1].html).not.toContain('<special>');
  });
});
