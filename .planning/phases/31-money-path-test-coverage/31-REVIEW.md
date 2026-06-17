---
phase: 31-money-path-test-coverage
reviewed: 2026-06-17T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - zoho-middleware/__tests__/checkout-route.test.js
  - zoho-middleware/__tests__/helcim-webhook.test.js
  - zoho-middleware/jest.config.js
  - zoho-middleware/package.json
  - zoho-middleware/server.js
findings:
  critical: 0
  warning: 5
  info: 4
  total: 9
status: issues_found
---

# Phase 31: Code Review Report

**Reviewed:** 2026-06-17
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

This is a test-coverage phase. I reviewed the two new test files, the coverage-threshold
config, the `package.json` dependency change, and the `server.js` export refactor.

Verification performed (not just read):
- Ran both new test files in isolation — **2 suites, 15 pass, 4 todo**.
- Ran the full middleware suite with coverage — **35 suites, 689 pass, 4 todo**; all
  declared coverage thresholds hold (global lines 63.01% vs floor 62; checkout 52.86 vs
  52; payments 37.2 vs 36; webhooks 62.96 vs 62; helcim 26.53 vs 25; validate/logger 100).
- Diffed `server.js` against the pre-phase commit (`8b4f49da…^`). The export refactor is
  **safe**: the entire startup block (`helcimLib.init`, `cache.init`, cron, `setInterval`,
  `SIGTERM`) is now wrapped in `if (require.main === module)`, and `module.exports = app`
  is appended. App construction, middleware, and route mounting still run on `require`, which
  is required so supertest gets a fully-wired app. Running `node server.js` is behaviorally
  identical to before; requiring it in tests no longer binds a port or starts cron. Confirmed
  no open handles leak with `--detectOpenHandles` (clean exit).

No BLOCKER-class defects found in the submitted source. The findings below are about
**test honesty / strength** and **doc/threshold drift** — the kind of thing that lets the
money path silently regress while the suite stays green. Several are tautological or
mislabeled assertions that give false confidence about what is actually covered.

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: The largest money-path branch (`payment_token` / `chargeAndProceed`) is never exercised

**File:** `zoho-middleware/__tests__/checkout-route.test.js:98-105, 184-322`
**Issue:** Every fixture (`makeCheckoutBody`) and every PATH-2/3/4 override sets
`transaction_id` but **never sets `payment_token`**. In `routes/checkout.js`,
`chargeAndProceed()` (lines 838-944) only runs its pre-charge validation + void-on-failure
logic when `body.payment_token` is present; with only `transaction_id`, it short-circuits
to `checkTransactionIdAndProceed()` and skips the entire block. The coverage report confirms
`checkout.js` lines **843-943 are uncovered** — that is the production money path the
HelcimPay.js iframe actually drives (the frontend sends `payment_token`, per CLAUDE.md
"Online Payments (Helcim)"). The suite claims to cover the "money path" but tests a
secondary `transaction_id`-only path that the live checkout flow does not take. The four
ghost-charge void calls in `chargeAndProceed` (lines 863, 884, 902, 910, 933) — the most
security-critical recovery code — have zero coverage.
**Fix:** Add at least one PATH that sets `payment_token` (and asserts pre-validation void
fires when catalog is empty / item_id unknown), e.g.:
```js
test('voids charged payment_token when catalog cache is empty', function () {
  cacheLib.get.mockResolvedValue(null); // empty catalog
  return request(app)
    .post('/api/checkout')
    .send(makeCheckoutBody({ payment_token: 'tok-abc' }))
    .expect(503)
    .then(function () {
      expect(helcimLib.voidTransaction).toHaveBeenCalledWith('tok-abc');
    });
});
```

### WR-02: PATH-1 "void NOT called on success" is a tautology — passes even if success logic breaks

**File:** `zoho-middleware/__tests__/checkout-route.test.js:157-165`
**Issue:** The fixture has no `transaction_id` and no `payment_token`, so `transactionId`
is `''` inside `processCheckout`. The void block at `routes/checkout.js:716` is guarded by
`if (transactionId && …)`, making `voidTransaction` **structurally unreachable** for this
request regardless of whether Zoho succeeds or fails. `expect(helcimLib.voidTransaction)
.not.toHaveBeenCalled()` therefore asserts nothing about the success path — it would pass
even if the route 500'd. This gives false confidence that "void is correctly suppressed on
success."
**Fix:** Set `transaction_id: 'txn-ok'` in the fixture so the void guard is actually
reachable, then assert it is NOT called *because Zoho succeeded* (and assert
`payment_voided` is absent / order is 201). That makes the negative assertion meaningful.

### WR-03: Test correctness depends on a leaky env var (`RECAPTCHA_SECRET_KEY`) and worker isolation

**File:** `zoho-middleware/__tests__/checkout-route.test.js:84-88, 118-124`
**Issue:** The checkout route only reaches `proceed()` because `verifyRecaptcha` (in
`lib/checkout-helpers.js:46-48`) returns `{success:true, score:1.0}` **only when
`RECAPTCHA_SECRET_KEY` is empty**. The test comments admit a sibling file
(`checkout.test.js`) sets it to `'secret123'` and "leaks across files" in the same Jest
worker, mitigated by a `beforeEach` reset. If test ordering, worker assignment, or a future
file changes this, `verifyRecaptcha` will either (a) attempt a real outbound HTTPS call to
`www.google.com`, or (b) with the empty token default (`rcToken=''`) hit the `if (!token)`
branch and return `{success:false, score:0}`, flipping the route to a 400 and breaking every
assertion. This is a latent flakiness/network-dependency vector baked into the suite.
**Fix:** Eliminate the env-ordering dependency by mocking `lib/checkout-helpers` (or just
`verifyRecaptcha`) explicitly: `jest.mock('../lib/checkout-helpers', …)` returning a
`verifyRecaptcha: jest.fn().mockResolvedValue({ success: true, score: 1 })`. Then the test
no longer relies on the unconfigured-secret fail-open behavior or `beforeEach` cleanup, and
can never make a real network call.

### WR-04: PATH-3 / PATH-4 async assertions rely on an arbitrary `setTimeout(100)` race

**File:** `zoho-middleware/__tests__/checkout-route.test.js:228, 289, 317`
**Issue:** Three tests assert on fire-and-forget side effects (`sendVoidFailureAlert`,
`voidTransaction not called`) by waiting a fixed `setTimeout(resolve, 100)` after the HTTP
response resolves. The void recovery in `routes/checkout.js` runs in a detached
`.then()/.catch()` chain (lines 777-824) that is not awaited by the response. A 100ms fixed
delay is a timing assumption, not a synchronization point — under CI load or a slower mock
it can fire the assertion before the async callback runs, producing intermittent false
failures. It can also pass spuriously if the callback never runs at all (the assertion just
checks a mock that was never called for an unrelated reason).
**Fix:** Make the side effect awaitable. Have the mock signal completion via a resolved
promise the test can await, e.g. give `mailer.sendVoidFailureAlert` a deferred:
```js
var alertCalled;
mailer.sendVoidFailureAlert.mockImplementation(function () {
  return new Promise(function (r) { alertCalled = r; }); // or flip a flag + resolve
});
```
or poll the mock with a short retry loop until `mock.calls.length > 0` (bounded), instead of
a single fixed sleep.

### WR-05: Coverage thresholds set with ~0–1 point of headroom will produce brittle CI failures

**File:** `zoho-middleware/jest.config.js:16-24`
**Issue:** Measured-vs-floor margins are razor-thin: global 63.01 vs 62 (1.0pt), checkout
52.86 vs 52 (0.86pt), webhooks 62.96 vs 62 (0.96pt), helcim 26.53 vs 25 (1.5pt), payments
37.2 vs 36 (1.2pt). Any unrelated refactor that adds a few uncovered lines to a large file
(e.g. `pos.js` or `catalog.js` for the *global* number, which sit at 67/52% and dominate
line count) can drop the global below 62 and **fail CI on a change that has nothing to do
with this phase**, blocking unrelated work. Per-file floors below their own measured value
also do not prevent regression *within* a file as long as the percentage holds — deleting a
covered line and adding an uncovered one can net to zero.
**Fix:** Either widen the global floor headroom (the comment says "1pt headroom" — that is
the problem, not the design) to ~3-5 points below measured, or scope `collectCoverageFrom`
to the money-path files this phase actually targets so unrelated large files don't drag the
global number. Document that the global floor must be re-baselined whenever a large
untested route changes.

## Info

### IN-01: jest.config.js comment cites 63.04% but actual measured global is 63.01%

**File:** `zoho-middleware/jest.config.js:11`
**Issue:** Comment "Global: measured 63.04% lines" — the live run reports 63.01%. Minor doc
drift; harmless now but the comment is presented as an authoritative baseline ("Honest
thresholds measured 2026-06-17") and is already stale by 0.03pt.
**Fix:** Update the comment to 63.01% (or note it as approximate), and re-measure if files
change.

### IN-02: helcim webhook Block B mocks an inconsistent subset of lib modules vs checkout test

**File:** `zoho-middleware/__tests__/helcim-webhook.test.js:159-207`
**Issue:** The webhook route block mocks `helcim`, `cache`, `eventLog`, `logger`,
`brewpad-integration`, etc., but unlike `checkout-route.test.js` it does NOT mock
`../lib/mailer`, `../lib/mailerlite`, `../lib/zoho-api`, or `../lib/inventory-ledger`. These
real modules load on `require('../server')`. It works today (the webhook route doesn't touch
them and they have no side effects on require), but the divergence is undocumented and a
future change to any of those modules' module-scope code could surprise this suite.
**Fix:** Either factor the shared "server-boot mocks" set into a single helper required by
both test files, or add a comment explaining why mailer/zoho-api/etc. are intentionally left
real here.

### IN-03: Block A Case 4 (base64 key) self-documents that its proof is indirect

**File:** `zoho-middleware/__tests__/helcim-webhook.test.js:113-150`
**Issue:** The test proves the base64-decode branch is "live" by asserting the base64-keyed
signature differs from the raw-keyed one and that the base64-keyed sig verifies true. But
because `verifyWebhookSignature` tries *both* keys (helcim.js:319), a signature made with
*either* key returns true — so the verify assertion alone doesn't isolate the base64 path;
only the preceding `not.toBe` inequality does, and that's a property of `crypto`, not of the
function under test. The test's own trailing comment acknowledges this is inferential. It is
not wrong, just weaker than it reads.
**Fix:** To isolate the base64 branch directly, temporarily make the raw-string key fail
(e.g. assert that a signature built with the raw key still verifies true only because the
base64 branch is tried first) — or accept the current indirect proof and trim the long
explanatory comment so it doesn't overstate certainty.

### IN-04: `test.todo` markers are good hygiene but encode known fail-open security gaps as deferred

**File:** `zoho-middleware/__tests__/checkout-route.test.js:327-328`; `helcim-webhook.test.js:101, 260`
**Issue:** Four `test.todo`s document real fail-open behaviors that ship to production today:
unauthenticated `/api/checkout` (no API key — by design per server.js:256, but untested),
`HELCIM_WEBHOOK_SECRET` missing → all webhooks accepted (helcim.js:311-313, fail-open), and
duplicate `charge_key` not rejected when Redis is down (checkout.js:218-221, fail-open).
These are correctly characterized as Phase 32 work, not defects of this phase. Flagging only
so the deferral is visible in review: the webhook fail-open in particular means a
misconfigured prod (`HELCIM_WEBHOOK_SECRET` unset) accepts forged terminal webhooks — track
HARDEN-02 as security-priority, not generic tech debt.
**Fix:** No code change required for Phase 31. Ensure HARDEN-02 (webhook fail-closed) is
labeled `type:security` / `priority:high` on the issue board so it isn't deprioritized.

---

_Reviewed: 2026-06-17_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
