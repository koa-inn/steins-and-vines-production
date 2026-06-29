'use strict';

// Helpers for keeping PII out of application logs (see the ZERO PII POLICY in
// lib/eventLog.js). Free-form log lines that need to reference a customer for
// debugging should log a masked form, never the raw value.

// Mask an email address for logging: keep the first character of the local part
// and the domain, replace the rest of the local part with a fixed mask (length
// is not revealed). 'jacob@gmail.com' -> 'j***@gmail.com'. Malformed or empty
// input collapses to a safe placeholder so a raw value never leaks.
function maskEmail(email) {
  if (typeof email !== 'string' || email.length === 0) return '(none)';
  var at = email.indexOf('@');
  if (at <= 0) {
    // No usable local@domain split — don't echo the raw string back.
    return email.charAt(0) + '***';
  }
  var domain = email.slice(at + 1);
  return email.charAt(0) + '***@' + domain;
}

module.exports = { maskEmail: maskEmail };
