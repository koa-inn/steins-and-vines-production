---
phase: 45-security-and-money-path-hardening-audit-critical-and-high
reviewed: 2026-06-30T00:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - zoho-middleware/routes/pos.js
  - zoho-middleware/routes/checkout.js
  - zoho-middleware/routes/webhooks.js
  - zoho-middleware/lib/money-path.js
  - zoho-middleware/lib/reconcile.js
  - zoho-middleware/lib/cache.js
  - zoho-middleware/lib/constants.js
  - zoho-middleware/server.js
  - scripts/check-artifact-drift.sh
  - .github/workflows/tests.yml
findings:
  critical: 2
  warning: 9
  info: 2
  total: 13
status: issues_found
---

# Phase 45: Code Review Report

**Reviewed:** 2026-06-30
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

This is a security + money-path hardening phase for the kiosk/online checkout payment system (Helcim terminal + Zoho Books). I traced the five flagged tradeoffs end-to-end (including the kiosk frontend caller and the middleware test suite, both outside the review file set but load-bearing for correctness).

Verdict on the flagged items:

1. **Redis fail-closed / loopback bypass (45-03)** — acceptable *only* if Railway's load balancer always appends the real client IP to `X-Forwarded-For`. With `trust proxy:1`, that assumption is plausible but unverified, and the failure mode (Redis outage + non-appending proxy = unthrottled PIN brute-force) is high-impact. See WR-01.
2. **pos.js idempotency required-in-prod (45-06)** — the prod fail-closed guard *is* enforced and the Helcim key *is* deterministic. **However**, the production-only requirement on `/api/kiosk/sale/confirm` is not satisfied by the only client (the kiosk frontend never sends `idempotency_key` on confirm), so every production kiosk card sale 400s *after the card is charged but before the void path*. This is a money-taken-but-unrecorded-and-unvoided orphan on the happy path. **CR-01 — BLOCKER.**
3. **Gift-card split-tender fail-open (45-07)** — re-opens the underpayment hole. The balance check treats "cert not found", "Apps Script unconfigured", and "lookup unreachable" identically (all → `null` → use client amount). A made-up `GC-NNNNNN` number passes validation and undercharges the terminal even when Apps Script is fully healthy. **CR-02 — BLOCKER.**
4. **Reconciliation backstop (45-08)** — real false-positive-void and race exposure (120s in-flight window, concurrent webhook+sweep double-void, fragile settled-detection). See WR-02.
5. **money-path extraction (45-05)** — behaviour-preserving; faithful extraction of the checkout primitives. pos.js correctly re-throws payment-recording failures so the outer void fires (confirmed at pos.js:1064-1070 → 1118-1158). No defect found in the extraction itself.

Note on test coverage: the production fail-closed branches are gated on `NODE_ENV==='production'`, but the Jest suite runs non-prod by default. The few tests that *do* set `NODE_ENV='production'` (pos-money.test.js T6) assert the 400 as *correct* rather than catching the broken client contract — a textbook "green tests ≠ correct behaviour" gap that masks CR-01.

## Narrative Findings (AI reviewer)

### Critical Issues

#### CR-01: Production kiosk confirm 400s after the card is charged → orphan charge (money taken, unrecorded, unvoided)

**File:** `zoho-middleware/routes/pos.js:670-672` (interaction with `js/kiosk.js:3624-3635`)

**Issue:**
`/api/kiosk/sale/confirm` now requires `idempotency_key` in production:

```js
if (!confirmIdemKey && process.env.NODE_ENV === 'production') {
  return res.status(400).json({ error: 'idempotency_key is required' });
}
```

But the only caller — the kiosk frontend `confirmSale()` — sends `reference_number` and `transaction_id` and **no `idempotency_key`** on the confirm request (`js/kiosk.js:3627-3635`). The sale step (`/api/kiosk/sale`) *does* send it (`js/kiosk.js:3522/3529`), so the terminal charge happens; then `confirmSale(txnId)` is called and 400s in production.

The 400 fires at the top-of-handler guard, *before* `runConfirm` and therefore before any void-on-failure logic (the void path at pos.js:1124-1158 only runs inside `runConfirm`'s catch when `body.transaction_id` is set). Net production result for **every standard card sale**: customer charged on the terminal, no Zoho invoice created, no inventory decrement, and **no void** — exactly the money-taken-but-unrecorded class this phase set out to eliminate.

This is invisible to CI: the branch only activates when `NODE_ENV==='production'`, and the one prod test (`__tests__/pos-money.test.js:T6`) asserts the 400 is returned — codifying the bug instead of catching the broken contract. Live terminal-sale UAT is recorded as still pending (commit 11cf95c), consistent with this never having been exercised in prod.

**Fix:** Make the confirm endpoint idempotent without depending on a field the client doesn't send, and never 400 after a charge without voiding. Either (preferred) derive the confirm idempotency seed from the already-unique `transaction_id` (or `reference_number`) when `idempotency_key` is absent:

```js
var idemSeed = (typeof body.idempotency_key === 'string' && body.idempotency_key)
  || (typeof body.transaction_id === 'string' && body.transaction_id)
  || null;
var confirmIdemKey = idemSeed
  ? C.CACHE_KEYS.KIOSK_IDEM_PREFIX + 'confirm:' + idemSeed.slice(0, 128)
  : null;
// In prod, if still null AND a charge exists, fall through to runConfirm so the
// void-on-failure path can fire — do NOT bare-400 after a terminal charge.
```

…and add `idempotency_key: refNumber` to the frontend confirm body (`js/kiosk.js:3627-3635`) to restore the deterministic replay guarantee. A regression test should set `NODE_ENV='production'`, POST a confirm with the *exact* body shape the frontend sends (no `idempotency_key`, with `transaction_id`), and assert an invoice is created (or the charge is voided) — never a bare 400.

---

#### CR-02: Gift-card balance validation fails OPEN on not-found / unconfigured / unreachable → terminal underpayment

**File:** `zoho-middleware/routes/pos.js:489-512` (sale) and `zoho-middleware/routes/pos.js:877-897` (confirm)

**Issue:**
The 45-07 balance guard is meant to clamp the applied gift-card amount to the real server-side balance before charging the terminal. But the lookup collapses every non-success outcome to `null`:

```js
.then(function (resp) {
  var r = (resp && resp.data) || {};
  return (r.ok && r.data && typeof r.data.balance === 'number') ? r.data.balance : null;
})
.catch(function (lookupErr) { return null; }); // fail open
```

…and the consumer only clamps when the balance is non-null:

```js
if (realBalance !== null && gift_amount > realBalance) { gift_amount = Math.min(realBalance, grandTotal); }
```

So the validation is bypassed (client-submitted amount used) when **any** of these hold:
- Apps Script is unreachable / times out (the documented fail-open), **or**
- `APPS_SCRIPT_URL` / `APPS_SCRIPT_SERVER_TOKEN` is not configured (the whole lookup is skipped — `gcRealBalanceLookup` stays `Promise.resolve(null)`), **or**
- the cert does not exist or has insufficient funds — Apps Script returns `ok:false`, which maps to `null` exactly like an outage.

The third case is the dangerous one: an attacker/operator submits a syntactically valid but bogus `GC-NNNNNN` with `amount_applied = grandTotal`. The lookup returns `ok:false` → `null` → no clamp → `terminal_amount = grandTotal - gift_amount` is undercharged (or the terminal is skipped entirely when gift covers 100%, pos.js:564-583). The downstream `redeem_gift_card` in the confirm last-step will fail and set `giftCardActivationFailed=true`, but that is *detection after the money was already not collected* — the terminal undercharge already happened at sale time.

**Fix:** Distinguish "definitively invalid / insufficient" from "lookup unavailable", and fail **closed** for the former (and, for a money path, ideally the latter too in production):

```js
// Return a discriminated result, not a bare number-or-null.
// { state: 'ok', balance } | { state: 'invalid' } | { state: 'unavailable' }
if (lookup.state === 'invalid') return reject 400 'Gift card not found or has insufficient balance';
if (lookup.state === 'unavailable' && isProd) return reject 503 'Gift card validation temporarily unavailable';
if (lookup.state === 'ok' && gift_amount > lookup.balance) gift_amount = Math.min(lookup.balance, grandTotal);
```

At minimum, treat an `ok:false` response (cert not found / insufficient) as a hard reject rather than fail-open, since that is the primary attack input and is unambiguously available even when Apps Script is healthy.

---

### Warnings

#### WR-01: Rate-limit loopback bypass rests on an unverified proxy assumption; Redis outage + spoofable `req.ip` defeats PIN/payment throttling

**File:** `zoho-middleware/server.js:312-330` (and 356-377)

**Issue:** During a Redis outage the security limiters (`pin`, `payment`, `api`) fall back to the in-process `memStore`, but loopback keys short-circuit to `{ totalHits: 1 }` (never accumulate). The safety of this depends entirely on Railway's LB always appending the real client IP to `X-Forwarded-For` so `req.ip` is never loopback. With `app.set('trust proxy', 1)`, `req.ip` is the right-most-but-one XFF entry; if the upstream ever forwards a client-supplied `X-Forwarded-For: ::1` without appending, `req.ip` becomes attacker-controlled loopback and PIN brute-force (`/api/kiosk/verify-pin`, 5/min) and payment spam become unthrottled for the duration of a Redis outage. The combination is low-likelihood but high-impact (auth/money path), and the mitigation is cheap.

**Fix:** Only honour the loopback skip outside production (`if ((!key || LOOPBACK_RE.test(key)) && process.env.NODE_ENV !== 'production')`), or drop the loopback short-circuit entirely for the `pin`/`payment` limiters so the in-process counter always accrues.

#### WR-02: Reconciliation backstop can false-positive-void legitimate in-flight charges, and webhook/sweep races cause double-void + spurious alerts

**File:** `zoho-middleware/lib/reconcile.js:96-105, 128-224, 244-341`; `zoho-middleware/routes/webhooks.js:216-220`; `zoho-middleware/server.js:577-582`

**Issue:** Three related exposures:
- **In-flight window:** the only guard against voiding a valid-but-not-yet-confirmed charge is `MIN_ORPHAN_AGE_SECONDS = 120`. The kiosk confirm step is human-in-the-loop (staff taps "confirm" after card approval). If the gap between `/api/kiosk/sale` and a successful `/confirm` exceeds 120s (slow staff, batch-review screen, network), an APPROVED charge with a still-present pending record and no settled signal is auto-voided — *then* `/confirm` records the Zoho payment, leaving an invoice marked paid against a reversed terminal charge.
- **Settled-detection fragility:** `hasMatchingZohoOrder` checks `KIOSK_IDEM_PREFIX + 'confirm:' + ctx.idempotency_key`, which only matches if the sale and confirm calls share the same `idempotency_key`. The frontend sends `idempotency_key` on sale but **not** on confirm (see CR-01), so the confirm idem key is never written under that value — this secondary signal is effectively always false. The *only* reliable settled signal is the pending-record deletion at pos.js:1104-1108, which itself requires `body.reference_number` to be echoed on confirm and to match the sale's `refNumber`. Once CR-01 is fixed, ensure both signals actually line up.
- **Race / double-void:** `reconcilePendingCharge` is not serialized. The webhook handler (webhooks.js:217) and the 5-minute sweep (server.js:577) can both resolve the same APPROVED txn, both see the pending record, both call `voidTransaction`. The second void fails (already voided) → persists an `sv:void-failure` record and emails a staff alert — false-positive manual-review noise.

**Fix:** (a) Raise the in-flight guard or, better, only auto-void when an authoritative Zoho lookup confirms no invoice/payment exists for the reference (don't infer from cache TTLs); (b) take a short Redis lock keyed on the transactionId/invoiceNumber at the top of `reconcilePendingCharge` so webhook and sweep cannot both void; (c) treat "void returns already-voided" as success, not a failure alert.

#### WR-03: Idempotency lock is never released on failure → legitimate retries blocked for the full TTL

**File:** `zoho-middleware/lib/money-path.js:52-76` (used by pos.js:251/676 and checkout.js:149)

**Issue:** `acquireIdempotencyLock` calls `cacheLib.acquireLock(key, ttl)` but no path releases the lock on a *failed* attempt that wrote no cached response (e.g. terminal error at pos.js:560-563, or a thrown Zoho error). A retry with the same `idempotency_key` then finds no cached body and a still-held lock → `contention` → 409 for up to the full TTL (5 min kiosk, 10 min checkout). Because the kiosk frontend reuses `refNumber` as the key for a given attempt, a transient terminal/Zoho blip locks the operator out of retrying that sale for minutes.

**Fix:** On a terminal/processing failure that did not record a charge, explicitly `cache.releaseLock(key)` (or delete the lock) before returning the error, so a deliberate retry can re-acquire. Keep the lock only when a charge may have succeeded.

#### WR-04: Legacy `/api/pos/sale` treats Zoho failure as non-fatal with no void and no pending-charge record

**File:** `zoho-middleware/routes/pos.js:1269-1309` (and 1238)

**Issue:** This route charges the terminal, then records the Zoho invoice/payment as best-effort: the `.catch` at 1303-1309 logs "non-fatal" and returns 200/ok with the charge already approved. There is no void and — unlike `/api/kiosk/sale` and `salesorder-pay` — no `KIOSK_PENDING_CHARGE` record written, so the new 45-08 reconciliation backstop cannot catch it either. Result: money collected in Helcim with no Zoho record and no automated recovery path.

**Fix:** If this route is still live, write a pending-charge sentinel before the Zoho calls (so the sweep can reconcile) or route it through the hardened `/api/kiosk/sale` flow. If it is deprecated, remove the route and its `paymentLimiter` mount (server.js:432).

#### WR-05: Hardcoded Zoho gift-card clearing account fallback in the money path

**File:** `zoho-middleware/routes/pos.js:933`

**Issue:** `account_id: process.env.ZOHO_GIFT_CARD_CLEARING_ACCOUNT_ID || '109900000000873231'`. A hardcoded financial account ID as a silent fallback means that if the env var is unset (or the app is pointed at a different Zoho org / sandbox), gift-card redemptions post to an arbitrary/incorrect ledger account with no error.

**Fix:** Fail closed when the clearing account is unconfigured (return 503 / skip the gift payment with a flagged manual-review record) rather than defaulting to a literal account ID.

#### WR-06: Promo `FIRSTBATCH` fails open on Redis errors → repeatable $20 discount during an outage

**File:** `zoho-middleware/routes/checkout.js:366-387`

**Issue:** Both the lock acquisition (line 367-372) and the redemption check (line 383-387) fail open — on any Redis error the code sets `lockAcquired = true` / `promoDiscount = 20`. During a Redis outage the same email can redeem the discount repeatedly, and the burn-write (line 572-576) also fails, so nothing records the redemption.

**Fix:** For a financial discount, fail closed (deny the promo) when the redemption store is unavailable, or gate the fail-open to non-production.

#### WR-07: Webhook API-unavailable fallback assumes APPROVED → phantom revenue risk

**File:** `zoho-middleware/routes/webhooks.js:106-114`

**Issue:** When `getCardTransactionById` fails, the handler correlates via the device-pending invoice and calls `processCardTransactionResult(transactionId, 'APPROVED', ...)` unconditionally, on the stated assumption that "Helcim creates a card-transaction record only on an approved auth." If that assumption is ever wrong (declined/voided event reaching the fallback), the terminal-result cache is populated as APPROVED, the kiosk poll resolves, and `/confirm` creates a paid Zoho invoice for a payment that was not actually captured.

**Fix:** Do not synthesize APPROVED from an API failure for the money path — cache a `status: 'UNCONFIRMED'` result that the poll treats as still-pending, and let the reconcile/API-retry path establish the real status.

#### WR-08: CI installs with `npm install` (not `npm ci`) → non-reproducible tests/audit and possible drift-check divergence

**File:** `.github/workflows/tests.yml:16, 34, 62`

**Issue:** The test/lint/audit jobs use `npm install`, which can mutate the lockfile and resolve different transitive versions than the committed `package-lock.json`. The `artifact-drift` job's own script uses `npm ci` for reproducibility (check-artifact-drift.sh:61), so the bundles are built against the locked tree while tests run against a potentially different tree — undermining both the reproducibility guarantee and `npm audit --audit-level=high` determinism.

**Fix:** Use `npm ci` in `test-middleware`, `test-frontend`, and `test-e2e`.

#### WR-09: Rate-limit store fails open (`totalHits: 0`) on null client / mid-op error while `connected` is still true

**File:** `zoho-middleware/server.js:334-335, 351-353`

**Issue:** The Redis path of `makeRedisStore.increment` returns `{ totalHits: 0 }` when `getClient()` resolves null or the INCR/EXPIRE rejects. `totalHits: 0` means the limiter never trips. The in-process `memStore` fallback only engages when `!cache.isConnected()`; there is a window where `connected` is stale-true but operations fail, during which the security-critical limiters (`pin`, `payment`, `api`) fail open.

**Fix:** On a mid-op Redis error in `increment`, fall back to the same `memStore` accounting used in the `!isConnected()` branch (return an incrementing count), rather than `totalHits: 0`.

### Info

#### IN-01: Reconcile comment misstates confirm-idem TTL; secondary settled-signal far shorter than pending TTL

**File:** `zoho-middleware/lib/reconcile.js:30` (vs `zoho-middleware/routes/pos.js:24`)

**Issue:** The comment says the confirm idem key has "TTL 10 min", but pos.js sets `IDEMPOTENCY_KEY_TTL = 300` (5 min). Meanwhile the pending-charge record lives 7 days (`KIOSK_PENDING_CHARGE_TTL = 604800`). So `hasMatchingZohoOrder`'s confirm-idem signal expires long before the pending record, leaving the deletion-based signal as the only durable one. Align the comment and consider whether the settled signal should persist as long as the pending record it guards.

#### IN-02: Idempotent replay returns 201 though the original sale response was 202

**File:** `zoho-middleware/routes/pos.js:253-256` (and 678-681)

**Issue:** The sale handler caches a 202 body but the replay branch returns it with `res.status(201)`. Minor status inconsistency that could confuse clients keying behaviour on the 202/201 distinction. Return the originally-cached status code, or document the normalization.

---

_Reviewed: 2026-06-30_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
