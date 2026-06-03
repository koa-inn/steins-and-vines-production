var log = require('./logger');
var mailer = require('./mailer');

// Startup SMTP health check. Surfaces a broken/missing mail credential at deploy
// time instead of on the next customer's order, when emails silently fail.
// Never throws — mail problems must not block server startup.
function checkMailer() {
  return mailer.verifyTransport().then(function (result) {
    if (result.ok) {
      log.info('[startup] SMTP transport verified — order confirmation + staff notification emails enabled');
    } else if (!result.configured) {
      log.error('[startup] SMTP NOT configured (SMTP_USER/SMTP_PASS missing) — order confirmation and staff notification emails are DISABLED');
    } else {
      log.error('[startup] SMTP transport verification FAILED — emails will NOT send: ' + result.error);
    }
    return result;
  }).catch(function (err) {
    log.error('[startup] SMTP check errored unexpectedly: ' + (err && err.message ? err.message : err));
  });
}

module.exports = checkMailer;
