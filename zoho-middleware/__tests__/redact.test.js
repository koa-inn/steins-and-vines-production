'use strict';

// Regression tests for #10 — PII (customer email) must never appear verbatim in
// logs. maskEmail keeps just enough to debug (first char + domain) and nothing
// more.

var redact = require('../lib/redact');

describe('redact.maskEmail', function () {
  test('masks the local part, keeps first char + domain', function () {
    expect(redact.maskEmail('jacob@gmail.com')).toBe('j***@gmail.com');
  });

  test('never returns the full address', function () {
    var addr = 'jane.doe@example.co.uk';
    var masked = redact.maskEmail(addr);
    expect(masked).not.toBe(addr);
    expect(masked).not.toContain('ane.doe'); // local part beyond first char is gone
    expect(masked).toBe('j***@example.co.uk');
  });

  test('does not reveal local-part length', function () {
    expect(redact.maskEmail('a@x.com')).toBe('a***@x.com');
    expect(redact.maskEmail('abcdefghij@x.com')).toBe('a***@x.com');
  });

  test('handles a malformed value without echoing it back', function () {
    expect(redact.maskEmail('notanemail')).toBe('n***');
    expect(redact.maskEmail('@nolocal.com')).toBe('@***');
  });

  test('collapses empty / non-string input to a safe placeholder', function () {
    expect(redact.maskEmail('')).toBe('(none)');
    expect(redact.maskEmail(undefined)).toBe('(none)');
    expect(redact.maskEmail(null)).toBe('(none)');
    expect(redact.maskEmail(42)).toBe('(none)');
  });
});
