var axios = require('axios');

// ---------------------------------------------------------------------------
// MailerLite marketing-list integration (HTTPS REST API).
//
// Used for list-building (e.g. the beer waitlist) — NOT transactional email
// (that goes through Resend / lib/mailer.js). Adding a subscriber upserts them
// into the configured MailerLite group/audience.
//
// Required env: MAILERLITE_API_KEY (token from MailerLite → Integrations → API).
// Optional env: MAILERLITE_WAITLIST_GROUP_ID (numeric group id to add waitlist
// signups to; if unset the subscriber is created without a group).
// ---------------------------------------------------------------------------

var MAILERLITE_API = 'https://connect.mailerlite.com/api';

/**
 * Whether MailerLite is configured. Without MAILERLITE_API_KEY no subscriber
 * can be created.
 * @returns {boolean}
 */
function isConfigured() {
  return !!process.env.MAILERLITE_API_KEY;
}

/**
 * Upsert a subscriber into MailerLite, optionally assigning groups.
 * Resolves with the MailerLite response body on success; rejects with a
 * descriptive Error otherwise. Idempotent — re-adding the same email is safe.
 *
 * @param {string} email
 * @param {string[]} [groups] - array of MailerLite group ids
 * @returns {Promise<Object>}
 */
function addSubscriber(email, groups) {
  if (!isConfigured()) {
    return Promise.reject(new Error('MAILERLITE_API_KEY not set'));
  }
  var addr = (email || '').trim();
  var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(addr)) {
    return Promise.reject(new Error('Invalid email'));
  }

  var payload = { email: addr, status: 'active' };
  var groupIds = (groups || []).filter(function (g) { return g; });
  if (groupIds.length) {
    payload.groups = groupIds;
  }

  return axios.post(MAILERLITE_API + '/subscribers', payload, {
    headers: {
      Authorization: 'Bearer ' + process.env.MAILERLITE_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    timeout: 10000
  }).then(function (res) {
    return res.data;
  }).catch(function (err) {
    var detail = (err && err.response && err.response.data &&
      (err.response.data.message || JSON.stringify(err.response.data))) ||
      (err && err.message) || String(err);
    throw new Error('MailerLite subscribe failed: ' + detail);
  });
}

module.exports = {
  isConfigured: isConfigured,
  addSubscriber: addSubscriber
};
