---
phase: 32-fail-closed-hardening-access-control
reviewed: 2026-06-17T00:00:00Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - zoho-middleware/lib/checkout-helpers.js
  - zoho-middleware/routes/checkout.js
  - zoho-middleware/lib/helcim.js
  - zoho-middleware/lib/calcom.js
  - zoho-middleware/routes/webhooks.js
  - zoho-middleware/lib/validateEnv.js
  - zoho-middleware/lib/validate.js
  - zoho-middleware/server.js
  - zoho-middleware/routes/items.js
  - zoho-middleware/routes/taxes.js
  - zoho-middleware/__tests__/checkout-route.test.js
  - zoho-middleware/__tests__/helcim-webhook.test.js
  - zoho-middleware/__tests__/calcom-webhook.test.js
  - zoho-middleware/__tests__/validateEnv.test.js
  - zoho-middleware/__tests__/pii-access.test.js
findings:
  critical: 3
  warning: 5
  info: 3
  total: 11
status: issues_found
---

# Phase 32: Code Review Report

**Reviewed:** 2026-06-17
**Depth:** standard
**Files Reviewed:** 15
**Status:** issues_found

## Summary

This phase hardens the money path from fail-open to fail-closed: reCAPTCHA, Helcim/Cal.com HMAC verification, idempotency guards, PII route gating, and environment boot assertions. The core fail-closed gates (reCAPTCHA, webhook HMAC, Redis-down 409, startup `validateEnv`) are correctly implemented and tests correctly assert the new behavior.

Three blockers were found: a promo lock race condition that nullifies the double-burn protection, an API key comparison timing side-channel on the PII guard that is NOT guarded by constant-time comparison, and an incomplete `brewpad-integration` mock in `helcim-webhook.test.js` that would cause `TypeError` if the server startup path ever ran in that test file. Five warnings cover: missing `calcom.verifyWebhook` prod-path unit test, a stale test label that describes already-shipped behavior as "upcoming", unvalidated `item_id` path parameter in a public image route, unvalidated body forwarded directly to Zoho in `POST /api/taxes/rules`, and an API key leakable via URL query parameter in `pos.js`.

---

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Promo lock acquired but never checked — double-burn race condition still possible

**File:** `zoho-middleware/routes/checkout.js:363-386`

**Issue:** The distributed lock on `promoKey` is acquired at line 365 to prevent concurrent double-burn of the `FIRSTBATCH` promo code. However, `lockAcquired` is stored in a local variable and **never consulted** before the code unconditionally falls through to `cache.get(promoKey)` on line 374. Two simultaneous checkout requests from the same email address can both fail to acquire the lock (request B gets `false`, not an exception, so the catch block is NOT entered), and both then read `cache.get(promoKey)` before either successfully burns the redemption key — both see `null` and both apply the $20 discount. The lock provides zero serialization.

The idempotency-key lock at line 133 correctly gates on the return value (`if (!lockAcquired) return 409`). The promo lock is missing this gate.

**Fix:**
```javascript
var lockAcquired = false;
try {
  lockAcquired = await cache.acquireLock(promoKey, 30);
} catch (lockErr) {
  // Lock acquisition itself threw — fail open
  lockAcquired = true;
  log.warn('[checkout] Promo lock acquisition failed, proceeding: ' + lockErr.message);
}

// Gate: if another request already holds the lock, skip the promo
if (!lockAcquired) {
  log.warn('[checkout] Promo code FIRSTBATCH skipped — concurrent checkout in progress for ' + customerEmail);
  // promoDiscount stays 0; downstream burn check is the last-resort guard
} else {
  // Re-validate: check Redis to confirm not already redeemed
  try {
    var promoExisting = await cache.get(promoKey);
    if (!promoExisting) {
      promoDiscount = 20;
      log.info('[checkout] Promo FIRSTBATCH validated for checkout by ' + customerEmail);
    } else {
      log.warn('[checkout] Promo code FIRSTBATCH rejected — already redeemed by ' + customerEmail);
    }
  } catch (promoCheckErr) {
    promoDiscount = 20;
    log.warn('[checkout] Promo Redis check failed, allowing discount: ' + promoCheckErr.message);
  }
}
```

---

### CR-02: PII API key comparison uses string equality, not constant-time compare

**File:** `zoho-middleware/server.js:413`

**Issue:** `requirePiiApiKey` compares `req.headers['x-api-key'] === API_SECRET_KEY` with the JavaScript `===` operator. String comparison in V8 short-circuits on the first differing byte, leaking the position of the first mismatch as a timing oracle. An attacker who can measure response time with microsecond granularity can recover `API_SECRET_KEY` one byte at a time. The global POST guard at line 264 has the same issue. Both guards should use `crypto.timingSafeEqual`.

Note: per CLAUDE.md, `MW_API_KEY` is described as "semi-public by design" and the primary protection is CORS + Referer. However, `requirePiiApiKey` protects the four PII-returning GET routes (`/api/contacts`, `/api/invoices`, `/api/items/inspect`, `/api/snapshot`) which return customer data and should not be treated as semi-public. These routes are the explicit new additions in this phase, and they deserve constant-time comparison.

**Fix:**
```javascript
function requirePiiApiKey(req, res, next) {
  var sent = req.headers['x-api-key'] || '';
  if (!API_SECRET_KEY) return res.status(403).json({ error: 'Forbidden' });
  if (sent.length === API_SECRET_KEY.length &&
      crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(API_SECRET_KEY))) {
    return next();
  }
  return res.status(403).json({ error: 'Forbidden' });
}
```

Apply the same pattern to the global POST guard at line 264.

---

### CR-03: `helcim-webhook.test.js` brewpad-integration mock is missing `retryPendingBatches` and `retrySyncQueue` — server startup would throw `TypeError`

**File:** `zoho-middleware/__tests__/helcim-webhook.test.js:216-219`

**Issue:** The `brewpad-integration` mock returned by `jest.mock` at line 216 only exports `{ syncBatch, init }`. The actual `server.js` (loaded via BLOCK B's `require('../server')`) calls `brewpadIntegration.retryPendingBatches()` and `brewpadIntegration.retrySyncQueue()` inside a `setInterval` (server.js lines 516-521). Although the startup block is guarded by `require.main === module` (which is `false` in Jest), the `setInterval` IS reached when `zohoAuth.isAuthenticated()` returns `true` (the mock returns `true` at line 210). If any test ever triggers the block that calls `catalogRouter.refreshProducts()`, it will also schedule the interval whose callbacks reference the un-mocked functions.

Currently this may be masked because `require.main === module` is `false`. However `zohoAuth.isAuthenticated()` returning `true` means the cron/interval block IS entered inside `app.listen` — and `app.listen` IS called when `require.main === module`. Since tests don't call `app.listen`, this is currently safe, but the mock is dangerously incomplete and a future refactor could expose the TypeError.

**Fix:** Add the missing methods to the mock:
```javascript
jest.mock('../lib/brewpad-integration', function () {
  return {
    syncBatch: jest.fn(),
    init: jest.fn(),
    createBatchesFromSale: jest.fn(),
    retryPendingBatches: jest.fn().mockResolvedValue(),
    retrySyncQueue: jest.fn().mockResolvedValue()
  };
});
```

---

## Warnings

### WR-01: No unit test for `calcom.verifyWebhook` prod fail-closed path (missing CALCOM_WEBHOOK_SECRET + NODE_ENV=production)

**File:** `zoho-middleware/__tests__/calcom-webhook.test.js`

**Issue:** `helcim-webhook.test.js` has explicit unit tests (HARDEN-02, lines 106-131) that directly test `verifyWebhookSignature` returning `false` when `HELCIM_WEBHOOK_SECRET` is missing in production. There is no equivalent unit test for `calcom.verifyWebhook` when `CALCOM_WEBHOOK_SECRET` is missing and `NODE_ENV=production`. The route-level test at line 156 only tests the branch where the mock returns `false`; it does not exercise the real `calcom.verifyWebhook` prod gate. The calcom prod-close path (`calcom.js:143`) could silently regress without a failing test.

**Fix:** Add a unit test block in `calcom-webhook.test.js` (or a new `calcom-unit.test.js`) mirroring the helcim BLOCK A pattern:
```javascript
describe('calcom.verifyWebhook — prod fail-closed unit', function () {
  test('missing CALCOM_WEBHOOK_SECRET + prod: returns false', function () {
    jest.resetModules();
    delete process.env.CALCOM_WEBHOOK_SECRET;
    process.env.NODE_ENV = 'production';
    var calcomLib = require('../lib/calcom');
    expect(calcomLib.verifyWebhook('body', 'any-sig')).toBe(false);
  });
  test('missing CALCOM_WEBHOOK_SECRET + dev: returns true', function () {
    jest.resetModules();
    delete process.env.CALCOM_WEBHOOK_SECRET;
    delete process.env.NODE_ENV;
    var calcomLib = require('../lib/calcom');
    expect(calcomLib.verifyWebhook('body', 'any-sig')).toBe(true);
  });
});
```

---

### WR-02: Stale test description says "Phase 32 (HARDEN-02) will flip this to fail-closed" — HARDEN-02 is already shipped in this phase

**File:** `zoho-middleware/__tests__/helcim-webhook.test.js:83-99`

**Issue:** The comment at line 85 reads: "Phase 32 (HARDEN-02) will flip this to fail-closed (return false)." and the test title says "current fail-open behavior". The HARDEN-02 change is already implemented in `lib/helcim.js` (delivered in this very phase). The test is technically correct in the dev/CI scenario (NODE_ENV unset, secret missing → returns true) but the surrounding commentary misleads future readers into thinking this path has not yet been hardened, when it has. A reader auditing the test might not add the prod-gate unit test believing it's coming later.

**Fix:** Update the comment and test name to reflect shipped state:
```javascript
// Case 3: missing HELCIM_WEBHOOK_SECRET in dev/CI (NODE_ENV unset)
// Fails OPEN for dev convenience. HARDEN-02 is already live: prod (NODE_ENV=production)
// fails closed — see Case 3b below.
test('missing HELCIM_WEBHOOK_SECRET + NODE_ENV unset -> returns true (dev fail-open)', function () {
```

---

### WR-03: Unvalidated `item_id` path parameter in public image proxy creates path-traversal risk toward Zoho Inventory API

**File:** `zoho-middleware/routes/items.js:151-180`

**Issue:** `GET /api/items/:item_id/image` is a public route (no API key required — all GETs are exempt from the API key guard per `server.js:254`). The Express `req.params.item_id` value is interpolated directly into the Zoho Inventory URL at line 154:
```javascript
ZOHO_INVENTORY_BASE + '/items/' + req.params.item_id + '/image'
```
Express decodes `%2F` in path segments by default. A crafted `:item_id` such as `../settings/taxes` could redirect the proxied request to a different Zoho Inventory endpoint. The request carries the OAuth bearer token (`Authorization: Zoho-oauthtoken ...`), so a successful path traversal would authenticate as the Zoho service account against an unintended endpoint.

**Fix:** Validate that `item_id` is numeric-only before use:
```javascript
router.get('/api/items/:item_id/image', function (req, res) {
  var itemId = req.params.item_id;
  if (!/^\d+$/.test(itemId)) {
    return res.status(400).json({ error: 'Invalid item id' });
  }
  // ... rest of handler
```

---

### WR-04: `POST /api/taxes/rules` forwards `req.body` directly to Zoho without body validation

**File:** `zoho-middleware/routes/taxes.js:201-208`

**Issue:** Unlike other mutating routes in this phase (`POST /api/items`, `POST /api/taxes/apply`) which run `validateBody()` before forwarding, `POST /api/taxes/rules` passes `req.body` directly to `zohoPost('/settings/taxrules', req.body)` with no field whitelisting. An authorized admin with the API key can inject arbitrary Zoho-side fields. This is inconsistent with the D-08 (no field smuggling) design goal documented in `routes/items.js:15-16`.

**Fix:** Apply `validateBody` with a tax-rule schema before forwarding:
```javascript
var TAX_RULE_SCHEMA = {
  allowed: ['tax_name', 'tax_percentage', 'tax_type', 'tax_authority_id', 'taxes'],
  required: ['tax_name', 'tax_percentage'],
  types: { tax_percentage: 'number' }
};
router.post('/api/taxes/rules', function (req, res) {
  var result = validate.validateBody(req.body, TAX_RULE_SCHEMA);
  if (result.error) return res.status(400).json({ error: result.error });
  zohoPost('/settings/taxrules', result.clean)...
```

---

### WR-05: `/api/contacts/search` accepts API key via URL query parameter — key exposed in server logs and proxy history

**File:** `zoho-middleware/routes/pos.js:1788`

**Issue:** The inline auth check in `GET /api/contacts/search` reads `req.headers['x-api-key'] || req.query.api_key`. Accepting the API key via `req.query.api_key` means the secret appears in the URL, which is then written to Railway/nginx access logs, browser history, referrer headers on redirects, and any CDN or proxy cache headers. This is a credential-in-URL antipattern regardless of how "semi-public" the key is.

Additionally, this route compares against `process.env.MW_API_KEY` specifically (not `API_SECRET_KEY || MW_API_KEY`). If a deployment only sets `API_SECRET_KEY` (the newer canonical name), `process.env.MW_API_KEY` is `undefined`, and the comparison `apiKey !== undefined` is always `true` — every request gets a 401.

**Fix:**
```javascript
var API_KEY = process.env.API_SECRET_KEY || process.env.MW_API_KEY || '';
var apiKey = req.headers['x-api-key'] || '';  // remove query param branch
if (!API_KEY || apiKey !== API_KEY) {
  return res.status(401).json({ error: 'Unauthorized' });
}
```

---

## Info

### IN-01: `recaptcha_token` max-length not validated — any-length string passes input gate

**File:** `zoho-middleware/routes/checkout.js:120`

**Issue:** `payment_token` and `idempotency_key` both have explicit length caps (500 and 128 chars). `recaptcha_token` is only type-checked (`typeof body.recaptcha_token === 'string'`) but not length-capped. A bot can send a 1 MB token string that occupies a URL-encoded request in the 1 MB `express.json` limit. This passes validation and enters the `verifyRecaptcha` flow, which sends the full token to Google via HTTPS. In production this immediately fails (score 0), but it wastes the HTTPS connection and reCAPTCHA API quota per request.

**Fix:** Add a length cap consistent with the other tokens:
```javascript
var rcToken = (typeof body.recaptcha_token === 'string' && body.recaptcha_token.length <= 2048)
  ? body.recaptcha_token : '';
```

---

### IN-02: `console.error` used in `server.js` contact-form and waitlist handlers instead of structured logger

**File:** `zoho-middleware/server.js:173, 197, 206, 209`

**Issue:** The `/api/contact` and `/api/waitlist` handlers use `console.error(...)` while all other handlers use `log.error(...)` (the structured logger from `lib/logger.js`). The structured logger attaches request IDs, log levels, and JSON format for Railway log drains. Raw `console.error` calls miss these metadata fields, making contact-form and waitlist errors harder to correlate in production.

**Fix:** Replace `console.error(...)` with `log.error(...)` and `console.error('[waitlist]...')` with `log.error('[waitlist]...')` throughout these handlers.

---

### IN-03: Test label "HARDEN-02: verifyWebhookSignature returns false -> route returns 403 (not processed)" is tautological — it only tests the route plumbing, not the actual HMAC behavior

**File:** `zoho-middleware/__tests__/helcim-webhook.test.js:291-306`

**Issue:** The BLOCK B test labeled "HARDEN-02" (line 291) sets `helcimLib.verifyWebhookSignature.mockReturnValue(false)` and then asserts the route returns 403. This test is identical to the earlier "tampered body -> 403" test at line 272 — both mock the verifier to `false` and check the route response. The test description attributes this to HARDEN-02's prod-gate (secret unset in prod), but the test has no `NODE_ENV=production` setup and does not exercise the real verifier. The HARDEN-02 prod behavior is properly tested in BLOCK A; this test only duplicates the route-plumbing test.

**Fix:** Either remove the BLOCK B HARDEN-02 test as redundant, or restructure it to call the real verifier in a prod-env supertest scenario:
```javascript
test('HARDEN-02: verifyWebhookSignature returns 403 when signature absent in prod (route integration)', function () {
  // This test proves the route calls verifyWebhookSignature and respects false.
  // The prod fail-closed behavior of the verifier itself is tested in BLOCK A.
  helcimLib.verifyWebhookSignature.mockReturnValue(false);
  return request(app)
    .post('/api/webhooks/terminal')
    .send({ type: 'cardTransaction', id: 'evt-unsigned' })
    .expect(403);
});
```

---

_Reviewed: 2026-06-17_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
