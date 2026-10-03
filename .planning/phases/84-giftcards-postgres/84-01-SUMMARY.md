---
phase: 84-giftcards-postgres
plan: 01
subsystem: database
tags: [postgres, pg, node-pg-migrate, gift-cards, ledger, atomicity, money-path]

# Dependency graph
requires:
  - phase: 83-postgres-infrastructure
    provides: lib/db.js (query/withTransaction/createPool), migration-guard.js + migration-allowlist.js (fail-closed additive-only gate), Testcontainers pg-harness.js (postgres:18-alpine)
provides:
  - "migrations/0002_gift_cards.sql — gift_cards + gift_card_transactions + gift_card_cert_seq, additive only"
  - "lib/gift-card-pg.js — atomic per-op Postgres functions (lookup/issue/redeem/reload/adjust/voidCard/updateInvoice/nextCertNumber)"
  - "Real-Postgres atomicity proofs for ROADMAP SC1 (replay, crash-then-retry, concurrency, Pitfall 1 composite-tx_ref guard)"
affects: [84-04-backfill, 84-05-gift-card-store-facade, 84-gift-cards-postgres-remaining-plans]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Atomic write-op shape: select...for update row lock -> tx_ref replay check (idempotent same cert+kind / tx_ref_conflict on mismatch) -> business checks (plain {ok:false} rejection, never throw) -> insert ledger row (on conflict (tx_ref) do nothing) -> guarded balance update (current_balance + delta >= 0); only the two defence-in-depth guards (GC_TXREF_RACE, GC_GUARD_FAILED) throw"
    - "Composite tx_ref values prevent the shared-refNumber collision across certs in one sale (Pitfall 1) — minting happens one layer up (84-05 facade), this module just enforces UNIQUE + cert/kind-match replay semantics"
    - "date-only Postgres columns are read back via local Date components (getFullYear/getMonth/getDate), never .toISOString() — pg's date parser builds the JS Date in local time, so toISOString() can shift the calendar day depending on server timezone"
    - "Every write result carries underscore-prefixed _card/_ledger for the facade's copy-state mirror; the facade strips them before responding to callers"

key-files:
  created:
    - zoho-middleware/migrations/0002_gift_cards.sql
    - zoho-middleware/lib/gift-card-pg.js
    - zoho-middleware/__tests__/db/gift-card-pg.test.js
  modified: []

key-decisions:
  - "Amount/delta validation happens before any DB call (pure, synchronous) for all write ops — matches the plan's issue() ordering and avoids a wasted query for an invalid shape"
  - "issue() distinguishes missing_fields (absent/NaN faceValue) from invalid_amount (bad precision, zero, negative, out of range) per the interface contract; redeem/reload/adjust map all bad shapes to invalid_amount since missing_fields is not in their error union"
  - "voidCard checks status BEFORE any replay logic so a double-void returns invalid_status (parity with the existing Apps Script voidGiftCard), rather than ever reaching an idempotent-replay branch"
  - "No extra validation added for adjust's reason/actor_name presence beyond the DB CHECK constraint — out of scope for this plan; the facade (84-05) owns that gate per CONTEXT's Claude's-Discretion section"

patterns-established:
  - "Pattern 1 (RESEARCH.md): composite tx_ref minting happens in the facade, not this module — this module only needs cert_number+kind to decide replay vs conflict"
  - "Pattern 2 (RESEARCH.md): atomic redeem/reload/adjust SQL shape, now implemented and proven against real Postgres 18"

requirements-completed: []  # DB-03 spans the full phase; not closeable until the remaining 84-0X plans land

# Metrics
duration: ~55min
completed: 2026-10-03
---

# Phase 84 Plan 01: GiftCards Schema + Atomic Postgres Operations Summary

**Additive `gift_cards`/`gift_card_transactions` migration plus `lib/gift-card-pg.js`'s atomic redeem/reload/issue/adjust/void operations, proven against real `postgres:18-alpine` with 22 passing tests covering replay, crash-then-retry, concurrency, and the Pitfall-1 shared-tx_ref guard.**

## Performance

- **Duration:** ~55 min
- **Completed:** 2026-10-03T19:25:39Z
- **Tasks:** 2
- **Files modified:** 3 (all new)

## Accomplishments
- `migrations/0002_gift_cards.sql` creates `gift_card_cert_seq`, `gift_cards` (numeric(10,2) balances, `GC-NNNNNN` check), and the append-only `gift_card_transactions` ledger (`tx_ref` UNIQUE, per-kind signed-amount CHECK constraints, `imported` flag) — passes both the legacy regex guard and the new libpg-query-backed allowlist, and applies cleanly against a real Postgres 18 container.
- `lib/gift-card-pg.js` implements the full exported contract (`lookup`, `issue`, `redeem`, `reload`, `adjust`, `voidCard`, `updateInvoice`, `nextCertNumber`) as pure functions over a caller-supplied transaction client — never imports `pg`, never creates a pool.
- ROADMAP success criterion 1 (atomic redeem/reload closing the Sheets double-write crash window) is proven, not just claimed: 22 real-Postgres tests cover same-tx_ref replay, a genuine crash (BEGIN/op/ROLLBACK) followed by a real retry, two concurrent transactions racing a redeem (exactly one succeeds, the other gets `insufficient_balance`), the Pitfall 1 shared-sale-ref-across-two-certs regression, `tx_ref_conflict` on a reused raw ref across different certs/kinds, every status-transition rule (depleted/void rejections, reload-restores-active), adjust's floor-at-zero and active-only rules, double-void, issue duplicate/idempotent/sequence-bump, `nextCertNumber`'s skip-existing loop, and the `current_balance == sum(ledger)` invariant.

## Task Commits

1. **Task 1: Additive migration 0002_gift_cards.sql** - `90e54ae6` (feat)
2. **Task 2: lib/gift-card-pg.js atomic operations + real-Postgres proofs** - `4d53f43b` (test, RED) / `b1bcbe4f` (feat, GREEN)

_TDD plan: RED (all 22 tests failed on "Cannot find module") confirmed before GREEN was committed._

## Files Created/Modified
- `zoho-middleware/migrations/0002_gift_cards.sql` - gift_card_cert_seq + gift_cards + gift_card_transactions DDL, additive only
- `zoho-middleware/lib/gift-card-pg.js` - atomic per-op Postgres functions taking a transaction client
- `zoho-middleware/__tests__/db/gift-card-pg.test.js` - real-Postgres atomicity proofs (22 tests)

## Decisions Made
- Amount/delta shape validation (finite, <=2 decimals, within +-99999999.99) runs before any query for every write op, mirroring the plan's explicit ordering for `issue()`.
- `issue()`'s `missing_fields` vs `invalid_amount` split follows the interface contract exactly; the other three write ops collapse all bad-shape cases to `invalid_amount` since `missing_fields` isn't in their documented error union.
- `voidCard()` checks status before any tx_ref replay logic, so a double-void returns `invalid_status` rather than an idempotent replay — this matches the existing Apps Script `voidGiftCard` behavior byte-for-byte.
- Deferred adjust's `reason`/`actor_name` presence validation to the DB CHECK constraint (and ultimately the 84-05 facade) rather than adding it here — out of this plan's documented `<behavior>` scope.

## Deviations from Plan

None - plan executed exactly as written. One lint fix was needed and applied within the GREEN commit before it landed (not a separate deviation commit): `eqeqeq` (no loose `!=`) flagged 9 warnings in the default-parameter fallbacks; replaced with an `orNull()` helper using strict `===` checks. This is normal TDD iteration (writing code, running the verify command, fixing lint before the GREEN commit), not a plan deviation.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. No deploy of any kind occurred (per environment constraints); this plan is code-only, verified locally against a throwaway Testcontainers Postgres 18 instance.

## Next Phase Readiness
- The schema and atomic operations module are ready for 84-05 (the `lib/gift-card-store.js` facade) to compose: mint the composite `tx_ref`, dispatch on `GIFT_CARDS_STORE`, and call these functions inside `db.withTransaction()`.
- Also ready for 84-04 (backfill): `gift_cards`/`gift_card_transactions` exist with the exact column shapes the backfill orchestration script needs to target, including the `imported` flag for historical ledger rows.
- No blockers. This plan's own `npm run migrate:guard`, `npm run test:db -- gift-card-pg`, `npm test` (middleware 2129/2129, frontend 2048/2048), and `npm run lint` are all green.

## Self-Check: PASSED

- FOUND: zoho-middleware/migrations/0002_gift_cards.sql
- FOUND: zoho-middleware/lib/gift-card-pg.js
- FOUND: zoho-middleware/__tests__/db/gift-card-pg.test.js
- FOUND commit 90e54ae6 (feat: migration)
- FOUND commit 4d53f43b (test: RED)
- FOUND commit b1bcbe4f (feat: GREEN)

---
*Phase: 84-giftcards-postgres*
*Completed: 2026-10-03*
