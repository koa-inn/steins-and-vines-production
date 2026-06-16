'use strict';

// ---------------------------------------------------------------------------
// axios mock — mailerlite adds subscribers via the MailerLite HTTPS API.
// Each test controls axios.post behavior.
// ---------------------------------------------------------------------------
jest.mock('axios', () => ({
  post: jest.fn()
}));

var axios = require('axios');
var mailerlite = require('../lib/mailerlite');

var SUBSCRIBERS_URL = 'https://connect.mailerlite.com/api/subscribers';

describe('mailerlite.isConfigured', () => {
  var orig = process.env.MAILERLITE_API_KEY;
  afterEach(() => {
    process.env.MAILERLITE_API_KEY = orig;
    if (orig === undefined) delete process.env.MAILERLITE_API_KEY;
  });

  test('true when MAILERLITE_API_KEY is set', () => {
    process.env.MAILERLITE_API_KEY = 'ml_test_123';
    expect(mailerlite.isConfigured()).toBe(true);
  });

  test('false when MAILERLITE_API_KEY missing', () => {
    delete process.env.MAILERLITE_API_KEY;
    expect(mailerlite.isConfigured()).toBe(false);
  });
});

describe('mailerlite.addSubscriber', () => {
  var orig = process.env.MAILERLITE_API_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.MAILERLITE_API_KEY = 'ml_test_123';
  });
  afterEach(() => {
    process.env.MAILERLITE_API_KEY = orig;
    if (orig === undefined) delete process.env.MAILERLITE_API_KEY;
  });

  test('rejects when API key not set', () => {
    delete process.env.MAILERLITE_API_KEY;
    return expect(mailerlite.addSubscriber('a@b.com', [])).rejects.toThrow(/not set/);
  });

  test('rejects an invalid email without calling the API', () => {
    return mailerlite.addSubscriber('not-an-email', []).catch(function (err) {
      expect(err.message).toMatch(/Invalid email/);
      expect(axios.post).not.toHaveBeenCalled();
    });
  });

  test('POSTs email + groups with bearer auth and resolves with response data', () => {
    axios.post.mockResolvedValue({ data: { data: { id: 'sub_1', email: 'a@b.com' } } });

    return mailerlite.addSubscriber('a@b.com', ['12345']).then(function (out) {
      expect(axios.post).toHaveBeenCalledTimes(1);
      var args = axios.post.mock.calls[0];
      expect(args[0]).toBe(SUBSCRIBERS_URL);
      expect(args[1]).toEqual({ email: 'a@b.com', status: 'active', groups: ['12345'] });
      expect(args[2].headers.Authorization).toBe('Bearer ml_test_123');
      expect(out.data.id).toBe('sub_1');
    });
  });

  test('omits groups when none provided', () => {
    axios.post.mockResolvedValue({ data: {} });

    return mailerlite.addSubscriber('a@b.com', []).then(function () {
      var body = axios.post.mock.calls[0][1];
      expect(body.groups).toBeUndefined();
      expect(body.email).toBe('a@b.com');
    });
  });

  test('surfaces a descriptive error on API failure', () => {
    axios.post.mockRejectedValue({ response: { data: { message: 'invalid group' } } });

    return expect(mailerlite.addSubscriber('a@b.com', ['x'])).rejects.toThrow(/MailerLite subscribe failed: invalid group/);
  });
});
