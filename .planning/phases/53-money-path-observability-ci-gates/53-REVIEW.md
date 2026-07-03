---
phase: 53-money-path-observability-ci-gates
reviewed: 2026-07-03T00:00:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - zoho-middleware/lib/sentry-scrub.js
  - zoho-middleware/server.js
  - zoho-middleware/lib/money-path.js
  - zoho-middleware/routes/checkout.js
  - zoho-middleware/routes/pos.js
  - zoho-middleware/routes/webhooks.js
  - zoho-middleware/routes/auth.js
  - zoho-middleware/routes/recipes.js
  - zoho-middleware/lib/recipe-scaling.js
  - eslint.config.js
  - .github/workflows/tests.yml
findings:
  critical: 0
  warning: 3
  info: 2
  total: 6
status: issues_found_1_critical_resolved
---

# Phase 53: Code Review Report

**Reviewed:** 2026-07-03
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Phase 53 adds a global Sentry `beforeSend` PII scrub + error-class fingerprint
(`lib/sentry-scrub.js`, wired in `server.js`), sprays `Sentry.captureException`
into money-movement catch blocks tagged with `reqId`/`txnId`/invoice ids, and
performs a lint cleanup (dead-var removal, bindingless `catch`, one `eqeqeq`
suppression) plus CI gate tightening (`npm ci`, `--max-warnings 0`, frontend
`ecmaVersion: 5`).

The "behavior-neutral" lint cleanup checks out — I traced every removed
identifier:
- `pos.js` `catalogMap` param drop from `processSaleWithPrices` is safe: that
  function spans lines 462–740 and never references `catalogMap`; all uses live
  in `runConfirm` (741+) which declares its own local `catalogMap`.
- `webhooks.js` `mailer`, `auth.js` `crypto`/`axios`, `recipes.js`
  `callAppsScriptGet`/`INGREDIENTS_FILE_CACHE` are all genuinely unreferenced
  after removal (`axios`/`path` still used by `callAppsScriptPost` and
  `INGREDIENTS_ALL_FILE_CACHE`).
- `recipe-scaling.js` `isContinuous` removal is dead-store elimination; the
  `if (!unitLower || !isDiscrete) { isDiscrete = false; }` block was already a
  no-op and remains one.
- Bindingless `catch` conversions (`catch (e)` → `catch`) all discard the error
  in bodies that never used it (`JSON.parse` fallbacks, dual-cart guard).

The correctness/behavior risk from the cleanup is therefore low. The material
concerns are in the **scrub coverage** itself: the control the phase introduces
to keep emails and raw amounts out of Sentry has no coverage over the single
most likely carriers — exception messages and console breadcrumbs — and the new
`captureException(err)` calls feed exactly those paths.

## Critical Issues

### CR-01: Sentry scrub does not cover exception messages or breadcrumbs — raw payment amounts and customer emails leak past the control

> **RESOLVED (commit 21656e2):** `scrubEvent` now applies a new `scrubString()`
> (email-mask + currency-redact) to `event.exception.values[].value` and to
> `event.breadcrumbs[].message`/`.data`. Regression tests added first (RED),
> now green — full middleware suite 1247 passing, lint gate clean.

**File:** `zoho-middleware/lib/sentry-scrub.js:58-83` (scrub coverage), `zoho-middleware/server.js:15-20` (wiring), plus every new `captureException(err, …)` call site

**Issue:**
`scrubEvent()` mutates only `event.user.email`, `event.tags`, `event.extra`,
`event.contexts.*`, and deletes `event.request.{data,cookies,headers}`. It never
inspects:

1. **`event.exception.values[].value`** — the exception *message*. The whole
   point of this phase is adding `Sentry.captureException(err, …)` to money-path
   catch blocks (`checkout.js` order-creation `err`, `payErr`, `captureReadErr`;
   `money-path.js` `vErr`/`voidErr`; `webhooks.js` reconcile `err`). Error
   messages routinely interpolate values — Helcim/Zoho errors can embed amounts,
   customer email, or contact fields — and those ship to Sentry verbatim. The
   scrub's own header comment promises "raw monetary values never leave the
   process (T-53-02)"; this path defeats that promise.

2. **`event.breadcrumbs`** — `@sentry/node` v10 (this repo: `^10.42.0`) enables
   the console breadcrumb integration by default, and `lib/logger.js` writes
   every log via `console.log`/`console.error`. This makes the leak *provable*,
   not hypothetical: `routes/pos.js:549-551` logs
   `'[pos/kiosk/sale] Pushing to terminal: total=$' + terminal_amount.toFixed(2)`
   and `' gift_card=$' + gift_amount.toFixed(2)` at `info` level. Those raw
   dollar amounts become breadcrumbs on the request scope and attach to any
   subsequent `captureException` in that request — arriving at Sentry
   unscrubbed. `scrubEvent` never touches `event.breadcrumbs`.

3. **Fingerprint compounds it:** `fingerprintFor()` (line 101) falls back to
   `first.value` (the raw message) when `first.type` is absent, and
   `server.js:17` assigns it *after* scrubbing — so an amount/email in a message
   can become the Sentry *issue fingerprint/title*.

Net effect: the security control the phase ships to keep PII/amounts out of a
third-party service has zero coverage over the two fields the phase's own new
code most reliably populates.

**Fix:** extend `scrubEvent` to sanitize messages and breadcrumbs (and prefer
suppressing the console breadcrumb integration for money paths):
```js
// in scrubEvent(), before return:
if (event.exception && Array.isArray(event.exception.values)) {
  event.exception.values.forEach(function (ex) {
    if (ex && typeof ex.value === 'string') {
      ex.value = ex.value.replace(EMAIL_RE, function (m) { return redact.maskEmail(m); });
      // strip $-amounts / bare decimals interpolated into messages
      ex.value = ex.value.replace(/\$?\d+\.\d{2}\b/g, '[amount]');
    }
  });
}
if (Array.isArray(event.breadcrumbs)) {
  event.breadcrumbs.forEach(function (bc) {
    if (bc && typeof bc.message === 'string') {
      bc.message = bc.message
        .replace(EMAIL_RE, function (m) { return redact.maskEmail(m); })
        .replace(/\$?\d+\.\d{2}\b/g, '[amount]');
    }
    if (bc) scrubMap(bc.data);
  });
}
```
```js
// server.js — additionally drop the console breadcrumb integration so amount
// log lines never become breadcrumbs in the first place:
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  integrations: function (defaults) {
    return defaults.filter(function (i) { return i.name !== 'Console'; });
  },
  // …existing options…
});
```

## Warnings

### WR-01: `captureException` runs before the orphan-charge void logic in money-movement catch blocks

**File:** `zoho-middleware/routes/checkout.js:793-796`, `zoho-middleware/routes/pos.js:1269-1275`

**Issue:** In both money-path catch handlers the new `Sentry.captureException`
call is placed *before* the void-on-failure block that prevents an orphaned
Helcim charge (checkout: capture at ~793, void dispatch at ~868; pos: capture at
~1269, void dispatch at ~1296). `Sentry.captureException` is engineered not to
throw, so the probability is low — but the impact if it ever did (SDK bug,
serializer throwing on a circular tag/extra, OOM) is an orphaned card charge
(money taken, no order, no void), which is precisely the failure class this file
exists to prevent. Putting a non-essential observability call ahead of the
money-safety logic inverts the priority order.

**Fix:** move the `captureException` call *after* the void dispatch, or wrap it
so it can never interrupt the catch:
```js
try {
  Sentry.captureException(err, { level: 'error', tags: { /* … */ } });
} catch (_sentryErr) { /* never let telemetry block the void */ }
// … then run void-on-failure logic …
```

### WR-02: `fingerprintFor` collapses all generic `Error`s into one Sentry issue — defeats the phase's observability goal

**File:** `zoho-middleware/lib/sentry-scrub.js:92-104`, applied in `zoho-middleware/server.js:17`

**Issue:** `fingerprintFor` returns `[first.type || first.value || 'Error']`.
For the many money-path failures thrown as `new Error('…')`, `first.type` is the
constructor name `'Error'`, so **every** generic `Error` across the entire
middleware (checkout failure, webhook failure, gift-card failure, …) fingerprints
to `['Error']` and merges into a *single* Sentry issue. For a phase whose stated
purpose is money-path *observability*, this makes distinct money incidents
indistinguishable in Sentry. Conversely, when `type` is absent the `|| first.value`
fallback fingerprints on the raw message, which both under-groups (unique
messages never merge) and leaks the message into the fingerprint (see CR-01).

**Fix:** fingerprint on a stable, app-supplied dimension rather than the bare JS
type — e.g. include the `phase` tag the phase already sets, and never fall back
to the raw message:
```js
function fingerprintFor(event) {
  var type = 'Error';
  var ex = event && event.exception && event.exception.values;
  if (Array.isArray(ex) && ex.length && ex[0] && ex[0].type) type = ex[0].type;
  var phase = (event && event.tags && event.tags.phase) || 'general';
  return [type, phase];
}
```

### WR-03: Request URL/query-string retained and `scrubMap` is non-recursive — PII can still leave via GET routes

**File:** `zoho-middleware/lib/sentry-scrub.js:36-49` (non-recursive), `76-80` (request scrub)

**Issue:** `scrubEvent` deletes `event.request.data/cookies/headers` but leaves
`event.request.url` and `event.request.query_string`. Because `beforeSend` is
global (server.js) it applies to every captured event, including errors thrown
from the PII GET routes gated in `server.js:552` (`/api/contacts`,
`/api/invoices`, `/api/snapshot`) — e.g. a `?search=jane@example.com` query
string would ship unscrubbed. Separately, `scrubMap` only walks the top-level
keys of a map; a nested `{ order: { amount: 123 } }` under `event.extra` or a
context object is neither deleted nor masked, so amounts/emails one level deep
bypass the money-key/email checks.

**Fix:** also scrub the request URL/query string, and recurse into nested
objects:
```js
if (event.request && typeof event.request === 'object') {
  delete event.request.data;
  delete event.request.cookies;
  delete event.request.headers;
  delete event.request.query_string;
  if (typeof event.request.url === 'string') {
    event.request.url = event.request.url.split('?')[0];
  }
}
```
```js
function scrubMap(map) {
  if (!map || typeof map !== 'object') return;
  Object.keys(map).forEach(function (key) {
    if (isAllowlisted(key)) return;
    if (MONEY_KEY_RE.test(key)) { delete map[key]; return; }
    var value = map[key];
    if (typeof value === 'string' && EMAIL_RE.test(value)) {
      map[key] = redact.maskEmail(value);
    } else if (value && typeof value === 'object') {
      scrubMap(value); // recurse into nested objects/arrays
    }
  });
}
```

## Info

### IN-01: `eslint.config.js` lowered to `ecmaVersion: 5` with `--max-warnings 0` will hard parse-error on any ES6+ frontend syntax

**File:** `eslint.config.js:11`

**Issue:** Dropping `ecmaVersion` from `2020` to `5` is correct for the ES5
GitHub Pages frontend (per CLAUDE.md), but combined with `--max-warnings 0` it
changes the failure mode: any `const`/`let`/arrow/template-literal/optional-chain
in `js/modules/*.js` now produces a *parse error* (not a warning), failing CI
outright. This is a deliberate, defensible tightening — just confirm every
non-ignored module under `js/` is genuinely ES5 (build artifacts `js/main.js` /
`*.min.js` are correctly ignored at `eslint.config.js:6`).

### IN-02: `voidWithTimeout` caller in checkout has no trailing `.catch` — telemetry throw would surface as an unhandled rejection

**File:** `zoho-middleware/routes/checkout.js:868-880`, `zoho-middleware/lib/money-path.js:214-244`

**Issue:** `moneyPath.voidWithTimeout(...).then(...)` at checkout.js:872 has no
`.catch`. Inside `voidWithTimeout`'s non-timeout branch, the new
`Sentry.captureException(voidErr, …)` (money-path.js:227) executes *before*
`return mailerDep.sendVoidFailureAlert(...)`; if it ever threw, the outer
`.catch` callback would throw and reject `voidWithTimeout`'s promise, producing an
unhandled rejection at the checkout call site. Low probability (captureException
does not throw in practice) but easily hardened by the `try/catch` wrap suggested
in WR-01, and/or attaching a `.catch` to the caller chain.

---

_Reviewed: 2026-07-03_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
