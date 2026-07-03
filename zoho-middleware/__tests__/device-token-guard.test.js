'use strict';

/**
 * Unit tests for lib/deviceToken.js — the kiosk device-token guard (D-46-01).
 *
 * Mirrors __tests__/api-key-guard.test.js's unit-test block (lines 112-127):
 *   - save/restore process.env.KIOSK_DEVICE_TOKEN per test
 *   - constant-time comparison via crypto.timingSafeEqual
 *   - fail-closed when the token is unset/empty
 */

var deviceToken = require('../lib/deviceToken');

describe('lib/deviceToken — constant-time kiosk device-token guard', function () {
  var saved;

  beforeEach(function () {
    saved = process.env.KIOSK_DEVICE_TOKEN;
    delete process.env.KIOSK_DEVICE_TOKEN;
  });

  afterEach(function () {
    if (saved === undefined) delete process.env.KIOSK_DEVICE_TOKEN;
    else process.env.KIOSK_DEVICE_TOKEN = saved;
  });

  test('matches the configured KIOSK_DEVICE_TOKEN', function () {
    process.env.KIOSK_DEVICE_TOKEN = 'correct-device-token';
    expect(deviceToken.matches('correct-device-token')).toBe(true);
  });

  test('rejects a wrong token', function () {
    process.env.KIOSK_DEVICE_TOKEN = 'correct-device-token';
    expect(deviceToken.matches('wrong-device-token')).toBe(false);
  });

  test('rejects a wrong-length token (no buffer crash)', function () {
    process.env.KIOSK_DEVICE_TOKEN = 'correct-device-token';
    expect(deviceToken.matches('x')).toBe(false);
  });

  test('rejects a wrong-value same-length token', function () {
    process.env.KIOSK_DEVICE_TOKEN = 'aaaaaaaaaa';
    expect(deviceToken.matches('bbbbbbbbbb')).toBe(false);
  });

  test('rejects non-string input', function () {
    process.env.KIOSK_DEVICE_TOKEN = 'correct-device-token';
    expect(deviceToken.matches(undefined)).toBe(false);
    expect(deviceToken.matches(null)).toBe(false);
    expect(deviceToken.matches(['correct-device-token'])).toBe(false);
    expect(deviceToken.matches({ token: 'correct-device-token' })).toBe(false);
  });

  test('fail-closed: rejects everything when no env var is configured', function () {
    // KIOSK_DEVICE_TOKEN deleted in beforeEach — no env var configured
    expect(deviceToken.matches('')).toBe(false);
    expect(deviceToken.matches('anything')).toBe(false);
  });

  test('getKey reads KIOSK_DEVICE_TOKEN with no legacy alias', function () {
    process.env.KIOSK_DEVICE_TOKEN = 'device-token-value';
    expect(deviceToken.getKey()).toBe('device-token-value');
  });

  test('getKey returns empty string when unset', function () {
    expect(deviceToken.getKey()).toBe('');
  });
});
