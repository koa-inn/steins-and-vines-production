var log = require('./logger');
var mailer = require('./mailer');

// Startup email health check. Surfaces a broken/missing Resend API key at deploy
// time instead of on the next customer's order, when emails silently fail.
// Never throws — mail problems must not block server startup.
function checkMailer() {
  return mailer.verifyTransport().then(function (result) {
    if (result.ok) {
      log.info('[startup] Email transport verified (Resend) — order confirmation + staff notification emails enabled');
    } else if (!result.configured) {
      log.error('[startup] Email NOT configured (RESEND_API_KEY missing) — order confirmation and staff notification emails are DISABLED');
    } else {
      log.error('[startup] Email transport verification FAILED (Resend) — emails will NOT send: ' + result.error);
    }
    return result;
  }).catch(function (err) {
    log.error('[startup] Email check errored unexpectedly: ' + (err && err.message ? err.message : err));
  });
}

module.exports = checkMailer;
