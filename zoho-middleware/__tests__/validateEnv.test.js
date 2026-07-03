'use strict';

/**
 * Tests for lib/validateEnv.js — HARDEN-04 / D-02 / D-06
 *
 * Covers:
 *   1. Existing REQUIRED-var behavior (ZOHO_CLIENT_ID etc.) unchanged
 *   2. D-06: REQUIRED_IN_PROD — hard-fail boot when NODE_ENV=production and a prod secret is missing
 *   3. D-02: Boot assertion — hard-fail when RAILWAY_ENVIRONMENT is set but NODE_ENV !== 'production'
 *   4. GP_* removal — assert none of the dead Global Payments vars appear in the module
 *   5. Dev/CI — no hard-fail when NODE_ENV and RAILWAY_ENVIRONMENT are both unset
 */

describe('validateEnv', () => {
  var validateEnv;

  // Env keys to restore on teardown
  var SAVED_ENV = {};

  // The full SC#5 prod secrets (D-06 + MONITOR-02 / phase 33) plus the
  // Phase 46 auth-re-architecture additions (STAFF_EMAILS, KIOSK_DEVICE_TOKEN,
  // SHEETS_CLIENT_ID — 46-01 Task 1).
  var PROD_SECRETS = [
    'RECAPTCHA_SECRET_KEY',
    'HELCIM_WEBHOOK_SECRET',
    'CALCOM_WEBHOOK_SECRET',
    'REDIS_ENCRYPTION_KEY',
    'SENTRY_DSN',
    'HELCIM_API_TOKEN',
    'STAFF_EMAILS',
    'KIOSK_DEVICE_TOKEN',
    'SHEETS_CLIENT_ID',
  ];

  // Minimum required vars so the REQUIRED check passes
  var BASE_REQUIRED = {
    ZOHO_CLIENT_ID: 'test-client-id',
    ZOHO_CLIENT_SECRET: 'test-client-secret',
    ZOHO_ORG_ID: 'test-org-id',
    API_SECRET_KEY: 'test-api-key',
  };

  function setEnv(vars) {
    Object.keys(vars).forEach(function (k) {
      process.env[k] = vars[k];
    });
  }

  function clearEnv(keys) {
    keys.forEach(function (k) {
      delete process.env[k];
    });
  }

  beforeEach(() => {
    // Snapshot current env
    SAVED_ENV = Object.assign({}, process.env);

    // Ensure a clean slate for each test
    jest.resetModules();

    // Clear prod-signal vars
    delete process.env.NODE_ENV;
    delete process.env.RAILWAY_ENVIRONMENT;

    // Clear prod secrets
    clearEnv(PROD_SECRETS);

    // Clear required vars
    clearEnv(Object.keys(BASE_REQUIRED));

    // Spy on process.exit so tests can assert without actually exiting
    jest.spyOn(process, 'exit').mockImplementation(() => {});

    // Suppress log output during tests
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});

    // Set base required vars so REQUIRED check passes unless overridden
    setEnv(BASE_REQUIRED);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    // Restore env to pre-test state
    // First delete all keys that might have been set
    Object.keys(process.env).forEach(function (k) {
      if (!(k in SAVED_ENV)) delete process.env[k];
    });
    Object.keys(SAVED_ENV).forEach(function (k) {
      process.env[k] = SAVED_ENV[k];
    });
  });

  // ─── 1. Existing REQUIRED behavior (regression) ────────────────────────────

  describe('REQUIRED vars — existing behavior', () => {
    test('does not exit when all required vars are present (dev)', () => {
      validateEnv = require('../lib/validateEnv');
      validateEnv();
      expect(process.exit).not.toHaveBeenCalled();
    });

    test('calls process.exit(1) when ZOHO_CLIENT_ID is missing', () => {
      delete process.env.ZOHO_CLIENT_ID;
      validateEnv = require('../lib/validateEnv');
      validateEnv();
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    test('accepts MW_API_KEY as legacy alias for API_SECRET_KEY', () => {
      delete process.env.API_SECRET_KEY;
      process.env.MW_API_KEY = 'legacy-key';
      validateEnv = require('../lib/validateEnv');
      validateEnv();
      expect(process.exit).not.toHaveBeenCalled();
      delete process.env.MW_API_KEY;
    });
  });

  // ─── 2. D-06: REQUIRED_IN_PROD — prod secret boot gate ────────────────────

  describe('D-06: REQUIRED_IN_PROD boot gate (NODE_ENV=production)', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      // Set all prod secrets (full SC#5 set: MONITOR-02 / phase 33, plus
      // Phase 46's STAFF_EMAILS/KIOSK_DEVICE_TOKEN/SHEETS_CLIENT_ID)
      setEnv({
        RECAPTCHA_SECRET_KEY: 'rcaptcha-secret',
        HELCIM_WEBHOOK_SECRET: 'helcim-secret',
        CALCOM_WEBHOOK_SECRET: 'calcom-secret',
        REDIS_ENCRYPTION_KEY: 'redis-key',
        SENTRY_DSN: 'https://sentry.io/test-dsn',
        HELCIM_API_TOKEN: 'helcim-api-token',
        STAFF_EMAILS: 'staff@example.com',
        KIOSK_DEVICE_TOKEN: 'test-device-token',
        SHEETS_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
      });
    });

    test('does NOT exit when NODE_ENV=production and all prod secrets are present', () => {
      validateEnv = require('../lib/validateEnv');
      validateEnv();
      expect(process.exit).not.toHaveBeenCalled();
    });

    test('calls process.exit(1) when HELCIM_WEBHOOK_SECRET is missing in production', () => {
      delete process.env.HELCIM_WEBHOOK_SECRET;
      validateEnv = require('../lib/validateEnv');
      validateEnv();
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    test('calls process.exit(1) when RECAPTCHA_SECRET_KEY is missing in production', () => {
      delete process.env.RECAPTCHA_SECRET_KEY;
      validateEnv = require('../lib/validateEnv');
      validateEnv();
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    test('calls process.exit(1) when CALCOM_WEBHOOK_SECRET is missing in production', () => {
      delete process.env.CALCOM_WEBHOOK_SECRET;
      validateEnv = require('../lib/validateEnv');
      validateEnv();
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    test('calls process.exit(1) when REDIS_ENCRYPTION_KEY is missing in production', () => {
      delete process.env.REDIS_ENCRYPTION_KEY;
      validateEnv = require('../lib/validateEnv');
      validateEnv();
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    // ── MONITOR-02 / ROADMAP SC#5 — new entries (phase 33) ─────────────────
    test('calls process.exit(1) when SENTRY_DSN is missing in production', () => {
      delete process.env.SENTRY_DSN;
      validateEnv = require('../lib/validateEnv');
      validateEnv();
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    test('calls process.exit(1) when HELCIM_API_TOKEN is missing in production', () => {
      delete process.env.HELCIM_API_TOKEN;
      validateEnv = require('../lib/validateEnv');
      validateEnv();
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    test('does NOT exit when NODE_ENV=production and the full SC#5 set is present', () => {
      // All 6 SC#5 secrets set by this describe's beforeEach — no deletions
      validateEnv = require('../lib/validateEnv');
      validateEnv();
      expect(process.exit).not.toHaveBeenCalled();
    });

    // ── Phase 46 auth re-architecture additions (46-01 Task 1) ─────────────
    test('calls process.exit(1) when STAFF_EMAILS is missing in production', () => {
      delete process.env.STAFF_EMAILS;
      validateEnv = require('../lib/validateEnv');
      validateEnv();
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    test('calls process.exit(1) when KIOSK_DEVICE_TOKEN is missing in production', () => {
      delete process.env.KIOSK_DEVICE_TOKEN;
      validateEnv = require('../lib/validateEnv');
      validateEnv();
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    test('calls process.exit(1) when SHEETS_CLIENT_ID is missing in production', () => {
      delete process.env.SHEETS_CLIENT_ID;
      validateEnv = require('../lib/validateEnv');
      validateEnv();
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  // ─── 2b. Non-prod gate — SENTRY_DSN + HELCIM_API_TOKEN not enforced outside prod ──

  describe('MONITOR-02: prod-only gate for SENTRY_DSN and HELCIM_API_TOKEN', () => {
    test('does NOT exit on SENTRY_DSN absence when NODE_ENV is not production', () => {
      // NODE_ENV unset (cleared in outer beforeEach), SENTRY_DSN unset
      // RAILWAY_ENVIRONMENT also unset — pure dev/CI scenario
      validateEnv = require('../lib/validateEnv');
      validateEnv();
      expect(process.exit).not.toHaveBeenCalled();
    });

    test('does NOT exit on HELCIM_API_TOKEN absence when NODE_ENV is not production', () => {
      process.env.NODE_ENV = 'test';
      // HELCIM_API_TOKEN not set (cleared in outer beforeEach via PROD_SECRETS clearance)
      validateEnv = require('../lib/validateEnv');
      validateEnv();
      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  // ─── 3. D-02: RAILWAY_ENVIRONMENT boot assertion ───────────────────────────

  describe('D-02: RAILWAY_ENVIRONMENT/NODE_ENV boot assertion', () => {
    test('calls process.exit(1) when RAILWAY_ENVIRONMENT is set but NODE_ENV is unset', () => {
      process.env.RAILWAY_ENVIRONMENT = 'production';
      // NODE_ENV is NOT set (deleted in beforeEach)
      validateEnv = require('../lib/validateEnv');
      validateEnv();
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    test('calls process.exit(1) when RAILWAY_ENVIRONMENT is set and NODE_ENV is "development"', () => {
      process.env.RAILWAY_ENVIRONMENT = 'production';
      process.env.NODE_ENV = 'development';
      validateEnv = require('../lib/validateEnv');
      validateEnv();
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    test('does NOT exit when RAILWAY_ENVIRONMENT is set and NODE_ENV=production (with all prod secrets)', () => {
      process.env.RAILWAY_ENVIRONMENT = 'production';
      process.env.NODE_ENV = 'production';
      // Provide all prod secrets (full SC#5 set, plus Phase 46 additions) so
      // REQUIRED_IN_PROD check also passes
      setEnv({
        RECAPTCHA_SECRET_KEY: 'rcaptcha-secret',
        HELCIM_WEBHOOK_SECRET: 'helcim-secret',
        CALCOM_WEBHOOK_SECRET: 'calcom-secret',
        REDIS_ENCRYPTION_KEY: 'redis-key',
        SENTRY_DSN: 'https://sentry.io/test-dsn',
        HELCIM_API_TOKEN: 'helcim-api-token',
        STAFF_EMAILS: 'staff@example.com',
        KIOSK_DEVICE_TOKEN: 'test-device-token',
        SHEETS_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
      });
      validateEnv = require('../lib/validateEnv');
      validateEnv();
      expect(process.exit).not.toHaveBeenCalled();
    });

    test('does NOT exit when RAILWAY_ENVIRONMENT is unset and NODE_ENV is unset (dev/CI)', () => {
      // Both unset — pure dev/CI scenario
      validateEnv = require('../lib/validateEnv');
      validateEnv();
      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  // ─── 4. Dev/CI — no hard-fail on missing prod secrets ─────────────────────

  describe('Dev/CI — no hard-fail on missing prod secrets', () => {
    test('does NOT exit when NODE_ENV and RAILWAY_ENVIRONMENT are both unset, even with prod secrets missing', () => {
      // NODE_ENV unset, RAILWAY_ENVIRONMENT unset, no prod secrets
      validateEnv = require('../lib/validateEnv');
      validateEnv();
      expect(process.exit).not.toHaveBeenCalled();
    });

    test('does NOT exit when NODE_ENV=test (CI)', () => {
      process.env.NODE_ENV = 'test';
      validateEnv = require('../lib/validateEnv');
      validateEnv();
      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  // ─── 5. GP_* removal — HARDEN-04 ──────────────────────────────────────────

  describe('HARDEN-04: GP_* dead vars removed', () => {
    test('GP_ENVIRONMENT is NOT in the validateEnv module source', () => {
      var src = require('fs').readFileSync(
        require('path').join(__dirname, '../lib/validateEnv.js'),
        'utf8'
      );
      expect(src).not.toMatch(/GP_ENVIRONMENT/);
    });

    test('GP_APP_ID is NOT in the validateEnv module source', () => {
      var src = require('fs').readFileSync(
        require('path').join(__dirname, '../lib/validateEnv.js'),
        'utf8'
      );
      expect(src).not.toMatch(/GP_APP_ID/);
    });

    test('GP_APP_KEY is NOT in the validateEnv module source', () => {
      var src = require('fs').readFileSync(
        require('path').join(__dirname, '../lib/validateEnv.js'),
        'utf8'
      );
      expect(src).not.toMatch(/GP_APP_KEY/);
    });

    test('GP_MERCHANT_ID is NOT in the validateEnv module source', () => {
      var src = require('fs').readFileSync(
        require('path').join(__dirname, '../lib/validateEnv.js'),
        'utf8'
      );
      expect(src).not.toMatch(/GP_MERCHANT_ID/);
    });

    test('GP_TERMINAL_ENABLED is NOT in the validateEnv module source', () => {
      var src = require('fs').readFileSync(
        require('path').join(__dirname, '../lib/validateEnv.js'),
        'utf8'
      );
      expect(src).not.toMatch(/GP_TERMINAL_ENABLED/);
    });

    test('GP_DEPOSIT_AMOUNT is NOT in the validateEnv module source', () => {
      var src = require('fs').readFileSync(
        require('path').join(__dirname, '../lib/validateEnv.js'),
        'utf8'
      );
      expect(src).not.toMatch(/GP_DEPOSIT_AMOUNT/);
    });

    test('HELCIM_WEBHOOK_SECRET IS present in the validateEnv module source', () => {
      var src = require('fs').readFileSync(
        require('path').join(__dirname, '../lib/validateEnv.js'),
        'utf8'
      );
      expect(src).toMatch(/HELCIM_WEBHOOK_SECRET/);
    });

    test('REDIS_ENCRYPTION_KEY IS present in the validateEnv module source', () => {
      var src = require('fs').readFileSync(
        require('path').join(__dirname, '../lib/validateEnv.js'),
        'utf8'
      );
      expect(src).toMatch(/REDIS_ENCRYPTION_KEY/);
    });
  });
});
