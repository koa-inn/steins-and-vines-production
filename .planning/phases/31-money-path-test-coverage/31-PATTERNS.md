# Phase 31: Money-Path Test Coverage - Pattern Map

**Mapped:** 2026-06-16
**Files analyzed:** 5 new/modified files
**Analogs found:** 5 / 5

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `zoho-middleware/__tests__/checkout-route.test.js` | route-level test (supertest) | request-response | `zoho-middleware/__tests__/calcom-webhook.test.js` | role-match (same HMAC/route pattern; different from direct-handler capture) |
| `zoho-middleware/__tests__/helcim-webhook.test.js` | unit test + route-level test | event-driven | `zoho-middleware/__tests__/calcom-webhook.test.js` | exact (same `createHmac`/`timingSafeEqual` pattern, same route structure) |
| `zoho-middleware/server.js` | config/export refactor | request-response | `zoho-middleware/server.js` (self) | self-modification |
| `zoho-middleware/jest.config.js` | config | n/a | `zoho-middleware/jest.config.js` (self) | self-modification |
| `zoho-middleware/package.json` | config | n/a | `zoho-middleware/package.json` (self) | self-modification |

---

## Pattern Assignments

### `zoho-middleware/__tests__/checkout-route.test.js` (route-level test, supertest)

**Analog:** `zoho-middleware/__tests__/calcom-webhook.test.js` (for route-loading pattern) and `zoho-middleware/__tests__/checkout.test.js` (for mock harness)

**Key departure from existing checkout.test.js:** The existing file mocks Express entirely (lines 9-14 of `checkout.test.js`). The new file MUST NOT mock Express — it uses supertest against the real exported app, so middleware (rate-limit, referer guard, body parsing, API-key guard) runs for real.

**Mock harness to reuse** (`checkout.test.js` lines 1-35):
```javascript
'use strict';

jest.mock('../lib/helcim', () => ({
  isEnabled: jest.fn().mockReturnValue(true),
  initializeCheckout: jest.fn().mockResolvedValue({ checkoutToken: 'tok-test-123' }),
  getDepositAmount: jest.fn().mockReturnValue(10000),
  voidTransaction: jest.fn().mockResolvedValue({ ok: true, transactionId: 'txn-mock' }),
  getTerminalDiagnostics: jest.fn().mockReturnValue({})
}));
jest.mock('../lib/zoho-api', () => ({
  zohoPost: jest.fn(), zohoGet: jest.fn()
}));
jest.mock('../lib/cache', () => ({
  get: jest.fn(), set: jest.fn(), del: jest.fn(),
  acquireLock: jest.fn().mockResolvedValue(true),
  isConnected: jest.fn().mockReturnValue(false)  // disable Redis store in rate limiter
}));
jest.mock('../lib/mailer', () => ({
  sendReservationNotification: jest.fn().mockResolvedValue(),
  sendOfflineOrderNotification: jest.fn().mockResolvedValue(),
  sendVoidFailureAlert: jest.fn().mockResolvedValue()
}));
jest.mock('axios', () => ({ post: jest.fn().mockResolvedValue({ data: { ok: true } }) }));
```

**Mocks NOT needed for supertest approach (unlike checkout.test.js):**
- Do NOT mock `express` — the real app must be wired
- Do NOT mock `https` for the route tests (reCAPTCHA will fail-open when `RECAPTCHA_SECRET_KEY` is unset)

**Additional mocks needed for server.js to load cleanly:**
```javascript
jest.mock('../lib/zohoAuth', () => ({
  init: jest.fn().mockResolvedValue(),
  isAuthenticated: jest.fn().mockReturnValue(true)  // skip Zoho-auth guard
}));
jest.mock('../lib/validateEnv', () => jest.fn());    // suppress startup warnings
jest.mock('../lib/checkRedis', () => jest.fn().mockResolvedValue());
jest.mock('../lib/checkMailer', () => jest.fn());
jest.mock('../lib/brewpad-integration', () => ({
  syncBatch: jest.fn(), init: jest.fn()
}));
jest.mock('node-cron', () => ({ schedule: jest.fn() }));
jest.mock('@sentry/node', () => ({
  init: jest.fn(), setupExpressErrorHandler: jest.fn()
}));
```

**Supertest import pattern** (new, no existing analog in codebase):
```javascript
var request = require('supertest');
var app = require('../server');   // requires D-02 refactor

// In tests:
return request(app)
  .post('/api/checkout')
  .set('x-api-key', 'test-key')   // API-key guard (server.js line 264)
  .send({ customer: { email: 'a@b.com' }, items: [...] })
  .expect(201)
  .then(function (res) {
    expect(res.body.salesorder_number).toBeDefined();
  });
```

**Fixture builder pattern** (from `calcom-webhook.test.js` lines 44-50):
```javascript
function makeCheckoutBody(overrides) {
  return Object.assign({
    customer: { name: 'Test User', email: 'test@example.com', phone: '' },
    items: [{ item_id: 'item-001', name: 'Wine Kit', quantity: 1, rate: 49.99 }],
    notes: '',
    cart_key: 'sv-cart-ferment'
  }, overrides || {});
}
```

**Four locked path test stubs** (characterization stance from D-10):
- PATH-1 (success): `zohoPost` returns `{ salesorder_id: 'so-1', salesorder_number: 'SO-001', total: 49.99 }` for both `/salesorders` and `/customerpayments` → expect 201 + `{ ok: true, salesorder_number: 'SO-001' }`
- PATH-2 (void recovery): `zohoPost` for `/salesorders` throws → `helcimLib.voidTransaction` must be called with the `transaction_id` → `payment_voided: true` in response
- PATH-3 (void-failure alert): `zohoPost` throws AND `helcimLib.voidTransaction` rejects → `mailer.sendVoidFailureAlert` must be called with `txnId`
- PATH-4 (dual-cart reversal): Second cart call with same `transaction_id` when first already succeeded (`cache.get` returns `'used'` for `otherUsedKey`) → `voidTransaction` NOT called, `payment_voided: false` in response, `sendVoidFailureAlert` called

**Phase 32 gap markers** (`test.todo` — keep suite green per D-10):
```javascript
test.todo('HARDEN-01: unauthenticated checkout (no x-api-key) currently passes — Phase 32 closes');
test.todo('HARDEN-03: duplicate charge_key not rejected 409 when Redis down — Phase 32 fixes');
```

---

### `zoho-middleware/__tests__/helcim-webhook.test.js` (unit + route-level test)

**Analog:** `zoho-middleware/__tests__/calcom-webhook.test.js` — exact structural match

**Part A: Unit tests for `lib/helcim.js#verifyWebhookSignature`**

The function signature (helcim.js lines 309-340):
```javascript
verifyWebhookSignature(webhookId, timestamp, rawBody, signature)
// payload = webhookId + '.' + timestamp + '.' + rawBody
// key tried: Buffer.from(rawSecret, 'base64'), then rawSecret as string
// signature candidates split on ' ', prefix up to comma stripped
// returns true if any (key, candidate) pair matches via timingSafeEqual
// fails open (returns true) if HELCIM_WEBHOOK_SECRET is not set
```

**Helper to generate valid signatures for tests** (derive from calcom.test.js pattern):
```javascript
var crypto = require('crypto');

function makeValidSig(webhookId, timestamp, rawBody, secretBase64) {
  var rawSecret = secretBase64.replace(/^whsec_/, '');
  var key = Buffer.from(rawSecret, 'base64');
  var payload = webhookId + '.' + timestamp + '.' + rawBody;
  return crypto.createHmac('sha256', key).update(payload).digest('base64');
}
```

**Four unit test cases (D-09a):**
```javascript
describe('verifyWebhookSignature (unit)', function () {
  var helcim;
  var FAKE_SECRET_B64 = Buffer.from('super-secret-key').toString('base64');

  beforeEach(function () {
    jest.resetModules();
    process.env.HELCIM_WEBHOOK_SECRET = FAKE_SECRET_B64;
    helcim = require('../lib/helcim');
  });

  afterEach(function () { delete process.env.HELCIM_WEBHOOK_SECRET; });

  test('valid signature accepted', function () { ... });
  test('tampered body rejected', function () { ... });
  test('missing secret fails open (returns true, logs warn)', function () {
    delete process.env.HELCIM_WEBHOOK_SECRET;
    // expect(helcim.verifyWebhookSignature(...)).toBe(true);
  });
  test('base64 key decoding correct (vs raw string as fallback)', function () { ... });
});
```

**Part B: Route-level test for `routes/webhooks.js` via supertest (D-09b)**

**Mock harness** (from `calcom-webhook.test.js` lines 1-33 — keep express mock for unit section, drop it for supertest section, or use two separate describe blocks):
```javascript
// For route-level tests, do NOT mock express.
// Same additional mocks as checkout-route.test.js (zohoAuth, validateEnv, etc.)
jest.mock('../lib/helcim', () => ({
  verifyWebhookSignature: jest.fn(),
  getDeviceCode: jest.fn().mockReturnValue(''),
  // ... other methods used by server.js boot
}));
jest.mock('../lib/cache', () => ({
  get: jest.fn(), set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1), isConnected: jest.fn().mockReturnValue(false)
}));
jest.mock('../lib/eventLog', () => ({ logEvent: jest.fn() }));
jest.mock('../lib/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));
```

**Route test pattern** (from `calcom-webhook.test.js` lines 106-135):
```javascript
test('valid signature -> 200 { received: true }', function () {
  helcimLib.verifyWebhookSignature.mockReturnValue(true);
  return request(app)
    .post('/api/webhooks/terminal')
    .set('webhook-id', 'wh-123')
    .set('webhook-timestamp', '1234567890')
    .set('webhook-signature', 'v1,valid-sig')
    .send({ type: 'cardTransaction', id: 'evt-1' })
    .expect(200)
    .then(function (res) {
      expect(res.body).toEqual({ received: true });
    });
});

test('tampered body -> 401 Invalid signature', function () {
  helcimLib.verifyWebhookSignature.mockReturnValue(false);
  return request(app)
    .post('/api/webhooks/terminal')
    .send({ type: 'cardTransaction' })
    .expect(401)
    .then(function (res) {
      expect(res.body.error).toBe('Invalid signature');
    });
});
```

**Phase 32 gap marker:**
```javascript
test.todo('HARDEN-02: missing HELCIM_WEBHOOK_SECRET currently accepts all webhooks — Phase 32 closes');
```

---

### `zoho-middleware/server.js` (export refactor, D-02)

**Analog:** `zoho-middleware/server.js` (self-modification — minimal, targeted)

**Current listen block** (server.js lines 427-434):
```javascript
helcimLib.init();
cache.init().then(function () {
  return checkRedis();
}).then(function () {
  return zohoAuth.init();
}).then(function () {
  var server = app.listen(PORT, function () {
    // ... startup logging, cron schedule, cache pre-warm
  });
});
```

**Required change — guard `app.listen` and export `app`:**
```javascript
// At the END of server.js, replace the unconditional listen chain with:

if (require.main === module) {
  helcimLib.init();
  cache.init().then(function () {
    return checkRedis();
  }).then(function () {
    return zohoAuth.init();
  }).then(function () {
    var server = app.listen(PORT, function () {
      // ... existing startup logging unchanged
    });
  });
}

module.exports = app;
```

**Critical constraint:** `var app = express()` at line 33 stays exactly as-is. Only the listen chain at line 427+ and the `module.exports` are touched. All middleware registration between lines 34-420 is untouched.

**Why `require.main === module` instead of env var:** Matches the Node.js idiomatic pattern; no new env vars required; already used in the project's TESTING.md module-export notes.

---

### `zoho-middleware/jest.config.js` (coverage config changes, D-05..D-08)

**Current state** (`jest.config.js` lines 1-15):
```javascript
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverage: true,
  collectCoverageFrom: [
    'lib/**/*.js'
  ],
  coverageThreshold: {
    global: { lines: 35 },
    './lib/validate.js': { lines: 98 },
    './lib/logger.js': { lines: 98 }
  },
  coverageReporters: ['text', 'lcov']
};
```

**Required changes (D-05, D-06, D-07, D-08):**
```javascript
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverage: true,
  collectCoverageFrom: [
    'lib/**/*.js',
    'routes/**/*.js'           // D-05: add routes glob — was missing, causing silent exclusion
  ],
  coverageThreshold: {
    global: { lines: <HONEST_NUMBER> },  // D-06: measure post-change, set just below actual
    // Per-file money-path thresholds (D-07):
    './routes/checkout.js':  { lines: 60 },  // placeholder — executor sets after first run
    './routes/payments.js':  { lines: 80 },
    './routes/webhooks.js':  { lines: 70 },
    './lib/helcim.js':       { lines: 70 },
    // Existing per-file thresholds (D-08: no stale exclusions found in config):
    './lib/validate.js': { lines: 98 },
    './lib/logger.js':   { lines: 98 }
  },
  coverageReporters: ['text', 'lcov']
};
```

**D-08 note:** Inspection of the current `jest.config.js` shows NO `!lib/mailer.js` or other `!`-prefix exclusions in `collectCoverageFrom`. The MEMORY.md reference to stale exclusions appears to describe a past state. The only change needed is adding `routes/**/*.js`. No exclusions to remove.

---

### `zoho-middleware/package.json` (add supertest, D-03)

**Required change** — add `supertest` to `devDependencies`:
```json
{
  "devDependencies": {
    "eslint": "^9.39.4",
    "jest": "^29.7.0",
    "supertest": "^7.0.0"
  }
}
```

Note: `supertest` is already present in `node_modules/` (pulled in transitively by `express-rate-limit` and `cors` dev deps), so install should be fast. Use `^7.0.0` to match the `7.2.x` version already on disk.

---

## Shared Patterns

### Express mock — when to use vs. when NOT to use

**Use the express mock** (existing pattern, `calcom-webhook.test.js` lines 3-8, `taxes.test.js` lines 4-9) for pure unit tests of exported helpers from route files:
```javascript
jest.mock('express', function () {
  var router = { get: jest.fn(), post: jest.fn() };
  var express = function () {};
  express.Router = function () { return router; };
  return express;
});
```

**Do NOT use the express mock** for any supertest-based route tests. The real `app` from the refactored `server.js` must be imported. Using the express mock with supertest will break the wiring.

### beforeEach reset pattern

From `calcom-webhook.test.js` lines 59-91 — use `jest.resetModules()` inside `beforeEach` when testing code that reads `process.env` at module load time (like `verifyWebhookSignature` reading `HELCIM_WEBHOOK_SECRET`):
```javascript
beforeEach(function () {
  jest.resetModules();
  helcim = require('../lib/helcim');
  jest.clearAllMocks();
});
```

For supertest tests, do NOT `resetModules` per-test — `app` is loaded once at top of file.

### mockRes helper (for unit tests only)

From `checkout.test.js` lines 458-463 and `calcom-webhook.test.js` lines 38-42:
```javascript
function mockRes() {
  var res = { json: jest.fn(), status: jest.fn() };
  res.status.mockReturnValue(res);  // enables chaining: res.status(401).json(...)
  return res;
}
```

Only needed for unit-level handler extraction tests. Supertest route tests use the HTTP response object directly.

### ES5 style enforcement

All test files use `var`, `function`, `'use strict'` at top. No `const`/`let`/arrow functions/template literals. Matches all existing `__tests__/*.test.js` files throughout `zoho-middleware/`.

### API-key header for supertest calls

`server.js` lines 253-273 show the API-key guard exempts `GET`, `/checkout`, `/promo/validate`, and `/webhooks/*`. All other `POST /api/*` calls via supertest that target guarded routes need:
```javascript
.set('x-api-key', process.env.API_SECRET_KEY || 'test-key')
```
And the test must set `process.env.API_SECRET_KEY = 'test-key'` before loading `app`.

The `/api/checkout` route is explicitly exempted from the API-key guard (`server.js` line 256), so checkout route tests do NOT need the API key header.

The `/api/webhooks/terminal` route is exempted via the `/webhooks/` prefix check (`server.js` line 260).

---

## No Analog Found

No files are in this category. All five targets have usable analogs.

---

## Metadata

**Analog search scope:** `zoho-middleware/__tests__/`, `zoho-middleware/routes/`, `zoho-middleware/lib/`, `zoho-middleware/server.js`, `zoho-middleware/jest.config.js`
**Files scanned:** 10 source files + 4 test files read in full
**Pattern extraction date:** 2026-06-16
