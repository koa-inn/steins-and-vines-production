'use strict';

/**
 * Unit tests for lib/googleVerify.js — server-side Google staff-identity
 * verification (D-46-05/06/07, T-46-02/09/14/15).
 *
 * Mocks google-auth-library's OAuth2Client#getTokenInfo entirely so these
 * tests exercise only googleVerify.js's own logic: the mandatory aud check
 * (T-46-02, 46-RESEARCH.md Pitfall 1), the email_verified check, and the
 * lowercasing of the server-derived email. Fixtures mirror the REAL
 * getTokenInfo response shape (aud/email/email_verified/scopes/expiry_date/
 * sub/azp) — no invented keys.
 */

var mockGetTokenInfo = jest.fn();

jest.mock('google-auth-library', function () {
  return {
    OAuth2Client: jest.fn().mockImplementation(function () {
      return { getTokenInfo: mockGetTokenInfo };
    })
  };
});

var googleVerify = require('../lib/googleVerify');

var CLIENT_ID = '8605205683-tck2da2tpp03vcbr5etauu9q7kompg3q.apps.googleusercontent.com';

function realTokenInfoFixture(overrides) {
  var base = {
    aud: CLIENT_ID,
    email: 'Staff@SteinsAndVines.ca',
    email_verified: true,
    scopes: ['email', 'profile'],
    expiry_date: Date.now() + 3600000,
    sub: '1234567890',
    azp: CLIENT_ID
  };
  Object.keys(overrides || {}).forEach(function (k) { base[k] = overrides[k]; });
  return base;
}

describe('lib/googleVerify — verifyStaffAccessToken', function () {
  var savedClientId;

  beforeEach(function () {
    jest.clearAllMocks();
    savedClientId = process.env.SHEETS_CLIENT_ID;
    process.env.SHEETS_CLIENT_ID = CLIENT_ID;
  });

  afterEach(function () {
    if (savedClientId === undefined) delete process.env.SHEETS_CLIENT_ID;
    else process.env.SHEETS_CLIENT_ID = savedClientId;
  });

  test('valid token + matching aud → resolves the lowercased email', function () {
    mockGetTokenInfo.mockResolvedValue(realTokenInfoFixture());
    return googleVerify.verifyStaffAccessToken('valid-token').then(function (email) {
      expect(mockGetTokenInfo).toHaveBeenCalledWith('valid-token');
      expect(email).toBe('staff@steinsandvines.ca');
    });
  });

  test('valid token + WRONG aud → rejects with an audience-mismatch error (mandatory case)', function () {
    mockGetTokenInfo.mockResolvedValue(realTokenInfoFixture({
      aud: '999999999-someoneelses-app.apps.googleusercontent.com',
      azp: '999999999-someoneelses-app.apps.googleusercontent.com'
    }));
    return expect(googleVerify.verifyStaffAccessToken('wrong-aud-token'))
      .rejects.toThrow('Token audience mismatch');
  });

  test('email_verified: false → rejects', function () {
    mockGetTokenInfo.mockResolvedValue(realTokenInfoFixture({ email_verified: false }));
    return expect(googleVerify.verifyStaffAccessToken('unverified-token'))
      .rejects.toThrow('Email not verified');
  });

  test('getTokenInfo rejects (expired/invalid token) → propagates rejection', function () {
    mockGetTokenInfo.mockRejectedValue(new Error('Invalid Value'));
    return expect(googleVerify.verifyStaffAccessToken('expired-token'))
      .rejects.toThrow('Invalid Value');
  });
});
