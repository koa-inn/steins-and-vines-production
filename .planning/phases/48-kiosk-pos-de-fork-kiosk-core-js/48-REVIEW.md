---
phase: 48-kiosk-pos-de-fork-kiosk-core-js
reviewed: 2026-07-04T15:18:24Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - js/kiosk-core.js
  - js/kiosk.js
  - js/admin.js
  - tests/frontend/kiosk-core-parity.test.js
findings:
  critical: 0
  warning: 5
  info: 2
  total: 7
status: issues_found
---

# Phase 48: Code Review Report

**Reviewed:** 2026-07-04T15:18:24Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Reviewed the Phase 48 kiosk POS de-fork: the duplicated cart/payment/void logic
that previously lived in both `js/kiosk.js` and `js/admin.js` is now a single
shared `js/kiosk-core.js` (dual-mode `window.KioskCore` / `module.exports`), with
both surfaces injecting only environment (auth seam + bridged cart state) via
`KioskCore.init(env)`.

I compared the new core line-by-line against the pre-phase implementations
(`git show 71ef87f:js/kiosk.js` / `:js/admin.js`) for the four focus areas.

Assessment of the four focus areas:

1. **Auth-injection seam** — Correct. `_kcMergeAuth` shallow-merges
   `buildAuthOptions()` into every outgoing fetch; kiosk injects
   `{ headers: { 'x-device-token': … } }`, admin injects `{ credentials: 'include' }`.
   Admin's `getMwHeaders()`/`getRecipesMwHeaders()` only ever added `Content-Type`
   (session cookie carries auth), so nothing is lost by routing admin GETs through
   the core with credentials-only. The parity test (`assertAuthDivergence`) pins
   this. No defect.

2. **Idempotency key = reference_number** — The core unifies `idempotency_key` on
   `reference_number` with no random suffix (`refNumber = 'KIOSK-' + Date.now()`),
   matching the pre-phase kiosk behaviour and intentionally dropping admin's old
   `refNumber + '-' + Math.random().toString(36)…` suffix (D-05). This is the
   intended change and is asserted by the test. See WR-02 for the one live edge
   this creates on the override resubmit.

3. **Manager Override 409 flow** — Ported faithfully from admin; both surfaces now
   render the conflict panel and wire `#kiosk-stock-override-btn` to resubmit with
   `override:true`. Works, but see WR-03 (the manual-confirm timer is not cancelled
   on a 409) and WR-02 (resubmit reuses the conflicted idempotency key — old admin
   regenerated it).

4. **Behaviour drift** — Two real drifts found: admin's recipe-sale terminal path
   changed from immediate-confirm to poll-based (WR-04), and `mwUrl` moved from
   lazy-per-call to cached-at-init (WR-01). The `modified_ingredients`/void-on-
   failure forwarding is otherwise a verbatim, correct migration.

No blockers. Five warnings (mostly money-path robustness edges introduced by the
unification) and two info items.

## Warnings

### WR-01: `mwUrl` cached once at `KioskCore.init` — lazy→eager regression risk

**File:** `js/kiosk-core.js:67-69`, `js/kiosk.js:42`, `js/admin.js:9828`
**Issue:** The core caches the middleware URL a single time at init
(`_kcEnv.mwUrl = env.mwUrl`, fed by `mwUrl: kioskMwUrl()` evaluated synchronously
at `KioskCore.init(...)` call time). Every downstream function reads the cached
`_kcEnv.mwUrl`. In the pre-phase code, `kioskMwUrl()` was re-evaluated lazily on
every call, so it recovered if `SHEETS_CONFIG.MIDDLEWARE_URL` became available
after the IIFE ran. With the cache, if `SHEETS_CONFIG` is not populated at init
time (async/late config injection, script-order change), the core captures `''`
permanently and *every* kiosk/admin middleware call silently no-ops or errors,
with no recovery path. This is a behaviour change, not preserved-as-is.
**Fix:** Keep the lazy read — either store the resolver instead of the value, or
re-resolve on use:
```js
// init: keep a getter
if (typeof env.mwUrl === 'function') { _kcEnv.getMwUrl = env.mwUrl; }
else if (typeof env.mwUrl !== 'undefined') { _kcEnv.getMwUrl = function () { return env.mwUrl; }; }
// call sites: var mw = _kcEnv.getMwUrl();
```
Or, at minimum, have consumers pass `mwUrl: kioskMwUrl` (the function) and have the
core invoke it. If config is guaranteed loaded before the IIFE in every entry
point, document that invariant explicitly.

### WR-02: Manager-Override resubmit reuses the idempotency key of the 409'd attempt

**File:** `js/kiosk-core.js:2390-2391, 2535, 2576-2580, 2607-2612`
**Issue:** On the initial recipe push the body carries
`idempotency_key: refNumber`. When staff clicks the override button, the same
closure re-invokes `_kioskPushToTerminal()`, which re-POSTs the *same*
`recipeSaleBody` (same object reference) — so the override resubmit sends the
**identical** `idempotency_key`/`reference_number` as the request the server just
rejected with a 409. The pre-phase admin override regenerated a fresh
`idempotencyKey` (`refNumber + '-' + Math.random()…`) on resubmit precisely
because it re-ran the whole outer function, so its resubmit was a distinct
request. If the server persists/caches the 409 response under the idempotency key,
the override resubmit will replay the cached conflict instead of re-evaluating
with `override:true`, silently defeating Manager Override.
**Fix:** Confirm the middleware does NOT persist non-terminal (409 conflict)
responses under the idempotency key. If it might, mint a fresh idempotency key for
the override resubmit while keeping `reference_number` stable, e.g.:
```js
overrideBtn.onclick = function () {
  _kioskStockOverride = true;
  recipeSaleBody.idempotency_key = refNumber + '-ovr'; // distinct replay key
  if (conflictEl) conflictEl.style.display = 'none';
  _kioskPushToTerminal();
};
```

### WR-03: Manual-confirm timer is armed on the 409 early-return, overlaying the override panel

**File:** `js/kiosk-core.js:2593-2615, 2662-2670`
**Issue:** `_kioskPushToTerminal` schedules the "Confirm Manually" fallback
`setTimeout(…, POLL_TIMEOUT_MS)` unconditionally as its last statement — it is
scheduled outside the fetch chain and fires regardless of how the push resolved.
On a recipe-sale 409 the function hides the spinner, renders the stock-conflict
panel, and `return`s — but the manual-confirm timer stays armed. ~45s later it
reveals `#kiosk-confirm-payment` ("Confirm Manually") and overwrites the message
with "Waiting for terminal… or confirm manually if payment was taken", layered on
top of the conflict panel. Clicking it calls `confirmSale('manual-confirm')`,
which POSTs `…/recipe-sale/confirm` with `override:false` and a sentinel
`transaction_id` for a sale the server just rejected for insufficient stock — with
no terminal charge ever having occurred. This is only defended by the server's
confirm-time stock re-check (comment cites `pos-recipe.js:610`); if that check has
any gap it books an unpaid/invalid invoice. The override click also does not clear
this pending timer.
**Fix:** Cancel/guard the manual-confirm reveal on the non-202 early-return paths.
Track the timer id and clear it when rendering the conflict panel (and in the
override onclick), or gate the `setTimeout` body on a flag that the 409 branch
sets:
```js
var manualConfirmTimer = setTimeout(function () {
  if (cancelled || saleCompleted || stockConflictShown) return;
  …
}, POLL_TIMEOUT_MS);
// in the 409 branch: stockConflictShown = true; clearTimeout(manualConfirmTimer);
```

### WR-04: Admin recipe-sale terminal flow silently changed from immediate-confirm to poll-based

**File:** `js/kiosk-core.js:2616-2649` vs pre-phase `js/admin.js` (old lines
~11090-11135)
**Issue:** The pre-phase admin recipe sale did NOT poll the terminal: on `202
pending` it immediately POSTed `…/recipe-sale/confirm` using
`reference: result.data.reference` and `transaction_id: result.data.transaction_id`
from the push response. The unified core routes admin recipe sales through kiosk's
poll loop instead: `202 pending` → `setInterval` poll `…/api/kiosk/sale/status` →
on `'approved'` → `confirmSale(statusData.transaction_id)` with
`reference: refNumber`. This is a material change to admin's money path (different
confirm timing, different `reference`/`transaction_id` source). Adopting kiosk's
proven poll flow on the shared endpoint is the plausible intent of the de-fork, but
it is behaviour drift that the parity test does not cover — the test stops at the
initial push call and never exercises the 202→poll→confirm chain.
**Fix:** No code change required if the poll flow is the intended unified path
(likely). Add an end-to-end test (or manual staging validation) of an admin
recipe sale through 202→poll→approved→confirm, and record in the phase summary
that admin's recipe terminal handling was intentionally migrated onto the
poll-based path.

### WR-05: Parity test's `modified_ingredients` assertion is tautological — Pitfall 3 is not actually exercised

**File:** `tests/frontend/kiosk-core-parity.test.js:307-308`
**Issue:** The recipe-sale parity test asserts:
```js
expect(Object.prototype.hasOwnProperty.call(kioskBody, 'modified_ingredients') ||
  kioskBody.modified_ingredients === undefined).toBe(true);
```
This can never fail: if the key is absent the right operand is `true`; if present,
`JSON.stringify` already dropped it when it was `undefined`, so it is again `true`.
The test seeds a recipe cart with NO ingredient modification (comment admits
"undefined here — no modification made"), so `modified_ingredients` forwarding —
the exact admin bug (Pitfall 3) this de-fork was meant to fix — is never verified.
A regression that dropped `modified_ingredients` on one surface would pass this
suite.
**Fix:** Seed a modification and assert the field is forwarded with the edited
quantities on BOTH surfaces:
```js
surface.core._setModifiedIngredients([
  { item_id: 'ING-1', item_name: 'Pale Malt', quantity: 9, unit: 'kg' }
]);
// after proceedToPayment:
expect(kioskBody.modified_ingredients).toEqual(adminBody.modified_ingredients);
expect(kioskBody.modified_ingredients[0].quantity).toBe(9);
```

## Info

### IN-01: Redundant dead assignment in `kioskSyncKitFees`

**File:** `js/kiosk-core.js:586`
**Issue:** The `else` branch sets `_kioskMakersFeeWaived = false`, but the function
already returned early at line 575 when `_kioskMakersFeeWaived` was truthy, so this
branch only runs when the flag is already `false`. The assignment is a no-op.
Harmless and matches the pre-phase source, but it reads as if it were meaningful
state-clearing.
**Fix:** Remove the redundant assignment, or add a comment noting it is a
defensive reset for the (currently unreachable) waived-with-no-kits state.

### IN-02: Fixed-amount discount last-line clamp can under-distribute vs. reported total

**File:** `js/kiosk-core.js:661-678`
**Issue:** In the fixed-amount discount branch the final matched line receives
`d = remaining`, then is clamped `if (d > lt) d = lt`. When the last line's total
is smaller than the un-allocated remainder, the clamp drops the excess, so
`sum(lineDiscount)` can be less than the reported `discountAmount = kioskR2(fixed)`.
The per-line `lineDiscount` map (used to compute the taxable base per line) and the
headline `discount` total can then disagree by cents on pathological carts. This
is pre-existing logic carried over verbatim (not introduced by this phase) and only
bites when a fixed discount exceeds the last matched line's subtotal, so I flag it
as Info rather than a regression.
**Fix:** If tightened later, clamp against the running remainder and redistribute
the clamped excess across earlier lines, or derive the reported total from
`sum(lineDiscount)` rather than from `fixed`.

---

_Reviewed: 2026-07-04T15:18:24Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
