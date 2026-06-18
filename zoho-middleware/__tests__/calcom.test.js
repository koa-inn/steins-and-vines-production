'use strict';

jest.mock('axios');
jest.mock('../lib/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));
// withRetry is used internally; mock zoho-api so tests do NOT need its env deps
jest.mock('../lib/zoho-api', () => ({
  withRetry: jest.fn(function (fn) { return fn(); })
}));

var axios = require('axios');
var crypto = require('crypto');
var log = require('../lib/logger');

describe('calcom adapter', () => {
  var calcom;

  beforeEach(() => {
    jest.resetModules();
    // re-apply the mocks after resetModules
    jest.mock('axios');
    jest.mock('../lib/logger', () => ({
      info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
    }));
    jest.mock('../lib/zoho-api', () => ({
      withRetry: jest.fn(function (fn) { return fn(); })
    }));
    process.env.CALCOM_API_KEY = 'cal_test_key_123';
    calcom = require('../lib/calcom');
    axios = require('axios');
    log = require('../lib/logger');
  });

  afterEach(() => {
    delete process.env.CALCOM_API_KEY;
    delete process.env.CALCOM_WEBHOOK_SECRET;
    delete process.env.NODE_ENV;
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Version map
  // -------------------------------------------------------------------------

  describe('CAL_VERSIONS (exported version map)', () => {
    test('exposes eventTypes version 2024-06-14', () => {
      expect(calcom.CAL_VERSIONS.eventTypes).toBe('2024-06-14');
    });
    test('exposes slots version 2024-09-04', () => {
      expect(calcom.CAL_VERSIONS.slots).toBe('2024-09-04');
    });
    test('exposes bookings version 2026-02-25', () => {
      expect(calcom.CAL_VERSIONS.bookings).toBe('2026-02-25');
    });
  });

  // -------------------------------------------------------------------------
  // listEventType
  // -------------------------------------------------------------------------

  describe('listEventType(id)', () => {
    test('calls GET /v2/event-types/{id} with correct cal-api-version and auth', async () => {
      axios.get = jest.fn().mockResolvedValue({ data: { status: 'success', data: { id: 42, title: 'Ferment in Store' } } });

      var result = await calcom.listEventType(42);

      expect(axios.get).toHaveBeenCalledTimes(1);
      var args = axios.get.mock.calls[0];
      expect(args[0]).toBe('https://api.cal.com/v2/event-types/42');
      expect(args[1].headers['cal-api-version']).toBe('2024-06-14');
      expect(args[1].headers['Authorization']).toBe('Bearer cal_test_key_123');
      expect(args[1].timeout).toBe(15000);
      expect(result).toEqual({ status: 'success', data: { id: 42, title: 'Ferment in Store' } });
    });

    test('uses empty string when CALCOM_API_KEY is unset', async () => {
      delete process.env.CALCOM_API_KEY;
      jest.resetModules();
      jest.mock('axios');
      jest.mock('../lib/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
      jest.mock('../lib/zoho-api', () => ({ withRetry: jest.fn(function (fn) { return fn(); }) }));
      var calcom2 = require('../lib/calcom');
      var axios2 = require('axios');
      axios2.get = jest.fn().mockResolvedValue({ data: { status: 'success', data: {} } });

      await calcom2.listEventType(1);
      expect(axios2.get.mock.calls[0][1].headers['Authorization']).toBe('Bearer ');
    });
  });

  // -------------------------------------------------------------------------
  // getSlots
  // -------------------------------------------------------------------------

  describe('getSlots(eventTypeId, start, end, timeZone)', () => {
    test('calls GET /v2/slots with correct version, auth, and params', async () => {
      var mockData = {
        status: 'success',
        data: {
          '2026-06-05': [{ start: '2026-06-05T09:00:00.000-07:00' }]
        }
      };
      axios.get = jest.fn().mockResolvedValue({ data: mockData });

      var result = await calcom.getSlots(123, '2026-06-01', '2026-06-30');

      expect(axios.get).toHaveBeenCalledTimes(1);
      var args = axios.get.mock.calls[0];
      expect(args[0]).toBe('https://api.cal.com/v2/slots');
      expect(args[1].headers['cal-api-version']).toBe('2024-09-04');
      expect(args[1].headers['Authorization']).toBe('Bearer cal_test_key_123');
      expect(args[1].timeout).toBe(15000);
      expect(args[1].params.eventTypeId).toBe(123);
      expect(args[1].params.start).toBe('2026-06-01');
      expect(args[1].params.end).toBe('2026-06-30');
      expect(args[1].params.timeZone).toBe('America/Vancouver');
      expect(result).toEqual(mockData);
    });

    test('accepts a custom timeZone override', async () => {
      axios.get = jest.fn().mockResolvedValue({ data: { status: 'success', data: {} } });
      await calcom.getSlots(1, '2026-06-01', '2026-06-30', 'America/Toronto');
      expect(axios.get.mock.calls[0][1].params.timeZone).toBe('America/Toronto');
    });

    test('defaults timeZone to America/Vancouver when not provided', async () => {
      axios.get = jest.fn().mockResolvedValue({ data: { status: 'success', data: {} } });
      await calcom.getSlots(1, '2026-06-01', '2026-06-30');
      expect(axios.get.mock.calls[0][1].params.timeZone).toBe('America/Vancouver');
    });
  });

  // -------------------------------------------------------------------------
  // createBooking
  // -------------------------------------------------------------------------

  describe('createBooking(body)', () => {
    test('calls POST /v2/bookings with correct version, auth, and body', async () => {
      var bookingBody = {
        start: '2026-06-05T16:00:00Z',
        eventTypeId: 123,
        attendee: {
          name: 'Anne MacDougall',
          email: 'anne@example.com',
          timeZone: 'America/Vancouver',
          language: 'en'
        },
        metadata: { notes: 'Cabernet kit' }
      };
      var mockResponse = {
        status: 'success',
        data: { id: 99, uid: 'booking_uid_99', status: 'accepted' }
      };
      axios.post = jest.fn().mockResolvedValue({ data: mockResponse });

      var result = await calcom.createBooking(bookingBody);

      expect(axios.post).toHaveBeenCalledTimes(1);
      var args = axios.post.mock.calls[0];
      expect(args[0]).toBe('https://api.cal.com/v2/bookings');
      expect(args[1]).toEqual(bookingBody);
      expect(args[2].headers['cal-api-version']).toBe('2026-02-25');
      expect(args[2].headers['Authorization']).toBe('Bearer cal_test_key_123');
      expect(args[2].timeout).toBe(15000);
      expect(result).toEqual(mockResponse);
    });
  });

  // -------------------------------------------------------------------------
  // verifyWebhook
  // -------------------------------------------------------------------------

  describe('verifyWebhook(rawBody, signature)', () => {
    function makeValidSig(secret, body) {
      return crypto.createHmac('sha256', secret).update(body).digest('hex');
    }

    test('returns true for a correct HMAC-SHA256 hex signature', () => {
      var secret = 'my-webhook-secret';
      var body = '{"trigger":"BOOKING_CREATED","payload":{"id":1}}';
      process.env.CALCOM_WEBHOOK_SECRET = secret;
      var sig = makeValidSig(secret, body);

      var result = calcom.verifyWebhook(body, sig);
      expect(result).toBe(true);
    });

    test('returns false for an incorrect signature', () => {
      process.env.CALCOM_WEBHOOK_SECRET = 'my-webhook-secret';
      var body = '{"trigger":"BOOKING_CREATED","payload":{"id":1}}';
      var wrongSig = makeValidSig('different-secret', body);

      var result = calcom.verifyWebhook(body, wrongSig);
      expect(result).toBe(false);
    });

    test('returns true (fail-open) and logs warn when CALCOM_WEBHOOK_SECRET is unset', () => {
      delete process.env.CALCOM_WEBHOOK_SECRET;
      var log2 = require('../lib/logger');

      var result = calcom.verifyWebhook('{"trigger":"BOOKING_CREATED"}', 'anysig');
      expect(result).toBe(true);
      expect(log2.warn).toHaveBeenCalledWith(expect.stringContaining('CALCOM_WEBHOOK_SECRET'));
    });

    // -------------------------------------------------------------------------
    // HARDEN-02: prod gate — unset secret must fail CLOSED in production
    // -------------------------------------------------------------------------

    test('HARDEN-02: CALCOM_WEBHOOK_SECRET unset + NODE_ENV=production -> returns false (fail closed)', () => {
      jest.resetModules();
      jest.mock('../lib/logger', () => ({
        info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
      }));
      jest.mock('../lib/zoho-api', () => ({
        withRetry: jest.fn(function (fn) { return fn(); })
      }));
      delete process.env.CALCOM_WEBHOOK_SECRET;
      process.env.NODE_ENV = 'production';
      var calcom2 = require('../lib/calcom');

      var result = calcom2.verifyWebhook('{"trigger":"BOOKING_CREATED"}', 'anysig');

      // Prod fail-closed: returns false so route rejects with 403
      expect(result).toBe(false);
    });

    test('HARDEN-02: CALCOM_WEBHOOK_SECRET unset + NODE_ENV unset -> returns true (dev fail-open preserved)', () => {
      jest.resetModules();
      jest.mock('../lib/logger', () => ({
        info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
      }));
      jest.mock('../lib/zoho-api', () => ({
        withRetry: jest.fn(function (fn) { return fn(); })
      }));
      delete process.env.CALCOM_WEBHOOK_SECRET;
      delete process.env.NODE_ENV;
      var calcom2 = require('../lib/calcom');

      var result = calcom2.verifyWebhook('{"trigger":"BOOKING_CREATED"}', 'anysig');

      // Dev: still fails open (skip-verification warning path preserved)
      expect(result).toBe(true);
    });

    test('returns false on length mismatch (no throw)', () => {
      process.env.CALCOM_WEBHOOK_SECRET = 'my-webhook-secret';
      var body = 'some body';
      // Provide a signature that is too short to match (length mismatch)
      var result = calcom.verifyWebhook(body, 'short');
      expect(result).toBe(false);
    });

    test('returns false for empty string signature', () => {
      process.env.CALCOM_WEBHOOK_SECRET = 'my-webhook-secret';
      var result = calcom.verifyWebhook('body content', '');
      expect(result).toBe(false);
    });

    test('uses hex digest (64 hex chars for a sha256 output)', () => {
      var secret = 'test-secret';
      var body = 'test body';
      process.env.CALCOM_WEBHOOK_SECRET = secret;
      var validHexSig = makeValidSig(secret, body);
      // Must be 64 hex characters (sha256 = 32 bytes = 64 hex)
      expect(validHexSig).toHaveLength(64);
      expect(calcom.verifyWebhook(body, validHexSig)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Exports shape
  // -------------------------------------------------------------------------

  describe('module exports', () => {
    test('exports listEventType function', () => {
      expect(typeof calcom.listEventType).toBe('function');
    });
    test('exports getSlots function', () => {
      expect(typeof calcom.getSlots).toBe('function');
    });
    test('exports createBooking function', () => {
      expect(typeof calcom.createBooking).toBe('function');
    });
    test('exports verifyWebhook function', () => {
      expect(typeof calcom.verifyWebhook).toBe('function');
    });
    test('exports CAL_VERSIONS map', () => {
      expect(typeof calcom.CAL_VERSIONS).toBe('object');
    });
  });
});
