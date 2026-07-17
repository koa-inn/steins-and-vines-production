'use strict';

/**
 * Integration tests for POST /auth/google and POST /auth/logout
 * (D-46-05/06/07/08, T-46-02/09/14/15).
 *
 * Mocks ../lib/googleVerify and ../lib/session so these tests exercise only
 * routes/auth.js's own logic: input validation, allowlist enforcement, cookie
 * issuance/clearing, and error-status mapping. Full mock roster (mirrors
 * __tests__/api-key-guard.test.js / pii-access.test.js) so the real Express
 * app can be required via supertest without touching any external service.
 */

jest.mock('../lib/zohoAuth', function () {
  return { init: jest.fn().mockResolvedValue(), isAuthenticated: jest.fn().mockReturnValue(true) };
});
jest.mock('../lib/validateEnv', function () { return jest.fn(); });
jest.mock('../lib/checkRedis', function () { return jest.fn().mockResolvedValue(); });
jest.mock('../lib/checkMailer', function () { return jest.fn(); });
jest.mock('../lib/brewpad-integration', function () {
  return { syncBatch: jest.fn(), init: jest.fn(), createBatchesFromSale: jest.fn() };
});
jest.mock('node-cron', function () { return { schedule: jest.fn() }; });
jest.mock('@sentry/node', function () {
  return { init: jest.fn(), setupExpressErrorHandler: jest.fn(), captureException: jest.fn() };
});
jest.mock('../lib/mailerlite', function () {
  return { isConfigured: jest.fn().mockReturnValue(false), addSubscriber: jest.fn().mockResolvedValue() };
});
jest.mock('../lib/eventLog', function () { return { logEvent: jest.fn() }; });
jest.mock('../lib/inventory-ledger', function () { return { decrementStock: jest.fn().mockResolvedValue() }; });
jest.mock('../lib/helcim', function () {
  return {
    isEnabled: jest.fn().mockReturnValue(true),
    initializeCheckout: jest.fn().mockResolvedValue({ checkoutToken: 'tok-test-123' }),
    getDepositAmount: jest.fn().mockReturnValue(10000),
    voidTransaction: jest.fn().mockResolvedValue({ ok: true, transactionId: 'txn-mock' }),
    getTerminalDiagnostics: jest.fn().mockReturnValue({}),
    getDeviceCode: jest.fn().mockReturnValue(''),
    init: jest.fn(),
    verifyWebhookSignature: jest.fn().mockReturnValue(true)
  };
});
jest.mock('../lib/zoho-api', function () {
  return {
    zohoPost: jest.fn().mockResolvedValue({}),
    zohoGet: jest.fn().mockResolvedValue({ salesorders: [] }),
    zohoPut: jest.fn().mockResolvedValue({}),
    inventoryGet: jest.fn().mockResolvedValue({}),
    inventoryPut: jest.fn().mockResolvedValue({}),
    ZOHO_INVENTORY_BASE: 'https://inventory.zoho.com/api/v1'
  };
});
jest.mock('../lib/cache', function () {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    acquireLock: jest.fn().mockResolvedValue(true),
    isConnected: jest.fn().mockReturnValue(false),
    init: jest.fn().mockResolvedValue(),
    getClient: jest.fn().mockResolvedValue(null)
  };
});
jest.mock('../lib/mailer', function () {
  return {
    sendReservationNotification: jest.fn().mockResolvedValue(),
    sendOfflineOrderNotification: jest.fn().mockResolvedValue(),
    sendVoidFailureAlert: jest.fn().mockResolvedValue(),
    sendCustomerConfirmation: jest.fn().mockResolvedValue()
  };
});
jest.mock('axios', function () { return { post: jest.fn().mockResolvedValue({ data: { ok: true } }) }; });

// ---------------------------------------------------------------------------
// Mocks specific to this route: identity verification + session store.
// ---------------------------------------------------------------------------
var mockVerifyStaffAccessToken = jest.fn();
jest.mock('../lib/googleVerify', function () {
  return { verifyStaffAccessToken: mockVerifyStaffAccessToken };
});

var mockCreateSession = jest.fn();
var mockDestroySession = jest.fn();
jest.mock('../lib/session', function () {
  return {
    createSession: mockCreateSession,
    getSession: jest.fn(),
    destroySession: mockDestroySession,
    touchSession: jest.fn()
  };
});

process.env.API_SECRET_KEY = 'test-secret-key';
process.env.STAFF_EMAILS = 'staff@steinsandvines.ca,owner@steinsandvines.ca';

var request = require('supertest');
var app = require('../server');

describe('POST /auth/google', function () {
  beforeEach(function () {
    jest.clearAllMocks();
    mockCreateSession.mockResolvedValue('deadbeef'.repeat(8)); // 64-hex-char-ish stand-in
  });

  test('missing access_token → 400', function () {
    return request(app)
      .post('/auth/google')
      .send({})
      .then(function (res) {
        expect(res.status).toBe(400);
        expect(mockVerifyStaffAccessToken).not.toHaveBeenCalled();
      });
  });

  test('verified but non-allowlisted email → 403 {authorized:false}', function () {
    mockVerifyStaffAccessToken.mockResolvedValue('not-staff@example.com');
    return request(app)
      .post('/auth/google')
      .send({ access_token: 'tok-abc' })
      .then(function (res) {
        expect(res.status).toBe(403);
        expect(res.body).toEqual({ authorized: false });
        expect(mockCreateSession).not.toHaveBeenCalled();
      });
  });

  test('allowlisted verified email → 200 {authorized:true} with Set-Cookie sv_session', function () {
    mockVerifyStaffAccessToken.mockResolvedValue('staff@steinsandvines.ca');
    return request(app)
      .post('/auth/google')
      .send({ access_token: 'tok-good' })
      .then(function (res) {
        expect(mockVerifyStaffAccessToken).toHaveBeenCalledWith('tok-good');
        expect(res.status).toBe(200);
        // token: the session id is returned in the body so cross-site staff
        // surfaces can send it as an x-session-token header (the cookie is not
        // delivered to this origin cross-site).
        expect(res.body).toEqual({ authorized: true, email: 'staff@steinsandvines.ca', token: 'deadbeef'.repeat(8) });
        expect(mockCreateSession).toHaveBeenCalledWith('staff@steinsandvines.ca');
        var setCookie = res.headers['set-cookie'] || [];
        var svSessionCookie = setCookie.find(function (c) { return c.indexOf('sv_session=') === 0; });
        expect(svSessionCookie).toBeDefined();
        expect(svSessionCookie).toMatch(/HttpOnly/i);
      });
  });

  test('verification throws (expired/invalid token) → 401 {authorized:false}', function () {
    mockVerifyStaffAccessToken.mockRejectedValue(new Error('Token audience mismatch'));
    return request(app)
      .post('/auth/google')
      .send({ access_token: 'tok-bad-aud' })
      .then(function (res) {
        expect(res.status).toBe(401);
        expect(res.body).toEqual({ authorized: false });
        expect(mockCreateSession).not.toHaveBeenCalled();
      });
  });
});

describe('POST /auth/logout', function () {
  beforeEach(function () {
    jest.clearAllMocks();
    mockDestroySession.mockResolvedValue();
  });

  test('responds 200 {ok:true} and clears the sv_session cookie', function () {
    return request(app)
      .post('/auth/logout')
      .then(function (res) {
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true });
        var setCookie = res.headers['set-cookie'] || [];
        var cleared = setCookie.find(function (c) { return c.indexOf('sv_session=') === 0; });
        expect(cleared).toBeDefined();
      });
  });
});
