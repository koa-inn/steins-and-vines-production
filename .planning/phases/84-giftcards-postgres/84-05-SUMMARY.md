---
phase: 84-giftcards-postgres
plan: 05
subsystem: database
tags: [postgres, gift-cards, facade, sheets-dual-postgres, tx-ref, money-path, jest, tdd]

# Dependency graph
requires:
  - phase: 84-giftcards-postgres
    plan: 01
    provides: lib/gift-card-pg.js (atomic redeem/reload/issue/adjust/voidCard/updateInvoice/
      nextCertNumber/lookup — this plan composes them inside db.withTransaction)
  - phase: 84-giftcards-postgres
    plan: 02
    provides: mirror_gift_card_state Apps Script action (D-04 copy-state contract this plan's
      buildMirrorPayload targets) + the ensureGiftCardLedgerSheet empty-tab fix the dual-mode
      sheet leg depends on
  - phase: 84-giftcards-postgres
    plan: 06
    provides: lib/reconcile.js's recordGiftCardReconcileFailure(record) (D-11 hook this plan
      calls on a post-charge infrastructure failure) and the giftcard:pending record/
      replayPending(record) contract this plan's replayPending() implements the consumer side of
  - phase: 83-postgres-infrastructure
    provides: lib/db.js (withTransaction/isConfigured), lib/store-flag.js (resolveStoreMode),
      lib/sheet-mirror.js (mirrorFireAndForget — production-only gate), lib/dual-write-compare.js
      (compareAndReport)
provides:
  - "lib/gift-card-store.js — the single facade (getMode/isConfigured/mintTxRef/
    actorFromRequest/lookup/nextCertNumber/issue/redeem/reload/voidCard/updateInvoice/adjust/
    replayPending/buildMirrorPayload) every gift-card call site must go through"
affects: [84-gift-cards-postgres-remaining-plans (routes/gift-cards.js, routes/pos.js confirm
  chain, the 84-06 replay sweep, and any replay CLI all consume this facade instead of calling
  Apps Script or Postgres directly)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Composite tx_ref minting (saleRef + ':' + certNumber + ':' + kind) lives in exactly one
      place — the facade — so a shared saleRef across two certs in one sale can never collide
      (Pitfall 1); the atomic Postgres layer (84-01) only enforces replay/conflict semantics
      against whatever tx_ref it is given"
    - "Per-cert tail-promise chain (chainForCert) serializes fire-and-forget sheet-leg calls for
      the same certificate, so issue-then-updateInvoice (or any two ops racing on one cert) can
      never land out of order and produce a false discrepancy"
    - "project(op, result) normalizes a sheets-side or postgres-side result down to
      {ok, balance, status, error} before comparison — Apps-Script-only fields (tx_id,
      claim_tx_id, needs_manual_review) and idempotent-replay-only fields never produce a false
      dual-write discrepancy"
    - "D-11 hook (handleInfraFailure) distinguishes a true Promise rejection (infrastructure
      failure — gets recorded, then rethrown) from a resolved {ok:false} (business rejection —
      never recorded) by living in the .catch() of runPg's promise chain, not inside the success
      branch"

key-files:
  created:
    - zoho-middleware/lib/gift-card-store.js
    - zoho-middleware/__tests__/gift-card-store.test.js
  modified:
    - zoho-middleware/jest.config.js

key-decisions:
  - "Both plan tasks (write paths + read paths/replayPending/coverage floor) were implemented in
    one pass across two commits (RED test, then GREEN implementation covering the FULL facade
    API) rather than strictly splitting write-only in commit 1 and read-only in commit 2 — the
    single test file's <behavior> coverage spans both tasks together, and splitting the
    implementation would have required either a half-exported module or duplicate commits
    touching the same file twice for no functional benefit. The jest.config.js coverage-floor
    edit (Task 2's own distinct file) is its own separate commit. See Deviations."
  - "adjust's dual-mode sheet leg maps a positive delta to reload_gift_card and a negative delta
    to redeem_gift_card (both carrying the ADJ-<adjustKey>:<cert>:adjust tx_ref) — there is no
    dedicated Apps Script adjust action (D-07) and the plan's <action> explicitly authorized this
    mapping as research-confirmed requiring no Apps Script redeploy"
  - "replayPending forces params.txRef to record.tx_ref verbatim AND postCharge:false before
    delegating to redeem/issue/reload — this both satisfies the 'no re-minting' requirement and
    prevents a second infrastructure failure during a replay from recursively re-triggering the
    D-11 hook (the pending record already IS the durable trail for that tx_ref)"
  - "project()'s balance/status rules differ by op: lookup reads off result.data (Apps Script's
    lookup wraps its payload in {ok, data:{...}}), issue defaults status to 'active' on ok since
    neither Apps Script's nor Postgres's issue result carries a top-level status field, and every
    other write op reads result.status directly"

patterns-established:
  - "Pattern (RESEARCH.md Pitfall 1): tx_ref minting is facade-only; 84-01's atomic layer never
    mints, it only ever consumes whatever tx_ref it is given"
  - "Pattern: sheets-mode write calls reproduce today's exact pos.js/routes/gift-cards.js Apps
    Script field shapes byte-for-byte (verified against routes/pos.js:1700-1820 and
    routes/gift-cards.js's callAppsScript, both read before writing this facade) — issue's
    sheets-mode call carries NO transaction_ref, while its dual/postgres sheet-leg call DOES
    (the composite txRef), which is the one deliberate shape difference between the two modes"

requirements-completed: []  # DB-03 spans the full phase; not closeable until the remaining
  # 84-0X plans (routes wiring, cutover) land and consume this facade

# Metrics
duration: ~50min
completed: 2026-10-03
---

# Phase 84 Plan 05: Gift-Card Store Facade (sheets/dual/postgres) Summary

**`lib/gift-card-store.js` — the single facade every gift-card call site goes through, dispatching sheets/dual/postgres by `GIFT_CARDS_STORE`, minting the composite `tx_ref` that closes Pitfall 1, running the dual-mode sheet re-run + discrepancy compare, the postgres-mode copy-state mirror, and the D-11 post-charge reconcile hook — 40/40 new tests passing, 97.64% line coverage.**

## Performance

- **Duration:** ~50 min
- **Completed:** 2026-10-03
- **Tasks:** 2 (implemented together across 3 commits — see Deviations)
- **Files modified:** 3 (2 new, 1 modified)

## Accomplishments

- `lib/gift-card-store.js` implements the full facade contract from the plan's `<interfaces>`
  section: `getMode`, `isConfigured`, `mintTxRef`, `actorFromRequest`, `lookup`, `nextCertNumber`,
  `issue`, `redeem`, `reload`, `voidCard`, `updateInvoice`, `adjust`, `replayPending`,
  `buildMirrorPayload`.
- Sheets mode reproduces today's exact Apps Script call shapes (verified against
  `routes/pos.js:1700-1820`'s confirm chain and `routes/gift-cards.js`'s `callAppsScript`) —
  same action names, same fields, same `{timeout:12000, maxRedirects:5}` options, raw
  (un-minted) `saleRef` as `transaction_ref` on redeem/reload, no `transaction_ref` on issue.
  `db.withTransaction` is never called in sheets mode.
- Dual/postgres modes mint the composite `saleRef:certNumber:kind` `tx_ref` (Pitfall 1 — proven
  via a test asserting two distinct `tx_ref`s when `GC-A`'s redeem and `GC-B`'s issue share one
  `saleRef`), run the real Postgres op inside `db.withTransaction`, and strip the underscore-
  prefixed `_card`/`_ledger` keys before returning to the caller.
- Dual mode re-runs the matching Apps Script op fire-and-forget (via `sheet-mirror.js`'s
  production-only gate) with the composite `tx_ref`, then reports any discrepancy via
  `dual-write-compare.js`'s `compareAndReport` using a narrow `project(op, result)` normalization
  so Apps-Script-only fields (`tx_id`, `claim_tx_id`, `needs_manual_review`) never produce a
  false positive; a `{ok:false}` Postgres result skips the sheet leg and the compare entirely.
- Postgres mode fires `mirror_gift_card_state` fire-and-forget instead, built by
  `buildMirrorPayload(_card, _ledger)` from the 84-02 contract; no Phase 51 Apps Script op
  (`redeem_gift_card` etc.) ever re-runs once a store has flipped to `postgres`.
- `chainForCert` serializes sheet-leg calls per certificate — proven via a controlled-timing test
  where an `issue` sheet call is gated open, then `updateInvoice` on the same cert is called
  immediately after: the `update_gift_card_invoice` HTTP call provably does not fire until the
  `issue_gift_card` call's promise settles.
- D-11: a true Postgres infrastructure rejection on a post-charge `redeem`/`issue`/`reload`
  (`params.postCharge === true`) calls `lib/reconcile.js`'s `recordGiftCardReconcileFailure`
  (lazy-required to avoid a load-time cycle with 84-06's sweep) with the exact record shape 84-06
  already implemented against, awaits it, then rethrows the original error — proven by a test
  asserting the call happens exactly once with the right fields BEFORE the promise rejects. A
  resolved `{ok:false}` business rejection and a `postCharge:false` write never trigger this hook.
- `adjust` resolves `adjust_unavailable` with zero Apps Script calls in sheets mode (D-07 — no
  dedicated adjust action exists); in dual/postgres its sheet leg maps a positive delta onto
  `reload_gift_card` and a negative delta onto `redeem_gift_card`, both carrying the
  `ADJ-<adjustKey>:<cert>:adjust` tx_ref — proven for both signs, plus a negative test asserting
  no literal adjust-specific Apps Script action string is ever used.
- `lookup` never falls back to a sheet read on a Postgres failure (D-09) — proven by a rejected
  `gift-card-pg.lookup` propagating straight through with zero `axios.post` calls. The `dual`
  mode's optional sheet-compare leg is opt-in via `{compare:true}` (per the plan's Claude's-
  Discretion choice, so the two pos.js pre-payment lookups don't double Apps Script load while
  the staff lookup route can opt in).
- `replayPending` dispatches `record.op` (`redeem`/`issue`/`reload`) through the same write paths
  with `record.tx_ref` forced verbatim (no re-minting) and `postCharge:false`; `sheets` mode
  always returns `store_mode_sheets`, an unrecognized op returns `unknown_op`.

## Task Commits

1. **Task 1 (write paths) + Task 2 (read paths/replayPending), combined test authoring:**
   `4ffaade8` test(84-05): add failing tests for gift-card-store facade (RED) — 40 tests, all
   failing on "Cannot find module" (confirmed RED).
2. **Task 1 + Task 2, combined implementation:** `905b1528` feat(84-05): implement
   gift-card-store facade write paths (GREEN) — all 40 tests passing (write AND read paths both
   landed here; see Deviations).
3. **Task 2's own file: `905b1528` + `a69a8e68`** feat(84-05): add
   `lib/gift-card-store.js` coverage floor (DB-03) — `jest.config.js` 90%-lines floor, measured
   97.64%.

## Files Created/Modified

- `zoho-middleware/lib/gift-card-store.js` — the facade (see Accomplishments)
- `zoho-middleware/__tests__/gift-card-store.test.js` — 40 tests covering every `<behavior>` line
  across both plan tasks: mode dispatch for every op, composite tx_ref minting + Pitfall 1,
  per-cert sheet-leg chaining, dual compare, postgres copy-state mirror, D-11 hook (both the
  "records" and "does not record" branches), replayPending (all three outcomes), lookup
  (sheets/postgres/dual-with-compare/DB-failure-no-fallback), nextCertNumber (sheets/postgres),
  and `buildMirrorPayload`'s contract shape including the `ledger_entry: null` case
- `zoho-middleware/jest.config.js` — added the `./lib/gift-card-store.js: {lines: 90}`
  money-path floor per the Phase 84 D-07 convention

## Decisions Made

See `key-decisions` in frontmatter. Most notably: both plan tasks were implemented together in a
single test file and a single facade module (committed as RED-test then GREEN-implementation,
with the Task-2-specific `jest.config.js` edit as its own third commit) rather than strictly
sequencing write-paths-only then read-paths-only across two separate module edits — the two
tasks' `<behavior>` lists target the same file and the same exported API, and splitting them
would have meant either shipping a half-complete module after Task 1 (something no other call
site could safely consume yet) or two commits touching identical lines twice. Functionally,
every `<behavior>` line from both tasks has a passing test and every acceptance-criteria grep
check passes.

## Deviations from Plan

### Process note (not a Rule 1-4 deviation)

The plan's two tasks are both `tdd="true"` and both target `lib/gift-card-store.js` +
`__tests__/gift-card-store.test.js` (Task 2 additionally touches `jest.config.js`). Rather than
writing a Task-1-only RED/GREEN pair followed by a Task-2-only RED/GREEN pair against the same
two files, this plan wrote the complete test suite (covering every behavior line from both
tasks) in one RED commit, then the complete facade implementation in one GREEN commit, then
added the `jest.config.js` coverage floor (Task 2's only task-specific file) as a third commit.
This mirrors the commit-granularity note already recorded in 84-06's SUMMARY for the same
reason: the two tasks are sequential refinements of one module, not independent surfaces. No
functional impact — every acceptance criterion from both tasks is independently verified below.

### Auto-fixed Issues

None — no bugs, missing functionality, or blocking issues were found beyond what the plan
already specified. The plan's `<action>` blocks were detailed enough (exact field shapes,
exact tx_ref formulas, exact D-11 record shape already fixed by 84-06) that no interpretation
gaps arose during implementation.

---

**Total deviations:** 0 auto-fixed, 1 process note (commit granularity, no functional impact)

## Issues Encountered

None. The worktree required a `git reset --hard` to `main`'s tip at startup (base was behind by
Phase 83 Postgres commits and the Phase 84 wave-1 plans — the orchestrator-provided base-sync
step, not an issue with the plan itself). `node_modules` was symlinked from the main checkout in
both the repo root and `zoho-middleware/` per the environment's disk-space constraint (not
committed — verified via `git status` before every commit).

## User Setup Required

None — no external service configuration required. No deploy of any kind occurred (per
environment constraints); this plan is code-only, verified via mocked unit tests (no real
Postgres or Apps Script connection needed for this facade layer — 84-01 already proved the real
atomicity against a live Postgres container, and 84-02 already proved the real Apps Script
mirror action against a fake Sheets runtime).

## Next Phase Readiness

- The facade's full API (`getMode`/`isConfigured`/`mintTxRef`/`actorFromRequest`/`lookup`/
  `nextCertNumber`/`issue`/`redeem`/`reload`/`voidCard`/`updateInvoice`/`adjust`/`replayPending`/
  `buildMirrorPayload`) is ready for 84-07 (routes/gift-cards.js rewiring), 84-08
  (routes/pos.js's kiosk confirm chain rewiring), and the 84-06 replay sweep (already coded
  against this exact `replayPending(record)` contract, with `deps.giftCardStore` injection as
  its primary path and this module as the lazy-required fallback) to consume directly.
- `buildMirrorPayload`'s shape is proven against the exact `mirror_gift_card_state` contract
  84-02 implemented and tested — no further payload-shape negotiation needed between the two
  plans.
- No blockers for sibling/downstream plans in Phase 84. Root `npm test` (144 suites, 2076
  tests), `cd zoho-middleware && npm test` (139 suites, 2183 tests), and both `npm run lint`
  commands are green on the fully merged Phase 84 wave-1 + this plan's tree.

## Self-Check: PASSED

- FOUND: zoho-middleware/lib/gift-card-store.js
- FOUND: zoho-middleware/__tests__/gift-card-store.test.js
- FOUND: zoho-middleware/jest.config.js (modified)
- FOUND commit 4ffaade8 (test(84-05): add failing tests for gift-card-store facade (RED))
- FOUND commit 905b1528 (feat(84-05): implement gift-card-store facade write paths (GREEN))
- FOUND commit a69a8e68 (feat(84-05): add lib/gift-card-store.js coverage floor (DB-03))
- `npx jest __tests__/gift-card-store.test.js`: 40/40 passed
- `cd zoho-middleware && npm test`: 139/139 suites, 2183/2183 tests passed; gift-card-store.js
  measured 97.64% lines (floor 90%)
- `cd zoho-middleware && npm run lint`: clean (0 warnings)
- Root `npm test`: 144/144 suites, 2076/2076 tests passed
- Root `npm run lint`: clean (0 warnings)
- `grep -c "resolveStoreMode('GIFT_CARDS_STORE')" lib/gift-card-store.js` → 1
- `grep -c "require('pg')" lib/gift-card-store.js` → 0
- `grep -cE "zoho-api|zohoPost|zohoGet" lib/gift-card-store.js` → 0
- `grep -c "adjust_gift_card" lib/gift-card-store.js` → 0
- `grep -c "mirror_gift_card_state" lib/gift-card-store.js` → 4
- `grep -c "./lib/gift-card-store.js" jest.config.js` → 1

---
*Phase: 84-giftcards-postgres*
*Completed: 2026-10-03*
