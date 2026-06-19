# Phase 32: Fail-Closed Hardening & Access Control - Pattern Map

**Mapped:** 2026-06-17
**Files analyzed:** 11 (10 modified, 0 net-new — see CRITICAL NOTE re `lib/validate.js`)
**Analogs found:** 11 / 11 (all in-codebase — this is a hardening phase, every change has an existing local pattern)

> All paths below are relative to `/Users/koa/dev/steins-and-vines-website/zoho-middleware/` unless absolute. This is a pure backend/middleware phase: Express, ES5 (`var`/`function`), Jest `node` env. No frontend.

---

## CRITICAL NOTE FOR PLANNER (resolve before writing PII-02 plan)

**`zoho-middleware/lib/validate.js` ALREADY EXISTS.** CONTEXT.md D-08 / canonical_refs describe it as a "NEW shared body-shape whitelist helper" — that is incorrect. The existing file exports `validateLineItems()` and `classifyZohoError()` (used by checkout/pos/purchaseorders) and has a full test suite (`__tests__/validate.test.js`, ~35 assertions). It is NOT a generic whitelist helper.

**Two safe options for PII-02 (planner picks one):**
1. **Extend `lib/validate.js`** — add a new exported function (e.g. `validateBody(body, schema)`) alongside the existing two exports. Do NOT modify `validateLineItems`/`classifyZohoError` (CLAUDE.md rule 10: don't change existing tests; rule 7: full suite after touching shared lib). Append-only.
2. **New file `lib/validateBody.js`** — avoids any blast radius on the existing validate suite.

Either way the helper must be ES5/vanilla, no schema-lib dependency. Recommend option 1 (matches CONTEXT D-08 naming intent) but flag the existing exports as untouchable.

---

## File Classification

| File | Role | Data Flow | Closest Analog | Match Quality |
|------|------|-----------|----------------|---------------|
| `lib/checkout-helpers.js` (`verifyRecaptcha`) | lib/validator | request-response (sync verify) | `lib/logger.js:11` (isProd gate) + self | exact (in-file) |
| `routes/checkout.js` (reCAPTCHA gate + `checkTransactionIdAndProceed`) | route | request-response | self (other Redis catch blocks in file) | exact (in-file) |
| `lib/helcim.js` (`verifyWebhookSignature`) | lib/validator | event-driven (HMAC verify) | `lib/calcom.js#verifyWebhook` + `lib/logger.js:11` | exact |
| `lib/calcom.js` (`verifyWebhook`) | lib/validator | event-driven (HMAC verify) | `lib/helcim.js#verifyWebhookSignature` | exact |
| `routes/webhooks.js` (consume verify result) | route | event-driven | self (both verify sites are already identical) | exact (in-file) |
| `lib/validateEnv.js` | config/startup | batch (boot check) | self (existing REQUIRED/missing pattern) | exact (in-file) |
| `server.js` (targeted PII GET guard) | middleware | request-response | `routes/consignment.js:24-28` (per-route x-api-key) | exact |
| `routes/items.js` (`POST /api/items`) | route | CRUD (create) | `routes/catalog.js:988-999` (upload-catalog body check) | role+flow match |
| `routes/items.js` (`PUT /api/inventory/items/:id`) | route | CRUD (update) | `routes/catalog.js:988-999` | role+flow match |
| `routes/taxes.js` (`POST /api/taxes/apply`) | route | CRUD (bulk update) | `routes/catalog.js:988-999` | role+flow match |
| `lib/validate.js` (extend) OR `lib/validateBody.js` (new) | lib/validator | transform | existing `lib/validate.js#validateLineItems` | exact |
| Tests (`__tests__/*`) | test | n/a | `checkout-route.test.js`, `helcim-webhook.test.js`, `calcom-webhook.test.js` | exact |

---

## Shared Pattern: the `isProd` gate (D-01) — drives HARDEN-01 & HARDEN-02

**This is the single most-reused pattern in the phase.** The canonical form already exists in the codebase:

**Source:** `lib/logger.js:11`
```javascript
var isProd = process.env.NODE_ENV === 'production';
```

**Apply to:** `verifyRecaptcha` (2 sites), `verifyWebhookSignature` (1 site), `verifyWebhook` (1 site), and `validateEnv.js` boot check.

**The fail-closed transform pattern** (from CONTEXT D-01): replace each `return <allow>` in an unset-secret / network-error branch with:
```javascript
var isProd = process.env.NODE_ENV === 'production';
if (!secret) {
  if (isProd) return false;            // or reject / {success:false} for recaptcha
  log.warn('... not set — skipping verification (dev)');
  return true;                          // dev keeps current fail-open
}
```

**No `RAILWAY_*` var is referenced anywhere in the codebase yet** (grep of `lib/`, `routes/`, `server.js` → zero hits). So for the D-02 "looks like prod but NODE_ENV !== production" boot assertion, the planner introduces a brand-new env reference. Recommendation (Claude's-Discretion item from D-02): key it on `process.env.RAILWAY_ENVIRONMENT` — it is the conventionally-injected Railway service var. There is no existing precedent to copy; document the choice in the plan and confirm presence in Railway as a human action alongside `NODE_ENV=production`.

**Tests must set `NODE_ENV`** to exercise the closed path. Established pattern in `__tests__/logger.test.js`:
```javascript
beforeEach(() => { delete process.env.NODE_ENV; });            // line 8
// ...
process.env.NODE_ENV = 'production';                            // line 69
// ...
afterEach(() => { delete process.env.NODE_ENV; });             // line 76
```

---

## Pattern Assignments

### HARDEN-01 — `lib/checkout-helpers.js#verifyRecaptcha` (lib/validator, request-response)

**Analog:** self + `lib/logger.js:11`. Two fail-open returns to flip in prod.

**Fail-open #1 — unset key** (`checkout-helpers.js:46-48`):
```javascript
function verifyRecaptcha(token) {
  var secret = process.env.RECAPTCHA_SECRET_KEY || '';
  if (!secret) return Promise.resolve({ success: true, score: 1.0 }); // unconfigured → allow
  if (!token) return Promise.resolve({ success: false, score: 0 });
```
→ In prod, return `{ success: false, score: 0 }` (or similar) when `!secret`.

**Fail-open #2 — timeout/network catch** (`checkout-helpers.js:74-77`):
```javascript
  return withTimeout(verifyPromise, 5000).catch(function(timeoutErr) {
    log.warn('[checkout] reCAPTCHA verification timed out — allowing through: ' + timeoutErr.message);
    return { success: true, score: 1.0 };
  });
```
→ In prod, the `.catch` returns `{ success: false }`. Dev keeps the warn+allow.

**Where the result is consumed** — `routes/checkout.js:146-171`. NOTE the route ALSO has a fail-open `catch` that the lib change does not cover:
```javascript
  try {
    var captcha = await verifyRecaptcha(rcToken);
    if (!captcha.success || captcha.score < 0.5) {
      // ... voids payment_token, then:
      return res.status(400).json({ error: 'Request could not be verified. Please try again.' });
    }
    return proceed();
  } catch (err) {
    // Google unreachable — log and allow through rather than blocking real customers
    log.warn('[checkout] reCAPTCHA verification failed (network error) — allowing through: ' + (err && err.message));
    return proceed();          // <-- route-level fail-open, line 170
  }
```
> Planner decision: D-03 says the timeout/network fail-open is inside `verifyRecaptcha`. But `verifyRecaptcha` swallows timeouts in its own `.catch` and returns an object — it never rejects, so the route `catch` at :167-171 only fires on a *synchronous* throw. To genuinely fail closed on network error in prod, the fix belongs in `verifyRecaptcha`'s `.catch` (returning `{success:false}` triggers the existing 400 at :164). The route's own `catch` (:170) should also flip to a 4xx in prod for defense-in-depth. The existing 400 at :164 is the rejection-before-charge that the success criterion requires (charge happens later inside `processCheckout`/`runCheckout`).

**Success criterion status code:** 4xx. The existing `res.status(400)` at :164 satisfies it.

---

### HARDEN-02 — `lib/helcim.js#verifyWebhookSignature` (lib/validator, event-driven)

**Analog:** `lib/calcom.js#verifyWebhook` (its sibling). Only the unset-secret branch flips; the `crypto.timingSafeEqual` HMAC body is unchanged.

**Fail-open branch** (`helcim.js:309-314`):
```javascript
function verifyWebhookSignature(webhookId, timestamp, rawBody, signature) {
  var secret = process.env.HELCIM_WEBHOOK_SECRET || '';
  if (!secret) {
    log.warn('[helcim] HELCIM_WEBHOOK_SECRET not set — skipping webhook signature verification');
    return true;                 // <-- flip to false in prod
  }
```

**Unchanged HMAC pattern to preserve** (`helcim.js:315-339`) — base64 key + `crypto.timingSafeEqual`:
```javascript
  var rawSecret = secret.replace(/^whsec_/, '');
  var payload = webhookId + '.' + timestamp + '.' + rawBody;
  var keys = [Buffer.from(rawSecret, 'base64'), rawSecret];     // base64 first, raw fallback
  var candidates = (signature || '').split(' ');
  for (var k = 0; k < keys.length; k++) {
    var expected = crypto.createHmac('sha256', keys[k]).update(payload).digest('base64');
    for (var i = 0; i < candidates.length; i++) {
      // ...
      try {
        if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return true;
      } catch (e) { /* length mismatch — try next */ }
    }
  }
  return false;
```

### HARDEN-02 — `lib/calcom.js#verifyWebhook` (lib/validator, event-driven)

**Fail-open branch** (`calcom.js:139-152`):
```javascript
function verifyWebhook(rawBody, signature) {
  var secret = process.env.CALCOM_WEBHOOK_SECRET || '';
  if (!secret) {
    log.warn('[calcom] CALCOM_WEBHOOK_SECRET not set — skipping webhook signature verification');
    return true; // fail-open dev pattern        <-- flip to false in prod
  }
  var expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature || ''));
  } catch (e) { return false; }
}
```

### HARDEN-02 — `routes/webhooks.js` consume sites (route, event-driven)

**No change needed to the route logic** — both consume sites already reject on `false` with a 401. Flipping the verifier return to `false` in prod automatically yields the rejection. (CONTEXT/criterion says 400/403; the existing code returns **401**. Planner: confirm whether 401 satisfies the "400/403" criterion or whether the status must change. 401 is arguably correct for an unsigned request; recommend keeping 401 but noting it explicitly against the criterion.)

**Helcim consume site** (`webhooks.js:37-41`):
```javascript
  if (!helcimLib.verifyWebhookSignature(webhookId, timestamp, rawBody, signature)) {
    log.warn('[webhook/helcim] Invalid signature — rejected (body_len=' + rawBody.length + ')');
    return res.status(401).json({ error: 'Invalid signature' });
  }
```
**Cal.com consume site** (`webhooks.js:224-227`):
```javascript
  if (!calcom.verifyWebhook(rawBody, signature)) {
    log.warn('[webhook/calcom] Invalid signature — rejected (body_len=' + rawBody.length + ')');
    return res.status(401).json({ error: 'Invalid signature' });
  }
```
Webhook routes are exempt from the API-key guard (`server.js:260`) and Referer guard (no Referer header), so HMAC is their only auth — fail-closing it is the whole point.

---

### HARDEN-03 — `routes/checkout.js#checkTransactionIdAndProceed` (route, request-response)

**Analog:** self. The replay guard is at lines 205-222.

**The Redis-down fail-open to fix** (`checkout.js:211-221`):
```javascript
    var txnKey = 'helcim:txn:' + transactionId + txnKeySuffix;
    try {
      var existing = await cache.get(txnKey);
      if (existing) {
        log.warn('[checkout] Replay attack detected — transaction_id already used: ' + transactionId);
        return res.status(409).json({ error: 'Payment already processed' });
      }
      return runCheckout();
    } catch (e) {
      // Redis unavailable — allow through (fail open)
      return runCheckout();                    // <-- D-05: replace with res.status(409)
    }
```
→ D-05: the `catch` returns `res.status(409).json({ error: 'Payment already processed' })` (reuse the exact 409 body already present at :215). The 409 status is a HARD success criterion.

**Open question the planner MUST resolve (D-05 flags it):** there are TWO other Redis-down fail-opens in this same request that also bear on "no duplicate Zoho order":

1. **Idempotency-key lock path** (`checkout.js:124-143`) — the outer `proceed()`:
```javascript
  async function proceed() {
    if (idempotencyKey) {
      try {
        var cached = await cache.get(idempotencyKey);
        if (cached) { return res.status(201).json(cached); }
        var lockAcquired = await cache.acquireLock(idempotencyKey, CHECKOUT_IDEMPOTENCY_TTL);
        if (!lockAcquired) { return res.status(409).json({ error: 'Checkout already in progress' }); }
        processCheckout(body, idempotencyKey, res, zohoOffline);
      } catch (e) {
        processCheckout(body, idempotencyKey, res, zohoOffline);    // <-- ALSO fails open on Redis-down
      }
      return;
    }
    processCheckout(body, null, res, zohoOffline);
  }
```
→ This ALSO fails open when Redis is down. Whether to harden it depends on scope reading: the success criterion (Criterion 3) is keyed on `transactionId`, not `idempotency_key`. The `transactionId` guard at :205 is the one that prevents a *charged* card from creating two Zoho orders (idempotency_key is a client-generated UUID, optional, and may be absent). Recommend: scope the plan to the `transactionId` guard per the literal criterion, but note the idempotency catch at :138 as a follow-up risk so it is a conscious decision, not an oversight.

2. **Promo lock** (`checkout.js:348-370`) — fails open on Redis-down (`lockAcquired = true` at :353, and the re-check `catch` at :366-369 sets `promoDiscount = 20`). This is a discount-burn risk, NOT a duplicate-order risk, so it is OUT of scope for HARDEN-03 (no money-path duplication). Leave unchanged.

---

### HARDEN-04 — `lib/validateEnv.js` (config/startup, batch)

**Analog:** self. The existing REQUIRED-missing → `process.exit(1)` mechanism is the exact pattern to extend.

**Existing failure-signal pattern to reuse** (`validateEnv.js:63-78`):
```javascript
function validateEnv() {
  var missing = REQUIRED.filter(function (v) { /* ... */ return !process.env[v.name]; });
  if (missing.length > 0) {
    missing.forEach(function (v) {
      log.error('[startup] Missing required env var: ' + v.name + ' — ' + v.desc);
    });
    log.error('[startup] ' + missing.length + ' required env var(s) missing. Exiting.');
    process.exit(1);
  }
  // ... optional warnings ...
}
```

**D-06 — add a prod-required-secrets check.** New secrets that must hard-fail boot when `NODE_ENV === 'production'`: `RECAPTCHA_SECRET_KEY`, `HELCIM_WEBHOOK_SECRET`, `CALCOM_WEBHOOK_SECRET`, `REDIS_ENCRYPTION_KEY`. These are currently in `OPTIONAL` (lines 30, 50) or absent. Pattern: a second `REQUIRED_IN_PROD` list filtered only when `isProd`, reusing the same `log.error` + `process.exit(1)` mechanism.

**D-02 — the "looks like prod but NODE_ENV unset" boot assertion.** No `RAILWAY_*` precedent exists (grep = 0 hits). Add: if `process.env.RAILWAY_ENVIRONMENT` (planner to confirm var name) is set AND `process.env.NODE_ENV !== 'production'` → `log.error` + `process.exit(1)`. Must NOT be gated on `isProd` (circular).

**Dead vars to DROP (HARDEN-04).** Global Payments vars are referenced ONLY in `validateEnv.js` (grep of `lib/routes/server.js` confirms zero other references). Remove these `OPTIONAL` entries (`validateEnv.js:24-29`):
```javascript
  { name: 'GP_ENVIRONMENT',      desc: 'Global Payments environment (test/production)' },
  { name: 'GP_APP_ID',           desc: 'Global Payments app ID' },
  { name: 'GP_APP_KEY',          desc: 'Global Payments app key' },
  { name: 'GP_MERCHANT_ID',      desc: 'Global Payments merchant ID' },
  { name: 'GP_TERMINAL_ENABLED', desc: 'Enable GP POS terminal (true/false)' },
  { name: 'GP_DEPOSIT_AMOUNT',   desc: 'GP POS deposit amount' },
```
Add the live Helcim/Cal.com vars to OPTIONAL if not present: `HELCIM_API_TOKEN`, `HELCIM_DEVICE_CODE`, `HELCIM_WEBHOOK_SECRET` (Helcim webhook secret is NOT currently in the list — only `CALCOM_WEBHOOK_SECRET` at :50 is). `REDIS_ENCRYPTION_KEY` is also absent and should be added (prod-required per D-06).

---

### PII-01 — `server.js` targeted GET guard (middleware, request-response)

**Analog:** `routes/consignment.js:24-28` — the existing per-route `x-api-key` check.
```javascript
router.get('/api/admin/consignment-report', function (req, res) {
  var apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (apiKey !== process.env.MW_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
```

**The global GET-bypass that must STAY** (`server.js:253-273`) — D-07: do NOT invert this:
```javascript
app.use('/api', function (req, res, next) {
  if (req.method === 'GET') return next();           // line 254 — stays for all other GETs
  if (req.path === '/checkout') return next();
  if (req.path === '/promo/validate') return next();
  if (req.path.indexOf('/webhooks/') === 0) return next();
  if (!API_SECRET_KEY) { return res.status(503).json({ /* ... */ }); }
  if (req.headers['x-api-key'] === API_SECRET_KEY) return next();
  // ... log.warn ...
  res.status(403).json({ error: 'Forbidden' });
});
```

**Recommended implementation:** a small dedicated middleware mounted on exactly the 4 PII paths, BEFORE the route modules and AFTER `requireAllowedReferer` (CONTEXT integration point). The 4 routes live in:
- `GET /api/contacts` → `routes/items.js:49`
- `GET /api/invoices` → `routes/items.js:66`
- `GET /api/items/inspect` → `routes/taxes.js:539`
- `GET /api/snapshot` → `routes/catalog.js:819`

Use the same key comparison the global guard uses (`API_SECRET_KEY = process.env.API_SECRET_KEY || process.env.MW_API_KEY`, `server.js:240`). Status: 401/403 (criterion). Mount example (pattern to follow — `server.js:383-388` shows existing path-scoped `app.use` mounts):
```javascript
var PII_GET_ROUTES = ['/api/contacts', '/api/invoices', '/api/items/inspect', '/api/snapshot'];
function requirePiiApiKey(req, res, next) {
  if (req.headers['x-api-key'] === API_SECRET_KEY && API_SECRET_KEY) return next();
  return res.status(403).json({ error: 'Forbidden' });
}
PII_GET_ROUTES.forEach(function (p) { app.get(p, requirePiiApiKey); });
```
Mount AFTER `app.use('/api', requireAllowedReferer)` (`server.js:384`) and BEFORE the route module registrations (`server.js:404-416`). Note `GET /api/contacts/search` (`routes/pos.js:1787`) is a DIFFERENT path and is NOT in scope — the exact-match list avoids catching it.

> Existing route order in server.js: `items` mounts at :404, `taxes` at :407, `catalog` (`catalogRouter`) at :400/registered, `consignment` at :411. The targeted guard must be registered before any of these so it runs first.

---

### PII-02 — body-shape whitelist (route + lib/validator, CRUD)

**Best analog (the model to copy):** `routes/catalog.js:988-999` (`upload-catalog`) — already does exactly the right thing (validate shape, reject 400 before any side effect):
```javascript
router.post('/api/admin/upload-catalog', function (req, res) {
  var products    = req.body.products    || [];
  var ingredients = req.body.ingredients || [];
  var services    = req.body.services    || [];
  if (!Array.isArray(products) || !Array.isArray(ingredients) || !Array.isArray(services)) {
    return res.status(400).json({ ok: false, error: 'Invalid payload: expected arrays for products, ingredients, services' });
  }
  if (products.length === 0 && ingredients.length === 0 && services.length === 0) {
    return res.status(400).json({ ok: false, error: 'Refusing empty catalog upload' });
  }
  // ... only THEN does cache.set fire ...
```
> upload-catalog already satisfies its part of PII-02 substantially — planner may only need a light touch (e.g. strip unknown top-level keys before caching, or confirm it counts as already-validated). The criterion lists `upload-catalog` so include it in the plan, but the lift is small.

**The raw-forward bugs to fix:**

`POST /api/items` (`items.js:32-43`) — forwards raw `req.body`:
```javascript
router.post('/api/items', function (req, res) {
  zohoPost('/items', req.body)                       // <-- raw body to Zoho
    .then(function (data) { res.status(201).json(data); })
    .catch(function (err) { /* ... */ });
});
```

`PUT /api/inventory/items/:id` (`items.js:92-99`) — forwards raw `req.body`:
```javascript
router.put('/api/inventory/items/:id', function (req, res) {
  inventoryPut('/items/' + req.params.id, req.body)  // <-- raw body to Zoho
    .then(function (data) { res.json(data); })
    .catch(function (err) { /* ... */ });
});
```
> CONTEXT says "PUT /api/items"; the actual route is `PUT /api/inventory/items/:id` (there is no bare `PUT /api/items`). Planner: use the real path.

`POST /api/taxes/apply` (`taxes.js:314-315`) — only reads one body field, `apply`:
```javascript
router.post('/api/taxes/apply', function (req, res) {
  var dryRun = !(req.body && req.body.apply === true);
```
> taxes/apply does NOT forward `req.body` to Zoho — it ignores everything except `body.apply` (boolean). Whitelist is trivial here: only `{ apply?: boolean }` is meaningful. The "validate body shape" requirement for this route is satisfied by rejecting non-object bodies / coercing `apply` strictly. Low risk; mostly a defensive-completeness item.

**Allowed-field schema derivation (for the new/extended helper).** Zoho item create/update payloads (from admin.js usage and Zoho Books item API). Planner should derive the exact whitelist from the admin frontend's create/update forms, but the standard Zoho Books item fields are:
- `name` (required, string), `sku` (string), `rate` (number), `purchase_rate` (number), `description` (string), `unit` (string), `product_type` (string: `goods`/`service`), `item_type` (string), `category_name`/`category_id` (string), `sales_tax_rule_id` / `tax_id` (string), `cf_*` custom fields, `status` (string).
- `name` is the only Zoho-required field for create. For PUT, the `:id` is in the path; body may be a partial update.

**Helper API to build (extend `lib/validate.js` — see CRITICAL NOTE).** Follow the existing `validateLineItems` signature convention: return an error string (or null) rather than throwing, so routes do `var err = validate.validateBody(...); if (err) return res.status(400).json({error: err});`. Existing convention (`validate.js:17`, `:51`):
```javascript
function validateLineItems(items, options) {
  // ...
  if (!Array.isArray(items) || items.length === 0) return 'line_items must be a non-empty array';
  // ...
  return null;   // null === valid
}
```
A `validateBody(body, { allowed: [...], required: [...], types: {...} })` returning `{ error, clean }` (or error-string + mutated whitelisted object) fits this idiom. Strip unknown keys (D-08: "no field smuggling"). Status: 400 (criterion).

---

## Test Patterns (the Phase 31 safety net these changes land on)

**Supertest real-app harness** (`__tests__/checkout-route.test.js:1-93`) — the model for any new route-level fail-closed test. Key setup facts:
- External services mocked (`helcim`, `zoho-api`, `cache`, `mailer`, `axios`), but `express` and `https` are NOT mocked.
- `cache.isConnected` mocked `false` and `cache.getClient` → `null` simulate **Redis-down** (`checkout-route.test.js:59-62`) — directly reusable for the HARDEN-03 409-when-Redis-down assertion.
- `process.env.API_SECRET_KEY = 'test-key'` set BEFORE `require('../server')` (`:79`); `app = require('../server')` (`:82`); `RECAPTCHA_SECRET_KEY` cleared AFTER require so reCAPTCHA fails open (`:88`). For HARDEN-01 prod tests, set `NODE_ENV='production'` and provide/omit the secret per case.

**The Phase 31 `test.todo` markers that become real assertions** (these are the explicit handoff):
- `checkout-route.test.js:327` — `test.todo('HARDEN-01: unauthenticated checkout (no x-api-key) currently passes — Phase 32 closes')`
- `checkout-route.test.js:328` — `test.todo('HARDEN-03: duplicate charge_key not rejected 409 when Redis down — Phase 32 fixes')`
- `checkout-route.test.js:334` — `test.todo('TEST-01 follow-up: payment_token/chargeAndProceed() ... uncovered — add coverage in Phase 32')`
- `helcim-webhook.test.js:101` — `test.todo('HARDEN-02: missing HELCIM_WEBHOOK_SECRET should fail closed (return false)')`
- `helcim-webhook.test.js:260` — `test.todo('HARDEN-02: missing HELCIM_WEBHOOK_SECRET currently accepts all webhooks — Phase 32 closes')`

**Current characterization tests that PIN the OLD fail-open behavior** — these will need updating (CLAUDE.md rule 10 caveat: this phase is explicitly changing behavior, so these specific assertions are expected to flip; do it deliberately):
- `helcim-webhook.test.js:87-99` — `'missing HELCIM_WEBHOOK_SECRET -> returns true (current fail-open behavior)'`. In Phase 32 this stays true for dev (NODE_ENV unset) but a NEW prod-case test asserts `false`. Pattern for reloading the module with env mutated: `jest.resetModules(); jest.unmock('../lib/helcim'); delete process.env.HELCIM_WEBHOOK_SECRET; helcim = require('../lib/helcim');` (`:88-93`).

**`NODE_ENV` toggling in tests** — copy `logger.test.js:8,69,76`:
```javascript
beforeEach(() => { delete process.env.NODE_ENV; });
// inside prod describe:
process.env.NODE_ENV = 'production';
afterEach(() => { delete process.env.NODE_ENV; });
```

**Webhook HMAC sign helper** for valid/tampered cases — `helcim-webhook.test.js` (build payload `webhookId + '.' + timestamp + '.' + rawBody`, HMAC-SHA256 base64) and `calcom-webhook.test.js` (HMAC-SHA256 hex over rawBody). Reuse those existing sign helpers for any new assertions.

**Coverage floors (jest.config.js:15-21) must not regress:**
```javascript
coverageThreshold: {
  './routes/checkout.js':  { lines: 52 },
  './routes/payments.js':  { lines: 36 },
  './routes/webhooks.js':  { lines: 62 },
  './lib/helcim.js':       { lines: 25 },
}
```
Hardening + new tests should raise, not lower, these. `lib/validate.js` already has `__tests__/validate.test.js` — extend it (append) when extending the helper; do not rewrite existing cases.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | — | — | Every change in this phase has a strong in-codebase analog. The only genuinely new concept is the `RAILWAY_ENVIRONMENT` boot reference (no prior usage), and the body-shape helper is an extension of an existing file. |

---

## Metadata

**Analog search scope:** `zoho-middleware/lib/`, `zoho-middleware/routes/`, `zoho-middleware/server.js`, `zoho-middleware/__tests__/`, `zoho-middleware/jest.config.js`
**Files scanned (read or grepped):** checkout-helpers.js, validateEnv.js, helcim.js, calcom.js, webhooks.js, checkout.js, server.js, consignment.js, items.js, taxes.js, catalog.js, validate.js, logger.js, checkout-route.test.js, helcim-webhook.test.js, calcom-webhook.test.js, validate.test.js, logger.test.js, jest.config.js
**Pattern extraction date:** 2026-06-17
