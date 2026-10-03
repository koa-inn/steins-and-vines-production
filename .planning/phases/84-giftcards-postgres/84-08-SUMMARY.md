---
phase: 84-giftcards-postgres
plan: 08
subsystem: payments
tags: [postgres, gift-cards, facade, pos, money-path, jest, pitfall-1, d-09, d-11]

# Dependency graph
requires:
  - phase: 84-giftcards-postgres
    plan: 05
    provides: "lib/gift-card-store.js — the sheets/dual/postgres facade with composite
      tx_ref minting, actorFromRequest, isConfigured, and the D-11 post-charge
      infra-failure hook this plan's pos.js wiring consumes directly"
  - phase: 84-giftcards-postgres
    plan: 06
    provides: "lib/reconcile.js's recordGiftCardReconcileFailure(record) — the durable
      giftcard:pending:<tx_ref> Redis record this plan's D-11 regression test observes"
provides:
  - "routes/pos.js's two pre-payment lookup_gift_card sites (/api/kiosk/sale,
    /api/kiosk/sale/confirm) and the four confirm-chain sites (redeem, issue,
    update-invoice, reload) all routed through lib/gift-card-store.js, honouring
    GIFT_CARDS_STORE end to end for the sale paths"
  - "__tests__/pos-giftcard-store.test.js — Pitfall 1 / D-09 / D-11 / attribution /
    sheets-parity regression coverage for the sale paths in Postgres mode"
  - "Rule 1 fix in lib/gift-card-store.js: callAppsScript() wraps axios.post() in
    Promise.resolve() (D-12 parity), restoring the fail-open defensive pattern the
    pre-84-05 pos.js code relied on"
affects: [84-09-routes-gift-cards-wiring, 84-cutover, 84-kiosk-gift-card-management]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Every pos.js gift-card HTTP call (lookup/redeem/issue/updateInvoice/reload) now
      goes through lib/gift-card-store.js instead of a direct axios.post to Apps
      Script — the facade is the only place that knows about GIFT_CARDS_STORE, mints
      tx_refs, or talks to Postgres"
    - "callAppsScript() in lib/gift-card-store.js wraps axios.post() in
      Promise.resolve() so a falsy/non-thenable return (real axios never does this,
      but an un-mocked jest.fn() in a caller's test can) rejects/resolves through the
      promise chain instead of throwing synchronously — the same defensive idiom the
      pre-84-05 pos.js code used for its direct axios.post calls (D-12, 45-07)"

key-files:
  created:
    - zoho-middleware/__tests__/pos-giftcard-store.test.js
  modified:
    - zoho-middleware/routes/pos.js
    - zoho-middleware/lib/gift-card-store.js

key-decisions:
  - "Fixed lib/gift-card-store.js's callAppsScript() (not just pos.js) under Rule 1 —
    wiring pos.js through the facade surfaced a latent gap where pos-gift-card.test.js's
    pre-payment lookup tests leave axios.post() entirely un-mocked (relying on the
    original pos.js code's Promise.resolve(axios.post(...)) wrapper to fail open to
    'unavailable'). The facade's callAppsScript() called axios.post(...).then(...)
    directly, so an un-mocked axios.post() returning undefined threw synchronously
    instead of failing open, breaking three pre-existing tests. The fix restores the
    original D-12 defensive wrapper; it is backward-compatible with every existing
    caller (gift-card-store.test.js only ever mocks axios.post with a real resolved/
    rejected promise, never a bare jest.fn())."
  - "gcConfigured / gcActor are computed once per confirm request (not re-derived per
    call site) since all four confirm-chain writes share the same isConfigured() gate
    and the same req-derived actor — matches the plan's literal action text
    (giftCardStore.actorFromRequest(req, 'kiosk-sale') on every write)."

patterns-established:
  - "Pattern: a test file that needs lib/gift-card-store.js's REAL tx_ref-minting and
    D-11 hook (not a shallow facade mock) mocks only its Postgres transport —
    ../lib/db (isConfigured/withTransaction) and ../lib/gift-card-pg (one jest.fn()
    per op) — leaving lib/gift-card-store.js and lib/reconcile.js real. This is the
    pattern 84-09's routes/gift-cards.js wiring test should reuse for the same
    Pitfall-1/D-09/D-11 assertions on that route."

requirements-completed: []  # DB-03 spans the full phase; not closeable until 84-09
  # (routes/gift-cards.js) and the kiosk balance-adjust control also land and the
  # phase's live production verification runs.

# Metrics
duration: ~20min
completed: 2026-10-03
---

# Phase 84 Plan 08: Route pos.js Gift-Card Sites Through the Store Facade Summary

**The six direct Apps-Script gift-card calls in routes/pos.js's kiosk sale/confirm chain now go through `lib/gift-card-store.js`, proven safe for Pitfall 1 (two distinct composite tx_refs), D-09 (DB-down fails closed before any charge), and D-11 (durable pending record on a post-charge infra failure) — with sheets-mode behaviour byte-for-byte unchanged.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-10-03
- **Tasks:** 2 completed
- **Files modified:** 3 (2 modified, 1 new)

## Accomplishments

- Both pre-payment `lookup_gift_card` sites (`/api/kiosk/sale` ~:734, `/api/kiosk/sale/confirm`
  ~:1397) now call `giftCardStore.lookup(cert)` + `giftCardStore.isConfigured()` instead of a
  direct `axios.post` gated on `_gcAsUrl && _gcAsToken` / `_cfAsUrl && _cfAsToken` — the exact
  discriminated `{state: ok|invalid|unavailable}` mapping and the confirm path's
  production-only-hard-reject / non-prod-fail-open split (T-44-G9) are unchanged.
- All four confirm-chain writes (redeem, issue, updateInvoice, reload, ~:1686-1816) now call
  `giftCardStore.redeem/issue/updateInvoice/reload` with `postCharge: true` and
  `actor: giftCardStore.actorFromRequest(req, 'kiosk-sale')`, replacing the `asUrl && asToken`
  gate — ordering (redeem before issue/reload, update-invoice only on issue success), logging
  text, `eventLog` events, and the `giftCardActivationFailed` surfacing are byte-for-byte
  unchanged.
- Pitfall 1 closed end to end on the sale path: a single confirm that redeems one cert AND
  issues another cert mints two distinct composite `tx_ref`s
  (`<refNumber>:<cert>:<kind>`) — proven against the real facade, not a mock.
- D-09 closed on the sale path: a Postgres outage at the pre-payment lookup returns 503 in
  production **before** `helcimLib.terminalPurchase` is ever called; a non-gift-card sale is
  completely unaffected by the same outage (the lookup never runs when no gift card is applied).
- D-11 closed on the sale path: a post-charge redeem that rejects with an infrastructure error
  surfaces `gift_card_activation_failed: true` **and** writes a durable
  `giftcard:pending:<tx_ref>` Redis record via the real `lib/reconcile.js` — verified against
  the actual `cache.set` call, not just a log line (same rule as MONEY-03 H6). A resolved
  `{ok:false, error:'insufficient_balance'}` business rejection sets the same flag but writes
  **no** pending record (an outage is recorded; a business decision is not).
- Every Postgres gift-card write from the sale path carries an actor starting with
  `'kiosk-sale:'` (T-84-47 attribution).
- Sheets-mode parity proven: with `GIFT_CARDS_STORE` unset, the same fixture still produces an
  Apps Script `redeem_gift_card` call with `transaction_ref === refNumber` (the raw ref, not a
  composite tx_ref) — zero behaviour change for the current production code path.
- **Rule 1 fix:** `lib/gift-card-store.js`'s `callAppsScript()` now wraps `axios.post()` in
  `Promise.resolve()` (restoring the D-12/45-07 defensive pattern the original pos.js code
  used), after discovering it broke three pre-existing `pos-gift-card.test.js` assertions that
  leave `axios.post` entirely un-mocked for the pre-payment lookup and rely on the fail-open
  wrapper to treat an un-mocked call as `'unavailable'` rather than a synchronous throw.

## Task Commits

1. **Task 1: Route the six pos.js gift-card sites through the facade** - `99163a2f` (feat)
   — includes the Rule 1 fix to `lib/gift-card-store.js`'s `callAppsScript()`, required for
   the task's own verification suites to pass.
2. **Task 2: Pitfall 1, D-09, D-11 and attribution regressions for the sale paths** -
   `964e0ed3` (test)

## Files Created/Modified

- `zoho-middleware/routes/pos.js` — six gift-card call sites (two lookups + four confirm-chain
  writes) now route through `giftCardStore` instead of direct `axios.post`
- `zoho-middleware/lib/gift-card-store.js` — `callAppsScript()` wraps `axios.post()` in
  `Promise.resolve()` (Rule 1 fix, see Deviations)
- `zoho-middleware/__tests__/pos-giftcard-store.test.js` — 7 new tests: Pitfall 1 (1), D-09 (2),
  D-11 + business-rejection contrast (2), attribution (1), sheets parity (1)

## Decisions Made

See `key-decisions` in frontmatter. Most notably: the Rule 1 fix was applied to
`lib/gift-card-store.js` (a file outside this plan's own `files_modified` list) because the
bug it fixes was directly surfaced by this plan's own wiring change and broke existing tests
this plan's own acceptance criteria require to keep passing unmodified — in scope per the
deviation rules' "directly caused by the current task's changes" boundary.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `lib/gift-card-store.js`'s `callAppsScript()` threw synchronously on a
falsy/non-thenable `axios.post()` return instead of failing open**
- **Found during:** Task 1 verification (`npx jest pos-giftcard.test.js pos-gift-card.test.js
  pos-money-defects.test.js pos-money.test.js`)
- **Issue:** `pos-gift-card.test.js`'s three "split-tender terminal_amount math" tests
  deliberately leave `axios.post` completely un-mocked for the pre-payment `lookup_gift_card`
  call (no `mockImplementation`/`mockResolvedValue` set) — relying on the pre-84-05 pos.js
  code's `Promise.resolve(axios.post(...))` wrapper (D-12, 45-07) to turn the resulting
  `undefined` return into a resolved promise that the `.then()` handler safely treats as
  `{state: 'unavailable'}` (fail-open in non-prod). `lib/gift-card-store.js`'s
  `callAppsScript()` called `axios.post(...).then(...)` directly with no such wrapper, so
  `axios.post()` returning `undefined` (a bare, un-mocked `jest.fn()`) threw synchronously
  inside the `cache.get(...).then(...)` chain, which propagated all the way to the outer
  `.catch(cacheErr => res.status(503)...)` and produced an unrelated "Unable to verify item
  prices" 503 instead of reaching the gift-card lookup at all.
- **Fix:** Wrapped the `axios.post(...)` call in `Promise.resolve(...)` inside
  `callAppsScript()`, matching the exact defensive idiom the code it replaced used. In
  production this is a no-op (real `axios.post` always returns a real promise); it only
  changes behaviour for a non-thenable return, which can only happen when a test's mock is
  incomplete.
- **Files modified:** `zoho-middleware/lib/gift-card-store.js`
- **Verification:** All 3 previously-failing tests pass; full `gift-card-store.test.js` (40
  tests, real axios mocks throughout) still passes unchanged; full middleware suite (141
  suites / 2217 tests) and root suite (144 suites / 2076 tests) both green; both linters clean.
- **Committed in:** `99163a2f` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** The fix was necessary for Task 1's own stated acceptance criterion ("existing
pos tests must keep passing unmodified") to hold. No scope creep — the fix is a single
defensive wrapper, backward-compatible with every existing caller of `callAppsScript()`.

## Issues Encountered

None beyond the Rule 1 fix documented above.

## User Setup Required

None — no external service configuration required. No deploy of any kind occurred (per
environment constraints); this plan is code-only, verified via mocked unit tests (no real
Postgres or Apps Script connection needed — 84-01/84-02 already proved the real Postgres
atomicity and the real Apps Script mirror action, and 84-05's own facade suite already proves
the facade's dual/postgres transport against real-shaped mocks).

## Next Phase Readiness

- The sale paths (`/api/kiosk/sale`, `/api/kiosk/sale/confirm`) are fully migrated to the
  facade and proven safe under Postgres mode for the three money-path invariants the phase
  exists to close (Pitfall 1, D-09, D-11), plus attribution (T-84-47) and zero sheets-mode
  regression.
- `routes/gift-cards.js` (next-number, lookup, void) is NOT yet wired — that is 84-09's scope,
  which this plan does not touch (`files_modified` was scoped to `routes/pos.js` only).
- The kiosk Gift Card Management balance-adjust control (D-05/D-06/D-07) is not part of this
  plan either.
- No blockers for 84-09 or the kiosk adjust-control plan: `lib/gift-card-store.js`'s full API
  surface was already complete from 84-05, and this plan's Rule 1 fix to `callAppsScript()`
  benefits every future caller (route or test) identically.
- Full middleware suite: 141 suites / 2217 tests passing, `./routes/pos.js` at 85.5% lines
  (floor 80%), `./lib/gift-card-store.js` coverage unaffected by this plan's one-line fix (still
  well above its 90% floor — the fix added no new branches). Root suite: 144 suites / 2076
  tests passing. Both linters clean.

## Self-Check: PASSED

- FOUND: zoho-middleware/routes/pos.js (modified)
- FOUND: zoho-middleware/lib/gift-card-store.js (modified)
- FOUND: zoho-middleware/__tests__/pos-giftcard-store.test.js
- FOUND commit 99163a2f (feat(84-08): route pos.js gift-card call sites through the store facade)
- FOUND commit 964e0ed3 (test(84-08): add Pitfall 1, D-09, D-11 and attribution regressions for the sale paths)
- `grep -cE "action: *'(lookup|redeem|issue|reload|update)_gift_card" zoho-middleware/routes/pos.js` → 0
- `grep -c "giftCardStore\\." zoho-middleware/routes/pos.js` → 10 (≥6 required)
- `grep -c "postCharge: true" zoho-middleware/routes/pos.js` → 3
- `git diff --stat HEAD~2 -- zoho-middleware/__tests__/` (excluding the new file) → no existing test files modified
- `grep -c "giftcard:pending:" zoho-middleware/__tests__/pos-giftcard-store.test.js` → 4
- `cd zoho-middleware && npx jest pos-giftcard-store.test.js`: 7/7 passed
- `cd zoho-middleware && npm test`: 141/141 suites, 2217/2217 tests passed
- `cd zoho-middleware && npm run lint`: clean (0 warnings)
- Root `npm test`: 144/144 suites, 2076/2076 tests passed
- Root `npm run lint`: clean (0 warnings)

---
*Phase: 84-giftcards-postgres*
*Completed: 2026-10-03*
