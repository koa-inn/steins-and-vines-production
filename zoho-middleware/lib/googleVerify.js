'use strict';

// Server-side Google staff-identity verification (D-46-05/06/07, T-46-02/09/14/15).
//
// Verifies a Google access token issued by the frontend GIS flow (js/lib/auth.js)
// using google-auth-library's OAuth2Client#getTokenInfo — a single network call
// to Google, no second round trip needed (46-RESEARCH.md Pattern 4).
//
// getTokenInfo() does NOT validate the token's audience (aud) for you — that is
// this module's own responsibility (46-RESEARCH.md Pitfall 1 / Finding #4/#7).
// Skipping the aud check would let a token issued to a DIFFERENT Google OAuth
// client (any app, not just this one) pass verification as long as the email
// happens to match a staff allowlist entry — the mandatory explicit check below
// closes that hole (T-46-02).
//
// The server NEVER trusts a client-supplied email (T-46-09): the only email this
// module returns is the one Google itself attests to in tokenInfo, lowercased.

var { OAuth2Client } = require('google-auth-library');

var client = new OAuth2Client();

/**
 * Verify a Google access token belongs to this app and a verified email.
 * Resolves to the lowercased, Google-verified email on success.
 * Rejects (throws inside the returned promise chain) when:
 *   - getTokenInfo itself rejects (expired/invalid/malformed token)
 *   - tokenInfo.aud does not match this app's SHEETS_CLIENT_ID (wrong audience)
 *   - tokenInfo.email_verified is falsy
 */
function verifyStaffAccessToken(accessToken) {
  return client.getTokenInfo(accessToken).then(function (tokenInfo) {
    if (tokenInfo.aud !== process.env.SHEETS_CLIENT_ID) {
      throw new Error('Token audience mismatch');
    }
    if (!tokenInfo.email_verified) {
      throw new Error('Email not verified');
    }
    return tokenInfo.email.toLowerCase();
  });
}

module.exports = {
  verifyStaffAccessToken: verifyStaffAccessToken
};
