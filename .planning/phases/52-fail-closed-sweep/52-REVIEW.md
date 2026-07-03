---
phase: 52-fail-closed-sweep
reviewed: 2026-07-02T00:00:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - zoho-middleware/lib/redis-guard.js
  - zoho-middleware/lib/constants.js
  - zoho-middleware/routes/catalog.js
  - zoho-middleware/routes/checkout.js
  - zoho-middleware/routes/gift-cards.js
  - zoho-middleware/routes/items.js
  - zoho-middleware/routes/pos.js
  - zoho-middleware/routes/recipes.js
  - zoho-middleware/routes/taxes.js
  - zoho-middleware/server.js
  - zoho-middleware/.env.example
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 52: Code Review Report

**Reviewed:** 2026-07-02T00:00:00Z
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Reviewed the diff introduced since `f1ad157` for the fail-closed sweep (RESIL-01). The core fail-closed conversions are, in the main, done correctly:

- **`lib/redis-guard.js`** — the shared `closedOnRedisError` helper is sound; `alwaysClosed:true` callers can never fail open.
- **`routes/checkout.js` (M1 promo)** — the promo lock/redemption check now fails closed (no discount on Redis error) in every environment. No residual fail-open on this path.
- **`server.js` (M4/M5 rate limit)** — the connected-but-failed Redis path is routed through `closedOnRedisError` and falls through to the shared `countInProcess` accounting, never `{ totalHits: 0 }`; the loopback skip is correctly gated off in production so a spoofed `X-Forwarded-For: ::1` cannot defeat PIN/payment throttling. No residual fail-open in production.
- **`routes/pos.js` (M2 quarantine / M3 gift-card clearing account)** — `/api/pos/sale` returns 410 before any terminal call; the gift-card clearing-account pre-flight and the payment post are gated on the identical condition, so there is no path that posts to a guessed ledger account.
- **`routes/catalog.js`, `routes/recipes.js`, `routes/gift-cards.js` (M7/M8 auth gates)** — the newly-gated GET routes correctly resolve their own tier (the global GET exemption skips them), and the gift-card *balance* lookup is deliberately left uncached.

However, three residual gaps remain where the sweep's stated guarantees are not fully enforced, plus three lower-severity quality items. The most important: the SSRF hardening on `/api/items/migrate` (M6) validates only the *initial* URL — `axios` still follows redirects, so an allowlisted host that issues a 3xx can bounce the fetch to the private/metadata range the block was explicitly meant to prevent; and the item-ID validation added in M20 was applied to the two GET routes but not to the sibling `PUT /api/inventory/items/:id`, which builds the same Zoho path from an unvalidated `:id`.

## Warnings

### WR-01: SSRF allowlist/private-host block bypassable via HTTP redirect

**File:** `zoho-middleware/routes/taxes.js:709-717`
**Issue:** `validateCsvUrl` enforces the mandatory host allowlist, https-only, and the private/link-local/metadata block against the *initial* `csv_url` only. The fetch is `axios.get(csvUrl, { responseType: 'text', timeout: 30000 })` with no `maxRedirects` override, so axios follows up to its default 5 redirects. An allowlisted host that returns a 3xx (open redirects are common on CDNs) can bounce the request to `http://169.254.169.254/…` or any internal host — exactly the fail-open corner the M6 private-host block (which the comment says "Includes the cloud metadata IP") was added to close. The allowlist and private-host checks are never re-applied to the redirect target. (Preconditions: an authenticated legacy/session caller — POST is not GET-exempt — plus an allowlisted host that can be made to redirect.) Note the rest of the codebase deliberately sets `maxRedirects: 5` on its axios calls, so the migrate fetch inherits redirect-following by default.
**Fix:**
```js
var csvPromise = axios.get(csvUrl, {
  responseType: 'text',
  timeout: 30000,
  maxRedirects: 0            // fail closed on any redirect; do not follow to an
                             // unvalidated (possibly private/metadata) target
});
// Optionally: on a 3xx, treat as an error rather than surfacing Location.
```
If redirects must be supported, re-run `validateCsvUrl` against every hop (custom `beforeRedirect` / manual redirect loop), rather than trusting the first URL.

### WR-02: `PUT /api/inventory/items/:id` missing the M20 numeric-id guard

**File:** `zoho-middleware/routes/items.js:143-148`
**Issue:** M20 added `isValidId(req.params.id)` to `GET /api/inventory/items/:id` (line 126) and `GET /api/items/:item_id/image` (line 163), but the sibling `PUT /api/inventory/items/:id` uses the identical pattern — `inventoryPut('/items/' + req.params.id, result.clean)` — with **no** id validation. This is the same param-injection / path-manipulation surface the guard was introduced to close, left open on the one route that mutates data. `req.params.id` is URL-decoded after route matching, so an encoded path separator or query fragment can alter the Zoho path the PUT targets. (The route requires a legacy/session credential, which limits exposure, but the validation gap is a direct inconsistency with the stated M20 fix.)
**Fix:**
```js
router.put('/api/inventory/items/:id', function (req, res) {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid item ID' });
  }
  var result = validateBody(req.body, ITEM_UPDATE_SCHEMA);
  ...
```

### WR-03: Promo per-email lock provides no mutual exclusion; `lockAcquired` is dead

**File:** `zoho-middleware/routes/checkout.js:369-390`
**Issue:** `lockAcquired` is computed (`var lockAcquired = (lockResult.status === 'value') ? lockResult.value : false;`) but never read anywhere afterward, and `cache.acquireLock` is never paired with a `releaseLock`. The redemption re-check and $20 discount grant proceed whenever `lockResult.status !== 'failclosed'` — regardless of whether the lock was actually acquired. So the comment's promise ("prevent two simultaneous checkout requests burning the same code") is not enforced: two concurrent `FIRSTBATCH` checkouts for the same email both call `acquireLock` (one gets `true`, one gets `false`), both fall into the `else` branch, both read `promoKey` as not-yet-redeemed, and both are granted the discount. This is largely pre-existing behavior, but the M1 rewrite re-introduced the dead variable and preserved the ineffective guard while claiming otherwise. (Impact is a bounded revenue leak under a narrow same-email concurrency race.)
**Fix:** Either gate the redemption check/discount on the lock (`if (!lockAcquired) { /* skip — another request holds it */ }`) and release it after the redemption is recorded, or delete the lock entirely and rely on the redemption record + idempotency key. At minimum, do not leave `lockAcquired` computed-but-unused with a comment asserting protection that does not exist.

## Info

### IN-01: Void-failure alert reports `grandTotal`, not the amount actually charged

**File:** `zoho-middleware/routes/pos.js:1001`
**Issue:** The M3 pre-flight void passes `grandTotal` to `moneyPath.voidWithTimeout(...)`. `amount` is used only for the staff `sendVoidFailureAlert` email (`lib/money-path.js:224`) — the actual void is by `transaction_id`, so behavior is correct — but the terminal only charged `terminalApplied` (`grandTotal - gcApplied`). On a gift-card-account-unset void, the alert overstates the at-risk amount by `gcApplied`, which can mislead manual reconciliation. This mirrors the existing precedent at line 965, so it is consistent, not a regression.
**Fix:** Pass `terminalApplied` as the alert amount for the gift-card pre-flight void (and consider aligning line 965 in a follow-up).

### IN-02: `validateCsvUrl` returns `parsed` but the caller ignores it

**File:** `zoho-middleware/routes/taxes.js:709` / `routes/taxes.js:59`
**Issue:** `validateCsvUrl` returns `{ ok: true, parsed: parsed }`, but the migrate handler discards `urlCheck.parsed` and re-fetches the raw `csvUrl` string. The returned `parsed` value is dead. (Fetching the parsed/normalized URL would also be a small hardening step in conjunction with WR-01.)
**Fix:** Either drop the `parsed` field from the return, or fetch `urlCheck.parsed.toString()` so validation and fetch operate on the same normalized value.

### IN-03: `decrement`/`resetKey` loopback skip not gated to production (asymmetric with M5)

**File:** `zoho-middleware/server.js:447, 461`
**Issue:** M5 gated the `increment` disconnected-branch loopback skip behind `NODE_ENV !== 'production'`, but `decrement` (line 447) and `resetKey` (line 461) still test `!LOOPBACK_RE.test(key)` unconditionally in all environments. In production this means a loopback key can be incremented in `memStore` but never decremented/reset — an asymmetry that errs toward *more* restrictive throttling (safe direction), so this is a consistency nit rather than a fail-open.
**Fix:** For consistency, gate the loopback checks in `decrement`/`resetKey` the same way as `increment`, or add a comment noting the intentional asymmetry.

---

## Narrative Findings (AI reviewer)

All findings above are narrative findings from direct review of the diff. No `<structural_findings>` block was provided for this phase, so there is no structural substrate to reconcile.

---

_Reviewed: 2026-07-02T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
