# Phase 45: Security and Money-Path Hardening - Pattern Map

**Mapped:** 2026-06-29
**Files analyzed:** 14 (4 new, 10 modified)
**Analogs found:** 12 / 14 (2 partial — kiosk device-cred + admin OAuth are net-new mechanisms with strong partial analogs)

> This is a backend-first hardening phase. The single most important fact for the
> planner: **`routes/checkout.js` is the gold standard and `routes/pos.js` is a
> divergent re-implementation of the same money flow without the guards.** Nearly
> every money task is "copy a primitive that already exists in `checkout.js` into a
> shared `lib/` helper, then make `pos.js` call it." The excerpts below are the
> exact primitives to extract and mirror.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `zoho-middleware/lib/money-path.js` **(new)** | service/utility (shared lib) | request-response + transform | `routes/checkout.js` (extract FROM) + `lib/checkout-helpers.js` (extraction shape) | exact (source) |
| `zoho-middleware/lib/reconcile.js` **(new, separable — D-13)** | service | event-driven + batch | `routes/collect.js` + `routes/webhooks.js` `handleCardTransaction` + `lib/helcim.js` `getCardTransactionById` | role+flow match |
| kiosk device-credential module **(new — D-01/D-03)** | middleware/utility | request-response | `lib/apiKey.js` (constant-time guard) + `lib/zohoAuth.js` (token lifecycle) | partial (net-new mechanism) |
| admin OAuth guard middleware **(new — D-02)** | middleware | request-response | `routes/auth.js` (OAuth flow) + `js/lib/auth.js` (Google GIS) + `lib/apiKey.js` (guard registration) | partial (net-new mechanism) |
| `.github/workflows/*.yml` artifact-drift **(new/modified — D-10)** | config (CI) | batch | existing `.github/workflows/tests.yml` | role match |
| `zoho-middleware/routes/pos.js` | route/controller | CRUD + request-response | `routes/checkout.js` | exact (sibling money path) |
| `zoho-middleware/routes/checkout.js` | route/controller | request-response | self (refactor to consume new `lib/money-path.js`) | self |
| `zoho-middleware/server.js` | config/middleware | request-response | self (`makeRedisStore`/`redisUnavailableSkip` + `PII_GET_ROUTES`) | self |
| `zoho-middleware/lib/cache.js` | service (lib) | request-response | self (`acquireLock` fail-open at :106-115) | self |
| `zoho-middleware/lib/helcim.js` | service (lib) | request-response | self (`getCardTransactionById`, `voidTransaction`) | self |
| `zoho-middleware/routes/webhooks.js` | route/controller | event-driven | self (`handleCardTransaction`, collect-pending block) | self |
| `js/sheets-config.js` | config (frontend) | n/a | self (remove `MW_API_KEY:65`) | self |
| `.gitignore` + `dump.rdb` removal | config | n/a | n/a | n/a (trivial) |
| middleware `__tests__/*` (new money/auth tests) | test | n/a | existing `zoho-middleware/__tests__/` + `jest.setup.js` env isolation | role match |

---

## Pattern Assignments

### `zoho-middleware/lib/money-path.js` (new shared lib — D-11)

This is the structural heart of the phase. Extract these four primitives **verbatim
from `checkout.js`** into a lib consumed by both `checkout.js` and `pos.js`. The
existing `lib/checkout-helpers.js` is the template for *how* to shape a checkout
lib (pure functions + small wrappers, `module.exports = { ... }`, lazy `require`).

**Primitive 1 — Atomic idempotency lock (the canonical `acquireLock` gate).**
Source: `routes/checkout.js:158-185`. This is what `pos.js` sale/confirm lack
(they use non-atomic get-then-set at `pos.js:241-251` and `597-603`).
```javascript
// checkout.js:158-181 — the pattern pos.js must adopt
if (idempotencyKey) {
  var cached = await cache.get(idempotencyKey);
  if (cached) {
    return res.status(201).json(cached);          // idempotent replay
  }
  // H1: Atomic lock prevents TOCTOU race on concurrent duplicate requests
  var lockAcquired = await cache.acquireLock(idempotencyKey, CHECKOUT_IDEMPOTENCY_TTL);
  if (!lockAcquired) {
    return res.status(409).json({ error: 'Checkout already in progress' });   // 409 on contention
  }
  // ... proceed ...
  // on Redis throw: fail CLOSED in prod (return 409), fail open only in dev
}
```
Note the **fail-closed-in-prod** policy on the Redis catch (`checkout.js:172-181`)
— mirror this exactly for the kiosk lock.

**Primitive 2 — Deterministic transaction-id replay guard.**
Source: `routes/checkout.js:248-270` (check) + `718-724` (mark used, 86400s TTL).
`pos.js` mints a fresh Helcim key per call (`helcim.js:204` default) and never
single-uses the transaction id. The new helper should take a `transactionId` and a
key suffix and expose `assertNotReplayed()` / `markUsed()`.
```javascript
// checkout.js:256-269 — replay guard, fail CLOSED on Redis error
var txnKey = 'helcim:txn:' + transactionId + txnKeySuffix;
var existing = await cache.get(txnKey);
if (existing) return res.status(409).json({ error: 'Payment already processed' });
// catch: Redis unavailable -> 409 (a charged txn must never create a duplicate order)
```

**Primitive 3 — `rejectWithVoid` (void-an-already-charged payment before a 4xx).**
Source: `routes/checkout.js:45-61`. This is the orphan-charge defense `pos.js`
validation paths skip. Extract verbatim; it already encapsulates token validation,
`eventLog`, and the `mailer.sendVoidFailureAlert` fallback.
```javascript
// checkout.js:45-61 — copy into lib/money-path.js, parametrise res/body/status
function rejectWithVoid(res, body, status, errorMsg) {
  var token = body && body.payment_token;
  if (typeof token === 'string' && token.length > 0 && token.length <= 500 && helcimLib.isEnabled()) {
    helcimLib.voidTransaction(token).catch(function (vErr) {
      mailer.sendVoidFailureAlert({ txnId: token, amount: 0,
        error: 'Early validation reject (' + status + ': ' + errorMsg + ') — void failed: ' + vErr.message,
        timestamp: new Date().toISOString() }).catch(function () {});
    });
  }
  return res.status(status).json({ error: errorMsg });
}
```

**Primitive 4 — Error-PROPAGATING payment recording + void-on-failure with timeout.**
Source: `routes/checkout.js:734-877` (the `catch` that voids) and the dual-cart
guard. The **key contrast** the planner must fix: `pos.js` confirm wraps its whole
payment chain in a `.catch` that only logs (`pos.js:952-954`) then falls through to
the 201 success block (`pos.js:957-985`), so the outer void (`pos.js:988-1025`)
never fires on a payment-recording failure. The helper must **re-throw** payment
failures so the outer void/`needs_manual_review` path runs. The correct
propagating shape already exists at `pos.js:1636-1685` (salesorder-pay) — that
`.catch` voids then 502s; use it as the in-`pos.js` reference. Also mirror the 8s
timeout-wrapped void: `checkout.js:825-873` via `helpers.withTimeout` (already in
`lib/checkout-helpers.js:34-39`).

---

### `zoho-middleware/routes/pos.js` (modified — D-09, D-12, D-15)

**Analog:** `routes/checkout.js` (sibling money path) + `lib/apiKey.js` (guards).

**Guard the 2 unguarded PII GETs (D-09).** Sibling guarded routes in the SAME file
show the drop-in pattern — copy it onto `:1303` (`/api/kiosk/salesorders`) and
`:2638` (`/api/kiosk/salesorder/:id`), both currently unguarded.
```javascript
// pos.js:1192-1194 (also :1263, :2273) — the exact guard to prepend
if (!apiKeyGuard.matches(req.headers['x-api-key'])) {
  return res.status(401).json({ error: 'Unauthorized' });
}
```
(`apiKeyGuard` is already imported at `pos.js:8`. Alternative per D-09 is adding the
two paths to `server.js:416 PII_GET_ROUTES` — note the `:id` path needs an Express
pattern, so the inline guard is the cleaner mirror here.)

**KIOSK_PIN length-check before `timingSafeEqual` (D-15).** Current `pos.js:578`
calls `timingSafeEqual(Buffer.from(pin), Buffer.from(process.env.KIOSK_PIN))` with
no length check on the env var → a misconfigured non-4-char `KIOSK_PIN` throws
`RangeError` → 500 on every login. Mirror the length-first pattern already proven in
`lib/apiKey.js:34` (`if (a.length !== b.length) return false;`):
```javascript
// pos.js:574-578 — add a length guard before timingSafeEqual
if (!process.env.KIOSK_PIN || process.env.KIOSK_PIN.length !== pin.length) {
  return res.status(503).json({ ok: false, error: 'PIN not configured' });
}
var match = crypto.timingSafeEqual(Buffer.from(pin), Buffer.from(process.env.KIOSK_PIN));
```

**Gift-card split-tender balance validation (D-12).** Today `gcApplied` is only
clamped to `grandTotal` (`pos.js:780-789`), never validated against the
certificate's real balance, and redeem failure only logs CRITICAL
(`pos.js:855-866`) without setting `needs_manual_review`. The success path
(`pos.js:957-985`) already shows the `needs_manual_review` mechanism used for
activation failure (`pos.js:974-977`) — extend the same flag-setting to redeem
failure, and add a server-side balance lookup+clamp before charging the reduced
`terminal_amount` (`pos.js:466`, `791`).
```javascript
// pos.js:974-977 — existing needs_manual_review mechanism to extend to redeem failure
if (giftCardActivationFailed) {
  result.gift_card_activation_failed = true;
  result.needs_manual_review = true;
}
```

**Make kiosk `sale`/`confirm` idempotency atomic + required (D-12).** Replace the
non-atomic get-then-set at `pos.js:241-251` (sale) and `597-603` (confirm) with
Primitive 1 above; make `idempotency_key` required (currently optional via the
`? ... : null` ternary at `pos.js:237-239`, `593-595`); derive the Helcim key
deterministically instead of `helcimLib.terminalPurchase(terminal_amount, refNumber)`
with no key (`pos.js:477`).

---

### `zoho-middleware/routes/checkout.js` (modified — D-11, refactor only)

**Analog:** self. After `lib/money-path.js` exists, replace the inline
`rejectWithVoid` (`:45-61`), the lock gate (`:158-185`), the replay guard
(`:248-270`/`:718-724`), and the void-on-failure block (`:825-873`) with calls into
the shared lib. **No behavior change** — the existing money-path Jest tests are the
guardrail (per CONTEXT D-11). Already exports helpers for testing at `:998-1002`,
so the lib-extraction convention is established.

---

### `zoho-middleware/server.js` (modified — D-06, D-08, D-09)

**Analog:** self. The fix is to **drop `skip: redisUnavailableSkip`** on the
security-critical limiters so express-rate-limit's default MemoryStore actually
applies per-process during a Redis outage (single Railway instance → per-process ==
all traffic). The infrastructure already exists and is correctly commented at
`server.js:346-351`; the bug is the `skip` short-circuits the store entirely.
```javascript
// server.js:375-384 — pinLimiter: remove `skip: redisUnavailableSkip` (D-07 always-on PIN throttle)
var pinLimiter = rateLimit({
  windowMs: 60 * 1000, max: 5,
  store: makeRedisStore(60 * 1000, 'pin'),
  skip: redisUnavailableSkip,   // <-- REMOVE so MemoryStore takes over on Redis outage
  ...
});
// Same treatment for paymentLimiter (:364-373). Fix the now-true fallback comment (D-08).
```
For D-09 (alternative path): `PII_GET_ROUTES` lives at `server.js:416-423` with the
`requirePiiApiKey` registration loop — the planner may add the two kiosk paths here
instead of inline in `pos.js`.

---

### `zoho-middleware/lib/cache.js` (modified — D-06 lock fallback)

**Analog:** self. `acquireLock` fails OPEN today (`cache.js:106-114`: returns
`true` when `!connected` and on error). The phase's D-06 keeps selling on a Redis
blip, but the planner should confirm the per-process in-memory lock fallback so a
double-tap during an outage is still serialized within the single instance.
```javascript
// cache.js:106-115 — current fail-open lock (the documented in-process flag must actually exist)
function acquireLock(key, ttlSeconds) {
  if (!connected) return Promise.resolve(true);   // <-- in-process guard must back this
  return getClient().then(function (c) {
    return c.set('lock:' + key, '1', { NX: true, EX: ttlSeconds });
  }).then(function (result) { return result !== null; })
    .catch(function () { return true; });
}
```

---

### `zoho-middleware/lib/reconcile.js` (new, separable — D-13)

**Analog:** `routes/collect.js` (pending-charge pattern) + `routes/webhooks.js`
`handleCardTransaction` (the late-webhook path) + `lib/helcim.js`
`getCardTransactionById`/`pollTerminalResult`.

**Mirror the pending-charge persist pattern from collect.js.** On terminal timeout,
`pos.js:1688-1690` currently logs "no txn to void" and 504s — that's the orphan
window. `collect.js:98-127` shows the correct mechanism: cache a *pending context*
keyed by reference, let the webhook reconcile it.
```javascript
// collect.js:99-127 — pending context cached for the webhook handler to settle
var pendingCacheKey = C.CACHE_KEYS.COLLECT_PENDING_PREFIX + soNumber;
var pendingContext = {
  salesorder_id: soId, salesorder_number: soNumber, customer_id: customerId,
  amount: balance, idempotency_key: idempotencyKey, created_at: new Date().toISOString()
};
cache.set(pendingCacheKey, pendingContext, PENDING_TTL) ...
```
**The webhook side already auto-voids/records the late approval** — `webhooks.js:84-209`
`handleCardTransaction` resolves the txn via `helcim.getCardTransactionById` then
the collect-pending block (`:166-208`) records the Zoho payment on APPROVED. The
backstop job should reuse this join: **key the Helcim↔Zoho match on
`reference_number` = Helcim transaction id** (per CONTEXT specifics), using
`helcimLib.getCardTransactionById(id)` (`helcim.js:304-325`, returns
`{ status, transactionId, invoiceNumber, amount }`) and flag/auto-void any charge
with no matching Zoho order.
```javascript
// helcim.js:304-320 — the lookup the reconciliation job keys on
function getCardTransactionById(id) {
  return axios.get(HELCIM_BASE_URL + '/card-transactions/' + encodeURIComponent(id), {
    headers: helcimHeaders(), timeout: 8000
  }).then(function (resp) {
    var txn = resp.data || {};
    return { status: (txn.status||'').toUpperCase(), transactionId: txn.transactionId||id,
             invoiceNumber: txn.invoiceNumber||'', cardType: txn.cardType||'', amount: txn.amount||0 };
  });
}
```
Persist orphan records with the existing void-failure key convention:
`cache.set('sv:void-failure:' + Date.now(), { ..., needs_manual_review: true }, 30d)`
(`pos.js:1007`, `1664`).

---

### Kiosk device-credential module (new — D-01/D-03) + admin OAuth guard (new — D-02)

**Partial analogs — these are net-new mechanisms.**

For the **constant-time credential guard** (kiosk device token), copy the
`lib/apiKey.js` shape exactly — lazy `getKey()`, length-check-then-`timingSafeEqual`,
header-only acceptance. It is the canonical guard and explicitly designed as the
single source of truth so call sites never drift (`apiKey.js:21-36`).

For **admin per-user Google OAuth (D-02)**, three existing pieces compose the model:
- **Frontend GIS token flow:** `js/lib/auth.js` — `waitForGoogleIdentity`,
  `gsiInitTokenClient`, `fetchGoogleUserInfo(token)` (`auth.js:25-60`). Admin.html
  already loads this for Sheets; extend it to gate privileged actions.
- **OAuth state/callback server flow:** `routes/auth.js:18-56` shows the
  state-in-cache → callback → exchange pattern (currently Zoho; the Google admin
  guard mirrors the structure: generate state, cache with TTL, validate on callback).
- **Server-side identity verification:** the durable fix per the audit is "verify
  Google ID token → staff-email allowlist." No existing server-side ID-token verifier
  exists — this is the net-new piece (planner: add a verifier + allowlist env, register
  it as middleware the same way `requirePiiApiKey` is registered at `server.js:418-423`).

**Key removal (D-03):** delete `MW_API_KEY` from `js/sheets-config.js:65` (the
leaked secret) and ensure public pages carry no admin key. Loaded by kiosk.html,
admin.html, index.html, products.html, contact.html, 404.html (per audit evidence).

---

### `.github/workflows/*.yml` artifact-drift check (new/modified — D-10)

**Analog:** existing `.github/workflows/tests.yml`. Add a CI step that runs
`npm run build` and fails on drift of tracked `.min.js`, **scoped to deterministic
minify output** (exclude `Date.now()` cache-buster stamps — the audit confirmed
current artifacts reproduce byte-for-byte, so this is drift-prevention). The build
command is `npm run build` (per CLAUDE.md); artifacts are `js/main.js`,
`js/main.min.js`, `js/kiosk.min.js`.

---

## Shared Patterns

### Fail-closed-in-prod / fail-open-in-dev (money + security)
**Source:** `routes/checkout.js:172-181`, `lib/checkout-helpers.js:47-88`
(`verifyRecaptcha`), `lib/helcim.js:370-377` (`verifyWebhookSignature`).
**Apply to:** every new Redis-dependent money guard (kiosk lock, replay guard) and
the admin OAuth verifier.
```javascript
var isProd = process.env.NODE_ENV === 'production';
// prod: reject/secure;  dev (NODE_ENV unset): allow through for local convenience
```

### Constant-time secret comparison, header-only, length-checked first
**Source:** `lib/apiKey.js:29-36`.
**Apply to:** kiosk device-credential guard, KIOSK_PIN check (`pos.js:578`).
```javascript
var a = Buffer.from(sent); var b = Buffer.from(key);
if (a.length !== b.length) return false;          // length is not secret; avoids RangeError
return crypto.timingSafeEqual(a, b);
```

### Void-on-failure + alert (orphan-charge defense)
**Source:** `routes/checkout.js:45-61` (`rejectWithVoid`), `:825-873` (timeout-wrapped
post-charge void), `pos.js:1636-1685` (salesorder-pay propagating void).
**Apply to:** all `pos.js` money handlers via `lib/money-path.js`. Pattern: void →
on void failure persist `sv:void-failure:<ts>` (30d) + `mailer.sendVoidFailureAlert`
+ set `needs_manual_review`.

### 200-before-async webhook processing
**Source:** `routes/webhooks.js:47` (respond 200, then process). 
**Apply to:** any reconciliation webhook entry the backstop adds.

### Zoho error masking (generic message to client, detail to logs)
**Source:** `routes/checkout.js:748-758` (M9).
**Apply to:** new handlers; note the audit's Low finding that `pos.js:1282` and the
salesorder GET error paths echo raw Zoho detail — keep new code on the masked pattern.

### Per-file Jest env isolation for money/auth tests
**Source:** `zoho-middleware/jest.setup.js` (CONTEXT code_context) + existing
`zoho-middleware/__tests__/`. New money/auth tests inherit a clean key env.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| Server-side Google **ID-token verifier** (part of admin OAuth, D-02) | middleware | request-response | No existing server-side Google ID-token verification — `routes/auth.js` is Zoho OAuth and `js/lib/auth.js` is frontend-only GIS. The verify-token-→-staff-allowlist step is net-new; planner should follow the audit recommendation + RESEARCH conventions (none for this phase). Guard *registration* still mirrors `server.js:418-423`. |
| Kiosk **device-provisioning** mechanism (D-01) | utility | request-response | No first-run device-token provisioning exists today. Mechanism (long-lived device token vs client cert vs first-run provisioning) is a planning decision per CONTEXT specifics; the *guard* half reuses `lib/apiKey.js`. |

---

## Metadata

**Analog search scope:** `zoho-middleware/routes/`, `zoho-middleware/lib/`,
`js/lib/`, `js/`, `.github/workflows/`
**Files scanned:** checkout.js, pos.js, collect.js, webhooks.js, auth.js, server.js,
lib/{apiKey,cache,helcim,redact,zohoAuth,checkout-helpers,constants}.js,
js/lib/auth.js, js/sheets-config.js
**Pattern extraction date:** 2026-06-29
