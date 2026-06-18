'use strict';

// ---------------------------------------------------------------------------
// helcim-webhook.test.js
//
// Two-block structure:
//   Block A (unit): verifyWebhookSignature — requires jest.resetModules per test
//   Block B (route): POST /api/webhooks/terminal via supertest — loads server once
//
// IMPORTANT: Do NOT add jest.mock('express') at file scope.
// lib/helcim.js has no express dependency — the unit block works without it,
// and a file-scope express mock would corrupt the route block's supertest wiring.
// ---------------------------------------------------------------------------

var crypto = require('crypto');

// ---------------------------------------------------------------------------
// Helper: produce a valid base64 HMAC-SHA256 signature matching helcim.js logic
// Mirrors verifyWebhookSignature's payload assembly and base64 key derivation.
// ---------------------------------------------------------------------------
function makeValidSig(webhookId, timestamp, rawBody, secretBase64) {
  var rawSecret = secretBase64.replace(/^whsec_/, '');
  var key = Buffer.from(rawSecret, 'base64');
  var payload = webhookId + '.' + timestamp + '.' + rawBody;
  return crypto.createHmac('sha256', key).update(payload).digest('base64');
}

// ---------------------------------------------------------------------------
// BLOCK A: Unit tests for lib/helcim.js#verifyWebhookSignature
// ---------------------------------------------------------------------------

describe('verifyWebhookSignature (unit)', function () {
  var helcim;
  // A secret that, when base64-decoded, produces a real 16-byte key.
  // Buffer.from('super-secret-key').toString('base64') = 'c3VwZXItc2VjcmV0LWtleQ=='
  var FAKE_SECRET_B64 = Buffer.from('super-secret-key').toString('base64');

  beforeEach(function () {
    jest.resetModules();
    // The file-scope jest.mock('../lib/helcim') is hoisted; unmock so we load the real module.
    jest.unmock('../lib/helcim');
    // Also unmock logger since helcim.js requires it
    jest.unmock('../lib/logger');
    process.env.HELCIM_WEBHOOK_SECRET = FAKE_SECRET_B64;
    helcim = require('../lib/helcim');
  });

  afterEach(function () {
    delete process.env.HELCIM_WEBHOOK_SECRET;
    delete process.env.NODE_ENV;
  });

  // -------------------------------------------------------------------------
  // Case 1: valid signature accepted
  // -------------------------------------------------------------------------

  test('valid signature -> returns true', function () {
    var webhookId = 'wh-test-001';
    var timestamp = '1750000000';
    var rawBody = '{"type":"cardTransaction","id":"evt-1"}';
    var sig = makeValidSig(webhookId, timestamp, rawBody, FAKE_SECRET_B64);

    expect(helcim.verifyWebhookSignature(webhookId, timestamp, rawBody, sig)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Case 2: tampered body rejected
  // -------------------------------------------------------------------------

  test('tampered body -> returns false', function () {
    var webhookId = 'wh-test-001';
    var timestamp = '1750000000';
    var rawBody = '{"type":"cardTransaction","id":"evt-1"}';
    var sig = makeValidSig(webhookId, timestamp, rawBody, FAKE_SECRET_B64);

    // Mutate the body by one character — signature is now stale
    var tamperedBody = rawBody + 'X';

    expect(helcim.verifyWebhookSignature(webhookId, timestamp, tamperedBody, sig)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Case 3: missing HELCIM_WEBHOOK_SECRET — current fail-OPEN behavior
  // This is the honest characterization per D-09/D-10.
  // Phase 32 (HARDEN-02) will flip this to fail-closed (return false).
  // -------------------------------------------------------------------------

  test('missing HELCIM_WEBHOOK_SECRET -> returns true (current fail-open behavior)', function () {
    // Override the beforeEach setup: delete the env var and reload the module fresh
    jest.resetModules();
    jest.unmock('../lib/helcim');
    jest.unmock('../lib/logger');
    delete process.env.HELCIM_WEBHOOK_SECRET;
    helcim = require('../lib/helcim');

    var result = helcim.verifyWebhookSignature('wh-1', '123', 'body', 'any-sig');

    // Current behavior: fails OPEN (returns true) when secret is missing
    expect(result).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Case 3b: HARDEN-02 — prod gate: missing secret must fail CLOSED in prod
  // -------------------------------------------------------------------------

  test('HARDEN-02: missing HELCIM_WEBHOOK_SECRET + NODE_ENV=production -> returns false (fail closed)', function () {
    jest.resetModules();
    jest.unmock('../lib/helcim');
    jest.unmock('../lib/logger');
    delete process.env.HELCIM_WEBHOOK_SECRET;
    process.env.NODE_ENV = 'production';
    helcim = require('../lib/helcim');

    var result = helcim.verifyWebhookSignature('wh-1', '123', 'body', 'any-sig');

    // Prod fail-closed: returns false so the route rejects with 403
    expect(result).toBe(false);
  });

  test('HARDEN-02: missing HELCIM_WEBHOOK_SECRET + NODE_ENV unset -> returns true (dev fail-open preserved)', function () {
    jest.resetModules();
    jest.unmock('../lib/helcim');
    jest.unmock('../lib/logger');
    delete process.env.HELCIM_WEBHOOK_SECRET;
    delete process.env.NODE_ENV;
    helcim = require('../lib/helcim');

    var result = helcim.verifyWebhookSignature('wh-1', '123', 'body', 'any-sig');

    // Dev: still fails open (skip-verification warning path preserved)
    expect(result).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Case 4: base64 key decoding — proves the base64 branch is exercised
  //
  // Construct a secret where the raw utf8 string is NOT a valid HMAC key for
  // the signature, but the base64-decoded version IS. We do this by computing
  // the signature using the base64-decoded key directly (makeValidSig does this)
  // and verifying it passes. Then we confirm the raw-string interpretation would
  // NOT produce the same signature (different key bytes).
  // -------------------------------------------------------------------------

  test('base64 key decoding correct — base64-decoded key matches, raw string would not', function () {
    // Use a secret where the base64-decoded bytes differ from the raw utf8 bytes
    // 'dGVzdC1zZWNyZXQ=' base64-decodes to 'test-secret' (different byte pattern)
    var secretB64 = Buffer.from('test-secret').toString('base64'); // 'dGVzdC1zZWNyZXQ='
    jest.resetModules();
    jest.unmock('../lib/helcim');
    jest.unmock('../lib/logger');
    process.env.HELCIM_WEBHOOK_SECRET = secretB64;
    helcim = require('../lib/helcim');

    var webhookId = 'wh-b64-test';
    var timestamp = '1750000001';
    var rawBody = '{"type":"cardTransaction","id":"evt-b64"}';

    // Signature computed using base64-decoded key (what makeValidSig does, what
    // verifyWebhookSignature tries first)
    var sigWithBase64Key = makeValidSig(webhookId, timestamp, rawBody, secretB64);

    // Signature computed using the raw utf8 secret string (the fallback path).
    // This will differ from sigWithBase64Key because the raw bytes of secretB64
    // (the base64 string itself) are different from the decoded bytes.
    var rawSecretUtf8 = secretB64; // e.g. 'dGVzdC1zZWNyZXQ='
    var payloadStr = webhookId + '.' + timestamp + '.' + rawBody;
    var sigWithRawKey = crypto.createHmac('sha256', rawSecretUtf8).update(payloadStr).digest('base64');

    // The two signatures must differ (if they were identical, the test would be
    // vacuous — it wouldn't prove the base64 branch independently)
    expect(sigWithBase64Key).not.toBe(sigWithRawKey);

    // verifyWebhookSignature with the base64-key-derived signature returns true
    // (proves the base64 decode path is exercised and correct)
    expect(helcim.verifyWebhookSignature(webhookId, timestamp, rawBody, sigWithBase64Key)).toBe(true);

    // verifyWebhookSignature also returns true for the raw-key signature because
    // helcim.js tries BOTH keys — first base64, then raw utf8 fallback.
    // We already proved the two signatures differ, so the base64 key was required
    // for the first assertion above to pass. This proves the base64 path is live.
  });
});

// ---------------------------------------------------------------------------
// BLOCK B: Route-level tests for POST /api/webhooks/terminal via supertest
// ---------------------------------------------------------------------------

// Mock helcim so verifyWebhookSignature is controllable per-test.
// getDeviceCode needed by server.js and webhooks.js startup.
jest.mock('../lib/helcim', function () {
  return {
    verifyWebhookSignature: jest.fn(),
    isEnabled: jest.fn().mockReturnValue(false),
    isTerminalEnabled: jest.fn().mockReturnValue(false),
    getDeviceCode: jest.fn().mockReturnValue(''),
    getDepositAmount: jest.fn().mockReturnValue(0),
    getTerminalDiagnostics: jest.fn().mockReturnValue({}),
    init: jest.fn(),
    initializeCheckout: jest.fn().mockResolvedValue({ checkoutToken: '' }),
    voidTransaction: jest.fn().mockResolvedValue({ ok: true }),
    refundTransaction: jest.fn().mockResolvedValue({ ok: true }),
    cancelTerminal: jest.fn().mockResolvedValue({ ok: false })
  };
});

// Server boot mocks — same set as checkout-route.test.js (D-02 refactor)
jest.mock('../lib/zohoAuth', function () {
  return {
    init: jest.fn().mockResolvedValue(),
    isAuthenticated: jest.fn().mockReturnValue(true)
  };
});
jest.mock('../lib/validateEnv', function () { return jest.fn(); });
jest.mock('../lib/checkRedis', function () { return jest.fn().mockResolvedValue(); });
jest.mock('../lib/checkMailer', function () { return jest.fn(); });
jest.mock('../lib/brewpad-integration', function () {
  return { syncBatch: jest.fn(), init: jest.fn() };
});
jest.mock('node-cron', function () { return { schedule: jest.fn() }; });
jest.mock('@sentry/node', function () {
  return { init: jest.fn(), setupExpressErrorHandler: jest.fn() };
});
jest.mock('../lib/cache', function () {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    acquireLock: jest.fn().mockResolvedValue(true),
    releaseLock: jest.fn().mockResolvedValue(),
    isConnected: jest.fn().mockReturnValue(false),
    init: jest.fn().mockResolvedValue(),
    quit: jest.fn().mockResolvedValue()
  };
});
jest.mock('../lib/eventLog', function () { return { logEvent: jest.fn() }; });
jest.mock('../lib/logger', function () {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
});

describe('POST /api/webhooks/terminal (route)', function () {
  var request = require('supertest');
  var helcimLib = require('../lib/helcim');
  var app = require('../server');

  beforeEach(function () {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Valid signature -> 200 { received: true }
  // -------------------------------------------------------------------------

  test('valid signature -> 200 { received: true }', function () {
    helcimLib.verifyWebhookSignature.mockReturnValue(true);

    return request(app)
      .post('/api/webhooks/terminal')
      .set('webhook-id', 'wh-123')
      .set('webhook-timestamp', '1750000000')
      .set('webhook-signature', 'v1,valid-sig')
      .send({ type: 'cardTransaction', id: 'evt-1' })
      .expect(200)
      .then(function (res) {
        expect(res.body).toEqual({ received: true });
      });
  });

  // -------------------------------------------------------------------------
  // Tampered body -> 401 { error: 'Invalid signature' }
  // -------------------------------------------------------------------------

  test('tampered body -> 401 { error: \'Invalid signature\' }', function () {
    helcimLib.verifyWebhookSignature.mockReturnValue(false);

    return request(app)
      .post('/api/webhooks/terminal')
      .set('webhook-id', 'wh-456')
      .set('webhook-timestamp', '1750000001')
      .set('webhook-signature', 'v1,bad-sig')
      .send({ type: 'cardTransaction', id: 'evt-tampered' })
      .expect(401)
      .then(function (res) {
        expect(res.body).toEqual({ error: 'Invalid signature' });
      });
  });

  // -------------------------------------------------------------------------
  // Phase 32 gap marker
  // -------------------------------------------------------------------------

  test.todo('HARDEN-02: missing HELCIM_WEBHOOK_SECRET currently accepts all webhooks — Phase 32 closes');
});
